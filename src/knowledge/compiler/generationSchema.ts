import * as z from "zod";

import type { KnowledgeDiagnostic, KnowledgeParseResult } from "@/knowledge/model/types";

const MAX_MODEL_SCHEMA_DIAGNOSTICS = 256;

// Generated text must supply claim-level witnesses before it can become a proposal.
// https://github.com/yydspanda/obsidian-copilot/issues/20
export const KNOWLEDGE_COMPILER_GENERATION_OUTPUT_VERSION = 2 as const;

/** Target-text excerpt offered as a coverage witness for one selected claim. */
export interface CompilerClaimCoverage {
  claimId: string;
  excerpt: string;
}

/** Explicit generation result for one writable approved target. */
export type CompilerGeneratedFile =
  | {
      targetId: string;
      outcome: "write";
      afterContent: string;
      claimCoverage: CompilerClaimCoverage[];
    }
  | { targetId: string; outcome: "unchanged"; claimCoverage: CompilerClaimCoverage[] };

/** Strict structured output expected from the content generation stage. */
export interface CompilerGenerationModelOutput {
  version: typeof KNOWLEDGE_COMPILER_GENERATION_OUTPUT_VERSION;
  targetSetDigest: string;
  files: CompilerGeneratedFile[];
}

/** Checks for non-whitespace text without transforming model output. */
function hasNonWhitespaceText(value: string): boolean {
  return value.trim().length > 0;
}

const nonEmptyStringSchema = z.string().refine(hasNonWhitespaceText, "Expected a non-empty string");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const claimCoverageSchema: z.ZodType<CompilerClaimCoverage> = z
  .object({
    claimId: nonEmptyStringSchema,
    excerpt: nonEmptyStringSchema,
  })
  .strict();

const generatedFileSchema: z.ZodType<CompilerGeneratedFile> = z.discriminatedUnion("outcome", [
  z
    .object({
      targetId: nonEmptyStringSchema,
      outcome: z.literal("write"),
      afterContent: z.string(),
      claimCoverage: z.array(claimCoverageSchema),
    })
    .strict(),
  z
    .object({
      targetId: nonEmptyStringSchema,
      outcome: z.literal("unchanged"),
      claimCoverage: z.array(claimCoverageSchema),
    })
    .strict(),
]);

/** Strict runtime schema for untrusted second-stage model output. */
export const compilerGenerationModelOutputSchema: z.ZodType<CompilerGenerationModelOutput> = z
  .object({
    version: z.literal(KNOWLEDGE_COMPILER_GENERATION_OUTPUT_VERSION),
    targetSetDigest: sha256Schema,
    files: z.array(generatedFileSchema),
  })
  .strict();

/**
 * Converts a Zod issue path to stable dotted/indexed field notation.
 *
 * @param path - Zod property and array-index path
 * @returns Stable field path for future review UI
 */
function formatIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    const text = String(segment);
    return result ? `${result}.${text}` : text;
  }, "");
}

/**
 * Strictly parses unknown second-stage output without exposing Zod to callers.
 *
 * Paths, operations, hashes, source references, validation flags, and status
 * are intentionally absent from this schema and therefore rejected as extras.
 *
 * @param value - Unknown model output
 * @returns Detached typed output or safe structural diagnostics
 */
export function parseCompilerGenerationModelOutput(
  value: unknown
): KnowledgeParseResult<CompilerGenerationModelOutput> {
  const result = compilerGenerationModelOutputSchema.safeParse(value);
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
