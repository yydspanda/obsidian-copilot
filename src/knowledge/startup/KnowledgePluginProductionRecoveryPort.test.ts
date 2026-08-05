import {
  KnowledgePluginProductionRecoveryPort,
  toKnowledgePluginRecoveryStartupResult,
  type KnowledgePluginProductionRecoveryComposerPort,
} from "@/knowledge/startup/KnowledgePluginProductionRecoveryPort";
import type { KnowledgeProductionRecoveryState } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";

/** Promise controls used to hold a durable recovery await across closure. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one externally settled Promise. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Creates one observable composer with a replaceable public state. */
function createComposer(
  state: KnowledgeProductionRecoveryState,
  start: () => Promise<void> = async () => undefined
): KnowledgePluginProductionRecoveryComposerPort & {
  start: jest.Mock<Promise<void>, []>;
  getState: jest.Mock<KnowledgeProductionRecoveryState, []>;
  close: jest.Mock<void, []>;
} {
  return {
    start: jest.fn(start),
    getState: jest.fn(() => state),
    close: jest.fn(),
  };
}

describe("KnowledgePluginProductionRecoveryPort", () => {
  it("checks lifecycle authority around recovery and projects only observed-clear state", async () => {
    const composer = createComposer({
      generation: 1,
      status: "observed_clear",
      bundleResults: [],
    });
    const assertCurrent = jest.fn();
    const port = new KnowledgePluginProductionRecoveryPort({ composer, assertCurrent });

    await expect(port.start(new AbortController().signal)).resolves.toEqual({
      kind: "observed_clear",
    });

    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(composer.start).toHaveBeenCalledTimes(1);
    expect(composer.getState).toHaveBeenCalledTimes(1);
  });

  it.each(["attention_required", "blocked"] as const)(
    "deduplicates sanitized attention categories for %s",
    async (status) => {
      const composer = createComposer({
        generation: 2,
        status,
        stoppedBundleId: "personal",
        bundleResults: [
          {
            bundleId: "personal",
            disposition: status,
            attentionKinds: ["accepted_not_started", "accepted_not_started"],
          },
          {
            bundleId: "research",
            disposition: "observed_clear",
            attentionKinds: ["no_journal_decision_required"],
          },
        ],
      });
      const port = new KnowledgePluginProductionRecoveryPort({
        composer,
        assertCurrent: () => undefined,
      });

      await expect(port.start(new AbortController().signal)).resolves.toEqual({
        kind: status,
        recoveryBundleId: "personal",
        attentionKinds: ["accepted_not_started", "no_journal_decision_required"],
      });
    }
  );

  it("maps static diagnostics while rejecting nonterminal composer states", () => {
    expect(
      toKnowledgePluginRecoveryStartupResult({
        generation: 1,
        status: "diagnostic",
        code: "runtime_state_invalid",
      })
    ).toEqual({ kind: "unavailable", diagnosticCode: "runtime_state_invalid" });
    expect(
      toKnowledgePluginRecoveryStartupResult({
        generation: 1,
        status: "recovering",
        bundleIds: ["personal"],
      })
    ).toEqual({ kind: "unavailable", diagnosticCode: "recovery_state_invalid" });
    expect(toKnowledgePluginRecoveryStartupResult({ generation: 2, status: "closed" })).toEqual({
      kind: "unavailable",
      diagnosticCode: "recovery_state_invalid",
    });
  });

  it("does not start recovery for an already-aborted caller", async () => {
    const composer = createComposer({
      generation: 0,
      status: "idle",
      bundleIds: ["personal"],
    });
    const assertCurrent = jest.fn();
    const port = new KnowledgePluginProductionRecoveryPort({ composer, assertCurrent });
    const controller = new AbortController();
    controller.abort();

    await expect(port.start(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(assertCurrent).not.toHaveBeenCalled();
    expect(composer.start).not.toHaveBeenCalled();
  });

  it("consumes the one-shot capability after one completed start", async () => {
    const composer = createComposer({
      generation: 1,
      status: "observed_clear",
      bundleResults: [],
    });
    const port = new KnowledgePluginProductionRecoveryPort({
      composer,
      assertCurrent: () => undefined,
    });

    await expect(port.start(new AbortController().signal)).resolves.toEqual({
      kind: "observed_clear",
    });
    await expect(port.start(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(composer.start).toHaveBeenCalledTimes(1);
    expect(composer.getState).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent second start before it can share composer state", async () => {
    const recovery = createDeferred<void>();
    const composer = createComposer(
      { generation: 1, status: "observed_clear", bundleResults: [] },
      () => recovery.promise
    );
    const port = new KnowledgePluginProductionRecoveryPort({
      composer,
      assertCurrent: () => undefined,
    });

    const first = port.start(new AbortController().signal);
    await expect(port.start(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    recovery.resolve(undefined);
    await expect(first).resolves.toEqual({ kind: "observed_clear" });

    expect(composer.start).toHaveBeenCalledTimes(1);
    expect(composer.getState).toHaveBeenCalledTimes(1);
  });

  it("closes in-flight ownership and rejects its late durable completion", async () => {
    const recovery = createDeferred<void>();
    const composer = createComposer(
      { generation: 1, status: "observed_clear", bundleResults: [] },
      () => recovery.promise
    );
    const onClose = jest.fn();
    const port = new KnowledgePluginProductionRecoveryPort({
      composer,
      assertCurrent: () => undefined,
      onClose,
    });
    const running = port.start(new AbortController().signal);

    port.close();
    port.close();
    recovery.resolve(undefined);

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(composer.close).toHaveBeenCalledTimes(1);
    expect(composer.getState).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("releases the plugin reference even if composer closure throws", () => {
    const composer = createComposer({ generation: 0, status: "closed" });
    composer.close.mockImplementation(() => {
      throw new Error("private cleanup failure");
    });
    const onClose = jest.fn();
    const port = new KnowledgePluginProductionRecoveryPort({
      composer,
      assertCurrent: () => undefined,
      onClose,
    });

    expect(() => port.close()).toThrow("private cleanup failure");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(() => port.close()).not.toThrow();
    expect(composer.close).toHaveBeenCalledTimes(1);
  });
});
