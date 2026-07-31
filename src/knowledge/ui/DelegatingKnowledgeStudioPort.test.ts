import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import { createUnavailableKnowledgeStudioSnapshot } from "@/knowledge/ui/KnowledgeStudioController";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";

/** Promise whose settlement is controlled by one test. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** One recorded delegate hint subscription. */
interface RecordedHintSubscription {
  bundleId: string;
  onHint: () => void;
  active: boolean;
}

/** One recorded command call. */
interface RecordedCommandCall {
  kind: "pause" | "resume" | "cancel" | "retry" | "review";
  bundleId: string;
  targetId?: string;
  signal: AbortSignal;
}

/** Optional behavior injected into the recording Studio port. */
interface RecordingPortHandlers {
  load?: (bundleId: string, signal: AbortSignal) => Promise<KnowledgeStudioSnapshot>;
  command?: (call: RecordedCommandCall) => Promise<void>;
  review?: (
    call: RecordedCommandCall,
    command: KnowledgeReviewCommand
  ) => Promise<KnowledgeStudioReviewSubmissionResult>;
}

/** Creates a manually controlled promise. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Flushes delegate calls scheduled through a promise continuation. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Creates a ready snapshot with an explicit revision.
 *
 * @param revisionToken - Durable revision represented by the snapshot
 * @param bundleId - Bundle represented by the snapshot
 * @returns Ready snapshot
 */
function createReadySnapshot(
  revisionToken: string,
  bundleId = "personal"
): KnowledgeStudioSnapshot {
  const unavailable = createUnavailableKnowledgeStudioSnapshot(bundleId);
  return {
    ...unavailable,
    revisionToken,
    availability: "ready",
    activity: {
      ...unavailable.activity,
      controls: { state: "running", canPause: true, canResume: false },
    },
    notice: undefined,
  };
}

/** Creates a content-free review command for command-routing tests. */
function createReviewCommand(): KnowledgeReviewCommand {
  return {
    changeSetId: "changeset-1",
    proposalDigest: "a".repeat(64),
    expectedSnapshotToken: "snapshot-1",
    decisions: [{ changeId: "change-1", decision: "reject" }],
  };
}

/** Read/command delegate that records operations, signals, and hint bindings. */
class RecordingKnowledgeStudioPort implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort {
  readonly loadCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly commandCalls: RecordedCommandCall[] = [];
  readonly hintSubscriptions: RecordedHintSubscription[] = [];
  unsubscribeCount = 0;

  /**
   * Creates a recording port with optional asynchronous behavior.
   *
   * @param name - Revision prefix returned by the default load implementation
   * @param handlers - Optional load and command implementations
   */
  constructor(
    private readonly name: string,
    private readonly handlers: RecordingPortHandlers = {}
  ) {}

  /** Records and executes one snapshot load. */
  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    this.loadCalls.push({ bundleId, signal });
    return (
      this.handlers.load?.(bundleId, signal) ??
      Promise.resolve(createReadySnapshot(`${this.name}-${this.loadCalls.length}`, bundleId))
    );
  }

  /** Records one delegate hint subscription and its cleanup. */
  subscribe(bundleId: string, onHint: () => void): () => void {
    const subscription: RecordedHintSubscription = { bundleId, onHint, active: true };
    this.hintSubscriptions.push(subscription);
    return () => {
      if (!subscription.active) {
        return;
      }
      subscription.active = false;
      this.unsubscribeCount += 1;
    };
  }

  /** Records and executes one Bundle pause. */
  async pauseBundle(bundleId: string, signal: AbortSignal): Promise<void> {
    return this.runVoidCommand({ kind: "pause", bundleId, signal });
  }

  /** Records and executes one Bundle resume. */
  async resumeBundle(bundleId: string, signal: AbortSignal): Promise<void> {
    return this.runVoidCommand({ kind: "resume", bundleId, signal });
  }

  /** Records and executes one job cancellation. */
  async cancelJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void> {
    return this.runVoidCommand({ kind: "cancel", bundleId, targetId: jobId, signal });
  }

  /** Records and executes one job retry. */
  async retryJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void> {
    return this.runVoidCommand({ kind: "retry", bundleId, targetId: jobId, signal });
  }

  /** Records and executes one review submission. */
  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    const call: RecordedCommandCall = { kind: "review", bundleId, signal };
    this.commandCalls.push(call);
    return this.handlers.review?.(call, command) ?? Promise.resolve({ kind: "apply_started" });
  }

  /**
   * Emits a hint from every active delegate subscription for one Bundle.
   *
   * @param bundleId - Bundle whose active callbacks are invoked
   */
  emitHint(bundleId: string): void {
    for (const subscription of this.hintSubscriptions) {
      if (subscription.active && subscription.bundleId === bundleId) {
        subscription.onHint();
      }
    }
  }

  /**
   * Invokes a retained callback even after unsubscription to simulate a late source.
   *
   * @param index - Recorded subscription index
   */
  emitRetainedHint(index: number): void {
    this.hintSubscriptions[index]?.onHint();
  }

  /**
   * Records and executes one void command.
   *
   * @param call - Captured command boundary arguments
   */
  private async runVoidCommand(call: RecordedCommandCall): Promise<void> {
    this.commandCalls.push(call);
    return this.handlers.command?.(call) ?? Promise.resolve();
  }
}

describe("DelegatingKnowledgeStudioPort", () => {
  it("keeps one stable wrapper while moving all reads and commands to the current delegate", async () => {
    const port = new DelegatingKnowledgeStudioPort("Adapters are still starting.");
    const stableReference = port;
    const signal = new AbortController().signal;

    await expect(port.load("personal", signal)).resolves.toMatchObject({
      availability: "adapter_unavailable",
      notice: "Adapters are still starting.",
    });
    await expect(port.pauseBundle("personal", signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });

    const delegate = new RecordingKnowledgeStudioPort("ready");
    port.replaceDelegate(delegate);

    expect(port).toBe(stableReference);
    await expect(port.load("personal", signal)).resolves.toMatchObject({
      availability: "ready",
      revisionToken: "ready-1",
    });
    await port.pauseBundle("personal", signal);
    await port.resumeBundle("personal", signal);
    await port.cancelJob("personal", "job-1", signal);
    await port.retryJob("personal", "job-2", signal);
    await expect(port.submitReview("personal", createReviewCommand(), signal)).resolves.toEqual({
      kind: "apply_started",
    });

    expect(delegate.commandCalls.map(({ kind, targetId }) => ({ kind, targetId }))).toEqual([
      { kind: "pause", targetId: undefined },
      { kind: "resume", targetId: undefined },
      { kind: "cancel", targetId: "job-1" },
      { kind: "retry", targetId: "job-2" },
      { kind: "review", targetId: undefined },
    ]);
    expect(delegate.commandCalls.every((call) => call.signal !== signal)).toBe(true);
  });

  it("never caches an authoritative snapshot between loads", async () => {
    const delegate = new RecordingKnowledgeStudioPort("durable");
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(delegate);

    const first = await port.load("personal", new AbortController().signal);
    const second = await port.load("personal", new AbortController().signal);

    expect(first.revisionToken).toBe("durable-1");
    expect(second.revisionToken).toBe("durable-2");
    expect(delegate.loadCalls).toHaveLength(2);
  });

  it("aborts in-flight old work and rejects late load and command results after replacement", async () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const command = createDeferred<void>();
    const oldDelegate = new RecordingKnowledgeStudioPort("old", {
      load: async () => load.promise,
      command: async () => command.promise,
    });
    const replacement = new RecordingKnowledgeStudioPort("new");
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);

    const oldLoad = port.load("personal", new AbortController().signal);
    const oldPause = port.pauseBundle("personal", new AbortController().signal);
    await flushAsync();
    expect(oldDelegate.loadCalls).toHaveLength(1);
    expect(oldDelegate.commandCalls).toHaveLength(1);

    port.replaceDelegate(replacement);

    expect(oldDelegate.loadCalls[0].signal.aborted).toBe(true);
    expect(oldDelegate.commandCalls[0].signal.aborted).toBe(true);
    await expect(oldLoad).rejects.toMatchObject({ name: "AbortError" });
    await expect(oldPause).rejects.toMatchObject({ name: "AbortError" });

    load.resolve(createReadySnapshot("late-old"));
    command.reject(new Error("late private failure"));
    await flushAsync();

    await expect(port.load("personal", new AbortController().signal)).resolves.toMatchObject({
      revisionToken: "new-1",
    });
  });

  it("propagates caller cancellation and cannot return a delegate result afterward", async () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const delegate = new RecordingKnowledgeStudioPort("ready", {
      load: async () => load.promise,
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(delegate);
    const caller = new AbortController();

    const pending = port.load("personal", caller.signal);
    await flushAsync();
    caller.abort();

    expect(delegate.loadCalls[0].signal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    load.resolve(createReadySnapshot("late-after-caller-abort"));
    await flushAsync();
  });

  it("rebinds active Bundle hints, emits replacement hints, and ignores late old callbacks", () => {
    const oldDelegate = new RecordingKnowledgeStudioPort("old");
    const replacement = new RecordingKnowledgeStudioPort("new");
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);
    let firstPersonalHints = 0;
    let secondPersonalHints = 0;
    let workHints = 0;

    const unsubscribeThrowing = port.subscribe("personal", () => {
      firstPersonalHints += 1;
      throw new Error("one view is already closing");
    });
    const unsubscribePersonal = port.subscribe("personal", () => {
      secondPersonalHints += 1;
    });
    const unsubscribeWork = port.subscribe("work", () => {
      workHints += 1;
    });

    expect(oldDelegate.hintSubscriptions.map(({ bundleId }) => bundleId)).toEqual([
      "personal",
      "work",
    ]);

    port.replaceDelegate(replacement);

    expect(oldDelegate.unsubscribeCount).toBe(2);
    expect(replacement.hintSubscriptions.map(({ bundleId }) => bundleId)).toEqual([
      "personal",
      "work",
    ]);
    expect({ firstPersonalHints, secondPersonalHints, workHints }).toEqual({
      firstPersonalHints: 1,
      secondPersonalHints: 1,
      workHints: 1,
    });

    oldDelegate.emitRetainedHint(0);
    expect(secondPersonalHints).toBe(1);
    replacement.emitHint("personal");
    expect(firstPersonalHints).toBe(2);
    expect(secondPersonalHints).toBe(2);

    unsubscribeThrowing();
    expect(replacement.unsubscribeCount).toBe(0);
    unsubscribePersonal();
    expect(replacement.unsubscribeCount).toBe(1);
    unsubscribeWork();
    expect(replacement.unsubscribeCount).toBe(2);
  });

  it("permanently fail-closes on dispose and notifies current views to reload", async () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const command = createDeferred<void>();
    const delegate = new RecordingKnowledgeStudioPort("ready", {
      load: async () => load.promise,
      command: async () => command.promise,
    });
    const replacement = new RecordingKnowledgeStudioPort("forbidden");
    const port = new DelegatingKnowledgeStudioPort("Studio runtime is unavailable.");
    port.replaceDelegate(delegate);
    let hints = 0;
    port.subscribe("personal", () => {
      hints += 1;
    });

    const pendingLoad = port.load("personal", new AbortController().signal);
    const pendingPause = port.pauseBundle("personal", new AbortController().signal);
    await flushAsync();
    port.dispose();

    expect(delegate.unsubscribeCount).toBe(1);
    expect(delegate.loadCalls[0].signal.aborted).toBe(true);
    expect(delegate.commandCalls[0].signal.aborted).toBe(true);
    expect(hints).toBe(1);
    await expect(pendingLoad).rejects.toMatchObject({ name: "AbortError" });
    await expect(pendingPause).rejects.toMatchObject({ name: "AbortError" });

    await expect(port.load("personal", new AbortController().signal)).resolves.toMatchObject({
      availability: "adapter_unavailable",
      notice: "Studio runtime is unavailable.",
    });
    await expect(port.pauseBundle("personal", new AbortController().signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    expect(port.subscribe("personal", () => undefined)).toBeInstanceOf(Function);
    expect(() => port.replaceDelegate(replacement)).toThrow(
      "Knowledge Studio runtime adapters are not configured yet"
    );
    expect(replacement.loadCalls).toHaveLength(0);

    load.resolve(createReadySnapshot("late-after-dispose"));
    command.resolve();
    await flushAsync();

    port.dispose();
    expect(hints).toBe(1);
  });
});
