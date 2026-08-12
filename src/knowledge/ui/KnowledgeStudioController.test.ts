import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import {
  KnowledgeStudioController,
  UnavailableKnowledgeStudioPort,
  createUnavailableKnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type {
  KnowledgeGroundedAnswerResult,
  KnowledgeGroundedRetrievalResult,
  KnowledgeStudioQueryPort,
  KnowledgeStudioQueryRequest,
  KnowledgeStudioQueryResult,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackRequest,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
  KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import type { KnowledgeRecoveryItem } from "@/knowledge/ui/recoveryModel";
import type {
  KnowledgeSourceLifecycleItem,
  KnowledgeSourceLifecycleModel,
  KnowledgeSourceRemovalConfirmation,
} from "@/knowledge/ui/sourceLifecycleModel";

/** Promise whose completion is controlled explicitly by one test. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** One recorded read-only Query call. */
interface RecordedQueryCall {
  bundleId: string;
  request: Readonly<KnowledgeStudioQueryRequest>;
  signal: AbortSignal;
}

/** One recorded opaque citation-navigation call. */
interface RecordedCitationCall {
  bundleId: string;
  queryId: string;
  citationRef: string;
  signal: AbortSignal;
}

/** One recorded current-answer writeback call. */
interface RecordedQueryWritebackCall {
  bundleId: string;
  queryId: string;
  request: Readonly<KnowledgeStudioQueryWritebackRequest>;
  signal: AbortSignal;
}

/** One recorded source lifecycle recheck. */
interface RecordedSourceCheckCall {
  bundleId: string;
  sourceId: string;
  signal: AbortSignal;
}

/** One recorded source retirement. */
interface RecordedSourceRetirementCall {
  bundleId: string;
  request: Readonly<KnowledgeSourceRetirementRequest>;
  signal: AbortSignal;
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
function createReviewPlan(token = "b".repeat(64)): KnowledgeReviewPlan {
  return {
    changeSetId: "changeset-1",
    bundleId: "personal",
    proposalDigest: "a".repeat(64),
    snapshotToken: token,
    operation: "ingest",
    sourceRefs: ["source-1"],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 10,
    evidence: [],
    omittedEvidenceCount: 0,
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
    commandCapabilities: {
      pauseBundle: true,
      resumeBundle: true,
      cancelJob: true,
      retryJob: true,
      reviewReject: true,
      reviewAccept: true,
    },
    activity: {
      ...base.activity,
      revision: 7,
      controls: { state: "running", canPause: true, canResume: false },
    },
    reviews,
    notice: undefined,
  };
}

/** Creates one source lifecycle projection embedded in a Studio read snapshot. */
function createSourceLifecycle(
  sources: readonly KnowledgeSourceLifecycleItem[] = [
    {
      sourceId: "source-missing",
      sourcePath: "Sources/Missing.md",
      custody: "user_managed",
      generatedPageCount: 2,
      status: "missing",
      issueReason: "source_missing",
      retirementRef: "retirement-missing",
      retirementBlockers: [],
      actions: { canCheckAgain: true, canRemove: true },
    },
  ]
): Readonly<KnowledgeSourceLifecycleModel> {
  return {
    bundleId: "personal",
    runtimeRevision: 9,
    manifestRevision: 4,
    sources,
  };
}

/** Embeds one exact lifecycle model in an otherwise ready Studio snapshot. */
function createSourceSnapshot(
  revisionToken: string,
  sourceLifecycle: Readonly<KnowledgeSourceLifecycleModel> = createSourceLifecycle()
): KnowledgeStudioSnapshot {
  return { ...createSnapshot(revisionToken, []), sourceLifecycle };
}

/** Freezes the exact source-removal authority emitted by the lifecycle panel. */
function createRemovalConfirmation(
  overrides: Partial<KnowledgeSourceRemovalConfirmation> = {}
): Readonly<KnowledgeSourceRemovalConfirmation> {
  return Object.freeze({
    sourceId: "source-missing",
    sourcePath: "Sources/Missing.md",
    retirementRef: "retirement-missing",
    runtimeRevision: 9,
    manifestRevision: 4,
    ...overrides,
  });
}

/** Creates the two actionable recovery rows used by controller command tests. */
function createRecoveryItems(): readonly KnowledgeRecoveryItem[] {
  return [
    {
      id: "recovery-continue",
      status: "accepted_not_started",
      changeSetId: "changeset-continue",
      actions: { canContinue: true, canAbandon: false },
    },
    {
      id: "recovery-decision",
      status: "decision_required",
      changeSetId: "changeset-decision",
      actions: { canContinue: true, canAbandon: true },
    },
  ];
}

/** Creates a ready snapshot with explicit recovery capabilities and rows. */
function createRecoverySnapshot(
  revisionToken = "recovery-revision",
  runtimeRevision = 41,
  items: readonly KnowledgeRecoveryItem[] = createRecoveryItems()
): KnowledgeStudioSnapshot {
  const base = createSnapshot(revisionToken, []);
  return {
    ...base,
    commandCapabilities: {
      ...base.commandCapabilities,
      recoveryContinue: true,
      recoveryAbandon: true,
    },
    recovery: {
      bundleId: base.bundleId,
      runtimeRevision,
      items,
    },
  };
}

/** Creates one exact grounded-retrieval result for controller lifecycle tests. */
function createQueryResult(queryId = "knowledge-query-1"): KnowledgeGroundedRetrievalResult {
  return {
    mode: "grounded_retrieval",
    bundleId: "personal",
    queryId,
    runtimeRevision: 7,
    manifestRevision: 3,
    hits: [
      {
        pageEvidenceId: "wiki-evidence-1",
        pagePath: "Wiki/Page.md",
        pageContentHash: "f".repeat(64),
        chunkId: "wiki-evidence-1:0",
        chunkIndex: 0,
        heading: "Page",
        headingPath: ["Page"],
        snippet: "Grounded knowledge excerpt.",
        startOffset: 0,
        endOffset: 27,
        score: 1,
        citations: [
          {
            citationRef: "knowledge-citation-1",
            sourceId: "source-1",
            sourcePath: "Sources/Page.md",
            relation: "supports",
            location: { kind: "markdown_lines", startLine: 2, endLine: 3 },
          },
        ],
      },
    ],
  };
}

/** Creates one exact grounded-answer result over the same opaque retrieval authority. */
function createAnswerQueryResult(
  queryId = "knowledge-query-answer-1"
): KnowledgeGroundedAnswerResult {
  const retrieval = createQueryResult(queryId);
  return {
    ...retrieval,
    mode: "grounded_answer",
    answer: {
      status: "answered",
      claims: [
        {
          claimId: "claim-1",
          kind: "source_fact",
          text: "Grounded knowledge is available.",
          citations: [retrieval.hits[0].citations[0]],
        },
      ],
      insufficientEvidence: [],
    },
  };
}

type LoadHandler = (bundleId: string, signal: AbortSignal) => Promise<KnowledgeStudioSnapshot>;
type VoidCommandHandler = (
  bundleId: string,
  targetId: string,
  expectedQueueRevision: number,
  signal: AbortSignal
) => Promise<void>;
type ReviewCommandHandler = (
  bundleId: string,
  command: KnowledgeReviewCommand,
  signal: AbortSignal
) => Promise<KnowledgeStudioReviewSubmissionResult>;
type RecoveryCommandHandler = (
  action: "continue" | "abandon",
  bundleId: string,
  recoveryId: string,
  expectedRuntimeRevision: number,
  signal: AbortSignal
) => Promise<KnowledgeStudioRecoverySubmissionResult>;

/** Scriptable read/command port that records every boundary call. */
class FakeKnowledgeStudioPort implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort {
  readonly loadCalls: { bundleId: string; signal: AbortSignal }[] = [];
  readonly pauseCalls: { bundleId: string; expectedQueueRevision: number; signal: AbortSignal }[] =
    [];
  readonly resumeCalls: { bundleId: string; expectedQueueRevision: number; signal: AbortSignal }[] =
    [];
  readonly cancelCalls: {
    bundleId: string;
    targetId: string;
    expectedQueueRevision: number;
    signal: AbortSignal;
  }[] = [];
  readonly retryCalls: {
    bundleId: string;
    targetId: string;
    expectedQueueRevision: number;
    signal: AbortSignal;
  }[] = [];
  readonly reviewCalls: {
    bundleId: string;
    command: KnowledgeReviewCommand;
    signal: AbortSignal;
  }[] = [];
  readonly continueRecoveryCalls: {
    bundleId: string;
    recoveryId: string;
    expectedRuntimeRevision: number;
    signal: AbortSignal;
  }[] = [];
  readonly abandonRecoveryCalls: {
    bundleId: string;
    recoveryId: string;
    expectedRuntimeRevision: number;
    signal: AbortSignal;
  }[] = [];
  hint?: () => void;
  unsubscribed = false;

  /** Creates a fake around explicit read and optional command handlers. */
  constructor(
    private readonly loadHandler: LoadHandler,
    private readonly voidCommandHandler: VoidCommandHandler = async () => undefined,
    private readonly reviewCommandHandler: ReviewCommandHandler = async () => ({
      kind: "applied",
    }),
    private readonly recoveryCommandHandler: RecoveryCommandHandler = async () => ({
      kind: "completed",
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
  async pauseBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    this.pauseCalls.push({ bundleId, expectedQueueRevision, signal });
    return this.voidCommandHandler(bundleId, "pause", expectedQueueRevision, signal);
  }

  /** Records and delegates a Bundle resume. */
  async resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    this.resumeCalls.push({ bundleId, expectedQueueRevision, signal });
    return this.voidCommandHandler(bundleId, "resume", expectedQueueRevision, signal);
  }

  /** Records and delegates one job cancellation. */
  async cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    this.cancelCalls.push({ bundleId, targetId: jobId, expectedQueueRevision, signal });
    return this.voidCommandHandler(bundleId, jobId, expectedQueueRevision, signal);
  }

  /** Records and delegates one job retry. */
  async retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    this.retryCalls.push({ bundleId, targetId: jobId, expectedQueueRevision, signal });
    return this.voidCommandHandler(bundleId, jobId, expectedQueueRevision, signal);
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

  /** Records and delegates one exact recovery continuation. */
  async continueRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    this.continueRecoveryCalls.push({
      bundleId,
      recoveryId,
      expectedRuntimeRevision,
      signal,
    });
    return this.recoveryCommandHandler(
      "continue",
      bundleId,
      recoveryId,
      expectedRuntimeRevision,
      signal
    );
  }

  /** Records and delegates one exact no-journal abandonment. */
  async abandonRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    this.abandonRecoveryCalls.push({
      bundleId,
      recoveryId,
      expectedRuntimeRevision,
      signal,
    });
    return this.recoveryCommandHandler(
      "abandon",
      bundleId,
      recoveryId,
      expectedRuntimeRevision,
      signal
    );
  }
}

/** Scriptable scoped-Query port that records opaque boundary calls and cancellation. */
class FakeKnowledgeStudioQueryPort implements KnowledgeStudioQueryPort {
  readonly queryCalls: RecordedQueryCall[] = [];
  readonly citationCalls: RecordedCitationCall[] = [];
  readonly revokeCalls: Array<{ bundleId: string; queryId?: string }> = [];
  closed = false;

  /** Creates a fake around optional asynchronous handlers. */
  constructor(
    private readonly queryHandler: (
      call: RecordedQueryCall
    ) => Promise<KnowledgeStudioQueryResult> = async () => createQueryResult(),
    private readonly citationHandler: (call: RecordedCitationCall) => Promise<void> = async () =>
      undefined
  ) {}

  /** Records one scoped retrieval or grounded-answer Query request. */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
    const call = { bundleId, request, signal };
    this.queryCalls.push(call);
    return this.queryHandler(call);
  }

  /** Records one opaque citation jump. */
  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    const call = { bundleId, queryId, citationRef, signal };
    this.citationCalls.push(call);
    return this.citationHandler(call);
  }

  /** Records synchronous revocation of one Bundle's current Query capability. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    this.revokeCalls.push({ bundleId, ...(queryId === undefined ? {} : { queryId }) });
  }

  /** Records lifecycle closure without performing external work. */
  close(): void {
    this.closed = true;
  }
}

/** Scriptable reviewed-writeback port that records exact opaque query authority. */
class FakeKnowledgeStudioQueryWritebackPort implements KnowledgeStudioQueryWritebackPort {
  readonly calls: RecordedQueryWritebackCall[] = [];

  /** Creates a fake around one optional asynchronous registration handler. */
  constructor(
    private readonly handler: (
      call: RecordedQueryWritebackCall
    ) => Promise<KnowledgeStudioQueryWritebackResult> = async () => ({ kind: "registered" })
  ) {}

  /** Records one current-answer registration request. */
  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    const call = { bundleId, queryId, request, signal };
    this.calls.push(call);
    return this.handler(call);
  }
}

/** Scriptable source lifecycle port that records only opaque command material. */
class FakeKnowledgeSourceLifecyclePort implements KnowledgeSourceLifecyclePort {
  readonly loadCalls: Array<{ bundleId: string; signal: AbortSignal }> = [];
  readonly checkCalls: RecordedSourceCheckCall[] = [];
  readonly retirementCalls: RecordedSourceRetirementCall[] = [];

  /** Creates a fake around one model and optional command handlers. */
  constructor(
    private readonly model: Readonly<KnowledgeSourceLifecycleModel> = createSourceLifecycle(),
    private readonly checkHandler: (call: RecordedSourceCheckCall) => Promise<void> = async () =>
      undefined,
    private readonly retirementHandler: (
      call: RecordedSourceRetirementCall
    ) => Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> = async () => ({
      outcome: "retired",
      retainedWikiPageCount: 2,
    })
  ) {}

  /** Records lifecycle loads so tests can prove Controller does not cross-read revisions. */
  async loadSources(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceLifecycleModel>> {
    this.loadCalls.push({ bundleId, signal });
    return this.model;
  }

  /** Records and delegates one source recheck. */
  async checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void> {
    const call = { bundleId, sourceId, signal };
    this.checkCalls.push(call);
    return this.checkHandler(call);
  }

  /** Records and delegates one exact source retirement. */
  async retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> {
    const call = { bundleId, request, signal };
    this.retirementCalls.push(call);
    return this.retirementHandler(call);
  }
}

/** Builds the content-free command expected by the controller boundary. */
function createReviewCommand(token = "b".repeat(64)): KnowledgeReviewCommand {
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
    await expect(
      port.pauseBundle("personal", 0, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
  });

  it("keeps every command disabled when the runtime foundation reports a safe notice", async () => {
    const port = new UnavailableKnowledgeStudioPort(
      "Durable storage is initialized, but workflow coordination remains disabled."
    );
    const snapshot = await port.load("personal", new AbortController().signal);

    expect(snapshot).toMatchObject({
      availability: "adapter_unavailable",
      notice: "Durable storage is initialized, but workflow coordination remains disabled.",
      reviews: [],
    });
    await expect(
      port.submitReview("personal", createReviewCommand(), new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
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

  it("uses the lifecycle model from the read snapshot without a cross-revision second load", async () => {
    const rawSourceLifecycle = createSourceLifecycle();
    const port = new FakeKnowledgeStudioPort(async () =>
      createSourceSnapshot("source-revision", rawSourceLifecycle)
    );
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(rawSourceLifecycle);
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);

    controller.start("personal");
    await flushAsync();

    const projected = controller.getState().snapshot?.sourceLifecycle;
    expect(sourcePort.loadCalls).toHaveLength(0);
    expect(projected).not.toBe(rawSourceLifecycle);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected?.sources)).toBe(true);
    expect(projected).toMatchObject({
      bundleId: "personal",
      runtimeRevision: 9,
      manifestRevision: 4,
      sources: [{ sourceId: "source-missing", status: "missing" }],
    });

    controller.selectTab("sources");
    expect(controller.getState().activeTab).toBe("sources");
  });

  it("opens Sources on the first constrained startup snapshot", async () => {
    const sourceLifecycle = createSourceLifecycle();
    const port = new FakeKnowledgeStudioPort(async () => ({
      ...createSourceSnapshot("source-recovery", sourceLifecycle),
      preferredTab: "sources" as const,
    }));
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(sourceLifecycle);
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);

    controller.start("personal");
    await flushAsync();

    expect(controller.getState()).toMatchObject({
      status: "ready",
      activeTab: "sources",
      snapshot: { preferredTab: "sources" },
    });
  });

  it("serializes source rechecks and reloads the coherent Studio snapshot after completion", async () => {
    const check = createDeferred<void>();
    const snapshots = [createSourceSnapshot("source-before"), createSourceSnapshot("source-after")];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(
      createSourceLifecycle(),
      async () => check.promise
    );
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);
    controller.start("personal");
    await flushAsync();

    const action = controller.checkSourceAgain("source-missing");
    await flushAsync();
    await controller.retireSource(createRemovalConfirmation());

    expect(sourcePort.checkCalls).toHaveLength(1);
    expect(sourcePort.checkCalls[0]).toMatchObject({
      bundleId: "personal",
      sourceId: "source-missing",
    });
    expect(sourcePort.checkCalls[0].signal.aborted).toBe(false);
    expect(sourcePort.retirementCalls).toHaveLength(0);
    expect(controller.getState()).toMatchObject({
      pendingAction: { kind: "check_source", targetId: "source-missing" },
      snapshot: { revisionToken: "source-before" },
    });

    check.resolve();
    await action;

    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState()).toMatchObject({
      pendingAction: undefined,
      snapshot: { revisionToken: "source-after" },
      feedback: { kind: "success" },
    });
  });

  it("forwards only exact frozen retirement authority from the current source row", async () => {
    const snapshots = [createSourceSnapshot("source-before"), createSourceSnapshot("source-after")];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(
      createSourceLifecycle(),
      undefined,
      async () => ({ outcome: "retired", retainedWikiPageCount: 2 })
    );
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);
    controller.start("personal");
    await flushAsync();

    const confirmation = createRemovalConfirmation();
    await controller.retireSource(confirmation);
    expect(sourcePort.retirementCalls).toHaveLength(1);
    expect(sourcePort.retirementCalls[0]).toMatchObject({
      bundleId: "personal",
      request: {
        sourceId: "source-missing",
        retirementRef: "retirement-missing",
        reason: "source_missing",
      },
    });
    expect(Object.keys(sourcePort.retirementCalls[0].request).sort()).toEqual([
      "reason",
      "retirementRef",
      "sourceId",
    ]);
    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState().feedback?.message).toContain(
      "2 generated Wiki pages were retained"
    );
  });

  it("never forwards stale or disabled lifecycle actions", async () => {
    const sourceLifecycle = createSourceLifecycle([
      {
        sourceId: "source-missing",
        sourcePath: "Sources/Missing.md",
        custody: "user_managed",
        generatedPageCount: 2,
        status: "missing",
        issueReason: "source_missing",
        retirementRef: "current-retirement-ref",
        retirementBlockers: ["bundle_review_pending"],
        actions: { canCheckAgain: false, canRemove: false },
      },
    ]);
    const snapshot = createSourceSnapshot("source-blocked", sourceLifecycle);
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(sourceLifecycle);
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);
    controller.start("personal");
    await flushAsync();

    await controller.checkSourceAgain("source-missing");
    await controller.retireSource(
      createRemovalConfirmation({ retirementRef: "stale-retirement-ref" })
    );

    expect(sourcePort.checkCalls).toHaveLength(0);
    expect(sourcePort.retirementCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });
  });

  it("rejects every stale or mutable removal token before the lifecycle port", async () => {
    const snapshot = createSourceSnapshot("source-current");
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const sourcePort = new FakeKnowledgeSourceLifecyclePort();
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);
    controller.start("personal");
    await flushAsync();

    const invalidConfirmations: Readonly<KnowledgeSourceRemovalConfirmation>[] = [
      createRemovalConfirmation({ sourceId: "source-other" }),
      createRemovalConfirmation({ sourcePath: "Sources/Other.md" }),
      createRemovalConfirmation({ retirementRef: "retirement-stale" }),
      createRemovalConfirmation({ runtimeRevision: 10 }),
      createRemovalConfirmation({ manifestRevision: 5 }),
      { ...createRemovalConfirmation() },
    ];
    for (const confirmation of invalidConfirmations) {
      await controller.retireSource(confirmation);
    }

    expect(sourcePort.retirementCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });
  });

  it("bridges panel cancellation into a source command and clears pending state", async () => {
    const snapshots = [createSourceSnapshot("source-before"), createSourceSnapshot("source-after")];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const sourcePort = new FakeKnowledgeSourceLifecyclePort(
      createSourceLifecycle(),
      async (call) =>
        new Promise<void>((_resolve, reject) => {
          call.signal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const controller = new KnowledgeStudioController(port, port, undefined, undefined, sourcePort);
    controller.start("personal");
    await flushAsync();
    const caller = new AbortController();

    const action = controller.checkSourceAgain("source-missing", caller.signal);
    await flushAsync();
    caller.abort();
    await action;

    expect(sourcePort.checkCalls[0].signal.aborted).toBe(true);
    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState()).toMatchObject({
      pendingAction: undefined,
      snapshot: { revisionToken: "source-after" },
    });
    expect(controller.getState().feedback).toBeUndefined();
  });

  it("runs scoped Query only when the durable snapshot enables it and opens opaque citations", async () => {
    const snapshot = { ...createSnapshot(), queryAvailable: true };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort();
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();

    await controller.runQuery("grounded topic");

    expect(queryPort.queryCalls).toHaveLength(1);
    expect(queryPort.queryCalls[0]).toMatchObject({
      bundleId: "personal",
      request: { query: "grounded topic" },
    });
    expect(controller.getState()).toMatchObject({
      activeTab: "query",
      query: {
        status: "ready",
        result: { queryId: "knowledge-query-1", hits: [{ pagePath: "Wiki/Page.md" }] },
      },
    });

    await controller.openQueryCitation("knowledge-citation-1");

    expect(queryPort.citationCalls).toHaveLength(1);
    expect(queryPort.citationCalls[0]).toMatchObject({
      bundleId: "personal",
      queryId: "knowledge-query-1",
      citationRef: "knowledge-citation-1",
    });
    expect(controller.getState().query).toMatchObject({
      status: "ready",
      openingCitationRef: undefined,
      error: undefined,
    });
  });

  it("publishes a grounded answer without changing its opaque citation authority", async () => {
    const snapshot = { ...createSnapshot(), queryAvailable: true };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => createAnswerQueryResult());
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();

    await controller.runQuery("grounded answer");

    expect(controller.getState()).toMatchObject({
      activeTab: "query",
      query: {
        status: "ready",
        result: {
          mode: "grounded_answer",
          answer: {
            status: "answered",
            claims: [
              {
                kind: "source_fact",
                citations: [{ citationRef: "knowledge-citation-1" }],
              },
            ],
          },
        },
      },
    });
  });

  it("registers a current grounded answer only through the published reviewed-writeback capability", async () => {
    const snapshot = {
      ...createSnapshot(),
      queryAvailable: true,
      queryWritebackAvailable: true,
    };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => createAnswerQueryResult());
    const writebackPort = new FakeKnowledgeStudioQueryWritebackPort();
    const controller = new KnowledgeStudioController(port, port, queryPort, writebackPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded answer");

    await controller.saveCurrentQueryToWiki("  Durable answer  ");

    expect(writebackPort.calls).toHaveLength(1);
    expect(writebackPort.calls[0]).toMatchObject({
      bundleId: "personal",
      queryId: "knowledge-query-answer-1",
      request: { title: "Durable answer" },
    });
    expect(writebackPort.calls[0].signal.aborted).toBe(false);
    const state = controller.getState();
    expect(state).toMatchObject({
      query: {
        status: "ready",
        savingToWiki: false,
        error: undefined,
        result: { queryId: "knowledge-query-answer-1" },
      },
      feedback: {
        kind: "success",
      },
    });
    expect(state.feedback?.message).toContain("Review proposal");
  });

  it("keeps answer writeback unavailable unless the current snapshot publishes it", async () => {
    const snapshot = {
      ...createSnapshot(),
      queryAvailable: true,
      queryWritebackAvailable: false,
    };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => createAnswerQueryResult());
    const writebackPort = new FakeKnowledgeStudioQueryWritebackPort();
    const controller = new KnowledgeStudioController(port, port, queryPort, writebackPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded answer");

    await controller.saveCurrentQueryToWiki("Blocked answer");

    expect(writebackPort.calls).toHaveLength(0);
    expect(controller.getState().query).toMatchObject({
      status: "ready",
      savingToWiki: false,
      error: "Only a current source-grounded answer can be sent to reviewed Wiki writeback.",
    });
  });

  it("rejects a writeback snapshot capability that is not backed by scoped Query", async () => {
    const invalid = {
      ...createSnapshot(),
      queryAvailable: false,
      queryWritebackAvailable: true,
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

  it("aborts an in-flight answer writeback and ignores its late old-generation receipt", async () => {
    const registration = createDeferred<KnowledgeStudioQueryWritebackResult>();
    const snapshots = [
      {
        ...createSnapshot("before"),
        queryAvailable: true,
        queryWritebackAvailable: true,
      },
      {
        ...createSnapshot("after"),
        queryAvailable: true,
        queryWritebackAvailable: true,
      },
    ];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => createAnswerQueryResult());
    const writebackPort = new FakeKnowledgeStudioQueryWritebackPort(
      async () => registration.promise
    );
    const controller = new KnowledgeStudioController(port, port, queryPort, writebackPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded answer");

    const pending = controller.saveCurrentQueryToWiki("Durable answer");
    await flushAsync();
    await controller.refresh();

    expect(writebackPort.calls[0].signal.aborted).toBe(true);
    expect(queryPort.revokeCalls).toEqual([
      { bundleId: "personal", queryId: "knowledge-query-answer-1" },
    ]);
    expect(controller.getState()).toMatchObject({
      snapshot: { revisionToken: "after" },
      query: { status: "idle" },
    });

    registration.resolve({ kind: "registered" });
    await pending;
    expect(controller.getState()).toMatchObject({
      snapshot: { revisionToken: "after" },
      query: { status: "idle" },
    });
    expect(controller.getState().feedback).toBeUndefined();
  });

  it("rejects an accessor-backed writeback receipt without invoking its getter", async () => {
    let getterCalls = 0;
    const receipt = {};
    Object.defineProperty(receipt, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("private getter payload");
      },
    });
    const snapshot = {
      ...createSnapshot(),
      queryAvailable: true,
      queryWritebackAvailable: true,
    };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => createAnswerQueryResult());
    const writebackPort = new FakeKnowledgeStudioQueryWritebackPort(async () =>
      Promise.resolve(receipt as unknown as KnowledgeStudioQueryWritebackResult)
    );
    const controller = new KnowledgeStudioController(port, port, queryPort, writebackPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded answer");

    await controller.saveCurrentQueryToWiki("Durable answer");

    expect(getterCalls).toBe(0);
    expect(controller.getState().query).toMatchObject({
      status: "ready",
      savingToWiki: false,
      error:
        "The grounded answer could not be registered. No Wiki file was changed; retry from a fresh query.",
    });
    expect(controller.getState().feedback).toBeUndefined();
  });

  it("keeps Query fail-closed when the current snapshot did not publish the adapter", async () => {
    const port = new FakeKnowledgeStudioPort(async () => createSnapshot());
    const queryPort = new FakeKnowledgeStudioQueryPort();
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();

    await controller.runQuery("must not escape to the Vault");
    await controller.openQueryCitation("unissued-reference");

    expect(queryPort.queryCalls).toHaveLength(0);
    expect(queryPort.citationCalls).toHaveLength(0);
    expect(controller.getState().query).toMatchObject({ status: "error" });
  });

  it("aborts and revokes ephemeral Query state on a durable reload hint", async () => {
    const query = createDeferred<KnowledgeGroundedRetrievalResult>();
    const snapshots = [
      { ...createSnapshot("before"), queryAvailable: true },
      { ...createSnapshot("after"), queryAvailable: true },
    ];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => query.promise);
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();

    const pending = controller.runQuery("changing topic");
    await flushAsync();
    const querySignal = queryPort.queryCalls[0].signal;
    port.hint?.();

    expect(querySignal.aborted).toBe(true);
    expect(queryPort.revokeCalls).toEqual([{ bundleId: "personal" }]);
    expect(controller.getState().query).toEqual({ status: "idle" });
    query.resolve(createQueryResult("late-query"));
    await pending;
    await flushAsync();

    expect(controller.getState()).toMatchObject({
      snapshot: { revisionToken: "after" },
      query: { status: "idle" },
    });
  });

  it("revokes a ready Query and its UI citation authority on explicit refresh", async () => {
    const snapshots = [
      { ...createSnapshot("before"), queryAvailable: true },
      { ...createSnapshot("after"), queryAvailable: true },
    ];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift()!);
    const queryPort = new FakeKnowledgeStudioQueryPort();
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded topic");
    expect(controller.getState().query?.status).toBe("ready");

    await controller.refresh();
    await controller.openQueryCitation("knowledge-citation-1");

    expect(queryPort.revokeCalls).toEqual([{ bundleId: "personal", queryId: "knowledge-query-1" }]);
    expect(controller.getState()).toMatchObject({
      snapshot: { revisionToken: "after" },
      query: { status: "error" },
    });
    expect(queryPort.citationCalls).toHaveLength(0);
  });

  it("revokes a ready Query capability when the Bundle session stops", async () => {
    const snapshot = { ...createSnapshot(), queryAvailable: true };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort();
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("grounded topic");

    controller.stop();

    expect(queryPort.revokeCalls).toEqual([{ bundleId: "personal", queryId: "knowledge-query-1" }]);
    expect(controller.getState()).toEqual({
      status: "idle",
      activeTab: "activity",
      refreshing: false,
    });
  });

  it("aborts an in-flight Query before an explicit authoritative refresh", async () => {
    const pendingQuery = createDeferred<KnowledgeGroundedRetrievalResult>();
    const snapshot = { ...createSnapshot(), queryAvailable: true };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(async () => pendingQuery.promise);
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();
    const pending = controller.runQuery("pending topic");
    await flushAsync();

    await controller.refresh();

    expect(queryPort.queryCalls[0].signal.aborted).toBe(true);
    expect(queryPort.revokeCalls).toEqual([]);
    expect(controller.getState().query).toEqual({ status: "idle" });
    pendingQuery.resolve(createQueryResult("late-query"));
    await pending;
    expect(controller.getState().query).toEqual({ status: "idle" });
  });

  it("refuses tabs that the current snapshot cannot render", async () => {
    const port = new FakeKnowledgeStudioPort(async () => createSnapshot());
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    controller.selectTab("query");
    controller.selectTab("recovery");

    expect(controller.getState().activeTab).toBe("activity");
    controller.selectTab("review");
    expect(controller.getState().activeTab).toBe("review");
  });

  it("sanitizes Query and citation-navigation failures without retaining adapter causes", async () => {
    const snapshot = { ...createSnapshot(), queryAvailable: true };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const queryPort = new FakeKnowledgeStudioQueryPort(
      async () => Promise.reject(new Error("private query and path")),
      async () => Promise.reject(new Error("private navigation failure"))
    );
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();

    await controller.runQuery("private question");
    expect(JSON.stringify(controller.getState().query)).not.toContain("private query and path");

    const successfulQueryPort = new FakeKnowledgeStudioQueryPort(
      async () => createQueryResult(),
      async () => Promise.reject(new Error("private navigation failure"))
    );
    const secondController = new KnowledgeStudioController(port, port, successfulQueryPort);
    secondController.start("personal");
    await flushAsync();
    await secondController.runQuery("grounded topic");
    await secondController.openQueryCitation("knowledge-citation-1");

    expect(JSON.stringify(secondController.getState().query)).not.toContain(
      "private navigation failure"
    );
    expect(secondController.getState().query).toMatchObject({ status: "error" });
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
    expect(port.pauseCalls[0]).toMatchObject({ expectedQueueRevision: 7 });

    pause.resolve();
    await action;
    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState()).toMatchObject({
      status: "ready",
      snapshot: { revisionToken: "after" },
      feedback: { kind: "success" },
    });
  });

  it("blocks new Query work and Bundle-wide revokes stale authority during a pending action", async () => {
    const pause = createDeferred<void>();
    const snapshots = [
      { ...createSnapshot("before"), queryAvailable: true },
      { ...createSnapshot("after"), queryAvailable: true },
    ];
    const port = new FakeKnowledgeStudioPort(
      async () => snapshots.shift()!,
      async (_bundleId, targetId) => {
        if (targetId === "pause") return pause.promise;
      }
    );
    const queryPort = new FakeKnowledgeStudioQueryPort();
    const controller = new KnowledgeStudioController(port, port, queryPort);
    controller.start("personal");
    await flushAsync();
    await controller.runQuery("ready topic");

    const action = controller.pauseBundle();
    await controller.runQuery("must remain blocked");
    port.hint?.();

    expect(queryPort.queryCalls).toHaveLength(1);
    expect(queryPort.revokeCalls).toEqual([
      { bundleId: "personal", queryId: "knowledge-query-1" },
      { bundleId: "personal" },
    ]);
    expect(controller.getState()).toMatchObject({
      pendingAction: { kind: "pause" },
      query: { status: "idle" },
      snapshot: { revisionToken: "before" },
    });

    pause.resolve();
    await action;
    expect(port.loadCalls).toHaveLength(2);
    expect(controller.getState()).toMatchObject({
      pendingAction: undefined,
      snapshot: { revisionToken: "after" },
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

  it("retains Review decisions and active text across tabs and same-token blocked refreshes", async () => {
    const plan = createReviewPlan();
    const snapshot = createSnapshot("same-token", [plan]);
    const port = new FakeKnowledgeStudioPort(
      async () => snapshot,
      undefined,
      async () => ({ kind: "blocked", diagnostics: [] })
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();
    controller.openReview(plan.changeSetId);
    expect(controller.updateReviewDraft(plan, { "change-1": { kind: "accept_exact" } })).toBe(true);
    expect(
      controller.updateReviewActiveEdit(plan, {
        changeId: "change-1",
        afterContent: "typing across tabs",
      })
    ).toBe(true);

    controller.selectTab("activity");
    controller.selectTab("review");
    expect(controller.getReviewDraft(plan)).toEqual({
      "change-1": { kind: "accept_exact" },
    });
    expect(controller.getReviewActiveEdit(plan)).toEqual({
      changeId: "change-1",
      afterContent: "typing across tabs",
    });

    await controller.submitReview(createReviewCommand());
    expect(port.reviewCalls).toHaveLength(0);
    expect(controller.getState().feedback).toEqual({
      kind: "blocked",
      message: "Finish or cancel the active manual edit before submitting this review.",
    });
    expect(controller.getReviewDraft(plan)).toEqual({
      "change-1": { kind: "accept_exact" },
    });
    expect(controller.getReviewActiveEdit(plan)?.afterContent).toBe("typing across tabs");
  });

  it("keeps a separate draft-revocation notice across same-token refreshes", async () => {
    const before = createReviewPlan("snapshot-1");
    const after = createReviewPlan("snapshot-2");
    const snapshots = [
      createSnapshot("before", [before]),
      createSnapshot("after", [after]),
      createSnapshot("same-after", [after]),
    ];
    const port = new FakeKnowledgeStudioPort(async () => snapshots.shift() ?? createSnapshot());
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();
    controller.updateReviewDraft(before, {
      "change-1": { kind: "accept_edited", afterContent: "saved" },
    });
    controller.updateReviewActiveEdit(before, {
      changeId: "change-1",
      afterContent: "typing",
    });
    await controller.submitReview({
      ...createReviewCommand(),
      extra: true,
    } as KnowledgeReviewCommand);
    expect(controller.getState().feedback?.message).toBe(
      "This review command is invalid and was not submitted."
    );

    await controller.refresh();

    expect(controller.getReviewDraft(before)).toEqual({});
    expect(controller.getReviewActiveEdit(before)).toBeUndefined();
    expect(controller.getState()).toMatchObject({
      feedback: {
        kind: "blocked",
        message: "This review command is invalid and was not submitted.",
      },
      reviewDraftNotice: "This proposal changed. Its session-only Review draft was cleared.",
    });

    await controller.refresh();
    expect(controller.getState().reviewDraftNotice).toContain("Review draft was cleared");
    controller.selectTab("review");
    expect(controller.getState().reviewDraftNotice).toBeUndefined();
  });

  it("clears the exact draft without a false revocation notice after durable recovery handoff", async () => {
    const plan = createReviewPlan();
    const snapshot = createSnapshot("recovery-handoff", [plan]);
    const port = new FakeKnowledgeStudioPort(
      async () => snapshot,
      undefined,
      async () => ({ kind: "recovery_required" })
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();
    expect(
      controller.updateReviewDraft(plan, {
        "change-1": { kind: "accept_edited", afterContent: "# Durable revision\n" },
      })
    ).toBe(true);

    await controller.submitReview(createReviewCommand());

    expect(controller.getReviewDraft(plan)).toEqual({});
    expect(controller.getState()).toMatchObject({
      feedback: {
        kind: "blocked",
        message: "The review is durable, but apply needs recovery before more work can continue.",
      },
      reviewDraftNotice: undefined,
    });
  });

  it("strictly rejects malformed Review commands before any command-port call", async () => {
    const port = new FakeKnowledgeStudioPort(async () => createSnapshot());
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();
    const command = createReviewCommand();
    const malformed = { ...command, extra: "not allowed" } as KnowledgeReviewCommand;

    await controller.submitReview(malformed);

    expect(port.reviewCalls).toHaveLength(0);
    expect(controller.getState().feedback).toEqual({
      kind: "blocked",
      message: "This review command is invalid and was not submitted.",
    });
  });

  it("does not inspect properties on an impostor Review plan at the draft boundary", async () => {
    const plan = createReviewPlan();
    const port = new FakeKnowledgeStudioPort(async () => createSnapshot("current", [plan]));
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();
    let getterCalls = 0;
    const impostor = Object.create(null) as KnowledgeReviewPlan;
    Object.defineProperty(impostor, "changeSetId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return plan.changeSetId;
      },
    });

    expect(controller.getReviewDraft(impostor)).toEqual({});
    expect(controller.getReviewActiveEdit(impostor)).toBeUndefined();
    expect(controller.updateReviewDraft(impostor, { "change-1": { kind: "reject" } })).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("allows literal rejection while keeping acceptance behind its separate capability", async () => {
    const review = createReviewPlan();
    const rejectCommand: KnowledgeReviewCommand = {
      changeSetId: review.changeSetId,
      proposalDigest: review.proposalDigest,
      expectedSnapshotToken: review.snapshotToken,
      decisions: [{ changeId: "change-1", decision: "reject" }],
    };
    const rejectOnly = {
      ...createSnapshot("reject-only", [review]),
      commandCapabilities: {
        pauseBundle: true,
        resumeBundle: true,
        cancelJob: true,
        retryJob: true,
        reviewReject: true,
        reviewAccept: false,
      },
    };
    const port = new FakeKnowledgeStudioPort(
      async () => rejectOnly,
      undefined,
      async () => ({
        kind: "rejected",
      })
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.submitReview(createReviewCommand());
    expect(port.reviewCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });

    await controller.submitReview(rejectCommand);
    expect(port.reviewCalls).toHaveLength(1);
    expect(controller.getState().feedback).toMatchObject({ kind: "success" });
  });

  it("opens Recovery automatically when the first durable snapshot needs attention", async () => {
    const port = new FakeKnowledgeStudioPort(async () => createRecoverySnapshot());
    const controller = new KnowledgeStudioController(port, port);

    controller.start("personal");
    await flushAsync();

    expect(controller.getState()).toMatchObject({
      status: "ready",
      activeTab: "recovery",
      snapshot: { recovery: { runtimeRevision: 41 } },
    });
  });

  it("delegates exact recovery ids with the runtime revision of each rendered snapshot", async () => {
    const snapshots = [
      createRecoverySnapshot("before", 41),
      createRecoverySnapshot("between", 42),
      createRecoverySnapshot("after", 43, []),
    ];
    const port = new FakeKnowledgeStudioPort(
      async () => snapshots.shift()!,
      undefined,
      undefined,
      async (action) => (action === "continue" ? { kind: "stale" } : { kind: "blocked" })
    );
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.continueRecovery("recovery-continue");
    await controller.abandonRecovery("recovery-decision");

    expect(port.continueRecoveryCalls).toHaveLength(1);
    expect(port.continueRecoveryCalls[0]).toMatchObject({
      bundleId: "personal",
      recoveryId: "recovery-continue",
      expectedRuntimeRevision: 41,
    });
    expect(port.continueRecoveryCalls[0]?.signal.aborted).toBe(false);
    expect(port.abandonRecoveryCalls).toHaveLength(1);
    expect(port.abandonRecoveryCalls[0]).toMatchObject({
      bundleId: "personal",
      recoveryId: "recovery-decision",
      expectedRuntimeRevision: 42,
    });
    expect(port.abandonRecoveryCalls[0]?.signal.aborted).toBe(false);
    expect(port.loadCalls).toHaveLength(3);
    expect(controller.getState()).toMatchObject({
      activeTab: "activity",
      snapshot: { revisionToken: "after" },
      feedback: {
        kind: "blocked",
        message: "The recovery action is not safe from the current durable state.",
      },
    });
  });

  it("never forwards recovery commands for disabled, stale, or read-only rows", async () => {
    const restricted = createRecoverySnapshot("restricted", 51, [
      ...createRecoveryItems(),
      {
        id: "recovery-read-only",
        status: "transaction_active",
        transactionId: "transaction-active",
        phase: "applying",
        actions: { canContinue: false, canAbandon: false },
      },
    ]);
    const snapshot: KnowledgeStudioSnapshot = {
      ...restricted,
      commandCapabilities: {
        ...restricted.commandCapabilities,
        recoveryContinue: false,
        recoveryAbandon: true,
      },
    };
    const port = new FakeKnowledgeStudioPort(async () => snapshot);
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.continueRecovery("recovery-continue");
    await controller.abandonRecovery("recovery-stale");
    await controller.abandonRecovery("recovery-read-only");

    expect(port.continueRecoveryCalls).toHaveLength(0);
    expect(port.abandonRecoveryCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });
  });

  it.each<{
    result: KnowledgeStudioRecoverySubmissionResult;
    feedbackKind: "success" | "blocked";
    message: string;
    shouldReload: boolean;
  }>([
    {
      result: { kind: "completed" },
      feedbackKind: "success",
      message: "Recovery completed. Knowledge startup is being checked again.",
      shouldReload: false,
    },
    {
      result: { kind: "stale" },
      feedbackKind: "blocked",
      message: "Recovery state changed before the action. Review the refreshed snapshot.",
      shouldReload: true,
    },
    {
      result: { kind: "recovery_required" },
      feedbackKind: "blocked",
      message:
        "The apply could not be fully finalized and still needs recovery. Startup remains paused; no rollback was assumed.",
      shouldReload: false,
    },
    {
      result: { kind: "blocked" },
      feedbackKind: "blocked",
      message: "The recovery action is not safe from the current durable state.",
      shouldReload: true,
    },
  ])(
    "maps $result.kind recovery feedback with its durable reload policy",
    async ({ result, feedbackKind, message, shouldReload }) => {
      const after = createRecoverySnapshot("after-result", 62, []);
      const snapshots = [createRecoverySnapshot("before-result", 61), after];
      const port = new FakeKnowledgeStudioPort(
        async () => snapshots.shift() ?? after,
        undefined,
        undefined,
        async () => result
      );
      const controller = new KnowledgeStudioController(port, port);
      controller.start("personal");
      await flushAsync();

      await controller.continueRecovery("recovery-continue");

      expect(port.continueRecoveryCalls).toHaveLength(1);
      expect(port.loadCalls).toHaveLength(shouldReload ? 2 : 1);
      expect(controller.getState()).toMatchObject({
        snapshot: {
          revisionToken: shouldReload ? "after-result" : "before-result",
        },
        feedback: { kind: feedbackKind, message },
      });
    }
  );

  it("never forwards a disabled Activity command even when called outside React", async () => {
    const disabled = {
      ...createSnapshot("disabled"),
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
      },
    };
    const port = new FakeKnowledgeStudioPort(async () => disabled);
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    await flushAsync();

    await controller.pauseBundle();

    expect(port.pauseCalls).toHaveLength(0);
    expect(controller.getState().feedback).toMatchObject({ kind: "blocked" });
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

  it("shows an unavailable explanation without inventing a Bundle and aborts prior work", () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const port = new FakeKnowledgeStudioPort(async () => load.promise);
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    const signal = port.loadCalls[0].signal;

    controller.showUnavailable("No project has a valid Knowledge Bundle configuration.");

    expect(signal.aborted).toBe(true);
    expect(port.unsubscribed).toBe(true);
    expect(controller.getState()).toEqual({
      status: "unavailable",
      activeTab: "activity",
      refreshing: false,
      unavailableNotice: "No project has a valid Knowledge Bundle configuration.",
    });
    expect(() => controller.showUnavailable(" ")).toThrow(TypeError);
  });

  it("shows an action-free transient refresh state and revokes the prior generation", () => {
    const load = createDeferred<KnowledgeStudioSnapshot>();
    const port = new FakeKnowledgeStudioPort(async () => load.promise);
    const controller = new KnowledgeStudioController(port, port);
    controller.start("personal");
    const signal = port.loadCalls[0].signal;

    controller.showRefreshing();

    expect(signal.aborted).toBe(true);
    expect(port.unsubscribed).toBe(true);
    expect(controller.getState()).toEqual({
      status: "refreshing",
      activeTab: "activity",
      refreshing: true,
    });
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
