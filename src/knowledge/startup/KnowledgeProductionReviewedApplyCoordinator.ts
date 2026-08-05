import type { CompilerTargetResolver } from "@/knowledge/compiler/CompilerModelPort";
import { ApplyCommitCoordinator } from "@/knowledge/changeset/ApplyCommitCoordinator";
import {
  ChangeSetTransaction,
  type ChangeSetTransactionApplyInput,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ChangeSetValidationError,
  ChangeSetValidator,
  type KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  KnowledgeProductionProjectionValidator,
  KnowledgeProductionReviewCandidateValidator,
  KnowledgeProductionSourceArtifactResolver,
} from "@/knowledge/changeset/KnowledgeProductionApplyValidation";
import {
  IngestQueue,
  type IngestAcceptedReviewDecisionReceipt,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeSourceExecutionPlan,
  type KnowledgeSourceParseJob,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  ChangeSetReviewDecisionConflictError,
  ChangeSetReviewIdentityConflictError,
  ChangeSetReviewNotFoundError,
  ChangeSetReviewRecordRevisionConflictError,
  ChangeSetReviewRepository,
} from "@/knowledge/review/ChangeSetReviewRepository";
import {
  KnowledgeReviewDecisionError,
  KnowledgeReviewDecisionService,
  snapshotKnowledgeReviewCommand,
  type KnowledgeReviewCommand,
} from "@/knowledge/review/ReviewDecision";
import type {
  AcceptedChangeSetReviewRecord,
  PendingChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";
import {
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeTransactionStorage,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import type { KnowledgeStudioReviewSubmissionResult } from "@/knowledge/ui/KnowledgeStudioController";
import {
  KnowledgeStudioRuntimeReadError,
  loadKnowledgeStudioReviewContext,
} from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";

/** Dependencies captured by one exact released production workflow generation. */
export interface KnowledgeProductionReviewedApplyCoordinatorInput {
  runtime: KnowledgeRuntimeStore;
  queue: IngestQueue;
  reviews: ChangeSetReviewRepository;
  plan: KnowledgeSourceExecutionPlan;
  bundles: readonly KnowledgeBundleConfig[];
  targetResolver: CompilerTargetResolver;
  fileStore: KnowledgeFileStore;
  assertCurrent(): void;
  onGenerationRefreshRequired(): void;
}

/** Hidden state retained by an authentic reviewed-apply coordinator. */
interface KnowledgeProductionReviewedApplyCoordinatorState {
  runtime: KnowledgeRuntimeStore;
  queue: IngestQueue;
  reviews: ChangeSetReviewRepository;
  plan: KnowledgeSourceExecutionPlan;
  bundles: ReadonlyMap<string, KnowledgeBundleConfig>;
  targetResolver: CompilerTargetResolver;
  fileStore: KnowledgeFileStore;
  reviewReject: KnowledgeRuntimeReviewRejectPort;
  assertCurrent: () => void;
  onGenerationRefreshRequired: () => void;
  operationTail: Promise<void>;
}

const coordinatorStates = new WeakMap<object, KnowledgeProductionReviewedApplyCoordinatorState>();

/** Creates the platform-standard cancellation used for stale production generations. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Returns hidden state only for an authentic coordinator instance. */
function requireCoordinatorState(value: unknown): KnowledgeProductionReviewedApplyCoordinatorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionReviewedApplyCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Captures a detached, validated Bundle map for one generation. */
function snapshotBundles(
  bundles: readonly KnowledgeBundleConfig[]
): ReadonlyMap<string, KnowledgeBundleConfig> {
  const result = new Map<string, KnowledgeBundleConfig>();
  for (const bundle of bundles) {
    if (result.has(bundle.id)) throw createAbortError();
    result.set(bundle.id, bundle);
  }
  if (result.size === 0) throw createAbortError();
  return result;
}

/** Proves caller cancellation and workflow ownership before a durable boundary. */
function assertInvocation(
  state: KnowledgeProductionReviewedApplyCoordinatorState,
  signal?: AbortSignal
): void {
  if (signal?.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal?.aborted) throw createAbortError();
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

/** Projects a durable Queue claim onto the execution plan's strict read-only input. */
function createSourceParseJob(
  bundleId: string,
  claim: Pick<
    AcceptedChangeSetReviewRecord["jobClaim"],
    "sourceId" | "sourceContentHash" | "pipelineFingerprint" | "inputRevision"
  >
): KnowledgeSourceParseJob {
  return {
    bundleId,
    sourceId: claim.sourceId,
    sourceContentHash: claim.sourceContentHash,
    pipelineFingerprint: claim.pipelineFingerprint,
    inputRevision: claim.inputRevision,
  };
}

/** Compares one terminal accepted record with the exact decision being confirmed. */
function acceptedRecordMatches(
  record: AcceptedChangeSetReviewRecord,
  pending: PendingChangeSetReviewRecord,
  acceptedDigest: string,
  acceptedChangeSet: unknown
): boolean {
  return (
    record.proposalDigest === pending.proposalDigest &&
    record.recordRevision === pending.recordRevision + 1 &&
    record.acceptedDigest === acceptedDigest &&
    canonicalizeJson(record.acceptedChangeSet as unknown as JsonValue) ===
      canonicalizeJson(acceptedChangeSet as JsonValue)
  );
}

/** Creates a strict literal Reject command after selection produced no file changes. */
function createLiteralRejectCommand(
  pending: PendingChangeSetReviewRecord,
  command: KnowledgeReviewCommand
): KnowledgeReviewCommand {
  return {
    changeSetId: pending.changeSetId,
    proposalDigest: pending.proposalDigest,
    expectedSnapshotToken: command.expectedSnapshotToken,
    decisions: pending.proposal.changes.map((change) => ({
      changeId: change.id,
      decision: "reject" as const,
    })),
  };
}

/** Maps deterministic Review identity failures to an optimistic stale result. */
function isStaleReviewError(error: unknown): boolean {
  return (
    error instanceof KnowledgeStudioRuntimeReadError ||
    error instanceof ChangeSetReviewNotFoundError ||
    error instanceof ChangeSetReviewIdentityConflictError ||
    error instanceof ChangeSetReviewRecordRevisionConflictError ||
    error instanceof ChangeSetReviewDecisionConflictError
  );
}

/** Requests a full lifecycle refresh without changing the durable operation outcome. */
function requestGenerationRefresh(state: KnowledgeProductionReviewedApplyCoordinatorState): void {
  try {
    state.onGenerationRefreshRequired();
  } catch {
    // Durable truth remains recoverable even if lifecycle notification fails.
  }
}

/**
 * Persists acceptance and confirms an ambiguous storage failure by exact reread.
 */
async function acceptWithConfirmation(
  state: KnowledgeProductionReviewedApplyCoordinatorState,
  bundleId: string,
  pending: PendingChangeSetReviewRecord,
  acceptedDigest: string,
  acceptedChangeSet: unknown
): Promise<AcceptedChangeSetReviewRecord> {
  try {
    return await state.reviews.accept(
      bundleId,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest,
      acceptedChangeSet
    );
  } catch (error) {
    let observed;
    try {
      observed = await state.reviews.get(bundleId, pending.changeSetId);
    } catch {
      throw error;
    }
    if (
      observed?.outcome === "accepted" &&
      acceptedRecordMatches(observed, pending, acceptedDigest, acceptedChangeSet)
    ) {
      return observed;
    }
    throw error;
  }
}

/** Builds an exact transaction input from the accepted record and new Queue claim. */
function createTransactionInput(
  bundle: KnowledgeBundleConfig,
  accepted: AcceptedChangeSetReviewRecord,
  applying: Awaited<ReturnType<IngestQueue["beginReviewApply"]>>
): ChangeSetTransactionApplyInput {
  return {
    changeSet: accepted.acceptedChangeSet,
    bundle,
    jobClaim: {
      jobId: applying.id,
      attempt: applying.attempt,
      startedAt: applying.startedAt,
      sourceId: applying.sourceId,
      sourceContentHash: applying.sourceContentHash,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: applying.inputRevision,
    },
    manifestCommitIntent: accepted.manifestCommitIntent,
    manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
  };
}

/**
 * Generation-owned explicit Review Accept → transaction Apply coordinator.
 *
 * Caller cancellation is honored until acceptance becomes durable. From that
 * point forward, the retained operation either reaches a crash-safe boundary or
 * leaves Runtime evidence for explicit recovery; it never fabricates rollback.
 */
export class KnowledgeProductionReviewedApplyCoordinator {
  /** Captures only exact production dependencies for one released generation. */
  constructor(input: KnowledgeProductionReviewedApplyCoordinatorInput) {
    if (
      !(input.runtime instanceof KnowledgeRuntimeStore) ||
      !(input.queue instanceof IngestQueue) ||
      !(input.reviews instanceof ChangeSetReviewRepository) ||
      typeof input.targetResolver?.resolve !== "function" ||
      typeof input.fileStore?.observe !== "function" ||
      typeof input.fileStore?.compareAndSwap !== "function" ||
      typeof input.assertCurrent !== "function" ||
      typeof input.onGenerationRefreshRequired !== "function"
    ) {
      throw createAbortError();
    }
    KnowledgeSourceExecutionPlan.assert(input.plan);
    coordinatorStates.set(this, {
      runtime: input.runtime,
      queue: input.queue,
      reviews: input.reviews,
      plan: input.plan,
      bundles: snapshotBundles(input.bundles),
      targetResolver: input.targetResolver,
      fileStore: input.fileStore,
      reviewReject: new KnowledgeRuntimeReviewRejectPort(input.runtime),
      assertCurrent: () => input.assertCurrent(),
      onGenerationRefreshRequired: () => input.onGenerationRefreshRequired(),
      operationTail: Promise.resolve(),
    });
    Object.freeze(this);
  }

  /** Proves a coordinator was constructed by this module without exposing its state. */
  static assert(value: unknown): asserts value is KnowledgeProductionReviewedApplyCoordinator {
    requireCoordinatorState(value);
  }

  /** Serializes and executes one explicit selected Review apply. */
  submit(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    const state = requireCoordinatorState(this);
    const previous = state.operationTail;
    const operation = previous
      .catch(() => undefined)
      .then(() => this.execute(state, bundleId, command, signal));
    state.operationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  /** Runs one complete preflight, durable acceptance, transaction, and finalization. */
  private async execute(
    state: KnowledgeProductionReviewedApplyCoordinatorState,
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    const bundle = state.bundles.get(bundleId);
    if (!bundle) throw createAbortError();
    let acceptedDurably = false;
    try {
      const capturedCommand = snapshotKnowledgeReviewCommand(command);
      assertInvocation(state, signal);
      const context = await loadKnowledgeStudioReviewContext({
        runtime: state.runtime,
        bundle,
        targetResolver: state.targetResolver,
        changeSetId: capturedCommand.changeSetId,
        signal,
        assertCurrent: state.assertCurrent,
      });
      if (!context) return { kind: "stale" };
      const reviewPreparation = await state.plan.prepare(
        createSourceParseJob(bundleId, context.record.jobClaim),
        signal
      );
      assertInvocation(state, signal);
      const decision = await new KnowledgeReviewDecisionService(
        new KnowledgeProductionReviewCandidateValidator(bundle, reviewPreparation.artifacts)
      ).decide(context.record.proposal, context.observations, capturedCommand, signal);
      assertInvocation(state, signal);
      if (decision.kind === "blocked") {
        return { kind: "blocked", diagnostics: decision.diagnostics };
      }
      if (decision.kind === "rejected") {
        await state.reviewReject.rejectReviewAtomically(
          bundleId,
          createLiteralRejectCommand(context.record, capturedCommand)
        );
        return { kind: "rejected" };
      }

      const accepted = await acceptWithConfirmation(
        state,
        bundleId,
        context.record,
        decision.acceptedDigest,
        decision.changeSet
      );
      acceptedDurably = true;

      // UI cancellation no longer owns the durable action after acceptance.
      assertInvocation(state);
      let applying;
      try {
        applying = await state.queue.beginReviewApply(
          bundleId,
          createAcceptedReceipt(bundleId, accepted)
        );
      } catch {
        applying = await state.queue.beginReviewApply(
          bundleId,
          createAcceptedReceipt(bundleId, accepted)
        );
      }
      assertInvocation(state);
      const applySignal = new AbortController().signal;
      const applyPreparation = await state.plan.prepare(
        createSourceParseJob(bundleId, accepted.jobClaim),
        applySignal
      );
      assertInvocation(state);

      const validator = new ChangeSetValidator(
        state.fileStore,
        new KnowledgeProductionSourceArtifactResolver(applyPreparation.artifacts),
        new KnowledgeProductionProjectionValidator()
      );
      const transaction = new ChangeSetTransaction({
        storage: new KnowledgeRuntimeTransactionStorage(state.runtime),
        fileStore: state.fileStore,
        validator,
        authority: new KnowledgeRuntimeApplyAuthorityPort(state.runtime),
      });
      const transactionInput = createTransactionInput(bundle, accepted, applying);

      // Once apply enters, lifecycle invalidation may not interrupt journal/finalization.
      let receipt;
      try {
        receipt = await transaction.apply(transactionInput);
      } catch {
        receipt = await transaction.apply(transactionInput);
      }
      const reconciliation = await new ApplyCommitCoordinator({
        transaction,
        queue: state.queue,
        manifest: new KnowledgeRuntimeApplyCommitManifestPort(state.runtime),
      }).reconcile(bundle);
      if (
        reconciliation.kind !== "committed" ||
        reconciliation.receipt.transactionId !== receipt.transactionId
      ) {
        throw new Error("The reviewed knowledge apply did not finalize its exact transaction");
      }
      requestGenerationRefresh(state);
      return { kind: "applied" };
    } catch (error) {
      if (acceptedDurably) {
        requestGenerationRefresh(state);
        return { kind: "recovery_required" };
      }
      if (error instanceof KnowledgeReviewDecisionError) {
        return { kind: "blocked", diagnostics: error.diagnostics };
      }
      if (error instanceof ChangeSetValidationError) {
        return { kind: "blocked", diagnostics: error.diagnostics };
      }
      if (isStaleReviewError(error)) return { kind: "stale" };
      throw error;
    }
  }
}

Object.freeze(KnowledgeProductionReviewedApplyCoordinator.prototype);
Object.freeze(KnowledgeProductionReviewedApplyCoordinator);
