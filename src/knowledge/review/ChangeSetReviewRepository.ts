import {
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

/** Exact proposal and queue claim supplied at the review persistence boundary. */
export interface SaveChangeSetProposalInput {
  proposal: unknown;
  proposalDigest: string;
  manifestCommitPlan: unknown;
  manifestCommitPlanDigest: string;
  jobClaim: ChangeSetReviewJobClaim;
}

/** Reports persisted review JSON that does not satisfy the strict v2 contract. */
export class ChangeSetReviewValidationError extends Error {
  /**
   * Creates a safe review validation failure.
   *
   * @param bundleId - Bundle whose review data failed validation
   * @param diagnostics - Safe structural or semantic diagnostics
   */
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`ChangeSet reviews for '${bundleId}' do not satisfy the current contract`);
    this.name = "ChangeSetReviewValidationError";
  }
}

/** Reports a persisted review snapshot version unsupported by this runtime. */
export class ChangeSetReviewIncompatibleVersionError extends Error {
  /**
   * Creates an incompatible review version failure without retaining raw JSON.
   *
   * @param bundleId - Bundle whose persisted version is unsupported
   * @param version - Sanitized primitive version value
   */
  constructor(
    public readonly bundleId: string,
    public readonly version: string | number | null | undefined
  ) {
    super(`ChangeSet reviews for '${bundleId}' use an unsupported version`);
    this.name = "ChangeSetReviewIncompatibleVersionError";
  }
}

/** Reports a storage key whose review snapshot declares another Bundle. */
export class ChangeSetReviewBundleMismatchError extends Error {
  /**
   * Creates a Bundle identity mismatch.
   *
   * @param requestedBundleId - Bundle used to access storage
   * @param storedBundleId - Bundle declared by persisted state
   */
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`ChangeSet reviews stored for '${requestedBundleId}' belong to '${storedBundleId}'`);
    this.name = "ChangeSetReviewBundleMismatchError";
  }
}

/** Reports reuse of one proposal or queue identity for different exact material. */
export class ChangeSetReviewIdentityConflictError extends Error {
  /**
   * Creates a fail-closed review identity conflict.
   *
   * @param bundleId - Bundle containing the conflicting identity
   * @param changeSetId - Proposal identity requested by the caller
   */
  constructor(
    public readonly bundleId: string,
    public readonly changeSetId: string
  ) {
    super(`ChangeSet review '${changeSetId}' conflicts with existing state in '${bundleId}'`);
    this.name = "ChangeSetReviewIdentityConflictError";
  }
}

/** Reports a decision targeting a proposal absent from durable review state. */
export class ChangeSetReviewNotFoundError extends Error {
  /**
   * Creates a missing proposal failure.
   *
   * @param bundleId - Bundle expected to contain the proposal
   * @param changeSetId - Missing ChangeSet identity
   */
  constructor(
    public readonly bundleId: string,
    public readonly changeSetId: string
  ) {
    super(`ChangeSet review '${changeSetId}' is not present in '${bundleId}'`);
    this.name = "ChangeSetReviewNotFoundError";
  }
}

/** Reports an optimistic decision against a stale record revision. */
export class ChangeSetReviewRecordRevisionConflictError extends Error {
  /**
   * Creates a record-level optimistic concurrency conflict.
   *
   * @param changeSetId - Proposal whose record changed
   * @param expectedRevision - Revision supplied by the review surface
   * @param actualRevision - Current durable record revision
   */
  constructor(
    public readonly changeSetId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(`ChangeSet review '${changeSetId}' changed after record revision ${expectedRevision}`);
    this.name = "ChangeSetReviewRecordRevisionConflictError";
  }
}

/** Reports an attempt to replace an already durable terminal decision. */
export class ChangeSetReviewDecisionConflictError extends Error {
  /**
   * Creates a terminal review decision conflict.
   *
   * @param changeSetId - Proposal whose decision is immutable
   * @param outcome - Already durable terminal outcome
   */
  constructor(
    public readonly changeSetId: string,
    public readonly outcome: "accepted" | "rejected"
  ) {
    super(`ChangeSet review '${changeSetId}' already has a different durable decision`);
    this.name = "ChangeSetReviewDecisionConflictError";
  }
}

/** Reports review snapshot revision exhaustion. */
export class ChangeSetReviewRevisionOverflowError extends Error {
  /**
   * Creates a safe-integer revision overflow failure.
   *
   * @param bundleId - Bundle whose review state cannot advance
   * @param scope - Persisted revision scope
   * @param revision - Last exactly represented revision
   */
  constructor(
    public readonly bundleId: string,
    public readonly scope: "snapshot",
    public readonly revision: number
  ) {
    super(`ChangeSet review ${scope} revision cannot advance in '${bundleId}'`);
    this.name = "ChangeSetReviewRevisionOverflowError";
  }
}

/** Reports exhausted bounded retries after repeated storage CAS conflicts. */
export class ChangeSetReviewWriteConflictExhaustedError extends Error {
  /**
   * Creates an exhausted optimistic write failure.
   *
   * @param bundleId - Bundle whose snapshot could not converge
   * @param attempts - Attempted read-transform-write cycles
   * @param conflict - Last safe storage conflict
   */
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: ReviewStorageRevisionConflictError
  ) {
    super(`ChangeSet reviews for '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "ChangeSetReviewWriteConflictExhaustedError";
  }
}

/** Reports unavailable review storage without retaining its raw exception. */
export class ChangeSetReviewInfrastructureError extends Error {
  /**
   * Creates a sanitized storage infrastructure failure.
   *
   * @param stage - Storage operation that failed
   */
  constructor(public readonly stage: "storage_read" | "storage_write") {
    super(`ChangeSet review infrastructure failed during ${stage}`);
    this.name = "ChangeSetReviewInfrastructureError";
  }
}

/** Parsed snapshot paired with the storage revision expected by its next write. */
interface LoadedReviewSnapshot {
  snapshot: ChangeSetReviewSnapshot;
  expectedRevision: number | null;
}

/**
 * Checks whether an unknown value is a non-array record.
 *
 * @param value - Runtime value to inspect
 * @returns Whether named properties can be read safely
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sanitizes an unsupported persisted version for typed reporting.
 *
 * @param value - Untrusted persisted version
 * @returns Primitive version or a type-only placeholder
 */
function sanitizeVersion(value: unknown): string | number | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

/**
 * Requires a non-whitespace identifier.
 *
 * @param value - Boundary identifier
 * @param field - Identifier field name
 */
function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * Requires one non-negative safe integer record revision.
 *
 * @param value - Revision supplied by a review surface
 * @param field - Revision field name
 */
function assertRecordRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
}

/**
 * Requires a lowercase SHA-256 digest.
 *
 * @param value - Digest supplied by a review surface
 * @param field - Digest field name
 */
function assertDigest(value: string, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

/**
 * Creates a detached empty snapshot without persisting it eagerly.
 *
 * @param bundleId - Stable Bundle identifier
 * @returns Empty revision-zero review snapshot
 */
function createEmptySnapshot(bundleId: string): ChangeSetReviewSnapshot {
  return { version: 2, bundleId, revision: 0, records: [] };
}

/**
 * Compares strict JSON values independently of key insertion order.
 *
 * @param left - First JSON-compatible value
 * @param right - Second JSON-compatible value
 * @returns Whether both have identical canonical JSON
 */
function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

/**
 * Removes parser-authored messages that may repeat malicious unknown key names.
 *
 * @param diagnostics - Structural ChangeSet parse issues
 * @returns Stable issues retaining only safe codes and field locations
 */
function sanitizeStructuralDiagnostics(
  diagnostics: readonly KnowledgeDiagnostic[]
): KnowledgeDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: "ChangeSet structure does not satisfy the strict review contract",
  }));
}

/**
 * Compares every immutable queue-claim field.
 *
 * @param left - First review job claim
 * @param right - Second review job claim
 * @returns Whether both identify one exact queue input and attempt
 */
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

/**
 * Strictly parses and semantically validates one ChangeSet argument.
 *
 * @param bundleId - Bundle used for safe error reporting
 * @param value - Unknown proposal or accepted payload
 * @returns Detached strict ChangeSet
 */
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

/**
 * Strictly parses and semantically validates one compiler-owned Manifest plan.
 *
 * @param bundleId - Bundle used for safe error reporting
 * @param value - Unknown plan supplied by the compiler orchestration boundary
 * @returns Detached strict Manifest plan
 */
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

/**
 * Finds one durable review record or fails closed.
 *
 * @param snapshot - Current validated review snapshot
 * @param changeSetId - Proposal identifier to locate
 * @returns Existing durable record
 */
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

/**
 * Replaces one record without mutating the current snapshot.
 *
 * @param snapshot - Current validated review snapshot
 * @param nextRecord - Complete record replacement
 * @returns Immutable snapshot proposal with unchanged global revision
 */
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

/**
 * Persists immutable proposals and exactly one durable review decision.
 *
 * Every mutation reloads and reapplies a deterministic transform after storage
 * CAS contention. Returned records and snapshots are detached strict clones.
 */
export class ChangeSetReviewRepository {
  private readonly maxWriteAttempts: number;
  private readonly clock: () => number;

  /**
   * Creates a review repository over an atomic storage adapter.
   *
   * @param storage - Per-Bundle complete snapshot persistence port
   * @param options - Bounded write attempts and deterministic clock
   */
  constructor(
    private readonly storage: ReviewStorage,
    options: { maxWriteAttempts?: number; clock?: () => number } = {}
  ) {
    this.maxWriteAttempts = options.maxWriteAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
    this.clock = options.clock ?? Date.now;
    if (!Number.isSafeInteger(this.maxWriteAttempts) || this.maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive safe integer");
    }
  }

  /**
   * Loads one detached strict review snapshot without creating storage eagerly.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Persisted snapshot or an empty revision-zero snapshot
   */
  async load(bundleId: string): Promise<ChangeSetReviewSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedSnapshot(bundleId, loaded.snapshot);
  }

  /**
   * Loads one detached durable review record when present.
   *
   * @param bundleId - Stable Bundle identifier
   * @param changeSetId - Proposal identifier
   * @returns Detached record or undefined
   */
  async get(bundleId: string, changeSetId: string): Promise<ChangeSetReviewRecord | undefined> {
    assertIdentifier(changeSetId, "changeSetId");
    const snapshot = await this.load(bundleId);
    return snapshot.records.find((record) => record.changeSetId === changeSetId);
  }

  /**
   * Saves one exact proposed ChangeSet and owning queue claim idempotently.
   *
   * Reusing either ChangeSet id or queue job id with different exact proposal
   * material or claim identity fails closed.
   *
   * @param bundleId - Stable Bundle identifier
   * @param input - Exact proposal, compiler digest, and queue job identity
   * @returns Detached pending or already-decided durable record
   */
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

  /**
   * Atomically accepts one exact proposal or replays an identical acceptance.
   *
   * The accepted payload may filter proposal changes or rewrite create/update
   * content, but review storage revalidates immutable identity and provenance.
   * Any accepted delete fails closed.
   *
   * @param bundleId - Stable Bundle identifier
   * @param changeSetId - Proposal identifier
   * @param expectedRecordRevision - Record revision observed by the reviewer
   * @param proposalDigest - Exact proposed payload identity observed by the reviewer
   * @param value - Exact accepted ChangeSet assembled by trusted review core
   * @returns Detached accepted record
   */
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

  /**
   * Atomically rejects one exact proposal or replays the same rejection.
   *
   * Rejection persists only its terminal outcome and time; it never fabricates
   * an empty accepted ChangeSet.
   *
   * @param bundleId - Stable Bundle identifier
   * @param changeSetId - Proposal identifier
   * @param expectedRecordRevision - Record revision observed by the reviewer
   * @param proposalDigest - Exact proposed payload identity observed by the reviewer
   * @returns Detached rejected record
   */
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

  /**
   * Validates the proposal digest observed by a decision command.
   *
   * @param record - Current durable review record
   * @param proposalDigest - Digest supplied by the caller
   */
  private assertProposalDigest(record: ChangeSetReviewRecord, proposalDigest: string): void {
    if (record.proposalDigest !== proposalDigest) {
      throw new ChangeSetReviewIdentityConflictError(record.proposal.bundleId, record.changeSetId);
    }
  }

  /**
   * Validates the optimistic record revision of a pending decision.
   *
   * @param record - Current pending review record
   * @param expectedRecordRevision - Revision observed by the caller
   */
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

  /**
   * Reads strict persisted state and enforces version and Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Validated snapshot and expected storage revision
   */
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

  /**
   * Applies one immutable transform with bounded optimistic retries.
   *
   * @param bundleId - Stable Bundle identifier
   * @param transform - Deterministic transform; undefined is an idempotent no-op
   * @returns Detached persisted or current snapshot
   */
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

  /**
   * Strictly parses, semantically validates, and detaches one snapshot.
   *
   * @param bundleId - Bundle used for safe error reporting
   * @param value - Unknown persisted or newly constructed snapshot
   * @returns Detached strict snapshot
   */
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

  /**
   * Reads a deterministic non-negative timestamp.
   *
   * @returns Safe timestamp supplied by the injected clock
   */
  private now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("clock must return a non-negative safe integer");
    }
    return value;
  }
}
