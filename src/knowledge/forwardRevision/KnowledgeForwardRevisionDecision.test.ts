import {
  KnowledgeForwardRevisionDecisionValidationError,
  createKnowledgeForwardRevisionAcceptedDecisionRecord,
  createKnowledgeForwardRevisionApplyClaimDigest,
  createKnowledgeForwardRevisionRejectedDecisionRecord,
  createKnowledgeForwardRevisionTerminalDecisionRecordDigest,
  snapshotKnowledgeForwardRevisionAcceptedDecisionRecord,
  snapshotKnowledgeForwardRevisionApplyClaim,
  snapshotKnowledgeForwardRevisionRejectedDecisionRecord,
  snapshotKnowledgeForwardRevisionTerminalDecisionRecord,
  validateKnowledgeForwardRevisionTerminalDecisionRecord,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

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

/** Creates one strict independently published proposal payload. */
function createProposal(selectedContent = HISTORICAL_CONTENT) {
  const selectedContentHash = createFileContentHash(selectedContent);
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
      selectedContentHash,
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
        afterHash: selectedContentHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: "Wiki/Topic.md",
        ownership: "generated",
        contentHash: selectedContentHash,
      },
    },
    selectedContent,
    selectedContentHash,
    requestedAt: 120,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 120 });
}

/** Creates one coherent applied source-freshness acceptance tuple. */
function createAppliedAuthority(): KnowledgeForwardRevisionAcceptanceAuthority {
  return {
    runtimeId: "runtime-1",
    runtimeRevision: 20,
    runtimeDigest: HASH_E,
    manifestRevision: 9,
    manifestDigest: HASH_F,
    manifestBaseHash: CURRENT_HASH,
    vaultObservedBeforeHash: CURRENT_HASH,
    currentSourceFreshness: {
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

/** Creates the alternative exact no-changes source-freshness tuple. */
function createNoChangesAuthority(): KnowledgeForwardRevisionAcceptanceAuthority {
  const applied = createAppliedAuthority();
  return {
    ...applied,
    currentSourceFreshness: {
      kind: "no_changes",
      runtimeId: applied.runtimeId,
      runtimeRevision: applied.runtimeRevision,
      runtimeDigest: applied.runtimeDigest,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      committedManifestRevision: 9,
      completedAt: 118,
      noChangesId: `knowledge-no-changes-${HASH_A}`,
      reason: "all_targets_unchanged",
      planDigest: HASH_C,
      jobId: "job-7",
      attempt: 1,
    },
  };
}

/** Creates a mutable JSON clone for adversarial persisted-state checks. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionDecision", () => {
  it("accepts exact historical bytes with dual hashes and a decision-bound dedicated claim", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest,
      afterContent: HISTORICAL_CONTENT,
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    });

    expect(accepted).toMatchObject({
      state: "accepted",
      recordRevision: 1,
      proposalDigest,
      selectedHistoricalHash: HISTORICAL_HASH,
      afterContent: HISTORICAL_CONTENT,
      acceptedAfterHash: HISTORICAL_HASH,
      manualOverride: false,
      acceptedAt: 130,
    });
    expect(accepted.acceptedDecisionDigest).toHaveLength(64);
    expect(accepted.applyClaim).toMatchObject({
      kind: "forward_revision_apply_claim",
      proposalId: proposal.proposalId,
      proposalDigest,
      requestId: proposal.request.requestId,
      requestDigest: proposal.requestDigest,
      acceptedDecisionDigest: accepted.acceptedDecisionDigest,
      selectedHistoricalHash: HISTORICAL_HASH,
      acceptedAfterHash: HISTORICAL_HASH,
      manualOverride: false,
    });
    expect("afterContent" in accepted.applyClaim).toBe(false);
    expect(accepted.applyClaimDigest).toBe(
      createKnowledgeForwardRevisionApplyClaimDigest(accepted.applyClaim)
    );
    expect(snapshotKnowledgeForwardRevisionApplyClaim(accepted.applyClaim, accepted)).toEqual(
      accepted.applyClaim
    );
    expect(createKnowledgeForwardRevisionTerminalDecisionRecordDigest(accepted)).toHaveLength(64);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.applyClaim)).toBe(true);
    expect(Object.isFrozen(accepted.sourceEvidence.sourceRefs)).toBe(true);
  });

  it("retains exact edited bytes while keeping evidence scoped to the historical proposal", () => {
    const proposal = createProposal();
    const afterContent = "# Edited\r\nCafe\u0301 🙂\tkept\n";
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent,
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    });

    expect(accepted.afterContent).toBe(afterContent);
    expect(accepted.acceptedAfterHash).toBe(createFileContentHash(afterContent));
    expect(accepted.manualOverride).toBe(true);
    expect(accepted.selectedHistoricalHash).toBe(HISTORICAL_HASH);
    expect(accepted.sourceEvidence).toMatchObject({
      evidenceScope: "selected_historical_output_and_original_source",
      manualOverrideEvidence: "not_asserted",
      historicalTransactionId: "transaction-historical",
      historicalChangeSetId: "changeset-historical",
      selectedHistoricalHash: HISTORICAL_HASH,
      sourceRefs: ["source-1"],
    });
  });

  it("binds an exact no-changes completion identity without changing decision semantics", () => {
    const proposal = createProposal();
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: HISTORICAL_CONTENT,
      acceptanceAuthority: createNoChangesAuthority(),
      acceptedAt: 130,
    });

    expect(accepted.acceptanceAuthority.currentSourceFreshness).toMatchObject({
      kind: "no_changes",
      noChangesId: `knowledge-no-changes-${HASH_A}`,
      planDigest: HASH_C,
      jobId: "job-7",
      attempt: 1,
    });
  });

  it("rejects terminally without creating or accepting any Apply claim", () => {
    const proposal = createProposal();
    const rejected = createKnowledgeForwardRevisionRejectedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      rejectedAt: 125,
    });

    expect(rejected).toMatchObject({
      state: "rejected",
      recordRevision: 1,
      rejectionReason: "user_rejected",
      rejectedAt: 125,
    });
    expect("applyClaim" in rejected).toBe(false);
    expect(rejected.rejectedDecisionDigest).toHaveLength(64);
    expect(snapshotKnowledgeForwardRevisionRejectedDecisionRecord(rejected)).toEqual(rejected);
    expect(snapshotKnowledgeForwardRevisionTerminalDecisionRecord(rejected)).toEqual(rejected);
  });

  it("rejects current-base no-ops, stale times, and mixed Runtime/freshness tuples", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const authority = createAppliedAuthority();
    const cases: Parameters<typeof createKnowledgeForwardRevisionAcceptedDecisionRecord>[0][] = [
      {
        proposal,
        proposalDigest,
        afterContent: CURRENT_CONTENT,
        acceptanceAuthority: authority,
        acceptedAt: 130,
      },
      {
        proposal,
        proposalDigest,
        afterContent: HISTORICAL_CONTENT,
        acceptanceAuthority: authority,
        acceptedAt: 119,
      },
      {
        proposal,
        proposalDigest,
        afterContent: HISTORICAL_CONTENT,
        acceptanceAuthority: {
          ...authority,
          runtimeRevision: 21,
        },
        acceptedAt: 130,
      },
      {
        proposal,
        proposalDigest,
        afterContent: HISTORICAL_CONTENT,
        acceptanceAuthority: {
          ...authority,
          vaultObservedBeforeHash: HISTORICAL_HASH,
        },
        acceptedAt: 130,
      },
    ];

    for (const value of cases) {
      expect(() => createKnowledgeForwardRevisionAcceptedDecisionRecord(value)).toThrow(
        KnowledgeForwardRevisionDecisionValidationError
      );
    }
  });

  it("rejects unsupported controls and lone surrogates but preserves valid exact text", () => {
    const proposal = createProposal();
    const base = {
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    };

    for (const afterContent of [
      "bad\u0000text",
      "bad\u000btext",
      "bad\u0085text",
      "bad\ud800text",
    ]) {
      expect(() =>
        createKnowledgeForwardRevisionAcceptedDecisionRecord({ ...base, afterContent })
      ).toThrow(KnowledgeForwardRevisionDecisionValidationError);
    }
    expect(() =>
      createKnowledgeForwardRevisionAcceptedDecisionRecord({
        ...base,
        afterContent: "valid\ttext\r\n🙂\n",
      })
    ).not.toThrow();
  });

  it("preserves an exact historical body with legacy controls but rejects edited controls", () => {
    const legacyContent = "A\u0000B";
    const proposal = createProposal(legacyContent);
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: legacyContent,
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    });
    expect(accepted.manualOverride).toBe(false);
    expect(accepted.afterContent).toBe(legacyContent);
    expect(() =>
      createKnowledgeForwardRevisionAcceptedDecisionRecord({
        proposal,
        proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
        afterContent: "edited\u0000body",
        acceptanceAuthority: createAppliedAuthority(),
        acceptedAt: 130,
      })
    ).toThrow(KnowledgeForwardRevisionDecisionValidationError);
  });

  it("detects body, dual-hash, evidence, decision, claim, and authority tampering", () => {
    const proposal = createProposal();
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: "# Manual\n",
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    });
    const cases: ((value: Record<string, unknown>) => void)[] = [
      (value) => {
        value.afterContent = "# Other\n";
      },
      (value) => {
        value.selectedHistoricalHash = HASH_A;
      },
      (value) => {
        value.acceptedAfterHash = HASH_A;
      },
      (value) => {
        value.manualOverride = false;
      },
      (value) => {
        (value.sourceEvidence as Record<string, unknown>).manualOverrideEvidence = "asserted";
      },
      (value) => {
        value.acceptedDecisionDigest = HASH_A;
      },
      (value) => {
        (value.applyClaim as Record<string, unknown>).acceptedDecisionDigest = HASH_A;
      },
      (value) => {
        value.applyClaimDigest = HASH_A;
      },
      (value) => {
        const authority = value.acceptanceAuthority as Record<string, unknown>;
        (authority.currentSourceFreshness as Record<string, unknown>).jobId = "forged";
      },
    ];

    for (const mutate of cases) {
      const value = clone(accepted) as unknown as Record<string, unknown>;
      mutate(value);
      expect(() => snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(value)).toThrow(
        KnowledgeForwardRevisionDecisionValidationError
      );
    }
  });

  it("rejects accessors, extra keys, revoked proxies, and caller-created errors", () => {
    const proposal = createProposal();
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: HISTORICAL_CONTENT,
      acceptanceAuthority: createAppliedAuthority(),
      acceptedAt: 130,
    });
    const accessor = clone(accepted) as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, "afterContent", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return HISTORICAL_CONTENT;
      },
    });
    const revoked = Proxy.revocable(accepted, {});
    revoked.revoke();

    for (const value of [{ ...accepted, extra: true }, accessor, revoked.proxy]) {
      expect(() => snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(value)).toThrow(
        KnowledgeForwardRevisionDecisionValidationError
      );
    }
    expect(getterCalls).toBe(0);

    const spoof = new KnowledgeForwardRevisionDecisionValidationError();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw spoof;
        },
      }
    );
    let observed: unknown;
    try {
      snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(hostile);
    } catch (error) {
      observed = error;
    }
    expect(observed).not.toBe(spoof);
    expect(Object.isFrozen(observed)).toBe(true);
  });

  it("returns closed validation results and detached terminal snapshots", () => {
    const secret = "secret-user-value";
    expect(validateKnowledgeForwardRevisionTerminalDecisionRecord({ secret })).toEqual({
      valid: false,
      diagnostics: [
        {
          code: "forward_revision_decision_invalid",
          severity: "error",
          field: "forwardRevisionDecision",
          message: "Forward revision decision does not satisfy its strict contract",
        },
      ],
    });
    expect(
      JSON.stringify(validateKnowledgeForwardRevisionTerminalDecisionRecord({ secret }))
    ).not.toContain(secret);

    const proposal = createProposal();
    const inputAuthority = createAppliedAuthority();
    const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: HISTORICAL_CONTENT,
      acceptanceAuthority: inputAuthority,
      acceptedAt: 130,
    });
    (inputAuthority.currentSourceFreshness as { completedAt: number }).completedAt = 999;
    expect(accepted.acceptanceAuthority.currentSourceFreshness.completedAt).toBe(115);
  });
});
