import type { IngestQueue, RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeProductionWorkerController,
  KnowledgeProductionWorkerControllerError,
  type KnowledgeProductionWorkerScheduler,
} from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgeProductionWorkerSession } from "@/knowledge/startup/KnowledgeProductionWorkerSession";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one externally settled Promise for detached-controller assertions. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates one authentic worker session around a scripted Queue-shaped test double. */
function createWorker(
  runNext: jest.Mock<Promise<RunNextResult>, [string]>
): KnowledgeProductionWorkerSession {
  return new KnowledgeProductionWorkerSession({
    queue: { runNext } as unknown as IngestQueue,
    bundleIds: ["personal"],
    isReleased: () => true,
    assertCurrent: () => undefined,
  });
}

/** Deterministic timer realm whose callbacks run only when explicitly invoked. */
class TestScheduler implements KnowledgeProductionWorkerScheduler {
  nowValue = 100;
  nextHandle = 0;
  readonly scheduled = new Map<number, { callback: () => void; delayMs: number }>();
  readonly cancelled: number[] = [];

  /** Returns the mutable deterministic test timestamp. */
  now(): number {
    return this.nowValue;
  }

  /** Retains one callback without running it. */
  schedule(callback: () => void, delayMs: number): number {
    const handle = ++this.nextHandle;
    this.scheduled.set(handle, { callback, delayMs });
    return handle;
  }

  /** Records and removes one retained callback. */
  cancel(handle: unknown): void {
    if (typeof handle !== "number") return;
    this.cancelled.push(handle);
    this.scheduled.delete(handle);
  }

  /** Runs and removes one retained callback as its renderer realm would. */
  run(handle: number): void {
    const scheduled = this.scheduled.get(handle);
    if (!scheduled) throw new Error("Expected one scheduled worker callback");
    this.scheduled.delete(handle);
    scheduled.callback();
  }
}

/** Adversarial timer realm that invokes callbacks before returning retained handles. */
class SynchronousScheduler implements KnowledgeProductionWorkerScheduler {
  nextHandle = 0;
  readonly retained = new Set<number>();
  readonly cancelled: number[] = [];

  /** Returns one stable timestamp. */
  now(): number {
    return 100;
  }

  /** Publishes a handle, fires synchronously, and only then returns the handle. */
  schedule(callback: () => void, _delayMs: number): number {
    const handle = ++this.nextHandle;
    this.retained.add(handle);
    callback();
    return handle;
  }

  /** Records cancellation of a handle retained across the synchronous callback. */
  cancel(handle: unknown): void {
    if (typeof handle !== "number") return;
    this.cancelled.push(handle);
    this.retained.delete(handle);
  }
}

describe("KnowledgeProductionWorkerController", () => {
  it("drains committed progress until the released Queue becomes idle", async () => {
    const drained = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async (): Promise<RunNextResult> => {
      if (runNext.mock.calls.length === 1) {
        return { kind: "executed", jobId: "job-1", status: "awaiting_review" };
      }
      drained.resolve();
      return { kind: "idle" };
    });
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler: new TestScheduler(),
    });

    controller.start();
    await drained.promise;

    expect(runNext.mock.calls).toEqual([["personal"], ["personal"]]);
    controller.close();
  });

  it("requests exactly one refresh after an explicit durable no-change generation effect", async () => {
    const refreshed = createDeferred<void>();
    const onGenerationRefreshRequired = jest.fn(() => refreshed.resolve());
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => ({
      kind: "executed",
      jobId: "job-no-changes",
      status: "completed",
      generationEffect: "manifest_no_changes_committed",
    }));
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      onGenerationRefreshRequired,
      probeGenerationCurrent: async () => true,
    });

    controller.start();
    await refreshed.promise;
    controller.notifyWorkAvailable();
    controller.notifyWorkAvailable();
    await Promise.resolve();

    expect(onGenerationRefreshRequired).toHaveBeenCalledTimes(1);
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled.size).toBe(0);
    controller.close();
  });

  it("refreshes without backoff when an ACK-lost rejection probes a changed Manifest", async () => {
    const attempted = createDeferred<void>();
    const refreshed = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempted.resolve();
      throw new Error("post-commit acknowledgement lost");
    });
    const probeGenerationCurrent = jest.fn(async () => false);
    const onGenerationRefreshRequired = jest.fn(() => refreshed.resolve());
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await attempted.promise;
    await refreshed.promise;
    controller.notifyWorkAvailable();
    await Promise.resolve();

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(1);
    expect(onGenerationRefreshRequired).toHaveBeenCalledTimes(1);
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled.size).toBe(0);
    controller.close();
  });

  it("keeps infrastructure backoff when an ambiguous rejection retains the Manifest generation", async () => {
    const attempted = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempted.resolve();
      throw new Error("transient Queue infrastructure failure");
    });
    const probeGenerationCurrent = jest.fn(async () => true);
    const onGenerationRefreshRequired = jest.fn();
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await attempted.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(1);
    expect(onGenerationRefreshRequired).not.toHaveBeenCalled();
    expect([...scheduler.scheduled.values()]).toEqual([expect.objectContaining({ delayMs: 250 })]);
    controller.close();
  });

  it("keeps infrastructure backoff when the Manifest generation probe rejects", async () => {
    const attempted = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempted.resolve();
      throw new Error("transient Queue infrastructure failure");
    });
    const probeGenerationCurrent = jest.fn(async () => {
      throw new Error("Manifest storage unavailable");
    });
    const onGenerationRefreshRequired = jest.fn();
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await attempted.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(1);
    expect(onGenerationRefreshRequired).not.toHaveBeenCalled();
    expect([...scheduler.scheduled.values()]).toEqual([expect.objectContaining({ delayMs: 250 })]);
    controller.close();
  });

  it("retries an unavailable ambiguous probe before Queue and refreshes when it later changed", async () => {
    const attempted = createDeferred<void>();
    const refreshed = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempted.resolve();
      if (runNext.mock.calls.length === 1) {
        throw new Error("post-commit acknowledgement lost");
      }
      return { kind: "idle" };
    });
    const probeGenerationCurrent = jest.fn(async () => {
      if (probeGenerationCurrent.mock.calls.length === 1) {
        throw new Error("Manifest storage temporarily unavailable");
      }
      return false;
    });
    const onGenerationRefreshRequired = jest.fn(() => refreshed.resolve());
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await attempted.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.scheduled.get(1)?.delayMs).toBe(250);

    scheduler.run(1);
    await refreshed.promise;

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(2);
    expect(onGenerationRefreshRequired).toHaveBeenCalledTimes(1);
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled.size).toBe(0);
    controller.close();
  });

  it("resumes Queue only after a retained ambiguous probe proves the generation current", async () => {
    const firstAttempt = createDeferred<void>();
    const secondAttempt = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        firstAttempt.resolve();
        throw new Error("ambiguous Queue acknowledgement");
      }
      secondAttempt.resolve();
      return { kind: "idle" };
    });
    const probeGenerationCurrent = jest.fn(async () => {
      if (probeGenerationCurrent.mock.calls.length === 1) {
        throw new Error("Manifest storage temporarily unavailable");
      }
      return true;
    });
    const onGenerationRefreshRequired = jest.fn();
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await firstAttempt.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(runNext).toHaveBeenCalledTimes(1);

    scheduler.run(1);
    await secondAttempt.promise;

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(2);
    expect(runNext).toHaveBeenCalledTimes(2);
    expect(onGenerationRefreshRequired).not.toHaveBeenCalled();
    expect(scheduler.scheduled.size).toBe(0);
    controller.close();
  });

  it("does not refresh or retry when closed during an ambiguous generation probe", async () => {
    const attempted = createDeferred<void>();
    const probeStarted = createDeferred<void>();
    const probeResult = createDeferred<boolean>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempted.resolve();
      throw new Error("ambiguous Queue acknowledgement");
    });
    const probeGenerationCurrent = jest.fn(async () => {
      probeStarted.resolve();
      return probeResult.promise;
    });
    const onGenerationRefreshRequired = jest.fn();
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
      probeGenerationCurrent,
      onGenerationRefreshRequired,
    });

    controller.start();
    await attempted.promise;
    await probeStarted.promise;
    controller.close();
    probeResult.resolve(false);
    await controller.whenSettled();

    expect(probeGenerationCurrent).toHaveBeenCalledTimes(1);
    expect(onGenerationRefreshRequired).not.toHaveBeenCalled();
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled.size).toBe(0);
  });

  it("uses the captured timer realm for the earliest durable retry", async () => {
    const firstPass = createDeferred<void>();
    const secondPass = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        firstPass.resolve();
        return { kind: "waiting", nextAttemptAt: 150 };
      }
      secondPass.resolve();
      return { kind: "idle" };
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await firstPass.promise;
    await Promise.resolve();
    expect([...scheduler.scheduled.entries()]).toEqual([
      [1, expect.objectContaining({ delayMs: 50 })],
    ]);

    scheduler.nowValue = 150;
    scheduler.run(1);
    await secondPass.promise;
    expect(runNext).toHaveBeenCalledTimes(2);
    controller.close();
  });

  it("wakes at the durable automatic rate-limit resume time", async () => {
    const firstPass = createDeferred<void>();
    const secondPass = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        firstPass.resolve();
        return { kind: "paused", reason: "rate_limit", resumeAt: 175 };
      }
      secondPass.resolve();
      return { kind: "idle" };
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await firstPass.promise;
    await Promise.resolve();
    expect(scheduler.scheduled.get(1)?.delayMs).toBe(75);

    scheduler.nowValue = 175;
    scheduler.run(1);
    await secondPass.promise;
    expect(runNext).toHaveBeenCalledTimes(2);
    controller.close();
  });

  it("coalesces Queue notifications and synchronously revokes retained timers", async () => {
    const firstPass = createDeferred<void>();
    const secondPass = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        firstPass.resolve();
        return { kind: "idle" };
      }
      secondPass.resolve();
      return { kind: "waiting", nextAttemptAt: 1_000 };
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await firstPass.promise;
    controller.notifyWorkAvailable();
    controller.notifyWorkAvailable();
    await secondPass.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(runNext).toHaveBeenCalledTimes(2);
    expect(scheduler.scheduled.size).toBe(1);

    controller.close();
    controller.close();
    expect(scheduler.scheduled.size).toBe(0);
    expect(scheduler.cancelled).toEqual([1]);
    expect(() => controller.start()).toThrow(KnowledgeProductionWorkerControllerError);
  });

  it("contains invalid scheduler time without leaving the detached controller wedged", async () => {
    const firstPass = createDeferred<void>();
    const secondPass = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        firstPass.resolve();
        return { kind: "waiting", nextAttemptAt: 150 };
      }
      secondPass.resolve();
      return { kind: "idle" };
    });
    const scheduler = new TestScheduler();
    scheduler.nowValue = -1;
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await firstPass.promise;
    await Promise.resolve();
    await Promise.resolve();

    scheduler.nowValue = 150;
    controller.notifyWorkAvailable();
    await secondPass.promise;
    expect(runNext).toHaveBeenCalledTimes(2);
    controller.close();
  });

  it("retries rejected worker infrastructure with capped-state backoff that resets on success", async () => {
    const attempts = Array.from({ length: 4 }, () => createDeferred<void>());
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      const attempt = runNext.mock.calls.length - 1;
      attempts[attempt].resolve();
      if (attempt === 0 || attempt === 1 || attempt === 3) {
        throw new Error("transient Queue infrastructure failure");
      }
      return { kind: "idle" };
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await attempts[0].promise;
    await Promise.resolve();
    expect(scheduler.scheduled.get(1)?.delayMs).toBe(250);

    scheduler.run(1);
    await attempts[1].promise;
    await Promise.resolve();
    expect(scheduler.scheduled.get(2)?.delayMs).toBe(500);

    scheduler.run(2);
    await attempts[2].promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.scheduled.size).toBe(0);

    controller.notifyWorkAvailable();
    await attempts[3].promise;
    await Promise.resolve();
    expect(scheduler.scheduled.get(3)?.delayMs).toBe(250);
    controller.close();
  });

  it("caps repeated infrastructure-failure backoff", async () => {
    const expectedDelays = [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    const attempts = expectedDelays.map(() => createDeferred<void>());
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      attempts[runNext.mock.calls.length - 1].resolve();
      throw new Error("persistent Queue infrastructure failure");
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    for (const [attempt, expectedDelay] of expectedDelays.entries()) {
      await attempts[attempt].promise;
      await Promise.resolve();
      expect([...scheduler.scheduled.values()].map(({ delayMs }) => delayMs)).toEqual([
        expectedDelay,
      ]);
      if (attempt < expectedDelays.length - 1) scheduler.run(attempt + 1);
    }

    controller.close();
  });

  it("yields after a bounded immediate progress quantum", async () => {
    const quantumReached = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async (): Promise<RunNextResult> => {
      if (runNext.mock.calls.length === 32) quantumReached.resolve();
      return {
        kind: "executed",
        jobId: `job-${runNext.mock.calls.length}`,
        status: "awaiting_review",
      };
    });
    const scheduler = new TestScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await quantumReached.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(runNext).toHaveBeenCalledTimes(32);
    expect([...scheduler.scheduled.values()]).toEqual([expect.objectContaining({ delayMs: 0 })]);
    controller.close();
  });

  it("cancels handles returned after synchronous scheduler callbacks", async () => {
    const secondPass = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      if (runNext.mock.calls.length === 1) {
        return { kind: "waiting", nextAttemptAt: 150 };
      }
      secondPass.resolve();
      return { kind: "idle" };
    });
    const scheduler = new SynchronousScheduler();
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler,
    });

    controller.start();
    await secondPass.promise;
    await Promise.resolve();

    expect(scheduler.retained.size).toBe(0);
    expect(scheduler.cancelled).toEqual([1, 2]);
    expect(runNext).toHaveBeenCalledTimes(2);
    controller.close();
  });

  it("settles only after a pending drain unwinds following close", async () => {
    const claimed = createDeferred<void>();
    const pending = createDeferred<RunNextResult>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      claimed.resolve();
      return pending.promise;
    });
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler: new TestScheduler(),
    });

    controller.start();
    await claimed.promise;
    controller.close();
    let settled = false;
    const settlement = controller.whenSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.resolve({ kind: "idle" });
    await settlement;
    expect(settled).toBe(true);
    await expect(controller.whenSettled()).resolves.toBeUndefined();
  });

  it("retains its lifetime settlement across idle periods until close", async () => {
    const idle = createDeferred<void>();
    const runNext = jest.fn<Promise<RunNextResult>, [string]>(async () => {
      idle.resolve();
      return { kind: "idle" };
    });
    const controller = new KnowledgeProductionWorkerController({
      worker: createWorker(runNext),
      scheduler: new TestScheduler(),
    });
    let settled = false;
    const lifetime = controller.whenSettled().then(() => {
      settled = true;
    });

    controller.start();
    await idle.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.close();
    await lifetime;
    expect(settled).toBe(true);
  });
});
