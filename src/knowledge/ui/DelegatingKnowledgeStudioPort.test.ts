import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import { createUnavailableKnowledgeStudioSnapshot } from "@/knowledge/ui/KnowledgeStudioController";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeGroundedRetrievalResult,
  KnowledgeStudioQueryPort,
  KnowledgeStudioQueryRequest,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackRequest,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";

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
  expectedQueueRevision?: number;
  signal: AbortSignal;
}

/** One read-only Query or opaque citation call received by a delegate. */
type RecordedQueryCall =
  | {
      kind: "query";
      bundleId: string;
      request: Readonly<KnowledgeStudioQueryRequest>;
      signal: AbortSignal;
    }
  | {
      kind: "citation";
      bundleId: string;
      queryId: string;
      citationRef: string;
      signal: AbortSignal;
    }
  | {
      kind: "writeback";
      bundleId: string;
      queryId: string;
      request: Readonly<KnowledgeStudioQueryWritebackRequest>;
      signal: AbortSignal;
    };

/** Optional behavior injected into the recording Studio port. */
interface RecordingPortHandlers {
  load?: (bundleId: string, signal: AbortSignal) => Promise<KnowledgeStudioSnapshot>;
  command?: (call: RecordedCommandCall) => Promise<void>;
  review?: (
    call: RecordedCommandCall,
    command: KnowledgeReviewCommand
  ) => Promise<KnowledgeStudioReviewSubmissionResult>;
  query?: (
    call: Extract<RecordedQueryCall, { kind: "query" }>
  ) => Promise<KnowledgeGroundedRetrievalResult>;
  citation?: (call: Extract<RecordedQueryCall, { kind: "citation" }>) => Promise<void>;
  writeback?: (
    call: Extract<RecordedQueryCall, { kind: "writeback" }>
  ) => Promise<KnowledgeStudioQueryWritebackResult>;
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

/** Creates one empty but valid grounded Query result for delegation tests. */
function createQueryResult(queryId = "query-1"): KnowledgeGroundedRetrievalResult {
  return {
    mode: "grounded_retrieval",
    bundleId: "personal",
    queryId,
    runtimeRevision: 1,
    manifestRevision: 1,
    hits: [],
  };
}

/** Read/command delegate that records operations, signals, and hint bindings. */
class RecordingKnowledgeStudioPort
  implements
    KnowledgeStudioReadPort,
    KnowledgeStudioCommandPort,
    KnowledgeStudioQueryPort,
    KnowledgeStudioQueryWritebackPort
{
  readonly loadCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly commandCalls: RecordedCommandCall[] = [];
  readonly queryCalls: RecordedQueryCall[] = [];
  readonly revokeCalls: Array<{ bundleId: string; queryId?: string }> = [];
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
  async pauseBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runVoidCommand({ kind: "pause", bundleId, expectedQueueRevision, signal });
  }

  /** Records and executes one Bundle resume. */
  async resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runVoidCommand({ kind: "resume", bundleId, expectedQueueRevision, signal });
  }

  /** Records and executes one job cancellation. */
  async cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runVoidCommand({
      kind: "cancel",
      bundleId,
      targetId: jobId,
      expectedQueueRevision,
      signal,
    });
  }

  /** Records and executes one job retry. */
  async retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runVoidCommand({
      kind: "retry",
      bundleId,
      targetId: jobId,
      expectedQueueRevision,
      signal,
    });
  }

  /** Records and executes one review submission. */
  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    const call: RecordedCommandCall = { kind: "review", bundleId, signal };
    this.commandCalls.push(call);
    return this.handlers.review?.(call, command) ?? Promise.resolve({ kind: "applied" });
  }

  /** Records and executes one retrieval-only Query. */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeGroundedRetrievalResult> {
    const call = { kind: "query" as const, bundleId, request, signal };
    this.queryCalls.push(call);
    return this.handlers.query?.(call) ?? Promise.resolve(createQueryResult());
  }

  /** Records and executes one opaque citation jump. */
  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    const call = { kind: "citation" as const, bundleId, queryId, citationRef, signal };
    this.queryCalls.push(call);
    return this.handlers.citation?.(call) ?? Promise.resolve();
  }

  /** Records and executes one reviewed current-answer registration. */
  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    const call = { kind: "writeback" as const, bundleId, queryId, request, signal };
    this.queryCalls.push(call);
    return this.handlers.writeback?.(call) ?? Promise.resolve({ kind: "registered" });
  }

  /** Records synchronous exact or Bundle-wide Query revocation. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    this.revokeCalls.push({ bundleId, ...(queryId === undefined ? {} : { queryId }) });
  }

  /** Satisfies the complete Query contract; delegate lifetime remains externally owned. */
  close(): void {
    // The production composer, not the stable wrapper, owns delegate closure.
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
    await expect(port.pauseBundle("personal", 0, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });

    const delegate = new RecordingKnowledgeStudioPort("ready");
    port.replaceDelegate(delegate);

    expect(port).toBe(stableReference);
    await expect(port.load("personal", signal)).resolves.toMatchObject({
      availability: "ready",
      revisionToken: "ready-1",
    });
    await port.pauseBundle("personal", 7, signal);
    await port.resumeBundle("personal", 8, signal);
    await port.cancelJob("personal", "job-1", 9, signal);
    await port.retryJob("personal", "job-2", 10, signal);
    await expect(port.submitReview("personal", createReviewCommand(), signal)).resolves.toEqual({
      kind: "applied",
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

  it("routes scoped Query and opaque citation jumps through only the current generation", async () => {
    const oldQuery = createDeferred<KnowledgeGroundedRetrievalResult>();
    const oldDelegate = new RecordingKnowledgeStudioPort("old", {
      query: async () => oldQuery.promise,
    });
    const replacement = new RecordingKnowledgeStudioPort("new", {
      query: async () => createQueryResult("query-new"),
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);

    const stale = port.query("personal", { query: "old generation" }, new AbortController().signal);
    await flushAsync();
    port.replaceDelegate(replacement);

    expect(oldDelegate.queryCalls).toHaveLength(1);
    expect(oldDelegate.queryCalls[0].signal.aborted).toBe(true);
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });

    const result = await port.query(
      "personal",
      { query: "current generation" },
      new AbortController().signal
    );
    await port.openCitation(
      "personal",
      result.queryId,
      "citation-current",
      new AbortController().signal
    );
    port.revokeCurrent("personal", result.queryId);

    expect(result.queryId).toBe("query-new");
    expect(replacement.queryCalls).toHaveLength(2);
    expect(replacement.revokeCalls).toEqual([{ bundleId: "personal", queryId: "query-new" }]);
    expect(replacement.queryCalls).toMatchObject([
      { kind: "query", bundleId: "personal", request: { query: "current generation" } },
      {
        kind: "citation",
        bundleId: "personal",
        queryId: "query-new",
        citationRef: "citation-current",
      },
    ]);

    oldQuery.resolve(createQueryResult("late-old"));
    await flushAsync();
  });

  it("revokes stale source lifecycle work and routes new actions only to the current generation", async () => {
    const oldCheck = createDeferred<void>();
    let oldSignal: AbortSignal | undefined;
    const oldDelegate = Object.assign(new RecordingKnowledgeStudioPort("old"), {
      loadSources: async () =>
        Object.freeze({
          bundleId: "personal",
          runtimeRevision: 1,
          manifestRevision: 1,
          sources: Object.freeze([]),
        }),
      checkAgain: async (_bundleId: string, _sourceId: string, signal: AbortSignal) => {
        oldSignal = signal;
        return oldCheck.promise;
      },
      retireSource: async () =>
        Object.freeze({ outcome: "retired" as const, retainedWikiPageCount: 0 }),
    });
    const retireSource = jest.fn(async () =>
      Object.freeze({ outcome: "retired" as const, retainedWikiPageCount: 2 })
    );
    const replacement = Object.assign(new RecordingKnowledgeStudioPort("new"), {
      loadSources: async () =>
        Object.freeze({
          bundleId: "personal",
          runtimeRevision: 2,
          manifestRevision: 2,
          sources: Object.freeze([]),
        }),
      checkAgain: async () => undefined,
      retireSource,
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);
    expect("replaceMissingSource" in port).toBe(false);

    const stale = port.checkAgain("personal", "source-old", new AbortController().signal);
    await flushAsync();
    port.replaceDelegate(replacement);

    expect(oldSignal?.aborted).toBe(true);
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(port.loadSources("personal", new AbortController().signal)).resolves.toMatchObject(
      {
        runtimeRevision: 2,
      }
    );
    await expect(
      port.retireSource(
        "personal",
        {
          sourceId: "source-new",
          retirementRef: "d".repeat(64),
          reason: "user_requested",
        },
        new AbortController().signal
      )
    ).resolves.toEqual({ outcome: "retired", retainedWikiPageCount: 2 });
    expect(retireSource).toHaveBeenCalledTimes(1);

    oldCheck.resolve();
    await flushAsync();
  });

  it("returns a committed retirement receipt after delegate replacement", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const replacementRetire = jest.fn(async () =>
      Object.freeze({ outcome: "retired" as const, retainedWikiPageCount: 9 })
    );
    const replacement = Object.assign(new RecordingKnowledgeStudioPort("new"), {
      retireSource: replacementRetire,
    });
    const committedReceipt = Object.freeze({
      outcome: "retired" as const,
      retainedWikiPageCount: 2,
    });
    const retireSource = jest.fn(async () => {
      port.replaceDelegate(replacement);
      return committedReceipt;
    });
    port.replaceDelegate(
      Object.assign(new RecordingKnowledgeStudioPort("old"), {
        retireSource,
      })
    );

    await expect(
      port.retireSource(
        "personal",
        {
          sourceId: "source-old",
          retirementRef: "d".repeat(64),
          reason: "user_requested",
        },
        new AbortController().signal
      )
    ).resolves.toBe(committedReceipt);
    expect(retireSource).toHaveBeenCalledTimes(1);
    expect(replacementRetire).not.toHaveBeenCalled();
  });

  it("returns a committed retirement receipt after caller cancellation", async () => {
    const caller = new AbortController();
    const committedReceipt = Object.freeze({
      outcome: "retired" as const,
      retainedWikiPageCount: 2,
    });
    const retireSource = jest.fn(async () => {
      caller.abort();
      return committedReceipt;
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(
      Object.assign(new RecordingKnowledgeStudioPort("current"), {
        retireSource,
      })
    );

    await expect(
      port.retireSource(
        "personal",
        {
          sourceId: "source-current",
          retirementRef: "d".repeat(64),
          reason: "user_requested",
        },
        caller.signal
      )
    ).resolves.toBe(committedReceipt);
    expect(retireSource).toHaveBeenCalledTimes(1);
  });

  it("does not invoke retirement when caller cancellation is already active", async () => {
    const caller = new AbortController();
    caller.abort();
    const retireSource = jest.fn(async () =>
      Object.freeze({ outcome: "retired" as const, retainedWikiPageCount: 2 })
    );
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(
      Object.assign(new RecordingKnowledgeStudioPort("current"), {
        retireSource,
      })
    );

    await expect(
      port.retireSource(
        "personal",
        {
          sourceId: "source-current",
          retirementRef: "d".repeat(64),
          reason: "user_requested",
        },
        caller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(retireSource).not.toHaveBeenCalled();
  });

  it("routes reviewed writeback through one generation and rejects its late replaced result", async () => {
    const oldWriteback = createDeferred<KnowledgeStudioQueryWritebackResult>();
    const oldDelegate = new RecordingKnowledgeStudioPort("old", {
      writeback: async () => oldWriteback.promise,
    });
    const replacement = new RecordingKnowledgeStudioPort("new");
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);

    const stale = port.saveQueryToWiki(
      "personal",
      "query-old",
      { title: "Old answer" },
      new AbortController().signal
    );
    await flushAsync();
    port.replaceDelegate(replacement);

    expect(oldDelegate.queryCalls).toHaveLength(1);
    expect(oldDelegate.queryCalls[0]).toMatchObject({
      kind: "writeback",
      bundleId: "personal",
      queryId: "query-old",
      request: { title: "Old answer" },
    });
    expect(oldDelegate.queryCalls[0].signal.aborted).toBe(true);
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });

    await expect(
      port.saveQueryToWiki(
        "personal",
        "query-current",
        { title: "Current answer" },
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "registered" });
    expect(replacement.queryCalls).toMatchObject([
      {
        kind: "writeback",
        bundleId: "personal",
        queryId: "query-current",
        request: { title: "Current answer" },
      },
    ]);

    oldWriteback.resolve({ kind: "registered" });
    await flushAsync();
  });

  it("routes synchronous Query revocation only to the current delegate generation", () => {
    const port = new DelegatingKnowledgeStudioPort();
    const oldDelegate = new RecordingKnowledgeStudioPort("old");
    const replacement = new RecordingKnowledgeStudioPort("new");

    expect(() => port.revokeCurrent("personal", "query-before-install")).not.toThrow();

    port.replaceDelegate(oldDelegate);
    port.revokeCurrent("personal", "query-exact");
    expect(oldDelegate.revokeCalls).toEqual([{ bundleId: "personal", queryId: "query-exact" }]);

    port.revokeCurrent("personal");
    expect(oldDelegate.revokeCalls).toEqual([
      { bundleId: "personal", queryId: "query-exact" },
      { bundleId: "personal" },
    ]);

    port.replaceDelegate(replacement);
    port.revokeCurrent("work", "query-replacement");
    port.revokeCurrent("work");

    expect(oldDelegate.revokeCalls).toEqual([
      { bundleId: "personal", queryId: "query-exact" },
      { bundleId: "personal" },
    ]);
    expect(replacement.revokeCalls).toEqual([
      { bundleId: "work", queryId: "query-replacement" },
      { bundleId: "work" },
    ]);

    port.close();
    expect(() => port.revokeCurrent("work", "query-after-close")).not.toThrow();
    expect(replacement.revokeCalls).toHaveLength(2);
  });

  it("fail-closes when a delegate implements Query revocation asynchronously", () => {
    const delegate = new RecordingKnowledgeStudioPort("invalid");
    Object.defineProperty(delegate, "revokeCurrent", {
      value: jest.fn(() => Promise.resolve()),
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(delegate);

    expect(() => port.revokeCurrent("personal", "query-async")).toThrow(
      "Knowledge Studio runtime adapters are not configured yet"
    );
  });

  it("does not dispatch queued work after synchronous generation replacement", async () => {
    const oldDelegate = new RecordingKnowledgeStudioPort("old");
    const replacement = new RecordingKnowledgeStudioPort("new");
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(oldDelegate);

    const stale = port.query(
      "personal",
      { query: "must not dispatch" },
      new AbortController().signal
    );
    port.replaceDelegate(replacement);

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(oldDelegate.queryCalls).toHaveLength(0);
    expect(replacement.queryCalls).toHaveLength(0);
  });

  it("keeps Query and reviewed writeback fail-closed when their adapter is unavailable", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const signal = new AbortController().signal;

    await expect(port.query("personal", { query: "blocked" }, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(
      port.saveQueryToWiki("personal", "query", { title: "Blocked" }, signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });

    const withoutWriteback = new RecordingKnowledgeStudioPort("query-only");
    Object.defineProperty(withoutWriteback, "saveQueryToWiki", { value: undefined });
    port.replaceDelegate(withoutWriteback);
    await expect(
      port.saveQueryToWiki("personal", "query", { title: "Blocked" }, signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });

    port.replaceDelegate(new RecordingKnowledgeStudioPort("ready"));
    port.close();

    await expect(port.openCitation("personal", "query", "citation", signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(
      port.saveQueryToWiki("personal", "query", { title: "Blocked" }, signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
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
    const oldPause = port.pauseBundle("personal", 1, new AbortController().signal);
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
    const pendingPause = port.pauseBundle("personal", 1, new AbortController().signal);
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
    await expect(
      port.pauseBundle("personal", 1, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
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
