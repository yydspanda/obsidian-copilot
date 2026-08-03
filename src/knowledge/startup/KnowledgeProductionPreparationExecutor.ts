import {
  KnowledgeAuthorizedSourcePreparationBinder,
  type KnowledgeAuthorizedSourcePreparation,
} from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { KnowledgeIngestExecutionAuthorityBinder } from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import { KnowledgeSourceExecutionPlan } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  IngestExecutionContext,
  IngestExecutionResult,
  IngestExecutor,
} from "@/knowledge/ingest/queue/IngestQueue";
import { KnowledgeRuntimeIngestExecutionProofPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";

/** Compiler-facing handler invoked only after exact claim/read/parser authorization. */
export interface KnowledgePreparedIngestHandler {
  /** Consumes one authentic preparation and returns a Queue-owned terminal projection. */
  execute(
    preparation: KnowledgeAuthorizedSourcePreparation,
    context: IngestExecutionContext
  ): Promise<IngestExecutionResult>;
}

interface PreparationExecutorState {
  plan: KnowledgeSourceExecutionPlan;
  authority: KnowledgeIngestExecutionAuthorityBinder;
  preparation: KnowledgeAuthorizedSourcePreparationBinder;
  handle: (
    preparation: KnowledgeAuthorizedSourcePreparation,
    context: IngestExecutionContext
  ) => Promise<IngestExecutionResult>;
}

const executorStates = new WeakMap<object, PreparationExecutorState>();

/** Stable boundary failure containing no source, job, Runtime, or credential data. */
export class KnowledgeProductionPreparationExecutorError extends Error {
  /** Creates one fail-closed preparation-executor error. */
  constructor() {
    super("The production Knowledge preparation executor is invalid");
    this.name = "KnowledgeProductionPreparationExecutorError";
  }
}

/** Snapshots one callable own/prototype method without retaining an accessor value. */
function hasCallableMethod(value: unknown, key: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  try {
    let current: object | null = value;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor && typeof descriptor.value === "function";
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return false;
  }
  return false;
}

/** Captures one exact data method and receiver so later mutation cannot replace execution. */
function captureHandler(
  handler: KnowledgePreparedIngestHandler
): PreparationExecutorState["handle"] {
  let current: object | null = handler;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "execute");
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new KnowledgeProductionPreparationExecutorError();
      }
      const method = descriptor.value as KnowledgePreparedIngestHandler["execute"];
      return (preparation, context) => Reflect.apply(method, handler, [preparation, context]);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new KnowledgeProductionPreparationExecutorError();
}

/** Exact Queue-claim → Runtime proof → workflow read/parser → handler bridge. */
export class KnowledgeProductionPreparationExecutor implements IngestExecutor {
  /** Captures authentic plan and Runtime proof capabilities before Queue execution begins. */
  constructor(
    plan: KnowledgeSourceExecutionPlan,
    proofPort: KnowledgeRuntimeIngestExecutionProofPort,
    handler: KnowledgePreparedIngestHandler
  ) {
    try {
      KnowledgeSourceExecutionPlan.assert(plan);
      KnowledgeRuntimeIngestExecutionProofPort.assert(proofPort);
      if (!hasCallableMethod(handler, "execute")) {
        throw new KnowledgeProductionPreparationExecutorError();
      }
      executorStates.set(this, {
        plan,
        authority: new KnowledgeIngestExecutionAuthorityBinder(proofPort),
        preparation: new KnowledgeAuthorizedSourcePreparationBinder(),
        handle: captureHandler(handler),
      });
    } catch {
      throw new KnowledgeProductionPreparationExecutorError();
    }
    Object.freeze(this);
  }

  /** Executes only after the exact Queue claim has been parsed from exact source bytes. */
  async execute(context: IngestExecutionContext): Promise<IngestExecutionResult> {
    const state = executorStates.get(this);
    if (!state || context.signal.aborted || context.executionClaim.getSignal() !== context.signal) {
      throw new KnowledgeProductionPreparationExecutorError();
    }
    const authority = await state.authority.bind(context.executionClaim);
    const preparation = await state.preparation.prepare(state.plan, authority);
    if (context.signal.aborted || preparation.getSignal() !== context.signal) {
      throw new KnowledgeProductionPreparationExecutorError();
    }
    return state.handle(preparation, context);
  }
}

Object.freeze(KnowledgeProductionPreparationExecutor.prototype);
Object.freeze(KnowledgeProductionPreparationExecutor);
