import type {
  IngestQueuePauseReason,
  IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeFailure, KnowledgeIngestJob } from "@/knowledge/model/types";
import type { KnowledgeRuntimeJobCompletion } from "@/knowledge/runtime/KnowledgeRuntimeStore";

export const DEFAULT_ACTIVITY_TERMINAL_LIMIT = 50;

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

export type KnowledgeActivityBundleState =
  | "running"
  | "paused"
  | "rate_limited"
  | "startup_recovery"
  | "recovery_required"
  | "finalizing";

export interface KnowledgeActivityBundleControls {
  state: KnowledgeActivityBundleState;
  canPause: boolean;
  canResume: boolean;
  pauseReason?: IngestQueuePauseReason;
  pausedAt?: number;
  detail?: string;
  resumeAt?: number;
}

export interface KnowledgeActivityJobActions {
  canCancel: boolean;
  canRetry: boolean;
  canReview: boolean;
  canReanalyze?: boolean;
  canRunSelected?: boolean;
}

export type KnowledgeActivityFailure = Readonly<KnowledgeFailure>;

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
  completion?: KnowledgeRuntimeJobCompletion;
}

export interface KnowledgeActivityCounts {
  total: number;
  active: number;
  terminal: number;
  hiddenTerminal: number;
  byStatus: Readonly<Record<KnowledgeActivityStatus, number>>;
}

export interface KnowledgeActivityModel {
  bundleId: string;
  revision: number;
  controls: Readonly<KnowledgeActivityBundleControls>;
  items: readonly Readonly<KnowledgeActivityItem>[];
  counts: Readonly<KnowledgeActivityCounts>;
}

export interface KnowledgeActivityModelOptions {
  maxTerminalItems?: number;
  completionOutcomes?: Readonly<Record<string, KnowledgeRuntimeJobCompletion>>;
  reanalyzableJobIds?: readonly string[];
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

function isRecoveryRequiredJob(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  if (snapshot.control.status !== "paused" || snapshot.control.reason !== "recovery_required") {
    return false;
  }
  return (
    snapshot.applyClaim?.jobId === job.id || (job.status === "failed" && job.stage === "applying")
  );
}

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

function hasActiveSourcePeer(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  return snapshot.jobs.some(
    (candidate) =>
      candidate.id !== job.id &&
      candidate.sourceId === job.sourceId &&
      !["failed", "completed", "cancelled"].includes(candidate.status)
  );
}

function hasNewerDivergentSourceObservation(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob
): boolean {
  const highWatermark = snapshot.sourceHighWatermarks.find(
    (candidate) => candidate.sourceId === job.sourceId
  );
  return (
    highWatermark !== undefined &&
    highWatermark.inputRevision > job.inputRevision &&
    (highWatermark.sourceContentHash !== job.sourceContentHash ||
      highWatermark.pipelineFingerprint !== job.pipelineFingerprint)
  );
}

export function isIngestQueueJobRetryEligible(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob
): boolean {
  return (
    job.status === "failed" &&
    job.failure.retryable &&
    job.stage !== "applying" &&
    !hasActiveSourcePeer(snapshot, job) &&
    !hasNewerDivergentSourceObservation(snapshot, job)
  );
}

function canBeginReview(snapshot: IngestQueueSnapshot): boolean {
  return (
    // Review is an exact user action; it must not require waking unrelated queued materials.
    // https://github.com/yydspanda/obsidian-copilot/issues/18
    (snapshot.control.status === "running" ||
      (snapshot.control.status === "paused" && snapshot.control.reason === "user")) &&
    !snapshot.applyClaim &&
    !snapshot.applyCommit &&
    !snapshot.jobs.some((job) => job.status === "processing")
  );
}

function hasDurablePendingReview(snapshot: IngestQueueSnapshot, job: KnowledgeIngestJob): boolean {
  return snapshot.pendingReviews.some(
    (review) =>
      review.kind === "durable" &&
      review.jobId === job.id &&
      job.status === "awaiting_review" &&
      review.changeSetId === job.changeSetId
  );
}

function deriveJobActions(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob,
  canReanalyze: boolean
): Readonly<KnowledgeActivityJobActions> {
  const canCancel =
    job.status === "pending" ||
    job.status === "paused" ||
    (job.status === "processing" && job.stage !== "applying");
  // The explicit single-material action never bypasses recovery or a scheduled retry.
  // https://github.com/yydspanda/obsidian-copilot/issues/18
  const canRunSelected =
    snapshot.control.status === "paused" &&
    snapshot.control.reason === "user" &&
    job.status === "pending" &&
    job.nextAttemptAt === undefined &&
    !snapshot.applyClaim &&
    !snapshot.applyCommit &&
    !snapshot.jobs.some((candidate) => candidate.status === "processing");
  return Object.freeze({
    canCancel,
    canRetry: isIngestQueueJobRetryEligible(snapshot, job),
    canReview:
      job.status === "awaiting_review" &&
      hasDurablePendingReview(snapshot, job) &&
      canBeginReview(snapshot),
    // Reanalysis admission must come from source-aware Runtime proof, never terminal status alone.
    // https://github.com/yydspanda/obsidian-copilot/issues/16
    ...(canReanalyze ? { canReanalyze: true } : {}),
    ...(canRunSelected ? { canRunSelected: true } : {}),
  });
}

function createActivityItem(
  snapshot: IngestQueueSnapshot,
  job: KnowledgeIngestJob,
  completion: KnowledgeRuntimeJobCompletion | undefined,
  canReanalyze: boolean
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
    actions: deriveJobActions(snapshot, job, status === "completed" && canReanalyze),
    ...(job.status === "pending" && job.nextAttemptAt !== undefined
      ? { nextAttemptAt: job.nextAttemptAt }
      : {}),
    ...(job.status === "awaiting_review" || job.status === "completed"
      ? { changeSetId: job.changeSetId }
      : {}),
    ...(job.status === "paused" && job.reason !== undefined ? { pausedReason: job.reason } : {}),
    ...(job.status === "failed" ? { failure: Object.freeze({ ...job.failure }) } : {}),
    // Completed storage can still be finalizing; never show its outcome as acknowledged early.
    // https://github.com/yydspanda/obsidian-copilot/issues/15
    ...(status === "completed" && completion !== undefined
      ? {
          completion: Object.freeze({
            ...completion,
            ...(completion.kind === "no_changes" && completion.generationOutcomes !== undefined
              ? { generationOutcomes: Object.freeze({ ...completion.generationOutcomes }) }
              : {}),
          }),
        }
      : {}),
  };
  return Object.freeze(item);
}

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

function compareActivityItems(
  left: Readonly<KnowledgeActivityItem>,
  right: Readonly<KnowledgeActivityItem>
): number {
  return (
    ACTIVITY_SORT_PRIORITY[left.status] - ACTIVITY_SORT_PRIORITY[right.status] ||
    compareRecentActivity(left, right)
  );
}

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

function deriveBundleControls(
  snapshot: IngestQueueSnapshot
): Readonly<KnowledgeActivityBundleControls> {
  // A single-material Apply retains user pause, but its commit still needs acknowledgement.
  // https://github.com/yydspanda/obsidian-copilot/issues/18
  if (snapshot.applyCommit) {
    return Object.freeze({
      state: "finalizing",
      canPause: false,
      canResume: false,
      ...(snapshot.control.status === "paused"
        ? { pauseReason: snapshot.control.reason, pausedAt: snapshot.control.pausedAt }
        : {}),
    });
  }
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
  const hardBlocked = ["startup_recovery", "recovery_required", "commit_pending_ack"].includes(
    snapshot.control.reason
  );
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

function readTerminalLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_ACTIVITY_TERMINAL_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("maxTerminalItems must be a non-negative safe integer");
  }
  return limit;
}

export function deriveKnowledgeActivityModel(
  snapshot: IngestQueueSnapshot,
  options: KnowledgeActivityModelOptions = {}
): Readonly<KnowledgeActivityModel> {
  const terminalLimit = readTerminalLimit(options.maxTerminalItems);
  const outcomes = options.completionOutcomes;
  // Job identifiers are data, so inherited object keys cannot stand in for completion proof.
  // https://github.com/yydspanda/obsidian-copilot/issues/15
  const projected = snapshot.jobs.map((job) =>
    createActivityItem(
      snapshot,
      job,
      outcomes !== undefined && Object.prototype.hasOwnProperty.call(outcomes, job.id)
        ? outcomes[job.id]
        : undefined,
      options.reanalyzableJobIds?.includes(job.id) === true
    )
  );
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
