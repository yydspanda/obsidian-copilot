import * as z from "zod";

import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  getManifestCommitPlanOperation,
  manifestCommitIntentSchema,
  manifestCommitPlanSchema,
  projectManifestCommitIntent,
  validateManifestCommitIntent,
  validateManifestCommitPlan,
  validateManifestCommitPlanForChangeSet,
  type ManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { knowledgeChangeSetSchema } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { validateKnowledgeChangeSet } from "@/knowledge/model/validation";

export const CHANGESET_REVIEW_SNAPSHOT_VERSION = 2 as const;

export interface ChangeSetReviewJobClaim {
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
}

interface ChangeSetReviewRecordBase {
  changeSetId: string;
  proposal: KnowledgeChangeSet;
  proposalDigest: string;
  manifestCommitPlan: ManifestCommitPlan;
  manifestCommitPlanDigest: string;
  jobClaim: ChangeSetReviewJobClaim;
  recordedAt: number;
}

export interface PendingChangeSetReviewRecord extends ChangeSetReviewRecordBase {
  outcome: "pending";
  recordRevision: 0;
}

export interface AcceptedChangeSetReviewRecord extends ChangeSetReviewRecordBase {
  outcome: "accepted";
  recordRevision: 1;
  acceptedChangeSet: KnowledgeChangeSet;
  acceptedDigest: string;
  manifestCommitIntent: ManifestCommitIntent;
  manifestCommitIntentDigest: string;
  acceptedAt: number;
}

export interface RejectedChangeSetReviewRecord extends ChangeSetReviewRecordBase {
  outcome: "rejected";
  recordRevision: 1;
  rejectedAt: number;
}

export type ChangeSetReviewRecord =
  | PendingChangeSetReviewRecord
  | AcceptedChangeSetReviewRecord
  | RejectedChangeSetReviewRecord;

export interface ChangeSetReviewSnapshot {
  version: typeof CHANGESET_REVIEW_SNAPSHOT_VERSION;
  bundleId: string;
  revision: number;
  records: ChangeSetReviewRecord[];
}

export class ReviewStorageRevisionConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly expectedRevision: number | null,
    public readonly actualRevision?: number | null
  ) {
    super(
      expectedRevision === null
        ? `ChangeSet review snapshot '${bundleId}' was created concurrently`
        : `ChangeSet review snapshot '${bundleId}' changed after revision ${expectedRevision}` +
            (actualRevision === undefined ? "" : `; observed revision ${actualRevision}`)
    );
    this.name = "ReviewStorageRevisionConflictError";
  }
}

export class ReviewStorageAcceptanceBlockedError extends Error {
  constructor() {
    super("The Bundle is paused; the proposal remains pending and Apply has not started.");
    this.name = "ReviewStorageAcceptanceBlockedError";
  }
}

export interface ReviewStorage {
  read(bundleId: string): Promise<unknown>;

  write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void>;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();
const positiveSafeIntegerSchema = z.number().int().safe().positive();

const changeSetReviewJobClaimSchema: z.ZodType<ChangeSetReviewJobClaim> = z
  .object({
    jobId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeSafeIntegerSchema,
    attempt: positiveSafeIntegerSchema,
  })
  .strict();

const reviewRecordBaseShape = {
  changeSetId: nonEmptyStringSchema,
  proposal: knowledgeChangeSetSchema,
  proposalDigest: sha256Schema,
  manifestCommitPlan: manifestCommitPlanSchema,
  manifestCommitPlanDigest: sha256Schema,
  jobClaim: changeSetReviewJobClaimSchema,
  recordedAt: nonNegativeSafeIntegerSchema,
};

const changeSetReviewRecordSchema: z.ZodType<ChangeSetReviewRecord> = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        ...reviewRecordBaseShape,
        outcome: z.literal("pending"),
        recordRevision: z.literal(0),
      })
      .strict(),
    z
      .object({
        ...reviewRecordBaseShape,
        outcome: z.literal("accepted"),
        recordRevision: z.literal(1),
        acceptedChangeSet: knowledgeChangeSetSchema,
        acceptedDigest: sha256Schema,
        manifestCommitIntent: manifestCommitIntentSchema,
        manifestCommitIntentDigest: sha256Schema,
        acceptedAt: nonNegativeSafeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...reviewRecordBaseShape,
        outcome: z.literal("rejected"),
        recordRevision: z.literal(1),
        rejectedAt: nonNegativeSafeIntegerSchema,
      })
      .strict(),
  ]
);

const changeSetReviewSnapshotSchema: z.ZodType<ChangeSetReviewSnapshot> = z
  .object({
    version: z.literal(CHANGESET_REVIEW_SNAPSHOT_VERSION),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeSafeIntegerSchema,
    records: z.array(changeSetReviewRecordSchema),
  })
  .strict();

function formatIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    const field = String(segment);
    return result ? `${result}.${field}` : field;
  }, "");
}

function mapSchemaIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.map((issue) => ({
    code: "review_snapshot_schema_invalid",
    severity: "error",
    field: formatIssuePath(issue.path),
    message: "Review snapshot structure does not satisfy the strict contract",
  }));
}

function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

function appendNested(
  diagnostics: KnowledgeDiagnostic[],
  prefix: string,
  nested: readonly KnowledgeDiagnostic[]
): void {
  for (const diagnostic of nested) {
    diagnostics.push({
      ...diagnostic,
      field: diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
    });
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

function hasAffirmativeValidation(changeSet: KnowledgeChangeSet): boolean {
  return (
    changeSet.validation.okfValid &&
    changeSet.validation.citationsValid &&
    changeSet.validation.linksValid
  );
}

function appendManifestPlanCoverageDiagnostics(
  diagnostics: KnowledgeDiagnostic[],
  field: string,
  nested: readonly KnowledgeDiagnostic[]
): void {
  for (const diagnostic of nested) {
    const nestedField = diagnostic.field.startsWith("changeSet")
      ? diagnostic.field.replace(/^changeSet/, "proposal")
      : diagnostic.field
        ? `manifestCommitPlan.${diagnostic.field}`
        : "manifestCommitPlan";
    diagnostics.push({
      ...diagnostic,
      field: `${field}.${nestedField}`,
    });
  }
}

function validateManifestPlanBinding(
  record: ChangeSetReviewRecord,
  snapshot: ChangeSetReviewSnapshot,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  const plan = record.manifestCommitPlan;
  const planValidation = validateManifestCommitPlan(plan);
  const coverage = validateManifestCommitPlanForChangeSet(plan, record.proposal);
  appendManifestPlanCoverageDiagnostics(diagnostics, field, coverage.diagnostics);
  if (
    planValidation.valid &&
    record.manifestCommitPlanDigest !== createManifestCommitPlanDigest(plan)
  ) {
    addError(
      diagnostics,
      "review_manifest_plan_digest_mismatch",
      `${field}.manifestCommitPlanDigest`,
      "Manifest commit plan digest must identify the exact persisted plan"
    );
  }
  if (
    plan.bundleId !== snapshot.bundleId ||
    plan.changeSetId !== record.changeSetId ||
    plan.sourceId !== record.jobClaim.sourceId ||
    plan.sourceContentHash !== record.jobClaim.sourceContentHash ||
    plan.pipelineFingerprint !== record.jobClaim.pipelineFingerprint ||
    plan.inputRevision !== record.jobClaim.inputRevision
  ) {
    addError(
      diagnostics,
      "review_manifest_plan_identity_mismatch",
      `${field}.manifestCommitPlan`,
      "Manifest commit plan must match the Review, Bundle, exact source content, pipeline, and input revision"
    );
  }
  if (record.proposal.operation !== getManifestCommitPlanOperation(plan)) {
    addError(
      diagnostics,
      "review_manifest_plan_operation_mismatch",
      `${field}.proposal.operation`,
      "Proposal operation must match the exact source-compile Manifest plan"
    );
  }
}

function validateAcceptedManifestIntent(
  record: AcceptedChangeSetReviewRecord,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  const intent = record.manifestCommitIntent;
  const intentValidation = validateManifestCommitIntent(intent);
  appendNested(diagnostics, `${field}.manifestCommitIntent`, intentValidation.diagnostics);
  if (
    intentValidation.valid &&
    record.manifestCommitIntentDigest !== createManifestCommitIntentDigest(intent)
  ) {
    addError(
      diagnostics,
      "review_manifest_intent_digest_mismatch",
      `${field}.manifestCommitIntentDigest`,
      "Manifest commit intent digest must identify the exact accepted projection"
    );
  }
  let expected: ManifestCommitIntent;
  try {
    expected = projectManifestCommitIntent(record.manifestCommitPlan, record.acceptedChangeSet);
  } catch {
    addError(
      diagnostics,
      "review_manifest_intent_projection_invalid",
      `${field}.manifestCommitIntent`,
      "Accepted ChangeSet cannot be projected from its immutable Manifest plan"
    );
    return;
  }
  if (!sameJson(intent, expected)) {
    addError(
      diagnostics,
      "review_manifest_intent_projection_mismatch",
      `${field}.manifestCommitIntent`,
      "Persisted Manifest intent must equal the exact accepted ChangeSet projection"
    );
  }
}

function validateAcceptedRecord(
  record: AcceptedChangeSetReviewRecord,
  field: string,
  diagnostics: KnowledgeDiagnostic[]
): void {
  const accepted = record.acceptedChangeSet;
  const proposal = record.proposal;
  validateAcceptedManifestIntent(record, field, diagnostics);
  appendNested(
    diagnostics,
    `${field}.acceptedChangeSet`,
    validateKnowledgeChangeSet(accepted).diagnostics
  );

  if (accepted.status !== "accepted") {
    addError(
      diagnostics,
      "review_accepted_status_invalid",
      `${field}.acceptedChangeSet.status`,
      "A durable accepted payload must have accepted status"
    );
  }
  if (!hasAffirmativeValidation(accepted)) {
    addError(
      diagnostics,
      "review_accepted_validation_invalid",
      `${field}.acceptedChangeSet.validation`,
      "A durable accepted payload must retain affirmative deterministic validation"
    );
  }
  if (
    accepted.bundleId !== proposal.bundleId ||
    accepted.id !== proposal.id ||
    accepted.operation !== proposal.operation ||
    accepted.createdAt !== proposal.createdAt
  ) {
    addError(
      diagnostics,
      "review_accepted_identity_mismatch",
      `${field}.acceptedChangeSet`,
      "Accepted payload identity must match its exact proposal"
    );
  }
  if (!sameJson(accepted.sourceRefs, proposal.sourceRefs)) {
    addError(
      diagnostics,
      "review_accepted_provenance_mismatch",
      `${field}.acceptedChangeSet.sourceRefs`,
      "Accepted payload source provenance must match its exact proposal"
    );
  }
  if (!sameJson(accepted.citations, proposal.citations)) {
    addError(
      diagnostics,
      "review_accepted_citations_mismatch",
      `${field}.acceptedChangeSet.citations`,
      "Accepted payload citations must match its exact proposal"
    );
  }
  if (accepted.changes.some((change) => change.operation === "delete")) {
    addError(
      diagnostics,
      "review_accepted_delete_disabled",
      `${field}.acceptedChangeSet.changes`,
      "Delete acceptance is disabled until manifest authorization is revalidated at apply time"
    );
  }

  const proposedById = new Map(
    proposal.changes.map((change, index) => [change.id, { change, index }] as const)
  );
  let previousProposalIndex = -1;
  accepted.changes.forEach((change, index) => {
    const proposed = proposedById.get(change.id);
    const changeField = `${field}.acceptedChangeSet.changes[${index}]`;
    if (!proposed) {
      addError(
        diagnostics,
        "review_accepted_change_unknown",
        `${changeField}.id`,
        "Accepted payload may contain only proposal-owned changes"
      );
      return;
    }
    if (proposed.index <= previousProposalIndex) {
      addError(
        diagnostics,
        "review_accepted_change_order_invalid",
        `${changeField}.id`,
        "Accepted changes must preserve proposal order"
      );
    }
    previousProposalIndex = proposed.index;
    const original = proposed.change;
    const stableFieldsMatch =
      change.path === original.path &&
      change.operation === original.operation &&
      change.reason === original.reason &&
      sameJson(change.sourceRefs, original.sourceRefs);
    const preconditionMatches =
      change.operation === "create"
        ? original.operation === "create" && change.expectedAbsent === original.expectedAbsent
        : change.operation === "update"
          ? original.operation === "update" && change.beforeHash === original.beforeHash
          : original.operation === "delete" && change.beforeHash === original.beforeHash;
    if (!stableFieldsMatch || !preconditionMatches) {
      addError(
        diagnostics,
        "review_accepted_change_identity_mismatch",
        changeField,
        "Accepted change target and provenance must match its proposal-owned change"
      );
    }
  });

  if (record.acceptedDigest !== createChangeSetTransactionDigest(accepted)) {
    addError(
      diagnostics,
      "review_accepted_digest_mismatch",
      `${field}.acceptedDigest`,
      "Accepted digest must identify the exact accepted ChangeSet"
    );
  }
  if (record.acceptedAt < record.recordedAt) {
    addError(
      diagnostics,
      "review_accepted_timestamp_invalid",
      `${field}.acceptedAt`,
      "Accepted time cannot precede proposal persistence"
    );
  }
}

export function validateChangeSetReviewSnapshot(
  snapshot: ChangeSetReviewSnapshot
): KnowledgeValidationResult {
  const diagnostics: KnowledgeDiagnostic[] = [];
  const changeSetIds = new Set<string>();
  const jobIds = new Set<string>();

  snapshot.records.forEach((record, index) => {
    const field = `records[${index}]`;
    if (changeSetIds.has(record.changeSetId)) {
      addError(
        diagnostics,
        "review_changeset_id_duplicate",
        `${field}.changeSetId`,
        "A review snapshot may contain each ChangeSet id only once"
      );
    }
    changeSetIds.add(record.changeSetId);
    if (jobIds.has(record.jobClaim.jobId)) {
      addError(
        diagnostics,
        "review_job_id_duplicate",
        `${field}.jobClaim.jobId`,
        "A durable queue job may own only one review proposal"
      );
    }
    jobIds.add(record.jobClaim.jobId);

    appendNested(
      diagnostics,
      `${field}.proposal`,
      validateKnowledgeChangeSet(record.proposal).diagnostics
    );
    if (
      record.changeSetId !== record.proposal.id ||
      record.proposal.bundleId !== snapshot.bundleId
    ) {
      addError(
        diagnostics,
        "review_proposal_identity_mismatch",
        `${field}.proposal`,
        "Proposal id and Bundle must match their durable review record"
      );
    }
    if (record.proposal.status !== "proposed") {
      addError(
        diagnostics,
        "review_proposal_status_invalid",
        `${field}.proposal.status`,
        "Review storage accepts only proposed ChangeSets as proposals"
      );
    }
    if (!hasAffirmativeValidation(record.proposal)) {
      addError(
        diagnostics,
        "review_proposal_validation_invalid",
        `${field}.proposal.validation`,
        "A review proposal must have affirmative deterministic validation"
      );
    }
    if (record.proposalDigest !== createChangeSetTransactionDigest(record.proposal)) {
      addError(
        diagnostics,
        "review_proposal_digest_mismatch",
        `${field}.proposalDigest`,
        "Proposal digest must identify the exact proposed ChangeSet"
      );
    }
    validateManifestPlanBinding(record, snapshot, field, diagnostics);
    if (!record.proposal.sourceRefs.includes(record.jobClaim.sourceId)) {
      addError(
        diagnostics,
        "review_claim_source_unknown",
        `${field}.jobClaim.sourceId`,
        "Review job source must be declared by the proposal"
      );
    }
    if (record.recordedAt < record.proposal.createdAt) {
      addError(
        diagnostics,
        "review_recorded_timestamp_invalid",
        `${field}.recordedAt`,
        "Proposal persistence cannot precede ChangeSet creation"
      );
    }

    if (record.outcome === "accepted") {
      validateAcceptedRecord(record, field, diagnostics);
    } else if (record.outcome === "rejected") {
      if (record.rejectedAt < record.recordedAt) {
        addError(
          diagnostics,
          "review_rejected_timestamp_invalid",
          `${field}.rejectedAt`,
          "Rejected time cannot precede proposal persistence"
        );
      }
    }
  });

  return { valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), diagnostics };
}

export function parseChangeSetReviewSnapshot(
  value: unknown
): KnowledgeParseResult<ChangeSetReviewSnapshot> {
  const parsed = changeSetReviewSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: mapSchemaIssues(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
