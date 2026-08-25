import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  KnowledgeForwardRevisionOverlayValidationError,
  createKnowledgeForwardRevisionOverlayEntry,
  parseKnowledgeForwardRevisionOverlayExtension,
  projectKnowledgeForwardRevisionOverlayAddition,
  projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit,
  snapshotKnowledgeForwardRevisionOverlayExtension,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import {
  createKnowledgeForwardRevisionSourceBase,
  createKnowledgeForwardRevisionSourceBaseDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import type { KnowledgeForwardRevisionAppliedFreshness } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import type { SourceManifest } from "@/knowledge/model/types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates one exact source and its latest applied freshness. */
function createFixture() {
  const manifest: SourceManifest = {
    version: 1,
    bundleId: "personal",
    revision: 9,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/note.md",
        sourcePath: "Sources/Note.md",
        custody: "user_managed",
        lastSuccessful: {
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          generatedPages: [{ path: "Wiki/Topic.md", ownership: "generated", contentHash: HASH_C }],
          changeSetId: "changeset-current",
          completedAt: 115,
        },
        extensions: {
          obsidianCopilotKnowledgeRuntimeCommit: {
            version: 1,
            inputRevision: 7,
            transactionId: "transaction-current",
            manifestIntentDigest: HASH_D,
          },
        },
      },
    ],
  };
  const freshness: KnowledgeForwardRevisionAppliedFreshness = {
    kind: "applied",
    runtimeId: "runtime-1",
    runtimeRevision: 20,
    runtimeDigest: HASH_E,
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 7,
    manifestRevision: 9,
    manifestDigest: createSourceManifestDigest(manifest),
    committedManifestRevision: 9,
    completedAt: 115,
    transactionId: "transaction-current",
    changeSetId: "changeset-current",
    changeSetDigest: HASH_F,
    manifestIntentDigest: HASH_D,
    committedManifestDigest: createSourceManifestDigest(manifest),
  };
  const sourceBase = createKnowledgeForwardRevisionSourceBase({
    bundleId: "personal",
    sourceEntry: manifest.entries[0],
    currentSourceFreshness: freshness,
  });
  const entry = createKnowledgeForwardRevisionOverlayEntry({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    sourceId: "source-1",
    sourceBaseDigest: createKnowledgeForwardRevisionSourceBaseDigest(sourceBase),
    sourceAppliedContentHash: HASH_C,
    previousEffectiveContentHash: HASH_C,
    effectiveContentHash: HASH_E,
    forwardTransactionId: "forward-transaction-1",
    acceptedDecisionDigest: HASH_A,
    forwardLedgerIdentityDigest: HASH_B,
    appliedAt: 130,
  });
  return { manifest, sourceBase, entry };
}

describe("KnowledgeForwardRevisionOverlay", () => {
  it("adds one acyclic overlay while preserving exact source entries", () => {
    const { manifest, sourceBase, entry } = createFixture();
    const beforeEntries = JSON.stringify(manifest.entries);
    const next = projectKnowledgeForwardRevisionOverlayAddition(manifest, entry, sourceBase);

    expect(next.revision).toBe(10);
    expect(JSON.stringify(next.entries)).toBe(beforeEntries);
    expect(next.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]).toEqual({
      version: 2,
      kind: "forward_revision_overlay_extension",
      entries: [entry],
    });
    expect(Object.isFrozen(next.entries[0].lastSuccessful)).toBe(true);
  });

  it("strictly replaces one head only through its exact effective predecessor", () => {
    const { manifest, sourceBase, entry } = createFixture();
    const first = projectKnowledgeForwardRevisionOverlayAddition(manifest, entry, sourceBase);
    const currentSourceEntry = first.entries[0];
    const advancedSourceEntry = {
      ...currentSourceEntry,
      lastSuccessful: {
        ...currentSourceEntry.lastSuccessful!,
        generatedPages: [
          ...currentSourceEntry.lastSuccessful!.generatedPages,
          {
            path: "Wiki/Other.md",
            ownership: "generated" as const,
            contentHash: HASH_D,
          },
        ],
      },
    };
    const advancedSourceBase = createKnowledgeForwardRevisionSourceBase({
      bundleId: first.bundleId,
      sourceEntry: advancedSourceEntry,
      currentSourceFreshness: sourceBase.currentSourceFreshness,
    });
    const afterUnrelatedSourceApply: SourceManifest = {
      ...first,
      revision: first.revision + 1,
      entries: [advancedSourceEntry],
    };
    const successor = createKnowledgeForwardRevisionOverlayEntry({
      bundleId: entry.bundleId,
      pagePath: entry.pagePath,
      sourceId: entry.sourceId,
      sourceBaseDigest: createKnowledgeForwardRevisionSourceBaseDigest(advancedSourceBase),
      sourceAppliedContentHash: entry.sourceAppliedContentHash,
      previousEffectiveContentHash: entry.effectiveContentHash,
      effectiveContentHash: HASH_A,
      forwardTransactionId: "forward-tx-2",
      acceptedDecisionDigest: HASH_B,
      forwardLedgerIdentityDigest: HASH_D,
      appliedAt: entry.appliedAt + 1,
    });
    const next = projectKnowledgeForwardRevisionOverlayAddition(
      afterUnrelatedSourceApply,
      successor,
      advancedSourceBase
    );
    const extension = snapshotKnowledgeForwardRevisionOverlayExtension(
      next.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]
    );

    expect(extension.entries).toEqual([successor]);
    expect(successor.sourceBaseDigest).not.toBe(entry.sourceBaseDigest);
    expect(() =>
      projectKnowledgeForwardRevisionOverlayAddition(
        afterUnrelatedSourceApply,
        {
          ...successor,
          previousEffectiveContentHash: HASH_F,
        },
        advancedSourceBase
      )
    ).toThrow(KnowledgeForwardRevisionOverlayValidationError);
  });

  it("migrates a v1 overlay base into source and predecessor identities", () => {
    const { entry } = createFixture();
    const {
      sourceAppliedContentHash: _sourceAppliedContentHash,
      previousEffectiveContentHash: _previousEffectiveContentHash,
      ...legacyEntry
    } = entry;
    void _sourceAppliedContentHash;
    void _previousEffectiveContentHash;

    const extension = snapshotKnowledgeForwardRevisionOverlayExtension({
      version: 1,
      kind: "forward_revision_overlay_extension",
      entries: [{ ...legacyEntry, version: 1, baseContentHash: HASH_C }],
    });

    expect(extension.version).toBe(2);
    expect(extension.entries[0]).toMatchObject({
      sourceAppliedContentHash: HASH_C,
      previousEffectiveContentHash: HASH_C,
    });
  });

  it("removes exact heads after a source commit without incrementing its revision", () => {
    const fixture = createFixture();
    const sourceEntry = fixture.manifest.entries[0];
    const sourceWithTwoPages = {
      ...sourceEntry,
      lastSuccessful: {
        ...sourceEntry.lastSuccessful!,
        generatedPages: [
          ...sourceEntry.lastSuccessful!.generatedPages,
          {
            path: "Wiki/Other.md",
            ownership: "generated" as const,
            contentHash: HASH_D,
          },
        ],
      },
    };
    const manifest: SourceManifest = {
      ...fixture.manifest,
      entries: [sourceWithTwoPages],
      extensions: { unrelated: { retained: true } },
    };
    const sourceBase = createKnowledgeForwardRevisionSourceBase({
      bundleId: manifest.bundleId,
      sourceEntry: sourceWithTwoPages,
      currentSourceFreshness: fixture.sourceBase.currentSourceFreshness,
    });
    const sourceBaseDigest = createKnowledgeForwardRevisionSourceBaseDigest(sourceBase);
    const first = createKnowledgeForwardRevisionOverlayEntry({
      bundleId: fixture.entry.bundleId,
      pagePath: fixture.entry.pagePath,
      sourceId: fixture.entry.sourceId,
      sourceBaseDigest,
      sourceAppliedContentHash: fixture.entry.sourceAppliedContentHash,
      previousEffectiveContentHash: fixture.entry.previousEffectiveContentHash,
      effectiveContentHash: fixture.entry.effectiveContentHash,
      forwardTransactionId: fixture.entry.forwardTransactionId,
      acceptedDecisionDigest: fixture.entry.acceptedDecisionDigest,
      forwardLedgerIdentityDigest: fixture.entry.forwardLedgerIdentityDigest,
      appliedAt: fixture.entry.appliedAt,
    });
    const second = createKnowledgeForwardRevisionOverlayEntry({
      bundleId: manifest.bundleId,
      pagePath: "Wiki/Other.md",
      sourceId: sourceBase.sourceId,
      sourceBaseDigest,
      sourceAppliedContentHash: HASH_D,
      previousEffectiveContentHash: HASH_D,
      effectiveContentHash: HASH_A,
      forwardTransactionId: "forward-tx-other",
      acceptedDecisionDigest: HASH_B,
      forwardLedgerIdentityDigest: HASH_D,
      appliedAt: 131,
    });
    const withBoth = projectKnowledgeForwardRevisionOverlayAddition(
      projectKnowledgeForwardRevisionOverlayAddition(manifest, first, sourceBase),
      second,
      sourceBase
    );
    const revision = withBoth.revision;
    const withoutFirst = projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(
      withBoth,
      first
    );
    const remaining = snapshotKnowledgeForwardRevisionOverlayExtension(
      withoutFirst.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]
    );

    expect(withoutFirst.revision).toBe(revision);
    expect(withoutFirst.extensions?.unrelated).toEqual({ retained: true });
    expect(remaining.entries).toEqual([second]);
    const withoutBoth = projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(
      withoutFirst,
      second
    );
    expect(withoutBoth.revision).toBe(revision);
    expect(withoutBoth.extensions).toEqual({ unrelated: { retained: true } });
    expect(() =>
      projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(withoutFirst, first)
    ).toThrow(KnowledgeForwardRevisionOverlayValidationError);
    expect(() =>
      projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(withBoth, {
        ...first,
        appliedAt: first.appliedAt + 1,
      })
    ).toThrow(KnowledgeForwardRevisionOverlayValidationError);
  });

  it("rejects replayed durable identities across distinct page heads", () => {
    const { entry } = createFixture();
    const variants = [
      {
        ...entry,
        pagePath: "Wiki/Other.md",
        windowsPathKey: "wiki/other.md",
        forwardTransactionId: entry.forwardTransactionId,
      },
      {
        ...entry,
        pagePath: "Wiki/Other.md",
        windowsPathKey: "wiki/other.md",
        forwardTransactionId: "other-tx",
        forwardLedgerIdentityDigest: entry.forwardLedgerIdentityDigest,
      },
      {
        ...entry,
        pagePath: "Wiki/Other.md",
        windowsPathKey: "wiki/other.md",
        forwardTransactionId: "other-tx",
        forwardLedgerIdentityDigest: HASH_F,
        acceptedDecisionDigest: entry.acceptedDecisionDigest,
      },
    ];
    for (const second of variants) {
      expect(() =>
        snapshotKnowledgeForwardRevisionOverlayExtension({
          version: 2,
          kind: "forward_revision_overlay_extension",
          entries: [entry, second],
        })
      ).toThrow(KnowledgeForwardRevisionOverlayValidationError);
    }
  });

  it("fails closed for hostile extension material and wrong source-base joins", () => {
    const { manifest, sourceBase, entry } = createFixture();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(parseKnowledgeForwardRevisionOverlayExtension(revoked.proxy)).toMatchObject({
      ok: false,
    });
    expect(() =>
      projectKnowledgeForwardRevisionOverlayAddition(manifest, entry, {
        ...sourceBase,
        sourceId: "source-2",
      })
    ).toThrow(KnowledgeForwardRevisionOverlayValidationError);
  });
});
