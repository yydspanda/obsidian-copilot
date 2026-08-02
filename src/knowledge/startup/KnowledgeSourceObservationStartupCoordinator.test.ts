import type { VaultSourceWatcherStartupBlocker } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  KnowledgeSourceObservationStartupCoordinator,
  type KnowledgeSourceObservationStartupCoordinatorDependencies,
  type KnowledgeSourceObservationStartupReconcilerPort,
  type KnowledgeSourceObservationStartupWatcherPort,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";
import {
  KnowledgeSourceObservationStartupError,
  type KnowledgeSourceObservationStartupResult,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface WatcherHarness extends KnowledgeSourceObservationStartupWatcherPort {
  startListening: jest.Mock<void, []>;
  scan: jest.Mock<number, []>;
  waitForIdle: jest.Mock<Promise<void>, []>;
  getStartupBlockers: jest.Mock<readonly Readonly<VaultSourceWatcherStartupBlocker>[], []>;
  close: jest.Mock<void, []>;
}

interface ReconcilerHarness extends KnowledgeSourceObservationStartupReconcilerPort {
  reconcile: jest.Mock<Promise<KnowledgeSourceObservationStartupResult>, [AbortSignal]>;
  close: jest.Mock<void, []>;
}

/** Creates one externally settled Promise for lifecycle interleaving tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Creates one strict reconciler aggregate result. */
function createReconciliation(
  patch: Partial<Omit<KnowledgeSourceObservationStartupResult, "kind">> = {}
): KnowledgeSourceObservationStartupResult {
  return {
    kind: "reconciled",
    replayedBoundCount: 0,
    supersededBoundCount: 0,
    deferredAllocatedCount: 0,
    deferredDriftCount: 0,
    ...patch,
  };
}

/** Creates one observable watcher port with optional event ordering. */
function createWatcher(
  order: string[] = [],
  blockers: readonly Readonly<VaultSourceWatcherStartupBlocker>[] = []
): WatcherHarness {
  return {
    startListening: jest.fn(() => {
      order.push("listener");
    }),
    scan: jest.fn(() => {
      order.push("crawl");
      return 2;
    }),
    waitForIdle: jest.fn(async () => {
      order.push("idle");
    }),
    getStartupBlockers: jest.fn(() => {
      order.push("blockers");
      return blockers;
    }),
    close: jest.fn(() => {
      order.push("watcher-close");
    }),
  };
}

/** Creates one two-pass reconciler port with optional event ordering. */
function createReconciler(
  results: readonly KnowledgeSourceObservationStartupResult[] = [
    createReconciliation(),
    createReconciliation(),
  ],
  order: string[] = []
): ReconcilerHarness {
  let callIndex = 0;
  return {
    reconcile: jest.fn(async (_signal: AbortSignal) => {
      order.push(`reconcile-${callIndex + 1}`);
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex += 1;
      return result;
    }),
    close: jest.fn(() => {
      order.push("reconciler-close");
    }),
  };
}

/** Creates one complete coordinator dependency fixture. */
function createDependencies(
  watcher: WatcherHarness,
  reconciler: ReconcilerHarness,
  assertCurrent: jest.Mock<void, []> = jest.fn<void, []>()
): KnowledgeSourceObservationStartupCoordinatorDependencies {
  return { watcher, reconciler, assertCurrent };
}

/** Flushes bounded Promise turns until a synchronous predicate becomes true. */
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for test condition");
}

describe("KnowledgeSourceObservationStartupCoordinator", () => {
  it("orders listener, recovery, authoritative crawl, idle, and final residual proof", async () => {
    const order: string[] = [];
    const watcher = createWatcher(order);
    const reconciler = createReconciler(
      [createReconciliation({ deferredAllocatedCount: 1 }), createReconciliation()],
      order
    );
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 2,
    });

    expect(order).toEqual([
      "listener",
      "reconcile-1",
      "crawl",
      "idle",
      "reconcile-2",
      "idle",
      "blockers",
    ]);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
    expect(watcher.waitForIdle).toHaveBeenCalledTimes(2);
  });

  it("retains a synchronous health proof and supports repeated serial reproof", async () => {
    const order: string[] = [];
    const watcher = createWatcher(order);
    const reconciler = createReconciler(undefined, order);
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(controller.signal)).resolves.toMatchObject({
      kind: "observation_converged",
    });
    expect(() => coordinator.assertHealthy()).not.toThrow();

    const firstReproofStart = order.length;
    await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
      kind: "observation_reproved",
    });
    expect(order.slice(firstReproofStart)).toEqual(["idle", "reconcile-3", "idle", "blockers"]);
    expect(() => coordinator.assertHealthy()).not.toThrow();

    const secondReproofStart = order.length;
    await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
      kind: "observation_reproved",
    });
    expect(order.slice(secondReproofStart)).toEqual(["idle", "reconcile-4", "idle", "blockers"]);
    expect(() => coordinator.assertHealthy()).not.toThrow();

    expect(watcher.scan).toHaveBeenCalledTimes(1);
    expect(watcher.waitForIdle).toHaveBeenCalledTimes(6);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(4);
  });

  it("lets the crawl heal a pre-crawl pipeline mismatch before final proof", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    reconciler.reconcile
      .mockRejectedValueOnce(
        new KnowledgeSourceObservationStartupError("pipeline_fingerprint_changed")
      )
      .mockResolvedValueOnce(createReconciliation());
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "observation_converged",
      scheduledCaptureCount: 2,
    });
    expect(watcher.scan).toHaveBeenCalledTimes(1);
  });

  it("does not crawl past a non-healable pre-crawl recovery failure", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    reconciler.reconcile.mockRejectedValueOnce(
      new KnowledgeSourceObservationStartupError("recovery_work_invalid")
    );
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "observation_recovery_recovery_work_invalid",
    });
    expect(watcher.scan).not.toHaveBeenCalled();
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it("validates the pre-crawl reconciliation result before any crawl mutation", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    reconciler.reconcile.mockResolvedValueOnce({
      ...createReconciliation(),
      unexpected: "secret",
    } as KnowledgeSourceObservationStartupResult);
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "observation_recovery_recovery_work_invalid",
    });
    expect(watcher.scan).not.toHaveBeenCalled();
  });

  it("returns authoritative watcher blockers without releasing or running work", async () => {
    const watcher = createWatcher(
      [],
      [
        { kind: "source_missing", bundleId: "personal", sourceId: "source-1" },
        {
          kind: "source_path_invalid",
          reason: "case_mismatch",
          bundleId: "personal",
          sourceId: "source-2",
        },
        { kind: "source_missing", bundleId: "work", sourceId: "source-3" },
      ]
    );
    const reconciler = createReconciler();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "blocked",
      blockerKinds: ["source_missing", "source_path_invalid"],
    });
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it.each([{ deferredAllocatedCount: 1 }, { deferredDriftCount: 1 }] as const)(
    "keeps final deferred recovery work blocked: %o",
    async (patch) => {
      const watcher = createWatcher();
      const reconciler = createReconciler([createReconciliation(), createReconciliation(patch)]);
      const coordinator = new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(watcher, reconciler)
      );

      await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
        kind: "blocked",
        blockerKinds: ["source_observation_pending"],
      });
      expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    }
  );

  it("detects a destructive watcher blocker synchronously after startup convergence", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockReturnValue([
      {
        kind: "source_change_unsupported",
        change: "rename",
        bundleId: "personal",
        sourceId: "source-1",
      },
    ]);

    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    await expect(coordinator.reprove(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("reproves post-start work before returning a newly observed delete blocker", async () => {
    const order: string[] = [];
    const watcher = createWatcher(order);
    const reconciler = createReconciler(undefined, order);
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockImplementation(() => {
      order.push("blockers");
      return [
        {
          kind: "source_change_unsupported",
          change: "delete",
          bundleId: "personal",
          sourceId: "source-1",
        },
      ];
    });

    await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
      kind: "blocked",
      blockerKinds: ["source_change_unsupported"],
    });
    expect(order.slice(-6)).toEqual([
      "idle",
      "reconcile-3",
      "idle",
      "blockers",
      "watcher-close",
      "reconciler-close",
    ]);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it.each([{ deferredAllocatedCount: 1 }, { deferredDriftCount: 1 }] as const)(
    "closes a reproof that still has residual observation work: %o",
    async (patch) => {
      const watcher = createWatcher();
      const reconciler = createReconciler([
        createReconciliation(),
        createReconciliation(),
        createReconciliation(patch),
      ]);
      const controller = new AbortController();
      const coordinator = new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(watcher, reconciler)
      );
      await coordinator.start(controller.signal);

      await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
        kind: "blocked",
        blockerKinds: ["source_observation_pending"],
      });
      expect(watcher.close).toHaveBeenCalledTimes(1);
      expect(reconciler.close).toHaveBeenCalledTimes(1);
      expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    }
  );

  it("sanitizes a reproof failure and permanently revokes session health", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    reconciler.reconcile.mockRejectedValueOnce(
      new KnowledgeSourceObservationStartupError("source_authority_missing")
    );

    await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "observation_recovery_source_authority_missing",
    });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it("maps malformed reproof blocker state to a closed diagnostic session", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockReturnValue({ secret: "vault/path" } as never);

    await expect(coordinator.reprove(controller.signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "watcher_state_invalid",
    });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it("cannot publish reproof health when final blocker inspection aborts the startup signal", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockImplementation(() => {
      controller.abort();
      return [];
    });

    await expect(coordinator.reprove(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it("cannot publish initial health when blocker inspection invalidates the outer generation", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    let current = true;
    watcher.getStartupBlockers.mockImplementation(() => {
      current = false;
      return [];
    });
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(
        watcher,
        reconciler,
        jest.fn(() => {
          if (!current) throw new Error("stale outer generation");
        })
      )
    );

    await expect(coordinator.start(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it("cannot publish reproof health when blocker inspection invalidates the outer generation", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    let current = true;
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(
        watcher,
        reconciler,
        jest.fn(() => {
          if (!current) throw new Error("stale outer generation");
        })
      )
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockImplementation(() => {
      current = false;
      return [];
    });

    await expect(coordinator.reprove(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it("cannot retain synchronous health when blocker inspection invalidates the outer generation", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    let current = true;
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(
        watcher,
        reconciler,
        jest.fn(() => {
          if (!current) throw new Error("stale outer generation");
        })
      )
    );
    await coordinator.start(controller.signal);
    watcher.getStartupBlockers.mockImplementation(() => {
      current = false;
      return [];
    });

    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it("invalidates concurrent reproof instead of allowing either call to publish health", async () => {
    const deferred = createDeferred<void>();
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.waitForIdle.mockImplementationOnce(() => deferred.promise);

    const first = coordinator.reprove(controller.signal);
    const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => watcher.waitForIdle.mock.calls.length === 3);
    const secondRejection = expect(coordinator.reprove(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    deferred.resolve(undefined);

    await Promise.all([firstRejection, secondRejection]);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it("aborts an active reproof when the original startup signal is cancelled", async () => {
    const deferred = createDeferred<void>();
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);
    watcher.waitForIdle.mockImplementationOnce(() => deferred.promise);

    const running = coordinator.reprove(controller.signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => watcher.waitForIdle.mock.calls.length === 3);
    controller.abort();
    deferred.resolve(undefined);

    await rejection;
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
  });

  it.each(["different", "aborted"] as const)(
    "invalidates a %s reproof signal without transferring session health",
    async (mode) => {
      const watcher = createWatcher();
      const reconciler = createReconciler();
      const startupController = new AbortController();
      const otherController = new AbortController();
      if (mode === "aborted") {
        otherController.abort();
      }
      const coordinator = new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(watcher, reconciler)
      );
      await coordinator.start(startupController.signal);

      await expect(coordinator.reprove(otherController.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(watcher.close).toHaveBeenCalledTimes(1);
      expect(reconciler.close).toHaveBeenCalledTimes(1);
      expect(() => coordinator.assertHealthy()).toThrow("The operation was aborted");
    }
  );

  it("projects only a branded final recovery failure code", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    reconciler.reconcile
      .mockResolvedValueOnce(createReconciliation())
      .mockRejectedValueOnce(
        new KnowledgeSourceObservationStartupError("source_authority_missing")
      );
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "observation_recovery_source_authority_missing",
    });
  });

  it("rejects prototype-forged recovery errors without exposing an injected code", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const forgedError = Object.create(KnowledgeSourceObservationStartupError.prototype) as object;
    Object.defineProperty(forgedError, "code", {
      enumerable: true,
      value: "vault/path/secret",
    });
    reconciler.reconcile
      .mockResolvedValueOnce(createReconciliation())
      .mockRejectedValueOnce(forgedError);
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );

    await expect(coordinator.start(new AbortController().signal)).resolves.toEqual({
      kind: "diagnostic",
      code: "observation_recovery_recovery_work_invalid",
    });
  });

  it("validates and freezes genuine recovery errors", () => {
    const error = new KnowledgeSourceObservationStartupError("source_authority_missing");

    expect(Object.isFrozen(error)).toBe(true);
    expect(
      () =>
        new KnowledgeSourceObservationStartupError(
          "vault/path/secret" as ConstructorParameters<
            typeof KnowledgeSourceObservationStartupError
          >[0]
        )
    ).toThrow(TypeError);
  });

  it("sanitizes listener, crawl, wait, and malformed watcher failures", async () => {
    const listenerWatcher = createWatcher();
    listenerWatcher.startListening.mockImplementation(() => {
      throw new Error("secret listener path");
    });
    await expect(
      new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(listenerWatcher, createReconciler())
      ).start(new AbortController().signal)
    ).resolves.toEqual({ kind: "diagnostic", code: "listener_start_failed" });

    const crawlWatcher = createWatcher();
    crawlWatcher.scan.mockImplementation(() => {
      throw new Error("secret crawl path");
    });
    await expect(
      new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(crawlWatcher, createReconciler())
      ).start(new AbortController().signal)
    ).resolves.toEqual({ kind: "diagnostic", code: "crawl_failed" });

    const waitWatcher = createWatcher();
    waitWatcher.waitForIdle.mockRejectedValue(new Error("secret pending capture"));
    await expect(
      new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(waitWatcher, createReconciler())
      ).start(new AbortController().signal)
    ).resolves.toEqual({ kind: "diagnostic", code: "watcher_wait_failed" });

    const malformedWatcher = createWatcher();
    malformedWatcher.scan.mockReturnValue(-1);
    await expect(
      new KnowledgeSourceObservationStartupCoordinator(
        createDependencies(malformedWatcher, createReconciler())
      ).start(new AbortController().signal)
    ).resolves.toEqual({ kind: "diagnostic", code: "watcher_state_invalid" });
  });

  it("close during pre-crawl recovery prevents the crawl and every later phase", async () => {
    const deferred = createDeferred<KnowledgeSourceObservationStartupResult>();
    const watcher = createWatcher();
    const reconciler = createReconciler();
    reconciler.reconcile.mockImplementationOnce(() => deferred.promise);
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    const running = coordinator.start(new AbortController().signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => reconciler.reconcile.mock.calls.length === 1);

    coordinator.close();
    coordinator.close();
    deferred.resolve(createReconciliation());

    await rejection;
    expect(watcher.scan).not.toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it("closes both ports and sanitizes a generation assertion failure", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    let assertionCount = 0;
    const assertCurrent = jest.fn(() => {
      assertionCount += 1;
      if (assertionCount === 2) {
        throw new Error("vault/path/secret");
      }
    });
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler, assertCurrent)
    );

    await expect(coordinator.start(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "The operation was aborted",
    });
    expect(watcher.startListening).toHaveBeenCalledTimes(1);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
  });

  it("close after crawl entry suppresses final reconciliation and publication", async () => {
    const deferred = createDeferred<void>();
    const watcher = createWatcher();
    watcher.waitForIdle.mockImplementationOnce(() => deferred.promise);
    const reconciler = createReconciler();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    const running = coordinator.start(new AbortController().signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => watcher.waitForIdle.mock.calls.length === 1);

    coordinator.close();
    deferred.resolve(undefined);

    await rejection;
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(watcher.getStartupBlockers).not.toHaveBeenCalled();
  });

  it("is one-shot and rejects an already-aborted caller before acquiring listeners", async () => {
    const watcher = createWatcher();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, createReconciler())
    );
    const aborted = new AbortController();
    aborted.abort();

    await expect(coordinator.start(aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(watcher.startListening).not.toHaveBeenCalled();

    const active = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(createWatcher(), createReconciler())
    );
    await expect(active.start(new AbortController().signal)).resolves.toMatchObject({
      kind: "observation_converged",
    });
    await expect(active.start(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("retains caller-generation cancellation after convergence and closes synchronously", async () => {
    const watcher = createWatcher();
    const reconciler = createReconciler();
    const controller = new AbortController();
    const coordinator = new KnowledgeSourceObservationStartupCoordinator(
      createDependencies(watcher, reconciler)
    );
    await coordinator.start(controller.signal);

    controller.abort();

    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(reconciler.close).toHaveBeenCalledTimes(1);
    coordinator.close();
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  it("rejects accessor-backed or incomplete dependency capabilities without invoking getters", () => {
    let getterCalls = 0;
    const watcher = Object.defineProperty({}, "startListening", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return () => undefined;
      },
    });

    expect(
      () =>
        new KnowledgeSourceObservationStartupCoordinator({
          watcher: watcher as KnowledgeSourceObservationStartupWatcherPort,
          reconciler: createReconciler(),
          assertCurrent: () => undefined,
        })
    ).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });
});
