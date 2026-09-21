import {
  KnowledgeStudioMaterialCoordinator,
  type KnowledgeStudioMaterialGeneration,
} from "@/knowledge/capture/KnowledgeStudioMaterialCoordinator";
import {
  KnowledgeStudioMaterialError,
  type KnowledgeStudioMaterialSelection,
} from "@/knowledge/capture/KnowledgeStudioMaterialPort";
import type { KnowledgeFolderImportRequest } from "@/knowledge/capture/KnowledgeFolderImportPort";
import { KnowledgeProductionFolderImportCoordinator } from "@/knowledge/capture/KnowledgeProductionFolderImportCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { TFile, type Stat } from "obsidian";

function createFile(path: string, size = 3): TFile {
  const file: unknown = Object.create(TFile.prototype);
  if (!(file instanceof TFile)) throw new Error("Expected a TFile fixture");
  Object.assign(file, { path, stat: { size, mtime: 10, ctime: 5 } });
  return file;
}

function createFixture() {
  const files = [createFile("Sources/Existing.md"), createFile("Research/中文.pdf")];
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const readBinary = jest.fn(async (_file: TFile): Promise<ArrayBuffer> => bytes);
  const copied: number[][] = [];
  const capture = {
    addVaultSource: jest.fn(async () => ({ status: "registered" as const, bundleId: "personal" })),
  };
  const folderImport = {
    importFolder: jest.fn(
      async (request: Readonly<KnowledgeFolderImportRequest>, _signal: AbortSignal) => {
        copied.push(Array.from(new Uint8Array(await request.files[0].arrayBuffer())));
        return {
          status: "completed" as const,
          bundleId: "personal",
          discoveredFiles: 1,
          eligibleFiles: 1,
          importedFiles: 1,
          reusedFiles: 0,
          skippedFiles: 0,
          conflictFiles: 0,
          failedFiles: 0,
          importedBytes: 3,
        };
      }
    ),
  };
  let current: KnowledgeStudioMaterialGeneration | undefined = {
    bundleId: "personal",
    sourceRoot: "Sources",
    excludedRoots: ["Wiki", "Copilot/Projects"],
    excludedPaths: ["Config/knowledge.md"],
    capture,
    folderImport,
    assertCurrent: () => undefined,
  };
  const generation = current;
  const stat = jest.fn(async (path: string): Promise<Stat | null> => {
    const file = files.find((candidate) => candidate.path === path);
    return file ? { ...file.stat, type: "file" } : null;
  });
  const vault = {
    getFiles: () => files,
    getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    readBinary,
    adapter: { stat },
  };
  const coordinator = new KnowledgeStudioMaterialCoordinator({
    vault,
    getCurrentGeneration: () => current,
  });
  const select = (path: string): Readonly<KnowledgeStudioMaterialSelection> => {
    const session = coordinator.prepare("personal");
    if (!session) throw new Error("Expected a ready chooser");
    return coordinator.select(session, path);
  };
  return {
    coordinator,
    files,
    generation,
    vault,
    capture,
    folderImport,
    readBinary,
    stat,
    copied,
    select,
    replace: (next: KnowledgeStudioMaterialGeneration | undefined) => {
      current = next;
    },
  };
}

describe("KnowledgeStudioMaterialCoordinator", () => {
  describe("KnowledgeStudioMaterialCoordinator", () => {
    describe("prepare()", () => {
      it("lists only supported non-Wiki and non-configuration paths without reading bytes or adding sources (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const fixture = createFixture();
        fixture.files.push(
          createFile("Wiki/Output.md"),
          createFile("Config/knowledge.md"),
          createFile("Copilot/Projects/Personal.md"),
          createFile("Research/unsupported.docx"),
          createFile("../outside.md")
        );
        const session = fixture.coordinator.prepare("personal");
        expect(session?.choices.map((choice) => choice.path)).toEqual([
          "Research/中文.pdf",
          "Sources/Existing.md",
        ]);
        expect(Object.isFrozen(session?.choices)).toBe(true);
        expect(fixture.readBinary).not.toHaveBeenCalled();
        expect(fixture.capture.addVaultSource).not.toHaveBeenCalled();
        expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
      });

      it("does not offer another Bundle or unavailable generation (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const fixture = createFixture();
        expect(fixture.coordinator.prepare("another")).toBeNull();
        fixture.replace(undefined);
        expect(fixture.coordinator.prepare("personal")).toBeNull();
      });
    });

    describe("select()", () => {
      it("shows in-place registration versus a full-path snapshot before any side effect (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const fixture = createFixture();
        expect(fixture.select("Sources/Existing.md")).toEqual({
          bundleId: "personal",
          sourcePath: "Sources/Existing.md",
          destinationPath: "Sources/Existing.md",
          mode: "register",
        });
        expect(fixture.select("Research/中文.pdf")).toEqual({
          bundleId: "personal",
          sourcePath: "Research/中文.pdf",
          destinationPath: "Sources/Vault/Research/中文.pdf",
          mode: "snapshot",
        });
        expect(fixture.readBinary).not.toHaveBeenCalled();
        expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
      });

      it("rejects an old chooser and paths absent from its inventory (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const fixture = createFixture();
        const session = fixture.coordinator.prepare("personal")!;
        expect(() => fixture.coordinator.select(session, "Hidden.md")).toThrow(
          KnowledgeStudioMaterialError
        );
        fixture.replace({ ...fixture.generation });
        expect(() => fixture.coordinator.select(session, "Sources/Existing.md")).toThrow(
          KnowledgeStudioMaterialError
        );
      });

      it("rejects snapshot files above 8 MiB before bytes while leaving in-root parser budgeting unchanged (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const fixture = createFixture();
        fixture.files[1].stat.size = 8_388_609;
        expect(() => fixture.select("Research/中文.pdf")).toThrow(KnowledgeStudioMaterialError);
        fixture.files[0].stat.size = 8_388_609;
        expect(fixture.select("Sources/Existing.md").mode).toBe("register");
        expect(fixture.readBinary).not.toHaveBeenCalled();
      });
    });

    describe("add()", () => {
      it("registers an in-root original through capture without reading or copying it (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Sources/Existing.md");
        const signal = new AbortController().signal;
        await expect(fixture.coordinator.add(selection, signal)).resolves.toEqual({
          ...selection,
          status: "added",
        });
        expect(fixture.capture.addVaultSource).toHaveBeenCalledWith(
          { sourcePath: selection.sourcePath },
          signal
        );
        expect(fixture.readBinary).not.toHaveBeenCalled();
        expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
      });

      it("copies one outside-root original with the displayed Vault hierarchy and preserves its bytes and identity (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const original = fixture.files[1];
        const selection = fixture.select(original.path);
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).resolves.toEqual({ ...selection, status: "added" });
        expect(fixture.folderImport.importFolder.mock.calls[0][0].files[0].webkitRelativePath).toBe(
          "Vault/Research/中文.pdf"
        );
        expect(fixture.copied).toEqual([[1, 2, 3]]);
        expect(fixture.files[1]).toBe(original);
        expect(original.path).toBe("Research/中文.pdf");
        expect(fixture.capture.addVaultSource).not.toHaveBeenCalled();
      });

      it("reuses the real folder import and registration core for one managed snapshot without rewriting the original (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const manifest: SourceManifest = {
          version: 1,
          bundleId: "personal",
          revision: 0,
          entries: [],
        };
        const published = new Map<string, Uint8Array>();
        const registration = new KnowledgeSourceRegistrationCore(
          {
            load: async () => manifest,
            registerSource: async (_bundleId, request) => {
              const entry: SourceManifestEntry = {
                ...request,
                sourceKey: toWindowsPathKey(request.sourcePath),
              };
              manifest.entries.push(entry);
              manifest.revision += 1;
              return entry;
            },
          },
          { assertCurrent: () => undefined }
        );
        const importDelegate = new KnowledgeProductionFolderImportCoordinator({
          owners: [
            {
              projectId: "p",
              config: {
                version: 1,
                id: "personal",
                sourceRoots: ["Sources"],
                wikiRoot: "Wiki",
                schemaRef: "Config/knowledge.md",
                reviewMode: "always",
              },
            },
          ],
          parserProfiles: [{ id: "pdf", version: "1", pathSuffixes: [".pdf"], configuration: {} }],
          registration,
          createFileStore: () => ({
            publish: async (path, bytes) => {
              const existing = published.get(path);
              if (existing)
                return { status: "reused", contentHash: createSourceContentHash(existing) };
              published.set(path, bytes.slice());
              return { status: "created", contentHash: createSourceContentHash(bytes) };
            },
          }),
          assertCurrent: () => undefined,
          onGenerationRefreshRequired: () => undefined,
        });
        fixture.replace({ ...fixture.generation, folderImport: importDelegate });
        const selection = fixture.select("Research/中文.pdf");
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).resolves.toMatchObject({ status: "added" });
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).resolves.toMatchObject({ status: "already_added" });
        expect(manifest.entries).toHaveLength(1);
        expect(manifest.entries[0]).toMatchObject({
          sourcePath: selection.destinationPath,
          custody: "managed_copy",
          extensions: {
            obsidianCopilotKnowledgeSourceOrigin: { version: 1, operation: "folder_import" },
          },
        });
        expect([...published.keys()]).toEqual([selection.destinationPath]);
        expect(fixture.files.map((file) => file.path)).toEqual([
          "Sources/Existing.md",
          "Research/中文.pdf",
        ]);
      });

      it("refuses a selection from a replaced generation without calling either old or new delegate (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Sources/Existing.md");
        fixture.replace({ ...fixture.generation });
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).rejects.toMatchObject({ code: "stale_selection" });
        expect(fixture.capture.addVaultSource).not.toHaveBeenCalled();
        expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
      });

      it("rejects forged selection data and aborted callers before reads or writes (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Research/中文.pdf");
        await expect(
          fixture.coordinator.add({ ...selection }, new AbortController().signal)
        ).rejects.toMatchObject({ code: "stale_selection" });
        const caller = new AbortController();
        caller.abort();
        await expect(fixture.coordinator.add(selection, caller.signal)).rejects.toMatchObject({
          name: "AbortError",
        });
        expect(fixture.readBinary).not.toHaveBeenCalled();
        expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
      });

      it.each(["size", "mtime", "identity"] as const)(
        "rejects changed %s before opening original bytes (https://github.com/yydspanda/obsidian-copilot/issues/13)",
        async (change) => {
          const fixture = createFixture();
          const selection = fixture.select("Research/中文.pdf");
          if (change === "identity") fixture.files[1] = createFile(selection.sourcePath);
          else fixture.files[1].stat[change] += 1;
          await expect(
            fixture.coordinator.add(selection, new AbortController().signal)
          ).rejects.toMatchObject({ code: "source_changed" });
          expect(fixture.readBinary).not.toHaveBeenCalled();
          expect(fixture.folderImport.importFolder).not.toHaveBeenCalled();
        }
      );

      it.each(["size", "identity", "bytes", "generation"] as const)(
        "rejects changed %s during snapshot read before publishing bytes (https://github.com/yydspanda/obsidian-copilot/issues/13)",
        async (change) => {
          const fixture = createFixture();
          const selection = fixture.select("Research/中文.pdf");
          fixture.readBinary.mockImplementationOnce(async () => {
            if (change === "size") fixture.files[1].stat.size += 1;
            if (change === "identity") fixture.files[1] = createFile(selection.sourcePath);
            if (change === "generation") fixture.replace({ ...fixture.generation });
            return new Uint8Array(change === "bytes" ? [1, 2] : [1, 2, 3]).buffer;
          });
          await expect(
            fixture.coordinator.add(selection, new AbortController().signal)
          ).rejects.toMatchObject({
            code: change === "generation" ? "stale_selection" : "source_changed",
          });
          expect(fixture.readBinary).toHaveBeenCalledTimes(1);
          expect(fixture.copied).toEqual([]);
        }
      );

      it("checks fresh adapter size before bytes even when the TFile cache still reports a small source (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Research/中文.pdf");
        fixture.stat.mockResolvedValueOnce({ type: "file", size: 8_388_609, mtime: 10, ctime: 5 });
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).rejects.toMatchObject({ code: "source_too_large" });
        expect(fixture.readBinary).not.toHaveBeenCalled();
        expect(fixture.copied).toEqual([]);
      });

      it("rechecks fresh adapter identity metadata after reading without relying on delayed Vault events (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Research/中文.pdf");
        fixture.stat.mockResolvedValueOnce({ type: "file", size: 3, mtime: 10, ctime: 5 });
        fixture.stat.mockResolvedValueOnce({ type: "file", size: 3, mtime: 11, ctime: 5 });
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).rejects.toMatchObject({ code: "source_changed" });
        expect(fixture.readBinary).toHaveBeenCalledTimes(1);
        expect(fixture.copied).toEqual([]);
      });

      it("aborts after an in-flight original read without publishing its returned bytes (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Research/中文.pdf");
        const caller = new AbortController();
        fixture.readBinary.mockImplementationOnce(async () => {
          caller.abort();
          return new Uint8Array([1, 2, 3]).buffer;
        });
        await expect(fixture.coordinator.add(selection, caller.signal)).rejects.toMatchObject({
          name: "AbortError",
        });
        expect(fixture.copied).toEqual([]);
      });

      it("sanitizes a failed Vault identity lookup before invoking any durable delegate (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Sources/Existing.md");
        fixture.vault.getAbstractFileByPath = () => {
          throw new Error("private lookup /vault/path");
        };
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).rejects.toMatchObject({
          code: "add_failed",
          message: "The Knowledge material could not be added",
        });
        expect(fixture.capture.addVaultSource).not.toHaveBeenCalled();
      });

      it("rejects duplicate pending Add calls and preserves a successful receipt across its own generation refresh (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        const selection = fixture.select("Sources/Existing.md");
        let release!: () => void;
        fixture.capture.addVaultSource.mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          fixture.replace(undefined);
          return { status: "registered", bundleId: "personal" };
        });
        const first = fixture.coordinator.add(selection, new AbortController().signal);
        void first.catch(() => undefined);
        await expect(
          fixture.coordinator.add(selection, new AbortController().signal)
        ).rejects.toMatchObject({ code: "stale_selection" });
        release();
        await expect(first).resolves.toEqual({ ...selection, status: "added" });
        expect(fixture.capture.addVaultSource).toHaveBeenCalledTimes(1);
      });

      it("sanitizes unknown delegate errors without retaining private paths or content (https://github.com/yydspanda/obsidian-copilot/issues/13)", async () => {
        const fixture = createFixture();
        fixture.capture.addVaultSource.mockRejectedValueOnce(
          new Error("secret /vault/private body")
        );
        const result = fixture.coordinator.add(
          fixture.select("Sources/Existing.md"),
          new AbortController().signal
        );
        await expect(result).rejects.toMatchObject({
          code: "add_failed",
          message: "The Knowledge material could not be added",
        });
      });
    });
  });
});
