import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  KNOWLEDGE_MODEL_BEHAVIOR_CONTRACT_VERSION,
  KNOWLEDGE_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION,
  ProjectKnowledgePipelineProfileError,
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProfileErrorCode,
  type ProjectKnowledgePipelineProfileSourceOptions,
  type ProjectKnowledgePipelineProjectInput,
  type ProjectKnowledgePipelineSettingsInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import {
  buildKnowledgeSourceWatchPlan,
  type KnowledgeBundlePipelineProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";

const PROJECT_ID = "project-a";
const BUNDLE_ID = "bundle-a";
const MODEL_NAME = "test-model";
const PROVIDER = "test-provider";
const MODEL_KEY = `${MODEL_NAME}|${PROVIDER}`;
const PROMPT_CONTRACT_IDENTITY = "a".repeat(64);
const DEEPSEEK_ROUTE_IDENTITY = "b".repeat(64);
const OPENAI_ROUTE_IDENTITY = "c".repeat(64);
const OLLAMA_ROUTE_IDENTITY = "d".repeat(64);

/** Creates one strict Bundle owned by the default test project. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  const config: KnowledgeBundleConfig = {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources/Bundle A"],
    wikiRoot: "Wiki/Bundle A",
    schemaRef: "Schemas/Bundle A.md",
    reviewMode: "always",
  };
  return { projectId: PROJECT_ID, config };
}

/** Creates one plain project snapshot with an exact model key. */
function createProject(
  overrides: Partial<ProjectKnowledgePipelineProjectInput> = {}
): ProjectKnowledgePipelineProjectInput {
  return {
    id: PROJECT_ID,
    projectModelKey: MODEL_KEY,
    modelConfigs: {},
    ...overrides,
  };
}

/** Creates one active-model record while permitting ignored provider extras. */
function createModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: MODEL_NAME,
    provider: PROVIDER,
    enabled: true,
    projectEnabled: true,
    ...overrides,
  };
}

/** Creates the narrow settings generation consumed by the profile source. */
function createSettings(
  activeModels: readonly unknown[] = [createModel()],
  overrides: Partial<ProjectKnowledgePipelineSettingsInput> = {}
): ProjectKnowledgePipelineSettingsInput {
  return {
    temperature: 0.2,
    maxTokens: 4096,
    reasoningEffort: "medium",
    verbosity: "medium",
    activeModels,
    ...overrides,
  };
}

/** Creates stable compiler, parser, language, and provider behavior. */
function createOptions(
  overrides: Partial<ProjectKnowledgePipelineProfileSourceOptions> = {}
): ProjectKnowledgePipelineProfileSourceOptions {
  return {
    compilerVersion: "knowledge-compiler-v1",
    compilerConfiguration: {
      protocolVersion: 1,
      maxModelContextCharacters: 8_000_000,
    },
    parsers: [
      {
        id: "markdown-utf8",
        version: "1",
        pathSuffixes: [".md"],
        configuration: {
          encoding: "utf-8-fatal",
          bomPolicy: "consume",
        },
      },
    ],
    outputLanguage: "source-language",
    supportedProviders: [PROVIDER, "openai", "ollama"],
    promptContractIdentity: PROMPT_CONTRACT_IDENTITY,
    providerRouteIdentities: {
      [PROVIDER]: DEEPSEEK_ROUTE_IDENTITY,
      openai: OPENAI_ROUTE_IDENTITY,
      ollama: OLLAMA_ROUTE_IDENTITY,
    },
    ...overrides,
  };
}

/** Resolves a profile from independently replaceable plain snapshots. */
function resolveProfile(
  options: {
    project?: ProjectKnowledgePipelineProjectInput;
    settings?: ProjectKnowledgePipelineSettingsInput;
    sourceOptions?: ProjectKnowledgePipelineProfileSourceOptions;
    owner?: ConfiguredProjectKnowledgeBundle;
  } = {}
): KnowledgeBundlePipelineProfile {
  const source = new ProjectKnowledgePipelineProfileSource(
    [options.project ?? createProject()],
    options.settings ?? createSettings(),
    options.sourceOptions ?? createOptions()
  );
  return source.resolve(options.owner ?? createOwner());
}

/** Captures and verifies one sanitized profile-source failure. */
function expectProfileError(
  action: () => unknown,
  code: ProjectKnowledgePipelineProfileErrorCode
): ProjectKnowledgePipelineProfileError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProjectKnowledgePipelineProfileError);
  const failure = caught as ProjectKnowledgePipelineProfileError;
  expect(failure.code).toBe(code);
  expect(failure.message).toBe("The project knowledge pipeline profile is invalid");
  return failure;
}

/** Computes the production pipeline-profile digest for one resolved profile. */
function createProfileDigest(profile: KnowledgeBundlePipelineProfile): string {
  const owner = createOwner();
  const manifest: SourceManifest = {
    version: 1,
    bundleId: owner.config.id,
    revision: 0,
    entries: [],
  };
  const plan = buildKnowledgeSourceWatchPlan([
    {
      bundle: owner.config,
      manifest,
      schema: {
        path: owner.config.schemaRef,
        bytes: new TextEncoder().encode("# Knowledge schema\n"),
      },
      pipeline: profile,
    },
  ]);
  const authority = plan.getBundleAuthority(owner.config.id);
  if (!authority) throw new Error("Expected Bundle watch authority");
  return authority.pipelineProfileDigest;
}

describe("ProjectKnowledgePipelineProfileSource", () => {
  it("selects only the exact project model and applies project overrides", () => {
    const profile = resolveProfile({
      project: createProject({ modelConfigs: { temperature: 0.15, maxTokens: 8192 } }),
      settings: createSettings([
        createModel({ name: "other-model", provider: PROVIDER, temperature: 0.99 }),
        createModel({
          temperature: 0.4,
          maxTokens: 2048,
          topP: 0.8,
          frequencyPenalty: 0.1,
          reasoningEffort: "high",
          verbosity: "low",
        }),
      ]),
    });

    expect(profile.model).toEqual({
      provider: PROVIDER,
      model: MODEL_NAME,
      configuration: {
        behaviorContractVersion: KNOWLEDGE_MODEL_BEHAVIOR_CONTRACT_VERSION,
        routeContractVersion: KNOWLEDGE_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION,
        promptContractIdentity: PROMPT_CONTRACT_IDENTITY,
        providerRouteIdentity: DEEPSEEK_ROUTE_IDENTITY,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-object-core-schema-v1",
        streaming: false,
        modelFallback: false,
        temperature: 0.15,
        maxTokens: 8192,
        reasoningEffort: "high",
        verbosity: "low",
        topP: 0.8,
        frequencyPenalty: 0.1,
      },
    });
    expect(profile.bundleId).toBe(BUNDLE_ID);
  });

  it("does not fall back to another enabled project model", () => {
    const project = createProject({
      projectModelKey: "missing-model|deepseek",
    });
    const settings = createSettings([
      createModel({ name: "fallback-model", enabled: true, projectEnabled: true }),
    ]);

    expectProfileError(() => resolveProfile({ project, settings }), "model_missing");
  });

  it("ignores behavior fields on models not selected by any captured project", () => {
    let getterCalls = 0;
    const unrelated = createModel({ name: "unrelated-model", numCtx: 0 });
    Object.defineProperty(unrelated, "topP", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return Number.NaN;
      },
    });

    const profile = resolveProfile({ settings: createSettings([unrelated, createModel()]) });

    expect(profile.model.model).toBe(MODEL_NAME);
    expect(getterCalls).toBe(0);
  });

  it("keeps the selected profile and digest stable across model reordering and unrelated additions", () => {
    const selected = createModel({ temperature: 0.35, maxTokens: 6144 });
    const unrelatedOpenAI = createModel({
      name: "unrelated-openai",
      provider: "openai",
      temperature: 0.91,
    });
    const unrelatedLocal = createModel({
      name: "unrelated-local",
      provider: "ollama",
      numCtx: 32768,
    });
    const baseline = resolveProfile({
      settings: createSettings([unrelatedOpenAI, selected, unrelatedLocal]),
    });
    const reordered = resolveProfile({
      settings: createSettings([unrelatedLocal, unrelatedOpenAI, selected]),
    });
    const withUnrelatedAddition = resolveProfile({
      settings: createSettings([
        createModel({
          name: "unrelated-new-provider-model",
          provider: "unrelated-provider",
          topP: 0.01,
        }),
        unrelatedLocal,
        selected,
        unrelatedOpenAI,
      ]),
    });

    expect(reordered).toEqual(baseline);
    expect(withUnrelatedAddition).toEqual(baseline);
    expect(createProfileDigest(reordered)).toBe(createProfileDigest(baseline));
    expect(createProfileDigest(withUnrelatedAddition)).toBe(createProfileDigest(baseline));
  });

  it("rejects more than 10,000 active models before reading any model element", () => {
    let modelGetterCalls = 0;
    const activeModels = new Array<unknown>(10_001);
    Object.defineProperty(activeModels, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        modelGetterCalls += 1;
        return createModel();
      },
    });

    expectProfileError(
      () => resolveProfile({ settings: createSettings(activeModels) }),
      "input_invalid"
    );
    expect(modelGetterCalls).toBe(0);
  });

  it("fails closed when the exact model is disabled even if a fallback is eligible", () => {
    const settings = createSettings([
      createModel({ enabled: false }),
      createModel({ name: "fallback-model", enabled: true, projectEnabled: true }),
    ]);

    expectProfileError(() => resolveProfile({ settings }), "model_disabled");
  });

  it("fails closed when the exact model is not enabled for projects", () => {
    const settings = createSettings([createModel({ projectEnabled: false })]);

    expectProfileError(() => resolveProfile({ settings }), "model_not_project_enabled");
  });

  it("rejects duplicate exact model identities", () => {
    const settings = createSettings([createModel(), createModel({ temperature: 0.7 })]);

    expectProfileError(() => resolveProfile({ settings }), "model_ambiguous");
  });

  it("rejects an exact model whose provider is outside the production allowlist", () => {
    const provider = "unsupported-provider";
    const project = createProject({ projectModelKey: `${MODEL_NAME}|${provider}` });
    const settings = createSettings([createModel({ provider })]);

    expectProfileError(() => resolveProfile({ project, settings }), "provider_unsupported");
  });

  it("ignores unknown model extras without touching a secret getter or retaining canaries", () => {
    const secretCanary = "secret-canary-17d5";
    const unknownCanary = "unknown-extra-canary-82b1";
    let apiKeyReads = 0;
    const model = createModel({ unknownProviderField: unknownCanary });
    Object.defineProperty(model, "apiKey", {
      enumerable: true,
      configurable: true,
      get: () => {
        apiKeyReads += 1;
        return secretCanary;
      },
    });

    const profile = resolveProfile({ settings: createSettings([model]) });
    const serialized = JSON.stringify(profile);

    expect(apiKeyReads).toBe(0);
    expect(serialized).not.toContain(secretCanary);
    expect(serialized).not.toContain(unknownCanary);
    expect(Object.keys(profile.model.configuration as Record<string, unknown>)).toEqual([
      "behaviorContractVersion",
      "routeContractVersion",
      "promptContractIdentity",
      "providerRouteIdentity",
      "adapterPolicy",
      "routingPolicy",
      "structuredOutput",
      "streaming",
      "modelFallback",
      "temperature",
      "maxTokens",
      "reasoningEffort",
      "verbosity",
    ]);
  });

  it("captures immutable opaque state that cannot be changed through original inputs", () => {
    const project = createProject();
    const model = createModel();
    const settings = createSettings([model]);
    const sourceOptions = createOptions();
    const source = new ProjectKnowledgePipelineProfileSource([project], settings, sourceOptions);
    const baseline = source.resolve(createOwner());

    project.projectModelKey = "missing|deepseek";
    model.temperature = 0.99;
    settings.temperature = 0.88;
    sourceOptions.compilerVersion = "mutated-compiler";

    expect(source.resolve(createOwner())).toEqual(baseline);
    expect(Reflect.ownKeys(source)).toEqual([]);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(ProjectKnowledgePipelineProfileSource)).toBe(true);
    expect(Object.isFrozen(ProjectKnowledgePipelineProfileSource.prototype)).toBe(true);

    const forged = Object.create(
      ProjectKnowledgePipelineProfileSource.prototype
    ) as ProjectKnowledgePipelineProfileSource;
    expectProfileError(() => forged.resolve(createOwner()), "input_invalid");
  });

  it("sanitizes proxy descriptor failures without leaking their message", () => {
    const canary = "proxy-secret-canary";
    const model = new Proxy(createModel(), {
      getOwnPropertyDescriptor: () => {
        throw new Error(canary);
      },
    });

    const failure = expectProfileError(
      () => resolveProfile({ settings: createSettings([model]) }),
      "input_invalid"
    );
    expect(JSON.stringify(failure)).not.toContain(canary);
  });

  it.each([
    ["userinfo", "https://user:secret-canary@example.com/v1"],
    ["query", "https://example.com/v1?api_key=secret-canary"],
    ["fragment", "https://example.com/v1#secret-canary"],
  ])("rejects endpoint %s credentials without retaining their value", (_name, baseUrl) => {
    const settings = createSettings([createModel({ baseUrl })]);

    const failure = expectProfileError(() => resolveProfile({ settings }), "endpoint_invalid");
    expect(JSON.stringify(failure)).not.toContain("secret-canary");
  });

  it.each([
    ["temperature", { temperature: 0.75 }],
    ["maxTokens", { maxTokens: 16384 }],
    ["topP", { topP: 0.7 }],
    ["frequencyPenalty", { frequencyPenalty: 0.25 }],
    ["numCtx", { numCtx: 32768 }],
    ["useResponsesApi", { useResponsesApi: true }],
    ["enablePromptCaching", { enablePromptCaching: false }],
    ["reasoningEffort", { reasoningEffort: "high" }],
    ["verbosity", { verbosity: "high" }],
    ["endpoint", { baseUrl: "https://api.example.com/v2" }],
    ["routing", { bedrockRegion: "ap-southeast-1" }],
  ] satisfies readonly [string, Record<string, unknown>][])(
    "%s changes both the projected behavior and production profile digest",
    (_name, override) => {
      const baseline = resolveProfile();
      const changed = resolveProfile({ settings: createSettings([createModel(override)]) });

      expect(changed.model.configuration).not.toEqual(baseline.model.configuration);
      expect(createProfileDigest(changed)).not.toBe(createProfileDigest(baseline));
    }
  );

  it("binds prompt and provider-route contract identities into the profile digest", () => {
    const baseline = resolveProfile();
    const promptChanged = resolveProfile({
      sourceOptions: createOptions({ promptContractIdentity: "e".repeat(64) }),
    });
    const routeChanged = resolveProfile({
      sourceOptions: createOptions({
        providerRouteIdentities: {
          [PROVIDER]: "f".repeat(64),
          openai: OPENAI_ROUTE_IDENTITY,
          ollama: OLLAMA_ROUTE_IDENTITY,
        },
      }),
    });

    expect(createProfileDigest(promptChanged)).not.toBe(createProfileDigest(baseline));
    expect(createProfileDigest(routeChanged)).not.toBe(createProfileDigest(baseline));
  });

  it("requires one valid provider-route identity for every allowed provider", () => {
    expectProfileError(
      () =>
        resolveProfile({
          sourceOptions: createOptions({
            providerRouteIdentities: { [PROVIDER]: DEEPSEEK_ROUTE_IDENTITY },
          }),
        }),
      "input_invalid"
    );
  });

  it("rejects accessors on an allowlisted model field without invoking them", () => {
    let reads = 0;
    const model = createModel();
    Object.defineProperty(model, "topP", {
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        return 0.5;
      },
    });

    expectProfileError(
      () => resolveProfile({ settings: createSettings([model]) }),
      "model_behavior_invalid"
    );
    expect(reads).toBe(0);
  });

  it.each([
    ["temperature", "hot"],
    ["maxTokens", 0],
    ["topP", Number.NaN],
    ["frequencyPenalty", Number.POSITIVE_INFINITY],
    ["numCtx", 1.5],
    ["useResponsesApi", "true"],
    ["enablePromptCaching", 1],
    ["reasoningEffort", "extreme"],
    ["verbosity", "verbose"],
    ["bedrockRegion", " ap-southeast-1 "],
  ])("rejects invalid allowlisted behavior field %s", (key, value) => {
    const settings = createSettings([createModel({ [key]: value })]);

    expectProfileError(() => resolveProfile({ settings }), "model_behavior_invalid");
  });

  it("rejects extra project model override fields", () => {
    const project = createProject({
      modelConfigs: {
        temperature: 0.2,
        maxTokens: 4096,
        apiKey: "project-secret-canary",
      },
    });

    const failure = expectProfileError(() => resolveProfile({ project }), "input_invalid");
    expect(JSON.stringify(failure)).not.toContain("project-secret-canary");
  });

  it.each(["compiler", "parser"] as const)(
    "rejects credential-like fields in trusted %s options without retaining their value",
    (target) => {
      const canary = "static-option-secret-canary";
      const sourceOptions =
        target === "compiler"
          ? createOptions({ compilerConfiguration: { apiKey: canary } })
          : createOptions({
              parsers: [
                {
                  id: "markdown-utf8",
                  version: "1",
                  pathSuffixes: [".md"],
                  configuration: { authorization: canary },
                },
              ],
            });

      const failure = expectProfileError(() => resolveProfile({ sourceOptions }), "input_invalid");
      expect(JSON.stringify(failure)).not.toContain(canary);
    }
  );

  describe("DeepSeek production behavior", () => {
    /** Resolves one direct DeepSeek profile through the production allowlist. */
    function resolveDeepSeekProfile(
      modelOverrides: Record<string, unknown> = {},
      projectOverrides: Partial<ProjectKnowledgePipelineProjectInput> = {}
    ): KnowledgeBundlePipelineProfile {
      const modelName = (modelOverrides.name as string | undefined) ?? "deepseek-flash";
      return resolveProfile({
        project: createProject({
          projectModelKey: `${modelName}|deepseek`,
          ...projectOverrides,
        }),
        settings: createSettings(
          [
            createModel({
              name: modelName,
              provider: "deepseek",
              reasoningEffort: "minimal",
              ...modelOverrides,
            }),
          ],
          { reasoningEffort: "minimal" }
        ),
        sourceOptions: createOptions({
          supportedProviders: ["deepseek"],
          providerRouteIdentities: { deepseek: DEEPSEEK_ROUTE_IDENTITY },
        }),
      });
    }

    it("accepts explicit non-thinking sampling for the current V4.1 Flash model", () => {
      expect(
        resolveDeepSeekProfile({ temperature: 0.2, topP: 0.8 }).model.configuration
      ).toMatchObject({
        temperature: 0.2,
        topP: 0.8,
        reasoningEffort: "minimal",
      });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 gives persisted and canonical Flash identities the same profile and fingerprint", () => {
      const canonical = resolveDeepSeekProfile();
      const persistedAlias = resolveDeepSeekProfile({ name: "deepseek-v4-flash" });

      expect(persistedAlias).toEqual(canonical);
      expect(createProfileDigest(persistedAlias)).toBe(createProfileDigest(canonical));
    });

    it("accepts explicit thinking only with the zero placeholder and no top-p", () => {
      expect(
        resolveDeepSeekProfile({
          name: "deepseek-flash",
          reasoningEffort: "high",
          temperature: 0,
        }).model.configuration
      ).toMatchObject({
        temperature: 0,
        reasoningEffort: "high",
      });
    });

    it("normalizes a stale project temperature after the selected model enables thinking", () => {
      expect(
        resolveDeepSeekProfile(
          {
            name: "deepseek-flash",
            reasoningEffort: "high",
            temperature: 0,
          },
          { modelConfigs: { temperature: 0.1 } }
        ).model.configuration
      ).toMatchObject({
        temperature: 0,
        reasoningEffort: "high",
      });
    });

    it("does not let a project override hide an invalid thinking-model temperature", () => {
      expectProfileError(
        () =>
          resolveDeepSeekProfile(
            {
              name: "deepseek-flash",
              reasoningEffort: "high",
              temperature: 0.1,
            },
            { modelConfigs: { temperature: 0.1 } }
          ),
        "configuration_unsupported"
      );
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects V4 Pro before route construction", () => {
      expectProfileError(
        () => resolveDeepSeekProfile({ name: "deepseek-v4-pro" }),
        "model_unsupported"
      );
    });

    it.each([
      [{ name: "deepseek-chat" }, "model_unsupported"],
      [{ reasoningEffort: "low", temperature: 0 }, "configuration_unsupported"],
      [{ reasoningEffort: "medium", temperature: 0 }, "configuration_unsupported"],
      [{ reasoningEffort: "high", temperature: 0.1 }, "configuration_unsupported"],
      [{ reasoningEffort: "high", temperature: 0, topP: 0.8 }, "configuration_unsupported"],
      [{ frequencyPenalty: 0 }, "configuration_unsupported"],
      [{ numCtx: 32768 }, "configuration_unsupported"],
      [{ useResponsesApi: false }, "configuration_unsupported"],
      [{ enablePromptCaching: false }, "configuration_unsupported"],
      [{ bedrockRegion: "ap-southeast-1" }, "configuration_unsupported"],
      [{ baseUrl: "https://example.com" }, "endpoint_invalid"],
    ] satisfies readonly [Record<string, unknown>, ProjectKnowledgePipelineProfileErrorCode][])(
      "rejects unsupported direct configuration %# before route construction",
      (override, code) => {
        expectProfileError(() => resolveDeepSeekProfile(override), code);
      }
    );
  });
});
