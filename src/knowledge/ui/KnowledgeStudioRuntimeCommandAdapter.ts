import { IngestQueue, type IngestQueueActivityCommand } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeLiteralRejectCommandError,
  KnowledgeReviewRejectConflictError,
  parseKnowledgeLiteralRejectCommand,
} from "@/knowledge/review/ReviewRejectTransition";
import { KnowledgeRuntimeReviewRejectPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeStudioReviewedApplyPort } from "@/knowledge/ui/KnowledgeStudioReviewedApplyPort";
import type {
  KnowledgeStudioCommandCapabilities,
  KnowledgeStudioCommandPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
} from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";

/** Commands exposed after one production worker generation is safely released. */
export const KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES: Readonly<KnowledgeStudioCommandCapabilities> =
  Object.freeze({
    pauseBundle: true,
    resumeBundle: true,
    cancelJob: true,
    retryJob: true,
    reviewReject: true,
    reviewAccept: false,
    recoveryContinue: false,
    recoveryAbandon: false,
  });

/** Value-free listener used only to request a fresh durable Studio read. */
type KnowledgeStudioCommandHintListener = () => void;

/** Dependencies retained privately by one exact command generation. */
export interface KnowledgeStudioRuntimeCommandAdapterInput {
  queue: IngestQueue;
  reviewReject: KnowledgeRuntimeReviewRejectPort;
  reviewApply?: KnowledgeStudioReviewedApplyPort;
  bundleIds: readonly string[];
  assertCurrent: () => void;
  retainDrain?: (drain: Promise<void>) => void;
  notifyReviewWorkAvailable?: () => void;
}

/** Hidden mutation authority that cannot be recovered by reflecting over the adapter. */
interface KnowledgeStudioRuntimeCommandAdapterState {
  queue: IngestQueue;
  reviewReject: KnowledgeRuntimeReviewRejectPort;
  reviewApply?: KnowledgeStudioReviewedApplyPort;
  bundleIds: ReadonlySet<string>;
  assertCurrent: () => void;
  retainDrain?: (drain: Promise<void>) => void;
  notifyReviewWorkAvailable?: () => void;
  listeners: Map<string, Set<KnowledgeStudioCommandHintListener>>;
}

const commandAdapterStates = new WeakMap<object, KnowledgeStudioRuntimeCommandAdapterState>();

/** Creates the platform-standard cancellation used for stale command generations. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Returns hidden state only for an authentic adapter instance. */
function requireCommandAdapterState(value: unknown): KnowledgeStudioRuntimeCommandAdapterState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeStudioRuntimeCommandAdapter.prototype
  ) {
    throw createAbortError();
  }
  const state = commandAdapterStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Requires a configured Bundle without exposing the captured allowlist. */
function assertBundle(state: KnowledgeStudioRuntimeCommandAdapterState, bundleId: string): void {
  if (typeof bundleId !== "string" || !state.bundleIds.has(bundleId)) {
    throw createAbortError();
  }
}

/** Requires an exact non-negative Queue revision at the UI mutation boundary. */
function assertQueueRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("expectedQueueRevision must be a non-negative safe integer");
  }
}

/** Requires one non-empty opaque Queue job id. */
function assertJobId(jobId: string): void {
  if (typeof jobId !== "string" || jobId.trim().length === 0) {
    throw new TypeError("jobId must be a non-empty string");
  }
}

/** Proves lifecycle and caller cancellation on both sides of an awaited mutation. */
function assertInvocation(
  state: KnowledgeStudioRuntimeCommandAdapterState,
  bundleId: string,
  signal: AbortSignal
): void {
  if (signal.aborted) throw createAbortError();
  assertBundle(state, bundleId);
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Publishes a best-effort reload hint without carrying durable state. */
function publishCommandHint(
  state: KnowledgeStudioRuntimeCommandAdapterState,
  bundleId: string
): void {
  for (const listener of [...(state.listeners.get(bundleId) ?? [])]) {
    try {
      listener();
    } catch {
      // Reload hints are non-authoritative and cannot change command success.
    }
  }
}

/** Requests Review worker attention without changing a durable command result. */
function notifyReviewWorkAvailable(state: KnowledgeStudioRuntimeCommandAdapterState): void {
  try {
    state.notifyReviewWorkAvailable?.();
  } catch {
    // Worker notifications are non-authoritative and may be retried by durable observation.
  }
}

/** Retains one command until its already-entered atomic mutation settles. */
function retainCommandDrain<T>(
  state: KnowledgeStudioRuntimeCommandAdapterState,
  operation: Promise<T>
): Promise<T> {
  if (state.retainDrain) {
    state.retainDrain(
      operation.then(
        () => undefined,
        () => undefined
      )
    );
  }
  return operation;
}

/** Creates one bounded safe diagnostic for a non-literal Review command. */
function createRejectOnlyDiagnostic() {
  return {
    code: "knowledge_review_reject_only",
    severity: "error" as const,
    field: "decisions",
    message: "Only whole-proposal rejection is available in this Knowledge Studio generation",
  };
}

/**
 * Generation-owned mutation adapter for exact Activity and Review commands.
 *
 * Queue, Runtime, worker, and lifecycle authority remain hidden in a WeakMap.
 * React receives only the strict Review decision interface; optional accepted
 * content crosses the narrow reviewed-apply port, while no model, Vault,
 * transaction, or direct storage method crosses the boundary.
 */
export class KnowledgeStudioRuntimeCommandAdapter implements KnowledgeStudioCommandPort {
  /** Captures the exact production Queue and atomic Reject facade for one generation. */
  constructor(input: KnowledgeStudioRuntimeCommandAdapterInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      !(input.queue instanceof IngestQueue) ||
      !(input.reviewReject instanceof KnowledgeRuntimeReviewRejectPort) ||
      !Array.isArray(input.bundleIds) ||
      typeof input.assertCurrent !== "function" ||
      (input.retainDrain !== undefined && typeof input.retainDrain !== "function") ||
      (input.notifyReviewWorkAvailable !== undefined &&
        typeof input.notifyReviewWorkAvailable !== "function")
    ) {
      throw createAbortError();
    }
    if (input.reviewApply !== undefined) {
      KnowledgeStudioReviewedApplyPort.assert(input.reviewApply);
    }
    const bundleIds = new Set<string>();
    for (const bundleId of input.bundleIds) {
      if (typeof bundleId !== "string" || bundleId.trim().length === 0 || bundleIds.has(bundleId)) {
        throw createAbortError();
      }
      bundleIds.add(bundleId);
    }
    if (bundleIds.size === 0) throw createAbortError();
    commandAdapterStates.set(this, {
      queue: input.queue,
      reviewReject: input.reviewReject,
      ...(input.reviewApply === undefined ? {} : { reviewApply: input.reviewApply }),
      bundleIds,
      assertCurrent: input.assertCurrent,
      ...(input.retainDrain === undefined ? {} : { retainDrain: input.retainDrain }),
      ...(input.notifyReviewWorkAvailable === undefined
        ? {}
        : { notifyReviewWorkAvailable: input.notifyReviewWorkAvailable }),
      listeners: new Map(),
    });
    Object.freeze(this);
  }

  /** Proves an adapter was constructed by this module without revealing its state. */
  static assert(value: unknown): asserts value is KnowledgeStudioRuntimeCommandAdapter {
    requireCommandAdapterState(value);
  }

  /** Returns the exact immutable capability set implemented by this command generation. */
  getCapabilities(): Readonly<KnowledgeStudioCommandCapabilities> {
    const state = requireCommandAdapterState(this);
    return state.reviewApply
      ? Object.freeze({
          ...KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES,
          reviewAccept: true,
        })
      : KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES;
  }

  /** Subscribes to local value-free command completion hints for one allowed Bundle. */
  subscribe(bundleId: string, listener: KnowledgeStudioCommandHintListener): () => void {
    const state = requireCommandAdapterState(this);
    assertBundle(state, bundleId);
    if (typeof listener !== "function") throw createAbortError();
    state.assertCurrent();
    const listeners = state.listeners.get(bundleId) ?? new Set();
    listeners.add(listener);
    state.listeners.set(bundleId, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) state.listeners.delete(bundleId);
    };
  }

  /** Executes an exact revision-bound Bundle pause. */
  pauseBundle(bundleId: string, expectedQueueRevision: number, signal: AbortSignal): Promise<void> {
    return this.executeActivity({ kind: "pause_bundle", bundleId, expectedQueueRevision }, signal);
  }

  /** Executes an exact revision-bound Bundle resume. */
  resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.executeActivity({ kind: "resume_bundle", bundleId, expectedQueueRevision }, signal);
  }

  /** Executes an exact revision-bound job cancellation. */
  cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    assertJobId(jobId);
    return this.executeActivity(
      { kind: "cancel_job", bundleId, jobId, expectedQueueRevision },
      signal
    );
  }

  /** Executes an exact revision-bound failed-job retry. */
  retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    assertJobId(jobId);
    return this.executeActivity(
      { kind: "retry_job", bundleId, jobId, expectedQueueRevision },
      signal
    );
  }

  /** Rejects a whole proposal or delegates selected acceptance to the narrow apply owner. */
  submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    const state = requireCommandAdapterState(this);
    const operation = (async (): Promise<KnowledgeStudioReviewSubmissionResult> => {
      assertInvocation(state, bundleId, signal);
      let literalReject;
      try {
        literalReject = parseKnowledgeLiteralRejectCommand(command);
      } catch (error) {
        if (!(error instanceof KnowledgeLiteralRejectCommandError)) throw error;
      }
      if (!literalReject) {
        if (!state.reviewApply) {
          return { kind: "blocked", diagnostics: [createRejectOnlyDiagnostic()] };
        }
        const result = await state.reviewApply.submit(bundleId, command, signal);
        if (result.kind === "applied" || result.kind === "rejected") {
          notifyReviewWorkAvailable(state);
        }
        publishCommandHint(state, bundleId);
        return result;
      }
      try {
        assertInvocation(state, bundleId, signal);
        await state.reviewReject.rejectReviewAtomically(bundleId, literalReject);
        notifyReviewWorkAvailable(state);
        publishCommandHint(state, bundleId);
        return { kind: "rejected" };
      } catch (error) {
        if (error instanceof KnowledgeReviewRejectConflictError) {
          return { kind: "stale" };
        }
        throw error;
      }
    })();
    return retainCommandDrain(state, operation);
  }

  /** Rejects recovery continuation because the released workflow owns no startup recovery. */
  async continueRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw createAbortError();
  }

  /** Rejects recovery abandonment because the released workflow owns no startup recovery. */
  async abandonRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw createAbortError();
  }

  /** Executes one exact Queue command and publishes only after durable confirmation. */
  private executeActivity(command: IngestQueueActivityCommand, signal: AbortSignal): Promise<void> {
    const state = requireCommandAdapterState(this);
    assertQueueRevision(command.expectedQueueRevision);
    const operation = (async () => {
      assertInvocation(state, command.bundleId, signal);
      await state.queue.executeActivityCommand(command);
      assertInvocation(state, command.bundleId, signal);
      publishCommandHint(state, command.bundleId);
    })();
    return retainCommandDrain(state, operation);
  }
}

Object.freeze(KnowledgeStudioRuntimeCommandAdapter.prototype);
Object.freeze(KnowledgeStudioRuntimeCommandAdapter);
