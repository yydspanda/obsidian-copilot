import { z } from "zod";

import type { KnowledgeSourceCompileAuthority } from "@/knowledge/capture/KnowledgeSourceOrigin";
import type { ManifestCommitPage } from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { validateVaultRelativePath } from "@/knowledge/model/validation";
import { findWindowsPathCollisions, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of the durable no-changes Manifest plan and marker. */
export const NO_CHANGES_MANIFEST_COMMIT_VERSION = 1 as const;

/** Reserved source extension containing the latest atomic no-changes commit marker. */
export const KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY =
  "obsidianCopilotKnowledgeNoChangesCommit" as const;

/** Deterministic compiler boundary that established an exact no-changes outcome. */
export type NoChangesManifestCommitReason =
  | "analysis_no_targets"
  | "resolved_no_targets"
  | "all_targets_unchanged";

/** Fields shared by ordinary and query-writeback no-changes plans. */
interface NoChangesManifestCommitPlanBase {
  version: typeof NO_CHANGES_MANIFEST_COMMIT_VERSION;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  noChangesId: string;
  compileContextDigest: string;
  analysisDigest: string;
  evidenceDigest: string;
  reason: NoChangesManifestCommitReason;
  expectedManifestRevision: number;
  expectedManifestDigest: string;
  baseGeneratedPages: ManifestCommitPage[];
}

/** No-file success plan for one ordinary durable source compile. */
export interface SourceNoChangesManifestCommitPlan extends NoChangesManifestCommitPlanBase {
  kind: "source_compile";
}

/** No-file success plan retaining the exact managed query-capture origin. */
export interface QueryWritebackNoChangesManifestCommitPlan extends NoChangesManifestCommitPlanBase {
  kind: "query_writeback_source_compile";
  sourceOriginDigest: string;
}

/** Complete proposal-time proof that compilation intentionally changed no Wiki files. */
export type NoChangesManifestCommitPlan =
  | SourceNoChangesManifestCommitPlan
  | QueryWritebackNoChangesManifestCommitPlan;

/** Distributive no-id plan core used to derive the non-circular identity. */
type NoChangesManifestCommitPlanCore = NoChangesManifestCommitPlan extends infer TPlan
  ? TPlan extends NoChangesManifestCommitPlan
    ? Omit<TPlan, "noChangesId">
    : never
  : never;

/** Input used to create one content-addressed no-changes plan. */
export interface CreateNoChangesManifestCommitPlanInput {
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  compileContextDigest: string;
  analysisDigest: string;
  evidenceDigest: string;
  reason: NoChangesManifestCommitReason;
  expectedManifestRevision: number;
  expectedManifestDigest: string;
  baseGeneratedPages: readonly ManifestCommitPage[];
  sourceAuthority: KnowledgeSourceCompileAuthority;
}

/** Exact processing claim bound to a no-changes Queue completion. */
export interface NoChangesManifestQueueClaim {
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
  startedAt: number;
}

/** Input used to bind one strict plan to its exact Queue completion. */
export interface CreateNoChangesManifestCommitMarkerInput {
  plan: NoChangesManifestCommitPlan;
  jobClaim: NoChangesManifestQueueClaim;
  completedAt: number;
  manifestAfterRevision: number;
}

/** Fields shared by ordinary and query-writeback no-changes commit markers. */
interface NoChangesManifestCommitMarkerBase extends NoChangesManifestCommitPlanBase {
  planDigest: string;
  jobId: string;
  attempt: number;
  startedAt: number;
  completedAt: number;
  manifestAfterRevision: number;
}

/** Durable ordinary-source marker published with Queue completion. */
export interface SourceNoChangesManifestCommitMarker extends NoChangesManifestCommitMarkerBase {
  kind: "source_compile";
}

/** Durable query-writeback marker published with Queue completion. */
export interface QueryWritebackNoChangesManifestCommitMarker
  extends NoChangesManifestCommitMarkerBase {
  kind: "query_writeback_source_compile";
  sourceOriginDigest: string;
}

/** Exact Manifest/Queue proof for one durably completed no-changes compile. */
export type NoChangesManifestCommitMarker =
  | SourceNoChangesManifestCommitMarker
  | QueryWritebackNoChangesManifestCommitMarker;

/** Stable sanitized failure for invalid no-changes commit material. */
export class NoChangesManifestCommitValidationError extends TypeError {
  /** Creates one failure carrying only bounded deterministic diagnostics. */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("No-changes Manifest commit material does not satisfy the strict contract");
    this.name = "NoChangesManifestCommitValidationError";
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NO_CHANGES_ID_PATTERN = /^knowledge-no-changes-[a-f0-9]{64}$/;
const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(SHA256_PATTERN);
const noChangesIdSchema = z.string().regex(NO_CHANGES_ID_PATTERN);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();

const manifestCommitPageSchema: z.ZodType<ManifestCommitPage> = z
  .object({
    path: nonEmptyStringSchema,
    ownership: z.enum(["generated", "shared", "user"]),
    contentHash: sha256Schema,
  })
  .strict();

const noChangesReasonSchema = z.enum([
  "analysis_no_targets",
  "resolved_no_targets",
  "all_targets_unchanged",
]);

const planBaseShape = {
  version: z.literal(NO_CHANGES_MANIFEST_COMMIT_VERSION),
  bundleId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceContentHash: sha256Schema,
  pipelineFingerprint: sha256Schema,
  inputRevision: nonNegativeIntegerSchema,
  noChangesId: noChangesIdSchema,
  compileContextDigest: sha256Schema,
  analysisDigest: sha256Schema,
  evidenceDigest: sha256Schema,
  reason: noChangesReasonSchema,
  expectedManifestRevision: nonNegativeIntegerSchema,
  expectedManifestDigest: sha256Schema,
  baseGeneratedPages: z.array(manifestCommitPageSchema),
} as const;

/** Strict runtime schema for a durable no-changes Manifest plan. */
export const noChangesManifestCommitPlanSchema: z.ZodType<NoChangesManifestCommitPlan> = z.union([
  z
    .object({
      ...planBaseShape,
      kind: z.literal("source_compile"),
    })
    .strict(),
  z
    .object({
      ...planBaseShape,
      kind: z.literal("query_writeback_source_compile"),
      sourceOriginDigest: sha256Schema,
    })
    .strict(),
]);

const markerBaseShape = {
  ...planBaseShape,
  planDigest: sha256Schema,
  jobId: nonEmptyStringSchema,
  attempt: positiveIntegerSchema,
  startedAt: nonNegativeIntegerSchema,
  completedAt: nonNegativeIntegerSchema,
  manifestAfterRevision: nonNegativeIntegerSchema,
} as const;

/** Strict runtime schema for one atomic Manifest/Queue no-changes marker. */
export const noChangesManifestCommitMarkerSchema: z.ZodType<NoChangesManifestCommitMarker> =
  z.union([
    z
      .object({
        ...markerBaseShape,
        kind: z.literal("source_compile"),
      })
      .strict(),
    z
      .object({
        ...markerBaseShape,
        kind: z.literal("query_writeback_source_compile"),
        sourceOriginDigest: sha256Schema,
      })
      .strict(),
  ]);

/** Converts one Zod issue path to stable dotted/indexed notation. */
function formatIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    const text = String(segment);
    return result ? `${result}.${text}` : text;
  }, "");
}

/** Maps strict structural parse issues into the public diagnostic contract. */
function mapSchemaIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.map((issue) => ({
    code: `schema_${issue.code}`,
    severity: "error" as const,
    field: formatIssuePath(issue.path),
    message:
      issue.code === "unrecognized_keys"
        ? "Object contains unsupported fields"
        : "Object does not satisfy the strict no-changes commit contract",
  }));
}

/** Creates one aggregate deterministic validation result. */
function toValidationResult(diagnostics: KnowledgeDiagnostic[]): KnowledgeValidationResult {
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
  };
}

/** Adds one deterministic error diagnostic. */
function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

/** Compares identifiers without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Compares Manifest pages by Windows path identity and exact path spelling. */
function comparePages(left: ManifestCommitPage, right: ManifestCommitPage): number {
  const keyComparison = compareText(toWindowsPathKey(left.path), toWindowsPathKey(right.path));
  return keyComparison === 0 ? compareText(left.path, right.path) : keyComparison;
}

/** Returns detached canonically ordered base-page material. */
function normalizePages(pages: readonly ManifestCommitPage[]): ManifestCommitPage[] {
  return pages.map((page) => ({ ...page })).sort(comparePages);
}

/** Reconstructs the exact plan core whose digest creates noChangesId. */
function createPlanIdentityCore(plan: NoChangesManifestCommitPlanCore): JsonValue {
  return plan as unknown as JsonValue;
}

/** Creates a non-circular content address over every behavior-defining plan field. */
function createNoChangesIdFromCore(plan: NoChangesManifestCommitPlanCore): string {
  return `knowledge-no-changes-${sha256(
    `knowledge-no-changes-plan-identity-v1\n${canonicalizeJson(createPlanIdentityCore(plan))}`
  )}`;
}

/** Removes the derived noChangesId while preserving the exact plan variant. */
function omitNoChangesId(plan: NoChangesManifestCommitPlan): NoChangesManifestCommitPlanCore {
  const { noChangesId: _noChangesId, ...core } = plan;
  void _noChangesId;
  return core;
}

/** Validates canonical paths, ordering, and identity shared by parsed plans. */
function validatePlanSemantics(plan: NoChangesManifestCommitPlan): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  plan.baseGeneratedPages.forEach((page, index) => {
    diagnostics.push(
      ...validateVaultRelativePath(page.path, `baseGeneratedPages[${index}].path`).diagnostics
    );
  });
  const collisions = findWindowsPathCollisions(plan.baseGeneratedPages.map((page) => page.path));
  if (collisions.length > 0) {
    addError(
      diagnostics,
      "no_changes_base_page_collision",
      "baseGeneratedPages",
      "Base generated pages must be unique under Windows path comparison"
    );
  }
  const normalized = normalizePages(plan.baseGeneratedPages);
  if (
    canonicalizeJson(normalized as unknown as JsonValue) !==
    canonicalizeJson(plan.baseGeneratedPages as unknown as JsonValue)
  ) {
    addError(
      diagnostics,
      "no_changes_base_pages_not_canonical",
      "baseGeneratedPages",
      "Base generated pages must use canonical Windows path order"
    );
  }
  if (plan.noChangesId !== createNoChangesIdFromCore(omitNoChangesId(plan))) {
    addError(
      diagnostics,
      "no_changes_id_mismatch",
      "noChangesId",
      "No-changes identity does not match the complete plan core"
    );
  }
  return diagnostics;
}

/** Deeply freezes one detached strict plan for safe asynchronous hand-off. */
function freezePlan(plan: NoChangesManifestCommitPlan): NoChangesManifestCommitPlan {
  return Object.freeze({
    ...plan,
    baseGeneratedPages: Object.freeze(
      plan.baseGeneratedPages.map((page) => Object.freeze({ ...page }))
    ),
  }) as NoChangesManifestCommitPlan;
}

/** Deeply freezes one detached strict marker for safe asynchronous hand-off. */
function freezeMarker(marker: NoChangesManifestCommitMarker): NoChangesManifestCommitMarker {
  return Object.freeze({
    ...marker,
    baseGeneratedPages: Object.freeze(
      marker.baseGeneratedPages.map((page) => Object.freeze({ ...page }))
    ),
  }) as NoChangesManifestCommitMarker;
}

/** Parses unknown JSON as one strict no-changes Manifest plan. */
export function parseNoChangesManifestCommitPlan(
  value: unknown
): KnowledgeParseResult<NoChangesManifestCommitPlan> {
  const parsed = noChangesManifestCommitPlanSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: freezePlan(parsed.data) }
    : { ok: false, issues: mapSchemaIssues(parsed.error) };
}

/** Validates one strict plan's canonical paths and complete derived identity. */
export function validateNoChangesManifestCommitPlan(value: unknown): KnowledgeValidationResult {
  const parsed = parseNoChangesManifestCommitPlan(value);
  if (!parsed.ok) return toValidationResult(parsed.issues);
  return toValidationResult(validatePlanSemantics(parsed.value));
}

/** Creates one canonical no-changes plan from exact source and Manifest authority. */
export function createNoChangesManifestCommitPlan(
  input: Readonly<CreateNoChangesManifestCommitPlanInput>
): NoChangesManifestCommitPlan {
  const base = {
    version: NO_CHANGES_MANIFEST_COMMIT_VERSION,
    bundleId: input.bundleId,
    sourceId: input.sourceId,
    sourceContentHash: input.sourceContentHash,
    pipelineFingerprint: input.pipelineFingerprint,
    inputRevision: input.inputRevision,
    compileContextDigest: input.compileContextDigest,
    analysisDigest: input.analysisDigest,
    evidenceDigest: input.evidenceDigest,
    reason: input.reason,
    expectedManifestRevision: input.expectedManifestRevision,
    expectedManifestDigest: input.expectedManifestDigest,
    baseGeneratedPages: normalizePages(input.baseGeneratedPages),
  } as const;
  let core: NoChangesManifestCommitPlanCore;
  if (input.sourceAuthority.operation === "query_writeback") {
    if (input.sourceAuthority.expectedSourceContentHash !== input.sourceContentHash) {
      throw new NoChangesManifestCommitValidationError([
        {
          code: "no_changes_query_source_hash_mismatch",
          severity: "error",
          field: "sourceContentHash",
          message: "Query-writeback source bytes must match their exact capture authority",
        },
      ]);
    }
    core = {
      ...base,
      kind: "query_writeback_source_compile",
      sourceOriginDigest: input.sourceAuthority.sourceOriginDigest,
    };
  } else {
    core = { ...base, kind: "source_compile" };
  }
  const candidate = { ...core, noChangesId: createNoChangesIdFromCore(core) };
  const parsed = parseNoChangesManifestCommitPlan(candidate);
  const diagnostics = parsed.ok ? validatePlanSemantics(parsed.value) : parsed.issues;
  if (!parsed.ok || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new NoChangesManifestCommitValidationError(diagnostics);
  }
  return freezePlan(parsed.value);
}

/** Computes the canonical digest of one exact validated no-changes plan. */
export function createNoChangesManifestCommitPlanDigest(
  value: NoChangesManifestCommitPlan
): string {
  const parsed = parseNoChangesManifestCommitPlan(value);
  const diagnostics = parsed.ok ? validatePlanSemantics(parsed.value) : parsed.issues;
  if (!parsed.ok || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new NoChangesManifestCommitValidationError(diagnostics);
  }
  return sha256(
    `knowledge-no-changes-manifest-plan-v1\n${canonicalizeJson(parsed.value as unknown as JsonValue)}`
  );
}

/** Reconstructs the exact plan embedded in one flat durable marker. */
function markerToPlan(marker: NoChangesManifestCommitMarker): NoChangesManifestCommitPlan {
  const {
    planDigest: _planDigest,
    jobId: _jobId,
    attempt: _attempt,
    startedAt: _startedAt,
    completedAt: _completedAt,
    manifestAfterRevision: _manifestAfterRevision,
    ...plan
  } = marker;
  void _planDigest;
  void _jobId;
  void _attempt;
  void _startedAt;
  void _completedAt;
  void _manifestAfterRevision;
  return plan;
}

/** Validates plan binding, Queue timing, and exact Manifest revision advancement. */
function validateMarkerSemantics(marker: NoChangesManifestCommitMarker): KnowledgeDiagnostic[] {
  const plan = markerToPlan(marker);
  const diagnostics = validatePlanSemantics(plan);
  let planDigest: string | undefined;
  try {
    planDigest = createNoChangesManifestCommitPlanDigest(plan);
  } catch (error) {
    if (error instanceof NoChangesManifestCommitValidationError) {
      diagnostics.push(...error.diagnostics);
    } else {
      throw error;
    }
  }
  if (planDigest !== undefined && marker.planDigest !== planDigest) {
    addError(
      diagnostics,
      "no_changes_plan_digest_mismatch",
      "planDigest",
      "Marker plan digest does not match its complete embedded plan identity"
    );
  }
  if (marker.completedAt < marker.startedAt) {
    addError(
      diagnostics,
      "no_changes_completion_time_invalid",
      "completedAt",
      "No-changes completion cannot precede its exact Queue claim"
    );
  }
  if (
    marker.expectedManifestRevision === Number.MAX_SAFE_INTEGER ||
    marker.manifestAfterRevision !== marker.expectedManifestRevision + 1
  ) {
    addError(
      diagnostics,
      "no_changes_manifest_revision_invalid",
      "manifestAfterRevision",
      "No-changes commit must advance the exact Manifest revision once"
    );
  }
  return diagnostics;
}

/** Parses unknown JSON as one strict durable no-changes commit marker. */
export function parseKnowledgeNoChangesCommitMarker(
  value: unknown
): KnowledgeParseResult<NoChangesManifestCommitMarker> {
  const parsed = noChangesManifestCommitMarkerSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: freezeMarker(parsed.data) }
    : { ok: false, issues: mapSchemaIssues(parsed.error) };
}

/** Validates a marker's exact plan digest, timing, revision, and derived identity. */
export function validateNoChangesManifestCommitMarker(value: unknown): KnowledgeValidationResult {
  const parsed = parseKnowledgeNoChangesCommitMarker(value);
  if (!parsed.ok) return toValidationResult(parsed.issues);
  return toValidationResult(validateMarkerSemantics(parsed.value));
}

/** Creates one strict flat marker from an exact plan and matching Queue claim. */
export function createKnowledgeNoChangesCommitMarker(
  input: Readonly<CreateNoChangesManifestCommitMarkerInput>
): NoChangesManifestCommitMarker {
  const plan = parseNoChangesManifestCommitPlan(input.plan);
  const planDiagnostics = plan.ok ? validatePlanSemantics(plan.value) : plan.issues;
  if (!plan.ok || planDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new NoChangesManifestCommitValidationError(planDiagnostics);
  }
  const claim = input.jobClaim;
  const claimMatches =
    claim.sourceId === plan.value.sourceId &&
    claim.sourceContentHash === plan.value.sourceContentHash &&
    claim.pipelineFingerprint === plan.value.pipelineFingerprint &&
    claim.inputRevision === plan.value.inputRevision;
  if (!claimMatches) {
    throw new NoChangesManifestCommitValidationError([
      {
        code: "no_changes_queue_claim_mismatch",
        severity: "error",
        field: "jobClaim",
        message: "Queue claim must match the exact no-changes source input",
      },
    ]);
  }
  const candidate = {
    ...plan.value,
    planDigest: createNoChangesManifestCommitPlanDigest(plan.value),
    jobId: claim.jobId,
    attempt: claim.attempt,
    startedAt: claim.startedAt,
    completedAt: input.completedAt,
    manifestAfterRevision: input.manifestAfterRevision,
  };
  const parsed = parseKnowledgeNoChangesCommitMarker(candidate);
  const diagnostics = parsed.ok ? validateMarkerSemantics(parsed.value) : parsed.issues;
  if (!parsed.ok || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new NoChangesManifestCommitValidationError(diagnostics);
  }
  return freezeMarker(parsed.value);
}
