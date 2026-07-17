import type {
  IngestQueuePauseReason,
  IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeFailure, KnowledgeIngestJob } from "@/knowledge/model/types";

/** Default number of terminal jobs retained in the derived Activity surface. */
export const DEFAULT_ACTIVITY_TERMINAL_LIMIT = 50;

/** Stable UI-facing state derived exclusively from a trusted queue snapshot. */
export type KnowledgeActivityStatus =
  | "queued"
  | "parsing"
  | "analyzing"
  | "associating"
  | "generating"
  | "validating"
  | "awaiting_review"
  | "applying"
  | "finalizing"
  | "paused"
  | "recovery_required"
  | "failed"
  | "cancelled"
  | "completed";

/** Bundle-wide execution state shown above individual Activity jobs. */
export type KnowledgeActivityBundleState =
  | "running"
  | "paused"
  | "rate_limited"
  | "startup_recovery"
  | "recovery_required"
  | "finalizing";

/** Bundle-wide controls; pause and resume are deliberately not job actions. */
export interface KnowledgeActivityBundleControls {
  state: KnowledgeActivityBundleState;
  canPause: boolean;
  canResume: boolean;
  pauseReason?: IngestQueuePauseReason;
  pausedAt?: number;
  detail?: string;
  resumeAt?: number;
}

/** Job-scoped actions that can be forwarded to the queue orchestration boundary. */
export interface KnowledgeActivityJobActions {
  canCancel: boolean;
  canRetry: boolean;
  canReview: boolean;
}

/** Detached, immutable failure text already sanitized by the queue boundary. */
export type KnowledgeActivityFailure = Readonly<KnowledgeFailure>;

/** One immutable Activity row derived from a durable ingest job. */
export interface KnowledgeActivityItem {
  id: string;
  sourceId: string;
  inputRevision: number;
  attempt: number;
  status: KnowledgeActivityStatus;
  durableStage: KnowledgeIngestJob["stage"];
  createdAt: number;
  updatedAt: number;
  rerunRequested: boolean;
  terminal: boolean;
  actions: Readonly<KnowledgeActivityJobActions>;
  nextAttemptAt?: number;
  changeSetId?: string;
  pausedReason?: string;
  failure?: KnowledgeActivityFailure;
}

/** Aggregate counts include hidden terminal history as well as visible jobs. */
export interface KnowledgeActivityCounts {
  total: number;
  active: number;
  terminal: number;
  hiddenTerminal: number;
  byStatus: Readonly<Record<KnowledgeActivityStatus, number>>;
}

/** Complete read-only projection consumed by a future Activity UI. */
export interface KnowledgeActivityModel {
  bundleId: string;
  revision: number;
  controls: Readonly<KnowledgeActivityBundleControls>;
  items: readonly Readonly<KnowledgeActivityItem>[];
  counts: Readonly<KnowledgeActivityCounts>;
}

/** Configuration for bounded terminal history projection. */
export interface KnowledgeActivityModelOptions {
  maxTerminalItems?: number;
}

const TERMINAL_ACTIVITY_STATUSES = new Set<KnowledgeActivityStatus>([
  "failed",
  "cancelled",
  "completed",
]);

const ACTIVITY_SORT_PRIORITY: Readonly<Record<KnowledgeActivityStatus, number>> = {
  recovery_required: 0,
  awaiting_review: 1,
  finalizing: 2,
  applying: 3,
  validating: 4,
  generating: 5,
  associating: 6,
  analyzing: 7,
  parsing: 8,
  paused: 9,
  queued: 10,
  failed: 11,
  cancelled: 12,
  completed: 13,
};

/**
 * Reports whether a job is the completed owner of an unacknowledged commit.
 *
 * A semantically validated queue guarantees that `commit_pending_ack` has an
 * apply marker. Matching by job id keeps unrelated completed history from
 * appearing successful or finalizing because another job owns that marker.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Candidate queue job
 * @returns Whether the job must remain in the non-success finalizing state
 */
function isFinalizingJob(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  if (job.status !== "completed") {
    return false;
  }
  const ownsCommitMarker = snapshot.applyCommit?.jobId === job.id;
  const ownsCommitPendingGate =
    snapshot.control.status === "paused" &&
    snapshot.control.reason === "commit_pending_ack" &&
    snapshot.applyCommit?.jobId === job.id;
  return ownsCommitMarker || ownsCommitPendingGate;
}

/**
 * Reports whether a failed apply is the Bundle's explicit recovery blocker.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Candidate queue job
 * @returns Whether the job represents a blocked recoverable transaction
 */
function isRecoveryRequiredJob(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  if (snapshot.control.status !== "paused" || snapshot.control.reason !== "recovery_required") {
    return false;
  }
  return (
    snapshot.applyClaim?.jobId === job.id || (job.status === "failed" && job.stage === "applying")
  );
}

/**
 * Converts one durable queue state into its stable Activity label.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Durable job to project
 * @returns UI-facing status that never promotes an unacknowledged commit to success
 */
function deriveActivityStatus(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob
): KnowledgeActivityStatus {
  if (isFinalizingJob(snapshot, job)) {
    return "finalizing";
  }
  if (isRecoveryRequiredJob(snapshot, job)) {
    return "recovery_required";
  }
  switch (job.status) {
    case "pending":
      return "queued";
    case "processing":
      return job.stage;
    case "paused":
      return "paused";
    case "awaiting_review":
      return "awaiting_review";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}

/**
 * Reports whether another non-terminal job already owns the same source.
 *
 * The durable queue rejects retry beside such a job, so exposing Retry in that
 * situation would create a predictably failing control.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Failed job being considered for retry
 * @returns Whether retry is blocked by another active source job
 */
function hasActiveSourcePeer(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  return snapshot.jobs.some(
    (candidate) =>
      candidate.id !== job.id &&
      candidate.sourceId === job.sourceId &&
      !["failed", "completed", "cancelled"].includes(candidate.status)
  );
}

/**
 * Determines whether review acceptance can enter the queue's apply claim.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @returns Whether Bundle state permits a job-level review action
 */
function canBeginReview(snapshot: IngestQueueSnapshot): boolean {
  return (
    snapshot.control.status === "running" &&
    !snapshot.jobs.some((job) => job.status === "processing")
  );
}

/**
 * Reports whether the queue anchored an exact durable pending Review Store record.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Awaiting-review job being projected
 * @returns Whether Review may safely advance to a terminal decision
 */
function hasDurablePendingReview(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  return snapshot.pendingReviews.some(
    (review) =>
      review.kind === "durable" &&
      review.jobId === job.id &&
      job.status === "awaiting_review" &&
      review.changeSetId === job.changeSetId
  );
}

/**
 * Derives job-level queue actions without inventing per-job pause or resume.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Durable job to inspect
 * @returns Immutable action availability for the Activity row
 */
function deriveJobActions(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob
): Readonly<KnowledgeActivityJobActions> {
  const canCancel =
    job.status === "pending" ||
    job.status === "paused" ||
    (job.status === "processing" && job.stage !== "applying");
  const canRetry =
    job.status === "failed" &&
    job.failure.retryable &&
    job.stage !== "applying" &&
    !hasActiveSourcePeer(snapshot, job);
  return Object.freeze({
    canCancel,
    canRetry,
    canReview:
      job.status === "awaiting_review" &&
      hasDurablePendingReview(snapshot, job) &&
      canBeginReview(snapshot),
  });
}

/**
 * Creates a detached immutable Activity row from one queue job.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @param job - Durable job to copy
 * @returns Read-only UI projection without references to mutable job objects
 */
function createActivityItem(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob
): Readonly<KnowledgeActivityItem> {
  const status = deriveActivityStatus(snapshot, job);
  const item: KnowledgeActivityItem = {
    id: job.id,
    sourceId: job.sourceId,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    status,
    durableStage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    rerunRequested: job.rerunRequested,
    terminal: TERMINAL_ACTIVITY_STATUSES.has(status),
    actions: deriveJobActions(snapshot, job),
    ...(job.status === "pending" && job.nextAttemptAt !== undefined
      ? { nextAttemptAt: job.nextAttemptAt }
      : {}),
    ...(job.status === "awaiting_review" || job.status === "completed"
      ? { changeSetId: job.changeSetId }
      : {}),
    ...(job.status === "paused" && job.reason !== undefined ? { pausedReason: job.reason } : {}),
    ...(job.status === "failed" ? { failure: Object.freeze({ ...job.failure }) } : {}),
  };
  return Object.freeze(item);
}

/**
 * Sorts newer Activity rows first with a deterministic id tie-breaker.
 *
 * @param left - First Activity row
 * @param right - Second Activity row
 * @returns Standard comparator result
 */
function compareRecentActivity(
  left: Readonly<KnowledgeActivityItem>,
  right: Readonly<KnowledgeActivityItem>
): number {
  return (
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Sorts Activity rows by attention priority and then recency.
 *
 * @param left - First Activity row
 * @param right - Second Activity row
 * @returns Standard comparator result
 */
function compareActivityItems(
  left: Readonly<KnowledgeActivityItem>,
  right: Readonly<KnowledgeActivityItem>
): number {
  return (
    ACTIVITY_SORT_PRIORITY[left.status] - ACTIVITY_SORT_PRIORITY[right.status] ||
    compareRecentActivity(left, right)
  );
}

/**
 * Creates zeroed counters for every Activity status.
 *
 * @returns Mutable counters used only while building the immutable model
 */
function createStatusCounts(): Record<KnowledgeActivityStatus, number> {
  return {
    queued: 0,
    parsing: 0,
    analyzing: 0,
    associating: 0,
    generating: 0,
    validating: 0,
    awaiting_review: 0,
    applying: 0,
    finalizing: 0,
    paused: 0,
    recovery_required: 0,
    failed: 0,
    cancelled: 0,
    completed: 0,
  };
}

/**
 * Projects the durable Bundle execution gate into safe UI controls.
 *
 * @param snapshot - Trusted durable queue snapshot
 * @returns Immutable Bundle-level pause and resume capabilities
 */
function deriveBundleControls(
  snapshot: IngestQueueSnapshot
): Readonly<KnowledgeActivityBundleControls> {
  if (snapshot.control.status === "running") {
    return Object.freeze({ state: "running", canPause: true, canResume: false });
  }

  const stateByReason: Readonly<Record<IngestQueuePauseReason, KnowledgeActivityBundleState>> = {
    user: "paused",
    rate_limit: "rate_limited",
    startup_recovery: "startup_recovery",
    recovery_required: "recovery_required",
    commit_pending_ack: "finalizing",
  };
  const hardBlocked = ["recovery_required", "commit_pending_ack"].includes(snapshot.control.reason);
  return Object.freeze({
    state: stateByReason[snapshot.control.reason],
    canPause: false,
    canResume: !hardBlocked,
    pauseReason: snapshot.control.reason,
    pausedAt: snapshot.control.pausedAt,
    ...(snapshot.control.detail === undefined ? {} : { detail: snapshot.control.detail }),
    ...(snapshot.control.resumeAt === undefined ? {} : { resumeAt: snapshot.control.resumeAt }),
  });
}

/**
 * Validates the caller-owned terminal projection limit.
 *
 * @param value - Requested maximum terminal row count
 * @returns Safe non-negative integer limit
 */
function readTerminalLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_ACTIVITY_TERMINAL_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("maxTerminalItems must be a non-negative safe integer");
  }
  return limit;
}

/**
 * Derives a bounded immutable Activity model from one trusted queue snapshot.
 *
 * Active, review, finalizing, and recovery rows are always retained and shown
 * before terminal history. Generic failed, cancelled, and completed history is
 * capped by recency so an indefinitely growing durable queue cannot create an
 * indefinitely growing render surface.
 *
 * @param snapshot - Strictly parsed and semantically validated queue snapshot
 * @param options - Optional terminal history projection limit
 * @returns Detached read-only Activity items, counts, and Bundle controls
 */
export function deriveKnowledgeActivityModel(
  snapshot: IngestQueueSnapshot,
  options: KnowledgeActivityModelOptions = {}
): Readonly<KnowledgeActivityModel> {
  const terminalLimit = readTerminalLimit(options.maxTerminalItems);
  const projected = snapshot.jobs.map((job) => createActivityItem(snapshot, job));
  const active = projected.filter((item) => !item.terminal).sort(compareActivityItems);
  const terminal = projected.filter((item) => item.terminal);
  const visibleTerminal = terminal
    .sort(compareRecentActivity)
    .slice(0, terminalLimit)
    .sort(compareActivityItems);
  const byStatus = createStatusCounts();
  for (const item of projected) {
    byStatus[item.status] += 1;
  }
  const hiddenTerminal = terminal.length - visibleTerminal.length;
  const controls = deriveBundleControls(snapshot);
  const items = Object.freeze([...active, ...visibleTerminal]);
  const counts: Readonly<KnowledgeActivityCounts> = Object.freeze({
    total: projected.length,
    active: active.length,
    terminal: terminal.length,
    hiddenTerminal,
    byStatus: Object.freeze(byStatus),
  });
  return Object.freeze({
    bundleId: snapshot.bundleId,
    revision: snapshot.revision,
    controls,
    items,
    counts,
  });
}
