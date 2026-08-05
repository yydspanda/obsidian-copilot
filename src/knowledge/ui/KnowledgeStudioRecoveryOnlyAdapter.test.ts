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
import type { KnowledgeStudioRecoverySubmissionResult } from "@/knowledge/ui/KnowledgeStudioController";

interface MutableComposerHarness {
  observation?: unknown;
  nextObservation?: unknown;
  start: jest.Mock<Promise<void>, []>;
}

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
