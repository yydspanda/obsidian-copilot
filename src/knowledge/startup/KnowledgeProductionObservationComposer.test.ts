jest.mock("obsidian", () => {
  class FileSystemAdapter {}

  class TFile {
    /** Creates one mutable fake Vault file. */
    constructor(public path: string) {}
  }

  class TFolder {
    /** Creates one mutable fake Vault folder. */
    constructor(public path: string) {}
  }

  return { FileSystemAdapter, TFile, TFolder };
});

import {
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  type KnowledgeDeepSeekFetchPort,
  type KnowledgeDeepSeekHttpResponse,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { KnowledgeProductionPreflightSettingsInput } from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import { parseIngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgePluginProductionPreflightLifecycle,
  type KnowledgePluginProductionPreflightAdmission,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { KnowledgeProductionObservationComposer } from "@/knowledge/startup/KnowledgeProductionObservationComposer";
import { KnowledgeStudioReadGenerationLease } from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import type { KnowledgeProductionWorkerScheduler } from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";
import { App, EventRef, FileSystemAdapter, TAbstractFile, TFile, Vault } from "obsidian";

const PROJECT_ID = "project-personal";
const MODEL_NAME = "deepseek-v4-pro";
const MODEL_KEY = `${MODEL_NAME}|deepseek`;
const SOURCE_PATH = "Sources/personal/研究.md";
const SCHEMA_PATH = "Schemas/personal.md";
const originalRandomUuidDescriptor = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
let captureSequence = 0;

type VaultEventName = "create" | "modify" | "delete" | "rename";
type VaultEventHandler = (file: TAbstractFile, oldPath?: string) => void;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one externally settled Promise for lifecycle race assertions. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates a timer port whose callbacks remain inert unless a retry is actually scheduled. */
function createWorkerScheduler(): KnowledgeProductionWorkerScheduler {
  return {
    now: () => Date.now(),
    schedule: () => 1,
    cancel: () => undefined,
  };
}

/** Creates one strict Bundle used by the real production loader. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources/personal"],
    wikiRoot: "Wiki/personal",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
}

/** Creates already-hydrated settings with test-only placeholder credentials. */
function createSettings(): KnowledgeProductionPreflightSettingsInput {
  return {
    temperature: 0,
    maxTokens: 8_192,
    reasoningEffort: "high",
    verbosity: "medium",
    activeModels: [
      {
        name: MODEL_NAME,
        provider: "deepseek",
        enabled: true,
        projectEnabled: true,
        temperature: 0,
        reasoningEffort: "high",
        apiKey: "test-only-model-credential",
      },
    ],
    deepseekApiKey: "test-only-provider-credential",
  };
}

/** Creates a native-fetch-shaped spy that fails if observation invokes a model route. */
function createFetchPort(): jest.MockedFunction<KnowledgeDeepSeekFetchPort> {
  return jest.fn<ReturnType<KnowledgeDeepSeekFetchPort>, Parameters<KnowledgeDeepSeekFetchPort>>(
    async () => {
      throw new Error("Observation startup must not invoke fetch");
    }
  );
}

/** Creates one strict DeepSeek response whose analysis produces no write targets. */
function createNoChangesResponse(): KnowledgeDeepSeekHttpResponse {
  const content = JSON.stringify({
    version: 1,
    summary: "No durable Wiki change is required.",
    concepts: [],
    entities: [],
    claims: [],
    relations: [],
    citations: [],
    targets: [],
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      id: "completion-observation-controller",
      object: "chat.completion",
      model: MODEL_NAME,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })
  );
  return {
    status: 200,
    redirected: false,
    url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    headers: {
      get: (name) => {
        const normalized = name.toLocaleLowerCase("en-US");
        if (normalized === "content-type") return "application/json; charset=utf-8";
        if (normalized === "content-length") return String(bytes.byteLength);
        return null;
      },
    },
    body: new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

/** Creates a mutable fake TFile despite Obsidian's opaque public constructor. */
function createFile(path: string): TFile {
  const FileConstructor = TFile as unknown as new (path: string) => TFile;
  return new FileConstructor(path);
}

/** Encodes exact UTF-8 text into a detached ArrayBuffer. */
function encodeText(text: string): ArrayBuffer {
  return new Uint8Array(new TextEncoder().encode(text)).buffer;
}

/** Minimal exact App/Vault lifecycle harness used by the real production adapters. */
class ProductionVaultHarness {
  readonly files = new Map<string, ArrayBuffer>();
  readonly loadedFiles = new Map<string, TFile>();
  readonly handlers = new Map<VaultEventName, Map<EventRef, VaultEventHandler>>();
  readonly readBinary = jest.fn(async (path: string): Promise<ArrayBuffer> => {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("missing fake bytes");
    return bytes.slice(0);
  });
  readonly read = jest.fn(async (path: string): Promise<string> => {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("missing fake text");
    return new TextDecoder().decode(bytes);
  });
  readonly stat = jest.fn(async (path: string) => {
    const bytes = this.files.get(path);
    return bytes ? { type: "file" as const, ctime: 1, mtime: 1, size: bytes.byteLength } : null;
  });
  readonly adapter = Object.assign(new FileSystemAdapter(), {
    readBinary: this.readBinary,
    read: this.read,
    stat: this.stat,
  });
  private nextRef = 0;

  readonly vault = {
    adapter: this.adapter,
    getFiles: jest.fn(() => [...this.loadedFiles.values()]),
    getAllLoadedFiles: jest.fn(() => [...this.loadedFiles.values()]),
    getAbstractFileByPath: jest.fn((path: string) => this.loadedFiles.get(path) ?? null),
    on: jest.fn((name: VaultEventName, handler: VaultEventHandler) => {
      const ref = { id: ++this.nextRef } as unknown as EventRef;
      const handlers = this.handlers.get(name) ?? new Map<EventRef, VaultEventHandler>();
      handlers.set(ref, handler);
      this.handlers.set(name, handlers);
      return ref;
    }),
    offref: jest.fn((ref: EventRef) => {
      for (const handlers of this.handlers.values()) handlers.delete(ref);
    }),
  } as unknown as jest.Mocked<Vault>;

  /** Returns one App identity permanently bound to this Vault. */
  createApp(): App {
    return { vault: this.vault } as unknown as App;
  }

  /** Adds one loaded file with exact adapter bytes. */
  addFile(path: string, bytes: ArrayBuffer): TFile {
    const file = createFile(path);
    this.loadedFiles.set(path, file);
    this.files.set(path, bytes.slice(0));
    return file;
  }

  /** Replaces the exact adapter bytes for one already loaded file. */
  updateFile(file: TFile, bytes: ArrayBuffer): void {
    if (this.loadedFiles.get(file.path) !== file) {
      throw new Error("Expected one loaded fake file");
    }
    this.files.set(file.path, bytes.slice(0));
  }

  /** Emits one Vault event through every currently installed listener. */
  trigger(name: VaultEventName, file: TAbstractFile, oldPath?: string): void {
    for (const handler of [...(this.handlers.get(name)?.values() ?? [])]) {
      handler(file, oldPath);
    }
  }

  /** Counts listener references still owned by the current observation session. */
  activeListenerCount(): number {
    return [...this.handlers.values()].reduce((total, handlers) => total + handlers.size, 0);
  }
}

/** Mints one authentic same-snapshot workflow lease through production preflight. */
async function createAdmission(fetchPort: KnowledgeDeepSeekFetchPort): Promise<{
  lifecycle: KnowledgePluginProductionPreflightLifecycle;
  admission: KnowledgePluginProductionPreflightAdmission;
}> {
  const lifecycle = new KnowledgePluginProductionPreflightLifecycle({
    getProjectRecords: () => [
      {
        project: {
          id: PROJECT_ID,
          knowledgeBundle: createBundle(),
          projectModelKey: MODEL_KEY,
          modelConfigs: {},
        },
      },
    ],
    getSettings: () => createSettings(),
    fetchPort,
    createResources: () => createKnowledgeProductionPipelineResources(),
  });
  const result = await lifecycle.load(new AbortController().signal);
  if (result.kind !== "configured") {
    throw new Error("Expected a configured production preflight");
  }
  return { lifecycle, admission: result.admission };
}

/** Creates an initialized Runtime whose Manifest registers the exact source. */
async function createRuntime(): Promise<KnowledgeRuntimeStore> {
  const runtime = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());
  await runtime.initialize();
  const manifests = new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(runtime));
  await manifests.registerSource("personal", {
    sourceId: "source-1",
    sourcePath: SOURCE_PATH,
    custody: "user_managed",
  });
  return runtime;
}

describe("KnowledgeProductionObservationComposer", () => {
  beforeAll(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        captureSequence += 1;
        return `00000000-0000-4000-8000-${String(captureSequence).padStart(12, "0")}`;
      },
    });
  });

  afterAll(() => {
    if (originalRandomUuidDescriptor) {
      Object.defineProperty(window.crypto, "randomUUID", originalRandomUuidDescriptor);
    } else {
      Reflect.deleteProperty(window.crypto, "randomUUID");
    }
  });

  it("loads the same preflight generation and converges a real Runtime observation without fetch", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Wiki schema\r\n保持引用。\n"));
    const source = vault.addFile(SOURCE_PATH, encodeText("# 原始资料\r\n精确字节。\n"));
    const controller = new AbortController();
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });

    await expect(composer.start(controller.signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });
    expect(() => composer.assertHealthy()).not.toThrow();
    await expect(composer.reprove(controller.signal)).resolves.toEqual({
      kind: "observation_reproved",
    });

    const parsedQueue = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(parsedQueue.ok).toBe(true);
    if (!parsedQueue.ok) throw new Error("Expected a strict Queue snapshot");
    expect(parsedQueue.value.jobs).toHaveLength(1);
    expect(parsedQueue.value.jobs[0]).toMatchObject({
      bundleId: "personal",
      sourceId: "source-1",
      inputRevision: 1,
      status: "pending",
    });
    expect(parsedQueue.value.sourceHighWatermarks).toEqual([
      expect.objectContaining({ sourceId: "source-1", inputRevision: 1 }),
    ]);

    vault.updateFile(source, encodeText("# 原始资料\n第二次精确观测。\n"));
    vault.trigger("modify", source);

    await expect(composer.reprove(controller.signal)).resolves.toEqual({
      kind: "observation_reproved",
    });
    const updatedQueue = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(updatedQueue.ok).toBe(true);
    if (!updatedQueue.ok) throw new Error("Expected an updated strict Queue snapshot");
    expect(updatedQueue.value.jobs).toHaveLength(1);
    expect(updatedQueue.value.jobs[0]).toMatchObject({
      bundleId: "personal",
      sourceId: "source-1",
      inputRevision: 2,
      status: "pending",
    });
    expect(updatedQueue.value.sourceHighWatermarks).toEqual([
      expect.objectContaining({ sourceId: "source-1", inputRevision: 2 }),
    ]);
    expect(fetchPort).not.toHaveBeenCalled();
    expect(vault.activeListenerCount()).toBe(4);
    expect("runNext" in composer).toBe(false);

    composer.close();
    lifecycle.close();
    expect(vault.activeListenerCount()).toBe(0);
  });

  it("synchronously closes the live watcher when the preflight lease is invalidated", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(new AbortController().signal);
    expect(vault.activeListenerCount()).toBe(4);

    lifecycle.invalidate();

    expect(vault.activeListenerCount()).toBe(0);
    expect(() => composer.assertHealthy()).toThrow("The operation was aborted");
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("publishes a least-authority live Studio command adapter for the exact worker generation", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(new AbortController().signal);

    expect(() => composer.createKnowledgeStudioRuntimeReadAdapter()).toThrow(
      "The operation was aborted"
    );
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler()
    );
    const onApplyGenerationRefreshRequired = jest.fn<void, []>();
    const adapter = composer.createKnowledgeStudioRuntimeReadAdapter(
      undefined,
      onApplyGenerationRefreshRequired
    );
    const adapterInput = (
      adapter as unknown as {
        input: {
          runtime: Record<PropertyKey, unknown>;
          commands: Record<PropertyKey, unknown>;
          query: Record<PropertyKey, unknown>;
        };
      }
    ).input;
    const adapterRuntime = adapterInput.runtime;
    expect(Reflect.ownKeys(adapterRuntime).sort()).toEqual([
      "readAppliedProvenance",
      "readStudioBundle",
      "subscribeStudioBundle",
    ]);
    expect(Object.isFrozen(adapterRuntime)).toBe(true);
    expect("writeQueue" in adapterRuntime).toBe(false);
    expect("writeReview" in adapterRuntime).toBe(false);
    const queryAdapter = adapterInput.query;
    expect(Reflect.ownKeys(queryAdapter)).toEqual([]);
    expect(Object.isFrozen(queryAdapter)).toBe(true);
    for (const forbiddenAuthority of [
      "runtime",
      "vault",
      "model",
      "search",
      "write",
      "queue",
      "review",
      "apply",
    ]) {
      expect(forbiddenAuthority in queryAdapter).toBe(false);
    }
    const commandAdapter = adapterInput.commands;
    expect(Reflect.ownKeys(commandAdapter)).toEqual([]);
    expect(Object.isFrozen(commandAdapter)).toBe(true);
    for (const forbiddenAuthority of [
      "queue",
      "runtime",
      "write",
      "writeQueue",
      "writeReview",
      "apply",
      "accept",
      "model",
      "executor",
      "transaction",
    ]) {
      expect(forbiddenAuthority in commandAdapter).toBe(false);
    }
    const studioPort = new DelegatingKnowledgeStudioPort();
    const studioReadGeneration = new KnowledgeStudioReadGenerationLease({
      delegate: adapter,
      subscribeInvalidation: (listener) => composer.subscribeClose(listener),
      replaceDelegate: (delegate) => studioPort.replaceDelegate(delegate),
      setUnavailable: () =>
        studioPort.replaceDelegate(new UnavailableKnowledgeStudioPort("Generation closed")),
      assertCurrent: () => composer.assertHealthy(),
    });
    const snapshot = await studioPort.load("personal", new AbortController().signal);

    expect(snapshot).toMatchObject({
      bundleId: "personal",
      availability: "ready",
      commandCapabilities: {
        pauseBundle: true,
        resumeBundle: true,
        cancelJob: true,
        retryJob: true,
        reviewReject: true,
        reviewAccept: true,
        recoveryContinue: false,
        recoveryAbandon: false,
      },
      activity: {
        bundleId: "personal",
        items: [expect.objectContaining({ sourceId: "source-1", status: "queued" })],
      },
      reviews: [],
      recovery: {
        bundleId: "personal",
        items: [],
      },
      queryAvailable: true,
    });
    expect(snapshot.notice).toContain("scoped Query are connected");
    expect(snapshot.notice).toContain(
      "model synthesis, Save to Wiki, PDF jump, and delete remain disabled"
    );
    expect(Object.isFrozen(snapshot.commandCapabilities)).toBe(true);
    expect(onApplyGenerationRefreshRequired).not.toHaveBeenCalled();

    await expect(
      studioPort.query("personal", { query: "grounded evidence" }, new AbortController().signal)
    ).resolves.toMatchObject({
      mode: "grounded_retrieval",
      bundleId: "personal",
      hits: [],
    });

    await expect(
      studioPort.pauseBundle("personal", snapshot.activity.revision, new AbortController().signal)
    ).resolves.toBeUndefined();
    const pausedQueue = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(pausedQueue.ok).toBe(true);
    if (!pausedQueue.ok) throw new Error("Expected a durably paused Queue snapshot");
    expect(pausedQueue.value).toMatchObject({
      revision: snapshot.activity.revision + 1,
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ sourceId: "source-1", status: "pending" })],
    });
    await expect(studioPort.load("personal", new AbortController().signal)).resolves.toMatchObject({
      availability: "ready",
      activity: {
        revision: pausedQueue.value.revision,
        controls: { state: "paused", canPause: false, canResume: true },
      },
    });

    const onHint = jest.fn();
    const unsubscribe = studioPort.subscribe("personal", onHint);
    expect(vault.activeListenerCount()).toBe(8);

    vault.trigger("create", createFile("Elsewhere/Note.md"));
    expect(onHint).not.toHaveBeenCalled();
    vault.trigger("create", createFile("Wiki/personal/Page.md"));
    expect(onHint).toHaveBeenCalledTimes(1);
    vault.trigger("modify", createFile("Wiki/personal/Page.md"));
    vault.trigger("delete", createFile("Wiki/personal/Page.md"));
    vault.trigger("rename", createFile("Elsewhere/Moved.md"), "Wiki/personal/BeforeMove.md");
    vault.trigger("rename", createFile("Wiki/personal/MovedIn.md"), "Elsewhere/BeforeMove.md");
    vault.trigger("create", createFile("wiki/PERSONAL/Case.md"));
    vault.trigger("rename", createFile("Elsewhere/New.md"), "Elsewhere/Old.md");
    expect(onHint).toHaveBeenCalledTimes(6);
    const retainedHandlers = [...vault.handlers.values()].flatMap((handlers) => [
      ...handlers.values(),
    ]);

    lifecycle.invalidate();
    expect(vault.activeListenerCount()).toBe(0);
    await expect(
      adapter.pauseBundle("personal", pausedQueue.value.revision, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      adapter.query("personal", { query: "late" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
    await expect(
      studioPort.pauseBundle("personal", pausedQueue.value.revision, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    await expect(
      studioPort.query("personal", { query: "late" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    await expect(studioPort.load("personal", new AbortController().signal)).resolves.toMatchObject({
      availability: "adapter_unavailable",
      notice: "Generation closed",
    });
    expect(parseIngestQueueSnapshot(await runtime.readQueue("personal"))).toEqual(pausedQueue);
    const callsAfterInvalidation = onHint.mock.calls.length;
    for (const handler of retainedHandlers) handler(createFile("Wiki/personal/Late.md"));
    expect(onHint).toHaveBeenCalledTimes(callsAfterInvalidation);
    unsubscribe();
    unsubscribe();
    studioReadGeneration.close();
    composer.close();
    await worker.whenSettled();
    expect(vault.activeListenerCount()).toBe(0);
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("revokes health immediately when the live watcher observes a destructive source change", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    const source = vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const controller = new AbortController();
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(controller.signal);

    source.path = "Sources/personal/renamed.md";
    vault.trigger("rename", source, SOURCE_PATH);

    expect(() => composer.assertHealthy()).toThrow("The operation was aborted");
    expect(vault.activeListenerCount()).toBe(0);
    await expect(composer.reprove(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchPort).not.toHaveBeenCalled();
    lifecycle.close();
  });

  it("returns a fixed plan diagnostic without installing listeners when schema bytes are absent", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });

    await expect(composer.start(new AbortController().signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "workflow_plan_unavailable",
    });
    expect(vault.activeListenerCount()).toBe(0);
    expect(fetchPort).not.toHaveBeenCalled();
    composer.close();
    lifecycle.close();
  });

  it("aborts the exact Queue signal when a live production model generation closes", async () => {
    const fetchStarted = createDeferred<AbortSignal>();
    const fetchAborted = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async (_url, init) => {
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Expected the exact Queue AbortSignal");
      }
      fetchStarted.resolve(signal);
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAborted = () => {
          fetchAborted.resolve();
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal.aborted) {
          rejectAborted();
          return;
        }
        signal.addEventListener("abort", rejectAborted, { once: true });
      });
    });
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await expect(composer.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler()
    );

    worker.start();
    const queueSignal = await fetchStarted.promise;
    expect(queueSignal.aborted).toBe(false);

    composer.close();

    expect(queueSignal.aborted).toBe(true);
    await fetchAborted.promise;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
      if (
        parsed.ok &&
        parsed.value.control.status === "paused" &&
        parsed.value.control.reason === "startup_recovery" &&
        parsed.value.jobs[0]?.status === "pending"
      ) {
        lifecycle.close();
        expect(fetchPort).toHaveBeenCalledTimes(1);
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    lifecycle.close();
    throw new Error("Expected lifecycle-aborted Queue recovery");
  });

  it("wakes an idle production controller from the real post-commit Queue event sink", async () => {
    const firstFetch = createDeferred<void>();
    const secondFetch = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async () => {
      if (fetchPort.mock.calls.length === 1) firstFetch.resolve();
      if (fetchPort.mock.calls.length === 2) secondFetch.resolve();
      return createNoChangesResponse();
    });
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    const source = vault.addFile(SOURCE_PATH, encodeText("# Source one\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(new AbortController().signal);
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler()
    );

    worker.start();
    await firstFetch.promise;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
      if (parsed.ok && parsed.value.jobs[0]?.status === "completed") break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    expect(fetchPort).toHaveBeenCalledTimes(1);

    vault.updateFile(source, encodeText("# Source two\n"));
    vault.trigger("modify", source);
    await secondFetch.promise;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
      if (
        parsed.ok &&
        parsed.value.jobs.some((job) => job.inputRevision === 2 && job.status === "completed")
      ) {
        composer.close();
        await worker.whenSettled();
        lifecycle.close();
        expect(fetchPort).toHaveBeenCalledTimes(2);
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
    throw new Error("Expected the Queue event sink to wake the idle worker");
  });
});
