import type {
  CompilerCandidateValidator,
  CompilerTargetResolver,
  KnowledgeCompileFailure,
  KnowledgeCompileNoChanges,
  KnowledgeCompileProposal,
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeProductionCompileAttemptBuilder,
  KnowledgeProductionModelRouteLease,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import { KnowledgeAuthorizedSourcePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createKnowledgeCompilerIngestExecutorError } from "@/knowledge/ingest/KnowledgeCompilerIngestFailure";
import {
  IngestExecutorError,
  type IngestExecutionContext,
  type IngestExecutionResult,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  ChangeSetReviewBundleMismatchError,
  ChangeSetReviewDecisionConflictError,
  ChangeSetReviewIdentityConflictError,
  ChangeSetReviewIncompatibleVersionError,
  ChangeSetReviewNotFoundError,
  ChangeSetReviewRecordRevisionConflictError,
  ChangeSetReviewRepository,
  ChangeSetReviewRevisionOverflowError,
  ChangeSetReviewValidationError,
} from "@/knowledge/review/ChangeSetReviewRepository";
import type {
  ChangeSetReviewJobClaim,
  ChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";
import { KnowledgeRuntimeReviewStorage } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import type { KnowledgePreparedIngestHandler } from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";
import { sha256 } from "@/utils/hash";

/** Exact generation-owned dependencies for compile-to-review production hand-off. */
export interface KnowledgeProductionCompileReviewHandlerInput {
  /** Preflight-owned private model routes for the current production generation. */
  routeLease: KnowledgeProductionModelRouteLease;
  /** Read-only exact Vault target resolver captured for the same App generation. */
  targetResolver: CompilerTargetResolver;
  /** Deterministic generated-candidate validator captured for this generation. */
  candidateValidator: CompilerCandidateValidator;
  /** Review repository backed by the same Runtime envelope as the owning Queue. */
  reviews: ChangeSetReviewRepository;
}

interface CapturedHandlerContext {
  job: IngestExecutionContext["job"];
  signal: AbortSignal;
}

interface HandlerState {
  routeLease: KnowledgeProductionModelRouteLease;
  builder: KnowledgeProductionCompileAttemptBuilder;
  executionOwner: KnowledgeExecutionOwner;
  saveProposal: ChangeSetReviewRepository["saveProposal"];
}

interface SafeExecutorFailure {
  code: string;
  message: string;
  retryable: boolean;
  rateLimited: boolean;
}

const handlerStates = new WeakMap<object, HandlerState>();

// Capturing the concrete base method prevents an own-property override or later
// prototype mutation from replacing the strict durable repository boundary.
// eslint-disable-next-line @typescript-eslint/unbound-method
const REVIEW_SAVE_PROPOSAL = ChangeSetReviewRepository.prototype.saveProposal;

const CONTROLLED_COMPILER_FAILURES: Readonly<
  Record<KnowledgeCompilerStage, Readonly<SafeExecutorFailure>>
> = Object.freeze({
  input: Object.freeze({
    code: "knowledge_compiler_input_rejected",
    message: "The knowledge compiler rejected its derived input",
    retryable: false,
    rateLimited: false,
  }),
  analysis: Object.freeze({
    code: "knowledge_compiler_analysis_rejected",
    message: "The knowledge compiler rejected the analysis result",
    retryable: false,
    rateLimited: false,
  }),
  target_resolution: Object.freeze({
    code: "knowledge_compiler_target_rejected",
    message: "The knowledge compiler rejected the resolved target state",
    retryable: false,
    rateLimited: false,
  }),
  generation: Object.freeze({
    code: "knowledge_compiler_generation_rejected",
    message: "The knowledge compiler rejected the generated proposal",
    retryable: false,
    rateLimited: false,
  }),
  candidate_validation: Object.freeze({
    code: "knowledge_compiler_candidate_rejected",
    message: "The knowledge compiler rejected deterministic candidate validation",
    retryable: false,
    rateLimited: false,
  }),
});

const REVIEW_STATE_CONFLICT: Readonly<SafeExecutorFailure> = Object.freeze({
  code: "knowledge_review_state_conflict",
  message: "The compiled proposal cannot enter the current review state",
  retryable: false,
  rateLimited: false,
});

const DEPENDENCY_FAILURE: Readonly<SafeExecutorFailure> = Object.freeze({
  code: "knowledge_compile_review_dependency_failed",
  message: "A knowledge compile or review dependency is temporarily unavailable",
  retryable: true,
  rateLimited: false,
});

/** Stable construction failure retaining no dependency, Vault, source, or credential value. */
export class KnowledgeProductionCompileReviewHandlerError extends Error {
  /** Creates one value-free invalid-composition failure. */
  constructor() {
    super("The production Knowledge compile-to-review handler is unavailable");
    this.name = "KnowledgeProductionCompileReviewHandlerError";
  }
}

/** Reads one required own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
  return descriptor.value;
}

/** Requires the exact constructor record shape before any dependency is captured. */
function snapshotInput(
  value: KnowledgeProductionCompileReviewHandlerInput
): Readonly<KnowledgeProductionCompileReviewHandlerInput> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    const expected = ["candidateValidator", "reviews", "routeLease", "targetResolver"];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string") ||
      (keys as string[]).sort().some((key, index) => key !== expected[index])
    ) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    return Object.freeze({
      routeLease: readDataProperty(value, "routeLease") as KnowledgeProductionModelRouteLease,
      targetResolver: readDataProperty(value, "targetResolver") as CompilerTargetResolver,
      candidateValidator: readDataProperty(
        value,
        "candidateValidator"
      ) as CompilerCandidateValidator,
      reviews: readDataProperty(value, "reviews") as ChangeSetReviewRepository,
    });
  } catch {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
}

/** Rejects prototype-only repository forgeries before the route builder is consumed. */
function getReviewExecutionOwner(value: unknown): KnowledgeExecutionOwner {
  try {
    if (
      !(value instanceof ChangeSetReviewRepository) ||
      Object.getPrototypeOf(value) !== ChangeSetReviewRepository.prototype
    ) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    const storage = Object.getOwnPropertyDescriptor(value, "storage");
    const attempts = Object.getOwnPropertyDescriptor(value, "maxWriteAttempts");
    const clock = Object.getOwnPropertyDescriptor(value, "clock");
    if (
      !storage ||
      !("value" in storage) ||
      typeof storage.value !== "object" ||
      storage.value === null ||
      !attempts ||
      !("value" in attempts) ||
      !Number.isSafeInteger(attempts.value) ||
      attempts.value < 1 ||
      !clock ||
      !("value" in clock) ||
      typeof clock.value !== "function" ||
      Object.prototype.hasOwnProperty.call(value, "saveProposal")
    ) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    return KnowledgeRuntimeReviewStorage.getExecutionOwner(storage.value);
  } catch {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
}

/** Captures the repository method and exact receiver without retaining a mutable lookup. */
function captureSaveProposal(
  repository: ChangeSetReviewRepository
): ChangeSetReviewRepository["saveProposal"] {
  return async (bundleId, input) =>
    await Reflect.apply(REVIEW_SAVE_PROPOSAL, repository, [bundleId, input]);
}

/** Returns hidden state only for an authentic handler instance. */
function requireHandlerState(value: unknown): HandlerState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
  const state = handlerStates.get(value);
  if (!state) throw new KnowledgeProductionCompileReviewHandlerError();
  return state;
}

/** Captures Queue job and signal references through data descriptors before asynchronous work. */
function captureContext(context: IngestExecutionContext): CapturedHandlerContext {
  try {
    const job = readDataProperty(context, "job");
    const signal = readDataProperty(context, "signal");
    if (typeof job !== "object" || job === null || typeof signal !== "object" || signal === null) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    return Object.freeze({
      job: job as IngestExecutionContext["job"],
      signal: signal as AbortSignal,
    });
  } catch {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
}

/** Creates a fresh safe cancellation without retaining an arbitrary abort reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Creates one Queue-bound failure from fixed non-sensitive policy facts. */
function createExecutorError(
  failure: Readonly<SafeExecutorFailure>,
  signal: AbortSignal
): IngestExecutorError {
  return new IngestExecutorError({ ...failure }, signal);
}

/** Detects deterministic Review contract/state failures for which model retry cannot help. */
function isDeterministicReviewFailure(error: unknown): boolean {
  return (
    error instanceof ChangeSetReviewValidationError ||
    error instanceof ChangeSetReviewIncompatibleVersionError ||
    error instanceof ChangeSetReviewBundleMismatchError ||
    error instanceof ChangeSetReviewIdentityConflictError ||
    error instanceof ChangeSetReviewNotFoundError ||
    error instanceof ChangeSetReviewRecordRevisionConflictError ||
    error instanceof ChangeSetReviewDecisionConflictError ||
    error instanceof ChangeSetReviewRevisionOverflowError
  );
}

/** Maps a dependency rejection without allowing its payload or message to escape. */
function projectDependencyFailure(error: unknown, signal: AbortSignal): never {
  // The Queue-owned signal is the only cancellation authority. DOMException is
  // constructible in any renderer and crosses realms unreliably, so a thrown
  // AbortError-shaped value cannot independently cancel this exact attempt.
  if (signal.aborted) throw createAbortError();
  const compilerFailure = createKnowledgeCompilerIngestExecutorError(error, signal);
  if (compilerFailure) throw compilerFailure;
  if (isDeterministicReviewFailure(error)) {
    throw createExecutorError(REVIEW_STATE_CONFLICT, signal);
  }
  throw createExecutorError(DEPENDENCY_FAILURE, signal);
}

/** Creates the exact durable six-field Review claim for one Queue attempt. */
function createReviewJobClaim(job: IngestExecutionContext["job"]): ChangeSetReviewJobClaim {
  return Object.freeze({
    jobId: job.id,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
  });
}

/** Compares one durable Review claim with the exact Queue processing attempt. */
function matchesReviewJobClaim(
  record: ChangeSetReviewRecord,
  expected: ChangeSetReviewJobClaim
): boolean {
  const actual = record.jobClaim;
  return (
    actual.jobId === expected.jobId &&
    actual.sourceId === expected.sourceId &&
    actual.sourceContentHash === expected.sourceContentHash &&
    actual.pipelineFingerprint === expected.pipelineFingerprint &&
    actual.inputRevision === expected.inputRevision &&
    actual.attempt === expected.attempt
  );
}

/** Creates a stable Queue-visible identity for a deterministic no-change compilation. */
function createNoChangesId(result: KnowledgeCompileNoChanges): string {
  return `knowledge-no-changes-${sha256(
    `knowledge-production-no-changes-v1\n${result.compileContextDigest}\n${result.analysisDigest}`
  )}`;
}

/** Projects one deterministic Compiler rejection without persisting its diagnostics. */
function projectControlledFailure(result: KnowledgeCompileFailure, signal: AbortSignal): never {
  throw createExecutorError(CONTROLLED_COMPILER_FAILURES[result.stage], signal);
}

/** Persists one proposal and returns only its exact durable pending Review receipt. */
async function persistProposal(
  state: HandlerState,
  result: KnowledgeCompileProposal,
  context: CapturedHandlerContext
): Promise<IngestExecutionResult> {
  const jobClaim = createReviewJobClaim(context.job);
  let record: ChangeSetReviewRecord;
  try {
    state.routeLease.assertCurrent();
    record = await state.saveProposal(result.changeSet.bundleId, {
      proposal: result.changeSet,
      proposalDigest: result.proposalDigest,
      manifestCommitPlan: result.manifestCommitPlan,
      manifestCommitPlanDigest: result.manifestCommitPlanDigest,
      jobClaim,
    });
  } catch (error) {
    projectDependencyFailure(error, context.signal);
  }

  // A successful Review write is the hand-off commit boundary. Lifecycle
  // invalidation may already have aborted the Queue signal while the durable
  // write was in flight, but this exact receipt must still reach Queue
  // finalization so startup recovery never sees an orphaned proposal.

  if (
    record.outcome !== "pending" ||
    record.recordRevision !== 0 ||
    record.changeSetId !== result.changeSet.id ||
    record.proposalDigest !== result.proposalDigest ||
    record.manifestCommitPlanDigest !== result.manifestCommitPlanDigest ||
    record.proposal.bundleId !== context.job.bundleId ||
    record.recordedAt < context.job.createdAt ||
    !matchesReviewJobClaim(record, jobClaim)
  ) {
    throw createExecutorError(REVIEW_STATE_CONFLICT, context.signal);
  }

  return Object.freeze({
    kind: "awaiting_review" as const,
    changeSetId: record.changeSetId,
    reviewDecision: Object.freeze({
      outcome: "pending" as const,
      bundleId: context.job.bundleId,
      changeSetId: record.changeSetId,
      proposalDigest: record.proposalDigest,
      recordRevision: record.recordRevision,
      recordedAt: record.recordedAt,
      jobClaim: Object.freeze({ ...record.jobClaim }),
    }),
  });
}

/**
 * Compiles one authentic production preparation and durably hands proposals to Review.
 *
 * The Review repository must carry the exact opaque execution owner already
 * bound to the Queue Runtime and workflow plan. The owner is checked again on
 * every authentic preparation before any target read or model call can begin.
 */
export class KnowledgeProductionCompileReviewHandler implements KnowledgePreparedIngestHandler {
  /** Captures all generation-owned ports and consumes the route's single builder slot once. */
  constructor(input: KnowledgeProductionCompileReviewHandlerInput) {
    try {
      const captured = snapshotInput(input);
      KnowledgeProductionModelRouteLease.assert(captured.routeLease);
      captured.routeLease.assertCurrent();
      const executionOwner = getReviewExecutionOwner(captured.reviews);
      const saveProposal = captureSaveProposal(captured.reviews);
      const builder = captured.routeLease.createAttemptBuilder(
        Object.freeze({
          targetResolver: captured.targetResolver,
          candidateValidator: captured.candidateValidator,
        })
      );
      KnowledgeProductionCompileAttemptBuilder.assert(builder);
      handlerStates.set(this, {
        routeLease: captured.routeLease,
        builder,
        executionOwner,
        saveProposal,
      });
    } catch {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    Object.freeze(this);
  }

  /** Requires this handler to carry one exact production composition owner. */
  static assertExecutionOwner(
    value: KnowledgeProductionCompileReviewHandler,
    expected: KnowledgeExecutionOwner
  ): void {
    KnowledgeExecutionOwner.assert(expected);
    if (requireHandlerState(value).executionOwner !== expected) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
  }

  /**
   * Runs build → compile and returns only a Queue-safe no-change or Review outcome.
   *
   * @param preparation - Authentic Runtime/workflow source preparation
   * @param context - Exact Queue-owned execution context
   * @returns Stable no-change identity or exact durable pending Review receipt
   */
  async execute(
    preparation: KnowledgeAuthorizedSourcePreparation,
    context: IngestExecutionContext
  ): Promise<IngestExecutionResult> {
    const state = requireHandlerState(this);
    const capturedContext = captureContext(context);
    if (
      !KnowledgeAuthorizedSourcePreparation.matchesExecutionOwner(preparation, state.executionOwner)
    ) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
    let result;
    try {
      const attempt = await state.builder.build(preparation, context);
      result = await state.routeLease.compile(attempt);
      state.routeLease.assertCurrent();
    } catch (error) {
      projectDependencyFailure(error, capturedContext.signal);
    }

    if (result.kind === "failed") {
      projectControlledFailure(result, capturedContext.signal);
    }
    if (result.kind === "no_changes") {
      return Object.freeze({
        kind: "no_changes" as const,
        changeSetId: createNoChangesId(result),
      });
    }
    return persistProposal(state, result, capturedContext);
  }
}

Object.freeze(KnowledgeProductionCompileReviewHandlerError.prototype);
Object.freeze(KnowledgeProductionCompileReviewHandlerError);
Object.freeze(KnowledgeProductionCompileReviewHandler.prototype);
Object.freeze(KnowledgeProductionCompileReviewHandler);
