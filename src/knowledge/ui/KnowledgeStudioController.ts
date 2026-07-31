import type { KnowledgeDiagnostic } from "@/knowledge/model/types";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeActivityCounts,
  KnowledgeActivityModel,
  KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";

/** Knowledge Studio tabs currently exposed by the Windows desktop surface. */
export type KnowledgeStudioTab = "activity" | "review";

/** Availability of the runtime adapters behind a UI snapshot. */
export type KnowledgeStudioAvailability = "ready" | "adapter_unavailable";

/** One trusted, read-only render snapshot returned by the orchestration edge. */
export interface KnowledgeStudioSnapshot {
  bundleId: string;
  revisionToken: string;
  availability: KnowledgeStudioAvailability;
  activity: Readonly<KnowledgeActivityModel>;
  reviews: readonly Readonly<KnowledgeReviewPlan>[];
  notice?: string;
}

/** Read boundary used by Knowledge Studio; event callbacks are reload hints only. */
export interface KnowledgeStudioReadPort {
  /**
   * Loads one complete, durable UI snapshot.
   *
   * @param bundleId - Stable Bundle identifier
   * @param signal - Cancellation signal owned by the controller
   * @returns Current trusted snapshot
   */
  load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot>;

  /**
   * Subscribes to non-authoritative change hints for one Bundle.
   *
   * @param bundleId - Stable Bundle identifier
   * @param onHint - Callback that must trigger a fresh durable read
   * @returns Unsubscribe callback
   */
  subscribe(bundleId: string, onHint: () => void): () => void;
}

/** Result of submitting one exact, opaque review decision. */
export type KnowledgeStudioReviewSubmissionResult =
  | { kind: "apply_started" }
  | { kind: "rejected" }
  | { kind: "stale" }
  | { kind: "blocked"; diagnostics: readonly KnowledgeDiagnostic[] };

/** Mutation boundary used by Knowledge Studio; implementations own all durable writes. */
export interface KnowledgeStudioCommandPort {
  /** Pauses an entire Bundle. */
  pauseBundle(bundleId: string, signal: AbortSignal): Promise<void>;
  /** Resumes an entire Bundle when its durable gate permits it. */
  resumeBundle(bundleId: string, signal: AbortSignal): Promise<void>;
  /** Cancels one cancellable queue job. */
  cancelJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void>;
  /** Retries one retryable failed queue job. */
  retryJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void>;
  /** Submits content-free review decisions to the core review boundary. */
  submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult>;
}

/** Controller lifecycle independent of any particular React render root. */
export type KnowledgeStudioLoadStatus = "idle" | "unavailable" | "loading" | "ready" | "error";

/** User-visible action currently serialized by the controller. */
export interface KnowledgeStudioPendingAction {
  kind: "pause" | "resume" | "cancel" | "retry" | "submit_review";
  targetId?: string;
}

/** Safe feedback produced by command outcomes without retaining raw errors. */
export interface KnowledgeStudioFeedback {
  kind: "success" | "blocked" | "error";
  message: string;
  diagnostics?: readonly KnowledgeDiagnostic[];
}

/** Immutable controller state consumed by React through subscription. */
export interface KnowledgeStudioState {
  status: KnowledgeStudioLoadStatus;
  activeTab: KnowledgeStudioTab;
  refreshing: boolean;
  bundleId?: string;
  snapshot?: KnowledgeStudioSnapshot;
  selectedReviewChangeSetId?: string;
  pendingAction?: KnowledgeStudioPendingAction;
  feedback?: KnowledgeStudioFeedback;
  unavailableNotice?: string;
  error?: string;
}

/** Callback used by a UI binding to observe controller state changes. */
export type KnowledgeStudioStateListener = () => void;

const EMPTY_STATUS_COUNTS: Readonly<Record<KnowledgeActivityStatus, number>> = Object.freeze({
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
});

const EMPTY_ACTIVITY_COUNTS: Readonly<KnowledgeActivityCounts> = Object.freeze({
  total: 0,
  active: 0,
  terminal: 0,
  hiddenTerminal: 0,
  byStatus: EMPTY_STATUS_COUNTS,
});

/** Sanitized error used by the temporary shell command port. */
export class KnowledgeStudioAdapterUnavailableError extends Error {
  /** Creates a stable adapter-unavailable error without implementation details. */
  constructor() {
    super("Knowledge Studio runtime adapters are not configured yet");
    this.name = "KnowledgeStudioAdapterUnavailableError";
  }
}

/**
 * Creates the empty snapshot used before the durable Windows adapters are connected.
 *
 * @param bundleId - Bundle selected for the future adapter
 * @returns Read-only unavailable snapshot with no fabricated activity
 */
export function createUnavailableKnowledgeStudioSnapshot(
  bundleId: string,
  notice = "Knowledge Studio is ready for its durable Windows adapter. No files can be changed from this shell."
): KnowledgeStudioSnapshot {
  const activity: Readonly<KnowledgeActivityModel> = Object.freeze({
    bundleId,
    revision: 0,
    controls: Object.freeze({ state: "paused", canPause: false, canResume: false }),
    items: Object.freeze([]),
    counts: EMPTY_ACTIVITY_COUNTS,
  });
  return Object.freeze({
    bundleId,
    revisionToken: "knowledge-studio-adapter-unavailable-v1",
    availability: "adapter_unavailable",
    activity,
    reviews: Object.freeze([]),
    notice,
  });
}

/** Read/command port that keeps the first UI entry fail-closed until adapters exist. */
export class UnavailableKnowledgeStudioPort
  implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort
{
  /**
   * Creates a fail-closed port with an optional sanitized readiness notice.
   *
   * @param notice - User-facing explanation of the remaining runtime gate
   */
  constructor(private readonly notice?: string) {}

  /** Loads an explicit unavailable snapshot without reading Vault files. */
  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    return createUnavailableKnowledgeStudioSnapshot(bundleId, this.notice);
  }

  /** Registers no hint source because no runtime adapter is active. */
  subscribe(_bundleId: string, _onHint: () => void): () => void {
    return () => undefined;
  }

  /** Rejects a pause request while adapters are unavailable. */
  async pauseBundle(_bundleId: string, _signal: AbortSignal): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a resume request while adapters are unavailable. */
  async resumeBundle(_bundleId: string, _signal: AbortSignal): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a cancel request while adapters are unavailable. */
  async cancelJob(_bundleId: string, _jobId: string, _signal: AbortSignal): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a retry request while adapters are unavailable. */
  async retryJob(_bundleId: string, _jobId: string, _signal: AbortSignal): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects review submission while adapters are unavailable. */
  async submitReview(
    _bundleId: string,
    _command: KnowledgeReviewCommand,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }
}

/**
 * Reports whether an unknown rejection represents intentional cancellation.
 *
 * @param error - Unknown rejection
 * @returns Whether the error uses the platform AbortError convention
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Validates the minimum cross-object identity contract of one trusted snapshot.
 *
 * @param bundleId - Bundle requested by the controller
 * @param snapshot - Snapshot returned by the read port
 */
function assertSnapshotIdentity(bundleId: string, snapshot: KnowledgeStudioSnapshot): void {
  if (
    snapshot.bundleId !== bundleId ||
    snapshot.activity.bundleId !== bundleId ||
    typeof snapshot.revisionToken !== "string" ||
    snapshot.revisionToken.length === 0
  ) {
    throw new TypeError("Knowledge Studio snapshot identity is invalid");
  }
  if (snapshot.reviews.some((review) => review.bundleId !== bundleId)) {
    throw new TypeError("Knowledge Studio review belongs to another Bundle");
  }
}

/**
 * Coordinates reload-only Activity/Review state and serializes UI commands.
 *
 * Durable queue/review snapshots remain authoritative. Subscription events never
 * mutate rows optimistically; they only schedule a fresh `load` through the port.
 */
export class KnowledgeStudioController {
  private state: KnowledgeStudioState = {
    status: "idle",
    activeTab: "activity",
    refreshing: false,
  };
  private readonly listeners = new Set<KnowledgeStudioStateListener>();
  private unsubscribeHints?: () => void;
  private loadAbort?: AbortController;
  private actionAbort?: AbortController;
  private loadGeneration = 0;
  private actionGeneration = 0;
  private refreshQueued = false;

  /**
   * Creates a controller over explicit read and command ports.
   *
   * @param readPort - Durable snapshot read boundary
   * @param commandPort - Durable mutation orchestration boundary
   */
  constructor(
    private readonly readPort: KnowledgeStudioReadPort,
    private readonly commandPort: KnowledgeStudioCommandPort
  ) {}

  /** Returns the current immutable-by-contract controller state. */
  getState(): KnowledgeStudioState {
    return this.state;
  }

  /**
   * Subscribes a renderer and immediately exposes the current state.
   *
   * @param listener - React-compatible external-store callback
   * @returns Unsubscribe callback
   */
  subscribe(listener: KnowledgeStudioStateListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts one Bundle session, replacing any previous session.
   *
   * @param bundleId - Stable non-empty Bundle identifier
   */
  start(bundleId: string): void {
    if (typeof bundleId !== "string" || bundleId.trim().length === 0) {
      throw new TypeError("bundleId must be a non-empty string");
    }
    this.cancelSessionWork();
    this.state = {
      status: "loading",
      activeTab: "activity",
      refreshing: true,
      bundleId,
    };
    this.emit();
    try {
      this.unsubscribeHints = this.readPort.subscribe(bundleId, () => this.handleReloadHint());
    } catch {
      this.unsubscribeHints = undefined;
    }
    void this.refresh();
  }

  /**
   * Presents a fail-closed explanation without inventing or loading a Bundle identity.
   *
   * @param notice - Sanitized user-facing reason no exact Bundle session can start
   */
  showUnavailable(notice: string): void {
    if (typeof notice !== "string" || notice.trim().length === 0) {
      throw new TypeError("Knowledge Studio unavailable notice must be a non-empty string");
    }
    this.cancelSessionWork();
    this.state = {
      status: "unavailable",
      activeTab: "activity",
      refreshing: false,
      unavailableNotice: notice,
    };
    this.emit();
  }

  /** Stops the current Bundle session and cancels in-flight work. */
  stop(): void {
    this.cancelSessionWork();
    this.state = {
      status: "idle",
      activeTab: "activity",
      refreshing: false,
    };
    this.emit();
  }

  /** Stops the session and releases all render subscriptions. */
  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  /**
   * Selects a top-level Knowledge Studio tab.
   *
   * @param tab - Activity or Review tab
   */
  selectTab(tab: KnowledgeStudioTab): void {
    if (this.state.activeTab === tab) return;
    this.state = { ...this.state, activeTab: tab };
    this.emit();
  }

  /**
   * Opens one current review plan by its opaque ChangeSet identity.
   *
   * @param changeSetId - Review proposal selected from Activity or the inbox
   */
  openReview(changeSetId: string): void {
    const review = this.state.snapshot?.reviews.find(
      (candidate) => candidate.changeSetId === changeSetId
    );
    if (!review) {
      this.state = {
        ...this.state,
        feedback: {
          kind: "blocked",
          message: "That review is no longer available. Activity has been refreshed.",
        },
      };
      this.emit();
      void this.refresh();
      return;
    }
    this.state = {
      ...this.state,
      activeTab: "review",
      selectedReviewChangeSetId: review.changeSetId,
      feedback: undefined,
    };
    this.emit();
  }

  /** Reloads the current durable snapshot without optimistic status changes. */
  async refresh(): Promise<void> {
    const bundleId = this.state.bundleId;
    if (!bundleId) return;
    if (this.state.pendingAction) {
      this.refreshQueued = true;
      return;
    }

    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const generation = ++this.loadGeneration;
    this.state = {
      ...this.state,
      status: this.state.snapshot ? "ready" : "loading",
      refreshing: true,
      error: undefined,
    };
    this.emit();

    try {
      const snapshot = await this.readPort.load(bundleId, abort.signal);
      assertSnapshotIdentity(bundleId, snapshot);
      if (
        abort.signal.aborted ||
        generation !== this.loadGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      const selectedReviewChangeSetId = snapshot.reviews.some(
        (review) => review.changeSetId === this.state.selectedReviewChangeSetId
      )
        ? this.state.selectedReviewChangeSetId
        : snapshot.reviews[0]?.changeSetId;
      this.state = {
        ...this.state,
        status: "ready",
        refreshing: false,
        snapshot,
        selectedReviewChangeSetId,
        error: undefined,
      };
      this.emit();
    } catch (error) {
      if (abort.signal.aborted || generation !== this.loadGeneration || isAbortError(error)) {
        return;
      }
      this.state = {
        ...this.state,
        status: this.state.snapshot ? "ready" : "error",
        refreshing: false,
        error: "Knowledge Studio could not load its durable state.",
      };
      this.emit();
    }
  }

  /** Requests a durable Bundle-wide user pause. */
  async pauseBundle(): Promise<void> {
    await this.executeAction(
      { kind: "pause" },
      (bundleId, signal) => this.commandPort.pauseBundle(bundleId, signal),
      () => ({ kind: "success", message: "Knowledge activity paused." })
    );
  }

  /** Requests a durable Bundle resume when its recovery gate allows it. */
  async resumeBundle(): Promise<void> {
    await this.executeAction(
      { kind: "resume" },
      (bundleId, signal) => this.commandPort.resumeBundle(bundleId, signal),
      () => ({ kind: "success", message: "Knowledge activity resumed." })
    );
  }

  /**
   * Cancels one job through the orchestration port.
   *
   * @param jobId - Opaque durable job identifier
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.executeAction(
      { kind: "cancel", targetId: jobId },
      (bundleId, signal) => this.commandPort.cancelJob(bundleId, jobId, signal),
      () => ({ kind: "success", message: "Knowledge job cancelled." })
    );
  }

  /**
   * Retries one eligible failed job through the orchestration port.
   *
   * @param jobId - Opaque durable job identifier
   */
  async retryJob(jobId: string): Promise<void> {
    await this.executeAction(
      { kind: "retry", targetId: jobId },
      (bundleId, signal) => this.commandPort.retryJob(bundleId, jobId, signal),
      () => ({ kind: "success", message: "Knowledge job queued for retry." })
    );
  }

  /**
   * Submits one content-free review command and then reloads durable truth.
   *
   * @param command - Opaque decisions bound to the currently rendered snapshot
   */
  async submitReview(command: KnowledgeReviewCommand): Promise<void> {
    const current = this.state.snapshot?.reviews.find(
      (review) => review.changeSetId === command.changeSetId
    );
    if (
      !current ||
      current.proposalDigest !== command.proposalDigest ||
      current.snapshotToken !== command.expectedSnapshotToken
    ) {
      this.state = {
        ...this.state,
        feedback: {
          kind: "blocked",
          message: "This review changed before submission. Review the refreshed proposal.",
        },
      };
      this.emit();
      await this.refresh();
      return;
    }

    await this.executeAction(
      { kind: "submit_review", targetId: command.changeSetId },
      (bundleId, signal) => this.commandPort.submitReview(bundleId, command, signal),
      (result) => {
        switch (result.kind) {
          case "apply_started":
            return { kind: "success", message: "Review accepted. Safe apply has started." };
          case "rejected":
            return { kind: "success", message: "The proposal was rejected without writing files." };
          case "stale":
            return {
              kind: "blocked",
              message: "The proposal or target files changed. Review the refreshed snapshot.",
            };
          case "blocked":
            return {
              kind: "blocked",
              message: "The selected changes did not pass deterministic validation.",
              diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
            };
        }
      }
    );
  }

  /** Emits current state to all external-store subscribers. */
  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Treats a runtime event as a request to reload durable truth. */
  private handleReloadHint(): void {
    if (this.state.pendingAction) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  /** Cancels reads, commands, and hint subscriptions for the current session. */
  private cancelSessionWork(): void {
    this.unsubscribeHints?.();
    this.unsubscribeHints = undefined;
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    this.actionAbort?.abort();
    this.actionAbort = undefined;
    this.loadGeneration += 1;
    this.actionGeneration += 1;
    this.refreshQueued = false;
  }

  /**
   * Runs exactly one UI command at a time and reconciles via a durable reload.
   *
   * @param pendingAction - Safe action descriptor shown by the UI
   * @param operation - Port call receiving the current Bundle and cancellation signal
   * @param toFeedback - Successful result mapper
   */
  private async executeAction<T>(
    pendingAction: KnowledgeStudioPendingAction,
    operation: (bundleId: string, signal: AbortSignal) => Promise<T>,
    toFeedback: (result: T) => KnowledgeStudioFeedback
  ): Promise<void> {
    const bundleId = this.state.bundleId;
    if (!bundleId || this.state.pendingAction) return;

    this.loadAbort?.abort();
    this.loadAbort = undefined;
    const abort = new AbortController();
    this.actionAbort = abort;
    const generation = ++this.actionGeneration;
    this.state = {
      ...this.state,
      pendingAction,
      feedback: undefined,
      error: undefined,
    };
    this.emit();

    try {
      const result = await operation(bundleId, abort.signal);
      if (
        abort.signal.aborted ||
        generation !== this.actionGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      this.state = { ...this.state, pendingAction: undefined, feedback: toFeedback(result) };
      this.emit();
    } catch (error) {
      if (abort.signal.aborted || generation !== this.actionGeneration || isAbortError(error)) {
        return;
      }
      this.state = {
        ...this.state,
        pendingAction: undefined,
        feedback: {
          kind: "error",
          message:
            "The Knowledge Studio action could not be completed. Durable state was reloaded.",
        },
      };
      this.emit();
    } finally {
      if (generation === this.actionGeneration) {
        this.actionAbort = undefined;
        this.refreshQueued = false;
        await this.refresh();
      }
    }
  }
}
