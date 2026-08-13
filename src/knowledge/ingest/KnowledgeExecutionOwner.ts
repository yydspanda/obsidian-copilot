const KNOWLEDGE_EXECUTION_OWNER_TOKEN = Symbol("KnowledgeExecutionOwner.constructor");

interface KnowledgeExecutionOwnerState {
  runtime?: object;
  workflow?: object;
  productionLease?: object;
  app?: object;
  vault?: object;
  adapter?: object;
  compositionClaim?: object;
}

const knowledgeExecutionOwnerStates = new WeakMap<object, KnowledgeExecutionOwnerState>();

/** Returns hidden role bindings only for an authentic execution owner. */
function requireKnowledgeExecutionOwnerState(value: unknown): KnowledgeExecutionOwnerState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The knowledge execution owner is invalid");
  }
  const state = knowledgeExecutionOwnerStates.get(value);
  if (!state) throw new TypeError("The knowledge execution owner is invalid");
  return state;
}

/** Exclusively binds one owner role while permitting exact-idempotent reproof. */
function bindOwnerRole(
  value: KnowledgeExecutionOwner,
  role: keyof KnowledgeExecutionOwnerState,
  identity: object
): void {
  const state = requireKnowledgeExecutionOwnerState(value);
  if (typeof identity !== "object" || identity === null) {
    throw new TypeError("The knowledge execution owner role is invalid");
  }
  const current = state[role];
  if (current !== undefined && current !== identity) {
    throw new TypeError("The knowledge execution owner role is already bound");
  }
  state[role] = identity;
}

/** Exclusively binds one exact App/Vault/adapter lifecycle as one atomic role tuple. */
function bindVaultLifecycleRoles(
  value: KnowledgeExecutionOwner,
  app: object,
  vault: object,
  adapter: object
): void {
  const state = requireKnowledgeExecutionOwnerState(value);
  const identities = { app, vault, adapter } as const;
  for (const identity of Object.values(identities)) {
    if (typeof identity !== "object" || identity === null) {
      throw new TypeError("The knowledge execution owner Vault lifecycle is invalid");
    }
  }
  if (
    (state.app !== undefined && state.app !== app) ||
    (state.vault !== undefined && state.vault !== vault) ||
    (state.adapter !== undefined && state.adapter !== adapter)
  ) {
    throw new TypeError("The knowledge execution owner Vault lifecycle is already bound");
  }
  state.app = app;
  state.vault = vault;
  state.adapter = adapter;
}

/**
 * Opaque lifecycle identity shared by one Runtime Queue and one workflow generation.
 *
 * Equal durable values are not enough to cross this process-local boundary. The
 * production composer must deliberately pass the same owner to the Runtime
 * Queue storage and workflow-plan loader for one App/Vault generation.
 */
export class KnowledgeExecutionOwner {
  /** Rejects direct construction without the module-private factory token. */
  constructor(token: symbol) {
    if (token !== KNOWLEDGE_EXECUTION_OWNER_TOKEN) {
      throw new TypeError("The knowledge execution owner is invalid");
    }
    knowledgeExecutionOwnerStates.set(this, {});
    Object.freeze(this);
  }

  /** Requires an authentic process-local execution owner. */
  static assert(value: unknown): asserts value is KnowledgeExecutionOwner {
    requireKnowledgeExecutionOwnerState(value);
  }

  /** Exclusively binds this lifecycle to one exact durable Runtime instance. */
  static bindRuntime(value: KnowledgeExecutionOwner, runtime: object): void {
    bindOwnerRole(value, "runtime", runtime);
  }

  /** Exclusively binds this lifecycle to one exact workflow-loader generation. */
  static bindWorkflow(value: KnowledgeExecutionOwner, workflow: object): void {
    bindOwnerRole(value, "workflow", workflow);
  }

  /** Exclusively binds this lifecycle to one exact production workflow lease. */
  static bindProductionLease(value: KnowledgeExecutionOwner, lease: object): void {
    bindOwnerRole(value, "productionLease", lease);
  }

  /** Reports whether this lifecycle owns one exact production workflow lease. */
  static matchesProductionLease(value: KnowledgeExecutionOwner, lease: object): boolean {
    try {
      return requireKnowledgeExecutionOwnerState(value).productionLease === lease;
    } catch {
      return false;
    }
  }

  /** Exclusively binds this lifecycle to one exact production composition claim. */
  static bindCompositionClaim(value: KnowledgeExecutionOwner, claim: object): void {
    bindOwnerRole(value, "compositionClaim", claim);
  }

  /** Reports whether this lifecycle owns one exact production composition claim. */
  static matchesCompositionClaim(value: KnowledgeExecutionOwner, claim: object): boolean {
    try {
      return requireKnowledgeExecutionOwnerState(value).compositionClaim === claim;
    } catch {
      return false;
    }
  }

  /** Exclusively binds this lifecycle to one exact App, Vault, and adapter tuple. */
  static bindVaultLifecycle(
    value: KnowledgeExecutionOwner,
    app: object,
    vault: object,
    adapter: object
  ): void {
    bindVaultLifecycleRoles(value, app, vault, adapter);
  }

  /** Reports whether this owner is already bound to the exact Vault lifecycle tuple. */
  static matchesVaultLifecycle(
    value: KnowledgeExecutionOwner,
    app: object,
    vault: object,
    adapter: object
  ): boolean {
    try {
      const state = requireKnowledgeExecutionOwnerState(value);
      return state.app === app && state.vault === vault && state.adapter === adapter;
    } catch {
      return false;
    }
  }
}

Object.freeze(KnowledgeExecutionOwner.prototype);
Object.freeze(KnowledgeExecutionOwner);

/** Creates one unique process-local App/Vault/workflow lifecycle identity. */
export function createKnowledgeExecutionOwner(): KnowledgeExecutionOwner {
  return new KnowledgeExecutionOwner(KNOWLEDGE_EXECUTION_OWNER_TOKEN);
}
