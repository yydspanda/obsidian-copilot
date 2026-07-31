import {
  KnowledgePluginStartupBarrier,
  type KnowledgePluginStartupBarrierDependencies,
  type KnowledgePluginBundleConfigLoadResult,
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
