import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import {
  KnowledgeStudioController,
  UnavailableKnowledgeStudioPort,
  createUnavailableKnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

/** Promise whose completion is controlled explicitly by one test. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
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

/** Flushes promise continuations scheduled by controller fire-and-forget calls. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Creates a compact current review plan for controller identity tests. */
function createReviewPlan(token = "snapshot-1"): KnowledgeReviewPlan {
  return {
    changeSetId: "changeset-1",
    bundleId: "personal",
    proposalDigest: "a".repeat(64),
    snapshotToken: token,
    operation: "ingest",
    sourceRefs: ["source-1"],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 10,
    files: [
      {
        changeId: "change-1",
        path: "Wiki/Page.md",
        operation: "create",
        reason: "Create page",
        sourceRefs: ["source-1"],
        integrity: "current",
        capability: "blocks_allowed",
        beforeContent: "",
        afterContent: "# Page\n",
        blocks: [
          {
            blockId: "block-1",
            kind: "change",
            parts: [{ kind: "added", value: "# Page\n" }],
          },
        ],
      },
    ],
  };
}

/** Creates a ready snapshot by replacing only the unavailable shell metadata. */
function createSnapshot(
  revisionToken = "revision-1",
  reviews: readonly KnowledgeReviewPlan[] = [createReviewPlan()]
): KnowledgeStudioSnapshot {
  const base = createUnavailableKnowledgeStudioSnapshot("personal");
  return {
    ...base,
    revisionToken,
    availability: "ready",
    activity: {
      ...base.activity,
      controls: { state: "running", canPause: true, canResume: false },
    },
    reviews,
    notice: undefined,
  };
}

type LoadHandler = (bundleId: string, signal: AbortSignal) => Promise<KnowledgeStudioSnapshot>;
type VoidCommandHandler = (
  bundleId: string,
  targetId: string,
  signal: AbortSignal
) => Promise<void>;
type ReviewCommandHandler = (
  bundleId: string,
  command: KnowledgeReviewCommand,
  signal: AbortSignal
) => Promise<KnowledgeStudioReviewSubmissionResult>;

/** Scriptable read/command port that records every boundary call. */
class FakeKnowledgeStudioPort implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort {
  readonly loadCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly pauseCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly resumeCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly cancelCalls: { bundleId: string; targetId: string; signal: AbortSignal }[] = [];
  readonly retryCalls: { bundleId: string; targetId: string; signal: AbortSignal }[] = [];
  readonly reviewCalls: {
    bundleId: string;
    command: KnowledgeReviewCommand;
    signal: AbortSignal;
  }[] = [];
  hint?: () => void;
  unsubscribed = false;

  /** Creates a fake around explicit read and optional command handlers. */
  constructor(
    private readonly loadHandler: LoadHandler,
    private readonly voidCommandHandler: VoidCommandHandler = async () => undefined,
    private readonly reviewCommandHandler: ReviewCommandHandler = async () => ({
      kind: "apply_started",
    })
  ) {}

  /** Records and delegates one snapshot load. */
  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    this.loadCalls.push({ bundleId, signal });
    return this.loadHandler(bundleId, signal);
  }

  /** Retains the reload hint and reports unsubscription. */
  subscribe(_bundleId: string, onHint: () => void): () => void {
    this.hint = onHint;
    return () => {
      this.unsubscribed = true;
    };
  }

  /** Records and delegates a Bundle pause. */
  async pauseBundle(bundleId: string, signal: AbortSignal): Promise<void> {
    this.pauseCalls.push({ bundleId, signal });
    return this.voidCommandHandler(bundleId, "pause", signal);
  }

  /** Records and delegates a Bundle resume. */
  async resumeBundle(bundleId: string, signal: AbortSignal): Promise<void> {
    this.resumeCalls.push({ bundleId, signal });
    return this.voidCommandHandler(bundleId, "resume", signal);
  }

  /** Records and delegates one job cancellation. */
  async cancelJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void> {
    this.cancelCalls.push({ bundleId, targetId: jobId, signal });
    return this.voidCommandHandler(bundleId, jobId, signal);
  }

  /** Records and delegates one job retry. */
  async retryJob(bundleId: string, jobId: string, signal: AbortSignal): Promise<void> {
    this.retryCalls.push({ bundleId, targetId: jobId, signal });
    return this.voidCommandHandler(bundleId, jobId, signal);
  }

  /** Records and delegates an opaque review command. */
  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    this.reviewCalls.push({ bundleId, command, signal });
    return this.reviewCommandHandler(bundleId, command, signal);
  }
}

/** Builds the content-free command expected by the controller boundary. */
function createReviewCommand(token = "snapshot-1"): KnowledgeReviewCommand {
  return {
    changeSetId: "changeset-1",
    proposalDigest: "a".repeat(64),
    expectedSnapshotToken: token,
    decisions: [{ changeId: "change-1", decision: "accept_blocks", acceptedBlockIds: ["block-1"] }],
  };
}

describe("KnowledgeStudioController", () => {
  it("loads an explicit fail-closed shell before runtime adapters are connected", async () => {
    const port = new UnavailableKnowledgeStudioPort();
    const snapshot = await port.load("personal", new AbortController().signal);

    expect(snapshot).toMatchObject({
      bundleId: "personal",
      availability: "adapter_unavailable",
      reviews: [],
    });
    expect(snapshot.activity.items).toEqual([]);
    await expect(port.pauseBundle("personal", new AbortController().signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
  });

  it("treats subscription events as reload hints instead of optimistic state", async () => {
    const snapshots = [createSnapshot("revision-1"), createSnapshot("revision-2")];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const controller = new KnowledgeStudioController(port, port);

    controller.start("personal");
    await flushAsync();
    expect(controller.getState().snapshot?.revisionToken).toBe("revision-1");

    port.hint?.();
    expect(controller.getState().snapshot?.revisionToken).toBe("revision-1");
    await flushAsync();
    expect(controller.getState().snapshot?.revisionToken).toBe("revision-2");
    expect(port.loadCalls).toHaveLength(2);
  });

  it("ignores an older load that resolves after a newer refresh", async () => {
    const first = createDeferred<KnowledgeStudioSnapshot>();
    const second = createDeferred<KnowledgeStudioSnapshot>();
    const loads = [first.promise, second.promise];
    const port = new FakeKnowledgeStudioPort(async () => loads.shift()!);
    const controller = new KnowledgeStudioController(port, port);

    controller.start("personal");
    const refresh = controller.refresh();
    second.resolve(createSnapshot("newer"));
    await refresh;
    first.resolve(createSnapshot("older"));
    await flushAsync();

    expect(port.loadCalls[0].signal.aborted).toBe(true);
    expect(controller.getState().snapshot?.revisionToken).toBe("newer");
  });

  it("serializes commands, keeps durable rows unchanged, and reloads after completion", async () => {
    const pause = createDeferred<void>();
    const snapshots = [createSnapshot("before"), createSnapshot("after")];
    const port = new FakeKnowledgeStudioPort(
      async () => snapshots.shift()!,
      async (_bundleId, targetId) => {
        if (targetId === "pause") return pause.promise;
      }
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    const action = controller.pauseBundle();
    await controller.retryJob("job-ignored");
    expect(controller.getState()).toMatchObject({
      pendingAction: { kind: "pause" },
      snapshot: { revisionToken: "before" },
    });
    expect(port.retryCalls).toHaveLength(0);

    pause.resolve();
    await action;
    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState()).toMatchObject({
      status: "ready",
      snapshot: { revisionToken: "after" },
      feedback: { kind: "success" },
    });
  });

  it("forwards only the opaque review command and reloads blocked diagnostics", async () => {
    const command = createReviewCommand();
    const snapshots = [createSnapshot("before"), createSnapshot("after")];
    const port = new FakeKnowledgeStudioPort(
      async () => snapshots.shift()!,
      undefined,
      async () => ({
        kind: "blocked",
        diagnostics: [
          { code: "links_invalid", severity: "error", field: "links", message: "Unsafe link" },
        ],
      })
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.submitReview(command);

    expect(port.reviewCalls).toHaveLength(1);
    expect(port.reviewCalls[0]).toMatchObject({ bundleId: "personal", command });
    expect(Object.keys(port.reviewCalls[0].command).sort()).toEqual([
      "changeSetId",
      "decisions",
      "expectedSnapshotToken",
      "proposalDigest",
    ]);
    expect(controller.getState().feedback).toMatchObject({
      kind: "blocked",
      diagnostics: [{ code: "links_invalid" }],
    });
  });

  it("rejects a stale local review without calling the command port", async () => {
    const port = new FakeKnowledgeStudioPort(async () => createSnapshot());
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.submitReview(createReviewCommand("stale-token"));

    expect(port.reviewCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });
  });

  it("fails closed on a cross-Bundle snapshot and never exposes raw errors", async () => {
    const invalid = {
      ...createSnapshot(),
      bundleId: "other",
    };
    const port = new FakeKnowledgeStudioPort(async () => invalid);
    const controller = new KnowledgeStudioController(port, port);

    controller.start("personal");
    await flushAsync();

    expect(controller.getState()).toMatchObject({
      status: "error",
      error: "Knowledge Studio could not load its durable state.",
    });
    expect(controller.getState().snapshot).toBeUndefined();
  });

  it("aborts work and removes hint subscriptions when stopped", async () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const port = new FakeKnowledgeStudioPort(async () => load.promise);
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    const signal = port.loadCalls[0].signal;

    controller.stop();

    expect(signal.aborted).toBe(true);
    expect(port.unsubscribed).toBe(true);
    expect(controller.getState()).toMatchObject({ status: "idle", refreshing: false });
  });
});
