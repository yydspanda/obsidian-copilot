import {
  KnowledgePluginStartupBarrier,
  type KnowledgePluginStartupBarrierDependencies,
  type KnowledgePluginBundleConfigLoadResult,
  type KnowledgePluginRecoveryStartupPort,
  type KnowledgePluginRecoveryStartupResult,
  type KnowledgePluginObservationStartupPort,
  type KnowledgePluginObservationStartupResult,
  type KnowledgePluginStartupState,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";

/** Promise controls used to hold one startup prerequisite across a rerun. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/** Creates externally controlled asynchronous work for ordering tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/** Creates the safe configured aggregate returned by the project adapter. */
function createConfiguredBundles(
  bundleIds: readonly string[] = ["personal"]
): KnowledgePluginBundleConfigLoadResult {
  return { kind: "configured", bundleIds };
}

/** Creates an observable one-shot recovery port. */
function createRecovery(
  start: (signal: AbortSignal) => Promise<KnowledgePluginRecoveryStartupResult> = async () => ({
    kind: "observed_clear",
  })
): KnowledgePluginRecoveryStartupPort & {
  start: jest.Mock<Promise<KnowledgePluginRecoveryStartupResult>, [AbortSignal]>;
  close: jest.Mock<void, []>;
} {
  return { start: jest.fn(start), close: jest.fn() };
}

/** Creates an observable long-lived observation port. */
function createObservation(
  start: (signal: AbortSignal) => Promise<KnowledgePluginObservationStartupResult> = async () => ({
    kind: "observation_converged",
    scheduledCaptureCount: 1,
  })
): KnowledgePluginObservationStartupPort & {
  start: jest.Mock<Promise<KnowledgePluginObservationStartupResult>, [AbortSignal]>;
  close: jest.Mock<void, []>;
} {
  return { start: jest.fn(start), close: jest.fn() };
}

/** Creates default narrow dependencies and captures every Studio reset. */
function createHarness(overrides: Partial<KnowledgePluginStartupBarrierDependencies> = {}): {
  barrier: KnowledgePluginStartupBarrier;
  dependencies: KnowledgePluginStartupBarrierDependencies;
  studioStates: KnowledgePluginStartupState[];
} {
  const studioStates: KnowledgePluginStartupState[] = [];
  const dependencies: KnowledgePluginStartupBarrierDependencies = {
    runtime: { isAvailable: jest.fn(() => true) },
    projects: { initialize: jest.fn(async () => undefined) },
    bundleConfig: { load: jest.fn(async () => createConfiguredBundles()) },
    studio: {
      setUnavailable: jest.fn((state) => {
        studioStates.push(state);
      }),
    },
    ...overrides,
  };
  return {
    barrier: new KnowledgePluginStartupBarrier(dependencies),
    dependencies,
    studioStates,
  };
}

describe("KnowledgePluginStartupBarrier", () => {
  it("enforces Runtime, awaited project initialization, then Bundle loading in strict order", async () => {
    const events: string[] = [];
    const projectsReady = createDeferred<void>();
    const { barrier } = createHarness({
      runtime: {
        isAvailable: () => {
          events.push("runtime");
          return true;
        },
      },
      projects: {
        initialize: async () => {
          events.push("projects:start");
          await projectsReady.promise;
          events.push("projects:end");
        },
      },
      bundleConfig: {
        load: async () => {
          events.push("bundle:load");
          return createConfiguredBundles();
        },
      },
      studio: {
        setUnavailable: (state) => {
          events.push(`studio:${state.status}:${state.generation}`);
        },
      },
    });

    const startup = barrier.startAfterLayout();
    expect(events).toEqual([
      "studio:waiting_for_layout:0",
      "studio:waiting_for_layout:1",
      "runtime",
      "projects:start",
    ]);

    projectsReady.resolve(undefined);
    await startup;

    expect(events).toEqual([
      "studio:waiting_for_layout:0",
      "studio:waiting_for_layout:1",
      "runtime",
      "projects:start",
      "projects:end",
      "bundle:load",
      "studio:workflow_adapters_unavailable:1",
    ]);
    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "workflow_adapters_unavailable",
      bundleIds: ["personal"],
    });
  });

  it("runs one recovery generation after configured preflight and remains workflow unavailable", async () => {
    const events: string[] = [];
    const recovery = createRecovery(async (signal) => {
      expect(signal.aborted).toBe(false);
      events.push("recovery:start");
      return { kind: "observed_clear" };
    });
    recovery.close.mockImplementation(() => events.push("recovery:close"));
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => {
          events.push("bundle:load");
          return { kind: "configured", bundleIds: ["personal"], recovery };
        },
      },
      studio: {
        setUnavailable: (state) => events.push(`studio:${state.status}`),
      },
    });

    await barrier.startAfterLayout();

    expect(events).toEqual([
      "studio:waiting_for_layout",
      "studio:waiting_for_layout",
      "bundle:load",
      "recovery:start",
      "recovery:close",
      "studio:workflow_adapters_unavailable",
    ]);
    expect(recovery.start).toHaveBeenCalledTimes(1);
    expect(recovery.close).toHaveBeenCalledTimes(1);
    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "workflow_adapters_unavailable",
      bundleIds: ["personal"],
    });
  });

  it("starts observation only after clear recovery and retains it until cancellation", async () => {
    const events: string[] = [];
    const recovery = createRecovery(async () => {
      events.push("recovery:start");
      return { kind: "observed_clear" };
    });
    recovery.close.mockImplementation(() => events.push("recovery:close"));
    const observation = createObservation(async (signal) => {
      expect(signal.aborted).toBe(false);
      events.push("observation:start");
      return { kind: "observation_converged", scheduledCaptureCount: 1 };
    });
    observation.close.mockImplementation(() => events.push("observation:close"));
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => ({
          kind: "configured",
          bundleIds: ["personal"],
          recovery,
          observation,
        }),
      },
      studio: {
        setUnavailable: (state) => events.push(`studio:${state.status}`),
      },
    });

    await barrier.startAfterLayout();

    expect(events).toEqual([
      "studio:waiting_for_layout",
      "studio:waiting_for_layout",
      "recovery:start",
      "recovery:close",
      "observation:start",
      "studio:workflow_adapters_unavailable",
    ]);
    expect(observation.close).not.toHaveBeenCalled();

    barrier.cancel();

    expect(observation.close).toHaveBeenCalledTimes(1);
    expect(barrier.getState()).toEqual({ generation: 2, status: "waiting_for_layout" });
  });

  it("closes observation when clear recovery is followed by a malformed result", async () => {
    const recovery = createRecovery();
    const observation = createObservation(async () => ({
      kind: "observation_converged",
      scheduledCaptureCount: -1,
    }));
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => ({ kind: "configured", bundleIds: ["personal"], recovery, observation }),
      },
    });

    await barrier.startAfterLayout();

    expect(observation.close).toHaveBeenCalledTimes(1);
    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "recovery_unavailable",
      bundleIds: ["personal"],
      diagnosticCodes: ["recovery_result_invalid"],
    });
  });

  it.each([
    {
      recoveryResult: {
        kind: "attention_required" as const,
        attentionKinds: [
          "no_journal_decision_required",
          "accepted_not_started",
          "accepted_not_started",
        ],
      },
      expected: {
        generation: 1,
        status: "recovery_attention_required",
        bundleIds: ["personal"],
        attentionKinds: ["accepted_not_started", "no_journal_decision_required"],
      },
    },
    {
      recoveryResult: {
        kind: "blocked" as const,
        attentionKinds: ["queue_recovery_required"],
      },
      expected: {
        generation: 1,
        status: "recovery_blocked",
        bundleIds: ["personal"],
        attentionKinds: ["queue_recovery_required"],
      },
    },
    {
      recoveryResult: {
        kind: "unavailable" as const,
        diagnosticCode: "runtime_state_invalid",
      },
      expected: {
        generation: 1,
        status: "recovery_unavailable",
        bundleIds: ["personal"],
        diagnosticCodes: ["runtime_state_invalid"],
      },
    },
  ])(
    "publishes sanitized recovery state for $recoveryResult.kind",
    async ({ recoveryResult, expected }) => {
      const recovery = createRecovery(async () => recoveryResult);
      const { barrier } = createHarness({
        bundleConfig: {
          load: async () => ({ kind: "configured", bundleIds: ["personal"], recovery }),
        },
      });

      await barrier.startAfterLayout();

      expect(barrier.getState()).toEqual(expected);
      expect(Object.isFrozen(barrier.getState())).toBe(true);
      expect(JSON.stringify(barrier.getState())).not.toContain("private");
      expect(recovery.close).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects unrecognized recovery evidence instead of exposing or dropping it", async () => {
    const rawAttention = "C:\\private\\vault";
    const recovery = createRecovery(async () => ({
      kind: "blocked",
      attentionKinds: ["queue_recovery_required", rawAttention],
    }));
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => ({ kind: "configured", bundleIds: ["personal"], recovery }),
      },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "recovery_unavailable",
      bundleIds: ["personal"],
      diagnosticCodes: ["recovery_result_invalid"],
    });
    expect(JSON.stringify(barrier.getState())).not.toContain(rawAttention);
  });

  it("sanitizes recovery failures without reclassifying strict Bundle configuration", async () => {
    const recovery = createRecovery(async () => {
      throw new Error("C:\\private\\vault and credential");
    });
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => ({ kind: "configured", bundleIds: ["personal"], recovery }),
      },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "recovery_unavailable",
      bundleIds: ["personal"],
      diagnosticCodes: ["recovery_failed"],
    });
    expect(JSON.stringify(barrier.getState())).not.toContain("private");
    expect(recovery.close).toHaveBeenCalledTimes(1);
  });

  it("closes an in-flight recovery and suppresses its late result after cancellation", async () => {
    const started = createDeferred<void>();
    const recoveryReady = createDeferred<KnowledgePluginRecoveryStartupResult>();
    let recoverySignal: AbortSignal | undefined;
    const recovery = createRecovery(async (signal) => {
      recoverySignal = signal;
      started.resolve(undefined);
      return recoveryReady.promise;
    });
    const { barrier } = createHarness({
      bundleConfig: {
        load: async () => ({ kind: "configured", bundleIds: ["personal"], recovery }),
      },
    });

    const startup = barrier.startAfterLayout();
    await started.promise;
    barrier.cancel();

    expect(recoverySignal?.aborted).toBe(true);
    expect(recovery.close).toHaveBeenCalledTimes(1);
    expect(barrier.getState()).toEqual({ generation: 2, status: "waiting_for_layout" });

    recoveryReady.resolve({ kind: "observed_clear" });
    await startup;
    expect(barrier.getState()).toEqual({ generation: 2, status: "waiting_for_layout" });
    expect(recovery.close).toHaveBeenCalledTimes(1);
  });

  it("stops before projects when the Runtime is unavailable or its check throws", async () => {
    for (const isAvailable of [
      () => false,
      () => {
        throw new Error("raw runtime detail");
      },
    ]) {
      const projects = { initialize: jest.fn(async () => undefined) };
      const bundleConfig = { load: jest.fn(async () => createConfiguredBundles()) };
      const { barrier } = createHarness({
        runtime: { isAvailable },
        projects,
        bundleConfig,
      });

      await barrier.startAfterLayout();

      expect(barrier.getState()).toEqual({
        generation: 1,
        status: "runtime_unavailable",
      });
      expect(projects.initialize).not.toHaveBeenCalled();
      expect(bundleConfig.load).not.toHaveBeenCalled();
    }
  });

  it("does not consult a stale Bundle cache when awaited project initialization fails", async () => {
    const bundleConfig = { load: jest.fn(async () => createConfiguredBundles()) };
    const { barrier } = createHarness({
      projects: {
        initialize: jest.fn(async () => {
          throw new Error("vault path and raw project failure");
        }),
      },
      bundleConfig,
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "projects_unavailable",
    });
    expect(bundleConfig.load).not.toHaveBeenCalled();
    expect(JSON.stringify(barrier.getState())).not.toContain("vault path");
  });

  it("keeps Studio unavailable when Bundle configuration is missing", async () => {
    const { barrier } = createHarness({
      bundleConfig: { load: jest.fn(async () => ({ kind: "unconfigured" as const })) },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "bundle_unconfigured",
    });
  });

  it("publishes only frozen, sanitized diagnostic codes without raw aggregate input", async () => {
    const rawSecret = "C:\\private\\vault\\project.md";
    const aggregate = {
      kind: "invalid" as const,
      diagnosticCodes: [
        "source_wiki_overlap",
        rawSecret,
        "schema_unrecognized_keys",
        "source_wiki_overlap",
      ],
      rawConfig: { schemaRef: rawSecret },
    };
    const { barrier } = createHarness({
      bundleConfig: { load: jest.fn(async () => aggregate) },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "bundle_invalid",
      diagnosticCodes: ["schema_unrecognized_keys", "source_wiki_overlap"],
    });
    const state = barrier.getState();
    expect(Object.isFrozen(state)).toBe(true);
    if (state.status === "bundle_invalid") {
      expect(Object.isFrozen(state.diagnosticCodes)).toBe(true);
    }
    expect(JSON.stringify(state)).not.toContain("private");
  });

  it("converts a Bundle load rejection into a sanitized invalid state", async () => {
    const { barrier } = createHarness({
      bundleConfig: {
        load: jest.fn(async () => {
          throw new Error("C:\\private\\vault\\project.md");
        }),
      },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "bundle_invalid",
      diagnosticCodes: ["bundle_config_load_failed"],
    });
    expect(JSON.stringify(barrier.getState())).not.toContain("private");
  });

  it("aborts a prior run and prevents its stale completion from publishing", async () => {
    const firstProjects = createDeferred<void>();
    const projectSignals: AbortSignal[] = [];
    let projectCall = 0;
    const bundleConfig = { load: jest.fn(async () => createConfiguredBundles()) };
    const { barrier, studioStates } = createHarness({
      projects: {
        initialize: jest.fn(async (signal) => {
          projectSignals.push(signal);
          projectCall += 1;
          if (projectCall === 1) {
            await firstProjects.promise;
          }
        }),
      },
      bundleConfig,
    });

    const staleRun = barrier.startAfterLayout();
    const currentRun = barrier.startAfterLayout();

    expect(projectSignals[0]?.aborted).toBe(true);
    await currentRun;
    firstProjects.resolve(undefined);
    await staleRun;

    expect(bundleConfig.load).toHaveBeenCalledTimes(1);
    expect(barrier.getState()).toEqual({
      generation: 2,
      status: "workflow_adapters_unavailable",
      bundleIds: ["personal"],
    });
    const firstGenerationTwoState = studioStates.findIndex((state) => state.generation === 2);
    expect(
      studioStates
        .slice(firstGenerationTwoState)
        .some((state) => state.generation === 1 && state.status !== "waiting_for_layout")
    ).toBe(false);
  });

  it("cancels an active await without permitting a later stale publication", async () => {
    const projectsReady = createDeferred<void>();
    let signal: AbortSignal | undefined;
    const bundleConfig = { load: jest.fn(async () => createConfiguredBundles()) };
    const { barrier } = createHarness({
      projects: {
        initialize: jest.fn(async (nextSignal) => {
          signal = nextSignal;
          await projectsReady.promise;
        }),
      },
      bundleConfig,
    });

    const startup = barrier.startAfterLayout();
    barrier.cancel();
    expect(signal?.aborted).toBe(true);
    expect(barrier.getState()).toEqual({
      generation: 2,
      status: "waiting_for_layout",
    });

    projectsReady.resolve(undefined);
    await startup;

    expect(bundleConfig.load).not.toHaveBeenCalled();
    expect(barrier.getState()).toEqual({
      generation: 2,
      status: "waiting_for_layout",
    });
  });

  it("notifies observers only after Studio has been reset to the same unavailable state", async () => {
    const order: string[] = [];
    let barrier!: KnowledgePluginStartupBarrier;
    const { barrier: created } = createHarness({
      studio: {
        setUnavailable: (state) => {
          order.push(`studio:${state.status}`);
        },
      },
      bundleConfig: { load: jest.fn(async () => ({ kind: "unconfigured" as const })) },
    });
    barrier = created;
    barrier.subscribe(() => {
      order.push(`observer:${barrier.getState().status}`);
    });

    await barrier.startAfterLayout();

    expect(order).toEqual([
      "studio:waiting_for_layout",
      "studio:waiting_for_layout",
      "observer:waiting_for_layout",
      "studio:bundle_unconfigured",
      "observer:bundle_unconfigured",
    ]);
  });

  it("offers no ready publication path across every terminal outcome", async () => {
    const terminalStates: KnowledgePluginStartupState[] = [];
    const scenarios: Partial<KnowledgePluginStartupBarrierDependencies>[] = [
      { runtime: { isAvailable: () => false } },
      {
        projects: {
          initialize: async () => {
            throw new Error("unavailable");
          },
        },
      },
      { bundleConfig: { load: async () => ({ kind: "unconfigured" }) } },
      {
        bundleConfig: {
          load: async () => ({ kind: "invalid", diagnosticCodes: ["schema_invalid"] }),
        },
      },
      { bundleConfig: { load: async () => createConfiguredBundles() } },
    ];

    for (const overrides of scenarios) {
      const { barrier, studioStates } = createHarness(overrides);
      await barrier.startAfterLayout();
      terminalStates.push(barrier.getState());
      expect(studioStates.every((state) => state.status !== ("ready" as never))).toBe(true);
    }

    expect(terminalStates.map((state) => state.status)).toEqual([
      "runtime_unavailable",
      "projects_unavailable",
      "bundle_unconfigured",
      "bundle_invalid",
      "workflow_adapters_unavailable",
    ]);
  });

  it("publishes deterministic frozen identifiers for multiple configured Bundles", async () => {
    const aggregate = {
      kind: "configured" as const,
      bundleIds: ["research", "personal", "research", "资料"],
      rawConfig: { sourceRoots: ["C:\\private\\sources"] },
    };
    const { barrier } = createHarness({
      bundleConfig: { load: jest.fn(async () => aggregate) },
    });

    await barrier.startAfterLayout();

    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "workflow_adapters_unavailable",
      bundleIds: ["personal", "research", "资料"],
    });
    const state = barrier.getState();
    expect(Object.isFrozen(state)).toBe(true);
    if (state.status === "workflow_adapters_unavailable") {
      expect(Object.isFrozen(state.bundleIds)).toBe(true);
    }
    expect(JSON.stringify(state)).not.toContain("private");
    expect(JSON.stringify(state)).not.toContain("sourceRoots");
  });

  it("isolates listener exceptions so later observers and startup still complete", async () => {
    const observations: string[] = [];
    const { barrier } = createHarness();
    barrier.subscribe(() => {
      throw new Error("observer-private-detail");
    });
    barrier.subscribe(() => {
      observations.push(barrier.getState().status);
    });

    await expect(barrier.startAfterLayout()).resolves.toBeUndefined();

    expect(observations).toEqual(["waiting_for_layout", "workflow_adapters_unavailable"]);
    expect(barrier.getState()).toEqual({
      generation: 1,
      status: "workflow_adapters_unavailable",
      bundleIds: ["personal"],
    });
    expect(JSON.stringify(barrier.getState())).not.toContain("observer-private-detail");
  });
});
