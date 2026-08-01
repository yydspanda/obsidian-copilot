import { ChangeSetTransactionRecoveryRequiredError } from "@/knowledge/changeset/ChangeSetTransaction";
import type { ApplyCommitReconciliationResult } from "@/knowledge/changeset/ApplyCommitCoordinator";
import {
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { parseKnowledgeBundleConfig } from "@/knowledge/model/schemas";
import type { KnowledgeBundleConfig, KnowledgeDiagnostic } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import {
  createNoJournalApplyRecoveryReference,
  type NoJournalApplyGlobalTransactionObservation,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoveryReference,
  type NoJournalApplyRecoverySnapshot,
  type NoJournalApplyRecoverySnapshotLoadResult,
  type NoJournalApplyRecoverySnapshotPort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import type {
  ReviewQueueStartupAction,
  ReviewQueueStartupReconciliationResult,
} from "@/knowledge/review/ReviewQueueStartupReconciler";

const DEFAULT_MAX_STARTUP_PASSES = 3;

/** Queue operation allowed before any new ingest claim can start. */
export interface KnowledgeStartupQueuePort {
  /** Recovers interrupted Queue execution and leaves durable backlog paused. */
  recoverOnStartup(bundleId: string): Promise<IngestQueueSnapshot>;
}

/** Existing committed or unfinished transaction reconciliation boundary. */
export interface KnowledgeStartupApplyCommitPort {
  /** Rolls forward exact journal evidence and completes downstream bookkeeping. */
  reconcile(bundle: KnowledgeBundleConfig): Promise<ApplyCommitReconciliationResult>;
}

/** Review-to-Queue hand-off reconciliation boundary. */
export interface KnowledgeStartupReviewPort {
  /** Converges pending and rejected records without starting accepted applies. */
  reconcile(bundleId: string): Promise<ReviewQueueStartupReconciliationResult>;
}

/** Constructor dependencies for the adapter-driven startup recovery gate. */
export interface KnowledgeStartupGateDependencies {
  queue: KnowledgeStartupQueuePort;
  applyCommit: KnowledgeStartupApplyCommitPort;
  reviews: KnowledgeStartupReviewPort;
  accepted: NoJournalApplyRecoverySnapshotPort;
  maxStartupPasses?: number;
}

/** Non-authoritative outcome of one stable startup recovery observation. */
export type KnowledgeStartupGateDisposition = "observed_clear" | "attention_required" | "blocked";

/** Review hand-offs that startup durably converged without exposing accepted authority. */
export type KnowledgeStartupReviewReconciliation = Extract<
  ReviewQueueStartupAction,
  { kind: "pending_reconciled" | "rejection_reconciled" }
>;

/** Sanitized condition preventing the startup observation from being clear. */
export type KnowledgeStartupAttention =
  | {
      kind: "transaction_recovery_required";
      transactionId: string;
      changeSetId: string;
    }
  | {
      kind: "accepted_not_started";
      jobId: string;
      changeSetId: string;
    }
  | {
      kind: "no_journal_decision_required";
      reference: NoJournalApplyRecoveryReference;
      jobId: string;
      changeSetId: string;
    }
  | {
      kind: "transaction_active";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
      phase: "prepared" | "applying";
    }
  | {
      kind: "accepted_apply_blocked";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
      reason: "transaction_recovery_required" | "other_transaction_active";
    }
  | {
      kind: "commit_finalizing";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
    }
  | {
      kind: "global_transaction_observed";
      transactionId: string;
      ownerBundleId: string;
      changeSetId: string;
      phase: NoJournalApplyGlobalTransactionObservation["phase"];
    }
  | { kind: "queue_recovery_required" }
  | { kind: "queue_commit_pending_ack" };

/** Stable result rendered by a future Studio adapter while actions still re-prove authority. */
export interface KnowledgeStartupGateResult {
  bundleId: string;
  disposition: KnowledgeStartupGateDisposition;
  runtimeRevision: number;
  reviewRevision: number;
  queueSnapshot: IngestQueueSnapshot;
  globalTransaction: NoJournalApplyGlobalTransactionObservation | null;
  applyCommit: ApplyCommitReconciliationResult;
  reviewReconciliations: readonly KnowledgeStartupReviewReconciliation[];
  acceptedClassifications: readonly NoJournalApplyRecoveryClassification[];
  attention: readonly KnowledgeStartupAttention[];
}

/** Reports an invalid current Bundle boundary before any recovery port is called. */
export class KnowledgeStartupBundleValidationError extends TypeError {
  /** Creates a sanitized Bundle validation failure. */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("The current knowledge Bundle does not satisfy the startup contract");
    this.name = "KnowledgeStartupBundleValidationError";
  }
}

/** Reports a Queue adapter result that cannot be trusted by the startup gate. */
export class KnowledgeStartupQueueValidationError extends Error {
  /** Creates a sanitized Queue result validation failure. */
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`The recovered Queue for '${bundleId}' does not satisfy its durable contract`);
    this.name = "KnowledgeStartupQueueValidationError";
  }
}

/** Stable reason an injected startup boundary contradicted an earlier durable observation. */
export type KnowledgeStartupSnapshotConsistencyErrorReason =
  | "runtime_revision_regressed"
  | "queue_revision_regressed"
  | "queue_same_revision_mismatch";

/** Reports a non-monotonic or internally contradictory startup snapshot. */
export class KnowledgeStartupSnapshotConsistencyError extends Error {
  /** Creates a sanitized durable-snapshot consistency failure. */
  constructor(
    public readonly bundleId: string,
    public readonly reason: KnowledgeStartupSnapshotConsistencyErrorReason,
    public readonly observedRevision: number,
    public readonly actualRevision: number
  ) {
    super(`Knowledge startup snapshots for '${bundleId}' are not monotonic`);
    this.name = "KnowledgeStartupSnapshotConsistencyError";
  }
}

/** Reports failure to normalize one newly persisted sticky transaction conflict. */
export class KnowledgeStartupRecoveryNormalizationError extends Error {
  /** Creates a sanitized transaction-normalization failure. */
  constructor(
    public readonly expectedTransactionId: string,
    public readonly observedKind: ApplyCommitReconciliationResult["kind"],
    public readonly observedTransactionId?: string
  ) {
    super(`Transaction '${expectedTransactionId}' did not normalize to its durable blocked state`);
    this.name = "KnowledgeStartupRecoveryNormalizationError";
  }
}

/** Reports a missing, duplicated, or unrelated accepted Review classification. */
export class KnowledgeStartupAcceptedClassificationError extends Error {
  /** Creates a sanitized accepted-classification set mismatch. */
  constructor(
    public readonly bundleId: string,
    public readonly expectedCount: number,
    public readonly actualCount: number
  ) {
    super(`Accepted Review classifications for '${bundleId}' do not match the stable Review set`);
    this.name = "KnowledgeStartupAcceptedClassificationError";
  }
}

/** Reports persistent Review churn across the outer startup reconciliation loop. */
export class KnowledgeStartupGateUnstableError extends Error {
  /** Creates a bounded-retry exhaustion error. */
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number
  ) {
    super(`Knowledge startup state for '${bundleId}' changed during ${attempts} passes`);
    this.name = "KnowledgeStartupGateUnstableError";
  }
}

/** Strictly validates one current Bundle configuration. */
function parseStartupBundle(value: unknown): KnowledgeBundleConfig {
  const parsed = parseKnowledgeBundleConfig(value);
  if (!parsed.ok) {
    throw new KnowledgeStartupBundleValidationError(parsed.issues);
  }
  const validation = validateKnowledgeBundleConfig(parsed.value);
  if (!validation.valid) {
    throw new KnowledgeStartupBundleValidationError(validation.diagnostics);
  }
  return parsed.value;
}

/** Strictly validates a Queue result returned by an injected startup port. */
function parseStartupQueue(bundleId: string, value: unknown): IngestQueueSnapshot {
  const parsed = parseIngestQueueSnapshot(value);
  if (!parsed.ok) {
    throw new KnowledgeStartupQueueValidationError(bundleId, parsed.issues);
  }
  const validation = validateIngestQueueSnapshot(parsed.value);
  const diagnostics = [...validation.diagnostics];
  if (parsed.value.bundleId !== bundleId) {
    diagnostics.push({
      code: "queue_bundle_mismatch",
      severity: "error",
      field: "bundleId",
      message: "Recovered Queue belongs to another Bundle",
    });
  }
  if (diagnostics.length > 0) {
    throw new KnowledgeStartupQueueValidationError(bundleId, diagnostics);
  }
  return parsed.value;
}

/** Compares normalized Queue snapshots whose shared revision claims one exact state. */
function startupQueueSnapshotsMatch(
  left: IngestQueueSnapshot,
  right: IngestQueueSnapshot
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Rejects a final atomic Queue snapshot that predates or contradicts startup recovery. */
function assertQueueSnapshotProgression(
  bundleId: string,
  recovered: IngestQueueSnapshot,
  final: IngestQueueSnapshot
): void {
  if (final.revision < recovered.revision) {
    throw new KnowledgeStartupSnapshotConsistencyError(
      bundleId,
      "queue_revision_regressed",
      recovered.revision,
      final.revision
    );
  }
  if (final.revision === recovered.revision && !startupQueueSnapshotsMatch(recovered, final)) {
    throw new KnowledgeStartupSnapshotConsistencyError(
      bundleId,
      "queue_same_revision_mismatch",
      recovered.revision,
      final.revision
    );
  }
}

/** Advances the known Queue observation after proving monotonic exact state. */
function observeQueueSnapshot(
  bundleId: string,
  previous: IngestQueueSnapshot,
  value: unknown
): IngestQueueSnapshot {
  const actual = parseStartupQueue(bundleId, value);
  assertQueueSnapshotProgression(bundleId, previous, actual);
  return actual.revision > previous.revision ? actual : previous;
}

/** Advances the known Runtime revision floor or rejects an impossible rollback. */
function observeRuntimeRevision(
  bundleId: string,
  previousRevision: number | undefined,
  actualRevision: number
): number {
  if (previousRevision !== undefined && actualRevision < previousRevision) {
    throw new KnowledgeStartupSnapshotConsistencyError(
      bundleId,
      "runtime_revision_regressed",
      previousRevision,
      actualRevision
    );
  }
  return actualRevision;
}

/** Reads the Bundle id retained by one accepted classification variant. */
function classificationBundleId(classification: NoJournalApplyRecoveryClassification): string {
  if (classification.kind === "accepted_not_started") {
    return classification.bundleId;
  }
  if (classification.kind === "requires_decision") {
    return classification.candidate.bundleId;
  }
  return classification.reference.bundleId;
}

/** Reads the opaque accepted Review reference retained by every classification variant. */
function classificationReference(
  classification: NoJournalApplyRecoveryClassification
): NoJournalApplyRecoveryReference {
  if (classification.kind === "requires_decision") {
    return classification.candidate;
  }
  return classification.reference;
}

/** Serializes an opaque Bundle-scoped recovery reference for exact set comparison. */
function recoveryReferenceKey(reference: NoJournalApplyRecoveryReference): string {
  return `${reference.bundleId}\u0000${reference.recoveryId}`;
}

/** Validates one sanitized Vault-global transaction observation. */
function globalTransactionObservationIsValid(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "object" || value === undefined) return false;
  const observation = value as Partial<NoJournalApplyGlobalTransactionObservation>;
  return (
    typeof observation.transactionId === "string" &&
    observation.transactionId.trim().length > 0 &&
    typeof observation.bundleId === "string" &&
    observation.bundleId.trim().length > 0 &&
    typeof observation.changeSetId === "string" &&
    observation.changeSetId.trim().length > 0 &&
    (observation.phase === "prepared" ||
      observation.phase === "applying" ||
      observation.phase === "recovery_required" ||
      observation.phase === "committed")
  );
}

/** Proves stable Review actions and atomic Runtime classifications correspond one-to-one. */
function assertAcceptedClassificationSet(
  bundleId: string,
  actions: readonly ReviewQueueStartupAction[],
  classifications: readonly NoJournalApplyRecoveryClassification[]
): void {
  const expectedKeys = actions
    .filter((action) => action.kind === "accepted_requires_runtime_classification")
    .map((action) =>
      recoveryReferenceKey(
        createNoJournalApplyRecoveryReference(action.identity.bundleId, action.identity)
      )
    );
  const actualKeys = classifications.map((classification) =>
    recoveryReferenceKey(classificationReference(classification))
  );
  const expected = new Set(expectedKeys);
  const actual = new Set(actualKeys);
  const exact =
    expected.size === expectedKeys.length &&
    actual.size === actualKeys.length &&
    expected.size === actual.size &&
    [...expected].every((key) => actual.has(key));
  if (!exact) {
    throw new KnowledgeStartupAcceptedClassificationError(
      bundleId,
      expectedKeys.length,
      actualKeys.length
    );
  }
}

/** Validates the minimum identity of an atomic recovery snapshot result. */
function assertRecoverySnapshotResult(
  bundleId: string,
  expectedReviewRevision: number,
  result: NoJournalApplyRecoverySnapshotLoadResult
): void {
  if (result.kind === "review_revision_changed") {
    if (
      result.bundleId !== bundleId ||
      !Number.isSafeInteger(result.runtimeRevision) ||
      result.runtimeRevision < 0 ||
      result.expectedReviewRevision !== expectedReviewRevision ||
      !Number.isSafeInteger(result.actualReviewRevision) ||
      result.actualReviewRevision < 0
    ) {
      throw new TypeError("Atomic startup Review revision result is invalid");
    }
    return;
  }
  const snapshot = result.snapshot;
  if (
    snapshot.bundleId !== bundleId ||
    snapshot.reviewRevision !== expectedReviewRevision ||
    !Number.isSafeInteger(snapshot.runtimeRevision) ||
    snapshot.runtimeRevision < 0 ||
    !globalTransactionObservationIsValid(snapshot.globalTransaction) ||
    snapshot.classifications.some(
      (classification) => classificationBundleId(classification) !== bundleId
    )
  ) {
    throw new TypeError("Atomic startup recovery snapshot identity is invalid");
  }
}

/** Selects only queue mutations already completed by Review startup reconciliation. */
function selectReviewReconciliations(
  actions: readonly ReviewQueueStartupAction[]
): KnowledgeStartupReviewReconciliation[] {
  return actions.filter(
    (action): action is KnowledgeStartupReviewReconciliation =>
      action.kind === "pending_reconciled" || action.kind === "rejection_reconciled"
  );
}

/** Adds one attention record only once by its stable serialized identity. */
function addUniqueAttention(
  attention: KnowledgeStartupAttention[],
  seen: Set<string>,
  key: string,
  value: KnowledgeStartupAttention
): void {
  if (seen.has(key)) return;
  seen.add(key);
  attention.push(value);
}

/** Detects whether one exact accepted no-journal candidate owns the Queue recovery pause. */
function noJournalDecisionExplainsQueueRecovery(snapshot: NoJournalApplyRecoverySnapshot): boolean {
  const claim = snapshot.queueSnapshot.applyClaim;
  if (!claim?.reviewedChangeSet || !claim.acceptedReview) return false;
  return snapshot.classifications.some((classification) => {
    if (classification.kind !== "requires_decision") return false;
    const candidate = classification.candidate;
    return (
      candidate.jobId === claim.jobId &&
      candidate.changeSetId === claim.reviewedChangeSet?.changeSetId &&
      candidate.sourceId === claim.sourceId &&
      candidate.sourceContentHash === claim.sourceContentHash &&
      candidate.pipelineFingerprint === claim.pipelineFingerprint &&
      candidate.inputRevision === claim.inputRevision &&
      candidate.attempt === claim.attempt &&
      candidate.startedAt === claim.startedAt &&
      candidate.acceptedAt === claim.acceptedReview?.acceptedAt
    );
  });
}

/** Derives deterministic sanitized attention rows from one atomic observation. */
function deriveStartupAttention(
  applyCommit: ApplyCommitReconciliationResult,
  snapshot: NoJournalApplyRecoverySnapshot
): KnowledgeStartupAttention[] {
  const attention: KnowledgeStartupAttention[] = [];
  const seen = new Set<string>();
  if (applyCommit.kind === "blocked") {
    addUniqueAttention(
      attention,
      seen,
      `transaction_recovery_required:${applyCommit.transactionId}`,
      {
        kind: "transaction_recovery_required",
        transactionId: applyCommit.transactionId,
        changeSetId: applyCommit.changeSetId,
      }
    );
  }
  for (const classification of snapshot.classifications) {
    switch (classification.kind) {
      case "accepted_not_started":
        addUniqueAttention(attention, seen, `accepted_not_started:${classification.jobId}`, {
          kind: "accepted_not_started",
          jobId: classification.jobId,
          changeSetId: classification.changeSetId,
        });
        break;
      case "requires_decision":
        addUniqueAttention(
          attention,
          seen,
          `no_journal_decision_required:${classification.candidate.recoveryId}`,
          {
            kind: "no_journal_decision_required",
            reference: {
              bundleId: classification.candidate.bundleId,
              recoveryId: classification.candidate.recoveryId,
            },
            jobId: classification.candidate.jobId,
            changeSetId: classification.candidate.changeSetId,
          }
        );
        break;
      case "active":
        addUniqueAttention(attention, seen, `transaction_active:${classification.transactionId}`, {
          kind: "transaction_active",
          reference: { ...classification.reference },
          transactionId: classification.transactionId,
          phase: classification.phase,
        });
        break;
      case "blocked":
        addUniqueAttention(
          attention,
          seen,
          `accepted_apply_blocked:${classification.transactionId}:${classification.reference.recoveryId}`,
          {
            kind: "accepted_apply_blocked",
            reference: { ...classification.reference },
            transactionId: classification.transactionId,
            reason: classification.reason,
          }
        );
        break;
      case "finalizing":
        addUniqueAttention(attention, seen, `commit_finalizing:${classification.transactionId}`, {
          kind: "commit_finalizing",
          reference: { ...classification.reference },
          transactionId: classification.transactionId,
        });
        break;
      case "committed":
      case "abandoned":
        break;
    }
  }

  const globalTransaction = snapshot.globalTransaction;
  if (
    globalTransaction !== null &&
    !attention.some(
      (item) => "transactionId" in item && item.transactionId === globalTransaction.transactionId
    )
  ) {
    addUniqueAttention(
      attention,
      seen,
      `global_transaction_observed:${globalTransaction.transactionId}`,
      {
        kind: "global_transaction_observed",
        transactionId: globalTransaction.transactionId,
        ownerBundleId: globalTransaction.bundleId,
        changeSetId: globalTransaction.changeSetId,
        phase: globalTransaction.phase,
      }
    );
  }

  if (
    snapshot.queueSnapshot.control.status === "paused" &&
    snapshot.queueSnapshot.control.reason === "recovery_required" &&
    !noJournalDecisionExplainsQueueRecovery(snapshot)
  ) {
    addUniqueAttention(attention, seen, "queue_recovery_required", {
      kind: "queue_recovery_required",
    });
  }
  if (
    snapshot.queueSnapshot.control.status === "paused" &&
    snapshot.queueSnapshot.control.reason === "commit_pending_ack"
  ) {
    addUniqueAttention(attention, seen, "queue_commit_pending_ack", {
      kind: "queue_commit_pending_ack",
    });
  }
  return attention;
}

/** Maps sanitized attention rows to the conservative startup disposition. */
function deriveStartupDisposition(
  attention: readonly KnowledgeStartupAttention[]
): KnowledgeStartupGateDisposition {
  const hasHardBlocker = attention.some(
    (item) => item.kind !== "accepted_not_started" && item.kind !== "no_journal_decision_required"
  );
  if (hasHardBlocker) return "blocked";
  return attention.length > 0 ? "attention_required" : "observed_clear";
}

/**
 * Orchestrates startup recovery without starting new jobs or automatic decisions.
 *
 * A valid current Bundle is required because prepared/applying transaction
 * recovery may observe and atomically update Wiki files. No-journal continue,
 * abandon, accepted-not-started apply, model execution, and Queue resume are
 * deliberately outside this gate.
 */
export class KnowledgeStartupGate {
  private readonly maxStartupPasses: number;

  /** Creates the gate over narrow durable recovery ports. */
  constructor(private readonly dependencies: KnowledgeStartupGateDependencies) {
    this.maxStartupPasses = dependencies.maxStartupPasses ?? DEFAULT_MAX_STARTUP_PASSES;
    if (!Number.isSafeInteger(this.maxStartupPasses) || this.maxStartupPasses < 1) {
      throw new TypeError("maxStartupPasses must be a positive safe integer");
    }
  }

  /**
   * Produces one stable, non-authoritative recovery observation for a Bundle.
   *
   * @param bundleValue - Current strictly configured Bundle boundary
   * @param assertCurrent - Optional per-run lifecycle proof checked between durable phases
   * @returns Stable recovery observation; no Queue resume occurs
   */
  async run(
    bundleValue: unknown,
    assertCurrent: () => void = () => undefined
  ): Promise<KnowledgeStartupGateResult> {
    assertCurrent();
    const bundle = parseStartupBundle(bundleValue);
    let observedQueue = parseStartupQueue(
      bundle.id,
      await this.dependencies.queue.recoverOnStartup(bundle.id)
    );
    assertCurrent();
    let observedRuntimeRevision: number | undefined;

    for (let pass = 0; pass < this.maxStartupPasses; pass += 1) {
      assertCurrent();
      const applyCommit = await this.reconcileApplyCommit(bundle);
      assertCurrent();
      if (applyCommit.kind === "committed" || applyCommit.kind === "finalized_pending_ack") {
        observedQueue = observeQueueSnapshot(bundle.id, observedQueue, applyCommit.queueSnapshot);
      }
      const reviews = await this.dependencies.reviews.reconcile(bundle.id);
      assertCurrent();
      this.assertReviewResult(bundle.id, reviews);
      const recovery = await this.dependencies.accepted.loadSnapshot(
        bundle.id,
        reviews.reviewRevision
      );
      assertCurrent();
      assertRecoverySnapshotResult(bundle.id, reviews.reviewRevision, recovery);
      const runtimeRevision =
        recovery.kind === "loaded" ? recovery.snapshot.runtimeRevision : recovery.runtimeRevision;
      observedRuntimeRevision = observeRuntimeRevision(
        bundle.id,
        observedRuntimeRevision,
        runtimeRevision
      );
      if (recovery.kind === "review_revision_changed") {
        continue;
      }
      const queueSnapshot = observeQueueSnapshot(
        bundle.id,
        observedQueue,
        recovery.snapshot.queueSnapshot
      );
      const snapshot: NoJournalApplyRecoverySnapshot = {
        ...recovery.snapshot,
        queueSnapshot,
      };
      assertAcceptedClassificationSet(bundle.id, reviews.actions, snapshot.classifications);
      const attention = deriveStartupAttention(applyCommit, snapshot);
      return {
        bundleId: bundle.id,
        disposition: deriveStartupDisposition(attention),
        runtimeRevision: snapshot.runtimeRevision,
        reviewRevision: snapshot.reviewRevision,
        queueSnapshot,
        globalTransaction:
          snapshot.globalTransaction === null ? null : { ...snapshot.globalTransaction },
        applyCommit,
        reviewReconciliations: selectReviewReconciliations(reviews.actions),
        acceptedClassifications: [...snapshot.classifications],
        attention,
      };
    }
    throw new KnowledgeStartupGateUnstableError(bundle.id, this.maxStartupPasses);
  }

  /** Normalizes the first sticky file conflict into the next read-only blocked result. */
  private async reconcileApplyCommit(
    bundle: KnowledgeBundleConfig
  ): Promise<ApplyCommitReconciliationResult> {
    try {
      return await this.dependencies.applyCommit.reconcile(bundle);
    } catch (error) {
      if (!(error instanceof ChangeSetTransactionRecoveryRequiredError)) {
        throw error;
      }
      const normalized = await this.dependencies.applyCommit.reconcile(bundle);
      if (
        normalized.kind !== "blocked" ||
        normalized.transactionId !== error.transactionId ||
        normalized.bundleId !== bundle.id
      ) {
        throw new KnowledgeStartupRecoveryNormalizationError(
          error.transactionId,
          normalized.kind,
          "transactionId" in normalized ? normalized.transactionId : undefined
        );
      }
      return normalized;
    }
  }

  /** Validates the identity token returned by Review reconciliation. */
  private assertReviewResult(
    bundleId: string,
    result: ReviewQueueStartupReconciliationResult
  ): void {
    if (
      result.bundleId !== bundleId ||
      !Number.isSafeInteger(result.reviewRevision) ||
      result.reviewRevision < 0 ||
      result.actions.some(
        (action) =>
          action.kind === "accepted_requires_runtime_classification" &&
          action.identity.bundleId !== bundleId
      )
    ) {
      throw new TypeError("Review startup reconciliation identity is invalid");
    }
  }
}
