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

/** Callback-only boundary for the Activity panel. */
export interface KnowledgeActivityPanelProps {
  model: Readonly<KnowledgeActivityModel>;
  commandCapabilities: Readonly<
    Pick<
      KnowledgeStudioCommandCapabilities,
      "pauseBundle" | "resumeBundle" | "cancelJob" | "retryJob"
    >
  >;
  onPauseBundle: () => void;
  onResumeBundle: () => void;
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onReviewJob: (jobId: string) => void;
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
    detail: "The queue finished this input and no durable commit acknowledgement remains pending.",
    icon: CheckCircle2,
    badgeClassName: "tw-bg-success",
    iconClassName: "tw-text-success",
  },
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
}: Pick<
  KnowledgeActivityPanelProps,
  "model" | "commandCapabilities" | "onPauseBundle" | "onResumeBundle"
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
                disabled={!commandCapabilities.pauseBundle}
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
                disabled={!commandCapabilities.resumeBundle}
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
}: {
  item: Readonly<KnowledgeActivityItem>;
  commandCapabilities: KnowledgeActivityPanelProps["commandCapabilities"];
  onCancelJob: KnowledgeActivityPanelProps["onCancelJob"];
  onRetryJob: KnowledgeActivityPanelProps["onRetryJob"];
  onReviewJob: KnowledgeActivityPanelProps["onReviewJob"];
}) {
  const presentation = STATUS_PRESENTATION[item.status];
  const StatusIcon = presentation.icon;

  return (
    <li className="tw-list-none">
      <Card className="tw-border-solid tw-bg-transparent tw-shadow-none">
        <CardHeader className="tw-p-4">
          <CardTitle className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              <StatusIcon
                aria-hidden="true"
                className={`tw-mt-0.5 tw-size-4 tw-shrink-0 ${presentation.iconClassName}`}
              />
              <div className="tw-min-w-0">
                <div className="tw-break-all tw-text-sm">{item.sourceId}</div>
                <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                  <Badge className={`tw-shadow-none ${presentation.badgeClassName}`}>
                    {presentation.label}
                  </Badge>
                  <span className="tw-text-xs tw-font-normal tw-text-muted">
                    Durable stage: {formatStage(item.durableStage)}
                  </span>
                </div>
              </div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
              {item.actions.canReview && (
                <Button
                  aria-label={`Review ${item.sourceId}`}
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
                  disabled={!commandCapabilities.retryJob}
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
                  disabled={!commandCapabilities.cancelJob}
                  size="sm"
                  variant="ghost"
                  onClick={() => onCancelJob(item.id)}
                >
                  <XCircle aria-hidden="true" className="tw-size-3" />
                  Cancel
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-space-y-2 tw-p-4 tw-pt-0">
          <p className="tw-m-0 tw-text-xs tw-text-muted">
            {item.pausedReason ?? presentation.detail}
          </p>
          <FailureDetails item={item} />
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
}: KnowledgeActivityPanelProps) {
  const hasAnyJobs = model.counts.total > 0;
  const hasVisibleJobs = model.items.length > 0;

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
        commandCapabilities={commandCapabilities}
        model={model}
        onPauseBundle={onPauseBundle}
        onResumeBundle={onResumeBundle}
      />
      <ActivityCounts model={model} />

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
              item={item}
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
