import {
  KnowledgeEffectivePageProjectionError,
  projectKnowledgeEffectiveManifestPages,
} from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  createKnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import type { SourceManifest } from "@/knowledge/model/types";

const SOURCE_HASH = "a".repeat(64);
const EFFECTIVE_HASH = "b".repeat(64);

/** Creates one strict source-applied Manifest with an optional active overlay. */
function createManifest(withOverlay = true): SourceManifest {
  const overlay = createKnowledgeForwardRevisionOverlayEntry({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    sourceId: "source-1",
    sourceBaseDigest: "c".repeat(64),
    sourceAppliedContentHash: SOURCE_HASH,
    previousEffectiveContentHash: SOURCE_HASH,
    effectiveContentHash: EFFECTIVE_HASH,
    forwardTransactionId: "forward-transaction-1",
    acceptedDecisionDigest: "d".repeat(64),
    forwardLedgerIdentityDigest: "e".repeat(64),
    appliedAt: 120,
  });
  return {
    version: 1,
    bundleId: "personal",
    revision: 4,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/topic.md",
        sourcePath: "Sources/Topic.md",
        custody: "user_managed",
        lastSuccessful: {
          sourceContentHash: "f".repeat(64),
          pipelineFingerprint: "1".repeat(64),
          generatedPages: [
            { path: "Wiki/Topic.md", ownership: "generated", contentHash: SOURCE_HASH },
          ],
          changeSetId: "source-changeset-1",
          completedAt: 100,
        },
      },
    ],
    ...(withOverlay
      ? {
          extensions: {
            [KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]: {
              version: 2,
              kind: "forward_revision_overlay_extension",
              entries: [overlay],
            },
          },
        }
      : {}),
  };
}

describe("projectKnowledgeEffectiveManifestPages", () => {
  it("preserves the source-applied base while exposing the exact forward head and lineage", () => {
    const manifest = createManifest();
    const before = manifest.entries[0].lastSuccessful?.generatedPages[0].contentHash;

    const pages = projectKnowledgeEffectiveManifestPages(manifest);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      bundleId: "personal",
      path: "Wiki/Topic.md",
      windowsPathKey: "wiki/topic.md",
      ownership: "generated",
      sourceIds: ["source-1"],
      sourceAppliedContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
      contentHash: EFFECTIVE_HASH,
      origin: { kind: "forward_revision" },
    });
    if (pages[0].origin.kind !== "forward_revision") {
      throw new Error("Expected forward-revision provenance");
    }
    expect(pages[0].origin.overlay).toMatchObject({
      sourceAppliedContentHash: SOURCE_HASH,
      previousEffectiveContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
    });
    expect(manifest.entries[0].lastSuccessful?.generatedPages[0].contentHash).toBe(before);
    expect(Object.isFrozen(pages)).toBe(true);
    expect(Object.isFrozen(pages[0])).toBe(true);
    expect(Object.isFrozen(pages[0].origin)).toBe(true);
  });

  it("projects an unoverlaid page as one source-apply head", () => {
    expect(projectKnowledgeEffectiveManifestPages(createManifest(false))[0]).toMatchObject({
      sourceAppliedContentHash: SOURCE_HASH,
      effectiveContentHash: SOURCE_HASH,
      contentHash: SOURCE_HASH,
      origin: { kind: "source_apply" },
    });
  });

  it("retains a page overlay when a later same-source commit leaves its source base unchanged", () => {
    const manifest = createManifest();
    manifest.entries[0].lastSuccessful!.completedAt = 130;

    expect(projectKnowledgeEffectiveManifestPages(manifest)[0]).toMatchObject({
      sourceAppliedContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
      origin: { kind: "forward_revision" },
    });
  });

  it("fails closed for orphaned, ambiguous, or accessor-backed overlay authority", () => {
    const orphaned = createManifest();
    orphaned.entries[0].lastSuccessful!.generatedPages[0].contentHash = "9".repeat(64);

    const ambiguous = createManifest();
    ambiguous.entries.push({
      sourceId: "source-2",
      sourceKey: "sources/other.md",
      sourcePath: "Sources/Other.md",
      custody: "user_managed",
      lastSuccessful: {
        ...ambiguous.entries[0].lastSuccessful!,
        generatedPages: [{ path: "Wiki/Topic.md", ownership: "shared", contentHash: SOURCE_HASH }],
      },
    });
    ambiguous.entries[0].lastSuccessful!.generatedPages[0].ownership = "shared";

    const accessor = createManifest();
    let calls = 0;
    Object.defineProperty(accessor.extensions!, KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY, {
      enumerable: true,
      get: () => {
        calls += 1;
        return undefined;
      },
    });

    for (const candidate of [orphaned, ambiguous, accessor]) {
      expect(() => projectKnowledgeEffectiveManifestPages(candidate)).toThrow(
        KnowledgeEffectivePageProjectionError
      );
    }
    expect(calls).toBe(0);
  });
});
