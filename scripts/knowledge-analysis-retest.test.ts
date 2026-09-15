import type { App } from "obsidian";
import { randomUUID } from "crypto";
import type {
  CompilerAnalysisRequest,
  CompilerGenerationRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import KnowledgeAnalysisRetestPlugin, {
  close,
  prepare,
  run,
  type KnowledgeAnalysisRetestInput,
} from "./knowledge-analysis-retest";
import {
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  type KnowledgeDeepSeekHttpResponse,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";

jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  Plugin: class {
    register = jest.fn();
  },
}));

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/8";
const SOURCE_TEXT = "A review is required before publication.";
const SOURCE_PATH = "Sources/Review.txt";
const SCHEMA_PATH = "Schemas/Rules.md";
const BUNDLE_ID = "retest-bundle";
const SOURCE_ID = "explicitly-selected-source";
const SECRET = "sk-local-retest-credential-canary";

async function fixture(options: { pending?: boolean; paused?: boolean } = {}) {
  const file = new KnowledgeExecutionMemoryRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  await new KnowledgeRuntimeManifestStorage(runtime).write(
    BUNDLE_ID,
    {
      version: 1,
      bundleId: BUNDLE_ID,
      revision: 1,
      entries: [
        {
          sourceId: SOURCE_ID,
          sourceKey: toWindowsPathKey(SOURCE_PATH),
          sourcePath: SOURCE_PATH,
          custody: "user_managed",
        },
      ],
    },
    null
  );
  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(runtime, createKnowledgeExecutionOwner()),
    {
      execute: async () => {
        throw new Error("The original Queue must never execute");
      },
    }
  );
  if (options.pending) {
    const allocation = await new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
      bundleId: BUNDLE_ID,
      sourceId: SOURCE_ID,
      captureId: "original-observation",
    });
    const binding = await new KnowledgeRuntimeInputObservationBinder(runtime).bind({
      observationToken: allocation.observationToken,
      sourceContentHash: createSourceContentHash(SOURCE_TEXT),
      pipelineFingerprint: "a".repeat(64),
    });
    if (binding.kind !== "ready") throw new Error("Fixture observation must be ready");
    await queue.enqueue(binding.observation);
  }
  if (options.paused !== false) await queue.pause(BUNDLE_ID);
  const runtimeText = await file.read();
  const contents = new Map([
    [SOURCE_PATH, SOURCE_TEXT],
    [SCHEMA_PATH, "# Rules\nGenerate concise grounded pages."],
  ]);
  const adapter = {
    stat: jest.fn(async (path: string) =>
      contents.has(path)
        ? {
            type: "file",
            ctime: 1,
            mtime: 1,
            size: new TextEncoder().encode(contents.get(path)).length,
          }
        : null
    ),
    read: jest.fn(async (path: string) => contents.get(path)),
    readBinary: jest.fn(
      async (path: string) => new TextEncoder().encode(contents.get(path)).buffer
    ),
    write: jest.fn(),
    process: jest.fn(),
    remove: jest.fn(),
  };
  const provider = {
    providerId: "local-provider",
    providerType: "openai-compatible",
    displayName: "Local fixture",
    baseUrl: "https://api.deepseek.com",
    apiKeyKeychainId: "fixture-key",
    requiresApiKey: true,
    origin: { kind: "byok", catalogProviderId: "deepseek" },
    addedAt: 1,
  };
  const model = {
    configuredModelId: "fixture-flash",
    providerId: provider.providerId,
    info: { id: "deepseek-flash", displayName: "Flash" },
    configuredAt: 1,
  };
  const getApiKey = jest.fn(async () => SECRET);
  const input: KnowledgeAnalysisRetestInput = {
    runtimeText,
    sourceId: SOURCE_ID,
    app: { vault: { adapter, getAllLoadedFiles: () => [] } } as unknown as Pick<App, "vault">,
    modelManagement: {
      backendConfigRegistry: {
        resolveEnabled: () => [
          {
            configuredModelId: model.configuredModelId,
            state: "ok",
            provider,
            configuredModel: model,
          },
        ],
      },
      configuredModelRegistry: { list: () => [model] },
      providerRegistry: { list: () => [provider], getApiKey },
    } as unknown as KnowledgeAnalysisRetestInput["modelManagement"],
    owner: {
      projectId: "retest-project",
      config: {
        version: 1,
        id: BUNDLE_ID,
        sourceRoots: ["Sources"],
        wikiRoot: "Wiki",
        schemaRef: SCHEMA_PATH,
        reviewMode: "always",
      },
    },
    project: { id: "retest-project", modelSelection: model.configuredModelId, modelConfigs: {} },
  };
  return { input, file, queue, contents, adapter, getApiKey };
}

function response(content: unknown, options: { contentType?: string; leaveOpen?: boolean } = {}) {
  const cancel = jest.fn();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            object: "chat.completion",
            model: "deepseek-flash",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: JSON.stringify(content) },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
          })
        )
      );
      if (!options.leaveOpen) value.close();
    },
    cancel,
  });
  const value: KnowledgeDeepSeekHttpResponse = {
    status: 200,
    redirected: false,
    url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    headers: {
      get: (key) =>
        key.toLowerCase() === "content-type" ? (options.contentType ?? "application/json") : null,
    },
    body,
  };
  return { value, cancel, finish: () => controller?.close() };
}

function noTargets() {
  return {
    version: 1,
    summary: "No generated page is needed",
    concepts: [],
    entities: [],
    claims: [],
    relations: [],
    citations: [],
    targets: [],
  };
}

describe("knowledge-analysis-retest", () => {
  const previousFetch = window.fetch;
  const previousRandomUUID = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
  let fetchMock: jest.Mock;
  beforeAll(() =>
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: randomUUID,
    })
  );
  afterAll(() => {
    if (previousRandomUUID) Object.defineProperty(window.crypto, "randomUUID", previousRandomUUID);
    else Reflect.deleteProperty(window.crypto, "randomUUID");
  });
  beforeEach(() => {
    fetchMock = jest.fn(async () => response(noTargets()).value);
    window.fetch = fetchMock;
  });
  afterEach(() => {
    close();
    window.fetch = previousFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("prepare()", () => {
    it(`${ISSUE} prepares the explicitly selected source with zero requests and preserves the original paused Runtime`, async () => {
      const original = await fixture();
      const result = await prepare(original.input);
      expect(result).toMatchObject({
        kind: "prepared",
        requestCount: 0,
        sourceId: SOURCE_ID,
        timeoutMs: 120_000,
        maxRequests: 2,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(original.getApiKey).toHaveBeenCalledTimes(1);
      expect(await original.file.read()).toBe(original.input.runtimeText);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(SOURCE_TEXT);
      expect(original.adapter.write).not.toHaveBeenCalled();
    });

    it(`${ISSUE} fences concurrent preparation and cannot replace an already prepared source`, async () => {
      const original = await fixture();
      const first = prepare(original.input);
      expect(await prepare(original.input)).toEqual({
        kind: "diagnostic",
        code: "session_already_prepared",
      });
      expect(await first).toMatchObject({ kind: "prepared" });
      expect(await prepare(original.input)).toEqual({
        kind: "diagnostic",
        code: "session_already_prepared",
      });
      expect(original.getApiKey).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([{ pending: true }, { paused: false }])(
      `${ISSUE} rejects an unsafe snapshot before credentials or network for %j`,
      async (options) => {
        const original = await fixture(options);
        expect(await prepare(original.input)).toMatchObject({
          kind: "diagnostic",
          code: options.pending
            ? "snapshot_contains_runnable_or_unsettled_work"
            : "snapshot_not_paused",
        });
        expect(original.getApiKey).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await original.file.read()).toBe(original.input.runtimeText);
      }
    );

    it(`${ISSUE} rejects a missing explicit source without falling back to a different source`, async () => {
      const original = await fixture();
      expect(await prepare({ ...original.input, sourceId: "not-in-manifest" })).toMatchObject({
        kind: "diagnostic",
        code: "source_missing",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("run()", () => {
    it(`${ISSUE} performs one analysis and one generation on the copied Runtime and cannot run twice`, async () => {
      const original = await fixture();
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const wire = JSON.parse(init.body as string) as { messages: { content: string }[] };
        const text = wire.messages[1].content;
        const { stage, request } = JSON.parse(text.slice(text.indexOf("\n") + 1)) as
          | { stage: "analysis"; request: CompilerAnalysisRequest }
          | { stage: "generation"; request: CompilerGenerationRequest };
        if (stage === "analysis")
          return response({
            ...noTargets(),
            claims: [{ ref: "primary-claim", text: SOURCE_TEXT }],
            citations: [
              {
                claimRef: "primary-claim",
                evidenceId: request.evidence[0].evidenceId,
                relation: "supports",
              },
            ],
            targets: [
              {
                ref: "new-page",
                path: "Wiki/Review.md",
                intent: "write",
                reason: "Summarize the source",
                claimRefs: ["primary-claim"],
              },
            ],
          }).value;
        return response({
          version: 1,
          targetSetDigest: request.targetSetDigest,
          files: request.targets.map((target: { targetId: string }) => ({
            targetId: target.targetId,
            outcome: "unchanged",
          })),
        }).value;
      });
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      const result = await run();
      expect(result).toMatchObject({
        kind: "settled",
        phase: "queue_settled",
        failureCode: undefined,
        staticCodes: [],
        status: "completed",
        queueResult: { kind: "executed", status: "completed" },
        priorReviewsUnchanged: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.requests).toEqual([
        expect.objectContaining({ stage: "analysis", responseStatus: 200 }),
        expect.objectContaining({ stage: "generation", responseStatus: 200 }),
      ]);
      expect(await run()).toEqual({ kind: "diagnostic", code: "run_not_available" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await original.file.read()).toBe(original.input.runtimeText);
      expect(original.adapter.write).not.toHaveBeenCalled();
      expect(original.adapter.process).not.toHaveBeenCalled();
      expect(original.adapter.remove).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(SOURCE_TEXT);
    });

    it(`${ISSUE} returns the production header failure immediately even when the HTTP 200 body never ends`, async () => {
      const original = await fixture();
      const reply = response(noTargets(), { contentType: "text/plain", leaveOpen: true });
      fetchMock.mockResolvedValue(reply.value);
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      jest.useFakeTimers();
      const pending = run();
      await jest.advanceTimersByTimeAsync(120_000);
      const result = await pending;
      expect(result).toMatchObject({
        kind: "settled",
        phase: "queue_settled",
        status: "failed",
        failureCode: "knowledge_provider_response_invalid",
        queueResult: { kind: "executed", status: "failed" },
        manifestUnchanged: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reply.cancel).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty("usage");
      expect(result.durationMs).toBeLessThan(120_000);
    }, 5_000);

    it(`${ISSUE} times out unfinished production body reads after 120 seconds and fences concurrent run`, async () => {
      const original = await fixture();
      const reply = response(noTargets(), { leaveOpen: true });
      let fetched: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      fetchMock.mockImplementation(async () => {
        fetched();
        return reply.value;
      });
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      jest.useFakeTimers();
      const pending = run();
      await started;
      expect(await run()).toEqual({ kind: "diagnostic", code: "run_not_available" });
      await jest.advanceTimersByTimeAsync(120_000);
      expect(await pending).toMatchObject({
        kind: "timeout",
        code: "retest_deadline",
        phase: "queue_execution",
        requests: [expect.objectContaining({ stage: "analysis", responseStatus: 200 })],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(await original.file.read()).toBe(original.input.runtimeText);
    });

    it(`${ISSUE} refuses changed source bytes before issuing any model request`, async () => {
      const original = await fixture();
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      original.contents.set(SOURCE_PATH, "The source changed after preparation.");
      expect(await run()).toMatchObject({
        kind: "diagnostic",
        code: "run_failed",
        phase: "source_reproof",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("close()", () => {
    it(`${ISSUE} aborts the independent HTTP signal after the Queue has already settled`, async () => {
      const original = await fixture();
      fetchMock.mockResolvedValue(
        response(noTargets(), { contentType: "text/plain", leaveOpen: true }).value
      );
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      expect(await run()).toMatchObject({ status: "failed" });
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      close();
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(await run()).toEqual({ kind: "diagnostic", code: "run_not_available" });
      expect(await original.file.read()).toBe(original.input.runtimeText);
    });

    it(`${ISSUE} closes a prepared session without executing or resuming any Queue`, async () => {
      const original = await fixture();
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      close();
      close();
      expect(await run()).toEqual({ kind: "diagnostic", code: "run_not_available" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await original.file.read()).toBe(original.input.runtimeText);
    });
  });

  describe("KnowledgeAnalysisRetestPlugin", () => {
    describe("onload()", () => {
      it(`${ISSUE} only exposes the manual API and registers cleanup without model calls`, () => {
        const plugin = new KnowledgeAnalysisRetestPlugin({} as App, {} as never);
        plugin.onload();
        expect(plugin.api).toEqual({ prepare, run, close });
        expect(plugin.register).toHaveBeenCalledWith(close);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });
});
