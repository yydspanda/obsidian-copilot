import * as z from "zod";

import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeDiagnostic, KnowledgeParseResult } from "@/knowledge/model/types";

const MAX_MODEL_SCHEMA_DIAGNOSTICS = 256;

/** A statement in the finished draft and the source excerpts that support it. */
export interface CompilerGeneratedClaim {
  text: string;
  evidenceIds: string[];
}

/** Explicit generation result for one program-owned writable target. */
export type CompilerGeneratedFile =
  | { targetId: string; outcome: "write"; afterContent: string; claims: CompilerGeneratedClaim[] }
  | { targetId: string; outcome: "unchanged" };

/** Strict structured output expected from the content generation stage. */
export interface CompilerGenerationModelOutput {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  targetSetDigest: string;
  files: CompilerGeneratedFile[];
}

/** Checks for non-whitespace text without transforming model output. */
function hasNonWhitespaceText(value: string): boolean {
  return value.trim().length > 0;
}

const nonEmptyStringSchema = z.string().refine(hasNonWhitespaceText, "Expected a non-empty string");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

// A draft must carry its actual evidence-backed statements so Review does not depend on a prior topic filter.
// https://github.com/yydspanda/obsidian-copilot/issues/20
const generatedFileSchema: z.ZodType<CompilerGeneratedFile> = z.discriminatedUnion("outcome", [
  z
    .object({
      targetId: nonEmptyStringSchema,
      outcome: z.literal("write"),
      afterContent: nonEmptyStringSchema,
      claims: z
        .array(
          z
            .object({
              text: nonEmptyStringSchema,
              evidenceIds: z.array(nonEmptyStringSchema).min(1),
            })
            .strict()
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      targetId: nonEmptyStringSchema,
      outcome: z.literal("unchanged"),
    })
    .strict(),
]);

/** Strict runtime schema for untrusted source-writing output. */
export const compilerGenerationModelOutputSchema: z.ZodType<CompilerGenerationModelOutput> = z
  .object({
    version: z.literal(KNOWLEDGE_COMPILER_PROTOCOL_VERSION),
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
 * Strictly parses unknown source-writing output without exposing Zod to callers.
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
