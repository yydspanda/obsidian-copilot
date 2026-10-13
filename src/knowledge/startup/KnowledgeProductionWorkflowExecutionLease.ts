import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";

const PAIRING_CLAIM_TOKEN = Symbol("KnowledgeProductionWorkflowExecutionPairingClaim.constructor");
const PREFLIGHT_BINDING_TOKEN = Symbol(
  "KnowledgeProductionWorkflowExecutionPreflightBinding.constructor"
);
const RUNTIME_BINDING_TOKEN = Symbol(
  "KnowledgeProductionWorkflowExecutionRuntimeBinding.constructor"
);
const LEASE_TOKEN = Symbol("KnowledgeProductionWorkflowExecutionLease.constructor");

interface PairingClaimState {
  readonly root: object;
  consumed: boolean;
}

interface ExecutionBindingState {
  readonly root: object;
}

interface ExecutionLeaseState {
  current: boolean;
  readonly root: object;
  readonly executionOwner: KnowledgeExecutionOwner;
}

const runtimeClaimStates = new WeakMap<object, PairingClaimState>();
const preflightClaimStates = new WeakMap<object, PairingClaimState>();
const runtimeBindingStates = new WeakMap<object, Readonly<ExecutionBindingState>>();
const preflightBindingStates = new WeakMap<object, Readonly<ExecutionBindingState>>();
const executionLeaseStates = new WeakMap<object, ExecutionLeaseState>();

export class KnowledgeProductionWorkflowExecutionRuntimeClaim {
  constructor(token: symbol, root?: object) {
    if (token !== PAIRING_CLAIM_TOKEN || !root) {
      throw new TypeError("The production Runtime execution claim is invalid");
    }
    runtimeClaimStates.set(this, { root, consumed: false });
    Object.freeze(this);
  }
}

export class KnowledgeProductionWorkflowExecutionPreflightClaim {
  constructor(token: symbol, root?: object) {
    if (token !== PAIRING_CLAIM_TOKEN || !root) {
      throw new TypeError("The production preflight execution claim is invalid");
    }
    preflightClaimStates.set(this, { root, consumed: false });
    Object.freeze(this);
  }
}

export class KnowledgeProductionWorkflowExecutionRuntimeBinding {
  constructor(token: symbol, root?: object) {
    if (token !== RUNTIME_BINDING_TOKEN || !root) {
      throw new TypeError("The production Runtime execution binding is invalid");
    }
    runtimeBindingStates.set(this, Object.freeze({ root }));
    Object.freeze(this);
  }

  ownsWorkflowExecutionLease(value: unknown): boolean {
    try {
      requireExactRuntimeBinding(this);
      requireExactWorkflowExecutionLease(value);
      const binding = runtimeBindingStates.get(this);
      const lease = executionLeaseStates.get(value);
      return Boolean(binding && lease?.current && lease.root === binding.root);
    } catch {
      return false;
    }
  }
}

export class KnowledgeProductionWorkflowExecutionPreflightBinding {
  constructor(token: symbol, root?: object) {
    if (token !== PREFLIGHT_BINDING_TOKEN || !root) {
      throw new TypeError("The production preflight execution binding is invalid");
    }
    preflightBindingStates.set(this, Object.freeze({ root }));
    Object.freeze(this);
  }

  issueWorkflowExecutionLease(): Readonly<{
    lease: KnowledgeProductionWorkflowExecutionLease;
    executionOwner: KnowledgeExecutionOwner;
  }> {
    requireExactPreflightBinding(this);
    const state = preflightBindingStates.get(this);
    if (!state) throw new TypeError("The production preflight execution binding is invalid");
    const executionOwner = createKnowledgeExecutionOwner();
    const lease = new KnowledgeProductionWorkflowExecutionLease(
      LEASE_TOKEN,
      state.root,
      executionOwner
    );
    return Object.freeze({ lease, executionOwner });
  }

  revokeWorkflowExecutionLease(value: KnowledgeProductionWorkflowExecutionLease): void {
    requireExactPreflightBinding(this);
    requireExactWorkflowExecutionLease(value);
    const binding = preflightBindingStates.get(this);
    const lease = executionLeaseStates.get(value);
    if (!binding || !lease || lease.root !== binding.root) {
      throw new TypeError("The production workflow execution lease is invalid");
    }
    lease.current = false;
  }

  ownsWorkflowExecutionLease(value: unknown): boolean {
    try {
      requireExactPreflightBinding(this);
      requireExactWorkflowExecutionLease(value);
      const binding = preflightBindingStates.get(this);
      const lease = executionLeaseStates.get(value);
      return Boolean(binding && lease?.current && lease.root === binding.root);
    } catch {
      return false;
    }
  }
}

export class KnowledgeProductionWorkflowExecutionLease {
  constructor(token: symbol, root?: object, executionOwner?: KnowledgeExecutionOwner) {
    if (token !== LEASE_TOKEN || !root || !executionOwner) {
      throw new TypeError("The production workflow execution lease is invalid");
    }
    KnowledgeExecutionOwner.assert(executionOwner);
    executionLeaseStates.set(this, { current: true, root, executionOwner });
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeProductionWorkflowExecutionLease {
    requireExactWorkflowExecutionLease(value);
  }

  assertCurrent(): void {
    requireExactWorkflowExecutionLease(this);
    if (!executionLeaseStates.get(this)?.current) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      requireExactWorkflowExecutionLease(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      const state = executionLeaseStates.get(value);
      return state?.current === true && state.executionOwner === executionOwner;
    } catch {
      return false;
    }
  }
}

export function createKnowledgeProductionWorkflowExecutionPairing(): Readonly<{
  runtimeClaim: KnowledgeProductionWorkflowExecutionRuntimeClaim;
  preflightClaim: KnowledgeProductionWorkflowExecutionPreflightClaim;
}> {
  const root = Object.freeze({});
  return Object.freeze({
    runtimeClaim: new KnowledgeProductionWorkflowExecutionRuntimeClaim(PAIRING_CLAIM_TOKEN, root),
    preflightClaim: new KnowledgeProductionWorkflowExecutionPreflightClaim(
      PAIRING_CLAIM_TOKEN,
      root
    ),
  });
}

export function consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(
  value: unknown
): KnowledgeProductionWorkflowExecutionRuntimeBinding {
  const state = requireExactRuntimeClaim(value);
  if (state.consumed) throw new TypeError("The production Runtime execution claim is invalid");
  state.consumed = true;
  return new KnowledgeProductionWorkflowExecutionRuntimeBinding(RUNTIME_BINDING_TOKEN, state.root);
}

export function consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
  value: unknown
): KnowledgeProductionWorkflowExecutionPreflightBinding {
  const state = requireExactPreflightClaim(value);
  if (state.consumed) throw new TypeError("The production preflight execution claim is invalid");
  state.consumed = true;
  return new KnowledgeProductionWorkflowExecutionPreflightBinding(
    PREFLIGHT_BINDING_TOKEN,
    state.root
  );
}

function requireExactRuntimeClaim(value: unknown): PairingClaimState {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeProductionWorkflowExecutionRuntimeClaim.prototype
    ) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("The production Runtime execution claim is invalid");
  }
  const state = runtimeClaimStates.get(value);
  if (!state) throw new TypeError("The production Runtime execution claim is invalid");
  return state;
}

function requireExactPreflightClaim(value: unknown): PairingClaimState {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeProductionWorkflowExecutionPreflightClaim.prototype
    ) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("The production preflight execution claim is invalid");
  }
  const state = preflightClaimStates.get(value);
  if (!state) throw new TypeError("The production preflight execution claim is invalid");
  return state;
}

function requireExactRuntimeBinding(value: unknown): void {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !==
        KnowledgeProductionWorkflowExecutionRuntimeBinding.prototype ||
      !runtimeBindingStates.has(value)
    ) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("The production Runtime execution binding is invalid");
  }
}

function requireExactPreflightBinding(value: unknown): void {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !==
        KnowledgeProductionWorkflowExecutionPreflightBinding.prototype ||
      !preflightBindingStates.has(value)
    ) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("The production preflight execution binding is invalid");
  }
}

function requireExactWorkflowExecutionLease(
  value: unknown
): asserts value is KnowledgeProductionWorkflowExecutionLease {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeProductionWorkflowExecutionLease.prototype ||
      !executionLeaseStates.has(value)
    ) {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("The production workflow execution lease is invalid");
  }
}

Object.freeze(KnowledgeProductionWorkflowExecutionRuntimeClaim.prototype);
Object.freeze(KnowledgeProductionWorkflowExecutionRuntimeClaim);
Object.freeze(KnowledgeProductionWorkflowExecutionPreflightClaim.prototype);
Object.freeze(KnowledgeProductionWorkflowExecutionPreflightClaim);
Object.freeze(KnowledgeProductionWorkflowExecutionRuntimeBinding.prototype);
Object.freeze(KnowledgeProductionWorkflowExecutionRuntimeBinding);
Object.freeze(KnowledgeProductionWorkflowExecutionPreflightBinding.prototype);
Object.freeze(KnowledgeProductionWorkflowExecutionPreflightBinding);
Object.freeze(KnowledgeProductionWorkflowExecutionLease.prototype);
Object.freeze(KnowledgeProductionWorkflowExecutionLease);
