import type {
  CompilerCandidateValidator,
  CompilerTargetResolver,
  KnowledgeCompileFailure,
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

export interface KnowledgeProductionCompileReviewHandlerInput {
  routeLease: KnowledgeProductionModelRouteLease;

  targetResolver: CompilerTargetResolver;

  candidateValidator: CompilerCandidateValidator;

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

// eslint-disable-next-line @typescript-eslint/unbound-method -- capture the concrete base method before prototype mutation can replace it
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

// Diagnostic messages and fields may contain model-proposed paths or unknown keys.
// Only these fixed compiler rule identifiers may enter durable failure text.
// https://github.com/yydspanda/obsidian-copilot/issues/8
const SAFE_COMPILER_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "schema_invalid_type",
  "schema_invalid_value",
  "schema_unrecognized_keys",
  "schema_custom",
  "compiler_output_limit_exceeded",
  "compiler_analysis_character_limit_exceeded",
  "compiler_analysis_ref_duplicate",
  "compiler_analysis_node_ref_ambiguous",
  "compiler_analysis_semantic_duplicate",
  "compiler_relation_endpoint_unknown",
  "compiler_relation_self_reference",
  "compiler_relation_semantic_duplicate",
  "compiler_citation_claim_unknown",
  "compiler_citation_evidence_unknown",
  "compiler_citation_duplicate",
  "compiler_claim_ungrounded",
  "compiler_generation_new_target_unchanged",
  "compiler_target_outside_wiki",
  "compiler_target_equals_wiki_root",
  "compiler_target_not_markdown",
  "compiler_target_inside_source",
  "compiler_target_is_schema",
  "compiler_target_claim_duplicate",
  "compiler_target_claim_unknown",
  "compiler_target_manifest_authorization_missing",
  "compiler_target_delete_unauthorized",
  "compiler_target_write_unauthorized",
  "compiler_target_claim_required",
  "compiler_target_semantic_duplicate",
  "compiler_target_windows_collision",
  "compiler_target_path_overlap",
  "path_required",
  "path_absolute",
  "path_backslash",
  "path_empty_segment",
  "path_traversal",
  "path_invalid_windows_character",
  "path_windows_reserved_name",
  "path_windows_trailing_character",
]);

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

export class KnowledgeProductionCompileReviewHandlerError extends Error {
  constructor() {
    super("The production Knowledge compile-to-review handler is unavailable");
    this.name = "KnowledgeProductionCompileReviewHandlerError";
  }
}

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

function captureSaveProposal(
  repository: ChangeSetReviewRepository
): ChangeSetReviewRepository["saveProposal"] {
  return async (bundleId, input) =>
    await Reflect.apply(REVIEW_SAVE_PROPOSAL, repository, [bundleId, input]);
}

function requireHandlerState(value: unknown): HandlerState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionCompileReviewHandlerError();
  }
  const state = handlerStates.get(value);
  if (!state) throw new KnowledgeProductionCompileReviewHandlerError();
  return state;
}

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

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function createExecutorError(
  failure: Readonly<SafeExecutorFailure>,
  signal: AbortSignal
): IngestExecutorError {
  return new IngestExecutorError({ ...failure }, signal);
}

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

function projectDependencyFailure(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) throw createAbortError();
  const compilerFailure = createKnowledgeCompilerIngestExecutorError(error, signal);
  if (compilerFailure) throw compilerFailure;
  if (isDeterministicReviewFailure(error)) {
    throw createExecutorError(REVIEW_STATE_CONFLICT, signal);
  }
  throw createExecutorError(DEPENDENCY_FAILURE, signal);
}

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

function projectControlledFailure(result: KnowledgeCompileFailure, signal: AbortSignal): never {
  const failure = CONTROLLED_COMPILER_FAILURES[result.stage];
  // Source-writing and destination checks need the same bounded identifiers as
  // historical analysis failures, without persisting model text or changing retries.
  // https://github.com/yydspanda/obsidian-copilot/issues/20
  const codes =
    result.stage === "analysis" ||
    result.stage === "generation" ||
    result.stage === "target_resolution"
      ? [
          ...new Set(
            result.diagnostics
              .map(({ code }) => code)
              .filter((code) => SAFE_COMPILER_DIAGNOSTIC_CODES.has(code))
          ),
        ].slice(0, 5)
      : [];
  throw createExecutorError(
    {
      ...failure,
      message:
        codes.length > 0 ? `${failure.message}. Checks: ${codes.join(", ")}.` : failure.message,
    },
    signal
  );
}

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

export class KnowledgeProductionCompileReviewHandler implements KnowledgePreparedIngestHandler {
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

  static assertExecutionOwner(
    value: KnowledgeProductionCompileReviewHandler,
    expected: KnowledgeExecutionOwner
  ): void {
    KnowledgeExecutionOwner.assert(expected);
    if (requireHandlerState(value).executionOwner !== expected) {
      throw new KnowledgeProductionCompileReviewHandlerError();
    }
  }

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
        changeSetId: result.noChangesId,
        manifestCommitPlan: result.manifestCommitPlan,
        manifestCommitPlanDigest: result.manifestCommitPlanDigest,
      });
    }
    return persistProposal(state, result, capturedContext);
  }
}

Object.freeze(KnowledgeProductionCompileReviewHandlerError.prototype);
Object.freeze(KnowledgeProductionCompileReviewHandlerError);
Object.freeze(KnowledgeProductionCompileReviewHandler.prototype);
Object.freeze(KnowledgeProductionCompileReviewHandler);
