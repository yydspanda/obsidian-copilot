import type { KnowledgeDiagnostic } from "@/knowledge/model/types";
import type {
  KnowledgeGroundedRetrievalResult,
  KnowledgeStudioQueryPort,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeActivityCounts,
  KnowledgeActivityModel,
  KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";
import type { KnowledgeRecoveryModel } from "@/knowledge/ui/recoveryModel";

/** Knowledge Studio tabs currently exposed by the Windows desktop surface. */
export type KnowledgeStudioTab = "query" | "activity" | "review" | "recovery";

/** Availability of the runtime adapters behind a UI snapshot. */
export type KnowledgeStudioAvailability = "ready" | "adapter_unavailable";

/** Commands implemented by the exact adapter generation behind a snapshot. */
export interface KnowledgeStudioCommandCapabilities {
  pauseBundle: boolean;
  resumeBundle: boolean;
  cancelJob: boolean;
  retryJob: boolean;
  reviewReject: boolean;
  reviewAccept: boolean;
  recoveryContinue?: boolean;
  recoveryAbandon?: boolean;
}

/** One trusted, read-only render snapshot returned by the orchestration edge. */
export interface KnowledgeStudioSnapshot {
  bundleId: string;
  revisionToken: string;
  availability: KnowledgeStudioAvailability;
  commandCapabilities: Readonly<KnowledgeStudioCommandCapabilities>;
  activity: Readonly<KnowledgeActivityModel>;
  reviews: readonly Readonly<KnowledgeReviewPlan>[];
  recovery: Readonly<KnowledgeRecoveryModel>;
  /** Whether the exact adapter generation exposes scoped applied-Wiki Query. */
  queryAvailable?: boolean;
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
  | { kind: "applied" }
  | { kind: "rejected" }
  | { kind: "recovery_required" }
  | { kind: "stale" }
  | { kind: "blocked"; diagnostics: readonly KnowledgeDiagnostic[] };

/** Result of one exact explicit recovery action. */
export type KnowledgeStudioRecoverySubmissionResult =
  | { kind: "completed" }
  | { kind: "stale" }
  | { kind: "recovery_required" }
  | { kind: "blocked" };

/** Mutation boundary used by Knowledge Studio; implementations own all durable writes. */
export interface KnowledgeStudioCommandPort {
  /** Pauses an entire Bundle. */
  pauseBundle(bundleId: string, expectedQueueRevision: number, signal: AbortSignal): Promise<void>;
  /** Resumes an entire Bundle when its durable gate permits it. */
  resumeBundle(bundleId: string, expectedQueueRevision: number, signal: AbortSignal): Promise<void>;
  /** Cancels one cancellable queue job. */
  cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void>;
  /** Retries one retryable failed queue job. */
  retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void>;
  /** Submits content-free review decisions to the core review boundary. */
  submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult>;
  /** Continues an exact accepted apply after fresh durable re-proof. */
  continueRecovery?(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult>;
  /** Abandons an exact no-journal apply before any Wiki mutation began. */
  abandonRecovery?(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult>;
}

/** Controller lifecycle independent of any particular React render root. */
export type KnowledgeStudioLoadStatus = "idle" | "unavailable" | "loading" | "ready" | "error";

/** User-visible action currently serialized by the controller. */
export interface KnowledgeStudioPendingAction {
  kind:
    | "pause"
    | "resume"
    | "cancel"
    | "retry"
    | "submit_review"
    | "continue_recovery"
    | "abandon_recovery";
  targetId?: string;
}

/** Safe feedback produced by command outcomes without retaining raw errors. */
export interface KnowledgeStudioFeedback {
  kind: "success" | "blocked" | "error";
  message: string;
  diagnostics?: readonly KnowledgeDiagnostic[];
}

/** Ephemeral scoped-query state that is never written into the durable Runtime. */
export interface KnowledgeStudioQueryState {
  status: "idle" | "loading" | "ready" | "error";
  result?: Readonly<KnowledgeGroundedRetrievalResult>;
  error?: string;
  openingCitationRef?: string;
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
  query?: Readonly<KnowledgeStudioQueryState>;
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

/** Fail-closed command capabilities shared by unavailable and read-only adapters. */
export const NO_KNOWLEDGE_STUDIO_COMMAND_CAPABILITIES: Readonly<KnowledgeStudioCommandCapabilities> =
  Object.freeze({
    pauseBundle: false,
    resumeBundle: false,
    cancelJob: false,
    retryJob: false,
    reviewReject: false,
    reviewAccept: false,
    recoveryContinue: false,
    recoveryAbandon: false,
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
  const recovery: Readonly<KnowledgeRecoveryModel> = Object.freeze({
    bundleId,
    runtimeRevision: 0,
    items: Object.freeze([]),
  });
  return Object.freeze({
    bundleId,
    revisionToken: "knowledge-studio-adapter-unavailable-v1",
    availability: "adapter_unavailable",
    commandCapabilities: NO_KNOWLEDGE_STUDIO_COMMAND_CAPABILITIES,
    activity,
    reviews: Object.freeze([]),
    recovery,
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
  async pauseBundle(
    _bundleId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a resume request while adapters are unavailable. */
  async resumeBundle(
    _bundleId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a cancel request while adapters are unavailable. */
  async cancelJob(
    _bundleId: string,
    _jobId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects a retry request while adapters are unavailable. */
  async retryJob(
    _bundleId: string,
    _jobId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
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

  /** Rejects recovery continuation while adapters are unavailable. */
  async continueRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects recovery abandonment while adapters are unavailable. */
  async abandonRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
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
  const commandCapabilities = snapshot.commandCapabilities;
  if (
    snapshot.bundleId !== bundleId ||
    snapshot.activity.bundleId !== bundleId ||
    snapshot.recovery.bundleId !== bundleId ||
    typeof snapshot.revisionToken !== "string" ||
    snapshot.revisionToken.length === 0 ||
    typeof commandCapabilities !== "object" ||
    commandCapabilities === null ||
    typeof commandCapabilities.pauseBundle !== "boolean" ||
    typeof commandCapabilities.resumeBundle !== "boolean" ||
    typeof commandCapabilities.cancelJob !== "boolean" ||
    typeof commandCapabilities.retryJob !== "boolean" ||
    typeof commandCapabilities.reviewReject !== "boolean" ||
    typeof commandCapabilities.reviewAccept !== "boolean" ||
    (commandCapabilities.recoveryContinue !== undefined &&
      typeof commandCapabilities.recoveryContinue !== "boolean") ||
    (commandCapabilities.recoveryAbandon !== undefined &&
      typeof commandCapabilities.recoveryAbandon !== "boolean")
  ) {
    throw new TypeError("Knowledge Studio snapshot identity is invalid");
  }
  if (snapshot.reviews.some((review) => review.bundleId !== bundleId)) {
    throw new TypeError("Knowledge Studio review belongs to another Bundle");
  }
}

/**
 * Coordinates durable Studio state, ephemeral scoped Query, and serialized UI commands.
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
  private queryAbort?: AbortController;
  private loadGeneration = 0;
  private actionGeneration = 0;
  private queryGeneration = 0;
  private refreshQueued = false;

  /**
   * Creates a controller over explicit read and command ports.
   *
   * @param readPort - Durable snapshot read boundary
   * @param commandPort - Durable mutation orchestration boundary
   * @param queryPort - Optional scoped Query and citation-navigation boundary
   */
  constructor(
    private readonly readPort: KnowledgeStudioReadPort,
    private readonly commandPort: KnowledgeStudioCommandPort,
    private readonly queryPort?: KnowledgeStudioQueryPort
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
      query: { status: "idle" },
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
   * @param tab - Query, Activity, Review, or Recovery tab
   */
  selectTab(tab: KnowledgeStudioTab): void {
    const snapshot = this.state.snapshot;
    if (tab === "query" && snapshot?.queryAvailable !== true) return;
    if (tab === "recovery" && (snapshot?.recovery.items.length ?? 0) === 0) return;
    if (this.state.activeTab === tab) return;
    this.state = { ...this.state, activeTab: tab };
    this.emit();
  }

  /**
   * Runs a read-only query against the exact applied Wiki generation.
   *
   * @param query - User question or search phrase
   */
  async runQuery(query: string): Promise<void> {
    const bundleId = this.state.bundleId;
    if (
      !bundleId ||
      !this.queryPort ||
      this.state.pendingAction !== undefined ||
      this.state.snapshot?.queryAvailable !== true ||
      typeof query !== "string" ||
      query.trim().length === 0
    ) {
      this.cancelQueryWork();
      this.state = {
        ...this.state,
        query: {
          status: "error",
          error: "Scoped knowledge query is not available from the current snapshot.",
        },
      };
      this.emit();
      return;
    }

    this.cancelQueryWork();
    const abort = new AbortController();
    this.queryAbort = abort;
    const generation = ++this.queryGeneration;
    this.state = {
      ...this.state,
      activeTab: "query",
      query: { status: "loading" },
    };
    this.emit();

    try {
      const result = await this.queryPort.query(bundleId, { query }, abort.signal);
      if (
        abort.signal.aborted ||
        generation !== this.queryGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      if (
        result.mode !== "grounded_retrieval" ||
        result.bundleId !== bundleId ||
        typeof result.queryId !== "string" ||
        result.queryId.length === 0 ||
        !Array.isArray(result.hits)
      ) {
        throw new TypeError("Knowledge query result identity is invalid");
      }
      this.state = { ...this.state, query: { status: "ready", result } };
      this.emit();
    } catch (error) {
      if (abort.signal.aborted || generation !== this.queryGeneration || isAbortError(error)) {
        return;
      }
      this.state = {
        ...this.state,
        query: {
          status: "error",
          error:
            "Knowledge Query could not prove a stable applied Wiki snapshot. No other Vault notes were searched.",
        },
      };
      this.emit();
    } finally {
      if (generation === this.queryGeneration) this.queryAbort = undefined;
    }
  }

  /**
   * Opens one coordinator-issued source citation without accepting a path from React.
   *
   * @param citationRef - Opaque reference present in the current query result
   */
  async openQueryCitation(citationRef: string): Promise<void> {
    const bundleId = this.state.bundleId;
    const currentQuery = this.state.query;
    const result = currentQuery?.result;
    const knownReference = result?.hits.some((hit) =>
      hit.citations.some((citation) => citation.citationRef === citationRef)
    );
    if (!bundleId || !this.queryPort || !currentQuery || !result || !knownReference) {
      this.state = {
        ...this.state,
        query: {
          ...(this.state.query ?? { status: "error" as const }),
          status: "error",
          error: "That source citation is no longer available from the current query.",
          openingCitationRef: undefined,
        },
      };
      this.emit();
      return;
    }

    this.queryAbort?.abort();
    const abort = new AbortController();
    this.queryAbort = abort;
    const generation = ++this.queryGeneration;
    this.state = {
      ...this.state,
      query: { ...currentQuery, openingCitationRef: citationRef },
    };
    this.emit();
    try {
      await this.queryPort.openCitation(bundleId, result.queryId, citationRef, abort.signal);
      if (
        abort.signal.aborted ||
        generation !== this.queryGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      this.state = {
        ...this.state,
        query: { ...currentQuery, openingCitationRef: undefined, error: undefined },
      };
      this.emit();
    } catch (error) {
      if (abort.signal.aborted || generation !== this.queryGeneration || isAbortError(error)) {
        return;
      }
      this.state = {
        ...this.state,
        query: {
          ...currentQuery,
          status: "error",
          openingCitationRef: undefined,
          error:
            "The source has changed, is unsupported, or cannot be opened at its exact citation.",
        },
      };
      this.emit();
    } finally {
      if (generation === this.queryGeneration) this.queryAbort = undefined;
    }
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

    this.cancelQueryWork();
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const generation = ++this.loadGeneration;
    this.state = {
      ...this.state,
      status: this.state.snapshot ? "ready" : "loading",
      refreshing: true,
      query: { status: "idle" },
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
      const activeTab =
        snapshot.recovery.items.length > 0
          ? this.state.snapshot === undefined
            ? "recovery"
            : this.state.activeTab
          : this.state.activeTab === "recovery"
            ? "activity"
            : this.state.activeTab === "query" && snapshot.queryAvailable !== true
              ? "activity"
              : this.state.activeTab;
      this.state = {
        ...this.state,
        status: "ready",
        activeTab,
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
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    if (!snapshot?.commandCapabilities.pauseBundle || !snapshot.activity.controls.canPause) {
      await this.rejectUnavailableAction("This Bundle cannot be paused from the current snapshot.");
      return;
    }
    const expectedQueueRevision = snapshot.activity.revision;
    await this.executeAction(
      { kind: "pause" },
      (bundleId, signal) => this.commandPort.pauseBundle(bundleId, expectedQueueRevision, signal),
      () => ({ kind: "success", message: "Knowledge activity paused." })
    );
  }

  /** Requests a durable Bundle resume when its recovery gate allows it. */
  async resumeBundle(): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    if (!snapshot?.commandCapabilities.resumeBundle || !snapshot.activity.controls.canResume) {
      await this.rejectUnavailableAction(
        "This Bundle cannot be resumed from the current snapshot."
      );
      return;
    }
    const expectedQueueRevision = snapshot.activity.revision;
    await this.executeAction(
      { kind: "resume" },
      (bundleId, signal) => this.commandPort.resumeBundle(bundleId, expectedQueueRevision, signal),
      () => ({ kind: "success", message: "Knowledge activity resumed." })
    );
  }

  /**
   * Cancels one job through the orchestration port.
   *
   * @param jobId - Opaque durable job identifier
   */
  async cancelJob(jobId: string): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    const item = snapshot?.activity.items.find((candidate) => candidate.id === jobId);
    if (!snapshot?.commandCapabilities.cancelJob || item?.actions.canCancel !== true) {
      await this.rejectUnavailableAction("This job cannot be cancelled from the current snapshot.");
      return;
    }
    const expectedQueueRevision = snapshot.activity.revision;
    await this.executeAction(
      { kind: "cancel", targetId: jobId },
      (bundleId, signal) =>
        this.commandPort.cancelJob(bundleId, jobId, expectedQueueRevision, signal),
      () => ({ kind: "success", message: "Knowledge job cancelled." })
    );
  }

  /**
   * Retries one eligible failed job through the orchestration port.
   *
   * @param jobId - Opaque durable job identifier
   */
  async retryJob(jobId: string): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    const item = snapshot?.activity.items.find((candidate) => candidate.id === jobId);
    if (!snapshot?.commandCapabilities.retryJob || item?.actions.canRetry !== true) {
      await this.rejectUnavailableAction("This job cannot be retried from the current snapshot.");
      return;
    }
    const expectedQueueRevision = snapshot.activity.revision;
    await this.executeAction(
      { kind: "retry", targetId: jobId },
      (bundleId, signal) =>
        this.commandPort.retryJob(bundleId, jobId, expectedQueueRevision, signal),
      () => ({ kind: "success", message: "Knowledge job queued for retry." })
    );
  }

  /**
   * Submits one content-free review command and then reloads durable truth.
   *
   * @param command - Opaque decisions bound to the currently rendered snapshot
   */
  async submitReview(command: KnowledgeReviewCommand): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    const current = snapshot?.reviews.find((review) => review.changeSetId === command.changeSetId);
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

    const rejectsWholeProposal =
      command.decisions.length === current.files.length &&
      command.decisions.every((decision) => decision.decision === "reject");
    const commandAvailable = rejectsWholeProposal
      ? snapshot?.commandCapabilities.reviewReject === true
      : snapshot?.commandCapabilities.reviewAccept === true;
    if (!commandAvailable) {
      await this.rejectUnavailableAction(
        rejectsWholeProposal
          ? "Proposal rejection is unavailable from the current snapshot."
          : "Proposal acceptance and Wiki apply are not connected yet."
      );
      return;
    }

    await this.executeAction(
      { kind: "submit_review", targetId: command.changeSetId },
      (bundleId, signal) => this.commandPort.submitReview(bundleId, command, signal),
      (result) => {
        switch (result.kind) {
          case "applied":
            return { kind: "success", message: "Changes applied." };
          case "rejected":
            return { kind: "success", message: "The proposal was rejected without writing files." };
          case "recovery_required":
            return {
              kind: "blocked",
              message:
                "The review is durable, but apply needs recovery before more work can continue.",
            };
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

  /** Continues one exact accepted apply selected from the current recovery snapshot. */
  async continueRecovery(recoveryId: string): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    const item = snapshot?.recovery.items.find((candidate) => candidate.id === recoveryId);
    if (
      !snapshot?.commandCapabilities.recoveryContinue ||
      item?.actions.canContinue !== true ||
      typeof this.commandPort.continueRecovery !== "function"
    ) {
      await this.rejectUnavailableAction(
        "This recovery item cannot be continued from the current snapshot."
      );
      return;
    }
    const expectedRuntimeRevision = snapshot.recovery.runtimeRevision;
    await this.executeAction<KnowledgeStudioRecoverySubmissionResult>(
      { kind: "continue_recovery", targetId: recoveryId },
      (bundleId, signal) =>
        this.commandPort.continueRecovery!(bundleId, recoveryId, expectedRuntimeRevision, signal),
      (result) => this.createRecoveryFeedback(result, "continued"),
      (result) => result.kind === "stale" || result.kind === "blocked"
    );
  }

  /** Abandons one exact no-journal apply selected from the current recovery snapshot. */
  async abandonRecovery(recoveryId: string): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    const item = snapshot?.recovery.items.find((candidate) => candidate.id === recoveryId);
    if (
      !snapshot?.commandCapabilities.recoveryAbandon ||
      item?.actions.canAbandon !== true ||
      typeof this.commandPort.abandonRecovery !== "function"
    ) {
      await this.rejectUnavailableAction(
        "This recovery item cannot be abandoned from the current snapshot."
      );
      return;
    }
    const expectedRuntimeRevision = snapshot.recovery.runtimeRevision;
    await this.executeAction<KnowledgeStudioRecoverySubmissionResult>(
      { kind: "abandon_recovery", targetId: recoveryId },
      (bundleId, signal) =>
        this.commandPort.abandonRecovery!(bundleId, recoveryId, expectedRuntimeRevision, signal),
      (result) => this.createRecoveryFeedback(result, "abandoned"),
      (result) => result.kind === "stale" || result.kind === "blocked"
    );
  }

  /** Maps one sanitized recovery result into stable user feedback. */
  private createRecoveryFeedback(
    result: KnowledgeStudioRecoverySubmissionResult,
    completedAction: "continued" | "abandoned"
  ): KnowledgeStudioFeedback {
    switch (result.kind) {
      case "completed":
        return {
          kind: "success",
          message:
            completedAction === "continued"
              ? "Recovery completed. Knowledge startup is being checked again."
              : "The no-journal apply was abandoned. Knowledge startup is being checked again.",
        };
      case "stale":
        return {
          kind: "blocked",
          message: "Recovery state changed before the action. Review the refreshed snapshot.",
        };
      case "recovery_required":
        return {
          kind: "blocked",
          message:
            "The apply could not be fully finalized and still needs recovery. Startup remains paused; no rollback was assumed.",
        };
      case "blocked":
        return {
          kind: "blocked",
          message: "The recovery action is not safe from the current durable state.",
        };
    }
  }

  /** Emits current state to all external-store subscribers. */
  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Treats a runtime event as a request to reload durable truth. */
  private handleReloadHint(): void {
    const hadQueryState = this.state.query !== undefined && this.state.query.status !== "idle";
    this.cancelQueryWork(true);
    if (hadQueryState) {
      this.state = { ...this.state, query: { status: "idle" } };
      this.emit();
    }
    if (this.state.pendingAction) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  /** Publishes a fail-closed action result and reconciles the durable snapshot. */
  private async rejectUnavailableAction(message: string): Promise<void> {
    this.state = {
      ...this.state,
      feedback: { kind: "blocked", message },
    };
    this.emit();
    await this.refresh();
  }

  /** Cancels reads, commands, and hint subscriptions for the current session. */
  private cancelSessionWork(): void {
    this.unsubscribeHints?.();
    this.unsubscribeHints = undefined;
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    this.actionAbort?.abort();
    this.actionAbort = undefined;
    this.queryAbort?.abort();
    this.queryAbort = undefined;
    this.revokeCurrentQueryCapability(false);
    this.loadGeneration += 1;
    this.actionGeneration += 1;
    this.queryGeneration += 1;
    this.refreshQueued = false;
  }

  /** Cancels only ephemeral Query and citation-navigation work. */
  private cancelQueryWork(bundleWide = false): void {
    this.queryAbort?.abort();
    this.queryAbort = undefined;
    this.revokeCurrentQueryCapability(bundleWide);
    this.queryGeneration += 1;
  }

  /** Revokes exact UI refs, or all Bundle refs for an authoritative durable hint. */
  private revokeCurrentQueryCapability(bundleWide: boolean): void {
    const bundleId = this.state.bundleId;
    const query = this.state.query;
    const queryId = query?.result?.queryId;
    if (!bundleId || !this.queryPort || (!bundleWide && queryId === undefined)) return;
    this.queryPort.revokeCurrent(bundleId, bundleWide ? undefined : queryId);
  }

  /**
   * Runs exactly one UI command at a time and reconciles via a durable reload.
   *
   * @param pendingAction - Safe action descriptor shown by the UI
   * @param operation - Port call receiving the current Bundle and cancellation signal
   * @param toFeedback - Successful result mapper
   * @param shouldRefreshAfterSuccess - Optional durable reload policy for successful results
   */
  private async executeAction<T>(
    pendingAction: KnowledgeStudioPendingAction,
    operation: (bundleId: string, signal: AbortSignal) => Promise<T>,
    toFeedback: (result: T) => KnowledgeStudioFeedback,
    shouldRefreshAfterSuccess: (result: T) => boolean = () => true
  ): Promise<void> {
    const bundleId = this.state.bundleId;
    if (!bundleId || this.state.pendingAction) return;

    this.cancelQueryWork();
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    const abort = new AbortController();
    this.actionAbort = abort;
    const generation = ++this.actionGeneration;
    this.state = {
      ...this.state,
      pendingAction,
      query: { status: "idle" },
      feedback: undefined,
      error: undefined,
    };
    this.emit();

    let successfulResult: T | undefined;
    try {
      const result = await operation(bundleId, abort.signal);
      if (
        abort.signal.aborted ||
        generation !== this.actionGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      successfulResult = result;
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
        if (successfulResult === undefined || shouldRefreshAfterSuccess(successfulResult)) {
          await this.refresh();
        }
      }
    }
  }
}
