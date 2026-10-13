import { DEFAULT_SETTINGS } from "@/constants";
import { useResolvedChatBackendModel } from "@/hooks/useResolvedChatBackendModel";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { settingsAtom, settingsStore } from "@/settings/model";
import { renderHook } from "@testing-library/react";
import type { App } from "obsidian";

function provider(providerId: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId,
    providerType: "openai-compatible",
    displayName: providerId,
    origin: { kind: "byok", catalogProviderId: "openai" },
    addedAt: 0,
    apiKeyKeychainId: `${providerId}-keychain`,
    ...overrides,
  };
}

function configuredModel(
  configuredModelId: string,
  providerId: string,
  wireId: string,
  displayName = wireId
): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: wireId, displayName },
    configuredAt: 0,
  };
}

function setChatInventory(
  providers: readonly Provider[],
  configuredModels: readonly ConfiguredModel[],
  enabledModels: readonly string[]
): void {
  settingsStore.set(settingsAtom, {
    ...DEFAULT_SETTINGS,
    providers: Object.fromEntries(providers.map((candidate) => [candidate.providerId, candidate])),
    configuredModels: [...configuredModels],
    backends: { chat: { enabledModels: [...enabledModels] } },
  });
}

function deepSeekProviders(): { official: Provider; proxy: Provider } {
  return {
    official: provider("deepseek-official", {
      origin: { kind: "byok", catalogProviderId: "deepseek" },
      baseUrl: "https://api.deepseek.com/v1",
    }),
    proxy: provider("deepseek-proxy", {
      origin: { kind: "byok", catalogProviderId: "deepseek" },
      baseUrl: "https://proxy.example/v1",
    }),
  };
}

describe("useResolvedChatBackendModel", () => {
  describe("useResolvedChatBackendModel()", () => {
    const app = {} as App;
    const getSecretById = jest.fn<string | null, [string]>();
    const keychain = { getSecretById } as unknown as KeychainService;
    const getKeychainInstance = jest.spyOn(KeychainService, "getInstance");

    beforeEach(() => {
      getSecretById.mockReset();
      getKeychainInstance.mockReset().mockReturnValue(keychain);
    });

    afterAll(() => {
      getKeychainInstance.mockRestore();
    });

    it("resolves an explicitly selected legacy model without fallback", () => {
      const openai = provider("openai", { apiKeyKeychainId: null, requiresApiKey: false });
      const available = configuredModel("available", openai.providerId, "gpt-4o", "GPT-4o");
      setChatInventory([openai], [available], [available.configuredModelId]);

      const { result } = renderHook(() => useResolvedChatBackendModel(app, "gpt-4o|openai"));

      expect(result.current).toMatchObject({ name: "gpt-4o", configuredModelId: "available" });
      expect(getSecretById).not.toHaveBeenCalled();
    });

    it.each([undefined, "removed"])(
      "returns no model for strict selection %s without reading credentials (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)",
      (selection) => {
        const openai = provider("openai");
        const available = configuredModel("available", openai.providerId, "gpt-4o");
        setChatInventory([openai], [available], [available.configuredModelId]);

        const { result } = renderHook(() => useResolvedChatBackendModel(app, selection));

        expect(result.current).toBeNull();
        expect(getKeychainInstance).not.toHaveBeenCalled();
        expect(getSecretById).not.toHaveBeenCalled();
      }
    );

    it("reads only the explicitly selected model's credential (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      const anthropic = provider("anthropic", {
        providerType: "anthropic",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      const openai = provider("openai");
      const retired = configuredModel("retired-claude", anthropic.providerId, "claude-old");
      const fallback = configuredModel("safe-model", openai.providerId, "gpt-5", "GPT-5");
      setChatInventory([anthropic, openai], [retired, fallback], [fallback.configuredModelId]);
      getSecretById.mockImplementation((keychainId) =>
        keychainId === openai.apiKeyKeychainId ? "safe-secret" : "wrong-secret"
      );

      const { result } = renderHook(() =>
        useResolvedChatBackendModel(app, fallback.configuredModelId)
      );

      expect(result.current).toMatchObject({
        configuredModelId: "safe-model",
        name: "gpt-5",
        displayName: "GPT-5",
        apiKey: "safe-secret",
      });
      expect(getKeychainInstance).toHaveBeenCalledTimes(1);
      expect(getKeychainInstance).toHaveBeenCalledWith(app);
      expect(getSecretById).toHaveBeenCalledTimes(1);
      expect(getSecretById).toHaveBeenCalledWith(openai.apiKeyKeychainId);
      expect(getSecretById).not.toHaveBeenCalledWith(anthropic.apiKeyKeychainId);
    });

    it("returns null for a retained disabled official DeepSeek Pro model without reading an enabled proxy credential (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      const { official, proxy } = deepSeekProviders();
      const retainedOfficial = configuredModel(
        "official-pro",
        official.providerId,
        "deepseek-v4-pro"
      );
      const enabledProxy = configuredModel("proxy-pro", proxy.providerId, "deepseek-v4-pro");
      setChatInventory(
        [official, proxy],
        [retainedOfficial, enabledProxy],
        [enabledProxy.configuredModelId]
      );

      const { result } = renderHook(() =>
        useResolvedChatBackendModel(app, retainedOfficial.configuredModelId)
      );

      expect(result.current).toBeNull();
      expect(getKeychainInstance).not.toHaveBeenCalled();
      expect(getSecretById).not.toHaveBeenCalled();
    });

    it("returns null for an ambiguously owned legacy DeepSeek Pro selection without looking up either credential (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      const { official, proxy } = deepSeekProviders();
      const retainedOfficial = configuredModel(
        "official-pro",
        official.providerId,
        "deepseek-v4-pro"
      );
      const enabledProxy = configuredModel("proxy-pro", proxy.providerId, "deepseek-v4-pro");
      setChatInventory(
        [official, proxy],
        [retainedOfficial, enabledProxy],
        [enabledProxy.configuredModelId]
      );

      const { result } = renderHook(() =>
        useResolvedChatBackendModel(app, "deepseek-v4-pro|deepseek")
      );

      expect(result.current).toBeNull();
      expect(getKeychainInstance).not.toHaveBeenCalled();
      expect(getSecretById).not.toHaveBeenCalled();
    });
  });
});
