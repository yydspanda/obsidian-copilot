import {
  KnowledgeForwardRevisionApplyJournalValidationError,
  createKnowledgeForwardRevisionPreparedApplyJournal,
  projectKnowledgeForwardRevisionApplyJournalApplying,
  projectKnowledgeForwardRevisionApplyJournalCommitted,
  projectKnowledgeForwardRevisionApplyJournalRecoveryRequired,
  snapshotKnowledgeForwardRevisionApplyJournal,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  KnowledgeForwardRevisionApplyLedgerValidationError,
  createKnowledgeForwardRevisionApplyLedgerIdentityDigest,
  createKnowledgeForwardRevisionApplyLedgerRecord,
  snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  KnowledgeForwardRevisionApplyRevalidationValidationError,
  createKnowledgeForwardRevisionApplyRevalidationReceipt,
  createKnowledgeForwardRevisionSourceBase,
  createKnowledgeForwardRevisionSourceBaseDigest,
  snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import {
  createKnowledgeForwardRevisionAcceptedDecisionRecord,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { createKnowledgeForwardRevisionReviewCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import {
  createKnowledgeForwardRevisionOverlayEntry,
  projectKnowledgeForwardRevisionOverlayAddition,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";

const HISTORICAL_CONTENT = "# Historical output\n";
const CURRENT_CONTENT = "# Current output\n";
const HISTORICAL_HASH = createFileContentHash(HISTORICAL_CONTENT);
const CURRENT_HASH = createFileContentHash(CURRENT_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates the exact latest applied source state shared by acceptance and Apply. */
function createAppliedAuthority(runtimeRevision = 20): KnowledgeForwardRevisionAcceptanceAuthority {
  const runtimeDigest = runtimeRevision === 20 ? HASH_E : HASH_D;
  return {
    runtimeId: "runtime-1",
    runtimeRevision,
    runtimeDigest,
    manifestRevision: 9,
    manifestDigest: HASH_F,
    manifestBaseHash: CURRENT_HASH,
    vaultObservedBeforeHash: CURRENT_HASH,
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: "runtime-1",
      runtimeRevision,
      runtimeDigest,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      committedManifestRevision: 8,
      completedAt: 115,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_D,
      manifestIntentDigest: HASH_C,
      committedManifestDigest: HASH_B,
    },
  };
}

/** Creates one pending proposal bound to the current generated page. */
function createProposal() {
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId: "transaction-historical",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash: HISTORICAL_HASH,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: ["source-1"],
      primarySourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      manifestBaseHash: CURRENT_HASH,
      vaultObservedBeforeHash: CURRENT_HASH,
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision: 1,
    runtimeId: "runtime-1",
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_B,
      acceptedDigest: HASH_C,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_D,
      acceptedAt: 90,
      targetChange: {
        changeId: "change-historical",
        path: "Wiki/Topic.md",
        operation: "update",
        afterHash: HISTORICAL_HASH,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: "Wiki/Topic.md",
        ownership: "generated",
        contentHash: HISTORICAL_HASH,
      },
    },
    selectedContent: HISTORICAL_CONTENT,
    selectedContentHash: HISTORICAL_HASH,
    requestedAt: 120,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 120 });
}

/** Creates a deterministic validation receipt for the exact accepted body. */
function createValidationReceipt(
  proposal: ReturnType<typeof createProposal>,
  authority: KnowledgeForwardRevisionAcceptanceAuthority,
  validatedAt: number,
  action: "accept_exact" | "accept_edited" = "accept_exact"
) {
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const command = createKnowledgeForwardRevisionReviewCommand(
    action === "accept_exact"
      ? { action, proposal, proposalDigest }
      : { action, proposal, proposalDigest, afterContent: HISTORICAL_CONTENT }
  );
  const validationReadSet = [
    {
      version: 1,
      kind: "forward_revision_validation_artifact_identity",
      artifactKind: "markdown",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: HASH_A,
    },
  ];
  return {
    command,
    receipt: createKnowledgeForwardRevisionValidationReceipt({
      proposal,
      proposalDigest,
      command,
      afterContent: HISTORICAL_CONTENT,
      validation: { okfValid: true, citationsValid: true, linksValid: true },
      validationProfile: {
        version: 1,
        kind: "forward_revision_validation_profile",
        profileId: "profile-1",
        profileVersion: 1,
        profileConfigurationDigest: HASH_A,
        bundleConfigurationDigest: HASH_B,
        validatorImplementationId: "deterministic-validator",
        validatorImplementationVersion: 1,
        validatorImplementationDigest: HASH_C,
      },
      acceptanceAuthority: authority,
      historicalCitations: [],
      validationReadSet,
      sourceArtifactObservationBindingDigest:
        createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
          authority,
          validationReadSet
        ),
      warningSummary: null,
      validatedAt,
    }),
  };
}

/** Creates one exact current source Manifest entry. */
function createSourceEntry(): SourceManifestEntry {
  return {
    sourceId: "source-1",
    sourceKey: "sources/note.md",
    sourcePath: "Sources/Note.md",
    custody: "user_managed",
    lastSuccessful: {
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      generatedPages: [
        { path: "Wiki/Topic.md", ownership: "generated", contentHash: CURRENT_HASH },
      ],
      changeSetId: "changeset-current",
      completedAt: 115,
    },
    extensions: {
      obsidianCopilotKnowledgeRuntimeCommit: {
        version: 1,
        inputRevision: 7,
        transactionId: "transaction-current",
        manifestIntentDigest: HASH_C,
      },
    },
  };
}

/** Creates a complete accepted-to-committed forward Apply fixture. */
function createApplyFixture() {
  const proposal = createProposal();
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const decisionAuthority = createAppliedAuthority(20);
  const original = createValidationReceipt(proposal, decisionAuthority, 125);
  const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
    proposal,
    proposalDigest,
    command: original.command,
    afterContent: HISTORICAL_CONTENT,
    acceptanceAuthority: decisionAuthority,
    validationReceipt: original.receipt,
    validationReceiptDigest: original.receipt.receiptDigest,
    acceptedAt: 130,
  });
  const applyAuthority = createAppliedAuthority(21);
  const fresh = createValidationReceipt(proposal, applyAuthority, 135);
  const sourceEntry = createSourceEntry();
  const sourceBase = createKnowledgeForwardRevisionSourceBase({
    bundleId: "personal",
    sourceEntry,
    currentSourceFreshness: applyAuthority.currentSourceFreshness,
  });
  const revalidation = createKnowledgeForwardRevisionApplyRevalidationReceipt({
    acceptedDecision: accepted,
    freshValidationReceipt: fresh.receipt,
    applyAuthority,
    sourceBase,
    vaultObservedBeforeHash: CURRENT_HASH,
    vaultObservedAfterHash: CURRENT_HASH,
    revalidatedAt: 135,
  });
  const prepared = createKnowledgeForwardRevisionPreparedApplyJournal({
    transactionId: "forward-transaction-1",
    acceptedDecision: accepted,
    revalidationReceipt: revalidation,
    manifestBeforeRevision: 9,
    manifestBeforeDigest: HASH_F,
    beforeContent: CURRENT_CONTENT,
    afterContent: HISTORICAL_CONTENT,
    createdAt: 136,
  });
  const applying = projectKnowledgeForwardRevisionApplyJournalApplying(prepared, 137);
  const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(applying, 138);
  return {
    proposal,
    accepted,
    applyAuthority,
    fresh,
    sourceEntry,
    sourceBase,
    revalidation,
    prepared,
    applying,
    committed,
  };
}

describe("forward Apply durable protocol", () => {
  it("binds a fresh receipt to the exact accepted decision and stable source base", () => {
    const fixture = createApplyFixture();
    expect(
      snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
        fixture.revalidation,
        fixture.accepted
      )
    ).toEqual(fixture.revalidation);

    const envelopeShift = {
      ...fixture.sourceBase,
      currentSourceFreshness: {
        ...fixture.sourceBase.currentSourceFreshness,
        runtimeRevision: 99,
        runtimeDigest: HASH_A,
        manifestRevision: 10,
        manifestDigest: HASH_B,
      },
    };
    expect(createKnowledgeForwardRevisionSourceBaseDigest(envelopeShift)).toBe(
      createKnowledgeForwardRevisionSourceBaseDigest(fixture.sourceBase)
    );
    expect(
      createKnowledgeForwardRevisionSourceBaseDigest({
        ...envelopeShift,
        lastSuccessful: {
          ...envelopeShift.lastSuccessful,
          completedAt: 116,
        },
        currentSourceFreshness: {
          ...envelopeShift.currentSourceFreshness,
          completedAt: 116,
        },
      })
    ).not.toBe(createKnowledgeForwardRevisionSourceBaseDigest(fixture.sourceBase));
  });

  it("rejects a fresh receipt whose user-command identity differs from acceptance", () => {
    const fixture = createApplyFixture();
    const alternate = createValidationReceipt(
      fixture.proposal,
      fixture.applyAuthority,
      135,
      "accept_edited"
    );
    expect(() =>
      createKnowledgeForwardRevisionApplyRevalidationReceipt({
        acceptedDecision: fixture.accepted,
        freshValidationReceipt: alternate.receipt,
        applyAuthority: fixture.applyAuthority,
        sourceBase: fixture.sourceBase,
        vaultObservedBeforeHash: CURRENT_HASH,
        vaultObservedAfterHash: CURRENT_HASH,
        revalidatedAt: 135,
      })
    ).toThrow(KnowledgeForwardRevisionApplyRevalidationValidationError);
  });

  it("enforces the exact phase DAG, immutable payload, and safe conflict shape", () => {
    const { prepared, applying, committed } = createApplyFixture();
    expect([prepared.revision, applying.revision, committed.revision]).toEqual([0, 1, 2]);
    expect(committed.committedAt).toBe(committed.updatedAt);
    const recovery = projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(prepared, {
      code: "file_state_conflict",
      actualKind: "missing",
      detectedAt: 140,
    });
    expect(recovery).toMatchObject({ phase: "recovery_required", revision: 1 });
    expect("actualHash" in recovery.conflict).toBe(false);

    const postCommitDrift = projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(committed, {
      code: "post_write_verification_failed",
      actualKind: "file",
      actualHash: committed.beforeHash,
      detectedAt: 141,
    });
    expect(postCommitDrift).toMatchObject({
      phase: "recovery_required",
      revision: 3,
      committedAt: committed.committedAt,
    });
    const oversizedPostCommitDrift = projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(
      committed,
      {
        code: "post_write_verification_failed",
        actualKind: "oversized_file",
        detectedAt: 142,
      }
    );
    expect(oversizedPostCommitDrift.conflict).toEqual({
      version: 1,
      kind: "forward_revision_apply_conflict",
      code: "post_write_verification_failed",
      actualKind: "oversized_file",
      detectedAt: 142,
    });
    expect(() =>
      projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(committed, {
        code: "post_write_verification_failed",
        actualKind: "file",
        actualHash: committed.afterHash,
        detectedAt: 141,
      })
    ).toThrow(KnowledgeForwardRevisionApplyJournalValidationError);
    expect(() =>
      projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(prepared, {
        code: "post_write_verification_failed",
        actualKind: "missing",
        detectedAt: 140,
      })
    ).toThrow(KnowledgeForwardRevisionApplyJournalValidationError);

    for (const invalidJournal of [
      { ...prepared, revision: 1 },
      { ...applying, revision: 99 },
      { ...committed, committedAt: committed.updatedAt + 1 },
      { ...committed, beforeContent: "tampered" },
    ]) {
      expect(() => snapshotKnowledgeForwardRevisionApplyJournal(invalidJournal)).toThrow(
        KnowledgeForwardRevisionApplyJournalValidationError
      );
    }
  });

  it("forms an acyclic overlay identity before final Manifest and full ledger digest", () => {
    const fixture = createApplyFixture();
    const identityDigest = createKnowledgeForwardRevisionApplyLedgerIdentityDigest(
      fixture.committed,
      fixture.sourceBase
    );
    const manifestBefore: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 9,
      entries: [fixture.sourceEntry],
    };
    const overlay = createKnowledgeForwardRevisionOverlayEntry({
      bundleId: fixture.committed.bundleId,
      pagePath: fixture.committed.pagePath,
      sourceId: fixture.committed.sourceId,
      sourceBaseDigest: fixture.committed.sourceBaseDigest,
      baseContentHash: fixture.committed.beforeHash,
      effectiveContentHash: fixture.committed.afterHash,
      forwardTransactionId: fixture.committed.transactionId,
      acceptedDecisionDigest: fixture.committed.acceptedDecisionDigest,
      forwardLedgerIdentityDigest: identityDigest,
      appliedAt: fixture.committed.committedAt,
    });
    const manifestAfter = projectKnowledgeForwardRevisionOverlayAddition(
      manifestBefore,
      overlay,
      fixture.sourceBase
    );
    const ledger = createKnowledgeForwardRevisionApplyLedgerRecord({
      committedJournal: fixture.committed,
      sourceBase: fixture.sourceBase,
      manifestAfterRevision: manifestAfter.revision,
      manifestAfterDigest: createSourceManifestDigest(manifestAfter),
      appliedAt: fixture.committed.committedAt,
    });

    expect(ledger.forwardLedgerIdentityDigest).toBe(identityDigest);
    expect(ledger.manifestAfterDigest).toBe(createSourceManifestDigest(manifestAfter));
    expect(ledger).not.toHaveProperty("beforeContent");
    expect(ledger).not.toHaveProperty("afterContent");
    expect(
      snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal(
        ledger,
        fixture.committed,
        fixture.sourceBase
      )
    ).toEqual(ledger);
    expect(() =>
      snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal(
        { ...ledger, manifestAfterDigest: HASH_A },
        fixture.committed,
        fixture.sourceBase
      )
    ).toThrow(KnowledgeForwardRevisionApplyLedgerValidationError);
  });

  it("translates revoked proxy failures into frozen authentic module errors", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    let error: unknown;
    try {
      snapshotKnowledgeForwardRevisionApplyJournal(revoked.proxy);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(KnowledgeForwardRevisionApplyJournalValidationError);
    expect(Object.isFrozen(error)).toBe(true);
  });
});
