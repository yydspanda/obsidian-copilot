import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import {
  KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
  type KnowledgeDeepSeekFetchPort,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import {
  KnowledgeProductionPreflightComposer,
  type KnowledgeProductionPreflightComposerInput,
  type KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  ProjectKnowledgePipelineProfileError,
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProfileSourceOptions,
  type ProjectKnowledgePipelineProjectInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";

const PROJECT_ID = "project-personal";
const MODEL_NAME = "deepseek-flash";
const MODEL_KEY = `${MODEL_NAME}|deepseek`;
const MODEL_SECRET = "sk-model-secret-canary";
const PROVIDER_SECRET = "sk-provider-secret-canary";

/** Creates one caller-validated Bundle owner. */
function createOwner(
  bundleId = "personal",
  projectId = PROJECT_ID
): ConfiguredProjectKnowledgeBundle {
  const config: KnowledgeBundleConfig = {
    version: 1,
    id: bundleId,
    sourceRoots: [`Sources/${bundleId}`],
    wikiRoot: `Wiki/${bundleId}`,
    schemaRef: `Schemas/${bundleId}.md`,
    reviewMode: "always",
  };
  return { projectId, config };
}

/** Creates one project snapshot with an exact model selection. */
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

/** Creates one enabled model record including its optional private credential. */
function createModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: MODEL_NAME,
    provider: "deepseek",
    enabled: true,
    projectEnabled: true,
    temperature: 0,
    reasoningEffort: "high",
    apiKey: MODEL_SECRET,
    ...overrides,
  };
}

/** Creates one already hydrated settings snapshot. */
function createSettings(
  activeModels: readonly unknown[] = [createModel()],
  overrides: Partial<KnowledgeProductionPreflightSettingsInput> = {}
): KnowledgeProductionPreflightSettingsInput {
  return {
    temperature: 0,
    maxTokens: 8_192,
    reasoningEffort: "high",
    verbosity: "medium",
    activeModels,
    deepseekApiKey: PROVIDER_SECRET,
    ...overrides,
  };
}

/** Creates production static compiler, parser, prompt, and route behavior. */
function createProfileOptions(
  overrides: Partial<ProjectKnowledgePipelineProfileSourceOptions> = {}
): ProjectKnowledgePipelineProfileSourceOptions {
  return {
    compilerVersion: "knowledge-compiler-v1",
    compilerConfiguration: { protocolVersion: 1 },
    parsers: [
      {
        id: "markdown-utf8",
        version: "1",
        pathSuffixes: [".md"],
        configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
      },
    ],
    outputLanguage: "source-language",
    supportedProviders: ["deepseek"],
    promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
    providerRouteIdentities: {
      deepseek: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
    },
    ...overrides,
  };
}

/** Creates a fetch capability that makes any accidental preflight network use fail. */
function createFetchPort(): KnowledgeDeepSeekFetchPort {
  return jest.fn(async () => {
    throw new Error("Preflight must not invoke native fetch");
  });
}

/** Creates one complete production preflight input. */
function createInput(
  overrides: Partial<KnowledgeProductionPreflightComposerInput> = {}
): KnowledgeProductionPreflightComposerInput {
  return {
    owners: [createOwner()],
    projects: [createProject()],
    settings: createSettings(),
    profileOptions: createProfileOptions(),
    fetchPort: createFetchPort(),
    ...overrides,
  };
}

describe("KnowledgeProductionPreflightComposer", () => {
  it("constructs a private current-V4 route while performing zero network I/O", () => {
    const fetchPort = createFetchPort();
    const composer = new KnowledgeProductionPreflightComposer(createInput({ fetchPort }));

    const result = composer.preflight();

    expect(result).toEqual({ kind: "ready", bundleCount: 1 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchPort).not.toHaveBeenCalled();
    expect(Reflect.ownKeys(composer)).toEqual([]);
    expect(JSON.stringify(composer)).not.toContain(MODEL_SECRET);
    expect(JSON.stringify(result)).not.toContain(MODEL_SECRET);
    expect(JSON.stringify(result)).not.toContain(PROVIDER_SECRET);
  });

  it("retains routes only behind a close-incapable exact-Bundle lease", () => {
    const composer = new KnowledgeProductionPreflightComposer(createInput());
    const owner = composer.getModelRouteLeaseOwner();
    const lease = owner.getLease();

    expect(lease.isCurrent()).toBe(true);
    expect(lease.coversBundleIds(["personal"])).toBe(true);
    expect(lease.coversBundleIds(["other"])).toBe(false);
    expect(Reflect.ownKeys(lease)).toEqual([]);
    expect("close" in lease).toBe(false);
    expect(JSON.stringify({ lease })).not.toContain(MODEL_SECRET);
    expect(JSON.stringify({ lease })).not.toContain(PROVIDER_SECRET);

    composer.close();

    expect(lease.isCurrent()).toBe(false);
    expect(lease.coversBundleIds(["personal"])).toBe(false);
    expect(() => lease.assertCurrent()).toThrow("The operation was aborted");
    expect(() => composer.getModelRouteLeaseOwner()).toThrow(TypeError);
  });

  it("uses the exact selected model credential without reading the provider fallback", () => {
    let providerCredentialReads = 0;
    const settings = createSettings([createModel({ apiKey: MODEL_SECRET })]);
    Object.defineProperty(settings, "deepseekApiKey", {
      enumerable: true,
      configurable: true,
      get() {
        providerCredentialReads += 1;
        throw new Error("The provider fallback must remain unread");
      },
    });

    const composer = new KnowledgeProductionPreflightComposer(createInput({ settings }));

    expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
    expect(providerCredentialReads).toBe(0);
  });

  it("falls back to the hydrated provider credential only for an absent or empty model key", () => {
    for (const modelCredential of [undefined, ""] as const) {
      const model = createModel();
      if (modelCredential === undefined) {
        delete model.apiKey;
      } else {
        model.apiKey = modelCredential;
      }
      const fetchPort = createFetchPort();
      const composer = new KnowledgeProductionPreflightComposer(
        createInput({ settings: createSettings([model]), fetchPort })
      );

      expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
      expect(fetchPort).not.toHaveBeenCalled();
    }
  });

  it("https://github.com/yydspanda/obsidian-copilot/issues/3 uses the credential on a persisted Flash alias after the profile becomes canonical", () => {
    const fetchPort = createFetchPort();
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({
        projects: [createProject({ projectModelKey: "deepseek-v4-flash|deepseek" })],
        settings: createSettings([
          createModel({ name: "deepseek-v4-flash", apiKey: MODEL_SECRET }),
        ]),
        fetchPort,
      })
    );

    expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("does not hide an invalid selected model key behind a valid provider fallback", () => {
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ settings: createSettings([createModel({ apiKey: " invalid " })]) })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "route_credential_invalid",
    });
  });

  it("rejects credential accessors without invoking them or exposing their value", () => {
    let credentialReads = 0;
    const model = createModel();
    Object.defineProperty(model, "apiKey", {
      enumerable: true,
      configurable: true,
      get() {
        credentialReads += 1;
        return MODEL_SECRET;
      },
    });
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ settings: createSettings([model]) })
    );

    const result = composer.preflight();

    expect(result).toEqual({ kind: "diagnostic", code: "route_credential_invalid" });
    expect(credentialReads).toBe(0);
    expect(JSON.stringify(result)).not.toContain(MODEL_SECRET);
  });

  it.each([
    ["deepseek-chat", "profile_model_unsupported"],
    ["deepseek-reasoner", "profile_model_unsupported"],
  ] as const)("rejects retired model identity %s without fallback", (name, code) => {
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({
        projects: [createProject({ projectModelKey: `${name}|deepseek` })],
        settings: createSettings([createModel({ name })]),
      })
    );

    expect(composer.preflight()).toEqual({ kind: "diagnostic", code });
  });

  it("rejects a non-DeepSeek profile even when the generic profile source supports it", () => {
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({
        projects: [createProject({ projectModelKey: "other-model|openai" })],
        settings: createSettings([
          createModel({ name: "other-model", provider: "openai", reasoningEffort: "minimal" }),
        ]),
        profileOptions: createProfileOptions({
          supportedProviders: ["openai"],
          providerRouteIdentities: { openai: "a".repeat(64) },
        }),
      })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "model_unsupported",
    });
  });

  it("validates the static prompt-to-route contract before reporting ready", () => {
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({
        profileOptions: createProfileOptions({
          providerRouteIdentities: { deepseek: "b".repeat(64) },
        }),
      })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "route_configuration_unsupported",
    });
  });

  it("composes every strict owner but rejects a duplicate Bundle generation", () => {
    const fetchPort = createFetchPort();
    const ready = new KnowledgeProductionPreflightComposer(
      createInput({ owners: [createOwner("first"), createOwner("second")], fetchPort })
    );
    const duplicate = new KnowledgeProductionPreflightComposer(
      createInput({ owners: [createOwner("same"), createOwner("same")] })
    );

    expect(ready.preflight()).toEqual({ kind: "ready", bundleCount: 2 });
    expect(duplicate.preflight()).toEqual({
      kind: "diagnostic",
      code: "bundle_duplicate",
    });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("captures one generation eagerly and ignores later input mutation", () => {
    const model = createModel();
    const project = createProject();
    const settings = createSettings([model]);
    const input = createInput({ projects: [project], settings });
    const composer = new KnowledgeProductionPreflightComposer(input);

    model.apiKey = " invalid ";
    project.projectModelKey = "deepseek-chat|deepseek";
    settings.deepseekApiKey = "";

    expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
    expect(input.fetchPort).not.toHaveBeenCalled();
  });

  it("uses the exact explicitly supplied profile source when it matches the input snapshot", () => {
    const owners = [createOwner()];
    const projects = [createProject()];
    const settings = createSettings();
    const profileOptions = createProfileOptions();
    const source = new ProjectKnowledgePipelineProfileSource(projects, settings, profileOptions);
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({
        owners,
        projects,
        settings,
        profileOptions,
        profileSource: source,
      })
    );

    expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
  });

  it("rejects an authentic shared profile source from a different input snapshot", () => {
    const fetchPort = createFetchPort();
    const source = new ProjectKnowledgePipelineProfileSource(
      [createProject()],
      createSettings(),
      createProfileOptions({ outputLanguage: "different-language" })
    );
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ profileSource: source, fetchPort })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "input_invalid",
    });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("resolves an authentic subclass through the frozen base authority method", () => {
    let overrideCalls = 0;
    class OverridingProfileSource extends ProjectKnowledgePipelineProfileSource {
      /** Must not replace the authentic base resolution boundary. */
      override resolve(owner: ConfiguredProjectKnowledgeBundle) {
        overrideCalls += 1;
        return super.resolve(owner);
      }
    }
    const projects = [createProject()];
    const settings = createSettings();
    const profileOptions = createProfileOptions();
    const source = new OverridingProfileSource(projects, settings, profileOptions);
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ projects, settings, profileOptions, profileSource: source })
    );

    expect(composer.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
    expect(overrideCalls).toBe(0);
  });

  it("does not trust or read a forged profile-error code thrown by an input proxy", () => {
    let codeReads = 0;
    const forged: Error = new TypeError("forged profile error");
    Object.setPrototypeOf(forged, ProjectKnowledgePipelineProfileError.prototype);
    Object.defineProperty(forged, "code", {
      enumerable: true,
      get() {
        codeReads += 1;
        return MODEL_SECRET;
      },
    });
    const modelConfigs = new Proxy(
      {},
      {
        ownKeys() {
          throw forged;
        },
      }
    );
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ projects: [createProject({ modelConfigs })] })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "profile_input_invalid",
    });
    expect(codeReads).toBe(0);
    expect(() =>
      Reflect.construct(ProjectKnowledgePipelineProfileError, [
        Symbol("forged-profile-error"),
        "endpoint_invalid",
      ])
    ).toThrow(TypeError);
  });

  it("synchronously closes idempotently and stays failed closed", () => {
    const fetchPort = createFetchPort();
    const composer = new KnowledgeProductionPreflightComposer(createInput({ fetchPort }));

    composer.close();
    composer.close();

    const result = composer.preflight();
    expect(result).toEqual({ kind: "diagnostic", code: "closed" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("fails closed on a missing native fetch capability without throwing", () => {
    const composer = new KnowledgeProductionPreflightComposer(
      createInput({ fetchPort: null as never })
    );

    expect(composer.preflight()).toEqual({
      kind: "diagnostic",
      code: "route_dependency_invalid",
    });
  });
});
