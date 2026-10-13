import type {
  IngestPendingReviewDecisionReceipt,
  IngestRejectedReviewDecisionReceipt,
} from "@/knowledge/ingest/queue/IngestQueue";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeIngestJob } from "@/knowledge/model/types";
import type {
  AcceptedChangeSetReviewRecord,
  ChangeSetReviewJobClaim,
  ChangeSetReviewRecord,
  ChangeSetReviewSnapshot,
  PendingChangeSetReviewRecord,
  RejectedChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";

const DEFAULT_MAX_REVIEW_PASSES = 3;

export interface ReviewQueueStartupReviewPort {
  load(bundleId: string): Promise<ChangeSetReviewSnapshot>;
}

export interface ReviewQueueStartupQueuePort {
  load(bundleId: string): Promise<IngestQueueSnapshot>;

  reconcilePendingReview(
    bundleId: string,
    reviewDecision: IngestPendingReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob>;

  rejectReview(
    bundleId: string,
    reviewDecision: IngestRejectedReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob>;
}

export interface AcceptedReviewStartupIdentity {
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  recordRevision: 1;
  recordedAt: number;
  acceptedDigest: string;
  manifestCommitIntentDigest: string;
  acceptedAt: number;
  jobClaim: ChangeSetReviewJobClaim;
}

export type ReviewQueueStartupAction =
  | {
      kind: "pending_reconciled";
      changeSetId: string;
      jobId: string;
    }
  | {
      kind: "rejection_reconciled";
      changeSetId: string;
      jobId: string;
    }
  | {
      kind: "accepted_requires_runtime_classification";
      identity: AcceptedReviewStartupIdentity;
    };

export interface ReviewQueueStartupReconciliationResult {
  bundleId: string;

  reviewRevision: number;
  actions: ReviewQueueStartupAction[];
}

export interface ReviewQueueStartupReconcilerDependencies {
  reviews: ReviewQueueStartupReviewPort;
  queue: ReviewQueueStartupQueuePort;
  maxReviewPasses?: number;
}

export class ReviewQueueStartupUnstableError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number
  ) {
    super(
      `Review startup state for '${bundleId}' changed during ${attempts} reconciliation passes`
    );
    this.name = "ReviewQueueStartupUnstableError";
  }
}

function cloneJobClaim(jobClaim: ChangeSetReviewJobClaim): ChangeSetReviewJobClaim {
  return { ...jobClaim };
}

function toPendingReceipt(
  bundleId: string,
  record: Pick<
    PendingChangeSetReviewRecord,
    "changeSetId" | "proposalDigest" | "recordedAt" | "jobClaim"
  >
): IngestPendingReviewDecisionReceipt {
  return {
    outcome: "pending",
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: 0,
    recordedAt: record.recordedAt,
    jobClaim: cloneJobClaim(record.jobClaim),
  };
}

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
    jobClaim: cloneJobClaim(record.jobClaim),
  };
}

function toAcceptedIdentity(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): AcceptedReviewStartupIdentity {
  return {
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    recordedAt: record.recordedAt,
    acceptedDigest: record.acceptedDigest,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: cloneJobClaim(record.jobClaim),
  };
}

function jobMatchesReviewClaim(
  job: KnowledgeIngestJob | undefined,
  claim: ChangeSetReviewJobClaim
): boolean {
  return (
    job !== undefined &&
    job.id === claim.jobId &&
    job.sourceId === claim.sourceId &&
    job.sourceContentHash === claim.sourceContentHash &&
    job.pipelineFingerprint === claim.pipelineFingerprint &&
    job.inputRevision === claim.inputRevision &&
    job.attempt === claim.attempt
  );
}

function hasExactPendingState(
  snapshot: IngestQueueSnapshot,
  record: Pick<
    PendingChangeSetReviewRecord,
    "changeSetId" | "proposalDigest" | "recordedAt" | "jobClaim" | "proposal"
  >
): boolean {
  const job = snapshot.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
  const pending = snapshot.pendingReviews.find(
    (candidate) => candidate.jobId === record.jobClaim.jobId
  );
  return (
    snapshot.bundleId === record.proposal.bundleId &&
    jobMatchesReviewClaim(job, record.jobClaim) &&
    job?.status === "awaiting_review" &&
    job.changeSetId === record.changeSetId &&
    pending?.kind === "durable" &&
    pending.changeSetId === record.changeSetId &&
    pending.proposalDigest === record.proposalDigest &&
    pending.reviewRecordRevision === 0 &&
    pending.recordedAt === record.recordedAt &&
    !snapshot.reviewRejections.some((candidate) => candidate.jobId === record.jobClaim.jobId) &&
    snapshot.applyClaim?.jobId !== record.jobClaim.jobId
  );
}

function hasExactRejectedState(
  snapshot: IngestQueueSnapshot,
  record: RejectedChangeSetReviewRecord
): boolean {
  const job = snapshot.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
  const rejection = snapshot.reviewRejections.find(
    (candidate) => candidate.jobId === record.jobClaim.jobId
  );
  return (
    snapshot.bundleId === record.proposal.bundleId &&
    jobMatchesReviewClaim(job, record.jobClaim) &&
    job?.status === "cancelled" &&
    rejection !== undefined &&
    rejection.changeSetId === record.changeSetId &&
    rejection.proposalDigest === record.proposalDigest &&
    rejection.reviewRecordRevision === record.recordRevision &&
    rejection.decisionAt === record.rejectedAt &&
    rejection.rejectedAt === job.cancelledAt &&
    !snapshot.pendingReviews.some((candidate) => candidate.jobId === record.jobClaim.jobId)
  );
}

function compareReviewRecords(left: ChangeSetReviewRecord, right: ChangeSetReviewRecord): number {
  const timestampOrder = left.recordedAt - right.recordedAt;
  if (timestampOrder !== 0) {
    return timestampOrder;
  }
  return left.changeSetId < right.changeSetId ? -1 : left.changeSetId > right.changeSetId ? 1 : 0;
}

export class ReviewQueueStartupReconciler {
  private readonly reviews: ReviewQueueStartupReviewPort;
  private readonly queue: ReviewQueueStartupQueuePort;
  private readonly maxReviewPasses: number;

  constructor(dependencies: ReviewQueueStartupReconcilerDependencies) {
    this.reviews = dependencies.reviews;
    this.queue = dependencies.queue;
    this.maxReviewPasses = dependencies.maxReviewPasses ?? DEFAULT_MAX_REVIEW_PASSES;
    if (!Number.isSafeInteger(this.maxReviewPasses) || this.maxReviewPasses < 1) {
      throw new TypeError("maxReviewPasses must be a positive safe integer");
    }
  }

  async reconcile(bundleId: string): Promise<ReviewQueueStartupReconciliationResult> {
    for (let pass = 0; pass < this.maxReviewPasses; pass += 1) {
      const snapshot = await this.loadReviewSnapshot(bundleId);
      let actions: ReviewQueueStartupAction[];
      try {
        actions = await this.reconcileSnapshot(bundleId, snapshot);
      } catch (error) {
        const confirmedAfterFailure = await this.loadReviewSnapshot(bundleId);
        if (confirmedAfterFailure.revision !== snapshot.revision) {
          continue;
        }
        throw error;
      }
      const confirmed = await this.loadReviewSnapshot(bundleId);
      if (confirmed.revision === snapshot.revision) {
        return { bundleId, reviewRevision: snapshot.revision, actions };
      }
    }
    throw new ReviewQueueStartupUnstableError(bundleId, this.maxReviewPasses);
  }

  private async reconcileSnapshot(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot
  ): Promise<ReviewQueueStartupAction[]> {
    const actions: ReviewQueueStartupAction[] = [];
    const records = [...snapshot.records].sort(compareReviewRecords);
    for (const record of records) {
      if (record.outcome === "accepted") {
        actions.push({
          kind: "accepted_requires_runtime_classification",
          identity: toAcceptedIdentity(bundleId, record),
        });
        continue;
      }
      if (record.outcome === "pending") {
        await this.reconcilePendingRecord(bundleId, record, false);
        actions.push({
          kind: "pending_reconciled",
          changeSetId: record.changeSetId,
          jobId: record.jobClaim.jobId,
        });
        continue;
      }

      await this.reconcileRejectedRecord(bundleId, record);
      actions.push({
        kind: "rejection_reconciled",
        changeSetId: record.changeSetId,
        jobId: record.jobClaim.jobId,
      });
    }
    return actions;
  }

  private async loadReviewSnapshot(bundleId: string): Promise<ChangeSetReviewSnapshot> {
    const snapshot = await this.reviews.load(bundleId);
    if (snapshot.bundleId !== bundleId) {
      throw new TypeError("Review startup snapshot must belong to the requested Bundle");
    }
    return snapshot;
  }

  private async reconcileRejectedRecord(
    bundleId: string,
    record: RejectedChangeSetReviewRecord
  ): Promise<void> {
    let queueSnapshot = await this.queue.load(bundleId);
    if (!hasExactRejectedState(queueSnapshot, record)) {
      await this.reconcilePendingRecord(bundleId, record, true);
    }
    try {
      await this.queue.rejectReview(bundleId, toRejectedReceipt(bundleId, record));
    } catch (error) {
      queueSnapshot = await this.queue.load(bundleId);
      if (!hasExactRejectedState(queueSnapshot, record)) {
        throw error;
      }
    }
  }

  private async reconcilePendingRecord(
    bundleId: string,
    record: PendingChangeSetReviewRecord | RejectedChangeSetReviewRecord,
    allowRejectedFinal: boolean
  ): Promise<void> {
    try {
      await this.queue.reconcilePendingReview(bundleId, toPendingReceipt(bundleId, record));
    } catch (error) {
      const queueSnapshot = await this.queue.load(bundleId);
      if (
        !hasExactPendingState(queueSnapshot, record) &&
        !(
          allowRejectedFinal &&
          record.outcome === "rejected" &&
          hasExactRejectedState(queueSnapshot, record)
        )
      ) {
        throw error;
      }
    }
  }
}
