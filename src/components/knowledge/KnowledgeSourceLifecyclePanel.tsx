import * as React from "react";
import { AlertTriangle, FileCheck2, FileWarning, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  KnowledgeSourceLifecycleIssueReason,
  KnowledgeSourceLifecycleItem,
  KnowledgeSourceLifecycleModel,
  KnowledgeSourceRemovalConfirmation,
} from "@/knowledge/ui/sourceLifecycleModel";

/** Async-or-sync callback result accepted by the UI-only command boundary. */
type KnowledgeSourceLifecycleCommandResult = void | Promise<void>;

/** Callback-only boundary for source lifecycle requests. */
export interface KnowledgeSourceLifecyclePanelProps {
  model: Readonly<KnowledgeSourceLifecycleModel>;
  onCheckAgain: (sourceId: string, signal: AbortSignal) => KnowledgeSourceLifecycleCommandResult;
  onRemove: (
    confirmation: Readonly<KnowledgeSourceRemovalConfirmation>,
    signal: AbortSignal
  ) => KnowledgeSourceLifecycleCommandResult;
}

type PendingActionKind = "check" | "remove";

interface PendingAction {
  kind: PendingActionKind;
  sourceId: string;
}

interface ActionFeedback {
  kind: "error";
  message: string;
}

const ISSUE_DETAILS: Readonly<Record<KnowledgeSourceLifecycleIssueReason, string>> = {
  source_missing: "The registered file is not present at its exact Vault path.",
  source_deleted: "A source delete event revoked this source's current ingest authority.",
  source_renamed: "A source rename event revoked this source's current path authority.",
};

const ERROR_MESSAGES: Readonly<Record<PendingActionKind, string>> = {
  check: "The source could not be checked. No source state was assumed.",
  remove: "The removal request could not be completed.",
};

/** Returns the stable visible label for one source custody mode. */
function getCustodyLabel(custody: KnowledgeSourceLifecycleItem["custody"]): string {
  return custody === "managed_copy" ? "Managed copy" : "User managed";
}

/** Returns the pending label for one row or undefined when another row owns work. */
function getPendingLabel(pending: PendingAction | undefined, sourceId: string): string | undefined {
  if (pending?.sourceId !== sourceId) return undefined;
  switch (pending.kind) {
    case "check":
      return "Checking source…";
    case "remove":
      return "Submitting removal…";
  }
}

interface SourceLifecycleRowProps {
  source: Readonly<KnowledgeSourceLifecycleItem>;
  pending: PendingAction | undefined;
  confirmation?: Readonly<KnowledgeSourceRemovalConfirmation>;
  onBeginRemove: (source: Readonly<KnowledgeSourceLifecycleItem>) => void;
  onCancelRemove: () => void;
  onConfirmRemove: (confirmation: Readonly<KnowledgeSourceRemovalConfirmation>) => void;
  onCheckAgain: (sourceId: string) => void;
}

/** Renders one active source row without acquiring durable write authority. */
function SourceLifecycleRow({
  source,
  pending,
  confirmation,
  onBeginRemove,
  onCancelRemove,
  onConfirmRemove,
  onCheckAgain,
}: SourceLifecycleRowProps): React.ReactElement {
  const confirmationTitleId = React.useId();
  const confirmationDetailId = React.useId();
  const missing = source.status === "missing";
  const commandPending = pending !== undefined;
  const rowPending = pending?.sourceId === source.sourceId;
  const pendingLabel = getPendingLabel(pending, source.sourceId);
  const StatusIcon = missing ? FileWarning : FileCheck2;
  const confirmationOpen = confirmation !== undefined;

  return (
    <li aria-busy={rowPending || undefined} className="tw-list-none">
      <Card className="tw-border-solid tw-bg-transparent tw-shadow-none">
        <CardHeader className="tw-p-4">
          <CardTitle className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              <StatusIcon
                aria-hidden="true"
                className={`tw-mt-0.5 tw-size-4 tw-shrink-0 ${
                  missing ? "tw-text-error" : "tw-text-success"
                }`}
              />
              <div className="tw-min-w-0">
                <div className="tw-break-all tw-text-sm">{source.sourcePath}</div>
                <div className="tw-mt-1 tw-flex tw-flex-wrap tw-gap-1">
                  <Badge variant={missing ? "destructive" : "secondary"}>
                    {missing ? "Missing" : "Ready"}
                  </Badge>
                  <Badge variant="outline">{getCustodyLabel(source.custody)}</Badge>
                </div>
              </div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
              {missing && source.actions.canCheckAgain ? (
                <Button
                  aria-label={`Check again ${source.sourceId}`}
                  disabled={commandPending}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onCheckAgain(source.sourceId)}
                >
                  {rowPending && pending?.kind === "check" ? (
                    <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="tw-size-3" />
                  )}
                  Check again
                </Button>
              ) : null}
              {source.actions.canRemove ? (
                <Button
                  aria-expanded={confirmationOpen}
                  aria-label={`Remove source ${source.sourceId}`}
                  disabled={commandPending}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => onBeginRemove(source)}
                >
                  {rowPending && pending?.kind === "remove" ? (
                    <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="tw-size-3" />
                  )}
                  Remove
                </Button>
              ) : null}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-space-y-3 tw-p-4 tw-pt-0">
          <div className="tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-1 tw-text-xs tw-text-faint">
            <span>Source {source.sourceId}</span>
            <span>
              {source.generatedPageCount} generated{" "}
              {source.generatedPageCount === 1 ? "page" : "pages"}
            </span>
          </div>
          {!source.actions.canRemove && source.retirementBlockers.length > 0 ? (
            <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
              Removal is currently unavailable. Clear pending Activity, Review, or Recovery work,
              then check again.
            </p>
          ) : null}
          {missing ? (
            <div className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-xs tw-text-error" role="alert">
              <p className="tw-m-0 tw-font-medium">{ISSUE_DETAILS[source.issueReason]}</p>
              <p className="tw-m-0 tw-mt-1">
                Ingest and Review are stopped for this source, and its Query citations are
                unavailable until a fresh durable check succeeds.
              </p>
              <p className="tw-m-0 tw-mt-1">
                Restore the file to this exact Vault path, then choose Check again; or Remove the
                source from future knowledge work.
              </p>
            </div>
          ) : (
            <p className="tw-m-0 tw-text-xs tw-text-muted">
              The exact registered Vault path is currently available.
            </p>
          )}
          {pendingLabel ? (
            <div
              aria-live="polite"
              className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-muted"
              role="status"
            >
              <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
              {pendingLabel}
            </div>
          ) : null}
          {confirmationOpen ? (
            <div
              aria-describedby={confirmationDetailId}
              aria-labelledby={confirmationTitleId}
              className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-3"
              role="alertdialog"
            >
              <div className="tw-flex tw-items-start tw-gap-2">
                <AlertTriangle
                  aria-hidden="true"
                  className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error"
                />
                <div className="tw-min-w-0">
                  <p className="tw-m-0 tw-text-sm tw-font-semibold" id={confirmationTitleId}>
                    Remove this source?
                  </p>
                  <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted" id={confirmationDetailId}>
                    If removal succeeds, future ingest, Review, and Query citations for this source
                    stop. Generated Wiki files are not deleted. Pending work or Recovery may block
                    this request.
                  </p>
                  <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
                    <Button
                      aria-label={`Confirm removal ${source.sourceId}`}
                      disabled={commandPending}
                      size="sm"
                      type="button"
                      variant="destructive"
                      onClick={() => confirmation && onConfirmRemove(confirmation)}
                    >
                      Confirm removal
                    </Button>
                    <Button
                      aria-label={`Keep source ${source.sourceId}`}
                      disabled={commandPending}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={onCancelRemove}
                    >
                      Keep source
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * Presents every active source and delegates lifecycle requests to narrow callbacks.
 *
 * This component never reads, copies, registers, retires, or deletes a source.
 * Retirement uses one exact revision-bound confirmation captured from the model.
 *
 * @param props - Immutable model and revocable command callbacks
 * @returns Accessible source inventory with fail-closed lifecycle controls
 */
export function KnowledgeSourceLifecyclePanel({
  model,
  onCheckAgain,
  onRemove,
}: KnowledgeSourceLifecyclePanelProps): React.ReactElement {
  const mountedRef = React.useRef(true);
  const pendingRef = React.useRef<PendingAction>();
  const abortControllerRef = React.useRef<AbortController>();
  const [pending, setPending] = React.useState<PendingAction>();
  const [confirmation, setConfirmation] =
    React.useState<Readonly<KnowledgeSourceRemovalConfirmation>>();
  const invalidatedConfirmationsRef = React.useRef(
    new WeakSet<Readonly<KnowledgeSourceRemovalConfirmation>>()
  );
  const [feedback, setFeedback] = React.useState<ActionFeedback>();

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = undefined;
      pendingRef.current = undefined;
    };
  }, []);

  /** Runs exactly one callback under a panel-owned abort signal. */
  const runAction = React.useCallback(
    async (
      kind: PendingActionKind,
      sourceId: string,
      operation: (signal: AbortSignal) => KnowledgeSourceLifecycleCommandResult
    ): Promise<void> => {
      if (!mountedRef.current || pendingRef.current !== undefined) return;
      const nextPending = { kind, sourceId } as const;
      const controller = new AbortController();
      pendingRef.current = nextPending;
      abortControllerRef.current = controller;
      setFeedback(undefined);
      setPending(nextPending);

      try {
        await operation(controller.signal);
      } catch {
        if (!mountedRef.current || controller.signal.aborted) return;
        setFeedback({ kind: "error", message: ERROR_MESSAGES[kind] });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = undefined;
        }
        if (pendingRef.current === nextPending) {
          pendingRef.current = undefined;
          if (mountedRef.current) setPending(undefined);
        }
      }
    },
    []
  );

  /** Starts one exact source recheck without passing paths or model objects. */
  const checkAgain = React.useCallback(
    (sourceId: string): void => {
      void runAction("check", sourceId, (signal) => onCheckAgain(sourceId, signal));
    },
    [onCheckAgain, runAction]
  );

  /** Freezes the exact row and revision authority that opened removal confirmation. */
  const beginRemove = React.useCallback(
    (source: Readonly<KnowledgeSourceLifecycleItem>): void => {
      setConfirmation(
        Object.freeze({
          sourceId: source.sourceId,
          sourcePath: source.sourcePath,
          retirementRef: source.retirementRef,
          runtimeRevision: model.runtimeRevision,
          manifestRevision: model.manifestRevision,
        })
      );
    },
    [model.manifestRevision, model.runtimeRevision]
  );

  /** Completes the second removal confirmation with its frozen authority token. */
  const confirmRemove = React.useCallback(
    (confirmed: Readonly<KnowledgeSourceRemovalConfirmation>): void => {
      setConfirmation(undefined);
      void runAction("remove", confirmed.sourceId, (signal) => onRemove(confirmed, signal));
    },
    [onRemove, runAction]
  );

  const confirmedSource = confirmation
    ? model.sources.find((source) => source.sourceId === confirmation.sourceId)
    : undefined;
  const confirmationMatches =
    confirmation !== undefined &&
    confirmedSource !== undefined &&
    model.runtimeRevision === confirmation.runtimeRevision &&
    model.manifestRevision === confirmation.manifestRevision &&
    confirmedSource.sourcePath === confirmation.sourcePath &&
    confirmedSource.retirementRef === confirmation.retirementRef &&
    confirmedSource.actions.canRemove === true;
  if (confirmation && !confirmationMatches) {
    invalidatedConfirmationsRef.current.add(confirmation);
  }
  const activeConfirmation =
    confirmationMatches && confirmation && !invalidatedConfirmationsRef.current.has(confirmation)
      ? confirmation
      : undefined;

  return (
    <section aria-labelledby="knowledge-source-lifecycle-heading" className="tw-space-y-4">
      <header>
        <h2
          className="tw-m-0 tw-text-base tw-font-semibold"
          id="knowledge-source-lifecycle-heading"
        >
          Knowledge sources
        </h2>
        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
          Bundle {model.bundleId} · runtime revision {model.runtimeRevision} · manifest revision{" "}
          {model.manifestRevision}
        </p>
      </header>

      {feedback ? (
        <div
          aria-live="polite"
          className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-xs tw-text-error"
          role="alert"
        >
          {feedback.message}
        </div>
      ) : null}

      {model.sources.length === 0 ? (
        <div
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
          role="status"
        >
          <p className="tw-m-0 tw-text-sm tw-font-medium">No active sources</p>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
            This snapshot does not contain a registered active source.
          </p>
        </div>
      ) : (
        <ul aria-label="Active knowledge sources" className="tw-m-0 tw-space-y-3 tw-p-0">
          {model.sources.map((source) => (
            <SourceLifecycleRow
              key={source.sourceId}
              confirmation={
                activeConfirmation?.sourceId === source.sourceId ? activeConfirmation : undefined
              }
              pending={pending}
              source={source}
              onBeginRemove={beginRemove}
              onCancelRemove={() => setConfirmation(undefined)}
              onCheckAgain={checkAgain}
              onConfirmRemove={confirmRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
