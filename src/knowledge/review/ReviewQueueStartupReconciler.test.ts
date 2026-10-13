import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  projectManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  IngestQueue,
  IngestQueueTransitionError,
  type IngestPendingReviewDecisionReceipt,
  type IngestRejectedReviewDecisionReceipt,
  type IngestExecutor,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeIngestJob } from "@/knowledge/model/types";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  ReviewQueueStartupReconciler,
  ReviewQueueStartupUnstableError,
  type ReviewQueueStartupQueuePort,
  type ReviewQueueStartupReviewPort,
} from "@/knowledge/review/ReviewQueueStartupReconciler";
import {
  ReviewStorageRevisionConflictError,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  type PendingChangeSetReviewRecord,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";

const BUNDLE_ID = "personal";
const JOB_ID = "job-1";
const SOURCE_ID = "source-1";
const SOURCE_HASH = "a".repeat(64);
const OTHER_SOURCE_HASH = "c".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const MANIFEST_HASH = "d".repeat(64);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryReviewStorage implements ReviewStorage {
  private readonly values = new Map<string, ChangeSetReviewSnapshot>();

  async read(bundleId: string): Promise<unknown> {
    const value = this.values.get(bundleId);
    return value ? cloneJson(value) : null;
  }

  async write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const actualRevision = this.values.get(bundleId)?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    this.values.set(bundleId, cloneJson(snapshot));
  }
}

class MemoryQueueStorage implements QueueStorage {
  private readonly values = new Map<string, IngestQueueSnapshot>();

  seed(snapshot: IngestQueueSnapshot): void {
    const parsed = parseIngestQueueSnapshot(snapshot);
    if (!parsed.ok) {
      throw new Error("Test queue seed must satisfy the strict schema");
    }
    this.values.set(snapshot.bundleId, cloneJson(parsed.value));
  }

  async read(bundleId: string): Promise<unknown> {
    const value = this.values.get(bundleId);
    return value ? cloneJson(value) : null;
  }

  async write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const actualRevision = this.values.get(bundleId)?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    const parsed = parseIngestQueueSnapshot(snapshot);
    if (!parsed.ok) {
      throw new Error("Test queue write must satisfy the strict schema");
    }
    this.values.set(bundleId, cloneJson(parsed.value));
  }
}

class ForbiddenExecutor implements IngestExecutor {
  calls = 0;

  async execute(): Promise<never> {
    this.calls += 1;
    throw new Error("Startup review reconciliation must not execute ingest work");
  }
}

class CommitThenThrowQueuePort implements ReviewQueueStartupQueuePort {
  private pendingFailureRemaining: boolean;
  private rejectionFailureRemaining: boolean;

  constructor(
    private readonly delegate: ReviewQueueStartupQueuePort,
    options: { pending?: boolean; rejection?: boolean }
  ) {
    this.pendingFailureRemaining = options.pending ?? false;
    this.rejectionFailureRemaining = options.rejection ?? false;
  }

  load(bundleId: string): Promise<IngestQueueSnapshot> {
    return this.delegate.load(bundleId);
  }

  async reconcilePendingReview(
    bundleId: string,
    receipt: IngestPendingReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob> {
    const job = await this.delegate.reconcilePendingReview(bundleId, receipt);
    if (this.pendingFailureRemaining) {
      this.pendingFailureRemaining = false;
      throw new Error("simulated pending commit-then-throw");
    }
    return job;
  }

  async rejectReview(
    bundleId: string,
    receipt: IngestRejectedReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob> {
    const job = await this.delegate.rejectReview(bundleId, receipt);
    if (this.rejectionFailureRemaining) {
      this.rejectionFailureRemaining = false;
      throw new Error("simulated rejection commit-then-throw");
    }
    return job;
  }
}

class RecordingQueuePort implements ReviewQueueStartupQueuePort {
  readonly pendingChangeSetIds: string[] = [];

  async load(bundleId: string): Promise<IngestQueueSnapshot> {
    return {
      version: INGEST_QUEUE_VERSION,
      bundleId,
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

  async reconcilePendingReview(
    bundleId: string,
    receipt: IngestPendingReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob> {
    this.pendingChangeSetIds.push(receipt.changeSetId);
    return {
      id: receipt.jobClaim.jobId,
      bundleId,
      sourceId: receipt.jobClaim.sourceId,
      sourceContentHash: receipt.jobClaim.sourceContentHash,
      pipelineFingerprint: receipt.jobClaim.pipelineFingerprint,
      inputRevision: receipt.jobClaim.inputRevision,
      attempt: receipt.jobClaim.attempt,
      rerunRequested: false,
      createdAt: receipt.recordedAt,
      updatedAt: receipt.recordedAt,
      status: "awaiting_review",
      stage: "review",
      changeSetId: receipt.changeSetId,
    };
  }

  async rejectReview(): Promise<never> {
    throw new Error("RecordingQueuePort does not accept rejected records");
  }
}

class StalePendingQueuePort extends RecordingQueuePort {
  async reconcilePendingReview(): Promise<never> {
    throw new Error("simulated concurrent terminal review transition");
  }
}

class SequencedReviewPort implements ReviewQueueStartupReviewPort {
  private index = 0;

  constructor(private readonly snapshots: ChangeSetReviewSnapshot[]) {}

  async load(): Promise<ChangeSetReviewSnapshot> {
    const snapshot = this.snapshots[Math.min(this.index, this.snapshots.length - 1)];
    this.index += 1;
    return cloneJson(snapshot);
  }
}

function createProposal(changeSetId = "changeset-1"): KnowledgeChangeSet {
  const afterContent = "# Durable review\n";
  return {
    id: changeSetId,
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes: [
      {
        id: `change-${changeSetId}`,
        path: `Wiki/${changeSetId}.md`,
        sourceRefs: [SOURCE_ID],
        reason: "Compile the durable source",
        operation: "create",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

function createReviewJobClaim(sourceContentHash = SOURCE_HASH) {
  return {
    jobId: JOB_ID,
    sourceId: SOURCE_ID,
    sourceContentHash,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 1,
    attempt: 1,
  };
}

function createManifestCommitPlan(
  proposal: KnowledgeChangeSet,
  jobClaim = createReviewJobClaim()
): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: proposal.bundleId,
    sourceId: jobClaim.sourceId,
    sourceContentHash: jobClaim.sourceContentHash,
    pipelineFingerprint: jobClaim.pipelineFingerprint,
    inputRevision: jobClaim.inputRevision,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: MANIFEST_HASH,
    baseGeneratedPages: [],
    mutations: proposal.changes.map((change) => ({
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: "create_only",
      ownership: "generated",
      wasTrackedByPrimarySource: false,
    })),
  };
}

function createPendingRecord(
  changeSetId: string,
  jobId: string,
  recordedAt: number
): PendingChangeSetReviewRecord {
  const proposal = createProposal(changeSetId);
  const jobClaim = { ...createReviewJobClaim(), jobId };
  const manifestCommitPlan = createManifestCommitPlan(proposal, jobClaim);
  return {
    changeSetId,
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim,
    recordedAt,
    outcome: "pending",
    recordRevision: 0,
  };
}

function createAcceptedRecord(
  pending: PendingChangeSetReviewRecord
): AcceptedChangeSetReviewRecord {
  const acceptedChangeSet: KnowledgeChangeSet = { ...pending.proposal, status: "accepted" };
  const manifestCommitIntent = projectManifestCommitIntent(
    pending.manifestCommitPlan,
    acceptedChangeSet
  );
  return {
    ...pending,
    outcome: "accepted",
    recordRevision: 1,
    acceptedChangeSet,
    acceptedDigest: createChangeSetTransactionDigest(acceptedChangeSet),
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    acceptedAt: pending.recordedAt + 1,
  };
}

function createInterruptedQueueSnapshot(): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: BUNDLE_ID,
    revision: 1,
    control: { status: "running" },
    jobs: [
      {
        id: JOB_ID,
        bundleId: BUNDLE_ID,
        sourceId: SOURCE_ID,
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 90,
        updatedAt: 100,
        status: "processing",
        stage: "generating",
        startedAt: 100,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId: SOURCE_ID,
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        inputRevision: 1,
        observedAt: 90,
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

interface StartupHarness {
  reviews: ChangeSetReviewRepository;
  queueStorage: MemoryQueueStorage;
  executor: ForbiddenExecutor;
  createQueue(): IngestQueue;
}

function createHarness(): StartupHarness {
  const queueStorage = new MemoryQueueStorage();
  queueStorage.seed(createInterruptedQueueSnapshot());
  const executor = new ForbiddenExecutor();
  return {
    reviews: new ChangeSetReviewRepository(new MemoryReviewStorage(), { clock: () => 110 }),
    queueStorage,
    executor,
    createQueue(): IngestQueue {
      return new IngestQueue(queueStorage, executor, { clock: () => 200 });
    },
  };
}

async function savePendingReview(
  reviews: ChangeSetReviewRepository,
  options: { sourceContentHash?: string } = {}
): Promise<Extract<ChangeSetReviewRecord, { outcome: "pending" }>> {
  const proposal = createProposal();
  const jobClaim = createReviewJobClaim(options.sourceContentHash);
  const manifestCommitPlan = createManifestCommitPlan(proposal, jobClaim);
  const record = await reviews.saveProposal(BUNDLE_ID, {
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim,
  });
  if (record.outcome !== "pending") {
    throw new Error("Test expected a pending review record");
  }
  return record;
}

describe("ReviewQueueStartupReconciler", () => {
  it("restores a pending Review Store hand-off without executing ingest work", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    const queue = harness.createQueue();
    const reconciler = new ReviewQueueStartupReconciler({ reviews: harness.reviews, queue });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toEqual({
      bundleId: BUNDLE_ID,
      reviewRevision: 1,
      actions: [
        {
          kind: "pending_reconciled",
          changeSetId: pending.changeSetId,
          jobId: JOB_ID,
        },
      ],
    });

    const snapshot = await queue.load(BUNDLE_ID);
    expect(snapshot.jobs).toEqual([
      expect.objectContaining({
        id: JOB_ID,
        status: "awaiting_review",
        stage: "review",
        changeSetId: pending.changeSetId,
      }),
    ]);
    expect(snapshot.pendingReviews).toEqual([
      {
        kind: "durable",
        jobId: JOB_ID,
        changeSetId: pending.changeSetId,
        proposalDigest: pending.proposalDigest,
        reviewRecordRevision: 0,
        recordedAt: pending.recordedAt,
      },
    ]);
    expect(harness.executor.calls).toBe(0);
  });

  it("replays the pending predecessor and exact rejection, then restarts as a no-op", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    const rejected = await harness.reviews.reject(
      BUNDLE_ID,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );
    const firstQueue = harness.createQueue();
    const first = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: firstQueue,
    });

    await expect(first.reconcile(BUNDLE_ID)).resolves.toEqual({
      bundleId: BUNDLE_ID,
      reviewRevision: 2,
      actions: [
        {
          kind: "rejection_reconciled",
          changeSetId: rejected.changeSetId,
          jobId: JOB_ID,
        },
      ],
    });
    const afterFirst = await firstQueue.load(BUNDLE_ID);
    expect(afterFirst.jobs).toEqual([
      expect.objectContaining({ id: JOB_ID, status: "cancelled", stage: "cancelled" }),
    ]);
    expect(afterFirst.pendingReviews).toEqual([]);
    expect(afterFirst.reviewRejections).toEqual([
      expect.objectContaining({
        jobId: JOB_ID,
        changeSetId: rejected.changeSetId,
        proposalDigest: rejected.proposalDigest,
        decisionAt: rejected.rejectedAt,
      }),
    ]);

    const reconstructedQueue = harness.createQueue();
    const reconstructed = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: reconstructedQueue,
    });
    await expect(reconstructed.reconcile(BUNDLE_ID)).resolves.toMatchObject({
      actions: [{ kind: "rejection_reconciled" }],
    });
    const afterRestart = await reconstructedQueue.load(BUNDLE_ID);
    expect(afterRestart.revision).toBe(afterFirst.revision);
    expect(afterRestart).toEqual(afterFirst);
    expect(harness.executor.calls).toBe(0);
  });

  it("classifies accepted review for a higher runtime coordinator without touching the queue", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    const acceptedChangeSet: KnowledgeChangeSet = { ...pending.proposal, status: "accepted" };
    const accepted = await harness.reviews.accept(
      BUNDLE_ID,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest,
      acceptedChangeSet
    );
    const forbiddenQueue: ReviewQueueStartupQueuePort = {
      async load(): Promise<never> {
        throw new Error("Accepted startup classification must not read queue apply state");
      },
      async reconcilePendingReview(): Promise<never> {
        throw new Error("Accepted startup classification must not restore a pending anchor");
      },
      async rejectReview(): Promise<never> {
        throw new Error("Accepted startup classification must not reject or apply");
      },
    };
    const reconciler = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: forbiddenQueue,
    });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toEqual({
      bundleId: BUNDLE_ID,
      reviewRevision: 2,
      actions: [
        {
          kind: "accepted_requires_runtime_classification",
          identity: {
            bundleId: BUNDLE_ID,
            changeSetId: accepted.changeSetId,
            proposalDigest: accepted.proposalDigest,
            recordRevision: accepted.recordRevision,
            recordedAt: accepted.recordedAt,
            acceptedDigest: accepted.acceptedDigest,
            manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
            acceptedAt: accepted.acceptedAt,
            jobClaim: accepted.jobClaim,
          },
        },
      ],
    });
    expect(harness.executor.calls).toBe(0);
  });

  it("retries when the Review Store advances and returns only the stable terminal revision", async () => {
    const pending = createPendingRecord("changeset-a", "job-a", 100);
    const accepted = createAcceptedRecord(pending);
    const revisionOne: ChangeSetReviewSnapshot = {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 1,
      records: [pending],
    };
    const revisionTwo: ChangeSetReviewSnapshot = {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 2,
      records: [accepted],
    };
    const reviews = new SequencedReviewPort([revisionOne, revisionTwo, revisionTwo, revisionTwo]);
    const queue = new RecordingQueuePort();
    const reconciler = new ReviewQueueStartupReconciler({ reviews, queue });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toMatchObject({
      reviewRevision: 2,
      actions: [
        {
          kind: "accepted_requires_runtime_classification",
          identity: { changeSetId: accepted.changeSetId },
        },
      ],
    });
    expect(queue.pendingChangeSetIds).toEqual([pending.changeSetId]);
  });

  it("retries a stale queue failure when Review concurrently becomes accepted", async () => {
    const pending = createPendingRecord("changeset-a", "job-a", 100);
    const accepted = createAcceptedRecord(pending);
    const revisionOne: ChangeSetReviewSnapshot = {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 1,
      records: [pending],
    };
    const revisionTwo: ChangeSetReviewSnapshot = {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 2,
      records: [accepted],
    };
    const reviews = new SequencedReviewPort([revisionOne, revisionTwo, revisionTwo, revisionTwo]);
    const reconciler = new ReviewQueueStartupReconciler({
      reviews,
      queue: new StalePendingQueuePort(),
    });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toMatchObject({
      reviewRevision: 2,
      actions: [
        {
          kind: "accepted_requires_runtime_classification",
          identity: { changeSetId: accepted.changeSetId },
        },
      ],
    });
  });

  it("sorts equal-time Review records by stable ChangeSet identity", async () => {
    const recordC = createPendingRecord("changeset-c", "job-c", 110);
    const recordB = createPendingRecord("changeset-b", "job-b", 100);
    const recordA = createPendingRecord("changeset-a", "job-a", 100);
    const snapshot: ChangeSetReviewSnapshot = {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 3,
      records: [recordC, recordB, recordA],
    };
    const reviews = new SequencedReviewPort([snapshot]);
    const queue = new RecordingQueuePort();
    const reconciler = new ReviewQueueStartupReconciler({ reviews, queue });

    const result = await reconciler.reconcile(BUNDLE_ID);
    expect(result.reviewRevision).toBe(3);
    expect(queue.pendingChangeSetIds).toEqual([
      recordA.changeSetId,
      recordB.changeSetId,
      recordC.changeSetId,
    ]);
    expect(result.actions.map((action) => action.kind)).toEqual([
      "pending_reconciled",
      "pending_reconciled",
      "pending_reconciled",
    ]);
  });

  it("fails closed after bounded Review Store churn", async () => {
    let revision = 0;
    const reviews: ReviewQueueStartupReviewPort = {
      async load(): Promise<ChangeSetReviewSnapshot> {
        revision += 1;
        return {
          version: 2,
          bundleId: BUNDLE_ID,
          revision,
          records: [],
        };
      },
    };
    const reconciler = new ReviewQueueStartupReconciler({
      reviews,
      queue: new RecordingQueuePort(),
      maxReviewPasses: 2,
    });

    await expect(reconciler.reconcile(BUNDLE_ID)).rejects.toMatchObject({
      name: ReviewQueueStartupUnstableError.name,
      bundleId: BUNDLE_ID,
      attempts: 2,
    });
  });

  it("converges two reconstructed runtimes on one pending review", async () => {
    const harness = createHarness();
    await savePendingReview(harness.reviews);
    const firstQueue = harness.createQueue();
    const secondQueue = harness.createQueue();
    const first = new ReviewQueueStartupReconciler({ reviews: harness.reviews, queue: firstQueue });
    const second = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: secondQueue,
    });

    await expect(
      Promise.all([first.reconcile(BUNDLE_ID), second.reconcile(BUNDLE_ID)])
    ).resolves.toHaveLength(2);
    const snapshot = await firstQueue.load(BUNDLE_ID);
    expect(snapshot.revision).toBe(2);
    expect(snapshot.pendingReviews).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({ status: "awaiting_review" });
  });

  it("proves an ambiguous pending commit by exact post-state", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    const queue = harness.createQueue();
    const ambiguousQueue = new CommitThenThrowQueuePort(queue, { pending: true });
    const reconciler = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: ambiguousQueue,
    });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toMatchObject({
      actions: [
        {
          kind: "pending_reconciled",
          changeSetId: pending.changeSetId,
        },
      ],
    });
    const snapshot = await queue.load(BUNDLE_ID);
    expect(snapshot.revision).toBe(2);
    expect(snapshot.jobs[0]).toMatchObject({ status: "awaiting_review" });
  });

  it("proves ambiguous pending and rejection commits before reporting convergence", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    const rejected = await harness.reviews.reject(
      BUNDLE_ID,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );
    const queue = harness.createQueue();
    const ambiguousQueue = new CommitThenThrowQueuePort(queue, {
      pending: true,
      rejection: true,
    });
    const reconciler = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: ambiguousQueue,
    });

    await expect(reconciler.reconcile(BUNDLE_ID)).resolves.toMatchObject({
      actions: [
        {
          kind: "rejection_reconciled",
          changeSetId: rejected.changeSetId,
        },
      ],
    });
    const snapshot = await queue.load(BUNDLE_ID);
    expect(snapshot.revision).toBe(3);
    expect(snapshot.jobs[0]).toMatchObject({ status: "cancelled" });
    expect(snapshot.reviewRejections).toHaveLength(1);
  });

  it("converges two reconstructed runtimes on one rejected review", async () => {
    const harness = createHarness();
    const pending = await savePendingReview(harness.reviews);
    await harness.reviews.reject(
      BUNDLE_ID,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );
    const firstQueue = harness.createQueue();
    const secondQueue = harness.createQueue();
    const first = new ReviewQueueStartupReconciler({ reviews: harness.reviews, queue: firstQueue });
    const second = new ReviewQueueStartupReconciler({
      reviews: harness.reviews,
      queue: secondQueue,
    });

    await expect(
      Promise.all([first.reconcile(BUNDLE_ID), second.reconcile(BUNDLE_ID)])
    ).resolves.toHaveLength(2);
    const snapshot = await firstQueue.load(BUNDLE_ID);
    expect(snapshot.revision).toBe(3);
    expect(snapshot.reviewRejections).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({ status: "cancelled" });
  });

  it("fails closed when a durable review belongs to different source bytes", async () => {
    const harness = createHarness();
    await savePendingReview(harness.reviews, { sourceContentHash: OTHER_SOURCE_HASH });
    const queue = harness.createQueue();
    const before = await queue.load(BUNDLE_ID);
    const reconciler = new ReviewQueueStartupReconciler({ reviews: harness.reviews, queue });

    await expect(reconciler.reconcile(BUNDLE_ID)).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );
    await expect(queue.load(BUNDLE_ID)).resolves.toEqual(before);
  });
});
