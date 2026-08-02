jest.mock("obsidian", () => {
  class TFile {
    /** Creates one mutable fake Vault file. */
    constructor(public path: string) {}
  }

  class TFolder {
    /** Creates one mutable fake Vault folder. */
    constructor(public path: string) {}
  }

  return { TFile, TFolder };
});

import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
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
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import { App, EventRef, TAbstractFile, TFile, Vault } from "obsidian";

const PROJECT_ID = "project-personal";
const MODEL_NAME = "deepseek-v4-pro";
const MODEL_KEY = `${MODEL_NAME}|deepseek`;
const SOURCE_PATH = "Sources/personal/研究.md";
const SCHEMA_PATH = "Schemas/personal.md";
const originalRandomUuidDescriptor = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
let captureSequence = 0;

type VaultEventName = "create" | "modify" | "delete" | "rename";
type VaultEventHandler = (file: TAbstractFile, oldPath?: string) => void;

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
  private nextRef = 0;

  readonly vault = {
    adapter: { readBinary: this.readBinary },
    getFiles: jest.fn(() => [...this.loadedFiles.values()]),
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
});
