import {
  IngestExecutorError,
  IngestExecutionClaim,
  IngestQueue,
  IngestQueueApplyCommitConflictError,
  IngestQueueApplyCommitPendingError,
  IngestQueueApplyReceiptRequiredError,
  IngestQueueBundleMismatchError,
  IngestQueueClosedError,
  IngestQueueIncompatibleVersionError,
  IngestQueueInfrastructureError,
  IngestQueueJobIdConflictError,
  IngestQueueJobNotFoundError,
  IngestQueueObservationConflictError,
  IngestQueueRecoveryRequiredError,
  IngestQueueReviewBundleMismatchError,
  IngestQueueRevisionOverflowError,
  IngestQueueStartupReleaseRequiredError,
  IngestQueueTransitionError,
  IngestQueueValidationError,
  IngestQueueWriteConflictExhaustedError,
  type EventSink,
  type IngestExecutionContext,
  type IngestExecutionResult,
  type IngestExecutor,
  type IngestAcceptedReviewDecisionReceipt,
  type IngestPendingReviewDecisionReceipt,
  type IngestQueueEvent,
  type IngestRejectedReviewDecisionReceipt,
  type IngestReviewDecisionJobClaim,
} from "@/knowledge/ingest/queue/IngestQueue";
import type { TransactionCommitReceipt } from "@/knowledge/changeset/ChangeSetTransaction";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestApplyClaimMarker,
  type IngestQueueSnapshot,
  type IngestRerunRequest,
  type IngestSourceHighWatermark,
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
 * Derives one highest source observation for a synthetic test snapshot.
 *
 * @param jobs - Durable test jobs
 * @param reruns - Durable test rerun payloads
 * @returns One high-watermark per represented source
 */
function deriveTestHighWatermarks(
  jobs: readonly KnowledgeIngestJob[],
  reruns: readonly IngestRerunRequest[]
): IngestSourceHighWatermark[] {
  const values = new Map<string, IngestSourceHighWatermark>();
  for (const record of [...jobs, ...reruns]) {
    const current = values.get(record.sourceId);
    if (!current || record.inputRevision > current.inputRevision) {
      values.set(record.sourceId, {
        sourceId: record.sourceId,
        sourceContentHash: record.sourceContentHash,
        pipelineFingerprint: record.pipelineFingerprint,
        inputRevision: record.inputRevision,
        observedAt: record.updatedAt,
      });
    }
  }
  return [...values.values()];
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
  const jobs = overrides.jobs ?? [];
  const reruns = overrides.reruns ?? [];
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision: 0,
    control: { status: "running" },
    jobs,
    reruns,
    ...overrides,
    sourceHighWatermarks: overrides.sourceHighWatermarks ?? deriveTestHighWatermarks(jobs, reruns),
    pendingReviews: overrides.pendingReviews ?? [],
    reviewRejections: overrides.reviewRejections ?? [],
    applyAbandonments: overrides.applyAbandonments ?? [],
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
  public readBarrier?: Promise<void>;
  public onRead?: () => void;

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
    this.onRead?.();
    await this.readBarrier;
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
    kind: "no_changes",
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

/**
 * Creates the exact queue attempt retained by a durable review record.
 *
 * @param overrides - Claim fields to replace
 * @returns Strict review job claim
 */
function createReviewJobClaim(
  overrides: Partial<IngestReviewDecisionJobClaim> = {}
): IngestReviewDecisionJobClaim {
  return {
    jobId: "job-1",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    ...overrides,
  };
}

type PendingReviewDecisionOverrides = Omit<
  Partial<IngestPendingReviewDecisionReceipt>,
  "jobClaim"
> & {
  jobClaim?: Partial<IngestReviewDecisionJobClaim>;
};

/**
 * Creates one durable pending Review Store receipt.
 *
 * @param overrides - Receipt and nested claim fields to replace
 * @returns Strict pending decision receipt
 */
function createPendingReviewDecision(
  overrides: PendingReviewDecisionOverrides = {}
): IngestPendingReviewDecisionReceipt {
  const { jobClaim, ...receiptOverrides } = overrides;
  return {
    outcome: "pending",
    bundleId: "personal",
    changeSetId: "changeset-review",
    proposalDigest: HASH_C,
    recordRevision: 0,
    recordedAt: 110,
    ...receiptOverrides,
    jobClaim: createReviewJobClaim(jobClaim),
  };
}

/**
 * Creates an executor outcome whose proposal is already durable in Review Store.
 *
 * @param overrides - Pending receipt fields to replace
 * @returns Strict awaiting-review executor result
 */
function createAwaitingReviewResult(
  overrides: PendingReviewDecisionOverrides = {}
): IngestExecutionResult {
  const reviewDecision = createPendingReviewDecision(overrides);
  return { kind: "awaiting_review", changeSetId: reviewDecision.changeSetId, reviewDecision };
}

type AcceptedReviewDecisionOverrides = Omit<
  Partial<IngestAcceptedReviewDecisionReceipt>,
  "jobClaim"
> & {
  jobClaim?: Partial<IngestReviewDecisionJobClaim>;
};

/**
 * Creates one terminal accepted Review Store receipt.
 *
 * @param overrides - Receipt and nested claim fields to replace
 * @returns Strict accepted decision receipt
 */
function createAcceptedReviewDecision(
  overrides: AcceptedReviewDecisionOverrides = {}
): IngestAcceptedReviewDecisionReceipt {
  const { jobClaim, ...receiptOverrides } = overrides;
  return {
    outcome: "accepted",
    bundleId: "personal",
    changeSetId: "changeset-review",
    proposalDigest: HASH_C,
    recordRevision: 1,
    acceptedDigest: HASH_D,
    manifestCommitIntentDigest: HASH_A,
    acceptedAt: 120,
    ...receiptOverrides,
    jobClaim: createReviewJobClaim(jobClaim),
  };
}

type RejectedReviewDecisionOverrides = Omit<
  Partial<IngestRejectedReviewDecisionReceipt>,
  "jobClaim"
> & {
  jobClaim?: Partial<IngestReviewDecisionJobClaim>;
};

/**
 * Creates one terminal rejected Review Store receipt.
 *
 * @param overrides - Receipt and nested claim fields to replace
 * @returns Strict rejected decision receipt
 */
function createRejectedReviewDecision(
  overrides: RejectedReviewDecisionOverrides = {}
): IngestRejectedReviewDecisionReceipt {
  const { jobClaim, ...receiptOverrides } = overrides;
  return {
    outcome: "rejected",
    bundleId: "personal",
    changeSetId: "changeset-review",
    proposalDigest: HASH_C,
    recordRevision: 1,
    rejectedAt: 120,
    ...receiptOverrides,
    jobClaim: createReviewJobClaim(jobClaim),
  };
}

/**
 * Creates one valid committed ChangeSet receipt for queue reconciliation tests.
 *
 * @param overrides - Receipt fields to replace
 * @returns Durable transaction commit proof
 */
type CommitReceiptOverrides = Omit<Partial<TransactionCommitReceipt>, "jobClaim"> & {
  jobClaim?: Partial<TransactionCommitReceipt["jobClaim"]>;
};

function createCommitReceipt(overrides: CommitReceiptOverrides = {}): TransactionCommitReceipt {
  const { jobClaim, ...receiptOverrides } = overrides;
  return {
    transactionId: "transaction-1",
    commitRevision: 4,
    bundleId: "personal",
    changeSetId: "changeset-committed",
    changeSetDigest: HASH_D,
    jobClaim: {
      jobId: "job-1",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
      startedAt: 100,
      ...jobClaim,
    },
    committedAt: 120,
    targets: [{ path: "Wiki/Page.md", kind: "file", contentHash: HASH_C }],
    ...receiptOverrides,
  };
}

/**
 * Creates the exact queue claim persisted at the applying boundary.
 *
 * @param overrides - Claim fields to replace
 * @returns Durable apply claim marker
 */
function createApplyClaimMarker(
  overrides: Partial<IngestApplyClaimMarker> = {}
): IngestApplyClaimMarker {
  return {
    jobId: "job-1",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    startedAt: 110,
    ...overrides,
  };
}

describe("IngestQueue persistence and enqueue", () => {
  it("loads a missing queue without eagerly writing it", async () => {
    const { queue, storage } = createHarness();

    await expect(queue.load("personal")).resolves.toEqual(createSnapshot());
    expect(storage.writeAttempts).toBe(0);
  });

  it("loads version 3 reviewed apply state as fail-closed current provenance", async () => {
    const harness = createHarness();
    const applying: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      status: "processing",
      stage: "applying",
      startedAt: 110,
      updatedAt: 110,
    };
    const current = createSnapshot("personal", {
      revision: 4,
      jobs: [applying],
      applyClaim: createApplyClaimMarker({
        reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
      }),
    });
    const { applyAbandonments: _applyAbandonments, ...legacyCurrent } = current;
    void _applyAbandonments;
    harness.storage.seed("personal", {
      ...legacyCurrent,
      version: 3,
      applyClaim: {
        ...current.applyClaim,
        acceptedReview: { proposalDigest: HASH_D, recordRevision: 1, acceptedAt: 105 },
      },
    });

    await expect(harness.queue.load("personal")).resolves.toMatchObject({
      version: INGEST_QUEUE_VERSION,
      applyClaim: {
        reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
        legacyReview: { kind: "legacy_unverified", migratedFromVersion: 3 },
      },
    });
  });

  it("fails closed for incompatible, mismatched, and malformed persisted JSON", async () => {
    const { queue, storage } = createHarness();
    storage.seed("versioned", { ...createSnapshot("versioned"), version: 6 });
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
  it("synchronously aborts active lifecycle work and recovers it behind startup release", async () => {
    const entered = createDeferred<void>();
    const outcome = createDeferred<IngestExecutionResult>();
    let signal: AbortSignal | undefined;
    const harness = createHarness(async (context) => {
      signal = context.signal;
      entered.resolve();
      return outcome.promise;
    });
    await harness.queue.enqueue(createRequest());

    const running = harness.queue.runNext("personal");
    await entered.promise;
    harness.queue.close();
    harness.queue.close();

    expect(signal?.aborted).toBe(true);
    outcome.reject(new DOMException("aborted", "AbortError"));
    await expect(running).resolves.toEqual({
      kind: "executed",
      jobId: "job-1",
      status: "pending",
    });
    await expect(harness.queue.load("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [{ id: "job-1", status: "pending", stage: "queued", attempt: 1 }],
    });
    await expect(harness.queue.enqueue(createRequest({ inputRevision: 2 }))).rejects.toBeInstanceOf(
      IngestQueueClosedError
    );
    await expect(harness.queue.runNext("personal")).rejects.toBeInstanceOf(IngestQueueClosedError);
  });

  it("does not let a closing lifecycle worker recover a newer cross-instance claim", async () => {
    const storage = new InMemoryQueueStorage();
    const oldStarted = createDeferred<void>();
    const oldOutcome = createDeferred<IngestExecutionResult>();
    const newStarted = createDeferred<void>();
    const newOutcome = createDeferred<IngestExecutionResult>();
    const oldExecutor = new TestExecutor(async () => {
      oldStarted.resolve();
      return oldOutcome.promise;
    });
    const newExecutor = new TestExecutor(async () => {
      newStarted.resolve();
      return newOutcome.promise;
    });
    let now = 100;
    let nextId = 1;
    const options = {
      clock: () => now,
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
    oldQueue.close();

    now = 150;
    await newQueue.recoverOnStartup("personal");
    const recovered = storage.getSnapshot("personal");
    storage.seed("personal", {
      ...recovered,
      revision: recovered.revision + 1,
      control: { status: "running" },
    });
    now = 200;
    const newRun = newQueue.runNext("personal");
    await newStarted.promise;

    oldOutcome.reject(new DOMException("aborted", "AbortError"));
    await expect(oldRun).resolves.toEqual({ kind: "stale", jobId: "job-1" });
    expect(storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [{ id: "job-1", status: "processing", attempt: 2, startedAt: 200 }],
    });

    newOutcome.resolve({ kind: "no_changes", changeSetId: "changeset-new-generation" });
    await expect(newRun).resolves.toMatchObject({ status: "completed" });
  });

  it("requires startedAt as well as attempt before lifecycle recovery mutates a claim", async () => {
    const entered = createDeferred<void>();
    const outcome = createDeferred<IngestExecutionResult>();
    const harness = createHarness(async () => {
      entered.resolve();
      return outcome.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await entered.promise;
    harness.queue.close();

    const claimed = harness.storage.getSnapshot("personal");
    const processing = claimed.jobs[0];
    if (processing.status !== "processing") throw new Error("Expected a processing claim");
    harness.storage.seed("personal", {
      ...claimed,
      revision: claimed.revision + 1,
      jobs: [{ ...processing, updatedAt: 200, startedAt: 200 }],
    });
    outcome.reject(new DOMException("aborted", "AbortError"));

    await expect(running).resolves.toEqual({ kind: "stale", jobId: "job-1" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [{ id: "job-1", status: "processing", attempt: 1, startedAt: 200 }],
    });
  });

  it("protects applying work from lifecycle abort until commit proof is returned", async () => {
    const enteredApplying = createDeferred<void>();
    const outcome = createDeferred<IngestExecutionResult>();
    let signal: AbortSignal | undefined;
    const harness = createHarness(async (context) => {
      signal = context.signal;
      await context.reportStage("applying");
      enteredApplying.resolve();
      return outcome.promise;
    });
    await harness.queue.enqueue(createRequest());

    const running = harness.queue.runNext("personal");
    await enteredApplying.promise;
    harness.queue.close();

    expect(signal?.aborted).toBe(false);
    outcome.resolve({
      kind: "completed",
      changeSetId: "changeset-committed",
      commitReceipt: createCommitReceipt(),
    });
    await expect(running).resolves.toMatchObject({
      kind: "commit_ready",
      jobId: "job-1",
    });
    expect(signal?.aborted).toBe(false);
  });

  it("issues an opaque claim for the exact Queue controller and revokes it after execution", async () => {
    let captured: IngestExecutionClaim | undefined;
    let capturedContext: IngestExecutionContext | undefined;
    const harness = createHarness(async (context) => {
      captured = context.executionClaim;
      capturedContext = context;
      IngestExecutionClaim.assert(context.executionClaim);
      expect(context.executionClaim.getJob()).toBe(context.job);
      expect(context.executionClaim.getSignal()).toBe(context.signal);
      expect(context.executionClaim.isCurrent()).toBe(true);
      expect(
        context.executionClaim.matchesExecutionContext(
          context.job,
          context.signal,
          context.reportStage
        )
      ).toBe(true);
      expect(
        context.executionClaim.matchesExecutionContext(
          { ...context.job },
          context.signal,
          context.reportStage
        )
      ).toBe(false);
      expect(
        context.executionClaim.matchesExecutionContext(
          context.job,
          context.signal,
          async () => undefined
        )
      ).toBe(false);
      expect(Object.keys(context.executionClaim)).toEqual([]);
      expect(Object.isFrozen(context.executionClaim)).toBe(true);
      expect(() => IngestExecutionClaim.assert({ ...context.executionClaim })).toThrow(TypeError);
      expect(() =>
        IngestExecutionClaim.assert(Object.create(IngestExecutionClaim.prototype))
      ).toThrow(TypeError);
      expect(() => new IngestExecutionClaim(Symbol("forged"))).toThrow(TypeError);
      return { kind: "no_changes", changeSetId: "changeset-final" };
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });

    expect(captured).toBeDefined();
    expect(captured?.isCurrent()).toBe(false);
    if (!capturedContext) throw new Error("Expected the issued execution context");
    expect(
      captured?.matchesExecutionContext(
        capturedContext.job,
        capturedContext.signal,
        capturedContext.reportStage
      )
    ).toBe(false);
  });

  it("revokes the execution claim before durable finalization begins", async () => {
    const finalizationReadStarted = createDeferred<void>();
    const releaseFinalizationRead = createDeferred<void>();
    let captured: IngestExecutionClaim | undefined;
    let retainedReporter: IngestExecutionContext["reportStage"] | undefined;
    let harness: QueueHarness;
    harness = createHarness(async (context) => {
      captured = context.executionClaim;
      retainedReporter = context.reportStage;
      harness.storage.onRead = () => finalizationReadStarted.resolve();
      harness.storage.readBarrier = releaseFinalizationRead.promise;
      return { kind: "no_changes", changeSetId: "changeset-finalization-boundary" };
    });
    await harness.queue.enqueue(createRequest());

    let settled = false;
    const running = harness.queue.runNext("personal").finally(() => {
      settled = true;
    });
    await finalizationReadStarted.promise;

    expect(captured).toBeDefined();
    expect(captured?.isCurrent()).toBe(false);
    expect(settled).toBe(false);
    if (!retainedReporter) throw new Error("Expected a retained stage reporter");
    await expect(retainedReporter("analyzing")).rejects.toMatchObject({ name: "AbortError" });

    releaseFinalizationRead.resolve();
    await expect(running).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
  });

  it("revokes the execution claim before inspecting an executor result", async () => {
    let currentDuringResultInspection: boolean | undefined;
    const harness = createHarness(async (context) => {
      const result = new Proxy(
        { kind: "no_changes" as const, changeSetId: "changeset-result-boundary" },
        {
          getOwnPropertyDescriptor: (target, key) => {
            currentDuringResultInspection = context.executionClaim.isCurrent();
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        }
      );
      return result;
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });

    expect(currentDuringResultInspection).toBe(false);
  });

  it("rejects accessor-backed executor outcomes without invoking accessors", async () => {
    let accessorCalls = 0;
    const harness = createHarness(async () => {
      const result = { changeSetId: "changeset-accessor" };
      Object.defineProperty(result, "kind", {
        enumerable: true,
        get: () => {
          accessorCalls += 1;
          return "no_changes";
        },
      });
      return result as IngestExecutionResult;
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "failed",
    });

    expect(accessorCalls).toBe(0);
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "failed",
      failure: { code: "unexpected_executor_failure" },
    });
  });

  it("finalizes only a one-read detached snapshot of a Proxy executor result", async () => {
    let changeSetDescriptorReads = 0;
    let propertyReads = 0;
    const result = new Proxy(
      { kind: "no_changes" as const, changeSetId: "changeset-detached" },
      {
        get: (_target, key) => {
          if (key === "then") return undefined;
          propertyReads += 1;
          throw new Error("Executor result properties must not be read directly");
        },
        getOwnPropertyDescriptor: (target, key) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          if (key !== "changeSetId" || !descriptor || !("value" in descriptor)) {
            return descriptor;
          }
          changeSetDescriptorReads += 1;
          return {
            ...descriptor,
            value: changeSetDescriptorReads === 1 ? "changeset-detached" : "changeset-substituted",
          };
        },
      }
    );
    const harness = createHarness(async () => result);
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });

    expect(propertyReads).toBe(0);
    expect(changeSetDescriptorReads).toBe(1);
    expect(harness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "completed",
      changeSetId: "changeset-detached",
    });
  });

  it("returns a deeply detached commit receipt without reading Proxy properties", async () => {
    let receiptPropertyReads = 0;
    let targetPropertyReads = 0;
    const receipt = createCommitReceipt();
    const originalTarget = receipt.targets[0];
    if (!originalTarget) throw new Error("Expected a commit target");
    receipt.targets = [
      new Proxy(originalTarget, {
        get: () => {
          targetPropertyReads += 1;
          throw new Error("Commit target properties must not be read directly");
        },
      }),
    ];
    const proxiedReceipt = new Proxy(receipt, {
      get: () => {
        receiptPropertyReads += 1;
        throw new Error("Commit receipt properties must not be read directly");
      },
    });
    const harness = createHarness(async (context) => {
      await context.reportStage("applying");
      return {
        kind: "completed",
        changeSetId: "changeset-committed",
        commitReceipt: proxiedReceipt,
      };
    });
    await harness.queue.enqueue(createRequest());

    const run = await harness.queue.runNext("personal");
    expect(run).toMatchObject({ kind: "commit_ready", jobId: "job-1" });
    if (run.kind !== "commit_ready") throw new Error("Expected detached commit proof");

    expect(receiptPropertyReads).toBe(0);
    expect(targetPropertyReads).toBe(0);
    expect(run.receipt).not.toBe(proxiedReceipt);
    expect(Object.isFrozen(run.receipt)).toBe(true);
    expect(Object.isFrozen(run.receipt.jobClaim)).toBe(true);
    expect(Object.isFrozen(run.receipt.targets)).toBe(true);
    expect(Object.isFrozen(run.receipt.targets[0])).toBe(true);
  });

  it("persists forward stages and completes a claimed job", async () => {
    const harness = createHarness(async (context) => {
      await context.reportStage("analyzing");
      await context.reportStage("generating");
      await context.reportStage("validating");
      return { kind: "no_changes", changeSetId: "changeset-final" };
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

  it("waits for coordinated apply and promotes a latest rerun only after commit proof", async () => {
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

    deferred.resolve(createAwaitingReviewResult());
    await expect(running).resolves.toMatchObject({ status: "awaiting_review" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ status: "awaiting_review", rerunRequested: true })],
      reruns: [expect.objectContaining({ sourceContentHash: HASH_D })],
    });

    harness.setNow(130);
    const acceptedDecision = createAcceptedReviewDecision({ acceptedAt: 130 });
    const applying = await harness.queue.beginReviewApply("personal", acceptedDecision);
    expect(applying).toMatchObject({ status: "processing", stage: "applying", startedAt: 130 });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      reruns: [expect.any(Object)],
      applyClaim: {
        jobId: "job-1",
        reviewedChangeSet: {
          changeSetId: "changeset-review",
          changeSetDigest: HASH_D,
        },
        startedAt: 130,
      },
    });
    const receipt = createCommitReceipt({
      changeSetId: "changeset-review",
      jobClaim: {
        jobId: applying.id,
        sourceId: applying.sourceId,
        sourceContentHash: applying.sourceContentHash,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: applying.inputRevision,
        attempt: applying.attempt,
        startedAt: applying.startedAt,
      },
      committedAt: 140,
    });
    await expect(
      harness.queue.verifyApplyRecovery({
        ...receipt,
        changeSetId: "changeset-not-reviewed",
      })
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
    await expect(
      harness.queue.verifyApplyRecovery({
        ...receipt,
        changeSetDigest: HASH_C,
      })
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
    await expect(harness.queue.verifyApplyRecovery(receipt)).resolves.toMatchObject({
      status: "processing",
      stage: "applying",
    });
    await harness.queue.resolveApplyRecovery(receipt);
    await harness.queue.finalizeApplyRecovery("personal", receipt.transactionId);
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
    await expect(
      harness.queue.beginReviewApply("personal", acceptedDecision)
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
  });

  it("snapshots reviewed ChangeSet identity before asynchronous queue storage", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    const readStarted = createDeferred<void>();
    const releaseRead = createDeferred<void>();
    harness.storage.onRead = () => readStarted.resolve();
    harness.storage.readBarrier = releaseRead.promise;
    const reviewDecision = createAcceptedReviewDecision();

    const applying = harness.queue.beginReviewApply("personal", reviewDecision);
    await readStarted.promise;
    reviewDecision.acceptedDigest = HASH_C;
    reviewDecision.proposalDigest = HASH_A;
    reviewDecision.manifestCommitIntentDigest = HASH_B;
    releaseRead.resolve();

    await expect(applying).resolves.toMatchObject({ status: "processing", stage: "applying" });
    expect(harness.storage.getSnapshot("personal").applyClaim).toMatchObject({
      reviewedChangeSet: {
        changeSetId: "changeset-review",
        changeSetDigest: HASH_D,
      },
      acceptedReview: {
        proposalDigest: HASH_C,
        recordRevision: 1,
        manifestCommitIntentDigest: HASH_A,
        acceptedAt: 120,
      },
    });
  });

  it("replays only the exact accepted review receipt without another write or event", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    const decision = createAcceptedReviewDecision();
    const revisionBefore = harness.storage.getSnapshot("personal").revision;

    const first = await harness.queue.beginReviewApply("personal", decision);
    const afterFirst = harness.storage.getSnapshot("personal");
    expect(afterFirst.revision).toBe(revisionBefore + 1);
    expect(harness.sink.events.filter(({ cause }) => cause === "review_accepted")).toHaveLength(1);

    await expect(harness.queue.beginReviewApply("personal", decision)).resolves.toEqual(first);
    expect(harness.storage.getSnapshot("personal").revision).toBe(afterFirst.revision);
    expect(harness.sink.events.filter(({ cause }) => cause === "review_accepted")).toHaveLength(1);

    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ proposalDigest: HASH_A })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      harness.queue.beginReviewApply("personal", createAcceptedReviewDecision({ acceptedAt: 121 }))
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ manifestCommitIntentDigest: HASH_B })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ recordRevision: 2 } as never)
      )
    ).rejects.toBeInstanceOf(TypeError);
    expect(harness.storage.getSnapshot("personal").revision).toBe(afterFirst.revision);
  });

  it("deduplicates equivalent newer observations without mutating an applying claim", async () => {
    const started = createDeferred<IngestExecutionContext>();
    const result = createDeferred<IngestExecutionResult>();
    const harness = createHarness(async (context) => {
      await context.reportStage("applying");
      started.resolve(context);
      return result.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    const context = await started.promise;

    await expect(harness.queue.enqueue(createRequest({ inputRevision: 3 }))).resolves.toMatchObject(
      { kind: "deduplicated", job: { inputRevision: 1 } }
    );
    await expect(
      harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }))
    ).resolves.toMatchObject({ kind: "deduplicated", job: { inputRevision: 1 } });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ inputRevision: 1, stage: "applying" })],
      applyClaim: { inputRevision: 1, startedAt: context.job.startedAt },
      reruns: [],
      sourceHighWatermarks: [
        expect.objectContaining({ sourceContentHash: HASH_A, inputRevision: 3 }),
      ],
    });

    result.resolve({
      kind: "completed",
      changeSetId: "changeset-committed",
      commitReceipt: createCommitReceipt({
        jobClaim: {
          jobId: context.job.id,
          sourceId: context.job.sourceId,
          sourceContentHash: context.job.sourceContentHash,
          pipelineFingerprint: context.job.pipelineFingerprint,
          inputRevision: context.job.inputRevision,
          attempt: context.job.attempt,
          startedAt: context.job.startedAt,
        },
      }),
    });
    const committed = await running;
    expect(committed).toMatchObject({ kind: "commit_ready", jobId: "job-1" });
    if (committed.kind !== "commit_ready") {
      throw new Error("Expected coordinated commit proof");
    }
    await harness.queue.resolveApplyRecovery(committed.receipt);
    await harness.queue.finalizeApplyRecovery("personal", committed.receipt.transactionId);
    await expect(harness.queue.enqueue(createRequest({ inputRevision: 4 }))).resolves.toMatchObject(
      { kind: "deduplicated", job: { status: "completed" } }
    );
    await expect(
      harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }))
    ).resolves.toMatchObject({ kind: "deduplicated", job: { status: "completed" } });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      jobs: [expect.objectContaining({ status: "completed", inputRevision: 1 })],
      reruns: [],
      sourceHighWatermarks: [expect.objectContaining({ inputRevision: 4 })],
    });
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

    deferred.resolve({ kind: "no_changes", changeSetId: "changeset-old" });
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

    deferred.resolve({ kind: "no_changes", changeSetId: "changeset-reverted" });
    await running;
    expect(
      harness.storage.getSnapshot("personal").jobs.filter((job) => job.status === "pending")
    ).toEqual([]);
  });

  it("promotes the latest rerun when its processing predecessor fails", async () => {
    const failure = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    let attemptSignal: AbortSignal | undefined;
    const harness = createHarness(async (context) => {
      attemptSignal = context.signal;
      started.resolve();
      return failure.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));
    if (!attemptSignal) throw new Error("Expected a Queue execution signal");

    failure.reject(
      new IngestExecutorError(
        {
          code: "invalid_output",
          message: "Compiler output was invalid",
          retryable: false,
          rateLimited: false,
        },
        attemptSignal
      )
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
      return { kind: "no_changes", changeSetId: "unreachable" };
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
    const harness = createHarness(async (context) => {
      call += 1;
      if (call === 1) {
        throw new IngestExecutorError(
          {
            code: "provider_timeout",
            message: "Provider timed out",
            retryable: true,
            rateLimited: false,
          },
          context.signal
        );
      }
      return { kind: "no_changes", changeSetId: "changeset-after-retry" };
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
    const harness = createHarness(async (context) => {
      throw new IngestExecutorError(
        {
          code: "temporary",
          message: "Still unavailable",
          retryable: true,
          rateLimited: false,
        },
        context.signal
      );
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
    const harness = createHarness(async (context) => {
      if (rateLimited) {
        throw new IngestExecutorError(
          {
            code: "provider_rate_limit",
            message: "Provider requested a pause",
            retryable: true,
            rateLimited: true,
            retryAfterMs: 500,
          },
          context.signal
        );
      }
      return { kind: "no_changes", changeSetId: "changeset-resumed" };
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
      resumeAt: 600,
    });

    rateLimited = false;
    harness.setNow(200);
    await harness.queue.resume("personal");
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("automatically resumes only when a durable rate-limit deadline is due", async () => {
    let rateLimited = true;
    const harness = createHarness(async (context) => {
      if (rateLimited) {
        throw new IngestExecutorError(
          {
            code: "provider_rate_limit",
            message: "Provider requested a pause",
            retryable: true,
            rateLimited: true,
            retryAfterMs: 500,
          },
          context.signal
        );
      }
      return { kind: "no_changes", changeSetId: "changeset-after-deadline" };
    });
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");

    harness.setNow(599);
    await expect(harness.queue.resumeRateLimitIfDue("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "rate_limit", resumeAt: 600 },
      jobs: [expect.objectContaining({ status: "paused", attempt: 1 })],
    });
    await expect(harness.queue.runNext("personal")).resolves.toEqual({
      kind: "paused",
      reason: "rate_limit",
      resumeAt: 600,
    });

    rateLimited = false;
    harness.setNow(600);
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [expect.objectContaining({ status: "completed", attempt: 2 })],
    });
  });

  it("never lets the automatic rate-limit API release a user pause", async () => {
    const harness = createHarness();
    await harness.queue.enqueue(createRequest());
    await harness.queue.pause("personal", "User requested inspection");
    harness.setNow(10_000);

    await expect(harness.queue.resumeRateLimitIfDue("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ status: "pending" })],
    });
  });

  it("fails closed when an attempt-bound rate-limit error is replayed by a later attempt", async () => {
    let captured: IngestExecutorError | undefined;
    const harness = createHarness(async (context) => {
      if (!captured) {
        captured = new IngestExecutorError(
          {
            code: "provider_rate_limit",
            message: "Provider requested a pause",
            retryable: true,
            rateLimited: true,
          },
          context.signal
        );
      }
      throw captured;
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({ status: "paused" });
    await harness.queue.resume("personal");
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({ status: "failed" });
    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot.control).toEqual({ status: "running" });
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      status: "failed",
      failure: {
        code: "unexpected_executor_failure",
        retryable: false,
      },
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
    const harness = createHarness(async (context) => {
      call += 1;
      if (call === 1) {
        throw new IngestExecutorError(
          {
            code: 42,
            message: "Malformed adapter payload",
            retryable: true,
            rateLimited: false,
          } as never,
          context.signal
        );
      }
      throw new IngestExecutorError(
        {
          code: "provider_error",
          message: "authorization=Bearer sk-examplecredential123",
          retryable: false,
          rateLimited: false,
        },
        context.signal
      );
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
  it("reconciles a durable pending review after startup recovery without a new attempt", async () => {
    const execution = createDeferred<IngestExecutionResult>();
    const started = createDeferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return execution.promise;
    });
    await harness.queue.enqueue(createRequest());
    const running = harness.queue.runNext("personal");
    await started.promise;

    harness.setNow(120);
    await harness.queue.recoverOnStartup("personal");
    const recovered = harness.storage.getSnapshot("personal");
    expect(recovered).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending", attempt: 1 })],
      pendingReviews: [],
    });

    const pendingDecision = createPendingReviewDecision();
    const revisionBefore = recovered.revision;
    const reconciled = await harness.queue.reconcilePendingReview("personal", pendingDecision);
    expect(reconciled).toMatchObject({
      status: "awaiting_review",
      changeSetId: "changeset-review",
      attempt: 1,
    });
    const anchored = harness.storage.getSnapshot("personal");
    expect(anchored.revision).toBe(revisionBefore + 1);
    expect(anchored.pendingReviews).toEqual([
      {
        kind: "durable",
        jobId: "job-1",
        changeSetId: "changeset-review",
        proposalDigest: HASH_C,
        reviewRecordRevision: 0,
        recordedAt: 110,
      },
    ]);
    expect(harness.sink.events.filter(({ cause }) => cause === "awaiting_review")).toHaveLength(1);

    await expect(
      harness.queue.reconcilePendingReview("personal", pendingDecision)
    ).resolves.toEqual(reconciled);
    expect(harness.storage.getSnapshot("personal").revision).toBe(anchored.revision);
    expect(harness.sink.events.filter(({ cause }) => cause === "awaiting_review")).toHaveLength(1);

    execution.resolve(createAwaitingReviewResult());
    await expect(running).resolves.toEqual({ kind: "stale", jobId: "job-1" });
    expect(harness.executor.calls).toHaveLength(1);
  });

  it("upgrades a legacy awaiting-review anchor only from its exact durable pending record", async () => {
    const harness = createHarness();
    const awaitingReview: Extract<KnowledgeIngestJob, { status: "awaiting_review" }> = {
      ...createPendingJob(),
      attempt: 1,
      updatedAt: 110,
      status: "awaiting_review",
      stage: "review",
      changeSetId: "changeset-review",
    };
    harness.storage.seed("personal", {
      version: 2,
      bundleId: "personal",
      revision: 3,
      control: { status: "running" },
      jobs: [awaitingReview],
      reruns: [],
      sourceHighWatermarks: deriveTestHighWatermarks([awaitingReview], []),
    });

    await expect(
      harness.queue.reconcilePendingReview("personal", createPendingReviewDecision())
    ).resolves.toMatchObject({ status: "awaiting_review", attempt: 1 });
    const upgraded = harness.storage.getSnapshot("personal");
    expect(upgraded).toMatchObject({
      version: INGEST_QUEUE_VERSION,
      revision: 4,
      pendingReviews: [
        {
          kind: "durable",
          jobId: "job-1",
          changeSetId: "changeset-review",
          proposalDigest: HASH_C,
          reviewRecordRevision: 0,
          recordedAt: 110,
        },
      ],
    });

    await expect(
      harness.queue.reconcilePendingReview(
        "personal",
        createPendingReviewDecision({ proposalDigest: HASH_A })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    expect(harness.storage.getSnapshot("personal")).toEqual(upgraded);
  });

  it("fails closed on cross-Bundle, malformed, or stale review receipts", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    const before = harness.storage.getSnapshot("personal");

    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ bundleId: "other-bundle" })
      )
    ).rejects.toBeInstanceOf(IngestQueueReviewBundleMismatchError);
    await expect(
      harness.queue.rejectReview(
        "personal",
        createRejectedReviewDecision({ bundleId: "other-bundle" })
      )
    ).rejects.toBeInstanceOf(IngestQueueReviewBundleMismatchError);
    await expect(
      harness.queue.reconcilePendingReview(
        "personal",
        createPendingReviewDecision({ bundleId: "other-bundle" })
      )
    ).rejects.toBeInstanceOf(IngestQueueReviewBundleMismatchError);
    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ jobClaim: { sourceContentHash: HASH_D } })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      harness.queue.rejectReview(
        "personal",
        createRejectedReviewDecision({ jobClaim: { pipelineFingerprint: HASH_D } })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      harness.queue.rejectReview("personal", {
        ...createRejectedReviewDecision(),
        outcome: "pending",
      } as never)
    ).rejects.toBeInstanceOf(TypeError);
    expect(harness.storage.getSnapshot("personal")).toEqual(before);
  });

  it("fails closed when applying completion omits transaction commit proof", async () => {
    const harness = createHarness(async (context) => {
      await context.reportStage("applying");
      return {
        kind: "completed",
        changeSetId: "changeset-unproved",
      } as unknown as IngestExecutionResult;
    });
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "failed",
    });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "recovery_required" },
      jobs: [expect.objectContaining({ status: "failed", stage: "applying" })],
      applyClaim: { jobId: "job-1", startedAt: 100 },
    });
  });

  it("rejects commit proof from an execution that never entered applying", async () => {
    const harness = createHarness(async () => ({
      kind: "completed",
      changeSetId: "changeset-misplaced",
      commitReceipt: createCommitReceipt({ changeSetId: "changeset-misplaced" }),
    }));
    await harness.queue.enqueue(createRequest());

    await expect(harness.queue.runNext("personal")).rejects.toBeInstanceOf(
      IngestQueueApplyReceiptRequiredError
    );
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending" })],
    });
  });

  it("retains a committed apply marker until journal acknowledgement is finalized", async () => {
    const harness = createHarness(async (context) => {
      await context.reportStage("applying");
      return {
        kind: "completed",
        changeSetId: "changeset-committed",
        commitReceipt: createCommitReceipt({
          jobClaim: {
            jobId: context.job.id,
            sourceId: context.job.sourceId,
            sourceContentHash: context.job.sourceContentHash,
            pipelineFingerprint: context.job.pipelineFingerprint,
            inputRevision: context.job.inputRevision,
            attempt: context.job.attempt,
            startedAt: context.job.startedAt,
          },
        }),
      };
    });
    await harness.queue.enqueue(createRequest());

    const run = await harness.queue.runNext("personal");
    expect(run).toMatchObject({
      kind: "commit_ready",
      jobId: "job-1",
    });
    if (run.kind !== "commit_ready") {
      throw new Error("Expected durable commit proof before queue completion");
    }
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [expect.objectContaining({ status: "processing", stage: "applying" })],
      applyClaim: { jobId: "job-1", startedAt: 100 },
    });
    expect(harness.storage.getSnapshot("personal").applyCommit).toBeUndefined();

    await expect(harness.queue.verifyApplyRecovery(run.receipt)).resolves.toMatchObject({
      status: "processing",
      stage: "applying",
    });
    await harness.queue.resolveApplyRecovery(run.receipt);
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "commit_pending_ack" },
      jobs: [
        expect.objectContaining({
          id: "job-1",
          status: "completed",
          changeSetId: "changeset-committed",
        }),
      ],
      applyCommit: {
        transactionId: "transaction-1",
        jobId: "job-1",
        attempt: 1,
        startedAt: 100,
      },
    });
    await expect(harness.queue.resume("personal")).rejects.toBeInstanceOf(
      IngestQueueApplyCommitPendingError
    );
    await harness.queue.pause("personal", "Cannot replace commit gate");
    expect(harness.storage.getSnapshot("personal").control).toMatchObject({
      reason: "commit_pending_ack",
    });
    await expect(
      harness.queue.finalizeApplyRecovery("personal", "transaction-other")
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);

    const finalized = await harness.queue.finalizeApplyRecovery("personal", "transaction-1");
    expect(finalized).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
    });
    expect(finalized.applyCommit).toBeUndefined();
    await expect(harness.queue.finalizeApplyRecovery("personal", "transaction-1")).resolves.toEqual(
      finalized
    );
    await expect(harness.queue.verifyApplyRecovery(run.receipt)).rejects.toBeInstanceOf(
      IngestQueueApplyCommitConflictError
    );
  });

  it("never treats marker-free no-change completion as transaction recovery proof", async () => {
    const harness = createHarness();
    await harness.queue.enqueue(createRequest());
    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });

    await expect(
      harness.queue.verifyApplyRecovery(
        createCommitReceipt({ changeSetId: "changeset-1", committedAt: 120 })
      )
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
  });

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

  it("cancels pending work but requires exact review rejection and blocks applying", async () => {
    const pendingHarness = createHarness();
    await pendingHarness.queue.enqueue(createRequest());
    await expect(pendingHarness.queue.cancel("personal", "job-1")).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(pendingHarness.executor.calls).toHaveLength(0);

    const reviewHarness = createHarness(async () => createAwaitingReviewResult());
    await reviewHarness.queue.enqueue(createRequest());
    await reviewHarness.queue.runNext("personal");
    await expect(reviewHarness.queue.cancel("personal", "job-1")).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );
    expect(reviewHarness.storage.getSnapshot("personal").jobs[0]).toMatchObject({
      status: "awaiting_review",
      changeSetId: "changeset-review",
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
    applying.resolve({
      kind: "completed",
      changeSetId: "changeset-applied",
      commitReceipt: createCommitReceipt({ changeSetId: "changeset-applied" }),
    });
    await expect(running).resolves.toMatchObject({ kind: "commit_ready" });
  });

  it("does not begin review apply while the Bundle is paused", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    await harness.queue.pause("personal", "Review later");

    await expect(
      harness.queue.beginReviewApply("personal", createAcceptedReviewDecision())
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    const paused = harness.storage.getSnapshot("personal");
    expect(paused).toMatchObject({
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ status: "awaiting_review" })],
    });
    expect(paused.applyClaim).toBeUndefined();
  });

  it("starts one accepted review explicitly under startup recovery without releasing backlog", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    await expect(harness.queue.recoverOnStartup("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "awaiting_review" })],
    });
    await expect(harness.queue.resume("personal")).rejects.toBeInstanceOf(
      IngestQueueStartupReleaseRequiredError
    );

    await expect(
      harness.queue.beginReviewApply("personal", createAcceptedReviewDecision())
    ).resolves.toMatchObject({ status: "processing", stage: "applying" });
    const applying = harness.storage.getSnapshot("personal");
    expect(applying).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "processing", stage: "applying" })],
      applyClaim: { jobId: "job-1" },
    });
    await expect(
      harness.queue.beginReviewApply("personal", createAcceptedReviewDecision())
    ).rejects.toBeInstanceOf(IngestQueueRecoveryRequiredError);

    await expect(harness.queue.recoverOnStartup("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "recovery_required" },
      jobs: [expect.objectContaining({ status: "failed", stage: "applying" })],
      applyClaim: { jobId: "job-1" },
    });
  });

  it("durably rejects one exact review and replays the same decision idempotently", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    harness.setNow(130);
    const revisionBefore = harness.storage.getSnapshot("personal").revision;

    const reviewDecision = createRejectedReviewDecision();
    const rejected = await harness.queue.rejectReview("personal", reviewDecision);
    expect(rejected).toMatchObject({
      status: "cancelled",
      stage: "cancelled",
      cancelledAt: 130,
      rerunRequested: false,
    });
    const durable = harness.storage.getSnapshot("personal");
    expect(durable.revision).toBe(revisionBefore + 1);
    expect(durable.reviewRejections).toEqual([
      {
        jobId: "job-1",
        changeSetId: "changeset-review",
        proposalDigest: HASH_C,
        reviewRecordRevision: 1,
        decisionAt: 120,
        rejectedAt: 130,
      },
    ]);
    expect(harness.sink.events.filter(({ cause }) => cause === "review_rejected")).toHaveLength(1);
    expect(harness.executor.calls).toHaveLength(1);

    await expect(harness.queue.rejectReview("personal", reviewDecision)).resolves.toEqual(rejected);
    expect(harness.storage.getSnapshot("personal").revision).toBe(revisionBefore + 1);
    expect(harness.sink.events.filter(({ cause }) => cause === "review_rejected")).toHaveLength(1);
  });

  it("converges after another queue instance durably records the same rejection", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    harness.setNow(140);
    const current = harness.storage.getSnapshot("personal");
    const reviewJob = current.jobs[0];
    const cancelled: KnowledgeIngestJob = {
      id: reviewJob.id,
      bundleId: reviewJob.bundleId,
      sourceId: reviewJob.sourceId,
      sourceContentHash: reviewJob.sourceContentHash,
      pipelineFingerprint: reviewJob.pipelineFingerprint,
      inputRevision: reviewJob.inputRevision,
      attempt: reviewJob.attempt,
      rerunRequested: false,
      createdAt: reviewJob.createdAt,
      updatedAt: 140,
      status: "cancelled",
      stage: "cancelled",
      cancelledAt: 140,
    };
    const concurrent: IngestQueueSnapshot = {
      ...current,
      revision: current.revision + 1,
      jobs: [cancelled],
      pendingReviews: [],
      reviewRejections: [
        {
          jobId: "job-1",
          changeSetId: "changeset-review",
          proposalDigest: HASH_C,
          reviewRecordRevision: 1,
          decisionAt: 120,
          rejectedAt: 140,
        },
      ],
    };
    harness.storage.planWriteFailure(
      new IngestQueueRevisionConflictError("personal", current.revision, concurrent.revision),
      () => harness.storage.seed("personal", concurrent)
    );
    const rejectionEventsBefore = harness.sink.events.filter(
      ({ cause }) => cause === "review_rejected"
    ).length;

    await expect(
      harness.queue.rejectReview("personal", createRejectedReviewDecision())
    ).resolves.toEqual(cancelled);
    expect(harness.storage.getSnapshot("personal")).toEqual(concurrent);
    expect(harness.sink.events.filter(({ cause }) => cause === "review_rejected")).toHaveLength(
      rejectionEventsBefore
    );
  });

  it("fails closed on stale, unknown, or conflicting review rejection identity", async () => {
    const pendingHarness = createHarness();
    await pendingHarness.queue.enqueue(createRequest());
    await expect(
      pendingHarness.queue.rejectReview("personal", createRejectedReviewDecision())
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    await expect(
      pendingHarness.queue.rejectReview(
        "personal",
        createRejectedReviewDecision({ jobClaim: { jobId: "job-missing" } })
      )
    ).rejects.toBeInstanceOf(IngestQueueJobNotFoundError);

    const reviewHarness = createHarness(async () => createAwaitingReviewResult());
    await reviewHarness.queue.enqueue(createRequest());
    await reviewHarness.queue.runNext("personal");
    const before = reviewHarness.storage.getSnapshot("personal");
    await expect(
      reviewHarness.queue.rejectReview(
        "personal",
        createRejectedReviewDecision({ changeSetId: "changeset-other" })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    expect(reviewHarness.storage.getSnapshot("personal")).toEqual(before);

    await reviewHarness.queue.rejectReview("personal", createRejectedReviewDecision());
    await expect(
      reviewHarness.queue.rejectReview(
        "personal",
        createRejectedReviewDecision({ changeSetId: "changeset-other" })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);
    expect(reviewHarness.storage.getSnapshot("personal").reviewRejections).toEqual([
      expect.objectContaining({ changeSetId: "changeset-review" }),
    ]);
  });

  it("atomically promotes the latest rerun while retaining rejection audit history", async () => {
    const harness = createHarness(async () => createAwaitingReviewResult());
    await harness.queue.enqueue(createRequest());
    await harness.queue.runNext("personal");
    harness.setNow(120);
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_C, inputRevision: 2 }));
    harness.setNow(130);
    await harness.queue.enqueue(createRequest({ sourceContentHash: HASH_D, inputRevision: 3 }));

    await harness.queue.rejectReview("personal", createRejectedReviewDecision());
    const snapshot = harness.storage.getSnapshot("personal");
    expect(snapshot.reviewRejections).toEqual([
      {
        jobId: "job-1",
        changeSetId: "changeset-review",
        proposalDigest: HASH_C,
        reviewRecordRevision: 1,
        decisionAt: 120,
        rejectedAt: 130,
      },
    ]);
    expect(snapshot.reruns).toEqual([]);
    expect(snapshot.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-1", status: "cancelled" }),
        expect.objectContaining({
          id: "job-2",
          status: "pending",
          sourceContentHash: HASH_D,
          inputRevision: 3,
          attempt: 0,
        }),
      ])
    );
    expect(snapshot.sourceHighWatermarks).toEqual([
      expect.objectContaining({
        sourceId: "source-1",
        sourceContentHash: HASH_D,
        inputRevision: 3,
      }),
    ]);
  });

  it("pauses only the gate during applying and returns proof without early queue success", async () => {
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

    applying.resolve({
      kind: "completed",
      changeSetId: "changeset-safe-apply",
      commitReceipt: createCommitReceipt({ changeSetId: "changeset-safe-apply" }),
    });
    await expect(running).resolves.toMatchObject({ kind: "commit_ready" });
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "user" },
      jobs: [expect.objectContaining({ status: "processing", stage: "applying" })],
    });
  });

  it("rejects illegal review and explicit retry transitions", async () => {
    const harness = createHarness();
    await harness.queue.enqueue(createRequest());
    await expect(
      harness.queue.beginReviewApply(
        "personal",
        createAcceptedReviewDecision({ changeSetId: "changeset-1" })
      )
    ).rejects.toBeInstanceOf(IngestQueueTransitionError);

    harness.executor.handler = async (context) => {
      throw new IngestExecutorError(
        {
          code: "invalid_source",
          message: "Source is invalid",
          retryable: false,
          rateLimited: false,
        },
        context.signal
      );
    };
    await harness.queue.runNext("personal");
    await expect(harness.queue.retryFailed("personal", "job-1")).rejects.toBeInstanceOf(
      IngestQueueTransitionError
    );
  });

  it("allows an explicit retry of a retryable failed job with a fresh attempt budget", async () => {
    const harness = createHarness(async (context) => {
      throw new IngestExecutorError(
        {
          code: "temporary",
          message: "Temporary failure",
          retryable: true,
          rateLimited: false,
        },
        context.signal
      );
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

    await expect(harness.queue.resume("personal")).rejects.toBeInstanceOf(
      IngestQueueStartupReleaseRequiredError
    );
    const beforeRelease = harness.storage.getSnapshot("personal");
    await expect(
      harness.queue.pause("personal", "Cannot launder startup recovery")
    ).resolves.toEqual(beforeRelease);
    expect(harness.storage.getSnapshot("personal")).toEqual(beforeRelease);
    harness.storage.seed("personal", {
      ...beforeRelease,
      revision: beforeRelease.revision + 1,
      control: { status: "running" },
    });
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
    harness.storage.seed(
      "personal",
      createSnapshot("personal", {
        revision: 4,
        jobs: [applying],
        applyClaim: createApplyClaimMarker(),
      })
    );
    harness.setNow(200);

    const recovered = await harness.queue.recoverOnStartup("personal");
    expect(recovered.control).toMatchObject({ status: "paused", reason: "recovery_required" });
    expect(recovered.applyClaim).toMatchObject({
      jobId: "job-1",
      attempt: 1,
      startedAt: 110,
      sourceId: "source-1",
    });
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

  it("reconciles an interrupted apply only for its exact committed job attempt", async () => {
    const harness = createHarness();
    const applying: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      updatedAt: 110,
      status: "processing",
      stage: "applying",
      startedAt: 110,
    };
    harness.storage.seed(
      "personal",
      createSnapshot("personal", {
        revision: 4,
        jobs: [applying],
        applyClaim: createApplyClaimMarker(),
      })
    );
    harness.setNow(200);
    await harness.queue.recoverOnStartup("personal");
    const receipt = createCommitReceipt({
      jobClaim: { jobId: "job-1", attempt: 1, startedAt: 110 },
      committedAt: 150,
    });

    await expect(
      harness.queue.resolveApplyRecovery({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, attempt: 2 },
      })
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
    await expect(
      harness.queue.verifyApplyRecovery({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, startedAt: 111 },
      })
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
    await expect(
      harness.queue.verifyApplyRecovery({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, sourceContentHash: HASH_C },
      })
    ).rejects.toBeInstanceOf(IngestQueueApplyCommitConflictError);
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "recovery_required" },
      jobs: [expect.objectContaining({ status: "failed", stage: "applying" })],
    });

    await expect(harness.queue.verifyApplyRecovery(receipt)).resolves.toMatchObject({
      status: "failed",
      stage: "applying",
    });
    await expect(harness.queue.resolveApplyRecovery(receipt)).resolves.toMatchObject({
      id: "job-1",
      status: "completed",
      attempt: 1,
      changeSetId: "changeset-committed",
    });
    await expect(harness.queue.resolveApplyRecovery(receipt)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(harness.queue.getPendingApplyCommit("personal")).resolves.toEqual(
      expect.objectContaining({ transactionId: "transaction-1", startedAt: 110 })
    );
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "commit_pending_ack" },
      jobs: [expect.objectContaining({ status: "completed" })],
    });
  });

  it("leaves a latest rerun with its existing successor during old-apply recovery", async () => {
    const harness = createHarness();
    const failedApply: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      rerunRequested: false,
      updatedAt: 200,
      status: "failed",
      stage: "applying",
      failure: {
        code: "interrupted_apply_requires_recovery",
        message: "Interrupted apply requires recovery",
        retryable: false,
        occurredAt: 200,
      },
    };
    const successor = createPendingJob({
      id: "job-2",
      sourceContentHash: HASH_C,
      inputRevision: 2,
      rerunRequested: true,
      createdAt: 120,
      updatedAt: 200,
    });
    const rerun: IngestRerunRequest = {
      jobId: "job-3",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      requestedAt: 130,
      updatedAt: 190,
    };
    harness.storage.seed(
      "personal",
      createSnapshot("personal", {
        revision: 5,
        control: { status: "paused", reason: "recovery_required", pausedAt: 200 },
        jobs: [failedApply, successor],
        reruns: [rerun],
        sourceHighWatermarks: [
          {
            sourceId: "source-1",
            sourceContentHash: HASH_A,
            pipelineFingerprint: HASH_B,
            inputRevision: 3,
            observedAt: 190,
          },
        ],
        applyClaim: createApplyClaimMarker(),
      })
    );
    const receipt = createCommitReceipt({
      jobClaim: { jobId: "job-1", attempt: 1, startedAt: 110 },
      committedAt: 150,
    });

    await expect(harness.queue.resolveApplyRecovery(receipt)).resolves.toMatchObject({
      id: "job-1",
      status: "completed",
    });
    const snapshot = await harness.queue.load("personal");
    expect(
      snapshot.jobs.filter((job) => !["failed", "completed", "cancelled"].includes(job.status))
    ).toEqual([expect.objectContaining({ id: "job-2", inputRevision: 2 })]);
    expect(snapshot.reruns).toEqual([
      expect.objectContaining({ jobId: "job-3", inputRevision: 3 }),
    ]);
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
    completion.resolve({ kind: "no_changes", changeSetId: "changeset-ambiguous" });

    await expect(running).rejects.toThrow("finalization disk failure");
    expect(harness.storage.getSnapshot("personal")).toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [expect.objectContaining({ status: "pending" })],
    });

    await expect(harness.queue.resume("personal")).rejects.toBeInstanceOf(
      IngestQueueStartupReleaseRequiredError
    );
    const beforeRelease = harness.storage.getSnapshot("personal");
    harness.storage.seed("personal", {
      ...beforeRelease,
      revision: beforeRelease.revision + 1,
      control: { status: "running" },
    });
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
      return { kind: "no_changes", changeSetId: "unreachable" };
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

  it("does not let an old infrastructure unwind recover a newer processing claim", async () => {
    const storage = new InMemoryQueueStorage();
    const oldStarted = createDeferred<void>();
    const oldFailure = createDeferred<IngestExecutionResult>();
    const newStarted = createDeferred<void>();
    const newCompletion = createDeferred<IngestExecutionResult>();
    const oldExecutor = new TestExecutor(async () => {
      oldStarted.resolve();
      return oldFailure.promise;
    });
    const newExecutor = new TestExecutor(async () => {
      newStarted.resolve();
      return newCompletion.promise;
    });
    let now = 100;
    let nextId = 1;
    const options = {
      clock: () => now,
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

    now = 150;
    await newQueue.recoverOnStartup("personal");
    const recovered = storage.getSnapshot("personal");
    storage.seed("personal", {
      ...recovered,
      revision: recovered.revision + 1,
      control: { status: "running" },
    });
    now = 200;
    const newRun = newQueue.runNext("personal");
    await newStarted.promise;

    oldFailure.reject(
      new IngestQueueInfrastructureError("old_generation_test", new Error("storage unavailable"))
    );
    await expect(oldRun).rejects.toBeInstanceOf(IngestQueueInfrastructureError);
    expect(storage.getSnapshot("personal")).toMatchObject({
      control: { status: "running" },
      jobs: [{ id: "job-1", status: "processing", attempt: 2, startedAt: 200 }],
    });

    newCompletion.resolve({ kind: "no_changes", changeSetId: "changeset-current" });
    await expect(newRun).resolves.toMatchObject({ status: "completed" });
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
      kind: "no_changes",
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
    completion.resolve({ kind: "no_changes", changeSetId: "changeset-first" });
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
      kind: "no_changes",
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
    oldCompletion.resolve({ kind: "no_changes", changeSetId: "changeset-old-attempt" });
    await expect(oldRun).resolves.toEqual({ kind: "stale", jobId: "job-1" });
    expect(storage.getSnapshot("personal").jobs[0]).toMatchObject({
      attempt: 2,
      changeSetId: "changeset-new-attempt",
    });
  });
});
