// Native containment fixtures need a real filesystem loader, separate from the memory suite.
jest.mock("obsidian", () => {
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  class TFile {
    constructor(public path: string) {}
  }
  class FileSystemAdapter {
    constructor(private readonly basePath: string) {}
    getBasePath(): string {
      return this.basePath;
    }
    getFullPath(relativePath: string): string {
      return path.join(this.basePath, relativePath);
    }
  }
  return { FileSystemAdapter, TFile };
});

jest.mock("@/knowledge/runtime/ObsidianNodeRuntime", () => ({
  loadObsidianNodeRuntimeModules: jest.fn(() => ({
    fs: jest.requireActual<typeof import("node:fs")>("node:fs").promises,
    path: jest.requireActual<typeof import("node:path")>("node:path"),
    randomUUID: jest.requireActual<typeof import("node:crypto")>("node:crypto").randomUUID,
  })),
}));

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSystemAdapter, TFile, type Vault } from "obsidian";

import {
  createKnowledgeExecutionOwner,
  KnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  KnowledgeFileAdapterPayloadError,
  KnowledgeFileParentUnavailableError,
  ObsidianKnowledgeFileStore,
} from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import { loadObsidianNodeRuntimeModules } from "@/knowledge/runtime/ObsidianNodeRuntime";

function fileState(content: string) {
  return { kind: "file" as const, content, contentHash: createFileContentHash(content) };
}

/** Uses native disk reads and writes so escaping updates cannot hide behind a memory mock. */
function createFileStore(root: string) {
  const Adapter = FileSystemAdapter as unknown as new (rootPath: string) => FileSystemAdapter;
  const File = TFile as unknown as new (filePath: string) => TFile;
  const file = new File("Wiki/Page.md");
  const adapter = Object.assign(new Adapter(root), {
    stat: async (relativePath: string) => {
      const stat = await fs.stat(path.join(root, relativePath));
      return { type: stat.isFile() ? "file" : "folder", size: stat.size };
    },
    read: (relativePath: string) => fs.readFile(path.join(root, relativePath), "utf8"),
  });
  const process = jest.fn(async (target: TFile, transform: (current: string) => string) => {
    const targetPath = path.join(root, target.path);
    const next = transform(await fs.readFile(targetPath, "utf8"));
    await fs.writeFile(targetPath, next, "utf8");
    return next;
  });
  const vault = { adapter, getAbstractFileByPath: () => file, process } as unknown as Vault;
  return { store: new ObsidianKnowledgeFileStore(vault), process, vault, file };
}

function onTargetResolution(targetPath: string, callback: () => void): void {
  const modules = loadObsidianNodeRuntimeModules();
  jest.mocked(loadObsidianNodeRuntimeModules).mockReturnValueOnce({
    ...modules,
    fs: {
      ...modules.fs,
      realpath: async (candidate: string) => {
        const resolved = await modules.fs.realpath(candidate);
        if (candidate === targetPath) callback();
        return resolved;
      },
    },
  });
}

describe("ObsidianKnowledgeFileStore", () => {
  let fixtureRoot: string;
  let vaultRoot: string;
  let externalRoot: string;

  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-update-containment-"));
    vaultRoot = path.join(fixtureRoot, "vault");
    externalRoot = path.join(fixtureRoot, "vault-outside");
    await fs.mkdir(vaultRoot);
    await fs.mkdir(externalRoot);
  });

  afterEach(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  describe("ObsidianKnowledgeFileStore", () => {
    describe("compareAndSwap()", () => {
      it("updates an existing in-Vault file and preserves exact Unicode/CRLF bytes", async () => {
        await fs.mkdir(path.join(vaultRoot, "Wiki"));
        const target = path.join(vaultRoot, "Wiki/Page.md");
        await fs.writeFile(target, "before", "utf8");
        const { store, process } = createFileStore(vaultRoot);

        await expect(
          store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("# 知识\r\n🦌\r\n"))
        ).resolves.toEqual({ kind: "applied" });

        expect(await fs.readFile(target, "utf8")).toBe("# 知识\r\n🦌\r\n");
        expect(process).toHaveBeenCalledTimes(1);
      });

      it("allows a file symlink whose real target remains inside the Vault — https://github.com/yydspanda/obsidian-copilot/issues/11", async () => {
        await fs.mkdir(path.join(vaultRoot, "Wiki"));
        const target = path.join(vaultRoot, "Actual.md");
        await fs.writeFile(target, "before", "utf8");
        await fs.symlink(target, path.join(vaultRoot, "Wiki/Page.md"), "file");
        const harness = createFileStore(vaultRoot);

        await expect(
          harness.store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
        ).resolves.toEqual({ kind: "applied" });

        expect(await fs.readFile(target, "utf8")).toBe("after");
        expect(harness.process).toHaveBeenCalledTimes(1);
      });

      it.each(["file", "parent"] as const)(
        "rejects a %s symlink escape before Vault.process and preserves the external file — https://github.com/yydspanda/obsidian-copilot/issues/11",
        async (linkKind) => {
          const externalFile = path.join(externalRoot, "Page.md");
          await fs.writeFile(externalFile, "before", "utf8");
          if (linkKind === "file") {
            await fs.mkdir(path.join(vaultRoot, "Wiki"));
            await fs.symlink(externalFile, path.join(vaultRoot, "Wiki/Page.md"), "file");
          } else {
            await fs.symlink(
              externalRoot,
              path.join(vaultRoot, "Wiki"),
              process.platform === "win32" ? "junction" : "dir"
            );
          }
          const harness = createFileStore(vaultRoot);

          const [result] = await Promise.allSettled([
            harness.store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after")),
          ]);

          expect(await fs.readFile(externalFile, "utf8")).toBe("before");
          expect(result).toMatchObject({
            status: "rejected",
            reason: expect.any(KnowledgeFileParentUnavailableError) as unknown,
          });
          expect(harness.process).not.toHaveBeenCalled();
        }
      );

      it("rejects an unresolved target before invoking Vault.process — https://github.com/yydspanda/obsidian-copilot/issues/11", async () => {
        const harness = createFileStore(vaultRoot);

        await expect(
          harness.store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
        ).rejects.toBeInstanceOf(KnowledgeFileParentUnavailableError);
        expect(harness.process).not.toHaveBeenCalled();
      });

      it("rejects an adapter without desktop real-path support before invoking Vault.process — https://github.com/yydspanda/obsidian-copilot/issues/11", async () => {
        await fs.mkdir(path.join(vaultRoot, "Wiki"));
        const target = path.join(vaultRoot, "Wiki/Page.md");
        await fs.writeFile(target, "before", "utf8");
        const harness = createFileStore(vaultRoot);
        Object.setPrototypeOf(harness.vault.adapter, Object.prototype);

        await expect(
          harness.store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
        ).rejects.toBeInstanceOf(KnowledgeFileAdapterPayloadError);
        expect(await fs.readFile(target, "utf8")).toBe("before");
        expect(harness.process).not.toHaveBeenCalled();
      });

      it("does not write when the Vault changes while target resolution is pending — https://github.com/yydspanda/obsidian-copilot/issues/11", async () => {
        await fs.mkdir(path.join(vaultRoot, "Wiki"));
        const target = path.join(vaultRoot, "Wiki/Page.md");
        await fs.writeFile(target, "before", "utf8");
        const harness = createFileStore(vaultRoot);
        const app = { vault: harness.vault };
        const owner = createKnowledgeExecutionOwner();
        KnowledgeExecutionOwner.bindVaultLifecycle(
          owner,
          app,
          harness.vault,
          harness.vault.adapter
        );
        const store = ObsidianKnowledgeFileStore.createForExecutionOwner(app, harness.vault, owner);
        onTargetResolution(target, () => {
          app.vault = { ...harness.vault } as Vault;
        });

        await expect(
          store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
        ).rejects.toThrow("generation is no longer current");
        expect(await fs.readFile(target, "utf8")).toBe("before");
        expect(harness.process).not.toHaveBeenCalled();
      });

      it("does not redirect an update when its loaded file is renamed during resolution — https://github.com/yydspanda/obsidian-copilot/issues/11", async () => {
        await fs.mkdir(path.join(vaultRoot, "Wiki"));
        const target = path.join(vaultRoot, "Wiki/Page.md");
        const renamedTarget = path.join(vaultRoot, "Wiki/Other.md");
        await fs.writeFile(target, "before", "utf8");
        await fs.writeFile(renamedTarget, "before", "utf8");
        const harness = createFileStore(vaultRoot);
        onTargetResolution(target, () => {
          harness.file.path = "Wiki/Other.md";
        });

        await expect(
          harness.store.compareAndSwap("Wiki/Page.md", fileState("before"), fileState("after"))
        ).rejects.toBeInstanceOf(KnowledgeFileAdapterPayloadError);
        expect(await fs.readFile(target, "utf8")).toBe("before");
        expect(await fs.readFile(renamedTarget, "utf8")).toBe("before");
        expect(harness.process).not.toHaveBeenCalled();
      });
    });
  });
});
