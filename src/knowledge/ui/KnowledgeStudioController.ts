import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import type { KnowledgeDiagnostic } from "@/knowledge/model/types";
import type {
  KnowledgeStudioQueryResult,
  KnowledgeStudioQueryPort,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import {
  snapshotKnowledgeReviewCommand,
  type KnowledgeReviewCommand,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type { KnowledgeReviewEvidenceOpenResult } from "@/knowledge/review/KnowledgeReviewEvidence";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import {
  createKnowledgeForwardRevisionStudioApplyCommand,
  createKnowledgeForwardRevisionStudioCommandFromReview,
  snapshotKnowledgeForwardRevisionStudioCommand,
  type KnowledgeForwardRevisionStudioCommand,
  type KnowledgeForwardRevisionStudioPendingReview,
  type KnowledgeForwardRevisionStudioReview,
  type KnowledgeForwardRevisionStudioSubmissionResult,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import type {
  KnowledgeActivityCounts,
  KnowledgeActivityModel,
  KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";
import type { KnowledgeRecoveryModel } from "@/knowledge/ui/recoveryModel";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";
import {
  createKnowledgeReviewDraftIdentity,
  KnowledgeReviewDraftStore,
  type KnowledgeReviewActiveEdit,
  type KnowledgeReviewDraftState,
} from "@/knowledge/ui/KnowledgeReviewDraftStore";
import {
  createKnowledgeSourceLifecycleModel,
  type KnowledgeSourceLifecycleModel,
  type KnowledgeSourceRemovalConfirmation,
} from "@/knowledge/ui/sourceLifecycleModel";

/** Knowledge Studio tabs currently exposed by the Windows desktop surface. */
export type KnowledgeStudioTab = "query" | "activity" | "review" | "sources" | "recovery";

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
  /** Whether the exact generation exposes dedicated forward Review decisions and Apply. */
  forwardRevisionReview?: boolean;
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
  /** Independent forward proposals and accepted-but-unapplied work. */
  forwardRevisionReviews?: readonly Readonly<KnowledgeForwardRevisionStudioReview>[];
  recovery: Readonly<KnowledgeRecoveryModel>;
  /** Active registered sources when the exact lifecycle generation is connected. */
  sourceLifecycle?: Readonly<KnowledgeSourceLifecycleModel>;
  /** Optional first-load tab selected by a constrained startup adapter. */
  preferredTab?: "sources" | "review";
  /** Whether the exact adapter generation exposes scoped applied-Wiki Query. */
  queryAvailable?: boolean;
  /** Whether current grounded answers can enter the reviewed writeback pipeline. */
  queryWritebackAvailable?: boolean;
  /** Whether opaque Review evidence references can be re-proved and opened. */
  reviewEvidenceAvailable?: boolean;
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
  /** Submits one dedicated opaque forward Review or accepted-ready Apply action. */
  submitForwardRevisionStudio?(
    bundleId: string,
    command: KnowledgeForwardRevisionStudioCommand,
    signal: AbortSignal
  ): Promise<KnowledgeForwardRevisionStudioSubmissionResult>;
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
export type KnowledgeStudioLoadStatus =
  | "idle"
  | "refreshing"
  | "unavailable"
  | "loading"
  | "ready"
  | "error";

/** User-visible action currently serialized by the controller. */
export interface KnowledgeStudioPendingAction {
  kind:
    | "pause"
    | "resume"
    | "cancel"
    | "retry"
    | "submit_review"
    | "submit_forward_revision"
    | "check_source"
    | "retire_source"
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
  result?: Readonly<KnowledgeStudioQueryResult>;
  error?: string;
  openingCitationRef?: string;
  savingToWiki?: boolean;
}

/** Immutable controller state consumed by React through subscription. */
export interface KnowledgeStudioState {
  status: KnowledgeStudioLoadStatus;
  activeTab: KnowledgeStudioTab;
  refreshing: boolean;
  bundleId?: string;
  snapshot?: KnowledgeStudioSnapshot;
  selectedReviewChangeSetId?: string;
  selectedForwardRevisionRef?: string;
  pendingAction?: KnowledgeStudioPendingAction;
  feedback?: KnowledgeStudioFeedback;
  unavailableNotice?: string;
  error?: string;
  query?: Readonly<KnowledgeStudioQueryState>;
  openingReviewEvidenceRef?: string;
  reviewEvidenceError?: string;
  /** Independent notice for session-only Review text revoked by a new durable snapshot. */
  reviewDraftNotice?: string;
  /** Monotonic render hint for private, controller-owned Review draft changes. */
  reviewDraftRevision?: number;
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
    forwardRevisionReview: false,
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
    forwardRevisionReviews: Object.freeze([]),
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

  /** Rejects forward Review submission while adapters are unavailable. */
  async submitForwardRevisionStudio(
    _bundleId: string,
    _command: KnowledgeForwardRevisionStudioCommand,
    _signal: AbortSignal
  ): Promise<KnowledgeForwardRevisionStudioSubmissionResult> {
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
const isAbortError = isKnowledgeAbortError;

/**
 * Validates the minimum cross-object identity contract of one trusted snapshot.
 *
 * @param bundleId - Bundle requested by the controller
 * @param snapshot - Snapshot returned by the read port
 */
function assertSnapshotIdentity(bundleId: string, snapshot: KnowledgeStudioSnapshot): void {
  const commandCapabilities = snapshot.commandCapabilities;
  const forwardReviews = snapshot.forwardRevisionReviews ?? [];
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
    (commandCapabilities.forwardRevisionReview !== undefined &&
      typeof commandCapabilities.forwardRevisionReview !== "boolean") ||
    (commandCapabilities.recoveryContinue !== undefined &&
      typeof commandCapabilities.recoveryContinue !== "boolean") ||
    (commandCapabilities.recoveryAbandon !== undefined &&
      typeof commandCapabilities.recoveryAbandon !== "boolean") ||
    (snapshot.queryAvailable !== undefined && typeof snapshot.queryAvailable !== "boolean") ||
    (snapshot.queryWritebackAvailable !== undefined &&
      typeof snapshot.queryWritebackAvailable !== "boolean") ||
    (snapshot.reviewEvidenceAvailable !== undefined &&
      typeof snapshot.reviewEvidenceAvailable !== "boolean") ||
    (snapshot.queryWritebackAvailable === true && snapshot.queryAvailable !== true) ||
    (snapshot.sourceLifecycle !== undefined && snapshot.sourceLifecycle.bundleId !== bundleId) ||
    (snapshot.preferredTab !== undefined &&
      snapshot.preferredTab !== "sources" &&
      snapshot.preferredTab !== "review") ||
    (snapshot.preferredTab === "sources" && snapshot.sourceLifecycle === undefined) ||
    (snapshot.preferredTab === "review" &&
      snapshot.reviews.length === 0 &&
      forwardReviews.length === 0)
  ) {
    throw new TypeError("Knowledge Studio snapshot identity is invalid");
  }
  if (snapshot.reviews.some((review) => review.bundleId !== bundleId)) {
    throw new TypeError("Knowledge Studio review belongs to another Bundle");
  }
  const forwardRefs = new Set<string>();
  if (
    forwardReviews.some((review) => {
      if (forwardRefs.has(review.reviewRef)) return true;
      forwardRefs.add(review.reviewRef);
      return review.state === "pending" && review.plan.bundleId !== bundleId;
    })
  ) {
    throw new TypeError("Knowledge Studio forward Review identity is invalid");
  }
}

/**
 * Reads one exact, frozen, data-only source-removal authority token.
 *
 * A copied frozen value prevents accessors or later caller mutation from changing
 * the authority that was validated before the Runtime command is submitted.
 */
function snapshotRemovalConfirmation(
  value: Readonly<KnowledgeSourceRemovalConfirmation>
): Readonly<KnowledgeSourceRemovalConfirmation> | undefined {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) return undefined;
  const expectedKeys = [
    "sourceId",
    "sourcePath",
    "retirementRef",
    "runtimeRevision",
    "manifestRevision",
  ] as const;
  if (Reflect.ownKeys(value).length !== expectedKeys.length) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (expectedKeys.some((key) => !("value" in (descriptors[key] ?? {})))) return undefined;

  const sourceId: unknown = descriptors.sourceId?.value;
  const sourcePath: unknown = descriptors.sourcePath?.value;
  const retirementRef: unknown = descriptors.retirementRef?.value;
  const runtimeRevision: unknown = descriptors.runtimeRevision?.value;
  const manifestRevision: unknown = descriptors.manifestRevision?.value;
  if (
    typeof sourceId !== "string" ||
    sourceId.trim().length === 0 ||
    typeof sourcePath !== "string" ||
    sourcePath.trim().length === 0 ||
    typeof retirementRef !== "string" ||
    retirementRef.trim().length === 0 ||
    typeof runtimeRevision !== "number" ||
    !Number.isSafeInteger(runtimeRevision) ||
    runtimeRevision < 0 ||
    typeof manifestRevision !== "number" ||
    !Number.isSafeInteger(manifestRevision) ||
    manifestRevision < 0
  ) {
    return undefined;
  }

  return Object.freeze({
    sourceId,
    sourcePath,
    retirementRef,
    runtimeRevision,
    manifestRevision,
  });
}

/**
 * Captures one exact value-free Review evidence result without invoking accessors.
 *
 * @param value - Untrusted result returned by the optional navigation boundary
 * @returns Frozen canonical result, or undefined when the receipt is malformed
 */
function snapshotReviewEvidenceOpenResult(
  value: unknown
): Readonly<KnowledgeReviewEvidenceOpenResult> | undefined {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== "kind") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    const kind: unknown = descriptor.value;
    if (kind !== "opened" && kind !== "stale" && kind !== "unsupported" && kind !== "unavailable") {
      return undefined;
    }
    return Object.freeze({ kind });
  } catch {
    return undefined;
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
  private reviewEvidenceAbort?: AbortController;
  private loadGeneration = 0;
  private actionGeneration = 0;
  private queryGeneration = 0;
  private reviewEvidenceGeneration = 0;
  private refreshQueued = false;
  private pendingForwardRevisionFocusRef?: string;
  private readonly reviewDrafts = new KnowledgeReviewDraftStore();

  /**
   * Creates a controller over explicit read and command ports.
   *
   * @param readPort - Durable snapshot read boundary
   * @param commandPort - Durable mutation orchestration boundary
   * @param queryPort - Optional scoped Query and citation-navigation boundary
   * @param queryWritebackPort - Optional current-answer capture boundary
   * @param sourceLifecyclePort - Optional source inventory and lifecycle command boundary
   * @param reviewEvidencePort - Optional opaque Review evidence navigation boundary
   */
  constructor(
    private readonly readPort: KnowledgeStudioReadPort,
    private readonly commandPort: KnowledgeStudioCommandPort,
    private readonly queryPort?: KnowledgeStudioQueryPort,
    private readonly queryWritebackPort?: KnowledgeStudioQueryWritebackPort,
    private readonly sourceLifecyclePort?: KnowledgeSourceLifecyclePort,
    private readonly reviewEvidencePort?: KnowledgeStudioReviewEvidencePort
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

  /**
   * Presents a transient, action-free refresh state while runtime ownership is rebuilt.
   *
   * This state deliberately retains no Bundle identity, snapshot, or command
   * capability. Callers must start a freshly admitted Bundle generation before
   * the Studio exposes durable state again.
   */
  showRefreshing(): void {
    this.cancelSessionWork();
    this.state = {
      status: "refreshing",
      activeTab: "activity",
      refreshing: true,
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
   * @param tab - Query, Activity, Review, Sources, or Recovery tab
   */
  selectTab(tab: KnowledgeStudioTab): void {
    const snapshot = this.state.snapshot;
    if (tab === "query" && snapshot?.queryAvailable !== true) return;
    if (tab === "sources" && snapshot?.sourceLifecycle === undefined) return;
    if (tab === "recovery" && (snapshot?.recovery.items.length ?? 0) === 0) return;
    if (this.state.activeTab === tab) return;
    this.cancelReviewEvidenceWork();
    this.state = {
      ...this.state,
      activeTab: tab,
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
      reviewDraftNotice: undefined,
    };
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
        (result.mode !== "grounded_retrieval" && result.mode !== "grounded_answer") ||
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
   * Registers the current grounded answer as a managed source for Review/Apply.
   *
   * @param title - User-selected display title embedded in the immutable capture
   */
  async saveCurrentQueryToWiki(title: string): Promise<void> {
    const bundleId = this.state.bundleId;
    const currentQuery = this.state.query;
    const result = currentQuery?.result;
    const answer = result?.mode === "grounded_answer" ? result.answer : undefined;
    if (
      !bundleId ||
      !this.queryWritebackPort ||
      this.state.snapshot?.queryWritebackAvailable !== true ||
      this.state.pendingAction !== undefined ||
      currentQuery?.savingToWiki === true ||
      !result ||
      !answer ||
      (answer.status !== "answered" && answer.status !== "partial") ||
      answer.claims.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0
    ) {
      this.state = {
        ...this.state,
        query: {
          ...(currentQuery ?? { status: "error" as const }),
          error: "Only a current source-grounded answer can be sent to reviewed Wiki writeback.",
          savingToWiki: false,
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
      query: { ...currentQuery, error: undefined, savingToWiki: true },
      feedback: undefined,
    };
    this.emit();

    try {
      const saved = await this.queryWritebackPort.saveQueryToWiki(
        bundleId,
        result.queryId,
        { title: title.trim() },
        abort.signal
      );
      this.assertQueryWritebackResult(saved);
      if (
        abort.signal.aborted ||
        generation !== this.queryGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      this.state = {
        ...this.state,
        query: { ...currentQuery, error: undefined, savingToWiki: false },
        feedback: {
          kind: "success",
          message:
            "Grounded answer registered as a managed source. Background compilation will create a Review proposal before any Wiki file changes.",
        },
      };
      this.emit();
    } catch (error) {
      if (abort.signal.aborted || generation !== this.queryGeneration || isAbortError(error))
        return;
      this.state = {
        ...this.state,
        query: {
          ...currentQuery,
          savingToWiki: false,
          error:
            "The grounded answer could not be registered. No Wiki file was changed; retry from a fresh query.",
        },
      };
      this.emit();
    } finally {
      if (generation === this.queryGeneration) this.queryAbort = undefined;
    }
  }

  /** Requires the exact value-free receipt returned by the writeback boundary. */
  private assertQueryWritebackResult(
    value: KnowledgeStudioQueryWritebackResult
  ): asserts value is Readonly<{ kind: "registered" }> {
    if (
      typeof value !== "object" ||
      value === null ||
      Reflect.ownKeys(value).length !== 1 ||
      Object.getOwnPropertyDescriptor(value, "kind")?.value !== "registered"
    ) {
      throw new TypeError("Knowledge query writeback receipt is invalid");
    }
  }

  /**
   * Opens one current review plan by its opaque ChangeSet identity.
   *
   * @param changeSetId - Review proposal selected from Activity or the inbox
   */
  openReview(changeSetId: string): void {
    this.cancelReviewEvidenceWork();
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
      selectedForwardRevisionRef: undefined,
      feedback: undefined,
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
    };
    this.emit();
  }

  /** Opens one current dedicated forward row by its opaque product reference. */
  openForwardRevision(reviewRef: string): void {
    this.cancelReviewEvidenceWork();
    const review = this.state.snapshot?.forwardRevisionReviews?.find(
      (candidate) => candidate.reviewRef === reviewRef
    );
    if (!review) {
      this.state = {
        ...this.state,
        feedback: {
          kind: "blocked",
          message: "That forward revision is no longer available. Review has been refreshed.",
        },
      };
      this.emit();
      void this.refresh();
      return;
    }
    this.state = {
      ...this.state,
      activeTab: "review",
      selectedReviewChangeSetId: undefined,
      selectedForwardRevisionRef: review.reviewRef,
      feedback: undefined,
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
    };
    this.emit();
  }

  /**
   * Focuses one just-published opaque forward row after a fresh durable reload.
   *
   * @param reviewRef - Product-only reference derived from the committed proposal receipt
   */
  focusPublishedForwardRevision(reviewRef: string): void {
    if (!/^forward-studio-review-[a-f0-9]{64}$/.test(reviewRef)) {
      throw new TypeError("Forward revision review reference is invalid");
    }
    this.cancelReviewEvidenceWork();
    this.pendingForwardRevisionFocusRef = reviewRef;
    this.state = {
      ...this.state,
      activeTab: "review",
      selectedReviewChangeSetId: undefined,
      selectedForwardRevisionRef: reviewRef,
      feedback: undefined,
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
    };
    this.emit();
    void this.refresh();
  }

  /**
   * Reads session-local decisions only when the supplied plan is still exact.
   *
   * @param plan - Plan currently rendered by React
   * @returns Immutable saved decisions, or an empty draft for stale input
   */
  getReviewDraft(plan: Readonly<KnowledgeReviewPlan>): KnowledgeReviewDraftState {
    const bundleId = this.state.bundleId;
    const current = this.getCurrentReview(plan);
    if (!bundleId || !current) return Object.freeze({});
    return this.reviewDrafts.read(createKnowledgeReviewDraftIdentity(bundleId, current));
  }

  /** Reads the bounded active editor retained for one exact current Review. */
  getReviewActiveEdit(
    plan: Readonly<KnowledgeReviewPlan>
  ): Readonly<KnowledgeReviewActiveEdit> | undefined {
    const bundleId = this.state.bundleId;
    const current = this.getCurrentReview(plan);
    if (!bundleId || !current) return undefined;
    return this.reviewDrafts.readActiveEdit(createKnowledgeReviewDraftIdentity(bundleId, current));
  }

  /**
   * Saves complete decisions without retaining any active textarea buffer.
   *
   * @param plan - Exact plan that produced the UI decision
   * @param draft - Complete replacement decision map
   */
  updateReviewDraft(
    plan: Readonly<KnowledgeReviewPlan>,
    draft: KnowledgeReviewDraftState
  ): boolean {
    const bundleId = this.state.bundleId;
    const current = this.getCurrentReview(plan);
    if (!bundleId || !current || this.state.pendingAction !== undefined) return false;
    try {
      this.reviewDrafts.write(
        createKnowledgeReviewDraftIdentity(bundleId, current),
        current,
        draft
      );
    } catch {
      return false;
    }
    this.state = {
      ...this.state,
      reviewDraftNotice: undefined,
      reviewDraftRevision: (this.state.reviewDraftRevision ?? 0) + 1,
    };
    this.emit();
    return true;
  }

  /** Saves or closes one bounded active editor for an exact current Review. */
  updateReviewActiveEdit(
    plan: Readonly<KnowledgeReviewPlan>,
    activeEdit: Readonly<KnowledgeReviewActiveEdit> | undefined
  ): boolean {
    const bundleId = this.state.bundleId;
    const current = this.getCurrentReview(plan);
    if (!bundleId || !current || this.state.pendingAction !== undefined) return false;
    try {
      this.reviewDrafts.writeActiveEdit(
        createKnowledgeReviewDraftIdentity(bundleId, current),
        current,
        activeEdit
      );
    } catch {
      return false;
    }
    this.state = {
      ...this.state,
      reviewDraftNotice: undefined,
      reviewDraftRevision: (this.state.reviewDraftRevision ?? 0) + 1,
    };
    this.emit();
    return true;
  }

  /** Resolves a supplied plan only when every exact identity field remains current. */
  private getCurrentReview(
    plan: Readonly<KnowledgeReviewPlan>
  ): Readonly<KnowledgeReviewPlan> | undefined {
    // React receives these exact frozen plan instances from the current controller snapshot.
    // Identity comparison avoids reading any property from a caller-owned impostor.
    return (
      this.state.snapshot?.reviews.find((candidate) => candidate === plan) ??
      this.state.snapshot?.forwardRevisionReviews?.find(
        (candidate): candidate is Readonly<KnowledgeForwardRevisionStudioPendingReview> =>
          candidate.state === "pending" && candidate.plan === plan
      )?.plan
    );
  }

  /**
   * Opens one opaque evidence reference using only identities from the current Review plan.
   *
   * @param evidenceRef - Opaque reference emitted by the current plan projection
   */
  async openReviewEvidence(evidenceRef: string): Promise<void> {
    const bundleId = this.state.bundleId;
    const plan = this.state.snapshot?.reviews.find(
      (review) => review.changeSetId === this.state.selectedReviewChangeSetId
    );
    const knownReference = plan?.evidence.some((evidence) => evidence.evidenceRef === evidenceRef);
    if (
      !bundleId ||
      !plan ||
      !knownReference ||
      !this.reviewEvidencePort ||
      this.state.snapshot?.reviewEvidenceAvailable !== true
    ) {
      this.cancelReviewEvidenceWork();
      this.state = {
        ...this.state,
        openingReviewEvidenceRef: undefined,
        reviewEvidenceError: "That review evidence is no longer available.",
      };
      this.emit();
      return;
    }

    this.cancelReviewEvidenceWork();
    const abort = new AbortController();
    this.reviewEvidenceAbort = abort;
    const generation = ++this.reviewEvidenceGeneration;
    this.state = {
      ...this.state,
      openingReviewEvidenceRef: evidenceRef,
      reviewEvidenceError: undefined,
    };
    this.emit();

    try {
      const rawResult = await this.reviewEvidencePort.openReviewEvidence(
        bundleId,
        {
          changeSetId: plan.changeSetId,
          proposalDigest: plan.proposalDigest,
          expectedSnapshotToken: plan.snapshotToken,
          evidenceRef,
        },
        abort.signal
      );
      if (
        abort.signal.aborted ||
        generation !== this.reviewEvidenceGeneration ||
        this.state.bundleId !== bundleId ||
        this.state.selectedReviewChangeSetId !== plan.changeSetId
      ) {
        return;
      }
      const result = snapshotReviewEvidenceOpenResult(rawResult);
      if (!result) {
        throw new TypeError("Knowledge review evidence result is invalid");
      }
      this.state = {
        ...this.state,
        openingReviewEvidenceRef: undefined,
        reviewEvidenceError: this.getReviewEvidenceResultMessage(result),
      };
      this.emit();
    } catch (error) {
      if (
        abort.signal.aborted ||
        generation !== this.reviewEvidenceGeneration ||
        isAbortError(error)
      ) {
        return;
      }
      this.state = {
        ...this.state,
        openingReviewEvidenceRef: undefined,
        reviewEvidenceError: "That review evidence could not be opened.",
      };
      this.emit();
    } finally {
      if (generation === this.reviewEvidenceGeneration) {
        this.reviewEvidenceAbort = undefined;
      }
    }
  }

  /** Maps one value-free evidence outcome to optional safe user feedback. */
  private getReviewEvidenceResultMessage(
    result: Readonly<KnowledgeReviewEvidenceOpenResult>
  ): string | undefined {
    switch (result.kind) {
      case "opened":
        return undefined;
      case "stale":
        return "This evidence or review changed. Refresh and try the current proposal.";
      case "unsupported":
        return "This evidence location cannot be opened in Obsidian.";
      case "unavailable":
        return "That review evidence could not be opened.";
    }
  }

  /**
   * Detaches one coherent Studio projection from the current read generation.
   *
   * Source lifecycle data must already belong to the read port's Runtime
   * consistency sandwich. The separate lifecycle port is command-only here so the
   * controller never combines independently observed revisions.
   *
   * @param base - Snapshot returned by the Studio read boundary
   * @returns Original snapshot or a copy with a strict detached lifecycle model
   */
  private snapshotStudioRead(base: KnowledgeStudioSnapshot): KnowledgeStudioSnapshot {
    const rawSourceLifecycle = base.sourceLifecycle;
    if (rawSourceLifecycle === undefined) return base;

    const sourceLifecycle = createKnowledgeSourceLifecycleModel({
      bundleId: rawSourceLifecycle.bundleId,
      runtimeRevision: rawSourceLifecycle.runtimeRevision,
      manifestRevision: rawSourceLifecycle.manifestRevision,
      sources: rawSourceLifecycle.sources,
    });
    return Object.freeze({ ...base, sourceLifecycle });
  }

  /** Reloads the current durable snapshot without optimistic status changes. */
  async refresh(): Promise<void> {
    const bundleId = this.state.bundleId;
    if (!bundleId) return;
    this.cancelReviewEvidenceWork();
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
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
      error: undefined,
    };
    this.emit();

    try {
      const snapshot = this.snapshotStudioRead(await this.readPort.load(bundleId, abort.signal));
      assertSnapshotIdentity(bundleId, snapshot);
      if (
        abort.signal.aborted ||
        generation !== this.loadGeneration ||
        this.state.bundleId !== bundleId
      ) {
        return;
      }
      const forwardRevisionReviews = snapshot.forwardRevisionReviews ?? [];
      const forwardPendingPlans = forwardRevisionReviews.flatMap((review) =>
        review.state === "pending" ? [review.plan] : []
      );
      const requestedForwardRevisionRef = this.pendingForwardRevisionFocusRef;
      const focusedForwardRevisionRef = forwardRevisionReviews.some(
        (review) => review.reviewRef === requestedForwardRevisionRef
      )
        ? requestedForwardRevisionRef
        : undefined;
      this.pendingForwardRevisionFocusRef = undefined;
      const reviewDraftsRevoked = this.reviewDrafts.reconcile(bundleId, [
        ...snapshot.reviews,
        ...forwardPendingPlans,
      ]);
      const retainedReviewChangeSetId =
        !focusedForwardRevisionRef &&
        snapshot.reviews.some(
          (review) => review.changeSetId === this.state.selectedReviewChangeSetId
        )
          ? this.state.selectedReviewChangeSetId
          : undefined;
      const retainedForwardRevisionRef = forwardRevisionReviews.some(
        (review) => review.reviewRef === this.state.selectedForwardRevisionRef
      )
        ? this.state.selectedForwardRevisionRef
        : undefined;
      const selectedForwardRevisionRef =
        focusedForwardRevisionRef ??
        (retainedReviewChangeSetId
          ? undefined
          : (retainedForwardRevisionRef ?? forwardRevisionReviews[0]?.reviewRef));
      const selectedReviewChangeSetId = selectedForwardRevisionRef
        ? undefined
        : (retainedReviewChangeSetId ?? snapshot.reviews[0]?.changeSetId);
      const activeTab = focusedForwardRevisionRef
        ? ("review" as const)
        : this.state.snapshot === undefined && snapshot.preferredTab !== undefined
          ? snapshot.preferredTab
          : snapshot.recovery.items.length > 0
            ? this.state.snapshot === undefined
              ? "recovery"
              : this.state.activeTab
            : this.state.activeTab === "recovery"
              ? "activity"
              : this.state.activeTab === "query" && snapshot.queryAvailable !== true
                ? "activity"
                : this.state.activeTab === "sources" && snapshot.sourceLifecycle === undefined
                  ? "activity"
                  : this.state.activeTab;
      this.state = {
        ...this.state,
        status: "ready",
        activeTab,
        refreshing: false,
        snapshot,
        selectedReviewChangeSetId,
        selectedForwardRevisionRef,
        feedback:
          requestedForwardRevisionRef !== undefined && focusedForwardRevisionRef === undefined
            ? {
                kind: "blocked" as const,
                message:
                  "The published forward proposal is not in this current Bundle. The Review inbox was refreshed.",
              }
            : this.state.feedback,
        reviewDraftNotice: reviewDraftsRevoked
          ? "This proposal changed. Its session-only Review draft was cleared."
          : this.state.reviewDraftNotice,
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
    await this.executeAction<void>(
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
   * Rechecks one currently missing source against fresh durable watcher state.
   *
   * @param sourceId - Opaque source identity from the current lifecycle snapshot
   * @param callerSignal - Optional view-owned cancellation signal
   */
  async checkSourceAgain(sourceId: string, callerSignal?: AbortSignal): Promise<void> {
    if (this.state.pendingAction) return;
    const sourceLifecyclePort = this.sourceLifecyclePort;
    const source = this.state.snapshot?.sourceLifecycle?.sources.find(
      (candidate) => candidate.sourceId === sourceId
    );
    if (
      !sourceLifecyclePort ||
      source?.status !== "missing" ||
      source.actions.canCheckAgain !== true
    ) {
      await this.rejectUnavailableAction(
        "This source cannot be checked again from the current snapshot."
      );
      return;
    }

    await this.executeAction<void>(
      { kind: "check_source", targetId: sourceId },
      (bundleId, signal) => sourceLifecyclePort.checkAgain(bundleId, sourceId, signal),
      () => ({
        kind: "success",
        message: "Source check completed. Current durable state has been refreshed.",
      }),
      () => true,
      callerSignal
    );
  }

  /**
   * Requests retirement of one exact active source without deleting generated Wiki pages.
   *
   * @param confirmation - Exact frozen row and revision authority shown to the user
   * @param callerSignal - Optional view-owned cancellation signal
   */
  async retireSource(
    confirmation: Readonly<KnowledgeSourceRemovalConfirmation>,
    callerSignal?: AbortSignal
  ): Promise<void> {
    if (this.state.pendingAction) return;
    const sourceLifecyclePort = this.sourceLifecyclePort;
    const lifecycle = this.state.snapshot?.sourceLifecycle;
    const authority = snapshotRemovalConfirmation(confirmation);
    const source = lifecycle?.sources.find(
      (candidate) => candidate.sourceId === authority?.sourceId
    );
    if (
      !sourceLifecyclePort ||
      !lifecycle ||
      !authority ||
      !source ||
      lifecycle.runtimeRevision !== authority.runtimeRevision ||
      lifecycle.manifestRevision !== authority.manifestRevision ||
      source.sourcePath !== authority.sourcePath ||
      source.retirementRef !== authority.retirementRef ||
      source.actions.canRemove !== true ||
      source.retirementBlockers.length > 0
    ) {
      await this.rejectUnavailableAction(
        "This source cannot be removed from the current snapshot. Clear pending work and check again."
      );
      return;
    }

    const reason = source.status === "missing" ? "source_missing" : "user_requested";
    const { sourceId, retirementRef } = authority;
    await this.executeAction<Readonly<KnowledgeSourceRetirementUiReceipt>>(
      { kind: "retire_source", targetId: sourceId },
      (bundleId, signal) =>
        sourceLifecyclePort.retireSource(bundleId, { sourceId, retirementRef, reason }, signal),
      (result) => this.createSourceRetirementFeedback(result),
      () => true,
      callerSignal
    );
  }

  /** Validates one path-free retirement receipt and maps it to stable feedback. */
  private createSourceRetirementFeedback(
    result: Readonly<KnowledgeSourceRetirementUiReceipt>
  ): KnowledgeStudioFeedback {
    if (typeof result !== "object" || result === null || Reflect.ownKeys(result).length !== 2) {
      throw new TypeError("Knowledge source retirement receipt is invalid");
    }
    const outcome = Object.getOwnPropertyDescriptor(result, "outcome")?.value;
    const retainedWikiPageCount = Object.getOwnPropertyDescriptor(
      result,
      "retainedWikiPageCount"
    )?.value;
    if (
      (outcome !== "retired" && outcome !== "already_retired") ||
      !Number.isSafeInteger(retainedWikiPageCount) ||
      retainedWikiPageCount < 0
    ) {
      throw new TypeError("Knowledge source retirement receipt is invalid");
    }
    return {
      kind: "success",
      message:
        outcome === "retired"
          ? `Source removed from future ingest, Review, and Query citations. ${retainedWikiPageCount} generated Wiki ${
              retainedWikiPageCount === 1 ? "page was" : "pages were"
            } retained.`
          : "The source was already removed. Existing generated Wiki pages remain unchanged.",
    };
  }

  /**
   * Strictly snapshots one identity-bound Review command and reloads durable truth.
   *
   * @param command - Opaque decisions bound to the currently rendered snapshot
   */
  async submitReview(command: KnowledgeReviewCommand): Promise<void> {
    this.cancelReviewEvidenceWork();
    if (this.state.pendingAction) return;
    let captured: KnowledgeReviewCommand;
    try {
      captured = snapshotKnowledgeReviewCommand(command);
    } catch {
      this.state = {
        ...this.state,
        feedback: {
          kind: "blocked",
          message: "This review command is invalid and was not submitted.",
        },
      };
      this.emit();
      return;
    }
    const snapshot = this.state.snapshot;
    const current = snapshot?.reviews.find((review) => review.changeSetId === captured.changeSetId);
    if (
      !current ||
      current.proposalDigest !== captured.proposalDigest ||
      current.snapshotToken !== captured.expectedSnapshotToken
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

    const draftIdentity = createKnowledgeReviewDraftIdentity(current.bundleId, current);
    if (this.reviewDrafts.readActiveEdit(draftIdentity) !== undefined) {
      this.state = {
        ...this.state,
        feedback: {
          kind: "blocked",
          message: "Finish or cancel the active manual edit before submitting this review.",
        },
      };
      this.emit();
      return;
    }

    const rejectsWholeProposal =
      captured.decisions.length === current.files.length &&
      captured.decisions.every((decision) => decision.decision === "reject");
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
      { kind: "submit_review", targetId: captured.changeSetId },
      async (bundleId, signal) => {
        const result = await this.commandPort.submitReview(bundleId, captured, signal);
        if (
          result.kind === "applied" ||
          result.kind === "rejected" ||
          result.kind === "recovery_required"
        ) {
          this.reviewDrafts.delete(draftIdentity);
        }
        return result;
      },
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

  /** Converts one reusable pending Review command into the distinct forward action boundary. */
  async submitForwardRevisionReview(
    reviewRef: string,
    command: KnowledgeReviewCommand
  ): Promise<void> {
    const review = this.state.snapshot?.forwardRevisionReviews?.find(
      (candidate): candidate is Readonly<KnowledgeForwardRevisionStudioPendingReview> =>
        candidate.reviewRef === reviewRef && candidate.state === "pending"
    );
    if (!review) {
      await this.rejectUnavailableAction(
        "That forward proposal changed before submission. Review the refreshed snapshot."
      );
      return;
    }
    let captured: Readonly<KnowledgeForwardRevisionStudioCommand>;
    try {
      captured = createKnowledgeForwardRevisionStudioCommandFromReview(review, command);
    } catch {
      await this.rejectUnavailableAction(
        "This forward Review command is invalid and was not submitted."
      );
      return;
    }
    const draftIdentity = createKnowledgeReviewDraftIdentity(review.plan.bundleId, review.plan);
    if (this.reviewDrafts.readActiveEdit(draftIdentity) !== undefined) {
      await this.rejectUnavailableAction(
        "Finish or cancel the active manual edit before submitting this forward Review."
      );
      return;
    }
    await this.submitForwardRevisionCommand(captured, draftIdentity);
  }

  /** Retries fresh validation and Apply for one durable accepted-ready forward decision. */
  async applyForwardRevision(reviewRef: string): Promise<void> {
    const review = this.state.snapshot?.forwardRevisionReviews?.find(
      (candidate) => candidate.reviewRef === reviewRef && candidate.state === "accepted_ready"
    );
    if (!review || review.state !== "accepted_ready") {
      await this.rejectUnavailableAction(
        "That accepted forward revision is no longer ready to apply."
      );
      return;
    }
    await this.submitForwardRevisionCommand(
      createKnowledgeForwardRevisionStudioApplyCommand(review)
    );
  }

  /** Serializes one current opaque Forward command and always reloads durable truth. */
  private async submitForwardRevisionCommand(
    commandValue: Readonly<KnowledgeForwardRevisionStudioCommand>,
    draftIdentity?: ReturnType<typeof createKnowledgeReviewDraftIdentity>
  ): Promise<void> {
    if (this.state.pendingAction) return;
    const snapshot = this.state.snapshot;
    if (
      snapshot?.commandCapabilities.forwardRevisionReview !== true ||
      typeof this.commandPort.submitForwardRevisionStudio !== "function"
    ) {
      await this.rejectUnavailableAction(
        "Forward Review decisions and Apply are unavailable from the current snapshot."
      );
      return;
    }
    let command: Readonly<KnowledgeForwardRevisionStudioCommand>;
    try {
      command = snapshotKnowledgeForwardRevisionStudioCommand(commandValue);
    } catch {
      await this.rejectUnavailableAction("This forward revision command is invalid.");
      return;
    }
    const current = snapshot.forwardRevisionReviews?.find(
      (review) =>
        review.reviewRef === command.reviewRef && review.snapshotRef === command.snapshotRef
    );
    if (!current) {
      await this.rejectUnavailableAction(
        "This forward revision changed before submission. Review the refreshed snapshot."
      );
      return;
    }

    await this.executeAction<KnowledgeForwardRevisionStudioSubmissionResult>(
      { kind: "submit_forward_revision", targetId: command.reviewRef },
      (bundleId, signal) =>
        this.commandPort.submitForwardRevisionStudio!(bundleId, command, signal),
      (result) => {
        if (
          draftIdentity &&
          result.kind !== "no_change" &&
          result.kind !== "stale" &&
          result.kind !== "unavailable"
        ) {
          this.reviewDrafts.delete(draftIdentity);
        }
        switch (result.kind) {
          case "applied":
            return { kind: "success", message: "The accepted revision was applied." };
          case "rejected":
            return {
              kind: "success",
              message: "The forward proposal was rejected without writing the Wiki page.",
            };
          case "accepted_ready":
            return {
              kind: "blocked",
              message:
                "The decision is durably accepted, but fresh Apply validation could not begin. It remains visible and retryable.",
            };
          case "applying":
            return {
              kind: "blocked",
              message:
                "The forward Apply journal is durable but paused. Reload the plugin to run startup recovery.",
            };
          case "no_change":
            return {
              kind: "blocked",
              message:
                "The selected edited content already equals the current Wiki page. The proposal remains pending.",
            };
          case "recovery_required":
            return {
              kind: "blocked",
              message:
                "The accepted revision is durable, but an exact file conflict requires recovery.",
            };
          case "stale":
            return {
              kind: "blocked",
              message:
                "The proposal, accepted decision, or current page changed. Review the refreshed state.",
            };
          case "unavailable":
            return {
              kind: "error",
              message: "The forward revision action is temporarily unavailable.",
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
    this.cancelReviewEvidenceWork();
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
    this.reviewEvidenceAbort?.abort();
    this.reviewEvidenceAbort = undefined;
    this.revokeCurrentQueryCapability(false);
    this.loadGeneration += 1;
    this.actionGeneration += 1;
    this.queryGeneration += 1;
    this.reviewEvidenceGeneration += 1;
    this.refreshQueued = false;
    this.reviewDrafts.clear();
  }

  /** Cancels only ephemeral Query and citation-navigation work. */
  private cancelQueryWork(bundleWide = false): void {
    this.queryAbort?.abort();
    this.queryAbort = undefined;
    this.revokeCurrentQueryCapability(bundleWide);
    this.queryGeneration += 1;
  }

  /** Cancels only ephemeral Review evidence navigation and revokes late publication. */
  private cancelReviewEvidenceWork(): void {
    this.reviewEvidenceAbort?.abort();
    this.reviewEvidenceAbort = undefined;
    this.reviewEvidenceGeneration += 1;
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
   * @param callerSignal - Optional view-owned signal bridged to controller cancellation
   */
  private async executeAction<T>(
    pendingAction: KnowledgeStudioPendingAction,
    operation: (bundleId: string, signal: AbortSignal) => Promise<T>,
    toFeedback: (result: T) => KnowledgeStudioFeedback,
    shouldRefreshAfterSuccess: (result: T) => boolean = () => true,
    callerSignal?: AbortSignal
  ): Promise<void> {
    const bundleId = this.state.bundleId;
    if (!bundleId || this.state.pendingAction || callerSignal?.aborted) return;

    this.cancelQueryWork();
    this.cancelReviewEvidenceWork();
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    const abort = new AbortController();
    this.actionAbort = abort;
    const abortFromCaller = (): void => abort.abort();
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    if (callerSignal?.aborted) abort.abort();
    const generation = ++this.actionGeneration;
    this.state = {
      ...this.state,
      pendingAction,
      query: { status: "idle" },
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
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
      callerSignal?.removeEventListener("abort", abortFromCaller);
      if (generation === this.actionGeneration) {
        this.actionAbort = undefined;
        this.refreshQueued = false;
        if (this.state.pendingAction === pendingAction) {
          this.state = { ...this.state, pendingAction: undefined };
          this.emit();
        }
        if (successfulResult === undefined || shouldRefreshAfterSuccess(successfulResult)) {
          await this.refresh();
        }
      }
    }
  }
}
