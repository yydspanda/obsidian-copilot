import { z } from "zod";

import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeDiagnostic, KnowledgeParseResult } from "@/knowledge/model/types";

const MAX_MODEL_SCHEMA_DIAGNOSTICS = 256;

/** Model-local concept reference emitted by the analysis stage. */
export interface CompilerAnalysisConceptDraft {
  ref: string;
  name: string;
  description?: string;
}

/** Model-local entity reference emitted by the analysis stage. */
export interface CompilerAnalysisEntityDraft {
  ref: string;
  name: string;
  type: string;
  description?: string;
}

/** Model-local factual claim emitted by the analysis stage. */
export interface CompilerAnalysisClaimDraft {
  ref: string;
  text: string;
}

/** Model-local relation whose endpoints must resolve after strict parsing. */
export interface CompilerAnalysisRelationDraft {
  ref: string;
  fromRef: string;
  toRef: string;
  type: string;
}

/** Reference from one claim to trusted evidence already supplied by the core. */
export interface CompilerAnalysisCitationDraft {
  claimRef: string;
  evidenceId: string;
  relation: "supports" | "contradicts" | "context";
}

/** Candidate Wiki target proposed without file state, hashes, or status. */
export interface CompilerAnalysisTargetDraft {
  ref: string;
  path: string;
  intent: "write" | "delete";
  reason: string;
  claimRefs: string[];
}

/** Strict structured output expected from the first model stage. */
export interface CompilerAnalysisModelOutput {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  summary: string;
  concepts: CompilerAnalysisConceptDraft[];
  entities: CompilerAnalysisEntityDraft[];
  claims: CompilerAnalysisClaimDraft[];
  relations: CompilerAnalysisRelationDraft[];
  citations: CompilerAnalysisCitationDraft[];
  targets: CompilerAnalysisTargetDraft[];
}

/** Checks for non-whitespace text without transforming model output. */
function hasNonWhitespaceText(value: string): boolean {
  return value.trim().length > 0;
}

const nonEmptyStringSchema = z.string().refine(hasNonWhitespaceText, "Expected a non-empty string");

const conceptDraftSchema: z.ZodType<CompilerAnalysisConceptDraft> = z
  .object({
    ref: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: z.string().optional(),
  })
  .strict();

const entityDraftSchema: z.ZodType<CompilerAnalysisEntityDraft> = z
  .object({
    ref: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    description: z.string().optional(),
  })
  .strict();

const claimDraftSchema: z.ZodType<CompilerAnalysisClaimDraft> = z
  .object({
    ref: nonEmptyStringSchema,
    text: nonEmptyStringSchema,
  })
  .strict();

const relationDraftSchema: z.ZodType<CompilerAnalysisRelationDraft> = z
  .object({
    ref: nonEmptyStringSchema,
    fromRef: nonEmptyStringSchema,
    toRef: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
  })
  .strict();

const citationDraftSchema: z.ZodType<CompilerAnalysisCitationDraft> = z
  .object({
    claimRef: nonEmptyStringSchema,
    evidenceId: nonEmptyStringSchema,
    relation: z.enum(["supports", "contradicts", "context"]),
  })
  .strict();

const targetDraftSchema: z.ZodType<CompilerAnalysisTargetDraft> = z
  .object({
    ref: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    intent: z.enum(["write", "delete"]),
    reason: nonEmptyStringSchema,
    claimRefs: z.array(nonEmptyStringSchema),
  })
  .strict();

/** Strict runtime schema for untrusted first-stage model output. */
export const compilerAnalysisModelOutputSchema: z.ZodType<CompilerAnalysisModelOutput> = z
  .object({
    version: z.literal(KNOWLEDGE_COMPILER_PROTOCOL_VERSION),
    summary: nonEmptyStringSchema,
    concepts: z.array(conceptDraftSchema),
    entities: z.array(entityDraftSchema),
    claims: z.array(claimDraftSchema),
    relations: z.array(relationDraftSchema),
    citations: z.array(citationDraftSchema),
    targets: z.array(targetDraftSchema),
  })
  .strict();

/**
 * Converts a Zod issue path to stable dotted/indexed field notation.
 *
 * @param path - Zod property and array-index path
 * @returns Stable field path for future review UI
 */
function formatIssuePath(path: (string | number)[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    return result ? `${result}.${segment}` : segment;
  }, "");
}

/**
 * Strictly parses unknown first-stage output without exposing Zod to callers.
 *
 * The parser never extracts JSON from strings, repairs fields, or discards
 * unknown keys. Provider adapters must return one decoded structured value.
 *
 * @param value - Unknown model output
 * @returns Detached typed output or safe structural diagnostics
 */
export function parseCompilerAnalysisModelOutput(
  value: unknown
): KnowledgeParseResult<CompilerAnalysisModelOutput> {
  const result = compilerAnalysisModelOutputSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  const issues: KnowledgeDiagnostic[] = result.error.issues
    .slice(0, MAX_MODEL_SCHEMA_DIAGNOSTICS)
    .map((issue) => ({
      code: `schema_${issue.code}`,
      severity: "error",
      field: formatIssuePath(issue.path),
      message: issue.message,
    }));
  return { ok: false, issues };
}
