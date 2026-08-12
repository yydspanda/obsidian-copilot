import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeReviewEvidenceOpenRequest,
  KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import {
  createUnavailableKnowledgeStudioSnapshot,
  KnowledgeStudioController,
  type KnowledgeStudioCommandPort,
  type KnowledgeStudioReadPort,
  type KnowledgeStudioReviewSubmissionResult,
  type KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";

const FIRST_REF = "c".repeat(64);
const SECOND_REF = "d".repeat(64);

/** Promise whose settlement is controlled explicitly by one test. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one manually controlled promise. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Flushes controller continuations scheduled by fire-and-forget refresh calls. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Creates one Review plan with two opaque evidence references. */
function createReviewPlan(): KnowledgeReviewPlan {
  return {
    changeSetId: "changeset-1",
    bundleId: "personal",
    proposalDigest: "a".repeat(64),
    snapshotToken: "b".repeat(64),
    operation: "ingest",
    sourceRefs: ["source-1"],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 1,
    evidence: [
      {
        evidenceRef: FIRST_REF,
        relation: "supports",
        excerpt: "First fact",
        truncated: false,
        location: { kind: "quote" },
      },
      {
        evidenceRef: SECOND_REF,
        relation: "context",
        excerpt: "Second fact",
        truncated: false,
        location: { kind: "quote" },
      },
    ],
    omittedEvidenceCount: 0,
    files: [
      {
        changeId: "change-1",
        path: "Wiki/Page.md",
        operation: "create",
        reason: "Create page",
        sourceRefs: ["source-1"],
        integrity: "current",
        capability: "exact_only",
        beforeContent: "",
        afterContent: "# Page\n",
        blocks: [],
      },
    ],
  };
}

/** Creates a ready evidence-capable Studio snapshot. */
function createSnapshot(): KnowledgeStudioSnapshot {
  const base = createUnavailableKnowledgeStudioSnapshot("personal");
  return {
    ...base,
    revisionToken: "revision-1",
    availability: "ready",
    commandCapabilities: {
      pauseBundle: false,
      resumeBundle: false,
      cancelJob: false,
      retryJob: false,
      reviewReject: true,
      reviewAccept: true,
    },
    reviews: [createReviewPlan()],
    reviewEvidenceAvailable: true,
    notice: undefined,
  };
}

/** Minimal durable port used to start and submit from the controller. */
class FixedStudioPort implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort {
  reviewCalls: Array<{ command: KnowledgeReviewCommand; signal: AbortSignal }> = [];

  /** Returns the same exact ready snapshot for every reconciliation read. */
  async load(): Promise<KnowledgeStudioSnapshot> {
    return createSnapshot();
  }

  /** Provides an inert durable hint subscription. */
  subscribe(): () => void {
    return () => undefined;
  }

  /** Keeps Bundle pause unavailable in this focused fixture. */
  async pauseBundle(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps Bundle resume unavailable in this focused fixture. */
  async resumeBundle(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps job cancellation unavailable in this focused fixture. */
  async cancelJob(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps job retry unavailable in this focused fixture. */
  async retryJob(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Records one current content-free Review command. */
  async submitReview(
    _bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    this.reviewCalls.push({ command, signal });
    return { kind: "rejected" };
  }
}

/** One recorded evidence boundary invocation. */
interface EvidenceCall {
  bundleId: string;
  request: Readonly<KnowledgeReviewEvidenceOpenRequest>;
  signal: AbortSignal;
}

/** Scriptable evidence port retaining exact opaque requests and signals. */
class RecordingEvidencePort implements KnowledgeStudioReviewEvidencePort {
  calls: EvidenceCall[] = [];

  /** Captures an optional asynchronous handler for every click. */
  constructor(
    private readonly handler: (
      call: EvidenceCall
    ) => Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> = async () => ({ kind: "opened" })
  ) {}

  /** Records and delegates one opaque evidence request. */
  async openReviewEvidence(
    bundleId: string,
    request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> {
    const call = { bundleId, request, signal };
    this.calls.push(call);
    return this.handler(call);
  }
}

/** Starts a ready controller with the supplied evidence boundary. */
async function startController(evidence: KnowledgeStudioReviewEvidencePort): Promise<{
  controller: KnowledgeStudioController;
  studio: FixedStudioPort;
}> {
  const studio = new FixedStudioPort();
  const controller = new KnowledgeStudioController(
    studio,
    studio,
    undefined,
    undefined,
    undefined,
    evidence
  );
  controller.start("personal");
  await flushAsync();
  return { controller, studio };
}

describe("KnowledgeStudioController Review evidence", () => {
  it("submits only the known opaque ref plus current plan identities and clears on opened", async () => {
    const evidence = new RecordingEvidencePort();
    const { controller } = await startController(evidence);

    await controller.openReviewEvidence(FIRST_REF);

    expect(evidence.calls).toHaveLength(1);
    expect(evidence.calls[0]).toMatchObject({
      bundleId: "personal",
      request: {
        changeSetId: "changeset-1",
        proposalDigest: "a".repeat(64),
        expectedSnapshotToken: "b".repeat(64),
        evidenceRef: FIRST_REF,
      },
    });
    expect(Object.keys(evidence.calls[0].request).sort()).toEqual([
      "changeSetId",
      "evidenceRef",
      "expectedSnapshotToken",
      "proposalDigest",
    ]);
    expect(controller.getState()).toMatchObject({
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: undefined,
    });
  });

  it("rejects an unknown ref locally without calling the evidence port", async () => {
    const evidence = new RecordingEvidencePort();
    const { controller } = await startController(evidence);

    await controller.openReviewEvidence("f".repeat(64));

    expect(evidence.calls).toHaveLength(0);
    expect(controller.getState().reviewEvidenceError).toBe(
      "That review evidence is no longer available."
    );
  });

  it.each([
    ["opened", undefined],
    ["stale", "This evidence or review changed. Refresh and try the current proposal."],
    ["unsupported", "This evidence location cannot be opened in Obsidian."],
    ["unavailable", "That review evidence could not be opened."],
  ] as const)("maps the exact %s result without retaining boundary data", async (kind, message) => {
    const evidence = new RecordingEvidencePort(async () => ({ kind }));
    const { controller } = await startController(evidence);

    await controller.openReviewEvidence(FIRST_REF);

    expect(controller.getState()).toMatchObject({
      openingReviewEvidenceRef: undefined,
      reviewEvidenceError: message,
    });
  });

  it.each([
    { kind: "bogus" },
    { kind: "opened", extra: "private" },
    Object.assign(Object.create({}), { kind: "opened" }),
    Object.defineProperty({}, "kind", { value: "opened" }),
  ])("fails closed for a malformed evidence result %#", async (malformed) => {
    const evidence = new RecordingEvidencePort(
      async () => malformed as Readonly<KnowledgeReviewEvidenceOpenResult>
    );
    const { controller } = await startController(evidence);

    await controller.openReviewEvidence(FIRST_REF);

    expect(controller.getState().reviewEvidenceError).toBe(
      "That review evidence could not be opened."
    );
  });

  it("rejects an accessor-backed evidence result without invoking its getter", async () => {
    let reads = 0;
    const malformed = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "opened";
      },
    });
    const evidence = new RecordingEvidencePort(
      async () => malformed as unknown as Readonly<KnowledgeReviewEvidenceOpenResult>
    );
    const { controller } = await startController(evidence);

    await controller.openReviewEvidence(FIRST_REF);

    expect(reads).toBe(0);
    expect(controller.getState().reviewEvidenceError).toBe(
      "That review evidence could not be opened."
    );
  });

  it("aborts the first click and lets only the second result publish", async () => {
    const first = createDeferred<Readonly<KnowledgeReviewEvidenceOpenResult>>();
    const second = createDeferred<Readonly<KnowledgeReviewEvidenceOpenResult>>();
    const evidence = new RecordingEvidencePort((call) =>
      call.request.evidenceRef === FIRST_REF ? first.promise : second.promise
    );
    const { controller } = await startController(evidence);

    const firstOpen = controller.openReviewEvidence(FIRST_REF);
    await flushAsync();
    const secondOpen = controller.openReviewEvidence(SECOND_REF);
    await flushAsync();

    expect(evidence.calls[0].signal.aborted).toBe(true);
    expect(evidence.calls[1].signal.aborted).toBe(false);
    second.resolve({ kind: "unsupported" });
    await secondOpen;
    expect(controller.getState().reviewEvidenceError).toBe(
      "This evidence location cannot be opened in Obsidian."
    );
    first.resolve({ kind: "opened" });
    await firstOpen;
    expect(controller.getState().reviewEvidenceError).toBe(
      "This evidence location cannot be opened in Obsidian."
    );
  });

  it.each(["tab", "refresh", "submit", "destroy"] as const)(
    "aborts an in-flight evidence jump on %s",
    async (action) => {
      const pending = createDeferred<Readonly<KnowledgeReviewEvidenceOpenResult>>();
      const evidence = new RecordingEvidencePort(async () => pending.promise);
      const { controller } = await startController(evidence);
      controller.openReview("changeset-1");
      void controller.openReviewEvidence(FIRST_REF);
      await flushAsync();

      if (action === "tab") controller.selectTab("activity");
      if (action === "refresh") void controller.refresh();
      if (action === "submit") {
        void controller.submitReview({
          changeSetId: "changeset-1",
          proposalDigest: "a".repeat(64),
          expectedSnapshotToken: "b".repeat(64),
          decisions: [{ changeId: "change-1", decision: "reject" }],
        });
      }
      if (action === "destroy") controller.destroy();

      expect(evidence.calls[0].signal.aborted).toBe(true);
    }
  );
});
