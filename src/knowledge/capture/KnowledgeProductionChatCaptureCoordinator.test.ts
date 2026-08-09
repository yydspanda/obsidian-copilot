import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCaptureErrorCode,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import { KnowledgeProductionChatCaptureCoordinator } from "@/knowledge/capture/KnowledgeProductionChatCaptureCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { SourceRegistration } from "@/knowledge/manifest/SourceManifestRepository";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { PDF_PAGE_KNOWLEDGE_PARSER_VERSION } from "@/knowledge/parser/PdfPageKnowledgeByteParser";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

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
function createRegistrationFixture(existing: SourceManifestEntry[] = []): {
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
        registrations.push(registration);
        const entry: SourceManifestEntry = {
          sourceId: registration.sourceId,
          sourcePath: registration.sourcePath,
          sourceKey: toWindowsPathKey(registration.sourcePath),
          custody: registration.custody,
          ...(registration.extensions === undefined ? {} : { extensions: registration.extensions }),
        };
        manifest.entries.push(entry);
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
}): {
  coordinator: KnowledgeProductionChatCaptureCoordinator;
  registrations: SourceRegistration[];
  refresh: jest.Mock;
} {
  const registration = createRegistrationFixture(options?.existing);
  const refresh = jest.fn();
  return {
    coordinator: new KnowledgeProductionChatCaptureCoordinator({
      owners: options?.owners ?? [createOwner()],
      parserProfiles: options?.parserProfiles ?? [createParserProfile(), createPdfParserProfile()],
      sourcePresence: { isFile: () => options?.isFile ?? true },
      registration: registration.core,
      assertCurrent: () => undefined,
      onGenerationRefreshRequired: refresh,
    }),
    registrations: registration.registrations,
    refresh,
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
});
