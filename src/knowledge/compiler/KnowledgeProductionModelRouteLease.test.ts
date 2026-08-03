import type {
  CompilerAnalysisRequest,
  CompilerCandidateValidationInput,
  CompilerGenerationRequest,
  CompilerTargetRequest,
  KnowledgeCompileResult,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompilerInfrastructureError } from "@/knowledge/compiler/KnowledgeCompiler";
import {
  bindKnowledgePrivateModelRouteToProfile,
  KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
  type KnowledgePrivateModelInvoke,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import {
  createKnowledgeProductionModelRouteLeaseOwner,
  KnowledgeProductionCompileAttempt,
  KnowledgeProductionCompileAttemptBuilder,
  KnowledgeProductionModelRouteLease,
  KnowledgeProductionModelRouteLeaseError,
  KnowledgeProductionModelRouteLeaseOwner,
  type KnowledgeProductionCompileAttemptDependencies,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeAuthorizedSourcePreparationBinder,
  type KnowledgeAuthorizedSourcePreparation,
} from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { KnowledgeIngestExecutionAuthorityBinder } from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  type KnowledgePipelineProfilePort,
  type KnowledgeWorkflowGenerationPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import type { IngestExecutionContext } from "@/knowledge/ingest/queue/IngestQueue";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import {
  createKnowledgeExecutionTestHarness,
  type KnowledgeExecutionTestHarness,
} from "@/knowledge/testing/KnowledgeExecutionTestHarness";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const MODEL = "private-test-model";
const SOURCE_TEXT = "Exact source text";
const SOURCE_BYTES = new TextEncoder().encode(`# Source\n${SOURCE_TEXT}\n`);
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);
const VALIDATION_SUCCESS = {
  validation: { okfValid: true, citationsValid: true, linksValid: true },
  diagnostics: [],
} as const;

interface AuthorizedLeaseHarnessContext {
  context: IngestExecutionContext;
  preparation: KnowledgeAuthorizedSourcePreparation;
  readCurrentStage(): Promise<string | undefined>;
}

interface CompileDependencyHarness {
  dependencies: KnowledgeProductionCompileAttemptDependencies;
  resolvedSignals: AbortSignal[];
  validatedSignals: AbortSignal[];
  validationInputs: CompilerCandidateValidationInput[];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates the project-owned Bundle used by every authentic lease attempt. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  const config: KnowledgeBundleConfig = {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
  return { projectId: "project-personal", config };
}

/** Creates one durable source Manifest for the real Runtime test harness. */
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

/** Creates the parser profile shared by workflow planning and source parsing. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates one complete secret-free profile accepted by the private model adapter. */
function createPipelineProfile(model = MODEL): KnowledgeBundlePipelineProfile {
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
      model,
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

/** Creates one exact source or schema read result with detached bytes. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

/** Creates an externally controlled promise for in-flight invalidation tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

/** Executes a callback inside one real Runtime-backed Queue claim and preparation. */
async function runAuthorizedLeaseAttempt(
  profile: KnowledgeBundlePipelineProfile,
  handler: (value: AuthorizedLeaseHarnessContext) => Promise<void>,
  manifest: SourceManifest = createManifest()
): Promise<void> {
  const owner = createOwner();
  const parser: KnowledgeByteParser = {
    getProfile: () => createParserProfile(),
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
  const executionOwner = createKnowledgeExecutionOwner();
  const plan = await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: manifestPort,
    artifactReader: readerPort,
    pipelineProfile: profilePort,
    parsers: [parser],
    generation: generationPort,
  }).load([owner], new AbortController().signal);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected an authorized watched source");

  const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();
  let capabilities: KnowledgeExecutionTestHarness | undefined;
  let handlerFailure: unknown;
  capabilities = await createKnowledgeExecutionTestHarness({
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    jobId: "job-production-route-lease",
    executionOwner,
    execute: async (context) => {
      if (!capabilities) throw new Error("Expected initialized Runtime capabilities");
      const authority = await new KnowledgeIngestExecutionAuthorityBinder(
        capabilities.proofPort
      ).bind(context.executionClaim);
      const preparation = await preparationBinder.prepare(plan, authority);
      const readCurrentStage = async (): Promise<string | undefined> => {
        if (!capabilities) throw new Error("Expected initialized Runtime capabilities");
        const snapshot = await capabilities.queue.load(BUNDLE_ID);
        return snapshot.jobs.find((job) => job.id === context.job.id)?.stage;
      };
      try {
        await handler({ context, preparation, readCurrentStage });
      } catch (error) {
        handlerFailure = error;
        throw error;
      }
      return { kind: "no_changes", changeSetId: "changeset-production-route-lease" };
    },
  });

  const result = await capabilities.queue.runNext(BUNDLE_ID);
  if (handlerFailure !== undefined) {
    if (handlerFailure instanceof Error) throw handlerFailure;
    throw new Error("The authorized production route lease test handler failed");
  }
  expect(result).toMatchObject({ kind: "executed", status: "completed" });
}

/** Creates deterministic read-only target and candidate-validation dependencies. */
function createCompileDependencies(): CompileDependencyHarness {
  const resolvedSignals: AbortSignal[] = [];
  const validatedSignals: AbortSignal[] = [];
  const validationInputs: CompilerCandidateValidationInput[] = [];
  const dependencies: KnowledgeProductionCompileAttemptDependencies = {
    targetResolver: {
      resolve: async (targets: readonly CompilerTargetRequest[], signal: AbortSignal) => {
        resolvedSignals.push(signal);
        return targets.map((target) => ({
          targetId: target.targetId,
          kind: "missing" as const,
          windowsPathKey: toWindowsPathKey(target.path),
        }));
      },
    },
    candidateValidator: {
      validate: async (input, signal) => {
        validatedSignals.push(signal);
        validationInputs.push(input);
        return VALIDATION_SUCCESS;
      },
    },
  };
  return { dependencies, resolvedSignals, validatedSignals, validationInputs };
}

/** Builds and consumes one exact Queue-bound production compile attempt. */
async function compileAuthorizedAttempt(
  lease: KnowledgeProductionModelRouteLease,
  preparation: KnowledgeAuthorizedSourcePreparation,
  context: IngestExecutionContext,
  dependencies: KnowledgeProductionCompileAttemptDependencies
): Promise<KnowledgeCompileResult> {
  const builder = lease.createAttemptBuilder(dependencies);
  const attempt = await builder.build(preparation, context);
  return lease.compile(attempt);
}

/** Creates one first-stage model output with optional new-page work. */
function createAnalysisWireOutput(includeTarget: boolean): string {
  return JSON.stringify({
    version: 1,
    summary: "Grounded source summary",
    concepts: [],
    entities: [],
    claims: [{ ref: "claim-primary", text: SOURCE_TEXT }],
    relations: [],
    citations: [
      {
        claimRef: "claim-primary",
        evidenceId: "evidence-0001",
        relation: "supports",
      },
    ],
    targets: includeTarget
      ? [
          {
            ref: "target-new-page",
            path: "Wiki/New Page.md",
            intent: "write",
            reason: "Create the grounded page",
            claimRefs: ["claim-primary"],
          },
        ]
      : [],
  });
}

/** Creates one valid second-stage write result for every approved target. */
function createGenerationWireOutput(request: CompilerGenerationRequest): string {
  return JSON.stringify({
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write",
      afterContent: "---\ntype: concept\n---\n\n# New Page\n",
    })),
  });
}

/** Creates one profile-bound private route owner and its close-incapable lease. */
function createLease(
  profile: KnowledgeBundlePipelineProfile,
  invoke: KnowledgePrivateModelInvoke,
  bundleId = BUNDLE_ID
): {
  owner: KnowledgeProductionModelRouteLeaseOwner;
  lease: KnowledgeProductionModelRouteLease;
} {
  const route = bindKnowledgePrivateModelRouteToProfile(profile, invoke);
  const owner = createKnowledgeProductionModelRouteLeaseOwner([{ bundleId, route }]);
  return { owner, lease: owner.getLease() };
}

/** Captures an expected asynchronous rejection without retaining it in production state. */
async function captureFailure(action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  return caught;
}

describe("KnowledgeProductionModelRouteLease", () => {
  it("returns no_changes through an authentic Queue claim without exposing a captured secret", async () => {
    const profile = createPipelineProfile();
    const secretCanary = "sk-production-route-result-canary";

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation, readCurrentStage }) => {
      const invokedStages: string[] = [];
      const invokedSignals: AbortSignal[] = [];
      const analysisRequests: CompilerAnalysisRequest[] = [];
      const { owner, lease } = createLease(profile, async (stage, request, signal) => {
        if (secretCanary.length === 0) throw new Error("Expected retained test credential");
        invokedStages.push(stage);
        invokedSignals.push(signal);
        expect(signal.aborted).toBe(false);
        analysisRequests.push(request as CompilerAnalysisRequest);
        return createAnalysisWireOutput(false);
      });
      const dependencyHarness = createCompileDependencies();

      const result = await compileAuthorizedAttempt(
        lease,
        preparation,
        context,
        dependencyHarness.dependencies
      );

      expect(result).toMatchObject({ kind: "no_changes" });
      expect(invokedStages).toEqual(["analysis"]);
      expect(invokedSignals).toHaveLength(1);
      expect(invokedSignals[0]).toBe(context.signal);
      expect(analysisRequests).toHaveLength(1);
      expect(analysisRequests[0]).toMatchObject({
        bundle: { id: BUNDLE_ID },
        source: { sourceId: SOURCE_ID },
        contextPages: [],
        targetAuthorizations: [],
        evidence: [
          {
            evidenceId: "evidence-0001",
            locator: { kind: "quote", excerpt: SOURCE_TEXT },
          },
        ],
      });
      expect(dependencyHarness.resolvedSignals).toHaveLength(0);
      expect(dependencyHarness.validatedSignals).toHaveLength(0);
      expect(JSON.stringify({ owner, lease, result })).not.toContain(secretCanary);
      expect(await readCurrentStage()).toBe("validating");
      owner.close();
    });
  });

  it("runs an authentic two-stage compile and returns a validated proposal", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation, readCurrentStage }) => {
      const invokedStages: string[] = [];
      const invokedSignals: AbortSignal[] = [];
      const { owner, lease } = createLease(profile, async (stage, request, signal) => {
        invokedStages.push(stage);
        invokedSignals.push(signal);
        expect(signal.aborted).toBe(false);
        if (stage === "analysis") return createAnalysisWireOutput(true);
        return createGenerationWireOutput(request as CompilerGenerationRequest);
      });
      const dependencyHarness = createCompileDependencies();

      const result = await compileAuthorizedAttempt(
        lease,
        preparation,
        context,
        dependencyHarness.dependencies
      );

      expect(result).toMatchObject({
        kind: "proposed",
        changeSet: {
          status: "proposed",
          changes: [{ operation: "create", path: "Wiki/New Page.md" }],
        },
      });
      expect(invokedStages).toEqual(["analysis", "generation"]);
      expect(invokedSignals).toHaveLength(2);
      expect(invokedSignals[0]).toBe(invokedSignals[1]);
      expect(invokedSignals[0]).toBe(context.signal);
      expect(dependencyHarness.resolvedSignals).toEqual([context.signal]);
      expect(dependencyHarness.validatedSignals).toEqual([context.signal]);
      expect(dependencyHarness.validationInputs[0]?.draft.createdAt).toBe(context.job.createdAt);
      expect(await readCurrentStage()).toBe("validating");
      owner.close();
    });
  });

  it("rejects Bundle and profile mismatches before invoking either private route", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const invoke: KnowledgePrivateModelInvoke = async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      };
      const missingBundle = createLease(profile, invoke, "different-bundle");
      const dependencies = createCompileDependencies().dependencies;

      const bundleFailure = await captureFailure(() =>
        missingBundle.lease.createAttemptBuilder(dependencies).build(preparation, context)
      );
      expect(bundleFailure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(invokeCalls).toBe(0);
      missingBundle.owner.close();

      const mismatchedProfile = createLease(createPipelineProfile("different-model"), invoke);
      const profileFailure = await captureFailure(() =>
        mismatchedProfile.lease.createAttemptBuilder(dependencies).build(preparation, context)
      );
      expect(profileFailure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(invokeCalls).toBe(0);
      mismatchedProfile.owner.close();

      const matchingProfile = createLease(profile, invoke);
      await expect(
        compileAuthorizedAttempt(matchingProfile.lease, preparation, context, dependencies)
      ).resolves.toMatchObject({ kind: "no_changes" });
      expect(invokeCalls).toBe(1);
      matchingProfile.owner.close();
    });
  });

  it("reserves an authentic preparation against sequential reuse", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const dependencies = createCompileDependencies().dependencies;
      const builder = lease.createAttemptBuilder(dependencies);
      const attempt = await builder.build(preparation, context);

      await expect(lease.compile(attempt)).resolves.toMatchObject({
        kind: "no_changes",
      });
      const reuseFailure = await captureFailure(() => builder.build(preparation, context));
      const attemptReuseFailure = await captureFailure(() => lease.compile(attempt));

      expect(reuseFailure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(attemptReuseFailure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(invokeCalls).toBe(1);
      owner.close();
    });
  });

  it("allows exactly one concurrent build to reserve an authentic preparation", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const dependencies = createCompileDependencies().dependencies;
      const builder = lease.createAttemptBuilder(dependencies);

      const settled = await Promise.allSettled([
        builder.build(preparation, context),
        builder.build(preparation, context),
      ]);
      const fulfilled = settled.filter(
        (entry): entry is PromiseFulfilledResult<KnowledgeProductionCompileAttempt> =>
          entry.status === "fulfilled"
      );
      const rejected = settled.filter(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      await expect(lease.compile(fulfilled[0].value)).resolves.toMatchObject({
        kind: "no_changes",
      });
      expect(invokeCalls).toBe(1);
      owner.close();
    });
  });

  it("allows exactly one concurrent compile to consume an opaque attempt", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const attempt = await lease
        .createAttemptBuilder(createCompileDependencies().dependencies)
        .build(preparation, context);

      const settled = await Promise.allSettled([lease.compile(attempt), lease.compile(attempt)]);
      const fulfilled = settled.filter(
        (entry): entry is PromiseFulfilledResult<KnowledgeCompileResult> =>
          entry.status === "fulfilled"
      );
      const rejected = settled.filter(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value).toMatchObject({ kind: "no_changes" });
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(invokeCalls).toBe(1);
      owner.close();
    });
  });

  it("rejects copied jobs, substituted signals, substituted reporters, and raw preparations", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      let dependencyGetterCalls = 0;
      const accessorDependencies = {
        candidateValidator: createCompileDependencies().dependencies.candidateValidator,
      } as Partial<KnowledgeProductionCompileAttemptDependencies>;
      Object.defineProperty(accessorDependencies, "targetResolver", {
        enumerable: true,
        get: () => {
          dependencyGetterCalls += 1;
          throw new Error("private dependency accessor canary");
        },
      });
      expect(() =>
        lease.createAttemptBuilder(
          accessorDependencies as KnowledgeProductionCompileAttemptDependencies
        )
      ).toThrow(KnowledgeProductionModelRouteLeaseError);
      expect(dependencyGetterCalls).toBe(0);
      const builder = lease.createAttemptBuilder(createCompileDependencies().dependencies);
      expect(() => lease.createAttemptBuilder(createCompileDependencies().dependencies)).toThrow(
        KnowledgeProductionModelRouteLeaseError
      );
      const invalidContexts: IngestExecutionContext[] = [
        { ...context, job: { ...context.job } },
        { ...context, signal: new AbortController().signal },
        {
          ...context,
          reportStage: async (stage) => {
            await context.reportStage(stage);
          },
        },
      ];

      for (const invalidContext of invalidContexts) {
        const failure = await captureFailure(() => builder.build(preparation, invalidContext));
        expect(failure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      }
      const rawFailure = await captureFailure(() =>
        lease.compile(preparation as unknown as KnowledgeProductionCompileAttempt)
      );
      expect(rawFailure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(invokeCalls).toBe(0);

      const attempt = await builder.build(preparation, context);
      expect(JSON.stringify({ builder, attempt })).toBe('{"builder":{},"attempt":{}}');
      await expect(lease.compile(attempt)).resolves.toMatchObject({ kind: "no_changes" });
      expect(invokeCalls).toBe(1);
      owner.close();
    });
  });

  it("rejects build or compile after route revocation without invoking the model", async () => {
    const profile = createPipelineProfile();
    let invokeCalls = 0;

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const builder = lease.createAttemptBuilder(createCompileDependencies().dependencies);
      owner.close();

      const failure = await captureFailure(() => builder.build(preparation, context));
      expect(failure).toMatchObject({ name: "AbortError" });
    });

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const attempt = await lease
        .createAttemptBuilder(createCompileDependencies().dependencies)
        .build(preparation, context);
      owner.close();

      const failure = await captureFailure(() => lease.compile(attempt));
      expect(failure).toMatchObject({ name: "AbortError" });
    });

    expect(invokeCalls).toBe(0);
  });

  it("rejects an attempt if its durable Queue stage moves before compile", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let invokeCalls = 0;
      const { owner, lease } = createLease(profile, async () => {
        invokeCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const attempt = await lease
        .createAttemptBuilder(createCompileDependencies().dependencies)
        .build(preparation, context);
      await context.reportStage("analyzing");

      await captureFailure(() => lease.compile(attempt));
      expect(invokeCalls).toBe(0);
      owner.close();
    });
  });

  it("binds each opaque attempt to the exact route lease that minted its builder", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      let primaryCalls = 0;
      let foreignCalls = 0;
      const primary = createLease(profile, async () => {
        primaryCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const foreign = createLease(profile, async () => {
        foreignCalls += 1;
        return createAnalysisWireOutput(false);
      });
      const attempt = await primary.lease
        .createAttemptBuilder(createCompileDependencies().dependencies)
        .build(preparation, context);

      const failure = await captureFailure(() => foreign.lease.compile(attempt));
      expect(failure).toBeInstanceOf(KnowledgeProductionModelRouteLeaseError);
      expect(primaryCalls).toBe(0);
      expect(foreignCalls).toBe(0);
      await expect(primary.lease.compile(attempt)).resolves.toMatchObject({
        kind: "no_changes",
      });
      expect(primaryCalls).toBe(1);
      expect(foreignCalls).toBe(0);
      primary.owner.close();
      foreign.owner.close();
    });
  });

  it("rejects a completed in-flight result after its owner closes instead of publishing it", async () => {
    const profile = createPipelineProfile();

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      const entered = createDeferred<void>();
      const response = createDeferred<string>();
      const { owner, lease } = createLease(profile, async (_stage, _request, signal) => {
        expect(signal).toBe(context.signal);
        entered.resolve();
        return response.promise;
      });
      let published: KnowledgeCompileResult | undefined;
      const attempt = await lease
        .createAttemptBuilder(createCompileDependencies().dependencies)
        .build(preparation, context);
      const compiling = lease.compile(attempt).then((result) => {
        published = result;
        return result;
      });
      await entered.promise;
      expect(context.signal.aborted).toBe(false);

      owner.close();
      expect(context.signal.aborted).toBe(false);
      response.resolve(createAnalysisWireOutput(false));
      const failure = await captureFailure(() => compiling);

      expect(failure).toMatchObject({ name: "AbortError" });
      expect(published).toBeUndefined();
      expect(lease.isCurrent()).toBe(false);
    });
  });

  it("sanitizes a private-route secret from owner, lease, errors, and result slots", async () => {
    const profile = createPipelineProfile();
    const secretCanary = "sk-production-route-error-canary";

    await runAuthorizedLeaseAttempt(profile, async ({ context, preparation }) => {
      const { owner, lease } = createLease(profile, async () => {
        throw new Error(`private provider rejected ${secretCanary}`);
      });
      let result: KnowledgeCompileResult | undefined;
      const failure = await captureFailure(async () => {
        result = await compileAuthorizedAttempt(
          lease,
          preparation,
          context,
          createCompileDependencies().dependencies
        );
      });

      expect(failure).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
      expect(KnowledgeCompilerInfrastructureError.inspect(failure)).toMatchObject({
        stage: "analysis",
        code: "model_authority_failed",
      });
      expect(String(failure)).not.toContain(secretCanary);
      expect(JSON.stringify({ owner, lease, failure, result })).not.toContain(secretCanary);
      expect(result).toBeUndefined();
      owner.close();
    });
  });

  it("rejects direct construction, spread copies, and prototype forgeries", () => {
    let invokeCalls = 0;
    const profile = createPipelineProfile();
    const route = bindKnowledgePrivateModelRouteToProfile(profile, async () => {
      invokeCalls += 1;
      return createAnalysisWireOutput(false);
    });
    const bindings = [{ bundleId: BUNDLE_ID, route }];
    const owner = createKnowledgeProductionModelRouteLeaseOwner(bindings);
    const lease = owner.getLease();

    expect(() => new KnowledgeProductionModelRouteLease(Symbol("forged"), bindings)).toThrow(
      KnowledgeProductionModelRouteLeaseError
    );
    expect(() => new KnowledgeProductionModelRouteLeaseOwner(Symbol("forged"), bindings)).toThrow(
      KnowledgeProductionModelRouteLeaseError
    );
    expect(() => new KnowledgeProductionCompileAttempt(Symbol("forged"))).toThrow(
      KnowledgeProductionModelRouteLeaseError
    );
    expect(
      () => new KnowledgeProductionCompileAttemptBuilder(Symbol("forged"), lease, {} as never)
    ).toThrow(KnowledgeProductionModelRouteLeaseError);
    expect(() => KnowledgeProductionModelRouteLease.assert({ ...lease })).toThrow(
      KnowledgeProductionModelRouteLeaseError
    );
    expect(() =>
      KnowledgeProductionModelRouteLease.assert(
        Object.create(KnowledgeProductionModelRouteLease.prototype)
      )
    ).toThrow(KnowledgeProductionModelRouteLeaseError);
    expect(() => KnowledgeProductionModelRouteLeaseOwner.assert({ ...owner })).toThrow(
      KnowledgeProductionModelRouteLeaseError
    );
    expect(() =>
      KnowledgeProductionModelRouteLeaseOwner.assert(
        Object.create(KnowledgeProductionModelRouteLeaseOwner.prototype)
      )
    ).toThrow(KnowledgeProductionModelRouteLeaseError);
    expect(() =>
      KnowledgeProductionCompileAttempt.assert(
        Object.create(KnowledgeProductionCompileAttempt.prototype)
      )
    ).toThrow(KnowledgeProductionModelRouteLeaseError);
    expect(() =>
      KnowledgeProductionCompileAttemptBuilder.assert(
        Object.create(KnowledgeProductionCompileAttemptBuilder.prototype)
      )
    ).toThrow(KnowledgeProductionModelRouteLeaseError);
    expect(invokeCalls).toBe(0);
    owner.close();
  });
});
