import { KnowledgeProductionForwardRevisionProposalActionAdapter } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";

/** Exact capabilities used to publish one revocable proposal-action generation. */
export interface KnowledgeForwardRevisionProposalActionGenerationLeaseInput {
  readonly delegate: KnowledgeProductionForwardRevisionProposalActionAdapter;
  readonly subscribeInvalidation: (listener: () => void) => () => void;
  readonly replaceDelegate: (
    delegate: KnowledgeProductionForwardRevisionProposalActionAdapter
  ) => void;
  readonly revokeDelegate: (
    delegate: KnowledgeProductionForwardRevisionProposalActionAdapter
  ) => void;
  readonly assertCurrent: () => void;
}

interface LeaseState {
  readonly input: Readonly<KnowledgeForwardRevisionProposalActionGenerationLeaseInput>;
  active: boolean;
  closed: boolean;
  published: boolean;
  unsubscribe: () => void;
}

const states = new WeakMap<object, LeaseState>();

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Invokes cleanup without allowing a stale cleanup failure to revive authority. */
function closeSafely(operation: () => void): void {
  try {
    operation();
  } catch {
    // The local action authority remains closed even when upstream cleanup is stale.
  }
}

/** Captures an exact five-field lease input through enumerable data descriptors. */
function snapshotInput(
  value: unknown
): Readonly<KnowledgeForwardRevisionProposalActionGenerationLeaseInput> {
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
    ] as const;
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
    KnowledgeProductionForwardRevisionProposalActionAdapter.assert(record.delegate);
    if (
      typeof record.subscribeInvalidation !== "function" ||
      typeof record.replaceDelegate !== "function" ||
      typeof record.revokeDelegate !== "function" ||
      typeof record.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    return Object.freeze({
      delegate: record.delegate,
      subscribeInvalidation: record.subscribeInvalidation as (listener: () => void) => () => void,
      replaceDelegate: record.replaceDelegate as (
        delegate: KnowledgeProductionForwardRevisionProposalActionAdapter
      ) => void,
      revokeDelegate: record.revokeDelegate as (
        delegate: KnowledgeProductionForwardRevisionProposalActionAdapter
      ) => void,
      assertCurrent: record.assertCurrent as () => void,
    });
  } catch {
    throw createAbortError();
  }
}

/** Returns hidden state only for one exact module-authentic action lease. */
function requireState(value: unknown): LeaseState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeForwardRevisionProposalActionGenerationLease.prototype
  ) {
    throw createAbortError();
  }
  const state = states.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Withdraws one exact published adapter without touching a newer generation. */
function withdraw(state: LeaseState): void {
  state.active = false;
  if (!state.published) return;
  state.published = false;
  closeSafely(() => state.input.revokeDelegate(state.input.delegate));
}

/** Revocable installation lease for the production proposal action adapter. */
export class KnowledgeForwardRevisionProposalActionGenerationLease {
  /** Subscribes invalidation before publishing one exact current adapter. */
  constructor(inputValue: KnowledgeForwardRevisionProposalActionGenerationLeaseInput) {
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

  /** Re-proves both this installation and its upstream production generation. */
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

  /** Idempotently closes invalidation and conditionally revokes the exact adapter. */
  close(): void {
    const state = requireState(this);
    if (state.closed) return;
    state.closed = true;
    closeSafely(state.unsubscribe);
    state.unsubscribe = () => undefined;
    withdraw(state);
  }
}

Object.freeze(KnowledgeForwardRevisionProposalActionGenerationLease.prototype);
Object.freeze(KnowledgeForwardRevisionProposalActionGenerationLease);
