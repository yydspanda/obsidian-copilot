import type {
  NoJournalApplyGlobalTransactionObservation,
  NoJournalApplyRecoveryCandidate,
  NoJournalApplyRecoveryClassification,
  NoJournalApplyRecoverySnapshot,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueControl,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { deriveKnowledgeRecoveryModel } from "@/knowledge/ui/recoveryModel";

const BUNDLE_ID = "personal";

/** Creates one opaque recovery reference for a caller-selected id. */
function createReference(recoveryId: string) {
  return { bundleId: BUNDLE_ID, recoveryId };
}

/** Creates one complete empty Queue snapshot with a caller-selected control gate. */
function createQueueSnapshot(control: IngestQueueControl): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: BUNDLE_ID,
    revision: 19,
    control,
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

/** Creates one atomic recovery observation around selected durable classifications. */
function createRecoverySnapshot(
  classifications: readonly NoJournalApplyRecoveryClassification[] = [],
  control: IngestQueueControl = { status: "running" },
  globalTransaction: NoJournalApplyGlobalTransactionObservation | null = null
): NoJournalApplyRecoverySnapshot {
  return {
    bundleId: BUNDLE_ID,
    runtimeRevision: 23,
    reviewRevision: 7,
    queueSnapshot: createQueueSnapshot(control),
    globalTransaction,
    classifications,
  };
}

describe("deriveKnowledgeRecoveryModel", () => {
  it("maps accepted and decision-required states to their exact action matrix", () => {
    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([
        {
          kind: "accepted_not_started",
          reference: createReference("recovery-accepted"),
          bundleId: BUNDLE_ID,
          changeSetId: "changeset-accepted",
          jobId: "job-accepted",
        },
        {
          kind: "requires_decision",
          candidate: {
            ...createReference("recovery-decision"),
            jobId: "job-decision",
            changeSetId: "changeset-decision",
            sourceId: "source-1",
            sourceContentHash: "source-hash",
            pipelineFingerprint: "pipeline-fingerprint",
            inputRevision: 4,
            attempt: 2,
            startedAt: 100,
            acceptedAt: 110,
          },
        },
      ])
    );

    expect(model).toMatchObject({ bundleId: BUNDLE_ID, runtimeRevision: 23 });
    expect(model.items).toEqual([
      {
        id: "recovery-accepted",
        status: "accepted_not_started",
        changeSetId: "changeset-accepted",
        actions: { canContinue: true, canAbandon: false },
      },
      {
        id: "recovery-decision",
        status: "decision_required",
        changeSetId: "changeset-decision",
        actions: { canContinue: true, canAbandon: true },
      },
    ]);
  });

  it("makes a stale Manifest decision abandon-only while retaining its explanation (https://github.com/yydspanda/obsidian-copilot/issues/2)", () => {
    const staleCandidate: NoJournalApplyRecoveryCandidate = {
      ...createReference("recovery-stale-manifest"),
      jobId: "job-stale-manifest",
      changeSetId: "changeset-stale-manifest",
      sourceId: "source-1",
      sourceContentHash: "source-hash",
      pipelineFingerprint: "pipeline-fingerprint",
      inputRevision: 4,
      attempt: 2,
      startedAt: 100,
      acceptedAt: 110,
      continueBlockedReason: "manifest_read_set_changed",
    };

    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([{ kind: "requires_decision", candidate: staleCandidate }])
    );

    expect(model.items).toEqual([
      {
        id: "recovery-stale-manifest",
        status: "decision_required",
        changeSetId: "changeset-stale-manifest",
        continueBlockedReason: "manifest_read_set_changed",
        actions: { canContinue: false, canAbandon: true },
      },
    ]);
  });

  it("makes stale accepted-not-started work abandon-only (https://github.com/yydspanda/obsidian-copilot/issues/2)", () => {
    const staleAccepted: NoJournalApplyRecoveryClassification = {
      kind: "accepted_not_started",
      reference: createReference("recovery-stale-accepted"),
      bundleId: BUNDLE_ID,
      changeSetId: "changeset-stale-accepted",
      jobId: "job-stale-accepted",
      continueBlockedReason: "manifest_read_set_changed",
    };

    const model = deriveKnowledgeRecoveryModel(createRecoverySnapshot([staleAccepted]));

    expect(model.items).toEqual([
      {
        id: "recovery-stale-accepted",
        status: "decision_required",
        changeSetId: "changeset-stale-accepted",
        continueBlockedReason: "manifest_read_set_changed",
        actions: { canContinue: false, canAbandon: true },
      },
    ]);
  });

  it("renders active, blocked, and finalizing transactions as read-only states", () => {
    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([
        {
          kind: "active",
          reference: createReference("recovery-prepared"),
          transactionId: "transaction-prepared",
          phase: "prepared",
        },
        {
          kind: "active",
          reference: createReference("recovery-applying"),
          transactionId: "transaction-applying",
          phase: "applying",
        },
        {
          kind: "blocked",
          reference: createReference("recovery-blocked-own"),
          transactionId: "transaction-blocked-own",
          reason: "transaction_recovery_required",
        },
        {
          kind: "blocked",
          reference: createReference("recovery-blocked-other"),
          transactionId: "transaction-blocked-other",
          reason: "other_transaction_active",
        },
        {
          kind: "finalizing",
          reference: createReference("recovery-finalizing"),
          transactionId: "transaction-finalizing",
        },
      ])
    );

    expect(model.items).toEqual([
      {
        id: "recovery-prepared",
        status: "transaction_active",
        transactionId: "transaction-prepared",
        phase: "prepared",
        actions: { canContinue: false, canAbandon: false },
      },
      {
        id: "recovery-applying",
        status: "transaction_active",
        transactionId: "transaction-applying",
        phase: "applying",
        actions: { canContinue: false, canAbandon: false },
      },
      {
        id: "recovery-blocked-own",
        status: "apply_blocked",
        transactionId: "transaction-blocked-own",
        blockedReason: "transaction_recovery_required",
        actions: { canContinue: false, canAbandon: false },
      },
      {
        id: "recovery-blocked-other",
        status: "apply_blocked",
        transactionId: "transaction-blocked-other",
        blockedReason: "other_transaction_active",
        actions: { canContinue: false, canAbandon: false },
      },
      {
        id: "recovery-finalizing",
        status: "commit_finalizing",
        transactionId: "transaction-finalizing",
        phase: "committed",
        actions: { canContinue: false, canAbandon: false },
      },
    ]);
  });

  it("omits committed and abandoned classifications from actionable recovery", () => {
    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([
        {
          kind: "committed",
          reference: createReference("recovery-committed"),
          transactionId: "transaction-committed",
        },
        {
          kind: "abandoned",
          reference: createReference("recovery-abandoned"),
          jobId: "job-abandoned",
          changeSetId: "changeset-abandoned",
          abandonedAt: 120,
        },
      ])
    );

    expect(model.items).toEqual([]);
  });

  it("adds one global transaction row unless a classification already represents it", () => {
    const globalTransaction: NoJournalApplyGlobalTransactionObservation = {
      transactionId: "transaction-global",
      bundleId: BUNDLE_ID,
      changeSetId: "changeset-global",
      phase: "recovery_required",
    };

    const standalone = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([], { status: "running" }, globalTransaction)
    );
    expect(standalone.items).toEqual([
      {
        id: "transaction:transaction-global",
        status: "global_transaction",
        transactionId: "transaction-global",
        changeSetId: "changeset-global",
        phase: "recovery_required",
        actions: { canContinue: false, canAbandon: false },
      },
    ]);

    const represented = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot(
        [
          {
            kind: "active",
            reference: createReference("recovery-active"),
            transactionId: "transaction-global",
            phase: "applying",
          },
        ],
        { status: "running" },
        globalTransaction
      )
    );
    expect(represented.items.map((item) => item.id)).toEqual(["recovery-active"]);
  });

  it.each([
    ["recovery_required", "queue_recovery_required"],
    ["commit_pending_ack", "queue_commit_pending_ack"],
  ] as const)("projects a paused %s Queue into %s", (reason, status) => {
    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([], { status: "paused", reason, pausedAt: 130 })
    );

    expect(model.items).toEqual([
      {
        id: `queue:${BUNDLE_ID}:${reason}`,
        status,
        actions: { canContinue: false, canAbandon: false },
      },
    ]);
  });

  it("does not duplicate Queue recovery and finalization states already classified", () => {
    const blocked = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot(
        [
          {
            kind: "blocked",
            reference: createReference("recovery-blocked"),
            transactionId: "transaction-blocked",
            reason: "transaction_recovery_required",
          },
        ],
        { status: "paused", reason: "recovery_required", pausedAt: 140 }
      )
    );
    const finalizing = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot(
        [
          {
            kind: "finalizing",
            reference: createReference("recovery-finalizing"),
            transactionId: "transaction-finalizing",
          },
        ],
        { status: "paused", reason: "commit_pending_ack", pausedAt: 150 }
      )
    );

    expect(blocked.items.map((item) => item.status)).toEqual(["apply_blocked"]);
    expect(finalizing.items.map((item) => item.status)).toEqual(["commit_finalizing"]);
  });

  it("deep-freezes the model, item collection, rows, and action flags", () => {
    const model = deriveKnowledgeRecoveryModel(
      createRecoverySnapshot([
        {
          kind: "accepted_not_started",
          reference: createReference("recovery-frozen"),
          bundleId: BUNDLE_ID,
          changeSetId: "changeset-frozen",
          jobId: "job-frozen",
        },
      ])
    );

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.items)).toBe(true);
    expect(Object.isFrozen(model.items[0])).toBe(true);
    expect(Object.isFrozen(model.items[0]?.actions)).toBe(true);
  });
});
