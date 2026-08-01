import {
  createKnowledgeDeepSeekPrivateRoute,
  KNOWLEDGE_DEEPSEEK_API_BASE_URL,
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
  KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT,
  KnowledgeDeepSeekTransportError,
  type KnowledgeDeepSeekFetchPort,
  type KnowledgeDeepSeekHttpResponse,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import {
  bindKnowledgeCompilerModelAdapter,
  classifyKnowledgeCompilerModelAdapterFailure,
  type KnowledgeModelStageReporter,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import type {
  CompilerTargetRequest,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { createKnowledgeModelEndpointIdentity } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeAuthorizedSourcePreparationBinder,
  type KnowledgeAuthorizedSourcePreparation,
} from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { createKnowledgeCompilerIngestExecutorError } from "@/knowledge/ingest/KnowledgeCompilerIngestFailure";
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
import type { IngestExecutionContext, RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { ExponentialRetryPolicy, type RetryPolicy } from "@/knowledge/ingest/queue/RetryPolicy";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
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
const MODEL = "deepseek-v4-pro";
const SOURCE_BYTES = new TextEncoder().encode("# Source\nExact source text\n");
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);

/** Creates the project-owned Bundle used by the authentic route harness. */
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

/** Creates the byte parser profile shared by planning and execution. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates one DeepSeek-compatible complete pipeline profile. */
function createPipelineProfile(
  configurationOverrides: Record<string, JsonValue> = {},
  profileOverrides: Partial<KnowledgeBundlePipelineProfile> = {}
): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: {
      version: "knowledge-compiler-v1",
      configuration: { protocolVersion: 1 },
    },
    parsers: [createParserProfile()],
    model: {
      provider: "deepseek",
      model: MODEL,
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
        providerRouteIdentity: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-object-core-schema-v1",
        streaming: false,
        modelFallback: false,
        temperature: 0,
        maxTokens: 8192,
        reasoningEffort: "high",
        verbosity: "medium",
        endpointIdentity: createKnowledgeModelEndpointIdentity(
          KNOWLEDGE_DEEPSEEK_API_BASE_URL
        ) as string,
        ...configurationOverrides,
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
    ...profileOverrides,
  };
}

/** Creates an exact-reader response with detached bytes. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

interface AuthorizedRouteHarnessContext {
  context: IngestExecutionContext;
  preparation: KnowledgeAuthorizedSourcePreparation;
  reportStage: KnowledgeModelStageReporter;
  reportStages: ("analyzing" | "generating")[];
  cancelCurrent(): Promise<void>;
}

interface AuthorizedRouteAttemptOptions {
  rethrowHandlerFailure?: boolean;
  retryPolicy?: RetryPolicy;
  onSettled?: (snapshot: IngestQueueSnapshot) => void | Promise<void>;
}

/** Creates authentic Queue, Runtime, workflow, parser, and preparation authority. */
async function runAuthorizedRouteAttempt(
  profile: KnowledgeBundlePipelineProfile,
  handler: (value: AuthorizedRouteHarnessContext) => Promise<void>,
  options: AuthorizedRouteAttemptOptions = {}
): Promise<RunNextResult> {
  const owner = createOwner();
  const manifest = createManifest();
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
    jobId: "job-deepseek-route",
    executionOwner,
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    execute: async (context) => {
      if (!capabilities) throw new Error("Expected initialized Runtime capabilities");
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
          reportStage,
          reportStages,
          cancelCurrent: async () => {
            if (!capabilities) throw new Error("Expected initialized Runtime capabilities");
            await capabilities.queue.cancel(BUNDLE_ID, context.job.id);
          },
        });
      } catch (error) {
        handlerFailure = error;
        throw error;
      }
      return { kind: "no_changes", changeSetId: "changeset-deepseek-route" };
    },
  });
  const result = await capabilities.queue.runNext(BUNDLE_ID);
  if (options.onSettled) {
    await options.onSettled(await capabilities.queue.load(BUNDLE_ID));
  }
  if (handlerFailure !== undefined && options.rethrowHandlerFailure !== false) {
    if (handlerFailure instanceof Error) throw handlerFailure;
    throw new Error("The authorized DeepSeek test handler failed");
  }
  if (handlerFailure === undefined) {
    expect(result).toMatchObject({ kind: "executed", status: "completed" });
  }
  return result;
}

/** Creates the valid compiler input exposed by an authorized preparation. */
function createCompileInput(
  preparation: KnowledgeAuthorizedSourcePreparation
): KnowledgeCompileInput {
  const input = preparation.getPreparation();
  const artifact = input.artifacts[0];
  if (!artifact || artifact.kind !== "text") {
    throw new Error("Expected one text artifact");
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

/** Creates deterministic no-write compiler dependencies around one model adapter. */
function createCompiler(
  model: ReturnType<typeof bindKnowledgeCompilerModelAdapter>
): KnowledgeCompiler {
  return new KnowledgeCompiler({
    model,
    classifyModelFailure: classifyKnowledgeCompilerModelAdapterFailure,
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

/** Reads the deterministic stage and request from a DeepSeek request body. */
function parseWirePrompt(body: string): {
  stage: "analysis" | "generation";
  request: Record<string, unknown>;
  wire: Record<string, unknown>;
} {
  const wire = JSON.parse(body) as Record<string, unknown>;
  const messages = wire.messages as { role: string; content: string }[];
  const userContent = messages[1].content;
  const input = JSON.parse(userContent.slice(userContent.indexOf("\n") + 1)) as {
    stage: "analysis" | "generation";
    request: Record<string, unknown>;
  };
  return { ...input, wire };
}

/** Creates strict model content for either compiler stage. */
function createModelContent(
  stage: "analysis" | "generation",
  request: Record<string, unknown>
): string {
  if (stage === "analysis") {
    return JSON.stringify({
      version: 1,
      summary: "Grounded source summary",
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
  const targets = request.targets as { targetId: string }[];
  return JSON.stringify({
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: targets.map((target) => ({ targetId: target.targetId, outcome: "unchanged" })),
  });
}

interface ResponseOverrides {
  status?: number;
  contentType?: string;
  model?: string;
  finishReason?: string;
  choices?: unknown[];
  prefix?: string;
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  url?: string;
  redirected?: boolean;
  chunkSize?: number;
}

/** Creates a streamed native-fetch-compatible DeepSeek response. */
function createResponse(
  content: string,
  overrides: ResponseOverrides = {}
): KnowledgeDeepSeekHttpResponse {
  const payload = `${overrides.prefix ?? ""}${JSON.stringify({
    id: "completion-1",
    object: "chat.completion",
    model: overrides.model ?? MODEL,
    choices: overrides.choices ?? [
      {
        index: 0,
        finish_reason: overrides.finishReason ?? "stop",
        message: { role: "assistant", content },
      },
    ],
    usage: {
      prompt_tokens: overrides.promptTokens ?? 100,
      completion_tokens: overrides.completionTokens ?? 100,
      total_tokens: overrides.totalTokens ?? 200,
    },
  })}`;
  const bytes = new TextEncoder().encode(payload);
  const chunkSize = overrides.chunkSize ?? Math.max(1, Math.ceil(bytes.byteLength / 2));
  let offset = 0;
  return {
    status: overrides.status ?? 200,
    redirected: overrides.redirected ?? false,
    url: overrides.url ?? KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    headers: {
      get: (name) => {
        if (name.toLocaleLowerCase("en-US") === "content-type") {
          return overrides.contentType ?? "application/json; charset=utf-8";
        }
        if (name.toLocaleLowerCase("en-US") === "content-length") {
          return String(bytes.byteLength);
        }
        return null;
      },
    },
    body: new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + chunkSize, bytes.byteLength);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
  };
}

/** Expects one stable factory-level transport failure. */
function expectTransportError(
  action: () => unknown,
  code: KnowledgeDeepSeekTransportError["code"]
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeDeepSeekTransportError);
  expect(caught).toMatchObject({ code });
}

describe("KnowledgeDeepSeekPrivateRoute", () => {
  it("executes exact analysis and generation POSTs with no retry, fallback, or streaming", async () => {
    const secret = "sk-deepseek-private-test-canary";
    const calls: { url: string; init: RequestInit }[] = [];
    let queueSignal: AbortSignal | undefined;
    const fetchPort: KnowledgeDeepSeekFetchPort = async (url, init) => {
      calls.push({ url, init });
      const parsed = parseWirePrompt(init.body as string);
      return createResponse(createModelContent(parsed.stage, parsed.request), { prefix: "\n\n" });
    };
    const profile = createPipelineProfile();

    await runAuthorizedRouteAttempt(profile, async ({ context, preparation, reportStage }) => {
      queueSignal = context.signal;
      const route = createKnowledgeDeepSeekPrivateRoute(profile, secret, fetchPort);
      expect(JSON.stringify(route.getDescriptor())).not.toContain(secret);
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      const result = await createCompiler(adapter).compile(
        createCompileInput(preparation),
        context.signal
      );
      expect(result.kind).toBe("no_changes");
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init.signal === queueSignal)).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
      KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    ]);
    expect(calls[0].init.signal).toBe(calls[1].init.signal);
    expect(calls.map((call) => parseWirePrompt(call.init.body as string).stage)).toEqual([
      "analysis",
      "generation",
    ]);
    for (const call of calls) {
      const wire = parseWirePrompt(call.init.body as string).wire;
      expect(call.init).toMatchObject({
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      expect(call.init.headers).toEqual({
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      });
      expect(wire).toMatchObject({
        model: MODEL,
        stream: false,
        response_format: { type: "json_object" },
        max_tokens: 8192,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      });
      expect(wire).not.toHaveProperty("temperature");
      expect(wire).not.toHaveProperty("top_p");
      expect(wire).not.toHaveProperty("tools");
      expect(wire).not.toHaveProperty("tool_choice");
      expect(wire).not.toHaveProperty("fallback");
      expect(call.init.body).not.toContain(secret);
    }
  });

  it("uses bounded storage across many one-byte response chunks", async () => {
    const fetchPort = jest.fn(async (_url: string, init: RequestInit) => {
      const parsed = parseWirePrompt(init.body as string);
      return createResponse(createModelContent(parsed.stage, parsed.request), {
        prefix: " ".repeat(10_000),
        chunkSize: 1,
      });
    });
    const profile = createPipelineProfile();

    await runAuthorizedRouteAttempt(profile, async ({ context, preparation, reportStage }) => {
      const route = createKnowledgeDeepSeekPrivateRoute(profile, "sk-valid", fetchPort);
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      await expect(
        createCompiler(adapter).compile(createCompileInput(preparation), context.signal)
      ).resolves.toMatchObject({ kind: "no_changes" });
    });

    expect(fetchPort).toHaveBeenCalledTimes(2);
  });

  it("fails closed before HTTP for obsolete models, custom endpoints, unsupported fields, and bad credentials", () => {
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >();
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile(
            {},
            { model: { ...createPipelineProfile().model, model: "deepseek-chat" } }
          ),
          "sk-valid",
          fetchPort
        ),
      "model_unsupported"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({
            endpointIdentity: createKnowledgeModelEndpointIdentity("https://example.com") as string,
          }),
          "sk-valid",
          fetchPort
        ),
      "endpoint_mismatch"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({ frequencyPenalty: 0.1 }),
          "sk-valid",
          fetchPort
        ),
      "configuration_unsupported"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({ promptContractIdentity: "a".repeat(64) }),
          "sk-valid",
          fetchPort
        ),
      "configuration_unsupported"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({ providerRouteIdentity: "b".repeat(64) }),
          "sk-valid",
          fetchPort
        ),
      "configuration_unsupported"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({ temperature: 0.1 }),
          "sk-valid",
          fetchPort
        ),
      "configuration_unsupported"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({ topP: 0.8 }),
          "sk-valid",
          fetchPort
        ),
      "configuration_unsupported"
    );
    expectTransportError(
      () => createKnowledgeDeepSeekPrivateRoute(createPipelineProfile(), " bad key ", fetchPort),
      "credential_invalid"
    );
    expectTransportError(
      () =>
        createKnowledgeDeepSeekPrivateRoute(
          createPipelineProfile({}, { outputLanguage: "x".repeat(1_025) }),
          "sk-valid",
          fetchPort
        ),
      "profile_invalid"
    );
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("rejects public construction and prototype forgery of transport errors", () => {
    const forged: unknown = Object.create(KnowledgeDeepSeekTransportError.prototype, {
      code: { value: "rate_limited", enumerable: true },
    });

    expect(() =>
      Reflect.construct(KnowledgeDeepSeekTransportError, [Symbol("forged"), "rate_limited"])
    ).toThrow(TypeError);
    expect(KnowledgeDeepSeekTransportError.inspect(forged)).toBeUndefined();
  });

  it("sends sampling controls only when thinking is explicitly disabled", async () => {
    const calls: RequestInit[] = [];
    const profile = createPipelineProfile({
      reasoningEffort: "minimal",
      temperature: 0.3,
      topP: 0.7,
    });
    const fetchPort: KnowledgeDeepSeekFetchPort = async (_url, init) => {
      calls.push(init);
      const parsed = parseWirePrompt(init.body as string);
      return createResponse(createModelContent(parsed.stage, parsed.request));
    };

    await runAuthorizedRouteAttempt(profile, async ({ context, preparation, reportStage }) => {
      const route = createKnowledgeDeepSeekPrivateRoute(profile, "sk-valid", fetchPort);
      const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
      await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const wire = parseWirePrompt(call.body as string).wire;
      expect(wire).toMatchObject({
        thinking: { type: "disabled" },
        temperature: 0.3,
        top_p: 0.7,
      });
      expect(wire).not.toHaveProperty("reasoning_effort");
    }
  });

  it("rejects profile accessors without invoking or exposing them", () => {
    const canary = "profile-accessor-secret-canary";
    const profile = createPipelineProfile();
    let reads = 0;
    Object.defineProperty(profile, "outputLanguage", {
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });
    let caught: unknown;
    try {
      createKnowledgeDeepSeekPrivateRoute(profile, "sk-valid", jest.fn());
    } catch (error) {
      caught = error;
    }

    expect(reads).toBe(0);
    expect(caught).toMatchObject({ code: "profile_invalid" });
    expect(JSON.stringify(caught)).not.toContain(canary);
  });

  it("binds output-language behavior to the full profile before any network call", async () => {
    const profile = createPipelineProfile();
    const fetchPort: KnowledgeDeepSeekFetchPort = async () =>
      createResponse(
        JSON.stringify({
          version: 1,
          summary: "No changes",
          concepts: [],
          entities: [],
          claims: [],
          relations: [],
          citations: [],
          targets: [],
        })
      );

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile({}, { outputLanguage: "zh-CN" }),
        async ({ preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(profile, "sk-valid", fetchPort);
          bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
        }
      )
    ).rejects.toMatchObject({ code: "profile_mismatch" });
  });

  it("cancels an unread response body when Queue authority is revoked after HTTP", async () => {
    let cancelCurrent: (() => Promise<void>) | undefined;
    let bodyCancelled = false;
    const fetchPort = jest.fn(async () => {
      if (!cancelCurrent) throw new Error("Expected the Queue cancellation capability");
      await cancelCurrent();
      return {
        ...createResponse("{}"),
        body: new ReadableStream<Uint8Array>({
          cancel: () => {
            bodyCancelled = true;
            return new Promise<void>(() => undefined);
          },
        }),
      };
    });

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage, cancelCurrent: cancel }) => {
          cancelCurrent = cancel;
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(bodyCancelled).toBe(true);
  });

  it("actively cancels a pending response read when Queue authority is revoked", async () => {
    let cancelCurrent: (() => Promise<void>) | undefined;
    let bodyCancelled = false;
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: (name) =>
            name.toLocaleLowerCase("en-US") === "content-type" ? "application/json" : null,
        },
        body: new ReadableStream<Uint8Array>({
          pull: async () => {
            if (!cancelCurrent) throw new Error("Expected the Queue cancellation capability");
            await cancelCurrent();
          },
          cancel: () => {
            bodyCancelled = true;
            return new Promise<void>(() => undefined);
          },
        }),
      })
    );

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage, cancelCurrent: cancel }) => {
          cancelCurrent = cancel;
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(bodyCancelled).toBe(true);
  });

  it("does not read or expose a 429 response body and performs no hidden retry", async () => {
    const secret = "sk-rate-limit-secret-canary";
    const responseCanary = "provider-body-secret-canary";
    const getReader = jest.fn();
    const cancel = jest.fn(async () => {
      throw new Error(responseCanary);
    });
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 429,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: { get: () => null },
        body: { getReader, cancel } as unknown as ReadableStream<Uint8Array>,
      })
    );
    let compilerFailure: unknown;
    let executionSignal: AbortSignal | undefined;
    const result = await runAuthorizedRouteAttempt(
      createPipelineProfile(),
      async ({ context, preparation, reportStage }) => {
        executionSignal = context.signal;
        try {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            secret,
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        } catch (error) {
          compilerFailure = error;
          const projected = createKnowledgeCompilerIngestExecutorError(error, context.signal);
          if (!projected) throw new Error("Expected an authentic Queue-safe rate-limit failure");
          expect(projected.details).toEqual({
            code: "knowledge_provider_rate_limited",
            message: "The knowledge model provider rate limit was reached",
            retryable: true,
            rateLimited: true,
          });
          throw projected;
        }
      },
      {
        rethrowHandlerFailure: false,
        retryPolicy: new ExponentialRetryPolicy(
          { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0 },
          () => 0.5
        ),
        onSettled: (snapshot) => {
          expect(snapshot.control).toMatchObject({ status: "paused", reason: "rate_limit" });
          expect(snapshot.jobs).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "job-deepseek-route",
                status: "paused",
                reason: "The knowledge model provider rate limit was reached",
              }),
            ])
          );
        },
      }
    );

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "executed", status: "paused" });
    expect(compilerFailure).toMatchObject({
      stage: "analysis",
      code: "provider_rate_limited",
      retryable: true,
      rateLimited: true,
    });
    expect(executionSignal).toBeDefined();
    expect(
      createKnowledgeCompilerIngestExecutorError(compilerFailure, new AbortController().signal)
    ).toBeUndefined();
    expect(JSON.stringify(compilerFailure)).not.toContain(secret);
    expect(JSON.stringify(compilerFailure)).not.toContain(responseCanary);
  });

  it.each([
    {
      status: 400,
      compilerCode: "provider_request_rejected",
      queueCode: "knowledge_model_request_rejected",
      retryable: false,
      finalStatus: "failed",
    },
    {
      status: 422,
      compilerCode: "provider_request_rejected",
      queueCode: "knowledge_model_request_rejected",
      retryable: false,
      finalStatus: "failed",
    },
    {
      status: 401,
      compilerCode: "provider_unauthorized",
      queueCode: "knowledge_provider_unauthorized",
      retryable: false,
      finalStatus: "failed",
    },
    {
      status: 402,
      compilerCode: "provider_balance_required",
      queueCode: "knowledge_provider_balance_required",
      retryable: false,
      finalStatus: "failed",
    },
    {
      status: 500,
      compilerCode: "provider_unavailable",
      queueCode: "knowledge_provider_unavailable",
      retryable: true,
      finalStatus: "pending",
    },
    {
      status: 503,
      compilerCode: "provider_unavailable",
      queueCode: "knowledge_provider_unavailable",
      retryable: true,
      finalStatus: "pending",
    },
    {
      status: 418,
      compilerCode: "provider_http_failed",
      queueCode: "knowledge_provider_http_failed",
      retryable: false,
      finalStatus: "failed",
    },
  ] as const)(
    "projects HTTP $status through Compiler policy into durable Queue $finalStatus",
    async ({ status, compilerCode, queueCode, retryable, finalStatus }) => {
      const cancel = jest.fn(async () => undefined);
      const fetchPort = jest.fn(
        async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
          status,
          redirected: false,
          url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
          headers: { get: () => null },
          body: { cancel } as unknown as ReadableStream<Uint8Array>,
        })
      );
      let compilerFailure: unknown;
      let queueFailureCode: string | undefined;

      const result = await runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          try {
            const route = createKnowledgeDeepSeekPrivateRoute(
              createPipelineProfile(),
              "sk-http-policy-test",
              fetchPort
            );
            const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
            await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
          } catch (error) {
            compilerFailure = error;
            const projected = createKnowledgeCompilerIngestExecutorError(error, context.signal);
            if (!projected) throw new Error("Expected an authentic Queue-safe provider failure");
            queueFailureCode = projected.details.code;
            expect(projected.details).toMatchObject({ retryable, rateLimited: false });
            throw projected;
          }
        },
        {
          rethrowHandlerFailure: false,
          retryPolicy: new ExponentialRetryPolicy(
            { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0 },
            () => 0.5
          ),
          onSettled: (snapshot) => {
            expect(snapshot.control).toEqual({ status: "running" });
            expect(snapshot.jobs).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ id: "job-deepseek-route", status: finalStatus }),
              ])
            );
          },
        }
      );

      expect(result).toMatchObject({ kind: "executed", status: finalStatus });
      expect(compilerFailure).toMatchObject({
        code: compilerCode,
        retryable,
        rateLimited: false,
      });
      expect(queueFailureCode).toBe(queueCode);
      expect(fetchPort).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  );

  it("sanitizes network failures without retaining the credential or provider cause", async () => {
    const secret = "sk-network-secret-canary";
    const causeCanary = "network-provider-cause-canary";
    const fetchPort = jest.fn(async () => {
      throw new Error(`${causeCanary}:${secret}`);
    });
    let caught: unknown;
    try {
      await runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            secret,
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(caught).toMatchObject({
      stage: "analysis",
      code: "provider_network_failed",
      retryable: true,
      rateLimited: false,
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(causeCanary);
  });

  it("does not accept a forged transport-error prototype from the response reader", async () => {
    const forged: unknown = Object.create(KnowledgeDeepSeekTransportError.prototype, {
      code: { value: "rate_limited", enumerable: true },
    });
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: (name) =>
            name.toLocaleLowerCase("en-US") === "content-type" ? "application/json" : null,
        },
        body: new ReadableStream<Uint8Array>({
          start: (controller) => controller.error(forged),
        }),
      })
    );
    let caught: unknown;

    try {
      await runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(caught).toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      rateLimited: false,
    });
  });

  it("cancels and sanitizes a response whose header adapter throws", async () => {
    const canary = "header-provider-cause-canary";
    const cancel = jest.fn(() => new Promise<void>(() => undefined));
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: () => {
            throw new Error(canary);
          },
        },
        body: { cancel } as unknown as ReadableStream<Uint8Array>,
      })
    );
    let caught: unknown;
    try {
      await runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(caught).toMatchObject({ stage: "analysis" });
    expect(JSON.stringify(caught)).not.toContain(canary);
  });

  it.each([
    ["length", createResponse("{}", { finishReason: "length" })],
    ["content type", createResponse("{}", { contentType: "text/event-stream" })],
    ["model mismatch", createResponse("{}", { model: "deepseek-v4-flash" })],
    [
      "multiple choices",
      createResponse("{}", {
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: "{}" } },
          { index: 1, finish_reason: "stop", message: { role: "assistant", content: "{}" } },
        ],
      }),
    ],
    ["redirect", createResponse("{}", { redirected: true })],
    ["URL mismatch", createResponse("{}", { url: "https://api.deepseek.com/v1/chat/completions" })],
    [
      "legacy function call",
      createResponse("{}", {
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "{}",
              function_call: { name: "write_file", arguments: "{}" },
            },
          },
        ],
      }),
    ],
    ["token overrun", createResponse("{}", { completionTokens: 8193 })],
    ["usage mismatch", createResponse("{}", { totalTokens: 201 })],
  ])("rejects %s without repair or a second provider call", async (_name, response) => {
    const fetchPort = jest.fn(async () => response);
    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ stage: "analysis" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });

  it("cancels a response reader when actual bytes cross the pre-decode cap", async () => {
    let cancelled = false;
    const first = new Uint8Array(KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxResponseBytes);
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: (name) =>
            name.toLocaleLowerCase("en-US") === "content-type" ? "application/json" : null,
        },
        body: new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(first);
            controller.enqueue(new Uint8Array([1]));
          },
          cancel: () => {
            cancelled = true;
          },
        }),
      })
    );

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ stage: "analysis" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  it("cancels before reading when declared response bytes exceed the cap", async () => {
    const getReader = jest.fn();
    const cancel = jest.fn(() => new Promise<void>(() => undefined));
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: (name) => {
            if (name.toLocaleLowerCase("en-US") === "content-type") {
              return "application/json";
            }
            if (name.toLocaleLowerCase("en-US") === "content-length") {
              return String(KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxResponseBytes + 1);
            }
            return null;
          },
        },
        body: { getReader, cancel } as unknown as ReadableStream<Uint8Array>,
      })
    );

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ stage: "analysis" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid UTF-8 before JSON parsing and performs no second provider call", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);
    const fetchPort = jest.fn(
      async (): Promise<KnowledgeDeepSeekHttpResponse> => ({
        status: 200,
        redirected: false,
        url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
        headers: {
          get: (name) => {
            if (name.toLocaleLowerCase("en-US") === "content-type") {
              return "application/json";
            }
            if (name.toLocaleLowerCase("en-US") === "content-length") {
              return String(bytes.byteLength);
            }
            return null;
          },
        },
        body: new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      })
    );

    await expect(
      runAuthorizedRouteAttempt(
        createPipelineProfile(),
        async ({ context, preparation, reportStage }) => {
          const route = createKnowledgeDeepSeekPrivateRoute(
            createPipelineProfile(),
            "sk-valid",
            fetchPort
          );
          const adapter = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
          await createCompiler(adapter).compile(createCompileInput(preparation), context.signal);
        }
      )
    ).rejects.toMatchObject({ stage: "analysis" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });
});
