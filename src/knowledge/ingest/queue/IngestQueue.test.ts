import {
  IngestExecutorError,
  IngestQueue,
  IngestQueueBundleMismatchError,
  IngestQueueIncompatibleVersionError,
  IngestQueueInfrastructureError,
  IngestQueueJobIdConflictError,
  IngestQueueObservationConflictError,
  IngestQueueRecoveryRequiredError,
  IngestQueueRevisionOverflowError,
  IngestQueueTransitionError,
  IngestQueueValidationError,
  IngestQueueWriteConflictExhaustedError,
  type EventSink,
  type IngestExecutionContext,
  type IngestExecutionResult,
  type IngestExecutor,
  type IngestQueueEvent,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import { ExponentialRetryPolicy } from "@/knowledge/ingest/queue/RetryPolicy";
import type { KnowledgeIngestJob } from "@/knowledge/model/types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

interface PlannedWriteFailure {
  error: Error;
  beforeThrow?: () => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/**
 * Creates a manually controlled promise for execution race tests.
 *
 * @returns Promise and its external settlement functions
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Clones JSON-compatible persisted state for storage isolation tests.
 *
 * @param value - JSON-compatible value
 * @returns Detached clone
 */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Creates a valid queue snapshot suitable for storage seeding.
 *
 * @param bundleId - Bundle identity
 * @param overrides - Optional snapshot fields to replace
 * @returns Strict queue snapshot
 */
function createSnapshot(
  bundleId = "personal",
  overrides: Partial<IngestQueueSnapshot> = {}
): IngestQueueSnapshot {
  return {
    version: 1,
    bundleId,
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    ...overrides,
  };
}

/**
 * Creates one valid durable pending job.
 *
 * @param overrides - Optional job fields to replace
 * @returns Pending ingest job
 */
function createPendingJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    id: "job-1",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 0,
    rerunRequested: false,
    createdAt: 100,
    updatedAt: 100,
    status: "pending",
    stage: "queued",
    ...overrides,
  } as KnowledgeIngestJob;
}

/** JSON-only in-memory adapter that enforces the queue storage CAS contract. */
class InMemoryQueueStorage implements QueueStorage {
  private readonly values = new Map<string, unknown>();
  private readonly failures: PlannedWriteFailure[] = [];

  public readCount = 0;
  public writeAttempts = 0;
  public successfulWrites = 0;

  /**
   * Seeds unknown persisted JSON without repository validation.
   *
   * @param bundleId - Storage key
   * @param value - Unknown JSON value
   */
  seed(bundleId: string, value: unknown): void {
    this.values.set(bundleId, cloneJson(value));
  }

  /**
   * Returns detached raw storage state.
   *
   * @param bundleId - Storage key
   * @returns Persisted state or null
   */
  get(bundleId: string): unknown {
    const value = this.values.get(bundleId);
    return value === undefined ? null : cloneJson(value);
  }

  /**
   * Returns one parsed queue snapshot for concise assertions.
   *
   * @param bundleId - Storage key
   * @returns Strict persisted queue snapshot
   */
  getSnapshot(bundleId: string): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(this.get(bundleId));
    if (!parsed.ok) {
      throw new Error("Test storage does not contain a valid queue snapshot");
    }
    return parsed.value;
  }

  /**
   * Plans one write failure, optionally simulating a concurrent storage change.
   *
   * @param error - Error thrown by the next write
   * @param beforeThrow - Optional concurrent mutation
   */
  planWriteFailure(error: Error, beforeThrow?: () => void): void {
    this.failures.push({ error, ...(beforeThrow ? { beforeThrow } : {}) });
  }

  /**
   * Reads detached unknown JSON.
   *
   * @param bundleId - Storage key
   * @returns Persisted JSON or null
   */
  async read(bundleId: string): Promise<unknown> {
    this.readCount += 1;
    return this.get(bundleId);
  }

  /**
   * Writes a complete snapshot only when the expected revision still matches.
   *
   * @param bundleId - Storage key
   * @param snapshot - Complete next queue revision
   * @param expectedRevision - Previously observed revision or null
   */
  async write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    this.writeAttempts += 1;
    const failure = this.failures.shift();
    if (failure) {
      failure.beforeThrow?.();
      throw failure.error;
    }

    const current = this.values.get(bundleId);
    if (expectedRevision === null) {
      if (current !== undefined) {
        const parsed = parseIngestQueueSnapshot(current);
        throw new IngestQueueRevisionConflictError(
          bundleId,
          null,
          parsed.ok ? parsed.value.revision : undefined
        );
      }
    } else {
      const parsed = parseIngestQueueSnapshot(current);
      if (!parsed.ok || parsed.value.revision !== expectedRevision) {
        throw new IngestQueueRevisionConflictError(
          bundleId,
          expectedRevision,
          parsed.ok ? parsed.value.revision : undefined
        );
      }
    }
    this.values.set(bundleId, cloneJson(snapshot));
    this.successfulWrites += 1;
  }
}

/** Mutable executor whose handler is replaceable between queue runs. */
class TestExecutor implements IngestExecutor {
  public readonly calls: IngestExecutionContext[] = [];

  /**
   * Creates a scripted executor.
   *
   * @param handler - Function invoked for each claimed job
   */
  constructor(
    public handler: (context: IngestExecutionContext) => Promise<IngestExecutionResult>
  ) {}

  /**
   * Records and delegates one execution.
   *
   * @param context - Claimed execution context
   * @returns Scripted result
   */
  async execute(context: IngestExecutionContext): Promise<IngestExecutionResult> {
    this.calls.push(context);
    return this.handler(context);
  }
}

/** Event sink that records notifications and may fail deliberately. */
class TestEventSink implements EventSink {
  public readonly events: IngestQueueEvent[] = [];
  public shouldThrow = false;
  public pending?: Promise<void>;

  /**
   * Records a post-commit event or simulates observer failure.
   *
   * @param event - Queue event
   */
  emit(event: IngestQueueEvent): void | Promise<void> {
    if (this.shouldThrow) {
      throw new Error("observer unavailable");
    }
    this.events.push(event);
    return this.pending;
  }
}

interface QueueHarness {
  storage: InMemoryQueueStorage;
  executor: TestExecutor;
  sink: TestEventSink;
  queue: IngestQueue;
  setNow(value: number): void;
}

/**
 * Creates a queue with deterministic ids, time, retry delays, and executor.
 *
 * @param handler - Optional scripted execution behavior
 * @param maxAttempts - Total execution bound
 * @returns Mutable queue test harness
 */
function createHarness(
  handler: (context: IngestExecutionContext) => Promise<IngestExecutionResult> = async () => ({
    kind: "completed",
    changeSetId: "changeset-1",
  }),
  maxAttempts = 3
): QueueHarness {
  const storage = new InMemoryQueueStorage();
  const executor = new TestExecutor(handler);
  const sink = new TestEventSink();
  let now = 100;
  let nextId = 1;
  const queue = new IngestQueue(storage, executor, {
    clock: () => now,
    jobIdFactory: () => `job-${nextId++}`,
    retryPolicy: new ExponentialRetryPolicy(
      { maxAttempts, baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0 },
      () => 0.5
    ),
    eventSink: sink,
  });
  return {
    storage,
    executor,
    sink,
    queue,
    setNow(value: number): void {
      now = value;
    },
  };
}

/**
 * Creates a standard enqueue request with optional exact input overrides.
 *
 * @param overrides - Request fields to replace
 * @returns Valid enqueue request
 */
function createRequest(
  overrides: Partial<{
    bundleId: string;
    sourceId: string;
    sourceContentHash: string;
    pipelineFingerprint: string;
    inputRevision: number;
  }> = {}
) {
  return {
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    ...overrides,
  };
}

describe("IngestQueue persistence and enqueue", () => {
  it("loads a missing queue without eagerly writing it", async () => {
    const { queue, storage } = createHarness();

    await expect(queue.load("personal")).resolves.toEqual(createSnapshot());
    expect(storage.writeAttempts).toBe(0);
  });

  it("fails closed for incompatible, mismatched, and malformed persisted JSON", async () => {
    const { queue, storage } = createHarness();
    storage.seed("versioned", { ...createSnapshot("versioned"), version: 2 });
    storage.seed("mismatch", createSnapshot("other"));
    storage.seed("malformed", { ...createSnapshot("malformed"), jobs: [{ status: "mystery" }] });

    await expect(queue.load("versioned")).rejects.toBeInstanceOf(
      IngestQueueIncompatibleVersionError
    );
    await expect(queue.load("mismatch")).rejects.toBeInstanceOf(IngestQueueBundleMismatchError);
    await expect(queue.load("malformed")).rejects.toBeInstanceOf(IngestQueueValidationError);
  });

  it("enqueues, deduplicates exact input, and updates unstarted input in place", async () => {
    const { queue, storage, setNow } = createHarness();

    const first = await queue.enqueue(createRequest());
    setNow(110);
    const duplicate = await queue.enqueue(createRequest());
    setNow(120);
    const updated = await queue.enqueue(
      createRequest({ sourceContentHash: HASH_C, inputRevision: 2 })
    );

    expect(first.kind).toBe("enqueued");
    expect(duplicate).toMatchObject({ kind: "deduplicated", job: { id: first.job.id } });
    expect(updated).toMatchObject({
      kind: "updated",
      job: { id: first.job.id, sourceContentHash: HASH_C, attempt: 0 },
    });
    expect(storage.getSnapshot("personal").jobs).toHaveLength(1);
    expect(storage.successfulWrites).toBe(2);
  });

  it("isolates queues by Bundle when product context switches", async () => {
    const { queue } = createHarness();
    await queue.enqueue(createRequest({ bundleId: "work", sourceId: "work-source" }));
    await queue.enqueue(createRequest({ bundleId: "personal", sourceId: "personal-source" }));

    expect((await queue.load("work")).jobs.map((job) => job.sourceId)).toEqual(["work-source"]);
    expect((await queue.load("personal")).jobs.map((job) => job.sourceId)).toEqual([
      "personal-source",
    ]);
  });
});

describe("IngestQueue execution and reruns", () => {
  it("persists forward stages and completes a claimed job", async () => {
    const harness = createHarness(async (context) => {
      await context.reportStage("analyzing");
      await context.reportStage("generating");
      await context.reportStage("validating");
      return { kind: "completed", changeSetId: "changeset-final" };
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toEqual({
      kind: "executed",
      jobId: "job-1",
      status: "completed",
    });

    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "completed",
      stage: "completed",
      attempt: 1,
      changeSetId: "changeset-final",
    });
    expect(harness.sink.events.map((event) => event.cause)).toEqual(
      expect.arrayContaining(["claim", "stage", "complete"])
    );
  });

  it("waits for review and promotes a latest rerun only after review completes", async () => {
    const deferred = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return deferred.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;

    harness.setNow(110);
    const firstRerun = await harness.queue.enqueue(
      createRequest({ sourceContentHash: HASH_C, inputRevision: 2 })
    );
    harness.setNow(120);
    const latestRerun = await harness.queue.enqueue(
      createRequest({ sourceContentHash: HASH_D, inputRevision: 3 })
    );

    expect(firstRerun.kind).toBe("rerun_scheduled");
    expect(latestRerun.kind).toBe("rerun_scheduled");
    const whileRunning = harness.storage.getSnapshot("personal");
    expect(whileRunning.reruns).toHaveLength(1);
    expect(whileRunning.reruns[0]).toMatchObject({
      jobId: "job-2",
      sourceContentHash: HASH_D,
    });

    deferred.resolve({ kind: "awaiting_review", changeSetId: "changeset-review" });
    await expect(running).resolves.toMatchObject({ status: "awaiting_review" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ status: "awaiting_review", rerunRequested: true })],
      reruns: [expect.objectContaining({ sourceContentHash: HASH_D })],
    });

    harness.setNow(130);
    await harness.queue.completeReview("personal", "job-1");
    const reviewed = harness.storage.getSnapshot("personal");
    expect(reviewed.reruns).toEqual([]);
    expect(reviewed.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-1", status: "completed" }),
        expect.objectContaining({
          id: "job-2",
          status: "pending",
          sourceContentHash: HASH_D,
          attempt: 0,
        }),
      ])
    );
  });

  it("promotes exactly one latest rerun after direct completion", async () => {
    const deferred = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return deferred.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_D, inputRevision: 3 }));

    deferred.resolve({ kind: "completed", changeSetId: "changeset-old" });
    await running;

    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot.reruns).toEqual([]);
    expect(snapshot.jobs.filter((job) => job.status === "pending")).toEqual([
      expect.objectContaining({ id: "job-2", sourceContentHash: HASH_D }),
    ]);
  });

  it("removes a queued rerun when the latest input reverts to the active version", async () => {
    const deferred = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return deferred.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));

    await expect(harness.queue.enqueue(createRequest({ inputRevision: 3 }))).resolves.toMatchObject(
      {
        kind: "updated",
      }
    );
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ status: "processing", rerunRequested: false })],
      reruns: [],
    });

    deferred.resolve({ kind: "completed", changeSetId: "changeset-reverted" });
    await running;
    expect(
      harness.storage.getSnapshot("personal").jobs.filter((job) => job.status === "pending")
    ).toEqual([]);
  });

  it("promotes the latest rerun when its processing predecessor fails", async () => {
    const failure = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return failure.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));

    failure.reject(
      new IngestExecutorError({
        code: "invalid_output",
        message: "Compiler output was invalid",
        retryable: false,
        rateLimited: false,
      })
    );
    await expect(running).resolves.toMatchObject({ status: "failed" });
    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot.reruns).toEqual([]);
    expect(snapshot.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-1", status: "failed" }),
        expect.objectContaining({ id: "job-2", status: "pending", inputRevision: 2 }),
      ])
    );
  });

  it("fails closed when an executor reports a backwards stage", async () => {
    const harness = createHarness(async (context) => {
      await context.reportStage("generating");
      await context.reportStage("analyzing");
      return { kind: "completed", changeSetId: "unreachable" };
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "failed",
    });
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "failed",
      failure: {
        code: "unexpected_executor_failure",
        message: "The ingest executor failed without safe structured details",
        retryable: false,
      },
    });
  });
});

describe("IngestQueue retries and rate limits", () => {
  it("schedules deterministic exponential retry and honors nextAttemptAt", async () => {
    let call = 0;
    const harness = createHarness(async () => {
      call += 1;
      if (call === 1) {
        throw new IngestExecutorError({
          code: "provider_timeout",
          message: "Provider timed out",
          retryable: true,
          rateLimited: false,
        });
      }
      return { kind: "completed", changeSetId: "changeset-after-retry" };
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({ status: "pending" });
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "pending",
      attempt: 1,
      nextAttemptAt: 1_100,
    });
    await expect(harness.queue.runNext("personal")).resolves.toEqual({
      kind: "waiting",
      nextAttemptAt: 1_100,
    });

    harness.setNow(1_100);
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.executor.calls).toHaveLength(2);
  });

  it("terminates after the configured total execution bound", async () => {
    const harness = createHarness(async () => {
      throw new IngestExecutorError({
        code: "temporary",
        message: "Still unavailable",
        retryable: true,
        rateLimited: false,
      });
    }, 2);
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    harness.setNow(1_100);

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({ status: "failed" });
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "failed",
      attempt: 2,
    });
  });

  it("pauses the queue on an explicit provider rate limit until user resume", async () => {
    let rateLimited = true;
    const harness = createHarness(async () => {
      if (rateLimited) {
        throw new IngestExecutorError({
          code: "provider_rate_limit",
          message: "Provider requested a pause",
          retryable: true,
          rateLimited: true,
          retryAfterMs: 500,
        });
      }
      return { kind: "completed", changeSetId: "changeset-resumed" };
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({ status: "paused" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "rate_limit", resumeAt: 600 },
      jobs: [expect.objectContaining({ status: "paused", stage: "parsing" })],
    });
    await expect(harness.queue.runNext("personal")).resolves.toEqual({
      kind: "paused",
      reason: "rate_limit",
    });

    rateLimited = false;
    harness.setNow(200);
    await harness.queue.resume("personal");
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("sanitizes unknown executor errors instead of persisting their message", async () => {
    const harness = createHarness(async () => {
      throw new Error("secret provider payload");
    });
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");

    const serialized = JSON.stringify(harness.storage.getSnapshot("personal"));
    expect(serialized).not.toContain("secret provider payload");
    expect(serialized).toContain("unexpected_executor_failure");
  });

  it("sanitizes malformed or credential-bearing typed executor failures", async () => {
    let call = 0;
    const harness = createHarness(async () => {
      call += 1;
      if (call === 1) {
        throw new IngestExecutorError({
          code: 42,
          message: "Malformed adapter payload",
          retryable: true,
          rateLimited: false,
        } as never);
      }
      throw new IngestExecutorError({
        code: "provider_error",
        message: "authorization=Bearer sk-examplecredential123",
        retryable: false,
        rateLimited: false,
      });
    });
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    let serialized = JSON.stringify(harness.storage.getSnapshot("personal"));
    expect(serialized).toContain("unexpected_executor_failure");
    expect(serialized).not.toContain("Malformed adapter payload");

    await harness.queue.enqueue(createRequest({ inputRevision: 2 }));
    await harness.queue.runNext("personal");
    serialized = JSON.stringify(harness.storage.getSnapshot("personal"));
    expect(serialized).not.toContain("sk-examplecredential123");
  });
});

describe("IngestQueue pause, cancellation, review, and recovery", () => {
  it("aborts active non-applying work only after persisting a paused state", async () => {
    const started = createDeferred<void>();
    const harness = createHarness(async (context) => {
      await context.reportStage("generating");
      started.resolve();
      return new Promise<IngestExecutionResult>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;

    harness.setNow(120);
    await harness.queue.pause("personal", "User paused ingestion");
    await expect(running).resolves.toMatchObject({ status: "paused" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ status: "paused", stage: "generating" })],
    });

    await harness.queue.resume("personal");
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [expect.objectContaining({ status: "pending", stage: "queued" })],
    });
  });

  it("cancels active work, ignores its late rejection, and never exposes file deletion", async () => {
    const started = createDeferred<void>();
    const harness = createHarness(async (context) => {
      started.resolve();
      return new Promise<IngestExecutionResult>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));

    const cancelled = await harness.queue.cancel("personal", "job-1");
    expect(cancelled.status).toBe("cancelled");
    await expect(running).resolves.toEqual({
      kind: "executed",
      jobId: "job-1",
      status: "cancelled",
    });
    expect(Object.keys(harness.executor.calls[0])).toEqual(
      expect.arrayContaining(["job", "signal", "reportStage"])
    );
    expect(Object.keys(harness.executor.calls[0])).not.toContain("delete");
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ status: "cancelled", rerunRequested: false })],
      reruns: [],
    });
  });

  it("cancels pending and review jobs but fails closed at the applying boundary", async () => {
    const pendingHarness = createHarness();
    await pendingHarness.queue.enqueue(createRequest());
    await expect(pendingHarness.queue.cancel("personal", "job-1")).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(pendingHarness.executor.calls).toHaveLength(0);

    const reviewHarness = createHarness(async () => ({
      kind: "awaiting_review",
      changeSetId: "changeset-review",
    }));
    await reviewHarness.queue.enqueue(createRequest());
    await reviewHarness.queue.runNext("personal");
    await expect(reviewHarness.queue.cancel("personal", "job-1")).resolves.toMatchObject({
      status: "cancelled",
    });

    const applying = createDeferred<IngestExecutionResult>();
    const applyingStarted = createDeferred<void>();
    const applyHarness = createHarness(async (context) => {
      await context.reportStage("applying");
      applyingStarted.resolve();
      return applying.promise;
    });
    await applyHarness.queue.enqueue(createRequest());
    const running = applyHarness.queue.runNext("personal");
    await applyingStarted.promise;
    await expect(applyHarness.queue.cancel("personal", "job-1")).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );
    applying.resolve({ kind: "completed", changeSetId: "changeset-applied" });
    await running;
  });

  it("pauses only the gate during applying and lets the safe boundary finish", async () => {
    const applying = createDeferred<IngestExecutionResult>();
    const applyingStarted = createDeferred<AbortSignal>();
    const harness = createHarness(async (context) => {
      await context.reportStage("applying");
      applyingStarted.resolve(context.signal);
      return applying.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    const signal = await applyingStarted.promise;

    await harness.queue.pause("personal", "Pause after safe apply");
    expect(signal.aborted).toBe(false);
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ status: "processing", stage: "applying" })],
    });

    applying.resolve({ kind: "completed", changeSetId: "changeset-safe-apply" });
    await expect(running).resolves.toMatchObject({ status: "completed" });
    expect(harness.storage.getSnapshot("personal").control.status).toBe("paused");
  });

  it("rejects illegal review and explicit retry transitions", async () => {
    const harness = createHarness();
    await harness.queue.enqueue(createRequest());
    await expect(harness.queue.completeReview("personal", "job-1")).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );

    harness.executor.handler = async () => {
      throw new IngestExecutorError({
        code: "invalid_source",
        message: "Source is invalid",
        retryable: false,
        rateLimited: false,
      });
    };
    await harness.queue.runNext("personal");
    await expect(harness.queue.retryFailed("personal", "job-1")).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );
  });

  it("allows an explicit retry of a retryable failed job with a fresh attempt budget", async () => {
    const harness = createHarness(async () => {
      throw new IngestExecutorError({
        code: "temporary",
        message: "Temporary failure",
        retryable: true,
        rateLimited: false,
      });
    }, 1);
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");

    harness.setNow(200);
    await expect(harness.queue.retryFailed("personal", "job-1")).resolves.toMatchObject({
      status: "pending",
      attempt: 0,
    });
  });

  it("recovers processing to pending, pauses backlog, and is idempotent", async () => {
    const harness = createHarness();
    const processing: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      updatedAt: 110,
      status: "processing",
      stage: "analyzing",
      startedAt: 110,
    };
    harness.storage.seed(
      "personal",
      createSnapshot("personal", { revision: 4, jobs: [processing] })
    );
    harness.setNow(200);

    const recovered = await harness.queue.recoverOnStartup("personal");
    expect(recovered).toMatchObject({
      revision: 5,
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending", attempt: 1 })],
    });
    await expect(harness.queue.runNext("personal")).resolves.toEqual({
      kind: "paused",
      reason: "startup_recovery",
    });
    const again = await harness.queue.recoverOnStartup("personal");
    expect(again.revision).toBe(5);

    await harness.queue.resume("personal");
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("pauses an existing pending backlog on clean startup", async () => {
    const harness = createHarness();
    harness.storage.seed(
      "personal",
      createSnapshot("personal", { revision: 2, jobs: [createPendingJob()] })
    );

    await expect(harness.queue.recoverOnStartup("personal")).resolves.toMatchObject({
      revision: 3,
      control: { status: "paused", reason: "startup_recovery" },
    });
    expect(harness.executor.calls).toHaveLength(0);
  });

  it("fails closed and keeps a sticky recovery gate after interrupted applying", async () => {
    const harness = createHarness();
    const applying: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      updatedAt: 110,
      status: "processing",
      stage: "applying",
      startedAt: 110,
    };
    harness.storage.seed("personal", createSnapshot("personal", { revision: 4, jobs: [applying] }));
    harness.setNow(200);

    const recovered = await harness.queue.recoverOnStartup("personal");
    expect(recovered.control).toMatchObject({ status: "paused", reason: "recovery_required" });
    expect(recovered.jobs[0]).toMatchObject({ status: "failed", stage: "applying" });
    const failed = recovered.jobs[0];
    if (failed.status !== "failed") {
      throw new Error("Expected interrupted apply to become a failed job");
    }
    expect(failed.failure.code).toBe("interrupted_apply_requires_recovery");
    await harness.queue.pause("personal", "Cannot bypass recovery");
    await expect(harness.queue.resume("personal")).rejects.toBeInstanceOf(
      IngestQueueRecoveryRequiredError
    );
  });
});

describe("IngestQueue concurrency and adapter failures", () => {
  it("replays an enqueue after CAS conflict and preserves concurrent Bundle work", async () => {
    const harness = createHarness();
    const concurrentJob = createPendingJob({
      id: "external-job",
      sourceId: "external-source",
      sourceContentHash: HASH_C,
    });
    harness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", null, 1),
      () => {
        harness.storage.seed(
          "personal",
          createSnapshot("personal", { revision: 1, jobs: [concurrentJob] })
        );
      }
    );

    await harness.queue.enqueue(createRequest());
    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot.revision).toBe(2);
    expect(snapshot.jobs.map((job) => job.sourceId)).toEqual(
      expect.arrayContaining(["external-source", "source-1"])
    );
  });

  it("exhausts bounded conflicts and never retries an unrelated I/O failure", async () => {
    const conflictHarness = createHarness();
    conflictHarness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", null)
    );
    conflictHarness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", null)
    );
    conflictHarness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", null)
    );
    await expect(conflictHarness.queue.enqueue(createRequest())).rejects.toBeInstanceOf(
      IngestQueueWriteConflictExhaustedError
    );
    expect(conflictHarness.storage.writeAttempts).toBe(3);

    const ioHarness = createHarness();
    ioHarness.storage.planWriteFailure(new Error("disk full"));
    await expect(ioHarness.queue.enqueue(createRequest())).rejects.toThrow("disk full");
    expect(ioHarness.storage.writeAttempts).toBe(1);
    expect(ioHarness.storage.get("personal")).toBeNull();
  });

  it("fails closed for revision overflow and generated id collisions", async () => {
    const overflowHarness = createHarness();
    overflowHarness.storage.seed(
      "personal",
      createSnapshot("personal", { revision: Number.MAX_SAFE_INTEGER })
    );
    await expect(overflowHarness.queue.enqueue(createRequest())).rejects.toBeInstanceOf(
      IngestQueueRevisionOverflowError
    );

    const collisionHarness = createHarness();
    const completed: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      status: "completed",
      stage: "completed",
      changeSetId: "changeset-old",
      completedAt: 100,
    };
    collisionHarness.storage.seed(
      "personal",
      createSnapshot("personal", { revision: 1, jobs: [completed] })
    );
    await expect(
      collisionHarness.queue.enqueue(createRequest({ sourceId: "source-2" }))
    ).rejects.toBeInstanceOf(IngestQueueJobIdConflictError);
  });

  it("keeps persisted state authoritative when the event observer fails", async () => {
    const harness = createHarness();
    harness.sink.shouldThrow = true;

    await expect(harness.queue.enqueue(createRequest())).resolves.toMatchObject({
      kind: "enqueued",
    });
    expect(harness.storage.getSnapshot("personal").jobs).toHaveLength(1);
  });

  it("does not let a never-settling event observer block execution", async () => {
    const harness = createHarness();
    harness.sink.pending = new Promise<void>(() => undefined);
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.executor.calls).toHaveLength(1);
  });

  it("recovers the live queue after finalization storage fails", async () => {
    const completion = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return completion.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    harness.storage.planWriteFailure(new Error("finalization disk failure"));
    completion.resolve({ kind: "completed", changeSetId: "changeset-ambiguous" });

    await expect(running).rejects.toThrow("finalization disk failure");
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending" })],
    });

    await harness.queue.resume("personal");
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("keeps stage persistence failures out of provider failure history and recovers", async () => {
    const started = createDeferred<void>();
    const proceed = createDeferred<void>();
    const harness = createHarness(async (context) => {
      started.resolve();
      await proceed.promise;
      await context.reportStage("analyzing");
      return { kind: "completed", changeSetId: "unreachable" };
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    harness.storage.planWriteFailure(new Error("stage disk failure"));
    proceed.resolve();

    await expect(running).rejects.toBeInstanceOf(IngestQueueInfrastructureError);
    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending" })],
    });
    expect(JSON.stringify(snapshot)).not.toContain("unexpected_executor_failure");
  });

  it("keeps the greatest durable input revision across stale same-source work", async () => {
    const harness = createHarness();
    await harness.queue.enqueue(createRequest());
    await harness.queue.enqueue(createRequest({ inputRevision: 3 }));

    await expect(
      harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }))
    ).resolves.toMatchObject({ kind: "deduplicated" });
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      sourceContentHash: HASH_A,
      inputRevision: 3,
    });
    await expect(
      harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 3 }))
    ).rejects.toBeInstanceOf(IngestQueueObservationConflictError);
  });

  it("does not let an older same-source CAS replay replace a newer persisted input", async () => {
    const harness = createHarness();
    const newer = createPendingJob({
      id: "external-job",
      sourceContentHash: HASH_C,
      inputRevision: 2,
      createdAt: 110,
      updatedAt: 110,
    });
    harness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", null, 1),
      () => {
        harness.storage.seed(
          "personal",
          createSnapshot("personal", { revision: 1, jobs: [newer] })
        );
      }
    );

    await expect(harness.queue.enqueue(createRequest())).resolves.toMatchObject({
      kind: "deduplicated",
      job: { id: "external-job", inputRevision: 2 },
    });
    expect(harness.storage.getSnapshot("personal").jobs[0].sourceContentHash).toBe(HASH_C);
  });

  it("allows two queue instances to claim a pending job only once", async () => {
    const storage = new InMemoryQueueStorage();
    const started = createDeferred<void>();
    const completion = createDeferred<IngestExecutionResult>();
    const firstExecutor = new TestExecutor(async () => {
      started.resolve();
      return completion.promise;
    });
    const secondExecutor = new TestExecutor(async () => ({
      kind: "completed",
      changeSetId: "should-not-run",
    }));
    let nextId = 1;
    const options = {
      clock: () => 100,
      jobIdFactory: () => `job-${nextId++}`,
      retryPolicy: new ExponentialRetryPolicy(
        { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
        () => 0.5
      ),
    };
    const first = new IngestQueue(storage, firstExecutor, options);
    const second = new IngestQueue(storage, secondExecutor, options);
    await first.enqueue(createRequest());

    const running = first.runNext("personal");
    await started.promise;
    await expect(second.runNext("personal")).resolves.toEqual({
      kind: "busy",
      jobId: "job-1",
    });
    expect(secondExecutor.calls).toHaveLength(0);
    completion.resolve({ kind: "completed", changeSetId: "changeset-first" });
    await running;
  });

  it("marks a late cross-instance attempt stale after a resumed attempt completes", async () => {
    const storage = new InMemoryQueueStorage();
    const oldStarted = createDeferred<void>();
    const oldCompletion = createDeferred<IngestExecutionResult>();
    const oldExecutor = new TestExecutor(async () => {
      oldStarted.resolve();
      return oldCompletion.promise;
    });
    const newExecutor = new TestExecutor(async () => ({
      kind: "completed",
      changeSetId: "changeset-new-attempt",
    }));
    let nextId = 1;
    const options = {
      clock: () => 100,
      jobIdFactory: () => `job-${nextId++}`,
      retryPolicy: new ExponentialRetryPolicy(
        { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
        () => 0.5
      ),
    };
    const oldQueue = new IngestQueue(storage, oldExecutor, options);
    const newQueue = new IngestQueue(storage, newExecutor, options);
    await oldQueue.enqueue(createRequest());
    const oldRun = oldQueue.runNext("personal");
    await oldStarted.promise;

    await newQueue.pause("personal", "Move work to a new coordinator");
    await newQueue.resume("personal");
    await expect(newQueue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
    oldCompletion.resolve({ kind: "completed", changeSetId: "changeset-old-attempt" });
    await expect(oldRun).resolves.toEqual({ kind: "stale", jobId: "job-1" });
    expect(storage.getSnapshot("personal").jobs[0]).toMatchObject({
      attempt: 2,
      changeSetId: "changeset-new-attempt",
    });
  });
});
