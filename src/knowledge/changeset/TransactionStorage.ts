import * as z from "zod";

import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  createManifestCommitIntentDigest,
  getManifestCommitIntentOperation,
  manifestCommitIntentSchema,
  validateManifestCommitIntent,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { knowledgeBundleConfigSchema, knowledgeChangeSetSchema } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
} from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export const TRANSACTION_JOURNAL_VERSION = 3 as const;

export type TransactionFileState =
  | { kind: "missing" }
  | { kind: "file"; content: string; contentHash: string };

export interface TransactionTarget {
  changeId: string;
  path: string;
  windowsPathKey: string;
  operation: KnowledgeFileChange["operation"];
  before: TransactionFileState;
  after: TransactionFileState;
}

export interface TransactionJobClaim {
  readonly jobId: string;
  readonly attempt: number;
  readonly startedAt: number;
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
}

export type TransactionConflictCode = "file_state_conflict" | "post_write_verification_failed";

export interface TransactionConflict {
  path: string;
  code: TransactionConflictCode;
  detectedAt: number;
  actualHash?: string;
}

interface ChangeSetTransactionJournalBase {
  version: typeof TRANSACTION_JOURNAL_VERSION;
  transactionId: string;
  revision: number;
  bundleId: string;
  bundle: KnowledgeBundleConfig;
  changeSetId: string;
  changeSetDigest: string;
  manifestCommitIntent: ManifestCommitIntent;
  manifestCommitIntentDigest: string;
  jobClaim: TransactionJobClaim;
  changeSet: KnowledgeChangeSet;
  targets: TransactionTarget[];
  appliedCount: number;
  createdAt: number;
  updatedAt: number;
}

export type ChangeSetTransactionJournal = ChangeSetTransactionJournalBase &
  (
    | { phase: "prepared" }
    | { phase: "applying" }
    | { phase: "committed"; committedAt: number }
    | { phase: "recovery_required"; conflicts: TransactionConflict[] }
  );

export interface TransactionStorageToken {
  transactionId: string;
  revision: number;
}

export class TransactionStorageAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionStorageAuthorityError";
  }
}

export class TransactionStorageRevisionConflictError extends Error {
  constructor(
    public readonly expectedToken: TransactionStorageToken | null,
    public readonly actualToken?: TransactionStorageToken | null
  ) {
    const expectedDescription = expectedToken
      ? `'${expectedToken.transactionId}' at revision ${expectedToken.revision}`
      : "an empty slot";
    const actualDescription =
      actualToken === undefined
        ? ""
        : actualToken === null
          ? "; the slot is empty"
          : `; observed '${actualToken.transactionId}' at revision ${actualToken.revision}`;
    super(
      `Active ChangeSet transaction no longer matches ${expectedDescription}${actualDescription}`
    );
    this.name = "TransactionStorageRevisionConflictError";
  }
}

export interface TransactionStorage {
  readActive(): Promise<unknown>;

  writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void>;

  clearActive(expectedToken: TransactionStorageToken): Promise<void>;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();

const transactionFileStateSchema: z.ZodType<TransactionFileState> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z
    .object({
      kind: z.literal("file"),
      content: z.string(),
      contentHash: sha256Schema,
    })
    .strict(),
]);

const transactionTargetSchema: z.ZodType<TransactionTarget> = z
  .object({
    changeId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    windowsPathKey: nonEmptyStringSchema,
    operation: z.enum(["create", "update", "delete"]),
    before: transactionFileStateSchema,
    after: transactionFileStateSchema,
  })
  .strict();

const transactionJobClaimSchema: z.ZodType<TransactionJobClaim> = z
  .object({
    jobId: nonEmptyStringSchema,
    attempt: positiveIntegerSchema,
    startedAt: nonNegativeIntegerSchema,
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeIntegerSchema,
  })
  .strict();

const transactionConflictSchema: z.ZodType<TransactionConflict> = z
  .object({
    path: nonEmptyStringSchema,
    code: z.enum(["file_state_conflict", "post_write_verification_failed"]),
    detectedAt: nonNegativeIntegerSchema,
    actualHash: sha256Schema.optional(),
  })
  .strict();

const transactionJournalBaseShape = {
  version: z.literal(TRANSACTION_JOURNAL_VERSION),
  transactionId: nonEmptyStringSchema,
  revision: nonNegativeIntegerSchema,
  bundleId: nonEmptyStringSchema,
  bundle: knowledgeBundleConfigSchema,
  changeSetId: nonEmptyStringSchema,
  changeSetDigest: sha256Schema,
  manifestCommitIntent: manifestCommitIntentSchema,
  manifestCommitIntentDigest: sha256Schema,
  jobClaim: transactionJobClaimSchema,
  changeSet: knowledgeChangeSetSchema,
  targets: z.array(transactionTargetSchema).min(1),
  appliedCount: nonNegativeIntegerSchema,
  createdAt: nonNegativeIntegerSchema,
  updatedAt: nonNegativeIntegerSchema,
};

const changeSetTransactionJournalSchema: z.ZodType<ChangeSetTransactionJournal> =
  z.discriminatedUnion("phase", [
    z.object({ ...transactionJournalBaseShape, phase: z.literal("prepared") }).strict(),
    z.object({ ...transactionJournalBaseShape, phase: z.literal("applying") }).strict(),
    z
      .object({
        ...transactionJournalBaseShape,
        phase: z.literal("committed"),
        committedAt: nonNegativeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...transactionJournalBaseShape,
        phase: z.literal("recovery_required"),
        conflicts: z.array(transactionConflictSchema).min(1),
      })
      .strict(),
  ]);

export function createChangeSetTransactionDigest(changeSet: KnowledgeChangeSet): string {
  return sha256(`knowledge-changeset-v1\n${canonicalizeJson(changeSet as unknown as JsonValue)}`);
}

export function createChangeSetTransactionJournalDigest(
  journal: ChangeSetTransactionJournal
): string {
  return sha256(
    `knowledge-transaction-journal-v${TRANSACTION_JOURNAL_VERSION}\n${canonicalizeJson(
      journal as unknown as JsonValue
    )}`
  );
}

function formatIssuePath(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

export function parseChangeSetTransactionJournal(
  value: unknown
): KnowledgeParseResult<ChangeSetTransactionJournal> {
  const result = changeSetTransactionJournalSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      code: `schema_${issue.code}`,
      severity: "error",
      field: formatIssuePath(issue.path),
      message: issue.message,
    })),
  };
}

function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

function appendNestedDiagnostics(
  diagnostics: KnowledgeDiagnostic[],
  prefix: string,
  nested: KnowledgeValidationResult
): void {
  for (const diagnostic of nested.diagnostics) {
    diagnostics.push({
      ...diagnostic,
      field: diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
    });
  }
}

function validateFileState(
  state: TransactionFileState,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  if (state.kind === "file" && createFileContentHash(state.content) !== state.contentHash) {
    addError(
      diagnostics,
      "transaction_file_state_hash_mismatch",
      `${field}.contentHash`,
      "File-state hash must match its exact persisted content"
    );
  }
}

function validateTargetAgainstChange(
  target: TransactionTarget,
  change: KnowledgeFileChange,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  if (target.path !== change.path) {
    addError(
      diagnostics,
      "transaction_target_path_mismatch",
      `${field}.path`,
      "Transaction target path must exactly match its accepted file change"
    );
  }
  if (target.operation !== change.operation) {
    addError(
      diagnostics,
      "transaction_target_operation_mismatch",
      `${field}.operation`,
      "Transaction target operation must match its accepted file change"
    );
    return;
  }

  if (change.operation === "create") {
    if (target.before.kind !== "missing") {
      addError(
        diagnostics,
        "transaction_target_before_mismatch",
        `${field}.before`,
        "A create target must capture a missing pre-state"
      );
    }
    if (
      target.after.kind !== "file" ||
      target.after.content !== change.afterContent ||
      target.after.contentHash !== change.afterHash
    ) {
      addError(
        diagnostics,
        "transaction_target_after_mismatch",
        `${field}.after`,
        "A create target after-state must exactly match the accepted content and hash"
      );
    }
    return;
  }

  if (target.before.kind !== "file" || target.before.contentHash !== change.beforeHash) {
    addError(
      diagnostics,
      "transaction_target_before_mismatch",
      `${field}.before`,
      "Target pre-state must be a file whose hash matches the accepted before hash"
    );
  }

  if (change.operation === "update") {
    if (
      target.after.kind !== "file" ||
      target.after.content !== change.afterContent ||
      target.after.contentHash !== change.afterHash
    ) {
      addError(
        diagnostics,
        "transaction_target_after_mismatch",
        `${field}.after`,
        "An update target after-state must exactly match the accepted content and hash"
      );
    }
    return;
  }

  if (target.after.kind !== "missing") {
    addError(
      diagnostics,
      "transaction_target_after_mismatch",
      `${field}.after`,
      "A delete target must expect a missing post-state"
    );
  }
}

export function validateChangeSetTransactionJournal(value: unknown): KnowledgeValidationResult {
  const parsed = parseChangeSetTransactionJournal(value);
  if (!parsed.ok) {
    return { valid: false, diagnostics: parsed.issues };
  }

  const journal = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];

  if (journal.updatedAt < journal.createdAt) {
    addError(
      diagnostics,
      "transaction_timestamp_order_invalid",
      "updatedAt",
      "Transaction updatedAt cannot precede createdAt"
    );
  }
  if (journal.jobClaim.startedAt > journal.createdAt) {
    addError(
      diagnostics,
      "transaction_claim_timestamp_invalid",
      "jobClaim.startedAt",
      "Owning job attempt must start before the transaction journal is created"
    );
  }
  if (!journal.changeSet.sourceRefs.includes(journal.jobClaim.sourceId)) {
    addError(
      diagnostics,
      "transaction_claim_source_ref_unknown",
      "jobClaim.sourceId",
      "Owning ingest source must be declared by the accepted ChangeSet"
    );
  }
  if (journal.appliedCount > journal.targets.length) {
    addError(
      diagnostics,
      "transaction_applied_count_invalid",
      "appliedCount",
      "Applied target count cannot exceed the number of transaction targets"
    );
  }
  if (journal.bundleId !== journal.changeSet.bundleId) {
    addError(
      diagnostics,
      "transaction_bundle_mismatch",
      "bundleId",
      "Journal bundleId must match the accepted ChangeSet"
    );
  }
  if (journal.bundle.id !== journal.bundleId) {
    addError(
      diagnostics,
      "transaction_bundle_config_mismatch",
      "bundle.id",
      "Persisted Bundle id must match the journal bundleId"
    );
  }
  if (journal.changeSetId !== journal.changeSet.id) {
    addError(
      diagnostics,
      "transaction_changeset_id_mismatch",
      "changeSetId",
      "Journal changeSetId must match the accepted ChangeSet"
    );
  }
  if (journal.changeSet.status !== "accepted") {
    addError(
      diagnostics,
      "transaction_changeset_not_accepted",
      "changeSet.status",
      "Only a fully accepted ChangeSet may enter the transaction journal"
    );
  }
  if (
    !journal.changeSet.validation.okfValid ||
    !journal.changeSet.validation.citationsValid ||
    !journal.changeSet.validation.linksValid
  ) {
    addError(
      diagnostics,
      "transaction_changeset_validation_invalid",
      "changeSet.validation",
      "An accepted journal ChangeSet must retain affirmative deterministic validation flags"
    );
  }
  if (journal.changeSetDigest !== createChangeSetTransactionDigest(journal.changeSet)) {
    addError(
      diagnostics,
      "transaction_changeset_digest_mismatch",
      "changeSetDigest",
      "ChangeSet digest must identify the exact embedded accepted ChangeSet"
    );
  }
  const manifestCommitIntentValidation = validateManifestCommitIntent(
    journal.manifestCommitIntent,
    journal.bundle
  );
  appendNestedDiagnostics(diagnostics, "manifestCommitIntent", manifestCommitIntentValidation);
  if (
    manifestCommitIntentValidation.valid &&
    journal.manifestCommitIntentDigest !==
      createManifestCommitIntentDigest(journal.manifestCommitIntent)
  ) {
    addError(
      diagnostics,
      "transaction_manifest_intent_digest_mismatch",
      "manifestCommitIntentDigest",
      "Manifest intent digest must identify the exact embedded final projection"
    );
  }
  if (
    journal.manifestCommitIntent.bundleId !== journal.bundleId ||
    journal.manifestCommitIntent.changeSetId !== journal.changeSetId
  ) {
    addError(
      diagnostics,
      "transaction_manifest_intent_identity_mismatch",
      "manifestCommitIntent",
      "Manifest intent Bundle and ChangeSet identities must match the journal"
    );
  }
  if (
    journal.manifestCommitIntent.sourceId !== journal.jobClaim.sourceId ||
    journal.manifestCommitIntent.sourceContentHash !== journal.jobClaim.sourceContentHash ||
    journal.manifestCommitIntent.pipelineFingerprint !== journal.jobClaim.pipelineFingerprint ||
    journal.manifestCommitIntent.inputRevision !== journal.jobClaim.inputRevision
  ) {
    addError(
      diagnostics,
      "transaction_manifest_intent_claim_mismatch",
      "manifestCommitIntent",
      "Manifest intent source content, pipeline, and input revision must match the owning job claim"
    );
  }
  if (
    journal.changeSet.operation !== getManifestCommitIntentOperation(journal.manifestCommitIntent)
  ) {
    addError(
      diagnostics,
      "transaction_manifest_intent_operation_mismatch",
      "changeSet.operation",
      "ChangeSet operation must match the exact source-compile Manifest intent"
    );
  }

  appendNestedDiagnostics(diagnostics, "bundle", validateKnowledgeBundleConfig(journal.bundle));
  appendNestedDiagnostics(
    diagnostics,
    "changeSet",
    validateKnowledgeChangeSet(journal.changeSet, journal.bundle)
  );

  if (journal.targets.length !== journal.changeSet.changes.length) {
    addError(
      diagnostics,
      "transaction_target_count_mismatch",
      "targets",
      "Transaction must contain exactly one target for every accepted file change"
    );
  }

  const changesById = new Map(journal.changeSet.changes.map((change) => [change.id, change]));
  const manifestPagesByKey = new Map(
    journal.manifestCommitIntent.generatedPages.map((page) => [toWindowsPathKey(page.path), page])
  );
  const targetChangeIds = new Set<string>();
  journal.targets.forEach((target, index) => {
    const field = `targets.${index}`;
    validateFileState(target.before, `${field}.before`, diagnostics);
    validateFileState(target.after, `${field}.after`, diagnostics);

    const expectedWindowsPathKey = toWindowsPathKey(target.path);
    if (target.windowsPathKey !== expectedWindowsPathKey) {
      addError(
        diagnostics,
        "transaction_windows_path_key_mismatch",
        `${field}.windowsPathKey`,
        "Windows path key must match the target path"
      );
    }
    if (index > 0 && journal.targets[index - 1].windowsPathKey >= target.windowsPathKey) {
      addError(
        diagnostics,
        "transaction_target_order_invalid",
        `${field}.windowsPathKey`,
        "Transaction targets must be strictly sorted by Windows path key"
      );
    }
    if (targetChangeIds.has(target.changeId)) {
      addError(
        diagnostics,
        "transaction_target_change_duplicate",
        `${field}.changeId`,
        "Every accepted file change may appear in at most one transaction target"
      );
    }
    targetChangeIds.add(target.changeId);

    const change = changesById.get(target.changeId);
    if (!change) {
      addError(
        diagnostics,
        "transaction_target_change_unknown",
        `${field}.changeId`,
        "Transaction target must reference an accepted file change"
      );
      return;
    }
    validateTargetAgainstChange(target, change, field, diagnostics);
    const committedPage = manifestPagesByKey.get(target.windowsPathKey);
    if (change.operation === "delete") {
      if (committedPage) {
        addError(
          diagnostics,
          "transaction_manifest_deleted_page_retained",
          "manifestCommitIntent.generatedPages",
          "A deleted transaction target cannot remain in the final Manifest projection"
        );
      }
    } else if (
      !committedPage ||
      committedPage.path !== change.path ||
      committedPage.contentHash !== change.afterHash
    ) {
      addError(
        diagnostics,
        "transaction_manifest_written_page_mismatch",
        "manifestCommitIntent.generatedPages",
        "Every written transaction target must have the exact final Manifest path and hash"
      );
    }
  });

  journal.changeSet.changes.forEach((change, index) => {
    if (!targetChangeIds.has(change.id)) {
      addError(
        diagnostics,
        "transaction_change_target_missing",
        `changeSet.changes.${index}.id`,
        "Every accepted file change must have one transaction target"
      );
    }
  });

  if (journal.phase === "prepared" && journal.appliedCount !== 0) {
    addError(
      diagnostics,
      "transaction_prepared_progress_invalid",
      "appliedCount",
      "A prepared transaction cannot have applied any targets"
    );
  }
  if (journal.phase === "committed") {
    if (journal.appliedCount !== journal.targets.length) {
      addError(
        diagnostics,
        "transaction_committed_progress_invalid",
        "appliedCount",
        "A committed transaction must have applied every target"
      );
    }
    if (journal.committedAt < journal.createdAt || journal.committedAt > journal.updatedAt) {
      addError(
        diagnostics,
        "transaction_committed_timestamp_invalid",
        "committedAt",
        "Committed timestamp must fall within the journal lifetime"
      );
    }
  }
  if (journal.phase === "recovery_required") {
    const targetPaths = new Set(journal.targets.map((target) => target.path));
    journal.conflicts.forEach((conflict, index) => {
      const field = `conflicts.${index}`;
      if (!targetPaths.has(conflict.path)) {
        addError(
          diagnostics,
          "transaction_conflict_target_unknown",
          `${field}.path`,
          "Recovery conflict path must exactly match a transaction target"
        );
      }
      if (conflict.detectedAt < journal.createdAt || conflict.detectedAt > journal.updatedAt) {
        addError(
          diagnostics,
          "transaction_conflict_timestamp_invalid",
          `${field}.detectedAt`,
          "Conflict timestamp must fall within the journal lifetime"
        );
      }
    });
  }

  return { valid: diagnostics.length === 0, diagnostics };
}
