import type { App } from "obsidian";
import { randomUUID } from "crypto";
import type { CompilerGenerationRequest } from "@/knowledge/compiler/CompilerModelPort";
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
import { IngestExecutorError, IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitPlan,
  createManifestCommitPlanDigest,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  parseKnowledgeRuntimeStoreSnapshot,
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
const OTHER_REVIEW_SOURCE_ID = "retained-review-source";
const PENDING_SOURCE_IDS = [SOURCE_ID, "other-pending-source", "third-pending-source"];

async function fixture(
  options: {
    pendingSources?: readonly string[];
    paused?: boolean;
    reviewSourceId?: string;
    retrying?: boolean;
    startupRecovery?: boolean;
    pipelineFingerprint?: string;
  } = {}
) {
  const file = new KnowledgeExecutionMemoryRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  const bundle: KnowledgeBundleConfig = {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
  const sourceIds = new Set([
    SOURCE_ID,
    ...(options.pendingSources ?? []),
    ...(options.reviewSourceId ? [options.reviewSourceId] : []),
  ]);
  const manifest: SourceManifest = {
    version: 1,
    bundleId: BUNDLE_ID,
    revision: 1,
    entries: [...sourceIds].map((sourceId) => {
      const sourcePath = sourceId === SOURCE_ID ? SOURCE_PATH : `Sources/${sourceId}.txt`;
      return {
        sourceId,
        sourceKey: toWindowsPathKey(sourcePath),
        sourcePath,
        custody: "user_managed",
      };
    }),
  };
  await new KnowledgeRuntimeManifestStorage(runtime).write(BUNDLE_ID, manifest, null);
  const executionOwner = createKnowledgeExecutionOwner();
  const reviews = new ChangeSetReviewRepository(
    new KnowledgeRuntimeReviewStorage(runtime, executionOwner)
  );
  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(runtime, executionOwner),
    {
      execute: async ({ job, signal }) => {
        if (job.sourceId === options.reviewSourceId) {
          const proposal: KnowledgeChangeSet = {
            id: "retained-proposal",
            bundleId: BUNDLE_ID,
            operation: "ingest",
            sourceRefs: [job.sourceId],
            changes: [
              {
                id: "retained-change",
                path: "Wiki/Retained.md",
                sourceRefs: [job.sourceId],
                reason: "Retained review",
                operation: "create",
                expectedAbsent: true,
                afterContent: "# Retained\n",
                afterHash: createFileContentHash("# Retained\n"),
              },
            ],
            citations: [],
            validation: { okfValid: true, citationsValid: true, linksValid: true },
            status: "proposed",
            createdAt: Date.now(),
          };
          const jobClaim = {
            jobId: job.id,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
          };
          const manifestCommitPlan = createManifestCommitPlan({
            bundle,
            manifest,
            ...jobClaim,
            changeSet: proposal,
            mutations: [
              {
                changeId: "retained-change",
                path: "Wiki/Retained.md",
                operation: "create",
                access: "create_only",
                ownership: "generated",
                wasTrackedByPrimarySource: false,
              },
            ],
          });
          const record = await reviews.saveProposal(BUNDLE_ID, {
            proposal,
            proposalDigest: createChangeSetTransactionDigest(proposal),
            manifestCommitPlan,
            manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
            jobClaim,
          });
          if (record.outcome !== "pending") throw new Error("Fixture Review must be pending");
          return {
            kind: "awaiting_review",
            changeSetId: record.changeSetId,
            reviewDecision: {
              outcome: "pending",
              bundleId: BUNDLE_ID,
              changeSetId: record.changeSetId,
              proposalDigest: record.proposalDigest,
              recordRevision: record.recordRevision,
              recordedAt: record.recordedAt,
              jobClaim,
            },
          };
        }
        if (options.retrying)
          throw new IngestExecutorError(
            {
              code: "fixture_retry",
              message: "Retry later",
              retryable: true,
              rateLimited: false,
            },
            signal
          );
        throw new Error("The original Queue must never execute");
      },
    },
    { retryPolicy: { decide: () => ({ kind: "retry", delayMs: 60_000 }) } }
  );
  let captureNumber = 0;
  const enqueue = async (sourceId: string, content = SOURCE_TEXT) => {
    const allocation = await new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
      bundleId: BUNDLE_ID,
      sourceId,
      captureId: `original-observation-${captureNumber++}`,
    });
    const binding = await new KnowledgeRuntimeInputObservationBinder(runtime).bind({
      observationToken: allocation.observationToken,
      sourceContentHash: createSourceContentHash(content),
      pipelineFingerprint: options.pipelineFingerprint ?? "a".repeat(64),
    });
    if (binding.kind !== "ready") throw new Error("Fixture observation must be ready");
    return queue.enqueue(binding.observation);
  };
  if (options.reviewSourceId) {
    await enqueue(options.reviewSourceId);
    const result = await queue.runNext(BUNDLE_ID);
    if (result.kind !== "executed" || result.status !== "awaiting_review")
      throw new Error("Fixture must persist a real pending Review");
    await enqueue(options.reviewSourceId, `${SOURCE_TEXT} Revised.`);
  }
  for (const sourceId of options.pendingSources ?? []) await enqueue(sourceId);
  if (options.retrying) await queue.runNext(BUNDLE_ID);
  if (options.startupRecovery) await queue.recoverOnStartup(BUNDLE_ID);
  else if (options.paused !== false) await queue.pause(BUNDLE_ID);
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
      config: bundle,
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

function writeResponse(init: RequestInit) {
  const wire = JSON.parse(init.body as string) as { messages: { content: string }[] };
  const text = wire.messages[1].content;
  const { request } = JSON.parse(text.slice(text.indexOf("\n") + 1)) as {
    request: CompilerGenerationRequest;
  };
  return {
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write",
      afterContent: `---\ntype: concept\n---\n\n# Review\n\n${SOURCE_TEXT}\n`,
      claims: [{ text: SOURCE_TEXT, evidenceIds: [request.evidence[0].evidenceId] }],
    })),
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
    fetchMock = jest.fn(
      async (_url: string, init: RequestInit) => response(writeResponse(init)).value
    );
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
        maxRequests: 1,
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

    it(`${ISSUE} cancels only other-source unattempted pending jobs in the paused copy while retaining the selected job and Review, rerun, Manifest and ledger records`, async () => {
      const original = await fixture({
        pendingSources: PENDING_SOURCE_IDS,
        reviewSourceId: OTHER_REVIEW_SOURCE_ID,
      });
      const before = parseKnowledgeRuntimeStoreSnapshot(JSON.parse(original.input.runtimeText));
      const beforeQueue = before.queues[0].value as IngestQueueSnapshot;
      expect(beforeQueue.jobs.filter((job) => job.status === "pending")).toHaveLength(3);
      expect(beforeQueue.pendingReviews).toHaveLength(1);
      expect(beforeQueue.reruns).toHaveLength(1);
      const initialize = jest.spyOn(KnowledgeExecutionMemoryRuntimeFile.prototype, "initialize");

      expect(await prepare(original.input)).toMatchObject({
        kind: "prepared",
        requestCount: 0,
        cancelledClonePendingJobs: 2,
        existingReviews: 1,
      });
      const clone = initialize.mock.contexts[0] as KnowledgeExecutionMemoryRuntimeFile;
      const after = parseKnowledgeRuntimeStoreSnapshot(JSON.parse(await clone.read()));
      expect({ ...after, revision: before.revision, queues: before.queues }).toEqual(before);
      const afterQueue = after.queues[0].value as IngestQueueSnapshot;
      expect(afterQueue).toMatchObject({
        control: beforeQueue.control,
        reruns: beforeQueue.reruns,
        pendingReviews: beforeQueue.pendingReviews,
      });
      expect(afterQueue.jobs).toHaveLength(beforeQueue.jobs.length);
      expect(
        afterQueue.jobs.filter((job) => job.status === "cancelled").map((job) => job.sourceId)
      ).toEqual(PENDING_SOURCE_IDS.filter((sourceId) => sourceId !== SOURCE_ID));
      expect(afterQueue.jobs.find((job) => job.sourceId === SOURCE_ID)).toEqual(
        beforeQueue.jobs.find((job) => job.sourceId === SOURCE_ID)
      );
      expect(afterQueue.jobs.find((job) => job.sourceId === OTHER_REVIEW_SOURCE_ID)).toEqual(
        beforeQueue.jobs.find((job) => job.sourceId === OTHER_REVIEW_SOURCE_ID)
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await original.file.read()).toBe(original.input.runtimeText);
      expect(original.adapter.write).not.toHaveBeenCalled();
    });

    it.each([
      { paused: false },
      { pendingSources: [SOURCE_ID], retrying: true },
      { pendingSources: [SOURCE_ID], startupRecovery: true },
    ])(
      `${ISSUE} rejects an unsafe snapshot before credentials or network for %j`,
      async (options) => {
        const original = await fixture(options);
        expect(await prepare(original.input)).toMatchObject({
          kind: "diagnostic",
          code:
            options.retrying || options.startupRecovery
              ? "snapshot_contains_runnable_or_unsettled_work"
              : "snapshot_not_paused",
        });
        expect(original.getApiKey).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await original.file.read()).toBe(original.input.runtimeText);
      }
    );

    it(`${ISSUE} refuses an awaiting-Review selected source without rejecting its proposal or consuming its rerun`, async () => {
      const original = await fixture({ reviewSourceId: SOURCE_ID });
      expect(await prepare(original.input)).toMatchObject({
        kind: "diagnostic",
        code: "source_already_active",
      });
      expect(original.getApiKey).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await original.file.read()).toBe(original.input.runtimeText);
    });

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
    it.each([
      ["unknown support", "compiler_citation_evidence_unknown"],
      ["new page unchanged", "compiler_generation_new_target_unchanged"],
    ])(
      "returns bounded writing checks for %s without leaking response text — https://github.com/yydspanda/obsidian-copilot/issues/20",
      async (scenario, code) => {
        const original = await fixture();
        fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
          const body = writeResponse(init);
          if (scenario === "unknown support") {
            body.files[0].claims[0].evidenceIds = ["private-evidence-canary"];
            return response(body).value;
          }
          return response({
            ...body,
            files: body.files.map(({ targetId }) => ({ targetId, outcome: "unchanged" })),
          }).value;
        });
        expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
        const result = await run();
        expect(result).toMatchObject({
          status: "failed",
          failureCode: "knowledge_compiler_generation_rejected",
        });
        expect(result.staticCodes).toContain(code);
        expect(JSON.stringify(result)).not.toContain("private-evidence-canary");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await original.file.read()).toBe(original.input.runtimeText);
        expect(original.adapter.write).not.toHaveBeenCalled();
        expect(original.adapter.process).not.toHaveBeenCalled();
      }
    );

    it(`performs one writing request on the copied Runtime and cannot run twice — https://github.com/yydspanda/obsidian-copilot/issues/20`, async () => {
      const original = await fixture({
        pendingSources: PENDING_SOURCE_IDS,
        reviewSourceId: OTHER_REVIEW_SOURCE_ID,
      });
      const initialize = jest.spyOn(KnowledgeExecutionMemoryRuntimeFile.prototype, "initialize");
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      const result = await run();
      expect(result).toMatchObject({
        kind: "settled",
        phase: "queue_settled",
        failureCode: undefined,
        staticCodes: [],
        status: "awaiting_review",
        queueResult: { kind: "executed", status: "awaiting_review" },
        priorReviewsUnchanged: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const clone = initialize.mock.contexts[0] as KnowledgeExecutionMemoryRuntimeFile;
      const before = parseKnowledgeRuntimeStoreSnapshot(JSON.parse(original.input.runtimeText));
      const after = parseKnowledgeRuntimeStoreSnapshot(JSON.parse(await clone.read()));
      const beforeQueue = before.queues[0].value as IngestQueueSnapshot;
      const afterQueue = after.queues[0].value as IngestQueueSnapshot;
      expect(result.priorReviewsUnchanged).toBe(true);
      expect(after.applyCommits).toEqual(before.applyCommits);
      expect(afterQueue.reruns).toEqual(beforeQueue.reruns);
      expect(afterQueue.pendingReviews).toEqual(expect.arrayContaining(beforeQueue.pendingReviews));
      expect(afterQueue.pendingReviews).toHaveLength(beforeQueue.pendingReviews.length + 1);
      expect(afterQueue.jobs).toHaveLength(beforeQueue.jobs.length);
      expect(afterQueue.jobs.filter((job) => job.status === "pending")).toHaveLength(0);
      expect(afterQueue.jobs.filter((job) => job.sourceId === SOURCE_ID)).toEqual([
        expect.objectContaining({
          id: beforeQueue.jobs.find((job) => job.sourceId === SOURCE_ID)?.id,
          sourceId: SOURCE_ID,
          attempt: 1,
          status: "awaiting_review",
        }),
      ]);
      expect(afterQueue.jobs.find((job) => job.sourceId === OTHER_REVIEW_SOURCE_ID)).toEqual(
        beforeQueue.jobs.find((job) => job.sourceId === OTHER_REVIEW_SOURCE_ID)
      );
      expect(result.requests).toEqual([
        expect.objectContaining({ stage: "generation", responseStatus: 200 }),
      ]);
      expect(await run()).toEqual({ kind: "diagnostic", code: "run_not_available" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await original.file.read()).toBe(original.input.runtimeText);
      expect(original.adapter.write).not.toHaveBeenCalled();
      expect(original.adapter.process).not.toHaveBeenCalled();
      expect(original.adapter.remove).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(SOURCE_TEXT);
    });

    it(`${ISSUE} reuses the selected pending job when source hash and pipeline already match instead of deduplicating a cancelled history row`, async () => {
      const seed = await fixture();
      const planned = await prepare(seed.input);
      expect(planned.kind).toBe("prepared");
      close();
      const original = await fixture({
        pendingSources: PENDING_SOURCE_IDS,
        reviewSourceId: OTHER_REVIEW_SOURCE_ID,
        pipelineFingerprint: planned.pipelineFingerprint as string,
      });
      const before = await original.queue.load(BUNDLE_ID);
      const target = before.jobs.find((job) => job.sourceId === SOURCE_ID);
      expect(target).toMatchObject({
        sourceContentHash: planned.sourceContentHash,
        pipelineFingerprint: planned.pipelineFingerprint,
        status: "pending",
        attempt: 0,
      });
      const initialize = jest.spyOn(KnowledgeExecutionMemoryRuntimeFile.prototype, "initialize");
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      expect(await run()).toMatchObject({
        kind: "settled",
        status: "awaiting_review",
        queueResult: { kind: "executed", jobId: target?.id, status: "awaiting_review" },
        priorReviewsUnchanged: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const clone = initialize.mock.contexts[0] as KnowledgeExecutionMemoryRuntimeFile;
      const copied = parseKnowledgeRuntimeStoreSnapshot(JSON.parse(await clone.read()));
      const after = copied.queues[0].value as IngestQueueSnapshot;
      expect(after.jobs).toHaveLength(before.jobs.length);
      expect(after.jobs.filter((job) => job.sourceId === SOURCE_ID)).toEqual([
        expect.objectContaining({
          id: target?.id,
          sourceId: SOURCE_ID,
          attempt: 1,
          status: "awaiting_review",
        }),
      ]);
      const completed = after.jobs.find((job) => job.id === target?.id);
      expect(completed?.inputRevision).toBeGreaterThan(target?.inputRevision ?? 0);
      expect(completed?.inputRevision).toBe(
        after.sourceHighWatermarks.find((entry) => entry.sourceId === SOURCE_ID)?.inputRevision
      );
      expect(after.reruns).toEqual(before.reruns);
      expect(after.pendingReviews).toEqual(expect.arrayContaining(before.pendingReviews));
      expect(after.pendingReviews).toHaveLength(before.pendingReviews.length + 1);
      expect(await original.file.read()).toBe(original.input.runtimeText);
      expect(original.adapter.write).not.toHaveBeenCalled();
    });

    it(`${ISSUE} refuses same-input cancelled history with zero HTTP instead of forcing a terminal job back into the queue`, async () => {
      const seed = await fixture();
      const planned = await prepare(seed.input);
      expect(planned.kind).toBe("prepared");
      close();
      const original = await fixture({
        pendingSources: [SOURCE_ID],
        pipelineFingerprint: planned.pipelineFingerprint as string,
      });
      const target = (await original.queue.load(BUNDLE_ID)).jobs[0];
      await original.queue.cancel(BUNDLE_ID, target.id);
      original.input.runtimeText = await original.file.read();
      expect(await prepare(original.input)).toMatchObject({ kind: "prepared" });
      expect(await run()).toMatchObject({
        kind: "diagnostic",
        code: "single_job_enqueue_failed",
        requests: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await original.file.read()).toBe(original.input.runtimeText);
    });

    it(`${ISSUE} returns the production header failure immediately even when the HTTP 200 body never ends`, async () => {
      const original = await fixture();
      const reply = response({}, { contentType: "text/plain", leaveOpen: true });
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
        staticCodes: [],
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
      const reply = response({}, { leaveOpen: true });
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
        requests: [expect.objectContaining({ stage: "generation", responseStatus: 200 })],
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
        response({}, { contentType: "text/plain", leaveOpen: true }).value
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
