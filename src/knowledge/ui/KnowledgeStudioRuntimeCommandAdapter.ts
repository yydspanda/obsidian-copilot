import { IngestQueue, type IngestQueueActivityCommand } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeLiteralRejectCommandError,
  KnowledgeReviewRejectConflictError,
  parseKnowledgeLiteralRejectCommand,
} from "@/knowledge/review/ReviewRejectTransition";
import {
  KnowledgeRuntimeReviewRejectPort,
  type KnowledgeCompletedSourceReanalysisCommand,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeStudioReviewedApplyPort } from "@/knowledge/ui/KnowledgeStudioReviewedApplyPort";
import type {
  KnowledgeStudioCommandCapabilities,
  KnowledgeStudioCommandPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
} from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";

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

type KnowledgeStudioCommandHintListener = () => void;

export interface KnowledgeStudioRuntimeCommandAdapterInput {
  queue: IngestQueue;
  reviewReject: KnowledgeRuntimeReviewRejectPort;
  reviewApply?: KnowledgeStudioReviewedApplyPort;
  bundleIds: readonly string[];
  assertCurrent: () => void;
  retainDrain?: (drain: Promise<void>) => void;
  notifyReviewWorkAvailable?: () => void;
  reanalyzeCompletedSource?: (command: KnowledgeCompletedSourceReanalysisCommand) => Promise<void>;
  onGenerationRefreshRequired?: () => void;
}

interface KnowledgeStudioRuntimeCommandAdapterState {
  queue: IngestQueue;
  reviewReject: KnowledgeRuntimeReviewRejectPort;
  reviewApply?: KnowledgeStudioReviewedApplyPort;
  bundleIds: ReadonlySet<string>;
  assertCurrent: () => void;
  retainDrain?: (drain: Promise<void>) => void;
  notifyReviewWorkAvailable?: () => void;
  reanalyzeCompletedSource?: KnowledgeStudioRuntimeCommandAdapterInput["reanalyzeCompletedSource"];
  onGenerationRefreshRequired?: () => void;
  listeners: Map<string, Set<KnowledgeStudioCommandHintListener>>;
}

const commandAdapterStates = new WeakMap<object, KnowledgeStudioRuntimeCommandAdapterState>();

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

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

function assertBundle(state: KnowledgeStudioRuntimeCommandAdapterState, bundleId: string): void {
  if (typeof bundleId !== "string" || !state.bundleIds.has(bundleId)) {
    throw createAbortError();
  }
}

function assertQueueRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("expectedQueueRevision must be a non-negative safe integer");
  }
}

function assertJobId(jobId: string): void {
  if (typeof jobId !== "string" || jobId.trim().length === 0) {
    throw new TypeError("jobId must be a non-empty string");
  }
}

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

function publishCommandHint(
  state: KnowledgeStudioRuntimeCommandAdapterState,
  bundleId: string
): void {
  for (const listener of [...(state.listeners.get(bundleId) ?? [])]) {
    try {
      listener();
    } catch {
      // Reload hints are non-authoritative and cannot change command success.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }
}

function notifyReviewWorkAvailable(state: KnowledgeStudioRuntimeCommandAdapterState): void {
  try {
    state.notifyReviewWorkAvailable?.();
  } catch {
    // Worker notifications are non-authoritative and may be retried by durable observation.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

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

function createRejectOnlyDiagnostic() {
  return {
    code: "knowledge_review_reject_only",
    severity: "error" as const,
    field: "decisions",
    message: "Only whole-proposal rejection is available in this Knowledge Studio generation",
  };
}

export class KnowledgeStudioRuntimeCommandAdapter implements KnowledgeStudioCommandPort {
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
        typeof input.notifyReviewWorkAvailable !== "function") ||
      (input.reanalyzeCompletedSource !== undefined &&
        typeof input.reanalyzeCompletedSource !== "function") ||
      (input.onGenerationRefreshRequired !== undefined &&
        typeof input.onGenerationRefreshRequired !== "function")
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
      ...(input.reanalyzeCompletedSource === undefined
        ? {}
        : { reanalyzeCompletedSource: input.reanalyzeCompletedSource }),
      ...(input.onGenerationRefreshRequired === undefined
        ? {}
        : { onGenerationRefreshRequired: input.onGenerationRefreshRequired }),
      listeners: new Map(),
    });
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeStudioRuntimeCommandAdapter {
    requireCommandAdapterState(value);
  }

  getCapabilities(): Readonly<KnowledgeStudioCommandCapabilities> {
    const state = requireCommandAdapterState(this);
    return state.reviewApply || state.reanalyzeCompletedSource || state.onGenerationRefreshRequired
      ? Object.freeze({
          ...KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES,
          ...(state.reviewApply ? { reviewAccept: true } : {}),
          ...(state.reanalyzeCompletedSource ? { reanalyzeJob: true } : {}),
          ...(state.onGenerationRefreshRequired ? { runSelectedJob: true } : {}),
        })
      : KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES;
  }

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

  pauseBundle(bundleId: string, expectedQueueRevision: number, signal: AbortSignal): Promise<void> {
    return this.executeActivity({ kind: "pause_bundle", bundleId, expectedQueueRevision }, signal);
  }

  resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.executeActivity({ kind: "resume_bundle", bundleId, expectedQueueRevision }, signal);
  }

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

  async reanalyzeJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    const state = requireCommandAdapterState(this);
    assertJobId(jobId);
    assertQueueRevision(expectedQueueRevision);
    const operation = (async () => {
      assertInvocation(state, bundleId, signal);
      // Legacy command generations cannot turn a completed row into fresh model work.
      // https://github.com/yydspanda/obsidian-copilot/issues/16
      if (!state.reanalyzeCompletedSource) throw createAbortError();
      await state.reanalyzeCompletedSource(
        Object.freeze({ bundleId, jobId, expectedQueueRevision })
      );
      // Once the atomic replay exists, late cancellation must not invite another paid attempt.
      // https://github.com/yydspanda/obsidian-copilot/issues/16
      publishCommandHint(state, bundleId);
    })();
    return retainCommandDrain(state, operation);
  }

  async runSelectedJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    const state = requireCommandAdapterState(this);
    assertJobId(jobId);
    assertQueueRevision(expectedQueueRevision);
    const operation = (async () => {
      assertInvocation(state, bundleId, signal);
      // A completed no-changes run changes Manifest authority even without writing Wiki.
      // Only a generation owner can safely expose this paid action.
      // https://github.com/yydspanda/obsidian-copilot/issues/18
      if (!state.onGenerationRefreshRequired) throw createAbortError();
      let result;
      try {
        result = await state.queue.runSelected(bundleId, jobId, expectedQueueRevision);
      } catch (error) {
        // A persistence failure may follow a durable commit; refresh authority, never retry.
        // https://github.com/yydspanda/obsidian-copilot/issues/18
        try {
          state.onGenerationRefreshRequired();
        } catch {
          // Notification cannot change durable truth.
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
        throw error;
      } finally {
        publishCommandHint(state, bundleId);
      }
      if (
        result.kind === "executed" &&
        result.status === "completed" &&
        result.generationEffect === "manifest_no_changes_committed"
      ) {
        try {
          state.onGenerationRefreshRequired();
        } catch {
          // A committed result remains successful.
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
      }
      // Backoff, failure and unavailable work are not a completed analysis and must not show success.
      // https://github.com/yydspanda/obsidian-copilot/issues/18
      if (
        result.kind !== "executed" ||
        result.jobId !== jobId ||
        (result.status !== "completed" && result.status !== "awaiting_review")
      ) {
        throw new Error("The selected material did not finish; inspect its Activity status.");
      }
    })();
    return retainCommandDrain(state, operation);
  }

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

  async continueRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw createAbortError();
  }

  async abandonRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw createAbortError();
  }

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
