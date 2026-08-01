const KNOWLEDGE_EXECUTION_OWNER_TOKEN = Symbol("KnowledgeExecutionOwner.constructor");

interface KnowledgeExecutionOwnerState {
  runtime?: object;
  workflow?: object;
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
}

Object.freeze(KnowledgeExecutionOwner.prototype);
Object.freeze(KnowledgeExecutionOwner);

/** Creates one unique process-local App/Vault/workflow lifecycle identity. */
export function createKnowledgeExecutionOwner(): KnowledgeExecutionOwner {
  return new KnowledgeExecutionOwner(KNOWLEDGE_EXECUTION_OWNER_TOKEN);
}
