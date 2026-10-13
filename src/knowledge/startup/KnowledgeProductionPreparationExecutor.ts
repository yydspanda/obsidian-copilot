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

export interface KnowledgePreparedIngestHandler {
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

export class KnowledgeProductionPreparationExecutorError extends Error {
  constructor() {
    super("The production Knowledge preparation executor is invalid");
    this.name = "KnowledgeProductionPreparationExecutorError";
  }
}

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

export class KnowledgeProductionPreparationExecutor implements IngestExecutor {
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
