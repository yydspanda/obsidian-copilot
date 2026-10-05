import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Eye,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  KnowledgeActivityBundleState,
  KnowledgeActivityItem,
  KnowledgeActivityModel,
  KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";
import type { KnowledgeStudioCommandCapabilities } from "@/knowledge/ui/KnowledgeStudioController";
import { cn } from "@/lib/utils";

/** Callback-only boundary for the Activity panel. */
export interface KnowledgeActivityPanelProps {
  model: Readonly<KnowledgeActivityModel>;
  commandCapabilities: Readonly<
    Pick<
      KnowledgeStudioCommandCapabilities,
      "pauseBundle" | "resumeBundle" | "cancelJob" | "retryJob" | "reanalyzeJob" | "runSelectedJob"
    >
  >;
  busy?: boolean;
  selectedRunCancelling?: boolean;
  runningSelectedJobId?: string;
  onPauseBundle: () => void;
  onResumeBundle: () => void;
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onReviewJob: (jobId: string) => void;
  onReanalyzeJob?: (jobId: string) => Promise<void>;
  onRunSelectedJob?: (jobId: string, confirmedQueueRevision: number) => Promise<void>;
}

interface MaterialConfirmation {
  kind: "reanalyze" | "run_selected";
  bundleId: string;
  revision: number;
  jobId: string;
}

interface StatusPresentation {
  label: string;
  detail: string;
  icon: LucideIcon;
  badgeClassName: string;
  iconClassName: string;
}

interface BundlePresentation {
  label: string;
  detail: string;
  icon: LucideIcon;
  iconClassName: string;
}

const STATUS_PRESENTATION: Readonly<Record<KnowledgeActivityStatus, StatusPresentation>> = {
  queued: {
    label: "Queued",
    detail: "Waiting for an ingest worker.",
    icon: Clock3,
    badgeClassName: "tw-bg-secondary-alt",
    iconClassName: "tw-text-muted",
  },
  parsing: {
    label: "Parsing",
    detail: "Reading and normalizing the source.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  analyzing: {
    label: "Analyzing",
    detail: "Extracting source-backed knowledge.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  associating: {
    label: "Associating",
    detail: "Resolving relationships with existing knowledge.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  generating: {
    label: "Generating",
    detail: "Building the proposed knowledge pages.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  validating: {
    label: "Validating",
    detail: "Checking the proposed change set.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  awaiting_review: {
    label: "Awaiting review",
    detail: "Generated changes need your decision.",
    icon: Eye,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-text-accent",
  },
  applying: {
    label: "Applying",
    detail: "An approved transaction is being applied.",
    icon: Loader2,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-accent",
  },
  finalizing: {
    label: "Finalizing",
    detail: "The commit is recorded but not yet durably acknowledged.",
    icon: RefreshCw,
    badgeClassName: "tw-bg-primary-alt",
    iconClassName: "tw-animate-spin tw-text-warning",
  },
  paused: {
    label: "Paused",
    detail: "This job is paused before applying changes.",
    icon: Pause,
    badgeClassName: "tw-bg-secondary-alt",
    iconClassName: "tw-text-warning",
  },
  recovery_required: {
    label: "Recovery required",
    detail: "Automatic writes are blocked until transaction recovery completes.",
    icon: ShieldAlert,
    badgeClassName: "tw-bg-error",
    iconClassName: "tw-text-error",
  },
  failed: {
    label: "Failed",
    detail: "The ingest attempt ended with an error.",
    icon: AlertCircle,
    badgeClassName: "tw-bg-error",
    iconClassName: "tw-text-error",
  },
  cancelled: {
    label: "Cancelled",
    detail: "The ingest attempt was cancelled.",
    icon: XCircle,
    badgeClassName: "tw-bg-secondary-alt",
    iconClassName: "tw-text-muted",
  },
  completed: {
    label: "Completed",
    // Older records cannot prove whether processing wrote files.
    // https://github.com/yydspanda/obsidian-copilot/issues/15
    detail:
      "Processing finished. The detailed outcome was not recorded, so this history cannot confirm whether Wiki files changed.",
    icon: CircleDashed,
    badgeClassName: cn("tw-bg-secondary-alt"),
    iconClassName: cn("tw-text-muted"),
  },
};

const COMPLETION_PRESENTATION: Readonly<
  Record<NonNullable<KnowledgeActivityItem["completion"]>["kind"], StatusPresentation>
> = {
  applied: {
    label: "Wiki updated",
    detail:
      "Approved file changes were written to the Wiki. This does not verify that every source detail is represented.",
    icon: CheckCircle2,
    badgeClassName: cn("tw-bg-success"),
    iconClassName: cn("tw-text-success"),
  },
  no_changes: {
    label: "No Wiki changes",
    detail: "Processing finished without writing any Wiki files.",
    icon: CircleDashed,
    badgeClassName: cn("tw-bg-secondary-alt"),
    iconClassName: cn("tw-text-muted"),
  },
};

const NO_CHANGES_REASON: Readonly<
  Record<
    Extract<NonNullable<KnowledgeActivityItem["completion"]>, { kind: "no_changes" }>["reason"],
    string
  >
> = {
  analysis_no_targets: "Analysis selected no Wiki targets.",
  resolved_no_targets: "Target resolution left no Wiki targets to generate.",
  all_targets_unchanged: "Generation produced no file changes.",
};

const BUNDLE_PRESENTATION: Readonly<Record<KnowledgeActivityBundleState, BundlePresentation>> = {
  running: {
    label: "Running",
    detail: "The ingest queue can start eligible work.",
    icon: CircleDashed,
    iconClassName: "tw-text-accent",
  },
  paused: {
    label: "Paused",
    detail: "The ingest queue is paused by you.",
    icon: Pause,
    iconClassName: "tw-text-warning",
  },
  rate_limited: {
    label: "Rate limited",
    detail: "The ingest queue will remain paused until it can safely resume.",
    icon: Clock3,
    iconClassName: "tw-text-warning",
  },
  startup_recovery: {
    label: "Startup recovery",
    detail: "The ingest queue is waiting for startup recovery to finish.",
    icon: RefreshCw,
    iconClassName: "tw-animate-spin tw-text-warning",
  },
  recovery_required: {
    label: "Recovery required",
    detail: "New work and automatic writes are blocked pending recovery.",
    icon: ShieldAlert,
    iconClassName: "tw-text-error",
  },
  finalizing: {
    label: "Finalizing commit",
    detail: "The queue is blocked until the durable commit acknowledgement clears.",
    icon: RefreshCw,
    iconClassName: "tw-animate-spin tw-text-warning",
  },
};

/**
 * Converts an epoch timestamp into deterministic, inspectable UI text.
 *
 * @param timestamp - Epoch timestamp in milliseconds
 * @returns ISO timestamp, or a safe fallback for invalid input
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toISOString();
}

/**
 * Converts a durable stage identifier into a human-readable label.
 *
 * @param stage - Durable queue stage
 * @returns Display label without changing stage semantics
 */
function formatStage(stage: KnowledgeActivityItem["durableStage"]): string {
  return stage === "review"
    ? "Review"
    : stage.charAt(0).toUpperCase() + stage.slice(1).replaceAll("_", " ");
}

/**
 * Renders one timestamp without relying on a global Window or Document.
 *
 * @param props - Timestamp and leading label
 * @returns Accessible timestamp metadata
 */
function ActivityTime({ timestamp, label }: { timestamp: number; label: string }) {
  const formatted = formatTimestamp(timestamp);
  return (
    <span>
      {label}{" "}
      <time dateTime={formatted === "Unknown time" ? undefined : formatted}>{formatted}</time>
    </span>
  );
}

/**
 * Renders the bundle-wide execution gate and only the actions it permits.
 *
 * @param props - Activity model and bundle callbacks
 * @returns Bundle control summary
 */
function BundleControls({
  model,
  commandCapabilities,
  onPauseBundle,
  onResumeBundle,
  busy,
}: Pick<
  KnowledgeActivityPanelProps,
  "model" | "commandCapabilities" | "onPauseBundle" | "onResumeBundle" | "busy"
>) {
  const controls = model.controls;
  const presentation = BUNDLE_PRESENTATION[controls.state];
  const StatusIcon = presentation.icon;

  return (
    <Card className="tw-border-solid tw-bg-transparent tw-shadow-none">
      <CardHeader className="tw-p-4">
        <CardTitle className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
            <StatusIcon
              aria-hidden="true"
              className={`tw-mt-0.5 tw-size-4 tw-shrink-0 ${presentation.iconClassName}`}
            />
            <div className="tw-min-w-0">
              <div className="tw-text-sm">Bundle {presentation.label}</div>
              <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-normal tw-text-muted">
                {controls.detail ?? presentation.detail}
              </p>
            </div>
          </div>
          <div className="tw-flex tw-items-center tw-gap-2">
            {controls.canPause && (
              <Button
                disabled={busy || !commandCapabilities.pauseBundle}
                size="sm"
                variant="ghost"
                onClick={onPauseBundle}
              >
                <Pause aria-hidden="true" className="tw-size-3" />
                Pause bundle
              </Button>
            )}
            {controls.canResume && (
              <Button
                disabled={busy || !commandCapabilities.resumeBundle}
                size="sm"
                variant="ghost"
                onClick={onResumeBundle}
              >
                <Play aria-hidden="true" className="tw-size-3" />
                Resume bundle
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      {(controls.pausedAt !== undefined || controls.resumeAt !== undefined) && (
        <CardContent className="tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-1 tw-p-4 tw-pt-0 tw-text-xs tw-text-muted">
          {controls.pausedAt !== undefined && (
            <ActivityTime label="Paused" timestamp={controls.pausedAt} />
          )}
          {controls.resumeAt !== undefined && (
            <ActivityTime label="Eligible to resume" timestamp={controls.resumeAt} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Renders aggregate Activity counts from the complete durable projection.
 *
 * @param model - Immutable Activity model
 * @returns Count summary that includes hidden terminal history
 */
function ActivityCounts({ model }: { model: Readonly<KnowledgeActivityModel> }) {
  const { counts } = model;
  return (
    <dl className="tw-m-0 tw-grid tw-grid-cols-2 tw-gap-2 sm:tw-grid-cols-5">
      <div className="tw-rounded-md tw-bg-secondary-alt tw-p-2">
        <dt className="tw-text-xs tw-text-muted">Total</dt>
        <dd className="tw-m-0 tw-text-sm tw-font-semibold">{counts.total}</dd>
      </div>
      <div className="tw-rounded-md tw-bg-secondary-alt tw-p-2">
        <dt className="tw-text-xs tw-text-muted">Active</dt>
        <dd className="tw-m-0 tw-text-sm tw-font-semibold">{counts.active}</dd>
      </div>
      <div className="tw-rounded-md tw-bg-secondary-alt tw-p-2">
        <dt className="tw-text-xs tw-text-muted">Awaiting review</dt>
        <dd className="tw-m-0 tw-text-sm tw-font-semibold">{counts.byStatus.awaiting_review}</dd>
      </div>
      <div className="tw-rounded-md tw-bg-secondary-alt tw-p-2">
        <dt className="tw-text-xs tw-text-muted">Failed</dt>
        <dd className="tw-m-0 tw-text-sm tw-font-semibold">{counts.byStatus.failed}</dd>
      </div>
      <div className="tw-rounded-md tw-bg-secondary-alt tw-p-2">
        <dt className="tw-text-xs tw-text-muted">History</dt>
        <dd className="tw-m-0 tw-text-sm tw-font-semibold">{counts.terminal}</dd>
      </div>
    </dl>
  );
}

/**
 * Renders failure details already sanitized by the queue boundary.
 *
 * @param item - Failed Activity item
 * @returns Failure detail block, or null for non-failed items
 */
function FailureDetails({ item }: { item: Readonly<KnowledgeActivityItem> }) {
  if (!item.failure) {
    return null;
  }

  return (
    <div className="tw-rounded-md tw-bg-error tw-p-2 tw-text-xs tw-text-error" role="alert">
      <div className="tw-font-semibold">
        {item.failure.code} · Failed during {formatStage(item.durableStage)}
      </div>
      <p className="tw-m-0 tw-mt-1 tw-whitespace-pre-wrap">{item.failure.message}</p>
    </div>
  );
}

function CompletionDetails({ completion }: Pick<KnowledgeActivityItem, "completion">) {
  if (completion?.kind !== "no_changes") {
    return null;
  }

  // A completed no-op does not prove that new material reached the Wiki or refreshed citations.
  // https://github.com/yydspanda/obsidian-copilot/issues/15
  return (
    <div className="tw-space-y-1 tw-text-xs tw-text-muted">
      <p className="tw-m-0">{NO_CHANGES_REASON[completion.reason]}</p>
      {completion.reason === "all_targets_unchanged" && (
        <p className="tw-m-0">
          {completion.generationOutcomes
            ? `Targets explicitly marked unchanged: ${completion.generationOutcomes.explicitUnchanged}. Proposed writes identical to existing files: ${completion.generationOutcomes.identicalWrites}.`
            : "This history did not record how many targets were marked unchanged or proposed identical writes."}
        </p>
      )}
      <p className="tw-m-0">
        No Wiki changes does not mean new material is included. Existing citations may still need
        updating.
      </p>
    </div>
  );
}

/**
 * Renders one durable Activity item and capability-gated callbacks.
 *
 * @param props - Item and job callback boundary
 * @returns One Activity row
 */
function ActivityItem({
  item,
  commandCapabilities,
  onCancelJob,
  onRetryJob,
  onReviewJob,
  busy,
  reanalysisAvailable,
  selectedRunAvailable,
  confirmationKind,
  pendingKind,
  selectedRunCancelling,
  onBeginConfirmation,
  onCancelConfirmation,
  onConfirm,
}: {
  item: Readonly<KnowledgeActivityItem>;
  commandCapabilities: KnowledgeActivityPanelProps["commandCapabilities"];
  onCancelJob: KnowledgeActivityPanelProps["onCancelJob"];
  onRetryJob: KnowledgeActivityPanelProps["onRetryJob"];
  onReviewJob: KnowledgeActivityPanelProps["onReviewJob"];
  busy: boolean;
  reanalysisAvailable: boolean;
  selectedRunAvailable: boolean;
  confirmationKind?: MaterialConfirmation["kind"];
  pendingKind?: MaterialConfirmation["kind"];
  selectedRunCancelling: boolean;
  onBeginConfirmation: (jobId: string, kind: MaterialConfirmation["kind"]) => void;
  onCancelConfirmation: () => void;
  onConfirm: () => void;
}) {
  const confirmationTitleId = React.useId();
  const confirmationDetailId = React.useId();
  // Do not display a successful outcome until the durable commit is acknowledged.
  // https://github.com/yydspanda/obsidian-copilot/issues/15
  const completion = item.status === "completed" ? item.completion : undefined;
  const presentation = completion
    ? COMPLETION_PRESENTATION[completion.kind]
    : STATUS_PRESENTATION[item.status];
  const StatusIcon = presentation.icon;

  return (
    <li aria-busy={pendingKind !== undefined || undefined} className="tw-list-none">
      <Card className="tw-border-solid tw-bg-transparent tw-shadow-none">
        <CardHeader className="tw-p-4">
          <CardTitle className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              <StatusIcon
                aria-hidden="true"
                className={cn("tw-mt-0.5 tw-size-4 tw-shrink-0", presentation.iconClassName)}
              />
              <div className="tw-min-w-0">
                <div className="tw-break-all tw-text-sm">{item.sourceId}</div>
                <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                  <Badge className={cn("tw-shadow-none", presentation.badgeClassName)}>
                    {presentation.label}
                  </Badge>
                  <span className="tw-text-xs tw-font-normal tw-text-muted">
                    Durable stage: {formatStage(item.durableStage)}
                  </span>
                </div>
              </div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
              {/* Scope paid execution to the confirmed row without waking the whole queue.
                  https://github.com/yydspanda/obsidian-copilot/issues/18 */}
              {item.status === "queued" && item.actions.canRunSelected && (
                <Button
                  aria-expanded={confirmationKind === "run_selected"}
                  aria-label={`Run only ${item.sourceId}`}
                  disabled={busy || !selectedRunAvailable}
                  size="sm"
                  variant="default"
                  onClick={() => onBeginConfirmation(item.id, "run_selected")}
                >
                  <Play aria-hidden="true" className="tw-size-3" />
                  Run only this material
                </Button>
              )}
              {item.actions.canReview && (
                <Button
                  aria-label={`Review ${item.sourceId}`}
                  disabled={busy}
                  size="sm"
                  variant="default"
                  onClick={() => onReviewJob(item.id)}
                >
                  <Eye aria-hidden="true" className="tw-size-3" />
                  Review
                </Button>
              )}
              {item.actions.canRetry && (
                <Button
                  aria-label={`Retry ${item.sourceId}`}
                  disabled={busy || !commandCapabilities.retryJob}
                  size="sm"
                  variant="ghost"
                  onClick={() => onRetryJob(item.id)}
                >
                  <RefreshCw aria-hidden="true" className="tw-size-3" />
                  Retry
                </Button>
              )}
              {item.actions.canCancel && (
                <Button
                  aria-label={`Cancel ${item.sourceId}`}
                  className="tw-text-error hover:tw-text-on-accent"
                  disabled={
                    (busy && pendingKind !== "run_selected") ||
                    selectedRunCancelling ||
                    !commandCapabilities.cancelJob
                  }
                  size="sm"
                  variant="ghost"
                  onClick={() => onCancelJob(item.id)}
                >
                  <XCircle aria-hidden="true" className="tw-size-3" />
                  Cancel
                </Button>
              )}
              {/* Only Runtime-admitted completed work may acquire a fresh explicit queue request.
                  https://github.com/yydspanda/obsidian-copilot/issues/16 */}
              {item.status === "completed" && item.actions.canReanalyze && (
                <Button
                  aria-expanded={confirmationKind === "reanalyze"}
                  aria-label={`Reanalyze ${item.sourceId}`}
                  disabled={busy || !reanalysisAvailable}
                  size="sm"
                  variant="ghost"
                  onClick={() => onBeginConfirmation(item.id, "reanalyze")}
                >
                  <RefreshCw aria-hidden="true" className="tw-size-3" />
                  Reanalyze
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-space-y-2 tw-p-4 tw-pt-0">
          <p className="tw-m-0 tw-text-xs tw-text-muted">
            {item.pausedReason ?? presentation.detail}
          </p>
          <CompletionDetails completion={completion} />
          <FailureDetails item={item} />
          {pendingKind && (
            <p aria-live="polite" className="tw-m-0 tw-text-xs tw-text-muted" role="status">
              {selectedRunCancelling
                ? "Cancelling this material… Other materials remain paused."
                : pendingKind === "run_selected"
                  ? "Running only this material… Other materials remain paused."
                  : "Queuing reanalysis…"}
            </p>
          )}
          {confirmationKind && (
            <div
              aria-describedby={confirmationDetailId}
              aria-labelledby={confirmationTitleId}
              className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-3"
              role="alertdialog"
            >
              <p className="tw-m-0 tw-text-sm tw-font-semibold" id={confirmationTitleId}>
                {confirmationKind === "run_selected"
                  ? "Run only this material?"
                  : "Reanalyze this material?"}
              </p>
              <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted" id={confirmationDetailId}>
                {confirmationKind === "run_selected"
                  ? "This runs analysis and generation with the configured model and may incur charges. Other materials stay paused. Wiki files are not changed automatically; any proposed changes still need Review and Apply."
                  : "Reanalysis uses the configured model and may incur charges. Your existing history and Wiki files are preserved. This only queues new work; use Run only this material on its queued row to start it alone. Resume bundle starts all eligible materials. Any proposed Wiki changes still need review."}
              </p>
              <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
                <Button disabled={busy} size="sm" onClick={onConfirm}>
                  {confirmationKind === "run_selected" ? "Run this material" : "Queue reanalysis"}
                </Button>
                <Button disabled={busy} size="sm" variant="ghost" onClick={onCancelConfirmation}>
                  {confirmationKind === "run_selected" ? "Not now" : "Cancel reanalysis"}
                </Button>
              </div>
            </div>
          )}
          <div className="tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-1 tw-text-xs tw-text-faint">
            <span>Attempt {item.attempt}</span>
            <span>Input revision {item.inputRevision}</span>
            <ActivityTime label="Updated" timestamp={item.updatedAt} />
            {item.nextAttemptAt !== undefined && (
              <ActivityTime label="Next attempt" timestamp={item.nextAttemptAt} />
            )}
            {item.rerunRequested && <span>Newer source revision queued</span>}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * Presents immutable personal-knowledge queue activity and delegates every
 * mutation request through caller-owned callbacks.
 *
 * @param props - Activity model and command callbacks
 * @returns Pure Activity panel
 */
export function KnowledgeActivityPanel({
  model,
  commandCapabilities,
  onPauseBundle,
  onResumeBundle,
  onCancelJob,
  onRetryJob,
  onReviewJob,
  onReanalyzeJob,
  onRunSelectedJob,
  runningSelectedJobId,
  selectedRunCancelling = false,
  busy = false,
}: KnowledgeActivityPanelProps) {
  const hasAnyJobs = model.counts.total > 0;
  const hasVisibleJobs = model.items.length > 0;
  const [confirmation, setConfirmation] = React.useState<MaterialConfirmation>();
  const [pending, setPending] = React.useState<MaterialConfirmation>();
  const [failedKind, setFailedKind] = React.useState<MaterialConfirmation["kind"]>();
  const pendingRef = React.useRef(false);
  const invalidatedConfirmationRef = React.useRef<MaterialConfirmation>();
  // Resume and competing row mutations must wait for the exact queued request to settle.
  // https://github.com/yydspanda/obsidian-copilot/issues/16
  const commandPending = busy || pending !== undefined;
  const reanalysisAvailable = commandCapabilities.reanalyzeJob === true && !!onReanalyzeJob;
  const selectedRunAvailable = commandCapabilities.runSelectedJob === true && !!onRunSelectedJob;
  // Paid-work confirmation belongs to one visible revision, never a refreshed or replaced row.
  // https://github.com/yydspanda/obsidian-copilot/issues/18
  const confirmationMatches =
    confirmation !== undefined &&
    confirmation.bundleId === model.bundleId &&
    confirmation.revision === model.revision &&
    model.items.some(
      (item) =>
        item.id === confirmation.jobId &&
        (confirmation.kind === "run_selected"
          ? selectedRunAvailable && item.status === "queued" && item.actions.canRunSelected
          : reanalysisAvailable && item.status === "completed" && item.actions.canReanalyze)
    );
  if (confirmation && !confirmationMatches) invalidatedConfirmationRef.current = confirmation;
  const activeConfirmation =
    confirmationMatches && invalidatedConfirmationRef.current !== confirmation
      ? confirmation
      : undefined;

  const confirmMaterial = async (): Promise<void> => {
    // Block repeated clicks before React renders the pending state; no implicit model retries.
    // https://github.com/yydspanda/obsidian-copilot/issues/16
    if (pendingRef.current || busy || !activeConfirmation) return;
    const action = activeConfirmation.kind === "run_selected" ? onRunSelectedJob : onReanalyzeJob;
    if (!action) return;
    pendingRef.current = true;
    setPending(activeConfirmation);
    setConfirmation(undefined);
    setFailedKind(undefined);
    try {
      if (activeConfirmation.kind === "run_selected") {
        await onRunSelectedJob!(activeConfirmation.jobId, activeConfirmation.revision);
      } else {
        await onReanalyzeJob!(activeConfirmation.jobId);
      }
    } catch {
      // Adapter failures may contain provider details; keep this local fallback content-free.
      // https://github.com/yydspanda/obsidian-copilot/issues/16
      setFailedKind(activeConfirmation.kind);
    } finally {
      pendingRef.current = false;
      setPending(undefined);
    }
  };

  return (
    <section aria-labelledby="knowledge-activity-title" className="tw-space-y-4">
      <div>
        <h2 id="knowledge-activity-title" className="tw-m-0 tw-text-base tw-font-semibold">
          Knowledge activity
        </h2>
        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
          Durable ingest progress for bundle {model.bundleId} · revision {model.revision}
        </p>
      </div>

      <BundleControls
        busy={commandPending}
        commandCapabilities={commandCapabilities}
        model={model}
        onPauseBundle={onPauseBundle}
        onResumeBundle={onResumeBundle}
      />
      <ActivityCounts model={model} />
      {failedKind && (
        <p
          className="tw-m-0 tw-rounded-md tw-bg-error tw-p-3 tw-text-xs tw-text-error"
          role="alert"
        >
          {failedKind === "run_selected"
            ? "Selected material could not be run. Check its Activity outcome before trying again."
            : "Reanalysis could not be queued. Refresh Activity before trying again."}
        </p>
      )}

      {!hasVisibleJobs && (
        <div
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
          role="status"
        >
          <CircleDashed aria-hidden="true" className="tw-mx-auto tw-size-6 tw-text-muted" />
          <p className="tw-m-0 tw-mt-2 tw-text-sm tw-font-medium">
            {hasAnyJobs ? "No recent activity to display" : "No knowledge activity yet"}
          </p>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
            {hasAnyJobs
              ? "Terminal history exists outside the current display limit."
              : "Ingested sources will appear here once work is queued."}
          </p>
        </div>
      )}

      {hasVisibleJobs && (
        <ul aria-label="Knowledge ingest jobs" className="tw-m-0 tw-space-y-2 tw-p-0">
          {model.items.map((item) => (
            <ActivityItem
              key={item.id}
              commandCapabilities={commandCapabilities}
              busy={commandPending}
              confirmationKind={
                activeConfirmation?.jobId === item.id ? activeConfirmation.kind : undefined
              }
              item={item}
              reanalysisAvailable={reanalysisAvailable}
              selectedRunAvailable={selectedRunAvailable}
              pendingKind={
                runningSelectedJobId === item.id
                  ? "run_selected"
                  : pending?.jobId === item.id
                    ? pending.kind
                    : undefined
              }
              selectedRunCancelling={selectedRunCancelling && runningSelectedJobId === item.id}
              onBeginConfirmation={(jobId, kind) =>
                setConfirmation({ bundleId: model.bundleId, revision: model.revision, jobId, kind })
              }
              onCancelConfirmation={() => setConfirmation(undefined)}
              onConfirm={() => void confirmMaterial()}
              onCancelJob={onCancelJob}
              onRetryJob={onRetryJob}
              onReviewJob={onReviewJob}
            />
          ))}
        </ul>
      )}

      {model.counts.hiddenTerminal > 0 && (
        <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
          {model.counts.hiddenTerminal} older terminal{" "}
          {model.counts.hiddenTerminal === 1 ? "job is" : "jobs are"} hidden by the Activity history
          limit.
        </p>
      )}
    </section>
  );
}
