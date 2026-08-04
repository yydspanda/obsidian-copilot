jest.mock("obsidian", () => {
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs").promises;
  const path = jest.requireActual<typeof import("node:path")>("node:path");

  class FileSystemAdapter {
    private readonly tails = new Map<string, Promise<void>>();

    /** Creates a fake desktop adapter rooted at one real temporary directory. */
    constructor(private readonly basePath: string) {}

    /** Returns the fake Vault root. */
    getBasePath(): string {
      return this.basePath;
    }

    /** Resolves one Vault-relative path beneath the fake root. */
    getFullPath(normalizedPath: string): string {
      return path.join(this.basePath, ...normalizedPath.split("/"));
    }

    /** Reads exact UTF-8 file contents. */
    read(normalizedPath: string): Promise<string> {
      return fs.readFile(this.getFullPath(normalizedPath), "utf8");
    }

    /** Serializes one fake atomic plaintext transform per file path. */
    async process(
      normalizedPath: string,
      transform: (currentContent: string) => string
    ): Promise<string> {
      const previous = this.tails.get(normalizedPath) ?? Promise.resolve();
      let release: () => void = () => undefined;
      this.tails.set(
        normalizedPath,
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      await previous;
      try {
        const current = await this.read(normalizedPath);
        const next = transform(current);
        await fs.writeFile(this.getFullPath(normalizedPath), next, "utf8");
        return next;
      } finally {
        release();
      }
    }
  }

  return {
    FileSystemAdapter,
    normalizePath: (value: string) => value,
  };
});

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { FileSystemAdapter } from "obsidian";

import {
  ObsidianAtomicRuntimeFile,
  ObsidianAtomicRuntimeFileUnsupportedError,
} from "@/knowledge/runtime/ObsidianAtomicRuntimeFile";
import type { ObsidianNodeRuntimeModules } from "@/knowledge/runtime/ObsidianNodeRuntime";

type TestFileSystemAdapter = FileSystemAdapter & {
  getFullPath(normalizedPath: string): string;
};

const temporaryDirectories: string[] = [];
const RUNTIME_PATH = "Config/plugins/copilot/runtime.json";

/** Loads the native Node modules used by the filesystem-backed test edge. */
function loadTestNodeRuntime(): ObsidianNodeRuntimeModules {
  return { fs, path, randomUUID };
}

/** Creates one fake FileSystemAdapter rooted in a fresh temporary Vault. */
async function createAdapter(createRuntimeParent = true): Promise<TestFileSystemAdapter> {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-knowledge-runtime-"));
  temporaryDirectories.push(basePath);
  const AdapterConstructor = FileSystemAdapter as unknown as new (
    rootPath: string
  ) => TestFileSystemAdapter;
  const adapter = new AdapterConstructor(basePath);
  if (createRuntimeParent) {
    await fs.mkdir(adapter.getFullPath("Config/plugins/copilot"), { recursive: true });
  }
  return adapter;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("ObsidianAtomicRuntimeFile", () => {
  it("initializes once without overwriting an existing runtime file", async () => {
    const adapter = await createAdapter();
    const file = new ObsidianAtomicRuntimeFile(adapter, RUNTIME_PATH, loadTestNodeRuntime);

    await file.initialize('{"version":1}');
    await file.initialize('{"version":2}');

    await expect(file.read()).resolves.toBe('{"version":1}');
  });

  it("allows exactly one concurrent exclusive initializer to create bytes", async () => {
    const adapter = await createAdapter();
    const first = new ObsidianAtomicRuntimeFile(adapter, RUNTIME_PATH, loadTestNodeRuntime);
    const second = new ObsidianAtomicRuntimeFile(adapter, RUNTIME_PATH, loadTestNodeRuntime);

    await Promise.all([first.initialize("first"), second.initialize("second")]);

    await expect(first.read()).resolves.toMatch(/^(first|second)$/);
  });

  it("delegates every later mutation to the adapter atomic process primitive", async () => {
    const adapter = await createAdapter();
    const file = new ObsidianAtomicRuntimeFile(adapter, RUNTIME_PATH, loadTestNodeRuntime);
    await file.initialize("one");

    await expect(file.process((current) => `${current}-two`)).resolves.toBe("one-two");
    await expect(file.read()).resolves.toBe("one-two");
  });

  it.each([
    "../runtime.json",
    "/runtime.json",
    "Config//runtime.json",
    "Config/./runtime.json",
    "Config\\runtime.json",
  ])("rejects ambiguous runtime path %s", async (runtimePath) => {
    const adapter = await createAdapter();

    expect(() => new ObsidianAtomicRuntimeFile(adapter, runtimePath)).toThrow(
      ObsidianAtomicRuntimeFileUnsupportedError
    );
  });

  it("rejects a non-filesystem Vault adapter", () => {
    expect(
      () =>
        new ObsidianAtomicRuntimeFile(
          {
            getName: () => "remote",
          } as never,
          RUNTIME_PATH
        )
    ).toThrow(ObsidianAtomicRuntimeFileUnsupportedError);
  });

  it("rejects a missing parent and a parent symlink that escapes the Vault", async () => {
    const missingParentAdapter = await createAdapter(false);
    const missingParentFile = new ObsidianAtomicRuntimeFile(
      missingParentAdapter,
      RUNTIME_PATH,
      loadTestNodeRuntime
    );
    await expect(missingParentFile.initialize("content")).rejects.toBeInstanceOf(
      ObsidianAtomicRuntimeFileUnsupportedError
    );

    const escapingAdapter = await createAdapter(false);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-runtime-outside-"));
    temporaryDirectories.push(outside);
    await fs.mkdir(path.join(outside, "plugins", "copilot"), { recursive: true });
    await fs.symlink(outside, escapingAdapter.getFullPath("Config"), "dir");
    const escapingFile = new ObsidianAtomicRuntimeFile(
      escapingAdapter,
      RUNTIME_PATH,
      loadTestNodeRuntime
    );

    await expect(escapingFile.initialize("outside content")).rejects.toBeInstanceOf(
      ObsidianAtomicRuntimeFileUnsupportedError
    );
    await expect(
      fs.stat(path.join(outside, "plugins", "copilot", "runtime.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
