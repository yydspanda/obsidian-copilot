import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import {
  KnowledgeProductionForwardRevisionProposalActionAdapter,
  type KnowledgeForwardRevisionProposalActionPort,
  type KnowledgeForwardRevisionProposalActionResult,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import type { KnowledgeKnownAppliedWikiOutputsSession } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

interface CapturedDelegate {
  readonly owner: object;
  readonly proposeKnownOutput: KnowledgeForwardRevisionProposalActionPort["proposeKnownOutput"];
}

interface Generation {
  readonly delegate: Readonly<CapturedDelegate>;
  readonly abortController: AbortController;
}

interface State {
  readonly unavailable: KnowledgeForwardRevisionProposalActionPort;
  generation: Readonly<Generation>;
  disposed: boolean;
}

interface LinkedSignal {
  readonly signal: AbortSignal;
  release(): void;
}

const states = new WeakMap<object, State>();
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

/** Explicit fail-closed action used before and between production generations. */
class UnavailableKnowledgeForwardRevisionProposalActionPort implements KnowledgeForwardRevisionProposalActionPort {
  /** Returns a value-free unavailable result without reading caller values. */
  async proposeKnownOutput(
    _session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    _outputRef: string,
    _signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionProposalActionResult>> {
    return UNAVAILABLE_RESULT;
  }
}

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether one caught value is platform-standard cancellation. */
const isAbortError = isKnowledgeAbortError;

/** Captures the exact production adapter receiver behind one frozen invocation. */
function captureProductionDelegate(
  value: KnowledgeProductionForwardRevisionProposalActionAdapter
): Readonly<CapturedDelegate> {
  KnowledgeProductionForwardRevisionProposalActionAdapter.assert(value);
  return Object.freeze({
    owner: value,
    proposeKnownOutput: (
      session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
      outputRef: string,
      signal: AbortSignal
    ) => value.proposeKnownOutput(session, outputRef, signal),
  });
}

/** Captures the internal unavailable action without widening replacement authority. */
function captureUnavailableDelegate(
  value: KnowledgeForwardRevisionProposalActionPort
): Readonly<CapturedDelegate> {
  return Object.freeze({
    owner: value,
    proposeKnownOutput: (
      session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
      outputRef: string,
      signal: AbortSignal
    ) => value.proposeKnownOutput(session, outputRef, signal),
  });
}

/** Links caller and generation cancellation for pre-publication coordinator checks. */
function linkSignals(caller: AbortSignal, generation: AbortSignal): Readonly<LinkedSignal> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (caller.aborted || generation.aborted) controller.abort();
  else {
    caller.addEventListener("abort", abort, { once: true });
    generation.addEventListener("abort", abort, { once: true });
  }
  return Object.freeze({
    signal: controller.signal,
    release: () => {
      caller.removeEventListener("abort", abort);
      generation.removeEventListener("abort", abort);
    },
  });
}

/** Returns hidden state only for an authentic stable proposal action port. */
function requireState(value: unknown): State {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !==
        DelegatingKnowledgeForwardRevisionProposalActionPort.prototype
    ) {
      throw createAbortError();
    }
    const state = states.get(value);
    if (state) return state;
  } catch {
    throw createAbortError();
  }
  throw createAbortError();
}

/** Stable generation-revocable action surface exposed to Known applied outputs UI. */
export class DelegatingKnowledgeForwardRevisionProposalActionPort implements KnowledgeForwardRevisionProposalActionPort {
  /** Creates one unavailable stable action surface. */
  constructor() {
    const unavailable = Object.freeze(new UnavailableKnowledgeForwardRevisionProposalActionPort());
    states.set(this, {
      unavailable,
      generation: Object.freeze({
        delegate: captureUnavailableDelegate(unavailable),
        abortController: new AbortController(),
      }),
      disposed: false,
    });
    Object.freeze(this);
  }

  /** Requires one exact process-local stable proposal action port. */
  static assert(
    value: unknown
  ): asserts value is DelegatingKnowledgeForwardRevisionProposalActionPort {
    requireState(value);
  }

  /** Requires that one exact production adapter owns the current generation. */
  static assertCurrentDelegate(
    value: unknown,
    delegate: KnowledgeProductionForwardRevisionProposalActionAdapter
  ): asserts value is DelegatingKnowledgeForwardRevisionProposalActionPort {
    const state = requireState(value);
    KnowledgeProductionForwardRevisionProposalActionAdapter.assert(delegate);
    if (state.disposed || state.generation.delegate.owner !== delegate) throw createAbortError();
  }

  /** Reports whether this authentic surface currently routes to a production delegate. */
  isAvailable(): boolean {
    const state = requireState(this);
    return !state.disposed && state.generation.delegate.owner !== state.unavailable;
  }

  /** Atomically publishes one genuine production adapter and revokes old work. */
  replaceDelegate(delegate: KnowledgeProductionForwardRevisionProposalActionAdapter): void {
    const state = requireState(this);
    if (state.disposed) throw createAbortError();
    const next = Object.freeze({
      delegate: captureProductionDelegate(delegate),
      abortController: new AbortController(),
    });
    const previous = state.generation;
    state.generation = next;
    previous.abortController.abort();
  }

  /** Conditionally revokes only the exact production adapter still installed. */
  revokeDelegate(delegate: KnowledgeProductionForwardRevisionProposalActionAdapter): void {
    const state = requireState(this);
    KnowledgeProductionForwardRevisionProposalActionAdapter.assert(delegate);
    if (state.disposed || state.generation.delegate.owner !== delegate) return;
    this.setUnavailable();
  }

  /** Withdraws the current generation without disposing the stable UI surface. */
  setUnavailable(): void {
    const state = requireState(this);
    if (state.disposed) return;
    const previous = state.generation;
    state.generation = Object.freeze({
      delegate: captureUnavailableDelegate(state.unavailable),
      abortController: new AbortController(),
    });
    previous.abortController.abort();
  }

  /**
   * Routes one opaque authentic session selection through the current generation.
   *
   * Generation or caller cancellation wins for every non-committed result. A
   * confirmed `published` result wins after delegate dispatch so durable truth is
   * never rewritten as a cancellation merely because the lease was then revoked.
   */
  async proposeKnownOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionProposalActionResult>> {
    const state = requireState(this);
    const generation = state.generation;
    const linked = linkSignals(signal, generation.abortController.signal);
    try {
      if (state.disposed || linked.signal.aborted) throw createAbortError();
      const result = await generation.delegate.proposeKnownOutput(
        session,
        outputRef,
        linked.signal
      );
      if (result.kind === "published") return result;
      if (state.disposed || state.generation !== generation || linked.signal.aborted) {
        throw createAbortError();
      }
      return result;
    } catch (error) {
      if (state.disposed || state.generation !== generation || linked.signal.aborted) {
        throw createAbortError();
      }
      if (isAbortError(error)) throw createAbortError();
      return UNAVAILABLE_RESULT;
    } finally {
      linked.release();
    }
  }

  /** Permanently revokes this stable action surface and all in-flight work. */
  dispose(): void {
    const state = requireState(this);
    if (state.disposed) return;
    state.disposed = true;
    state.generation.abortController.abort();
  }
}

Object.freeze(DelegatingKnowledgeForwardRevisionProposalActionPort.prototype);
Object.freeze(DelegatingKnowledgeForwardRevisionProposalActionPort);
