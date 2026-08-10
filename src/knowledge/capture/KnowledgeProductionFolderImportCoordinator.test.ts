import {
  KnowledgeFolderImportError,
  type KnowledgeFolderImportErrorCode,
} from "@/knowledge/capture/KnowledgeFolderImportPort";
import {
  KnowledgeProductionFolderImportCoordinator,
  type KnowledgeFolderImportFileStorePort,
} from "@/knowledge/capture/KnowledgeProductionFolderImportCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { SourceRegistration } from "@/knowledge/manifest/SourceManifestRepository";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { KnowledgeFolderImportFileStoreError } from "@/knowledge/capture/ObsidianKnowledgeFolderImportFileStore";

/** Creates one valid project-owned Bundle for folder import tests. */
function createOwner(sourceRoots: string[] = ["Sources"]): ConfiguredProjectKnowledgeBundle {
  return {
    projectId: "project-personal",
    config: {
      version: 1,
      id: "personal",
      sourceRoots,
      wikiRoot: "Wiki",
      schemaRef: "Schema/knowledge.md",
      reviewMode: "always",
    },
  };
}

/** Creates the current text and PDF parser ownership projection. */
function createParserProfiles(): KnowledgeSourceParserProfile[] {
  return [
    {
      id: "knowledge-utf8-text",
      version: "utf8-text-v1",
      pathSuffixes: [".markdown", ".md", ".txt"],
      configuration: {},
    },
    {
      id: "knowledge-pdf-pages",
      version: "pdf-pages-v1",
      pathSuffixes: [".pdf"],
      configuration: {},
    },
  ];
}

/** Creates a browser-file shaped capability without an external absolute path. */
function createSelectedFile(
  relativePath: string,
  values: readonly number[],
  read: () => Promise<ArrayBuffer> = async () => new Uint8Array(values).buffer
): File {
  return {
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    size: values.length,
    webkitRelativePath: relativePath,
    arrayBuffer: read,
  } as File;
}

/** Creates an in-memory registration core and captures its writes. */
function createRegistrationFixture(
  existing: readonly SourceManifestEntry[] = [],
  commitThenThrowOnce = false
): {
  core: KnowledgeSourceRegistrationCore;
  registrations: SourceRegistration[];
  manifest: SourceManifest;
} {
  const registrations: SourceRegistration[] = [];
  const manifest: SourceManifest = {
    version: 1,
    bundleId: "personal",
    revision: 0,
    entries: [...existing],
  };
  let shouldThrowAfterCommit = commitThenThrowOnce;
  const core = new KnowledgeSourceRegistrationCore(
    {
      load: async () => manifest,
      registerSource: async (_bundleId, registration) => {
        registrations.push(registration);
        const entry: SourceManifestEntry = {
          sourceId: registration.sourceId,
          sourcePath: registration.sourcePath,
          sourceKey: toWindowsPathKey(registration.sourcePath),
          custody: registration.custody,
          ...(registration.extensions === undefined ? {} : { extensions: registration.extensions }),
        };
        manifest.entries.push(entry);
        manifest.revision += 1;
        if (shouldThrowAfterCommit) {
          shouldThrowAfterCommit = false;
          throw new Error("private post-commit failure");
        }
        return entry;
      },
    },
    { assertCurrent: () => undefined }
  );
  return { core, registrations, manifest };
}

/** Creates one exact byte store with create/reuse/conflict behavior. */
function createFileStore(): KnowledgeFolderImportFileStorePort & {
  files: Map<string, Uint8Array>;
  publish: jest.Mock;
} {
  const files = new Map<string, Uint8Array>();
  const publish = jest.fn(async (path: string, bytes: Uint8Array) => {
    const existing = files.get(toWindowsPathKey(path));
    const contentHash = createSourceContentHash(bytes);
    if (!existing) {
      files.set(toWindowsPathKey(path), bytes.slice());
      return { status: "created" as const, contentHash };
    }
    return createSourceContentHash(existing) === contentHash
      ? { status: "reused" as const, contentHash }
      : { status: "conflict" as const };
  });
  return { files, publish };
}

/** Creates a coordinator with individually overridable authority inputs. */
function createCoordinator(options?: {
  owners?: readonly ConfiguredProjectKnowledgeBundle[];
  parserProfiles?: readonly KnowledgeSourceParserProfile[];
  store?: ReturnType<typeof createFileStore>;
  existing?: readonly SourceManifestEntry[];
  commitThenThrowOnce?: boolean;
}): {
  coordinator: KnowledgeProductionFolderImportCoordinator;
  registrations: SourceRegistration[];
  manifest: SourceManifest;
  store: ReturnType<typeof createFileStore>;
  refresh: jest.Mock;
} {
  const registration = createRegistrationFixture(options?.existing, options?.commitThenThrowOnce);
  const store = options?.store ?? createFileStore();
  const refresh = jest.fn();
  return {
    coordinator: new KnowledgeProductionFolderImportCoordinator({
      owners: options?.owners ?? [createOwner()],
      parserProfiles: options?.parserProfiles ?? createParserProfiles(),
      registration: registration.core,
      createFileStore: () => store,
      assertCurrent: () => undefined,
      onGenerationRefreshRequired: refresh,
    }),
    registrations: registration.registrations,
    manifest: registration.manifest,
    store,
    refresh,
  };
}

/** Expects one sanitized folder import error code. */
async function expectImportError(
  promise: Promise<unknown>,
  code: KnowledgeFolderImportErrorCode
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining<Partial<KnowledgeFolderImportError>>({ code })
  );
}

describe("KnowledgeProductionFolderImportCoordinator", () => {
  it("copies supported files, preserves hierarchy, skips unsupported files, and refreshes once", async () => {
    const { coordinator, registrations, store, refresh } = createCoordinator();
    const files = [
      createSelectedFile("my_idea/Notes/One.md", [1, 2, 3]),
      createSelectedFile("my_idea/Papers/Two.pdf", [4, 5]),
      createSelectedFile("my_idea/Archive.zip", [6]),
    ];

    await expect(
      coordinator.importFolder({ files }, new AbortController().signal)
    ).resolves.toEqual({
      status: "completed",
      bundleId: "personal",
      discoveredFiles: 3,
      eligibleFiles: 2,
      importedFiles: 2,
      reusedFiles: 0,
      skippedFiles: 1,
      conflictFiles: 0,
      failedFiles: 0,
      importedBytes: 5,
    });
    expect([...store.files.keys()]).toEqual([
      "sources/my_idea/notes/one.md",
      "sources/my_idea/papers/two.pdf",
    ]);
    expect(registrations).toHaveLength(2);
    expect(registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "Sources/my_idea/Notes/One.md",
          custody: "managed_copy",
          extensions: {
            obsidianCopilotKnowledgeSourceOrigin: { version: 1, operation: "folder_import" },
          },
        }),
      ])
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reuses exact bytes and registrations without another refresh", async () => {
    const { coordinator, store, refresh } = createCoordinator();
    const files = [createSelectedFile("my_idea/One.md", [1, 2, 3])];
    await coordinator.importFolder({ files }, new AbortController().signal);
    refresh.mockClear();

    await expect(
      coordinator.importFolder({ files }, new AbortController().signal)
    ).resolves.toMatchObject({ importedFiles: 0, reusedFiles: 1, importedBytes: 0 });
    expect(store.publish).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when an exact registered managed copy is recreated", async () => {
    const existing: SourceManifestEntry = {
      sourceId: "source-existing",
      sourcePath: "Sources/my_idea/One.md",
      sourceKey: "sources/my_idea/one.md",
      custody: "managed_copy",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: { version: 1, operation: "folder_import" },
      },
    };
    const { coordinator, refresh } = createCoordinator({ existing: [existing] });

    await expect(
      coordinator.importFolder(
        { files: [createSelectedFile("my_idea/One.md", [1, 2, 3])] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ importedFiles: 1, reusedFiles: 0, importedBytes: 3 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes after an uncertain durable registration and converges on exact retry", async () => {
    const store = createFileStore();
    const bytes = new Uint8Array([1, 2, 3]);
    store.files.set("sources/my_idea/one.md", bytes);
    const { coordinator, manifest, refresh, registrations } = createCoordinator({
      store,
      commitThenThrowOnce: true,
    });
    const files = [createSelectedFile("my_idea/One.md", [...bytes])];

    await expectImportError(
      coordinator.importFolder({ files }, new AbortController().signal),
      "import_failed"
    );

    expect(manifest.entries).toHaveLength(1);
    expect(registrations).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    await expect(
      coordinator.importFolder({ files }, new AbortController().signal)
    ).resolves.toMatchObject({ importedFiles: 0, reusedFiles: 1, importedBytes: 0 });
    expect(registrations).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects incompatible existing registration metadata before reading or copying", async () => {
    const read = jest.fn(async () => new Uint8Array([1]).buffer);
    const existing: SourceManifestEntry = {
      sourceId: "source-existing",
      sourcePath: "Sources/my_idea/One.md",
      sourceKey: "sources/my_idea/one.md",
      custody: "user_managed",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: {
          version: 1,
          operation: "chat_add_to_knowledge",
        },
      },
    };
    const { coordinator, store, refresh } = createCoordinator({ existing: [existing] });

    await expect(
      coordinator.importFolder(
        { files: [createSelectedFile("my_idea/One.md", [1], read)] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ status: "partial", conflictFiles: 1, importedFiles: 0 });
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports per-file conflicts and read failures while preserving other imports", async () => {
    const store = createFileStore();
    store.files.set("sources/my_idea/conflict.md", new Uint8Array([9]));
    const { coordinator, registrations, refresh } = createCoordinator({ store });
    const files = [
      createSelectedFile("my_idea/Good.md", [1]),
      createSelectedFile("my_idea/Conflict.md", [2]),
      createSelectedFile("my_idea/Unreadable.pdf", [3], async () => {
        throw new Error("private path detail");
      }),
    ];

    await expect(
      coordinator.importFolder({ files }, new AbortController().signal)
    ).resolves.toMatchObject({
      status: "partial",
      importedFiles: 1,
      conflictFiles: 1,
      failedFiles: 1,
    });
    expect(registrations).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("fails fast on a systemic copy-boundary failure without reading later files", async () => {
    const store = createFileStore();
    store.publish.mockRejectedValueOnce(
      new KnowledgeFolderImportFileStoreError("unsupported_runtime")
    );
    const laterRead = jest.fn(async () => new Uint8Array([2]).buffer);
    const { coordinator, refresh } = createCoordinator({ store });

    await expectImportError(
      coordinator.importFolder(
        {
          files: [
            createSelectedFile("my_idea/First.md", [1]),
            createSelectedFile("my_idea/Later.md", [2], laterRead),
          ],
        },
        new AbortController().signal
      ),
      "unsupported_runtime"
    );
    expect(laterRead).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects Windows collisions and mixed selection roots before reading or writing", async () => {
    const firstRead = jest.fn(async () => new Uint8Array([1]).buffer);
    const collision = createCoordinator();
    await expectImportError(
      collision.coordinator.importFolder(
        {
          files: [
            createSelectedFile("my_idea/A.md", [1], firstRead),
            createSelectedFile("my_idea/a.MD", [2]),
          ],
        },
        new AbortController().signal
      ),
      "invalid_selection"
    );
    await expectImportError(
      collision.coordinator.importFolder(
        {
          files: [
            createSelectedFile("my_idea/A.md", [1], firstRead),
            createSelectedFile("other/B.md", [2]),
          ],
        },
        new AbortController().signal
      ),
      "invalid_selection"
    );
    expect(firstRead).not.toHaveBeenCalled();
    expect(collision.store.publish).not.toHaveBeenCalled();
  });

  it("rejects oversized eligible files without reading their bytes", async () => {
    const read = jest.fn(async () => new ArrayBuffer(0));
    const file = {
      size: 8_388_609,
      webkitRelativePath: "my_idea/Huge.pdf",
      arrayBuffer: read,
    } as unknown as File;
    const { coordinator, store } = createCoordinator();

    await expectImportError(
      coordinator.importFolder({ files: [file] }, new AbortController().signal),
      "selection_too_large"
    );
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("rejects a selection above the file-count limit before reading any file", async () => {
    const read = jest.fn(async () => new Uint8Array([1]).buffer);
    const files = Array.from({ length: 1_001 }, (_value, index) =>
      createSelectedFile(`my_idea/${index}.md`, [1], read)
    );
    const { coordinator, store } = createCoordinator();

    await expectImportError(
      coordinator.importFolder({ files }, new AbortController().signal),
      "selection_too_large"
    );
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("rejects eligible bytes above the aggregate limit before reading any file", async () => {
    const read = jest.fn(async () => new ArrayBuffer(0));
    const files = Array.from(
      { length: 17 },
      (_value, index) =>
        ({
          size: 8_388_608,
          webkitRelativePath: `my_idea/${index}.pdf`,
          arrayBuffer: read,
        }) as unknown as File
    );
    const { coordinator, store } = createCoordinator();

    await expectImportError(
      coordinator.importFolder({ files }, new AbortController().signal),
      "selection_too_large"
    );
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("rejects an overlong selected relative path before reading its bytes", async () => {
    const read = jest.fn(async () => new Uint8Array([1]).buffer);
    const relativePath = `my_idea/${"a".repeat(1_014)}.md`;
    const { coordinator, store } = createCoordinator();

    await expectImportError(
      coordinator.importFolder(
        { files: [createSelectedFile(relativePath, [1], read)] },
        new AbortController().signal
      ),
      "invalid_selection"
    );
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("accepts a 240-character destination and rejects the next character", async () => {
    const acceptedRelativePath = `my_idea/${"a".repeat(221)}.md`;
    const rejectedRelativePath = `my_idea/${"a".repeat(222)}.md`;
    expect(`Sources/${acceptedRelativePath}`).toHaveLength(240);
    expect(`Sources/${rejectedRelativePath}`).toHaveLength(241);
    const accepted = createCoordinator();
    const rejected = createCoordinator();

    await expect(
      accepted.coordinator.importFolder(
        { files: [createSelectedFile(acceptedRelativePath, [1])] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ importedFiles: 1, importedBytes: 1 });
    await expectImportError(
      rejected.coordinator.importFolder(
        { files: [createSelectedFile(rejectedRelativePath, [1])] },
        new AbortController().signal
      ),
      "invalid_selection"
    );
    expect(rejected.store.publish).not.toHaveBeenCalled();
  });

  it.each<[string, KnowledgeFolderImportErrorCode, readonly ConfiguredProjectKnowledgeBundle[]]>([
    ["no Bundle", "ambiguous_bundle", []],
    ["multiple Bundles", "ambiguous_bundle", [createOwner(), createOwner()]],
    ["multiple source roots", "ambiguous_source_root", [createOwner(["A", "B"])]],
  ])("rejects %s without reading files", async (_name, code, owners) => {
    const read = jest.fn(async () => new Uint8Array([1]).buffer);
    const { coordinator, store } = createCoordinator({ owners });
    await expectImportError(
      coordinator.importFolder(
        { files: [createSelectedFile("my_idea/A.md", [1], read)] },
        new AbortController().signal
      ),
      code
    );
    expect(read).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });
});
