import { z } from "zod";

import {
  KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
  type CompilerAnalysis,
  type CompilerAnalysisRequest,
  type CompilerApprovedTarget,
  type CompilerBoundTarget,
  type CompilerCandidateValidationInput,
  type CompilerCandidateValidationResult,
  type CompilerChangeSetDraft,
  type CompilerEvidence,
  type CompilerGenerationAnalysis,
  type CompilerGenerationRequest,
  type CompilerGenerationTarget,
  type CompilerSourceIdentity,
  type CompilerTargetAuthorization,
  type CompilerTargetObservation,
  type CompilerTargetRequest,
  type CompilerWritableTarget,
  type KnowledgeCompileFailure,
  type KnowledgeCompileInput,
  type KnowledgeCompileResult,
  type KnowledgeCompilerDependencies,
  type KnowledgeCompilerLimits,
  type KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  parseCompilerAnalysisModelOutput,
  type CompilerAnalysisModelOutput,
} from "@/knowledge/compiler/analysisSchema";
import {
  parseCompilerGenerationModelOutput,
  type CompilerGeneratedFile,
  type CompilerGenerationModelOutput,
} from "@/knowledge/compiler/generationSchema";
import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import { validateSourceLocatorAgainstArtifact } from "@/knowledge/model/locatorMaterialValidation";
import { knowledgeBundleConfigSchema, sourceLocatorSchema } from "@/knowledge/model/schemas";
import type {
  ClaimCitation,
  JsonValue,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateVaultRelativePath,
} from "@/knowledge/model/validation";
import {
  findWindowsPathCollisions,
  isPathWithinRoot,
  toWindowsPathKey,
} from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Safe defaults that callers may lower or raise through explicit configuration. */
export const DEFAULT_KNOWLEDGE_COMPILER_LIMITS: KnowledgeCompilerLimits = {
  maxConcepts: 256,
  maxEntities: 256,
  maxClaims: 512,
  maxRelations: 512,
  maxCitations: 1024,
  maxTargets: 128,
  maxEvidenceItems: 2048,
  maxContextPages: 256,
  maxTargetAuthorizations: 256,
  maxModelContextCharacters: 8_000_000,
  maxAnalysisCharacters: 1_000_000,
  maxGeneratedFileCharacters: 2_000_000,
  maxTotalGeneratedCharacters: 8_000_000,
  maxValidationDiagnostics: 1024,
};

const MAX_COMPILER_SCHEMA_DIAGNOSTICS = 256;

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();

const compilerSourceIdentitySchema: z.ZodType<CompilerSourceIdentity> = z
  .object({
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
  })
  .strict();

const compilerSchemaSnapshotSchema = z
  .object({
    path: nonEmptyStringSchema,
    content: z.string(),
    contentHash: sha256Schema,
  })
  .strict();

const compilerContextPageSchema = z
  .object({
    path: nonEmptyStringSchema,
    content: z.string(),
    contentHash: sha256Schema,
  })
  .strict();

const markdownHeadingObservationSchema = z
  .object({
    heading: nonEmptyStringSchema,
    occurrence: positiveIntegerSchema,
    startLine: positiveIntegerSchema,
    endLine: positiveIntegerSchema,
  })
  .strict();

const sourceArtifactObservationSchema: z.ZodType<SourceArtifactObservation> = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("markdown"),
        sourceId: nonEmptyStringSchema,
        artifactId: nonEmptyStringSchema,
        artifactContentHash: sha256Schema,
        text: z.string(),
        headings: z.array(markdownHeadingObservationSchema),
      })
      .strict(),
    z
      .object({
        kind: z.literal("pdf"),
        sourceId: nonEmptyStringSchema,
        artifactId: nonEmptyStringSchema,
        artifactContentHash: sha256Schema,
        pages: z.array(
          z
            .object({
              page: positiveIntegerSchema,
              text: z.string(),
            })
            .strict()
        ),
      })
      .strict(),
    z
      .object({
        kind: z.literal("text"),
        sourceId: nonEmptyStringSchema,
        artifactId: nonEmptyStringSchema,
        artifactContentHash: sha256Schema,
        text: z.string(),
      })
      .strict(),
  ]
);

const compilerEvidenceSchema: z.ZodType<CompilerEvidence> = z
  .object({
    evidenceId: nonEmptyStringSchema,
    locator: sourceLocatorSchema,
  })
  .strict();

const compilerTargetAuthorizationSchema: z.ZodType<CompilerTargetAuthorization> = z
  .object({
    path: nonEmptyStringSchema,
    allowedIntents: z.array(z.enum(["write", "delete"])).min(1),
    contentPolicy: z.enum(["grounded", "structural"]),
    ownership: z.enum(["generated", "shared", "user"]),
    sourceRefs: z.array(nonEmptyStringSchema),
    expectedContentHash: sha256Schema.optional(),
  })
  .strict();

const knowledgeCompileInputSchema: z.ZodType<KnowledgeCompileInput> = z
  .object({
    bundle: knowledgeBundleConfigSchema,
    operation: z.enum(["ingest", "query_writeback", "lint_fix"]),
    source: compilerSourceIdentitySchema,
    schema: compilerSchemaSnapshotSchema,
    artifacts: z.array(sourceArtifactObservationSchema).min(1),
    evidence: z.array(compilerEvidenceSchema).min(1),
    contextPages: z.array(compilerContextPageSchema),
    targetAuthorizations: z.array(compilerTargetAuthorizationSchema),
    createdAt: nonNegativeIntegerSchema,
  })
  .strict();

const compilerTargetObservationSchema: z.ZodType<CompilerTargetObservation> = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        targetId: nonEmptyStringSchema,
        kind: z.literal("missing"),
        windowsPathKey: nonEmptyStringSchema,
      })
      .strict(),
    z
      .object({
        targetId: nonEmptyStringSchema,
        kind: z.literal("occupied"),
        path: nonEmptyStringSchema,
      })
      .strict(),
    z
      .object({
        targetId: nonEmptyStringSchema,
        kind: z.literal("file"),
        path: nonEmptyStringSchema,
        content: z.string(),
      })
      .strict(),
    z
      .object({
        targetId: nonEmptyStringSchema,
        kind: z.literal("directory"),
        path: nonEmptyStringSchema,
      })
      .strict(),
  ]
);

const compilerTargetObservationsSchema = z.array(compilerTargetObservationSchema);

const knowledgeDiagnosticSchema: z.ZodType<KnowledgeDiagnostic> = z
  .object({
    code: nonEmptyStringSchema,
    severity: z.enum(["error", "warning"]),
    field: z.string(),
    message: nonEmptyStringSchema,
  })
  .strict();

const knowledgeValidationSummarySchema: z.ZodType<KnowledgeValidationSummary> = z
  .object({
    okfValid: z.boolean(),
    citationsValid: z.boolean(),
    linksValid: z.boolean(),
  })
  .strict();

const compilerCandidateValidationResultSchema: z.ZodType<CompilerCandidateValidationResult> = z
  .object({
    validation: knowledgeValidationSummarySchema,
    diagnostics: z.array(knowledgeDiagnosticSchema),
  })
  .strict();

/** Internal result used while normalizing untrusted analysis semantics. */
type AnalysisNormalizationResult =
  | { ok: true; analysis: CompilerAnalysis; analysisDigest: string }
  | { ok: false; diagnostics: KnowledgeDiagnostic[] };

/** Internal result used while binding approved paths to exact file states. */
type TargetBindingResult =
  | { ok: true; targets: CompilerBoundTarget[]; diagnostics: KnowledgeDiagnostic[] }
  | { ok: false; diagnostics: KnowledgeDiagnostic[] };

/** Internal result used while projecting second-stage output into file changes. */
type GenerationProjectionResult =
  | { ok: true; changes: KnowledgeFileChange[]; diagnostics: KnowledgeDiagnostic[] }
  | { ok: false; diagnostics: KnowledgeDiagnostic[] };

/** Sanitized dependency failure that never retains provider output or raw errors. */
export class KnowledgeCompilerInfrastructureError extends Error {
  public readonly retryable = true;

  /**
   * Creates a safe infrastructure failure for one compiler dependency.
   *
   * @param stage - Dependency stage that failed to return a value
   */
  constructor(public readonly stage: Exclude<KnowledgeCompilerStage, "input">) {
    super(`Knowledge compiler dependency failed during ${stage}`);
    this.name = "KnowledgeCompilerInfrastructureError";
  }
}

/** Cancellation signal surfaced without retaining an arbitrary signal reason. */
export class KnowledgeCompilerAbortError extends Error {
  /**
   * Creates a safe AbortError compatible with queue cancellation detection.
   *
   * @param stage - Compiler stage interrupted by the caller
   */
  constructor(public readonly stage: Exclude<KnowledgeCompilerStage, "input">) {
    super(`Knowledge compilation was cancelled during ${stage}`);
    this.name = "AbortError";
  }
}

/**
 * Appends one deterministic diagnostic.
 *
 * @param diagnostics - Mutable destination
 * @param severity - Error or warning classification
 * @param code - Stable machine-readable code
 * @param field - Field associated with the issue
 * @param message - Safe human-readable message
 */
function addDiagnostic(
  diagnostics: KnowledgeDiagnostic[],
  severity: KnowledgeDiagnostic["severity"],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity, field, message });
}

/**
 * Prefixes nested diagnostics without exposing an implementation dependency.
 *
 * @param diagnostics - Nested diagnostics to copy
 * @param prefix - Stable parent field path
 * @returns Detached prefixed diagnostics
 */
function prefixDiagnostics(
  diagnostics: readonly KnowledgeDiagnostic[],
  prefix: string
): KnowledgeDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    field: diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
  }));
}

/**
 * Converts a Zod issue path to stable dotted/indexed field notation.
 *
 * @param path - Zod issue path
 * @returns Stable field path
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
 * Maps strict schema issues to safe knowledge diagnostics.
 *
 * @param error - Zod validation error
 * @returns Detached structural diagnostics
 */
function mapSchemaIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.slice(0, MAX_COMPILER_SCHEMA_DIAGNOSTICS).map((issue) => ({
    code: `schema_${issue.code}`,
    severity: "error",
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

/**
 * Sorts stable text without locale-dependent behavior.
 *
 * @param left - First value
 * @param right - Second value
 * @returns Standard comparator result
 */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Sorts paths by Windows comparison identity and then exact spelling.
 *
 * @param left - First Vault path
 * @param right - Second Vault path
 * @returns Standard comparator result
 */
function compareVaultPaths(left: string, right: string): number {
  const keyComparison = compareText(toWindowsPathKey(left), toWindowsPathKey(right));
  return keyComparison === 0 ? compareText(left, right) : keyComparison;
}

/**
 * Produces a namespaced canonical SHA-256 digest.
 *
 * @param namespace - Versioned identity namespace
 * @param value - JSON-compatible semantic payload
 * @returns Lowercase SHA-256 digest
 */
function digestJson(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/**
 * Produces a readable stable id without trusting a model-local reference.
 *
 * @param prefix - Entity namespace
 * @param value - Canonical semantic payload
 * @returns Prefixed lowercase SHA-256 identity
 */
function createStableId(prefix: string, value: unknown): string {
  return `${prefix}-${digestJson(`knowledge-${prefix}-v1`, value)}`;
}

/**
 * Recursively freezes one detached request before it crosses an async port.
 *
 * @param value - Detached plain value
 * @param seen - Objects already visited during this recursion
 * @returns The same deeply frozen value
 */
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

/**
 * Checks whether a path targets a Markdown file in the Windows-only Wiki.
 *
 * @param path - Canonical Vault-relative path
 * @returns Whether the final segment has a case-insensitive .md extension
 */
function isMarkdownPath(path: string): boolean {
  return path.toLocaleLowerCase("en-US").endsWith(".md");
}

/**
 * Checks whether two valid Vault paths overlap as equal or ancestor/descendant.
 *
 * @param left - First path
 * @param right - Second path
 * @returns Whether either path contains the other
 */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/**
 * Copies one locator so no caller-owned object crosses an async boundary.
 *
 * @param locator - Strictly parsed source locator
 * @returns Detached locator preserving the discriminated shape
 */
function cloneLocator(locator: CompilerEvidence["locator"]): CompilerEvidence["locator"] {
  if (locator.kind === "markdown_lines") {
    const { heading, ...required } = locator;
    return { ...required, ...(heading === undefined ? {} : { heading }) };
  }
  if (locator.kind === "heading") {
    return { ...locator };
  }
  if (locator.kind === "pdf_page") {
    return { ...locator };
  }
  const { prefix, suffix, ...required } = locator;
  return {
    ...required,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}

/**
 * Creates one stable artifact lookup key.
 *
 * @param sourceId - Owning source id
 * @param artifactId - Parser artifact id
 * @returns Collision-resistant in-memory lookup key
 */
function createArtifactKey(sourceId: string, artifactId: string): string {
  return `${sourceId.length}:${sourceId}${artifactId}`;
}

/**
 * Normalizes input collection order after strict parsing.
 *
 * @param input - Detached strict compiler input
 * @returns Detached input with semantically unordered collections sorted
 */
function normalizeCompileInput(input: KnowledgeCompileInput): KnowledgeCompileInput {
  return {
    ...input,
    bundle: {
      ...input.bundle,
      sourceRoots: [...input.bundle.sourceRoots].sort(compareVaultPaths),
    },
    schema: { ...input.schema },
    source: { ...input.source },
    artifacts: [...input.artifacts].sort((left, right) =>
      compareText(
        createArtifactKey(left.sourceId, left.artifactId),
        createArtifactKey(right.sourceId, right.artifactId)
      )
    ),
    evidence: [...input.evidence]
      .sort((left, right) => compareText(left.evidenceId, right.evidenceId))
      .map((item) => ({ evidenceId: item.evidenceId, locator: cloneLocator(item.locator) })),
    contextPages: [...input.contextPages]
      .sort((left, right) => compareVaultPaths(left.path, right.path))
      .map((page) => ({ ...page })),
    targetAuthorizations: [...input.targetAuthorizations]
      .sort((left, right) => compareVaultPaths(left.path, right.path))
      .map((authorization) => {
        const { expectedContentHash, ...required } = authorization;
        return {
          ...required,
          allowedIntents: [...authorization.allowedIntents].sort(compareText),
          sourceRefs: [...authorization.sourceRefs].sort(compareText),
          ...(expectedContentHash === undefined ? {} : { expectedContentHash }),
        };
      }),
  };
}

/**
 * Validates semantic relationships in detached compile input.
 *
 * @param input - Strictly parsed and order-normalized input
 * @param limits - Explicit model-context resource bounds
 * @returns Deterministic input diagnostics
 */
function validateCompileInput(
  input: KnowledgeCompileInput,
  limits: KnowledgeCompilerLimits
): KnowledgeDiagnostic[] {
  const diagnostics = prefixDiagnostics(
    validateKnowledgeBundleConfig(input.bundle).diagnostics,
    "bundle"
  );
  validateCollectionLimit(diagnostics, "evidence", input.evidence.length, limits.maxEvidenceItems);
  validateCollectionLimit(
    diagnostics,
    "contextPages",
    input.contextPages.length,
    limits.maxContextPages
  );
  validateCollectionLimit(
    diagnostics,
    "targetAuthorizations",
    input.targetAuthorizations.length,
    limits.maxTargetAuthorizations
  );
  const modelContextCharacters = JSON.stringify({
    bundle: input.bundle,
    operation: input.operation,
    source: input.source,
    schema: input.schema,
    evidence: input.evidence,
    contextPages: input.contextPages,
    targetAuthorizations: input.targetAuthorizations.map((authorization) => ({
      path: authorization.path,
      allowedIntents: authorization.allowedIntents,
      contentPolicy: authorization.contentPolicy,
    })),
  }).length;
  if (modelContextCharacters > limits.maxModelContextCharacters) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_model_context_limit_exceeded",
      "input",
      "Model-visible compiler context exceeds the configured character limit"
    );
  }

  if (toWindowsPathKey(input.schema.path) !== toWindowsPathKey(input.bundle.schemaRef)) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_schema_path_mismatch",
      "schema.path",
      "Schema snapshot path must match the Bundle schemaRef"
    );
  }
  if (createFileContentHash(input.schema.content) !== input.schema.contentHash) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_schema_hash_mismatch",
      "schema.contentHash",
      "Schema snapshot hash does not match its exact content"
    );
  }

  const artifactsByKey = new Map<string, SourceArtifactObservation>();
  let primaryArtifactFound = false;
  input.artifacts.forEach((artifact, index) => {
    const key = createArtifactKey(artifact.sourceId, artifact.artifactId);
    if (artifactsByKey.has(key)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_artifact_duplicate",
        `artifacts[${index}]`,
        "Source and artifact identity must be unique within one compile"
      );
    } else {
      artifactsByKey.set(key, artifact);
    }
    if (artifact.sourceId === input.source.sourceId) {
      primaryArtifactFound = true;
    }

    if (artifact.kind === "markdown") {
      const headingKeys = new Set<string>();
      const lineCount = artifact.text.replace(/\r\n?/g, "\n").split("\n").length;
      artifact.headings.forEach((heading, headingIndex) => {
        const headingKey = `${heading.heading.length}:${heading.heading}${heading.occurrence}`;
        if (headingKeys.has(headingKey)) {
          addDiagnostic(
            diagnostics,
            "error",
            "compiler_heading_duplicate",
            `artifacts[${index}].headings[${headingIndex}]`,
            "Heading and occurrence must be unique within one Markdown artifact"
          );
        }
        headingKeys.add(headingKey);
        if (heading.startLine > heading.endLine || heading.endLine > lineCount) {
          addDiagnostic(
            diagnostics,
            "error",
            "compiler_heading_range_invalid",
            `artifacts[${index}].headings[${headingIndex}]`,
            "Heading line range must resolve inside the Markdown artifact"
          );
        }
      });
    }

    if (artifact.kind === "pdf") {
      const pageNumbers = new Set<number>();
      artifact.pages.forEach((page, pageIndex) => {
        if (pageNumbers.has(page.page)) {
          addDiagnostic(
            diagnostics,
            "error",
            "compiler_pdf_page_duplicate",
            `artifacts[${index}].pages[${pageIndex}].page`,
            "PDF page numbers must be unique within one artifact"
          );
        }
        pageNumbers.add(page.page);
      });
    }
  });

  if (!primaryArtifactFound) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_primary_artifact_missing",
      "artifacts",
      "At least one parser artifact must belong to the primary source"
    );
  }

  const evidenceIds = new Set<string>();
  let primaryEvidenceFound = false;
  input.evidence.forEach((evidence, index) => {
    if (evidenceIds.has(evidence.evidenceId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_evidence_id_duplicate",
        `evidence[${index}].evidenceId`,
        "Evidence ids must be unique within one compile"
      );
    }
    evidenceIds.add(evidence.evidenceId);
    if (evidence.locator.sourceId === input.source.sourceId) {
      primaryEvidenceFound = true;
    }

    const artifact = artifactsByKey.get(
      createArtifactKey(evidence.locator.sourceId, evidence.locator.artifactId)
    );
    if (!artifact) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_evidence_artifact_unknown",
        `evidence[${index}].locator`,
        "Evidence must reference an artifact included in this compile"
      );
      return;
    }
    const result = validateSourceLocatorAgainstArtifact(evidence.locator, artifact);
    diagnostics.push(...prefixDiagnostics(result.diagnostics, `evidence[${index}].locator`));
  });

  if (!primaryEvidenceFound) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_primary_evidence_missing",
      "evidence",
      "At least one model-visible evidence item must belong to the primary source"
    );
  }

  const contextKeys = new Set<string>();
  input.contextPages.forEach((page, index) => {
    const field = `contextPages[${index}].path`;
    diagnostics.push(
      ...prefixDiagnostics(validateVaultRelativePath(page.path, "").diagnostics, field)
    );
    if (!isPathWithinRoot(page.path, input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_context_outside_wiki",
        field,
        "Context pages must remain inside the generated Wiki root"
      );
    }
    if (toWindowsPathKey(page.path) === toWindowsPathKey(input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_context_equals_wiki_root",
        field,
        "A context page must be a strict descendant of the Wiki root"
      );
    }
    if (!isMarkdownPath(page.path)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_context_not_markdown",
        field,
        "Knowledge context pages must use the .md extension"
      );
    }
    if (createFileContentHash(page.content) !== page.contentHash) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_context_hash_mismatch",
        `contextPages[${index}].contentHash`,
        "Context page hash does not match its exact content"
      );
    }
    const key = toWindowsPathKey(page.path);
    if (contextKeys.has(key)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_context_path_duplicate",
        field,
        "Context paths must be unique on a case-insensitive Windows filesystem"
      );
    }
    contextKeys.add(key);
  });

  const authorizationKeys = new Set<string>();
  input.targetAuthorizations.forEach((authorization, index) => {
    const field = `targetAuthorizations[${index}].path`;
    diagnostics.push(
      ...prefixDiagnostics(validateVaultRelativePath(authorization.path, "").diagnostics, field)
    );
    if (!isPathWithinRoot(authorization.path, input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_outside_wiki",
        field,
        "Target authorizations must remain inside the generated Wiki root"
      );
    }
    if (toWindowsPathKey(authorization.path) === toWindowsPathKey(input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_equals_wiki_root",
        field,
        "Target authorizations must identify strict descendants of the Wiki root"
      );
    }
    if (!isMarkdownPath(authorization.path)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_not_markdown",
        field,
        "Target authorizations must use the .md extension"
      );
    }
    const intents = new Set(authorization.allowedIntents);
    if (intents.size !== authorization.allowedIntents.length) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_intent_duplicate",
        `targetAuthorizations[${index}].allowedIntents`,
        "Target authorization intents must be unique"
      );
    }
    if (intents.has("delete") && authorization.ownership !== "generated") {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_delete_ownership_invalid",
        `targetAuthorizations[${index}].allowedIntents`,
        "Delete authorization is limited to manifest-owned generated pages"
      );
    }
    const authorizationSourceRefs = new Set(authorization.sourceRefs);
    if (authorizationSourceRefs.size !== authorization.sourceRefs.length) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_source_ref_duplicate",
        `targetAuthorizations[${index}].sourceRefs`,
        "Target authorization source references must be unique"
      );
    }
    if (
      intents.has("delete") &&
      (authorizationSourceRefs.size !== 1 || !authorizationSourceRefs.has(input.source.sourceId))
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_delete_source_mismatch",
        `targetAuthorizations[${index}].sourceRefs`,
        "Delete authorization requires the primary source to be the page's only owner"
      );
    }
    if (intents.has("delete") && authorization.expectedContentHash === undefined) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_delete_hash_missing",
        `targetAuthorizations[${index}].expectedContentHash`,
        "Delete authorization requires the manifest's last generated content hash"
      );
    }
    const key = toWindowsPathKey(authorization.path);
    if (authorizationKeys.has(key)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorization_path_duplicate",
        field,
        "Target authorizations must be unique on a case-insensitive Windows filesystem"
      );
    }
    authorizationKeys.add(key);
  });

  return diagnostics;
}

/**
 * Creates an identity for the exact context exposed to both model stages.
 *
 * @param input - Validated normalized compiler input
 * @returns Stable compile context digest
 */
function createCompileContextDigest(input: KnowledgeCompileInput): string {
  return digestJson("knowledge-compile-context-v1", {
    bundle: input.bundle,
    operation: input.operation,
    source: input.source,
    schema: { path: input.schema.path, contentHash: input.schema.contentHash },
    artifacts: input.artifacts.map((artifact) => ({
      kind: artifact.kind,
      sourceId: artifact.sourceId,
      artifactId: artifact.artifactId,
      artifactContentHash: artifact.artifactContentHash,
      materialDigest: digestJson("knowledge-artifact-material-v1", artifact),
    })),
    evidence: input.evidence,
    contextPages: input.contextPages.map((page) => ({
      path: page.path,
      contentHash: page.contentHash,
    })),
    targetAuthorizations: input.targetAuthorizations,
  });
}

/**
 * Checks a model array against an explicitly configured resource bound.
 *
 * @param diagnostics - Mutable analysis diagnostics
 * @param field - Output array field
 * @param actual - Actual item count
 * @param limit - Configured maximum
 */
function validateCollectionLimit(
  diagnostics: KnowledgeDiagnostic[],
  field: string,
  actual: number,
  limit: number
): void {
  if (actual > limit) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_output_limit_exceeded",
      field,
      `Model output contains ${actual} items but the configured limit is ${limit}`
    );
  }
}

/**
 * Applies the configured character budget to one exact model request.
 *
 * @param value - Frozen provider-neutral request
 * @param limit - Maximum serialized character count
 * @param field - Request stage shown in diagnostics
 * @returns Empty diagnostics or one fail-closed size error
 */
function validateModelRequestCharacterLimit(
  value: unknown,
  limit: number,
  field: "analysisRequest" | "generationRequest"
): KnowledgeDiagnostic[] {
  if (JSON.stringify(value).length <= limit) {
    return [];
  }
  return [
    {
      code: "compiler_model_context_limit_exceeded",
      severity: "error",
      field,
      message: "Model-visible compiler request exceeds the configured character limit",
    },
  ];
}

/**
 * Records duplicate local references in one analysis namespace.
 *
 * @param diagnostics - Mutable analysis diagnostics
 * @param namespace - Output collection name
 * @param refs - Model-local refs in collection order
 */
function validateUniqueRefs(
  diagnostics: KnowledgeDiagnostic[],
  namespace: string,
  refs: readonly string[]
): void {
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    if (seen.has(ref)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_analysis_ref_duplicate",
        `${namespace}[${index}].ref`,
        `Analysis refs must be unique within ${namespace}`
      );
    }
    seen.add(ref);
  });
}

/**
 * Normalizes model-local refs into stable domain ids and validates all links.
 *
 * @param output - Strictly parsed first-stage output
 * @param input - Validated normalized compiler input
 * @param limits - Explicit resource limits
 * @returns Stable analysis or deterministic semantic diagnostics
 */
function normalizeAnalysis(
  output: CompilerAnalysisModelOutput,
  input: KnowledgeCompileInput,
  limits: KnowledgeCompilerLimits
): AnalysisNormalizationResult {
  const diagnostics: KnowledgeDiagnostic[] = [];
  validateCollectionLimit(diagnostics, "concepts", output.concepts.length, limits.maxConcepts);
  validateCollectionLimit(diagnostics, "entities", output.entities.length, limits.maxEntities);
  validateCollectionLimit(diagnostics, "claims", output.claims.length, limits.maxClaims);
  validateCollectionLimit(diagnostics, "relations", output.relations.length, limits.maxRelations);
  validateCollectionLimit(diagnostics, "citations", output.citations.length, limits.maxCitations);
  validateCollectionLimit(diagnostics, "targets", output.targets.length, limits.maxTargets);
  if (JSON.stringify(output).length > limits.maxAnalysisCharacters) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_analysis_character_limit_exceeded",
      "analysis",
      "Analysis output exceeds the configured total character limit"
    );
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  validateUniqueRefs(
    diagnostics,
    "concepts",
    output.concepts.map((item) => item.ref)
  );
  validateUniqueRefs(
    diagnostics,
    "entities",
    output.entities.map((item) => item.ref)
  );
  validateUniqueRefs(
    diagnostics,
    "claims",
    output.claims.map((item) => item.ref)
  );
  validateUniqueRefs(
    diagnostics,
    "relations",
    output.relations.map((item) => item.ref)
  );
  validateUniqueRefs(
    diagnostics,
    "targets",
    output.targets.map((item) => item.ref)
  );

  const nodeRefs = new Set<string>();
  for (const [namespace, values] of [
    ["concepts", output.concepts],
    ["entities", output.entities],
    ["claims", output.claims],
  ] as const) {
    values.forEach((value, index) => {
      if (nodeRefs.has(value.ref)) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_analysis_node_ref_ambiguous",
          `${namespace}[${index}].ref`,
          "Concept, entity, and claim refs must be globally unambiguous"
        );
      }
      nodeRefs.add(value.ref);
    });
  }

  const concepts = output.concepts.map((concept) => ({
    id: createStableId("concept", {
      name: concept.name,
      ...(concept.description === undefined ? {} : { description: concept.description }),
    }),
    name: concept.name,
    ...(concept.description === undefined ? {} : { description: concept.description }),
  }));
  const entities = output.entities.map((entity) => ({
    id: createStableId("entity", {
      name: entity.name,
      type: entity.type,
      ...(entity.description === undefined ? {} : { description: entity.description }),
    }),
    name: entity.name,
    type: entity.type,
    ...(entity.description === undefined ? {} : { description: entity.description }),
  }));
  const claims = output.claims.map((claim) => ({
    id: createStableId("claim", { text: claim.text }),
    text: claim.text,
  }));

  const nodeIdByRef = new Map<string, string>();
  output.concepts.forEach((item, index) => nodeIdByRef.set(item.ref, concepts[index].id));
  output.entities.forEach((item, index) => nodeIdByRef.set(item.ref, entities[index].id));
  output.claims.forEach((item, index) => nodeIdByRef.set(item.ref, claims[index].id));

  const stableNodeIds = new Set<string>();
  [...concepts, ...entities, ...claims].forEach((item) => {
    if (stableNodeIds.has(item.id)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_analysis_semantic_duplicate",
        "analysis",
        "Semantically duplicate analysis nodes are not accepted"
      );
    }
    stableNodeIds.add(item.id);
  });

  const relations = output.relations.flatMap((relation, index) => {
    const fromId = nodeIdByRef.get(relation.fromRef);
    const toId = nodeIdByRef.get(relation.toRef);
    if (!fromId || !toId) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_relation_endpoint_unknown",
        `relations[${index}]`,
        "Relation endpoints must reference a concept, entity, or claim"
      );
      return [];
    }
    if (fromId === toId) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_relation_self_reference",
        `relations[${index}]`,
        "A relation must connect two distinct analysis nodes"
      );
    }
    return [
      {
        id: createStableId("relation", { fromId, toId, type: relation.type }),
        fromId,
        toId,
        type: relation.type,
      },
    ];
  });

  const relationIds = new Set<string>();
  relations.forEach((relation, index) => {
    if (relationIds.has(relation.id)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_relation_semantic_duplicate",
        `relations[${index}]`,
        "Semantically duplicate relations are not accepted"
      );
    }
    relationIds.add(relation.id);
  });

  const evidenceById = new Map(input.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const claimIdByRef = new Map(
    output.claims.map((claim, index) => [claim.ref, claims[index].id] as const)
  );
  const citationKeys = new Set<string>();
  const supportedClaimIds = new Set<string>();
  const citations: ClaimCitation[] = [];
  output.citations.forEach((citation, index) => {
    const claimId = claimIdByRef.get(citation.claimRef);
    const evidence = evidenceById.get(citation.evidenceId);
    if (!claimId) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_citation_claim_unknown",
        `citations[${index}].claimRef`,
        "Citation claimRef must reference an analysis claim"
      );
    }
    if (!evidence) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_citation_evidence_unknown",
        `citations[${index}].evidenceId`,
        "Citation evidenceId must reference model-visible trusted evidence"
      );
    }
    if (!claimId || !evidence) {
      return;
    }

    const locator = cloneLocator(evidence.locator);
    const citationKey = digestJson("knowledge-citation-key-v1", {
      claimId,
      relation: citation.relation,
      locator,
    });
    if (citationKeys.has(citationKey)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_citation_duplicate",
        `citations[${index}]`,
        "The same claim, relation, and source locator may be cited only once"
      );
      return;
    }
    citationKeys.add(citationKey);
    if (citation.relation === "supports") {
      supportedClaimIds.add(claimId);
    }
    citations.push({
      citationId: createStableId("citation", {
        claimId,
        relation: citation.relation,
        locator,
      }),
      claimId,
      relation: citation.relation,
      locator,
    });
  });

  claims.forEach((claim, index) => {
    if (!supportedClaimIds.has(claim.id)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_claim_ungrounded",
        `claims[${index}]`,
        "Every analysis claim must have at least one supporting evidence citation"
      );
    }
  });

  const citationsByClaimId = new Map<string, ClaimCitation[]>();
  citations.forEach((citation) => {
    const existing = citationsByClaimId.get(citation.claimId);
    if (existing) {
      existing.push(citation);
    } else {
      citationsByClaimId.set(citation.claimId, [citation]);
    }
  });

  const targets: CompilerApprovedTarget[] = [];
  const targetIds = new Set<string>();
  const authorizationsByPath = new Map(
    input.targetAuthorizations.map((authorization) => [
      toWindowsPathKey(authorization.path),
      authorization,
    ])
  );
  output.targets.forEach((target, index) => {
    const field = `targets[${index}].path`;
    diagnostics.push(
      ...prefixDiagnostics(validateVaultRelativePath(target.path, "").diagnostics, field)
    );
    if (!isPathWithinRoot(target.path, input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_outside_wiki",
        field,
        "Compiler targets must remain inside the generated Wiki root"
      );
    }
    if (toWindowsPathKey(target.path) === toWindowsPathKey(input.bundle.wikiRoot)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_equals_wiki_root",
        field,
        "Compiler targets must be strict descendants of the Wiki root"
      );
    }
    if (!isMarkdownPath(target.path)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_not_markdown",
        field,
        "Compiler targets must use the .md extension"
      );
    }
    if (input.bundle.sourceRoots.some((root) => isPathWithinRoot(target.path, root))) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_inside_source",
        field,
        "Compiler targets cannot modify a raw source root"
      );
    }
    if (toWindowsPathKey(target.path) === toWindowsPathKey(input.bundle.schemaRef)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_is_schema",
        field,
        "Compiler targets cannot modify the Bundle schema"
      );
    }

    const claimRefs = new Set<string>();
    const claimIds: string[] = [];
    target.claimRefs.forEach((claimRef, claimIndex) => {
      if (claimRefs.has(claimRef)) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_target_claim_duplicate",
          `targets[${index}].claimRefs[${claimIndex}]`,
          "Target claim references must be unique"
        );
      }
      claimRefs.add(claimRef);
      const claimId = claimIdByRef.get(claimRef);
      if (!claimId) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_target_claim_unknown",
          `targets[${index}].claimRefs[${claimIndex}]`,
          "Target claimRefs must reference analysis claims"
        );
      } else {
        claimIds.push(claimId);
      }
    });
    claimIds.sort(compareText);

    const authorization = authorizationsByPath.get(toWindowsPathKey(target.path));
    const access = authorization ? "authorized" : "create_only";
    const contentPolicy = authorization?.contentPolicy ?? "grounded";
    const ownership = authorization?.ownership ?? "new";
    if (target.intent === "delete" && !authorization?.allowedIntents.includes("delete")) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_delete_unauthorized",
        `targets[${index}].intent`,
        "Delete targets require an explicit caller-owned delete authorization"
      );
    }
    if (
      target.intent === "write" &&
      authorization !== undefined &&
      !authorization.allowedIntents.includes("write")
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_write_unauthorized",
        `targets[${index}].intent`,
        "Known targets require an explicit caller-owned write authorization"
      );
    }
    if (target.intent === "write" && contentPolicy === "grounded" && claimIds.length === 0) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_claim_required",
        `targets[${index}].claimRefs`,
        "Grounded write targets must reference at least one supported analysis claim"
      );
    }

    const sourceRefs = new Set<string>([input.source.sourceId]);
    authorization?.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef));
    claimIds.forEach((claimId) => {
      citationsByClaimId
        .get(claimId)
        ?.forEach((citation) => sourceRefs.add(citation.locator.sourceId));
    });
    const approvedPath = authorization?.path ?? target.path;
    const targetId = createStableId("target", {
      bundleId: input.bundle.id,
      windowsPathKey: toWindowsPathKey(approvedPath),
      intent: target.intent,
    });
    if (targetIds.has(targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_semantic_duplicate",
        `targets[${index}]`,
        "The same Windows target and intent may be proposed only once"
      );
    }
    targetIds.add(targetId);
    targets.push({
      targetId,
      path: approvedPath,
      intent: target.intent,
      reason: target.reason,
      claimIds,
      sourceRefs: [...sourceRefs].sort(compareText),
      access,
      contentPolicy,
      ownership,
      ...(authorization?.expectedContentHash === undefined
        ? {}
        : { expectedContentHash: authorization.expectedContentHash }),
    });
  });

  const collisions = findWindowsPathCollisions(targets.map((target) => target.path));
  collisions.forEach((collision) => {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_target_windows_collision",
      "targets",
      `Analysis proposed multiple targets for Windows path '${collision.key}'`
    );
  });
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex];
      const right = targets[rightIndex];
      if (
        toWindowsPathKey(left.path) !== toWindowsPathKey(right.path) &&
        pathsOverlap(left.path, right.path)
      ) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_target_path_overlap",
          `targets[${rightIndex}].path`,
          "Analysis cannot target both an ancestor path and its descendant"
        );
      }
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  concepts.sort((left, right) => compareText(left.id, right.id));
  entities.sort((left, right) => compareText(left.id, right.id));
  claims.sort((left, right) => compareText(left.id, right.id));
  relations.sort((left, right) => compareText(left.id, right.id));
  citations.sort((left, right) => compareText(left.citationId, right.citationId));
  targets.sort((left, right) => {
    const pathComparison = compareVaultPaths(left.path, right.path);
    return pathComparison === 0 ? compareText(left.targetId, right.targetId) : pathComparison;
  });

  const analysis: CompilerAnalysis = {
    version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
    summary: output.summary,
    concepts,
    entities,
    claims,
    relations,
    citations,
    targets,
  };
  return {
    ok: true,
    analysis,
    analysisDigest: digestJson("knowledge-analysis-v1", analysis),
  };
}

/**
 * Validates a resolver-reported path against its approved Windows identity.
 *
 * @param path - Existing canonical path reported by the resolver
 * @param target - First-stage approved target
 * @param field - Observation field for diagnostics
 * @returns Deterministic path diagnostics
 */
function validateObservedTargetPath(
  path: string,
  target: CompilerApprovedTarget,
  field: string
): KnowledgeDiagnostic[] {
  const diagnostics = prefixDiagnostics(validateVaultRelativePath(path, "").diagnostics, field);
  if (toWindowsPathKey(path) !== toWindowsPathKey(target.path)) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_observation_path_mismatch",
      field,
      "Resolver path must identify the same Windows target that analysis approved"
    );
  }
  if (!isMarkdownPath(path)) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_observation_not_markdown",
      field,
      "Resolved knowledge targets must use the .md extension"
    );
  }
  return diagnostics;
}

/**
 * Binds first-stage intents to runtime-owned create/update/delete semantics.
 *
 * @param analysis - Stable normalized analysis
 * @param observations - Strictly parsed resolver payload
 * @returns Bound targets, no-op warnings, or fail-closed diagnostics
 */
function bindTargetObservations(
  analysis: CompilerAnalysis,
  observations: CompilerTargetObservation[]
): TargetBindingResult {
  const diagnostics: KnowledgeDiagnostic[] = [];
  const targetsById = new Map(analysis.targets.map((target) => [target.targetId, target]));
  const observationsById = new Map<string, CompilerTargetObservation>();

  observations.forEach((observation, index) => {
    if (observationsById.has(observation.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_observation_duplicate",
        `observations[${index}].targetId`,
        "Resolver must return each target id exactly once"
      );
    }
    if (!targetsById.has(observation.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_observation_unknown_target",
        `observations[${index}].targetId`,
        "Resolver returned a target id that analysis did not approve"
      );
    }
    observationsById.set(observation.targetId, observation);
  });

  analysis.targets.forEach((target, index) => {
    if (!observationsById.has(target.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_observation_missing",
        `targets[${index}].targetId`,
        "Resolver must return one exact observation for every approved target"
      );
    }
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const boundTargets: CompilerBoundTarget[] = [];
  analysis.targets.forEach((target, index) => {
    const observation = observationsById.get(target.targetId);
    if (!observation) {
      return;
    }
    if (observation.kind === "missing") {
      if (observation.windowsPathKey !== toWindowsPathKey(target.path)) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_missing_windows_key_mismatch",
          `observations[${index}].windowsPathKey`,
          "Missing observation must prove the approved Windows comparison key was checked"
        );
        return;
      }
      if (target.intent === "delete") {
        addDiagnostic(
          diagnostics,
          "warning",
          "compiler_delete_target_missing",
          `targets[${index}].path`,
          "Delete target is already missing and was treated as no change"
        );
        return;
      }
      boundTargets.push({ ...target, operation: "create" });
      return;
    }

    diagnostics.push(
      ...validateObservedTargetPath(observation.path, target, `observations[${index}].path`)
    );
    if (target.access === "create_only") {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_unapproved_existing_target",
        `observations[${index}]`,
        "A newly proposed path cannot read or update an existing unapproved Wiki target"
      );
      return;
    }
    if (observation.kind === "directory") {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_target_is_directory",
        `observations[${index}]`,
        "A compiler target cannot resolve to a directory"
      );
      return;
    }
    if (observation.kind === "occupied") {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_authorized_observation_incomplete",
        `observations[${index}]`,
        "Authorized existing targets require exact file content or a directory observation"
      );
      return;
    }

    const beforeHash = createFileContentHash(observation.content);
    if (target.intent === "delete") {
      if (target.expectedContentHash !== beforeHash) {
        addDiagnostic(
          diagnostics,
          "error",
          "compiler_delete_content_changed",
          `observations[${index}].content`,
          "Delete target no longer matches the manifest's last generated content hash"
        );
        return;
      }
      boundTargets.push({
        ...target,
        path: observation.path,
        operation: "delete",
        beforeContent: observation.content,
        beforeHash,
      });
    } else {
      boundTargets.push({
        ...target,
        path: observation.path,
        operation: "update",
        beforeContent: observation.content,
        beforeHash,
      });
    }
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }
  boundTargets.sort((left, right) => compareVaultPaths(left.path, right.path));
  return { ok: true, targets: boundTargets, diagnostics };
}

/**
 * Creates an immutable identity for exact runtime-bound target states.
 *
 * @param compileContextDigest - Digest of all model-visible compile context
 * @param analysisDigest - Digest of normalized first-stage analysis
 * @param targets - Exact sorted runtime-bound targets
 * @returns Target-set digest echoed by the generation response
 */
function createTargetSetDigest(
  compileContextDigest: string,
  analysisDigest: string,
  targets: readonly CompilerBoundTarget[]
): string {
  return digestJson("knowledge-target-set-v1", {
    compileContextDigest,
    analysisDigest,
    targets: targets.map((target) => ({
      targetId: target.targetId,
      path: target.path,
      intent: target.intent,
      operation: target.operation,
      reason: target.reason,
      claimIds: target.claimIds,
      sourceRefs: target.sourceRefs,
      access: target.access,
      contentPolicy: target.contentPolicy,
      ownership: target.ownership,
      ...(target.expectedContentHash === undefined
        ? {}
        : { expectedContentHash: target.expectedContentHash }),
      ...(target.operation === "create" ? {} : { beforeHash: target.beforeHash }),
    })),
  });
}

/**
 * Builds one runtime-owned file change from a writable target and model content.
 *
 * @param target - Exact create or update target
 * @param afterContent - Model-produced content only
 * @returns Fully hashed file change
 */
function createWritableChange(
  target: Extract<CompilerBoundTarget, { operation: "create" | "update" }>,
  afterContent: string
): KnowledgeFileChange {
  const afterHash = createFileContentHash(afterContent);
  const base = {
    id: createStableId("change", {
      targetId: target.targetId,
      operation: target.operation,
      ...(target.operation === "update" ? { beforeHash: target.beforeHash } : {}),
      afterHash,
    }),
    path: target.path,
    sourceRefs: [...target.sourceRefs],
    reason: target.reason,
  };
  if (target.operation === "create") {
    return {
      ...base,
      operation: "create",
      expectedAbsent: true,
      afterContent,
      afterHash,
    };
  }
  return {
    ...base,
    operation: "update",
    beforeHash: target.beforeHash,
    afterContent,
    afterHash,
  };
}

/**
 * Builds one runtime-owned delete change without model-controlled fields.
 *
 * @param target - Exact existing delete target
 * @returns Fully bound delete file change
 */
function createDeleteChange(
  target: Extract<CompilerBoundTarget, { operation: "delete" }>
): KnowledgeFileChange {
  return {
    id: createStableId("change", {
      targetId: target.targetId,
      operation: target.operation,
      beforeHash: target.beforeHash,
    }),
    operation: "delete",
    path: target.path,
    sourceRefs: [...target.sourceRefs],
    reason: target.reason,
    beforeHash: target.beforeHash,
  };
}

/**
 * Validates exact second-stage coverage and creates runtime-owned changes.
 *
 * @param output - Strictly parsed generation output
 * @param targetSetDigest - Digest generation must echo exactly
 * @param targets - Runtime-bound approved targets
 * @param limits - Explicit content resource bounds
 * @returns Stable file changes or fail-closed diagnostics
 */
function projectGeneration(
  output: CompilerGenerationModelOutput,
  targetSetDigest: string,
  targets: readonly CompilerBoundTarget[],
  limits: KnowledgeCompilerLimits
): GenerationProjectionResult {
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (output.files.length > limits.maxTargets) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_generation_file_limit_exceeded",
      "files",
      "Generation output exceeds the configured target count limit"
    );
    return { ok: false, diagnostics };
  }
  if (output.targetSetDigest !== targetSetDigest) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_generation_target_set_mismatch",
      "targetSetDigest",
      "Generation output does not belong to the current approved target set"
    );
  }

  const writableTargets = targets.filter(
    (target): target is Extract<CompilerBoundTarget, { operation: "create" | "update" }> =>
      target.operation !== "delete"
  );
  const writableById = new Map(writableTargets.map((target) => [target.targetId, target]));
  const generatedById = new Map<string, CompilerGeneratedFile>();
  let totalGeneratedCharacters = 0;
  output.files.forEach((file, index) => {
    if (generatedById.has(file.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_generation_target_duplicate",
        `files[${index}].targetId`,
        "Generation must return each writable target exactly once"
      );
    }
    if (!writableById.has(file.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_generation_target_unknown",
        `files[${index}].targetId`,
        "Generation returned a target id that is not an approved writable target"
      );
    }
    generatedById.set(file.targetId, file);
    if (file.outcome === "write") {
      totalGeneratedCharacters += file.afterContent.length;
    }
    if (file.outcome === "write" && file.afterContent.length > limits.maxGeneratedFileCharacters) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_generated_content_limit_exceeded",
        `files[${index}].afterContent`,
        "Generated content exceeds the configured per-file character limit"
      );
    }
  });
  if (totalGeneratedCharacters > limits.maxTotalGeneratedCharacters) {
    addDiagnostic(
      diagnostics,
      "error",
      "compiler_generated_total_limit_exceeded",
      "files",
      "Generated content exceeds the configured total character limit"
    );
  }

  writableTargets.forEach((target, index) => {
    if (!generatedById.has(target.targetId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_generation_target_missing",
        `targets[${index}].targetId`,
        "Generation must explicitly write or preserve every writable target"
      );
    }
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const changes: KnowledgeFileChange[] = targets
    .filter(
      (target): target is Extract<CompilerBoundTarget, { operation: "delete" }> =>
        target.operation === "delete"
    )
    .map(createDeleteChange);
  writableTargets.forEach((target) => {
    const generated = generatedById.get(target.targetId);
    if (!generated || generated.outcome === "unchanged") {
      return;
    }
    if (target.operation === "update" && generated.afterContent === target.beforeContent) {
      addDiagnostic(
        diagnostics,
        "warning",
        "compiler_update_content_unchanged",
        target.path,
        "Generated update exactly matches the current file and was treated as no change"
      );
      return;
    }
    changes.push(createWritableChange(target, generated.afterContent));
  });
  changes.sort((left, right) => compareVaultPaths(left.path, right.path));
  return { ok: true, changes, diagnostics };
}

/**
 * Creates a stable ChangeSet id from semantic proposal material, excluding time.
 *
 * @param input - Validated normalized compile input
 * @param analysisDigest - Stable analysis digest
 * @param targetSetDigest - Exact target-state digest
 * @param changes - Runtime-owned file changes
 * @param citations - Runtime-owned normalized citations
 * @returns Stable proposal id
 */
function createChangeSetId(
  input: KnowledgeCompileInput,
  analysisDigest: string,
  targetSetDigest: string,
  changes: readonly KnowledgeFileChange[],
  citations: readonly ClaimCitation[]
): string {
  return createStableId("changeset", {
    bundleId: input.bundle.id,
    operation: input.operation,
    source: input.source,
    analysisDigest,
    targetSetDigest,
    changes,
    citations,
  });
}

/**
 * Derives the complete source reference union without trusting model output.
 *
 * @param primarySourceId - Queue-owned primary source id
 * @param changes - Runtime-owned file changes
 * @param citations - Runtime-owned citations
 * @returns Sorted unique source ids
 */
function collectSourceRefs(
  primarySourceId: string,
  changes: readonly KnowledgeFileChange[],
  citations: readonly ClaimCitation[]
): string[] {
  const sourceRefs = new Set<string>([primarySourceId]);
  changes.forEach((change) => change.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef)));
  citations.forEach((citation) => sourceRefs.add(citation.locator.sourceId));
  return [...sourceRefs].sort(compareText);
}

/**
 * Builds a controlled deterministic failure result.
 *
 * @param stage - Compiler stage that rejected the value
 * @param diagnostics - Safe structured diagnostics
 * @returns Persistable non-retryable failure
 */
function createFailure(
  stage: KnowledgeCompilerStage,
  diagnostics: KnowledgeDiagnostic[]
): KnowledgeCompileFailure {
  return { kind: "failed", stage, retryable: false, diagnostics };
}

/**
 * Verifies configured limits before the compiler accepts dependencies.
 *
 * @param limits - Merged compile limits
 */
function assertValidLimits(limits: KnowledgeCompilerLimits): void {
  for (const [field, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Knowledge compiler limit '${field}' must be a positive safe integer`);
    }
  }
}

/** Provider-neutral deterministic two-stage Knowledge Compiler. */
export class KnowledgeCompiler {
  private readonly limits: KnowledgeCompilerLimits;

  /**
   * Creates a compiler with all provider, read, and validation boundaries injected.
   *
   * @param dependencies - Model, read-only target resolver, validator, and limits
   */
  constructor(private readonly dependencies: KnowledgeCompilerDependencies) {
    this.limits = {
      ...DEFAULT_KNOWLEDGE_COMPILER_LIMITS,
      ...dependencies.limits,
    };
    assertValidLimits(this.limits);
  }

  /**
   * Compiles trusted parser material into a validated review-only ChangeSet.
   *
   * The method performs no Vault write. Model outputs remain unknown until
   * strict parsing, target paths are bound before generation, and the returned
   * ChangeSet status is always `proposed`.
   *
   * @param value - Typed or runtime-supplied compile input
   * @param signal - Cancellation signal owned by the ingest queue attempt
   * @returns No changes, a safe controlled failure, or a validated proposal
   */
  async compile(
    value: KnowledgeCompileInput,
    signal: AbortSignal
  ): Promise<KnowledgeCompileResult> {
    const parsedInput = knowledgeCompileInputSchema.safeParse(value);
    if (!parsedInput.success) {
      return createFailure("input", mapSchemaIssues(parsedInput.error));
    }

    const input = normalizeCompileInput(parsedInput.data);
    const inputDiagnostics = validateCompileInput(input, this.limits);
    if (inputDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return createFailure("input", inputDiagnostics);
    }

    const compileContextDigest = createCompileContextDigest(input);
    const analysisRequest = this.createAnalysisRequest(input, compileContextDigest);
    const analysisRequestDiagnostics = validateModelRequestCharacterLimit(
      analysisRequest,
      this.limits.maxModelContextCharacters,
      "analysisRequest"
    );
    if (analysisRequestDiagnostics.length > 0) {
      return createFailure("input", analysisRequestDiagnostics);
    }
    const rawAnalysis = await this.invokeDependency("analysis", signal, () =>
      this.dependencies.model.analyze(analysisRequest, signal)
    );
    const parsedAnalysis = parseCompilerAnalysisModelOutput(rawAnalysis);
    if (!parsedAnalysis.ok) {
      return createFailure("analysis", parsedAnalysis.issues);
    }

    const normalized = normalizeAnalysis(parsedAnalysis.value, input, this.limits);
    if (!normalized.ok) {
      return createFailure("analysis", normalized.diagnostics);
    }
    const { analysis, analysisDigest } = normalized;
    if (analysis.targets.length === 0) {
      return {
        kind: "no_changes",
        compileContextDigest,
        analysisDigest,
        analysis,
        diagnostics: inputDiagnostics,
      };
    }

    const targetRequests = deepFreeze(
      analysis.targets.map<CompilerTargetRequest>((target) => ({
        targetId: target.targetId,
        path: target.path,
        intent: target.intent,
        access: target.access,
      }))
    );
    const rawObservations = await this.invokeDependency("target_resolution", signal, () =>
      this.dependencies.targetResolver.resolve(targetRequests, signal)
    );
    const parsedObservations = compilerTargetObservationsSchema.safeParse(rawObservations);
    if (!parsedObservations.success) {
      return createFailure("target_resolution", mapSchemaIssues(parsedObservations.error));
    }
    const binding = bindTargetObservations(analysis, parsedObservations.data);
    if (!binding.ok) {
      return createFailure("target_resolution", binding.diagnostics);
    }
    const targetDiagnostics = [...inputDiagnostics, ...binding.diagnostics];
    if (binding.targets.length === 0) {
      return {
        kind: "no_changes",
        compileContextDigest,
        analysisDigest,
        analysis,
        diagnostics: targetDiagnostics,
      };
    }

    const targetSetDigest = createTargetSetDigest(
      compileContextDigest,
      analysisDigest,
      binding.targets
    );
    const writableTargets = binding.targets.filter(
      (target): target is CompilerWritableTarget => target.operation !== "delete"
    );
    let generationOutput: CompilerGenerationModelOutput = {
      version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
      targetSetDigest,
      files: [],
    };
    if (writableTargets.length > 0) {
      const generationRequest = this.createGenerationRequest(
        input,
        compileContextDigest,
        analysisDigest,
        targetSetDigest,
        analysis,
        writableTargets
      );
      const generationRequestDiagnostics = validateModelRequestCharacterLimit(
        generationRequest,
        this.limits.maxModelContextCharacters,
        "generationRequest"
      );
      if (generationRequestDiagnostics.length > 0) {
        return createFailure("generation", generationRequestDiagnostics);
      }
      const rawGeneration = await this.invokeDependency("generation", signal, () =>
        this.dependencies.model.generate(generationRequest, signal)
      );
      const parsedGeneration = parseCompilerGenerationModelOutput(rawGeneration);
      if (!parsedGeneration.ok) {
        return createFailure("generation", parsedGeneration.issues);
      }
      generationOutput = parsedGeneration.value;
    }

    const projection = projectGeneration(
      generationOutput,
      targetSetDigest,
      binding.targets,
      this.limits
    );
    if (!projection.ok) {
      return createFailure("generation", projection.diagnostics);
    }
    const compileDiagnostics = [...targetDiagnostics, ...projection.diagnostics];
    if (projection.changes.length === 0) {
      return {
        kind: "no_changes",
        compileContextDigest,
        analysisDigest,
        analysis,
        diagnostics: compileDiagnostics,
      };
    }

    const sourceRefs = collectSourceRefs(
      input.source.sourceId,
      projection.changes,
      analysis.citations
    );
    const draft: CompilerChangeSetDraft = {
      id: createChangeSetId(
        input,
        analysisDigest,
        targetSetDigest,
        projection.changes,
        analysis.citations
      ),
      bundleId: input.bundle.id,
      operation: input.operation,
      sourceRefs,
      changes: projection.changes,
      citations: analysis.citations,
      createdAt: input.createdAt,
    };
    const validationInput: CompilerCandidateValidationInput = deepFreeze({
      bundle: input.bundle,
      source: input.source,
      schema: input.schema,
      artifacts: input.artifacts,
      contextPages: input.contextPages,
      analysis,
      targetSetDigest,
      targets: binding.targets,
      draft,
    });
    const rawValidation = await this.invokeDependency("candidate_validation", signal, () =>
      this.dependencies.candidateValidator.validate(validationInput, signal)
    );
    const parsedValidation = compilerCandidateValidationResultSchema.safeParse(rawValidation);
    if (!parsedValidation.success) {
      return createFailure("candidate_validation", mapSchemaIssues(parsedValidation.error));
    }

    if (parsedValidation.data.diagnostics.length > this.limits.maxValidationDiagnostics) {
      return createFailure("candidate_validation", [
        {
          code: "compiler_validation_diagnostic_limit_exceeded",
          severity: "error",
          field: "diagnostics",
          message: "Candidate validator returned more diagnostics than the configured limit",
        },
      ]);
    }
    const validationDiagnostics = [...parsedValidation.data.diagnostics];
    this.appendFailedValidationFlags(parsedValidation.data.validation, validationDiagnostics);
    if (validationDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return createFailure("candidate_validation", validationDiagnostics);
    }

    const changeSet: KnowledgeChangeSet = {
      ...draft,
      validation: parsedValidation.data.validation,
      status: "proposed",
    };
    const finalValidation = validateKnowledgeChangeSet(changeSet, input.bundle);
    if (!finalValidation.valid) {
      return createFailure("candidate_validation", finalValidation.diagnostics);
    }

    return {
      kind: "proposed",
      compileContextDigest,
      analysisDigest,
      targetSetDigest,
      proposalDigest: createChangeSetTransactionDigest(changeSet),
      analysis,
      changeSet,
      diagnostics: [...compileDiagnostics, ...validationDiagnostics],
    };
  }

  /**
   * Creates and freezes the provider-neutral first-stage request.
   *
   * @param input - Validated normalized compile input
   * @param compileContextDigest - Identity of the exact model-visible context
   * @returns Deeply frozen request
   */
  private createAnalysisRequest(
    input: KnowledgeCompileInput,
    compileContextDigest: string
  ): CompilerAnalysisRequest {
    return deepFreeze({
      version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
      compileContextDigest,
      bundle: input.bundle,
      operation: input.operation,
      source: input.source,
      schema: input.schema,
      evidence: input.evidence,
      contextPages: input.contextPages,
      targetAuthorizations: input.targetAuthorizations.map((authorization) => ({
        path: authorization.path,
        allowedIntents: authorization.allowedIntents,
        contentPolicy: authorization.contentPolicy,
      })),
    });
  }

  /**
   * Creates and freezes the provider-neutral second-stage request.
   *
   * @param input - Validated normalized compile input
   * @param compileContextDigest - Identity of exact model-visible context
   * @param analysisDigest - Identity of normalized first-stage analysis
   * @param targetSetDigest - Identity of runtime-bound target states
   * @param analysis - Stable normalized analysis
   * @param targets - Runtime-bound writable targets only
   * @returns Deeply frozen generation request
   */
  private createGenerationRequest(
    input: KnowledgeCompileInput,
    compileContextDigest: string,
    analysisDigest: string,
    targetSetDigest: string,
    analysis: CompilerAnalysis,
    targets: CompilerWritableTarget[]
  ): CompilerGenerationRequest {
    const generationAnalysis: CompilerGenerationAnalysis = {
      version: analysis.version,
      summary: analysis.summary,
      concepts: analysis.concepts,
      entities: analysis.entities,
      claims: analysis.claims,
      relations: analysis.relations,
      citations: analysis.citations,
    };
    const generationTargets: CompilerGenerationTarget[] = targets.map((target) => {
      const base = {
        targetId: target.targetId,
        path: target.path,
        reason: target.reason,
        claimIds: target.claimIds,
        contentPolicy: target.contentPolicy,
      };
      if (target.operation === "create") {
        return { ...base, operation: "create" };
      }
      return {
        ...base,
        operation: "update",
        currentContent: target.beforeContent,
      };
    });
    return deepFreeze({
      version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
      compileContextDigest,
      analysisDigest,
      targetSetDigest,
      bundle: input.bundle,
      operation: input.operation,
      source: input.source,
      schema: input.schema,
      evidence: input.evidence,
      contextPages: input.contextPages,
      analysis: generationAnalysis,
      targets: generationTargets,
    });
  }

  /**
   * Invokes one dependency while preserving cancellation and sanitizing errors.
   *
   * @param stage - Dependency stage
   * @param signal - Cancellation signal
   * @param invoke - Deferred dependency invocation
   * @returns Dependency payload
   */
  private async invokeDependency<T>(
    stage: Exclude<KnowledgeCompilerStage, "input">,
    signal: AbortSignal,
    invoke: () => Promise<T>
  ): Promise<T> {
    if (signal.aborted) {
      throw new KnowledgeCompilerAbortError(stage);
    }
    try {
      const result = await invoke();
      if (signal.aborted) {
        throw new KnowledgeCompilerAbortError(stage);
      }
      return result;
    } catch {
      if (signal.aborted) {
        throw new KnowledgeCompilerAbortError(stage);
      }
      throw new KnowledgeCompilerInfrastructureError(stage);
    }
  }

  /**
   * Converts false validator flags into explicit fail-closed diagnostics.
   *
   * @param validation - Deterministic validation flags
   * @param diagnostics - Mutable validator diagnostics
   */
  private appendFailedValidationFlags(
    validation: KnowledgeValidationSummary,
    diagnostics: KnowledgeDiagnostic[]
  ): void {
    if (!validation.okfValid) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_candidate_okf_invalid",
        "validation.okfValid",
        "Generated files do not satisfy the configured OKF contract"
      );
    }
    if (!validation.citationsValid) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_candidate_citations_invalid",
        "validation.citationsValid",
        "Generated proposal citations did not pass deterministic validation"
      );
    }
    if (!validation.linksValid) {
      addDiagnostic(
        diagnostics,
        "error",
        "compiler_candidate_links_invalid",
        "validation.linksValid",
        "Generated proposal links did not pass projected validation"
      );
    }
  }
}
