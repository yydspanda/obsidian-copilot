import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import {
  createKnowledgeConfiguredModelProjection,
  KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS,
  prepareKnowledgeConfiguredModelPreflight,
  type KnowledgeConfiguredModelProjectionInput,
  type KnowledgeConfiguredModelProjectInput,
  type PrepareKnowledgeConfiguredModelPreflightInput,
} from "@/knowledge/compiler/KnowledgeConfiguredModelBridge";
import {
  KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
  type KnowledgeDeepSeekFetchPort,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { ProjectKnowledgePipelineProfileSourceOptions } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import type { Provider, ResolvedChatBackendEntry } from "@/modelManagement";

const FLASH = "deepseek-flash";
const LEGACY_FLASH = "deepseek-v4-flash";
const PRO = "deepseek-v4-pro";
const PROJECT_ID = "project-a";
const BUNDLE_ID = "bundle-a";
const CREDENTIAL = "sk-private-canary";

function createOwner(
  projectId = PROJECT_ID,
  bundleId = BUNDLE_ID
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

function createProject(
  modelSelection = "configured-flash",
  overrides: Partial<KnowledgeConfiguredModelProjectInput> = {}
): KnowledgeConfiguredModelProjectInput {
  return {
    id: PROJECT_ID,
    modelSelection,
    modelConfigs: {},
    ...overrides,
  };
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "provider-deepseek",
    providerType: "openai-compatible",
    displayName: "DeepSeek account",
    baseUrl: "https://api.deepseek.com",
    apiKeyKeychainId: "keychain-pointer-canary",
    requiresApiKey: true,
    origin: { kind: "byok", catalogProviderId: "deepseek" },
    addedAt: 1,
    ...overrides,
  };
}

function createEntry(
  model = FLASH,
  configuredModelId = "configured-flash",
  providerOverrides: Partial<Provider> = {}
): ResolvedChatBackendEntry {
  const provider = createProvider(providerOverrides);
  return {
    configuredModelId,
    state: "ok",
    provider,
    configuredModel: {
      configuredModelId,
      providerId: provider.providerId,
      info: { id: model, displayName: model },
      configuredAt: 1,
    },
  };
}

function createInventory(
  enabledEntries: readonly ResolvedChatBackendEntry[],
  retainedEntries: readonly ResolvedChatBackendEntry[] = []
): Pick<KnowledgeConfiguredModelProjectionInput, "configuredModels" | "providers"> {
  const entries = [...enabledEntries, ...retainedEntries];
  const providers = new Map(entries.map((entry) => [entry.provider.providerId, entry.provider]));
  return {
    configuredModels: entries.map((entry) => entry.configuredModel),
    providers: [...providers.values()],
  };
}

function projectConfiguredModels(
  input: Omit<KnowledgeConfiguredModelProjectionInput, "configuredModels" | "providers"> &
    Partial<Pick<KnowledgeConfiguredModelProjectionInput, "configuredModels" | "providers">>
) {
  const enabledEntries = input.enabledChatModels.filter(
    (entry): entry is ResolvedChatBackendEntry => entry.state === "ok"
  );
  return createKnowledgeConfiguredModelProjection({
    ...createInventory(enabledEntries),
    ...input,
  });
}

function createProfileOptions(): ProjectKnowledgePipelineProfileSourceOptions {
  return {
    compilerVersion: "knowledge-compiler-v2",
    compilerConfiguration: { protocolVersion: 1 },
    parsers: [
      {
        id: "markdown-utf8",
        version: "1",
        pathSuffixes: [".md"],
        configuration: { encoding: "utf-8-fatal" },
      },
    ],
    outputLanguage: "source-language",
    supportedProviders: ["deepseek"],
    promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
    providerRouteIdentities: {
      deepseek: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
    },
  };
}

function createModelManagement(
  entries: readonly ResolvedChatBackendEntry[],
  credential: string | null | Error = CREDENTIAL,
  retainedEntries: readonly ResolvedChatBackendEntry[] = []
): {
  api: PrepareKnowledgeConfiguredModelPreflightInput["modelManagement"];
  resolveEnabled: jest.Mock;
  getApiKey: jest.Mock;
} {
  const resolveEnabled = jest.fn(() => entries);
  const getApiKey =
    credential instanceof Error
      ? jest.fn().mockRejectedValue(credential)
      : jest.fn().mockResolvedValue(credential);
  const inventory = createInventory(entries, retainedEntries);
  return {
    api: {
      backendConfigRegistry: { resolveEnabled },
      configuredModelRegistry: { list: () => inventory.configuredModels },
      providerRegistry: { list: () => inventory.providers, getApiKey },
    } as unknown as PrepareKnowledgeConfiguredModelPreflightInput["modelManagement"],
    resolveEnabled,
    getApiKey,
  };
}

function createPrepareInput(
  modelManagement: PrepareKnowledgeConfiguredModelPreflightInput["modelManagement"],
  overrides: Partial<PrepareKnowledgeConfiguredModelPreflightInput> = {}
): PrepareKnowledgeConfiguredModelPreflightInput {
  return {
    owners: [createOwner()],
    projects: [createProject()],
    modelManagement,
    profileOptions: createProfileOptions(),
    fetchPort: jest.fn() as KnowledgeDeepSeekFetchPort,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("KnowledgeConfiguredModelBridge", () => {
  describe("createKnowledgeConfiguredModelProjection()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 projects canonical and persisted Flash identities to the same defaults without provider secrets", () => {
      const owners = [
        createOwner("project-flash", "bundle-flash"),
        createOwner("project-legacy-flash", "bundle-legacy-flash"),
      ];
      const result = projectConfiguredModels({
        owners,
        projects: [
          createProject("configured-flash", { id: "project-flash" }),
          createProject("configured-legacy-flash", { id: "project-legacy-flash" }),
        ],
        enabledChatModels: [
          createEntry(FLASH, "configured-flash"),
          createEntry(LEGACY_FLASH, "configured-legacy-flash"),
        ],
        profileOptions: createProfileOptions(),
      });

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") return;
      const flash = result.projection.profileSource.resolve(owners[0]);
      const legacyFlash = result.projection.profileSource.resolve(owners[1]);
      expect(flash.model.configuration).toMatchObject({
        temperature: 0.1,
        maxTokens: 6_000,
        reasoningEffort: "minimal",
        verbosity: "medium",
        modelFallback: false,
      });
      expect(legacyFlash.model).toEqual(flash.model);
      expect(legacyFlash.model.configuration).toMatchObject({
        temperature: 0.1,
        maxTokens: 6_000,
        reasoningEffort: "minimal",
        verbosity: "medium",
        modelFallback: false,
      });
      expect(KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.maxTokens).toBe(6_000);
      expect(JSON.stringify(result)).not.toContain("keychain-pointer-canary");
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    });

    it("never replaces a missing Project selection with the first enabled model (https://github.com/logancyang/obsidian-copilot-preview/issues/310)", () => {
      const result = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject("missing-configured-id")],
        enabledChatModels: [createEntry()],
        profileOptions: createProfileOptions(),
      });

      expect(result).toEqual({ kind: "diagnostic", code: "model_missing" });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 resolves a configured id exactly while keeping different-provider legacy matches ambiguous", () => {
      const first = createEntry(FLASH, "configured-first", {
        providerId: "provider-first",
      });
      const second = createEntry(FLASH, "configured-second", {
        providerId: "provider-second",
      });
      const exact = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject("configured-second")],
        enabledChatModels: [first, second],
        profileOptions: createProfileOptions(),
      });
      const legacy = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject(`${FLASH}|deepseek`)],
        enabledChatModels: [first, second],
        profileOptions: createProfileOptions(),
      });

      expect(exact.kind).toBe("ready");
      if (exact.kind === "ready") {
        expect(exact.projection.credentialBindings).toEqual([
          { activeModelIndex: 0, providerId: "provider-second" },
        ]);
      }
      expect(legacy).toEqual({ kind: "diagnostic", code: "model_ambiguous" });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 keeps a disabled Project model owner from being replaced by an enabled account", () => {
      const disabledOwner = createEntry(LEGACY_FLASH, "disabled-owner", {
        providerId: "provider-disabled",
      });
      const enabledOtherAccount = createEntry(FLASH, "enabled-other", {
        providerId: "provider-enabled",
      });
      const result = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject(`${LEGACY_FLASH}|deepseek`)],
        enabledChatModels: [enabledOtherAccount],
        ...createInventory([enabledOtherAccount], [disabledOwner]),
        profileOptions: createProfileOptions(),
      });

      expect(result).toEqual({ kind: "diagnostic", code: "model_ambiguous" });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects a projection that omits its retained provider inventory", () => {
      const result = createKnowledgeConfiguredModelProjection({
        owners: [createOwner()],
        projects: [createProject()],
        enabledChatModels: [createEntry()],
        configuredModels: undefined as unknown as readonly never[],
        providers: [],
        profileOptions: createProfileOptions(),
      });

      expect(result).toEqual({ kind: "diagnostic", code: "input_invalid" });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 resolves a persisted Flash Project key against a canonical configured row", () => {
      const owner = createOwner();
      const result = projectConfiguredModels({
        owners: [owner],
        projects: [createProject(`${LEGACY_FLASH}|deepseek`)],
        enabledChatModels: [createEntry(FLASH, "configured-flash")],
        profileOptions: createProfileOptions(),
      });

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") return;
      expect(result.projection.profileSource.resolve(owner).model.model).toBe(FLASH);
    });

    it("applies Project sampling and output overrides to canonical Flash", () => {
      const owner = createOwner();
      const result = projectConfiguredModels({
        owners: [owner],
        projects: [
          createProject("configured-flash", {
            modelConfigs: { temperature: 0.7, maxTokens: 8_192 },
          }),
        ],
        enabledChatModels: [createEntry(FLASH, "configured-flash")],
        profileOptions: createProfileOptions(),
      });

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") return;
      expect(result.projection.profileSource.resolve(owner).model.configuration).toMatchObject({
        temperature: 0.7,
        maxTokens: 8_192,
        reasoningEffort: "minimal",
      });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects V4 Pro instead of silently projecting it as Flash", () => {
      const result = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject("configured-pro")],
        enabledChatModels: [createEntry(PRO, "configured-pro")],
        profileOptions: createProfileOptions(),
      });

      expect(result).toEqual({ kind: "diagnostic", code: "model_unsupported" });
    });

    it.each([
      [createEntry("deepseek-chat"), "model_unsupported"],
      [
        createEntry(FLASH, "configured-flash", {
          origin: { kind: "byok", catalogProviderId: "openai" },
        }),
        "provider_unsupported",
      ],
      [
        createEntry(FLASH, "configured-flash", { baseUrl: "https://proxy.example/v1" }),
        "profile_endpoint_invalid",
      ],
    ] as const)("rejects an unsupported configured route %#", (entry, code) => {
      const result = projectConfiguredModels({
        owners: [createOwner()],
        projects: [createProject(entry.configuredModelId)],
        enabledChatModels: [entry],
        profileOptions: createProfileOptions(),
      });

      expect(result).toEqual({ kind: "diagnostic", code });
    });
  });

  describe("prepareKnowledgeConfiguredModelPreflight()", () => {
    it("reads the selected provider key once and returns a zero-network private preflight", async () => {
      const modelManagement = createModelManagement([createEntry()]);
      const input = createPrepareInput(modelManagement.api);
      const result = await prepareKnowledgeConfiguredModelPreflight(input);

      expect(result.kind).toBe("ready");
      expect(modelManagement.resolveEnabled).toHaveBeenCalledWith("chat");
      expect(modelManagement.getApiKey).toHaveBeenCalledTimes(1);
      expect(modelManagement.getApiKey).toHaveBeenCalledWith("provider-deepseek");
      expect(input.fetchPort).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
      if (result.kind === "ready") {
        expect(result.preflight.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
        expect(JSON.stringify(result.profileSource.resolve(input.owners[0]))).not.toContain(
          CREDENTIAL
        );
        result.preflight.close();
      }
    });

    it.each([
      ["missing key", null],
      ["keychain read failure", new Error("keychain canary")],
    ] as const)("returns a credential-only diagnostic for %s", async (_label, credential) => {
      const modelManagement = createModelManagement([createEntry()], credential);

      await expect(
        prepareKnowledgeConfiguredModelPreflight(createPrepareInput(modelManagement.api))
      ).resolves.toEqual({ kind: "diagnostic", code: "route_credential_invalid" });
    });

    it("honors generation cancellation before reading the keychain", async () => {
      const modelManagement = createModelManagement([createEntry()]);
      const controller = new AbortController();
      controller.abort();

      await expect(
        prepareKnowledgeConfiguredModelPreflight(
          createPrepareInput(modelManagement.api, { signal: controller.signal })
        )
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(modelManagement.resolveEnabled).not.toHaveBeenCalled();
      expect(modelManagement.getApiKey).not.toHaveBeenCalled();
    });
  });
});
