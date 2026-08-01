import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type {
  KnowledgeProductionPreflightComposerInput,
  KnowledgeProductionPreflightResult,
  KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import type { ProjectKnowledgePipelineProfileSourceOptions } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import {
  KnowledgePluginProductionPreflightLifecycle,
  type KnowledgePluginProductionPreflightLifecycleDependencies,
  type KnowledgePluginProductionPreflightPort,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";

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

/** Creates sufficient static profile data for a fake preflight boundary. */
function createProfileOptions(): ProjectKnowledgePipelineProfileSourceOptions {
  return {
    compilerVersion: "knowledge-compiler-v1",
    compilerConfiguration: { protocolVersion: 1 },
    parsers: [
      {
        id: "knowledge-utf8-text",
        version: "1",
        pathSuffixes: [".md"],
        configuration: { encoding: "utf-8-fatal" },
      },
    ],
    outputLanguage: "source-language",
    supportedProviders: ["deepseek"],
    promptContractIdentity: "test-prompt-contract",
    providerRouteIdentities: { deepseek: "test-route-contract" },
  };
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
  return {
    preflight: jest.fn(() => (closed ? { kind: "diagnostic", code: "closed" } : result)),
    close: jest.fn(() => {
      closed = true;
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
    createResources: jest.fn(() => ({ profileOptions: createProfileOptions() })),
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
        return { profileOptions: createProfileOptions() };
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
    expect(fetchPort).not.toHaveBeenCalled();
    expect(candidate.close).not.toHaveBeenCalled();
    expect(() => lifecycle.assertCurrentAdmission(result.admission)).not.toThrow();
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
    const createResources = jest.fn(() => ({ profileOptions: createProfileOptions() }));
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
    await lifecycle.load(new AbortController().signal);

    lifecycle.close();
    lifecycle.close();

    expect(candidate.close).toHaveBeenCalledTimes(1);
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
