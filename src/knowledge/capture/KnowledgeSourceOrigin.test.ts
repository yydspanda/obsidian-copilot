import {
  createKnowledgeSourceOriginDigest,
  createKnowledgeSourceOriginExtensions,
  deriveKnowledgeSourceCompileAuthority,
  KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY,
  KnowledgeSourceOriginValidationError,
  parseKnowledgeSourceOrigin,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import type { SourceManifestEntry } from "@/knowledge/model/types";

const CAPTURE_DIGEST = "a".repeat(64);
const CAPTURE_CONTENT_HASH = "b".repeat(64);

/** Creates one exact Manifest entry for origin-authority tests. */
function createEntry(patch: Partial<SourceManifestEntry> = {}): SourceManifestEntry {
  return {
    sourceId: "source-1",
    sourceKey: "sources/capture.md",
    sourcePath: "Sources/Capture.md",
    custody: "managed_copy",
    ...patch,
  };
}

describe("KnowledgeSourceOrigin", () => {
  it("keeps legacy, Chat, Chat-draft, and folder-import sources on ordinary ingest authority", () => {
    expect(deriveKnowledgeSourceCompileAuthority(createEntry())).toEqual({
      operation: "ingest",
    });
    expect(
      deriveKnowledgeSourceCompileAuthority(
        createEntry({
          custody: "user_managed",
          extensions: createKnowledgeSourceOriginExtensions("chat_add_to_knowledge"),
        })
      )
    ).toEqual({ operation: "ingest" });
    expect(
      deriveKnowledgeSourceCompileAuthority(
        createEntry({
          extensions: createKnowledgeSourceOriginExtensions("folder_import"),
        })
      )
    ).toEqual({ operation: "ingest" });
    expect(
      parseKnowledgeSourceOrigin(
        createKnowledgeSourceOriginExtensions("folder_import")[
          KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY
        ]
      )
    ).toEqual({ version: 1, operation: "folder_import" });
    const draftExtensions = createKnowledgeSourceOriginExtensions("chat_knowledge_draft", {
      captureDigest: CAPTURE_DIGEST,
      captureContentHash: CAPTURE_CONTENT_HASH,
    });
    expect(
      deriveKnowledgeSourceCompileAuthority(createEntry({ extensions: draftExtensions }))
    ).toEqual({
      operation: "ingest",
    });
    expect(
      parseKnowledgeSourceOrigin(draftExtensions[KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY])
    ).toEqual({
      version: 1,
      operation: "chat_knowledge_draft",
      captureDigest: CAPTURE_DIGEST,
      captureContentHash: CAPTURE_CONTENT_HASH,
    });
  });

  it("derives query writeback only from a strict managed capture origin", () => {
    const extensions = createKnowledgeSourceOriginExtensions("query_writeback", {
      captureDigest: CAPTURE_DIGEST,
      captureContentHash: CAPTURE_CONTENT_HASH,
    });
    const origin = parseKnowledgeSourceOrigin(extensions[KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY]);

    expect(deriveKnowledgeSourceCompileAuthority(createEntry({ extensions }))).toEqual({
      operation: "query_writeback",
      sourceOriginDigest: createKnowledgeSourceOriginDigest(origin),
      expectedSourceContentHash: CAPTURE_CONTENT_HASH,
    });
  });

  it("rejects user-managed, malformed, or extensible query origins", () => {
    const extensions = createKnowledgeSourceOriginExtensions("query_writeback", {
      captureDigest: CAPTURE_DIGEST,
      captureContentHash: CAPTURE_CONTENT_HASH,
    });
    expect(() =>
      deriveKnowledgeSourceCompileAuthority(createEntry({ custody: "user_managed", extensions }))
    ).toThrow(KnowledgeSourceOriginValidationError);
    expect(() =>
      parseKnowledgeSourceOrigin({
        version: 1,
        operation: "query_writeback",
        captureDigest: CAPTURE_DIGEST,
        captureContentHash: CAPTURE_CONTENT_HASH,
        unreviewed: true,
      })
    ).toThrow(KnowledgeSourceOriginValidationError);
    expect(() =>
      parseKnowledgeSourceOrigin({
        version: 1,
        operation: "query_writeback",
        captureDigest: "not-a-hash",
        captureContentHash: CAPTURE_CONTENT_HASH,
      })
    ).toThrow(KnowledgeSourceOriginValidationError);
  });
});
