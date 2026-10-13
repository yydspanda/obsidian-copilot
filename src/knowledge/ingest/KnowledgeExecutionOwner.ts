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

function requireKnowledgeExecutionOwnerState(value: unknown): KnowledgeExecutionOwnerState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The knowledge execution owner is invalid");
  }
  const state = knowledgeExecutionOwnerStates.get(value);
  if (!state) throw new TypeError("The knowledge execution owner is invalid");
  return state;
}

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

export class KnowledgeExecutionOwner {
  constructor(token: symbol) {
    if (token !== KNOWLEDGE_EXECUTION_OWNER_TOKEN) {
      throw new TypeError("The knowledge execution owner is invalid");
    }
    knowledgeExecutionOwnerStates.set(this, {});
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeExecutionOwner {
    requireKnowledgeExecutionOwnerState(value);
  }

  static bindRuntime(value: KnowledgeExecutionOwner, runtime: object): void {
    bindOwnerRole(value, "runtime", runtime);
  }

  static bindWorkflow(value: KnowledgeExecutionOwner, workflow: object): void {
    bindOwnerRole(value, "workflow", workflow);
  }

  static bindProductionLease(value: KnowledgeExecutionOwner, lease: object): void {
    bindOwnerRole(value, "productionLease", lease);
  }

  static matchesProductionLease(value: KnowledgeExecutionOwner, lease: object): boolean {
    try {
      return requireKnowledgeExecutionOwnerState(value).productionLease === lease;
    } catch {
      return false;
    }
  }

  static bindCompositionClaim(value: KnowledgeExecutionOwner, claim: object): void {
    bindOwnerRole(value, "compositionClaim", claim);
  }

  static matchesCompositionClaim(value: KnowledgeExecutionOwner, claim: object): boolean {
    try {
      return requireKnowledgeExecutionOwnerState(value).compositionClaim === claim;
    } catch {
      return false;
    }
  }

  static bindVaultLifecycle(
    value: KnowledgeExecutionOwner,
    app: object,
    vault: object,
    adapter: object
  ): void {
    bindVaultLifecycleRoles(value, app, vault, adapter);
  }

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

export function createKnowledgeExecutionOwner(): KnowledgeExecutionOwner {
  return new KnowledgeExecutionOwner(KNOWLEDGE_EXECUTION_OWNER_TOKEN);
}
