import { createKnowledgeChatDraftCapture } from "@/knowledge/capture/KnowledgeChatDraftCapture";
import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCaptureErrorCode,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import { KnowledgeProductionChatCaptureCoordinator } from "@/knowledge/capture/KnowledgeProductionChatCaptureCoordinator";
import type { KnowledgeFolderImportFileStorePort } from "@/knowledge/capture/KnowledgeProductionFolderImportCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { SourceRegistration } from "@/knowledge/manifest/SourceManifestRepository";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { PDF_PAGE_KNOWLEDGE_PARSER_VERSION } from "@/knowledge/parser/PdfPageKnowledgeByteParser";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";

/** Creates one valid project-owned Bundle for capture tests. */
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

/** Creates the exact current production parser profiles. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "knowledge-utf8-text",
    version: "utf8-text-v1",
    pathSuffixes: [".markdown", ".md", ".txt"],
    configuration: {},
  };
}

/** Creates one externally resolvable promise for async boundary tests. */
function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Creates the exact current production PDF parser profile. */
function createPdfParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "knowledge-pdf-pages",
    version: PDF_PAGE_KNOWLEDGE_PARSER_VERSION,
    pathSuffixes: [".pdf"],
    configuration: {},
  };
}

/** Creates an in-memory registration core and captures its writes. */
function createRegistrationFixture(
  existing: SourceManifestEntry[] = [],
  mode: "normal" | "fail" | "commit_then_throw" = "normal"
): {
  core: KnowledgeSourceRegistrationCore;
  registrations: SourceRegistration[];
} {
  const registrations: SourceRegistration[] = [];
  const manifest: SourceManifest = {
    version: 1,
    bundleId: "personal",
    revision: 0,
    entries: existing,
  };
  const core = new KnowledgeSourceRegistrationCore(
    {
      load: async () => manifest,
      registerSource: async (_bundleId, registration) => {
        if (mode === "fail") throw new Error("registration unavailable");
        registrations.push(registration);
        const entry: SourceManifestEntry = {
          sourceId: registration.sourceId,
          sourcePath: registration.sourcePath,
          sourceKey: toWindowsPathKey(registration.sourcePath),
          custody: registration.custody,
          ...(registration.extensions === undefined ? {} : { extensions: registration.extensions }),
        };
        manifest.entries.push(entry);
        if (mode === "commit_then_throw") throw new Error("ack lost after commit");
        return entry;
      },
    },
    { assertCurrent: () => undefined }
  );
  return { core, registrations };
}

/** Creates a coordinator with individually overridable authority inputs. */
function createCoordinator(options?: {
  owners?: readonly ConfiguredProjectKnowledgeBundle[];
  parserProfiles?: readonly KnowledgeSourceParserProfile[];
  isFile?: boolean;
  existing?: SourceManifestEntry[];
  publish?: KnowledgeFolderImportFileStorePort["publish"];
  refresh?: () => void;
  retainDrain?: (drain: Promise<void>) => void;
  registrationMode?: "normal" | "fail" | "commit_then_throw";
}): {
  coordinator: KnowledgeProductionChatCaptureCoordinator;
  registrations: SourceRegistration[];
  refresh: jest.Mock;
  publish: jest.MockedFunction<KnowledgeFolderImportFileStorePort["publish"]>;
} {
  const registration = createRegistrationFixture(options?.existing, options?.registrationMode);
  const refresh = jest.fn(options?.refresh);
  const files = new Map<string, Uint8Array>();
  const publish = jest.fn<
    ReturnType<KnowledgeFolderImportFileStorePort["publish"]>,
    Parameters<KnowledgeFolderImportFileStorePort["publish"]>
  >(
    options?.publish ??
      (async (path, bytes) => {
        const existing = files.get(path);
        const contentHash = createSourceContentHash(bytes);
        if (!existing) {
          files.set(path, new Uint8Array(bytes));
          return { status: "created" as const, contentHash };
        }
        return createSourceContentHash(existing) === contentHash
          ? { status: "reused" as const, contentHash }
          : { status: "conflict" as const };
      })
  );
  return {
    coordinator: new KnowledgeProductionChatCaptureCoordinator({
      owners: options?.owners ?? [createOwner()],
      parserProfiles: options?.parserProfiles ?? [createParserProfile(), createPdfParserProfile()],
      sourcePresence: { isFile: () => options?.isFile ?? true },
      registration: registration.core,
      createFileStore: () => ({ publish }),
      assertCurrent: () => undefined,
      onGenerationRefreshRequired: refresh,
      ...(options?.retainDrain === undefined ? {} : { retainDrain: options.retainDrain }),
    }),
    registrations: registration.registrations,
    refresh,
    publish,
  };
}

/** Expects one sanitized capture error code. */
async function expectCaptureError(
  promise: Promise<unknown>,
  code: KnowledgeChatCaptureErrorCode
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining<Partial<KnowledgeChatCaptureError>>({ code })
  );
}

/** Creates a draft through the exact destination session shown to the user. */
function createDraft(
  coordinator: KnowledgeProductionChatCaptureCoordinator,
  request: { readonly title: string; readonly body: string; readonly reviewConfirmed: true },
  signal: AbortSignal = new AbortController().signal
) {
  const session = coordinator.prepareKnowledgeDraft();
  if (!session) throw new Error("Expected a prepared Knowledge draft destination");
  return coordinator.createKnowledgeDraft(session, request, signal);
}

describe("KnowledgeProductionChatCaptureCoordinator", () => {
  it("registers an in-root Vault text source and requests a generation rebuild", async () => {
    const { coordinator, registrations, refresh } = createCoordinator();

    await expect(
      coordinator.addVaultSource(
        { sourcePath: "Sources/Research/Note.md" },
        new AbortController().signal
      )
    ).resolves.toEqual({ status: "registered", bundleId: "personal" });
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      sourcePath: "Sources/Research/Note.md",
      custody: "user_managed",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: {
          version: 1,
          operation: "chat_add_to_knowledge",
        },
      },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns an exact already-registered receipt without rebuilding again", async () => {
    const existing: SourceManifestEntry = {
      sourceId: "source-existing",
      sourcePath: "Sources/Note.txt",
      sourceKey: "sources/note.txt",
      custody: "user_managed",
    };
    const { coordinator, registrations, refresh } = createCoordinator({ existing: [existing] });

    await expect(
      coordinator.addVaultSource({ sourcePath: "Sources/Note.txt" }, new AbortController().signal)
    ).resolves.toEqual({ status: "already_registered", bundleId: "personal" });
    expect(registrations).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("registers an in-root Vault PDF through its unique production parser", async () => {
    const { coordinator, registrations, refresh } = createCoordinator();

    await expect(
      coordinator.addVaultSource(
        { sourcePath: "Sources/论文 资料/三页.PDF" },
        new AbortController().signal
      )
    ).resolves.toEqual({ status: "registered", bundleId: "personal" });
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      sourcePath: "Sources/论文 资料/三页.PDF",
      custody: "user_managed",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each<[string, KnowledgeChatCaptureErrorCode, Parameters<typeof createCoordinator>[0]]>([
    ["rejects multiple Bundles", "ambiguous_bundle", { owners: [createOwner(), createOwner()] }],
    [
      "rejects multiple source roots",
      "ambiguous_source_root",
      { owners: [createOwner(["Sources/A", "Sources/B"])] },
    ],
    ["rejects a missing Vault file", "source_missing", { isFile: false }],
  ])("%s", async (_name, code, options) => {
    const { coordinator, registrations, refresh } = createCoordinator(options);
    await expectCaptureError(
      coordinator.addVaultSource({ sourcePath: "Sources/Note.md" }, new AbortController().signal),
      code
    );
    expect(registrations).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects unsupported and out-of-root paths before Manifest mutation", async () => {
    const { coordinator, registrations, refresh } = createCoordinator();

    await expectCaptureError(
      coordinator.addVaultSource({ sourcePath: "Sources/Note.docx" }, new AbortController().signal),
      "unsupported_source_type"
    );
    await expectCaptureError(
      coordinator.addVaultSource({ sourcePath: "Other/Note.md" }, new AbortController().signal),
      "source_outside_root"
    );
    expect(registrations).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects a suffix with no unique current production parser", async () => {
    const duplicate = createParserProfile();
    const { coordinator, registrations } = createCoordinator({
      parserProfiles: [createParserProfile(), { ...duplicate, id: "other-parser" }],
    });

    await expectCaptureError(
      coordinator.addVaultSource({ sourcePath: "Sources/Note.md" }, new AbortController().signal),
      "unsupported_source_type"
    );
    expect(registrations).toHaveLength(0);
  });

  it("creates an edited Chat response as a managed Source without writing Wiki authority", async () => {
    const { coordinator, registrations, refresh, publish } = createCoordinator();
    const request = {
      title: "Why conformity can feel private",
      body: "Checked explanation. Add the exact book passage and page before relying on it.",
      reviewConfirmed: true as const,
    };
    const capture = createKnowledgeChatDraftCapture(request);

    await expect(createDraft(coordinator, request)).resolves.toEqual({
      status: "registered",
      bundleId: "personal",
      sourcePath: `Sources/Knowledge Draft ${capture.captureDigest}.md`,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toBe(`Sources/Knowledge Draft ${capture.captureDigest}.md`);
    expect(new TextDecoder().decode(publish.mock.calls[0]?.[1])).toBe(capture.sourceContent);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      sourcePath: `Sources/Knowledge Draft ${capture.captureDigest}.md`,
      custody: "managed_copy",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: {
          version: 1,
          operation: "chat_knowledge_draft",
          captureDigest: capture.captureDigest,
          captureContentHash: capture.sourceContentHash,
        },
      },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("binds draft editing to one frozen Bundle/root capability", async () => {
    const { coordinator, publish, registrations } = createCoordinator();
    const session = coordinator.prepareKnowledgeDraft();

    expect(session).toEqual({ bundleId: "personal", sourceRoot: "Sources" });
    expect(Object.isFrozen(session)).toBe(true);
    await expectCaptureError(
      coordinator.createKnowledgeDraft(
        { bundleId: "personal", sourceRoot: "Sources" },
        { title: "Draft", body: "Checked body", reviewConfirmed: true },
        new AbortController().signal
      ),
      "unavailable"
    );
    expect(publish).not.toHaveBeenCalled();
    expect(registrations).toHaveLength(0);
  });

  it("does not offer a draft destination for ambiguous ownership or parser authority", () => {
    expect(
      createCoordinator({
        owners: [createOwner(), createOwner()],
      }).coordinator.prepareKnowledgeDraft()
    ).toBeNull();
    expect(
      createCoordinator({
        owners: [createOwner(["Sources/A", "Sources/B"])],
      }).coordinator.prepareKnowledgeDraft()
    ).toBeNull();
    expect(
      createCoordinator({
        parserProfiles: [createPdfParserProfile()],
      }).coordinator.prepareKnowledgeDraft()
    ).toBeNull();
    expect(
      createCoordinator({
        parserProfiles: [
          createParserProfile(),
          { ...createParserProfile(), id: "duplicate-markdown-parser" },
        ],
      }).coordinator.prepareKnowledgeDraft()
    ).toBeNull();
  });

  it("rejects a destination beyond the Windows path bound before file publication", async () => {
    const { coordinator, publish, registrations } = createCoordinator({
      owners: [createOwner(["S".repeat(200)])],
    });

    await expectCaptureError(
      createDraft(coordinator, { title: "Draft", body: "Checked body", reviewConfirmed: true }),
      "draft_conflict"
    );
    expect(publish).not.toHaveBeenCalled();
    expect(registrations).toHaveLength(0);
  });

  it("retains the complete draft operation in the Vault drain", async () => {
    const drains: Promise<void>[] = [];
    const { coordinator } = createCoordinator({
      retainDrain: (drain) => drains.push(drain),
    });

    const operation = createDraft(coordinator, {
      title: "Draft",
      body: "Checked body",
      reviewConfirmed: true,
    });

    expect(drains).toHaveLength(1);
    await expect(operation).resolves.toMatchObject({ status: "registered" });
    await expect(drains[0]).resolves.toBeUndefined();
  });

  it("aborts before publication completes without registering or refreshing", async () => {
    const publishStarted = createDeferred();
    const { coordinator, registrations, refresh } = createCoordinator({
      publish: async (_path, _bytes, signal) => {
        publishStarted.resolve();
        return new Promise<never>((_resolve, reject) => {
          const abort = (): void => reject(new DOMException("aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      },
    });
    const controller = new AbortController();
    const operation = createDraft(
      coordinator,
      { title: "Draft", body: "Checked body", reviewConfirmed: true },
      controller.signal
    );
    await publishStarted.promise;

    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(registrations).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("replays the same draft without overwriting or creating a second identity", async () => {
    const { coordinator, registrations, refresh, publish } = createCoordinator();
    const request = { title: "Draft", body: "Checked body", reviewConfirmed: true as const };

    await expect(createDraft(coordinator, request)).resolves.toMatchObject({
      status: "registered",
    });
    await expect(createDraft(coordinator, request)).resolves.toMatchObject({
      status: "already_registered",
    });

    expect(registrations).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid drafts and file conflicts before Manifest registration", async () => {
    const invalid = createCoordinator();
    await expectCaptureError(
      createDraft(invalid.coordinator, { title: "", body: "Body", reviewConfirmed: true }),
      "draft_invalid"
    );
    expect(invalid.publish).not.toHaveBeenCalled();
    expect(invalid.registrations).toHaveLength(0);

    const conflict = createCoordinator({
      publish: async () => ({ status: "conflict" }),
    });
    await expectCaptureError(
      createDraft(conflict.coordinator, {
        title: "Draft",
        body: "Body",
        reviewConfirmed: true,
      }),
      "draft_conflict"
    );
    expect(conflict.registrations).toHaveLength(0);
  });

  it("keeps durable draft registration successful when refresh reporting fails", async () => {
    const { coordinator, registrations } = createCoordinator({
      refresh: () => {
        throw new Error("refresh transport failed");
      },
    });

    await expect(
      createDraft(coordinator, {
        title: "Draft",
        body: "Checked body",
        reviewConfirmed: true,
      })
    ).resolves.toMatchObject({ status: "registered", bundleId: "personal" });
    expect(registrations).toHaveLength(1);
  });

  it("does not refresh an unregistered file after a registration failure", async () => {
    const { coordinator, registrations, refresh, publish } = createCoordinator({
      registrationMode: "fail",
    });

    await expectCaptureError(
      createDraft(coordinator, {
        title: "Draft",
        body: "Checked body",
        reviewConfirmed: true,
      }),
      "draft_persistence_failed"
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(registrations).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("confirms a commit-then-throw registration through a read-only exact replay", async () => {
    const { coordinator, registrations, refresh } = createCoordinator({
      registrationMode: "commit_then_throw",
    });

    await expect(
      createDraft(coordinator, {
        title: "Draft",
        body: "Checked body",
        reviewConfirmed: true,
      })
    ).resolves.toMatchObject({ status: "already_registered", bundleId: "personal" });
    expect(registrations).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
