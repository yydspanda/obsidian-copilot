import { z } from "zod";

import {
  deriveKnowledgeSourceCompileAuthority,
  type KnowledgeSourceCompileOperation,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  projectKnowledgeEffectiveManifestPages,
  type KnowledgeEffectiveManifestPage,
} from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { parseKnowledgeChangeSet, parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  GeneratedPageReference,
  GeneratedPageOwnership,
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeParseResult,
  KnowledgeValidationResult,
  SourceManifest,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateSourceManifest,
  validateVaultRelativePath,
} from "@/knowledge/model/validation";
import {
  findWindowsPathCollisions,
  isPathWithinRoot,
  toWindowsPathKey,
} from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of the durable Manifest commit plan. */
export const MANIFEST_COMMIT_PLAN_VERSION = 1 as const;

/** Current strict version of the final Manifest commit intent. */
export const MANIFEST_COMMIT_INTENT_VERSION = 1 as const;

/** One complete, content-addressed page in a source's Manifest projection. */
export interface ManifestCommitPage {
  path: string;
  ownership: GeneratedPageOwnership;
  contentHash: string;
}

/** Runtime-resolved Manifest effect owned by one proposal change. */
export interface ManifestCommitMutation {
  changeId: string;
  path: string;
  operation: KnowledgeFileChange["operation"];
  access: "authorized" | "create_only";
  ownership: GeneratedPageOwnership;
  wasTrackedByPrimarySource: boolean;
  /** Effective CAS head when it differs from the source-applied base page. */
  expectedContentHash?: string;
}

/** Fields shared by every source-backed proposal-time Manifest plan. */
interface ManifestCommitPlanBase {
  version: typeof MANIFEST_COMMIT_PLAN_VERSION;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSetId: string;
  expectedManifestRevision: number;
  expectedManifestDigest: string;
  baseGeneratedPages: ManifestCommitPage[];
  mutations: ManifestCommitMutation[];
}

/** Legacy-compatible ordinary ingest plan with unchanged serialized identity. */
export interface SourceCompileManifestCommitPlan extends ManifestCommitPlanBase {
  kind: "source_compile";
}

/** Managed query-capture plan bound to its exact strict origin extension. */
export interface QueryWritebackManifestCommitPlan extends ManifestCommitPlanBase {
  kind: "query_writeback_source_compile";
  sourceOriginDigest: string;
}

/** Durable proposal-time material needed to derive a reviewed final intent. */
export type ManifestCommitPlan = SourceCompileManifestCommitPlan | QueryWritebackManifestCommitPlan;

/** Fields shared by every complete post-commit Manifest intent. */
interface ManifestCommitIntentBase {
  version: typeof MANIFEST_COMMIT_INTENT_VERSION;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  manifestCommitPlanDigest: string;
  changeSetId: string;
  expectedManifestRevision: number;
  expectedManifestDigest: string;
  generatedPages: ManifestCommitPage[];
}

/** Legacy-compatible final intent for an ordinary ingest source compile. */
export interface SourceCompileManifestCommitIntent extends ManifestCommitIntentBase {
  kind: "source_compile";
}

/** Final intent for a managed query capture with immutable origin binding. */
export interface QueryWritebackManifestCommitIntent extends ManifestCommitIntentBase {
  kind: "query_writeback_source_compile";
  sourceOriginDigest: string;
}

/** Complete post-commit Manifest state for one accepted source compile. */
export type ManifestCommitIntent =
  | SourceCompileManifestCommitIntent
  | QueryWritebackManifestCommitIntent;

/** Input used to construct one proposal-time Manifest commit plan. */
export interface CreateManifestCommitPlanInput {
  bundle: KnowledgeBundleConfig;
  manifest: SourceManifest;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSet: KnowledgeChangeSet;
  mutations: readonly ManifestCommitMutation[];
}

const MAX_SCHEMA_DIAGNOSTICS = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(SHA256_PATTERN);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();

const manifestCommitPageSchema: z.ZodType<ManifestCommitPage> = z
  .object({
    path: nonEmptyStringSchema,
    ownership: z.enum(["generated", "shared", "user"]),
    contentHash: sha256Schema,
  })
  .strict();

const manifestCommitMutationSchema: z.ZodType<ManifestCommitMutation> = z
  .object({
    changeId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    operation: z.enum(["create", "update", "delete"]),
    access: z.enum(["authorized", "create_only"]),
    ownership: z.enum(["generated", "shared", "user"]),
    wasTrackedByPrimarySource: z.boolean(),
    expectedContentHash: sha256Schema.optional(),
  })
  .strict();

const manifestCommitPlanBaseShape = {
  version: z.literal(MANIFEST_COMMIT_PLAN_VERSION),
  bundleId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceContentHash: sha256Schema,
  pipelineFingerprint: sha256Schema,
  inputRevision: nonNegativeIntegerSchema,
  changeSetId: nonEmptyStringSchema,
  expectedManifestRevision: nonNegativeIntegerSchema,
  expectedManifestDigest: sha256Schema,
  baseGeneratedPages: z.array(manifestCommitPageSchema),
  mutations: z.array(manifestCommitMutationSchema).min(1),
} as const;

/** Strict composable Zod schema for a persisted Manifest commit plan. */
export const manifestCommitPlanSchema: z.ZodType<ManifestCommitPlan> = z.union([
  z
    .object({
      ...manifestCommitPlanBaseShape,
      kind: z.literal("source_compile"),
    })
    .strict(),
  z
    .object({
      ...manifestCommitPlanBaseShape,
      kind: z.literal("query_writeback_source_compile"),
      sourceOriginDigest: sha256Schema,
    })
    .strict(),
]);

const manifestCommitIntentBaseShape = {
  version: z.literal(MANIFEST_COMMIT_INTENT_VERSION),
  bundleId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceContentHash: sha256Schema,
  pipelineFingerprint: sha256Schema,
  inputRevision: nonNegativeIntegerSchema,
  manifestCommitPlanDigest: sha256Schema,
  changeSetId: nonEmptyStringSchema,
  expectedManifestRevision: nonNegativeIntegerSchema,
  expectedManifestDigest: sha256Schema,
  generatedPages: z.array(manifestCommitPageSchema).min(1),
} as const;

/** Strict composable Zod schema for a persisted final Manifest commit intent. */
export const manifestCommitIntentSchema: z.ZodType<ManifestCommitIntent> = z.union([
  z
    .object({
      ...manifestCommitIntentBaseShape,
      kind: z.literal("source_compile"),
    })
    .strict(),
  z
    .object({
      ...manifestCommitIntentBaseShape,
      kind: z.literal("query_writeback_source_compile"),
      sourceOriginDigest: sha256Schema,
    })
    .strict(),
]);

/** Derives the authorized compiler operation from one exact plan variant. */
export function getManifestCommitPlanOperation(
  plan: ManifestCommitPlan
): KnowledgeSourceCompileOperation {
  return plan.kind === "query_writeback_source_compile" ? "query_writeback" : "ingest";
}

/** Derives the authorized compiler operation from one exact intent variant. */
export function getManifestCommitIntentOperation(
  intent: ManifestCommitIntent
): KnowledgeSourceCompileOperation {
  return intent.kind === "query_writeback_source_compile" ? "query_writeback" : "ingest";
}

/** Reports a contract value that cannot be safely projected or committed. */
export class ManifestCommitValidationError extends Error {
  /**
   * Creates a sanitized Manifest commit validation failure.
   *
   * @param diagnostics - Stable structural or semantic diagnostics
   */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Manifest commit material does not satisfy the strict domain contract");
    this.name = "ManifestCommitValidationError";
  }
}

/**
 * Appends one deterministic error diagnostic.
 *
 * @param diagnostics - Mutable diagnostic collection
 * @param code - Stable machine-readable error code
 * @param field - Field associated with the error
 * @param message - Safe human-readable description
 */
function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

/**
 * Creates one aggregate validation result.
 *
 * @param diagnostics - Collected deterministic diagnostics
 * @returns Result whose valid flag rejects every error
 */
function toValidationResult(diagnostics: KnowledgeDiagnostic[]): KnowledgeValidationResult {
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
  };
}

/**
 * Adds a field prefix to nested diagnostics.
 *
 * @param diagnostics - Nested diagnostics to copy
 * @param prefix - Parent field path
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
 * Converts one Zod path to stable dotted notation.
 *
 * @param path - Structural issue path
 * @returns Dotted field path
 */
function formatIssuePath(path: (string | number)[]): string {
  return path.map(String).join(".");
}

/**
 * Maps bounded Zod issues to the public knowledge diagnostic contract.
 *
 * @param error - Strict schema failure
 * @returns Safe structural diagnostics
 */
function mapSchemaIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.slice(0, MAX_SCHEMA_DIAGNOSTICS).map((issue) => ({
    code: `schema_${issue.code}`,
    severity: "error" as const,
    field: formatIssuePath(issue.path),
    message:
      issue.code === "unrecognized_keys"
        ? "Object contains unsupported fields"
        : "Object does not satisfy the strict Manifest commit contract",
  }));
}

/**
 * Compares text without locale-dependent collation.
 *
 * @param left - First text value
 * @param right - Second text value
 * @returns Standard comparator result
 */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Compares Vault paths by Windows identity and exact spelling.
 *
 * @param left - First Vault-relative path
 * @param right - Second Vault-relative path
 * @returns Standard comparator result
 */
function compareVaultPaths(left: string, right: string): number {
  const keyComparison = compareText(toWindowsPathKey(left), toWindowsPathKey(right));
  return keyComparison === 0 ? compareText(left, right) : keyComparison;
}

/**
 * Sorts and detaches complete page references.
 *
 * @param pages - Pages whose semantic order is path-based
 * @returns Canonically sorted detached pages
 */
function normalizePages(pages: readonly ManifestCommitPage[]): ManifestCommitPage[] {
  return pages
    .map((page) => ({ ...page }))
    .sort((left, right) => compareVaultPaths(left.path, right.path));
}

/**
 * Sorts and detaches proposal mutation authority.
 *
 * @param mutations - Resolved mutations to normalize
 * @returns Canonically sorted detached mutations
 */
function normalizeMutations(
  mutations: readonly ManifestCommitMutation[]
): ManifestCommitMutation[] {
  return mutations
    .map((mutation) => {
      const { expectedContentHash, ...required } = mutation;
      return {
        ...required,
        ...(expectedContentHash === undefined ? {} : { expectedContentHash }),
      };
    })
    .sort((left, right) => {
      const pathComparison = compareVaultPaths(left.path, right.path);
      return pathComparison === 0 ? compareText(left.changeId, right.changeId) : pathComparison;
    });
}

/** One Manifest page together with the source entry that tracks it. */
interface TrackedManifestPage {
  sourceId: string;
  page: GeneratedPageReference;
}

/**
 * Indexes every generated-page reference by its Windows filesystem identity.
 *
 * @param manifest - Exact complete Source Manifest read-set
 * @returns Page-key index retaining every source owner
 */
function collectTrackedManifestPages(manifest: SourceManifest): Map<string, TrackedManifestPage[]> {
  const byKey = new Map<string, TrackedManifestPage[]>();
  manifest.entries.forEach((entry) => {
    entry.lastSuccessful?.generatedPages.forEach((page) => {
      const key = toWindowsPathKey(page.path);
      const tracked = byKey.get(key) ?? [];
      tracked.push({ sourceId: entry.sourceId, page });
      byKey.set(key, tracked);
    });
  });
  return byKey;
}

/**
 * Projects effective pages owned by one source into a Windows-keyed authority map.
 *
 * @param manifest - Exact current Manifest including any active forward overlay
 * @param sourceId - Primary source whose mutations are being authorized
 * @param diagnostics - Mutable deterministic diagnostics
 * @param field - Sanitized diagnostic field for projection failures
 * @returns Effective pages owned by the source, or an empty map on failure
 */
function collectEffectiveSourcePages(
  manifest: SourceManifest,
  sourceId: string,
  diagnostics: KnowledgeDiagnostic[],
  field: string
): ReadonlyMap<string, Readonly<KnowledgeEffectiveManifestPage>> {
  try {
    return new Map(
      projectKnowledgeEffectiveManifestPages(manifest)
        .filter((page) => page.sourceIds.includes(sourceId))
        .map((page) => [page.windowsPathKey, page])
    );
  } catch {
    addError(
      diagnostics,
      "manifest_commit_effective_pages_invalid",
      field,
      "Manifest page authority or active forward-revision lineage is invalid"
    );
    return new Map();
  }
}

/**
 * Returns the exact existing-file hash authorized by one planned mutation.
 *
 * An absent per-mutation override preserves the legacy source-applied CAS
 * meaning, so existing v1 plans keep their byte identity and semantics.
 *
 * @param mutation - Strict planned mutation
 * @param baseByKey - Source-applied base pages keyed by Windows identity
 * @returns Effective override or source-applied base hash
 */
function getMutationExpectedContentHash(
  mutation: ManifestCommitMutation,
  baseByKey: ReadonlyMap<string, ManifestCommitPage>
): string | undefined {
  return (
    mutation.expectedContentHash ?? baseByKey.get(toWindowsPathKey(mutation.path))?.contentHash
  );
}

/**
 * Requires every source tracking one shared target to agree on its authority.
 *
 * @param tracked - Every Manifest reference with the same Windows path key
 * @param primaryPage - Primary source page used as the canonical authority
 * @param field - Diagnostic field for the target mutation
 * @param diagnostics - Mutable deterministic diagnostics
 */
function validateCoOwnedPageAuthority(
  tracked: readonly TrackedManifestPage[],
  primaryPage: ManifestCommitPage,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  if (tracked.length > 1 && primaryPage.ownership !== "shared") {
    addError(
      diagnostics,
      "manifest_commit_coowner_ownership_invalid",
      field,
      "A page tracked by multiple sources must use shared ownership"
    );
  }
  tracked.forEach(({ page }, index) => {
    if (
      page.path !== primaryPage.path ||
      page.ownership !== primaryPage.ownership ||
      page.contentHash !== primaryPage.contentHash
    ) {
      addError(
        diagnostics,
        "manifest_commit_coowner_page_mismatch",
        `${field}.trackedPages[${index}]`,
        "Every source tracking one page must agree on path spelling, ownership, and content hash"
      );
    }
  });
}

/**
 * Requires file-change provenance to retain every Manifest source tracking its target.
 *
 * Additional cited sources remain allowed because sourceRefs also carries evidence
 * provenance, not only page ownership.
 *
 * @param sourceRefs - Runtime-owned ChangeSet source provenance
 * @param tracked - Every Manifest reference for the target path
 * @param field - Diagnostic field for source provenance
 * @param diagnostics - Mutable deterministic diagnostics
 */
function validateTrackedSourceCoverage(
  sourceRefs: readonly string[],
  tracked: readonly TrackedManifestPage[],
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  const sourceRefSet = new Set(sourceRefs);
  const missing = [...new Set(tracked.map(({ sourceId }) => sourceId))].filter(
    (sourceId) => !sourceRefSet.has(sourceId)
  );
  if (missing.length > 0) {
    addError(
      diagnostics,
      "manifest_commit_coowner_source_missing",
      field,
      "Change provenance must retain every source that tracks the target page"
    );
  }
}

/**
 * Checks whether two valid Vault paths are equal or ancestor/descendant.
 *
 * @param left - First path
 * @param right - Second path
 * @returns Whether either path contains the other
 */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/**
 * Checks whether a Vault path targets a Markdown file.
 *
 * @param path - Canonical Vault-relative path
 * @returns Whether the final extension is Markdown under case-insensitive comparison
 */
function isMarkdownPath(path: string): boolean {
  return path.toLocaleLowerCase("en-US").endsWith(".md");
}

/**
 * Validates one page or mutation path, optionally against a Bundle boundary.
 *
 * @param path - Candidate Vault-relative path
 * @param field - Diagnostic field
 * @param bundle - Optional exact Bundle boundary
 * @param diagnostics - Mutable diagnostic collection
 */
function validateCommitPath(
  path: string,
  field: string,
  bundle: KnowledgeBundleConfig | undefined,
  diagnostics: KnowledgeDiagnostic[]
): void {
  diagnostics.push(...prefixDiagnostics(validateVaultRelativePath(path, "").diagnostics, field));
  if (!isMarkdownPath(path)) {
    addError(
      diagnostics,
      "manifest_commit_path_not_markdown",
      field,
      "Manifest commit pages must use the .md extension"
    );
  }
  if (!bundle) {
    return;
  }
  if (!isPathWithinRoot(path, bundle.wikiRoot)) {
    addError(
      diagnostics,
      "manifest_commit_path_outside_wiki",
      field,
      "Manifest commit pages must remain inside the generated Wiki root"
    );
  }
  if (toWindowsPathKey(path) === toWindowsPathKey(bundle.wikiRoot)) {
    addError(
      diagnostics,
      "manifest_commit_path_equals_wiki_root",
      field,
      "Manifest commit pages must be strict descendants of the Wiki root"
    );
  }
  if (bundle.sourceRoots.some((root) => isPathWithinRoot(path, root))) {
    addError(
      diagnostics,
      "manifest_commit_path_inside_source",
      field,
      "Manifest commit pages cannot target a raw source root"
    );
  }
  if (toWindowsPathKey(path) === toWindowsPathKey(bundle.schemaRef)) {
    addError(
      diagnostics,
      "manifest_commit_path_is_schema",
      field,
      "Manifest commit pages cannot target the Bundle schema"
    );
  }
}

/**
 * Validates a complete page projection, including canonical Windows ordering.
 *
 * @param pages - Complete page projection
 * @param field - Parent diagnostic field
 * @param bundle - Optional Bundle boundary
 * @param allowEmpty - Whether an empty pre-compile projection is allowed
 * @returns Deterministic semantic diagnostics
 */
function validatePageProjection(
  pages: readonly ManifestCommitPage[],
  field: string,
  bundle: KnowledgeBundleConfig | undefined,
  allowEmpty: boolean
): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (!allowEmpty && pages.length === 0) {
    addError(
      diagnostics,
      "manifest_commit_pages_empty",
      field,
      "A successful source compile must retain at least one generated page"
    );
  }
  pages.forEach((page, index) => {
    validateCommitPath(page.path, `${field}[${index}].path`, bundle, diagnostics);
  });

  const collisions = findWindowsPathCollisions(pages.map((page) => page.path));
  collisions.forEach((collision) => {
    addError(
      diagnostics,
      "manifest_commit_page_windows_collision",
      field,
      `Manifest commit pages collide at Windows path '${collision.key}'`
    );
  });
  for (let leftIndex = 0; leftIndex < pages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < pages.length; rightIndex += 1) {
      const left = pages[leftIndex];
      const right = pages[rightIndex];
      if (
        toWindowsPathKey(left.path) !== toWindowsPathKey(right.path) &&
        pathsOverlap(left.path, right.path)
      ) {
        addError(
          diagnostics,
          "manifest_commit_page_path_overlap",
          `${field}[${rightIndex}].path`,
          "Manifest commit pages cannot target both an ancestor and its descendant"
        );
      }
    }
  }

  const normalized = normalizePages(pages);
  if (
    normalized.some(
      (page, index) =>
        page.path !== pages[index]?.path ||
        page.ownership !== pages[index]?.ownership ||
        page.contentHash !== pages[index]?.contentHash
    )
  ) {
    addError(
      diagnostics,
      "manifest_commit_pages_not_canonical",
      field,
      "Manifest commit pages must use canonical Windows path order"
    );
  }
  return diagnostics;
}

/**
 * Validates mutation identities and their relationship to the primary base projection.
 *
 * @param plan - Strict parsed commit plan
 * @param bundle - Optional Bundle boundary
 * @returns Deterministic semantic diagnostics
 */
function validatePlanMutations(
  plan: ManifestCommitPlan,
  bundle?: KnowledgeBundleConfig
): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  const baseByKey = new Map(
    plan.baseGeneratedPages.map((page) => [toWindowsPathKey(page.path), page])
  );
  const changeIds = new Set<string>();
  const mutationKeys = new Set<string>();
  plan.mutations.forEach((mutation, index) => {
    const field = `mutations[${index}]`;
    validateCommitPath(mutation.path, `${field}.path`, bundle, diagnostics);
    if (changeIds.has(mutation.changeId)) {
      addError(
        diagnostics,
        "manifest_commit_mutation_change_duplicate",
        `${field}.changeId`,
        "Manifest commit mutation change ids must be unique"
      );
    }
    changeIds.add(mutation.changeId);
    const key = toWindowsPathKey(mutation.path);
    if (mutationKeys.has(key)) {
      addError(
        diagnostics,
        "manifest_commit_mutation_path_duplicate",
        `${field}.path`,
        "Manifest commit mutations must target unique Windows paths"
      );
    }
    mutationKeys.add(key);

    const basePage = baseByKey.get(key);
    if (mutation.wasTrackedByPrimarySource !== (basePage !== undefined)) {
      addError(
        diagnostics,
        "manifest_commit_mutation_tracking_mismatch",
        `${field}.wasTrackedByPrimarySource`,
        "Mutation tracking must match the primary source's exact base projection"
      );
    }
    if (mutation.wasTrackedByPrimarySource && mutation.access !== "authorized") {
      addError(
        diagnostics,
        "manifest_commit_tracked_authority_missing",
        `${field}.access`,
        "A Manifest-tracked target requires explicit caller-owned authorization"
      );
    }
    if (!mutation.wasTrackedByPrimarySource && mutation.access !== "create_only") {
      addError(
        diagnostics,
        "manifest_commit_untracked_authority_invalid",
        `${field}.access`,
        "An untracked target may use only create-only authority"
      );
    }
    if (basePage && basePage.ownership !== mutation.ownership) {
      addError(
        diagnostics,
        "manifest_commit_mutation_ownership_mismatch",
        `${field}.ownership`,
        "Existing mutations must preserve Manifest page ownership"
      );
    }
    if (
      mutation.expectedContentHash !== undefined &&
      (!basePage ||
        mutation.operation === "create" ||
        mutation.expectedContentHash === basePage.contentHash)
    ) {
      addError(
        diagnostics,
        "manifest_commit_mutation_effective_hash_invalid",
        `${field}.expectedContentHash`,
        "A distinct effective CAS hash is valid only for an existing tracked mutation"
      );
    }
    if (
      (mutation.operation === "update" || mutation.operation === "delete") &&
      !mutation.wasTrackedByPrimarySource
    ) {
      addError(
        diagnostics,
        "manifest_commit_existing_not_primary_tracked",
        `${field}.wasTrackedByPrimarySource`,
        "Existing updates and deletes require a page tracked by the primary source"
      );
    }
    if (
      mutation.operation === "create" &&
      !mutation.wasTrackedByPrimarySource &&
      mutation.ownership !== "generated"
    ) {
      addError(
        diagnostics,
        "manifest_commit_new_ownership_invalid",
        `${field}.ownership`,
        "A newly created page must become generated ownership"
      );
    }
    if (mutation.operation === "delete" && mutation.ownership !== "generated") {
      addError(
        diagnostics,
        "manifest_commit_delete_ownership_invalid",
        `${field}.ownership`,
        "Only generated pages may be deleted by a source compile"
      );
    }
  });

  const normalized = normalizeMutations(plan.mutations);
  if (
    normalized.some(
      (mutation, index) =>
        mutation.changeId !== plan.mutations[index]?.changeId ||
        mutation.path !== plan.mutations[index]?.path ||
        mutation.operation !== plan.mutations[index]?.operation ||
        mutation.access !== plan.mutations[index]?.access ||
        mutation.ownership !== plan.mutations[index]?.ownership ||
        mutation.wasTrackedByPrimarySource !== plan.mutations[index]?.wasTrackedByPrimarySource ||
        mutation.expectedContentHash !== plan.mutations[index]?.expectedContentHash
    )
  ) {
    addError(
      diagnostics,
      "manifest_commit_mutations_not_canonical",
      "mutations",
      "Manifest commit mutations must use canonical Windows path order"
    );
  }
  return diagnostics;
}

/**
 * Parses one ChangeSet and appends safe structural and semantic diagnostics.
 *
 * @param value - Runtime ChangeSet value
 * @param bundle - Optional Bundle boundary
 * @returns Parsed ChangeSet plus diagnostics when available
 */
function inspectChangeSet(
  value: unknown,
  bundle?: KnowledgeBundleConfig
): { changeSet?: KnowledgeChangeSet; diagnostics: KnowledgeDiagnostic[] } {
  const parsed = parseKnowledgeChangeSet(value);
  if (!parsed.ok) {
    return { diagnostics: prefixDiagnostics(parsed.issues, "changeSet") };
  }
  return {
    changeSet: parsed.value,
    diagnostics: prefixDiagnostics(
      validateKnowledgeChangeSet(parsed.value, bundle).diagnostics,
      "changeSet"
    ),
  };
}

/**
 * Compares complete page projections field by field.
 *
 * @param left - First canonical projection
 * @param right - Second canonical projection
 * @returns Whether both projections are exactly equal
 */
function samePages(
  left: readonly ManifestCommitPage[],
  right: readonly ManifestCommitPage[]
): boolean {
  return (
    left.length === right.length &&
    left.every((page, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        page.path === other.path &&
        page.ownership === other.ownership &&
        page.contentHash === other.contentHash
      );
    })
  );
}

/**
 * Throws one typed failure when deterministic validation found an error.
 *
 * @param result - Validation result to require
 */
function requireValid(result: KnowledgeValidationResult): void {
  if (!result.valid) {
    throw new ManifestCommitValidationError(result.diagnostics);
  }
}

/**
 * Strictly parses unknown persisted Manifest commit plan JSON.
 *
 * @param value - Runtime value expected to contain a complete plan
 * @returns Parsed detached plan or bounded structural diagnostics
 */
export function parseManifestCommitPlan(value: unknown): KnowledgeParseResult<ManifestCommitPlan> {
  const parsed = manifestCommitPlanSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: mapSchemaIssues(parsed.error) };
}

/**
 * Strictly parses unknown persisted final Manifest commit intent JSON.
 *
 * @param value - Runtime value expected to contain a complete intent
 * @returns Parsed detached intent or bounded structural diagnostics
 */
export function parseManifestCommitIntent(
  value: unknown
): KnowledgeParseResult<ManifestCommitIntent> {
  const parsed = manifestCommitIntentSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: mapSchemaIssues(parsed.error) };
}

/**
 * Validates a Manifest commit plan independently of any provider or persistence adapter.
 *
 * Passing a Bundle adds exact write-boundary validation. Omitting it remains
 * suitable for Review Store validation because every intrinsic path, collision,
 * canonical ordering, tracking, and ownership invariant is still enforced.
 *
 * @param value - Runtime plan value
 * @param bundle - Optional exact Bundle boundary
 * @returns Deterministic structural and semantic validation result
 */
export function validateManifestCommitPlan(
  value: unknown,
  bundle?: KnowledgeBundleConfig
): KnowledgeValidationResult {
  const parsed = parseManifestCommitPlan(value);
  if (!parsed.ok) {
    return toValidationResult(parsed.issues);
  }
  const plan = parsed.value;
  const diagnostics = [
    ...validatePageProjection(plan.baseGeneratedPages, "baseGeneratedPages", bundle, true),
    ...validatePlanMutations(plan, bundle),
  ];
  if (bundle) {
    diagnostics.push(
      ...prefixDiagnostics(validateKnowledgeBundleConfig(bundle).diagnostics, "bundle")
    );
    if (plan.bundleId !== bundle.id) {
      addError(
        diagnostics,
        "manifest_commit_bundle_mismatch",
        "bundleId",
        "Manifest commit plan must belong to the selected Bundle"
      );
    }
  }
  if (plan.expectedManifestRevision >= Number.MAX_SAFE_INTEGER) {
    addError(
      diagnostics,
      "manifest_commit_revision_exhausted",
      "expectedManifestRevision",
      "Manifest revision cannot advance without safe-integer precision loss"
    );
  }
  return toValidationResult(diagnostics);
}

/**
 * Validates a complete final Manifest commit intent.
 *
 * @param value - Runtime intent value
 * @param bundle - Optional exact Bundle boundary
 * @returns Deterministic structural and semantic validation result
 */
export function validateManifestCommitIntent(
  value: unknown,
  bundle?: KnowledgeBundleConfig
): KnowledgeValidationResult {
  const parsed = parseManifestCommitIntent(value);
  if (!parsed.ok) {
    return toValidationResult(parsed.issues);
  }
  const intent = parsed.value;
  const diagnostics = validatePageProjection(
    intent.generatedPages,
    "generatedPages",
    bundle,
    false
  );
  if (bundle) {
    diagnostics.push(
      ...prefixDiagnostics(validateKnowledgeBundleConfig(bundle).diagnostics, "bundle")
    );
    if (intent.bundleId !== bundle.id) {
      addError(
        diagnostics,
        "manifest_commit_bundle_mismatch",
        "bundleId",
        "Manifest commit intent must belong to the selected Bundle"
      );
    }
  }
  if (intent.expectedManifestRevision >= Number.MAX_SAFE_INTEGER) {
    addError(
      diagnostics,
      "manifest_commit_revision_exhausted",
      "expectedManifestRevision",
      "Manifest revision cannot advance without safe-integer precision loss"
    );
  }
  return toValidationResult(diagnostics);
}

/**
 * Computes the canonical digest of one exact validated Source Manifest.
 *
 * Array order remains part of the persisted Manifest identity. Callers must use
 * this shared helper both when constructing and when committing an intent.
 *
 * @param value - Exact persisted Source Manifest
 * @returns Domain-separated lowercase SHA-256 digest
 */
export function createSourceManifestDigest(value: SourceManifest): string {
  const parsed = parseSourceManifest(value);
  if (!parsed.ok) {
    throw new ManifestCommitValidationError(parsed.issues);
  }
  const semantic = validateSourceManifest(parsed.value);
  requireValid(semantic);
  return sha256(
    `knowledge-source-manifest-v1\n${canonicalizeJson(parsed.value as unknown as JsonValue)}`
  );
}

/**
 * Computes the canonical identity of one strict Manifest commit plan.
 *
 * @param value - Complete proposal-time plan
 * @returns Domain-separated lowercase SHA-256 digest
 */
export function createManifestCommitPlanDigest(value: ManifestCommitPlan): string {
  const parsed = parseManifestCommitPlan(value);
  if (!parsed.ok) {
    throw new ManifestCommitValidationError(parsed.issues);
  }
  requireValid(validateManifestCommitPlan(parsed.value));
  return sha256(
    `knowledge-manifest-commit-plan-v1\n${canonicalizeJson(parsed.value as unknown as JsonValue)}`
  );
}

/**
 * Computes the canonical identity of one strict final Manifest commit intent.
 *
 * @param value - Complete final intent
 * @returns Domain-separated lowercase SHA-256 digest
 */
export function createManifestCommitIntentDigest(value: ManifestCommitIntent): string {
  const parsed = parseManifestCommitIntent(value);
  if (!parsed.ok) {
    throw new ManifestCommitValidationError(parsed.issues);
  }
  requireValid(validateManifestCommitIntent(parsed.value));
  return sha256(
    `knowledge-manifest-commit-intent-v1\n${canonicalizeJson(parsed.value as unknown as JsonValue)}`
  );
}

/**
 * Validates exact or accepted-subset ChangeSet coverage by one commit plan.
 *
 * @param plan - Strict parsed plan
 * @param changeSet - Strict parsed proposal or accepted payload
 * @param bundle - Optional exact Bundle boundary
 * @param requireExactCoverage - Whether every plan mutation must appear in the ChangeSet
 * @returns Deterministic semantic diagnostics
 */
function validatePlanChangeSetCoverage(
  plan: ManifestCommitPlan,
  changeSet: KnowledgeChangeSet,
  bundle: KnowledgeBundleConfig | undefined,
  requireExactCoverage: boolean
): KnowledgeValidationResult {
  const diagnostics = [...validateManifestCommitPlan(plan, bundle).diagnostics];
  const inspected = inspectChangeSet(changeSet, bundle);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.changeSet) {
    return toValidationResult(diagnostics);
  }
  const parsedChangeSet = inspected.changeSet;
  if (parsedChangeSet.bundleId !== plan.bundleId) {
    addError(
      diagnostics,
      "manifest_commit_changeset_bundle_mismatch",
      "changeSet.bundleId",
      "ChangeSet and Manifest commit plan must belong to the same Bundle"
    );
  }
  if (parsedChangeSet.id !== plan.changeSetId) {
    addError(
      diagnostics,
      "manifest_commit_changeset_id_mismatch",
      "changeSet.id",
      "ChangeSet id must match the Manifest commit plan"
    );
  }
  if (parsedChangeSet.operation !== getManifestCommitPlanOperation(plan)) {
    addError(
      diagnostics,
      "manifest_commit_operation_mismatch",
      "changeSet.operation",
      "ChangeSet operation must match the exact source compile plan"
    );
  }
  if (!parsedChangeSet.sourceRefs.includes(plan.sourceId)) {
    addError(
      diagnostics,
      "manifest_commit_primary_source_missing",
      "changeSet.sourceRefs",
      "ChangeSet provenance must include the primary source"
    );
  }

  const mutationsById = new Map(plan.mutations.map((mutation) => [mutation.changeId, mutation]));
  const baseByKey = new Map(
    plan.baseGeneratedPages.map((page) => [toWindowsPathKey(page.path), page])
  );
  const changeIds = new Set(parsedChangeSet.changes.map((change) => change.id));
  parsedChangeSet.changes.forEach((change, index) => {
    const mutation = mutationsById.get(change.id);
    if (!mutation) {
      addError(
        diagnostics,
        "manifest_commit_change_unknown",
        `changeSet.changes[${index}].id`,
        "ChangeSet change is absent from the immutable Manifest commit plan"
      );
      return;
    }
    if (change.path !== mutation.path) {
      addError(
        diagnostics,
        "manifest_commit_change_path_mismatch",
        `changeSet.changes[${index}].path`,
        "Accepted change path must match its planned canonical path"
      );
    }
    if (change.operation !== mutation.operation) {
      addError(
        diagnostics,
        "manifest_commit_change_operation_mismatch",
        `changeSet.changes[${index}].operation`,
        "Accepted change operation must match its planned operation"
      );
    }
    if (change.operation !== "create" && mutation.expectedContentHash !== undefined) {
      const expectedContentHash = getMutationExpectedContentHash(mutation, baseByKey);
      if (expectedContentHash === undefined || change.beforeHash !== expectedContentHash) {
        addError(
          diagnostics,
          change.operation === "delete"
            ? "manifest_commit_delete_hash_mismatch"
            : "manifest_commit_update_hash_mismatch",
          `changeSet.changes[${index}].beforeHash`,
          "Existing-file precondition must match its planned effective CAS hash"
        );
      }
    }
    if (!change.sourceRefs.includes(plan.sourceId)) {
      addError(
        diagnostics,
        "manifest_commit_change_primary_source_missing",
        `changeSet.changes[${index}].sourceRefs`,
        "Every Manifest mutation must retain the primary source provenance"
      );
    }
  });
  if (requireExactCoverage) {
    plan.mutations.forEach((mutation, index) => {
      if (!changeIds.has(mutation.changeId)) {
        addError(
          diagnostics,
          "manifest_commit_mutation_change_missing",
          `mutations[${index}].changeId`,
          "Every planned Manifest mutation must belong to the proposal ChangeSet"
        );
      }
    });
  }
  return toValidationResult(diagnostics);
}

/**
 * Validates that a plan exactly covers one proposal ChangeSet.
 *
 * @param plan - Proposal-time Manifest commit plan
 * @param changeSet - Exact proposal ChangeSet
 * @param bundle - Optional exact Bundle boundary
 * @returns Deterministic validation result
 */
export function validateManifestCommitPlanForChangeSet(
  plan: ManifestCommitPlan,
  changeSet: KnowledgeChangeSet,
  bundle?: KnowledgeBundleConfig
): KnowledgeValidationResult {
  return validatePlanChangeSetCoverage(plan, changeSet, bundle, true);
}

/**
 * Constructs a durable proposal-time plan from an exact Manifest read-set.
 *
 * Existing updates and deletes must already be tracked by the primary source.
 * A create outside the primary projection must be absent from every Manifest
 * source and resolves to generated ownership.
 *
 * @param input - Exact Bundle, Manifest, ChangeSet, source identity, and resolved mutations
 * @returns Detached canonical plan
 */
export function createManifestCommitPlan(input: CreateManifestCommitPlanInput): ManifestCommitPlan {
  const diagnostics = [
    ...prefixDiagnostics(validateKnowledgeBundleConfig(input.bundle).diagnostics, "bundle"),
  ];
  const parsedManifest = parseSourceManifest(input.manifest);
  if (!parsedManifest.ok) {
    throw new ManifestCommitValidationError([
      ...diagnostics,
      ...prefixDiagnostics(parsedManifest.issues, "manifest"),
    ]);
  }
  diagnostics.push(
    ...prefixDiagnostics(validateSourceManifest(parsedManifest.value).diagnostics, "manifest")
  );
  const inspectedChangeSet = inspectChangeSet(input.changeSet, input.bundle);
  diagnostics.push(...inspectedChangeSet.diagnostics);
  if (!inspectedChangeSet.changeSet || diagnostics.some((item) => item.severity === "error")) {
    throw new ManifestCommitValidationError(diagnostics);
  }

  const manifest = parsedManifest.value;
  const changeSet = inspectedChangeSet.changeSet;
  if (manifest.bundleId !== input.bundle.id) {
    addError(
      diagnostics,
      "manifest_commit_manifest_bundle_mismatch",
      "manifest.bundleId",
      "Source Manifest must belong to the selected Bundle"
    );
  }
  const source = manifest.entries.find((entry) => entry.sourceId === input.sourceId);
  if (!source) {
    addError(
      diagnostics,
      "manifest_commit_source_not_found",
      "sourceId",
      "Primary source is not registered in the exact Source Manifest"
    );
  }
  let sourceCompileAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority> = {
    operation: "ingest",
  };
  if (source) {
    try {
      sourceCompileAuthority = deriveKnowledgeSourceCompileAuthority(source);
    } catch {
      addError(
        diagnostics,
        "manifest_commit_source_origin_invalid",
        "manifest.entries.extensions",
        "Primary source origin does not authorize a source compile"
      );
    }
  }
  if (changeSet.operation !== sourceCompileAuthority.operation) {
    addError(
      diagnostics,
      "manifest_commit_operation_mismatch",
      "changeSet.operation",
      "ChangeSet operation must match the exact Manifest source origin"
    );
  }
  if (
    sourceCompileAuthority.operation === "query_writeback" &&
    input.sourceContentHash !== sourceCompileAuthority.expectedSourceContentHash
  ) {
    addError(
      diagnostics,
      "manifest_commit_source_capture_hash_mismatch",
      "sourceContentHash",
      "Managed query capture bytes must match their exact Manifest origin"
    );
  }

  const rawBasePages = source?.lastSuccessful?.generatedPages ?? [];
  rawBasePages.forEach((page, index) => {
    if (page.contentHash === undefined) {
      addError(
        diagnostics,
        "manifest_commit_base_hash_missing",
        `manifest.entries.lastSuccessful.generatedPages[${index}].contentHash`,
        "Every base page requires a last-generated content hash"
      );
    }
  });
  const baseGeneratedPages = normalizePages(
    rawBasePages
      .filter((page): page is ManifestCommitPage => page.contentHash !== undefined)
      .map((page) => ({ ...page, contentHash: page.contentHash }))
  );
  const baseByKey = new Map(baseGeneratedPages.map((page) => [toWindowsPathKey(page.path), page]));
  const effectiveByKey = collectEffectiveSourcePages(
    manifest,
    input.sourceId,
    diagnostics,
    "manifest.extensions"
  );
  const mutations = normalizeMutations(input.mutations).map((mutation, index) => {
    const required: ManifestCommitMutation = {
      changeId: mutation.changeId,
      path: mutation.path,
      operation: mutation.operation,
      access: mutation.access,
      ownership: mutation.ownership,
      wasTrackedByPrimarySource: mutation.wasTrackedByPrimarySource,
    };
    const key = toWindowsPathKey(mutation.path);
    const basePage = baseByKey.get(key);
    const effectivePage = effectiveByKey.get(key);
    if (basePage && !effectivePage) {
      addError(
        diagnostics,
        "manifest_commit_effective_page_missing",
        `mutations[${index}].path`,
        "Tracked mutation is absent from the effective Manifest page projection"
      );
    }
    if (basePage && effectivePage && effectivePage.effectiveContentHash !== basePage.contentHash) {
      if (mutation.operation === "create") {
        addError(
          diagnostics,
          "manifest_commit_overlay_create_invalid",
          `mutations[${index}].operation`,
          "An active forward-revision page requires an existing-file CAS mutation"
        );
        return required;
      }
      return {
        ...required,
        expectedContentHash: effectivePage.effectiveContentHash,
      };
    }
    return required;
  });
  const trackedPagesByKey = collectTrackedManifestPages(manifest);
  const changesById = new Map(changeSet.changes.map((change) => [change.id, change]));
  mutations.forEach((mutation, index) => {
    const key = toWindowsPathKey(mutation.path);
    const basePage = baseByKey.get(key);
    const trackedPages = trackedPagesByKey.get(key) ?? [];
    const change = changesById.get(mutation.changeId);
    if (mutation.wasTrackedByPrimarySource !== (basePage !== undefined)) {
      addError(
        diagnostics,
        "manifest_commit_mutation_tracking_mismatch",
        `mutations[${index}].wasTrackedByPrimarySource`,
        "Resolved mutation tracking does not match the exact Source Manifest"
      );
    }
    if (basePage && basePage.ownership !== mutation.ownership) {
      addError(
        diagnostics,
        "manifest_commit_mutation_ownership_mismatch",
        `mutations[${index}].ownership`,
        "Resolved mutation ownership does not match the exact Source Manifest"
      );
    }
    if (basePage) {
      validateCoOwnedPageAuthority(trackedPages, basePage, `mutations[${index}].path`, diagnostics);
      if (change) {
        validateTrackedSourceCoverage(
          change.sourceRefs,
          trackedPages,
          `changeSet.changes.${mutation.changeId}.sourceRefs`,
          diagnostics
        );
      }
    }
    if (!basePage && mutation.operation !== "create") {
      addError(
        diagnostics,
        "manifest_commit_existing_not_primary_tracked",
        `mutations[${index}].path`,
        "Existing updates and deletes require primary-source Manifest tracking"
      );
    }
    if (!basePage && mutation.operation === "create") {
      if (trackedPages.length > 0) {
        addError(
          diagnostics,
          "manifest_commit_cross_source_existing_page",
          `mutations[${index}].path`,
          "A new create cannot claim a page already tracked by another source"
        );
      }
      if (mutation.ownership !== "generated") {
        addError(
          diagnostics,
          "manifest_commit_new_ownership_invalid",
          `mutations[${index}].ownership`,
          "A newly created page must resolve to generated ownership"
        );
      }
    }
    if (mutation.operation === "delete") {
      const existingSources = new Set(trackedPages.map(({ sourceId }) => sourceId));
      if (
        mutation.ownership !== "generated" ||
        existingSources.size !== 1 ||
        !existingSources.has(input.sourceId)
      ) {
        addError(
          diagnostics,
          "manifest_commit_delete_not_sole_source",
          `mutations[${index}].path`,
          "Delete requires a generated page owned only by the primary source"
        );
      }
    }
  });

  const commonPlan: ManifestCommitPlanBase = {
    version: MANIFEST_COMMIT_PLAN_VERSION,
    bundleId: input.bundle.id,
    sourceId: input.sourceId,
    sourceContentHash: input.sourceContentHash,
    pipelineFingerprint: input.pipelineFingerprint,
    inputRevision: input.inputRevision,
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    baseGeneratedPages,
    mutations,
  };
  const plan: ManifestCommitPlan =
    sourceCompileAuthority.operation === "query_writeback"
      ? {
          ...commonPlan,
          kind: "query_writeback_source_compile",
          sourceOriginDigest: sourceCompileAuthority.sourceOriginDigest,
        }
      : { ...commonPlan, kind: "source_compile" };
  diagnostics.push(
    ...validateManifestCommitPlanForChangeSet(plan, changeSet, input.bundle).diagnostics
  );
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new ManifestCommitValidationError(diagnostics);
  }
  const parsedPlan = parseManifestCommitPlan(plan);
  if (!parsedPlan.ok) {
    throw new ManifestCommitValidationError(parsedPlan.issues);
  }
  return parsedPlan.value;
}

/**
 * Applies an accepted ChangeSet subset to one immutable proposal-time plan.
 *
 * Rewritten create/update content uses the accepted afterHash. Rejected plan
 * mutations leave the base projection untouched.
 *
 * @param plan - Durable exact proposal-time plan
 * @param acceptedChangeSet - Exact accepted ChangeSet after review
 * @returns Detached canonical final Manifest commit intent
 */
export function projectManifestCommitIntent(
  plan: ManifestCommitPlan,
  acceptedChangeSet: KnowledgeChangeSet
): ManifestCommitIntent {
  const coverage = validatePlanChangeSetCoverage(plan, acceptedChangeSet, undefined, false);
  const diagnostics = [...coverage.diagnostics];
  if (acceptedChangeSet.status !== "accepted") {
    addError(
      diagnostics,
      "manifest_commit_changeset_not_accepted",
      "changeSet.status",
      "Only an accepted ChangeSet may produce a final Manifest commit intent"
    );
  }
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new ManifestCommitValidationError(diagnostics);
  }

  const pagesByKey = new Map(
    plan.baseGeneratedPages.map((page) => [toWindowsPathKey(page.path), { ...page }])
  );
  const mutationsById = new Map(plan.mutations.map((mutation) => [mutation.changeId, mutation]));
  acceptedChangeSet.changes.forEach((change) => {
    const mutation = mutationsById.get(change.id)!;
    const key = toWindowsPathKey(change.path);
    const basePage = pagesByKey.get(key);
    const expectedContentHash = getMutationExpectedContentHash(mutation, pagesByKey);
    if (change.operation === "delete") {
      if (!basePage || change.beforeHash !== expectedContentHash) {
        addError(
          diagnostics,
          "manifest_commit_delete_hash_mismatch",
          change.path,
          "Delete precondition must match the plan's effective CAS hash"
        );
        return;
      }
      pagesByKey.delete(key);
      return;
    }
    if (change.operation === "update" && (!basePage || change.beforeHash !== expectedContentHash)) {
      addError(
        diagnostics,
        "manifest_commit_update_hash_mismatch",
        change.path,
        "Update precondition must match the plan's effective CAS hash"
      );
      return;
    }
    pagesByKey.set(key, {
      path: change.path,
      ownership: mutation.ownership,
      contentHash: change.afterHash,
    });
  });
  if (pagesByKey.size === 0) {
    addError(
      diagnostics,
      "manifest_commit_pages_empty",
      "generatedPages",
      "A successful source compile must retain at least one generated page"
    );
  }
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new ManifestCommitValidationError(diagnostics);
  }

  const commonIntent: ManifestCommitIntentBase = {
    version: MANIFEST_COMMIT_INTENT_VERSION,
    bundleId: plan.bundleId,
    sourceId: plan.sourceId,
    sourceContentHash: plan.sourceContentHash,
    pipelineFingerprint: plan.pipelineFingerprint,
    inputRevision: plan.inputRevision,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(plan),
    changeSetId: acceptedChangeSet.id,
    expectedManifestRevision: plan.expectedManifestRevision,
    expectedManifestDigest: plan.expectedManifestDigest,
    generatedPages: normalizePages([...pagesByKey.values()]),
  };
  const intent: ManifestCommitIntent =
    plan.kind === "query_writeback_source_compile"
      ? {
          ...commonIntent,
          kind: "query_writeback_source_compile",
          sourceOriginDigest: plan.sourceOriginDigest,
        }
      : { ...commonIntent, kind: "source_compile" };
  requireValid(validateManifestCommitIntent(intent));
  const parsed = parseManifestCommitIntent(intent);
  if (!parsed.ok) {
    throw new ManifestCommitValidationError(parsed.issues);
  }
  return parsed.value;
}

/**
 * Reconstructs final pages directly from an actual pre-commit Manifest.
 *
 * This journal/ledger helper intentionally does not trust a proposal plan.
 * Existing updates and deletes must be primary-source tracked, new creates must
 * be absent from every source, and ownership is derived exclusively from the
 * actual Manifest or the generated-new rule.
 *
 * @param intent - Final durable intent to verify
 * @param actualManifest - Actual Manifest observed inside the atomic commit transform
 * @param acceptedChangeSet - Exact accepted ChangeSet stored in the journal
 * @param bundle - Exact Bundle boundary stored in the journal
 * @returns Deterministic validation result
 */
export function validateManifestCommitIntentForCommit(
  intent: ManifestCommitIntent,
  actualManifest: SourceManifest,
  acceptedChangeSet: KnowledgeChangeSet,
  bundle: KnowledgeBundleConfig
): KnowledgeValidationResult {
  const diagnostics = [
    ...validateManifestCommitIntent(intent, bundle).diagnostics,
    ...prefixDiagnostics(validateKnowledgeBundleConfig(bundle).diagnostics, "bundle"),
  ];
  const parsedManifest = parseSourceManifest(actualManifest);
  if (!parsedManifest.ok) {
    diagnostics.push(...prefixDiagnostics(parsedManifest.issues, "manifest"));
    return toValidationResult(diagnostics);
  }
  diagnostics.push(
    ...prefixDiagnostics(validateSourceManifest(parsedManifest.value).diagnostics, "manifest")
  );
  const inspected = inspectChangeSet(acceptedChangeSet, bundle);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.changeSet) {
    return toValidationResult(diagnostics);
  }
  const manifest = parsedManifest.value;
  const changeSet = inspected.changeSet;
  if (manifest.bundleId !== bundle.id || intent.bundleId !== manifest.bundleId) {
    addError(
      diagnostics,
      "manifest_commit_manifest_bundle_mismatch",
      "manifest.bundleId",
      "Actual Manifest, Bundle, and intent identities must match"
    );
  }
  if (manifest.revision !== intent.expectedManifestRevision) {
    addError(
      diagnostics,
      "manifest_commit_revision_mismatch",
      "expectedManifestRevision",
      "Actual Manifest revision no longer matches the intent read-set"
    );
  }
  try {
    if (createSourceManifestDigest(manifest) !== intent.expectedManifestDigest) {
      addError(
        diagnostics,
        "manifest_commit_digest_mismatch",
        "expectedManifestDigest",
        "Actual Manifest content no longer matches the intent read-set"
      );
    }
  } catch (error) {
    if (error instanceof ManifestCommitValidationError) {
      diagnostics.push(...prefixDiagnostics(error.diagnostics, "manifest"));
    } else {
      throw error;
    }
  }
  if (
    changeSet.id !== intent.changeSetId ||
    changeSet.bundleId !== intent.bundleId ||
    changeSet.operation !== getManifestCommitIntentOperation(intent)
  ) {
    addError(
      diagnostics,
      "manifest_commit_changeset_identity_mismatch",
      "changeSet",
      "Accepted ChangeSet does not match the source-compile intent"
    );
  }
  if (changeSet.status !== "accepted") {
    addError(
      diagnostics,
      "manifest_commit_changeset_not_accepted",
      "changeSet.status",
      "Only an accepted ChangeSet may be committed"
    );
  }
  if (!changeSet.sourceRefs.includes(intent.sourceId)) {
    addError(
      diagnostics,
      "manifest_commit_primary_source_missing",
      "changeSet.sourceRefs",
      "Accepted ChangeSet provenance must include the primary source"
    );
  }

  const source = manifest.entries.find((entry) => entry.sourceId === intent.sourceId);
  if (!source) {
    addError(
      diagnostics,
      "manifest_commit_source_not_found",
      "sourceId",
      "Primary source is not registered in the actual Manifest"
    );
    return toValidationResult(diagnostics);
  }
  try {
    const sourceCompileAuthority = deriveKnowledgeSourceCompileAuthority(source);
    if (sourceCompileAuthority.operation !== getManifestCommitIntentOperation(intent)) {
      addError(
        diagnostics,
        "manifest_commit_source_origin_mismatch",
        "manifest.entries.extensions",
        "Actual Manifest source origin does not match the final intent operation"
      );
    } else if (sourceCompileAuthority.operation === "query_writeback") {
      if (
        intent.kind !== "query_writeback_source_compile" ||
        sourceCompileAuthority.sourceOriginDigest !== intent.sourceOriginDigest ||
        sourceCompileAuthority.expectedSourceContentHash !== intent.sourceContentHash
      ) {
        addError(
          diagnostics,
          "manifest_commit_source_origin_mismatch",
          "manifest.entries.extensions",
          "Actual managed query source no longer matches the reviewed origin"
        );
      }
    }
  } catch {
    addError(
      diagnostics,
      "manifest_commit_source_origin_invalid",
      "manifest.entries.extensions",
      "Actual Manifest source origin is invalid"
    );
  }
  const basePages: ManifestCommitPage[] = [];
  (source.lastSuccessful?.generatedPages ?? []).forEach((page, index) => {
    if (page.contentHash === undefined) {
      addError(
        diagnostics,
        "manifest_commit_base_hash_missing",
        `manifest.source.lastSuccessful.generatedPages[${index}].contentHash`,
        "Every base page requires a last-generated content hash"
      );
      return;
    }
    basePages.push({ ...page, contentHash: page.contentHash });
  });
  const normalizedBase = normalizePages(basePages);
  diagnostics.push(
    ...validatePageProjection(normalizedBase, "manifest.baseGeneratedPages", bundle, true)
  );
  const pagesByKey = new Map(
    normalizedBase.map((page) => [toWindowsPathKey(page.path), { ...page }])
  );
  const effectiveByKey = collectEffectiveSourcePages(
    manifest,
    intent.sourceId,
    diagnostics,
    "manifest.extensions"
  );
  const trackedPagesByKey = collectTrackedManifestPages(manifest);

  changeSet.changes.forEach((change, index) => {
    const field = `changeSet.changes[${index}]`;
    const key = toWindowsPathKey(change.path);
    const basePage = pagesByKey.get(key);
    const effectivePage = effectiveByKey.get(key);
    const trackedPages = trackedPagesByKey.get(key) ?? [];
    const existingSources = new Set(trackedPages.map(({ sourceId }) => sourceId));
    if (!change.sourceRefs.includes(intent.sourceId)) {
      addError(
        diagnostics,
        "manifest_commit_change_primary_source_missing",
        `${field}.sourceRefs`,
        "Every committed Manifest mutation must retain primary source provenance"
      );
    }
    if (change.operation === "create") {
      if (!basePage && existingSources.size > 0) {
        addError(
          diagnostics,
          "manifest_commit_cross_source_existing_page",
          `${field}.path`,
          "A new create cannot claim a page tracked by another source"
        );
        return;
      }
      if (basePage) {
        validateCoOwnedPageAuthority(trackedPages, basePage, `${field}.path`, diagnostics);
        validateTrackedSourceCoverage(
          change.sourceRefs,
          trackedPages,
          `${field}.sourceRefs`,
          diagnostics
        );
        if (effectivePage && effectivePage.effectiveContentHash !== basePage.contentHash) {
          addError(
            diagnostics,
            "manifest_commit_overlay_create_invalid",
            `${field}.operation`,
            "An active forward-revision page requires an existing-file CAS mutation"
          );
          return;
        }
      }
      pagesByKey.set(key, {
        path: change.path,
        ownership: basePage?.ownership ?? "generated",
        contentHash: change.afterHash,
      });
      return;
    }
    if (!basePage) {
      addError(
        diagnostics,
        "manifest_commit_existing_not_primary_tracked",
        `${field}.path`,
        "Existing update or delete target is not tracked by the primary source"
      );
      return;
    }
    validateCoOwnedPageAuthority(trackedPages, basePage, `${field}.path`, diagnostics);
    validateTrackedSourceCoverage(
      change.sourceRefs,
      trackedPages,
      `${field}.sourceRefs`,
      diagnostics
    );
    const expectedContentHash = effectivePage?.effectiveContentHash ?? basePage.contentHash;
    if (change.operation === "delete") {
      if (
        basePage.ownership !== "generated" ||
        existingSources.size !== 1 ||
        !existingSources.has(intent.sourceId)
      ) {
        addError(
          diagnostics,
          "manifest_commit_delete_not_sole_source",
          `${field}.path`,
          "Delete requires a generated page owned only by the primary source"
        );
        return;
      }
      if (change.beforeHash !== expectedContentHash) {
        addError(
          diagnostics,
          "manifest_commit_delete_hash_mismatch",
          `${field}.beforeHash`,
          "Delete precondition must match the Manifest's effective CAS hash"
        );
        return;
      }
      pagesByKey.delete(key);
      return;
    }
    if (change.beforeHash !== expectedContentHash) {
      addError(
        diagnostics,
        "manifest_commit_update_hash_mismatch",
        `${field}.beforeHash`,
        "Update precondition must match the Manifest's effective CAS hash"
      );
      return;
    }
    pagesByKey.set(key, {
      path: change.path,
      ownership: basePage.ownership,
      contentHash: change.afterHash,
    });
  });

  const projectedPages = normalizePages([...pagesByKey.values()]);
  diagnostics.push(
    ...validatePageProjection(projectedPages, "projectedGeneratedPages", bundle, false)
  );
  if (!samePages(projectedPages, intent.generatedPages)) {
    addError(
      diagnostics,
      "manifest_commit_final_projection_mismatch",
      "generatedPages",
      "Intent pages do not equal the complete projection rebuilt from actual Manifest state"
    );
  }
  return toValidationResult(diagnostics);
}

/**
 * Cross-checks a plan-derived intent against the actual pre-commit Manifest.
 *
 * @param intent - Final intent derived at review acceptance
 * @param plan - Immutable proposal-time plan
 * @param actualManifest - Actual Manifest observed before commit
 * @param acceptedChangeSet - Exact accepted ChangeSet
 * @param bundle - Exact Bundle boundary
 * @returns Deterministic validation result
 */
export function validateManifestCommitIntentAgainstManifest(
  intent: ManifestCommitIntent,
  plan: ManifestCommitPlan,
  actualManifest: SourceManifest,
  acceptedChangeSet: KnowledgeChangeSet,
  bundle: KnowledgeBundleConfig
): KnowledgeValidationResult {
  const diagnostics = [
    ...validateManifestCommitPlan(plan, bundle).diagnostics,
    ...validateManifestCommitIntentForCommit(intent, actualManifest, acceptedChangeSet, bundle)
      .diagnostics,
  ];
  try {
    const projected = projectManifestCommitIntent(plan, acceptedChangeSet);
    if (
      canonicalizeJson(projected as unknown as JsonValue) !==
      canonicalizeJson(intent as unknown as JsonValue)
    ) {
      addError(
        diagnostics,
        "manifest_commit_plan_intent_mismatch",
        "intent",
        "Final intent does not equal the accepted projection of its durable plan"
      );
    }
  } catch (error) {
    if (error instanceof ManifestCommitValidationError) {
      diagnostics.push(...error.diagnostics);
    } else {
      throw error;
    }
  }
  return toValidationResult(diagnostics);
}
