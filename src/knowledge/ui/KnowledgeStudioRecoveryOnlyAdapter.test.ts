jest.mock("@/knowledge/startup/KnowledgeProductionRecoveryComposer", () => {
  class KnowledgeProductionRecoveryComposer {
    observation?: unknown;
    nextObservation?: unknown;
    readonly start = jest.fn(async () => {
      this.observation = this.nextObservation;
    });

    /** Accepts only instances minted by this test replacement. */
    static assert(value: unknown): void {
      if (!(value instanceof KnowledgeProductionRecoveryComposer)) throw new TypeError("invalid");
    }

    /** Returns the current injected stopped-Bundle observation. */
    getStudioObservation(bundleId: string): unknown {
      const observation = this.observation as { bundleId?: string } | undefined;
      return observation?.bundleId === bundleId ? observation : undefined;
    }
  }
  return { KnowledgeProductionRecoveryComposer };
});

import { KnowledgeProductionRecoveryComposer } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";
import {
  KnowledgeStudioRecoveryOnlyAdapter,
  type KnowledgeStudioRecoveryActionPort,
} from "@/knowledge/ui/KnowledgeStudioRecoveryOnlyAdapter";
import {
  KnowledgeStudioController,
  type KnowledgeStudioRecoverySubmissionResult,
} from "@/knowledge/ui/KnowledgeStudioController";

interface MutableComposerHarness {
  observation?: unknown;
  nextObservation?: unknown;
  start: jest.Mock<Promise<void>, []>;
}

const FORWARD_REVIEW_REF = `forward-studio-review-${"1".repeat(64)}`;
const FORWARD_SNAPSHOT_REF = `forward-studio-snapshot-${"2".repeat(64)}`;

/** Creates one frozen-enough content-free recovery observation for adapter tests. */
function createObservation(runtimeRevision = 7) {
  return {
    bundleId: "personal",
    runtimeRevision,
    reviewRevision: 3,
    activity: {
      bundleId: "personal",
      revision: 5,
      controls: {
        state: "startup_recovery" as const,
        canPause: false,
        canResume: false,
      },
      items: [],
      counts: {
        total: 0,
        active: 0,
        terminal: 0,
        hiddenTerminal: 0,
        byStatus: {
          queued: 0,
          parsing: 0,
          analyzing: 0,
          associating: 0,
          generating: 0,
          validating: 0,
          awaiting_review: 0,
          applying: 0,
          finalizing: 0,
          paused: 0,
          recovery_required: 0,
          failed: 0,
          cancelled: 0,
          completed: 0,
        },
      },
    },
    recovery: {
      bundleId: "personal",
      runtimeRevision,
      items: [
        {
          id: "recovery-1",
          status: "decision_required" as const,
          actions: { canContinue: true, canAbandon: true },
        },
      ],
    },
    forwardRevisionReviews: [],
  };
}

/** Creates one content-free forward journal observation owned by startup recovery. */
function createForwardObservation(state: "applying" | "recovery_required", runtimeRevision = 8) {
  const base = {
    reviewRef: FORWARD_REVIEW_REF,
    snapshotRef: FORWARD_SNAPSHOT_REF,
    pagePath: "Wiki/Forward.md",
    updatedAt: 30,
    acceptedAt: 20,
    manualOverride: false,
  };
  return {
    ...createObservation(runtimeRevision),
    activity: {
      ...createObservation(runtimeRevision).activity,
      controls: {
        state:
          state === "applying" ? ("startup_recovery" as const) : ("recovery_required" as const),
        canPause: false,
        canResume: false,
      },
    },
    recovery: { bundleId: "personal", runtimeRevision, items: [] },
    forwardRevisionReviews: [
      state === "applying"
        ? { state, ...base, applyPhase: "applying" as const }
        : {
            state,
            ...base,
            conflictCode: "file_state_conflict" as const,
            actualKind: "file" as const,
            detectedAt: 31,
          },
    ],
  };
}

/** Creates one adapter plus observable fake composer and action callbacks. */
function createHarness() {
  const composer = new KnowledgeProductionRecoveryComposer({} as never);
  const mutableComposer = composer as unknown as MutableComposerHarness;
  mutableComposer.observation = createObservation();
  const actions: jest.Mocked<KnowledgeStudioRecoveryActionPort> = {
    continue: jest.fn<
      Promise<KnowledgeStudioRecoverySubmissionResult>,
      [string, string, number, AbortSignal]
    >(async () => ({ kind: "completed" })),
    abandon: jest.fn<
      Promise<KnowledgeStudioRecoverySubmissionResult>,
      [string, string, number, AbortSignal]
    >(async () => ({ kind: "completed" })),
  };
  const onRecoveryStateChanged = jest.fn();
  const adapter = new KnowledgeStudioRecoveryOnlyAdapter({
    composer,
    bundleIds: ["personal"],
    actions,
    assertCurrent: () => undefined,
    onRecoveryStateChanged,
  });
  return { adapter, actions, mutableComposer, onRecoveryStateChanged };
}

describe("KnowledgeStudioRecoveryOnlyAdapter", () => {
  it("publishes only recovery capabilities from the retained first observation", async () => {
    const { adapter, mutableComposer } = createHarness();

    const snapshot = await adapter.load("personal", new AbortController().signal);

    expect(mutableComposer.start).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      bundleId: "personal",
      availability: "ready",
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
        forwardRevisionReview: false,
        recoveryContinue: true,
        recoveryAbandon: true,
      },
      recovery: { runtimeRevision: 7 },
    });
    expect(snapshot.reviews).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    await expect(
      adapter.pauseBundle("personal", 5, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
  });

  it.each(["applying", "recovery_required"] as const)(
    "publishes one %s forward row on Review with every mutation command disabled",
    async (forwardState) => {
      const { adapter, actions, mutableComposer } = createHarness();
      mutableComposer.observation = createForwardObservation(forwardState);

      const snapshot = await adapter.load("personal", new AbortController().signal);

      expect(snapshot.preferredTab).toBe("review");
      expect(snapshot.commandCapabilities).toEqual({
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
        forwardRevisionReview: false,
        recoveryContinue: false,
        recoveryAbandon: false,
      });
      expect(snapshot.reviews).toEqual([]);
      expect(snapshot.recovery.items).toEqual([]);
      expect(snapshot.forwardRevisionReviews).toHaveLength(1);
      expect(snapshot.forwardRevisionReviews?.[0]).toMatchObject({
        state: forwardState,
        reviewRef: FORWARD_REVIEW_REF,
        snapshotRef: FORWARD_SNAPSHOT_REF,
        pagePath: "Wiki/Forward.md",
      });
      expect(Object.keys(snapshot.forwardRevisionReviews?.[0] ?? {}).sort()).toEqual(
        (forwardState === "applying"
          ? [
              "acceptedAt",
              "applyPhase",
              "manualOverride",
              "pagePath",
              "reviewRef",
              "snapshotRef",
              "state",
              "updatedAt",
            ]
          : [
              "acceptedAt",
              "actualKind",
              "conflictCode",
              "detectedAt",
              "manualOverride",
              "pagePath",
              "reviewRef",
              "snapshotRef",
              "state",
              "updatedAt",
            ]
        ).sort()
      );
      expect(JSON.stringify(snapshot)).not.toMatch(
        /acceptedDecision|applyClaim|decisionDigest|journalRevision|ledger|transactionId/
      );
      expect("submitForwardRevisionStudio" in adapter).toBe(false);
      expect(actions.continue).not.toHaveBeenCalled();
      expect(actions.abandon).not.toHaveBeenCalled();
      expect(snapshot.notice).toContain(
        forwardState === "applying"
          ? "reload the plugin or reopen Studio"
          : "Automatic Apply retry is disabled"
      );
    }
  );

  it("re-runs forward recovery on a second load and replaces applying with sticky conflict truth", async () => {
    const { adapter, mutableComposer, onRecoveryStateChanged } = createHarness();
    mutableComposer.observation = createForwardObservation("applying", 8);
    const initial = await adapter.load("personal", new AbortController().signal);
    mutableComposer.nextObservation = createForwardObservation("recovery_required", 9);

    const refreshed = await adapter.load("personal", new AbortController().signal);

    expect(mutableComposer.start).toHaveBeenCalledTimes(1);
    expect(refreshed.preferredTab).toBe("review");
    expect(refreshed.forwardRevisionReviews).toMatchObject([
      { state: "recovery_required", reviewRef: FORWARD_REVIEW_REF },
    ]);
    expect(refreshed.revisionToken).not.toBe(initial.revisionToken);
    expect(onRecoveryStateChanged).not.toHaveBeenCalled();
  });

  it("opens the controller on Review for the first forward startup-recovery snapshot", async () => {
    const { adapter, mutableComposer } = createHarness();
    mutableComposer.observation = createForwardObservation("applying");
    const controller = new KnowledgeStudioController(adapter, adapter);

    controller.start("personal");
    for (let attempt = 0; attempt < 20 && controller.getState().status !== "ready"; attempt += 1) {
      await Promise.resolve();
    }

    expect(controller.getState()).toMatchObject({
      status: "ready",
      activeTab: "review",
      selectedForwardRevisionRef: FORWARD_REVIEW_REF,
      snapshot: {
        preferredTab: "review",
        commandCapabilities: { forwardRevisionReview: false },
      },
    });
    controller.destroy();
  });

  it("re-runs recovery on a later check and requests lifecycle rebuild when clear", async () => {
    const { adapter, mutableComposer, onRecoveryStateChanged } = createHarness();
    await adapter.load("personal", new AbortController().signal);
    mutableComposer.nextObservation = undefined;

    await expect(adapter.load("personal", new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mutableComposer.start).toHaveBeenCalledTimes(1);
    expect(onRecoveryStateChanged).toHaveBeenCalledTimes(1);
  });

  it("delegates exact opaque continue and abandon commands", async () => {
    const { adapter, actions } = createHarness();
    const signal = new AbortController().signal;

    await expect(adapter.continueRecovery("personal", "recovery-1", 7, signal)).resolves.toEqual({
      kind: "completed",
    });
    await expect(adapter.abandonRecovery("personal", "recovery-1", 7, signal)).resolves.toEqual({
      kind: "completed",
    });

    expect(actions.continue).toHaveBeenCalledWith("personal", "recovery-1", 7, signal);
    expect(actions.abandon).toHaveBeenCalledWith("personal", "recovery-1", 7, signal);
  });

  it("rejects another Bundle and caller cancellation before consulting actions", async () => {
    const { adapter, actions } = createHarness();
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(
      adapter.continueRecovery("research", "recovery-1", 7, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      adapter.abandonRecovery("personal", "recovery-1", 7, cancelled.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(actions.continue).not.toHaveBeenCalled();
    expect(actions.abandon).not.toHaveBeenCalled();
  });
});
