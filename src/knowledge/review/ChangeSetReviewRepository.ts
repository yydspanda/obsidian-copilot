import {
  ReviewStorageAcceptanceBlockedError,
  ReviewStorageRevisionConflictError,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewJobClaim,
  type ChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  type PendingChangeSetReviewRecord,
  type ReviewStorage,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  manifestCommitPlanSchema,
  projectManifestCommitIntent,
  validateManifestCommitPlan,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type { JsonValue, KnowledgeChangeSet, KnowledgeDiagnostic } from "@/knowledge/model/types";
import { validateKnowledgeChangeSet } from "@/knowledge/model/validation";

const DEFAULT_MAX_WRITE_ATTEMPTS = 3;

export interface SaveChangeSetProposalInput {
  proposal: unknown;
  proposalDigest: string;
  manifestCommitPlan: unknown;
  manifestCommitPlanDigest: string;
  jobClaim: ChangeSetReviewJobClaim;
}

export class ChangeSetReviewValidationError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`ChangeSet reviews for '${bundleId}' do not satisfy the current contract`);
    this.name = "ChangeSetReviewValidationError";
  }
}

export class ChangeSetReviewIncompatibleVersionError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly version: string | number | null | undefined
  ) {
    super(`ChangeSet reviews for '${bundleId}' use an unsupported version`);
    this.name = "ChangeSetReviewIncompatibleVersionError";
  }
}

export class ChangeSetReviewBundleMismatchError extends Error {
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`ChangeSet reviews stored for '${requestedBundleId}' belong to '${storedBundleId}'`);
    this.name = "ChangeSetReviewBundleMismatchError";
  }
}

export class ChangeSetReviewIdentityConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly changeSetId: string
  ) {
    super(`ChangeSet review '${changeSetId}' conflicts with existing state in '${bundleId}'`);
    this.name = "ChangeSetReviewIdentityConflictError";
  }
}

export class ChangeSetReviewNotFoundError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly changeSetId: string
  ) {
    super(`ChangeSet review '${changeSetId}' is not present in '${bundleId}'`);
    this.name = "ChangeSetReviewNotFoundError";
  }
}

export class ChangeSetReviewRecordRevisionConflictError extends Error {
  constructor(
    public readonly changeSetId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(`ChangeSet review '${changeSetId}' changed after record revision ${expectedRevision}`);
    this.name = "ChangeSetReviewRecordRevisionConflictError";
  }
}

export class ChangeSetReviewDecisionConflictError extends Error {
  constructor(
    public readonly changeSetId: string,
    public readonly outcome: "accepted" | "rejected"
  ) {
    super(`ChangeSet review '${changeSetId}' already has a different durable decision`);
    this.name = "ChangeSetReviewDecisionConflictError";
  }
}

export class ChangeSetReviewRevisionOverflowError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly scope: "snapshot",
    public readonly revision: number
  ) {
    super(`ChangeSet review ${scope} revision cannot advance in '${bundleId}'`);
    this.name = "ChangeSetReviewRevisionOverflowError";
  }
}

export class ChangeSetReviewWriteConflictExhaustedError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: ReviewStorageRevisionConflictError
  ) {
    super(`ChangeSet reviews for '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "ChangeSetReviewWriteConflictExhaustedError";
  }
}

export class ChangeSetReviewInfrastructureError extends Error {
  constructor(public readonly stage: "storage_read" | "storage_write") {
    super(`ChangeSet review infrastructure failed during ${stage}`);
    this.name = "ChangeSetReviewInfrastructureError";
  }
}

interface LoadedReviewSnapshot {
  snapshot: ChangeSetReviewSnapshot;
  expectedRevision: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeVersion(value: unknown): string | number | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertRecordRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
}

function assertDigest(value: string, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function createEmptySnapshot(bundleId: string): ChangeSetReviewSnapshot {
  return { version: 2, bundleId, revision: 0, records: [] };
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

function sanitizeStructuralDiagnostics(
  diagnostics: readonly KnowledgeDiagnostic[]
): KnowledgeDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: "ChangeSet structure does not satisfy the strict review contract",
  }));
}

function sameJobClaim(left: ChangeSetReviewJobClaim, right: ChangeSetReviewJobClaim): boolean {
  return (
    left.jobId === right.jobId &&
    left.sourceId === right.sourceId &&
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.inputRevision === right.inputRevision &&
    left.attempt === right.attempt
  );
}

function parseChangeSetArgument(bundleId: string, value: unknown): KnowledgeChangeSet {
  const parsed = parseKnowledgeChangeSet(value);
  if (!parsed.ok) {
    throw new ChangeSetReviewValidationError(
      bundleId,
      sanitizeStructuralDiagnostics(parsed.issues)
    );
  }
  const semantic = validateKnowledgeChangeSet(parsed.value);
  if (!semantic.valid) {
    throw new ChangeSetReviewValidationError(bundleId, semantic.diagnostics);
  }
  return parsed.value;
}

function parseManifestCommitPlanArgument(bundleId: string, value: unknown): ManifestCommitPlan {
  const parsed = manifestCommitPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChangeSetReviewValidationError(bundleId, [
      {
        code: "review_manifest_plan_schema_invalid",
        severity: "error",
        field: "manifestCommitPlan",
        message: "Manifest commit plan structure does not satisfy the strict review contract",
      },
    ]);
  }
  const semantic = validateManifestCommitPlan(parsed.data);
  if (!semantic.valid) {
    throw new ChangeSetReviewValidationError(
      bundleId,
      semantic.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        field: diagnostic.field ? `manifestCommitPlan.${diagnostic.field}` : "manifestCommitPlan",
      }))
    );
  }
  return parsed.data;
}

function requireReviewRecord(
  snapshot: ChangeSetReviewSnapshot,
  changeSetId: string
): ChangeSetReviewRecord {
  const record = snapshot.records.find((candidate) => candidate.changeSetId === changeSetId);
  if (!record) {
    throw new ChangeSetReviewNotFoundError(snapshot.bundleId, changeSetId);
  }
  return record;
}

function replaceReviewRecord(
  snapshot: ChangeSetReviewSnapshot,
  nextRecord: ChangeSetReviewRecord
): ChangeSetReviewSnapshot {
  return {
    ...snapshot,
    records: snapshot.records.map((record) =>
      record.changeSetId === nextRecord.changeSetId ? nextRecord : record
    ),
  };
}

export class ChangeSetReviewRepository {
  private readonly maxWriteAttempts: number;
  private readonly clock: () => number;

  constructor(
    private readonly storage: ReviewStorage,
    options: { maxWriteAttempts?: number; clock?: () => number } = {}
  ) {
    this.maxWriteAttempts = options.maxWriteAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
    this.clock = options.clock ?? Date.now;
    if (!Number.isSafeInteger(this.maxWriteAttempts) || this.maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive safe integer");
    }
    Object.freeze(this);
  }

  async load(bundleId: string): Promise<ChangeSetReviewSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedSnapshot(bundleId, loaded.snapshot);
  }

  async get(bundleId: string, changeSetId: string): Promise<ChangeSetReviewRecord | undefined> {
    assertIdentifier(changeSetId, "changeSetId");
    const snapshot = await this.load(bundleId);
    return snapshot.records.find((record) => record.changeSetId === changeSetId);
  }

  async saveProposal(
    bundleId: string,
    input: SaveChangeSetProposalInput
  ): Promise<ChangeSetReviewRecord> {
    assertIdentifier(bundleId, "bundleId");
    assertDigest(input.proposalDigest, "proposalDigest");
    assertDigest(input.manifestCommitPlanDigest, "manifestCommitPlanDigest");
    const proposal = parseChangeSetArgument(bundleId, input.proposal);
    const manifestCommitPlan = parseManifestCommitPlanArgument(bundleId, input.manifestCommitPlan);
    const recordedAt = this.now();
    const pending: PendingChangeSetReviewRecord = {
      changeSetId: proposal.id,
      recordRevision: 0,
      proposal,
      proposalDigest: input.proposalDigest,
      manifestCommitPlan,
      manifestCommitPlanDigest: input.manifestCommitPlanDigest,
      jobClaim: { ...input.jobClaim },
      recordedAt,
      outcome: "pending",
    };
    this.cloneValidatedSnapshot(bundleId, {
      version: 2,
      bundleId,
      revision: 0,
      records: [pending],
    });

    const snapshot = await this.mutate(bundleId, (current) => {
      const byChangeSet = current.records.find(
        (record) => record.changeSetId === pending.changeSetId
      );
      const byJob = current.records.find(
        (record) => record.jobClaim.jobId === pending.jobClaim.jobId
      );
      if (byChangeSet || byJob) {
        const existing = byChangeSet ?? byJob;
        if (
          existing &&
          existing.changeSetId === pending.changeSetId &&
          existing.proposalDigest === pending.proposalDigest &&
          existing.manifestCommitPlanDigest === pending.manifestCommitPlanDigest &&
          sameJson(existing.proposal, pending.proposal) &&
          sameJson(existing.manifestCommitPlan, pending.manifestCommitPlan) &&
          sameJobClaim(existing.jobClaim, pending.jobClaim)
        ) {
          return undefined;
        }
        throw new ChangeSetReviewIdentityConflictError(bundleId, pending.changeSetId);
      }
      return { ...current, records: [...current.records, pending] };
    });
    return requireReviewRecord(snapshot, pending.changeSetId);
  }

  async accept(
    bundleId: string,
    changeSetId: string,
    expectedRecordRevision: number,
    proposalDigest: string,
    value: unknown
  ): Promise<AcceptedChangeSetReviewRecord> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(changeSetId, "changeSetId");
    assertRecordRevision(expectedRecordRevision, "expectedRecordRevision");
    assertDigest(proposalDigest, "proposalDigest");
    const acceptedChangeSet = parseChangeSetArgument(bundleId, value);
    const acceptedDigest = createChangeSetTransactionDigest(acceptedChangeSet);
    const acceptedAt = this.now();

    const snapshot = await this.mutate(bundleId, (current) => {
      const record = requireReviewRecord(current, changeSetId);
      this.assertProposalDigest(record, proposalDigest);
      if (record.outcome === "accepted") {
        if (
          record.acceptedDigest === acceptedDigest &&
          sameJson(record.acceptedChangeSet, acceptedChangeSet)
        ) {
          return undefined;
        }
        throw new ChangeSetReviewDecisionConflictError(changeSetId, "accepted");
      }
      if (record.outcome === "rejected") {
        throw new ChangeSetReviewDecisionConflictError(changeSetId, "rejected");
      }
      this.assertExpectedRecordRevision(record, expectedRecordRevision);
      let manifestCommitIntent;
      try {
        manifestCommitIntent = projectManifestCommitIntent(
          record.manifestCommitPlan,
          acceptedChangeSet
        );
      } catch {
        throw new ChangeSetReviewValidationError(bundleId, [
          {
            code: "review_manifest_intent_projection_invalid",
            severity: "error",
            field: "manifestCommitIntent",
            message: "Accepted ChangeSet cannot be projected from its immutable Manifest plan",
          },
        ]);
      }
      const accepted: AcceptedChangeSetReviewRecord = {
        ...record,
        recordRevision: 1,
        outcome: "accepted",
        acceptedChangeSet,
        acceptedDigest,
        manifestCommitIntent,
        manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
        acceptedAt: Math.max(acceptedAt, record.recordedAt),
      };
      return replaceReviewRecord(current, accepted);
    });
    const record = requireReviewRecord(snapshot, changeSetId);
    if (record.outcome !== "accepted") {
      throw new ChangeSetReviewIdentityConflictError(bundleId, changeSetId);
    }
    return record;
  }

  async reject(
    bundleId: string,
    changeSetId: string,
    expectedRecordRevision: number,
    proposalDigest: string
  ): Promise<Extract<ChangeSetReviewRecord, { outcome: "rejected" }>> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(changeSetId, "changeSetId");
    assertRecordRevision(expectedRecordRevision, "expectedRecordRevision");
    assertDigest(proposalDigest, "proposalDigest");
    const rejectedAt = this.now();

    const snapshot = await this.mutate(bundleId, (current) => {
      const record = requireReviewRecord(current, changeSetId);
      this.assertProposalDigest(record, proposalDigest);
      if (record.outcome === "rejected") {
        return undefined;
      }
      if (record.outcome === "accepted") {
        throw new ChangeSetReviewDecisionConflictError(changeSetId, "accepted");
      }
      this.assertExpectedRecordRevision(record, expectedRecordRevision);
      return replaceReviewRecord(current, {
        ...record,
        recordRevision: 1,
        outcome: "rejected",
        rejectedAt: Math.max(rejectedAt, record.recordedAt),
      });
    });
    const record = requireReviewRecord(snapshot, changeSetId);
    if (record.outcome !== "rejected") {
      throw new ChangeSetReviewIdentityConflictError(bundleId, changeSetId);
    }
    return record;
  }

  private assertProposalDigest(record: ChangeSetReviewRecord, proposalDigest: string): void {
    if (record.proposalDigest !== proposalDigest) {
      throw new ChangeSetReviewIdentityConflictError(record.proposal.bundleId, record.changeSetId);
    }
  }

  private assertExpectedRecordRevision(
    record: PendingChangeSetReviewRecord,
    expectedRecordRevision: number
  ): void {
    if (record.recordRevision !== expectedRecordRevision) {
      throw new ChangeSetReviewRecordRevisionConflictError(
        record.changeSetId,
        expectedRecordRevision,
        record.recordRevision
      );
    }
  }

  private async loadForMutation(bundleId: string): Promise<LoadedReviewSnapshot> {
    let raw: unknown;
    try {
      raw = await this.storage.read(bundleId);
    } catch {
      throw new ChangeSetReviewInfrastructureError("storage_read");
    }
    if (raw === null) {
      return { snapshot: createEmptySnapshot(bundleId), expectedRevision: null };
    }
    if (isRecord(raw) && "version" in raw && raw.version !== 2) {
      throw new ChangeSetReviewIncompatibleVersionError(bundleId, sanitizeVersion(raw.version));
    }
    const snapshot = this.cloneValidatedSnapshot(bundleId, raw);
    if (snapshot.bundleId !== bundleId) {
      throw new ChangeSetReviewBundleMismatchError(bundleId, snapshot.bundleId);
    }
    return { snapshot, expectedRevision: snapshot.revision };
  }

  private async mutate(
    bundleId: string,
    transform: (snapshot: ChangeSetReviewSnapshot) => ChangeSetReviewSnapshot | undefined
  ): Promise<ChangeSetReviewSnapshot> {
    let lastConflict: ReviewStorageRevisionConflictError | undefined;
    for (let attempt = 0; attempt < this.maxWriteAttempts; attempt += 1) {
      const loaded = await this.loadForMutation(bundleId);
      const proposed = transform(loaded.snapshot);
      if (!proposed) {
        return this.cloneValidatedSnapshot(bundleId, loaded.snapshot);
      }
      if (loaded.snapshot.revision >= Number.MAX_SAFE_INTEGER) {
        throw new ChangeSetReviewRevisionOverflowError(
          bundleId,
          "snapshot",
          loaded.snapshot.revision
        );
      }
      const next = this.cloneValidatedSnapshot(bundleId, {
        ...proposed,
        version: 2,
        bundleId,
        revision: loaded.snapshot.revision + 1,
      });
      try {
        await this.storage.write(bundleId, next, loaded.expectedRevision);
        return this.cloneValidatedSnapshot(bundleId, next);
      } catch (error) {
        // Preserve the safe pause result so callers do not mistake unchanged Review
        // state for a storage failure. https://github.com/yydspanda/obsidian-copilot/issues/6
        if (error instanceof ReviewStorageAcceptanceBlockedError) throw error;
        if (error instanceof ReviewStorageRevisionConflictError) {
          lastConflict = error;
          continue;
        }
        throw new ChangeSetReviewInfrastructureError("storage_write");
      }
    }
    throw new ChangeSetReviewWriteConflictExhaustedError(
      bundleId,
      this.maxWriteAttempts,
      lastConflict ?? new ReviewStorageRevisionConflictError(bundleId, null)
    );
  }

  private cloneValidatedSnapshot(bundleId: string, value: unknown): ChangeSetReviewSnapshot {
    const parsed = parseChangeSetReviewSnapshot(value);
    if (!parsed.ok) {
      throw new ChangeSetReviewValidationError(bundleId, parsed.issues);
    }
    const semantic = validateChangeSetReviewSnapshot(parsed.value);
    if (!semantic.valid) {
      throw new ChangeSetReviewValidationError(bundleId, semantic.diagnostics);
    }
    return parsed.value;
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("clock must return a non-negative safe integer");
    }
    return value;
  }
}
