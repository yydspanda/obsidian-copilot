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

/** Read-only Review Store operations required during startup reconciliation. */
export interface ReviewQueueStartupReviewPort {
  /** Loads one detached durable review snapshot. */
  load(bundleId: string): Promise<ChangeSetReviewSnapshot>;
}

/** Queue operations permitted during startup review reconciliation. */
export interface ReviewQueueStartupQueuePort {
  /** Loads one detached durable queue snapshot. */
  load(bundleId: string): Promise<IngestQueueSnapshot>;

  /** Restores the exact awaiting-review anchor for one durable pending record. */
  reconcilePendingReview(
    bundleId: string,
    reviewDecision: IngestPendingReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob>;

  /** Applies one already-durable rejected review decision without touching Wiki files. */
  rejectReview(
    bundleId: string,
    reviewDecision: IngestRejectedReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob>;
}

/** Identity-only accepted review that still requires an exact durable reload before action. */
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

/** One deterministic startup classification or queue reconciliation result. */
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

/** Complete result of one Bundle's fail-closed review startup pass. */
export interface ReviewQueueStartupReconciliationResult {
  bundleId: string;
  /** Stable Review Store revision that a higher-level startup gate must revalidate. */
  reviewRevision: number;
  actions: ReviewQueueStartupAction[];
}

/** Constructor dependencies for review-only startup reconciliation. */
export interface ReviewQueueStartupReconcilerDependencies {
  reviews: ReviewQueueStartupReviewPort;
  queue: ReviewQueueStartupQueuePort;
  maxReviewPasses?: number;
}

/** Reports Review Store churn that prevented one stable startup classification. */
export class ReviewQueueStartupUnstableError extends Error {
  /** Creates a bounded-retry exhaustion error for one Bundle. */
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

/** Converts one durable review job claim into a detached queue receipt claim. */
function cloneJobClaim(jobClaim: ChangeSetReviewJobClaim): ChangeSetReviewJobClaim {
  return { ...jobClaim };
}

/** Creates the queue receipt represented by one durable pending review record. */
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

/** Creates the queue receipt represented by one durable rejected review record. */
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

/** Creates a non-mutating classification identity from one accepted record. */
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

/** Compares a queue job with the exact durable Review Store claim. */
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

/** Detects the exact pending-review queue state represented by one durable record. */
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

/**
 * Detects an exact queue rejection already converged by this or another runtime.
 *
 * The queue's rejection timestamp may be later than the Review Store decision,
 * so identity uses the immutable decision timestamp and the queue-owned applied
 * timestamp only to prove the terminal job and tombstone agree with each other.
 */
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

/** Sorts review records independently of storage insertion order. */
function compareReviewRecords(left: ChangeSetReviewRecord, right: ChangeSetReviewRecord): number {
  const timestampOrder = left.recordedAt - right.recordedAt;
  if (timestampOrder !== 0) {
    return timestampOrder;
  }
  return left.changeSetId < right.changeSetId ? -1 : left.changeSetId > right.changeSetId ? 1 : 0;
}

/**
 * Reconciles Review Store hand-off gaps without running a model or writing Wiki files.
 *
 * Pending records restore their exact queue anchor. Rejected records first
 * restore that anchor when needed and then replay the exact durable rejection.
 * Accepted records are read-only recovery candidates: startup never begins an
 * apply automatically because no-journal recovery still requires an explicit
 * user continue or abandon decision. A higher-level runtime coordinator must
 * still classify historical completed, active, and no-journal apply states.
 */
export class ReviewQueueStartupReconciler {
  private readonly reviews: ReviewQueueStartupReviewPort;
  private readonly queue: ReviewQueueStartupQueuePort;
  private readonly maxReviewPasses: number;

  /** Creates a review-only startup coordinator over durable ports. */
  constructor(dependencies: ReviewQueueStartupReconcilerDependencies) {
    this.reviews = dependencies.reviews;
    this.queue = dependencies.queue;
    this.maxReviewPasses = dependencies.maxReviewPasses ?? DEFAULT_MAX_REVIEW_PASSES;
    if (!Number.isSafeInteger(this.maxReviewPasses) || this.maxReviewPasses < 1) {
      throw new TypeError("maxReviewPasses must be a positive safe integer");
    }
  }

  /**
   * Reconciles every durable review record for one Bundle in stable order.
   *
   * @param bundleId - Bundle whose Review Store and queue must converge
   * The returned Review revision is an optimistic token, not a readiness lock;
   * the higher-level startup gate must revalidate it before enabling claims.
   *
   * @returns Deterministic actions and identity-only accepted classifications
   */
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

  /** Reconciles one observed Review Store revision in deterministic record order. */
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

  /** Loads one Bundle-matching Review Store snapshot for revision comparison. */
  private async loadReviewSnapshot(bundleId: string): Promise<ChangeSetReviewSnapshot> {
    const snapshot = await this.reviews.load(bundleId);
    if (snapshot.bundleId !== bundleId) {
      throw new TypeError("Review startup snapshot must belong to the requested Bundle");
    }
    return snapshot;
  }

  /**
   * Restores a rejected record's pending predecessor unless exact final state exists.
   *
   * A second runtime may win between the initial read and reconciliation. When
   * that happens, only an exact final-state recheck converts the rejected
   * transition error into convergence; every conflicting state still fails.
   */
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

  /**
   * Replays one pending hand-off and proves ambiguous adapter failures by re-reading state.
   *
   * @param bundleId - Bundle whose queue owns the pending anchor
   * @param record - Pending base fields retained by pending and terminal records
   * @param allowRejectedFinal - Whether an exact concurrent rejection also proves convergence
   */
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
