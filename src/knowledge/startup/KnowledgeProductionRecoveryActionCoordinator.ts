import type { App } from "obsidian";

import { ApplyCommitCoordinator } from "@/knowledge/changeset/ApplyCommitCoordinator";
import {
  ChangeSetTransaction,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import { ChangeSetValidator } from "@/knowledge/changeset/ChangeSetValidator";
import {
  KnowledgeProductionProjectionValidator,
  KnowledgeProductionSourceArtifactResolver,
} from "@/knowledge/changeset/KnowledgeProductionApplyValidation";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanError,
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeSourceParseJob,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import {
  IngestQueue,
  type IngestAcceptedReviewDecisionReceipt,
  type IngestExecutionContext,
  type IngestExecutionResult,
} from "@/knowledge/ingest/queue/IngestQueue";
import { ObsidianExactSourceArtifactReader } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  NoJournalApplyRecoveryCoordinator,
  createNoJournalApplyRecoveryReference,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoveryReference,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import type { AcceptedChangeSetReviewRecord } from "@/knowledge/review/ReviewStorage";
import {
  KnowledgeNoJournalApplyRecoveryConflictError,
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeTransactionStorage,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { ObsidianKnowledgeFileStore } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import { KnowledgePluginProductionWorkflowLease } from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import type { KnowledgeStudioRecoverySubmissionResult } from "@/knowledge/ui/KnowledgeStudioController";

/** Exact production dependencies retained by one recovery-action generation. */
export interface KnowledgeProductionRecoveryActionCoordinatorInput {
  app: App;
  runtime: KnowledgeRuntimeStore;
  workflowLease: KnowledgePluginProductionWorkflowLease;
  assertCurrent(): void;
  onGenerationRefreshRequired(): void;
}

/** Hidden state retained only by an authentic recovery-action coordinator. */
interface KnowledgeProductionRecoveryActionCoordinatorState {
  app: App;
  runtime: KnowledgeRuntimeStore;
  workflowLease: KnowledgePluginProductionWorkflowLease;
  assertCurrent: () => void;
  onGenerationRefreshRequired: () => void;
  operationTail: Promise<void>;
}

/** Exact atomic lookup result before any recovery action can mutate durable state. */
type ExactRecoveryLookup =
  | { kind: "stale" }
  | { kind: "blocked" }
  | {
      kind: "found";
      classification: NoJournalApplyRecoveryClassification;
      reference: NoJournalApplyRecoveryReference;
    };

/** Plan preparation and Queue capabilities bound to one exact workflow owner. */
interface ContinuePreparation {
  bundle: KnowledgeBundleConfig;
  queue: IngestQueue;
  artifacts: readonly SourceArtifactObservation[];
}

/** Exact apply identity used to reject an unrelated global transaction. */
interface ExpectedRecoveryApplyIdentity {
  bundleId: string;
  changeSetId: string;
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
  startedAt: number;
}

const coordinatorStates = new WeakMap<object, KnowledgeProductionRecoveryActionCoordinatorState>();

/** Throws the platform-standard cancellation category without retaining a cause. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Returns hidden state only for an authentic coordinator instance. */
function requireCoordinatorState(
  value: unknown
): KnowledgeProductionRecoveryActionCoordinatorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionRecoveryActionCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Reports whether one external command identifier is canonical. */
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Reports whether one optimistic Runtime revision is exact and representable. */
function isRuntimeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Proves caller cancellation and workflow ownership before a durable boundary. */
function assertInvocation(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  signal: AbortSignal
): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  state.workflowLease.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Reports current generation ownership to the read-only workflow loader. */
function isGenerationCurrent(state: KnowledgeProductionRecoveryActionCoordinatorState): boolean {
  try {
    state.assertCurrent();
    return state.workflowLease.isCurrent();
  } catch {
    return false;
  }
}

/** Requests a full lifecycle refresh without changing a durable action result. */
function requestGenerationRefresh(state: KnowledgeProductionRecoveryActionCoordinatorState): void {
  try {
    state.onGenerationRefreshRequired();
  } catch {
    // Durable Runtime evidence remains recoverable when notification fails.
  }
}

/** Returns the opaque recovery id carried by one exact classification. */
function getClassificationRecoveryId(classification: NoJournalApplyRecoveryClassification): string {
  return classification.kind === "requires_decision"
    ? classification.candidate.recoveryId
    : classification.reference.recoveryId;
}

/** Returns the opaque reference carried by one exact classification. */
function getClassificationReference(
  classification: NoJournalApplyRecoveryClassification
): NoJournalApplyRecoveryReference {
  return classification.kind === "requires_decision"
    ? {
        bundleId: classification.candidate.bundleId,
        recoveryId: classification.candidate.recoveryId,
      }
    : { ...classification.reference };
}

/** Loads one atomic recovery classification bound to the UI's exact Runtime revision. */
async function loadExactRecovery(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  bundleId: string,
  recoveryId: string,
  expectedRuntimeRevision: number,
  signal: AbortSignal
): Promise<ExactRecoveryLookup> {
  if (
    !isIdentifier(bundleId) ||
    !isIdentifier(recoveryId) ||
    !isRuntimeRevision(expectedRuntimeRevision)
  ) {
    return { kind: "stale" };
  }
  assertInvocation(state, signal);
  const studio = await state.runtime.readStudioBundle(bundleId);
  assertInvocation(state, signal);
  if (studio.runtimeRevision !== expectedRuntimeRevision) return { kind: "stale" };

  const loaded = await new KnowledgeRuntimeNoJournalApplyRecoveryPort(state.runtime).loadSnapshot(
    bundleId,
    studio.review.revision
  );
  assertInvocation(state, signal);
  if (loaded.kind !== "loaded" || loaded.snapshot.runtimeRevision !== expectedRuntimeRevision) {
    return { kind: "stale" };
  }
  const matches = loaded.snapshot.classifications.filter(
    (classification) => getClassificationRecoveryId(classification) === recoveryId
  );
  if (matches.length === 0) return { kind: "stale" };
  if (matches.length !== 1) return { kind: "blocked" };
  return {
    kind: "found",
    classification: matches[0],
    reference: getClassificationReference(matches[0]),
  };
}

/** Converts one immutable accepted record into the Queue's strict receipt. */
function createAcceptedReceipt(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): IngestAcceptedReviewDecisionReceipt {
  return {
    outcome: "accepted",
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    acceptedDigest: record.acceptedDigest,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/** Loads the exact accepted record named by an accepted-not-started classification. */
async function loadAcceptedNotStartedRecord(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  bundleId: string,
  classification: Extract<NoJournalApplyRecoveryClassification, { kind: "accepted_not_started" }>
): Promise<AcceptedChangeSetReviewRecord | undefined> {
  const reviews = new ChangeSetReviewRepository(new KnowledgeRuntimeReviewStorage(state.runtime));
  const record = await reviews.get(bundleId, classification.changeSetId);
  if (record?.outcome !== "accepted") return undefined;
  const reference = createNoJournalApplyRecoveryReference(bundleId, record);
  if (
    reference.recoveryId !== classification.reference.recoveryId ||
    record.jobClaim.jobId !== classification.jobId ||
    record.changeSetId !== classification.changeSetId
  ) {
    return undefined;
  }
  return record;
}

/** Queue executor that cannot claim or execute ordinary ingest work. */
class RecoveryExecutionUnavailableExecutor {
  /** Rejects every accidental execution attempt without inspecting private context. */
  async execute(_context: IngestExecutionContext): Promise<IngestExecutionResult> {
    throw new Error("Recovery Queue execution is unavailable");
  }
}

/** Builds and runs one authentic workflow preparation before recovery mutation. */
async function prepareContinue(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  bundleId: string,
  job: KnowledgeSourceParseJob,
  signal: AbortSignal
): Promise<ContinuePreparation | undefined> {
  const owners = state.workflowLease.getOwners();
  const matchingOwners = owners.filter((owner) => owner.config.id === bundleId);
  if (matchingOwners.length !== 1) return undefined;
  const executionOwner = createKnowledgeExecutionOwner();
  const queueStorage = new KnowledgeRuntimeQueueStorage(state.runtime, executionOwner);
  const queue = new IngestQueue(queueStorage, new RecoveryExecutionUnavailableExecutor());
  const loader = new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(state.runtime)),
    artifactReader: new ObsidianExactSourceArtifactReader(state.app),
    pipelineProfile: state.workflowLease,
    parsers: state.workflowLease.getParsers(),
    generation: { isCurrent: () => isGenerationCurrent(state) },
  });
  const plan = await loader.load(matchingOwners, signal);
  const preparation = await plan.prepare(job, signal);
  return {
    bundle: matchingOwners[0].config,
    queue,
    artifacts: preparation.artifacts,
  };
}

/**
 * Confirms an ambiguous startup-paused Queue transition from one atomic Runtime snapshot.
 *
 * IngestQueue deliberately refuses an applying replay while startup recovery owns
 * the pause. The Runtime classification is therefore the exact durable replay
 * proof after a commit-then-throw Queue storage boundary.
 */
async function confirmRequiresDecision(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  bundleId: string,
  reference: NoJournalApplyRecoveryReference,
  record: AcceptedChangeSetReviewRecord
): Promise<ExpectedRecoveryApplyIdentity | undefined> {
  const studio = await state.runtime.readStudioBundle(bundleId);
  const loaded = await new KnowledgeRuntimeNoJournalApplyRecoveryPort(state.runtime).loadSnapshot(
    bundleId,
    studio.review.revision
  );
  if (loaded.kind !== "loaded") return undefined;
  const matches = loaded.snapshot.classifications.filter(
    (
      classification
    ): classification is Extract<
      NoJournalApplyRecoveryClassification,
      { kind: "requires_decision" }
    > =>
      classification.kind === "requires_decision" &&
      classification.candidate.recoveryId === reference.recoveryId
  );
  if (matches.length !== 1) return undefined;
  const candidate = matches[0].candidate;
  if (
    candidate.bundleId !== bundleId ||
    candidate.changeSetId !== record.changeSetId ||
    candidate.jobId !== record.jobClaim.jobId ||
    candidate.sourceId !== record.jobClaim.sourceId ||
    candidate.sourceContentHash !== record.jobClaim.sourceContentHash ||
    candidate.pipelineFingerprint !== record.jobClaim.pipelineFingerprint ||
    candidate.inputRevision !== record.jobClaim.inputRevision ||
    candidate.attempt !== record.jobClaim.attempt ||
    candidate.acceptedAt !== record.acceptedAt
  ) {
    return undefined;
  }
  return {
    bundleId,
    changeSetId: candidate.changeSetId,
    jobId: candidate.jobId,
    sourceId: candidate.sourceId,
    sourceContentHash: candidate.sourceContentHash,
    pipelineFingerprint: candidate.pipelineFingerprint,
    inputRevision: candidate.inputRevision,
    attempt: candidate.attempt,
    startedAt: candidate.startedAt,
  };
}

/** Begins an accepted-not-started apply or confirms its exact ambiguous commit. */
async function beginAcceptedApply(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  preparation: ContinuePreparation,
  bundleId: string,
  reference: NoJournalApplyRecoveryReference,
  record: AcceptedChangeSetReviewRecord
): Promise<ExpectedRecoveryApplyIdentity> {
  const receipt = createAcceptedReceipt(bundleId, record);
  let applying;
  try {
    applying = await preparation.queue.beginReviewApply(bundleId, receipt);
  } catch {
    try {
      applying = await preparation.queue.beginReviewApply(bundleId, receipt);
    } catch (error) {
      const confirmed = await confirmRequiresDecision(state, bundleId, reference, record);
      if (confirmed) return confirmed;
      throw error;
    }
  }
  return {
    bundleId,
    changeSetId: record.changeSetId,
    jobId: applying.id,
    sourceId: applying.sourceId,
    sourceContentHash: applying.sourceContentHash,
    pipelineFingerprint: applying.pipelineFingerprint,
    inputRevision: applying.inputRevision,
    attempt: applying.attempt,
    startedAt: applying.startedAt,
  };
}

/** Reports whether a committed receipt owns the exact selected recovery action. */
function receiptMatchesExpected(
  receipt: TransactionCommitReceipt,
  expected: ExpectedRecoveryApplyIdentity
): boolean {
  return (
    receipt.bundleId === expected.bundleId &&
    receipt.changeSetId === expected.changeSetId &&
    receipt.jobClaim.jobId === expected.jobId &&
    receipt.jobClaim.sourceId === expected.sourceId &&
    receipt.jobClaim.sourceContentHash === expected.sourceContentHash &&
    receipt.jobClaim.pipelineFingerprint === expected.pipelineFingerprint &&
    receipt.jobClaim.inputRevision === expected.inputRevision &&
    receipt.jobClaim.attempt === expected.attempt &&
    receipt.jobClaim.startedAt === expected.startedAt
  );
}

/** Reports whether an active journal belongs to the selected recovery action. */
function journalMatchesExpected(
  journal: Awaited<ReturnType<ChangeSetTransaction["loadActive"]>>,
  expected: ExpectedRecoveryApplyIdentity
): boolean {
  return (
    journal !== null &&
    journal.bundleId === expected.bundleId &&
    journal.changeSetId === expected.changeSetId &&
    journal.jobClaim.jobId === expected.jobId &&
    journal.jobClaim.sourceId === expected.sourceId &&
    journal.jobClaim.sourceContentHash === expected.sourceContentHash &&
    journal.jobClaim.pipelineFingerprint === expected.pipelineFingerprint &&
    journal.jobClaim.inputRevision === expected.inputRevision &&
    journal.jobClaim.attempt === expected.attempt &&
    journal.jobClaim.startedAt === expected.startedAt
  );
}

/** Runs the exact no-journal transaction and its crash-safe downstream finalization. */
async function continueAndFinalize(
  state: KnowledgeProductionRecoveryActionCoordinatorState,
  preparation: ContinuePreparation,
  reference: NoJournalApplyRecoveryReference,
  expected: ExpectedRecoveryApplyIdentity
): Promise<KnowledgeStudioRecoverySubmissionResult> {
  const fileStore = new ObsidianKnowledgeFileStore(state.app.vault);
  const transaction = new ChangeSetTransaction({
    storage: new KnowledgeRuntimeTransactionStorage(state.runtime),
    fileStore,
    validator: new ChangeSetValidator(
      fileStore,
      new KnowledgeProductionSourceArtifactResolver(preparation.artifacts),
      new KnowledgeProductionProjectionValidator()
    ),
    authority: new KnowledgeRuntimeApplyAuthorityPort(state.runtime),
  });
  const accepted = new NoJournalApplyRecoveryCoordinator({
    state: new KnowledgeRuntimeNoJournalApplyRecoveryPort(state.runtime),
    transaction,
  });
  let receipt: Awaited<ReturnType<NoJournalApplyRecoveryCoordinator["continue"]>> | undefined;
  try {
    receipt = await accepted.continue(reference, preparation.bundle);
  } catch {
    const active = await transaction.loadActive();
    if (!journalMatchesExpected(active, expected)) return { kind: "recovery_required" };
  }

  const reconciliation = await new ApplyCommitCoordinator({
    transaction,
    queue: preparation.queue,
    manifest: new KnowledgeRuntimeApplyCommitManifestPort(state.runtime),
  }).reconcile(preparation.bundle);
  if (
    reconciliation.kind !== "committed" ||
    !receiptMatchesExpected(reconciliation.receipt, expected) ||
    (receipt !== undefined && receipt.transactionId !== reconciliation.receipt.transactionId)
  ) {
    return { kind: "recovery_required" };
  }
  return { kind: "completed" };
}

/** Maps one pre-mutation recovery conflict to a fail-closed UI result. */
function mapRecoveryConflict(
  error: KnowledgeNoJournalApplyRecoveryConflictError
): KnowledgeStudioRecoverySubmissionResult {
  return error.reason === "recovery_id_unknown" ||
    error.reason === "review_record_missing" ||
    error.reason === "review_record_mismatch" ||
    error.reason === "state_not_actionable"
    ? { kind: "stale" }
    : { kind: "blocked" };
}

/** Reports whether an error is the platform cancellation category. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Frozen transaction port proving Abandon never creates a transaction runtime. */
const ABANDON_TRANSACTION_UNAVAILABLE = Object.freeze({
  /** Rejects accidental transaction use from the abandonment-only path. */
  async apply(): Promise<never> {
    throw new Error("Abandon cannot apply a knowledge transaction");
  },
});

/**
 * Generation-owned production coordinator for explicit no-journal recovery actions.
 *
 * Every action first binds the opaque row to one exact atomic Runtime revision.
 * Continue performs real source reproof and Wiki transaction validation; Abandon
 * remains a Runtime-only decision that cannot access source or Wiki adapters.
 */
export class KnowledgeProductionRecoveryActionCoordinator {
  /** Captures one exact App, Runtime, and production workflow generation. */
  constructor(input: KnowledgeProductionRecoveryActionCoordinatorInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.app !== "object" ||
      input.app === null ||
      typeof input.app.vault !== "object" ||
      input.app.vault === null ||
      !(input.runtime instanceof KnowledgeRuntimeStore) ||
      typeof input.assertCurrent !== "function" ||
      typeof input.onGenerationRefreshRequired !== "function"
    ) {
      throw createAbortError();
    }
    KnowledgePluginProductionWorkflowLease.assert(input.workflowLease);
    input.workflowLease.assertCurrent();
    coordinatorStates.set(this, {
      app: input.app,
      runtime: input.runtime,
      workflowLease: input.workflowLease,
      assertCurrent: () => input.assertCurrent(),
      onGenerationRefreshRequired: () => input.onGenerationRefreshRequired(),
      operationTail: Promise.resolve(),
    });
    Object.freeze(this);
  }

  /** Proves a coordinator was minted by this module without exposing its state. */
  static assert(value: unknown): asserts value is KnowledgeProductionRecoveryActionCoordinator {
    requireCoordinatorState(value);
  }

  /** Continues one exact accepted no-journal apply through finalization. */
  continue(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    const state = requireCoordinatorState(this);
    const operation = state.operationTail
      .catch(() => undefined)
      .then(() =>
        this.executeContinue(state, bundleId, recoveryId, expectedRuntimeRevision, signal)
      );
    state.operationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  /** Abandons one exact requires-decision state without source or Wiki access. */
  abandon(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    const state = requireCoordinatorState(this);
    const operation = state.operationTail
      .catch(() => undefined)
      .then(() =>
        this.executeAbandon(state, bundleId, recoveryId, expectedRuntimeRevision, signal)
      );
    state.operationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  /** Executes one explicit Continue while honoring cancellation only before mutation. */
  private async executeContinue(
    state: KnowledgeProductionRecoveryActionCoordinatorState,
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    let durableAttempted = false;
    try {
      const lookup = await loadExactRecovery(
        state,
        bundleId,
        recoveryId,
        expectedRuntimeRevision,
        signal
      );
      if (lookup.kind !== "found") return lookup;
      const { classification, reference } = lookup;
      if (classification.kind === "committed" || classification.kind === "abandoned") {
        return { kind: "stale" };
      }
      if (
        classification.kind === "active" ||
        classification.kind === "blocked" ||
        classification.kind === "finalizing"
      ) {
        return { kind: "blocked" };
      }

      let acceptedRecord: AcceptedChangeSetReviewRecord | undefined;
      let job: KnowledgeSourceParseJob;
      if (classification.kind === "accepted_not_started") {
        acceptedRecord = await loadAcceptedNotStartedRecord(state, bundleId, classification);
        assertInvocation(state, signal);
        if (!acceptedRecord) return { kind: "stale" };
        job = {
          bundleId,
          sourceId: acceptedRecord.jobClaim.sourceId,
          sourceContentHash: acceptedRecord.jobClaim.sourceContentHash,
          pipelineFingerprint: acceptedRecord.jobClaim.pipelineFingerprint,
          inputRevision: acceptedRecord.jobClaim.inputRevision,
        };
      } else {
        job = {
          bundleId,
          sourceId: classification.candidate.sourceId,
          sourceContentHash: classification.candidate.sourceContentHash,
          pipelineFingerprint: classification.candidate.pipelineFingerprint,
          inputRevision: classification.candidate.inputRevision,
        };
      }

      const preparation = await prepareContinue(state, bundleId, job, signal);
      assertInvocation(state, signal);
      if (!preparation) return { kind: "stale" };

      let expected: ExpectedRecoveryApplyIdentity;
      if (classification.kind === "accepted_not_started") {
        if (!acceptedRecord) return { kind: "stale" };
        durableAttempted = true;
        expected = await beginAcceptedApply(
          state,
          preparation,
          bundleId,
          reference,
          acceptedRecord
        );
      } else {
        assertInvocation(state, signal);
        durableAttempted = true;
        expected = {
          bundleId,
          changeSetId: classification.candidate.changeSetId,
          jobId: classification.candidate.jobId,
          sourceId: classification.candidate.sourceId,
          sourceContentHash: classification.candidate.sourceContentHash,
          pipelineFingerprint: classification.candidate.pipelineFingerprint,
          inputRevision: classification.candidate.inputRevision,
          attempt: classification.candidate.attempt,
          startedAt: classification.candidate.startedAt,
        };
      }

      const result = await continueAndFinalize(state, preparation, reference, expected);
      requestGenerationRefresh(state);
      return result;
    } catch (error) {
      if (durableAttempted) {
        requestGenerationRefresh(state);
        return { kind: "recovery_required" };
      }
      if (signal.aborted || isAbortError(error)) throw createAbortError();
      if (error instanceof KnowledgeNoJournalApplyRecoveryConflictError) {
        return mapRecoveryConflict(error);
      }
      if (error instanceof KnowledgeSourceWorkflowPlanError) return { kind: "blocked" };
      throw error;
    }
  }

  /** Executes one Runtime-only abandonment after an exact actionable re-read. */
  private async executeAbandon(
    state: KnowledgeProductionRecoveryActionCoordinatorState,
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    let durableAttempted = false;
    try {
      const lookup = await loadExactRecovery(
        state,
        bundleId,
        recoveryId,
        expectedRuntimeRevision,
        signal
      );
      if (lookup.kind !== "found") return lookup;
      if (
        lookup.classification.kind === "committed" ||
        lookup.classification.kind === "abandoned"
      ) {
        return { kind: "stale" };
      }
      if (lookup.classification.kind !== "requires_decision") {
        return { kind: "blocked" };
      }
      assertInvocation(state, signal);
      durableAttempted = true;
      const recovery = new NoJournalApplyRecoveryCoordinator({
        state: new KnowledgeRuntimeNoJournalApplyRecoveryPort(state.runtime),
        transaction: ABANDON_TRANSACTION_UNAVAILABLE,
      });
      try {
        await recovery.abandon(lookup.reference);
      } catch {
        await recovery.abandon(lookup.reference);
      }
      requestGenerationRefresh(state);
      return { kind: "completed" };
    } catch (error) {
      if (durableAttempted) {
        requestGenerationRefresh(state);
        return { kind: "recovery_required" };
      }
      if (signal.aborted || isAbortError(error)) throw createAbortError();
      if (error instanceof KnowledgeNoJournalApplyRecoveryConflictError) {
        return mapRecoveryConflict(error);
      }
      throw error;
    }
  }
}

Object.freeze(KnowledgeProductionRecoveryActionCoordinator.prototype);
Object.freeze(KnowledgeProductionRecoveryActionCoordinator);
