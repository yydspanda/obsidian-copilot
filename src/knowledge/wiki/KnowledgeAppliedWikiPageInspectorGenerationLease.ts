import type { KnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type {
  KnowledgeAppliedWikiPathIndexLease,
  KnowledgeAppliedWikiPathIndexRow,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

/** Installation capabilities retained by one revocable inspector/index generation. */
export interface KnowledgeAppliedWikiPageInspectorGenerationLeaseInput {
  readonly delegate: KnowledgeAppliedWikiPageInspectorPort;
  readonly indexRows: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[];
  readonly subscribeInvalidation: (listener: () => void) => () => void;
  readonly replaceDelegate: (delegate: KnowledgeAppliedWikiPageInspectorPort) => void;
  readonly revokeDelegate: (delegate: KnowledgeAppliedWikiPageInspectorPort) => void;
  readonly installPathIndex: (
    rows: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
  ) => KnowledgeAppliedWikiPathIndexLease;
  readonly revokePathIndex: (lease: KnowledgeAppliedWikiPathIndexLease) => void;
  readonly assertCurrent: () => void;
}

interface LeaseState {
  readonly input: Readonly<KnowledgeAppliedWikiPageInspectorGenerationLeaseInput>;
  active: boolean;
  closed: boolean;
  unsubscribeInvalidation: () => void;
  indexLease?: KnowledgeAppliedWikiPathIndexLease;
  delegatePublished: boolean;
}

const leaseStates = new WeakMap<object, LeaseState>();

/** Creates the platform-standard cancellation for a stale installation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Invokes cleanup after authority is withdrawn without leaking cleanup failures. */
function closeSafely(close: () => void): void {
  try {
    close();
  } catch {
    // The exact owning generation is already non-authoritative.
  }
}

/** Reads one exact own enumerable data record without invoking accessors. */
function snapshotInput(
  value: unknown
): Readonly<KnowledgeAppliedWikiPageInspectorGenerationLeaseInput> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    ) {
      throw createAbortError();
    }
    const expected = [
      "delegate",
      "indexRows",
      "subscribeInvalidation",
      "replaceDelegate",
      "revokeDelegate",
      "installPathIndex",
      "revokePathIndex",
      "assertCurrent",
    ];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string") ||
      !expected.every((key) => keys.includes(key))
    ) {
      throw createAbortError();
    }
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createAbortError();
      }
      record[key] = descriptor.value;
    }
    if (
      typeof record.delegate !== "object" ||
      record.delegate === null ||
      !Array.isArray(record.indexRows) ||
      typeof record.subscribeInvalidation !== "function" ||
      typeof record.replaceDelegate !== "function" ||
      typeof record.revokeDelegate !== "function" ||
      typeof record.installPathIndex !== "function" ||
      typeof record.revokePathIndex !== "function" ||
      typeof record.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    return Object.freeze({
      delegate: record.delegate as KnowledgeAppliedWikiPageInspectorPort,
      indexRows: record.indexRows as readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[],
      subscribeInvalidation: record.subscribeInvalidation as (listener: () => void) => () => void,
      replaceDelegate: record.replaceDelegate as (
        delegate: KnowledgeAppliedWikiPageInspectorPort
      ) => void,
      revokeDelegate: record.revokeDelegate as (
        delegate: KnowledgeAppliedWikiPageInspectorPort
      ) => void,
      installPathIndex: record.installPathIndex as (
        rows: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
      ) => KnowledgeAppliedWikiPathIndexLease,
      revokePathIndex: record.revokePathIndex as (
        lease: KnowledgeAppliedWikiPathIndexLease
      ) => void,
      assertCurrent: record.assertCurrent as () => void,
    });
  } catch {
    throw createAbortError();
  }
}

/** Returns hidden state only for one authentic frozen lease. */
function requireLeaseState(value: unknown): LeaseState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeAppliedWikiPageInspectorGenerationLease.prototype
  ) {
    throw createAbortError();
  }
  const state = leaseStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Withdraws both advisory discovery and inspector authority conditionally. */
function withdraw(state: LeaseState): void {
  if (!state.active && !state.indexLease && !state.delegatePublished) return;
  state.active = false;
  const indexLease = state.indexLease;
  state.indexLease = undefined;
  if (indexLease) closeSafely(() => state.input.revokePathIndex(indexLease));
  if (state.delegatePublished) {
    state.delegatePublished = false;
    closeSafely(() => state.input.revokeDelegate(state.input.delegate));
  }
}

/** Unconditionally attempts exact conditional revocation after a failed publication. */
function cleanupPublished(state: LeaseState): void {
  state.active = false;
  const indexLease = state.indexLease;
  state.indexLease = undefined;
  if (indexLease) closeSafely(() => state.input.revokePathIndex(indexLease));
  state.delegatePublished = false;
  closeSafely(() => state.input.revokeDelegate(state.input.delegate));
}

/**
 * Atomically installs an inspector delegate and its matching advisory path index.
 *
 * Invalidation is subscribed before either publication. Withdrawal is exact and
 * conditional, so an obsolete lease cannot remove a newer generation.
 */
export class KnowledgeAppliedWikiPageInspectorGenerationLease {
  /** Publishes one exact generation only while upstream observation remains current. */
  constructor(inputValue: KnowledgeAppliedWikiPageInspectorGenerationLeaseInput) {
    const input = snapshotInput(inputValue);
    const state: LeaseState = {
      input,
      active: true,
      closed: false,
      unsubscribeInvalidation: () => undefined,
      delegatePublished: false,
    };
    leaseStates.set(this, state);
    Object.freeze(this);
    try {
      const unsubscribe = input.subscribeInvalidation(() => withdraw(state));
      if (typeof unsubscribe !== "function") throw createAbortError();
      state.unsubscribeInvalidation = unsubscribe;
      this.assertCurrent();
      const indexLease = input.installPathIndex(input.indexRows);
      state.indexLease = indexLease;
      this.assertCurrent();
      input.replaceDelegate(input.delegate);
      state.delegatePublished = true;
      this.assertCurrent();
    } catch {
      closeSafely(state.unsubscribeInvalidation);
      state.unsubscribeInvalidation = () => undefined;
      cleanupPublished(state);
      state.closed = true;
      throw createAbortError();
    }
  }

  /** Proves local installation plus the upstream production generation. */
  assertCurrent(): void {
    const state = requireLeaseState(this);
    if (!state.active || state.closed) throw createAbortError();
    try {
      state.input.assertCurrent();
    } catch {
      withdraw(state);
      throw createAbortError();
    }
    if (!state.active || state.closed) throw createAbortError();
  }

  /** Idempotently closes invalidation and both exact publications. */
  close(): void {
    const state = requireLeaseState(this);
    if (state.closed) return;
    state.closed = true;
    closeSafely(state.unsubscribeInvalidation);
    state.unsubscribeInvalidation = () => undefined;
    withdraw(state);
  }
}

Object.freeze(KnowledgeAppliedWikiPageInspectorGenerationLease.prototype);
Object.freeze(KnowledgeAppliedWikiPageInspectorGenerationLease);
