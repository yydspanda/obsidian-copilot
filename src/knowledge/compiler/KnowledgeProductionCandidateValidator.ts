import { parseDocument } from "yaml";
import { z } from "zod";

import type {
  CompilerApprovedTarget,
  CompilerBoundTarget,
  CompilerCandidateValidationInput,
  CompilerCandidateValidationResult,
  CompilerCandidateValidator,
} from "@/knowledge/compiler/CompilerModelPort";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  type SourceArtifactObservation,
  validateSourceLocatorAgainstArtifact,
} from "@/knowledge/model/locatorMaterialValidation";
import {
  claimCitationSchema,
  knowledgeBundleConfigSchema,
  knowledgeFileChangeSchema,
} from "@/knowledge/model/schemas";
import type {
  ClaimCitation,
  JsonValue,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  OkfDocument,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateOkfDocument,
} from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 500_000;
const MAX_SNAPSHOT_CHARACTERS = 20_000_000;
const MAX_COLLECTION_ITEMS = 20_000;
const MAX_OBJECT_KEYS = 20_000;
const MAX_FRONTMATTER_CHARACTERS = 65_536;
const MAX_DIAGNOSTICS = 512;

const canonicalTextSchema = z
  .string()
  .refine(
    (value) => value.length > 0 && value.trim() === value,
    "Expected canonical non-empty text"
  );
const nonEmptyTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected non-empty text");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();

const markdownHeadingSchema = z
  .object({
    heading: nonEmptyTextSchema,
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
        kind: z.literal("text"),
        sourceId: canonicalTextSchema,
        artifactId: canonicalTextSchema,
        artifactContentHash: sha256Schema,
        text: z.string(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("markdown"),
        sourceId: canonicalTextSchema,
        artifactId: canonicalTextSchema,
        artifactContentHash: sha256Schema,
        text: z.string(),
        headings: z.array(markdownHeadingSchema),
      })
      .strict(),
    z
      .object({
        kind: z.literal("pdf"),
        sourceId: canonicalTextSchema,
        artifactId: canonicalTextSchema,
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
  ]
);

const compilerSourceSchema = z
  .object({
    sourceId: canonicalTextSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeIntegerSchema,
  })
  .strict();

const compilerSchemaSnapshotSchema = z
  .object({
    path: canonicalTextSchema,
    content: z.string(),
    contentHash: sha256Schema,
  })
  .strict();

const compilerContextPageSchema = z
  .object({
    path: canonicalTextSchema,
    content: z.string(),
    contentHash: sha256Schema,
  })
  .strict();

const approvedTargetShape = {
  targetId: canonicalTextSchema,
  path: canonicalTextSchema,
  intent: z.enum(["write", "delete"]),
  reason: nonEmptyTextSchema,
  claimIds: z.array(canonicalTextSchema),
  sourceRefs: z.array(canonicalTextSchema),
  access: z.enum(["authorized", "create_only"]),
  contentPolicy: z.enum(["grounded", "structural"]),
  ownership: z.enum(["generated", "shared", "user", "new"]),
  expectedContentHash: sha256Schema.optional(),
};

const approvedTargetSchema = z.object(approvedTargetShape).strict();
const boundTargetSchema = z.discriminatedUnion("operation", [
  z.object({ ...approvedTargetShape, operation: z.literal("create") }).strict(),
  z
    .object({
      ...approvedTargetShape,
      operation: z.literal("update"),
      beforeContent: z.string(),
      beforeHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      ...approvedTargetShape,
      operation: z.literal("delete"),
      beforeContent: z.string(),
      beforeHash: sha256Schema,
    })
    .strict(),
]);

const compilerAnalysisSchema = z
  .object({
    version: z.literal(1),
    summary: nonEmptyTextSchema,
    concepts: z.array(
      z
        .object({
          id: canonicalTextSchema,
          name: nonEmptyTextSchema,
          description: z.string().optional(),
        })
        .strict()
    ),
    entities: z.array(
      z
        .object({
          id: canonicalTextSchema,
          name: nonEmptyTextSchema,
          type: nonEmptyTextSchema,
          description: z.string().optional(),
        })
        .strict()
    ),
    claims: z.array(z.object({ id: canonicalTextSchema, text: nonEmptyTextSchema }).strict()),
    relations: z.array(
      z
        .object({
          id: canonicalTextSchema,
          fromId: canonicalTextSchema,
          toId: canonicalTextSchema,
          type: nonEmptyTextSchema,
        })
        .strict()
    ),
    citations: z.array(claimCitationSchema),
    targets: z.array(approvedTargetSchema),
  })
  .strict();

const compilerDraftSchema = z
  .object({
    id: canonicalTextSchema,
    bundleId: canonicalTextSchema,
    operation: z.enum(["ingest", "query_writeback", "lint_fix"]),
    sourceRefs: z.array(canonicalTextSchema),
    changes: z.array(knowledgeFileChangeSchema).min(1),
    citations: z.array(claimCitationSchema),
    createdAt: nonNegativeIntegerSchema,
  })
  .strict();

const candidateInputSchema = z
  .object({
    bundle: knowledgeBundleConfigSchema,
    source: compilerSourceSchema,
    schema: compilerSchemaSnapshotSchema,
    artifacts: z.array(sourceArtifactObservationSchema).min(1),
    contextPages: z.array(compilerContextPageSchema),
    analysis: compilerAnalysisSchema,
    targetSetDigest: sha256Schema,
    targets: z.array(boundTargetSchema).min(1),
    draft: compilerDraftSchema,
  })
  .strict();

interface SnapshotBudget {
  nodes: number;
  characters: number;
}

interface ParsedMarkdown {
  body: string;
  frontmatter: Readonly<Record<string, JsonValue>>;
  hasFrontmatter: boolean;
}

/** Adds one bounded, fixed-message diagnostic without retaining untrusted material. */
function addDiagnostic(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  if (diagnostics.length >= MAX_DIAGNOSTICS) return;
  diagnostics.push({ code, severity: "error", field, message });
}

/** Prefixes trusted internal diagnostics while replacing their messages. */
function appendSafeDiagnostics(
  diagnostics: KnowledgeDiagnostic[],
  prefix: string,
  nested: readonly KnowledgeDiagnostic[],
  message: string
): void {
  for (const diagnostic of nested) {
    addDiagnostic(
      diagnostics,
      `production_candidate_${diagnostic.code}`,
      diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
      message
    );
  }
}

/** Checks whether a detached value is a plain string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively snapshots JSON-compatible data without invoking property accessors. */
function snapshotData(value: unknown, budget: SnapshotBudget, depth = 0): JsonValue {
  if (depth > MAX_SNAPSHOT_DEPTH || budget.nodes >= MAX_SNAPSHOT_NODES) {
    throw new TypeError("Candidate input exceeds its structural budget");
  }
  budget.nodes += 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.characters += value.length;
    if (budget.characters > MAX_SNAPSHOT_CHARACTERS) {
      throw new TypeError("Candidate input exceeds its text budget");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Candidate number is not finite");
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Candidate input is not JSON-compatible");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new TypeError("Candidate input uses an unsupported prototype");
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_COLLECTION_ITEMS ||
      Reflect.ownKeys(value).length !== lengthDescriptor.value + 1
    ) {
      throw new TypeError("Candidate array is not dense and bounded");
    }
    const snapshot: JsonValue[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Candidate array item is not plain data");
      }
      snapshot.push(snapshotData(descriptor.value, budget, depth + 1));
    }
    return Object.freeze(snapshot) as unknown as JsonValue;
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_KEYS || keys.some((key) => typeof key !== "string")) {
    throw new TypeError("Candidate object keys are not bounded strings");
  }
  const snapshot: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Candidate object property is not plain data");
    }
    snapshot[key] = snapshotData(descriptor.value, budget, depth + 1);
  }
  return Object.freeze(snapshot);
}

/** Creates one exact all-false result for a malformed or unavailable candidate. */
function createInvalidResult(
  code: string,
  field: string,
  message: string
): CompilerCandidateValidationResult {
  const diagnostics: KnowledgeDiagnostic[] = [
    Object.freeze({ code, severity: "error" as const, field, message }),
  ];
  Object.freeze(diagnostics);
  return Object.freeze({
    validation: Object.freeze({ okfValid: false, citationsValid: false, linksValid: false }),
    diagnostics,
  });
}

/** Extracts a bounded YAML frontmatter block without accepting partial delimiters. */
function parseMarkdown(content: string): ParsedMarkdown {
  const opening = content.startsWith("---\n") || content.startsWith("---\r\n");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (opening) throw new TypeError("Markdown frontmatter is unterminated");
    return Object.freeze({ body: content, frontmatter: Object.freeze({}), hasFrontmatter: false });
  }
  const yaml = match[1];
  if (yaml.length > MAX_FRONTMATTER_CHARACTERS) {
    throw new TypeError("Markdown frontmatter is too large");
  }
  const document = parseDocument(yaml, {
    schema: "core",
    merge: false,
    uniqueKeys: true,
    stringKeys: true,
    strict: true,
    prettyErrors: false,
    resolveKnownTags: false,
    customTags: [],
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new TypeError("Markdown frontmatter is invalid");
  }
  const raw: unknown = document.toJS({ maxAliasCount: 0 });
  const detached = snapshotData(raw ?? {}, { nodes: 0, characters: 0 });
  if (!isRecord(detached)) throw new TypeError("Markdown frontmatter must be a mapping");
  return Object.freeze({
    body: content.slice(match[0].length),
    frontmatter: detached,
    hasFrontmatter: true,
  });
}

/** Returns one Wiki-relative canonical path using the already validated Bundle depth. */
function toRelativeWikiPath(wikiRoot: string, path: string): string {
  const rootSegments = wikiRoot.split("/");
  const pathSegments = path.split("/");
  if (pathSegments.length <= rootSegments.length) {
    throw new TypeError("Generated path is not a Wiki descendant");
  }
  return pathSegments.slice(rootSegments.length).join("/");
}

/** Detects link syntax unsupported by the first fail-closed production generation. */
function containsUnsupportedLink(content: string): boolean {
  return (
    /!?\[\[[\s\S]*?\]\]/.test(content) ||
    /!?\[[^\]\r\n]*\]\([^\r\n)]*\)/.test(content) ||
    /!?\[[^\]\r\n]*\]\[[^\]\r\n]*\]/.test(content) ||
    /^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(?:\r?\n[ \t]+)?\S+/m.test(content) ||
    /<[a-z][a-z0-9+.-]*:[^<>\r\n]+>/i.test(content) ||
    /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*?)?\s*\/?>/i.test(content) ||
    /\b[a-z][a-z0-9+.-]*:[^\s<>\r\n]+/i.test(content) ||
    /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<>\r\n]*)?/i.test(content) ||
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(content)
  );
}

/** Compares two canonical string arrays without silently normalizing their order. */
function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Compares strict parsed JSON material independently of object key insertion order. */
function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

/** Sorts canonical identifiers using the Compiler's locale-independent text order. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Checks the immutable approved fields retained by one runtime-bound target. */
function matchesApprovedProjection(
  approved: CompilerApprovedTarget,
  bound: CompilerBoundTarget
): boolean {
  return (
    approved.targetId === bound.targetId &&
    toWindowsPathKey(approved.path) === toWindowsPathKey(bound.path) &&
    approved.intent === bound.intent &&
    approved.reason === bound.reason &&
    sameStringArray(approved.claimIds, bound.claimIds) &&
    sameStringArray(approved.sourceRefs, bound.sourceRefs) &&
    approved.access === bound.access &&
    approved.contentPolicy === bound.contentPolicy &&
    approved.ownership === bound.ownership &&
    approved.expectedContentHash === bound.expectedContentHash
  );
}

/** Checks one runtime-owned change against the exact bound target it projects. */
function matchesBoundChange(change: KnowledgeFileChange, target: CompilerBoundTarget): boolean {
  if (
    change.path !== target.path ||
    change.operation !== target.operation ||
    change.reason !== target.reason ||
    !sameStringArray(change.sourceRefs, target.sourceRefs)
  ) {
    return false;
  }
  if (change.operation === "create") return target.operation === "create";
  return target.operation === change.operation && change.beforeHash === target.beforeHash;
}

/** Validates claim, target, citation, change, and source-union relationships. */
function validateCandidateRelationships(
  input: z.infer<typeof candidateInputSchema>,
  diagnostics: KnowledgeDiagnostic[]
): void {
  const claimIds = new Set(input.analysis.claims.map((claim) => claim.id));
  input.analysis.citations.forEach((citation, index) => {
    if (!claimIds.has(citation.claimId)) {
      addDiagnostic(
        diagnostics,
        "production_candidate_analysis_citation_claim_unknown",
        `analysis.citations[${index}].claimId`,
        "Analysis citation must reference an exact analysis claim"
      );
    }
  });
  input.analysis.targets.forEach((target, targetIndex) => {
    target.claimIds.forEach((claimId, claimIndex) => {
      if (!claimIds.has(claimId)) {
        addDiagnostic(
          diagnostics,
          "production_candidate_analysis_target_claim_unknown",
          `analysis.targets[${targetIndex}].claimIds[${claimIndex}]`,
          "Analysis target must reference an exact analysis claim"
        );
      }
    });
  });

  if (!sameJson(input.analysis.citations, input.draft.citations)) {
    addDiagnostic(
      diagnostics,
      "production_candidate_draft_citations_mismatch",
      "draft.citations",
      "Draft citations must exactly retain the approved analysis citations"
    );
  }

  const approvedById = new Map<string, CompilerApprovedTarget[]>();
  input.analysis.targets.forEach((target) => {
    const matches = approvedById.get(target.targetId) ?? [];
    matches.push(target);
    approvedById.set(target.targetId, matches);
  });
  const boundById = new Map<string, CompilerBoundTarget[]>();
  input.targets.forEach((target, index) => {
    const approved = approvedById.get(target.targetId) ?? [];
    if (approved.length !== 1 || !matchesApprovedProjection(approved[0], target)) {
      addDiagnostic(
        diagnostics,
        "production_candidate_bound_target_projection_invalid",
        `targets[${index}]`,
        "Runtime-bound target does not retain one exact approved target projection"
      );
    }
    const expectedIntent = target.operation === "delete" ? "delete" : "write";
    if (target.intent !== expectedIntent) {
      addDiagnostic(
        diagnostics,
        "production_candidate_bound_target_operation_invalid",
        `targets[${index}].operation`,
        "Runtime-bound operation does not match its approved target intent"
      );
    }
    const matches = boundById.get(target.targetId) ?? [];
    matches.push(target);
    boundById.set(target.targetId, matches);
  });
  input.analysis.targets.forEach((target, index) => {
    const matches = boundById.get(target.targetId) ?? [];
    // A missing approved delete is a legitimate no-op and is intentionally absent
    // from the bound set. Every write and every present delete remains one-to-one.
    if ((target.intent === "write" && matches.length !== 1) || matches.length > 1) {
      addDiagnostic(
        diagnostics,
        "production_candidate_analysis_target_binding_invalid",
        `analysis.targets[${index}]`,
        "Approved target does not have the required exact runtime binding"
      );
    }
  });

  input.draft.changes.forEach((change, index) => {
    const matches = input.targets.filter((target) => target.path === change.path);
    if (matches.length !== 1 || !matchesBoundChange(change, matches[0])) {
      addDiagnostic(
        diagnostics,
        "production_candidate_change_target_mismatch",
        `draft.changes[${index}]`,
        "Draft change does not retain one exact runtime-bound target"
      );
    }
  });

  const expectedSourceRefs = new Set<string>([input.source.sourceId]);
  input.draft.changes.forEach((change) =>
    change.sourceRefs.forEach((sourceRef) => expectedSourceRefs.add(sourceRef))
  );
  input.draft.citations.forEach((citation) => expectedSourceRefs.add(citation.locator.sourceId));
  const expectedSourceRefList = [...expectedSourceRefs].sort(compareText);
  if (!sameStringArray(input.draft.sourceRefs, expectedSourceRefList)) {
    addDiagnostic(
      diagnostics,
      "production_candidate_source_refs_mismatch",
      "draft.sourceRefs",
      "Draft source references must equal the canonical primary, change, and citation union"
    );
  }

  // targetSetDigest is deliberately format-validated only. Recomputing its
  // authorized identity also requires compileContextDigest and analysisDigest,
  // which the Compiler does not expose to this adapter. The Compiler validates
  // the generation echo before constructing this candidate input.
}

/** Copies known frontmatter fields while retaining JSON-compatible extensions. */
function createConceptDocument(
  path: string,
  markdown: ParsedMarkdown,
  citations: readonly ClaimCitation[]
): unknown {
  const known = new Set(["type", "title", "description", "resource", "tags", "timestamp"]);
  const extensions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(markdown.frontmatter)) {
    if (!known.has(key)) extensions[key] = value;
  }
  const value = (key: string): JsonValue | undefined => markdown.frontmatter[key];
  return {
    kind: "concept",
    path,
    body: markdown.body,
    type: value("type"),
    ...(value("title") === undefined ? {} : { title: value("title") }),
    ...(value("description") === undefined ? {} : { description: value("description") }),
    ...(value("resource") === undefined ? {} : { resource: value("resource") }),
    ...(value("tags") === undefined ? {} : { tags: value("tags") }),
    ...(value("timestamp") === undefined ? {} : { timestamp: value("timestamp") }),
    extensions,
    citations: citations.map((citation) => ({ ...citation, locator: { ...citation.locator } })),
  };
}

/** Converts one generated Markdown file into the path-selected OKF document kind. */
function createOkfDocument(
  bundleWikiRoot: string,
  change: Exclude<KnowledgeFileChange, { operation: "delete" }>,
  citations: readonly ClaimCitation[]
): unknown {
  const relativePath = toRelativeWikiPath(bundleWikiRoot, change.path);
  const basename = relativePath.split("/").pop()?.toLocaleLowerCase("en-US");
  const markdown = parseMarkdown(change.afterContent);
  if (basename === "index.md") {
    const keys = Object.keys(markdown.frontmatter);
    if (keys.some((key) => key !== "okfVersion")) {
      throw new TypeError("Index frontmatter contains unsupported fields");
    }
    return {
      kind: "index",
      path: relativePath,
      body: markdown.body,
      ...(markdown.frontmatter.okfVersion === undefined
        ? {}
        : { okfVersion: markdown.frontmatter.okfVersion }),
    };
  }
  if (basename === "log.md") {
    if (Object.keys(markdown.frontmatter).length > 0) {
      throw new TypeError("Log frontmatter contains unsupported fields");
    }
    return { kind: "log", path: relativePath, body: markdown.body };
  }
  if (!markdown.hasFrontmatter) {
    throw new TypeError("Concept frontmatter is required");
  }
  return createConceptDocument(relativePath, markdown, citations);
}

/** Validates artifact identities and every material citation in the candidate. */
function validateCitations(
  artifacts: readonly SourceArtifactObservation[],
  citations: readonly ClaimCitation[],
  diagnostics: KnowledgeDiagnostic[]
): boolean {
  const artifactsByIdentity = new Map<string, SourceArtifactObservation[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.sourceId.length}:${artifact.sourceId}${artifact.artifactId.length}:${artifact.artifactId}${artifact.artifactContentHash}`;
    const existing = artifactsByIdentity.get(key) ?? [];
    existing.push(artifact);
    artifactsByIdentity.set(key, existing);
  }
  let valid = true;
  citations.forEach((citation, index) => {
    const locator = citation.locator;
    const key = `${locator.sourceId.length}:${locator.sourceId}${locator.artifactId.length}:${locator.artifactId}${locator.artifactContentHash}`;
    const matches = artifactsByIdentity.get(key) ?? [];
    if (matches.length !== 1) {
      valid = false;
      addDiagnostic(
        diagnostics,
        "production_candidate_citation_artifact_identity_invalid",
        `draft.citations[${index}].locator`,
        "Candidate citation does not identify exactly one parser-owned artifact"
      );
      return;
    }
    const result = validateSourceLocatorAgainstArtifact(locator, matches[0]);
    if (!result.valid) valid = false;
    appendSafeDiagnostics(
      diagnostics,
      `draft.citations[${index}].locator`,
      result.diagnostics,
      "Candidate citation did not resolve against parser-owned material"
    );
  });
  return valid;
}

/** Validates each non-delete file as OKF Markdown and rejects every link in generation one. */
function validateGeneratedDocuments(
  bundleWikiRoot: string,
  changes: readonly KnowledgeFileChange[],
  citations: readonly ClaimCitation[],
  diagnostics: KnowledgeDiagnostic[]
): { okfValid: boolean; linksValid: boolean } {
  let okfValid = true;
  let linksValid = true;
  changes.forEach((change, index) => {
    if (change.operation === "delete") {
      okfValid = false;
      addDiagnostic(
        diagnostics,
        "production_candidate_delete_unsupported",
        `draft.changes[${index}].operation`,
        "Delete is unavailable in the first production candidate validator"
      );
      return;
    }
    if (containsUnsupportedLink(change.afterContent)) {
      linksValid = false;
      addDiagnostic(
        diagnostics,
        "production_candidate_links_unsupported",
        `draft.changes[${index}].afterContent`,
        "Generated Markdown links are unavailable until projected link resolution is enabled"
      );
    }
    try {
      const sourceRefs = new Set(change.sourceRefs);
      const documentCitations = citations.filter((citation) =>
        sourceRefs.has(citation.locator.sourceId)
      );
      const document = createOkfDocument(bundleWikiRoot, change, documentCitations) as OkfDocument;
      const validation = validateOkfDocument(document);
      if (!validation.valid) okfValid = false;
      appendSafeDiagnostics(
        diagnostics,
        `draft.changes[${index}].afterContent`,
        validation.diagnostics,
        "Generated Markdown does not satisfy the OKF document contract"
      );
    } catch {
      okfValid = false;
      addDiagnostic(
        diagnostics,
        "production_candidate_okf_markdown_invalid",
        `draft.changes[${index}].afterContent`,
        "Generated Markdown could not be parsed as a bounded OKF document"
      );
    }
  });
  return { okfValid, linksValid };
}

/** Performs deterministic candidate checks after the descriptor-only input snapshot. */
function validateCandidate(
  input: z.infer<typeof candidateInputSchema>
): CompilerCandidateValidationResult {
  const diagnostics: KnowledgeDiagnostic[] = [];
  const bundleValidation = validateKnowledgeBundleConfig(input.bundle);
  appendSafeDiagnostics(
    diagnostics,
    "bundle",
    bundleValidation.diagnostics,
    "Candidate Bundle does not satisfy the production contract"
  );
  if (!bundleValidation.valid) {
    return {
      validation: { okfValid: false, citationsValid: false, linksValid: false },
      diagnostics,
    };
  }
  if (createFileContentHash(input.schema.content) !== input.schema.contentHash) {
    addDiagnostic(
      diagnostics,
      "production_candidate_schema_hash_mismatch",
      "schema.contentHash",
      "Candidate schema content does not match its declared hash"
    );
  }
  input.contextPages.forEach((page, index) => {
    if (createFileContentHash(page.content) !== page.contentHash) {
      addDiagnostic(
        diagnostics,
        "production_candidate_context_hash_mismatch",
        `contextPages[${index}].contentHash`,
        "Candidate context content does not match its declared hash"
      );
    }
  });
  input.targets.forEach((target, index) => {
    if (
      target.operation !== "create" &&
      createFileContentHash(target.beforeContent) !== target.beforeHash
    ) {
      addDiagnostic(
        diagnostics,
        "production_candidate_target_hash_mismatch",
        `targets[${index}].beforeHash`,
        "Candidate target pre-state does not match its declared hash"
      );
    }
  });

  const proposed: KnowledgeChangeSet = {
    ...input.draft,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
  };
  const changeSetValidation = validateKnowledgeChangeSet(proposed, input.bundle);
  appendSafeDiagnostics(
    diagnostics,
    "draft",
    changeSetValidation.diagnostics,
    "Candidate ChangeSet does not satisfy deterministic structural validation"
  );
  if (
    !changeSetValidation.valid ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return {
      validation: { okfValid: false, citationsValid: false, linksValid: false },
      diagnostics,
    };
  }

  validateCandidateRelationships(input, diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      validation: { okfValid: false, citationsValid: false, linksValid: false },
      diagnostics,
    };
  }

  const citationsValid = validateCitations(input.artifacts, proposed.citations, diagnostics);
  const generated = validateGeneratedDocuments(
    input.bundle.wikiRoot,
    proposed.changes,
    proposed.citations,
    diagnostics
  );
  return {
    validation: {
      okfValid: generated.okfValid,
      citationsValid,
      linksValid: generated.linksValid,
    },
    diagnostics,
  };
}

/**
 * Deterministic first-generation production validator for generated Wiki candidates.
 *
 * The adapter performs no Vault I/O. It snapshots the complete Compiler input,
 * revalidates ChangeSet structure, resolves citations only against parser-owned
 * artifacts, parses generated Markdown into OKF documents, and rejects every
 * link until a projected link resolver is available.
 */
export class KnowledgeProductionCandidateValidator implements CompilerCandidateValidator {
  /** Freezes this stateless validation capability against instance mutation. */
  constructor() {
    Object.freeze(this);
  }

  /**
   * Validates one generated candidate without exposing parser or YAML failures.
   *
   * @param input - Compiler-owned candidate and complete semantic read context
   * @param _signal - Exact Queue signal, checked by the generation-owned route wrapper
   * @returns Exact validation flags and bounded safe diagnostics
   */
  async validate(
    input: CompilerCandidateValidationInput,
    _signal: AbortSignal
  ): Promise<CompilerCandidateValidationResult> {
    try {
      const snapshot = snapshotData(input, { nodes: 0, characters: 0 });
      const parsed = candidateInputSchema.safeParse(snapshot);
      if (!parsed.success) {
        return createInvalidResult(
          "production_candidate_input_invalid",
          "input",
          "Candidate validation input does not satisfy the strict production contract"
        );
      }
      return validateCandidate(parsed.data);
    } catch {
      return createInvalidResult(
        "production_candidate_input_unavailable",
        "input",
        "Candidate validation input could not be safely inspected"
      );
    }
  }
}

Object.freeze(KnowledgeProductionCandidateValidator.prototype);
Object.freeze(KnowledgeProductionCandidateValidator);
