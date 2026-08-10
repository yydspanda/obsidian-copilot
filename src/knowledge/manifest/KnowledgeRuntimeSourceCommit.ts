import { z } from "zod";

import type { KnowledgeParseResult } from "@/knowledge/model/types";

/** Reserved Source Manifest extension containing monotonic Runtime apply metadata. */
export const KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY =
  "obsidianCopilotKnowledgeRuntimeCommit" as const;

/** Runtime-owned monotonic source metadata stored through the Manifest extension bag. */
export interface KnowledgeRuntimeSourceCommitExtension {
  version: 1;
  inputRevision: number;
  transactionId: string;
  manifestIntentDigest: string;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const runtimeSourceCommitExtensionSchema: z.ZodType<KnowledgeRuntimeSourceCommitExtension> = z
  .object({
    version: z.literal(1),
    inputRevision: z.number().int().safe().nonnegative(),
    transactionId: nonEmptyStringSchema,
    manifestIntentDigest: sha256Schema,
  })
  .strict();

/**
 * Strictly parses detached Runtime apply metadata without importing the Runtime store.
 *
 * Keeping this parser at the Manifest leaf lets freshness compare Apply and
 * no-change revisions without creating a dependency on Queue, Review, or file
 * mutation capabilities.
 *
 * @param value - Untrusted Manifest extension value
 * @returns Frozen metadata or one sanitized parse failure
 */
export function parseKnowledgeRuntimeSourceCommitExtension(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeRuntimeSourceCommitExtension>> {
  const parsed = runtimeSourceCommitExtensionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: "runtime_source_commit_invalid",
          severity: "error",
          field: "source.extensions.runtimeCommit",
          message: "Runtime source commit metadata is invalid",
        },
      ],
    };
  }
  return {
    ok: true,
    value: Object.freeze({ ...parsed.data }),
  };
}
