import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  KnowledgeForwardRevisionOverlayValidationError,
  createKnowledgeForwardRevisionOverlayEntry,
  parseKnowledgeForwardRevisionOverlayExtension,
  projectKnowledgeForwardRevisionOverlayAddition,
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
    baseContentHash: HASH_C,
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
      version: 1,
      kind: "forward_revision_overlay_extension",
      entries: [entry],
    });
    expect(Object.isFrozen(next.entries[0].lastSuccessful)).toBe(true);
  });

  it("rejects Windows-equivalent replacement and replayed durable identities", () => {
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
          version: 1,
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
