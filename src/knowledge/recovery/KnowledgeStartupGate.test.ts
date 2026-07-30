import type { ApplyCommitReconciliationResult } from "@/knowledge/changeset/ApplyCommitCoordinator";
import { ChangeSetTransactionRecoveryRequiredError } from "@/knowledge/changeset/ChangeSetTransaction";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeBundleConfig, KnowledgeIngestJob } from "@/knowledge/model/types";
import {
  KnowledgeStartupAcceptedClassificationError,
  KnowledgeStartupBundleValidationError,
  KnowledgeStartupGate,
  KnowledgeStartupGateUnstableError,
  KnowledgeStartupQueueValidationError,
  KnowledgeStartupRecoveryNormalizationError,
  KnowledgeStartupSnapshotConsistencyError,
  type KnowledgeStartupApplyCommitPort,
  type KnowledgeStartupQueuePort,
  type KnowledgeStartupReviewPort,
} from "@/knowledge/recovery/KnowledgeStartupGate";
import {
  createNoJournalApplyRecoveryReference,
  type NoJournalApplyGlobalTransactionObservation,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoverySnapshotLoadResult,
  type NoJournalApplyRecoverySnapshotPort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import type {
  AcceptedReviewStartupIdentity,
  ReviewQueueStartupReconciliationResult,
} from "@/knowledge/review/ReviewQueueStartupReconciler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** Creates one exact accepted identity for Review-to-Runtime correlation tests. */
function createAcceptedIdentity(
  options: {
    changeSetId?: string;
    jobId?: string;
    sourceId?: string;
  } = {}
): AcceptedReviewStartupIdentity {
  return {
    bundleId: "personal",
    changeSetId: options.changeSetId ?? "changeset-1",
    proposalDigest: HASH_A,
    recordRevision: 1,
    recordedAt: 1,
    acceptedDigest: HASH_B,
    manifestCommitIntentDigest: HASH_A,
    acceptedAt: 2,
    jobClaim: {
      jobId: options.jobId ?? "job-1",
      sourceId: options.sourceId ?? "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
    },
  };
}

const RECOVERY_ID = createNoJournalApplyRecoveryReference(
  "personal",
  createAcceptedIdentity()
).recoveryId;

/** Creates one stable Review result containing exactly the supplied accepted identities. */
function createReviewResult(
  identities: readonly AcceptedReviewStartupIdentity[],
  reviewRevision = 0
): ReviewQueueStartupReconciliationResult {
  return {
    bundleId: "personal",
    reviewRevision,
    actions: identities.map((identity) => ({
      kind: "accepted_requires_runtime_classification" as const,
      identity,
    })),
  };
}

/** Creates the valid current Bundle required before journal roll-forward. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates a revision-zero Queue with no durable work. */
function createEmptyQueue(): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "personal",
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

/** Creates a valid interrupted direct apply used to test Queue-only blockers. */
function createRecoveryRequiredQueue(): IngestQueueSnapshot {
  const job: KnowledgeIngestJob = {
    id: "job-1",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    rerunRequested: false,
    createdAt: 1,
    updatedAt: 4,
    status: "failed",
    stage: "applying",
    failure: {
      code: "interrupted_apply_requires_recovery",
      message: "Interrupted apply requires recovery",
      retryable: false,
      occurredAt: 4,
    },
  };
  return {
    ...createEmptyQueue(),
    revision: 3,
    control: { status: "paused", reason: "recovery_required", pausedAt: 4 },
    jobs: [job],
    sourceHighWatermarks: [
      {
        sourceId: job.sourceId,
        sourceContentHash: job.sourceContentHash,
        pipelineFingerprint: job.pipelineFingerprint,
        inputRevision: job.inputRevision,
        observedAt: 1,
      },
    ],
    applyClaim: {
      jobId: job.id,
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
      attempt: job.attempt,
      startedAt: 3,
    },
  };
}

/** Creates one exact no-journal user-decision classification. */
function createDecisionClassification(
  identity: AcceptedReviewStartupIdentity = createAcceptedIdentity()
): NoJournalApplyRecoveryClassification {
  const reference = createNoJournalApplyRecoveryReference(identity.bundleId, identity);
  return {
    kind: "requires_decision",
    candidate: {
      ...reference,
      jobId: identity.jobClaim.jobId,
      changeSetId: identity.changeSetId,
      sourceId: identity.jobClaim.sourceId,
      sourceContentHash: identity.jobClaim.sourceContentHash,
      pipelineFingerprint: identity.jobClaim.pipelineFingerprint,
      inputRevision: identity.jobClaim.inputRevision,
      attempt: identity.jobClaim.attempt,
      startedAt: 3,
      acceptedAt: identity.acceptedAt,
    },
  };
}

/** Creates one loaded atomic snapshot result. */
function createLoadedSnapshot(
  classifications: readonly NoJournalApplyRecoveryClassification[] = [],
  options: {
    reviewRevision?: number;
    runtimeRevision?: number;
    queue?: IngestQueueSnapshot;
    globalTransaction?: NoJournalApplyGlobalTransactionObservation | null;
  } = {}
): NoJournalApplyRecoverySnapshotLoadResult {
  return {
    kind: "loaded",
    snapshot: {
      bundleId: "personal",
      runtimeRevision: options.runtimeRevision ?? 5,
      reviewRevision: options.reviewRevision ?? 0,
      queueSnapshot: options.queue ?? createEmptyQueue(),
      globalTransaction: options.globalTransaction ?? null,
      classifications,
    },
  };
}

/** Scripted Queue startup port with observable call ordering. */
class ScriptedQueuePort implements KnowledgeStartupQueuePort {
  /** Creates a Queue port returning one fixed strict snapshot. */
  constructor(
    private readonly calls: string[],
    private readonly snapshot: IngestQueueSnapshot = createEmptyQueue()
  ) {}

  /** Records and returns the startup recovery snapshot. */
  async recoverOnStartup(bundleId: string): Promise<IngestQueueSnapshot> {
    this.calls.push(`queue:${bundleId}`);
    return this.snapshot;
  }
}

/** Scripted apply coordinator supporting exact results or injected failures. */
class ScriptedApplyCommitPort implements KnowledgeStartupApplyCommitPort {
  private index = 0;

  /** Creates an apply port from an ordered script. */
  constructor(
    private readonly calls: string[],
    private readonly script: readonly (ApplyCommitReconciliationResult | Error)[] = [
      { kind: "none" },
    ]
  ) {}

  /** Records the call and consumes the next scripted outcome. */
  async reconcile(bundle: KnowledgeBundleConfig): Promise<ApplyCommitReconciliationResult> {
    this.calls.push(`apply:${bundle.id}`);
    const outcome = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

/** Scripted Review reconciler supporting outer revision churn tests. */
class ScriptedReviewPort implements KnowledgeStartupReviewPort {
  private index = 0;

  /** Creates a Review port from stable or changing results. */
  constructor(
    private readonly calls: string[],
    private readonly script: readonly ReviewQueueStartupReconciliationResult[] = [
      { bundleId: "personal", reviewRevision: 0, actions: [] },
    ]
  ) {}

  /** Records the call and consumes the next reconciliation result. */
  async reconcile(bundleId: string): Promise<ReviewQueueStartupReconciliationResult> {
    this.calls.push(`reviews:${bundleId}`);
    const result = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return result;
  }
}

/** Scripted atomic accepted-recovery snapshot port. */
class ScriptedAcceptedPort implements NoJournalApplyRecoverySnapshotPort {
  private index = 0;

  /** Creates an accepted snapshot port from ordered atomic observations. */
  constructor(
    private readonly calls: string[],
    private readonly script: readonly NoJournalApplyRecoverySnapshotLoadResult[] = [
      createLoadedSnapshot(),
    ]
  ) {}

  /** Records the expected revision and consumes the next atomic observation. */
  async loadSnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult> {
    this.calls.push(`accepted:${bundleId}:${expectedReviewRevision}`);
    const result = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return result;
  }
}

/** Creates a gate whose individual scripted ports can be overridden. */
function createGate(
  calls: string[],
  options: {
    queue?: KnowledgeStartupQueuePort;
    applyCommit?: KnowledgeStartupApplyCommitPort;
    reviews?: KnowledgeStartupReviewPort;
    accepted?: NoJournalApplyRecoverySnapshotPort;
    acceptedIdentities?: readonly AcceptedReviewStartupIdentity[];
    maxStartupPasses?: number;
  } = {}
): KnowledgeStartupGate {
  return new KnowledgeStartupGate({
    queue: options.queue ?? new ScriptedQueuePort(calls),
    applyCommit: options.applyCommit ?? new ScriptedApplyCommitPort(calls),
    reviews:
      options.reviews ??
      new ScriptedReviewPort(calls, [createReviewResult(options.acceptedIdentities ?? [])]),
    accepted: options.accepted ?? new ScriptedAcceptedPort(calls),
    maxStartupPasses: options.maxStartupPasses,
  });
}

describe("KnowledgeStartupGate", () => {
  it("runs Queue, apply reconciliation, Review reconciliation, and atomic classification in order", async () => {
    const calls: string[] = [];
    const result = await createGate(calls).run(createBundle());

    expect(calls).toEqual([
      "queue:personal",
      "apply:personal",
      "reviews:personal",
      "accepted:personal:0",
    ]);
    expect(result).toMatchObject({
      bundleId: "personal",
      disposition: "observed_clear",
      runtimeRevision: 5,
      reviewRevision: 0,
      applyCommit: { kind: "none" },
      attention: [],
    });
  });

  it("rejects an invalid current Bundle before invoking any recovery port", async () => {
    const calls: string[] = [];
    const gate = createGate(calls);

    await expect(gate.run({ ...createBundle(), wikiRoot: "../Outside" })).rejects.toBeInstanceOf(
      KnowledgeStartupBundleValidationError
    );
    expect(calls).toEqual([]);
  });

  it("normalizes the first sticky transaction conflict through one immediate reconcile retry", async () => {
    const calls: string[] = [];
    const identity = createAcceptedIdentity();
    const blocked: ApplyCommitReconciliationResult = {
      kind: "blocked",
      transactionId: "tx-1",
      bundleId: "personal",
      changeSetId: "changeset-1",
      conflicts: [],
    };
    const applyCommit = new ScriptedApplyCommitPort(calls, [
      new ChangeSetTransactionRecoveryRequiredError("tx-1", []),
      blocked,
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([
        {
          kind: "blocked",
          reference: { bundleId: "personal", recoveryId: RECOVERY_ID },
          transactionId: "tx-1",
          reason: "transaction_recovery_required",
        },
      ]),
    ]);

    const result = await createGate(calls, {
      applyCommit,
      accepted,
      acceptedIdentities: [identity],
    }).run(createBundle());

    expect(calls.filter((call) => call === "apply:personal")).toHaveLength(2);
    expect(result.disposition).toBe("blocked");
    expect(result.attention).toEqual([
      {
        kind: "transaction_recovery_required",
        transactionId: "tx-1",
        changeSetId: "changeset-1",
      },
      {
        kind: "accepted_apply_blocked",
        reference: { bundleId: "personal", recoveryId: RECOVERY_ID },
        transactionId: "tx-1",
        reason: "transaction_recovery_required",
      },
    ]);
  });

  it.each([
    {
      label: "no blocked transaction",
      normalized: { kind: "none" } as ApplyCommitReconciliationResult,
      observedKind: "none",
      observedTransactionId: undefined,
    },
    {
      label: "a different blocked transaction",
      normalized: {
        kind: "blocked",
        transactionId: "tx-2",
        bundleId: "personal",
        changeSetId: "changeset-2",
        conflicts: [],
      } as ApplyCommitReconciliationResult,
      observedKind: "blocked",
      observedTransactionId: "tx-2",
    },
  ])("fails closed when sticky conflict normalization returns $label", async (scenario) => {
    const calls: string[] = [];
    const applyCommit = new ScriptedApplyCommitPort(calls, [
      new ChangeSetTransactionRecoveryRequiredError("tx-1", []),
      scenario.normalized,
    ]);

    await expect(createGate(calls, { applyCommit }).run(createBundle())).rejects.toMatchObject({
      name: KnowledgeStartupRecoveryNormalizationError.name,
      expectedTransactionId: "tx-1",
      observedKind: scenario.observedKind,
      observedTransactionId: scenario.observedTransactionId,
    });
  });

  it("exposes no-journal and accepted-not-started states as explicit attention without acting", async () => {
    const calls: string[] = [];
    const notStartedIdentity = createAcceptedIdentity({
      changeSetId: "changeset-0",
      jobId: "job-0",
      sourceId: "source-0",
    });
    const decisionIdentity = createAcceptedIdentity();
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([
        {
          kind: "accepted_not_started",
          reference: createNoJournalApplyRecoveryReference(
            notStartedIdentity.bundleId,
            notStartedIdentity
          ),
          bundleId: "personal",
          changeSetId: "changeset-0",
          jobId: "job-0",
        },
        createDecisionClassification(decisionIdentity),
      ]),
    ]);

    const result = await createGate(calls, {
      accepted,
      acceptedIdentities: [notStartedIdentity, decisionIdentity],
    }).run(createBundle());

    expect(result.disposition).toBe("attention_required");
    expect(result.attention).toEqual([
      { kind: "accepted_not_started", jobId: "job-0", changeSetId: "changeset-0" },
      {
        kind: "no_journal_decision_required",
        reference: { bundleId: "personal", recoveryId: RECOVERY_ID },
        jobId: "job-1",
        changeSetId: "changeset-1",
      },
    ]);
    expect(calls).not.toContain("continue");
    expect(calls).not.toContain("abandon");
  });

  it("fails closed when an accepted Review classification is missing", async () => {
    const calls: string[] = [];
    const identity = createAcceptedIdentity();

    await expect(
      createGate(calls, {
        accepted: new ScriptedAcceptedPort(calls, [createLoadedSnapshot()]),
        acceptedIdentities: [identity],
      }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupAcceptedClassificationError.name,
      bundleId: "personal",
      expectedCount: 1,
      actualCount: 0,
    });
  });

  it("fails closed when Runtime returns an unrequested accepted classification", async () => {
    const calls: string[] = [];

    await expect(
      createGate(calls, {
        accepted: new ScriptedAcceptedPort(calls, [
          createLoadedSnapshot([createDecisionClassification()]),
        ]),
      }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupAcceptedClassificationError.name,
      bundleId: "personal",
      expectedCount: 0,
      actualCount: 1,
    });
  });

  it("rejects duplicate classifications and accepts the same exact set in another order", async () => {
    const first = createAcceptedIdentity();
    const second = createAcceptedIdentity({
      changeSetId: "changeset-2",
      jobId: "job-2",
      sourceId: "source-2",
    });
    const duplicateCalls: string[] = [];
    await expect(
      createGate(duplicateCalls, {
        accepted: new ScriptedAcceptedPort(duplicateCalls, [
          createLoadedSnapshot([
            createDecisionClassification(first),
            createDecisionClassification(first),
          ]),
        ]),
        acceptedIdentities: [first, second],
      }).run(createBundle())
    ).rejects.toBeInstanceOf(KnowledgeStartupAcceptedClassificationError);

    const reorderedCalls: string[] = [];
    await expect(
      createGate(reorderedCalls, {
        accepted: new ScriptedAcceptedPort(reorderedCalls, [
          createLoadedSnapshot([
            createDecisionClassification(second),
            createDecisionClassification(first),
          ]),
        ]),
        acceptedIdentities: [first, second],
      }).run(createBundle())
    ).resolves.toMatchObject({ disposition: "attention_required" });
  });

  it("fails closed when immutable accepted identity material no longer correlates", async () => {
    const calls: string[] = [];
    const classifiedIdentity = createAcceptedIdentity();
    const changedIdentity: AcceptedReviewStartupIdentity = {
      ...classifiedIdentity,
      proposalDigest: HASH_B,
    };

    await expect(
      createGate(calls, {
        accepted: new ScriptedAcceptedPort(calls, [
          createLoadedSnapshot([createDecisionClassification(classifiedIdentity)]),
        ]),
        acceptedIdentities: [changedIdentity],
      }).run(createBundle())
    ).rejects.toBeInstanceOf(KnowledgeStartupAcceptedClassificationError);
  });

  it("treats active and finalizing accepted transactions as hard blockers", async () => {
    const calls: string[] = [];
    const activeIdentity = createAcceptedIdentity();
    const finalizingIdentity = createAcceptedIdentity({
      changeSetId: "changeset-2",
      jobId: "job-2",
      sourceId: "source-2",
    });
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot(
        [
          {
            kind: "active",
            reference: createNoJournalApplyRecoveryReference(
              activeIdentity.bundleId,
              activeIdentity
            ),
            transactionId: "tx-active",
            phase: "applying",
          },
          {
            kind: "finalizing",
            reference: createNoJournalApplyRecoveryReference(
              finalizingIdentity.bundleId,
              finalizingIdentity
            ),
            transactionId: "tx-finalizing",
          },
        ],
        {
          globalTransaction: {
            transactionId: "tx-active",
            bundleId: "personal",
            changeSetId: "changeset-1",
            phase: "applying",
          },
        }
      ),
    ]);

    const result = await createGate(calls, {
      accepted,
      acceptedIdentities: [activeIdentity, finalizingIdentity],
    }).run(createBundle());

    expect(result.disposition).toBe("blocked");
    expect(result.attention.map((item) => item.kind)).toEqual([
      "transaction_active",
      "commit_finalizing",
    ]);
  });

  it("surfaces a Vault-global transaction that appears after apply reconciliation", async () => {
    const calls: string[] = [];
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([], {
        globalTransaction: {
          transactionId: "tx-raced",
          bundleId: "other-bundle",
          changeSetId: "changeset-raced",
          phase: "prepared",
        },
      }),
    ]);

    const result = await createGate(calls, { accepted }).run(createBundle());

    expect(result).toMatchObject({
      disposition: "blocked",
      globalTransaction: {
        transactionId: "tx-raced",
        bundleId: "other-bundle",
        changeSetId: "changeset-raced",
        phase: "prepared",
      },
      attention: [
        {
          kind: "global_transaction_observed",
          transactionId: "tx-raced",
          ownerBundleId: "other-bundle",
          changeSetId: "changeset-raced",
          phase: "prepared",
        },
      ],
    });
  });

  it("keeps distinct accepted blockers that share one Vault-global transaction", async () => {
    const calls: string[] = [];
    const firstIdentity = createAcceptedIdentity();
    const secondIdentity = createAcceptedIdentity({
      changeSetId: "changeset-2",
      jobId: "job-2",
      sourceId: "source-2",
    });
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([
        {
          kind: "blocked",
          reference: createNoJournalApplyRecoveryReference(firstIdentity.bundleId, firstIdentity),
          transactionId: "tx-global",
          reason: "other_transaction_active",
        },
        {
          kind: "blocked",
          reference: createNoJournalApplyRecoveryReference(secondIdentity.bundleId, secondIdentity),
          transactionId: "tx-global",
          reason: "other_transaction_active",
        },
      ]),
    ]);

    const result = await createGate(calls, {
      accepted,
      acceptedIdentities: [firstIdentity, secondIdentity],
    }).run(createBundle());

    expect(result.attention.filter((item) => item.kind === "accepted_apply_blocked")).toHaveLength(
      2
    );
  });

  it("does not treat committed or abandoned history as unresolved recovery", async () => {
    const calls: string[] = [];
    const committedIdentity = createAcceptedIdentity();
    const abandonedIdentity = createAcceptedIdentity({
      changeSetId: "changeset-2",
      jobId: "job-2",
      sourceId: "source-2",
    });
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([
        {
          kind: "committed",
          reference: createNoJournalApplyRecoveryReference(
            committedIdentity.bundleId,
            committedIdentity
          ),
          transactionId: "tx-committed",
        },
        {
          kind: "abandoned",
          reference: createNoJournalApplyRecoveryReference(
            abandonedIdentity.bundleId,
            abandonedIdentity
          ),
          jobId: "job-2",
          changeSetId: "changeset-2",
          abandonedAt: 9,
        },
      ]),
    ]);

    await expect(
      createGate(calls, {
        accepted,
        acceptedIdentities: [committedIdentity, abandonedIdentity],
      }).run(createBundle())
    ).resolves.toMatchObject({
      disposition: "observed_clear",
      attention: [],
    });
  });

  it("retries the outer pass when the atomic Review revision moved", async () => {
    const calls: string[] = [];
    const reviews = new ScriptedReviewPort(calls, [
      { bundleId: "personal", reviewRevision: 1, actions: [] },
      {
        bundleId: "personal",
        reviewRevision: 2,
        actions: [{ kind: "pending_reconciled", changeSetId: "changeset-2", jobId: "job-2" }],
      },
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      {
        kind: "review_revision_changed",
        bundleId: "personal",
        runtimeRevision: 6,
        expectedReviewRevision: 1,
        actualReviewRevision: 2,
      },
      createLoadedSnapshot([], { reviewRevision: 2, runtimeRevision: 7 }),
    ]);

    const result = await createGate(calls, { reviews, accepted }).run(createBundle());

    expect(calls.filter((call) => call === "apply:personal")).toHaveLength(2);
    expect(result).toMatchObject({
      runtimeRevision: 7,
      reviewRevision: 2,
      reviewReconciliations: [
        { kind: "pending_reconciled", changeSetId: "changeset-2", jobId: "job-2" },
      ],
    });
  });

  it("fails closed when an atomic Runtime observation regresses across Review retries", async () => {
    const calls: string[] = [];
    const reviews = new ScriptedReviewPort(calls, [
      { bundleId: "personal", reviewRevision: 1, actions: [] },
      { bundleId: "personal", reviewRevision: 2, actions: [] },
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      {
        kind: "review_revision_changed",
        bundleId: "personal",
        runtimeRevision: 10,
        expectedReviewRevision: 1,
        actualReviewRevision: 2,
      },
      createLoadedSnapshot([], { reviewRevision: 2, runtimeRevision: 5 }),
    ]);

    await expect(
      createGate(calls, { reviews, accepted }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupSnapshotConsistencyError.name,
      bundleId: "personal",
      reason: "runtime_revision_regressed",
      observedRevision: 10,
      actualRevision: 5,
    });
  });

  it("fails closed after bounded persistent Review revision churn", async () => {
    const calls: string[] = [];
    const reviews = new ScriptedReviewPort(calls, [
      { bundleId: "personal", reviewRevision: 1, actions: [] },
      { bundleId: "personal", reviewRevision: 2, actions: [] },
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      {
        kind: "review_revision_changed",
        bundleId: "personal",
        runtimeRevision: 2,
        expectedReviewRevision: 1,
        actualReviewRevision: 2,
      },
      {
        kind: "review_revision_changed",
        bundleId: "personal",
        runtimeRevision: 3,
        expectedReviewRevision: 2,
        actualReviewRevision: 3,
      },
    ]);

    await expect(
      createGate(calls, { reviews, accepted, maxStartupPasses: 2 }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupGateUnstableError.name,
      bundleId: "personal",
      attempts: 2,
    });
  });

  it("fails closed for a malformed Queue returned by either startup boundary", async () => {
    const calls: string[] = [];
    const invalidQueue = { ...createEmptyQueue(), bundleId: "other" };

    try {
      await createGate(calls, { queue: new ScriptedQueuePort(calls, invalidQueue) }).run(
        createBundle()
      );
      throw new Error("Expected an invalid startup Queue to fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeStartupQueueValidationError);
      if (!(error instanceof KnowledgeStartupQueueValidationError)) throw error;
      expect(error.diagnostics).toContainEqual({
        code: "queue_bundle_mismatch",
        severity: "error",
        field: "bundleId",
        message: "Recovered Queue belongs to another Bundle",
      });
    }

    const secondCalls: string[] = [];
    const accepted = new ScriptedAcceptedPort(secondCalls, [
      createLoadedSnapshot([], { queue: invalidQueue }),
    ]);
    await expect(createGate(secondCalls, { accepted }).run(createBundle())).rejects.toBeInstanceOf(
      KnowledgeStartupQueueValidationError
    );
  });

  it("retains a newer Queue snapshot returned by apply reconciliation as the revision floor", async () => {
    const calls: string[] = [];
    const applyQueue = { ...createEmptyQueue(), revision: 2 } satisfies IngestQueueSnapshot;
    const staleAtomicQueue = { ...createEmptyQueue(), revision: 1 } satisfies IngestQueueSnapshot;
    const applyCommit = new ScriptedApplyCommitPort(calls, [
      {
        kind: "finalized_pending_ack",
        transactionId: "tx-finalized",
        queueSnapshot: applyQueue,
      },
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([], { queue: staleAtomicQueue }),
    ]);

    await expect(
      createGate(calls, { applyCommit, accepted }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupSnapshotConsistencyError.name,
      reason: "queue_revision_regressed",
      observedRevision: 2,
      actualRevision: 1,
    });
  });

  it.each([
    {
      label: "an older Queue revision",
      recovered: { ...createRecoveryRequiredQueue(), revision: 4 },
      final: createEmptyQueue(),
      reason: "queue_revision_regressed",
      observedRevision: 4,
      actualRevision: 0,
    },
    {
      label: "different content at the same Queue revision",
      recovered: createEmptyQueue(),
      final: {
        ...createEmptyQueue(),
        control: { status: "paused", reason: "user", pausedAt: 9 },
      } satisfies IngestQueueSnapshot,
      reason: "queue_same_revision_mismatch",
      observedRevision: 0,
      actualRevision: 0,
    },
  ])("fails closed when the final atomic snapshot contains $label", async (scenario) => {
    const calls: string[] = [];
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([], { queue: scenario.final }),
    ]);

    await expect(
      createGate(calls, {
        queue: new ScriptedQueuePort(calls, scenario.recovered),
        accepted,
      }).run(createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeStartupSnapshotConsistencyError.name,
      bundleId: "personal",
      reason: scenario.reason,
      observedRevision: scenario.observedRevision,
      actualRevision: scenario.actualRevision,
    });
  });

  it("surfaces a Queue-only recovery gate when no accepted Review explains it", async () => {
    const calls: string[] = [];
    const queue = createRecoveryRequiredQueue();
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([], { queue, runtimeRevision: 8 }),
    ]);

    const result = await createGate(calls, {
      queue: new ScriptedQueuePort(calls, queue),
      accepted,
    }).run(createBundle());

    expect(result).toMatchObject({
      disposition: "blocked",
      attention: [{ kind: "queue_recovery_required" }],
    });
  });

  it("keeps Queue recovery visible beside an unrelated Vault-global transaction blocker", async () => {
    const calls: string[] = [];
    const queue = createRecoveryRequiredQueue();
    const applyCommit = new ScriptedApplyCommitPort(calls, [
      {
        kind: "blocked",
        transactionId: "tx-other",
        bundleId: "personal",
        changeSetId: "changeset-other",
        conflicts: [],
      },
    ]);
    const accepted = new ScriptedAcceptedPort(calls, [
      createLoadedSnapshot([], { queue, runtimeRevision: 8 }),
    ]);

    const result = await createGate(calls, {
      queue: new ScriptedQueuePort(calls, queue),
      applyCommit,
      accepted,
    }).run(createBundle());

    expect(result.attention.map((item) => item.kind)).toEqual([
      "transaction_recovery_required",
      "queue_recovery_required",
    ]);
  });
});
