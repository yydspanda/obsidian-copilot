import {
  getKnowledgeKnownAppliedWikiOutputsErrorCode,
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  KnowledgeKnownAppliedWikiOutputsError,
  snapshotKnowledgeKnownAppliedWikiOutputComparisonResult,
  snapshotKnowledgeKnownAppliedWikiOutputDetailResult,
  snapshotKnowledgeKnownAppliedWikiOutputsPageResult,
  snapshotKnowledgeKnownAppliedWikiOutputsRequest,
  snapshotKnowledgeKnownAppliedWikiOutputsSession,
  type KnowledgeKnownAppliedWikiOutputComparisonResult,
  type KnowledgeKnownAppliedWikiOutputDetailResult,
  type KnowledgeKnownAppliedWikiOutputsPageResult,
  type KnowledgeKnownAppliedWikiOutputsPort,
  type KnowledgeKnownAppliedWikiOutputsRequest,
  type KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

interface CapturedDelegate {
  readonly owner: object;
  readonly inspectKnownOutputs: KnowledgeKnownAppliedWikiOutputsPort["inspectKnownOutputs"];
  readonly listMore: KnowledgeKnownAppliedWikiOutputsPort["listMore"];
  readonly readOutput: KnowledgeKnownAppliedWikiOutputsPort["readOutput"];
  readonly compareWithCurrent: KnowledgeKnownAppliedWikiOutputsPort["compareWithCurrent"];
}

interface Generation {
  readonly delegate: CapturedDelegate;
  readonly abortController: AbortController;
}

interface SessionBinding {
  readonly generation: Generation;
  readonly delegateSession: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
  readonly summaries: Map<
    string,
    Readonly<KnowledgeKnownAppliedWikiOutputsSession["items"][number]>
  >;
  remaining: number;
  nextCursor?: string;
  consumedCursors: Set<string>;
}

interface State {
  readonly unavailable: KnowledgeKnownAppliedWikiOutputsPort;
  generation: Generation;
  sessions: WeakMap<object, SessionBinding>;
  disposed: boolean;
}

interface LinkedSignal {
  readonly signal: AbortSignal;
  release(): void;
}

const states = new WeakMap<object, State>();
const STALE_PAGE = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_PAGE = Object.freeze({ kind: "unavailable" as const });
const STALE_DETAIL = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_DETAIL = Object.freeze({ kind: "unavailable" as const });
const STALE_COMPARISON = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_COMPARISON = Object.freeze({ kind: "unavailable" as const });
const OPAQUE_REF_PATTERN = /^known-wiki-(?:page|output|cursor)-[a-f0-9]{64}$/;

/** Reports whether a caller supplied one bounded opaque ref without coercion. */
function isOpaqueRef(value: unknown, kind: "output" | "cursor"): value is string {
  return (
    typeof value === "string" &&
    value.length === `known-wiki-${kind}-`.length + 64 &&
    OPAQUE_REF_PATTERN.test(value) &&
    value.startsWith(`known-wiki-${kind}-`)
  );
}

/** Reports whether a returned session uses the exact opaque field categories. */
function sessionRefsHaveExactKinds(
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>
): boolean {
  return (
    session.pageRef.startsWith("known-wiki-page-") &&
    session.items.every((item) => isOpaqueRef(item.outputRef, "output")) &&
    (session.nextCursor === undefined || isOpaqueRef(session.nextCursor, "cursor"))
  );
}

/** Explicit fail-closed capability used outside a released production generation. */
class UnavailableKnowledgeKnownAppliedWikiOutputsPort
  implements KnowledgeKnownAppliedWikiOutputsPort
{
  /** Rejects a new browsing session while no generation is installed. */
  async inspectKnownOutputs(): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsSession>> {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }

  /** Returns a value-free unavailable page result. */
  async listMore(): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsPageResult>> {
    return UNAVAILABLE_PAGE;
  }

  /** Returns a value-free unavailable detail result. */
  async readOutput(): Promise<Readonly<KnowledgeKnownAppliedWikiOutputDetailResult>> {
    return UNAVAILABLE_DETAIL;
  }

  /** Returns a value-free unavailable comparison result. */
  async compareWithCurrent(): Promise<Readonly<KnowledgeKnownAppliedWikiOutputComparisonResult>> {
    return UNAVAILABLE_COMPARISON;
  }
}

/** Creates a platform cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Finds one callable data method without invoking an accessor. */
function captureMethod(value: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner && visited.size < 64 && !visited.has(owner)) {
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? (descriptor.value as (...args: unknown[]) => unknown)
          : undefined;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Captures the exact delegate receiver and four read-only methods. */
function captureDelegate(value: KnowledgeKnownAppliedWikiOutputsPort): CapturedDelegate {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const inspect = captureMethod(value, "inspectKnownOutputs");
  const listMore = captureMethod(value, "listMore");
  const readOutput = captureMethod(value, "readOutput");
  const compare = captureMethod(value, "compareWithCurrent");
  if (!inspect || !listMore || !readOutput || !compare) throw createAbortError();
  return Object.freeze({
    owner: value,
    inspectKnownOutputs: ((request, signal) =>
      Promise.resolve(
        Reflect.apply(inspect, value, [request, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["inspectKnownOutputs"],
    listMore: ((session, cursor, signal) =>
      Promise.resolve(
        Reflect.apply(listMore, value, [session, cursor, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["listMore"],
    readOutput: ((session, outputRef, signal) =>
      Promise.resolve(
        Reflect.apply(readOutput, value, [session, outputRef, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["readOutput"],
    compareWithCurrent: ((session, outputRef, signal) =>
      Promise.resolve(
        Reflect.apply(compare, value, [session, outputRef, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["compareWithCurrent"],
  });
}

/** Links caller and generation cancellation and releases listeners after settlement. */
function linkSignals(caller: AbortSignal, generation: AbortSignal): LinkedSignal {
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

/** Races a delegate read against linked cancellation without accepting late values. */
async function runAbortWins<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw createAbortError();
  let remove = (): void => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    remove = () => signal.removeEventListener("abort", abort);
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    remove();
  }
}

/** Returns hidden state only for an authentic stable port. */
function requireState(value: unknown): State {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== DelegatingKnowledgeKnownAppliedWikiOutputsPort.prototype
  ) {
    throw createAbortError();
  }
  const state = states.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Returns an authentic session binding only from the exact current generation. */
function resolveSession(
  state: State,
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>
): SessionBinding | undefined {
  const binding =
    typeof session === "object" && session !== null ? state.sessions.get(session) : undefined;
  return binding && binding.generation === state.generation && !state.disposed
    ? binding
    : undefined;
}

/** Stable generation-revocable port for the optional Known outputs UI. */
export class DelegatingKnowledgeKnownAppliedWikiOutputsPort
  implements KnowledgeKnownAppliedWikiOutputsPort
{
  /** Creates one fail-closed stable surface. */
  constructor() {
    const unavailable = Object.freeze(new UnavailableKnowledgeKnownAppliedWikiOutputsPort());
    states.set(this, {
      unavailable,
      generation: Object.freeze({
        delegate: captureDelegate(unavailable),
        abortController: new AbortController(),
      }),
      sessions: new WeakMap(),
      disposed: false,
    });
    Object.freeze(this);
  }

  /** Atomically replaces the read generation and invalidates all old sessions. */
  replaceDelegate(delegate: KnowledgeKnownAppliedWikiOutputsPort): void {
    const state = requireState(this);
    if (state.disposed) throw createAbortError();
    const next: Generation = Object.freeze({
      delegate: captureDelegate(delegate),
      abortController: new AbortController(),
    });
    const previous = state.generation;
    state.generation = next;
    state.sessions = new WeakMap();
    previous.abortController.abort();
  }

  /** Conditionally revokes one exact published delegate. */
  revokeDelegate(delegate: KnowledgeKnownAppliedWikiOutputsPort): void {
    const state = requireState(this);
    if (state.disposed || state.generation.delegate.owner !== delegate) return;
    this.setUnavailable();
  }

  /** Withdraws all current sessions without reviving a disposed port. */
  setUnavailable(): void {
    const state = requireState(this);
    if (state.disposed) return;
    const previous = state.generation;
    state.generation = Object.freeze({
      delegate: captureDelegate(state.unavailable),
      abortController: new AbortController(),
    });
    state.sessions = new WeakMap();
    previous.abortController.abort();
  }

  /** Re-proves one canonical path through the current exact generation. */
  async inspectKnownOutputs(
    requestValue: Readonly<KnowledgeKnownAppliedWikiOutputsRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsSession>> {
    const state = requireState(this);
    const request = snapshotKnowledgeKnownAppliedWikiOutputsRequest(requestValue);
    if (state.disposed) throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
    const generation = state.generation;
    const linked = linkSignals(signal, generation.abortController.signal);
    try {
      if (linked.signal.aborted) throw createAbortError();
      const delegateSession = await runAbortWins(
        generation.delegate.inspectKnownOutputs(request, linked.signal),
        linked.signal
      );
      if (state.disposed || state.generation !== generation || linked.signal.aborted) {
        throw createAbortError();
      }
      const wrapper = snapshotKnowledgeKnownAppliedWikiOutputsSession(delegateSession);
      if (state.disposed || state.generation !== generation || linked.signal.aborted) {
        throw createAbortError();
      }
      if (wrapper.displayPagePath !== request.pagePath || !sessionRefsHaveExactKinds(wrapper)) {
        throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
      }
      const summaries = new Map(wrapper.items.map((item) => [item.outputRef, item]));
      state.sessions.set(wrapper, {
        generation,
        delegateSession,
        summaries,
        remaining: wrapper.knownOutputCount - wrapper.items.length,
        ...(wrapper.nextCursor === undefined ? {} : { nextCursor: wrapper.nextCursor }),
        consumedCursors: new Set(),
      });
      return wrapper;
    } catch (error) {
      if (linked.signal.aborted) throw createAbortError();
      const code = getKnowledgeKnownAppliedWikiOutputsErrorCode(error);
      throw new KnowledgeKnownAppliedWikiOutputsError(code ?? "unavailable");
    } finally {
      linked.release();
    }
  }

  /** Delegates one current session/cursor and snapshots the closed result. */
  async listMore(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    cursor: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsPageResult>> {
    const state = requireState(this);
    const binding = resolveSession(state, session);
    if (
      !binding ||
      !isOpaqueRef(cursor, "cursor") ||
      binding.nextCursor !== cursor ||
      binding.consumedCursors.has(cursor) ||
      binding.remaining <= 0
    ) {
      return STALE_PAGE;
    }
    const linked = linkSignals(signal, binding.generation.abortController.signal);
    try {
      if (linked.signal.aborted) throw createAbortError();
      binding.consumedCursors.add(cursor);
      binding.nextCursor = undefined;
      const result = await runAbortWins(
        binding.generation.delegate.listMore(binding.delegateSession, cursor, linked.signal),
        linked.signal
      );
      if (state.generation !== binding.generation || linked.signal.aborted) return STALE_PAGE;
      const captured = snapshotKnowledgeKnownAppliedWikiOutputsPageResult(result);
      if (state.disposed || state.generation !== binding.generation || linked.signal.aborted) {
        return STALE_PAGE;
      }
      if (captured.kind !== "loaded") return captured;
      if (
        captured.value.items.some((item) => !isOpaqueRef(item.outputRef, "output")) ||
        (captured.value.nextCursor !== undefined &&
          !isOpaqueRef(captured.value.nextCursor, "cursor"))
      ) {
        return UNAVAILABLE_PAGE;
      }
      const expectedCount = Math.min(
        binding.remaining,
        KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.pageSize
      );
      const nextRefs = new Set(captured.value.items.map((item) => item.outputRef));
      const remaining = binding.remaining - captured.value.items.length;
      if (
        captured.value.items.length !== expectedCount ||
        nextRefs.size !== captured.value.items.length ||
        captured.value.items.some((item) => binding.summaries.has(item.outputRef)) ||
        remaining > 0 !== (captured.value.nextCursor !== undefined) ||
        (captured.value.nextCursor !== undefined &&
          binding.consumedCursors.has(captured.value.nextCursor))
      ) {
        return UNAVAILABLE_PAGE;
      }
      for (const item of captured.value.items) binding.summaries.set(item.outputRef, item);
      binding.remaining = remaining;
      binding.nextCursor = captured.value.nextCursor;
      return captured;
    } catch {
      if (linked.signal.aborted) throw createAbortError();
      return UNAVAILABLE_PAGE;
    } finally {
      linked.release();
    }
  }

  /** Delegates one current output reference and snapshots its exact lazy body. */
  async readOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputDetailResult>> {
    const state = requireState(this);
    const binding = resolveSession(state, session);
    const summary = isOpaqueRef(outputRef, "output")
      ? binding?.summaries.get(outputRef)
      : undefined;
    if (!binding || !summary) return STALE_DETAIL;
    const linked = linkSignals(signal, binding.generation.abortController.signal);
    try {
      if (linked.signal.aborted) throw createAbortError();
      const result = await runAbortWins(
        binding.generation.delegate.readOutput(binding.delegateSession, outputRef, linked.signal),
        linked.signal
      );
      if (state.generation !== binding.generation || linked.signal.aborted) return STALE_DETAIL;
      const captured = snapshotKnowledgeKnownAppliedWikiOutputDetailResult(result);
      if (state.disposed || state.generation !== binding.generation || linked.signal.aborted) {
        return STALE_DETAIL;
      }
      if (
        captured.kind === "loaded" &&
        (captured.value.outputRef !== outputRef ||
          captured.value.appliedAt !== summary.appliedAt ||
          captured.value.verifiedApplyCount !== summary.verifiedApplyCount)
      ) {
        return UNAVAILABLE_DETAIL;
      }
      return captured;
    } catch {
      if (linked.signal.aborted) throw createAbortError();
      return UNAVAILABLE_DETAIL;
    } finally {
      linked.release();
    }
  }

  /** Delegates one current output comparison and snapshots both bounded texts. */
  async compareWithCurrent(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputComparisonResult>> {
    const state = requireState(this);
    const binding = resolveSession(state, session);
    if (!binding || !isOpaqueRef(outputRef, "output") || !binding.summaries.has(outputRef)) {
      return STALE_COMPARISON;
    }
    const linked = linkSignals(signal, binding.generation.abortController.signal);
    try {
      if (linked.signal.aborted) throw createAbortError();
      const result = await runAbortWins(
        binding.generation.delegate.compareWithCurrent(
          binding.delegateSession,
          outputRef,
          linked.signal
        ),
        linked.signal
      );
      if (state.generation !== binding.generation || linked.signal.aborted) {
        return STALE_COMPARISON;
      }
      const captured = snapshotKnowledgeKnownAppliedWikiOutputComparisonResult(result);
      if (state.disposed || state.generation !== binding.generation || linked.signal.aborted) {
        return STALE_COMPARISON;
      }
      if (
        captured.kind === "loaded" &&
        (captured.value.outputRef !== outputRef ||
          captured.value.currentState !== session.currentState)
      ) {
        return UNAVAILABLE_COMPARISON;
      }
      return captured;
    } catch {
      if (linked.signal.aborted) throw createAbortError();
      return UNAVAILABLE_COMPARISON;
    } finally {
      linked.release();
    }
  }

  /** Permanently aborts and clears the stable surface. */
  dispose(): void {
    const state = requireState(this);
    if (state.disposed) return;
    state.disposed = true;
    state.sessions = new WeakMap();
    state.generation.abortController.abort();
  }
}

Object.freeze(DelegatingKnowledgeKnownAppliedWikiOutputsPort.prototype);
Object.freeze(DelegatingKnowledgeKnownAppliedWikiOutputsPort);
