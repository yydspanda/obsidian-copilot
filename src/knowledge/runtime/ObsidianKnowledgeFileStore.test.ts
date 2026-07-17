jest.mock("obsidian", () => {
  const path = jest.requireActual<typeof import("node:path")>("node:path");

  class TFile {
    /** Creates one fake loaded Vault file. */
    constructor(public readonly path: string) {}
  }

  class FileSystemAdapter {
    /** Creates one fake filesystem adapter rooted at a native directory. */
    constructor(private readonly basePath: string) {}

    /** Returns the fake Vault root. */
    getBasePath(): string {
      return this.basePath;
    }

    /** Resolves one Vault-relative path beneath the fake root. */
    getFullPath(normalizedPath: string): string {
      return path.join(this.basePath, ...normalizedPath.split("/"));
    }
  }

  return { FileSystemAdapter, TFile };
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileSystemAdapter, TFile, type Vault } from "obsidian";

import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  KnowledgeFileAdapterPayloadError,
  KnowledgeFileMutationUnsupportedError,
  KnowledgeFileParentUnavailableError,
  ObsidianKnowledgeFileStore,
  WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES,
  WindowsExclusiveKnowledgeFileCreator,
  type ExclusiveKnowledgeFileCreator,
} from "@/knowledge/runtime/ObsidianKnowledgeFileStore";

const temporaryDirectories: string[] = [];

/** Creates one loaded fake TFile despite the public constructor being opaque. */
function createTestFile(targetPath: string): TFile {
  const TestFileConstructor = TFile as unknown as new (filePath: string) => TFile;
  return new TestFileConstructor(targetPath);
}

/** Creates one exact journal file state. */
function fileState(content: string) {
  return { kind: "file" as const, content, contentHash: createFileContentHash(content) };
}

/** In-memory Vault edge that exposes exact process/no-write behavior. */
class MemoryVaultHarness {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>(["Wiki"]);
  processWriteCount = 0;
  creatorCallCount = 0;
  afterProcess?: (path: string) => void;
  malformedStat = false;
  processFailure?: Error;
  processReturnOverride?: string;

  readonly adapter = {
    /** Observes one in-memory file or folder. */
    stat: async (targetPath: string) => {
      if (this.malformedStat) {
        return { type: "unexpected" } as never;
      }
      if (this.directories.has(targetPath)) {
        return { type: "folder" as const, ctime: 0, mtime: 0, size: 0 };
      }
      const content = this.files.get(targetPath);
      return content === undefined
        ? null
        : { type: "file" as const, ctime: 0, mtime: 0, size: content.length };
    },
    /** Reads exact in-memory text. */
    read: async (targetPath: string) => {
      const content = this.files.get(targetPath);
      if (content === undefined) {
        throw new Error("Missing in-memory file");
      }
      return content;
    },
  };

  readonly vault = {
    adapter: this.adapter,
    /** Returns a loaded fake file when exact bytes exist. */
    getAbstractFileByPath: (targetPath: string) =>
      this.files.has(targetPath) ? createTestFile(targetPath) : null,
    /** Atomically transforms one loaded fake file without writing on callback errors. */
    process: async (file: TFile, transform: (current: string) => string) => {
      if (this.processFailure) {
        const error = this.processFailure;
        this.processFailure = undefined;
        throw error;
      }
      const current = this.files.get(file.path);
      if (current === undefined) {
        throw new Error("Missing process target");
      }
      const next = transform(current);
      this.files.set(file.path, next);
      this.processWriteCount += 1;
      this.afterProcess?.(file.path);
      return this.processReturnOverride ?? next;
    },
  } as unknown as Vault;

  readonly creator: ExclusiveKnowledgeFileCreator = {
    /** Creates an absent in-memory path without overwriting it. */
    create: async (targetPath: string, content: string) => {
      this.creatorCallCount += 1;
      if (this.files.has(targetPath) || this.directories.has(targetPath)) {
        return "exists";
      }
      this.files.set(targetPath, content);
      return "created";
    },
  };

  /** Creates a file store over the in-memory Vault and exclusive creator. */
  createStore(creator: ExclusiveKnowledgeFileCreator = this.creator): ObsidianKnowledgeFileStore {
    return new ObsidianKnowledgeFileStore(this.vault, creator);
  }
}

/** Creates a fake FileSystemAdapter rooted at one fresh native directory. */
async function createNativeAdapter(): Promise<FileSystemAdapter> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-knowledge-file-"));
  temporaryDirectories.push(root);
  const AdapterConstructor = FileSystemAdapter as unknown as new (
    rootPath: string
  ) => FileSystemAdapter;
  return new AdapterConstructor(root);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("ObsidianKnowledgeFileStore", () => {
  it("observes missing, directory, and exact Unicode/CRLF file content", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "# 标题\r\nemoji 🦌  \r\n");
    const store = harness.createStore();

    await expect(store.observe("Wiki/Missing.md")).resolves.toEqual({ kind: "missing" });
    await expect(store.observe("Wiki")).resolves.toEqual({ kind: "directory" });
    await expect(store.observe("Wiki/Page.md")).resolves.toEqual({
      kind: "file",
      content: "# 标题\r\nemoji 🦌  \r\n",
    });
  });

  it("atomically updates exact before content and verifies the after state", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "before");
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).resolves.toEqual({ kind: "applied" });
    expect(harness.files.get("Wiki/Page.md")).toBe("after");
    expect(harness.processWriteCount).toBe(1);
  });

  it("returns already-after from inside process without producing a write event", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "after");
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).resolves.toEqual({ kind: "already_after" });
    expect(harness.processWriteCount).toBe(0);
  });

  it("returns an exact third-state conflict without rewriting the file", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "user edit");
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).resolves.toEqual({
      kind: "conflict",
      observation: { kind: "file", content: "user edit" },
    });
    expect(harness.files.get("Wiki/Page.md")).toBe("user edit");
    expect(harness.processWriteCount).toBe(0);
  });

  it("detects an edit that wins immediately after the atomic update", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "before");
    harness.afterProcess = (targetPath) => harness.files.set(targetPath, "later user edit");
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).resolves.toEqual({
      kind: "conflict",
      observation: { kind: "file", content: "later user edit" },
    });
  });

  it("propagates external process failures without mutation and allows a later retry", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "before");
    const failure = new Error("adapter unavailable");
    harness.processFailure = failure;
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).rejects.toBe(failure);
    expect(harness.files.get("Wiki/Page.md")).toBe("before");
    expect(harness.processWriteCount).toBe(0);

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).resolves.toEqual({ kind: "applied" });
  });

  it("rejects a malformed process success payload after preserving observable bytes", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "before");
    harness.processReturnOverride = "not-the-written-content";
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
    ).rejects.toBeInstanceOf(KnowledgeFileAdapterPayloadError);
    expect(harness.files.get("Wiki/Page.md")).toBe("after");
  });

  it("allows only one of two competing exact-before updates to apply", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "before");
    const first = harness.createStore();
    const second = harness.createStore();

    const results = await Promise.all([
      first.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("first")),
      second.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("second")),
    ]);

    expect(results.filter((result) => result.kind === "applied")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "conflict")).toHaveLength(1);
    expect(harness.processWriteCount).toBe(1);
  });

  it("creates only an absent file and replays its exact after state", async () => {
    const harness = new MemoryVaultHarness();
    const store = harness.createStore();
    const after = fileState("# New\n");

    await expect(store.compareAndSwap("Wiki/New.md", { kind: "missing" }, after)).resolves.toEqual({
      kind: "applied",
    });
    await expect(store.compareAndSwap("Wiki/New.md", { kind: "missing" }, after)).resolves.toEqual({
      kind: "already_after",
    });
    expect(harness.creatorCallCount).toBe(1);
  });

  it("does not overwrite a file that appears during exclusive create", async () => {
    const harness = new MemoryVaultHarness();
    const racingCreator: ExclusiveKnowledgeFileCreator = {
      /** Simulates another writer winning create before this caller. */
      create: async (targetPath) => {
        harness.files.set(targetPath, "concurrent content");
        return "exists";
      },
    };
    const store = harness.createStore(racingCreator);

    await expect(
      store.compareAndSwap("Wiki/New.md", { kind: "missing" }, fileState("ours"))
    ).resolves.toEqual({
      kind: "conflict",
      observation: { kind: "file", content: "concurrent content" },
    });
    expect(harness.files.get("Wiki/New.md")).toBe("concurrent content");
  });

  it("rejects delete before invoking any Vault mutation", async () => {
    const harness = new MemoryVaultHarness();
    harness.files.set("Wiki/Page.md", "keep me");
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("keep me"), { kind: "missing" })
    ).rejects.toBeInstanceOf(KnowledgeFileMutationUnsupportedError);
    expect(harness.files.get("Wiki/Page.md")).toBe("keep me");
    expect(harness.processWriteCount).toBe(0);
  });

  it("classifies delete replay before rejecting an actual delete mutation", async () => {
    const harness = new MemoryVaultHarness();
    const store = harness.createStore();

    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), { kind: "missing" })
    ).resolves.toEqual({ kind: "already_after" });

    harness.files.set("Wiki/Page.md", "user edit");
    await expect(
      store.compareAndSwap("Wiki/Page.md", fileState("before"), { kind: "missing" })
    ).resolves.toEqual({
      kind: "conflict",
      observation: { kind: "file", content: "user edit" },
    });
    expect(harness.processWriteCount).toBe(0);
  });

  it("exposes the frozen production capability gate with delete disabled", () => {
    const harness = new MemoryVaultHarness();
    const store = harness.createStore();

    expect(store.mutationCapabilities).toBe(WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES);
    expect(store.mutationCapabilities).toEqual({
      create: true,
      update: true,
      delete: false,
    });
    expect(Object.isFrozen(store.mutationCapabilities)).toBe(true);
  });

  it("rejects invalid path, state hash, and adapter stat payload", async () => {
    const harness = new MemoryVaultHarness();
    const store = harness.createStore();

    await expect(store.observe("../Page.md")).rejects.toBeInstanceOf(TypeError);
    await expect(
      store.compareAndSwap(
        "Wiki/Page.md",
        { kind: "file", content: "before", contentHash: "0".repeat(64) },
        fileState("after")
      )
    ).rejects.toBeInstanceOf(TypeError);
    harness.malformedStat = true;
    await expect(store.observe("Wiki/Page.md")).rejects.toBeInstanceOf(
      KnowledgeFileAdapterPayloadError
    );
  });
});

describe("WindowsExclusiveKnowledgeFileCreator", () => {
  it("allows exactly one concurrent create without overwriting the winner", async () => {
    const adapter = await createNativeAdapter();
    const creator = new WindowsExclusiveKnowledgeFileCreator(adapter);
    await fs.mkdir((adapter as never as { getFullPath(path: string): string }).getFullPath("Wiki"));

    const results = await Promise.all([
      creator.create("Wiki/Page.md", "first"),
      creator.create("Wiki/Page.md", "second"),
    ]);
    const content = await fs.readFile(
      (adapter as never as { getFullPath(path: string): string }).getFullPath("Wiki/Page.md"),
      "utf8"
    );

    expect(results.sort()).toEqual(["created", "exists"]);
    expect(content).toMatch(/^(first|second)$/);
  });

  it("rejects a missing parent and a symlink escape", async () => {
    const adapter = await createNativeAdapter();
    const creator = new WindowsExclusiveKnowledgeFileCreator(adapter);
    await expect(creator.create("Missing/Page.md", "content")).rejects.toBeInstanceOf(
      KnowledgeFileParentUnavailableError
    );

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-knowledge-outside-"));
    temporaryDirectories.push(outside);
    const adapterWithPath = adapter as never as { getFullPath(path: string): string };
    await fs.symlink(outside, adapterWithPath.getFullPath("Outside"), "dir");
    await expect(creator.create("Outside/Page.md", "content")).rejects.toBeInstanceOf(
      KnowledgeFileParentUnavailableError
    );
  });
});
