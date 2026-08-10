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

import { App, EventRef, TAbstractFile, TFile, TFolder, Vault } from "obsidian";

import type {
  BindSourceInputObservationRequest,
  SourceInputRevisionAllocation,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  buildKnowledgeSourceWatchPlan,
  type KnowledgeBundlePipelineProfile,
  type KnowledgeSourceWatchPlan,
  type WatchedKnowledgeSource,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import {
  SourceObservationHandoff,
  type CommitSourceInputObservationResult,
} from "@/knowledge/ingest/SourceObservationHandoff";
import {
  ObsidianExactSourceArtifactReader,
  ObsidianVaultSourceWatcher,
  SourceArtifactAdapterPayloadError,
  SourceArtifactHashMismatchError,
  SourceArtifactUnavailableError,
  VaultSourceWatchPlanError,
  VaultSourceWatcherClosedError,
  type ExactSourceArtifact,
  type VaultSourceObservationHandoffPort,
  type VaultSourceWatcherNotification,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  createKnowledgeBundleConfigDigest,
  createPipelineFingerprint,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { GeneratedPageOwnership, KnowledgeBundleConfig } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeSourceObservationStartupCoordinator } from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";
import { KnowledgeSourceObservationStartupReconciler } from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";

const SCHEMA_BYTES = new TextEncoder().encode("# Test schema\r\n规则：精确字节\n");
const SCHEMA_HASH = createSourceContentHash(SCHEMA_BYTES);

/**
 * Creates one strict caller-projected test pipeline profile.
 *
 * @param bundleId - Owning Bundle identity
 * @param variant - Behavior variant expected by legacy watcher assertions
 * @returns Complete Bundle pipeline profile
 */
function createPipelineProfile(
  bundleId: string,
  variant: "a" | "b"
): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId,
    compiler: {
      version: `test-compiler-${variant}`,
      configuration: { maxContextPages: variant === "a" ? 20 : 30 },
    },
    parsers: [
      {
        id: `test-parser-${variant}`,
        version: "1",
        pathSuffixes: [".md", ".pdf"],
        configuration: { variant },
      },
    ],
    model: {
      provider: "test-provider",
      model: `test-model-${variant}`,
      configuration: { temperature: variant === "a" ? 0 : 1 },
    },
    outputLanguage: "test-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates the exact Bundle config shared by watcher test fixtures and hashes. */
function createTestBundle(bundleId: string): KnowledgeBundleConfig {
  return {
    version: 1,
    id: bundleId,
    sourceRoots: ["Sources"],
    wikiRoot: `Wiki/${bundleId}`,
    schemaRef: `Schemas/${bundleId}.md`,
    reviewMode: "always",
  };
}

/**
 * Computes the exact source fingerprint emitted by a test pipeline variant.
 *
 * @param bundleId - Exact Bundle identity and behavior boundary
 * @param variant - Pipeline behavior variant
 * @returns Lowercase pipeline fingerprint
 */
function createTestPipelineFingerprint(bundleId: string, variant: "a" | "b"): string {
  const profile = createPipelineProfile(bundleId, variant);
  const parser = profile.parsers[0];
  return createPipelineFingerprint({
    version: 1,
    contractVersion: 1,
    compilerVersion: profile.compiler.version,
    compilerConfiguration: profile.compiler.configuration,
    bundleConfigDigest: createKnowledgeBundleConfigDigest(createTestBundle(bundleId)),
    parser: {
      id: parser.id,
      version: parser.version,
      configuration: parser.configuration,
    },
    schemaHash: SCHEMA_HASH,
    model: profile.model,
    outputLanguage: profile.outputLanguage,
    okfVersion: profile.okfVersion,
    citationContractVersion: profile.citationContractVersion,
  });
}

const PIPELINE_A = createTestPipelineFingerprint("personal", "a");
const PIPELINE_B = createTestPipelineFingerprint("personal", "b");

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/**
 * Creates an externally controlled Promise for lifecycle interleaving tests.
 *
 * @returns Deferred Promise and settlement callbacks
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Flushes bounded Promise turns until a synchronous predicate becomes true.
 *
 * @param predicate - Completion predicate
 */
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for test condition");
}

/**
 * Creates a detached ArrayBuffer from exact byte values.
 *
 * @param bytes - Byte values to copy
 * @returns Detached binary payload
 */
function createBuffer(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/**
 * Encodes exact UTF-8 text into a detached ArrayBuffer.
 *
 * @param text - Text whose BOM and line endings remain significant
 * @returns Exact encoded bytes
 */
function encodeText(text: string): ArrayBuffer {
  return new Uint8Array(new TextEncoder().encode(text)).buffer;
}

/**
 * Creates a mutable fake TFile despite Obsidian's opaque public constructor.
 *
 * @param path - Vault-relative path
 * @returns Fake TFile
 */
function createFile(path: string): TFile {
  const FileConstructor = TFile as unknown as new (path: string) => TFile;
  return new FileConstructor(path);
}

/**
 * Creates a mutable fake TFolder despite Obsidian's opaque public constructor.
 *
 * @param path - Vault-relative path
 * @returns Fake TFolder
 */
function createFolder(path: string): TFolder {
  const FolderConstructor = TFolder as unknown as new (path: string) => TFolder;
  return new FolderConstructor(path);
}

/**
 * Creates one source specification consumed by the strict watch-plan fixture.
 *
 * @param patch - Fields to replace
 * @returns Complete watched source
 */
function createSource(patch: Partial<WatchedKnowledgeSource> = {}): WatchedKnowledgeSource {
  const sourcePath = patch.sourcePath ?? "Sources/研究.md";
  return {
    bundleId: "personal",
    sourceId: "source-1",
    sourcePath,
    sourceKey: toWindowsPathKey(sourcePath),
    pipelineFingerprint: PIPELINE_A,
    ...patch,
  };
}

/** One committed generated page owned by a watcher source fixture. */
interface GeneratedOutputFixture {
  bundleId?: string;
  sourceId: string;
  path: string;
  ownership: GeneratedPageOwnership;
  contentHash: string;
}

/**
 * Builds an opaque plan through the same strict authority boundary as production.
 *
 * Test sources use their expected fingerprint only to select a complete profile;
 * the builder independently recomputes every actual source fingerprint.
 *
 * @param sources - Durable source specifications grouped by Bundle
 * @param generatedOutputs - Successful Manifest pages used by the reverse index
 * @returns Strict immutable plan accepted by the watcher
 */
function createWatchPlan(
  sources: readonly WatchedKnowledgeSource[],
  generatedOutputs: readonly GeneratedOutputFixture[] = []
): KnowledgeSourceWatchPlan {
  const byBundle = new Map<string, WatchedKnowledgeSource[]>();
  for (const source of sources) {
    const matching = byBundle.get(source.bundleId);
    if (matching) {
      matching.push(source);
    } else {
      byBundle.set(source.bundleId, [source]);
    }
  }

  return buildKnowledgeSourceWatchPlan(
    [...byBundle.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([bundleId, bundleSources]) => {
        const fingerprints = new Set(bundleSources.map((source) => source.pipelineFingerprint));
        if (fingerprints.size !== 1) {
          throw new Error("A watcher test Bundle must use one pipeline fixture variant");
        }
        const fingerprint = bundleSources[0]?.pipelineFingerprint;
        const variant = fingerprint === PIPELINE_B ? "b" : "a";
        if (fingerprint !== PIPELINE_A && fingerprint !== PIPELINE_B) {
          throw new Error("Unknown watcher test pipeline fixture");
        }
        const bundle = createTestBundle(bundleId);
        return {
          bundle,
          manifest: {
            version: 1 as const,
            bundleId,
            revision: 0,
            entries: bundleSources.map((source) => {
              const pages = generatedOutputs
                .filter(
                  (output) =>
                    (output.bundleId ?? source.bundleId) === source.bundleId &&
                    output.sourceId === source.sourceId
                )
                .map((output) => ({
                  path: output.path,
                  ownership: output.ownership,
                  contentHash: output.contentHash,
                }));
              return {
                sourceId: source.sourceId,
                sourceKey: source.sourceKey,
                sourcePath: source.sourcePath,
                custody: "user_managed" as const,
                ...(pages.length > 0
                  ? {
                      lastSuccessful: {
                        sourceContentHash: "a".repeat(64),
                        pipelineFingerprint: source.pipelineFingerprint,
                        generatedPages: pages,
                        changeSetId: `changeset-${source.sourceId}`,
                        completedAt: 100,
                      },
                    }
                  : {}),
              };
            }),
          },
          schema: { path: bundle.schemaRef, bytes: SCHEMA_BYTES.slice() },
          pipeline: createPipelineProfile(bundleId, variant),
        };
      })
  );
}

/**
 * Builds one Bundle authority whose durable Manifest currently has no sources.
 *
 * @param bundleId - Empty Bundle identity
 * @returns Strict plan that still requires a Bundle handoff
 */
function createEmptyBundleWatchPlan(bundleId = "personal"): KnowledgeSourceWatchPlan {
  const bundle = createTestBundle(bundleId);
  return buildKnowledgeSourceWatchPlan([
    {
      bundle,
      manifest: { version: 1, bundleId, revision: 0, entries: [] },
      schema: { path: bundle.schemaRef, bytes: SCHEMA_BYTES.slice() },
      pipeline: createPipelineProfile(bundleId, "a"),
    },
  ]);
}

type VaultEventName = "create" | "modify" | "delete" | "rename";
type VaultEventHandler = (file: TAbstractFile, oldPath?: string) => void;

/** Minimal exact-Vault harness for event, lifecycle, and binary-read tests. */
class VaultHarness {
  readonly files = new Map<string, ArrayBuffer>();
  readonly loadedFiles = new Map<string, TFile>();
  readonly handlers = new Map<VaultEventName, Map<EventRef, VaultEventHandler>>();
  readonly readCalls: string[] = [];
  readonly order: string[] = [];
  readonly cachedRead = jest.fn();
  readonly read = jest.fn();
  readonly stat = jest.fn();
  readBinaryImplementation?: (path: string) => Promise<unknown>;
  failOnEventRegistration?: VaultEventName;
  private nextRef = 0;

  readonly adapter = {
    readBinary: jest.fn(async (path: string): Promise<ArrayBuffer> => {
      this.order.push(`read:${path}`);
      this.readCalls.push(path);
      if (this.readBinaryImplementation) {
        return (await this.readBinaryImplementation(path)) as ArrayBuffer;
      }
      const bytes = this.files.get(path);
      if (!bytes) throw new Error("missing fake bytes");
      return bytes.slice(0);
    }),
    stat: this.stat,
  };

  readonly vault = {
    adapter: this.adapter,
    cachedRead: this.cachedRead,
    read: this.read,
    getFiles: jest.fn(() => [...this.loadedFiles.values()]),
    getAbstractFileByPath: jest.fn((path: string) => this.loadedFiles.get(path) ?? null),
    on: jest.fn((name: VaultEventName, handler: VaultEventHandler) => {
      if (name === this.failOnEventRegistration) {
        throw new Error("fake event registration failure");
      }
      const ref = { id: ++this.nextRef } as unknown as EventRef;
      const eventHandlers = this.handlers.get(name) ?? new Map<EventRef, VaultEventHandler>();
      eventHandlers.set(ref, handler);
      this.handlers.set(name, eventHandlers);
      this.order.push(`listen:${name}`);
      return ref;
    }),
    offref: jest.fn((ref: EventRef) => {
      for (const eventHandlers of this.handlers.values()) {
        eventHandlers.delete(ref);
      }
    }),
  } as unknown as jest.Mocked<Vault>;

  /** Returns one minimal App bound to this exact Vault. */
  createApp(): App {
    return { vault: this.vault } as unknown as App;
  }

  /**
   * Adds one loaded fake file and exact bytes.
   *
   * @param path - Vault-relative path
   * @param bytes - Exact file bytes
   * @returns Mutable fake file
   */
  addFile(path: string, bytes: ArrayBuffer): TFile {
    const file = createFile(path);
    this.loadedFiles.set(path, file);
    this.files.set(path, bytes.slice(0));
    return file;
  }

  /**
   * Emits one Vault event through every active EventRef.
   *
   * @param name - Vault event name
   * @param file - File or folder event target
   * @param oldPath - Previous path for rename
   */
  trigger(name: VaultEventName, file: TAbstractFile, oldPath?: string): void {
    for (const handler of [...(this.handlers.get(name)?.values() ?? [])]) {
      handler(file, oldPath);
    }
  }
}

/** Recording durable hand-off with injectable allocation and commit behavior. */
class RecordingHandoff implements VaultSourceObservationHandoffPort {
  readonly allocateRequestReferences: {
    bundleId: string;
    sourceId: string;
    captureId: string;
  }[] = [];
  readonly allocateCalls: {
    bundleId: string;
    sourceId: string;
    captureId: string;
  }[] = [];
  readonly commitCalls: BindSourceInputObservationRequest[] = [];
  readonly allocationsByToken = new Map<string, SourceInputRevisionAllocation>();
  allocateImplementation?: (
    request: {
      bundleId: string;
      sourceId: string;
      captureId: string;
    },
    call: number
  ) => Promise<SourceInputRevisionAllocation>;
  commitImplementation?: (
    request: BindSourceInputObservationRequest,
    call: number
  ) => Promise<CommitSourceInputObservationResult>;
  private revision = 0;

  /** Creates a hand-off whose calls append to an optional global order. */
  constructor(private readonly order: string[] = []) {}

  /** Allocates one deterministic fake observation token. */
  async allocate(request: {
    bundleId: string;
    sourceId: string;
    captureId: string;
  }): Promise<SourceInputRevisionAllocation> {
    this.order.push(`allocate:${request.captureId}`);
    this.allocateRequestReferences.push(request);
    this.allocateCalls.push({ ...request });
    if (this.allocateImplementation) {
      const allocation = await this.allocateImplementation(request, this.allocateCalls.length);
      this.allocationsByToken.set(allocation.observationToken, allocation);
      return allocation;
    }
    const existing = [...this.allocationsByToken.values()].find(
      (allocation) => allocation.captureId === request.captureId
    );
    if (existing) return existing;
    const allocation: SourceInputRevisionAllocation = {
      ...request,
      inputRevision: ++this.revision,
      observationToken: `token-${request.captureId}`,
    };
    this.allocationsByToken.set(allocation.observationToken, allocation);
    return allocation;
  }

  /** Commits one deterministic fake durable settlement. */
  async commit(
    request: BindSourceInputObservationRequest
  ): Promise<CommitSourceInputObservationResult> {
    this.order.push(`commit:${request.observationToken}`);
    this.commitCalls.push({ ...request });
    if (this.commitImplementation) {
      return this.commitImplementation(request, this.commitCalls.length);
    }
    const allocation = this.allocationsByToken.get(request.observationToken);
    if (!allocation) throw new Error("unknown fake allocation");
    return {
      kind: "committed",
      observation: {
        ...allocation,
        sourceContentHash: request.sourceContentHash,
        pipelineFingerprint: request.pipelineFingerprint,
      },
      queueRevision: allocation.inputRevision,
    };
  }
}

/** Recording non-authoritative notification sink. */
class RecordingSink {
  readonly notifications: VaultSourceWatcherNotification[] = [];

  /** Records one detached watcher notification. */
  emit(notification: VaultSourceWatcherNotification): void {
    this.notifications.push({ ...notification });
  }
}

/** Serialized in-memory atomic runtime file used by the watcher/Queue integration test. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail = Promise.resolve();

  /** Initializes the file once without replacing existing bytes. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) {
      this.content = initialContent;
    }
  }

  /** Reads the exact current runtime text. */
  async read(): Promise<string> {
    if (this.content === undefined) {
      throw new Error("Runtime file is absent");
    }
    return this.content;
  }

  /** Serializes one deterministic full-file transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) {
        throw new Error("Runtime file is absent");
      }
      this.content = transform(this.content);
      return this.content;
    } finally {
      release();
    }
  }
}

describe("ObsidianExactSourceArtifactReader", () => {
  it("hashes exact binary bytes and returns the same verified bytes to a future parser", async () => {
    const harness = new VaultHarness();
    const bytes = encodeText("\ufeff标题\r\n正文 🦌\r\n");
    harness.addFile("Sources/研究.md", bytes);
    const reader = new ObsidianExactSourceArtifactReader(harness.createApp());
    const expectedHash = createSourceContentHash(bytes);

    await expect(reader.readExpected("Sources/研究.md", expectedHash)).resolves.toMatchObject({
      sourcePath: "Sources/研究.md",
      sourceContentHash: expectedHash,
    });
    const result = await reader.readExpected("Sources/研究.md", expectedHash);
    expect([...result.bytes]).toEqual([...new Uint8Array(bytes)]);
    expect(harness.adapter.readBinary).toHaveBeenCalledWith("Sources/研究.md");
    expect(harness.cachedRead).not.toHaveBeenCalled();
    expect(harness.read).not.toHaveBeenCalled();
    expect(harness.stat).not.toHaveBeenCalled();
  });

  it("rejects missing files, malformed adapter success, stale hashes, and cancellation", async () => {
    const harness = new VaultHarness();
    const file = harness.addFile("Sources/input.pdf", createBuffer(37, 80, 68, 70));
    const reader = new ObsidianExactSourceArtifactReader(harness.createApp());

    await expect(reader.read("Sources/missing.pdf")).rejects.toBeInstanceOf(
      SourceArtifactUnavailableError
    );

    harness.readBinaryImplementation = async () => "not-an-array-buffer";
    await expect(reader.read(file.path)).rejects.toBeInstanceOf(SourceArtifactAdapterPayloadError);

    harness.readBinaryImplementation = async () => ({
      byteLength: 4,
      [Symbol.toStringTag]: "ArrayBuffer",
    });
    await expect(reader.read(file.path)).rejects.toBeInstanceOf(SourceArtifactAdapterPayloadError);

    harness.readBinaryImplementation = async () => createBuffer(1, 2, 3);
    await expect(reader.readExpected(file.path, "f".repeat(64))).rejects.toBeInstanceOf(
      SourceArtifactHashMismatchError
    );

    const controller = new AbortController();
    controller.abort();
    await expect(reader.read(file.path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("stays bound to its exact App/Vault adapter", async () => {
    const first = new VaultHarness();
    const second = new VaultHarness();
    first.addFile("Sources/shared.md", createBuffer(1));
    second.addFile("Sources/shared.md", createBuffer(2));
    const firstApp = first.createApp();
    const secondApp = second.createApp();
    const reader = new ObsidianExactSourceArtifactReader(firstApp);

    const result = await reader.read("Sources/shared.md");

    expect([...result.bytes]).toEqual([1]);
    expect(reader.owns(firstApp)).toBe(true);
    expect(reader.owns(first.createApp())).toBe(false);
    expect(first.adapter.readBinary).toHaveBeenCalledTimes(1);
    expect(second.adapter.readBinary).not.toHaveBeenCalled();
    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          secondApp,
          createWatchPlan([createSource({ sourcePath: "Sources/shared.md" })]),
          new Map([["personal", new RecordingHandoff()]]),
          { artifactReader: reader }
        )
    ).toThrow(VaultSourceWatchPlanError);
  });
});

describe("ObsidianVaultSourceWatcher", () => {
  it("registers listeners before scanning and performs captureId → allocate → read → commit", async () => {
    const harness = new VaultHarness();
    const bytes = encodeText("\ufeff标题\r\n内容 🦌\r\n");
    harness.addFile("Sources/研究.md", bytes);
    const order = harness.order;
    const handoff = new RecordingHandoff(order);
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => {
          order.push("capture-id:capture-1");
          return "capture-1";
        },
        notificationSink: sink,
      }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(order).toEqual([
      "listen:create",
      "listen:modify",
      "listen:delete",
      "listen:rename",
      "capture-id:capture-1",
      "allocate:capture-1",
      "read:Sources/研究.md",
      "commit:token-capture-1",
    ]);
    expect(handoff.commitCalls).toEqual([
      {
        observationToken: "token-capture-1",
        sourceContentHash: createSourceContentHash(bytes),
        pipelineFingerprint: PIPELINE_A,
      },
    ]);
    expect(sink.notifications).toContainEqual({
      kind: "capture_settled",
      cause: "initial_scan",
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "capture-1",
      inputRevision: 1,
      settlement: "committed",
    });
  });

  it("can establish listener ownership before an explicit production crawl", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", encodeText("source"));
    const handoff = new RecordingHandoff(harness.order);
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "split-start-capture" }
    );

    watcher.startListening();

    expect(harness.order).toEqual([
      "listen:create",
      "listen:modify",
      "listen:delete",
      "listen:rename",
    ]);
    expect(handoff.allocateCalls).toHaveLength(0);
    expect(watcher.scan()).toBe(1);
    await watcher.waitForIdle();
    expect(handoff.allocateCalls).toEqual([
      {
        bundleId: "personal",
        sourceId: "source-1",
        captureId: "split-start-capture",
      },
    ]);
  });

  it("turns every generated-output lifecycle event into one original-source observation", async () => {
    const harness = new VaultHarness();
    const sourcePath = "Sources/研究.md";
    const outputPath = "Wiki/personal/Page.md";
    harness.addFile(sourcePath, encodeText("authoritative source"));
    const output = harness.addFile(outputPath, encodeText("generated output"));
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan(
        [createSource()],
        [
          {
            sourceId: "source-1",
            path: outputPath,
            ownership: "generated",
            contentHash: "c".repeat(64),
          },
        ]
      ),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => `output-lifecycle-${++captureSequence}`,
        notificationSink: sink,
      }
    );
    watcher.startListening();

    harness.trigger("create", output);
    await watcher.waitForIdle();
    harness.trigger("modify", output);
    await watcher.waitForIdle();
    harness.loadedFiles.delete(outputPath);
    harness.files.delete(outputPath);
    harness.trigger("delete", output);
    await watcher.waitForIdle();
    const renamed = harness.addFile("Wiki/personal/Renamed.md", encodeText("renamed output"));
    harness.trigger("rename", renamed, outputPath);
    await watcher.waitForIdle();

    expect(harness.readCalls).toEqual([sourcePath, sourcePath, sourcePath, sourcePath]);
    expect(harness.readCalls).not.toContain(outputPath);
    expect(handoff.allocateCalls.map((call) => call.sourceId)).toEqual([
      "source-1",
      "source-1",
      "source-1",
      "source-1",
    ]);
    expect(handoff.commitCalls).toHaveLength(4);
    expect(
      sink.notifications
        .filter((notification) => notification.kind === "capture_settled")
        .map((notification) => notification.cause)
    ).toEqual([
      "generated_output_create",
      "generated_output_modify",
      "generated_output_delete",
      "generated_output_rename",
    ]);
  });

  it("re-observes every shared-page owner and ignores unrelated Wiki events", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/A.md", encodeText("source a"));
    harness.addFile("Sources/B.md", encodeText("source b"));
    const sharedPath = "Wiki/personal/Shared.md";
    const shared = harness.addFile(sharedPath, encodeText("shared output"));
    const unrelated = harness.addFile("Wiki/personal/Unrelated.md", encodeText("unrelated"));
    const sources = [
      createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" }),
      createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
    ];
    const sharedHash = "d".repeat(64);
    const outputs: GeneratedOutputFixture[] = sources.map((source) => ({
      sourceId: source.sourceId,
      path: sharedPath,
      ownership: "shared",
      contentHash: sharedHash,
    }));
    const handoff = new RecordingHandoff();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan(sources, outputs),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => `shared-output-${++captureSequence}` }
    );
    watcher.startListening();

    harness.trigger("modify", shared);
    await watcher.waitForIdle();
    harness.trigger("modify", unrelated);
    await watcher.waitForIdle();

    expect(handoff.allocateCalls.map((call) => call.sourceId)).toEqual(["source-a", "source-b"]);
    expect(harness.readCalls).toEqual(["Sources/A.md", "Sources/B.md"]);
    expect(handoff.commitCalls).toHaveLength(2);
  });

  it("deduplicates one folder-output event to one observation per source", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", encodeText("source"));
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan(
        [createSource()],
        [
          {
            sourceId: "source-1",
            path: "Wiki/personal/A.md",
            ownership: "generated",
            contentHash: "e".repeat(64),
          },
          {
            sourceId: "source-1",
            path: "Wiki/personal/B.md",
            ownership: "generated",
            contentHash: "f".repeat(64),
          },
        ]
      ),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "folder-output-capture" }
    );
    watcher.startListening();

    harness.trigger("delete", createFolder("Wiki/personal"));
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(harness.readCalls).toEqual(["Sources/研究.md"]);
    expect(handoff.commitCalls).toHaveLength(1);
  });

  it("fails closed on generated-output case aliases and live Windows collisions", async () => {
    const outputPath = "Wiki/personal/Page.md";
    const createPlan = () =>
      createWatchPlan(
        [createSource()],
        [
          {
            sourceId: "source-1",
            path: outputPath,
            ownership: "generated",
            contentHash: "c".repeat(64),
          },
        ]
      );

    const caseHarness = new VaultHarness();
    caseHarness.addFile("Sources/研究.md", encodeText("source"));
    const caseAlias = caseHarness.addFile("wiki/personal/page.md", encodeText("alias"));
    const caseHandoff = new RecordingHandoff();
    const caseWatcher = new ObsidianVaultSourceWatcher(
      caseHarness.createApp(),
      createPlan(),
      new Map([["personal", caseHandoff]])
    );
    caseWatcher.startListening();
    caseHarness.trigger("modify", caseAlias);
    await caseWatcher.waitForIdle();

    expect(caseHandoff.allocateCalls).toHaveLength(0);
    expect(caseHarness.readCalls).toEqual([]);
    expect(caseWatcher.getStartupBlockers()).toEqual([
      {
        kind: "source_path_invalid",
        reason: "case_mismatch",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);

    const collisionHarness = new VaultHarness();
    collisionHarness.addFile("Sources/研究.md", encodeText("source"));
    const canonical = collisionHarness.addFile(outputPath, encodeText("canonical"));
    collisionHarness.addFile("wiki/personal/page.md", encodeText("alias"));
    const collisionHandoff = new RecordingHandoff();
    const collisionWatcher = new ObsidianVaultSourceWatcher(
      collisionHarness.createApp(),
      createPlan(),
      new Map([["personal", collisionHandoff]])
    );
    collisionWatcher.startListening();
    collisionHarness.trigger("modify", canonical);
    await collisionWatcher.waitForIdle();

    expect(collisionHandoff.allocateCalls).toHaveLength(0);
    expect(collisionHarness.readCalls).toEqual([]);
    expect(collisionWatcher.getStartupBlockers()).toEqual([
      {
        kind: "source_path_invalid",
        reason: "windows_collision",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("quarantines a loaded generated-output alias before the startup source crawl", () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", encodeText("source"));
    harness.addFile("wiki/personal/page.md", encodeText("case alias"));
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan(
        [createSource()],
        [
          {
            sourceId: "source-1",
            path: "Wiki/personal/Page.md",
            ownership: "generated",
            contentHash: "c".repeat(64),
          },
        ]
      ),
      new Map([["personal", handoff]])
    );

    watcher.start();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(harness.readCalls).toEqual([]);
    expect(watcher.getStartupBlockers()).toEqual([
      {
        kind: "source_path_invalid",
        reason: "case_mismatch",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("invalidates output-triggered work when its watch-plan generation changes", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", encodeText("source"));
    const outputPath = "Wiki/personal/Page.md";
    const output = harness.addFile(outputPath, encodeText("output"));
    const allocation = createDeferred<SourceInputRevisionAllocation>();
    const handoff = new RecordingHandoff();
    handoff.allocateImplementation = async () => allocation.promise;
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan(
        [createSource()],
        [
          {
            sourceId: "source-1",
            path: outputPath,
            ownership: "generated",
            contentHash: "c".repeat(64),
          },
        ]
      ),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => "obsolete-output-capture",
        notificationSink: sink,
      }
    );
    watcher.startListening();

    harness.trigger("modify", output);
    await waitUntil(() => handoff.allocateCalls.length === 1);
    watcher.replaceWatchPlan(createWatchPlan([createSource()]));
    allocation.resolve({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "obsolete-output-capture",
      inputRevision: 1,
      observationToken: "obsolete-output-token",
    });
    await watcher.waitForIdle();

    expect(harness.readCalls).toEqual([]);
    expect(handoff.commitCalls).toEqual([]);
    expect(sink.notifications).toEqual([]);
  });

  it("keeps start idempotent after the initial crawl has been activated", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", encodeText("source"));
    const handoff = new RecordingHandoff();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => `idempotent-start-${++captureSequence}` }
    );

    watcher.start();
    await watcher.waitForIdle();
    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(handoff.commitCalls).toHaveLength(1);
    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(1);
    }
  });

  it("does not crawl a replacement plan during the listener-only startup phase", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/B.md", encodeText("replacement"));
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" })]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "replacement-before-crawl" }
    );

    watcher.startListening();
    watcher.replaceWatchPlan(
      createWatchPlan([createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" })])
    );

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(watcher.getStartupBlockers()).toEqual([]);
    expect(watcher.scan()).toBe(1);
    await watcher.waitForIdle();
    expect(handoff.allocateCalls).toEqual([
      {
        bundleId: "personal",
        sourceId: "source-b",
        captureId: "replacement-before-crawl",
      },
    ]);
  });

  it("crawls a replacement plan installed reentrantly while Vault files are loaded", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/A.md", encodeText("obsolete"));
    harness.addFile("Sources/B.md", encodeText("current"));
    const handoff = new RecordingHandoff();
    const replacementPlan = createWatchPlan([
      createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
    ]);
    let captureSequence = 0;
    let getFilesCalls = 0;
    let watcher!: ObsidianVaultSourceWatcher;
    watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" })]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => `reentrant-crawl-${++captureSequence}` }
    );
    harness.vault.getFiles.mockImplementation(() => {
      getFilesCalls += 1;
      if (getFilesCalls === 1) {
        watcher.replaceWatchPlan(replacementPlan);
      }
      return [...harness.loadedFiles.values()];
    });

    watcher.start();
    await watcher.waitForIdle();
    watcher.start();

    expect(harness.vault.getFiles).toHaveBeenCalledTimes(2);
    expect(handoff.allocateCalls).toEqual([
      {
        bundleId: "personal",
        sourceId: "source-b",
        captureId: "reentrant-crawl-1",
      },
    ]);
    expect(handoff.commitCalls).toHaveLength(1);
    expect(watcher.getStartupBlockers()).toEqual([]);
  });

  it("copies injected exact bytes without calling an instance-level slice override", async () => {
    const harness = new VaultHarness();
    const app = harness.createApp();
    harness.addFile("Sources/研究.md", createBuffer(1, 2, 3));
    const bytes = new Uint8Array([1, 2, 3]);
    let sliceCalls = 0;
    Object.defineProperty(bytes, "slice", {
      value: () => {
        sliceCalls += 1;
        return new Uint8Array([9]);
      },
    });
    const reader = new ObsidianExactSourceArtifactReader(app);
    jest.spyOn(reader, "read").mockResolvedValue({
      sourcePath: "Sources/研究.md",
      bytes,
      sourceContentHash: createSourceContentHash(new Uint8Array([1, 2, 3])),
    });
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      app,
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        artifactReader: reader,
        captureIdFactory: () => "overridden-slice",
      }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(sliceCalls).toBe(0);
    expect(handoff.commitCalls[0]?.sourceContentHash).toBe(
      createSourceContentHash(new Uint8Array([1, 2, 3]))
    );
  });

  it("observes one physical path independently per Bundle", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/shared.pdf", createBuffer(37, 80, 68, 70, 10));
    const first = new RecordingHandoff();
    const second = new RecordingHandoff();
    const captureIds = ["capture-a", "capture-b"];
    const personal = createSource({
      sourcePath: "Sources/shared.pdf",
      sourceId: "personal-source",
    });
    const work = createSource({
      bundleId: "work",
      sourceId: "work-source",
      sourcePath: "Sources/shared.pdf",
      pipelineFingerprint: PIPELINE_B,
    });
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([personal, work]),
      new Map([
        ["personal", first],
        ["work", second],
      ]),
      { captureIdFactory: () => captureIds.shift()! }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(first.allocateCalls).toHaveLength(1);
    expect(second.allocateCalls).toHaveLength(1);
    expect(first.allocateCalls[0]?.captureId).not.toBe(second.allocateCalls[0]?.captureId);
    expect(first.commitCalls[0]?.pipelineFingerprint).toBe(PIPELINE_A);
    expect(second.commitCalls[0]?.pipelineFingerprint).toBe(
      createTestPipelineFingerprint("work", "b")
    );
    expect(harness.adapter.readBinary).toHaveBeenCalledTimes(2);
  });

  it("does not let a reentrant capture-id factory bless an obsolete watch plan", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    let replaced = false;
    let watcher: ObsidianVaultSourceWatcher;
    watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => {
          if (!replaced) {
            replaced = true;
            watcher.replaceWatchPlan(createWatchPlan([]));
          }
          return "obsolete-plan-capture";
        },
      }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(harness.adapter.readBinary).not.toHaveBeenCalled();
    expect(handoff.commitCalls).toHaveLength(0);
  });

  it("invalidates an entire same-path multi-Bundle batch during reentrant replacement", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/shared.md", createBuffer(1));
    const personalHandoff = new RecordingHandoff();
    const workHandoff = new RecordingHandoff();
    let captureFactoryCalls = 0;
    let watcher: ObsidianVaultSourceWatcher;
    watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([
        createSource({ sourceId: "personal-source", sourcePath: "Sources/shared.md" }),
        createSource({
          bundleId: "work",
          sourceId: "work-source",
          sourcePath: "Sources/shared.md",
          pipelineFingerprint: PIPELINE_B,
        }),
      ]),
      new Map([
        ["personal", personalHandoff],
        ["work", workHandoff],
      ]),
      {
        captureIdFactory: () => {
          captureFactoryCalls += 1;
          watcher.replaceWatchPlan(createWatchPlan([]));
          return "obsolete-multi-bundle-capture";
        },
      }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(captureFactoryCalls).toBe(1);
    expect(personalHandoff.allocateCalls).toHaveLength(0);
    expect(workHandoff.allocateCalls).toHaveLength(0);
    expect(harness.adapter.readBinary).not.toHaveBeenCalled();
    expect(personalHandoff.commitCalls).toHaveLength(0);
    expect(workHandoff.commitCalls).toHaveLength(0);
  });

  it("retries uncertain allocation and commit with the same capture, token, hash, and pipeline", async () => {
    const harness = new VaultHarness();
    const bytes = createBuffer(0, 1, 2, 3, 255);
    harness.addFile("Sources/研究.md", bytes);
    const handoff = new RecordingHandoff();
    let durableAllocation: SourceInputRevisionAllocation | undefined;
    handoff.allocateImplementation = async (request, call) => {
      durableAllocation ??= {
        ...request,
        inputRevision: 7,
        observationToken: "durable-token",
      };
      handoff.allocationsByToken.set(durableAllocation.observationToken, durableAllocation);
      if (call === 1) throw new Error("commit then throw");
      return durableAllocation;
    };
    handoff.commitImplementation = async (request, call) => {
      if (call === 1) throw new Error("acknowledgement lost");
      return {
        kind: "committed",
        observation: {
          ...durableAllocation!,
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
        },
        queueRevision: 9,
      };
    };
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "stable-capture" }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls.map(({ captureId }) => captureId)).toEqual([
      "stable-capture",
      "stable-capture",
    ]);
    expect(handoff.allocateRequestReferences[1]).toBe(handoff.allocateRequestReferences[0]);
    expect(Object.isFrozen(handoff.allocateRequestReferences[0])).toBe(true);
    expect(handoff.commitCalls).toHaveLength(2);
    expect(handoff.commitCalls[1]).toEqual(handoff.commitCalls[0]);
    expect(handoff.commitCalls[0]).toEqual({
      observationToken: "durable-token",
      sourceContentHash: createSourceContentHash(bytes),
      pipelineFingerprint: PIPELINE_A,
    });
  });

  it("leaves an allocated capture uncommitted when every exact-byte read fails", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", createBuffer(1));
    harness.readBinaryImplementation = async () => {
      throw new Error("file temporarily locked");
    };
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => "read-failure",
        notificationSink: sink,
        maxReadAttempts: 2,
      }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(harness.adapter.readBinary).toHaveBeenCalledTimes(2);
    expect(handoff.commitCalls).toHaveLength(0);
    expect(sink.notifications).toContainEqual({
      kind: "capture_failed",
      cause: "initial_scan",
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "read-failure",
      stage: "read",
    });
    expect(watcher.getStartupBlockers()).toEqual([
      {
        kind: "capture_failed",
        stage: "read",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("blocks readiness when capture preparation cannot issue a valid identity", () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "" }
    );

    watcher.start();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(watcher.getStartupBlockers()).toEqual([
      {
        kind: "capture_failed",
        stage: "prepare",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("captures the event path synchronously even if Obsidian mutates TFile.path during allocate", async () => {
    const harness = new VaultHarness();
    const originalPath = "Sources/研究.md";
    const file = harness.addFile(originalPath, createBuffer(1, 2, 3));
    const allocation = createDeferred<SourceInputRevisionAllocation>();
    const handoff = new RecordingHandoff();
    handoff.allocateImplementation = async () => allocation.promise;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "captured-before-await" }
    );

    watcher.start();
    await waitUntil(() => handoff.allocateCalls.length === 1);
    expect(harness.adapter.readBinary).not.toHaveBeenCalled();
    expect(handoff.commitCalls).toHaveLength(0);
    (file as { path: string }).path = "Sources/Renamed.md";
    allocation.resolve({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "captured-before-await",
      inputRevision: 1,
      observationToken: "captured-token",
    });
    await watcher.waitForIdle();

    expect(harness.readCalls).toEqual([originalPath]);
    expect(handoff.commitCalls).toHaveLength(1);
  });

  it("prevents old lifecycle and old watch-plan continuations from reading or committing", async () => {
    const lifecycleHarness = new VaultHarness();
    lifecycleHarness.addFile("Sources/研究.md", createBuffer(1));
    const lifecycleAllocation = createDeferred<SourceInputRevisionAllocation>();
    const lifecycleHandoff = new RecordingHandoff();
    lifecycleHandoff.allocateImplementation = async () => lifecycleAllocation.promise;
    const lifecycleSink = new RecordingSink();
    const oldWatcher = new ObsidianVaultSourceWatcher(
      lifecycleHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", lifecycleHandoff]]),
      {
        captureIdFactory: () => "old-lifecycle",
        notificationSink: lifecycleSink,
      }
    );
    oldWatcher.start();
    await Promise.resolve();
    oldWatcher.close();
    lifecycleAllocation.resolve({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "old-lifecycle",
      inputRevision: 1,
      observationToken: "old-token",
    });
    await oldWatcher.waitForIdle();

    expect(lifecycleHarness.adapter.readBinary).not.toHaveBeenCalled();
    expect(lifecycleHandoff.commitCalls).toHaveLength(0);
    expect(lifecycleSink.notifications).toHaveLength(0);
    expect(lifecycleHarness.vault.offref).toHaveBeenCalledTimes(4);
    expect(() => oldWatcher.replaceWatchPlan(createWatchPlan([]))).toThrow(
      VaultSourceWatcherClosedError
    );

    const planHarness = new VaultHarness();
    planHarness.addFile("Sources/A.md", createBuffer(1));
    planHarness.addFile("Sources/C.md", createBuffer(3));
    const planAllocation = createDeferred<SourceInputRevisionAllocation>();
    const planHandoff = new RecordingHandoff();
    planHandoff.allocateImplementation = async (request) => {
      if (request.sourceId === "source-a") return planAllocation.promise;
      return {
        ...request,
        inputRevision: 2,
        observationToken: "current-token",
      };
    };
    const ids = ["capture-a", "capture-c"];
    const planWatcher = new ObsidianVaultSourceWatcher(
      planHarness.createApp(),
      createWatchPlan([createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" })]),
      new Map([["personal", planHandoff]]),
      { captureIdFactory: () => ids.shift()! }
    );
    planWatcher.start();
    await Promise.resolve();
    planWatcher.replaceWatchPlan(
      createWatchPlan([createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" })])
    );
    planWatcher.replaceWatchPlan(
      createWatchPlan([createSource({ sourceId: "source-c", sourcePath: "Sources/C.md" })])
    );
    planAllocation.resolve({
      bundleId: "personal",
      sourceId: "source-a",
      captureId: "capture-a",
      inputRevision: 1,
      observationToken: "stale-token",
    });
    await planWatcher.waitForIdle();

    expect(planHarness.readCalls).toEqual(["Sources/C.md"]);
    expect(planHandoff.commitCalls).toEqual([
      {
        observationToken: "current-token",
        sourceContentHash: createSourceContentHash(createBuffer(3)),
        pipelineFingerprint: PIPELINE_A,
      },
    ]);
  });

  it("suppresses stale read and commit continuations after close or plan replacement", async () => {
    const readHarness = new VaultHarness();
    const readBytes = createBuffer(1, 2, 3);
    readHarness.addFile("Sources/研究.md", readBytes);
    const deferredRead = createDeferred<unknown>();
    readHarness.readBinaryImplementation = async () => deferredRead.promise;
    const readHandoff = new RecordingHandoff();
    const readSink = new RecordingSink();
    const readWatcher = new ObsidianVaultSourceWatcher(
      readHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", readHandoff]]),
      {
        captureIdFactory: () => "read-in-flight",
        notificationSink: readSink,
      }
    );

    readWatcher.start();
    await waitUntil(() => readHarness.readCalls.length === 1);
    readWatcher.close();
    deferredRead.resolve(readBytes);
    await readWatcher.waitForIdle();

    expect(readHandoff.commitCalls).toHaveLength(0);
    expect(readSink.notifications).toHaveLength(0);

    const commitHarness = new VaultHarness();
    commitHarness.addFile("Sources/研究.md", createBuffer(4, 5, 6));
    const deferredCommit = createDeferred<CommitSourceInputObservationResult>();
    const commitHandoff = new RecordingHandoff();
    commitHandoff.commitImplementation = async () => deferredCommit.promise;
    const commitSink = new RecordingSink();
    const commitWatcher = new ObsidianVaultSourceWatcher(
      commitHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", commitHandoff]]),
      {
        captureIdFactory: () => "commit-in-flight",
        notificationSink: commitSink,
      }
    );

    commitWatcher.start();
    await waitUntil(() => commitHandoff.commitCalls.length === 1);
    const committedAllocation = [...commitHandoff.allocationsByToken.values()][0];
    const committedRequest = commitHandoff.commitCalls[0];
    if (!committedAllocation || !committedRequest) {
      throw new Error("Expected one in-flight durable commit fixture");
    }
    commitWatcher.replaceWatchPlan(createWatchPlan([]));
    deferredCommit.resolve({
      kind: "committed",
      observation: {
        ...committedAllocation,
        sourceContentHash: committedRequest.sourceContentHash,
        pipelineFingerprint: committedRequest.pipelineFingerprint,
      },
      queueRevision: 1,
    });
    await commitWatcher.waitForIdle();

    expect(commitHandoff.commitCalls).toHaveLength(1);
    expect(commitSink.notifications).toHaveLength(0);
  });

  it("quarantines destructive folder changes until an explicit plan replacement", async () => {
    const harness = new VaultHarness();
    const oldBytes = createBuffer(1);
    const newBytes = createBuffer(2);
    harness.addFile("Sources/研究.md", oldBytes);
    const deferredRead = createDeferred<unknown>();
    harness.readBinaryImplementation = async () => deferredRead.promise;
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => `capture-${++captureSequence}`,
        notificationSink: sink,
      }
    );

    watcher.start();
    await waitUntil(() => harness.readCalls.length === 1);
    harness.trigger("delete", createFolder("Sources"));
    const recreated = harness.addFile("Sources/研究.md", newBytes);
    harness.trigger("create", recreated);
    deferredRead.resolve(oldBytes);
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(harness.readCalls).toEqual(["Sources/研究.md"]);
    expect(handoff.commitCalls).toHaveLength(0);
    expect(sink.notifications).toContainEqual({
      kind: "source_change_unsupported",
      change: "delete",
      bundleId: "personal",
      sourceId: "source-1",
    });
    expect(watcher.getStartupBlockers()).toContainEqual({
      kind: "source_change_unsupported",
      change: "delete",
      bundleId: "personal",
      sourceId: "source-1",
    });

    harness.readBinaryImplementation = undefined;
    watcher.replaceWatchPlan(createWatchPlan([createSource()]));
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(2);
    expect(harness.readCalls).toEqual(["Sources/研究.md", "Sources/研究.md"]);
    expect(handoff.commitCalls).toHaveLength(1);
    expect(handoff.commitCalls[0]?.sourceContentHash).toBe(createSourceContentHash(newBytes));
  });

  it("keeps unrelated in-flight source authority when another source is quarantined", async () => {
    const harness = new VaultHarness();
    const firstBytes = createBuffer(1);
    const secondBytes = createBuffer(2);
    const firstFile = harness.addFile("Sources/A.md", firstBytes);
    harness.addFile("Sources/B.md", secondBytes);
    const firstRead = createDeferred<unknown>();
    const secondRead = createDeferred<unknown>();
    harness.readBinaryImplementation = async (path) =>
      path === "Sources/A.md" ? firstRead.promise : secondRead.promise;
    const handoff = new RecordingHandoff();
    const captureIds = ["capture-a", "capture-b"];
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([
        createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" }),
        createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
      ]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => captureIds.shift()! }
    );

    watcher.start();
    await waitUntil(() => harness.readCalls.length === 2);
    harness.trigger("delete", firstFile);
    firstRead.resolve(firstBytes);
    secondRead.resolve(secondBytes);
    await watcher.waitForIdle();

    expect(handoff.commitCalls).toEqual([
      {
        observationToken: "token-capture-b",
        sourceContentHash: createSourceContentHash(secondBytes),
        pipelineFingerprint: PIPELINE_A,
      },
    ]);
  });

  it("blocks rename-to-old-path ABA captures until source identity is revalidated", async () => {
    const harness = new VaultHarness();
    const oldPath = "Sources/研究.md";
    const renamedPath = "Sources/已移动.md";
    const file = harness.addFile(oldPath, createBuffer(1));
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => `rename-capture-${++captureSequence}`,
        notificationSink: sink,
      }
    );
    watcher.start();
    await watcher.waitForIdle();
    handoff.allocateCalls.length = 0;
    handoff.commitCalls.length = 0;
    harness.adapter.readBinary.mockClear();
    harness.readCalls.length = 0;
    sink.notifications.length = 0;

    harness.loadedFiles.delete(oldPath);
    harness.files.delete(oldPath);
    (file as { path: string }).path = renamedPath;
    harness.loadedFiles.set(renamedPath, file);
    harness.files.set(renamedPath, createBuffer(1));
    harness.trigger("rename", file, oldPath);
    const replacement = harness.addFile(oldPath, createBuffer(9));
    harness.trigger("create", replacement);
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(handoff.commitCalls).toHaveLength(0);
    expect(harness.adapter.readBinary).not.toHaveBeenCalled();
    expect(sink.notifications).toEqual([
      {
        kind: "source_change_unsupported",
        change: "rename",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("keeps old cleanup from removing a replacement watcher's EventRefs", () => {
    const harness = new VaultHarness();
    const first = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([]),
      new Map(),
      {
        captureIdFactory: () => "unused-first",
      }
    );
    const second = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([]),
      new Map(),
      {
        captureIdFactory: () => "unused-second",
      }
    );
    first.start();
    second.start();

    first.close();

    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(1);
    }
    expect(second.owns(harness.createApp())).toBe(false);
    const exactApp = { vault: harness.vault } as unknown as App;
    const owned = new ObsidianVaultSourceWatcher(exactApp, createWatchPlan([]), new Map());
    expect(owned.owns(exactApp)).toBe(true);
  });

  it("releases partial EventRefs when listener registration fails and permits a clean retry", () => {
    const harness = new VaultHarness();
    harness.failOnEventRegistration = "delete";
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([]),
      new Map()
    );

    expect(() => watcher.start()).toThrow("fake event registration failure");
    expect(harness.vault.offref).toHaveBeenCalledTimes(2);
    expect(harness.handlers.get("create")?.size).toBe(0);
    expect(harness.handlers.get("modify")?.size).toBe(0);

    harness.failOnEventRegistration = undefined;
    expect(() => watcher.start()).not.toThrow();
    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(1);
    }
  });

  it("rolls back listener ownership when the initial Vault crawl throws", () => {
    const harness = new VaultHarness();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([]),
      new Map()
    );
    harness.vault.getFiles.mockImplementationOnce(() => {
      throw new Error("fake crawl failure");
    });

    expect(() => watcher.start()).toThrow("fake crawl failure");
    expect(harness.vault.offref).toHaveBeenCalledTimes(4);
    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(0);
    }

    expect(() => watcher.start()).not.toThrow();
    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(1);
    }
  });

  it("reports rename/delete/folder changes without allocating, reading, or committing", async () => {
    const harness = new VaultHarness();
    const file = harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => "should-not-be-used",
        notificationSink: sink,
      }
    );
    watcher.start();
    await watcher.waitForIdle();
    handoff.allocateCalls.length = 0;
    handoff.commitCalls.length = 0;
    harness.adapter.readBinary.mockClear();
    sink.notifications.length = 0;

    harness.trigger("delete", file);
    harness.trigger("rename", file, "Sources/研究.md");
    harness.trigger("delete", createFolder("Sources"));
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(handoff.commitCalls).toHaveLength(0);
    expect(harness.adapter.readBinary).not.toHaveBeenCalled();
    expect(sink.notifications).toEqual([
      {
        kind: "source_change_unsupported",
        change: "delete",
        bundleId: "personal",
        sourceId: "source-1",
      },
      {
        kind: "source_change_unsupported",
        change: "rename",
        bundleId: "personal",
        sourceId: "source-1",
      },
      {
        kind: "source_change_unsupported",
        change: "delete",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("rejects mismatched reader, allocation, and settlement success payloads", async () => {
    const readerHarness = new VaultHarness();
    const readerApp = readerHarness.createApp();
    readerHarness.addFile("Sources/研究.md", createBuffer(1));
    const lyingReader = new ObsidianExactSourceArtifactReader(readerApp);
    jest.spyOn(lyingReader, "read").mockResolvedValue({
      sourcePath: "Sources/研究.md",
      bytes: Uint8Array.from([1]),
      sourceContentHash: createSourceContentHash(createBuffer(2)),
    });
    const readerHandoff = new RecordingHandoff();
    const readerSink = new RecordingSink();
    const readerWatcher = new ObsidianVaultSourceWatcher(
      readerApp,
      createWatchPlan([createSource()]),
      new Map([["personal", readerHandoff]]),
      {
        artifactReader: lyingReader,
        captureIdFactory: () => "lying-reader",
        notificationSink: readerSink,
      }
    );
    readerWatcher.start();
    await readerWatcher.waitForIdle();

    expect(readerHandoff.commitCalls).toHaveLength(0);
    expect(lyingReader.read).toHaveBeenCalledTimes(1);
    expect(readerSink.notifications).toContainEqual({
      kind: "capture_failed",
      cause: "initial_scan",
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "lying-reader",
      stage: "read",
    });

    const allocationHarness = new VaultHarness();
    allocationHarness.addFile("Sources/研究.md", createBuffer(3));
    const allocationHandoff = new RecordingHandoff();
    allocationHandoff.allocateImplementation = async (request) => ({
      ...request,
      sourceId: "foreign-source",
      inputRevision: 1,
      observationToken: "foreign-allocation",
    });
    const allocationSink = new RecordingSink();
    const allocationWatcher = new ObsidianVaultSourceWatcher(
      allocationHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", allocationHandoff]]),
      {
        captureIdFactory: () => "lying-allocation",
        notificationSink: allocationSink,
      }
    );
    allocationWatcher.start();
    await allocationWatcher.waitForIdle();

    expect(allocationHarness.adapter.readBinary).not.toHaveBeenCalled();
    expect(allocationHandoff.allocateCalls).toHaveLength(1);
    expect(allocationSink.notifications).toContainEqual({
      kind: "capture_failed",
      cause: "initial_scan",
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "lying-allocation",
      stage: "allocate",
    });

    const settlementHarness = new VaultHarness();
    settlementHarness.addFile("Sources/研究.md", createBuffer(4));
    const settlementHandoff = new RecordingHandoff();
    settlementHandoff.commitImplementation = async (request) => {
      const allocation = [...settlementHandoff.allocationsByToken.values()][0];
      return {
        kind: "committed",
        observation: {
          ...allocation,
          sourceId: "foreign-source",
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
        },
        queueRevision: 1,
      };
    };
    const settlementSink = new RecordingSink();
    const settlementWatcher = new ObsidianVaultSourceWatcher(
      settlementHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", settlementHandoff]]),
      {
        captureIdFactory: () => "lying-settlement",
        notificationSink: settlementSink,
      }
    );
    settlementWatcher.start();
    await settlementWatcher.waitForIdle();

    expect(settlementHandoff.commitCalls).toHaveLength(1);
    expect(settlementSink.notifications).toContainEqual({
      kind: "capture_failed",
      cause: "initial_scan",
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "lying-settlement",
      stage: "commit",
    });
    expect(settlementSink.notifications).not.toContainEqual(
      expect.objectContaining({ kind: "capture_settled" })
    );
  });

  it("rejects accessor-backed success payloads without invoking their getters", async () => {
    const readerHarness = new VaultHarness();
    const readerApp = readerHarness.createApp();
    readerHarness.addFile("Sources/研究.md", createBuffer(1));
    const accessorReader = new ObsidianExactSourceArtifactReader(readerApp);
    let artifactGetterCalls = 0;
    const accessorArtifact = Object.defineProperties(
      { sourcePath: "Sources/研究.md" },
      {
        bytes: {
          enumerable: true,
          get: () => {
            artifactGetterCalls += 1;
            return Uint8Array.from([1]);
          },
        },
        sourceContentHash: {
          enumerable: true,
          get: () => {
            artifactGetterCalls += 1;
            return createSourceContentHash(createBuffer(1));
          },
        },
      }
    ) as ExactSourceArtifact;
    jest.spyOn(accessorReader, "read").mockResolvedValue(accessorArtifact);
    const readerHandoff = new RecordingHandoff();
    const readerSink = new RecordingSink();
    const readerWatcher = new ObsidianVaultSourceWatcher(
      readerApp,
      createWatchPlan([createSource()]),
      new Map([["personal", readerHandoff]]),
      {
        artifactReader: accessorReader,
        captureIdFactory: () => "accessor-artifact",
        notificationSink: readerSink,
      }
    );
    readerWatcher.start();
    await readerWatcher.waitForIdle();

    expect(artifactGetterCalls).toBe(0);
    expect(readerHandoff.commitCalls).toHaveLength(0);
    expect(readerSink.notifications).toContainEqual(
      expect.objectContaining({ kind: "capture_failed", stage: "read" })
    );

    const allocationHarness = new VaultHarness();
    allocationHarness.addFile("Sources/研究.md", createBuffer(2));
    let allocationGetterCalls = 0;
    let allocationCommitCalls = 0;
    const allocationHandoff: VaultSourceObservationHandoffPort = {
      allocate: async (request) =>
        Object.defineProperty(
          {
            ...request,
            observationToken: "accessor-allocation-token",
          },
          "inputRevision",
          {
            enumerable: true,
            get: () => {
              allocationGetterCalls += 1;
              return 1;
            },
          }
        ) as SourceInputRevisionAllocation,
      commit: async () => {
        allocationCommitCalls += 1;
        throw new Error("accessor allocation must not reach commit");
      },
    };
    const allocationSink = new RecordingSink();
    const allocationWatcher = new ObsidianVaultSourceWatcher(
      allocationHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", allocationHandoff]]),
      {
        captureIdFactory: () => "accessor-allocation",
        notificationSink: allocationSink,
      }
    );
    allocationWatcher.start();
    await allocationWatcher.waitForIdle();

    expect(allocationGetterCalls).toBe(0);
    expect(allocationHarness.adapter.readBinary).not.toHaveBeenCalled();
    expect(allocationCommitCalls).toBe(0);
    expect(allocationSink.notifications).toContainEqual(
      expect.objectContaining({ kind: "capture_failed", stage: "allocate" })
    );

    const settlementHarness = new VaultHarness();
    settlementHarness.addFile("Sources/研究.md", createBuffer(3));
    let settlementGetterCalls = 0;
    const settlementHandoff = new RecordingHandoff();
    settlementHandoff.commitImplementation = async () =>
      Object.defineProperty({ kind: "committed", queueRevision: 1 }, "observation", {
        enumerable: true,
        get: () => {
          settlementGetterCalls += 1;
          return {};
        },
      }) as CommitSourceInputObservationResult;
    const settlementSink = new RecordingSink();
    const settlementWatcher = new ObsidianVaultSourceWatcher(
      settlementHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", settlementHandoff]]),
      {
        captureIdFactory: () => "accessor-settlement",
        notificationSink: settlementSink,
      }
    );
    settlementWatcher.start();
    await settlementWatcher.waitForIdle();

    expect(settlementGetterCalls).toBe(0);
    expect(settlementHandoff.commitCalls).toHaveLength(1);
    expect(settlementSink.notifications).toContainEqual(
      expect.objectContaining({ kind: "capture_failed", stage: "commit" })
    );
    expect(settlementSink.notifications).not.toContainEqual(
      expect.objectContaining({ kind: "capture_settled" })
    );
  });

  it("rejects a plan when its Bundle has no durable handoff", () => {
    const harness = new VaultHarness();

    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          harness.createApp(),
          createWatchPlan([createSource()]),
          new Map()
        )
    ).toThrow(VaultSourceWatchPlanError);
    expect(
      () =>
        new ObsidianVaultSourceWatcher(harness.createApp(), createEmptyBundleWatchPlan(), new Map())
    ).toThrow(VaultSourceWatchPlanError);

    const malformedValues: unknown[] = [undefined, {}, { allocate: async () => undefined }];
    for (const malformed of malformedValues) {
      expect(
        () =>
          new ObsidianVaultSourceWatcher(
            harness.createApp(),
            createEmptyBundleWatchPlan(),
            new Map([["personal", malformed as VaultSourceObservationHandoffPort]])
          )
      ).toThrow(VaultSourceWatchPlanError);
    }

    let accessorCalls = 0;
    const accessorBacked = Object.defineProperties(
      {},
      {
        allocate: {
          enumerable: true,
          get: () => {
            accessorCalls += 1;
            return async () => undefined;
          },
        },
        commit: {
          enumerable: true,
          get: () => {
            accessorCalls += 1;
            return async () => undefined;
          },
        },
      }
    );
    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          harness.createApp(),
          createEmptyBundleWatchPlan(),
          new Map([["personal", accessorBacked as unknown as VaultSourceObservationHandoffPort]])
        )
    ).toThrow(VaultSourceWatchPlanError);
    expect(accessorCalls).toBe(0);

    let cyclicPrototype!: object;
    cyclicPrototype = new Proxy(
      {},
      {
        getPrototypeOf: () => cyclicPrototype,
      }
    );
    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          harness.createApp(),
          createEmptyBundleWatchPlan(),
          new Map([["personal", cyclicPrototype as VaultSourceObservationHandoffPort]])
        )
    ).toThrow(VaultSourceWatchPlanError);
  });

  it("keeps the previous plan active after a replacement dependency check fails", async () => {
    const harness = new VaultHarness();
    const file = harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    let captureSequence = 0;
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => `capture-${++captureSequence}` }
    );
    watcher.start();
    await watcher.waitForIdle();
    handoff.allocateCalls.length = 0;
    handoff.commitCalls.length = 0;

    expect(() =>
      watcher.replaceWatchPlan(
        createWatchPlan([
          createSource({
            bundleId: "work",
            sourceId: "work-source",
            sourcePath: "Sources/研究.md",
            pipelineFingerprint: PIPELINE_B,
          }),
        ])
      )
    ).toThrow(VaultSourceWatchPlanError);

    harness.trigger("modify", file);
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(handoff.allocateCalls[0]).toMatchObject({
      bundleId: "personal",
      sourceId: "source-1",
    });
    expect(handoff.commitCalls).toHaveLength(1);
  });

  it("uses handoff methods captured at installation even if the handoff object is mutated", async () => {
    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "captured-methods" }
    );
    handoff.allocate = async () => {
      throw new Error("replacement method must not run");
    };
    handoff.commit = async () => {
      throw new Error("replacement method must not run");
    };

    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(1);
    expect(handoff.commitCalls).toHaveLength(1);
  });

  it("stops stale missing and destructive notifications after a reentrant plan replacement", async () => {
    const sources = [
      createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" }),
      createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
    ];

    const missingHarness = new VaultHarness();
    const missingNotifications: VaultSourceWatcherNotification[] = [];
    let missingWatcher: ObsidianVaultSourceWatcher;
    const missingSink = {
      emit: (notification: VaultSourceWatcherNotification): void => {
        missingNotifications.push(notification);
        missingWatcher.replaceWatchPlan(createWatchPlan([]));
      },
    };
    missingWatcher = new ObsidianVaultSourceWatcher(
      missingHarness.createApp(),
      createWatchPlan(sources),
      new Map([["personal", new RecordingHandoff()]]),
      { notificationSink: missingSink }
    );

    missingWatcher.start();

    expect(missingNotifications).toHaveLength(1);
    expect(missingNotifications[0]).toMatchObject({ kind: "source_missing" });

    const destructiveHarness = new VaultHarness();
    destructiveHarness.addFile("Sources/A.md", createBuffer(1));
    destructiveHarness.addFile("Sources/B.md", createBuffer(2));
    const destructiveNotifications: VaultSourceWatcherNotification[] = [];
    let destructiveWatcher: ObsidianVaultSourceWatcher;
    const destructiveSink = {
      emit: (notification: VaultSourceWatcherNotification): void => {
        destructiveNotifications.push(notification);
        if (notification.kind === "source_change_unsupported") {
          destructiveWatcher.replaceWatchPlan(createWatchPlan([]));
        }
      },
    };
    destructiveWatcher = new ObsidianVaultSourceWatcher(
      destructiveHarness.createApp(),
      createWatchPlan(sources),
      new Map([["personal", new RecordingHandoff()]]),
      {
        captureIdFactory: (() => {
          let sequence = 0;
          return () => `destructive-capture-${++sequence}`;
        })(),
        notificationSink: destructiveSink,
      }
    );
    destructiveWatcher.start();
    await destructiveWatcher.waitForIdle();
    destructiveNotifications.length = 0;

    destructiveHarness.trigger("delete", createFolder("Sources"));

    expect(destructiveNotifications).toHaveLength(1);
    expect(destructiveNotifications[0]).toMatchObject({
      kind: "source_change_unsupported",
      change: "delete",
    });
  });

  it("quarantines a startup-missing source until a new plan generation revalidates it", async () => {
    const harness = new VaultHarness();
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => "created-after-startup-missing",
        notificationSink: sink,
      }
    );

    watcher.start();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(sink.notifications).toEqual([
      { kind: "source_missing", bundleId: "personal", sourceId: "source-1" },
    ]);
    expect(watcher.getStartupBlockers()).toEqual([
      { kind: "source_missing", bundleId: "personal", sourceId: "source-1" },
    ]);
    expect(harness.order.slice(0, 4)).toEqual([
      "listen:create",
      "listen:modify",
      "listen:delete",
      "listen:rename",
    ]);

    const created = harness.addFile("Sources/研究.md", createBuffer(1, 2, 3));
    harness.trigger("create", created);
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toHaveLength(0);

    watcher.replaceWatchPlan(createWatchPlan([createSource()]));
    await watcher.waitForIdle();

    expect(handoff.allocateCalls).toEqual([
      {
        bundleId: "personal",
        sourceId: "source-1",
        captureId: "created-after-startup-missing",
      },
    ]);
    expect(handoff.commitCalls).toHaveLength(1);
    expect(watcher.getStartupBlockers()).toEqual([]);
  });

  it("blocks case-only source drift and Windows-key collisions during startup crawl", () => {
    const caseHarness = new VaultHarness();
    caseHarness.addFile("sources/研究.md", createBuffer(1));
    const caseHandoff = new RecordingHandoff();
    const caseWatcher = new ObsidianVaultSourceWatcher(
      caseHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", caseHandoff]])
    );

    caseWatcher.start();

    expect(caseHandoff.allocateCalls).toHaveLength(0);
    expect(caseWatcher.getStartupBlockers()).toEqual([
      {
        kind: "source_path_invalid",
        reason: "case_mismatch",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);

    const collisionHarness = new VaultHarness();
    collisionHarness.addFile("Sources/研究.md", createBuffer(1));
    collisionHarness.addFile("sources/研究.md", createBuffer(2));
    const collisionHandoff = new RecordingHandoff();
    const collisionWatcher = new ObsidianVaultSourceWatcher(
      collisionHarness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", collisionHandoff]])
    );

    collisionWatcher.start();

    expect(collisionHandoff.allocateCalls).toHaveLength(0);
    expect(collisionWatcher.getStartupBlockers()).toEqual([
      {
        kind: "source_path_invalid",
        reason: "windows_collision",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);
  });

  it("converges allocated and drifted bound restart work through a newer authoritative crawl", async () => {
    const runtime = new KnowledgeRuntimeStore(new MemoryAtomicRuntimeFile(), {
      opaqueIdFactory: (() => {
        let id = 0;
        return () => (++id).toString(16).padStart(32, "0");
      })(),
      clock: (() => {
        let now = 100;
        return () => ++now;
      })(),
    });
    await runtime.initialize();
    const storage = new KnowledgeRuntimeQueueStorage(runtime);
    const queue = new IngestQueue(
      storage,
      {
        /** Fails if observation startup unexpectedly starts Queue execution. */
        execute: async () => {
          throw new Error("Observation startup must not run Queue work");
        },
      },
      { clock: () => 1_000, jobIdFactory: () => "job-authoritative-crawl" }
    );
    const revisions = new KnowledgeRuntimeInputRevisionAllocator(runtime);
    const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
    const handoff = new SourceObservationHandoff(revisions, observations, queue);
    const staleBytes = createBuffer(1);
    const currentBytes = createBuffer(2);
    const stale = await revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "restart-bound",
    });
    await observations.bind({
      observationToken: stale.observationToken,
      sourceContentHash: createSourceContentHash(staleBytes),
      pipelineFingerprint: PIPELINE_A,
    });
    await revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "restart-allocated",
    });

    const harness = new VaultHarness();
    harness.addFile("Sources/研究.md", currentBytes);
    const app = harness.createApp();
    const plan = createWatchPlan([createSource()]);
    const watcher = new ObsidianVaultSourceWatcher(app, plan, new Map([["personal", handoff]]), {
      captureIdFactory: () => "authoritative-crawl",
    });
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: new ObsidianExactSourceArtifactReader(app),
      handoffs: new Map([["personal", handoff]]),
    });
    const coordinator = new KnowledgeSourceObservationStartupCoordinator({
      watcher,
      reconciler,
      assertCurrent: () => undefined,
    });

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 1,
    });
    await expect(handoff.loadRecoveryWork("personal")).resolves.toEqual([]);
    await expect(queue.load("personal")).resolves.toMatchObject({
      sourceHighWatermarks: [
        {
          sourceId: "source-1",
          inputRevision: 3,
          sourceContentHash: createSourceContentHash(currentBytes),
          pipelineFingerprint: PIPELINE_A,
        },
      ],
      jobs: [
        {
          sourceId: "source-1",
          inputRevision: 3,
          sourceContentHash: createSourceContentHash(currentBytes),
          status: "pending",
        },
      ],
    });

    coordinator.close();
    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(0);
    }
  });

  it("converges out-of-order rapid modifies through Runtime v3 and Queue v5 authority", async () => {
    const runtime = new KnowledgeRuntimeStore(new MemoryAtomicRuntimeFile(), {
      opaqueIdFactory: (() => {
        let id = 0;
        return () => (++id).toString(16).padStart(32, "0");
      })(),
      clock: (() => {
        let now = 100;
        return () => ++now;
      })(),
    });
    await runtime.initialize();
    const queue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(runtime),
      {
        /** Fails if the watcher unexpectedly starts worker execution. */
        execute: async () => {
          throw new Error("Watcher must not execute Queue work");
        },
      },
      {
        jobIdFactory: (() => {
          let id = 0;
          return () => `job-${++id}`;
        })(),
        clock: (() => {
          let now = 1_000;
          return () => ++now;
        })(),
      }
    );
    const handoff = new SourceObservationHandoff(
      new KnowledgeRuntimeInputRevisionAllocator(runtime),
      new KnowledgeRuntimeInputObservationBinder(runtime),
      queue
    );
    const harness = new VaultHarness();
    const file = harness.addFile("Sources/研究.md", createBuffer(0));
    const reads: Deferred<unknown>[] = [];
    harness.readBinaryImplementation = async () => {
      const read = createDeferred<unknown>();
      reads.push(read);
      return read.promise;
    };
    const captureIds = ["rapid-1", "rapid-2"];
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      createWatchPlan([createSource()]),
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => captureIds.shift()!,
        maxReadAttempts: 1,
      }
    );
    harness.loadedFiles.clear();
    watcher.startListening();
    harness.loadedFiles.set(file.path, file);

    harness.trigger("modify", file);
    harness.trigger("modify", file);
    await waitUntil(() => reads.length === 2);
    const olderBytes = createBuffer(1);
    const newerBytes = createBuffer(2);
    reads[1]?.resolve(newerBytes);
    await Promise.resolve();
    reads[0]?.resolve(olderBytes);
    await watcher.waitForIdle();

    const snapshot = await queue.load("personal");
    expect(snapshot.sourceHighWatermarks).toHaveLength(1);
    expect(snapshot.sourceHighWatermarks[0]).toMatchObject({
      sourceId: "source-1",
      sourceContentHash: createSourceContentHash(newerBytes),
      pipelineFingerprint: PIPELINE_A,
      inputRevision: 2,
    });
    expect(Number.isSafeInteger(snapshot.sourceHighWatermarks[0]?.observedAt)).toBe(true);
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      sourceId: "source-1",
      sourceContentHash: createSourceContentHash(newerBytes),
      inputRevision: 2,
      status: "pending",
    });
  });
});
