import type {
  IngestQueueSnapshot,
  IngestRerunRequest,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeIngestJob } from "@/knowledge/model/types";
import type {
  ChangeSetReviewJobClaim,
  ChangeSetReviewSnapshot,
  PendingChangeSetReviewRecord,
  RejectedChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Content-free command that can express only whole-proposal rejection. */
export interface KnowledgeLiteralRejectCommand {
  changeSetId: string;
  proposalDigest: string;
  expectedSnapshotToken: string;
  decisions: readonly Readonly<{ changeId: string; decision: "reject" }>[];
}

/** Stable reasons why a reject command is structurally unsafe. */
export type KnowledgeLiteralRejectCommandErrorReason =
  | "command_invalid"
  | "decision_invalid"
  | "decision_duplicate";

/** Reports a malformed or non-literal Reject command without retaining input values. */
export class KnowledgeLiteralRejectCommandError extends Error {
  /** Creates one sanitized strict-command rejection. */
  constructor(public readonly reason: KnowledgeLiteralRejectCommandErrorReason) {
    super("The Knowledge Review command is not a strict whole-proposal rejection");
    this.name = "KnowledgeLiteralRejectCommandError";
  }
}

/** Stable fail-closed reasons produced by the durable Reject state machine. */
export type KnowledgeReviewRejectConflictReason =
  | "bundle_mismatch"
  | "record_missing"
  | "proposal_mismatch"
  | "decision_set_mismatch"
  | "review_already_accepted"
  | "queue_anchor_mismatch"
  | "rejected_final_mismatch"
  | "revision_overflow"
  | "timestamp_invalid";

/** Reports a Queue/Review identity conflict without exposing durable payloads. */
export class KnowledgeReviewRejectConflictError extends Error {
  /** Creates one sanitized durable-state rejection. */
  constructor(public readonly reason: KnowledgeReviewRejectConflictReason) {
    super("The durable Knowledge Review rejection state does not match the requested proposal");
    this.name = "KnowledgeReviewRejectConflictError";
  }
}

/** Durable identity returned after one atomic Reject transition or exact replay. */
export interface KnowledgeReviewRejectTransitionReceipt {
  outcome: "rejected";
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  recordRevision: 1;
  rejectedAt: number;
  cancelledAt: number;
  jobClaim: ChangeSetReviewJobClaim;
  queueRevision: number;
  reviewRevision: number;
}

/** Pure projection returned to the shared Runtime envelope. */
export type KnowledgeReviewRejectProjection =
  | {
      kind: "changed";
      queue: IngestQueueSnapshot;
      review: ChangeSetReviewSnapshot;
      receipt: KnowledgeReviewRejectTransitionReceipt;
    }
  | {
      kind: "already_rejected";
      receipt: KnowledgeReviewRejectTransitionReceipt;
    };

/** Inputs required to project one exact Queue+Review rejection. */
export interface KnowledgeReviewRejectProjectionInput {
  bundleId: string;
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;
  command: unknown;
  decidedAt: number;
}

/** Reads an exact plain record without invoking accessors. */
function readExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== expectedKeys.length ||
      !expectedKeys.every((key) => keys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Snapshots a dense array without accepting holes, accessors, or named properties. */
function snapshotDenseArray(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.enumerable
    ) {
      return undefined;
    }
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== length + 1 ||
      !keys.includes("length")
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Requires one non-empty identity string. */
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Strictly snapshots a command whose every file decision is literally Reject.
 *
 * `expectedSnapshotToken` remains a UI anti-mistake token. The durable mutation
 * authority is re-proved from Queue and Review in the atomic projection.
 */
export function parseKnowledgeLiteralRejectCommand(value: unknown): KnowledgeLiteralRejectCommand {
  const command = readExactDataRecord(value, [
    "changeSetId",
    "proposalDigest",
    "expectedSnapshotToken",
    "decisions",
  ]);
  const decisions = snapshotDenseArray(command?.decisions);
  if (
    !command ||
    !isIdentifier(command.changeSetId) ||
    typeof command.proposalDigest !== "string" ||
    !SHA256_PATTERN.test(command.proposalDigest) ||
    typeof command.expectedSnapshotToken !== "string" ||
    !SHA256_PATTERN.test(command.expectedSnapshotToken) ||
    !decisions ||
    decisions.length === 0
  ) {
    throw new KnowledgeLiteralRejectCommandError("command_invalid");
  }

  const seen = new Set<string>();
  const captured = decisions.map((value) => {
    const decision = readExactDataRecord(value, ["changeId", "decision"]);
    if (!decision || !isIdentifier(decision.changeId) || decision.decision !== "reject") {
      throw new KnowledgeLiteralRejectCommandError("decision_invalid");
    }
    if (seen.has(decision.changeId)) {
      throw new KnowledgeLiteralRejectCommandError("decision_duplicate");
    }
    seen.add(decision.changeId);
    return Object.freeze({ changeId: decision.changeId, decision: "reject" as const });
  });
  Object.freeze(captured);
  return Object.freeze({
    changeSetId: command.changeSetId,
    proposalDigest: command.proposalDigest,
    expectedSnapshotToken: command.expectedSnapshotToken,
    decisions: captured,
  });
}

/** Reports whether a Queue job belongs to one exact Review attempt. */
function jobMatchesClaim(
  job: KnowledgeIngestJob | undefined,
  claim: ChangeSetReviewJobClaim
): job is KnowledgeIngestJob {
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

/** Requires the command to reject every proposal change exactly once. */
function assertExactDecisionSet(
  record: PendingChangeSetReviewRecord | RejectedChangeSetReviewRecord,
  command: KnowledgeLiteralRejectCommand
): void {
  const expected = new Set(record.proposal.changes.map((change) => change.id));
  if (
    expected.size !== record.proposal.changes.length ||
    expected.size !== command.decisions.length ||
    !command.decisions.every((decision) => expected.has(decision.changeId))
  ) {
    throw new KnowledgeReviewRejectConflictError("decision_set_mismatch");
  }
}

/** Returns whether a Queue job still consumes scheduling capacity. */
function isActiveJob(job: KnowledgeIngestJob): boolean {
  return job.status !== "failed" && job.status !== "completed" && job.status !== "cancelled";
}

/** Converts one retained rerun request into its pending successor job. */
function createJobFromRerun(
  bundleId: string,
  rerun: IngestRerunRequest,
  timestamp: number
): KnowledgeIngestJob {
  return {
    id: rerun.jobId,
    bundleId,
    sourceId: rerun.sourceId,
    sourceContentHash: rerun.sourceContentHash,
    pipelineFingerprint: rerun.pipelineFingerprint,
    inputRevision: rerun.inputRevision,
    attempt: 0,
    rerunRequested: false,
    createdAt: rerun.requestedAt,
    updatedAt: Math.max(timestamp, rerun.updatedAt),
    status: "pending",
    stage: "queued",
  };
}

/** Promotes at most one retained latest rerun after its predecessor is terminal. */
function promoteRerun(
  snapshot: IngestQueueSnapshot,
  sourceId: string,
  timestamp: number
): IngestQueueSnapshot {
  const rerun = snapshot.reruns.find((candidate) => candidate.sourceId === sourceId);
  const activeSuccessor = snapshot.jobs.some(
    (job) => job.sourceId === sourceId && isActiveJob(job)
  );
  if (!rerun || activeSuccessor) return snapshot;
  return {
    ...snapshot,
    jobs: [...snapshot.jobs, createJobFromRerun(snapshot.bundleId, rerun, timestamp)],
    reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== sourceId),
  };
}

/** Builds the detached durable receipt represented by an exact final state. */
function createReceipt(
  queue: IngestQueueSnapshot,
  review: ChangeSetReviewSnapshot,
  record: RejectedChangeSetReviewRecord,
  job: Extract<KnowledgeIngestJob, { status: "cancelled" }>
): KnowledgeReviewRejectTransitionReceipt {
  return {
    outcome: "rejected",
    bundleId: review.bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: 1,
    rejectedAt: record.rejectedAt,
    cancelledAt: job.cancelledAt,
    jobClaim: { ...record.jobClaim },
    queueRevision: queue.revision,
    reviewRevision: review.revision,
  };
}

/**
 * Proves and projects the only legal whole-proposal Reject transition.
 *
 * The function is synchronous and side-effect free so Runtime can execute it
 * inside one atomic envelope transform. Exact terminal replay is byte-preserving.
 */
export function projectKnowledgeReviewRejection(
  input: KnowledgeReviewRejectProjectionInput
): KnowledgeReviewRejectProjection {
  const command = parseKnowledgeLiteralRejectCommand(input.command);
  if (
    !isIdentifier(input.bundleId) ||
    input.queue.bundleId !== input.bundleId ||
    input.review.bundleId !== input.bundleId
  ) {
    throw new KnowledgeReviewRejectConflictError("bundle_mismatch");
  }
  if (!Number.isSafeInteger(input.decidedAt) || input.decidedAt < 0) {
    throw new KnowledgeReviewRejectConflictError("timestamp_invalid");
  }

  const records = input.review.records.filter(
    (candidate) => candidate.changeSetId === command.changeSetId
  );
  if (records.length !== 1) {
    throw new KnowledgeReviewRejectConflictError("record_missing");
  }
  const record = records[0];
  if (record.proposalDigest !== command.proposalDigest) {
    throw new KnowledgeReviewRejectConflictError("proposal_mismatch");
  }
  if (record.outcome === "accepted") {
    throw new KnowledgeReviewRejectConflictError("review_already_accepted");
  }
  assertExactDecisionSet(record, command);

  const job = input.queue.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
  if (record.outcome === "rejected") {
    const rejection = input.queue.reviewRejections.filter(
      (candidate) =>
        candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
    );
    const pendingConflict = input.queue.pendingReviews.some(
      (candidate) =>
        candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
    );
    if (
      !jobMatchesClaim(job, record.jobClaim) ||
      job.status !== "cancelled" ||
      job.stage !== "cancelled" ||
      job.rerunRequested ||
      job.updatedAt !== job.cancelledAt ||
      rejection.length !== 1 ||
      rejection[0].jobId !== record.jobClaim.jobId ||
      rejection[0].changeSetId !== record.changeSetId ||
      rejection[0].proposalDigest !== record.proposalDigest ||
      rejection[0].reviewRecordRevision !== record.recordRevision ||
      rejection[0].decisionAt !== record.rejectedAt ||
      rejection[0].rejectedAt !== job.cancelledAt ||
      pendingConflict ||
      input.queue.applyClaim?.jobId === record.jobClaim.jobId ||
      input.queue.applyClaim?.reviewedChangeSet?.changeSetId === record.changeSetId ||
      input.queue.applyCommit?.jobId === record.jobClaim.jobId ||
      input.queue.applyCommit?.changeSetId === record.changeSetId ||
      input.queue.applyAbandonments.some(
        (candidate) =>
          candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
      )
    ) {
      throw new KnowledgeReviewRejectConflictError("rejected_final_mismatch");
    }
    return {
      kind: "already_rejected",
      receipt: createReceipt(input.queue, input.review, record, job),
    };
  }

  const anchor = input.queue.pendingReviews.find(
    (candidate) => candidate.jobId === record.jobClaim.jobId
  );
  const hasRejectionConflict = input.queue.reviewRejections.some(
    (candidate) =>
      candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
  );
  if (
    !jobMatchesClaim(job, record.jobClaim) ||
    job.status !== "awaiting_review" ||
    job.stage !== "review" ||
    job.changeSetId !== record.changeSetId ||
    anchor?.kind !== "durable" ||
    anchor.changeSetId !== record.changeSetId ||
    anchor.proposalDigest !== record.proposalDigest ||
    anchor.reviewRecordRevision !== record.recordRevision ||
    anchor.recordedAt !== record.recordedAt ||
    hasRejectionConflict ||
    input.queue.applyClaim?.jobId === record.jobClaim.jobId ||
    input.queue.applyClaim?.reviewedChangeSet?.changeSetId === record.changeSetId ||
    input.queue.applyCommit?.jobId === record.jobClaim.jobId ||
    input.queue.applyCommit?.changeSetId === record.changeSetId ||
    input.queue.applyAbandonments.some(
      (candidate) =>
        candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
    )
  ) {
    throw new KnowledgeReviewRejectConflictError("queue_anchor_mismatch");
  }
  if (
    input.queue.revision >= Number.MAX_SAFE_INTEGER ||
    input.review.revision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new KnowledgeReviewRejectConflictError("revision_overflow");
  }

  const rejectedAt = Math.max(input.decidedAt, record.recordedAt);
  const cancelledAt = Math.max(rejectedAt, job.updatedAt);
  const rejectedRecord: RejectedChangeSetReviewRecord = {
    ...record,
    recordRevision: 1,
    outcome: "rejected",
    rejectedAt,
  };
  const cancelledJob: Extract<KnowledgeIngestJob, { status: "cancelled" }> = {
    id: job.id,
    bundleId: job.bundleId,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    rerunRequested: false,
    createdAt: job.createdAt,
    updatedAt: cancelledAt,
    status: "cancelled",
    stage: "cancelled",
    cancelledAt,
  };
  const review: ChangeSetReviewSnapshot = {
    ...input.review,
    revision: input.review.revision + 1,
    records: input.review.records.map((candidate) =>
      candidate.changeSetId === record.changeSetId ? rejectedRecord : candidate
    ),
  };
  const rejectedQueue: IngestQueueSnapshot = {
    ...input.queue,
    revision: input.queue.revision + 1,
    jobs: input.queue.jobs.map((candidate) =>
      candidate.id === cancelledJob.id ? cancelledJob : candidate
    ),
    pendingReviews: input.queue.pendingReviews.filter(
      (candidate) => candidate.jobId !== cancelledJob.id
    ),
    reviewRejections: [
      ...input.queue.reviewRejections,
      {
        jobId: cancelledJob.id,
        changeSetId: record.changeSetId,
        proposalDigest: record.proposalDigest,
        reviewRecordRevision: 1,
        decisionAt: rejectedAt,
        rejectedAt: cancelledAt,
      },
    ],
  };
  const queue = promoteRerun(rejectedQueue, cancelledJob.sourceId, cancelledAt);
  return {
    kind: "changed",
    queue,
    review,
    receipt: createReceipt(queue, review, rejectedRecord, cancelledJob),
  };
}
