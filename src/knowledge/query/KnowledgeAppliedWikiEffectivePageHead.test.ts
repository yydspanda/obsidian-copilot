import {
  KnowledgeAppliedWikiEffectivePageHeadError,
  snapshotKnowledgeAppliedWikiEffectivePageHead,
} from "@/knowledge/query/KnowledgeAppliedWikiEffectivePageHead";

const SOURCE_HASH = "a".repeat(64);
const EFFECTIVE_HASH = "b".repeat(64);
const CONTEXT = Object.freeze({
  bundleId: "personal",
  pagePath: "Wiki/Applied.md",
  windowsPathKey: "wiki/applied.md",
  ownership: "generated" as const,
  sourceIds: Object.freeze(["source-1"]),
});

/** Creates one exact canonical forward-overlay origin. */
function createForwardOrigin() {
  return {
    kind: "forward_revision" as const,
    overlay: {
      version: 2 as const,
      kind: "forward_revision_overlay_entry" as const,
      bundleId: "personal",
      pagePath: "Wiki/Applied.md",
      windowsPathKey: "wiki/applied.md",
      sourceId: "source-1",
      sourceBaseDigest: "c".repeat(64),
      sourceAppliedContentHash: SOURCE_HASH,
      previousEffectiveContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
      forwardTransactionId: "forward-1",
      acceptedDecisionDigest: "d".repeat(64),
      forwardLedgerIdentityDigest: "e".repeat(64),
      appliedAt: 20,
    },
  };
}

describe("snapshotKnowledgeAppliedWikiEffectivePageHead", () => {
  it("snapshots source-applied and canonical forward heads with an effective alias", () => {
    const source = snapshotKnowledgeAppliedWikiEffectivePageHead(
      {
        sourceAppliedContentHash: SOURCE_HASH,
        effectiveContentHash: SOURCE_HASH,
        contentHash: SOURCE_HASH,
        origin: { kind: "source_apply" },
      },
      CONTEXT
    );
    const forward = snapshotKnowledgeAppliedWikiEffectivePageHead(
      {
        sourceAppliedContentHash: SOURCE_HASH,
        effectiveContentHash: EFFECTIVE_HASH,
        contentHash: EFFECTIVE_HASH,
        origin: createForwardOrigin(),
      },
      CONTEXT
    );

    expect(source).toEqual({
      sourceAppliedContentHash: SOURCE_HASH,
      effectiveContentHash: SOURCE_HASH,
      contentHash: SOURCE_HASH,
      origin: { kind: "source_apply" },
    });
    expect(forward).toMatchObject({
      sourceAppliedContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
      contentHash: EFFECTIVE_HASH,
      origin: { kind: "forward_revision", overlay: { version: 2 } },
    });
    expect(Object.isFrozen(forward)).toBe(true);
    expect(Object.isFrozen(forward.origin)).toBe(true);
  });

  it("rejects legacy overlay wire shapes and lineage that cannot rejoin the page", () => {
    const legacy = createForwardOrigin();
    const legacyOverlay = {
      version: 1,
      kind: legacy.overlay.kind,
      bundleId: legacy.overlay.bundleId,
      pagePath: legacy.overlay.pagePath,
      windowsPathKey: legacy.overlay.windowsPathKey,
      sourceId: legacy.overlay.sourceId,
      sourceBaseDigest: legacy.overlay.sourceBaseDigest,
      baseContentHash: SOURCE_HASH,
      effectiveContentHash: EFFECTIVE_HASH,
      forwardTransactionId: legacy.overlay.forwardTransactionId,
      acceptedDecisionDigest: legacy.overlay.acceptedDecisionDigest,
      forwardLedgerIdentityDigest: legacy.overlay.forwardLedgerIdentityDigest,
      appliedAt: legacy.overlay.appliedAt,
    };
    const candidates = [
      { kind: "forward_revision", overlay: legacyOverlay },
      {
        ...createForwardOrigin(),
        overlay: { ...createForwardOrigin().overlay, sourceId: "orphan-source" },
      },
    ];

    for (const origin of candidates) {
      expect(() =>
        snapshotKnowledgeAppliedWikiEffectivePageHead(
          {
            sourceAppliedContentHash: SOURCE_HASH,
            effectiveContentHash: EFFECTIVE_HASH,
            contentHash: EFFECTIVE_HASH,
            origin,
          },
          CONTEXT
        )
      ).toThrow(KnowledgeAppliedWikiEffectivePageHeadError);
    }
  });

  it("rejects accessor origins without invoking them", () => {
    let getterCalls = 0;
    const origin = {};
    Object.defineProperty(origin, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "source_apply";
      },
    });

    expect(() =>
      snapshotKnowledgeAppliedWikiEffectivePageHead(
        {
          sourceAppliedContentHash: SOURCE_HASH,
          effectiveContentHash: SOURCE_HASH,
          contentHash: SOURCE_HASH,
          origin,
        },
        CONTEXT
      )
    ).toThrow(KnowledgeAppliedWikiEffectivePageHeadError);
    expect(getterCalls).toBe(0);
  });
});
