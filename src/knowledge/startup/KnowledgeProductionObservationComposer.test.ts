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

  return { apiVersion: "1.13.4-test", FileSystemAdapter, TFile, TFolder };
});

import {
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  type KnowledgeDeepSeekFetchPort,
  type KnowledgeDeepSeekHttpResponse,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KnowledgeProductionChatCaptureCoordinator } from "@/knowledge/capture/KnowledgeProductionChatCaptureCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { KnowledgeProductionPreflightSettingsInput } from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import { parseIngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY } from "@/knowledge/manifest/NoChangesManifestCommit";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeProductionSourceLifecycleCoordinator } from "@/knowledge/sourceLifecycle/KnowledgeProductionSourceLifecycleCoordinator";
import type { KnowledgeSourceLifecyclePort } from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import {
  KnowledgePluginProductionPreflightLifecycle,
  type KnowledgePluginProductionPreflightAdmission,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { KnowledgeProductionObservationComposer } from "@/knowledge/startup/KnowledgeProductionObservationComposer";
import { DelegatingKnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/DelegatingKnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPageInspectorGenerationLease } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorGenerationLease";
import { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import { KnowledgeKnownAppliedWikiOutputsGenerationLease } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsGenerationLease";
import {
  KnowledgePluginStartupBarrier,
  type KnowledgePluginObservationStartupPort,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { createSourceObservationPreReleaseResult } from "@/knowledge/startup/KnowledgeSourceObservationPreRelease";
import { KnowledgeStudioReadGenerationLease } from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import type { KnowledgeProductionWorkerScheduler } from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { KnowledgeStudioSourceLifecycleOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioSourceLifecycleOnlyAdapter";
import {
  KnowledgeStudioController,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";
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

/** Flushes coalesced value-free Studio hints without advancing timers. */
async function flushStudioHints(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Waits bounded Promise turns for one asynchronous Studio state transition. */
async function waitForStudioState(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for Knowledge Studio state");
}

/** Creates a timer port whose callbacks remain inert unless a retry is actually scheduled. */
function createWorkerScheduler(): KnowledgeProductionWorkerScheduler {
  return {
    now: () => Date.now(),
    schedule: () => 1,
    cancel: () => undefined,
  };
}

/**
 * Creates one strict Bundle used by the real production loader.
 *
 * @param patch - Optional Bundle fields replaced for one test
 */
function createBundle(patch: Partial<KnowledgeBundleConfig> = {}): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources/personal"],
    wikiRoot: "Wiki/personal",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
    ...patch,
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

/** Creates one strict DeepSeek response with optional test-controlled model content. */
function createNoChangesResponse(contentOverride?: string): KnowledgeDeepSeekHttpResponse {
  const content =
    contentOverride ??
    JSON.stringify({
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
  let consumed = false;
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
      pull: (controller) => {
        if (consumed) {
          controller.close();
          return;
        }
        consumed = true;
        controller.enqueue(bytes);
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

/** Memory Runtime file that loses one acknowledgement after a durable no-change commit. */
class PostCommitThrowRuntimeFile extends KnowledgeExecutionMemoryRuntimeFile {
  private armed = false;

  /** Arms one post-commit transport failure without changing the committed bytes. */
  arm(): void {
    this.armed = true;
  }

  /** Commits through the base atomic file and then drops the matching acknowledgement once. */
  override async process(transform: (currentContent: string) => string): Promise<string> {
    const committed = await super.process(transform);
    if (this.armed && committed.includes(KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY)) {
      this.armed = false;
      throw new Error("test-only post-commit acknowledgement loss");
    }
    return committed;
  }
}

/**
 * Mints one authentic same-snapshot workflow lease through production preflight.
 *
 * @param fetchPort - Test model transport that observation must not call
 * @param bundle - Bundle projected into the production preflight snapshot
 */
async function createAdmission(
  fetchPort: KnowledgeDeepSeekFetchPort,
  bundle: KnowledgeBundleConfig = createBundle()
): Promise<{
  lifecycle: KnowledgePluginProductionPreflightLifecycle;
  admission: KnowledgePluginProductionPreflightAdmission;
}> {
  const lifecycle = new KnowledgePluginProductionPreflightLifecycle({
    getProjectRecords: () => [
      {
        project: {
          id: PROJECT_ID,
          knowledgeBundle: bundle,
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
async function createRuntime(
  file: KnowledgeExecutionMemoryRuntimeFile = new KnowledgeExecutionMemoryRuntimeFile()
): Promise<KnowledgeRuntimeStore> {
  const runtime = new KnowledgeRuntimeStore(file);
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
    expect(composer.getSourceIssues()).toEqual([]);
    const registeredSources = composer.getRegisteredSourcePaths();
    expect(registeredSources).toEqual([
      { bundleId: "personal", sourceId: "source-1", sourcePath: SOURCE_PATH },
    ]);
    expect(Object.isFrozen(registeredSources)).toBe(true);
    expect(registeredSources.every(Object.isFrozen)).toBe(true);
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
    expect(() => composer.getSourceIssues()).toThrow("The operation was aborted");
    expect(() => composer.getRegisteredSourcePaths()).toThrow("The operation was aborted");
    lifecycle.close();
    expect(vault.activeListenerCount()).toBe(0);
  });

  it("routes a real startup-missing pending observation through the source-only Barrier state", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    await new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "capture-missing-before-restart",
    });
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    let active = true;
    let sourceOnly: KnowledgeStudioSourceLifecycleOnlyAdapter | undefined;
    const release = jest.fn(async () => ({ kind: "released" as const, bundleIds: ["personal"] }));
    const observation: KnowledgePluginObservationStartupPort = {
      start: async (signal) => {
        const result = await composer.start(signal);
        const sourceRecovery = createSourceObservationPreReleaseResult(
          result,
          ["personal"],
          composer.getSourceIssues()
        );
        if (!sourceRecovery) return result;
        const assertCurrent = (): void => {
          if (!active) throw new DOMException("The operation was aborted", "AbortError");
          composer.getSourceIssues();
        };
        const coordinator = new KnowledgeProductionSourceLifecycleCoordinator({
          runtime,
          getSourceIssues: () => composer.getSourceIssues(),
          assertCurrent,
          onGenerationRefreshRequired: () => undefined,
        });
        const sourceLifecycle: KnowledgeSourceLifecyclePort = Object.freeze({
          loadSources: (bundleId: string, nextSignal: AbortSignal) =>
            coordinator.loadSources(bundleId, nextSignal),
          checkAgain: (bundleId: string, sourceId: string, nextSignal: AbortSignal) =>
            coordinator.checkAgain(bundleId, sourceId, nextSignal),
          retireSource: (
            bundleId: string,
            request: Parameters<KnowledgeSourceLifecyclePort["retireSource"]>[1],
            nextSignal: AbortSignal
          ) => coordinator.retireSource(bundleId, request, nextSignal),
        });
        sourceOnly = new KnowledgeStudioSourceLifecycleOnlyAdapter({
          bundleId: "personal",
          sourceLifecycle,
          assertCurrent,
        });
        return sourceRecovery;
      },
      release,
      close: () => {
        active = false;
        composer.close();
      },
    };
    const setSourceRecoveryReady = jest.fn<void, [unknown]>();
    const barrier = new KnowledgePluginStartupBarrier({
      runtime: { isAvailable: () => true },
      projects: { initialize: async () => undefined },
      bundleConfig: {
        load: async () => ({
          kind: "configured",
          bundleIds: ["personal"],
          recovery: {
            start: async () => ({ kind: "observed_clear" as const }),
            close: () => undefined,
          },
          observation,
        }),
      },
      studio: {
        setUnavailable: () => undefined,
        setReadReady: () => undefined,
        setSourceRecoveryReady,
      },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toMatchObject({
      status: "source_recovery_required",
      sourceRecoveryBundleId: "personal",
    });
    expect(setSourceRecoveryReady).toHaveBeenCalledWith(barrier.getState());
    expect(release).not.toHaveBeenCalled();
    expect(sourceOnly).toBeDefined();
    await expect(sourceOnly!.load("personal", new AbortController().signal)).resolves.toMatchObject(
      {
        availability: "ready",
        preferredTab: "sources",
        sourceLifecycle: {
          sources: [expect.objectContaining({ sourceId: "source-1", status: "missing" })],
        },
      }
    );
    await expect(
      sourceOnly!.pauseBundle("personal", 0, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    expect("replaceMissingSource" in sourceOnly!).toBe(false);

    barrier.cancel();
    expect(() => composer.getSourceIssues()).toThrow("The operation was aborted");
    await expect(sourceOnly!.load("personal", new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(release).not.toHaveBeenCalled();
    lifecycle.close();
    expect(fetchPort).not.toHaveBeenCalled();
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
    expect(() => composer.getSourceIssues()).toThrow("The operation was aborted");
    expect(() => composer.getRegisteredSourcePaths()).toThrow("The operation was aborted");
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

    expect(() =>
      composer.createKnowledgeStudioRuntimeReadAdapter(admission.modelRouteLease)
    ).toThrow("The operation was aborted");
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => undefined
    );
    const onApplyGenerationRefreshRequired = jest.fn<void, []>();
    const adapter = composer.createKnowledgeStudioRuntimeReadAdapter(
      admission.modelRouteLease,
      undefined,
      onApplyGenerationRefreshRequired
    );
    const adapterInput = (
      adapter as unknown as {
        input: {
          runtime: Record<PropertyKey, unknown>;
          commands: Record<PropertyKey, unknown>;
          query: Record<PropertyKey, unknown>;
          reviewEvidence: Record<PropertyKey, unknown>;
          sourceLifecycle: Record<PropertyKey, unknown>;
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
    const reviewEvidenceAdapter = adapterInput.reviewEvidence;
    expect(Reflect.ownKeys(reviewEvidenceAdapter)).toEqual(["openReviewEvidence"]);
    expect(Object.isFrozen(reviewEvidenceAdapter)).toBe(true);
    for (const forbiddenAuthority of [
      "runtime",
      "vault",
      "model",
      "network",
      "write",
      "queue",
      "review",
      "apply",
      "sourceAuthority",
      "navigator",
    ]) {
      expect(forbiddenAuthority in reviewEvidenceAdapter).toBe(false);
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
    const sourceLifecycleAdapter = adapterInput.sourceLifecycle;
    expect(Reflect.ownKeys(sourceLifecycleAdapter).sort()).toEqual([
      "checkAgain",
      "loadSources",
      "retireSource",
    ]);
    expect(Object.isFrozen(sourceLifecycleAdapter)).toBe(true);
    for (const forbiddenAuthority of [
      "runtime",
      "vault",
      "write",
      "remove",
      "queue",
      "review",
      "apply",
      "transaction",
    ]) {
      expect(forbiddenAuthority in sourceLifecycleAdapter).toBe(false);
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
      sourceLifecycle: {
        bundleId: "personal",
        sources: [
          expect.objectContaining({
            sourceId: "source-1",
            sourcePath: SOURCE_PATH,
            status: "ready",
          }),
        ],
      },
      queryAvailable: true,
      queryWritebackAvailable: true,
      reviewEvidenceAvailable: true,
    });
    expect(snapshot.sourceLifecycle?.sources[0]?.actions.canRemove).toBe(false);
    expect(snapshot.notice).toContain("reviewed Save to Wiki");
    expect(snapshot.notice).toContain("Saved answers enter Review");
    expect(snapshot.notice).toContain("source lifecycle recovery");
    expect(snapshot.notice).toContain("without deleting generated Wiki files");
    expect(snapshot.notice).toContain("generated Wiki deletion remains disabled");
    expect(Object.isFrozen(snapshot.commandCapabilities)).toBe(true);
    expect(onApplyGenerationRefreshRequired).not.toHaveBeenCalled();

    await expect(
      studioPort.query("personal", { query: "grounded evidence" }, new AbortController().signal)
    ).resolves.toMatchObject({
      mode: "grounded_answer",
      bundleId: "personal",
      answer: { status: "insufficient_evidence", claims: [] },
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
    vault.trigger("modify", createFile("Wiki/personal/Page.md"));
    vault.trigger("delete", createFile("Wiki/personal/Page.md"));
    vault.trigger("rename", createFile("Elsewhere/Moved.md"), "Wiki/personal/BeforeMove.md");
    vault.trigger("rename", createFile("Wiki/personal/MovedIn.md"), "Elsewhere/BeforeMove.md");
    vault.trigger("create", createFile("wiki/PERSONAL/Case.md"));
    vault.trigger("rename", createFile("Elsewhere/New.md"), "Elsewhere/Old.md");
    await flushStudioHints();
    expect(onHint).toHaveBeenCalledTimes(1);
    vault.trigger("create", createFile("Sources/personal/New.md"));
    vault.trigger("modify", createFile("Sources/personal/New.md"));
    vault.trigger("delete", createFile("Sources/personal/New.md"));
    vault.trigger("rename", createFile("Elsewhere/MovedSource.md"), "Sources/personal/Old.md");
    vault.trigger("rename", createFile("Sources/personal/MovedIn.md"), "Elsewhere/OldSource.md");
    vault.trigger("create", createFile("sources/PERSONAL/Case.md"));
    await flushStudioHints();
    expect(onHint).toHaveBeenCalledTimes(2);
    const retainedHandlers = [...vault.handlers.values()].flatMap((handlers) => [
      ...handlers.values(),
    ]);

    vault.trigger("create", createFile("Wiki/personal/PendingClose.md"));
    lifecycle.invalidate();
    expect(onHint).toHaveBeenCalledTimes(3);
    await flushStudioHints();
    expect(onHint).toHaveBeenCalledTimes(3);
    expect(vault.activeListenerCount()).toBe(0);
    await expect(
      adapter.pauseBundle("personal", pausedQueue.value.revision, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      adapter.query("personal", { query: "late" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
    await expect(
      adapter.openReviewEvidence(
        "personal",
        {
          changeSetId: "changeset-late",
          proposalDigest: "a".repeat(64),
          expectedSnapshotToken: "b".repeat(64),
          evidenceRef: "c".repeat(64),
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      studioPort.pauseBundle("personal", pausedQueue.value.revision, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    await expect(
      studioPort.query("personal", { query: "late" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    await expect(
      studioPort.openReviewEvidence(
        "personal",
        {
          changeSetId: "changeset-late",
          proposalDigest: "a".repeat(64),
          expectedSnapshotToken: "b".repeat(64),
          evidenceRef: "c".repeat(64),
        },
        new AbortController().signal
      )
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

  it("emits Studio hints for every configured source root and both sides of rename", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(
      fetchPort,
      createBundle({ sourceRoots: ["Sources/personal", "Inbox/research"] })
    );
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
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => undefined
    );
    const adapter = composer.createKnowledgeStudioRuntimeReadAdapter(admission.modelRouteLease);
    const onHint = jest.fn<void, []>();
    const unsubscribe = adapter.subscribe("personal", onHint);

    vault.trigger("create", createFile("Sources/personal/New.md"));
    await flushStudioHints();
    vault.trigger("create", createFile("Inbox/research/Paper.pdf"));
    await flushStudioHints();
    vault.trigger("create", createFile("Wiki/personal/New.md"));
    await flushStudioHints();
    vault.trigger("rename", createFile("Elsewhere/Moved.pdf"), "Inbox/research/Before.pdf");
    await flushStudioHints();
    vault.trigger("rename", createFile("Sources/personal/MovedIn.md"), "Elsewhere/Before.md");
    await flushStudioHints();
    vault.trigger("create", createFile("Inbox/research-other/No.md"));
    vault.trigger("rename", createFile("Elsewhere/New.md"), "Elsewhere/Old.md");

    expect(onHint).toHaveBeenCalledTimes(5);

    vault.trigger("create", createFile("Wiki/personal/PendingUnsubscribe.md"));
    unsubscribe();
    await flushStudioHints();
    expect(onHint).toHaveBeenCalledTimes(5);
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
    expect(vault.activeListenerCount()).toBe(0);
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("reloads an open Studio after delete and again only when recovery settles", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    const source = vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const controller = new AbortController();
    const emit = jest.fn<void, [unknown]>();
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
      notificationSink: { emit },
    });
    await composer.start(controller.signal);
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => undefined
    );
    const adapter = composer.createKnowledgeStudioRuntimeReadAdapter(
      admission.modelRouteLease,
      undefined,
      () => undefined
    );
    const studio = new KnowledgeStudioController(adapter, adapter, undefined, undefined, adapter);
    studio.start("personal");
    await waitForStudioState(
      () => studio.getState().snapshot?.sourceLifecycle?.sources[0]?.status === "ready"
    );

    vault.loadedFiles.delete(SOURCE_PATH);
    vault.files.delete(SOURCE_PATH);
    vault.trigger("delete", source);
    await waitForStudioState(
      () => studio.getState().snapshot?.sourceLifecycle?.sources[0]?.status === "missing"
    );

    expect(() => composer.assertHealthy()).not.toThrow();
    expect(composer.getSourceIssues()).toEqual([
      {
        kind: "source_change_unsupported",
        change: "delete",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
    expect(composer.getRegisteredSourcePaths()).toEqual([
      { bundleId: "personal", sourceId: "source-1", sourcePath: SOURCE_PATH },
    ]);
    expect(vault.activeListenerCount()).toBe(8);
    expect(emit).toHaveBeenCalledWith({
      kind: "source_change_unsupported",
      change: "delete",
      bundleId: "personal",
      sourceId: "source-1",
    });

    const replacement = vault.addFile(SOURCE_PATH, encodeText("# Restored source\n"));
    vault.trigger("create", replacement);
    await waitForStudioState(
      () => studio.getState().snapshot?.sourceLifecycle?.sources[0]?.status === "ready"
    );
    expect(composer.getSourceIssues()).toEqual([]);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "capture_settled",
        cause: "create",
        bundleId: "personal",
        sourceId: "source-1",
      })
    );
    expect(vault.activeListenerCount()).toBe(8);
    expect(fetchPort).not.toHaveBeenCalled();
    studio.stop();
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
  });

  it("mints one least-authority applied-Wiki inspector only for the released worker generation", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const signal = new AbortController().signal;
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });

    await expect(composer.start(signal)).resolves.toMatchObject({
      kind: "observation_converged",
    });
    expect(() => composer.createAppliedWikiPageInspectorCoordinator()).toThrow("aborted");

    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => undefined
    );
    const inspector = composer.createAppliedWikiPageInspectorCoordinator();

    const indexRows = await inspector.listAppliedWikiPathIndexRows(signal);
    expect(indexRows).toEqual([]);
    expect(Reflect.ownKeys(inspector)).toEqual([]);
    expect(Object.isFrozen(inspector)).toBe(true);
    expect(() => composer.createAppliedWikiPageInspectorCoordinator()).toThrow("aborted");

    const stablePort = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    const pathIndex = new KnowledgeAppliedWikiPathIndex();
    const generation = new KnowledgeAppliedWikiPageInspectorGenerationLease({
      delegate: inspector,
      indexRows,
      subscribeInvalidation: (listener) => composer.subscribeClose(listener),
      replaceDelegate: (delegate) => stablePort.replaceDelegate(delegate),
      revokeDelegate: (delegate) => stablePort.revokeDelegate(delegate),
      installPathIndex: (rows) => pathIndex.install(rows),
      revokePathIndex: (lease) => pathIndex.revoke(lease),
      assertCurrent: () => composer.assertHealthy(),
    });
    await expect(
      stablePort.inspectPage(Object.freeze({ pagePath: "Wiki/personal/Missing.md" }), signal)
    ).rejects.toMatchObject({ code: "not_applied" });
    expect(() => generation.assertCurrent()).not.toThrow();

    composer.close();
    expect(() => generation.assertCurrent()).toThrow("aborted");
    await expect(
      stablePort.inspectPage(Object.freeze({ pagePath: "Wiki/personal/Missing.md" }), signal)
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(pathIndex.lookupExact("Wiki/personal/Missing.md")).toEqual([]);
    await expect(inspector.listAppliedWikiPathIndexRows(signal)).rejects.toMatchObject({
      name: "KnowledgeAppliedWikiPageInspectorError",
      code: "unavailable",
    });
    generation.close();
    stablePort.dispose();
    pathIndex.dispose();
    await worker.whenSettled();
    lifecycle.close();
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("mints one least-authority known-output browser only for the released worker generation", async () => {
    const fetchPort = createFetchPort();
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source\n"));
    const signal = new AbortController().signal;
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });

    await expect(composer.start(signal)).resolves.toMatchObject({
      kind: "observation_converged",
    });
    expect(() => composer.createKnownAppliedWikiOutputsCoordinator()).toThrow("aborted");

    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => undefined
    );
    const browser = composer.createKnownAppliedWikiOutputsCoordinator();

    expect(Reflect.ownKeys(browser)).toEqual([]);
    expect(Object.isFrozen(browser)).toBe(true);
    expect(() => composer.createKnownAppliedWikiOutputsCoordinator()).toThrow("aborted");

    const stablePort = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    const generation = new KnowledgeKnownAppliedWikiOutputsGenerationLease({
      delegate: browser,
      subscribeInvalidation: (listener) => composer.subscribeClose(listener),
      replaceDelegate: (delegate) => stablePort.replaceDelegate(delegate),
      revokeDelegate: (delegate) => stablePort.revokeDelegate(delegate),
      assertCurrent: () => composer.assertHealthy(),
    });
    await expect(
      stablePort.inspectKnownOutputs(
        Object.freeze({ pagePath: "Wiki/personal/Missing.md" }),
        signal
      )
    ).rejects.toMatchObject({ code: "not_known" });
    expect(() => generation.assertCurrent()).not.toThrow();

    composer.close();
    expect(() => generation.assertCurrent()).toThrow("aborted");
    await expect(
      stablePort.inspectKnownOutputs(
        Object.freeze({ pagePath: "Wiki/personal/Missing.md" }),
        signal
      )
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      browser.inspectKnownOutputs(Object.freeze({ pagePath: "Wiki/personal/Missing.md" }), signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    generation.close();
    stablePort.dispose();
    await worker.whenSettled();
    lifecycle.close();
    expect(fetchPort).not.toHaveBeenCalled();
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
      createWorkerScheduler(),
      () => undefined
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
      if (fetchPort.mock.calls.length === 1) {
        firstFetch.resolve();
        return createNoChangesResponse("{}");
      }
      secondFetch.resolve();
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
      createWorkerScheduler(),
      () => undefined
    );

    worker.start();
    await firstFetch.promise;
    let firstFailed = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
      if (parsed.ok && parsed.value.jobs[0]?.status === "failed") {
        firstFailed = true;
        break;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    expect(firstFailed).toBe(true);

    vault.updateFile(source, encodeText("# Source two\n"));
    vault.trigger("modify", source);
    await secondFetch.promise;

    expect(fetchPort).toHaveBeenCalledTimes(2);
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
  });

  it("requests a generation refresh after the real no-change Manifest commit", async () => {
    const firstFetch = createDeferred<void>();
    const refreshRequired = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async () => {
      if (fetchPort.mock.calls.length === 1) firstFetch.resolve();
      return createNoChangesResponse();
    });
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source one\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(new AbortController().signal);
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => refreshRequired.resolve()
    );

    worker.start();
    await firstFetch.promise;
    await refreshRequired.promise;
    const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Expected a strict no-change Queue snapshot");
    expect(parsed.value.jobs[0]).toMatchObject({ status: "completed", stage: "completed" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
  });

  it("turns a reviewed Chat draft into completed no-change Activity after the requested production rebuild", async () => {
    const modelStarted = createDeferred<void>();
    const workerRefreshRequired = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async () => {
      modelStarted.resolve();
      return createNoChangesResponse();
    });
    const firstAdmission = await createAdmission(fetchPort);
    const runtime = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());
    await runtime.initialize();
    const manifests = new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(runtime));
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    const captureRefreshRequired = jest.fn<void, []>();
    const captureCoordinator = new KnowledgeProductionChatCaptureCoordinator({
      owners: firstAdmission.admission.owners,
      parserProfiles: firstAdmission.admission.workflowLease
        .getParsers()
        .map((parser) => parser.getProfile()),
      sourcePresence: { isFile: (sourcePath) => vault.loadedFiles.has(sourcePath) },
      registration: new KnowledgeSourceRegistrationCore(manifests, {
        assertCurrent: () => firstAdmission.admission.workflowLease.assertCurrent(),
      }),
      createFileStore: () => ({
        publish: async (sourcePath, bytes, signal) => {
          if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
          const contentHash = createSourceContentHash(bytes);
          const existing = vault.files.get(sourcePath);
          if (existing) {
            return createSourceContentHash(new Uint8Array(existing)) === contentHash
              ? { status: "reused" as const, contentHash }
              : { status: "conflict" as const };
          }
          vault.addFile(sourcePath, new Uint8Array(bytes).buffer);
          return { status: "created" as const, contentHash };
        },
      }),
      assertCurrent: () => firstAdmission.admission.workflowLease.assertCurrent(),
      onGenerationRefreshRequired: captureRefreshRequired,
    });
    const session = captureCoordinator.prepareKnowledgeDraft();
    if (!session) throw new Error("Expected a current Chat draft destination");

    const receipt = await captureCoordinator.createKnowledgeDraft(
      session,
      {
        title: "Reviewed Chat draft",
        body: "The user checked this explanation before registering it as a source.",
        reviewConfirmed: true,
      },
      new AbortController().signal
    );

    expect(receipt).toMatchObject({ status: "registered", bundleId: "personal" });
    expect(captureRefreshRequired).toHaveBeenCalledTimes(1);
    const registeredManifest = await manifests.load("personal");
    expect(registeredManifest.entries).toHaveLength(1);
    expect(registeredManifest.entries[0]).toMatchObject({
      sourcePath: receipt.sourcePath,
      custody: "managed_copy",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: {
          version: 1,
          operation: "chat_knowledge_draft",
        },
      },
    });
    firstAdmission.lifecycle.close();

    const nextAdmission = await createAdmission(fetchPort);
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: nextAdmission.admission.workflowLease,
    });
    await expect(composer.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });
    const worker = composer.createCompileReviewWorkerController(
      nextAdmission.admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => workerRefreshRequired.resolve()
    );
    const studio = composer.createKnowledgeStudioRuntimeReadAdapter(
      nextAdmission.admission.modelRouteLease,
      undefined,
      () => undefined
    );

    worker.start();
    await modelStarted.promise;
    await workerRefreshRequired.promise;
    const snapshot = await studio.load("personal", new AbortController().signal);
    expect(snapshot.activity.items).toEqual([
      expect.objectContaining({
        sourceId: registeredManifest.entries[0]?.sourceId,
        status: "completed",
        terminal: true,
      }),
    ]);
    expect(snapshot.reviews).toEqual([]);
    expect(snapshot.sourceLifecycle?.sources).toEqual([
      expect.objectContaining({
        sourceId: registeredManifest.entries[0]?.sourceId,
        sourcePath: receipt.sourcePath,
        status: "ready",
      }),
    ]);
    const committedManifest = await manifests.load("personal");
    expect(
      committedManifest.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toBeDefined();
    expect(fetchPort).toHaveBeenCalledTimes(1);

    composer.close();
    await worker.whenSettled();
    nextAdmission.lifecycle.close();
  });

  it("admits an unchanged cold observation from a real zero-page no-change authority", async () => {
    const refreshRequired = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async () => createNoChangesResponse());
    const firstAdmission = await createAdmission(fetchPort);
    const runtime = await createRuntime();
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source one\n"));
    const firstComposer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: firstAdmission.admission.workflowLease,
    });
    await expect(firstComposer.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });
    const firstWorker = firstComposer.createCompileReviewWorkerController(
      firstAdmission.admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => refreshRequired.resolve()
    );

    firstWorker.start();
    await refreshRequired.promise;

    const queueBeforeRestart = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(queueBeforeRestart.ok).toBe(true);
    if (!queueBeforeRestart.ok) throw new Error("Expected a strict no-change Queue snapshot");
    expect(queueBeforeRestart.value.jobs).toHaveLength(1);
    expect(queueBeforeRestart.value.jobs[0]).toMatchObject({
      sourceId: "source-1",
      inputRevision: 1,
      attempt: 1,
      status: "completed",
      stage: "completed",
    });
    expect(queueBeforeRestart.value.sourceHighWatermarks).toEqual([
      expect.objectContaining({ sourceId: "source-1", inputRevision: 1 }),
    ]);
    const jobBeforeRestart = queueBeforeRestart.value.jobs[0];
    const manifestBeforeRestart = await new SourceManifestRepository(
      new KnowledgeRuntimeManifestStorage(runtime)
    ).load("personal");
    const markerBeforeRestart =
      manifestBeforeRestart.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
    expect(markerBeforeRestart).toBeDefined();
    expect(fetchPort).toHaveBeenCalledTimes(1);

    firstComposer.close();
    await firstWorker.whenSettled();
    firstAdmission.lifecycle.close();

    const secondAdmission = await createAdmission(fetchPort);
    const secondComposer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: secondAdmission.admission.workflowLease,
    });
    await expect(secondComposer.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });

    const queueAfterRestart = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(queueAfterRestart.ok).toBe(true);
    if (!queueAfterRestart.ok) throw new Error("Expected a strict admitted Queue snapshot");
    expect(queueAfterRestart.value.revision).toBeGreaterThan(queueBeforeRestart.value.revision);
    expect(queueAfterRestart.value.jobs).toEqual([jobBeforeRestart]);
    expect(queueAfterRestart.value.reruns).toEqual([]);
    const highWatermarkAfterRestart = queueAfterRestart.value.sourceHighWatermarks[0];
    expect(queueAfterRestart.value.sourceHighWatermarks).toEqual([
      {
        ...queueBeforeRestart.value.sourceHighWatermarks[0],
        inputRevision: 2,
        observedAt: highWatermarkAfterRestart.observedAt,
      },
    ]);
    expect(highWatermarkAfterRestart.observedAt).toBeGreaterThanOrEqual(
      queueBeforeRestart.value.sourceHighWatermarks[0].observedAt
    );
    const manifestAfterRestart = await new SourceManifestRepository(
      new KnowledgeRuntimeManifestStorage(runtime)
    ).load("personal");
    expect(manifestAfterRestart).toEqual(manifestBeforeRestart);
    expect(
      manifestAfterRestart.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toEqual(markerBeforeRestart);
    expect(fetchPort).toHaveBeenCalledTimes(1);

    secondComposer.close();
    secondAdmission.lifecycle.close();
  });

  it("probes and refreshes after a no-change commit acknowledgement is lost", async () => {
    const fetchStarted = createDeferred<void>();
    const refreshRequired = createDeferred<void>();
    const fetchPort = jest.fn<
      ReturnType<KnowledgeDeepSeekFetchPort>,
      Parameters<KnowledgeDeepSeekFetchPort>
    >(async () => {
      fetchStarted.resolve();
      return createNoChangesResponse();
    });
    const { lifecycle, admission } = await createAdmission(fetchPort);
    const file = new PostCommitThrowRuntimeFile();
    const runtime = await createRuntime(file);
    const vault = new ProductionVaultHarness();
    vault.addFile(SCHEMA_PATH, encodeText("# Schema\n"));
    vault.addFile(SOURCE_PATH, encodeText("# Source one\n"));
    const composer = new KnowledgeProductionObservationComposer({
      app: vault.createApp(),
      runtime,
      workflowLease: admission.workflowLease,
    });
    await composer.start(new AbortController().signal);
    const worker = composer.createCompileReviewWorkerController(
      admission.modelRouteLease,
      () => true,
      createWorkerScheduler(),
      () => refreshRequired.resolve()
    );

    file.arm();
    worker.start();
    await fetchStarted.promise;
    await refreshRequired.promise;

    const parsed = parseIngestQueueSnapshot(await runtime.readQueue("personal"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Expected the committed no-change Queue snapshot");
    expect(parsed.value.jobs[0]).toMatchObject({ status: "completed", stage: "completed" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    composer.close();
    await worker.whenSettled();
    lifecycle.close();
  });
});
