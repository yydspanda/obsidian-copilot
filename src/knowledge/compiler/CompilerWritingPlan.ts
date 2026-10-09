import type { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";

/** Compiler-owned destination and the written claims associated with that page. */
export interface CompilerWritingTarget {
  ref: string;
  path: string;
  intent: "write";
  reason: string;
  claimRefs: string[];
}

/**
 * Internal source-writing plan, populated with claims only after generation.
 * This is not model output or a persisted schema; destination authority stays local.
 */
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
