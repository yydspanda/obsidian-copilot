import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import { resolveChatBackendModel } from "./resolveChatBackendModel";

function provider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: id,
    providerType: "anthropic",
    displayName: id,
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function okEntry(
  configuredModelId: string,
  prov: Provider,
  wireId = `${configuredModelId}-wire`
): EnabledBackendEntry {
  const configuredModel: ConfiguredModel = {
    configuredModelId,
    providerId: prov.providerId,
    info: { id: wireId, displayName: configuredModelId },
    configuredAt: 0,
  };
  return { configuredModelId, state: "ok", configuredModel, provider: prov };
}

function configuredModel(
  configuredModelId: string,
  prov: Provider,
  wireId: string
): ConfiguredModel {
  return {
    configuredModelId,
    providerId: prov.providerId,
    info: { id: wireId, displayName: configuredModelId },
    configuredAt: 0,
  };
}

/** Minimal api stub exposing only what the resolver reads. */
function makeApi(
  entries: readonly EnabledBackendEntry[],
  keyByProvider: Record<string, string | null> = {},
  extraInventory: {
    configuredModels?: readonly ConfiguredModel[];
    providers?: readonly Provider[];
  } = {}
): Pick<
  ModelManagementApi,
  "backendConfigRegistry" | "configuredModelRegistry" | "providerRegistry"
> {
  const enabledModels = entries.flatMap((entry) =>
    entry.state === "ok" ? [entry.configuredModel] : []
  );
  const modelsById = new Map(
    [...enabledModels, ...(extraInventory.configuredModels ?? [])].map((model) => [
      model.configuredModelId,
      model,
    ])
  );
  const providersById = new Map(
    [
      ...entries.flatMap((entry) => (entry.state === "ok" ? [entry.provider] : [])),
      ...(extraInventory.providers ?? []),
    ].map((prov) => [prov.providerId, prov])
  );
  return {
    backendConfigRegistry: {
      resolveEnabled: (backend: string) => (backend === "chat" ? entries : []),
    } as unknown as ModelManagementApi["backendConfigRegistry"],
    configuredModelRegistry: {
      get: (configuredModelId: string) => modelsById.get(configuredModelId),
      list: () => [...modelsById.values()],
    } as unknown as ModelManagementApi["configuredModelRegistry"],
    providerRegistry: {
      get: (providerId: string) => providersById.get(providerId),
      list: () => [...providersById.values()],
      getApiKey: async (providerId: string) => keyByProvider[providerId] ?? null,
    } as unknown as ModelManagementApi["providerRegistry"],
  };
}

describe("resolveChatBackendModel", () => {
  describe("resolveChatBackendModel()", () => {
    it("resolves the preferred model when it is enabled", async () => {
      const p = provider("p1");
      const api = makeApi([okEntry("a", p), okEntry("b", p)], { p1: "key" });

      const result = await resolveChatBackendModel(api, "b");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.configuredModelId).toBe("b");
        expect(result.customModel.apiKey).toBe("key");
      }
    });

    it("falls back to the first enabled model when the preferred id is gone", async () => {
      const p = provider("p1");
      const api = makeApi([okEntry("a", p), okEntry("b", p)], { p1: "key" });

      const result = await resolveChatBackendModel(api, "stale-uuid");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.configuredModelId).toBe("a");
    });

    it("resolves a legacy name|provider selection", async () => {
      const p = provider("p1");
      const api = makeApi([okEntry("a", p)], { p1: "key" });

      const result = await resolveChatBackendModel(api, "a-wire|anthropic");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.configuredModelId).toBe("a");
    });

    it("falls back to the first enabled model when no preference is given", async () => {
      const p = provider("p1");
      const api = makeApi([okEntry("a", p)], { p1: "key" });

      const result = await resolveChatBackendModel(api, undefined);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.configuredModelId).toBe("a");
    });

    it("returns empty when nothing is enabled", async () => {
      const api = makeApi([]);
      const result = await resolveChatBackendModel(api, "anything");
      expect(result).toEqual({ ok: false, reason: "empty" });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 does not replace a retired direct DeepSeek selection or read another provider credential", async () => {
      const safeProvider = provider("safe", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "openai" },
      });
      const api = makeApi([okEntry("safe-model", safeProvider, "gpt-5")], {
        safe: "safe-key",
      });
      const getApiKey = jest.spyOn(api.providerRegistry, "getApiKey");

      await expect(resolveChatBackendModel(api, "deepseek-v4-pro|deepseek")).resolves.toEqual({
        ok: false,
        reason: "selection_unavailable",
      });
      expect(getApiKey).not.toHaveBeenCalled();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 does not replace a disabled Pro configured-model id or read another provider credential", async () => {
      const deepseek = provider("deepseek-official", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "deepseek" },
        baseUrl: "https://api.deepseek.com/v1",
      });
      const safeProvider = provider("safe", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "openai" },
      });
      const api = makeApi(
        [okEntry("safe-model", safeProvider, "gpt-5")],
        { safe: "safe-key", "deepseek-official": "deepseek-key" },
        {
          configuredModels: [configuredModel("retired-pro", deepseek, "deepseek-v4-pro")],
          providers: [deepseek],
        }
      );
      const getApiKey = jest.spyOn(api.providerRegistry, "getApiKey");

      await expect(resolveChatBackendModel(api, "retired-pro")).resolves.toEqual({
        ok: false,
        reason: "selection_unavailable",
      });
      expect(getApiKey).not.toHaveBeenCalled();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 does not choose an account for an ambiguous persisted Flash alias", async () => {
      const first = provider("deepseek-first", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "deepseek" },
      });
      const second = provider("deepseek-second", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "deepseek" },
      });
      const api = makeApi([
        okEntry("first", first, "deepseek-flash"),
        okEntry("second", second, "deepseek-flash"),
      ]);
      const getApiKey = jest.spyOn(api.providerRegistry, "getApiKey");

      await expect(resolveChatBackendModel(api, "deepseek-v4-flash|deepseek")).resolves.toEqual({
        ok: false,
        reason: "selection_unavailable",
      });
      expect(getApiKey).not.toHaveBeenCalled();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 does not route a disabled official Pro selection through an enabled proxy", async () => {
      const official = provider("deepseek-official", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "deepseek" },
        baseUrl: "https://api.deepseek.com/v1",
      });
      const proxy = provider("deepseek-proxy", {
        providerType: "openai-compatible",
        origin: { kind: "byok", catalogProviderId: "deepseek" },
        baseUrl: "https://proxy.example/v1",
      });
      const api = makeApi(
        [okEntry("proxy-pro", proxy, "deepseek-v4-pro")],
        { "deepseek-official": "official-key", "deepseek-proxy": "proxy-key" },
        {
          configuredModels: [configuredModel("official-pro", official, "deepseek-v4-pro")],
          providers: [official],
        }
      );
      const getApiKey = jest.spyOn(api.providerRegistry, "getApiKey");

      await expect(resolveChatBackendModel(api, "deepseek-v4-pro|deepseek")).resolves.toEqual({
        ok: false,
        reason: "selection_unavailable",
      });
      expect(getApiKey).not.toHaveBeenCalled();
    });

    it("skips broken refs and resolves the first ok entry", async () => {
      const p = provider("p1");
      const broken: EnabledBackendEntry = { configuredModelId: "x", state: "broken" };
      const api = makeApi([broken, okEntry("a", p)], { p1: "key" });

      const result = await resolveChatBackendModel(api, "x");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.configuredModelId).toBe("a");
    });
  });
});
