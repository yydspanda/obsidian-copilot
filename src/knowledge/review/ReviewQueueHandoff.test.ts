import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitPlanDigest,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  IngestQueue,
  type IngestAcceptedReviewDecisionReceipt,
  type IngestExecutionContext,
  type IngestExecutionResult,
  type IngestExecutor,
  type IngestPendingReviewDecisionReceipt,
  type IngestRejectedReviewDecisionReceipt,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet } from "@/knowledge/model/types";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  ReviewStorageRevisionConflictError,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  type PendingChangeSetReviewRecord,
  type RejectedChangeSetReviewRecord,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const MANIFEST_HASH = "c".repeat(64);

/**
 * Clones JSON-compatible durable state for adapter-isolation assertions.
 *
 * @param value - JSON-compatible value
 * @returns Detached clone
 */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory atomic Review Store used only by cross-module protocol tests. */
class MemoryReviewStorage implements ReviewStorage {
  private readonly values = new Map<string, ChangeSetReviewSnapshot>();

  /** {@inheritDoc ReviewStorage.read} */
  async read(bundleId: string): Promise<unknown> {
    const value = this.values.get(bundleId);
    return value ? cloneJson(value) : null;
  }

  /** {@inheritDoc ReviewStorage.write} */
  async write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const current = this.values.get(bundleId);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    this.values.set(bundleId, cloneJson(snapshot));
  }
}

/** In-memory atomic Queue Store used only by cross-module protocol tests. */
class MemoryQueueStorage implements QueueStorage {
  private readonly values = new Map<string, IngestQueueSnapshot>();

  /** {@inheritDoc QueueStorage.read} */
  async read(bundleId: string): Promise<unknown> {
    const value = this.values.get(bundleId);
    return value ? cloneJson(value) : null;
  }

  /** {@inheritDoc QueueStorage.write} */
  async write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const current = this.values.get(bundleId);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    const parsed = parseIngestQueueSnapshot(snapshot);
    if (!parsed.ok) {
      throw new Error("Test queue snapshot must satisfy its strict schema");
    }
    this.values.set(bundleId, cloneJson(parsed.value));
  }
}

/**
 * Creates the deterministic proposal persisted by the integrated executor.
 *
 * @param context - Exact claimed queue attempt
 * @returns Valid proposed ChangeSet
 */
function createProposal(context: IngestExecutionContext): KnowledgeChangeSet {
  const content = `# ${context.job.sourceId}\n`;
  return {
    id: `changeset-${context.job.id}`,
    bundleId: context.job.bundleId,
    operation: "ingest",
    sourceRefs: [context.job.sourceId],
    changes: [
      {
        id: `change-${context.job.id}`,
        path: `Wiki/${context.job.sourceId}.md`,
        sourceRefs: [context.job.sourceId],
        reason: "Compile the durable test source",
        operation: "create",
        expectedAbsent: true,
        afterContent: content,
        afterHash: createFileContentHash(content),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates the strict Manifest plan owned by one integrated compiler proposal. */
function createManifestCommitPlan(
  context: IngestExecutionContext,
  proposal: KnowledgeChangeSet
): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: proposal.bundleId,
    sourceId: context.job.sourceId,
    sourceContentHash: context.job.sourceContentHash,
    pipelineFingerprint: context.job.pipelineFingerprint,
    inputRevision: context.job.inputRevision,
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

/**
 * Converts a real pending Review Store record into the queue hand-off receipt.
 *
 * @param bundleId - Owning Bundle
 * @param record - Durable pending record
 * @returns Pending queue receipt
 */
function toPendingReceipt(
  bundleId: string,
  record: PendingChangeSetReviewRecord
): IngestPendingReviewDecisionReceipt {
  return {
    outcome: "pending",
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    recordedAt: record.recordedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/**
 * Converts a real accepted Review Store record into the queue hand-off receipt.
 *
 * @param bundleId - Owning Bundle
 * @param record - Durable accepted record
 * @returns Accepted queue receipt
 */
function toAcceptedReceipt(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): IngestAcceptedReviewDecisionReceipt {
  return {
    outcome: "accepted",
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    acceptedDigest: record.acceptedDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/**
 * Converts a real rejected Review Store record into the queue hand-off receipt.
 *
 * @param bundleId - Owning Bundle
 * @param record - Durable rejected record
 * @returns Rejected queue receipt
 */
function toRejectedReceipt(
  bundleId: string,
  record: RejectedChangeSetReviewRecord
): IngestRejectedReviewDecisionReceipt {
  return {
    outcome: "rejected",
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    rejectedAt: record.rejectedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/** Executor that persists a proposal before returning an awaiting-review result. */
class ReviewPersistingExecutor implements IngestExecutor {
  /** Creates an executor over the real review repository. */
  constructor(private readonly reviews: ChangeSetReviewRepository) {}

  /** {@inheritDoc IngestExecutor.execute} */
  async execute(context: IngestExecutionContext): Promise<IngestExecutionResult> {
    const proposal = createProposal(context);
    const manifestCommitPlan = createManifestCommitPlan(context, proposal);
    const record = await this.reviews.saveProposal(context.job.bundleId, {
      proposal,
      proposalDigest: createChangeSetTransactionDigest(proposal),
      manifestCommitPlan,
      manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
      jobClaim: {
        jobId: context.job.id,
        sourceId: context.job.sourceId,
        sourceContentHash: context.job.sourceContentHash,
        pipelineFingerprint: context.job.pipelineFingerprint,
        inputRevision: context.job.inputRevision,
        attempt: context.job.attempt,
      },
    });
    if (record.outcome !== "pending") {
      throw new Error("Integrated executor expected one pending review record");
    }
    return {
      kind: "awaiting_review",
      changeSetId: proposal.id,
      reviewDecision: toPendingReceipt(context.job.bundleId, record),
    };
  }
}

interface ReviewQueueHarness {
  queue: IngestQueue;
  reviews: ChangeSetReviewRepository;
  setQueueNow(value: number): void;
  setReviewNow(value: number): void;
}

/** Creates real queue/repository cores over isolated atomic memory adapters. */
function createHarness(): ReviewQueueHarness {
  let queueNow = 100;
  let reviewNow = 110;
  const reviews = new ChangeSetReviewRepository(new MemoryReviewStorage(), {
    clock: () => reviewNow,
  });
  const queue = new IngestQueue(new MemoryQueueStorage(), new ReviewPersistingExecutor(reviews), {
    clock: () => queueNow,
    jobIdFactory: () => "job-1",
  });
  return {
    queue,
    reviews,
    setQueueNow(value: number): void {
      queueNow = value;
    },
    setReviewNow(value: number): void {
      reviewNow = value;
    },
  };
}

/** Loads and narrows one required durable review record for the test. */
async function requireRecord(
  reviews: ChangeSetReviewRepository,
  changeSetId: string
): Promise<ChangeSetReviewRecord> {
  const record = await reviews.get("personal", changeSetId);
  if (!record) {
    throw new Error("Expected integrated review record");
  }
  return record;
}

describe("Review Store to ingest queue hand-off", () => {
  it("anchors a real pending record before accepting its exact terminal record", async () => {
    const harness = createHarness();
    await harness.queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_HASH,
      inputRevision: 1,
    });
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "awaiting_review",
    });
    const pending = await requireRecord(harness.reviews, "changeset-job-1");
    expect(pending.outcome).toBe("pending");
    if (pending.outcome !== "pending") {
      throw new Error("Expected pending review record");
    }

    harness.setReviewNow(120);
    const acceptedChangeSet: KnowledgeChangeSet = { ...pending.proposal, status: "accepted" };
    const accepted = await harness.reviews.accept(
      "personal",
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest,
      acceptedChangeSet
    );
    harness.setQueueNow(130);
    await expect(
      harness.queue.beginReviewApply("personal", toAcceptedReceipt("personal", accepted))
    ).resolves.toMatchObject({ status: "processing", stage: "applying", startedAt: 130 });

    const queue = await harness.queue.load("personal");
    expect(queue.pendingReviews).toEqual([]);
    expect(queue.applyClaim).toMatchObject({
      reviewedChangeSet: {
        changeSetId: accepted.changeSetId,
        changeSetDigest: accepted.acceptedDigest,
      },
      acceptedReview: {
        proposalDigest: accepted.proposalDigest,
        recordRevision: 1,
        acceptedAt: 120,
      },
    });
  });

  it("anchors a real pending record before rejecting without an apply claim", async () => {
    const harness = createHarness();
    await harness.queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_HASH,
      inputRevision: 1,
    });
    await harness.queue.runNext("personal");
    const pending = await requireRecord(harness.reviews, "changeset-job-1");
    if (pending.outcome !== "pending") {
      throw new Error("Expected pending review record");
    }

    harness.setReviewNow(120);
    const rejected = await harness.reviews.reject(
      "personal",
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );
    harness.setQueueNow(130);
    await expect(
      harness.queue.rejectReview("personal", toRejectedReceipt("personal", rejected))
    ).resolves.toMatchObject({ status: "cancelled", cancelledAt: 130 });

    const queue = await harness.queue.load("personal");
    expect(queue.pendingReviews).toEqual([]);
    expect(queue.applyClaim).toBeUndefined();
    expect(queue.reviewRejections).toEqual([
      expect.objectContaining({
        jobId: "job-1",
        changeSetId: rejected.changeSetId,
        proposalDigest: rejected.proposalDigest,
        reviewRecordRevision: 1,
        decisionAt: 120,
      }),
    ]);
  });
});
