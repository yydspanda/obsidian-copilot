import { Mutex } from "async-mutex";

import type { TransactionCommitReceipt } from "@/knowledge/changeset/ChangeSetTransaction";
import type {
  KnowledgeDiagnostic,
  KnowledgeFailure,
  KnowledgeIngestJob,
} from "@/knowledge/model/types";
import type { KnowledgeIngestWorkStage } from "@/knowledge/model/types";
import {
  ExponentialRetryPolicy,
  type RetryDecision,
  type RetryPolicy,
} from "@/knowledge/ingest/queue/RetryPolicy";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestApplyClaimMarker,
  type IngestApplyCommitMarker,
  type IngestAcceptedReviewIdentity,
  type IngestDurablePendingReview,
  type IngestQueuePauseReason,
  type IngestQueueSnapshot,
  type IngestReviewedChangeSetIdentity,
  type IngestRerunRequest,
  type IngestSourceHighWatermark,
  type QueueWriteAuthority,
  type QueueStorage,
  validateIngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";

const DEFAULT_MAX_WRITE_ATTEMPTS = 3;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FAILURE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;
const SENSITIVE_FAILURE_PATTERN =
  /(?:\bbearer\s+[a-z0-9._~-]{8,}|\bsk-[a-z0-9_-]{8,}|(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+)/i;
const WORK_STAGE_ORDER: readonly KnowledgeIngestWorkStage[] = [
  "parsing",
  "analyzing",
  "associating",
  "generating",
  "validating",
  "applying",
];

type ProcessingIngestJob = Extract<KnowledgeIngestJob, { status: "processing" }>;
type ExecutedJobStatus = Extract<RunNextResult, { kind: "executed" }>["status"];

/** Input required to enqueue one exact source and pipeline version. */
export interface EnqueueIngestRequest {
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  /** Durable, per-source monotonic revision allocated before enqueue. */
  inputRevision: number;
  /** Opaque Runtime capability required by the production Queue adapter. */
  observationToken?: string;
}

/** Observable result of durable source-level enqueue deduplication. */
export interface EnqueueIngestResult {
  kind: "enqueued" | "deduplicated" | "updated" | "rerun_scheduled";
  job: KnowledgeIngestJob;
}

/** Exact queue attempt retained by a durable terminal review record. */
export interface IngestReviewDecisionJobClaim {
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
}

/** Durable pending-record receipt required before a queue may await review. */
export interface IngestPendingReviewDecisionReceipt {
  outcome: "pending";
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  recordRevision: 0;
  recordedAt: number;
  jobClaim: IngestReviewDecisionJobClaim;
}

/** Durable accepted-record receipt required before review apply may begin. */
export interface IngestAcceptedReviewDecisionReceipt {
  outcome: "accepted";
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  recordRevision: 1;
  acceptedDigest: string;
  manifestCommitIntentDigest: string;
  acceptedAt: number;
  jobClaim: IngestReviewDecisionJobClaim;
}

/** Durable rejected-record receipt required before a review job may be cancelled. */
export interface IngestRejectedReviewDecisionReceipt {
  outcome: "rejected";
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  recordRevision: 1;
  rejectedAt: number;
  jobClaim: IngestReviewDecisionJobClaim;
}

/** Successful executor outcome that waits for review, changes nothing, or commits pages. */
export type IngestExecutionResult =
  | {
      kind: "awaiting_review";
      changeSetId: string;
      reviewDecision: IngestPendingReviewDecisionReceipt;
    }
  /** Terminal compile outcome that intentionally produced no file mutation. */
  | { kind: "no_changes"; changeSetId: string }
  | {
      kind: "completed";
      changeSetId: string;
      /** Durable apply proof retained until manifest/queue/journal reconciliation finishes. */
      commitReceipt: TransactionCommitReceipt;
    };

/** Context passed to a provider-neutral ingest executor. */
export interface IngestExecutionContext {
  job: Readonly<ProcessingIngestJob>;
  signal: AbortSignal;
  reportStage(stage: KnowledgeIngestWorkStage): Promise<void>;
}

/** Provider-neutral port that performs one already-claimed ingest job. */
export interface IngestExecutor {
  /**
   * Executes one job and cooperatively observes cancellation.
   *
   * @param context - Claimed job, abort signal, and durable stage reporter
   * @returns Review or committed completion outcome
   */
  execute(context: IngestExecutionContext): Promise<IngestExecutionResult>;
}

/** Serializable failure details deliberately supplied by an executor adapter. */
export interface IngestExecutorFailureDetails {
  code: string;
  message: string;
  retryable: boolean;
  rateLimited: boolean;
  retryAfterMs?: number;
}

/** Typed executor failure safe for retry classification and persistence. */
export class IngestExecutorError extends Error {
  /**
   * Creates a structured executor failure.
   *
   * @param details - Serializable failure and rate-limit metadata
   */
  constructor(public readonly details: IngestExecutorFailureDetails) {
    super(details.message);
    this.name = "IngestExecutorError";
  }
}

/** Cause attached to a post-commit queue notification. */
export type IngestQueueEventCause =
  | "enqueue"
  | "deduplicate"
  | "source_update"
  | "rerun_scheduled"
  | "claim"
  | "stage"
  | "retry"
  | "rate_limit"
  | "failure"
  | "awaiting_review"
  | "review_accepted"
  | "review_rejected"
  | "complete"
  | "pause"
  | "resume"
  | "cancel"
  | "recover"
  | "apply_commit_pending"
  | "apply_commit_finalized";

/** Best-effort notification emitted only after durable state is known. */
export interface IngestQueueEvent {
  type: "queue_changed";
  cause: IngestQueueEventCause;
  bundleId: string;
  revision: number;
  jobId?: string;
}

/** Non-authoritative notification port for future UI and activity surfaces. */
export interface EventSink {
  /**
   * Observes a committed queue mutation without owning queue state.
   *
   * @param event - Post-commit reload hint
   */
  emit(event: IngestQueueEvent): void | Promise<void>;
}

/** Queue construction dependencies with deterministic test seams. */
export interface IngestQueueOptions {
  clock?: () => number;
  jobIdFactory?: () => string;
  retryPolicy?: RetryPolicy;
  eventSink?: EventSink;
  maxWriteAttempts?: number;
}

/** Result returned when the queue attempts to execute one eligible job. */
export type RunNextResult =
  | { kind: "idle" }
  | { kind: "paused"; reason: IngestQueuePauseReason }
  | { kind: "waiting"; nextAttemptAt: number }
  | { kind: "busy"; jobId: string }
  | { kind: "stale"; jobId: string }
  | { kind: "commit_ready"; jobId: string; receipt: TransactionCommitReceipt }
  | {
      kind: "executed";
      jobId: string;
      status: "pending" | "paused" | "awaiting_review" | "failed" | "completed" | "cancelled";
    };

/** Reports persisted queue JSON that cannot satisfy the current contract. */
export class IngestQueueValidationError extends Error {
  /**
   * Creates a queue validation failure without retaining raw persisted data.
   *
   * @param bundleId - Bundle whose queue failed validation
   * @param diagnostics - Stable structural or semantic issues
   */
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`Ingest queue '${bundleId}' does not satisfy the current contract`);
    this.name = "IngestQueueValidationError";
  }
}

/** Reports a persisted queue version that this runtime cannot safely read. */
export class IngestQueueIncompatibleVersionError extends Error {
  /**
   * Creates an incompatible queue version failure.
   *
   * @param bundleId - Bundle whose queue uses an unsupported version
   * @param version - Unknown persisted version value
   */
  constructor(
    public readonly bundleId: string,
    public readonly version: unknown
  ) {
    super(`Ingest queue '${bundleId}' uses an unsupported version`);
    this.name = "IngestQueueIncompatibleVersionError";
  }
}

/** Reports a storage key whose queue claims to belong to another Bundle. */
export class IngestQueueBundleMismatchError extends Error {
  /**
   * Creates a Bundle identity mismatch.
   *
   * @param requestedBundleId - Bundle used to read storage
   * @param storedBundleId - Bundle declared by persisted queue state
   */
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`Ingest queue stored for '${requestedBundleId}' belongs to '${storedBundleId}'`);
    this.name = "IngestQueueBundleMismatchError";
  }
}

/** Reports a terminal review receipt loaded from another Bundle. */
export class IngestQueueReviewBundleMismatchError extends Error {
  /**
   * Creates a review-to-queue Bundle mismatch.
   *
   * @param requestedBundleId - Queue Bundle receiving the decision
   * @param reviewBundleId - Bundle that owns the durable Review Store record
   */
  constructor(
    public readonly requestedBundleId: string,
    public readonly reviewBundleId: string
  ) {
    super(`Review decision for '${reviewBundleId}' cannot mutate queue '${requestedBundleId}'`);
    this.name = "IngestQueueReviewBundleMismatchError";
  }
}

/** Reports a queue revision that cannot advance without precision loss. */
export class IngestQueueRevisionOverflowError extends Error {
  /**
   * Creates a safe-integer revision overflow failure.
   *
   * @param bundleId - Bundle whose revision reached the safe integer limit
   * @param revision - Last safely represented revision
   */
  constructor(
    public readonly bundleId: string,
    public readonly revision: number
  ) {
    super(`Ingest queue '${bundleId}' cannot advance beyond revision ${revision}`);
    this.name = "IngestQueueRevisionOverflowError";
  }
}

/** Reports optimistic write conflicts that exceeded bounded retries. */
export class IngestQueueWriteConflictExhaustedError extends Error {
  /**
   * Creates an exhausted queue write conflict.
   *
   * @param bundleId - Bundle whose queue could not converge
   * @param attempts - Attempted read-transform-write cycles
   * @param conflict - Last observed storage conflict
   */
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: IngestQueueRevisionConflictError
  ) {
    super(`Ingest queue '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "IngestQueueWriteConflictExhaustedError";
  }
}

/** Reports an operation targeting an unknown durable job id. */
export class IngestQueueJobNotFoundError extends Error {
  /**
   * Creates a missing queue job failure.
   *
   * @param bundleId - Bundle expected to contain the job
   * @param jobId - Missing job identifier
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Job '${jobId}' is not present in Bundle queue '${bundleId}'`);
    this.name = "IngestQueueJobNotFoundError";
  }
}

/** Reports a fail-closed illegal queue state transition. */
export class IngestQueueTransitionError extends Error {
  /**
   * Creates an illegal state transition failure.
   *
   * @param jobId - Durable job identifier
   * @param from - Current persisted status and stage
   * @param action - Rejected operation
   */
  constructor(
    public readonly jobId: string,
    public readonly from: string,
    public readonly action: string
  ) {
    super(`Job '${jobId}' cannot ${action} from '${from}'`);
    this.name = "IngestQueueTransitionError";
  }
}

/** Reports a non-empty id factory collision with persisted queue history. */
export class IngestQueueJobIdConflictError extends Error {
  /**
   * Creates a generated job id collision.
   *
   * @param bundleId - Bundle containing the conflicting id
   * @param jobId - Generated duplicate id
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Generated job id '${jobId}' already exists in Bundle queue '${bundleId}'`);
    this.name = "IngestQueueJobIdConflictError";
  }
}

/** Reports distinct source inputs that claim the same monotonic input revision. */
export class IngestQueueObservationConflictError extends Error {
  /**
   * Creates an unordered same-time source observation conflict.
   *
   * @param bundleId - Bundle containing the source
   * @param sourceId - Stable source identifier
   * @param inputRevision - Source revision shared by different exact inputs
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly inputRevision: number
  ) {
    super(`Source '${sourceId}' has conflicting queue inputs at revision ${inputRevision}`);
    this.name = "IngestQueueObservationConflictError";
  }
}

/** Reports a queue blocked on a future recoverable apply transaction. */
export class IngestQueueRecoveryRequiredError extends Error {
  /**
   * Creates a recovery-required queue gate failure.
   *
   * @param bundleId - Bundle whose interrupted apply is not safe to resume
   */
  constructor(public readonly bundleId: string) {
    super(`Bundle queue '${bundleId}' requires apply transaction recovery before resume`);
    this.name = "IngestQueueRecoveryRequiredError";
  }
}

/** Reports an attempt to bypass the shared-runtime startup release authority. */
export class IngestQueueStartupReleaseRequiredError extends Error {
  /**
   * Creates a startup conditional-release gate failure.
   *
   * @param bundleId - Bundle whose startup pause requires atomic Runtime release
   */
  constructor(public readonly bundleId: string) {
    super(`Bundle queue '${bundleId}' requires atomic startup release before resume`);
    this.name = "IngestQueueStartupReleaseRequiredError";
  }
}

/** Reports an apply receipt that cannot own the selected durable queue job. */
export class IngestQueueApplyCommitConflictError extends Error {
  /**
   * Creates an apply-commit correlation failure.
   *
   * @param bundleId - Bundle whose receipt cannot be reconciled
   * @param jobId - Job claimed by the receipt
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Committed apply receipt for job '${jobId}' does not match queue '${bundleId}'`);
    this.name = "IngestQueueApplyCommitConflictError";
  }
}

/** Reports a queue still waiting for its committed journal to be acknowledged. */
export class IngestQueueApplyCommitPendingError extends Error {
  /**
   * Creates a commit-pending execution gate failure.
   *
   * @param bundleId - Bundle whose journal acknowledgement is incomplete
   */
  constructor(public readonly bundleId: string) {
    super(`Bundle queue '${bundleId}' is waiting for apply journal acknowledgement`);
    this.name = "IngestQueueApplyCommitPendingError";
  }
}

/** Reports an applying execution that did not provide durable transaction proof. */
export class IngestQueueApplyReceiptRequiredError extends Error {
  /**
   * Creates a missing or misplaced apply-receipt protocol failure.
   *
   * @param bundleId - Bundle whose applying claim cannot be completed safely
   * @param jobId - Exact queue job at the applying boundary
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Applying job '${jobId}' in Bundle queue '${bundleId}' requires exact commit proof`);
    this.name = "IngestQueueApplyReceiptRequiredError";
  }
}

/** Reports queue persistence failures separately from executor failures. */
export class IngestQueueInfrastructureError extends Error {
  /**
   * Creates an infrastructure boundary failure that must not be persisted as a provider error.
   *
   * @param operation - Queue infrastructure operation that failed
   * @param cause - Original storage, validation, or concurrency error
   */
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    super(`Ingest queue infrastructure failed during ${operation}`);
    this.name = "IngestQueueInfrastructureError";
  }
}

interface LoadedQueue {
  snapshot: IngestQueueSnapshot;
  expectedRevision: number | null;
}

interface QueueMutation<T> {
  next?: IngestQueueSnapshot;
  value: T;
}

interface MutationResult<T> {
  snapshot: IngestQueueSnapshot;
  value: T;
}

interface ClaimedJobResult {
  kind: "claimed" | "idle" | "paused" | "waiting" | "busy";
  jobId?: string;
  reason?: IngestQueuePauseReason;
  nextAttemptAt?: number;
}

interface EnqueueMutationValue {
  kind: EnqueueIngestResult["kind"];
  jobId: string;
}

interface PauseMutationValue {
  changed: boolean;
  pausedJobId?: string;
}

interface FailureMutationValue {
  changed: boolean;
  cause: IngestQueueEventCause;
}

type SuccessMutationValue = "changed" | "stale" | "commit_ready";

interface ActiveController {
  jobId: string;
  attempt: number;
  startedAt: number;
  controller: AbortController;
}

/**
 * Checks whether an unknown value is a non-null record.
 *
 * @param value - Runtime value to inspect
 * @returns Whether fields can be read safely
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a job remains eligible for source-level deduplication.
 *
 * @param job - Durable queue job
 * @returns Whether the job is non-terminal
 */
function isActiveJob(job: KnowledgeIngestJob): boolean {
  return !["failed", "completed", "cancelled"].includes(job.status);
}

/**
 * Returns a stable status/stage label for transition errors.
 *
 * @param job - Durable queue job
 * @returns Combined state label
 */
function jobState(job: KnowledgeIngestJob): string {
  return `${job.status}/${job.stage}`;
}

/**
 * Checks whether processing state still belongs to one exact claimed execution.
 *
 * Attempt is incremented on every durable claim, so it prevents a late result
 * from an aborted predecessor from finalizing a subsequently resumed attempt.
 *
 * @param job - Current durable job state
 * @param attempt - Completed-execution count captured at claim time
 * @param startedAt - Start timestamp captured at claim time
 * @returns Whether the current processing state is the same claim
 */
function isSameClaim(
  job: KnowledgeIngestJob,
  attempt: number,
  startedAt: number
): job is ProcessingIngestJob {
  return job.status === "processing" && job.attempt === attempt && job.startedAt === startedAt;
}

/**
 * Finds a durable job or throws a typed not-found error.
 *
 * @param snapshot - Current validated queue snapshot
 * @param jobId - Stable job identifier
 * @returns Matching durable job
 */
function requireJob(snapshot: IngestQueueSnapshot, jobId: string): KnowledgeIngestJob {
  const job = snapshot.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    throw new IngestQueueJobNotFoundError(snapshot.bundleId, jobId);
  }
  return job;
}

/**
 * Replaces one durable job without mutating the parsed snapshot.
 *
 * @param snapshot - Current validated queue snapshot
 * @param nextJob - Complete replacement job
 * @returns Immutable queue proposal
 */
function replaceJob(
  snapshot: IngestQueueSnapshot,
  nextJob: KnowledgeIngestJob
): IngestQueueSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => (job.id === nextJob.id ? nextJob : job)),
  };
}

/**
 * Creates an empty, unpersisted Bundle queue.
 *
 * @param bundleId - Stable Bundle identifier
 * @returns Revision-zero running queue
 */
function createEmptyQueue(bundleId: string): IngestQueueSnapshot {
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

/**
 * Checks whether a job matches one exact source and pipeline input.
 *
 * @param job - Durable queue job
 * @param request - Requested source input
 * @returns Whether both behavior-defining hashes match
 */
function jobMatchesRequest(job: KnowledgeIngestJob, request: EnqueueIngestRequest): boolean {
  return (
    job.sourceContentHash === request.sourceContentHash &&
    job.pipelineFingerprint === request.pipelineFingerprint
  );
}

/**
 * Checks whether a rerun payload matches one exact source and pipeline input.
 *
 * @param rerun - Durable latest rerun request
 * @param request - Requested source input
 * @returns Whether both behavior-defining hashes match
 */
function rerunMatchesRequest(rerun: IngestRerunRequest, request: EnqueueIngestRequest): boolean {
  return (
    rerun.sourceContentHash === request.sourceContentHash &&
    rerun.pipelineFingerprint === request.pipelineFingerprint
  );
}

/**
 * Checks whether a source high-watermark represents the requested compile input.
 *
 * @param highWatermark - Latest durable observation for one source
 * @param request - Candidate source observation
 * @returns Whether content and pipeline identity are unchanged
 */
function highWatermarkMatchesRequest(
  highWatermark: IngestSourceHighWatermark,
  request: EnqueueIngestRequest
): boolean {
  return (
    highWatermark.sourceContentHash === request.sourceContentHash &&
    highWatermark.pipelineFingerprint === request.pipelineFingerprint
  );
}

/**
 * Records one strictly newer source observation outside any claimed job identity.
 *
 * @param snapshot - Current validated queue state
 * @param request - New highest source observation
 * @param timestamp - Validated observation time
 * @returns Snapshot containing the replaced or appended high-watermark
 */
function recordSourceHighWatermark(
  snapshot: IngestQueueSnapshot,
  request: EnqueueIngestRequest,
  timestamp: number
): IngestQueueSnapshot {
  const current = snapshot.sourceHighWatermarks.find(
    (candidate) => candidate.sourceId === request.sourceId
  );
  const next: IngestSourceHighWatermark = {
    sourceId: request.sourceId,
    sourceContentHash: request.sourceContentHash,
    pipelineFingerprint: request.pipelineFingerprint,
    inputRevision: request.inputRevision,
    observedAt: Math.max(timestamp, current?.observedAt ?? 0),
  };
  return {
    ...snapshot,
    sourceHighWatermarks: current
      ? snapshot.sourceHighWatermarks.map((candidate) =>
          candidate.sourceId === request.sourceId ? next : candidate
        )
      : [...snapshot.sourceHighWatermarks, next],
  };
}

/**
 * Finds the newest retained job for a source high-watermark result.
 *
 * @param snapshot - Current validated queue state
 * @param sourceId - Source whose observation was deduplicated
 * @returns Newest retained job for the source
 */
function requireLatestSourceJob(
  snapshot: IngestQueueSnapshot,
  sourceId: string
): KnowledgeIngestJob {
  const job = snapshot.jobs
    .filter((candidate) => candidate.sourceId === sourceId)
    .sort(
      (left, right) =>
        right.inputRevision - left.inputRevision ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id)
    )[0];
  if (!job) {
    throw new IngestQueueValidationError(snapshot.bundleId, [
      {
        code: "queue_source_high_watermark_orphaned",
        severity: "error",
        field: "sourceHighWatermarks",
        message: "A source high-watermark has no retained queue history",
      },
    ]);
  }
  return job;
}

/**
 * Converts a reserved rerun payload into one new pending job.
 *
 * @param bundleId - Containing Bundle identity
 * @param rerun - Latest durable rerun input
 * @param timestamp - Non-regressing promotion timestamp
 * @returns Pending job with a fresh attempt budget
 */
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

/**
 * Promotes a latest rerun payload after its predecessor becomes terminal.
 *
 * @param snapshot - Snapshot already containing the terminal predecessor
 * @param sourceId - Source whose rerun may be promoted
 * @param timestamp - Non-regressing promotion timestamp
 * @returns Queue with zero or one newly pending rerun job
 */
function promoteRerun(
  snapshot: IngestQueueSnapshot,
  sourceId: string,
  timestamp: number
): IngestQueueSnapshot {
  const rerun = snapshot.reruns.find((candidate) => candidate.sourceId === sourceId);
  const existingSuccessor = snapshot.jobs.some(
    (job) => job.sourceId === sourceId && isActiveJob(job)
  );
  if (!rerun || existingSuccessor) {
    return snapshot;
  }
  return {
    ...snapshot,
    jobs: [...snapshot.jobs, createJobFromRerun(snapshot.bundleId, rerun, timestamp)],
    reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== sourceId),
  };
}

/**
 * Requires a non-whitespace identifier at the queue boundary.
 *
 * @param value - Identifier supplied by orchestration
 * @param field - Field name used by the thrown error
 */
function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

/**
 * Requires a lowercase SHA-256 value at the queue boundary.
 *
 * @param value - Hash supplied by orchestration
 * @param field - Field name used by the thrown error
 */
function assertHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`);
  }
}

/**
 * Snapshots and validates the queue claim carried by a durable review decision.
 *
 * @param value - Unknown claim supplied by the review orchestration boundary
 * @returns Detached exact queue-attempt identity
 */
function snapshotReviewDecisionJobClaim(value: unknown): IngestReviewDecisionJobClaim {
  if (!isRecord(value)) {
    throw new TypeError("reviewDecision.jobClaim must be an object");
  }
  assertIdentifier(value.jobId, "reviewDecision.jobClaim.jobId");
  assertIdentifier(value.sourceId, "reviewDecision.jobClaim.sourceId");
  assertHash(value.sourceContentHash, "reviewDecision.jobClaim.sourceContentHash");
  assertHash(value.pipelineFingerprint, "reviewDecision.jobClaim.pipelineFingerprint");
  if (!Number.isSafeInteger(value.inputRevision) || (value.inputRevision as number) < 0) {
    throw new TypeError("reviewDecision.jobClaim.inputRevision must be non-negative");
  }
  if (!Number.isSafeInteger(value.attempt) || (value.attempt as number) <= 0) {
    throw new TypeError("reviewDecision.jobClaim.attempt must be positive");
  }
  return Object.freeze({
    jobId: value.jobId,
    sourceId: value.sourceId,
    sourceContentHash: value.sourceContentHash,
    pipelineFingerprint: value.pipelineFingerprint,
    inputRevision: value.inputRevision as number,
    attempt: value.attempt as number,
  });
}

/**
 * Snapshots the pending fields proven by a strict durable Review Store record.
 *
 * @param value - Runtime receipt supplied by the ingest executor
 * @returns Detached pending decision identity
 */
function snapshotPendingReviewDecision(value: unknown): IngestPendingReviewDecisionReceipt {
  if (!isRecord(value) || value.outcome !== "pending") {
    throw new TypeError("reviewDecision must be a durable pending record");
  }
  assertIdentifier(value.bundleId, "reviewDecision.bundleId");
  assertIdentifier(value.changeSetId, "reviewDecision.changeSetId");
  assertHash(value.proposalDigest, "reviewDecision.proposalDigest");
  if (value.recordRevision !== 0) {
    throw new TypeError("reviewDecision.recordRevision must be zero while pending");
  }
  if (!Number.isSafeInteger(value.recordedAt) || (value.recordedAt as number) < 0) {
    throw new TypeError("reviewDecision.recordedAt must be non-negative");
  }
  return Object.freeze({
    outcome: "pending",
    bundleId: value.bundleId,
    changeSetId: value.changeSetId,
    proposalDigest: value.proposalDigest,
    recordRevision: 0,
    recordedAt: value.recordedAt as number,
    jobClaim: snapshotReviewDecisionJobClaim(value.jobClaim),
  });
}

/**
 * Snapshots the accepted fields proven by a strict durable Review Store record.
 *
 * @param value - Runtime receipt supplied by review orchestration
 * @returns Detached accepted decision identity
 */
function snapshotAcceptedReviewDecision(value: unknown): IngestAcceptedReviewDecisionReceipt {
  if (!isRecord(value) || value.outcome !== "accepted") {
    throw new TypeError("reviewDecision must be a durable accepted record");
  }
  assertIdentifier(value.bundleId, "reviewDecision.bundleId");
  assertIdentifier(value.changeSetId, "reviewDecision.changeSetId");
  assertHash(value.proposalDigest, "reviewDecision.proposalDigest");
  assertHash(value.acceptedDigest, "reviewDecision.acceptedDigest");
  assertHash(value.manifestCommitIntentDigest, "reviewDecision.manifestCommitIntentDigest");
  if (value.recordRevision !== 1) {
    throw new TypeError("reviewDecision.recordRevision must be one for a terminal record");
  }
  if (!Number.isSafeInteger(value.acceptedAt) || (value.acceptedAt as number) < 0) {
    throw new TypeError("reviewDecision.acceptedAt must be non-negative");
  }
  return Object.freeze({
    outcome: "accepted",
    bundleId: value.bundleId,
    changeSetId: value.changeSetId,
    proposalDigest: value.proposalDigest,
    recordRevision: 1,
    acceptedDigest: value.acceptedDigest,
    manifestCommitIntentDigest: value.manifestCommitIntentDigest,
    acceptedAt: value.acceptedAt as number,
    jobClaim: snapshotReviewDecisionJobClaim(value.jobClaim),
  });
}

/**
 * Snapshots the rejected fields proven by a strict durable Review Store record.
 *
 * @param value - Runtime receipt supplied by review orchestration
 * @returns Detached rejected decision identity
 */
function snapshotRejectedReviewDecision(value: unknown): IngestRejectedReviewDecisionReceipt {
  if (!isRecord(value) || value.outcome !== "rejected") {
    throw new TypeError("reviewDecision must be a durable rejected record");
  }
  assertIdentifier(value.bundleId, "reviewDecision.bundleId");
  assertIdentifier(value.changeSetId, "reviewDecision.changeSetId");
  assertHash(value.proposalDigest, "reviewDecision.proposalDigest");
  if (value.recordRevision !== 1) {
    throw new TypeError("reviewDecision.recordRevision must be one for a terminal record");
  }
  if (!Number.isSafeInteger(value.rejectedAt) || (value.rejectedAt as number) < 0) {
    throw new TypeError("reviewDecision.rejectedAt must be non-negative");
  }
  return Object.freeze({
    outcome: "rejected",
    bundleId: value.bundleId,
    changeSetId: value.changeSetId,
    proposalDigest: value.proposalDigest,
    recordRevision: 1,
    rejectedAt: value.rejectedAt as number,
    jobClaim: snapshotReviewDecisionJobClaim(value.jobClaim),
  });
}

/**
 * Checks whether a durable job is owned by one exact Review Store claim.
 *
 * @param job - Current queue job
 * @param claim - Review decision's queue-attempt identity
 * @returns Whether every immutable job field matches
 */
function jobMatchesReviewDecisionClaim(
  job: KnowledgeIngestJob,
  claim: IngestReviewDecisionJobClaim
): boolean {
  return (
    job.id === claim.jobId &&
    job.sourceId === claim.sourceId &&
    job.sourceContentHash === claim.sourceContentHash &&
    job.pipelineFingerprint === claim.pipelineFingerprint &&
    job.inputRevision === claim.inputRevision &&
    job.attempt === claim.attempt
  );
}

/**
 * Validates the receipt fields needed for durable queue reconciliation.
 *
 * @param value - Runtime receipt returned by the ChangeSet transaction layer
 */
function assertTransactionCommitReceipt(value: unknown): asserts value is TransactionCommitReceipt {
  const jobClaim = isRecord(value) && isRecord(value.jobClaim) ? value.jobClaim : null;
  if (
    !isRecord(value) ||
    typeof value.transactionId !== "string" ||
    typeof value.bundleId !== "string" ||
    typeof value.changeSetId !== "string" ||
    typeof value.changeSetDigest !== "string" ||
    !Number.isSafeInteger(value.commitRevision) ||
    (value.commitRevision as number) < 0 ||
    !Number.isSafeInteger(value.committedAt) ||
    (value.committedAt as number) < 0 ||
    jobClaim === null ||
    typeof jobClaim.jobId !== "string" ||
    typeof jobClaim.sourceId !== "string" ||
    typeof jobClaim.sourceContentHash !== "string" ||
    typeof jobClaim.pipelineFingerprint !== "string" ||
    !Number.isSafeInteger(jobClaim.inputRevision) ||
    (jobClaim.inputRevision as number) < 0 ||
    !Number.isSafeInteger(jobClaim.attempt) ||
    (jobClaim.attempt as number) <= 0 ||
    !Number.isSafeInteger(jobClaim.startedAt) ||
    (jobClaim.startedAt as number) < 0 ||
    !Array.isArray(value.targets) ||
    value.targets.some(
      (target) =>
        !isRecord(target) ||
        typeof target.path !== "string" ||
        target.path.trim().length === 0 ||
        (target.kind !== "missing" &&
          (target.kind !== "file" ||
            typeof target.contentHash !== "string" ||
            !HASH_PATTERN.test(target.contentHash)))
    )
  ) {
    throw new TypeError("transaction commit receipt does not satisfy the queue contract");
  }
  assertIdentifier(value.transactionId, "receipt.transactionId");
  assertIdentifier(value.bundleId, "receipt.bundleId");
  assertIdentifier(value.changeSetId, "receipt.changeSetId");
  assertIdentifier(jobClaim.jobId, "receipt.jobClaim.jobId");
  assertIdentifier(jobClaim.sourceId, "receipt.jobClaim.sourceId");
  assertHash(jobClaim.sourceContentHash, "receipt.jobClaim.sourceContentHash");
  assertHash(jobClaim.pipelineFingerprint, "receipt.jobClaim.pipelineFingerprint");
  assertHash(value.changeSetDigest, "receipt.changeSetDigest");
  const startedAt = jobClaim.startedAt as number;
  const committedAt = value.committedAt as number;
  if (startedAt > committedAt) {
    throw new TypeError("receipt committedAt cannot precede its owning job claim");
  }
}

/**
 * Extracts the queue-owned durable marker from a committed transaction receipt.
 *
 * @param receipt - Strictly validated transaction commit receipt
 * @returns Marker retained until the journal slot is durably cleared
 */
function createApplyCommitMarker(receipt: TransactionCommitReceipt): IngestApplyCommitMarker {
  return {
    transactionId: receipt.transactionId,
    changeSetId: receipt.changeSetId,
    changeSetDigest: receipt.changeSetDigest,
    commitRevision: receipt.commitRevision,
    jobId: receipt.jobClaim.jobId,
    sourceId: receipt.jobClaim.sourceId,
    sourceContentHash: receipt.jobClaim.sourceContentHash,
    pipelineFingerprint: receipt.jobClaim.pipelineFingerprint,
    inputRevision: receipt.jobClaim.inputRevision,
    attempt: receipt.jobClaim.attempt,
    startedAt: receipt.jobClaim.startedAt,
    committedAt: receipt.committedAt,
  };
}

/**
 * Compares all queue-persisted receipt correlation fields.
 *
 * @param left - Existing durable apply marker
 * @param right - Candidate marker derived from a receipt
 * @returns Whether both markers identify one exact commit
 */
function sameApplyCommitMarker(
  left: IngestApplyCommitMarker,
  right: IngestApplyCommitMarker
): boolean {
  return (
    left.transactionId === right.transactionId &&
    left.changeSetId === right.changeSetId &&
    left.changeSetDigest === right.changeSetDigest &&
    left.commitRevision === right.commitRevision &&
    left.jobId === right.jobId &&
    left.sourceId === right.sourceId &&
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.inputRevision === right.inputRevision &&
    left.attempt === right.attempt &&
    left.startedAt === right.startedAt &&
    left.committedAt === right.committedAt
  );
}

/**
 * Captures the exact applying claim when work crosses the durable write boundary.
 *
 * @param job - Durable processing job at the applying boundary
 * @param reviewedChangeSet - Optional exact reviewed payload that this claim may apply
 * @returns Claim marker retained until coordinated commit completion
 */
function createApplyClaimMarker(
  job: ProcessingIngestJob,
  reviewedChangeSet?: IngestReviewedChangeSetIdentity,
  acceptedReview?: IngestAcceptedReviewIdentity
): IngestApplyClaimMarker {
  return {
    jobId: job.id,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    startedAt: job.startedAt,
    ...(reviewedChangeSet === undefined ? {} : { reviewedChangeSet: { ...reviewedChangeSet } }),
    ...(acceptedReview === undefined ? {} : { acceptedReview: { ...acceptedReview } }),
  };
}

/**
 * Checks one queue job against every immutable field in a committed apply marker.
 *
 * @param job - Durable queue job
 * @param marker - Marker derived from transaction commit proof
 * @returns Whether the transaction belongs to the exact queue input and attempt
 */
function jobMatchesApplyMarker(job: KnowledgeIngestJob, marker: IngestApplyCommitMarker): boolean {
  return (
    job.id === marker.jobId &&
    job.sourceId === marker.sourceId &&
    job.sourceContentHash === marker.sourceContentHash &&
    job.pipelineFingerprint === marker.pipelineFingerprint &&
    job.inputRevision === marker.inputRevision &&
    job.attempt === marker.attempt
  );
}

/**
 * Compares a retained applying claim with one committed transaction marker.
 *
 * @param claim - Exact claim captured at the applying boundary
 * @param committed - Exact claim carried by the committed transaction
 * @returns Whether both claims identify the same applying execution
 */
function applyClaimMatchesCommit(
  claim: IngestApplyClaimMarker,
  committed: IngestApplyCommitMarker
): boolean {
  return (
    claim.jobId === committed.jobId &&
    claim.sourceId === committed.sourceId &&
    claim.sourceContentHash === committed.sourceContentHash &&
    claim.pipelineFingerprint === committed.pipelineFingerprint &&
    claim.inputRevision === committed.inputRevision &&
    claim.attempt === committed.attempt &&
    claim.startedAt === committed.startedAt &&
    (claim.reviewedChangeSet === undefined ||
      (claim.reviewedChangeSet.changeSetId === committed.changeSetId &&
        claim.reviewedChangeSet.changeSetDigest === committed.changeSetDigest))
  );
}

/**
 * Proves that one committed receipt can safely own the current durable queue state.
 *
 * This read-only check is shared by pre-manifest verification and the later
 * marker mutation so identity rules cannot drift between the two phases.
 *
 * @param snapshot - Current validated Bundle queue
 * @param marker - Commit marker derived from the exact transaction receipt
 * @returns Queue job owned by the committed transaction
 */
function requireApplyRecoveryJob(
  snapshot: IngestQueueSnapshot,
  marker: IngestApplyCommitMarker
): KnowledgeIngestJob {
  if (snapshot.applyCommit && !sameApplyCommitMarker(snapshot.applyCommit, marker)) {
    throw new IngestQueueApplyCommitConflictError(snapshot.bundleId, marker.jobId);
  }

  const job = requireJob(snapshot, marker.jobId);
  if (!jobMatchesApplyMarker(job, marker)) {
    throw new IngestQueueApplyCommitConflictError(snapshot.bundleId, marker.jobId);
  }

  const processingMatch =
    job.status === "processing" &&
    job.stage === "applying" &&
    job.startedAt === marker.startedAt &&
    snapshot.applyClaim !== undefined &&
    applyClaimMatchesCommit(snapshot.applyClaim, marker);
  const failedMatch =
    job.status === "failed" &&
    job.stage === "applying" &&
    snapshot.applyClaim !== undefined &&
    applyClaimMatchesCommit(snapshot.applyClaim, marker);
  const completedMatch =
    job.status === "completed" &&
    snapshot.applyCommit !== undefined &&
    sameApplyCommitMarker(snapshot.applyCommit, marker) &&
    job.changeSetId === marker.changeSetId;
  if (!processingMatch && !failedMatch && !completedMatch) {
    throw new IngestQueueApplyCommitConflictError(snapshot.bundleId, marker.jobId);
  }
  return job;
}

/**
 * Adds a validated delay without exceeding JavaScript's exact integer range.
 *
 * @param timestamp - Non-negative safe-integer timestamp
 * @param delayMs - Non-negative safe-integer delay
 * @returns Saturated safe-integer timestamp
 */
function addSafeDelay(timestamp: number, delayMs: number): number {
  if (delayMs > Number.MAX_SAFE_INTEGER - timestamp) {
    return Number.MAX_SAFE_INTEGER;
  }
  return timestamp + delayMs;
}

/**
 * Persists and executes isolated durable ingest queues for knowledge Bundles.
 *
 * Storage CAS protects independent queue instances. Per-Bundle mutexes only
 * serialize operations within this object; executor work always runs outside
 * the mutex so user pause and cancellation remain responsive.
 */
export class IngestQueue {
  private readonly clock: () => number;
  private readonly jobIdFactory: () => string;
  private readonly retryPolicy: RetryPolicy;
  private readonly eventSink?: EventSink;
  private readonly maxWriteAttempts: number;
  private readonly bundleMutexes = new Map<string, Mutex>();
  private readonly activeControllers = new Map<string, ActiveController>();

  /**
   * Creates a queue over injected persistence and execution ports.
   *
   * @param storage - Complete queue snapshot persistence port
   * @param executor - Provider-neutral work executor
   * @param options - Deterministic clock, ids, retries, events, and CAS bound
   */
  constructor(
    private readonly storage: QueueStorage,
    private readonly executor: IngestExecutor,
    options: IngestQueueOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.jobIdFactory =
      options.jobIdFactory ??
      (() => {
        return crypto.randomUUID();
      });
    this.retryPolicy =
      options.retryPolicy ??
      new ExponentialRetryPolicy(
        {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          jitterRatio: 0.2,
        },
        Math.random
      );
    this.eventSink = options.eventSink;
    this.maxWriteAttempts = options.maxWriteAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxWriteAttempts) || this.maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive safe integer");
    }
  }

  /**
   * Loads and validates one Bundle queue without creating storage eagerly.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached persisted state or an empty revision-zero queue
   */
  async load(bundleId: string): Promise<IngestQueueSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedSnapshot(bundleId, loaded.snapshot);
  }

  /**
   * Enqueues one source version with source-level deduplication.
   *
   * Pending inputs are updated in place before their first execution. If an
   * older input is processing or awaiting review, only one latest rerun payload
   * is retained durably regardless of how many further source changes arrive.
   *
   * @param request - Exact source and pipeline input to schedule
   * @returns Durable enqueue, update, rerun, or deduplication result
   */
  async enqueue(request: EnqueueIngestRequest): Promise<EnqueueIngestResult> {
    this.assertEnqueueRequest(request);
    const timestamp = this.now();
    const reservedJobId = this.nextJobId();
    const mutation = await this.getBundleMutex(request.bundleId).runExclusive(async () => {
      return this.mutateSourceObservation<EnqueueMutationValue>(request, (current) => {
        const active = current.jobs.find(
          (job) => isActiveJob(job) && job.sourceId === request.sourceId
        );
        const highWatermark = current.sourceHighWatermarks.find(
          (candidate) => candidate.sourceId === request.sourceId
        );
        if (highWatermark && request.inputRevision <= highWatermark.inputRevision) {
          const deduplicatedJob = active ?? requireLatestSourceJob(current, request.sourceId);
          if (
            request.inputRevision === highWatermark.inputRevision &&
            !highWatermarkMatchesRequest(highWatermark, request)
          ) {
            throw new IngestQueueObservationConflictError(
              request.bundleId,
              request.sourceId,
              request.inputRevision
            );
          }
          return { value: { kind: "deduplicated" as const, jobId: deduplicatedJob.id } };
        }
        if (!active && highWatermark && highWatermarkMatchesRequest(highWatermark, request)) {
          const deduplicatedJob = requireLatestSourceJob(current, request.sourceId);
          return {
            next: recordSourceHighWatermark(current, request, timestamp),
            value: { kind: "deduplicated" as const, jobId: deduplicatedJob.id },
          };
        }
        if (!active) {
          this.assertJobIdAvailable(current, reservedJobId);
          const job: KnowledgeIngestJob = {
            id: reservedJobId,
            bundleId: request.bundleId,
            sourceId: request.sourceId,
            sourceContentHash: request.sourceContentHash,
            pipelineFingerprint: request.pipelineFingerprint,
            inputRevision: request.inputRevision,
            attempt: 0,
            rerunRequested: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            status: "pending",
            stage: "queued",
          };
          return {
            next: recordSourceHighWatermark(
              { ...current, jobs: [...current.jobs, job] },
              request,
              timestamp
            ),
            value: { kind: "enqueued" as const, jobId: job.id },
          };
        }

        const existingRerun = current.reruns.find((rerun) => rerun.sourceId === request.sourceId);
        if (existingRerun !== undefined && rerunMatchesRequest(existingRerun, request)) {
          const next = {
            ...replaceJob(current, {
              ...active,
              updatedAt: Math.max(timestamp, active.updatedAt),
            }),
            reruns: current.reruns.map((rerun) =>
              rerun.sourceId === active.sourceId
                ? {
                    ...rerun,
                    inputRevision: request.inputRevision,
                    updatedAt: Math.max(timestamp, rerun.updatedAt),
                  }
                : rerun
            ),
          };
          return {
            next: recordSourceHighWatermark(next, request, timestamp),
            value: { kind: "deduplicated" as const, jobId: active.id },
          };
        }
        if (jobMatchesRequest(active, request)) {
          if (!existingRerun) {
            if (active.status !== "pending" && active.status !== "paused") {
              return {
                next: recordSourceHighWatermark(current, request, timestamp),
                value: { kind: "deduplicated" as const, jobId: active.id },
              };
            }
            return {
              next: recordSourceHighWatermark(
                replaceJob(current, {
                  ...active,
                  inputRevision: request.inputRevision,
                  updatedAt: Math.max(timestamp, active.updatedAt),
                }),
                request,
                timestamp
              ),
              value: { kind: "deduplicated" as const, jobId: active.id },
            };
          }
          const claimSafeActive =
            active.status === "pending" || active.status === "paused"
              ? { ...active, inputRevision: request.inputRevision }
              : active;
          const next = {
            ...replaceJob(current, {
              ...claimSafeActive,
              rerunRequested: false,
              updatedAt: Math.max(timestamp, active.updatedAt),
            }),
            reruns: current.reruns.filter((rerun) => rerun.sourceId !== active.sourceId),
          };
          return {
            next: recordSourceHighWatermark(next, request, timestamp),
            value: { kind: "updated" as const, jobId: active.id },
          };
        }

        if (
          (active.status === "pending" || active.status === "paused") &&
          existingRerun === undefined
        ) {
          const updatedAt = Math.max(timestamp, active.updatedAt);
          const nextJob: KnowledgeIngestJob = {
            id: active.id,
            bundleId: active.bundleId,
            sourceId: active.sourceId,
            sourceContentHash: request.sourceContentHash,
            pipelineFingerprint: request.pipelineFingerprint,
            inputRevision: request.inputRevision,
            attempt: 0,
            rerunRequested: false,
            createdAt: active.createdAt,
            updatedAt,
            status: "pending",
            stage: "queued",
          };
          return {
            next: recordSourceHighWatermark(replaceJob(current, nextJob), request, timestamp),
            value: { kind: "updated" as const, jobId: active.id },
          };
        }

        const rerunJobId = existingRerun?.jobId ?? reservedJobId;
        if (!existingRerun) {
          this.assertJobIdAvailable(current, rerunJobId);
        }
        const rerun: IngestRerunRequest = {
          jobId: rerunJobId,
          sourceId: request.sourceId,
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
          inputRevision: request.inputRevision,
          requestedAt: existingRerun?.requestedAt ?? Math.max(timestamp, active.updatedAt),
          updatedAt: Math.max(timestamp, existingRerun?.updatedAt ?? active.updatedAt),
        };
        const nextJob: KnowledgeIngestJob = {
          ...active,
          rerunRequested: true,
          updatedAt: Math.max(timestamp, active.updatedAt),
        };
        const next = {
          ...replaceJob(current, nextJob),
          reruns: existingRerun
            ? current.reruns.map((candidate) =>
                candidate.sourceId === rerun.sourceId ? rerun : candidate
              )
            : [...current.reruns, rerun],
        };
        return {
          next: recordSourceHighWatermark(next, request, timestamp),
          value: { kind: "rerun_scheduled" as const, jobId: active.id },
        };
      });
    });

    const job = requireJob(mutation.snapshot, mutation.value.jobId);
    const cause: IngestQueueEventCause =
      mutation.value.kind === "enqueued"
        ? "enqueue"
        : mutation.value.kind === "updated"
          ? "source_update"
          : mutation.value.kind === "rerun_scheduled"
            ? "rerun_scheduled"
            : "deduplicate";
    this.emit(mutation.snapshot, cause, job.id);
    return { kind: mutation.value.kind, job };
  }

  /**
   * Claims and executes at most one eligible job for a Bundle.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Queue availability or final durable status of the claimed job
   */
  async runNext(bundleId: string): Promise<RunNextResult> {
    assertIdentifier(bundleId, "bundleId");
    const claim = await this.claimNext(bundleId);
    if (claim.value.kind !== "claimed" || !claim.value.jobId) {
      if (claim.value.kind === "paused" && claim.value.reason) {
        return { kind: "paused", reason: claim.value.reason };
      }
      if (claim.value.kind === "waiting" && claim.value.nextAttemptAt !== undefined) {
        return { kind: "waiting", nextAttemptAt: claim.value.nextAttemptAt };
      }
      if (claim.value.kind === "busy" && claim.value.jobId) {
        return { kind: "busy", jobId: claim.value.jobId };
      }
      return { kind: "idle" };
    }

    const job = requireJob(claim.snapshot, claim.value.jobId);
    if (job.status !== "processing") {
      throw new IngestQueueTransitionError(job.id, jobState(job), "execute an unclaimed job");
    }
    const active = this.activeControllers.get(bundleId);
    if (
      !active ||
      active.jobId !== job.id ||
      active.attempt !== job.attempt ||
      active.startedAt !== job.startedAt
    ) {
      throw new IngestQueueTransitionError(job.id, jobState(job), "execute without a controller");
    }

    const executionJob = Object.freeze({ ...job });
    try {
      this.emit(claim.snapshot, "claim", executionJob.id);
      const beforeExecution = requireJob(await this.load(bundleId), executionJob.id);
      if (
        active.controller.signal.aborted ||
        !isSameClaim(beforeExecution, executionJob.attempt, executionJob.startedAt)
      ) {
        const status = this.toRunStatus(beforeExecution);
        return status === "stale"
          ? { kind: "stale", jobId: executionJob.id }
          : { kind: "executed", jobId: executionJob.id, status };
      }

      let result: IngestExecutionResult;
      try {
        result = await this.executor.execute({
          job: executionJob,
          signal: active.controller.signal,
          reportStage: async (stage) => {
            await this.reportStage(
              bundleId,
              executionJob.id,
              executionJob.attempt,
              executionJob.startedAt,
              stage,
              active.controller.signal
            );
          },
        });
        this.assertExecutionResult(result);
      } catch (error) {
        if (error instanceof IngestQueueInfrastructureError) {
          throw error;
        }
        const finalized = await this.finalizeFailure(
          bundleId,
          executionJob.id,
          executionJob.attempt,
          executionJob.startedAt,
          error,
          active.controller.signal
        );
        if (finalized === "stale") {
          return { kind: "stale", jobId: executionJob.id };
        }
        return { kind: "executed", jobId: executionJob.id, status: finalized };
      }

      const finalized = await this.finalizeSuccess(
        bundleId,
        executionJob.id,
        executionJob.attempt,
        executionJob.startedAt,
        result
      );
      if (typeof finalized !== "string") {
        return { kind: "commit_ready", jobId: executionJob.id, receipt: finalized.receipt };
      }
      if (finalized === "stale") {
        return { kind: "stale", jobId: executionJob.id };
      }
      return { kind: "executed", jobId: executionJob.id, status: finalized };
    } catch (error) {
      await this.recoverAfterInfrastructureFailure(bundleId);
      throw error;
    } finally {
      const current = this.activeControllers.get(bundleId);
      if (current?.controller === active.controller) {
        this.activeControllers.delete(bundleId);
      }
    }
  }

  /**
   * Reloads ambiguous storage state and prevents an orphaned processing claim.
   *
   * The original infrastructure error remains authoritative. If storage is
   * still unavailable, startup recovery will retry this same operation later.
   *
   * @param bundleId - Bundle whose live worker unwound unexpectedly
   */
  private async recoverAfterInfrastructureFailure(bundleId: string): Promise<void> {
    try {
      await this.recoverOnStartup(bundleId);
    } catch {
      return;
    }
  }

  /**
   * Pauses new claims and cooperatively stops non-applying active work.
   *
   * Applying is an explicit no-abort boundary: the execution gate is paused,
   * but a future recoverable transaction must reach a safe commit or recovery
   * point before the job itself can stop.
   *
   * @param bundleId - Stable Bundle identifier
   * @param detail - Optional user-facing pause detail
   * @returns Detached committed queue snapshot
   */
  async pause(bundleId: string, detail?: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<PauseMutationValue>(bundleId, (current) => {
        if (
          current.control.status === "paused" &&
          ["startup_recovery", "recovery_required", "commit_pending_ack"].includes(
            current.control.reason
          )
        ) {
          return { value: { changed: false } };
        }
        const processing = current.jobs.find((job) => job.status === "processing");
        const sameControl =
          current.control.status === "paused" &&
          current.control.reason === "user" &&
          current.control.detail === detail;
        let next = current;
        if (processing && processing.stage !== "applying") {
          const pausedAt = Math.max(timestamp, processing.updatedAt);
          const paused: KnowledgeIngestJob = {
            id: processing.id,
            bundleId: processing.bundleId,
            sourceId: processing.sourceId,
            sourceContentHash: processing.sourceContentHash,
            pipelineFingerprint: processing.pipelineFingerprint,
            inputRevision: processing.inputRevision,
            attempt: processing.attempt,
            rerunRequested: processing.rerunRequested,
            createdAt: processing.createdAt,
            updatedAt: pausedAt,
            status: "paused",
            stage: processing.stage,
            pausedAt,
            ...(detail === undefined ? {} : { reason: detail }),
          };
          next = replaceJob(next, paused);
        }
        if (!sameControl) {
          next = {
            ...next,
            control: {
              status: "paused",
              reason: "user",
              pausedAt: timestamp,
              ...(detail === undefined ? {} : { detail }),
            },
          };
        }
        const pausedJobId = processing?.stage === "applying" ? undefined : processing?.id;
        return next === current
          ? { value: { changed: false } }
          : {
              next,
              value: {
                changed: true,
                ...(pausedJobId === undefined ? {} : { pausedJobId }),
              },
            };
      });
    });

    if (mutation.value.pausedJobId) {
      const active = this.activeControllers.get(bundleId);
      if (active?.jobId === mutation.value.pausedJobId) {
        active.controller.abort();
      }
    }
    if (mutation.value.changed) {
      this.emit(mutation.snapshot, "pause", mutation.value.pausedJobId);
    }
    return mutation.snapshot;
  }

  /**
   * Resumes a Bundle queue and requeues every safely paused job.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached committed queue snapshot
   */
  async resume(bundleId: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        if (
          current.control.status === "paused" &&
          current.control.reason === "commit_pending_ack"
        ) {
          throw new IngestQueueApplyCommitPendingError(bundleId);
        }
        if (current.control.status === "paused" && current.control.reason === "startup_recovery") {
          throw new IngestQueueStartupReleaseRequiredError(bundleId);
        }
        const hasApplyRecoveryFailure = current.jobs.some(
          (job) => job.status === "failed" && job.stage === "applying"
        );
        if (
          hasApplyRecoveryFailure ||
          (current.control.status === "paused" && current.control.reason === "recovery_required")
        ) {
          throw new IngestQueueRecoveryRequiredError(bundleId);
        }
        const hasPausedJobs = current.jobs.some((job) => job.status === "paused");
        if (current.control.status === "running" && !hasPausedJobs) {
          return { value: false };
        }
        return {
          next: {
            ...current,
            control: { status: "running" },
            jobs: current.jobs.map((job): KnowledgeIngestJob => {
              if (job.status !== "paused") {
                return job;
              }
              return {
                id: job.id,
                bundleId: job.bundleId,
                sourceId: job.sourceId,
                sourceContentHash: job.sourceContentHash,
                pipelineFingerprint: job.pipelineFingerprint,
                inputRevision: job.inputRevision,
                attempt: job.attempt,
                rerunRequested: job.rerunRequested,
                createdAt: job.createdAt,
                updatedAt: Math.max(timestamp, job.updatedAt),
                status: "pending",
                stage: "queued",
              };
            }),
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "resume");
    }
    return mutation.snapshot;
  }

  /**
   * Cancels a pending, paused, or non-applying processing job and its reserved rerun.
   *
   * Applying cannot be cancelled at the queue boundary because aborting a
   * multi-file write without its transaction journal could corrupt user data.
   * Awaiting-review jobs require {@link rejectReview} so their exact durable
   * proposal outcome and latest rerun cannot be orphaned. This is source-work
   * cancellation, so the one coalesced rerun is discarded.
   * Cancellation only updates queue state and signals the executor; it has no
   * page-deletion capability, including for shared or user-owned pages.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Durable job identifier
   * @returns Detached cancelled job
   */
  async cancel(bundleId: string, jobId: string): Promise<KnowledgeIngestJob> {
    assertIdentifier(jobId, "jobId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status === "cancelled") {
          return { value: false };
        }
        if (["completed", "failed"].includes(job.status)) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "cancel");
        }
        if (job.status === "awaiting_review") {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "cancel review without an exact durable rejection"
          );
        }
        if (job.status === "processing" && job.stage === "applying") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "cancel during apply");
        }
        const cancelledAt = Math.max(timestamp, job.updatedAt);
        const cancelled: KnowledgeIngestJob = {
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
        return {
          next: {
            ...replaceJob(current, cancelled),
            reruns: current.reruns.filter((rerun) => rerun.sourceId !== job.sourceId),
          },
          value: true,
        };
      });
    });

    if (mutation.value) {
      const active = this.activeControllers.get(bundleId);
      if (active?.jobId === jobId) {
        active.controller.abort();
      }
      this.emit(mutation.snapshot, "cancel", jobId);
    }
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Explicitly retries one retryable terminal failure.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Failed job identifier
   * @returns Detached pending job
   */
  async retryFailed(bundleId: string, jobId: string): Promise<KnowledgeIngestJob> {
    assertIdentifier(jobId, "jobId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "failed" || !job.failure.retryable || job.stage === "applying") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "retry");
        }
        const activeForSource = current.jobs.some(
          (candidate) =>
            candidate.id !== job.id && candidate.sourceId === job.sourceId && isActiveJob(candidate)
        );
        if (activeForSource) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "retry beside active source");
        }
        const pending: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: 0,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: Math.max(timestamp, job.updatedAt),
          status: "pending",
          stage: "queued",
        };
        return { next: replaceJob(current, pending), value: true };
      });
    });
    this.emit(mutation.snapshot, "retry", jobId);
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Reconciles a durable pending Review Store record after a hand-off interruption.
   *
   * This closes the crash window between proposal persistence and the queue's
   * awaiting-review transition. It never runs the executor or writes pages and
   * may safely convert the matching live or startup-recovered attempt.
   *
   * @param bundleId - Stable Bundle identifier
   * @param reviewDecision - Strict durable pending Review Store record receipt
   * @returns Detached awaiting-review job
   */
  async reconcilePendingReview(
    bundleId: string,
    reviewDecision: IngestPendingReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob> {
    const pendingDecision = snapshotPendingReviewDecision(reviewDecision);
    if (pendingDecision.bundleId !== bundleId) {
      throw new IngestQueueReviewBundleMismatchError(bundleId, pendingDecision.bundleId);
    }
    const { jobId } = pendingDecision.jobClaim;
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (!jobMatchesReviewDecisionClaim(job, pendingDecision.jobClaim)) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "reconcile a pending review for a different queue claim"
          );
        }
        const existing = current.pendingReviews.find((review) => review.jobId === job.id);
        if (job.status === "awaiting_review") {
          if (
            existing?.kind === "durable" &&
            existing.changeSetId === pendingDecision.changeSetId &&
            existing.proposalDigest === pendingDecision.proposalDigest &&
            existing.reviewRecordRevision === pendingDecision.recordRevision &&
            existing.recordedAt === pendingDecision.recordedAt &&
            job.changeSetId === pendingDecision.changeSetId
          ) {
            return { value: false };
          }
          if (
            existing?.kind === "legacy_unverified" &&
            existing.changeSetId === pendingDecision.changeSetId &&
            job.changeSetId === pendingDecision.changeSetId &&
            pendingDecision.recordedAt >= job.createdAt
          ) {
            const updatedAt = Math.max(timestamp, job.updatedAt, pendingDecision.recordedAt);
            const upgradedJob: KnowledgeIngestJob = { ...job, updatedAt };
            const anchor: IngestDurablePendingReview = {
              kind: "durable",
              jobId: job.id,
              changeSetId: pendingDecision.changeSetId,
              proposalDigest: pendingDecision.proposalDigest,
              reviewRecordRevision: pendingDecision.recordRevision,
              recordedAt: pendingDecision.recordedAt,
            };
            return {
              next: {
                ...replaceJob(current, upgradedJob),
                pendingReviews: current.pendingReviews.map((review) =>
                  review.jobId === job.id ? anchor : review
                ),
              },
              value: true,
            };
          }
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "replace a different pending review anchor"
          );
        }
        const isRecoverableAttempt =
          job.status === "pending" ||
          job.status === "paused" ||
          (job.status === "processing" && job.stage !== "applying");
        if (!isRecoverableAttempt || existing) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "reconcile pending review");
        }
        if (
          current.pendingReviews.some(
            (review) => review.changeSetId === pendingDecision.changeSetId
          )
        ) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "reuse a pending review ChangeSet"
          );
        }
        if (pendingDecision.recordedAt < job.createdAt) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "reconcile a review recorded before its queue job"
          );
        }
        const updatedAt = Math.max(timestamp, job.updatedAt, pendingDecision.recordedAt);
        const awaitingReview: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: job.rerunRequested,
          createdAt: job.createdAt,
          updatedAt,
          status: "awaiting_review",
          stage: "review",
          changeSetId: pendingDecision.changeSetId,
        };
        const anchor: IngestDurablePendingReview = {
          kind: "durable",
          jobId: job.id,
          changeSetId: pendingDecision.changeSetId,
          proposalDigest: pendingDecision.proposalDigest,
          reviewRecordRevision: pendingDecision.recordRevision,
          recordedAt: pendingDecision.recordedAt,
        };
        return {
          next: {
            ...replaceJob(current, awaitingReview),
            pendingReviews: [...current.pendingReviews, anchor],
          },
          value: true,
        };
      });
    });
    const active = this.activeControllers.get(bundleId);
    if (
      mutation.value &&
      active?.jobId === jobId &&
      active.attempt === pendingDecision.jobClaim.attempt
    ) {
      active.controller.abort();
    }
    if (mutation.value) {
      this.emit(mutation.snapshot, "awaiting_review", jobId);
    }
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Durably rejects one exact awaiting-review ChangeSet without touching pages.
   *
   * Review persistence must precede this queue transition. The durable rejection
   * marker makes an identical retry safe after a crash while preventing another
   * ChangeSet from being attributed to the cancelled job. A retained latest
   * rerun is promoted atomically after its predecessor becomes terminal.
   *
   * @param bundleId - Stable Bundle identifier
   * @param reviewDecision - Strict durable rejected Review Store record receipt
   * @returns Detached cancelled predecessor job
   */
  async rejectReview(
    bundleId: string,
    reviewDecision: IngestRejectedReviewDecisionReceipt
  ): Promise<KnowledgeIngestJob> {
    const rejectedReview = snapshotRejectedReviewDecision(reviewDecision);
    if (rejectedReview.bundleId !== bundleId) {
      throw new IngestQueueReviewBundleMismatchError(bundleId, rejectedReview.bundleId);
    }
    const { jobId } = rejectedReview.jobClaim;
    const { changeSetId } = rejectedReview;
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        const existing = current.reviewRejections.find((rejection) => rejection.jobId === jobId);
        if (existing) {
          if (
            existing.changeSetId !== changeSetId ||
            existing.proposalDigest !== rejectedReview.proposalDigest ||
            existing.reviewRecordRevision !== rejectedReview.recordRevision ||
            existing.decisionAt !== rejectedReview.rejectedAt ||
            job.status !== "cancelled" ||
            !jobMatchesReviewDecisionClaim(job, rejectedReview.jobClaim)
          ) {
            throw new IngestQueueTransitionError(
              job.id,
              jobState(job),
              "reject a different reviewed ChangeSet"
            );
          }
          return { value: false };
        }
        if (job.status !== "awaiting_review") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "reject review");
        }
        if (
          job.changeSetId !== changeSetId ||
          !jobMatchesReviewDecisionClaim(job, rejectedReview.jobClaim)
        ) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "reject a different reviewed ChangeSet"
          );
        }
        const pendingReview = current.pendingReviews.find((review) => review.jobId === job.id);
        if (
          pendingReview?.kind !== "durable" ||
          pendingReview.changeSetId !== changeSetId ||
          pendingReview.proposalDigest !== rejectedReview.proposalDigest ||
          rejectedReview.recordRevision !== pendingReview.reviewRecordRevision + 1 ||
          rejectedReview.rejectedAt < pendingReview.recordedAt
        ) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "reject a review without its exact pending record"
          );
        }

        const rejectedAt = Math.max(timestamp, job.updatedAt, rejectedReview.rejectedAt);
        const cancelled: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: rejectedAt,
          status: "cancelled",
          stage: "cancelled",
          cancelledAt: rejectedAt,
        };
        const rejected = {
          ...replaceJob(current, cancelled),
          pendingReviews: current.pendingReviews.filter((review) => review.jobId !== job.id),
          reviewRejections: [
            ...current.reviewRejections,
            {
              jobId,
              changeSetId,
              proposalDigest: rejectedReview.proposalDigest,
              reviewRecordRevision: rejectedReview.recordRevision,
              decisionAt: rejectedReview.rejectedAt,
              rejectedAt,
            },
          ],
        };
        return {
          next: promoteRerun(rejected, job.sourceId, rejectedAt),
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "review_rejected", jobId);
    }
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Converts an accepted review into a durable applying claim.
   *
   * Review acceptance is not job success. The caller must apply the accepted
   * ChangeSet through ChangeSetTransaction and pass its receipt to the
   * ApplyCommitCoordinator before the queue can become completed.
   *
   * @param bundleId - Stable Bundle identifier
   * @param reviewDecision - Strict durable accepted Review Store record receipt
   * @returns Detached processing job containing the exact apply claim
   */
  async beginReviewApply(
    bundleId: string,
    reviewDecision: IngestAcceptedReviewDecisionReceipt
  ): Promise<ProcessingIngestJob> {
    const acceptedDecision = snapshotAcceptedReviewDecision(reviewDecision);
    if (acceptedDecision.bundleId !== bundleId) {
      throw new IngestQueueReviewBundleMismatchError(bundleId, acceptedDecision.bundleId);
    }
    const { jobId } = acceptedDecision.jobClaim;
    const acceptedReview = Object.freeze({
      changeSetId: acceptedDecision.changeSetId,
      changeSetDigest: acceptedDecision.acceptedDigest,
    });
    const acceptedReviewIdentity = Object.freeze({
      proposalDigest: acceptedDecision.proposalDigest,
      recordRevision: acceptedDecision.recordRevision,
      manifestCommitIntentDigest: acceptedDecision.manifestCommitIntentDigest,
      acceptedAt: acceptedDecision.acceptedAt,
    });
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (!jobMatchesReviewDecisionClaim(job, acceptedDecision.jobClaim)) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "apply a review decision for a different queue claim"
          );
        }
        const isStartupRecoveryPaused =
          current.control.status === "paused" && current.control.reason === "startup_recovery";
        if (job.status === "processing" && job.stage === "applying") {
          if (isStartupRecoveryPaused) {
            throw new IngestQueueRecoveryRequiredError(bundleId);
          }
          const claim = current.applyClaim;
          if (
            claim &&
            claim.jobId === job.id &&
            claim.sourceId === job.sourceId &&
            claim.sourceContentHash === job.sourceContentHash &&
            claim.pipelineFingerprint === job.pipelineFingerprint &&
            claim.inputRevision === job.inputRevision &&
            claim.attempt === job.attempt &&
            claim.startedAt === job.startedAt &&
            claim.reviewedChangeSet?.changeSetId === acceptedReview.changeSetId &&
            claim.reviewedChangeSet.changeSetDigest === acceptedReview.changeSetDigest &&
            claim.acceptedReview?.proposalDigest === acceptedReviewIdentity.proposalDigest &&
            claim.acceptedReview.recordRevision === acceptedReviewIdentity.recordRevision &&
            claim.acceptedReview.manifestCommitIntentDigest ===
              acceptedReviewIdentity.manifestCommitIntentDigest &&
            claim.acceptedReview.acceptedAt === acceptedReviewIdentity.acceptedAt
          ) {
            return { value: false };
          }
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "replace a different active review apply claim"
          );
        }
        if (current.control.status === "paused" && current.control.reason === "recovery_required") {
          throw new IngestQueueRecoveryRequiredError(bundleId);
        }
        if (
          current.control.status === "paused" &&
          current.control.reason === "commit_pending_ack"
        ) {
          throw new IngestQueueApplyCommitPendingError(bundleId);
        }
        if (current.control.status === "paused" && !isStartupRecoveryPaused) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "begin review apply while the Bundle is paused"
          );
        }
        if (job.status !== "awaiting_review") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "begin review apply");
        }
        if (job.changeSetId !== acceptedReview.changeSetId) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "apply a different reviewed ChangeSet"
          );
        }
        const pendingReview = current.pendingReviews.find((review) => review.jobId === job.id);
        if (
          pendingReview?.kind !== "durable" ||
          pendingReview.changeSetId !== acceptedReview.changeSetId ||
          pendingReview.proposalDigest !== acceptedDecision.proposalDigest ||
          acceptedDecision.recordRevision !== pendingReview.reviewRecordRevision + 1 ||
          acceptedDecision.acceptedAt < pendingReview.recordedAt
        ) {
          throw new IngestQueueTransitionError(
            job.id,
            jobState(job),
            "apply a review without its exact pending record"
          );
        }
        if (current.jobs.some((candidate) => candidate.status === "processing")) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "apply beside active work");
        }
        const startedAt = Math.max(timestamp, job.updatedAt, acceptedDecision.acceptedAt);
        const applying: ProcessingIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: job.rerunRequested,
          createdAt: job.createdAt,
          updatedAt: startedAt,
          status: "processing",
          stage: "applying",
          startedAt,
        };
        return {
          next: {
            ...replaceJob(current, applying),
            pendingReviews: current.pendingReviews.filter((review) => review.jobId !== job.id),
            applyClaim: createApplyClaimMarker(applying, acceptedReview, acceptedReviewIdentity),
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "review_accepted", jobId);
    }
    const applying = requireJob(mutation.snapshot, jobId);
    if (applying.status !== "processing" || applying.stage !== "applying") {
      throw new IngestQueueTransitionError(jobId, jobState(applying), "return apply claim");
    }
    return applying;
  }

  /**
   * Recovers interrupted work once during startup and leaves backlog paused.
   *
   * Non-applying processing becomes pending in the same durable mutation as
   * the startup-recovery gate. An interrupted apply fails closed behind a
   * recovery-required gate until Commit E's write journal can prove its state.
   * Recovery itself never increments an execution attempt.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached recovered queue snapshot
   */
  async recoverOnStartup(bundleId: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const hasBacklog = current.jobs.some((job) => isActiveJob(job));
        if (!hasBacklog) {
          return { value: false };
        }
        const alreadySafelyPaused =
          current.control.status === "paused" &&
          !current.jobs.some((job) => job.status === "processing");
        if (alreadySafelyPaused) {
          return { value: false };
        }
        let next = current;
        let requiresApplyRecovery = false;
        for (const job of current.jobs) {
          if (job.status !== "processing") {
            continue;
          }
          const recoveredAt = Math.max(timestamp, job.updatedAt);
          if (job.stage === "applying") {
            requiresApplyRecovery = true;
            const failed: KnowledgeIngestJob = {
              id: job.id,
              bundleId: job.bundleId,
              sourceId: job.sourceId,
              sourceContentHash: job.sourceContentHash,
              pipelineFingerprint: job.pipelineFingerprint,
              inputRevision: job.inputRevision,
              attempt: job.attempt,
              rerunRequested: false,
              createdAt: job.createdAt,
              updatedAt: recoveredAt,
              status: "failed",
              stage: "applying",
              failure: {
                code: "interrupted_apply_requires_recovery",
                message: "An interrupted apply requires transaction recovery before retry",
                retryable: false,
                occurredAt: recoveredAt,
              },
            };
            next = promoteRerun(replaceJob(next, failed), job.sourceId, recoveredAt);
            continue;
          }
          const pending: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: job.rerunRequested,
            createdAt: job.createdAt,
            updatedAt: recoveredAt,
            status: "pending",
            stage: "queued",
          };
          next = replaceJob(next, pending);
        }
        return {
          next: {
            ...next,
            control: requiresApplyRecovery
              ? {
                  status: "paused",
                  reason: "recovery_required",
                  pausedAt: timestamp,
                  detail: "An interrupted apply must be recovered before queue resume",
                }
              : current.control.status === "paused"
                ? current.control
                : { status: "paused", reason: "startup_recovery", pausedAt: timestamp },
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "recover");
    }
    return mutation.snapshot;
  }

  /**
   * Verifies the exact queue job and apply claim before Manifest success is written.
   *
   * This method never mutates queue state. The coordinator must call it before
   * its idempotent Manifest write, then call {@link resolveApplyRecovery}; the
   * latter repeats the same proof inside the queue CAS mutation.
   *
   * @param receipt - Durable transaction proof proposed for reconciliation
   * @returns Detached exact queue job owned by the receipt
   */
  async verifyApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    assertTransactionCommitReceipt(receipt);
    const marker = createApplyCommitMarker(receipt);
    return this.getBundleMutex(receipt.bundleId).runExclusive(async () => {
      const snapshot = await this.load(receipt.bundleId);
      return requireApplyRecoveryJob(snapshot, marker);
    });
  }

  /**
   * Reconciles a committed transaction receipt with an interrupted applying job.
   *
   * The manifest success record MUST already be durable before this method is
   * called. The queue job becomes completed, but execution remains blocked by a
   * durable `commit_pending_ack` marker until the global transaction journal is
   * cleared and {@link finalizeApplyRecovery} removes that marker.
   *
   * @param receipt - Durable proof returned by ChangeSet transaction recovery
   * @returns Detached completed queue job
   */
  async resolveApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    assertTransactionCommitReceipt(receipt);
    const bundleId = receipt.bundleId;
    const marker = createApplyCommitMarker(receipt);
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const job = requireApplyRecoveryJob(current, marker);
        if (current.applyCommit) {
          return { value: false };
        }

        const completedAt = Math.max(timestamp, marker.committedAt, job.updatedAt);
        const completed: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: completedAt,
          status: "completed",
          stage: "completed",
          changeSetId: marker.changeSetId,
          completedAt,
        };
        const next = promoteRerun(replaceJob(current, completed), job.sourceId, completedAt);
        const withoutApplyClaim: IngestQueueSnapshot = { ...next };
        delete withoutApplyClaim.applyClaim;
        return {
          next: {
            ...withoutApplyClaim,
            control: {
              status: "paused",
              reason: "commit_pending_ack",
              pausedAt: completedAt,
              detail: "Committed pages are waiting for durable journal acknowledgement",
            },
            applyCommit: marker,
          },
          value: true,
        };
      });
    });

    const active = this.activeControllers.get(bundleId);
    if (
      mutation.value &&
      active?.jobId === marker.jobId &&
      active.attempt === marker.attempt &&
      active.startedAt === marker.startedAt
    ) {
      active.controller.abort();
    }
    if (mutation.value) {
      this.emit(mutation.snapshot, "apply_commit_pending", marker.jobId);
    }
    return requireJob(mutation.snapshot, marker.jobId);
  }

  /**
   * Reads the durable queue marker waiting for journal acknowledgement.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached pending marker, or null when none exists
   */
  async getPendingApplyCommit(bundleId: string): Promise<IngestApplyCommitMarker | null> {
    const snapshot = await this.load(bundleId);
    return snapshot.applyCommit ? { ...snapshot.applyCommit } : null;
  }

  /**
   * Releases a commit-pending queue only after the journal slot is durably clear.
   *
   * This method deliberately leaves the backlog under `startup_recovery` pause,
   * requiring a fresh Gate observation and conditional Runtime release.
   *
   * @param bundleId - Stable Bundle identifier
   * @param transactionId - Exact acknowledged transaction identifier
   * @returns Detached reconciled queue snapshot
   */
  async finalizeApplyRecovery(
    bundleId: string,
    transactionId: string
  ): Promise<IngestQueueSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(transactionId, "transactionId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const marker = current.applyCommit;
        if (!marker) {
          return { value: false };
        }
        if (marker.transactionId !== transactionId) {
          throw new IngestQueueApplyCommitConflictError(bundleId, marker.jobId);
        }
        const job = requireJob(current, marker.jobId);
        if (
          job.status !== "completed" ||
          !jobMatchesApplyMarker(job, marker) ||
          job.changeSetId !== marker.changeSetId
        ) {
          throw new IngestQueueApplyCommitConflictError(bundleId, marker.jobId);
        }
        const withoutMarker: IngestQueueSnapshot = { ...current };
        delete withoutMarker.applyCommit;
        return {
          next: {
            ...withoutMarker,
            control: {
              status: "paused",
              reason: "startup_recovery",
              pausedAt: Math.max(timestamp, marker.committedAt),
              detail: "Recovered apply committed; startup reconciliation must release the backlog",
            },
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "apply_commit_finalized");
    }
    return mutation.snapshot;
  }

  /**
   * Claims the oldest due pending job under the Bundle mutex and creates its controller.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Claimed snapshot or a durable availability result
   */
  private async claimNext(bundleId: string): Promise<MutationResult<ClaimedJobResult>> {
    const timestamp = this.now();
    return this.getBundleMutex(bundleId).runExclusive(async () => {
      const localExecution = this.activeControllers.get(bundleId);
      if (localExecution) {
        return {
          snapshot: await this.load(bundleId),
          value: { kind: "busy", jobId: localExecution.jobId },
        };
      }
      const mutation = await this.mutate<ClaimedJobResult>(bundleId, (current) => {
        if (current.control.status === "paused") {
          return {
            value: {
              kind: "paused" as const,
              reason: current.control.reason,
            },
          };
        }
        const processing = current.jobs.find((job) => job.status === "processing");
        if (processing) {
          return { value: { kind: "busy" as const, jobId: processing.id } };
        }

        const pending = current.jobs
          .filter((job): job is Extract<KnowledgeIngestJob, { status: "pending" }> => {
            return job.status === "pending";
          })
          .sort(
            (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
          );
        const due = pending.find(
          (job) => job.nextAttemptAt === undefined || job.nextAttemptAt <= timestamp
        );
        if (!due) {
          const nextAttemptAt = pending.reduce<number | undefined>((earliest, job) => {
            if (job.nextAttemptAt === undefined) {
              return earliest;
            }
            return earliest === undefined
              ? job.nextAttemptAt
              : Math.min(earliest, job.nextAttemptAt);
          }, undefined);
          return nextAttemptAt === undefined
            ? { value: { kind: "idle" as const } }
            : { value: { kind: "waiting" as const, nextAttemptAt } };
        }
        if (due.attempt >= Number.MAX_SAFE_INTEGER) {
          throw new IngestQueueTransitionError(due.id, jobState(due), "increment attempt");
        }
        const startedAt = Math.max(timestamp, due.updatedAt);
        const processingJob: ProcessingIngestJob = {
          id: due.id,
          bundleId: due.bundleId,
          sourceId: due.sourceId,
          sourceContentHash: due.sourceContentHash,
          pipelineFingerprint: due.pipelineFingerprint,
          inputRevision: due.inputRevision,
          attempt: due.attempt + 1,
          rerunRequested: due.rerunRequested,
          createdAt: due.createdAt,
          updatedAt: startedAt,
          status: "processing",
          stage: "parsing",
          startedAt,
        };
        return {
          next: replaceJob(current, processingJob),
          value: { kind: "claimed" as const, jobId: due.id },
        };
      });

      if (mutation.value.kind === "claimed" && mutation.value.jobId) {
        const claimed = requireJob(mutation.snapshot, mutation.value.jobId);
        if (claimed.status !== "processing") {
          throw new IngestQueueTransitionError(
            claimed.id,
            jobState(claimed),
            "create claim controller"
          );
        }
        this.activeControllers.set(bundleId, {
          jobId: mutation.value.jobId,
          attempt: claimed.attempt,
          startedAt: claimed.startedAt,
          controller: new AbortController(),
        });
      }
      return mutation;
    });
  }

  /**
   * Persists a monotonic forward work-stage transition reported by the executor.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param stage - Current executor stage
   * @param signal - Controller signal paired with the claim
   */
  private async reportStage(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    stage: KnowledgeIngestWorkStage,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      throw new DOMException("Ingest execution was aborted", "AbortError");
    }
    const timestamp = this.now();
    let mutation: MutationResult<boolean>;
    try {
      mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
        return this.mutate<boolean>(bundleId, (current) => {
          const job = requireJob(current, jobId);
          if (!isSameClaim(job, attempt, startedAt)) {
            throw new IngestQueueTransitionError(job.id, jobState(job), `report stage '${stage}'`);
          }
          const currentIndex = WORK_STAGE_ORDER.indexOf(job.stage);
          const nextIndex = WORK_STAGE_ORDER.indexOf(stage);
          if (nextIndex < currentIndex) {
            throw new IngestQueueTransitionError(
              job.id,
              jobState(job),
              `move backward to '${stage}'`
            );
          }
          if (nextIndex === currentIndex) {
            return { value: false };
          }
          const nextJob: ProcessingIngestJob = {
            ...job,
            stage,
            updatedAt: Math.max(timestamp, job.updatedAt),
          };
          const next = replaceJob(current, nextJob);
          return {
            next:
              stage === "applying"
                ? { ...next, applyClaim: createApplyClaimMarker(nextJob) }
                : next,
            value: true,
          };
        });
      });
    } catch (error) {
      if (error instanceof IngestQueueTransitionError) {
        throw error;
      }
      throw new IngestQueueInfrastructureError("stage persistence", error);
    }
    if (mutation.value) {
      this.emit(mutation.snapshot, "stage", jobId);
    }
  }

  /**
   * Persists a non-applying outcome or returns committed apply proof for coordination.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param result - Review or completed executor outcome
   * @returns Final durable status, stale claim, or unacknowledged commit proof
   */
  private async finalizeSuccess(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    result: IngestExecutionResult
  ): Promise<
    ExecutedJobStatus | "stale" | { kind: "commit_ready"; receipt: TransactionCommitReceipt }
  > {
    if (
      result.kind !== "awaiting_review" &&
      result.kind !== "no_changes" &&
      result.kind !== "completed"
    ) {
      throw new TypeError("executor result kind is not supported");
    }
    assertIdentifier(result.changeSetId, "changeSetId");
    let commitMarker: IngestApplyCommitMarker | undefined;
    let pendingReviewDecision: IngestPendingReviewDecisionReceipt | undefined;
    if (result.kind === "awaiting_review") {
      pendingReviewDecision = snapshotPendingReviewDecision(result.reviewDecision);
      if (
        pendingReviewDecision.bundleId !== bundleId ||
        pendingReviewDecision.changeSetId !== result.changeSetId ||
        pendingReviewDecision.jobClaim.jobId !== jobId ||
        pendingReviewDecision.jobClaim.attempt !== attempt
      ) {
        throw new IngestQueueTransitionError(
          jobId,
          `attempt ${attempt}`,
          "persist a pending review for a different queue claim"
        );
      }
    }
    if (result.kind === "completed") {
      assertTransactionCommitReceipt(result.commitReceipt);
      if (
        result.commitReceipt.bundleId !== bundleId ||
        result.commitReceipt.changeSetId !== result.changeSetId ||
        result.commitReceipt.jobClaim.jobId !== jobId ||
        result.commitReceipt.jobClaim.attempt !== attempt ||
        result.commitReceipt.jobClaim.startedAt !== startedAt
      ) {
        throw new IngestQueueApplyCommitConflictError(bundleId, jobId);
      }
      commitMarker = createApplyCommitMarker(result.commitReceipt);
    }
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<SuccessMutationValue>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "processing") {
          return { value: "stale" };
        }
        if (!isSameClaim(job, attempt, startedAt)) {
          return { value: "stale" };
        }
        if (job.stage === "applying") {
          if (
            result.kind !== "completed" ||
            !commitMarker ||
            !jobMatchesApplyMarker(job, commitMarker) ||
            commitMarker.startedAt !== job.startedAt
          ) {
            throw new IngestQueueApplyReceiptRequiredError(bundleId, jobId);
          }
          return { value: "commit_ready" };
        }
        if (result.kind === "completed" || commitMarker) {
          throw new IngestQueueApplyReceiptRequiredError(bundleId, jobId);
        }
        if (result.kind === "awaiting_review") {
          if (
            !pendingReviewDecision ||
            !jobMatchesReviewDecisionClaim(job, pendingReviewDecision.jobClaim) ||
            pendingReviewDecision.recordedAt < job.createdAt ||
            current.pendingReviews.some(
              (review) =>
                review.jobId === job.id || review.changeSetId === pendingReviewDecision.changeSetId
            )
          ) {
            throw new IngestQueueTransitionError(
              job.id,
              jobState(job),
              "persist an invalid pending review hand-off"
            );
          }
          const updatedAt = Math.max(timestamp, job.updatedAt, pendingReviewDecision.recordedAt);
          const awaitingReview: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: job.rerunRequested,
            createdAt: job.createdAt,
            updatedAt,
            status: "awaiting_review",
            stage: "review",
            changeSetId: result.changeSetId,
          };
          const anchor: IngestDurablePendingReview = {
            kind: "durable",
            jobId: job.id,
            changeSetId: pendingReviewDecision.changeSetId,
            proposalDigest: pendingReviewDecision.proposalDigest,
            reviewRecordRevision: pendingReviewDecision.recordRevision,
            recordedAt: pendingReviewDecision.recordedAt,
          };
          return {
            next: {
              ...replaceJob(current, awaitingReview),
              pendingReviews: [...current.pendingReviews, anchor],
            },
            value: "changed",
          };
        }
        const completedAt = Math.max(timestamp, job.updatedAt);
        const completed: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: completedAt,
          status: "completed",
          stage: "completed",
          changeSetId: result.changeSetId,
          completedAt,
        };
        return {
          next: promoteRerun(replaceJob(current, completed), job.sourceId, completedAt),
          value: "changed",
        };
      });
    });
    if (mutation.value === "stale") {
      return "stale";
    }
    if (mutation.value === "commit_ready") {
      if (result.kind !== "completed") {
        throw new IngestQueueApplyReceiptRequiredError(bundleId, jobId);
      }
      return { kind: "commit_ready", receipt: result.commitReceipt };
    }
    const finalJob = requireJob(mutation.snapshot, jobId);
    if (finalJob.attempt !== attempt) {
      return "stale";
    }
    const cause = finalJob.status === "awaiting_review" ? "awaiting_review" : "complete";
    this.emit(mutation.snapshot, cause, jobId);
    return this.toRunStatus(finalJob);
  }

  /**
   * Persists retry, rate-limit pause, or terminal failure after executor rejection.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param error - Unknown executor rejection
   * @param signal - Controller signal paired with the claim
   * @returns Final durable job status
   */
  private async finalizeFailure(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    error: unknown,
    signal: AbortSignal
  ): Promise<ExecutedJobStatus | "stale"> {
    const timestamp = this.now();
    const normalized = this.normalizeExecutorFailure(error, timestamp);
    const decision = this.decideRetrySafely({
      attempt,
      retryable: normalized.failure.retryable,
      rateLimited: normalized.rateLimited,
      ...(normalized.retryAfterMs === undefined ? {} : { retryAfterMs: normalized.retryAfterMs }),
    });
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<FailureMutationValue>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "processing") {
          return { value: { changed: false, cause: "failure" } };
        }
        if (!isSameClaim(job, attempt, startedAt)) {
          return { value: { changed: false, cause: "failure" } };
        }

        const failedAt = Math.max(timestamp, job.updatedAt);
        const failure: KnowledgeFailure = {
          ...normalized.failure,
          occurredAt: failedAt,
        };
        const terminalFailure: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: failedAt,
          status: "failed",
          stage: job.stage,
          failure,
        };
        if (job.stage === "applying") {
          const recoveryFailure: KnowledgeIngestJob = {
            ...terminalFailure,
            failure: {
              code: "apply_failure_requires_recovery",
              message: "Apply failure requires transaction recovery before retry",
              retryable: false,
              occurredAt: failedAt,
            },
          };
          const next = promoteRerun(replaceJob(current, recoveryFailure), job.sourceId, failedAt);
          return {
            next: {
              ...next,
              control: {
                status: "paused",
                reason: "recovery_required",
                pausedAt: failedAt,
                detail: "Apply transaction state must be recovered before queue resume",
              },
            },
            value: { changed: true, cause: "failure" },
          };
        }
        const hasRerun = current.reruns.some((rerun) => rerun.sourceId === job.sourceId);
        if (hasRerun) {
          let next = promoteRerun(
            replaceJob(current, terminalFailure),
            job.sourceId,
            Math.max(timestamp, job.updatedAt)
          );
          if (decision.kind === "pause") {
            next = {
              ...next,
              control: {
                status: "paused",
                reason: "rate_limit",
                pausedAt: timestamp,
                ...(decision.retryAfterMs === undefined
                  ? {}
                  : { resumeAt: addSafeDelay(timestamp, decision.retryAfterMs) }),
              },
            };
          }
          return {
            next,
            value: {
              changed: true,
              cause: decision.kind === "pause" ? "rate_limit" : "failure",
            },
          };
        }

        if (decision.kind === "retry") {
          const pending: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: false,
            createdAt: job.createdAt,
            updatedAt: Math.max(timestamp, job.updatedAt),
            status: "pending",
            stage: "queued",
            nextAttemptAt: addSafeDelay(Math.max(timestamp, job.updatedAt), decision.delayMs),
          };
          return {
            next: replaceJob(current, pending),
            value: { changed: true, cause: "retry" },
          };
        }

        if (decision.kind === "pause") {
          const pausedAt = Math.max(timestamp, job.updatedAt);
          const nextJob: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: false,
            createdAt: job.createdAt,
            updatedAt: pausedAt,
            status: "paused",
            stage: job.stage,
            pausedAt,
            reason: normalized.failure.message,
          };
          return {
            next: {
              ...replaceJob(current, nextJob),
              control: {
                status: "paused",
                reason: "rate_limit",
                pausedAt,
                detail: normalized.failure.message,
                ...(decision.retryAfterMs === undefined
                  ? {}
                  : { resumeAt: addSafeDelay(pausedAt, decision.retryAfterMs) }),
              },
            },
            value: { changed: true, cause: "rate_limit" },
          };
        }

        return {
          next: replaceJob(current, terminalFailure),
          value: { changed: true, cause: "failure" },
        };
      });
    });

    const finalJob = requireJob(mutation.snapshot, jobId);
    if (finalJob.attempt !== attempt) {
      return "stale";
    }
    if (mutation.value.changed && !(signal.aborted && finalJob.status === "cancelled")) {
      this.emit(mutation.snapshot, mutation.value.cause, jobId);
    }
    return this.toRunStatus(finalJob);
  }

  /**
   * Normalizes only explicitly typed executor errors; unknown errors remain generic.
   *
   * Avoiding raw unknown error messages prevents provider payloads or credentials
   * from being copied into durable queue JSON accidentally.
   *
   * @param error - Unknown executor rejection
   * @param occurredAt - Queue-owned failure timestamp
   * @returns Serializable failure and explicit retry classification
   */
  private normalizeExecutorFailure(
    error: unknown,
    occurredAt: number
  ): {
    failure: KnowledgeFailure;
    rateLimited: boolean;
    retryAfterMs?: number;
  } {
    if (error instanceof IngestExecutorError) {
      const { details } = error;
      if (
        isRecord(details) &&
        typeof details.code === "string" &&
        FAILURE_CODE_PATTERN.test(details.code) &&
        typeof details.message === "string" &&
        details.message.trim().length > 0 &&
        details.message.length <= 1_000 &&
        !SENSITIVE_FAILURE_PATTERN.test(details.message) &&
        typeof details.retryable === "boolean" &&
        typeof details.rateLimited === "boolean" &&
        (details.retryAfterMs === undefined ||
          (Number.isSafeInteger(details.retryAfterMs) && details.retryAfterMs >= 0)) &&
        (details.rateLimited || details.retryAfterMs === undefined)
      ) {
        return {
          failure: {
            code: details.code,
            message: details.message,
            retryable: details.retryable,
            occurredAt,
          },
          rateLimited: details.rateLimited,
          ...(details.retryAfterMs === undefined ? {} : { retryAfterMs: details.retryAfterMs }),
        };
      }
    }
    return {
      failure: {
        code: "unexpected_executor_failure",
        message: "The ingest executor failed without safe structured details",
        retryable: false,
        occurredAt,
      },
      rateLimited: false,
    };
  }

  /**
   * Selects a stable retry decision and fails closed for malformed custom policies.
   *
   * The decision is computed once outside the CAS-replayed transform so jitter
   * cannot change merely because an unrelated concurrent queue write won first.
   *
   * @param context - Completed-attempt and normalized failure classification
   * @returns Valid retry, rate-limit pause, or terminal failure decision
   */
  private decideRetrySafely(context: {
    attempt: number;
    retryable: boolean;
    rateLimited: boolean;
    retryAfterMs?: number;
  }): RetryDecision {
    try {
      const decision = this.retryPolicy.decide(context);
      if (
        decision.kind === "retry" &&
        Number.isSafeInteger(decision.delayMs) &&
        decision.delayMs >= 0
      ) {
        return decision;
      }
      if (
        decision.kind === "pause" &&
        (decision.retryAfterMs === undefined ||
          (Number.isSafeInteger(decision.retryAfterMs) && decision.retryAfterMs >= 0))
      ) {
        return decision;
      }
      if (
        decision.kind === "fail" &&
        (decision.reason === "not_retryable" || decision.reason === "attempts_exhausted")
      ) {
        return decision;
      }
    } catch {
      return { kind: "fail", reason: "not_retryable" };
    }
    return { kind: "fail", reason: "not_retryable" };
  }

  /**
   * Validates an executor outcome before entering persistence finalization.
   *
   * @param value - Runtime result returned through the executor port
   */
  private assertExecutionResult(value: unknown): asserts value is IngestExecutionResult {
    if (
      !isRecord(value) ||
      (value.kind !== "awaiting_review" &&
        value.kind !== "no_changes" &&
        value.kind !== "completed") ||
      typeof value.changeSetId !== "string" ||
      value.changeSetId.trim().length === 0
    ) {
      throw new TypeError("executor result does not satisfy the ingest outcome contract");
    }
    if (value.kind === "completed") {
      if (!("commitReceipt" in value)) {
        throw new TypeError("completed executor result requires transaction commit proof");
      }
      assertTransactionCommitReceipt(value.commitReceipt);
      if (value.commitReceipt.changeSetId !== value.changeSetId) {
        throw new TypeError("executor commit receipt must match its ChangeSet result");
      }
    } else if (value.kind === "awaiting_review") {
      if (!("reviewDecision" in value)) {
        throw new TypeError("awaiting-review executor result requires pending review proof");
      }
      const pendingReview = snapshotPendingReviewDecision(value.reviewDecision);
      if (pendingReview.changeSetId !== value.changeSetId) {
        throw new TypeError("executor pending review proof must match its ChangeSet result");
      }
    }
    if (value.kind !== "completed" && "commitReceipt" in value) {
      throw new TypeError("only a completed executor result may carry transaction commit proof");
    }
    if (value.kind !== "awaiting_review" && "reviewDecision" in value) {
      throw new TypeError("only an awaiting-review result may carry pending review proof");
    }
  }

  /**
   * Narrows a durable state to the statuses exposed by runNext.
   *
   * @param job - Durable job after success/failure finalization
   * @returns Legal externally observable execution status
   */
  private toRunStatus(job: KnowledgeIngestJob): ExecutedJobStatus | "stale" {
    if (job.status === "processing") {
      return "stale";
    }
    return job.status;
  }

  /**
   * Validates exact enqueue identity and hashes before any storage access.
   *
   * @param request - Candidate enqueue request
   */
  private assertEnqueueRequest(request: EnqueueIngestRequest): void {
    assertIdentifier(request.bundleId, "bundleId");
    assertIdentifier(request.sourceId, "sourceId");
    assertHash(request.sourceContentHash, "sourceContentHash");
    assertHash(request.pipelineFingerprint, "pipelineFingerprint");
    if (!Number.isSafeInteger(request.inputRevision) || request.inputRevision < 0) {
      throw new TypeError("inputRevision must be a non-negative safe integer");
    }
    if (request.observationToken !== undefined) {
      assertIdentifier(request.observationToken, "observationToken");
    }
  }

  /**
   * Reads a validated non-negative safe-integer timestamp from the injected clock.
   *
   * @returns Current deterministic queue time
   */
  private now(): number {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("clock must return a non-negative safe integer");
    }
    return timestamp;
  }

  /**
   * Reads and validates one non-whitespace id from the injected factory.
   *
   * @returns Candidate durable job id
   */
  private nextJobId(): string {
    const jobId = this.jobIdFactory();
    assertIdentifier(jobId, "generated jobId");
    return jobId;
  }

  /**
   * Rejects a candidate id already used by job history or a reserved rerun.
   *
   * @param snapshot - Current validated queue snapshot
   * @param jobId - Candidate durable id
   */
  private assertJobIdAvailable(snapshot: IngestQueueSnapshot, jobId: string): void {
    if (
      snapshot.jobs.some((job) => job.id === jobId) ||
      snapshot.reruns.some((rerun) => rerun.jobId === jobId)
    ) {
      throw new IngestQueueJobIdConflictError(snapshot.bundleId, jobId);
    }
  }

  /**
   * Returns the in-process mutex dedicated to one Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Reused Bundle mutex
   */
  private getBundleMutex(bundleId: string): Mutex {
    const existing = this.bundleMutexes.get(bundleId);
    if (existing) {
      return existing;
    }
    const mutex = new Mutex();
    this.bundleMutexes.set(bundleId, mutex);
    return mutex;
  }

  /**
   * Emits a best-effort post-commit reload hint.
   *
   * Queue storage remains authoritative: observer failure never rolls back or
   * changes the success result of the durable operation it follows.
   *
   * @param snapshot - Current committed or validated no-op snapshot
   * @param cause - Operation that produced the observable state
   * @param jobId - Optional affected job id
   */
  private emit(snapshot: IngestQueueSnapshot, cause: IngestQueueEventCause, jobId?: string): void {
    if (!this.eventSink) {
      return;
    }
    try {
      const pending = this.eventSink.emit({
        type: "queue_changed",
        cause,
        bundleId: snapshot.bundleId,
        revision: snapshot.revision,
        ...(jobId === undefined ? {} : { jobId }),
      });
      void Promise.resolve(pending).catch(() => undefined);
    } catch {
      return;
    }
  }

  /**
   * Loads unknown queue JSON and enforces version and Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Validated snapshot and expected write revision
   */
  private async loadForMutation(bundleId: string): Promise<LoadedQueue> {
    const raw = await this.storage.read(bundleId);
    if (raw === null) {
      return { snapshot: createEmptyQueue(bundleId), expectedRevision: null };
    }
    if (
      isRecord(raw) &&
      "version" in raw &&
      raw.version !== 1 &&
      raw.version !== 2 &&
      raw.version !== 3 &&
      raw.version !== INGEST_QUEUE_VERSION
    ) {
      throw new IngestQueueIncompatibleVersionError(bundleId, raw.version);
    }
    const snapshot = this.cloneValidatedSnapshot(bundleId, raw);
    if (snapshot.bundleId !== bundleId) {
      throw new IngestQueueBundleMismatchError(bundleId, snapshot.bundleId);
    }
    return { snapshot, expectedRevision: snapshot.revision };
  }

  /**
   * Applies one enqueue mutation with its out-of-band observation capability.
   *
   * @param request - Source observation carrying Bundle and optional Runtime token
   * @param transform - Deterministic Queue transform
   * @returns Detached current or newly persisted snapshot and operation value
   */
  private mutateSourceObservation<T>(
    request: Pick<EnqueueIngestRequest, "bundleId" | "observationToken">,
    transform: (snapshot: IngestQueueSnapshot) => QueueMutation<T>
  ): Promise<MutationResult<T>> {
    const authority: QueueWriteAuthority | undefined =
      request.observationToken === undefined
        ? undefined
        : { kind: "source_observation", observationToken: request.observationToken };
    return this.mutate(request.bundleId, transform, authority);
  }

  /**
   * Applies one immutable mutation with bounded optimistic conflict retries.
   *
   * @param bundleId - Stable Bundle identifier
   * @param transform - Deterministic transform replayed after CAS conflicts
   * @returns Detached current or newly persisted snapshot and operation value
   */
  private async mutate<T>(
    bundleId: string,
    transform: (snapshot: IngestQueueSnapshot) => QueueMutation<T>,
    authority?: QueueWriteAuthority
  ): Promise<MutationResult<T>> {
    assertIdentifier(bundleId, "bundleId");
    let lastConflict: IngestQueueRevisionConflictError | undefined;
    for (let attempt = 0; attempt < this.maxWriteAttempts; attempt += 1) {
      const loaded = await this.loadForMutation(bundleId);
      const proposal = transform(loaded.snapshot);
      if (!proposal.next) {
        return {
          snapshot: this.cloneValidatedSnapshot(bundleId, loaded.snapshot),
          value: proposal.value,
        };
      }
      if (loaded.snapshot.revision >= Number.MAX_SAFE_INTEGER) {
        throw new IngestQueueRevisionOverflowError(bundleId, loaded.snapshot.revision);
      }
      const next = this.cloneValidatedSnapshot(bundleId, {
        ...proposal.next,
        version: INGEST_QUEUE_VERSION,
        bundleId,
        revision: loaded.snapshot.revision + 1,
      });
      try {
        await this.storage.write(bundleId, next, loaded.expectedRevision, authority);
        return {
          snapshot: this.cloneValidatedSnapshot(bundleId, next),
          value: proposal.value,
        };
      } catch (error) {
        if (!(error instanceof IngestQueueRevisionConflictError)) {
          throw error;
        }
        lastConflict = error;
      }
    }
    throw new IngestQueueWriteConflictExhaustedError(
      bundleId,
      this.maxWriteAttempts,
      lastConflict ?? new IngestQueueRevisionConflictError(bundleId, null)
    );
  }

  /**
   * Strictly parses, semantically validates, and clones a queue snapshot.
   *
   * @param bundleId - Bundle used for safe error reporting
   * @param value - Unknown or typed queue value
   * @returns Detached validated queue snapshot
   */
  private cloneValidatedSnapshot(bundleId: string, value: unknown): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(value);
    if (!parsed.ok) {
      throw new IngestQueueValidationError(bundleId, parsed.issues);
    }
    const semantic = validateIngestQueueSnapshot(parsed.value);
    if (!semantic.valid) {
      throw new IngestQueueValidationError(bundleId, semantic.diagnostics);
    }
    return parsed.value;
  }
}
