import * as React from "react";
import {
  AlertTriangle,
  CirclePlay,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  KnowledgeRecoveryItem,
  KnowledgeRecoveryModel,
  KnowledgeRecoveryStatus,
} from "@/knowledge/ui/recoveryModel";

/** Callback-only boundary for the recovery panel. */
export interface KnowledgeRecoveryPanelProps {
  model: Readonly<KnowledgeRecoveryModel>;
  pendingRecoveryId?: string;
  onContinue: (recoveryId: string) => void;
  onAbandon: (recoveryId: string) => void;
  onRefresh: () => void;
}

interface RecoveryPresentation {
  label: string;
  detail: string;
  icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
}

const RECOVERY_PRESENTATION: Readonly<Record<KnowledgeRecoveryStatus, RecoveryPresentation>> = {
  accepted_not_started: {
    label: "Accepted, not started",
    detail: "The review is accepted, but its apply claim has not been started.",
    icon: CirclePlay,
    iconClassName: "tw-text-warning",
    badgeClassName: "tw-bg-primary-alt",
  },
  decision_required: {
    label: "Decision required",
    detail:
      "The apply claim exists without a transaction journal. Continue after rechecking, or abandon it before writes start.",
    icon: AlertTriangle,
    iconClassName: "tw-text-warning",
    badgeClassName: "tw-bg-error",
  },
  transaction_active: {
    label: "Transaction active",
    detail: "A durable transaction is in progress. Recheck its persisted state before proceeding.",
    icon: Loader2,
    iconClassName: "tw-animate-spin tw-text-accent",
    badgeClassName: "tw-bg-primary-alt",
  },
  apply_blocked: {
    label: "Apply blocked",
    detail: "Automatic writes remain blocked until the durable transaction state changes.",
    icon: ShieldAlert,
    iconClassName: "tw-text-error",
    badgeClassName: "tw-bg-error",
  },
  commit_finalizing: {
    label: "Commit finalizing",
    detail: "Wiki changes are committed while their durable acknowledgement is still finalizing.",
    icon: RefreshCw,
    iconClassName: "tw-animate-spin tw-text-warning",
    badgeClassName: "tw-bg-primary-alt",
  },
  global_transaction: {
    label: "Global transaction",
    detail: "A Vault-wide transaction is active and blocks new apply work.",
    icon: ShieldAlert,
    iconClassName: "tw-text-warning",
    badgeClassName: "tw-bg-secondary-alt",
  },
  queue_recovery_required: {
    label: "Queue recovery required",
    detail: "The ingest queue is paused because transaction recovery is required.",
    icon: ShieldAlert,
    iconClassName: "tw-text-error",
    badgeClassName: "tw-bg-error",
  },
  queue_commit_pending_ack: {
    label: "Queue commit pending",
    detail: "The ingest queue is paused until the committed transaction is acknowledged.",
    icon: Clock3,
    iconClassName: "tw-text-warning",
    badgeClassName: "tw-bg-primary-alt",
  },
};

/**
 * Resolves the safe visible detail for one recovery item.
 *
 * @param item - Opaque recovery row
 * @returns Human-readable detail without adding recovery authority
 */
function getRecoveryDetail(item: Readonly<KnowledgeRecoveryItem>): string {
  // https://github.com/yydspanda/obsidian-copilot/issues/2
  // A changed Knowledge read-set makes retry misleading, so the row explains the only safe exit.
  if (item.continueBlockedReason === "manifest_read_set_changed") {
    return "Knowledge changed since this proposal was generated, so Continue cannot safely succeed. Abandon this outdated proposal, then generate and review a fresh one. This Apply did not write any Wiki files.";
  }
  if (item.status !== "apply_blocked") return RECOVERY_PRESENTATION[item.status].detail;
  if (item.blockedReason === "transaction_recovery_required") {
    return "The transaction requires explicit recovery. Automatic writes remain blocked.";
  }
  if (item.blockedReason === "other_transaction_active") {
    return "Another transaction owns the global write slot. Automatic writes remain blocked.";
  }
  return RECOVERY_PRESENTATION.apply_blocked.detail;
}

/**
 * Reports whether the status may expose an explicit continue command.
 *
 * @param item - Recovery row and action hints
 * @returns True only for a model-authorized no-journal state
 */
function canContinue(item: Readonly<KnowledgeRecoveryItem>): boolean {
  return (
    (item.status === "accepted_not_started" || item.status === "decision_required") &&
    item.actions.canContinue
  );
}

/**
 * Reports whether the status may expose an explicit abandon command.
 *
 * @param item - Recovery row and action hints
 * @returns True only for a model-authorized decision-required state
 */
function canAbandon(item: Readonly<KnowledgeRecoveryItem>): boolean {
  return item.status === "decision_required" && item.actions.canAbandon;
}

/**
 * Renders one content-free recovery row and only its permitted actions.
 *
 * @param props - Recovery item, pending identity, and callbacks
 * @returns One accessible recovery list item
 */
function RecoveryItem({
  item,
  pendingRecoveryId,
  onContinue,
  onAbandon,
  onRefresh,
}: {
  item: Readonly<KnowledgeRecoveryItem>;
  pendingRecoveryId?: string;
  onContinue: KnowledgeRecoveryPanelProps["onContinue"];
  onAbandon: KnowledgeRecoveryPanelProps["onAbandon"];
  onRefresh: KnowledgeRecoveryPanelProps["onRefresh"];
}) {
  const presentation = RECOVERY_PRESENTATION[item.status];
  const StatusIcon = presentation.icon;
  const continueAllowed = canContinue(item);
  const abandonAllowed = canAbandon(item);
  const hasDecisionAction = continueAllowed || abandonAllowed;
  const commandPending = pendingRecoveryId !== undefined;
  const rowPending = pendingRecoveryId === item.id;

  return (
    <li aria-busy={rowPending || undefined} className="tw-list-none">
      <Card className="tw-border-solid tw-bg-transparent tw-shadow-none">
        <CardHeader className="tw-p-4">
          <CardTitle className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              <StatusIcon
                aria-hidden="true"
                className={`tw-mt-0.5 tw-size-4 tw-shrink-0 ${presentation.iconClassName}`}
              />
              <div className="tw-min-w-0">
                <div className="tw-break-all tw-text-sm">Recovery {item.id}</div>
                <Badge className={`tw-mt-1 tw-shadow-none ${presentation.badgeClassName}`}>
                  {presentation.label}
                </Badge>
              </div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
              {continueAllowed && (
                <Button
                  aria-label={`Continue ${item.id}`}
                  disabled={commandPending}
                  size="sm"
                  type="button"
                  variant="default"
                  onClick={() => onContinue(item.id)}
                >
                  {rowPending && (
                    <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
                  )}
                  Continue
                </Button>
              )}
              {abandonAllowed && (
                <Button
                  aria-label={`Abandon ${item.id}`}
                  disabled={commandPending}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => onAbandon(item.id)}
                >
                  {rowPending && (
                    <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
                  )}
                  Abandon
                </Button>
              )}
              {!hasDecisionAction && (
                <Button
                  aria-label={`Check again ${item.id}`}
                  disabled={commandPending}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onRefresh()}
                >
                  {rowPending ? (
                    <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="tw-size-3" />
                  )}
                  Check again
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-space-y-2 tw-p-4 tw-pt-0">
          <p className="tw-m-0 tw-text-xs tw-text-muted">{getRecoveryDetail(item)}</p>
          <div className="tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-1 tw-text-xs tw-text-faint">
            {item.changeSetId !== undefined && <span>Change set {item.changeSetId}</span>}
            {item.transactionId !== undefined && <span>Transaction {item.transactionId}</span>}
            {item.phase !== undefined && <span>Phase {item.phase}</span>}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * Presents immutable recovery state without owning any transaction authority.
 *
 * Continue and Abandon are rendered only for exact model-authorized no-journal
 * states. Active, blocked, finalizing, global, and Queue blockers can only ask
 * the caller to re-read durable state; this panel never fabricates rollback.
 *
 * @param props - Recovery model, pending command identity, and callbacks
 * @returns Pure recovery panel
 */
export function KnowledgeRecoveryPanel({
  model,
  pendingRecoveryId,
  onContinue,
  onAbandon,
  onRefresh,
}: KnowledgeRecoveryPanelProps) {
  return (
    <section aria-labelledby="knowledge-recovery-title" className="tw-space-y-4">
      <div>
        <h2 id="knowledge-recovery-title" className="tw-m-0 tw-text-base tw-font-semibold">
          Knowledge recovery
        </h2>
        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
          Durable recovery state for bundle {model.bundleId} · runtime revision{" "}
          {model.runtimeRevision}
        </p>
      </div>

      {model.items.length === 0 ? (
        <div
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
          role="status"
        >
          <p className="tw-m-0 tw-text-sm tw-font-medium">
            No recovery action is currently required
          </p>
          <Button
            className="tw-mt-3"
            disabled={pendingRecoveryId !== undefined}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => onRefresh()}
          >
            <RefreshCw aria-hidden="true" className="tw-size-3" />
            Check again
          </Button>
        </div>
      ) : (
        <ul aria-label="Knowledge recovery items" className="tw-m-0 tw-space-y-2 tw-p-0">
          {model.items.map((item) => (
            <RecoveryItem
              key={item.id}
              item={item}
              onAbandon={onAbandon}
              onContinue={onContinue}
              onRefresh={onRefresh}
              pendingRecoveryId={pendingRecoveryId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
