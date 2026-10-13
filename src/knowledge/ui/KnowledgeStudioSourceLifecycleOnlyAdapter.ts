import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
  KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import {
  createKnowledgeSourceLifecycleModel,
  type KnowledgeSourceLifecycleModel,
} from "@/knowledge/ui/sourceLifecycleModel";
import {
  createUnavailableKnowledgeStudioSnapshot,
  KnowledgeStudioAdapterUnavailableError,
  type KnowledgeStudioCommandPort,
  type KnowledgeStudioReadPort,
  type KnowledgeStudioRecoverySubmissionResult,
  type KnowledgeStudioReviewSubmissionResult,
  type KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import { sha256 } from "@/utils/hash";

export interface KnowledgeStudioSourceLifecycleOnlyAdapterInput {
  bundleId: string;
  sourceLifecycle: KnowledgeSourceLifecyclePort;
  assertCurrent(): void;
}

interface SourceLifecycleOnlyState {
  readonly bundleId: string;
  readonly loadSources: KnowledgeSourceLifecyclePort["loadSources"];
  readonly checkAgain: KnowledgeSourceLifecyclePort["checkAgain"];
  readonly retireSource: KnowledgeSourceLifecyclePort["retireSource"];
  readonly assertCurrent: () => void;
}

const sourceLifecycleOnlyStates = new WeakMap<object, SourceLifecycleOnlyState>();

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function captureLifecycleMethod<K extends keyof KnowledgeSourceLifecyclePort>(
  owner: object,
  key: K
): KnowledgeSourceLifecyclePort[K] {
  let current: object | null = owner;
  const visited = new Set<object>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw createAbortError();
      }
      return descriptor.value as KnowledgeSourceLifecyclePort[K];
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw createAbortError();
}

function requireState(value: unknown): SourceLifecycleOnlyState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeStudioSourceLifecycleOnlyAdapter.prototype
  ) {
    throw createAbortError();
  }
  const state = sourceLifecycleOnlyStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

function assertInvocation(
  state: SourceLifecycleOnlyState,
  bundleId: string,
  signal: AbortSignal
): void {
  if (signal.aborted || bundleId !== state.bundleId) throw createAbortError();
  try {
    state.assertCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

function snapshotLifecycleModel(
  value: Readonly<KnowledgeSourceLifecycleModel>
): Readonly<KnowledgeSourceLifecycleModel> {
  return createKnowledgeSourceLifecycleModel({
    bundleId: value.bundleId,
    runtimeRevision: value.runtimeRevision,
    manifestRevision: value.manifestRevision,
    sources: value.sources,
  });
}

function createRevisionToken(model: Readonly<KnowledgeSourceLifecycleModel>): string {
  const material: JsonValue = {
    version: 1,
    bundleId: model.bundleId,
    runtimeRevision: model.runtimeRevision,
    manifestRevision: model.manifestRevision,
    sources: model.sources.map((source) => ({
      sourceId: source.sourceId,
      status: source.status,
      retirementRef: source.retirementRef,
      blockers: [...source.retirementBlockers],
    })),
  };
  return `knowledge-source-lifecycle-${sha256(canonicalizeJson(material))}`;
}

export class KnowledgeStudioSourceLifecycleOnlyAdapter
  implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort, KnowledgeSourceLifecyclePort
{
  constructor(input: KnowledgeStudioSourceLifecycleOnlyAdapterInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.bundleId !== "string" ||
      input.bundleId.trim().length === 0 ||
      typeof input.sourceLifecycle !== "object" ||
      input.sourceLifecycle === null ||
      typeof input.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    const owner = input.sourceLifecycle;
    const loadSources = captureLifecycleMethod(owner, "loadSources");
    const checkAgain = captureLifecycleMethod(owner, "checkAgain");
    const retireSource = captureLifecycleMethod(owner, "retireSource");
    sourceLifecycleOnlyStates.set(this, {
      bundleId: input.bundleId,
      loadSources: (bundleId, signal) => Reflect.apply(loadSources, owner, [bundleId, signal]),
      checkAgain: (bundleId, sourceId, signal) =>
        Reflect.apply(checkAgain, owner, [bundleId, sourceId, signal]),
      retireSource: (bundleId, request, signal) =>
        Reflect.apply(retireSource, owner, [bundleId, request, signal]),
      assertCurrent: () => input.assertCurrent(),
    });
    Object.freeze(this);
  }

  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    const state = requireState(this);
    assertInvocation(state, bundleId, signal);
    const sourceLifecycle = snapshotLifecycleModel(await state.loadSources(bundleId, signal));
    assertInvocation(state, bundleId, signal);
    const empty = createUnavailableKnowledgeStudioSnapshot(bundleId);
    return Object.freeze({
      ...empty,
      revisionToken: createRevisionToken(sourceLifecycle),
      availability: "ready" as const,
      sourceLifecycle,
      preferredTab: "sources" as const,
      queryAvailable: false,
      queryWritebackAvailable: false,
      notice:
        "Knowledge startup is held for a source decision. Only source recheck and registration removal are available; ingest, model, Review, Apply, Query, and Wiki writes remain stopped.",
    });
  }

  subscribe(bundleId: string, _onHint: () => void): () => void {
    const state = requireState(this);
    assertInvocation(state, bundleId, new AbortController().signal);
    return () => undefined;
  }

  async loadSources(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceLifecycleModel>> {
    const state = requireState(this);
    assertInvocation(state, bundleId, signal);
    const model = snapshotLifecycleModel(await state.loadSources(bundleId, signal));
    assertInvocation(state, bundleId, signal);
    return model;
  }

  async checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void> {
    const state = requireState(this);
    assertInvocation(state, bundleId, signal);
    await state.checkAgain(bundleId, sourceId, signal);
  }

  async retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> {
    const state = requireState(this);
    assertInvocation(state, bundleId, signal);
    return state.retireSource(bundleId, request, signal);
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
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  async abandonRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }
}

Object.freeze(KnowledgeStudioSourceLifecycleOnlyAdapter.prototype);
Object.freeze(KnowledgeStudioSourceLifecycleOnlyAdapter);
