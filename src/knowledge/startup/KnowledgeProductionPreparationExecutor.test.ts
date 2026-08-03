import {
  KnowledgeProductionPreparationExecutor,
  KnowledgeProductionPreparationExecutorError,
} from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";
import type { KnowledgeSourceExecutionPlan } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type { KnowledgeRuntimeIngestExecutionProofPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";

describe("KnowledgeProductionPreparationExecutor", () => {
  it("rejects structurally similar plan and proof objects", () => {
    expect(
      () =>
        new KnowledgeProductionPreparationExecutor(
          {} as KnowledgeSourceExecutionPlan,
          {} as KnowledgeRuntimeIngestExecutionProofPort,
          { execute: async () => ({ kind: "no_changes", changeSetId: "never" }) }
        )
    ).toThrow(KnowledgeProductionPreparationExecutorError);
  });

  it("does not invoke a handler accessor while validating dependencies", () => {
    let getterCalls = 0;
    const handler = Object.defineProperty({}, "execute", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return async () => ({ kind: "no_changes", changeSetId: "never" });
      },
    });

    expect(
      () =>
        new KnowledgeProductionPreparationExecutor(
          {} as KnowledgeSourceExecutionPlan,
          {} as KnowledgeRuntimeIngestExecutionProofPort,
          handler as never
        )
    ).toThrow(KnowledgeProductionPreparationExecutorError);
    expect(getterCalls).toBe(0);
  });
});
