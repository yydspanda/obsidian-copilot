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
  type VaultSourceObservationHandoffPort,
  type VaultSourceWatcherNotification,
  type WatchedKnowledgeSource,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const PIPELINE_A = "a".repeat(64);
const PIPELINE_B = "b".repeat(64);

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
 * Creates one valid immutable watch-plan input.
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
          [createSource({ sourcePath: "Sources/shared.md" })],
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
      [createSource()],
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

  it("deduplicates an identical plan entry but observes one path independently per Bundle", async () => {
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
      [personal, { ...personal }, work],
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
    expect(second.commitCalls[0]?.pipelineFingerprint).toBe(PIPELINE_B);
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
      [createSource()],
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => {
          if (!replaced) {
            replaced = true;
            watcher.replaceWatchPlan([]);
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
      [createSource()],
      new Map([["personal", handoff]]),
      { captureIdFactory: () => "stable-capture" }
    );

    watcher.start();
    await watcher.waitForIdle();

    expect(handoff.allocateCalls.map(({ captureId }) => captureId)).toEqual([
      "stable-capture",
      "stable-capture",
    ]);
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
      [createSource()],
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
      [createSource()],
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
      [createSource()],
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
    expect(() => oldWatcher.replaceWatchPlan([])).toThrow(VaultSourceWatcherClosedError);

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
      [createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" })],
      new Map([["personal", planHandoff]]),
      { captureIdFactory: () => ids.shift()! }
    );
    planWatcher.start();
    await Promise.resolve();
    planWatcher.replaceWatchPlan([
      createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
    ]);
    planWatcher.replaceWatchPlan([
      createSource({ sourceId: "source-c", sourcePath: "Sources/C.md" }),
    ]);
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
      [createSource()],
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
      [createSource()],
      new Map([["personal", commitHandoff]]),
      {
        captureIdFactory: () => "commit-in-flight",
        notificationSink: commitSink,
      }
    );

    commitWatcher.start();
    await waitUntil(() => commitHandoff.commitCalls.length === 1);
    commitWatcher.replaceWatchPlan([]);
    deferredCommit.reject(new Error("durable commit acknowledgement lost"));
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
      [createSource()],
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

    harness.readBinaryImplementation = undefined;
    watcher.replaceWatchPlan([createSource()]);
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
      [
        createSource({ sourceId: "source-a", sourcePath: "Sources/A.md" }),
        createSource({ sourceId: "source-b", sourcePath: "Sources/B.md" }),
      ],
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
      [createSource()],
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
    const first = new ObsidianVaultSourceWatcher(harness.createApp(), [], new Map(), {
      captureIdFactory: () => "unused-first",
    });
    const second = new ObsidianVaultSourceWatcher(harness.createApp(), [], new Map(), {
      captureIdFactory: () => "unused-second",
    });
    first.start();
    second.start();

    first.close();

    for (const name of ["create", "modify", "delete", "rename"] as const) {
      expect(harness.handlers.get(name)?.size).toBe(1);
    }
    expect(second.owns(harness.createApp())).toBe(false);
    const exactApp = { vault: harness.vault } as unknown as App;
    const owned = new ObsidianVaultSourceWatcher(exactApp, [], new Map());
    expect(owned.owns(exactApp)).toBe(true);
  });

  it("releases partial EventRefs when listener registration fails and permits a clean retry", () => {
    const harness = new VaultHarness();
    harness.failOnEventRegistration = "delete";
    const watcher = new ObsidianVaultSourceWatcher(harness.createApp(), [], new Map());

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

  it("reports rename/delete/folder changes without allocating, reading, or committing", async () => {
    const harness = new VaultHarness();
    const file = harness.addFile("Sources/研究.md", createBuffer(1));
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      [createSource()],
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
      [createSource()],
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
      [createSource()],
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
      [createSource()],
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

  it("rejects conflicting source/path ownership, invalid fingerprints, and missing handoffs", () => {
    const harness = new VaultHarness();
    const valid = createSource();

    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          harness.createApp(),
          [valid, { ...valid, sourcePath: "Sources/other.md", sourceKey: "sources/other.md" }],
          new Map([["personal", new RecordingHandoff()]])
        )
    ).toThrow(VaultSourceWatchPlanError);
    expect(
      () =>
        new ObsidianVaultSourceWatcher(
          harness.createApp(),
          [{ ...valid, pipelineFingerprint: "not-a-hash" }],
          new Map([["personal", new RecordingHandoff()]])
        )
    ).toThrow(VaultSourceWatchPlanError);
    expect(() => new ObsidianVaultSourceWatcher(harness.createApp(), [valid], new Map())).toThrow(
      VaultSourceWatchPlanError
    );
  });

  it("reports a missing planned source after listener registration without fabricating a capture", () => {
    const harness = new VaultHarness();
    const handoff = new RecordingHandoff();
    const sink = new RecordingSink();
    const watcher = new ObsidianVaultSourceWatcher(
      harness.createApp(),
      [createSource()],
      new Map([["personal", handoff]]),
      { notificationSink: sink }
    );

    watcher.start();

    expect(handoff.allocateCalls).toHaveLength(0);
    expect(sink.notifications).toEqual([
      { kind: "source_missing", bundleId: "personal", sourceId: "source-1" },
    ]);
    expect(harness.order.slice(0, 4)).toEqual([
      "listen:create",
      "listen:modify",
      "listen:delete",
      "listen:rename",
    ]);
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
      [createSource()],
      new Map([["personal", handoff]]),
      {
        captureIdFactory: () => captureIds.shift()!,
        maxReadAttempts: 1,
      }
    );
    harness.loadedFiles.clear();
    watcher.start();
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
