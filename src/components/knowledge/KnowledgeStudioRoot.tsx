import * as React from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Files,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { KnowledgeActivityPanel } from "@/components/knowledge/KnowledgeActivityPanel";
import { KnowledgeFolderImportButton } from "@/components/knowledge/KnowledgeFolderImportButton";
import { KnowledgeRecoveryPanel } from "@/components/knowledge/KnowledgeRecoveryPanel";
import { KnowledgeReviewPanel } from "@/components/knowledge/KnowledgeReviewPanel";
import { KnowledgeQueryPanel } from "@/components/knowledge/KnowledgeQueryPanel";
import { KnowledgeSetupPanel } from "@/components/knowledge/KnowledgeSetupPanel";
import { KnowledgeSourceLifecyclePanel } from "@/components/knowledge/KnowledgeSourceLifecyclePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KnowledgeDiagnostic } from "@/knowledge/model/types";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import type { KnowledgeReviewPlan } from "@/knowledge/review/ReviewDecision";
import type { KnowledgeForwardRevisionStudioReview } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";
import type { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";
import type {
  KnowledgeStudioController,
  KnowledgeStudioFeedback,
  KnowledgeStudioPendingAction,
  KnowledgeStudioState,
  KnowledgeStudioTab,
} from "@/knowledge/ui/KnowledgeStudioController";

/** Props for the controller-backed Knowledge Studio React surface. */
export interface KnowledgeStudioRootProps {
  controller: KnowledgeStudioController;
  folderImportPort: KnowledgeFolderImportPort;
  setupReadiness: KnowledgeSetupReadinessStore;
  setupNavigation: KnowledgeSetupNavigationPort;
}

interface TabDefinition {
  id: KnowledgeStudioTab;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

const STUDIO_TABS: readonly TabDefinition[] = [
  { id: "query", label: "Query", icon: Search },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "review", label: "Review", icon: Inbox },
  { id: "sources", label: "Sources", icon: Files },
  { id: "recovery", label: "Recovery", icon: ShieldAlert },
];

const PENDING_ACTION_LABELS: Readonly<Record<KnowledgeStudioPendingAction["kind"], string>> = {
  pause: "Pausing knowledge activity…",
  resume: "Resuming knowledge activity…",
  cancel: "Cancelling the selected job…",
  retry: "Queuing the selected job for retry…",
  submit_review: "Submitting the review decision…",
  submit_forward_revision: "Submitting the forward revision decision…",
  check_source: "Checking the selected source…",
  retire_source: "Removing the selected source…",
  continue_recovery: "Continuing the selected recovery…",
  abandon_recovery: "Abandoning the selected no-journal apply…",
};

/**
 * Subscribes React to one controller without copying or deriving durable state.
 *
 * @param controller - Knowledge Studio external store
 * @returns Current controller-owned state object
 */
function useKnowledgeStudioState(controller: KnowledgeStudioController): KnowledgeStudioState {
  const subscribe = React.useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller]
  );
  const getSnapshot = React.useCallback(() => controller.getState(), [controller]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Renders one deterministic validation diagnostic.
 *
 * @param diagnostic - Sanitized diagnostic supplied by the controller
 * @returns One diagnostic list item
 */
function DiagnosticItem({
  diagnostic,
}: {
  diagnostic: Readonly<KnowledgeDiagnostic>;
}): React.ReactElement {
  return (
    <li className="tw-text-xs">
      <span className="tw-font-semibold">{diagnostic.code}</span>
      <span className="tw-text-muted"> · {diagnostic.field}</span>
      <span>: {diagnostic.message}</span>
    </li>
  );
}

/**
 * Renders command feedback and its optional deterministic diagnostics.
 *
 * @param feedback - Safe controller feedback
 * @returns Feedback banner, or null when no command has reported an outcome
 */
function FeedbackBanner({
  feedback,
}: {
  feedback: KnowledgeStudioFeedback | undefined;
}): React.ReactElement | null {
  if (!feedback) return null;

  const isSuccess = feedback.kind === "success";
  const isBlocked = feedback.kind === "blocked";
  const FeedbackIcon = isSuccess ? CheckCircle2 : isBlocked ? ShieldAlert : AlertCircle;
  const toneClassName = isSuccess ? "tw-bg-success tw-text-success" : "tw-bg-error tw-text-error";

  return (
    <aside
      aria-live="polite"
      className={`tw-rounded-lg tw-p-3 ${toneClassName}`}
      role={isSuccess ? "status" : "alert"}
    >
      <div className="tw-flex tw-items-start tw-gap-2">
        <FeedbackIcon aria-hidden="true" className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
        <div className="tw-min-w-0">
          <p className="tw-m-0 tw-text-sm tw-font-medium">{feedback.message}</p>
          {feedback.diagnostics && feedback.diagnostics.length > 0 ? (
            <ul
              aria-label="Validation diagnostics"
              className="tw-mb-0 tw-mt-2 tw-space-y-1 tw-pl-4"
            >
              {feedback.diagnostics.map((diagnostic) => (
                <DiagnosticItem
                  key={`${diagnostic.code}:${diagnostic.severity}:${diagnostic.field}:${diagnostic.message}`}
                  diagnostic={diagnostic}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

/**
 * Renders a non-authoritative progress hint while the controller reconciles.
 *
 * @param state - Current controller state
 * @returns Pending or refreshing banner, or null while settled
 */
function ReconciliationStatus({
  state,
}: {
  state: KnowledgeStudioState;
}): React.ReactElement | null {
  const message = state.pendingAction
    ? PENDING_ACTION_LABELS[state.pendingAction.kind]
    : state.refreshing
      ? "Refreshing durable knowledge state…"
      : undefined;
  if (!message) return null;

  return (
    <div
      aria-live="polite"
      className="tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-bg-secondary-alt tw-p-2 tw-text-xs tw-text-muted"
      role="status"
    >
      <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
      {message}
    </div>
  );
}

/**
 * Renders an adapter or snapshot notice without granting any action capability.
 *
 * @param state - Ready controller state with an optional snapshot notice
 * @returns Fail-closed adapter notice or informational snapshot notice
 */
function SnapshotNotice({ state }: { state: KnowledgeStudioState }): React.ReactElement | null {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const adapterUnavailable = snapshot.availability === "adapter_unavailable";
  if (!adapterUnavailable && !snapshot.notice) return null;

  return (
    <aside
      className={`tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-p-3 tw-text-sm ${
        adapterUnavailable ? "tw-bg-error tw-text-error" : "tw-bg-secondary-alt tw-text-muted"
      }`}
      role={adapterUnavailable ? "alert" : "note"}
    >
      {adapterUnavailable ? (
        <ShieldAlert aria-hidden="true" className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
      ) : (
        <AlertCircle aria-hidden="true" className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
      )}
      <span>
        {snapshot.notice ??
          "Knowledge Studio runtime adapters are unavailable. No files can be changed."}
      </span>
    </aside>
  );
}

/**
 * Renders a load failure while retaining an explicit durable reload action.
 *
 * @param message - Sanitized controller error
 * @param controller - Controller that owns the reload
 * @param fullPage - Whether the error replaces the complete studio surface
 * @returns Error banner with a retry control
 */
function LoadError({
  message,
  controller,
  fullPage,
}: {
  message: string;
  controller: KnowledgeStudioController;
  fullPage: boolean;
}): React.ReactElement {
  return (
    <div
      className={`tw-rounded-lg tw-bg-error tw-p-4 tw-text-error ${fullPage ? "tw-m-auto" : ""}`}
      role="alert"
    >
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
        <div className="tw-flex tw-items-start tw-gap-2">
          <AlertCircle aria-hidden="true" className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
          <span className="tw-text-sm">{message}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void controller.refresh()}>
          <RefreshCw aria-hidden="true" className="tw-size-3" />
          Retry load
        </Button>
      </div>
    </div>
  );
}

/**
 * Finds the review selected by the controller's opaque ChangeSet identity.
 *
 * @param state - Current Knowledge Studio state
 * @returns Selected review from the current snapshot, if it still exists
 */
function getSelectedReview(state: KnowledgeStudioState): Readonly<KnowledgeReviewPlan> | undefined {
  return state.snapshot?.reviews.find(
    (review) => review.changeSetId === state.selectedReviewChangeSetId
  );
}

/** Finds the forward row selected by the controller's opaque product reference. */
function getSelectedForwardRevision(
  state: KnowledgeStudioState
): Readonly<KnowledgeForwardRevisionStudioReview> | undefined {
  return state.snapshot?.forwardRevisionReviews?.find(
    (review) => review.reviewRef === state.selectedForwardRevisionRef
  );
}

/** Returns concise stable text for one forward product state. */
function formatForwardRevisionState(state: KnowledgeForwardRevisionStudioReview["state"]): string {
  switch (state) {
    case "pending":
      return "Needs decision";
    case "accepted_ready":
      return "Accepted · ready to apply";
    case "applying":
      return "Applying";
    case "recovery_required":
      return "Recovery required";
  }
}

/** Renders an accepted or journal-owned forward row without exposing protocol identities. */
function ForwardRevisionStatusPanel({
  review,
  state,
  controller,
}: {
  review: Exclude<KnowledgeForwardRevisionStudioReview, { state: "pending" }>;
  state: KnowledgeStudioState;
  controller: KnowledgeStudioController;
}): React.ReactElement {
  const busy = state.pendingAction !== undefined;
  if (review.state === "accepted_ready") {
    return (
      <section
        aria-label="Accepted forward revision ready to apply"
        className="tw-space-y-3 tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
      >
        <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <h2 className="tw-m-0 tw-text-lg tw-font-semibold">Accepted revision ready to apply</h2>
            <p className="tw-m-0 tw-mt-1 tw-break-all tw-font-mono tw-text-sm">{review.pagePath}</p>
          </div>
          <Badge variant="secondary">Accepted</Badge>
        </div>
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          The Review decision is durable. Validate and apply reruns current deterministic source,
          citation, schema, and exact-file checks before creating a crash-safe journal.
        </p>
        {review.manualOverride ? (
          <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
            This decision contains a manual full-file edit. No model is called to rewrite it.
          </p>
        ) : null}
        <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
          This first release has no abandon or force-apply action. If current validation cannot
          pass, the accepted decision stays visible and no file is overwritten.
        </p>
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          <Button
            disabled={busy || state.snapshot?.commandCapabilities.forwardRevisionReview !== true}
            type="button"
            onClick={() => void controller.applyForwardRevision(review.reviewRef)}
          >
            {busy ? <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" /> : null}
            Validate and apply
          </Button>
          <Button type="button" variant="ghost" onClick={() => controller.selectTab("activity")}>
            Back to activity
          </Button>
        </div>
      </section>
    );
  }
  if (review.state === "applying") {
    return (
      <section
        aria-label="Forward revision applying"
        className="tw-space-y-2 tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
        role="status"
      >
        <div className="tw-flex tw-items-center tw-gap-2">
          <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
          <h2 className="tw-m-0 tw-text-lg tw-font-semibold">Applying accepted revision</h2>
        </div>
        <p className="tw-m-0 tw-break-all tw-font-mono tw-text-sm">{review.pagePath}</p>
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          A durable {review.applyPhase} journal owns this exact file transition. Reload or disable
          cannot turn it back into an unjournaled write. If Apply remains paused, reload the plugin
          to run startup recovery.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Forward revision recovery required"
      className="tw-border-error tw-space-y-2 tw-rounded-xl tw-border tw-border-solid tw-bg-error tw-p-4"
      role="alert"
    >
      <div className="tw-flex tw-items-center tw-gap-2">
        <ShieldAlert aria-hidden="true" className="tw-size-4" />
        <h2 className="tw-m-0 tw-text-lg tw-font-semibold">Forward Apply needs recovery</h2>
      </div>
      <p className="tw-m-0 tw-break-all tw-font-mono tw-text-sm">{review.pagePath}</p>
      <p className="tw-m-0 tw-text-sm">
        The Wiki file no longer matches either exact journal state. Copilot will not overwrite it.
        Startup remains stopped and no automatic retry will overwrite the file. Inspect or restore
        the exact file state, then use the supported recovery workflow before continuing.
      </p>
    </section>
  );
}

/**
 * Renders the review inbox and the exact plan selected by the controller.
 *
 * @param state - Current controller state
 * @param controller - Command/navigation boundary
 * @returns Review tab content
 */
function ReviewWorkspace({
  state,
  controller,
}: {
  state: KnowledgeStudioState;
  controller: KnowledgeStudioController;
}): React.ReactElement {
  const reviews = state.snapshot?.reviews ?? [];
  const forwardReviews = state.snapshot?.forwardRevisionReviews ?? [];
  const selectedReview = getSelectedReview(state);
  const selectedForwardRevision = getSelectedForwardRevision(state);

  if (reviews.length === 0 && forwardReviews.length === 0) {
    return (
      <div
        className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
        role="status"
      >
        <Inbox aria-hidden="true" className="tw-mx-auto tw-size-6 tw-text-muted" />
        <p className="tw-m-0 tw-mt-2 tw-text-sm tw-font-medium">No proposals are awaiting review</p>
        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
          New proposals and accepted revisions awaiting Apply will appear here.
        </p>
        <Button
          className="tw-mt-3"
          size="sm"
          variant="ghost"
          onClick={() => controller.selectTab("activity")}
        >
          View activity
        </Button>
      </div>
    );
  }

  return (
    <div className="tw-space-y-4">
      <nav aria-label="Pending knowledge reviews" className="tw-flex tw-flex-wrap tw-gap-2">
        {reviews.map((review, index) => {
          const selected = review.changeSetId === state.selectedReviewChangeSetId;
          return (
            <Button
              key={review.changeSetId}
              aria-label={`Open review ${index + 1}`}
              aria-pressed={selected}
              size="sm"
              variant={selected ? "default" : "secondary"}
              onClick={() => controller.openReview(review.changeSetId)}
            >
              Proposal {index + 1}
              <Badge className="tw-ml-1 tw-shadow-none" variant="outline">
                {review.files.length} {review.files.length === 1 ? "file" : "files"}
              </Badge>
            </Button>
          );
        })}
        {forwardReviews.map((review, index) => {
          const selected = review.reviewRef === state.selectedForwardRevisionRef;
          return (
            <Button
              key={review.reviewRef}
              aria-label={`Open forward revision ${index + 1}`}
              aria-pressed={selected}
              size="sm"
              variant={selected ? "default" : "secondary"}
              onClick={() => controller.openForwardRevision(review.reviewRef)}
            >
              Forward revision {index + 1}
              <Badge className="tw-ml-1 tw-shadow-none" variant="outline">
                {formatForwardRevisionState(review.state)}
              </Badge>
            </Button>
          );
        })}
      </nav>

      {selectedReview ? (
        <KnowledgeReviewPanel
          activeEdit={controller.getReviewActiveEdit(selectedReview)}
          busy={state.pendingAction !== undefined}
          acceptCommandsEnabled={state.snapshot?.commandCapabilities.reviewAccept === true}
          rejectCommandsEnabled={state.snapshot?.commandCapabilities.reviewReject === true}
          draft={controller.getReviewDraft(selectedReview)}
          plan={selectedReview}
          evidenceError={state.reviewEvidenceError}
          openingEvidenceRef={state.openingReviewEvidenceRef}
          onBack={() => controller.selectTab("activity")}
          onActiveEditChange={(activeEdit) =>
            controller.updateReviewActiveEdit(selectedReview, activeEdit)
          }
          onOpenEvidence={
            state.snapshot?.reviewEvidenceAvailable === true
              ? (evidenceRef) => controller.openReviewEvidence(evidenceRef)
              : undefined
          }
          onDraftChange={(draft) => controller.updateReviewDraft(selectedReview, draft)}
          onSubmit={(command) => controller.submitReview(command)}
        />
      ) : selectedForwardRevision?.state === "pending" ? (
        <KnowledgeReviewPanel
          activeEdit={controller.getReviewActiveEdit(selectedForwardRevision.plan)}
          busy={state.pendingAction !== undefined}
          acceptCommandsEnabled={state.snapshot?.commandCapabilities.forwardRevisionReview === true}
          rejectCommandsEnabled={state.snapshot?.commandCapabilities.forwardRevisionReview === true}
          draft={controller.getReviewDraft(selectedForwardRevision.plan)}
          plan={selectedForwardRevision.plan}
          onBack={() => controller.selectTab("activity")}
          onActiveEditChange={(activeEdit) =>
            controller.updateReviewActiveEdit(selectedForwardRevision.plan, activeEdit)
          }
          onDraftChange={(draft) =>
            controller.updateReviewDraft(selectedForwardRevision.plan, draft)
          }
          onSubmit={(command) =>
            controller.submitForwardRevisionReview(selectedForwardRevision.reviewRef, command)
          }
        />
      ) : selectedForwardRevision ? (
        <ForwardRevisionStatusPanel
          controller={controller}
          review={selectedForwardRevision}
          state={state}
        />
      ) : (
        <div className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-sm tw-text-error" role="alert">
          The selected review is no longer available. Choose a current proposal above.
        </div>
      )}
    </div>
  );
}

/**
 * Maps an Activity job selection to the ChangeSet currently stored in the
 * controller snapshot, then delegates navigation back to the controller.
 *
 * @param controller - Current Knowledge Studio controller
 * @param jobId - Opaque Activity job identifier
 */
function openJobReview(controller: KnowledgeStudioController, jobId: string): void {
  const item = controller
    .getState()
    .snapshot?.activity.items.find((candidate) => candidate.id === jobId);
  if (item?.changeSetId) {
    controller.openReview(item.changeSetId);
    return;
  }
  controller.selectTab("review");
}

/**
 * Renders the Activity/Review composition over controller-owned durable truth.
 *
 * This component never writes queue, review, or Vault state. Every command is
 * delegated to the controller, and rendered job state changes only after the
 * controller publishes a reconciled snapshot.
 *
 * @param props - Knowledge Studio controller boundary
 * @returns Controller-backed Knowledge Studio surface
 */
export function KnowledgeStudioRoot({
  controller,
  folderImportPort,
  setupReadiness,
  setupNavigation,
}: KnowledgeStudioRootProps): React.ReactElement {
  const state = useKnowledgeStudioState(controller);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const activityTabId = React.useId();
  const queryTabId = React.useId();
  const reviewTabId = React.useId();
  const sourcesTabId = React.useId();
  const recoveryTabId = React.useId();
  const tabIds: Readonly<Record<KnowledgeStudioTab, string>> = {
    query: queryTabId,
    activity: activityTabId,
    review: reviewTabId,
    sources: sourcesTabId,
    recovery: recoveryTabId,
  };

  if (state.status === "refreshing") {
    return (
      <main className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-6">
        <section
          className="tw-max-w-xl tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-5 tw-text-muted"
          role="status"
        >
          <div className="tw-flex tw-items-start tw-gap-3">
            <Loader2
              aria-hidden="true"
              className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-animate-spin"
            />
            <div>
              <h1 className="tw-m-0 tw-text-base tw-font-semibold">Refreshing Knowledge Studio…</h1>
              <p className="tw-m-0 tw-mt-2 tw-text-sm">
                Checking the current configuration and durable state. Actions are temporarily
                paused; this is expected and does not mean the operation failed.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (state.status === "unavailable") {
    return (
      <KnowledgeSetupPanel
        navigation={setupNavigation}
        readiness={setupReadiness}
        unavailableNotice={
          state.unavailableNotice ??
          "Knowledge Studio cannot select a validated project Bundle yet."
        }
      />
    );
  }

  if (setupOpen) {
    return (
      <KnowledgeSetupPanel
        navigation={setupNavigation}
        readiness={setupReadiness}
        onBack={() => setSetupOpen(false)}
      />
    );
  }

  if (state.status === "idle") {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-6" role="status">
        <p className="tw-m-0 tw-text-sm tw-text-muted">Knowledge Studio is not active.</p>
      </div>
    );
  }

  if (state.status === "loading" && !state.snapshot) {
    return (
      <div
        className="tw-flex tw-h-full tw-items-center tw-justify-center tw-gap-2 tw-p-6 tw-text-sm tw-text-muted"
        role="status"
      >
        <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
        Loading durable knowledge state…
      </div>
    );
  }

  if (state.status === "error" && !state.snapshot) {
    return (
      <div className="tw-flex tw-h-full tw-p-6">
        <LoadError
          controller={controller}
          fullPage={true}
          message={state.error ?? "Knowledge Studio could not load its durable state."}
        />
      </div>
    );
  }

  const snapshot = state.snapshot;
  if (!snapshot) {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-6" role="status">
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          Durable knowledge state is not available yet.
        </p>
      </div>
    );
  }

  const missingSourceCount =
    snapshot.sourceLifecycle?.sources.filter((source) => source.status === "missing").length ?? 0;

  return (
    <main className="tw-flex tw-h-full tw-flex-col tw-gap-4 tw-overflow-auto tw-p-4">
      <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
        <div>
          <h1 className="tw-m-0 tw-text-lg tw-font-semibold">Knowledge Studio</h1>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
            Bundle {snapshot.bundleId} · durable revision {snapshot.revisionToken}
          </p>
        </div>
        <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-end tw-gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSetupOpen(true)}>
            Setup &amp; status
          </Button>
          <KnowledgeFolderImportButton port={folderImportPort} />
          <div aria-label="Knowledge Studio sections" className="tw-flex tw-gap-1" role="tablist">
            {STUDIO_TABS.filter(
              (tab) =>
                (tab.id !== "query" || snapshot.queryAvailable === true) &&
                (tab.id !== "sources" || snapshot.sourceLifecycle !== undefined) &&
                (tab.id !== "recovery" || snapshot.recovery.items.length > 0)
            ).map((tab) => {
              const selected = state.activeTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <Button
                  key={tab.id}
                  aria-controls={`${tabIds[tab.id]}-panel`}
                  aria-selected={selected}
                  id={`${tabIds[tab.id]}-tab`}
                  role="tab"
                  size="sm"
                  variant={selected ? "default" : "ghost"}
                  onClick={() => controller.selectTab(tab.id)}
                >
                  <TabIcon aria-hidden="true" className="tw-size-3" />
                  {tab.label}
                  {tab.id === "review" &&
                  snapshot.reviews.length + (snapshot.forwardRevisionReviews?.length ?? 0) > 0 ? (
                    <Badge className="tw-ml-1 tw-shadow-none" variant="outline">
                      {snapshot.reviews.length + (snapshot.forwardRevisionReviews?.length ?? 0)}
                    </Badge>
                  ) : null}
                  {tab.id === "recovery" && snapshot.recovery.items.length > 0 ? (
                    <Badge className="tw-ml-1 tw-shadow-none" variant="outline">
                      {snapshot.recovery.items.length}
                    </Badge>
                  ) : null}
                  {tab.id === "sources" && missingSourceCount > 0 ? (
                    <Badge className="tw-ml-1 tw-shadow-none" variant="destructive">
                      {missingSourceCount}
                    </Badge>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </div>
      </header>

      <SnapshotNotice state={state} />
      {state.error ? (
        <LoadError controller={controller} fullPage={false} message={state.error} />
      ) : null}
      <FeedbackBanner feedback={state.feedback} />
      {state.reviewDraftNotice ? (
        <aside
          aria-live="polite"
          className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-error"
          role="alert"
        >
          <p className="tw-m-0 tw-text-sm tw-font-medium">{state.reviewDraftNotice}</p>
        </aside>
      ) : null}
      <ReconciliationStatus state={state} />

      <section
        aria-labelledby={`${tabIds[state.activeTab]}-tab`}
        id={`${tabIds[state.activeTab]}-panel`}
        role="tabpanel"
      >
        {state.activeTab === "query" ? (
          <KnowledgeQueryPanel
            state={state.query ?? { status: "idle" }}
            writebackAvailable={snapshot.queryWritebackAvailable === true}
            onOpenCitation={(citationRef) => controller.openQueryCitation(citationRef)}
            onQuery={(query) => controller.runQuery(query)}
            onSaveToWiki={(title) => controller.saveCurrentQueryToWiki(title)}
          />
        ) : state.activeTab === "activity" ? (
          snapshot.availability === "adapter_unavailable" ? (
            <div
              className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
              role="status"
            >
              <ShieldAlert aria-hidden="true" className="tw-mx-auto tw-size-6 tw-text-muted" />
              <p className="tw-m-0 tw-mt-2 tw-text-sm tw-font-medium">
                Durable Activity is not connected
              </p>
              <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
                No queue state is inferred while the Windows adapter is unavailable.
              </p>
            </div>
          ) : (
            <KnowledgeActivityPanel
              commandCapabilities={snapshot.commandCapabilities}
              model={snapshot.activity}
              onCancelJob={(jobId) => void controller.cancelJob(jobId)}
              onPauseBundle={() => void controller.pauseBundle()}
              onResumeBundle={() => void controller.resumeBundle()}
              onRetryJob={(jobId) => void controller.retryJob(jobId)}
              onReviewJob={(jobId) => openJobReview(controller, jobId)}
            />
          )
        ) : state.activeTab === "review" ? (
          <ReviewWorkspace controller={controller} state={state} />
        ) : state.activeTab === "sources" ? (
          snapshot.sourceLifecycle ? (
            <KnowledgeSourceLifecyclePanel
              model={snapshot.sourceLifecycle}
              onCheckAgain={(sourceId, signal) => controller.checkSourceAgain(sourceId, signal)}
              onRemove={(confirmation, signal) => controller.retireSource(confirmation, signal)}
            />
          ) : (
            <p className="tw-m-0 tw-text-sm tw-text-muted" role="status">
              Source lifecycle state is not available from this snapshot.
            </p>
          )
        ) : (
          <KnowledgeRecoveryPanel
            model={snapshot.recovery}
            onAbandon={(recoveryId) => void controller.abandonRecovery(recoveryId)}
            onContinue={(recoveryId) => void controller.continueRecovery(recoveryId)}
            onRefresh={() => void controller.refresh()}
            pendingRecoveryId={
              state.pendingAction?.kind === "continue_recovery" ||
              state.pendingAction?.kind === "abandon_recovery"
                ? state.pendingAction.targetId
                : undefined
            }
          />
        )}
      </section>
    </main>
  );
}
