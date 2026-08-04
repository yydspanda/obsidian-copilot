import type {
  CompilerCandidateValidator,
  CompilerGenerationRequest,
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  bindKnowledgePrivateModelRouteToProfile,
  KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
  type KnowledgePrivateModelFailureClassifier,
  type KnowledgePrivateModelInvoke,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import {
  createKnowledgeProductionModelRouteLeaseOwner,
  KnowledgeProductionModelRouteLease,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  createKnowledgeExecutionOwner,
  type KnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  type KnowledgePipelineProfilePort,
  type KnowledgeSourceExecutionPlan,
  type KnowledgeWorkflowGenerationPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import type { RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import type { ChangeSetReviewSnapshot } from "@/knowledge/review/ReviewStorage";
import {
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeProductionCompileReviewHandler,
  KnowledgeProductionCompileReviewHandlerError,
} from "@/knowledge/startup/KnowledgeProductionCompileReviewHandler";
import { KnowledgeProductionPreparationExecutor } from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";
import {
  createKnowledgeExecutionTestHarness,
  KnowledgeExecutionMemoryRuntimeFile,
  type KnowledgeExecutionTestHarness,
} from "@/knowledge/testing/KnowledgeExecutionTestHarness";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const SOURCE_TEXT = "Project Atlas launch date is 2026-08-01.";
const SOURCE_BYTES = new TextEncoder().encode(`# Source\n${SOURCE_TEXT}\n`);
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);

const VALIDATION_SUCCESS = Object.freeze({
  validation: Object.freeze({ okfValid: true, citationsValid: true, linksValid: true }),
  diagnostics: Object.freeze([]),
});

interface AttemptOptions {
  invoke: KnowledgePrivateModelInvoke;
  classifyFailure?: KnowledgePrivateModelFailureClassifier;
  targetResolver?: CompilerTargetResolver;
  candidateValidator?: CompilerCandidateValidator;
  reviewExecutionOwner?: KnowledgeExecutionOwner;
  prepareReviewRuntime?(runtime: KnowledgeRuntimeStore): void;
  prepareReviews?(reviews: ChangeSetReviewRepository): Promise<void>;
  closeRouteBeforeRun?: boolean;
  closeQueueAfterReviewWrite?: boolean;
}

interface AttemptResult {
  queueResult: RunNextResult;
  queueSnapshot: IngestQueueSnapshot;
  reviewSnapshot: ChangeSetReviewSnapshot;
  runtimeContent: string;
}

/** Creates the single project-owned Bundle used by authentic preparation tests. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  return {
    projectId: "project-personal",
    config: {
      version: 1,
      id: BUNDLE_ID,
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: SCHEMA_PATH,
      reviewMode: "always",
    },
  };
}

/** Creates the initial durable Manifest for the production Queue attempt. */
function createManifest(): SourceManifest {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    revision: 1,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourcePath: SOURCE_PATH,
        sourceKey: toWindowsPathKey(SOURCE_PATH),
        custody: "user_managed",
      },
    ],
  };
}

/** Creates the parser identity retained in the exact pipeline fingerprint. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates the complete secret-free model profile bound to the private route. */
function createPipelineProfile(): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: {
      version: "knowledge-compiler-v1",
      configuration: { protocolVersion: 1 },
    },
    parsers: [createParserProfile()],
    model: {
      provider: "private-test-provider",
      model: "private-test-model",
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
        streaming: false,
        modelFallback: false,
        temperature: 0,
        maxTokens: 8192,
        reasoningEffort: "medium",
        verbosity: "medium",
        endpointIdentity: "1".repeat(64),
        routingIdentity: "2".repeat(64),
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates one exact source or schema byte read. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

/** Builds the authentic workflow plan shared by Queue proof and source parsing. */
async function createExecutionPlan(
  profile: KnowledgeBundlePipelineProfile,
  manifest: SourceManifest,
  executionOwner: ReturnType<typeof createKnowledgeExecutionOwner>
): Promise<KnowledgeSourceExecutionPlan> {
  const parser: KnowledgeByteParser = {
    /** Returns the exact parser profile used by planning. */
    getProfile: () => createParserProfile(),
    /** Converts exact source bytes into one trusted full-text artifact. */
    parse: async () => ({
      artifact: {
        kind: "text" as const,
        sourceId: SOURCE_ID,
        artifactId: "primary",
        artifactContentHash: createFileContentHash(SOURCE_TEXT),
        text: SOURCE_TEXT,
      },
    }),
  };
  const manifestPort: KnowledgeManifestSnapshotPort = { load: async () => manifest };
  const readerPort: KnowledgeExactArtifactReaderPort = {
    read: async (path) => createExactArtifact(path, SCHEMA_BYTES),
    readExpected: async (path) => createExactArtifact(path, SOURCE_BYTES),
  };
  const profilePort: KnowledgePipelineProfilePort = { resolve: async () => profile };
  const generationPort: KnowledgeWorkflowGenerationPort = { isCurrent: () => true };
  return await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: manifestPort,
    artifactReader: readerPort,
    pipelineProfile: profilePort,
    parsers: [parser],
    generation: generationPort,
  }).load([createOwner()], new AbortController().signal);
}

/** Creates a deterministic missing-target resolver for a new Wiki page. */
function createTargetResolver(): CompilerTargetResolver {
  return Object.freeze({
    resolve: async (targets: readonly CompilerTargetRequest[]) =>
      targets.map((target) => ({
        targetId: target.targetId,
        kind: "missing" as const,
        windowsPathKey: toWindowsPathKey(target.path),
      })),
  });
}

/** Creates an affirmative deterministic candidate validator for handler protocol tests. */
function createCandidateValidator(): CompilerCandidateValidator {
  return Object.freeze({ validate: async () => VALIDATION_SUCCESS });
}

/** Creates a valid analysis wire result with or without one write target. */
function createAnalysisWireOutput(includeTarget: boolean): string {
  return JSON.stringify({
    version: 1,
    summary: "Grounded Atlas summary",
    concepts: [],
    entities: [],
    claims: includeTarget ? [{ ref: "claim-atlas", text: SOURCE_TEXT }] : [],
    relations: [],
    citations: includeTarget
      ? [{ claimRef: "claim-atlas", evidenceId: "evidence-0001", relation: "supports" }]
      : [],
    targets: includeTarget
      ? [
          {
            ref: "target-atlas",
            path: "Wiki/Atlas.md",
            intent: "write",
            reason: "Record the grounded Atlas fact",
            claimRefs: ["claim-atlas"],
          },
        ]
      : [],
  });
}

/** Creates a valid generation wire result for all authorized write targets. */
function createGenerationWireOutput(request: CompilerGenerationRequest): string {
  return JSON.stringify({
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write",
      afterContent: `---\ntype: concept\n---\n\n# Atlas\n\n${SOURCE_TEXT}\n`,
    })),
  });
}

/** Creates a semantically invalid analysis result that becomes a controlled failure. */
function createUnsupportedAnalysisWireOutput(): string {
  return JSON.stringify({
    version: 1,
    summary: "Unsupported ungrounded analysis",
    concepts: [],
    entities: [],
    claims: [{ ref: "claim-atlas", text: SOURCE_TEXT }],
    relations: [],
    citations: [],
    targets: [],
  });
}

/** Creates one real repository for constructor validation without Runtime execution. */
function createStandaloneReviews(): ChangeSetReviewRepository {
  const runtime = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());
  const executionOwner = createKnowledgeExecutionOwner();
  return new ChangeSetReviewRepository(new KnowledgeRuntimeReviewStorage(runtime, executionOwner), {
    clock: () => 110,
  });
}

/** Creates one private route lease and its lifecycle close owner. */
function createRouteLease(
  profile: KnowledgeBundlePipelineProfile,
  invoke: KnowledgePrivateModelInvoke,
  classifyFailure?: KnowledgePrivateModelFailureClassifier
) {
  const route = bindKnowledgePrivateModelRouteToProfile(profile, invoke, classifyFailure);
  const owner = createKnowledgeProductionModelRouteLeaseOwner([{ bundleId: BUNDLE_ID, route }]);
  return { owner, lease: owner.getLease() };
}

/** Runs the complete authentic Queue → preparation → compile → Review handler chain. */
async function runAttempt(options: AttemptOptions): Promise<AttemptResult> {
  const profile = createPipelineProfile();
  const manifest = createManifest();
  const executionOwner = createKnowledgeExecutionOwner();
  const plan = await createExecutionPlan(profile, manifest, executionOwner);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected one planned source");

  let preparationExecutor: KnowledgeProductionPreparationExecutor | undefined;
  const capabilities: KnowledgeExecutionTestHarness = await createKnowledgeExecutionTestHarness({
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    jobId: "job-compile-review",
    clock: 100,
    executionOwner,
    execute: async (context) => {
      if (!preparationExecutor) throw new Error("Preparation executor is not installed");
      return await preparationExecutor.execute(context);
    },
  });
  const runtimeReviewStorage = new KnowledgeRuntimeReviewStorage(
    capabilities.runtime,
    options.reviewExecutionOwner ?? capabilities.executionOwner
  );
  options.prepareReviewRuntime?.(capabilities.runtime);
  if (options.closeQueueAfterReviewWrite) {
    const writeReview = capabilities.runtime.writeReview;
    jest.spyOn(capabilities.runtime, "writeReview").mockImplementation(async (...args) => {
      await writeReview.call(capabilities.runtime, ...args);
      capabilities.queue.close();
    });
  }
  const reviews = new ChangeSetReviewRepository(runtimeReviewStorage, { clock: () => 110 });
  await options.prepareReviews?.(reviews);
  const route = createRouteLease(profile, options.invoke, options.classifyFailure);
  try {
    const handler = new KnowledgeProductionCompileReviewHandler({
      routeLease: route.lease,
      targetResolver: options.targetResolver ?? createTargetResolver(),
      candidateValidator: options.candidateValidator ?? createCandidateValidator(),
      reviews,
    });
    preparationExecutor = new KnowledgeProductionPreparationExecutor(
      plan,
      capabilities.proofPort,
      handler
    );
    if (options.closeRouteBeforeRun) route.owner.close();
    const queueResult = await capabilities.queue.runNext(BUNDLE_ID);
    return {
      queueResult,
      queueSnapshot: await capabilities.queue.load(BUNDLE_ID),
      reviewSnapshot: await reviews.load(BUNDLE_ID),
      runtimeContent: await capabilities.file.read(),
    };
  } finally {
    route.owner.close();
  }
}

/** Returns the single durable Queue job produced by a test attempt. */
function requireOnlyJob(snapshot: IngestQueueSnapshot) {
  const job = snapshot.jobs[0];
  if (!job || snapshot.jobs.length !== 1) throw new Error("Expected exactly one Queue job");
  return job;
}

describe("KnowledgeProductionCompileReviewHandler", () => {
  it("rejects a Review owner from another workflow before invoking the model", async () => {
    const invoke = jest.fn(async () => createAnalysisWireOutput(false));
    const attempt = await runAttempt({
      invoke,
      reviewExecutionOwner: createKnowledgeExecutionOwner(),
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(requireOnlyJob(attempt.queueSnapshot)).toMatchObject({
      status: "failed",
      failure: { code: "unexpected_executor_failure", retryable: false },
    });
    expect(attempt.reviewSnapshot.records).toEqual([]);
  });

  it("does not let one execution owner bind Review storage to two Runtime instances", () => {
    const owner = createKnowledgeExecutionOwner();
    const runtimeA = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());
    const runtimeB = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());

    expect(() => new KnowledgeRuntimeReviewStorage(runtimeA, owner)).not.toThrow();
    expect(() => new KnowledgeRuntimeReviewStorage(runtimeB, owner)).toThrow();
  });

  it("persists an exact proposal before returning its pending Review receipt", async () => {
    const invokedStages: string[] = [];
    const attempt = await runAttempt({
      invoke: async (stage, request) => {
        invokedStages.push(stage);
        return stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest);
      },
    });

    expect(attempt.queueResult).toMatchObject({
      kind: "executed",
      status: "awaiting_review",
      jobId: "job-compile-review",
    });
    expect(invokedStages).toEqual(["analysis", "generation"]);
    const job = requireOnlyJob(attempt.queueSnapshot);
    const record = attempt.reviewSnapshot.records[0];
    expect(job).toMatchObject({
      status: "awaiting_review",
      stage: "review",
      changeSetId: record?.changeSetId,
    });
    expect(record).toMatchObject({
      outcome: "pending",
      recordRevision: 0,
      proposal: { status: "proposed", bundleId: BUNDLE_ID },
      jobClaim: {
        jobId: job.id,
        sourceId: job.sourceId,
        sourceContentHash: job.sourceContentHash,
        pipelineFingerprint: job.pipelineFingerprint,
        inputRevision: job.inputRevision,
        attempt: job.attempt,
      },
    });
    expect(record?.proposalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.manifestCommitPlanDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(attempt.queueSnapshot.pendingReviews).toEqual([
      expect.objectContaining({
        kind: "durable",
        jobId: job.id,
        changeSetId: record?.changeSetId,
        proposalDigest: record?.proposalDigest,
        reviewRecordRevision: 0,
      }),
    ]);
  });

  it("finishes the Queue hand-off when lifecycle closure follows the durable Review write", async () => {
    const attempt = await runAttempt({
      invoke: async (stage, request) =>
        stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest),
      closeQueueAfterReviewWrite: true,
    });

    expect(attempt.queueResult).toMatchObject({
      kind: "executed",
      status: "awaiting_review",
      jobId: "job-compile-review",
    });
    expect(requireOnlyJob(attempt.queueSnapshot)).toMatchObject({
      status: "awaiting_review",
      stage: "review",
    });
    expect(attempt.queueSnapshot.pendingReviews).toEqual([
      expect.objectContaining({ kind: "durable", jobId: "job-compile-review" }),
    ]);
    expect(attempt.reviewSnapshot.records).toEqual([
      expect.objectContaining({ outcome: "pending" }),
    ]);
  });

  it("derives a stable non-empty no-change identity without creating Review state", async () => {
    const first = await runAttempt({ invoke: async () => createAnalysisWireOutput(false) });
    const second = await runAttempt({ invoke: async () => createAnalysisWireOutput(false) });
    const firstJob = requireOnlyJob(first.queueSnapshot);
    const secondJob = requireOnlyJob(second.queueSnapshot);
    if (firstJob.status !== "completed" || secondJob.status !== "completed") {
      throw new Error("Expected completed no-change Queue jobs");
    }

    expect(first.queueResult).toMatchObject({ kind: "executed", status: "completed" });
    expect(firstJob).toMatchObject({ status: "completed", stage: "completed" });
    expect(firstJob.changeSetId).toMatch(/^knowledge-no-changes-[a-f0-9]{64}$/);
    expect(secondJob.changeSetId).toBe(firstJob.changeSetId);
    expect(first.reviewSnapshot.records).toEqual([]);
    expect(second.reviewSnapshot.records).toEqual([]);
  });

  it("projects a controlled Compiler failure as a safe nonretryable Queue failure", async () => {
    const attempt = await runAttempt({
      invoke: async () => createUnsupportedAnalysisWireOutput(),
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(attempt.queueResult).toMatchObject({ kind: "executed", status: "failed" });
    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_compiler_analysis_rejected",
        message: "The knowledge compiler rejected the analysis result",
        retryable: false,
      },
    });
    expect(attempt.reviewSnapshot.records).toEqual([]);
  });

  it("preserves an authentic Compiler infrastructure classification and exact Queue policy", async () => {
    const providerFailure = new Error("private provider canary");
    const attempt = await runAttempt({
      invoke: async () => {
        throw providerFailure;
      },
      classifyFailure: (error) => (error === providerFailure ? "rate_limited" : undefined),
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_provider_rate_limited",
        message: "The knowledge model provider rate limit was reached",
        retryable: true,
      },
    });
    expect(attempt.runtimeContent).not.toContain("private provider canary");
  });

  it("sanitizes an unrelated Review rejection as a retryable dependency failure", async () => {
    const secretCanary = "private-review-storage-canary";
    const attempt = await runAttempt({
      invoke: async (stage, request) =>
        stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest),
      prepareReviewRuntime: (runtime) => {
        jest.spyOn(runtime, "writeReview").mockRejectedValue(new Error(secretCanary));
      },
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_compile_review_dependency_failed",
        message: "A knowledge compile or review dependency is temporarily unavailable",
        retryable: true,
      },
    });
    expect(attempt.runtimeContent).not.toContain(secretCanary);
  });

  it("projects an authentic deterministic Review contract failure as nonretryable", async () => {
    const secretCanary = "invalid-review-payload-canary";
    const attempt = await runAttempt({
      invoke: async (stage, request) =>
        stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest),
      prepareReviewRuntime: (runtime) => {
        let readCount = 0;
        const readReview = runtime.readReview;
        jest.spyOn(runtime, "readReview").mockImplementation(async (bundleId) => {
          readCount += 1;
          return readCount === 1
            ? {
                version: 2,
                bundleId: BUNDLE_ID,
                revision: 0,
                records: [],
                unexpected: secretCanary,
              }
            : (readReview.call(runtime, bundleId) as Promise<unknown>);
        });
      },
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_review_state_conflict",
        message: "The compiled proposal cannot enter the current review state",
        retryable: false,
      },
    });
    expect(attempt.runtimeContent).not.toContain(secretCanary);
  });

  it("does not let an error-name forgery impersonate Queue cancellation", async () => {
    const secretCanary = "forged-abort-review-canary";
    const forgedAbort = new Error(secretCanary);
    forgedAbort.name = "AbortError";
    const attempt = await runAttempt({
      invoke: async (stage, request) =>
        stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest),
      prepareReviewRuntime: (runtime) => {
        jest.spyOn(runtime, "writeReview").mockRejectedValue(forgedAbort);
      },
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_compile_review_dependency_failed",
        retryable: true,
      },
    });
    expect(attempt.runtimeContent).not.toContain(secretCanary);
  });

  it("does not let a platform AbortError cancel an attempt whose Queue signal is live", async () => {
    const attempt = await runAttempt({
      invoke: async () => createAnalysisWireOutput(false),
      closeRouteBeforeRun: true,
    });
    const job = requireOnlyJob(attempt.queueSnapshot);

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "knowledge_compile_review_dependency_failed",
        message: "A knowledge compile or review dependency is temporarily unavailable",
        retryable: true,
      },
    });
    expect(attempt.reviewSnapshot.records).toEqual([]);
  });

  it.each(["accepted", "rejected"] as const)(
    "rejects an already-%s Review record instead of forging a pending receipt",
    async (outcome) => {
      const invoke: KnowledgePrivateModelInvoke = async (stage, request) =>
        stage === "analysis"
          ? createAnalysisWireOutput(true)
          : createGenerationWireOutput(request as CompilerGenerationRequest);
      const baseline = await runAttempt({ invoke });
      const pending = baseline.reviewSnapshot.records[0];
      if (!pending || pending.outcome !== "pending") {
        throw new Error("Expected one baseline pending Review record");
      }
      const attempt = await runAttempt({
        invoke,
        prepareReviews: async (reviews) => {
          const seeded = await reviews.saveProposal(BUNDLE_ID, {
            proposal: pending.proposal,
            proposalDigest: pending.proposalDigest,
            manifestCommitPlan: pending.manifestCommitPlan,
            manifestCommitPlanDigest: pending.manifestCommitPlanDigest,
            jobClaim: pending.jobClaim,
          });
          if (seeded.outcome !== "pending") {
            throw new Error("Expected one seeded pending Review record");
          }
          if (outcome === "rejected") {
            await reviews.reject(
              BUNDLE_ID,
              seeded.changeSetId,
              seeded.recordRevision,
              seeded.proposalDigest
            );
            return;
          }
          await reviews.accept(
            BUNDLE_ID,
            seeded.changeSetId,
            seeded.recordRevision,
            seeded.proposalDigest,
            { ...seeded.proposal, status: "accepted" }
          );
        },
      });
      const job = requireOnlyJob(attempt.queueSnapshot);

      expect(job).toMatchObject({
        status: "failed",
        failure: { code: "knowledge_review_state_conflict", retryable: false },
      });
      expect(attempt.queueSnapshot.pendingReviews).toEqual([]);
    }
  );

  it("rejects top-level and nested dependency accessors without invoking them", () => {
    const profile = createPipelineProfile();
    const route = createRouteLease(profile, async () => createAnalysisWireOutput(false));
    const reviews = createStandaloneReviews();
    let topLevelGetterCalls = 0;
    const accessorInput = {
      routeLease: route.lease,
      targetResolver: createTargetResolver(),
      candidateValidator: createCandidateValidator(),
    } as Partial<ConstructorParameters<typeof KnowledgeProductionCompileReviewHandler>[0]>;
    Object.defineProperty(accessorInput, "reviews", {
      enumerable: true,
      get: () => {
        topLevelGetterCalls += 1;
        return reviews;
      },
    });
    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler(
          accessorInput as ConstructorParameters<typeof KnowledgeProductionCompileReviewHandler>[0]
        )
    ).toThrow(KnowledgeProductionCompileReviewHandlerError);
    expect(topLevelGetterCalls).toBe(0);

    let resolverGetterCalls = 0;
    const accessorResolver = {} as CompilerTargetResolver;
    Object.defineProperty(accessorResolver, "resolve", {
      enumerable: true,
      get: () => {
        resolverGetterCalls += 1;
        return createTargetResolver().resolve;
      },
    });
    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler({
          routeLease: route.lease,
          targetResolver: accessorResolver,
          candidateValidator: createCandidateValidator(),
          reviews,
        })
    ).toThrow(KnowledgeProductionCompileReviewHandlerError);
    expect(resolverGetterCalls).toBe(0);

    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler({
          routeLease: route.lease,
          targetResolver: createTargetResolver(),
          candidateValidator: createCandidateValidator(),
          reviews,
        })
    ).not.toThrow();
    route.owner.close();
  });

  it("rejects forged route, Review repository, and handler objects", async () => {
    const profile = createPipelineProfile();
    const route = createRouteLease(profile, async () => createAnalysisWireOutput(false));
    const reviews = createStandaloneReviews();
    const forgedLease = Object.create(
      KnowledgeProductionModelRouteLease.prototype
    ) as KnowledgeProductionModelRouteLease;
    const forgedReviews = Object.create(
      ChangeSetReviewRepository.prototype
    ) as ChangeSetReviewRepository;
    const overriddenReviews = createStandaloneReviews();
    let overriddenSaveCalls = 0;
    expect(() =>
      Object.defineProperty(overriddenReviews, "saveProposal", {
        configurable: true,
        value: async () => {
          overriddenSaveCalls += 1;
          throw new Error("overridden Review method must not run");
        },
      })
    ).toThrow();

    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler({
          routeLease: forgedLease,
          targetResolver: createTargetResolver(),
          candidateValidator: createCandidateValidator(),
          reviews,
        })
    ).toThrow(KnowledgeProductionCompileReviewHandlerError);
    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler({
          routeLease: route.lease,
          targetResolver: createTargetResolver(),
          candidateValidator: createCandidateValidator(),
          reviews: forgedReviews,
        })
    ).toThrow(KnowledgeProductionCompileReviewHandlerError);
    expect(overriddenSaveCalls).toBe(0);

    const forgedHandler = Object.create(
      KnowledgeProductionCompileReviewHandler.prototype
    ) as KnowledgeProductionCompileReviewHandler;
    await expect(
      forgedHandler.execute(
        {} as Parameters<KnowledgeProductionCompileReviewHandler["execute"]>[0],
        {} as Parameters<KnowledgeProductionCompileReviewHandler["execute"]>[1]
      )
    ).rejects.toBeInstanceOf(KnowledgeProductionCompileReviewHandlerError);

    expect(
      () =>
        new KnowledgeProductionCompileReviewHandler({
          routeLease: route.lease,
          targetResolver: createTargetResolver(),
          candidateValidator: createCandidateValidator(),
          reviews,
        })
    ).not.toThrow();
    route.owner.close();
  });

  it("consumes the route generation's single builder slot during construction", () => {
    const profile = createPipelineProfile();
    const route = createRouteLease(profile, async () => createAnalysisWireOutput(false));
    const input = {
      routeLease: route.lease,
      targetResolver: createTargetResolver(),
      candidateValidator: createCandidateValidator(),
      reviews: createStandaloneReviews(),
    };

    expect(() => new KnowledgeProductionCompileReviewHandler(input)).not.toThrow();
    expect(() => new KnowledgeProductionCompileReviewHandler(input)).toThrow(
      KnowledgeProductionCompileReviewHandlerError
    );
    route.owner.close();
  });
});
