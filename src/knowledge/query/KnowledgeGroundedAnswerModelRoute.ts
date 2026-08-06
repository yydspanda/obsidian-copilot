import {
  assertKnowledgeGroundedAnswerRequest,
  KnowledgeGroundedAnswerError,
  type KnowledgeGroundedAnswerModelPort,
  type KnowledgeGroundedAnswerRequest,
} from "@/knowledge/query/KnowledgeGroundedAnswer";

const ROUTE_TOKEN = Symbol("KnowledgeGroundedAnswerModelRoute.constructor");

/** Private transport closure retained only in module-owned route state. */
export type KnowledgeGroundedAnswerModelInvoke = (
  request: Readonly<KnowledgeGroundedAnswerRequest>,
  signal: AbortSignal
) => Promise<string>;

interface KnowledgeGroundedAnswerModelRouteState {
  readonly bundleId: string;
  readonly invoke: KnowledgeGroundedAnswerModelInvoke;
}

const routeStates = new WeakMap<object, KnowledgeGroundedAnswerModelRouteState>();

interface LinkedAbortSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** Requires one canonical Bundle identity without normalizing it. */
function assertBundleId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Requires only the cross-realm AbortSignal surface consumed by this route. */
function assertAbortSignal(value: unknown): asserts value is AbortSignal {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<AbortSignal>).aborted !== "boolean" ||
    typeof (value as Partial<AbortSignal>).addEventListener !== "function" ||
    typeof (value as Partial<AbortSignal>).removeEventListener !== "function"
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Returns hidden state only for an authentic route instance. */
function requireRouteState(value: unknown): KnowledgeGroundedAnswerModelRouteState {
  if (typeof value !== "object" || value === null) throw new KnowledgeGroundedAnswerError();
  const state = routeStates.get(value);
  if (!state) throw new KnowledgeGroundedAnswerError();
  return state;
}

/** Creates the standard cancellation used after lifecycle revocation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Links caller and lifecycle cancellation for exactly one provider invocation. */
function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbortSignal {
  const controller = new AbortController();

  /** Propagates one parent cancellation without retaining its reason. */
  function abort(): void {
    controller.abort();
  }

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return Object.freeze({
    signal: controller.signal,
    dispose: (): void => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  });
}

/** Opaque Bundle-specific route that never exposes its credential or transport closure. */
export class KnowledgeGroundedAnswerModelRoute {
  /** Rejects direct construction without the module-private provider factory token. */
  constructor(token: symbol, bundleId: string, invoke: KnowledgeGroundedAnswerModelInvoke) {
    if (token !== ROUTE_TOKEN || typeof invoke !== "function") {
      throw new KnowledgeGroundedAnswerError();
    }
    assertBundleId(bundleId);
    routeStates.set(this, Object.freeze({ bundleId, invoke }));
    Object.freeze(this);
  }

  /** Rejects spread copies, prototype forgeries, and ordinary route-shaped records. */
  static assert(value: unknown): asserts value is KnowledgeGroundedAnswerModelRoute {
    requireRouteState(value);
  }

  /** Reports whether this private route belongs to one exact Bundle. */
  matchesBundleId(bundleId: string): boolean {
    try {
      assertBundleId(bundleId);
      return requireRouteState(this).bundleId === bundleId;
    } catch {
      return false;
    }
  }
}

Object.freeze(KnowledgeGroundedAnswerModelRoute.prototype);
Object.freeze(KnowledgeGroundedAnswerModelRoute);

/** Seals one reviewed provider transport behind an opaque Bundle route. */
export function bindKnowledgeGroundedAnswerModelRoute(
  bundleId: string,
  invoke: KnowledgeGroundedAnswerModelInvoke
): KnowledgeGroundedAnswerModelRoute {
  return new KnowledgeGroundedAnswerModelRoute(ROUTE_TOKEN, bundleId, invoke);
}

/** Permanently erases one route's retained transport closure after owner revocation. */
export function revokeKnowledgeGroundedAnswerModelRoute(
  route: KnowledgeGroundedAnswerModelRoute
): void {
  requireRouteState(route);
  routeStates.delete(route);
}

/**
 * Creates a narrow model port whose every call is fenced by the owning lifecycle.
 *
 * The returned object has no route descriptor, credential, close, or arbitrary
 * prompt capability. It accepts only authentic requests minted by the Query Core.
 */
export function createKnowledgeGroundedAnswerModelPort(
  route: KnowledgeGroundedAnswerModelRoute,
  assertCurrent: () => void,
  lifecycleSignal?: AbortSignal
): Readonly<KnowledgeGroundedAnswerModelPort> {
  requireRouteState(route);
  if (typeof assertCurrent !== "function") throw new KnowledgeGroundedAnswerError();
  if (lifecycleSignal !== undefined) assertAbortSignal(lifecycleSignal);
  return Object.freeze({
    generate: async (
      request: Readonly<KnowledgeGroundedAnswerRequest>,
      signal: AbortSignal
    ): Promise<string> => {
      assertKnowledgeGroundedAnswerRequest(request);
      assertAbortSignal(signal);
      if (signal.aborted || lifecycleSignal?.aborted) throw createAbortError();
      assertCurrent();
      const state = requireRouteState(route);
      const linked = linkAbortSignals(
        lifecycleSignal === undefined ? [signal] : [signal, lifecycleSignal]
      );
      try {
        const result = await Reflect.apply(state.invoke, undefined, [request, linked.signal]);
        if (linked.signal.aborted) throw createAbortError();
        assertCurrent();
        if (typeof result !== "string") throw new KnowledgeGroundedAnswerError();
        return result;
      } catch (error) {
        if (linked.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw createAbortError();
        }
        throw error;
      } finally {
        linked.dispose();
      }
    },
  });
}
