import * as z from "zod";

import type {
  ClaimCitation,
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeIngestJob,
  KnowledgeParseResult,
  OkfDocument,
  SourceLocator,
  SourceManifest,
} from "@/knowledge/model/types";

function hasNonWhitespaceText(value: string): boolean {
  return value.trim().length > 0;
}

const nonEmptyStringSchema = z.string().refine(hasNonWhitespaceText, "Expected a non-empty string");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const knowledgeBundleConfigSchema: z.ZodType<KnowledgeBundleConfig> = z
  .object({
    version: z.literal(1),
    id: nonEmptyStringSchema,
    sourceRoots: z.array(nonEmptyStringSchema).min(1),
    wikiRoot: nonEmptyStringSchema,
    schemaRef: nonEmptyStringSchema,
    reviewMode: z.enum(["always", "multi_file", "trusted_generated_only"]),
  })
  .strict();

const knowledgeFailureSchema = z
  .object({
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    retryable: z.boolean(),
    occurredAt: nonNegativeIntegerSchema,
  })
  .strict();

const generatedPageReferenceSchema = z
  .object({
    path: nonEmptyStringSchema,
    ownership: z.enum(["generated", "shared", "user"]),
    contentHash: sha256Schema.optional(),
  })
  .strict();

const sourceCompileSnapshotSchema = z
  .object({
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    generatedPages: z.array(generatedPageReferenceSchema).min(1),
    changeSetId: nonEmptyStringSchema,
    completedAt: nonNegativeIntegerSchema,
  })
  .strict();

const sourceCompileFailureSchema = z
  .object({
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    failure: knowledgeFailureSchema,
  })
  .strict();

export const sourceManifestEntrySchema = z
  .object({
    sourceId: nonEmptyStringSchema,
    sourceKey: nonEmptyStringSchema,
    sourcePath: nonEmptyStringSchema,
    custody: z.enum(["user_managed", "managed_copy"]),
    lastSuccessful: sourceCompileSnapshotSchema.optional(),
    lastFailure: sourceCompileFailureSchema.optional(),
    extensions: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export const sourceManifestSchema: z.ZodType<SourceManifest> = z
  .object({
    version: z.literal(1),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    entries: z.array(sourceManifestEntrySchema),
    extensions: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const sourceLocatorBaseShape = {
  sourceId: nonEmptyStringSchema,
  artifactId: nonEmptyStringSchema,
  artifactContentHash: sha256Schema,
  excerpt: nonEmptyStringSchema,
  quoteHash: sha256Schema,
};

export const sourceLocatorSchema: z.ZodType<SourceLocator> = z.discriminatedUnion("kind", [
  z
    .object({
      ...sourceLocatorBaseShape,
      kind: z.literal("markdown_lines"),
      startLine: positiveIntegerSchema,
      endLine: positiveIntegerSchema,
      heading: nonEmptyStringSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...sourceLocatorBaseShape,
      kind: z.literal("heading"),
      heading: nonEmptyStringSchema,
      occurrence: positiveIntegerSchema,
    })
    .strict(),
  z
    .object({
      ...sourceLocatorBaseShape,
      kind: z.literal("pdf_page"),
      page: positiveIntegerSchema,
    })
    .strict(),
  z
    .object({
      ...sourceLocatorBaseShape,
      kind: z.literal("quote"),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })
    .strict(),
]);

export const claimCitationSchema: z.ZodType<ClaimCitation> = z
  .object({
    citationId: nonEmptyStringSchema,
    claimId: nonEmptyStringSchema,
    relation: z.enum(["supports", "contradicts", "context"]),
    locator: sourceLocatorSchema,
  })
  .strict();

const okfConceptDocumentSchema = z
  .object({
    kind: z.literal("concept"),
    path: nonEmptyStringSchema,
    body: z.string(),
    type: nonEmptyStringSchema,
    title: nonEmptyStringSchema.optional(),
    description: z.string().optional(),
    resource: nonEmptyStringSchema.optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    timestamp: nonEmptyStringSchema.optional(),
    extensions: z.record(z.string(), jsonValueSchema),
    citations: z.array(claimCitationSchema),
  })
  .strict();

const okfIndexDocumentSchema = z
  .object({
    kind: z.literal("index"),
    path: nonEmptyStringSchema,
    body: z.string(),
    okfVersion: z.literal("0.1").optional(),
  })
  .strict();

const okfLogDocumentSchema = z
  .object({
    kind: z.literal("log"),
    path: nonEmptyStringSchema,
    body: z.string(),
  })
  .strict();

export const okfDocumentSchema: z.ZodType<OkfDocument> = z.discriminatedUnion("kind", [
  okfConceptDocumentSchema,
  okfIndexDocumentSchema,
  okfLogDocumentSchema,
]);

const ingestJobBaseShape = {
  id: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceContentHash: sha256Schema,
  pipelineFingerprint: sha256Schema,
  inputRevision: nonNegativeIntegerSchema,
  attempt: nonNegativeIntegerSchema,
  rerunRequested: z.boolean(),
  createdAt: nonNegativeIntegerSchema,
  updatedAt: nonNegativeIntegerSchema,
};

export const knowledgeIngestJobSchema: z.ZodType<KnowledgeIngestJob> = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("pending"),
        stage: z.literal("queued"),
        nextAttemptAt: nonNegativeIntegerSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("processing"),
        stage: z.enum([
          "parsing",
          "analyzing",
          "associating",
          "generating",
          "validating",
          "applying",
        ]),
        startedAt: nonNegativeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("paused"),
        stage: z.enum(["parsing", "analyzing", "associating", "generating", "validating"]),
        pausedAt: nonNegativeIntegerSchema,
        reason: z.string().optional(),
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("awaiting_review"),
        stage: z.literal("review"),
        changeSetId: nonEmptyStringSchema,
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("failed"),
        stage: z.enum([
          "queued",
          "parsing",
          "analyzing",
          "associating",
          "generating",
          "validating",
          "applying",
          "review",
        ]),
        failure: knowledgeFailureSchema,
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("completed"),
        stage: z.literal("completed"),
        changeSetId: nonEmptyStringSchema,
        completedAt: nonNegativeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...ingestJobBaseShape,
        status: z.literal("cancelled"),
        stage: z.literal("cancelled"),
        cancelledAt: nonNegativeIntegerSchema,
      })
      .strict(),
  ]
);

const fileChangeBaseShape = {
  id: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  sourceRefs: z.array(nonEmptyStringSchema),
  reason: nonEmptyStringSchema,
};

export const knowledgeFileChangeSchema: z.ZodType<KnowledgeFileChange> = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ...fileChangeBaseShape,
        operation: z.literal("create"),
        expectedAbsent: z.literal(true),
        afterContent: z.string(),
        afterHash: sha256Schema,
      })
      .strict(),
    z
      .object({
        ...fileChangeBaseShape,
        operation: z.literal("update"),
        beforeHash: sha256Schema,
        afterContent: z.string(),
        afterHash: sha256Schema,
      })
      .strict(),
    z
      .object({
        ...fileChangeBaseShape,
        operation: z.literal("delete"),
        beforeHash: sha256Schema,
      })
      .strict(),
  ]
);

export const knowledgeChangeSetSchema: z.ZodType<KnowledgeChangeSet> = z
  .object({
    id: nonEmptyStringSchema,
    bundleId: nonEmptyStringSchema,
    operation: z.enum(["ingest", "query_writeback", "lint_fix"]),
    sourceRefs: z.array(nonEmptyStringSchema),
    changes: z.array(knowledgeFileChangeSchema).min(1),
    citations: z.array(claimCitationSchema),
    validation: z
      .object({
        okfValid: z.boolean(),
        citationsValid: z.boolean(),
        linksValid: z.boolean(),
      })
      .strict(),
    status: z.enum(["proposed", "accepted", "rejected", "applied", "failed"]),
    createdAt: nonNegativeIntegerSchema,
  })
  .strict();

function formatIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    const text = String(segment);
    return result ? `${result}.${text}` : text;
  }, "");
}

function formatIssueCode(issue: z.ZodIssue): string {
  if (issue.code !== "invalid_value") {
    return issue.code;
  }

  return issue.values.length === 1 ? "invalid_literal" : "invalid_enum_value";
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): KnowledgeParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const issues: KnowledgeDiagnostic[] = result.error.issues.map((issue) => ({
    code: `schema_${formatIssueCode(issue)}`,
    severity: "error",
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
  return { ok: false, issues };
}

export function parseKnowledgeBundleConfig(
  value: unknown
): KnowledgeParseResult<KnowledgeBundleConfig> {
  return parseWithSchema(knowledgeBundleConfigSchema, value);
}

export function parseSourceManifest(value: unknown): KnowledgeParseResult<SourceManifest> {
  return parseWithSchema(sourceManifestSchema, value);
}

export function parseSourceLocator(value: unknown): KnowledgeParseResult<SourceLocator> {
  return parseWithSchema(sourceLocatorSchema, value);
}

export function parseClaimCitation(value: unknown): KnowledgeParseResult<ClaimCitation> {
  return parseWithSchema(claimCitationSchema, value);
}

export function parseKnowledgeIngestJob(value: unknown): KnowledgeParseResult<KnowledgeIngestJob> {
  return parseWithSchema(knowledgeIngestJobSchema, value);
}

export function parseKnowledgeFileChange(
  value: unknown
): KnowledgeParseResult<KnowledgeFileChange> {
  return parseWithSchema(knowledgeFileChangeSchema, value);
}

export function parseKnowledgeChangeSet(value: unknown): KnowledgeParseResult<KnowledgeChangeSet> {
  return parseWithSchema(knowledgeChangeSetSchema, value);
}

export function parseOkfDocument(value: unknown): KnowledgeParseResult<OkfDocument> {
  return parseWithSchema(okfDocumentSchema, value);
}
