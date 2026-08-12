import type { KnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

/** Exact capabilities used to publish one revocable known-output generation. */
export interface KnowledgeKnownAppliedWikiOutputsGenerationLeaseInput {
  readonly delegate: KnowledgeKnownAppliedWikiOutputsPort;
  readonly subscribeInvalidation: (listener: () => void) => () => void;
  readonly replaceDelegate: (delegate: KnowledgeKnownAppliedWikiOutputsPort) => void;
  readonly revokeDelegate: (delegate: KnowledgeKnownAppliedWikiOutputsPort) => void;
  readonly assertCurrent: () => void;
}

interface LeaseState {
  readonly input: Readonly<KnowledgeKnownAppliedWikiOutputsGenerationLeaseInput>;
  active: boolean;
  closed: boolean;
  published: boolean;
  unsubscribe: () => void;
}

const states = new WeakMap<object, LeaseState>();

/** Creates platform-standard cancellation for a stale publication. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Invokes cleanup without letting an already-revoked capability escape. */
function closeSafely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Exact conditional revocation is best-effort after local authority is closed.
  }
}

/** Captures the exact five-field publication surface through data descriptors. */
function snapshotInput(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputsGenerationLeaseInput> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    ) {
      throw createAbortError();
    }
    const keys = [
      "delegate",
      "subscribeInvalidation",
      "replaceDelegate",
      "revokeDelegate",
      "assertCurrent",
    ];
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) {
      throw createAbortError();
    }
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw createAbortError();
      }
      record[key] = descriptor.value;
    }
    if (
      typeof record.delegate !== "object" ||
      record.delegate === null ||
      typeof record.subscribeInvalidation !== "function" ||
      typeof record.replaceDelegate !== "function" ||
      typeof record.revokeDelegate !== "function" ||
      typeof record.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    return Object.freeze({
      delegate: record.delegate as KnowledgeKnownAppliedWikiOutputsPort,
      subscribeInvalidation: record.subscribeInvalidation as (listener: () => void) => () => void,
      replaceDelegate: record.replaceDelegate as (
        delegate: KnowledgeKnownAppliedWikiOutputsPort
      ) => void,
      revokeDelegate: record.revokeDelegate as (
        delegate: KnowledgeKnownAppliedWikiOutputsPort
      ) => void,
      assertCurrent: record.assertCurrent as () => void,
    });
  } catch {
    throw createAbortError();
  }
}

/** Returns hidden state only for an authentic lease. */
function requireState(value: unknown): LeaseState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeKnownAppliedWikiOutputsGenerationLease.prototype
  ) {
    throw createAbortError();
  }
  const state = states.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Withdraws one exact published delegate without touching a newer generation. */
function withdraw(state: LeaseState): void {
  state.active = false;
  if (!state.published) return;
  state.published = false;
  closeSafely(() => state.input.revokeDelegate(state.input.delegate));
}

/** Revocable generation lease for the optional read-only history surface. */
export class KnowledgeKnownAppliedWikiOutputsGenerationLease {
  /** Publishes only while the exact production generation remains current. */
  constructor(inputValue: KnowledgeKnownAppliedWikiOutputsGenerationLeaseInput) {
    const input = snapshotInput(inputValue);
    const state: LeaseState = {
      input,
      active: true,
      closed: false,
      published: false,
      unsubscribe: () => undefined,
    };
    states.set(this, state);
    Object.freeze(this);
    try {
      const unsubscribe = input.subscribeInvalidation(() => withdraw(state));
      if (typeof unsubscribe !== "function") throw createAbortError();
      state.unsubscribe = unsubscribe;
      this.assertCurrent();
      state.published = true;
      input.replaceDelegate(input.delegate);
      this.assertCurrent();
    } catch {
      closeSafely(state.unsubscribe);
      state.unsubscribe = () => undefined;
      withdraw(state);
      closeSafely(() => input.revokeDelegate(input.delegate));
      state.closed = true;
      throw createAbortError();
    }
  }

  /** Re-proves the local installation and upstream generation. */
  assertCurrent(): void {
    const state = requireState(this);
    if (!state.active || state.closed) throw createAbortError();
    try {
      state.input.assertCurrent();
    } catch {
      withdraw(state);
      throw createAbortError();
    }
    if (!state.active || state.closed) throw createAbortError();
  }

  /** Idempotently closes invalidation and conditionally revokes the delegate. */
  close(): void {
    const state = requireState(this);
    if (state.closed) return;
    state.closed = true;
    closeSafely(state.unsubscribe);
    state.unsubscribe = () => undefined;
    withdraw(state);
  }
}

Object.freeze(KnowledgeKnownAppliedWikiOutputsGenerationLease.prototype);
Object.freeze(KnowledgeKnownAppliedWikiOutputsGenerationLease);
