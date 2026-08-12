import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  IngestQueue,
  IngestQueueActivityCommandStaleError,
  type EventSink,
  type IngestExecutionResult,
  type IngestQueueActivityCommandResult,
  type IngestQueueEvent,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitPlanDigest,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeIngestJob } from "@/knowledge/model/types";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import {
  validateChangeSetReviewSnapshot,
  type ChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeStore,
  createEmptyKnowledgeRuntimeStoreSnapshot,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES,
  KnowledgeStudioRuntimeCommandAdapter,
} from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";
import { KnowledgeStudioReviewedApplyPort } from "@/knowledge/ui/KnowledgeStudioReviewedApplyPort";
import type { KnowledgeStudioReviewSubmissionResult } from "@/knowledge/ui/KnowledgeStudioController";

const BUNDLE_ID = "personal";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const RUNTIME_ID = "d".repeat(32);

/** Promise whose settlement is controlled by one test. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** Creates one externally settled Promise. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Clones one JSON-compatible value across a persistence boundary. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Creates the strict empty Queue state used by Activity adapter tests. */
function createQueueSnapshot(
  revision = 0,
  overrides: Partial<IngestQueueSnapshot> = {}
): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: BUNDLE_ID,
    revision,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
    ...overrides,
  };
}

/** JSON-only Queue storage with strict compare-and-swap behavior. */
class MemoryQueueStorage implements QueueStorage {
  private readonly values = new Map<string, unknown>();

  readonly writes: Array<{
    bundleId: string;
    snapshot: IngestQueueSnapshot;
    expectedRevision: number | null;
  }> = [];

  /** Seeds one exact Queue snapshot without counting a command write. */
  seed(snapshot: IngestQueueSnapshot): void {
    this.values.set(snapshot.bundleId, cloneJson(snapshot));
  }

  /** Reads detached persisted Queue JSON. */
  async read(bundleId: string): Promise<unknown> {
    const value = this.values.get(bundleId);
    return value === undefined ? null : cloneJson(value);
  }

  /** Atomically compares and replaces one complete Queue snapshot. */
  async write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const current = this.values.get(bundleId);
    const parsed = current === undefined ? undefined : parseIngestQueueSnapshot(current);
    const actualRevision = parsed?.ok ? parsed.value.revision : null;
    if (
      (expectedRevision === null && current !== undefined) ||
      (expectedRevision !== null && actualRevision !== expectedRevision)
    ) {
      throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    this.writes.push({
      bundleId,
      snapshot: cloneJson(snapshot),
      expectedRevision,
    });
    this.values.set(bundleId, cloneJson(snapshot));
  }

  /** Returns one strict detached Queue snapshot for assertions. */
  snapshot(bundleId = BUNDLE_ID): IngestQueueSnapshot {
    const value = this.values.get(bundleId);
    const parsed = parseIngestQueueSnapshot(value);
    if (!parsed.ok) throw new Error("The test Queue snapshot is invalid");
    return parsed.value;
  }
}

/** Records the exact post-commit Queue notifications emitted by Activity commands. */
class RecordingEventSink implements EventSink {
  readonly events: IngestQueueEvent[] = [];

  /** Records one value-free Queue event. */
  emit(event: IngestQueueEvent): void {
    this.events.push({ ...event });
  }
}

/** Minimal serialized atomic Runtime file with a write counter. */
class CountingMemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();

  processCount = 0;

  /** Initializes the file without replacing existing bytes. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) this.content = initialContent;
  }

  /** Reads the current exact Runtime bytes. */
  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("The test Runtime is not initialized");
    return this.content;
  }

  /** Serializes and commits one synchronous full-file transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) throw new Error("The test Runtime is not initialized");
      this.processCount += 1;
      this.content = transform(this.content);
      return this.content;
    } finally {
      release();
    }
  }

  /** Replaces the Runtime bytes to seed an exact durable fixture. */
  replaceContent(content: string): void {
    this.content = content;
  }

  /** Resets only the command-write counter after fixture setup. */
  resetProcessCount(): void {
    this.processCount = 0;
  }
}

/** Creates one authentic Queue whose executor is unreachable in adapter tests. */
function createQueue(storage: QueueStorage, sink = new RecordingEventSink()): IngestQueue {
  return new IngestQueue(
    storage,
    {
      execute: async (): Promise<IngestExecutionResult> => {
        throw new Error("The command adapter must not execute ingest work directly");
      },
    },
    { clock: () => 125, eventSink: sink }
  );
}

/** Creates one proposed ChangeSet for an exact pending Review. */
function createProposal(): KnowledgeChangeSet {
  const afterContent = "# Adapter rejection\n";
  return {
    id: "changeset-reject",
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: ["source-review"],
    changes: [
      {
        id: "change-reject",
        operation: "create",
        path: "Wiki/Adapter rejection.md",
        sourceRefs: ["source-review"],
        reason: "Compile one grounded page",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 90,
  };
}

/** Creates one immutable Manifest plan retained by the pending Review. */
function createManifestPlan(proposal: KnowledgeChangeSet): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: BUNDLE_ID,
    sourceId: "source-review",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_C,
    baseGeneratedPages: [],
    mutations: proposal.changes.map((change) => ({
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: "create_only" as const,
      ownership: "generated" as const,
      wasTrackedByPrimarySource: false,
    })),
  };
}

/** Creates exact Queue, Review, and command identity for atomic Reject tests. */
function createPendingReviewFixture(): {
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;
  command: KnowledgeReviewCommand;
} {
  const proposal = createProposal();
  const proposalDigest = createChangeSetTransactionDigest(proposal);
  const manifestCommitPlan = createManifestPlan(proposal);
  const job: KnowledgeIngestJob = {
    id: "job-review",
    bundleId: BUNDLE_ID,
    sourceId: "source-review",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    rerunRequested: false,
    createdAt: 100,
    updatedAt: 120,
    status: "awaiting_review",
    stage: "review",
    changeSetId: proposal.id,
  };
  return {
    queue: createQueueSnapshot(7, {
      jobs: [job],
      sourceHighWatermarks: [
        {
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          observedAt: job.updatedAt,
        },
      ],
      pendingReviews: [
        {
          kind: "durable",
          jobId: job.id,
          changeSetId: proposal.id,
          proposalDigest,
          reviewRecordRevision: 0,
          recordedAt: 110,
        },
      ],
    }),
    review: {
      version: 2,
      bundleId: BUNDLE_ID,
      revision: 4,
      records: [
        {
          changeSetId: proposal.id,
          proposal,
          proposalDigest,
          manifestCommitPlan,
          manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
          jobClaim: {
            jobId: job.id,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
          },
          recordedAt: 110,
          outcome: "pending",
          recordRevision: 0,
        },
      ],
    },
    command: {
      changeSetId: proposal.id,
      proposalDigest,
      expectedSnapshotToken: HASH_C,
      decisions: [{ changeId: proposal.changes[0].id, decision: "reject" }],
    },
  };
}

/** Creates an initialized authentic Runtime and its narrow Reject facade. */
async function createReviewRuntime(fixture = createPendingReviewFixture()): Promise<{
  file: CountingMemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  port: KnowledgeRuntimeReviewRejectPort;
}> {
  const file = new CountingMemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file, {
    clock: () => 125,
    opaqueIdFactory: () => RUNTIME_ID,
  });
  await runtime.initialize();
  const state: KnowledgeRuntimeStoreSnapshot = {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(RUNTIME_ID),
    revision: 12,
    queues: [{ bundleId: BUNDLE_ID, value: fixture.queue }],
    reviews: [{ bundleId: BUNDLE_ID, value: fixture.review }],
    inputRevisions: [
      {
        bundleId: BUNDLE_ID,
        sources: [
          {
            sourceId: "source-review",
            inputRevision: 1,
            managedAfterRevision: 0,
            observations: [
              {
                observationToken: "e".repeat(32),
                captureId: "capture-review",
                inputRevision: 1,
                allocatedAt: 100,
                status: "consumed",
                sourceContentHash: HASH_A,
                pipelineFingerprint: HASH_B,
                boundAt: 100,
                settledAt: 100,
                queueRevision: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  file.replaceContent(JSON.stringify(state));
  file.resetProcessCount();
  return { file, runtime, port: new KnowledgeRuntimeReviewRejectPort(runtime) };
}

/** Creates an authentic command adapter with observable lifecycle and side effects. */
async function createAdapterHarness(
  options: {
    fixture?: ReturnType<typeof createPendingReviewFixture>;
    queueStorage?: MemoryQueueStorage;
    reviewApply?: KnowledgeStudioReviewedApplyPort;
  } = {}
): Promise<{
  adapter: KnowledgeStudioRuntimeCommandAdapter;
  queue: IngestQueue;
  queueStorage: MemoryQueueStorage;
  queueSink: RecordingEventSink;
  file: CountingMemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  drains: Promise<void>[];
  notifyReviewWorkAvailable: jest.Mock<void, []>;
  setCurrent(value: boolean): void;
}> {
  const queueStorage = options.queueStorage ?? new MemoryQueueStorage();
  const queueSink = new RecordingEventSink();
  const queue = createQueue(queueStorage, queueSink);
  const review = await createReviewRuntime(options.fixture);
  const drains: Promise<void>[] = [];
  const notifyReviewWorkAvailable = jest.fn<void, []>();
  let current = true;
  const adapter = new KnowledgeStudioRuntimeCommandAdapter({
    queue,
    reviewReject: review.port,
    ...(options.reviewApply === undefined ? {} : { reviewApply: options.reviewApply }),
    bundleIds: [BUNDLE_ID],
    assertCurrent: () => {
      if (!current) throw new DOMException("stale generation", "AbortError");
    },
    retainDrain: (drain) => drains.push(drain),
    notifyReviewWorkAvailable,
  });
  return {
    adapter,
    queue,
    queueStorage,
    queueSink,
    file: review.file,
    runtime: review.runtime,
    drains,
    notifyReviewWorkAvailable,
    setCurrent: (value) => {
      current = value;
    },
  };
}

describe("KnowledgeStudioRuntimeCommandAdapter", () => {
  it("publishes only reject-safe frozen capabilities and hides all authority in WeakMap state", async () => {
    const { adapter } = await createAdapterHarness();

    expect(KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES).toEqual({
      pauseBundle: true,
      resumeBundle: true,
      cancelJob: true,
      retryJob: true,
      reviewReject: true,
      reviewAccept: false,
      recoveryContinue: false,
      recoveryAbandon: false,
    });
    expect(Object.isFrozen(KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES)).toBe(true);
    expect(adapter.getCapabilities()).toBe(KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES);
    expect(Reflect.ownKeys(adapter)).toEqual([]);
    expect(Object.getOwnPropertyDescriptors(adapter)).toEqual({});
    expect(JSON.stringify(adapter)).toBe("{}");
    expect(Object.isFrozen(adapter)).toBe(true);
    for (const hidden of [
      "queue",
      "reviewReject",
      "reviewApply",
      "bundleIds",
      "assertCurrent",
      "retainDrain",
      "notifyReviewWorkAvailable",
      "listeners",
    ]) {
      expect(hidden in adapter).toBe(false);
    }
    expect(() => KnowledgeStudioRuntimeCommandAdapter.assert(adapter)).not.toThrow();

    const counterfeit = Object.freeze(
      Object.create(KnowledgeStudioRuntimeCommandAdapter.prototype) as object
    );
    let counterfeitError: unknown;
    try {
      KnowledgeStudioRuntimeCommandAdapter.assert(counterfeit);
    } catch (error) {
      counterfeitError = error;
    }
    expect(counterfeitError).toBeInstanceOf(DOMException);
    if (!(counterfeitError instanceof DOMException)) {
      throw new Error("Expected a platform AbortError for a counterfeit adapter");
    }
    expect(counterfeitError.name).toBe("AbortError");
  });

  it("enables frozen Review Accept capability only when an authentic reviewed-apply port exists", async () => {
    const reviewApply = new KnowledgeStudioReviewedApplyPort(async () => ({ kind: "applied" }));
    const { adapter } = await createAdapterHarness({ reviewApply });

    const capabilities = adapter.getCapabilities();

    expect(capabilities).toEqual({
      ...KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES,
      reviewAccept: true,
    });
    expect(capabilities).not.toBe(KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(KNOWLEDGE_STUDIO_RUNTIME_COMMAND_CAPABILITIES.reviewAccept).toBe(false);
  });

  it("forwards every Activity command with its exact expected revision and publishes local hints", async () => {
    const harness = await createAdapterHarness();
    const snapshot = createQueueSnapshot(99);
    const execute = jest.spyOn(harness.queue, "executeActivityCommand").mockImplementation(
      async (command): Promise<IngestQueueActivityCommandResult> => ({
        kind: "committed",
        command: command.kind,
        snapshot,
      })
    );
    const hint = jest.fn<void, []>();
    const unsubscribe = harness.adapter.subscribe(BUNDLE_ID, hint);
    const signal = new AbortController().signal;

    await harness.adapter.pauseBundle(BUNDLE_ID, 11, signal);
    await harness.adapter.resumeBundle(BUNDLE_ID, 12, signal);
    await harness.adapter.cancelJob(BUNDLE_ID, "job-cancel", 13, signal);
    await harness.adapter.retryJob(BUNDLE_ID, "job-retry", 14, signal);

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      { kind: "pause_bundle", bundleId: BUNDLE_ID, expectedQueueRevision: 11 },
      { kind: "resume_bundle", bundleId: BUNDLE_ID, expectedQueueRevision: 12 },
      {
        kind: "cancel_job",
        bundleId: BUNDLE_ID,
        jobId: "job-cancel",
        expectedQueueRevision: 13,
      },
      {
        kind: "retry_job",
        bundleId: BUNDLE_ID,
        jobId: "job-retry",
        expectedQueueRevision: 14,
      },
    ]);
    expect(hint).toHaveBeenCalledTimes(4);
    expect(harness.drains).toHaveLength(4);
    await Promise.all(harness.drains);

    unsubscribe();
    await harness.adapter.pauseBundle(BUNDLE_ID, 15, signal);
    expect(hint).toHaveBeenCalledTimes(4);
    execute.mockRestore();
  });

  it("uses the real Queue revision as authority and emits hints only after commit", async () => {
    const storage = new MemoryQueueStorage();
    const harness = await createAdapterHarness({ queueStorage: storage });
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);
    const signal = new AbortController().signal;

    await harness.adapter.pauseBundle(BUNDLE_ID, 0, signal);
    expect(storage.snapshot()).toMatchObject({
      revision: 1,
      control: { status: "paused", reason: "user" },
    });
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0].expectedRevision).toBeNull();
    expect(harness.queueSink.events).toEqual([
      expect.objectContaining({ cause: "pause", bundleId: BUNDLE_ID, revision: 1 }),
    ]);
    expect(hint).toHaveBeenCalledTimes(1);

    await expect(harness.adapter.resumeBundle(BUNDLE_ID, 0, signal)).rejects.toBeInstanceOf(
      IngestQueueActivityCommandStaleError
    );
    expect(storage.writes).toHaveLength(1);
    expect(harness.queueSink.events).toHaveLength(1);
    expect(hint).toHaveBeenCalledTimes(1);

    await harness.adapter.resumeBundle(BUNDLE_ID, 1, signal);
    expect(storage.snapshot()).toMatchObject({ revision: 2, control: { status: "running" } });
    expect(storage.writes[1].expectedRevision).toBe(1);
    expect(harness.queueSink.events[1]).toEqual(
      expect.objectContaining({ cause: "resume", bundleId: BUNDLE_ID, revision: 2 })
    );
    expect(hint).toHaveBeenCalledTimes(2);
    await Promise.all(harness.drains);
  });

  it("fails pre-aborted, stale-lifecycle, and unknown-Bundle commands before Queue mutation", async () => {
    const harness = await createAdapterHarness();
    const execute = jest.spyOn(harness.queue, "executeActivityCommand");
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);
    const aborted = new AbortController();
    aborted.abort();

    await expect(harness.adapter.pauseBundle(BUNDLE_ID, 0, aborted.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      harness.adapter.pauseBundle("unknown", 0, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    harness.setCurrent(false);
    await expect(
      harness.adapter.pauseBundle(BUNDLE_ID, 0, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(execute).not.toHaveBeenCalled();
    expect(harness.queueStorage.writes).toHaveLength(0);
    expect(hint).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it("retains an entered Activity mutation across lifecycle invalidation without publishing stale hints", async () => {
    const harness = await createAdapterHarness();
    const entered = createDeferred<IngestQueueActivityCommandResult>();
    const execute = jest
      .spyOn(harness.queue, "executeActivityCommand")
      .mockReturnValue(entered.promise);
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);

    const command = harness.adapter.pauseBundle(BUNDLE_ID, 17, new AbortController().signal);
    expect(harness.drains).toHaveLength(1);
    harness.setCurrent(false);
    entered.resolve({
      kind: "committed",
      command: "pause_bundle",
      snapshot: createQueueSnapshot(18, {
        control: { status: "paused", reason: "user", pausedAt: 125 },
      }),
    });

    await expect(command).rejects.toMatchObject({ name: "AbortError" });
    await expect(harness.drains[0]).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith({
      kind: "pause_bundle",
      bundleId: BUNDLE_ID,
      expectedQueueRevision: 17,
    });
    expect(hint).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it("atomically submits a literal Reject, publishes a local hint, and notifies Review work", async () => {
    const fixture = createPendingReviewFixture();
    expect(validateIngestQueueSnapshot(fixture.queue)).toEqual({ valid: true, diagnostics: [] });
    expect(validateChangeSetReviewSnapshot(fixture.review)).toEqual({
      valid: true,
      diagnostics: [],
    });
    const harness = await createAdapterHarness({ fixture });
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, fixture.command, new AbortController().signal)
    ).resolves.toEqual({ kind: "rejected" });

    const durable = await harness.runtime.readStudioBundle(BUNDLE_ID);
    expect(durable).toMatchObject({
      runtimeRevision: 13,
      queue: {
        revision: 8,
        pendingReviews: [],
        jobs: [
          expect.objectContaining({
            id: "job-review",
            status: "cancelled",
            stage: "cancelled",
            cancelledAt: 125,
          }),
        ],
        reviewRejections: [
          expect.objectContaining({
            jobId: "job-review",
            changeSetId: "changeset-reject",
            reviewRecordRevision: 1,
          }),
        ],
      },
      review: {
        revision: 5,
        records: [
          expect.objectContaining({
            changeSetId: "changeset-reject",
            outcome: "rejected",
            recordRevision: 1,
            rejectedAt: 125,
          }),
        ],
      },
    });
    expect(harness.file.processCount).toBe(1);
    expect(harness.notifyReviewWorkAvailable).toHaveBeenCalledTimes(1);
    expect(hint).toHaveBeenCalledTimes(1);
    expect(harness.drains).toHaveLength(1);
    await expect(harness.drains[0]).resolves.toBeUndefined();
  });

  it("returns a committed literal Reject after caller cancellation at storage return", async () => {
    const fixture = createPendingReviewFixture();
    const harness = await createAdapterHarness({ fixture });
    const caller = new AbortController();
    const process = jest.spyOn(harness.file, "process");
    process.mockImplementation(async (transform: (currentContent: string) => string) => {
      process.mockRestore();
      const committed = await harness.file.process(transform);
      caller.abort();
      return committed;
    });

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, fixture.command, caller.signal)
    ).resolves.toEqual({ kind: "rejected" });

    expect(caller.signal.aborted).toBe(true);
    const durable = await harness.runtime.readStudioBundle(BUNDLE_ID);
    expect(durable.review.records).toEqual([
      expect.objectContaining({
        changeSetId: fixture.command.changeSetId,
        outcome: "rejected",
      }),
    ]);
  });

  it("keeps a literal Reject receipt when best-effort notifications fail", async () => {
    const fixture = createPendingReviewFixture();
    const harness = await createAdapterHarness({ fixture });
    harness.notifyReviewWorkAvailable.mockImplementation(() => {
      throw new Error("worker notification failed");
    });
    harness.adapter.subscribe(BUNDLE_ID, () => {
      throw new Error("reload listener failed");
    });

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, fixture.command, new AbortController().signal)
    ).resolves.toEqual({ kind: "rejected" });

    const durable = await harness.runtime.readStudioBundle(BUNDLE_ID);
    expect(durable.review.records).toEqual([
      expect.objectContaining({
        changeSetId: fixture.command.changeSetId,
        outcome: "rejected",
      }),
    ]);
    expect(harness.notifyReviewWorkAvailable).toHaveBeenCalledTimes(1);
  });

  it.each<{
    result: KnowledgeStudioReviewSubmissionResult;
    expectedNotificationCount: number;
  }>([
    { result: { kind: "applied" }, expectedNotificationCount: 1 },
    { result: { kind: "recovery_required" }, expectedNotificationCount: 0 },
  ])(
    "delegates a selected Review command and preserves the $result.kind result",
    async ({ result, expectedNotificationCount }) => {
      const fixture = createPendingReviewFixture();
      const command: KnowledgeReviewCommand = {
        ...fixture.command,
        decisions: [{ changeId: "change-reject", decision: "accept_exact" }],
      };
      const submit = jest.fn<
        Promise<KnowledgeStudioReviewSubmissionResult>,
        [string, KnowledgeReviewCommand, AbortSignal]
      >(async () => result);
      const reviewApply = new KnowledgeStudioReviewedApplyPort(submit);
      const harness = await createAdapterHarness({ fixture, reviewApply });
      const hint = jest.fn<void, []>();
      harness.adapter.subscribe(BUNDLE_ID, hint);
      const signal = new AbortController().signal;

      await expect(harness.adapter.submitReview(BUNDLE_ID, command, signal)).resolves.toEqual(
        result
      );

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(BUNDLE_ID, command, signal);
      expect(harness.file.processCount).toBe(0);
      expect(harness.notifyReviewWorkAvailable).toHaveBeenCalledTimes(expectedNotificationCount);
      expect(hint).toHaveBeenCalledTimes(1);
      expect(harness.drains).toHaveLength(1);
      await expect(harness.drains[0]).resolves.toBeUndefined();
    }
  );

  it("keeps a reviewed Apply receipt when best-effort notifications fail", async () => {
    const fixture = createPendingReviewFixture();
    const command: KnowledgeReviewCommand = {
      ...fixture.command,
      decisions: [{ changeId: "change-reject", decision: "accept_exact" }],
    };
    const receipt = Object.freeze({ kind: "applied" as const });
    const reviewApply = new KnowledgeStudioReviewedApplyPort(async () => receipt);
    const harness = await createAdapterHarness({ fixture, reviewApply });
    harness.notifyReviewWorkAvailable.mockImplementation(() => {
      throw new Error("worker notification failed");
    });
    harness.adapter.subscribe(BUNDLE_ID, () => {
      throw new Error("reload listener failed");
    });

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toBe(receipt);
    expect(harness.notifyReviewWorkAvailable).toHaveBeenCalledTimes(1);
    expect(harness.file.processCount).toBe(0);
  });

  it.each([
    {
      name: "accept_exact",
      decision: { changeId: "change-reject", decision: "accept_exact" } as const,
    },
    {
      name: "accept_blocks",
      decision: {
        changeId: "change-reject",
        decision: "accept_blocks",
        acceptedBlockIds: [] as string[],
      } as const,
    },
    {
      name: "accept_edited",
      decision: {
        changeId: "change-reject",
        decision: "accept_edited",
        afterContent: "# Human revision\n",
      } as const,
    },
  ])("blocks $name without entering Runtime storage", async ({ decision }) => {
    const fixture = createPendingReviewFixture();
    const harness = await createAdapterHarness({ fixture });
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);
    const command: KnowledgeReviewCommand = { ...fixture.command, decisions: [decision] };

    expect(harness.adapter.getCapabilities().reviewAccept).toBe(false);

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({
      kind: "blocked",
      diagnostics: [
        expect.objectContaining({
          code: "knowledge_review_reject_only",
          severity: "error",
          field: "decisions",
        }),
      ],
    });

    expect(harness.file.processCount).toBe(0);
    expect(harness.notifyReviewWorkAvailable).not.toHaveBeenCalled();
    expect(hint).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "block selection",
      decision: {
        changeId: "change-reject",
        decision: "accept_blocks",
        acceptedBlockIds: [] as string[],
      } as const,
    },
    {
      name: "manual edit",
      decision: {
        changeId: "change-reject",
        decision: "accept_edited",
        afterContent: "# Human revision\n",
      } as const,
    },
  ])(
    "routes $name directly to reviewed Apply without entering the atomic Reject facade",
    async ({ decision }) => {
      const fixture = createPendingReviewFixture();
      const submit = jest.fn<
        Promise<KnowledgeStudioReviewSubmissionResult>,
        [string, KnowledgeReviewCommand, AbortSignal]
      >(async () => ({ kind: "applied" }));
      const reviewApply = new KnowledgeStudioReviewedApplyPort(submit);
      const harness = await createAdapterHarness({ fixture, reviewApply });
      const signal = new AbortController().signal;
      const command: KnowledgeReviewCommand = { ...fixture.command, decisions: [decision] };

      await expect(harness.adapter.submitReview(BUNDLE_ID, command, signal)).resolves.toEqual({
        kind: "applied",
      });

      expect(submit).toHaveBeenCalledWith(BUNDLE_ID, command, signal);
      expect(harness.file.processCount).toBe(0);
    }
  );

  it.each([
    { name: "pre-aborted", bundleId: BUNDLE_ID, current: true, abort: true },
    { name: "unknown-Bundle", bundleId: "unknown", current: true, abort: false },
    { name: "stale-generation", bundleId: BUNDLE_ID, current: false, abort: false },
  ])(
    "rejects a $name edited command before reviewed Apply or Runtime mutation",
    async ({ bundleId, current, abort }) => {
      const fixture = createPendingReviewFixture();
      const submit = jest.fn<
        Promise<KnowledgeStudioReviewSubmissionResult>,
        [string, KnowledgeReviewCommand, AbortSignal]
      >(async () => ({ kind: "applied" }));
      const reviewApply = new KnowledgeStudioReviewedApplyPort(submit);
      const harness = await createAdapterHarness({ fixture, reviewApply });
      harness.setCurrent(current);
      const controller = new AbortController();
      if (abort) controller.abort();
      const command: KnowledgeReviewCommand = {
        ...fixture.command,
        decisions: [
          {
            changeId: "change-reject",
            decision: "accept_edited",
            afterContent: "# Human revision\n",
          },
        ],
      };

      await expect(
        harness.adapter.submitReview(bundleId, command, controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });

      expect(submit).not.toHaveBeenCalled();
      expect(harness.file.processCount).toBe(0);
    }
  );

  it("maps an exact durable Queue/Review conflict to stale without notifications", async () => {
    const fixture = createPendingReviewFixture();
    const anchor = fixture.queue.pendingReviews[0];
    if (anchor.kind !== "durable") throw new Error("Expected a durable Review anchor");
    anchor.proposalDigest = HASH_C;
    const harness = await createAdapterHarness({ fixture });
    const hint = jest.fn<void, []>();
    harness.adapter.subscribe(BUNDLE_ID, hint);

    await expect(
      harness.adapter.submitReview(BUNDLE_ID, fixture.command, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });

    const durable = await harness.runtime.readStudioBundle(BUNDLE_ID);
    expect(durable.runtimeRevision).toBe(12);
    expect(durable.queue.revision).toBe(7);
    expect(durable.review.revision).toBe(4);
    expect(harness.file.processCount).toBe(1);
    expect(harness.notifyReviewWorkAvailable).not.toHaveBeenCalled();
    expect(hint).not.toHaveBeenCalled();
  });
});
