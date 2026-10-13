import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { KnowledgeProductionRecoveryComposer } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";
import type {
  KnowledgeStudioCommandCapabilities,
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import {
  createUnavailableKnowledgeStudioSnapshot,
  KnowledgeStudioAdapterUnavailableError,
} from "@/knowledge/ui/KnowledgeStudioController";
import { sha256 } from "@/utils/hash";

export interface KnowledgeStudioRecoveryActionPort {
  continue(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult>;

  abandon(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult>;
}

export interface KnowledgeStudioRecoveryOnlyAdapterInput {
  composer: KnowledgeProductionRecoveryComposer;
  bundleIds: readonly string[];
  actions: KnowledgeStudioRecoveryActionPort;
  assertCurrent(): void;
  onRecoveryStateChanged(): void;
}

interface KnowledgeStudioRecoveryOnlyAdapterState {
  composer: KnowledgeProductionRecoveryComposer;
  bundleIds: ReadonlySet<string>;
  continueRecovery: KnowledgeStudioRecoveryActionPort["continue"];
  abandonRecovery: KnowledgeStudioRecoveryActionPort["abandon"];
  assertCurrent: () => void;
  onRecoveryStateChanged: () => void;
  loadedBundles: Set<string>;
  loadTail: Promise<void>;
}

const recoveryAdapterStates = new WeakMap<object, KnowledgeStudioRecoveryOnlyAdapterState>();

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function requireRecoveryAdapterState(value: unknown): KnowledgeStudioRecoveryOnlyAdapterState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeStudioRecoveryOnlyAdapter.prototype
  ) {
    throw createAbortError();
  }
  const state = recoveryAdapterStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

function assertInvocation(
  state: KnowledgeStudioRecoveryOnlyAdapterState,
  bundleId: string,
  signal: AbortSignal
): void {
  if (signal.aborted || !state.bundleIds.has(bundleId)) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

function requestRecoveryStateChanged(state: KnowledgeStudioRecoveryOnlyAdapterState): void {
  try {
    state.onRecoveryStateChanged();
  } catch {
    // The retained recovery state remains fail-closed if lifecycle notification fails.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

function createRecoveryRevisionToken(
  observation: NonNullable<ReturnType<KnowledgeProductionRecoveryComposer["getStudioObservation"]>>
): string {
  const material: JsonValue = {
    version: 1,
    bundleId: observation.bundleId,
    runtimeRevision: observation.runtimeRevision,
    reviewRevision: observation.reviewRevision,
    queueRevision: observation.activity?.revision ?? null,
    items: (observation.recovery?.items ?? []).map((item) => ({
      id: item.id,
      status: item.status,
      changeSetId: item.changeSetId ?? null,
      transactionId: item.transactionId ?? null,
      phase: item.phase ?? null,
      blockedReason: item.blockedReason ?? null,
      canContinue: item.actions.canContinue,
      canAbandon: item.actions.canAbandon,
    })),
    forwardRevisionReviews: observation.forwardRevisionReviews.map((review) => ({
      reviewRef: review.reviewRef,
      snapshotRef: review.snapshotRef,
      state: review.state,
      updatedAt: review.updatedAt,
      ...(review.state === "applying"
        ? { applyPhase: review.applyPhase }
        : {
            conflictCode: review.conflictCode,
            actualKind: review.actualKind,
            detectedAt: review.detectedAt,
          }),
    })),
  };
  return `knowledge-recovery-${sha256(canonicalizeJson(material))}`;
}

function createRecoveryCapabilities(
  observation: NonNullable<ReturnType<KnowledgeProductionRecoveryComposer["getStudioObservation"]>>
): Readonly<KnowledgeStudioCommandCapabilities> {
  return Object.freeze({
    pauseBundle: false,
    resumeBundle: false,
    cancelJob: false,
    retryJob: false,
    reviewReject: false,
    reviewAccept: false,
    forwardRevisionReview: false,
    recoveryContinue: (observation.recovery?.items ?? []).some((item) => item.actions.canContinue),
    recoveryAbandon: (observation.recovery?.items ?? []).some((item) => item.actions.canAbandon),
  });
}

export class KnowledgeStudioRecoveryOnlyAdapter
  implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort
{
  constructor(input: KnowledgeStudioRecoveryOnlyAdapterInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      !Array.isArray(input.bundleIds) ||
      typeof input.actions !== "object" ||
      input.actions === null ||
      typeof input.actions.continue !== "function" ||
      typeof input.actions.abandon !== "function" ||
      typeof input.assertCurrent !== "function" ||
      typeof input.onRecoveryStateChanged !== "function"
    ) {
      throw createAbortError();
    }
    KnowledgeProductionRecoveryComposer.assert(input.composer);
    const bundleIds = new Set<string>();
    for (const bundleId of input.bundleIds) {
      if (typeof bundleId !== "string" || bundleId.trim().length === 0 || bundleIds.has(bundleId)) {
        throw createAbortError();
      }
      bundleIds.add(bundleId);
    }
    if (bundleIds.size === 0) throw createAbortError();
    recoveryAdapterStates.set(this, {
      composer: input.composer,
      bundleIds,
      continueRecovery: (bundleId, recoveryId, expectedRuntimeRevision, signal) =>
        input.actions.continue(bundleId, recoveryId, expectedRuntimeRevision, signal),
      abandonRecovery: (bundleId, recoveryId, expectedRuntimeRevision, signal) =>
        input.actions.abandon(bundleId, recoveryId, expectedRuntimeRevision, signal),
      assertCurrent: () => input.assertCurrent(),
      onRecoveryStateChanged: () => input.onRecoveryStateChanged(),
      loadedBundles: new Set(),
      loadTail: Promise.resolve(),
    });
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeStudioRecoveryOnlyAdapter {
    requireRecoveryAdapterState(value);
  }

  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    const state = requireRecoveryAdapterState(this);
    assertInvocation(state, bundleId, signal);
    const shouldRecheck = state.loadedBundles.has(bundleId);
    const previous = state.loadTail;
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        assertInvocation(state, bundleId, signal);
        if (shouldRecheck) {
          await state.composer.start();
          assertInvocation(state, bundleId, signal);
        }
      });
    state.loadTail = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    assertInvocation(state, bundleId, signal);
    state.loadedBundles.add(bundleId);
    const observation = state.composer.getStudioObservation(bundleId);
    if (!observation) {
      requestRecoveryStateChanged(state);
      throw createAbortError();
    }
    const fallback = createUnavailableKnowledgeStudioSnapshot(bundleId);
    const forwardRevisionBlocked = observation.forwardRevisionReviews.length > 0;
    const forwardRevisionState = observation.forwardRevisionReviews[0]?.state;
    const activity =
      observation.activity ??
      Object.freeze({
        ...fallback.activity,
        controls: Object.freeze({
          state: forwardRevisionBlocked
            ? ("recovery_required" as const)
            : ("startup_recovery" as const),
          canPause: false,
          canResume: false,
        }),
      });
    const recovery =
      observation.recovery ??
      Object.freeze({
        bundleId,
        runtimeRevision: observation.runtimeRevision,
        items: Object.freeze([]),
      });
    return Object.freeze({
      bundleId,
      revisionToken: createRecoveryRevisionToken(observation),
      availability: "ready" as const,
      ...(forwardRevisionBlocked ? { preferredTab: "review" as const } : {}),
      commandCapabilities: createRecoveryCapabilities(observation),
      activity,
      reviews: Object.freeze([]),
      forwardRevisionReviews: observation.forwardRevisionReviews,
      recovery,
      notice:
        forwardRevisionState === "applying"
          ? "Knowledge startup paused after bounded recovery attempts for this durable Apply journal. New work remains disabled; reload the plugin or reopen Studio to run startup recovery again."
          : forwardRevisionState === "recovery_required"
            ? "Knowledge startup is blocked by a sticky exact-file conflict. Automatic Apply retry is disabled; preserve the current note and use the supported recovery path before restarting Knowledge work."
            : "Knowledge startup is paused for an explicit recovery decision. Ordinary ingest and Review commands remain disabled.",
    });
  }

  subscribe(bundleId: string, _onHint: () => void): () => void {
    const state = requireRecoveryAdapterState(this);
    if (!state.bundleIds.has(bundleId)) throw createAbortError();
    state.assertCurrent();
    return () => undefined;
  }

  async pauseBundle(
    _bundleId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async resumeBundle(
    _bundleId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async cancelJob(
    _bundleId: string,
    _jobId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async retryJob(
    _bundleId: string,
    _jobId: string,
    _expectedQueueRevision: number,
    _signal: AbortSignal
  ): Promise<void> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async submitReview(
    _bundleId: string,
    _command: KnowledgeReviewCommand,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async continueRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    const state = requireRecoveryAdapterState(this);
    assertInvocation(state, bundleId, signal);
    return state.continueRecovery(bundleId, recoveryId, expectedRuntimeRevision, signal);
  }

  async abandonRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    const state = requireRecoveryAdapterState(this);
    assertInvocation(state, bundleId, signal);
    return state.abandonRecovery(bundleId, recoveryId, expectedRuntimeRevision, signal);
  }
}

Object.freeze(KnowledgeStudioRecoveryOnlyAdapter.prototype);
Object.freeze(KnowledgeStudioRecoveryOnlyAdapter);
