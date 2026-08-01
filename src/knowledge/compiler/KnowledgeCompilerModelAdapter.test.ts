import {
  bindKnowledgeCompilerModelAdapter,
  bindKnowledgePrivateModelRoute,
  KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
  KnowledgeCompilerModelAdapter,
  KnowledgeCompilerModelAdapterError,
  KnowledgePrivateModelRoute,
  type KnowledgeModelStageReporter,
  type KnowledgePrivateModelInvoke,
  type KnowledgePrivateModelRouteDescriptor,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import type {
  CompilerAnalysisRequest,
  CompilerGenerationRequest,
  CompilerModelPort,
  CompilerTargetRequest,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeCompiler,
  KnowledgeCompilerInfrastructureError,
} from "@/knowledge/compiler/KnowledgeCompiler";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { ProjectKnowledgePipelineProfileSource } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
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
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import type {
  KnowledgeExecutionMemoryRuntimeFile,
  KnowledgeExecutionTestHarness,
} from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import { createKnowledgeExecutionTestHarness } from "@/knowledge/testing/KnowledgeExecutionTestHarness";

/** Creates one complete secret-free model route declaration. */
function createRouteDescriptor(
  configurationOverrides: Record<string, JsonValue> = {}
): KnowledgePrivateModelRouteDescriptor {
  return {
    provider: "deepseek",
    model: "deepseek-chat",
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
      ...configurationOverrides,
    },
  };
}

/** Creates one strict first-stage provider result as serialized JSON text. */
function createAnalysisWireOutput(): string {
  return JSON.stringify({
    version: 1,
    summary: "summary",
    concepts: [],
    entities: [],
    claims: [{ ref: "claim-primary", text: "Exact source text" }],
    relations: [],
    citations: [
      {
        claimRef: "claim-primary",
        evidenceId: "evidence-primary",
        relation: "supports",
      },
    ],
    targets: [
      {
        ref: "target-new-page",
        path: "Wiki/New Page.md",
        intent: "write",
        reason: "Create the grounded page",
        claimRefs: ["claim-primary"],
      },
    ],
  });
}

/** Creates one reviewed provider route through the token-protected factory. */
function createPrivateRoute(invoke: KnowledgePrivateModelInvoke): KnowledgePrivateModelRoute {
  return bindKnowledgePrivateModelRoute(createRouteDescriptor(), invoke);
}

/** Expects one stable sanitized adapter error code. */
function expectAdapterError(
  operation: () => unknown,
  code: KnowledgeCompilerModelAdapterError["code"]
): void {
  try {
    operation();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeCompilerModelAdapterError);
    expect((error as KnowledgeCompilerModelAdapterError).code).toBe(code);
    expect((error as Error).message).not.toContain("1".repeat(64));
  }
}

/** Expects one stable sanitized adapter error from an asynchronous operation. */
async function expectAdapterErrorAsync(
  operation: () => Promise<unknown>,
  code: KnowledgeCompilerModelAdapterError["code"],
  forbiddenText?: string
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeCompilerModelAdapterError);
  expect(caught).toMatchObject({ code });
  if (forbiddenText) {
    expect((caught as Error).message).not.toContain(forbiddenText);
    expect(JSON.stringify(caught)).not.toContain(forbiddenText);
  }
}

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const SOURCE_BYTES = new TextEncoder().encode("# Source\nExact source text\n");
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);

/** Creates the exact project-owned Bundle used by the authorized model harness. */
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

/** Creates one durable source Manifest. */
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

/** Creates the parser profile used by both the plan and parser capability. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates one exact secret-free pipeline profile matching the private route. */
function createPipelineProfile(): KnowledgeBundlePipelineProfile {
  const route = createRouteDescriptor();
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: {
      version: "knowledge-compiler-v1",
      configuration: { protocolVersion: 1 },
    },
    parsers: [createParserProfile()],
    model: {
      provider: route.provider,
      model: route.model,
      configuration: route.configuration,
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates a detached exact-reader result for test source or schema bytes. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

interface AuthorizedModelHarnessContext {
  context: IngestExecutionContext;
  preparation: KnowledgeAuthorizedSourcePreparation;
  manifest: SourceManifest;
  runtimeFile: KnowledgeExecutionMemoryRuntimeFile;
  reportStage: KnowledgeModelStageReporter;
  reportStages: ("analyzing" | "generating")[];
}

/** Creates an authentic plan, Queue claim, Runtime authority, and source preparation. */
async function runAuthorizedModelAttempt(
  handler: (value: AuthorizedModelHarnessContext) => Promise<void>
): Promise<void> {
  const owner = createOwner();
  const manifest = createManifest();
  const profile = createPipelineProfile();
  const parser: KnowledgeByteParser = {
    getProfile: () => createParserProfile(),
    parse: async () => ({
      artifact: {
        kind: "text" as const,
        sourceId: SOURCE_ID,
        artifactId: "primary",
        artifactContentHash: createFileContentHash("Exact source text"),
        text: "Exact source text",
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
  const loader = new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: manifestPort,
    artifactReader: readerPort,
    pipelineProfile: profilePort,
    parsers: [parser],
    generation: generationPort,
  });
  const plan = await loader.load([owner], new AbortController().signal);
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
    jobId: "job-model-adapter",
    executionOwner,
    execute: async (context) => {
      if (!capabilities) throw new Error("Expected initialized Runtime test capabilities");
      const authority = await new KnowledgeIngestExecutionAuthorityBinder(
        capabilities.proofPort
      ).bind(context.executionClaim);
      const preparation = await preparationBinder.prepare(plan, authority);
      const reportStages: ("analyzing" | "generating")[] = [];
      const reportStage: KnowledgeModelStageReporter = async (stage) => {
        await context.reportStage(stage);
        reportStages.push(stage);
      };
      try {
        await handler({
          context,
          preparation,
          manifest,
          runtimeFile: capabilities.file,
          reportStage,
          reportStages,
        });
      } catch (error) {
        handlerFailure = error;
        throw error;
      }
      return { kind: "no_changes", changeSetId: "changeset-model-adapter" };
    },
  });
  const result = await capabilities.queue.runNext(BUNDLE_ID);
  if (handlerFailure !== undefined) {
    if (handlerFailure instanceof Error) throw handlerFailure;
    throw new Error("The authorized model test handler failed");
  }
  expect(result).toMatchObject({
    kind: "executed",
    status: "completed",
  });
}

/** Creates a valid compiler input from the exact authorized source preparation. */
function createCompileInput(
  preparation: KnowledgeAuthorizedSourcePreparation
): KnowledgeCompileInput {
  const input = preparation.getPreparation();
  const artifact = input.artifacts[0];
  if (!artifact || artifact.kind !== "text") {
    throw new Error("Expected one text artifact in the model adapter harness");
  }
  return {
    bundle: input.bundle,
    operation: input.operation,
    source: input.source,
    manifest: input.manifest,
    schema: input.schema,
    artifacts: [...input.artifacts],
    evidence: [
      {
        evidenceId: "evidence-primary",
        locator: {
          kind: "quote",
          sourceId: artifact.sourceId,
          artifactId: artifact.artifactId,
          artifactContentHash: artifact.artifactContentHash,
          excerpt: artifact.text,
          quoteHash: createQuoteHash(artifact.text),
        },
      },
    ],
    contextPages: [],
    targetAuthorizations: [],
    createdAt: 100,
  };
}

/** Creates a compiler around one explicit model boundary and deterministic no-write dependencies. */
function createCompiler(model: CompilerModelPort): KnowledgeCompiler {
  return new KnowledgeCompiler({
    model,
    targetResolver: {
      resolve: async (targets: readonly CompilerTargetRequest[]) =>
        targets.map((target) => ({
          targetId: target.targetId,
          kind: "missing" as const,
          windowsPathKey: toWindowsPathKey(target.path),
        })),
    },
    candidateValidator: {
      validate: async () => ({
        validation: { okfValid: true, citationsValid: true, linksValid: true },
        diagnostics: [],
      }),
    },
  });
}

/** Creates strict stage-specific JSON text for a successful private route call. */
function createSuccessfulWireOutput(
  stage: "analysis" | "generation",
  request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>
): string {
  if (stage === "analysis") return createAnalysisWireOutput();
  return JSON.stringify({
    version: 1,
    targetSetDigest: (request as CompilerGenerationRequest).targetSetDigest,
    files: (request as CompilerGenerationRequest).targets.map((target) => ({
      targetId: target.targetId,
      outcome: "unchanged",
    })),
  });
}

/** Delivers an authentic analysis capability while withholding the compiler's model call. */
async function authorizeAnalysisWithCompiler(
  adapter: ReturnType<typeof bindKnowledgeCompilerModelAdapter>,
  preparation: KnowledgeAuthorizedSourcePreparation,
  signal: AbortSignal
): Promise<CompilerAnalysisRequest> {
  let request: CompilerAnalysisRequest | undefined;
  const model: CompilerModelPort = {
    authorizeModelCall: (authorization) => adapter.authorizeModelCall(authorization),
    analyze: async (value) => {
      request = value;
      throw new Error("stop-after-analysis-authorization");
    },
    generate: async () => {
      throw new Error("Unexpected generation call");
    },
  };
  let failure: unknown;
  try {
    await createCompiler(model).compile(createCompileInput(preparation), signal);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
  expect(failure).toMatchObject({ stage: "analysis" });
  if (!request) throw new Error("Expected the compiler's exact analysis request");
  return request;
}

/** Delivers both model-stage capabilities from one exact compiler invocation. */
async function authorizeGenerationWithCompiler(
  adapter: ReturnType<typeof bindKnowledgeCompilerModelAdapter>,
  preparation: KnowledgeAuthorizedSourcePreparation,
  signal: AbortSignal
): Promise<CompilerGenerationRequest> {
  let authorizationCount = 0;
  let request: CompilerGenerationRequest | undefined;
  const model: CompilerModelPort = {
    authorizeModelCall: (authorization) => {
      authorizationCount += 1;
      adapter.authorizeModelCall(authorization);
    },
    analyze: (value, modelSignal) => adapter.analyze(value, modelSignal),
    generate: async (value) => {
      request = value;
      throw new Error("stop-after-generation-authorization");
    },
  };
  let failure: unknown;
  try {
    await createCompiler(model).compile(createCompileInput(preparation), signal);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
  expect(failure).toMatchObject({ stage: "generation" });
  expect(authorizationCount).toBe(2);
  if (!request) throw new Error("Expected the compiler's exact generation request");
  return request;
}

describe("KnowledgePrivateModelRoute", () => {
  it("retains the private invoke closure only behind an opaque frozen capability", () => {
    const secretCanary = "sk-private-model-secret-canary";
    const invoke: KnowledgePrivateModelInvoke = async () => createAnalysisWireOutput();
    const input = createRouteDescriptor();
    const route = bindKnowledgePrivateModelRoute(input, invoke);

    expect(Object.isFrozen(route)).toBe(true);
    expect(Reflect.ownKeys(route)).toEqual([]);
    expect("invoke" in route).toBe(false);
    expect(JSON.stringify(route)).not.toContain(secretCanary);
    expect(route.getDescriptor()).not.toBe(input);
    expect(route.getDescriptor().configuration).not.toBe(input.configuration);
    expect(Object.isFrozen(route.getDescriptor())).toBe(true);
    expect(Object.isFrozen(route.getDescriptor().configuration)).toBe(true);

    expectAdapterError(
      () => new KnowledgePrivateModelRoute(Symbol("forged"), input, invoke),
      "route_invalid"
    );
    expectAdapterError(() => KnowledgePrivateModelRoute.assert({ ...route }), "route_invalid");
    expectAdapterError(
      () => KnowledgePrivateModelRoute.assert(Object.create(KnowledgePrivateModelRoute.prototype)),
      "route_invalid"
    );
  });

  it.each([
    ["behaviorContractVersion", 2],
    ["routeContractVersion", 2],
    ["adapterPolicy", "shared-chat-adapter"],
    ["routingPolicy", "fallback-enabled"],
    ["structuredOutput", "provider-json-mode"],
    ["streaming", true],
    ["modelFallback", true],
    ["endpointIdentity", "https://api.example.test"],
    ["routingIdentity", "tenant-plaintext"],
  ] as const)("rejects an unsupported %s contract before retaining the route", (key, value) => {
    expectAdapterError(
      () =>
        bindKnowledgePrivateModelRoute(createRouteDescriptor({ [key]: value }), async () => "{}"),
      "route_invalid"
    );
  });

  it("rejects credential-shaped configuration without echoing its value", () => {
    const secretCanary = "sk-private-model-secret-canary";
    try {
      bindKnowledgePrivateModelRoute(
        createRouteDescriptor({ apiKey: secretCanary }),
        async () => "{}"
      );
      throw new Error("Expected route construction to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeCompilerModelAdapterError);
      expect((error as KnowledgeCompilerModelAdapterError).code).toBe("route_invalid");
      expect((error as Error).message).not.toContain(secretCanary);
    }
  });

  it("binds the exact model projection resolved by ProjectKnowledgePipelineProfileSource", () => {
    const profile = new ProjectKnowledgePipelineProfileSource(
      [
        {
          id: "project-personal",
          projectModelKey: "deepseek-chat|deepseek",
          modelConfigs: {},
        },
      ],
      {
        temperature: 0,
        maxTokens: 8192,
        reasoningEffort: "medium",
        verbosity: "medium",
        activeModels: [
          {
            name: "deepseek-chat",
            provider: "deepseek",
            enabled: true,
            projectEnabled: true,
            baseUrl: "https://api.deepseek.com/v1",
          },
        ],
      },
      {
        compilerVersion: "knowledge-compiler-v1",
        compilerConfiguration: { protocolVersion: 1 },
        parsers: [createParserProfile()],
        outputLanguage: "source-language",
        supportedProviders: ["deepseek"],
        promptContractIdentity: "e".repeat(64),
        providerRouteIdentities: { deepseek: "f".repeat(64) },
      }
    ).resolve(createOwner());

    const route = bindKnowledgePrivateModelRoute(profile.model, async () => "{}");

    expect(route.getDescriptor()).toEqual(profile.model);
  });

  it("rejects arrays with non-index own properties instead of silently dropping them", () => {
    const malformed: unknown[] = [];
    Object.defineProperty(malformed, "01", {
      value: "hidden-routing-input",
      enumerable: true,
      writable: true,
      configurable: true,
    });

    expectAdapterError(
      () =>
        bindKnowledgePrivateModelRoute(
          createRouteDescriptor({ transportOrder: malformed as unknown as JsonValue }),
          async () => "{}"
        ),
      "route_invalid"
    );
  });

  it("refuses to bind a structurally similar but unauthenticated preparation", () => {
    let routeCalls = 0;
    const route = createPrivateRoute(async () => {
      routeCalls += 1;
      return createAnalysisWireOutput();
    });

    expectAdapterError(
      () => bindKnowledgeCompilerModelAdapter({} as never, route, async () => undefined),
      "preparation_invalid"
    );
    expect(routeCalls).toBe(0);
  });
});

describe("KnowledgeCompilerModelAdapter", () => {
  it("runs both stages only through compiler-issued calls and exact Queue authority", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      const routeCalls: {
        stage: string;
        request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>;
        signal: AbortSignal;
      }[] = [];
      const route = createPrivateRoute(async (stage, request, signal) => {
        routeCalls.push({ stage, request, signal });
        return createSuccessfulWireOutput(stage, request);
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);

      expect(Object.isFrozen(adapter)).toBe(true);
      expect(Reflect.ownKeys(adapter)).toEqual([]);
      await expectAdapterErrorAsync(
        () => adapter.analyze({} as CompilerAnalysisRequest, context.signal),
        "request_not_authorized"
      );
      await expectAdapterErrorAsync(
        () => adapter.analyze({} as CompilerAnalysisRequest, new AbortController().signal),
        "signal_mismatch"
      );
      expect(routeCalls).toHaveLength(0);
      expect(reportStages).toEqual([]);

      const result = await createCompiler(adapter).compile(
        createCompileInput(preparation),
        context.signal
      );

      expect(result.kind).toBe("no_changes");
      expect(routeCalls).toHaveLength(2);
      expect(routeCalls.map(({ stage }) => stage)).toEqual(["analysis", "generation"]);
      expect(routeCalls.every(({ signal }) => signal === context.signal)).toBe(true);
      expect(Object.isFrozen(routeCalls[0].request)).toBe(true);
      expect(Object.isFrozen(routeCalls[0].request.source)).toBe(true);
      expect(reportStages).toEqual(["analyzing", "generating"]);
      await expectAdapterErrorAsync(
        () => adapter.analyze(routeCalls[0].request as CompilerAnalysisRequest, context.signal),
        "stage_invalid"
      );
    });
  });

  it("rejects an exact-route mismatch before stage reporting or provider invocation", async () => {
    await runAuthorizedModelAttempt(async ({ preparation, reportStage, reportStages }) => {
      let routeCalls = 0;
      const route = bindKnowledgePrivateModelRoute(
        { ...createRouteDescriptor(), model: "different-model" },
        async () => {
          routeCalls += 1;
          return createAnalysisWireOutput();
        }
      );

      expectAdapterError(
        () => bindKnowledgeCompilerModelAdapter(preparation, route, reportStage),
        "profile_mismatch"
      );
      const matchingRoute = createPrivateRoute(async () => createAnalysisWireOutput());
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, matchingRoute, reportStage);
      expect(() => KnowledgeCompilerModelAdapter.assert(adapter)).not.toThrow();
      expect(routeCalls).toBe(0);
      expect(reportStages).toEqual([]);
    });
  });

  it("rejects forged compiler authorization before stage reporting or route invocation", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      let routeCalls = 0;
      const route = createPrivateRoute(async () => {
        routeCalls += 1;
        return createAnalysisWireOutput();
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);

      expectAdapterError(
        () => adapter.authorizeModelCall(Object.freeze({ stage: "analysis" })),
        "request_not_authorized"
      );
      await expectAdapterErrorAsync(
        () => adapter.analyze({} as CompilerAnalysisRequest, context.signal),
        "stage_invalid"
      );
      expect(routeCalls).toBe(0);
      expect(reportStages).toEqual([]);
    });
  });

  it("rejects a generation authorization minted by a different compiler instance", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      const routeCalls: string[] = [];
      const route = createPrivateRoute(async (stage, request) => {
        routeCalls.push(stage);
        return createSuccessfulWireOutput(stage, request);
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const analysisRequest = await authorizeAnalysisWithCompiler(
        adapter,
        preparation,
        context.signal
      );
      const analysisOutput = await adapter.analyze(analysisRequest, context.signal);
      let authorizationCount = 0;
      let generationCalls = 0;
      const otherCompilerModel: CompilerModelPort = {
        authorizeModelCall: (authorization) => {
          authorizationCount += 1;
          if (authorizationCount === 2) adapter.authorizeModelCall(authorization);
        },
        analyze: async () => analysisOutput,
        generate: async () => {
          generationCalls += 1;
          throw new Error("Generation must remain unavailable");
        },
      };
      let failure: unknown;
      try {
        await createCompiler(otherCompilerModel).compile(
          createCompileInput(preparation),
          context.signal
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
      expect(failure).toMatchObject({ stage: "generation" });
      expect(authorizationCount).toBe(2);
      expect(generationCalls).toBe(0);
      expect(routeCalls).toEqual(["analysis"]);
      expect(reportStages).toEqual(["analyzing"]);
    });
  });

  it("rejects cross-compile splicing even on the same compiler instance", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      const routeCalls: string[] = [];
      const route = createPrivateRoute(async (stage, request) => {
        routeCalls.push(stage);
        return createSuccessfulWireOutput(stage, request);
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      let phase: "capture_analysis" | "splice_generation" = "capture_analysis";
      let secondCompileAuthorizations = 0;
      let analysisRequest: CompilerAnalysisRequest | undefined;
      let analysisOutput: unknown;
      let generationCalls = 0;
      const model: CompilerModelPort = {
        authorizeModelCall: (authorization) => {
          if (phase === "capture_analysis") {
            adapter.authorizeModelCall(authorization);
            return;
          }
          secondCompileAuthorizations += 1;
          if (secondCompileAuthorizations === 2) {
            adapter.authorizeModelCall(authorization);
          }
        },
        analyze: async (request) => {
          if (phase === "capture_analysis") {
            analysisRequest = request;
            throw new Error("stop-after-analysis-authorization");
          }
          return analysisOutput;
        },
        generate: async () => {
          generationCalls += 1;
          throw new Error("Generation must remain unavailable");
        },
      };
      const compiler = createCompiler(model);
      await expect(
        compiler.compile(createCompileInput(preparation), context.signal)
      ).rejects.toMatchObject({ stage: "analysis" });
      if (!analysisRequest) throw new Error("Expected the first compile's analysis request");
      analysisOutput = await adapter.analyze(analysisRequest, context.signal);
      phase = "splice_generation";

      await expect(
        compiler.compile(createCompileInput(preparation), context.signal)
      ).rejects.toMatchObject({ stage: "generation" });
      expect(secondCompileAuthorizations).toBe(2);
      expect(generationCalls).toBe(0);
      expect(routeCalls).toEqual(["analysis"]);
      expect(reportStages).toEqual(["analyzing"]);
    });
  });

  it("reserves each authorized preparation to exactly one fresh adapter", async () => {
    await runAuthorizedModelAttempt(async ({ preparation, reportStage, reportStages }) => {
      const route = createPrivateRoute(async () => createAnalysisWireOutput());
      const first = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      expect(() => KnowledgeCompilerModelAdapter.assert(first)).not.toThrow();
      expectAdapterError(
        () => bindKnowledgeCompilerModelAdapter(preparation, route, reportStage),
        "preparation_reused"
      );
      expect(reportStages).toEqual([]);
    });
  });

  it("sanitizes private route failures and never retries the failed stage", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage }) => {
      const secretCanary = "sk-private-route-failure-canary";
      let routeCalls = 0;
      const route = createPrivateRoute(async () => {
        routeCalls += 1;
        throw new Error(secretCanary);
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);

      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "route_failed",
        secretCanary
      );
      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "stage_invalid"
      );
      expect(routeCalls).toBe(1);
    });
  });

  it("rejects proof drift after a provider result instead of publishing it", async () => {
    await runAuthorizedModelAttempt(
      async ({ context, preparation, manifest, runtimeFile, reportStage }) => {
        let routeCalls = 0;
        const route = createPrivateRoute(async () => {
          routeCalls += 1;
          await runtimeFile.replaceManifest({ ...manifest, revision: manifest.revision + 1 });
          return createAnalysisWireOutput();
        });
        const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
        const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);

        await expectAdapterErrorAsync(
          () => adapter.analyze(request, context.signal),
          "authority_stale"
        );
        expect(routeCalls).toBe(1);
      }
    );
  });

  it("uses fixed decoded-output limits and leaves the failed call single-use", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage }) => {
      let routeCalls = 0;
      const route = createPrivateRoute(async () => {
        routeCalls += 1;
        return JSON.stringify({
          ...JSON.parse(createAnalysisWireOutput()),
          concepts: Array.from({ length: 10_001 }, (_, index) => ({
            ref: `concept-${index}`,
            name: `Concept ${index}`,
          })),
        });
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);

      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "output_too_large"
      );
      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "stage_invalid"
      );
      expect(routeCalls).toBe(1);
    });
  });

  it("rejects copied requests without inspecting their proxy traps or allowing reentrancy", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      let routeCalls = 0;
      let proxyTrapCalls = 0;
      let reentrantCall: Promise<unknown> | undefined;
      const route = createPrivateRoute(async () => {
        routeCalls += 1;
        return createAnalysisWireOutput();
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);
      const copiedRequest = new Proxy(
        { ...request },
        {
          ownKeys: (target) => {
            proxyTrapCalls += 1;
            reentrantCall = adapter.analyze(request, context.signal);
            return Reflect.ownKeys(target);
          },
        }
      );

      await expectAdapterErrorAsync(
        () => adapter.analyze(copiedRequest, context.signal),
        "request_not_authorized"
      );
      expect(proxyTrapCalls).toBe(0);
      expect(reentrantCall).toBeUndefined();
      expect(routeCalls).toBe(0);
      expect(reportStages).toEqual([]);
    });
  });

  it("requires primitive JSON text and never touches provider-returned object accessors", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage }) => {
      let accessorReads = 0;
      const output = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(output, "version", {
        enumerable: true,
        get: () => {
          accessorReads += 1;
          return 1;
        },
      });
      const route = createPrivateRoute(async () => output as unknown as string);
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);

      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "output_invalid"
      );
      expect(accessorReads).toBe(0);
    });
  });

  it("rejects structurally invalid decoded output before generation can be authorized", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage }) => {
      let routeCalls = 0;
      const route = createPrivateRoute(async () => {
        routeCalls += 1;
        return "{}";
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const request = await authorizeAnalysisWithCompiler(adapter, preparation, context.signal);

      await expectAdapterErrorAsync(
        () => adapter.analyze(request, context.signal),
        "output_invalid"
      );
      await expectAdapterErrorAsync(
        () => adapter.generate({} as CompilerGenerationRequest, context.signal),
        "generation_not_authorized"
      );
      expect(routeCalls).toBe(1);
    });
  });

  it("accepts genuine normalized generation authority but rejects a copied request identity", async () => {
    await runAuthorizedModelAttempt(async ({ context, preparation, reportStage, reportStages }) => {
      const routeCalls: string[] = [];
      const route = createPrivateRoute(async (stage, request) => {
        routeCalls.push(stage);
        return createSuccessfulWireOutput(stage, request);
      });
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const generationRequest = await authorizeGenerationWithCompiler(
        adapter,
        preparation,
        context.signal
      );

      await expectAdapterErrorAsync(
        () => adapter.generate({ ...generationRequest }, context.signal),
        "generation_not_authorized"
      );
      await expectAdapterErrorAsync(
        () => adapter.generate(generationRequest, context.signal),
        "generation_not_authorized"
      );
      expect(routeCalls).toEqual(["analysis"]);
      expect(reportStages).toEqual(["analyzing"]);
    });
  });
});
