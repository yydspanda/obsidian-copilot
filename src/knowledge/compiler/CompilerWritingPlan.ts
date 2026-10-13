import type { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";

export interface CompilerWritingTarget {
  ref: string;
  path: string;
  intent: "write";
  reason: string;
  claimRefs: string[];
}

export interface CompilerWritingPlan {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  summary: string;
  claims: { ref: string; text: string }[];
  citations: {
    claimRef: string;
    evidenceId: string;
    relation: "supports";
  }[];
  targets: CompilerWritingTarget[];
}
