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

export interface KnowledgeStartupQueuePort {
  recoverOnStartup(bundleId: string): Promise<IngestQueueSnapshot>;
}

export interface KnowledgeStartupApplyCommitPort {
  reconcile(bundle: KnowledgeBundleConfig): Promise<ApplyCommitReconciliationResult>;
}

export interface KnowledgeStartupReviewPort {
  reconcile(bundleId: string): Promise<ReviewQueueStartupReconciliationResult>;
}

export interface KnowledgeStartupGateDependencies {
  queue: KnowledgeStartupQueuePort;
  applyCommit: KnowledgeStartupApplyCommitPort;
  reviews: KnowledgeStartupReviewPort;
  accepted: NoJournalApplyRecoverySnapshotPort;
  maxStartupPasses?: number;
}

export type KnowledgeStartupGateDisposition = "observed_clear" | "attention_required" | "blocked";

export type KnowledgeStartupReviewReconciliation = Extract<
  ReviewQueueStartupAction,
  { kind: "pending_reconciled" | "rejection_reconciled" }
>;

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

export class KnowledgeStartupBundleValidationError extends TypeError {
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("The current knowledge Bundle does not satisfy the startup contract");
    this.name = "KnowledgeStartupBundleValidationError";
  }
}

export class KnowledgeStartupQueueValidationError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`The recovered Queue for '${bundleId}' does not satisfy its durable contract`);
    this.name = "KnowledgeStartupQueueValidationError";
  }
}

export type KnowledgeStartupSnapshotConsistencyErrorReason =
  | "runtime_revision_regressed"
  | "queue_revision_regressed"
  | "queue_same_revision_mismatch";

export class KnowledgeStartupSnapshotConsistencyError extends Error {
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

export class KnowledgeStartupRecoveryNormalizationError extends Error {
  constructor(
    public readonly expectedTransactionId: string,
    public readonly observedKind: ApplyCommitReconciliationResult["kind"],
    public readonly observedTransactionId?: string
  ) {
    super(`Transaction '${expectedTransactionId}' did not normalize to its durable blocked state`);
    this.name = "KnowledgeStartupRecoveryNormalizationError";
  }
}

export class KnowledgeStartupAcceptedClassificationError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly expectedCount: number,
    public readonly actualCount: number
  ) {
    super(`Accepted Review classifications for '${bundleId}' do not match the stable Review set`);
    this.name = "KnowledgeStartupAcceptedClassificationError";
  }
}

export class KnowledgeStartupGateUnstableError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number
  ) {
    super(`Knowledge startup state for '${bundleId}' changed during ${attempts} passes`);
    this.name = "KnowledgeStartupGateUnstableError";
  }
}

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

function startupQueueSnapshotsMatch(
  left: IngestQueueSnapshot,
  right: IngestQueueSnapshot
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

function observeQueueSnapshot(
  bundleId: string,
  previous: IngestQueueSnapshot,
  value: unknown
): IngestQueueSnapshot {
  const actual = parseStartupQueue(bundleId, value);
  assertQueueSnapshotProgression(bundleId, previous, actual);
  return actual.revision > previous.revision ? actual : previous;
}

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

function classificationBundleId(classification: NoJournalApplyRecoveryClassification): string {
  if (classification.kind === "accepted_not_started") {
    return classification.bundleId;
  }
  if (classification.kind === "requires_decision") {
    return classification.candidate.bundleId;
  }
  return classification.reference.bundleId;
}

function classificationReference(
  classification: NoJournalApplyRecoveryClassification
): NoJournalApplyRecoveryReference {
  if (classification.kind === "requires_decision") {
    return classification.candidate;
  }
  return classification.reference;
}

function recoveryReferenceKey(reference: NoJournalApplyRecoveryReference): string {
  return `${reference.bundleId}\u0000${reference.recoveryId}`;
}

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

function selectReviewReconciliations(
  actions: readonly ReviewQueueStartupAction[]
): KnowledgeStartupReviewReconciliation[] {
  return actions.filter(
    (action): action is KnowledgeStartupReviewReconciliation =>
      action.kind === "pending_reconciled" || action.kind === "rejection_reconciled"
  );
}

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
    // Retaining a user pause does not acknowledge a committed transaction.
    // https://github.com/yydspanda/obsidian-copilot/issues/18
    snapshot.queueSnapshot.applyCommit !== undefined ||
    (snapshot.queueSnapshot.control.status === "paused" &&
      snapshot.queueSnapshot.control.reason === "commit_pending_ack")
  ) {
    addUniqueAttention(attention, seen, "queue_commit_pending_ack", {
      kind: "queue_commit_pending_ack",
    });
  }
  return attention;
}

function deriveStartupDisposition(
  attention: readonly KnowledgeStartupAttention[]
): KnowledgeStartupGateDisposition {
  const hasHardBlocker = attention.some(
    (item) => item.kind !== "accepted_not_started" && item.kind !== "no_journal_decision_required"
  );
  if (hasHardBlocker) return "blocked";
  return attention.length > 0 ? "attention_required" : "observed_clear";
}

export class KnowledgeStartupGate {
  private readonly maxStartupPasses: number;

  constructor(private readonly dependencies: KnowledgeStartupGateDependencies) {
    this.maxStartupPasses = dependencies.maxStartupPasses ?? DEFAULT_MAX_STARTUP_PASSES;
    if (!Number.isSafeInteger(this.maxStartupPasses) || this.maxStartupPasses < 1) {
      throw new TypeError("maxStartupPasses must be a positive safe integer");
    }
  }

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
