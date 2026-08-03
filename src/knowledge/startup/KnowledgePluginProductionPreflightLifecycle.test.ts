import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KnowledgeProductionModelRouteLease } from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import {
  KnowledgeProductionPreflightComposer,
  type KnowledgeProductionPreflightComposerInput,
  type KnowledgeProductionPreflightResult,
  type KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { ProjectKnowledgePipelineProfileSource } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  KnowledgePluginProductionPreflightLifecycle,
  KnowledgePluginProductionWorkflowLease,
  type KnowledgePluginProductionPreflightLifecycleDependencies,
  type KnowledgePluginProductionPreflightPort,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import {
  createKnowledgeProductionPipelineResources,
  type KnowledgeProductionPipelineResources,
} from "@/knowledge/startup/KnowledgeProductionPipelineResources";

const PROJECT_ID = "project-personal";
const MODEL_NAME = "deepseek-v4-pro";
const MODEL_KEY = `${MODEL_NAME}|deepseek`;

/** Creates one strict Bundle with independent source and Wiki boundaries. */
function createBundle(id = "personal"): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: [`Sources/${id}`],
    wikiRoot: `Wiki/${id}`,
    schemaRef: `Schemas/${id}.md`,
    reviewMode: "always",
  };
}

/** Creates the narrow Project snapshot captured by one lifecycle generation. */
function createProjectRecord(bundle: unknown = createBundle()) {
  return {
    project: {
      id: PROJECT_ID,
      knowledgeBundle: bundle,
      projectModelKey: MODEL_KEY,
      modelConfigs: {},
    },
  };
}

/** Creates the detached complete owner shape produced by the workflow-plan loader. */
function cloneOwner(owner: ConfiguredProjectKnowledgeBundle): ConfiguredProjectKnowledgeBundle {
  return {
    projectId: owner.projectId,
    config: { ...owner.config, sourceRoots: [...owner.config.sourceRoots] },
  };
}

/** Creates already-hydrated settings without exposing a real credential. */
function createSettings(): KnowledgeProductionPreflightSettingsInput {
  return {
    temperature: 0,
    maxTokens: 8_192,
    reasoningEffort: "high",
    verbosity: "medium",
    activeModels: [
      {
        name: MODEL_NAME,
        provider: "deepseek",
        enabled: true,
        projectEnabled: true,
        temperature: 0,
        reasoningEffort: "high",
        apiKey: "test-only-model-credential",
      },
    ],
    deepseekApiKey: "test-only-provider-credential",
  };
}

/** Creates matching parser capabilities and secret-free profile behavior. */
function createResources(): KnowledgeProductionPipelineResources {
  return createKnowledgeProductionPipelineResources();
}

/** Creates a native-fetch-shaped capability that fails on accidental invocation. */
function createFetchPort(): jest.MockedFunction<KnowledgeDeepSeekFetchPort> {
  return jest.fn<ReturnType<KnowledgeDeepSeekFetchPort>, Parameters<KnowledgeDeepSeekFetchPort>>(
    async (_url, _init) => {
      throw new Error("Preflight must not invoke fetch");
    }
  );
}

/** Creates one observable idempotent preflight candidate. */
function createCandidate(
  result: KnowledgeProductionPreflightResult = { kind: "ready", bundleCount: 1 }
): KnowledgePluginProductionPreflightPort & {
  preflight: jest.Mock<KnowledgeProductionPreflightResult, []>;
  close: jest.Mock<void, []>;
} {
  let closed = false;
  const bundle = createBundle();
  const routeComposer = new KnowledgeProductionPreflightComposer({
    owners: [{ projectId: PROJECT_ID, config: bundle }],
    projects: [
      {
        id: PROJECT_ID,
        projectModelKey: MODEL_KEY,
        modelConfigs: {},
      },
    ],
    settings: createSettings(),
    profileOptions: createResources().profileOptions,
    fetchPort: createFetchPort(),
  });
  const routeOwner = routeComposer.getModelRouteLeaseOwner();
  return {
    preflight: jest.fn(() => (closed ? { kind: "diagnostic", code: "closed" } : result)),
    getModelRouteLeaseOwner: () => routeOwner,
    close: jest.fn(() => {
      closed = true;
      routeOwner.close();
    }),
  };
}

/** Creates default lifecycle dependencies with every capture point observable. */
function createDependencies(
  overrides: Partial<KnowledgePluginProductionPreflightLifecycleDependencies> = {}
): KnowledgePluginProductionPreflightLifecycleDependencies {
  return {
    getProjectRecords: jest.fn(() => [createProjectRecord()]),
    getSettings: jest.fn(() => createSettings()),
    fetchPort: createFetchPort(),
    createResources: jest.fn(() => createResources()),
    createPreflight: jest.fn(() => createCandidate()),
    ...overrides,
  };
}

describe("KnowledgePluginProductionPreflightLifecycle", () => {
  it("runs the real production composer without invoking the captured renderer fetch", async () => {
    const fetchPort = createFetchPort();
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle({
      getProjectRecords: () => [createProjectRecord()],
      getSettings: () => createSettings(),
      fetchPort,
      createResources: () => createKnowledgeProductionPipelineResources(),
    });

    const result = await lifecycle.load(new AbortController().signal);

    expect(result).toMatchObject({ kind: "configured", bundleIds: ["personal"] });
    expect(fetchPort).not.toHaveBeenCalled();
    lifecycle.close();
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("captures one Projects/Settings generation and retains the exact frozen owners it preflights", async () => {
    const events: string[] = [];
    const fetchPort = createFetchPort();
    const candidate = createCandidate();
    let preflightInput: KnowledgeProductionPreflightComposerInput | undefined;
    const dependencies = createDependencies({
      getProjectRecords: () => {
        events.push("projects");
        return [createProjectRecord()];
      },
      getSettings: () => {
        events.push("settings");
        return createSettings();
      },
      fetchPort,
      createResources: () => {
        events.push("resources");
        return createResources();
      },
      createPreflight: (input) => {
        events.push("preflight:construct");
        preflightInput = input;
        candidate.preflight.mockImplementation(() => {
          events.push("preflight:read");
          return { kind: "ready", bundleCount: 1 };
        });
        return candidate;
      },
    });
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(dependencies);

    const result = await lifecycle.load(new AbortController().signal);

    expect(events).toEqual([
      "projects",
      "settings",
      "resources",
      "preflight:construct",
      "preflight:read",
    ]);
    expect(result).toMatchObject({ kind: "configured", bundleIds: ["personal"] });
    if (result.kind !== "configured") throw new Error("Expected configured preflight");
    expect(preflightInput?.owners).toBe(result.admission.owners);
    expect(preflightInput?.fetchPort).toBe(fetchPort);
    expect(Object.isFrozen(result.admission)).toBe(true);
    expect(Object.isFrozen(result.admission.owners)).toBe(true);
    expect(Object.isFrozen(result.admission.owners[0]?.config)).toBe(true);
    expect(Object.isFrozen(result.admission.owners[0]?.config.sourceRoots)).toBe(true);
    expect(result.admission.workflowLease.getOwners()).toBe(result.admission.owners);
    expect(Object.isFrozen(result.admission.workflowLease.getParsers())).toBe(true);
    expect(result.admission.modelRouteLease.isCurrent()).toBe(true);
    expect(result.admission.modelRouteLease.coversBundleIds(["personal"])).toBe(true);
    expect(Reflect.ownKeys(result.admission.modelRouteLease)).toEqual([]);
    expect(preflightInput?.profileSource).toBeInstanceOf(ProjectKnowledgePipelineProfileSource);
    expect(fetchPort).not.toHaveBeenCalled();
    expect(candidate.close).not.toHaveBeenCalled();
    expect(() => lifecycle.assertCurrentAdmission(result.admission)).not.toThrow();
  });

  it("uses one authentic profile source for preflight and the same workflow generation", async () => {
    let preflightSource: ProjectKnowledgePipelineProfileSource | undefined;
    let preflightProfile: unknown;
    const candidate = createCandidate();
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({
        createPreflight: (input) => {
          preflightSource = input.profileSource;
          candidate.preflight.mockImplementation(() => {
            if (!input.profileSource) throw new Error("Expected lifecycle profile source");
            preflightProfile = input.profileSource.resolve(input.owners[0]);
            return { kind: "ready", bundleCount: 1 };
          });
          return candidate;
        },
      })
    );

    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");
    const detachedOwner = cloneOwner(result.admission.owners[0]);
    const workflowProfile = result.admission.workflowLease.resolve(
      detachedOwner,
      new AbortController().signal
    );

    expect(preflightSource).toBeInstanceOf(ProjectKnowledgePipelineProfileSource);
    expect(workflowProfile).toEqual(preflightProfile);
    expect(Object.isFrozen(workflowProfile)).toBe(true);
  });

  it("resolves a strict detached owner but rejects any changed complete config", async () => {
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(createDependencies());
    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");
    const owner = result.admission.owners[0];
    const detachedOwner = cloneOwner(owner);

    expect(
      result.admission.workflowLease.resolve(detachedOwner, new AbortController().signal)
    ).toMatchObject({ bundleId: owner.config.id });
    expect(() =>
      result.admission.workflowLease.resolve(
        {
          ...detachedOwner,
          config: { ...detachedOwner.config, wikiRoot: "Wiki/forged" },
        },
        new AbortController().signal
      )
    ).toThrow(TypeError);
    const aborted = new AbortController();
    aborted.abort();
    expect(() => result.admission.workflowLease.resolve(detachedOwner, aborted.signal)).toThrow(
      "The operation was aborted"
    );
  });

  it("revokes before a stable invalidation snapshot and isolates throwing observers", async () => {
    const candidate = createCandidate();
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight: () => candidate })
    );
    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");
    const lease = result.admission.workflowLease;
    const detachedOwner = cloneOwner(lease.getOwners()[0]);
    const events: string[] = [];
    let unsubscribeSecond: () => void = () => undefined;
    lease.subscribeInvalidation(() => {
      events.push(`first:${String(lease.isCurrent())}`);
      unsubscribeSecond();
      throw new Error("Observer failure must stay isolated");
    });
    unsubscribeSecond = lease.subscribeInvalidation(() => {
      events.push(`second:${String(lease.isCurrent())}`);
    });
    const unsubscribeRemoved = lease.subscribeInvalidation(() => events.push("removed"));
    unsubscribeRemoved();
    unsubscribeRemoved();

    lifecycle.invalidate();

    expect(events).toEqual(["first:false", "second:false"]);
    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(result.admission.modelRouteLease.isCurrent()).toBe(false);
    expect(lease.isCurrent()).toBe(false);
    expect(() => lease.assertCurrent()).toThrow("The operation was aborted");
    expect(() => lease.getOwners()).toThrow("The operation was aborted");
    expect(() => lease.getParsers()).toThrow("The operation was aborted");
    expect(() => lease.resolve(detachedOwner, new AbortController().signal)).toThrow(
      "The operation was aborted"
    );
    lease.subscribeInvalidation(() => events.push("late"))();
    lifecycle.invalidate();
    expect(events).toEqual(["first:false", "second:false", "late"]);
  });

  it("authenticates only minted secret-free leases without exposing mint or close authority", async () => {
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(createDependencies());
    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");
    const lease = result.admission.workflowLease;
    const modelLease = result.admission.modelRouteLease;
    const owner = lease.getOwners()[0];
    const profile = lease.resolve(cloneOwner(owner), new AbortController().signal);
    const exposed = JSON.stringify({ admission: result.admission, profile });

    expect(() => KnowledgePluginProductionWorkflowLease.assert(lease)).not.toThrow();
    expect(() => KnowledgeProductionModelRouteLease.assert(modelLease)).not.toThrow();
    expect(Reflect.ownKeys(lease)).toEqual([]);
    expect(Reflect.ownKeys(modelLease)).toEqual([]);
    expect("close" in modelLease).toBe(false);
    expect(exposed).not.toContain("test-only-model-credential");
    expect(exposed).not.toContain("test-only-provider-credential");
    expect(exposed).not.toContain("apiKey");
    expect(() =>
      KnowledgePluginProductionWorkflowLease.assert(
        Object.create(KnowledgePluginProductionWorkflowLease.prototype)
      )
    ).toThrow(TypeError);
    expect(() =>
      KnowledgePluginProductionWorkflowLease.assert({
        getOwners: () => result.admission.owners,
        getParsers: () => lease.getParsers(),
        isCurrent: () => true,
      })
    ).toThrow(TypeError);
    expect(() =>
      KnowledgeProductionModelRouteLease.assert(
        Object.create(KnowledgeProductionModelRouteLease.prototype)
      )
    ).toThrow();
    expect(() => {
      Reflect.construct(KnowledgePluginProductionWorkflowLease, [
        Symbol("forged"),
        result.admission.owners,
        lease.getParsers(),
        {},
      ]);
    }).toThrow(TypeError);
  });

  it("rejects a forged model-route owner without invoking it or blocking candidate cleanup", async () => {
    const candidate = createCandidate();
    const forgedClose = jest.fn(() => {
      throw new Error("Untrusted close authority must never run");
    });
    const forgedGetLease = jest.fn();
    const forgedOwner = { getLease: forgedGetLease, close: forgedClose };
    Object.defineProperty(candidate, "getModelRouteLeaseOwner", {
      value: () => forgedOwner,
      enumerable: true,
      configurable: true,
    });
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight: () => candidate })
    );

    await expect(lifecycle.load(new AbortController().signal)).resolves.toEqual({
      kind: "invalid",
      diagnosticCodes: ["production_preflight_route_invalid"],
    });

    expect(forgedClose).not.toHaveBeenCalled();
    expect(forgedGetLease).not.toHaveBeenCalled();
    expect(candidate.close).toHaveBeenCalledTimes(1);
  });

  it("closes a candidate constructed during synchronous Settings/Projects invalidation", async () => {
    const candidate = createCandidate();
    let lifecycle!: KnowledgePluginProductionPreflightLifecycle;
    const dependencies = createDependencies({
      createPreflight: () => {
        lifecycle.invalidate();
        return candidate;
      },
    });
    lifecycle = new KnowledgePluginProductionPreflightLifecycle(dependencies);

    await expect(lifecycle.load(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(candidate.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a candidate invalidated re-entrantly while its result is read", async () => {
    const candidate = createCandidate();
    let lifecycle!: KnowledgePluginProductionPreflightLifecycle;
    candidate.preflight.mockImplementation(() => {
      lifecycle.invalidate();
      return { kind: "ready", bundleCount: 1 };
    });
    lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight: () => candidate })
    );

    await expect(lifecycle.load(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(candidate.close).toHaveBeenCalled();
  });

  it("invalidates an installed admission synchronously and never rebuilds implicitly", async () => {
    const candidate = createCandidate();
    const createPreflight = jest.fn(() => candidate);
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight })
    );
    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");

    lifecycle.invalidate();

    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(result.admission.workflowLease.isCurrent()).toBe(false);
    expect(result.admission.modelRouteLease.isCurrent()).toBe(false);
    expect(createPreflight).toHaveBeenCalledTimes(1);
    let failure: unknown;
    try {
      lifecycle.assertCurrentAdmission(result.admission);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: "AbortError" });
  });

  it("uses latest-wins replacement and rejects the prior admission", async () => {
    const first = createCandidate();
    const second = createCandidate();
    const createPreflight = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight })
    );
    const firstResult = await lifecycle.load(new AbortController().signal);
    const secondResult = await lifecycle.load(new AbortController().signal);
    if (firstResult.kind !== "configured" || secondResult.kind !== "configured") {
      throw new Error("Expected configured preflights");
    }

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect(firstResult.admission.workflowLease.isCurrent()).toBe(false);
    expect(firstResult.admission.modelRouteLease.isCurrent()).toBe(false);
    expect(secondResult.admission.workflowLease.isCurrent()).toBe(true);
    expect(secondResult.admission.modelRouteLease.isCurrent()).toBe(true);
    expect(() => lifecycle.assertCurrentAdmission(firstResult.admission)).toThrow();
    expect(() => lifecycle.assertCurrentAdmission(secondResult.admission)).not.toThrow();
  });

  it("closes a diagnostic candidate and returns only its sanitized startup code", async () => {
    const candidate = createCandidate({ kind: "diagnostic", code: "route_credential_invalid" });
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ createPreflight: () => candidate })
    );

    await expect(lifecycle.load(new AbortController().signal)).resolves.toEqual({
      kind: "invalid",
      diagnosticCodes: ["production_preflight_route_credential_invalid"],
    });
    expect(candidate.close).toHaveBeenCalledTimes(1);
  });

  it("fails before Settings/resources/composer when renderer fetch is unavailable", async () => {
    const getSettings = jest.fn(() => createSettings());
    const createResources = jest.fn(() => createKnowledgeProductionPipelineResources());
    const createPreflight = jest.fn(() => createCandidate());
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({
        fetchPort: undefined,
        getSettings,
        createResources,
        createPreflight,
      })
    );

    await expect(lifecycle.load(new AbortController().signal)).resolves.toEqual({
      kind: "invalid",
      diagnosticCodes: ["production_preflight_route_dependency_invalid"],
    });
    expect(getSettings).not.toHaveBeenCalled();
    expect(createResources).not.toHaveBeenCalled();
    expect(createPreflight).not.toHaveBeenCalled();
  });

  it("preserves strict unconfigured and invalid Bundle outcomes without preflight", async () => {
    const createPreflight = jest.fn(() => createCandidate());
    const unconfigured = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({
        getProjectRecords: () => [
          {
            project: {
              id: PROJECT_ID,
              projectModelKey: MODEL_KEY,
              modelConfigs: {},
            },
          },
        ],
        createPreflight,
      })
    );
    const invalid = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({
        getProjectRecords: () => [createProjectRecord(null)],
        createPreflight,
      })
    );

    await expect(unconfigured.load(new AbortController().signal)).resolves.toEqual({
      kind: "unconfigured",
    });
    await expect(invalid.load(new AbortController().signal)).resolves.toEqual({
      kind: "invalid",
      diagnosticCodes: ["bundle_schema_invalid"],
    });
    expect(createPreflight).not.toHaveBeenCalled();
  });

  it("permanently closes the current candidate and rejects late startup", async () => {
    const candidate = createCandidate();
    const fetchPort = createFetchPort();
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ fetchPort, createPreflight: () => candidate })
    );
    const result = await lifecycle.load(new AbortController().signal);
    if (result.kind !== "configured") throw new Error("Expected configured preflight");

    lifecycle.close();
    lifecycle.close();

    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(result.admission.workflowLease.isCurrent()).toBe(false);
    expect(result.admission.modelRouteLease.isCurrent()).toBe(false);
    await expect(lifecycle.load(new AbortController().signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("rejects an already-aborted generation before reading Projects", async () => {
    const getProjectRecords = jest.fn(() => [createProjectRecord()]);
    const lifecycle = new KnowledgePluginProductionPreflightLifecycle(
      createDependencies({ getProjectRecords })
    );
    const controller = new AbortController();
    controller.abort();

    await expect(lifecycle.load(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getProjectRecords).not.toHaveBeenCalled();
  });
});
