import { DEFAULT_SETTINGS } from "@/constants";
import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { settingsAtom, settingsStore } from "@/settings/model";
import { renderHook } from "@testing-library/react";

function provider(providerId: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId,
    providerType: "openai-compatible",
    displayName: providerId,
    origin: { kind: "byok", catalogProviderId: "openai" },
    addedAt: 0,
    apiKeyKeychainId: `${providerId}-key`,
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

describe("useChatBackendModelOptions", () => {
  describe("useChatBackendModelOptions()", () => {
    it("lists enabled models whose provider can authenticate and resolves a legacy selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      const openai = provider("openai", { apiKeyKeychainId: null, requiresApiKey: false });
      const anthropic = provider("anthropic", {
        providerType: "anthropic",
        apiKeyKeychainId: null,
        requiresApiKey: true,
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      const available = configuredModel("available", openai.providerId, "gpt-4o", "GPT-4o");
      const missingKey = configuredModel("missing-key", anthropic.providerId, "claude", "Claude");
      setChatInventory([openai, anthropic], [available, missingKey], ["available", "missing-key"]);

      const { result } = renderHook(() => useChatBackendModelOptions(false));

      expect(result.current.options).toEqual([{ label: "GPT-4o", value: "available" }]);
      expect(result.current.resolveSelectionId("gpt-4o|openai")).toBe("available");
    });

    it("does not substitute the first model for a removed command selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      const openai = provider("openai");
      const available = configuredModel("available", openai.providerId, "gpt-4o");
      setChatInventory([openai], [available], [available.configuredModelId]);

      const { result } = renderHook(() => useChatBackendModelOptions(false));

      expect(result.current.resolveSelectionId("removed")).toBeUndefined();
      expect(result.current.resolveSelectionId(undefined)).toBeUndefined();
    });

    it("falls back from an ordinary provider's retained stale model to the first enabled option (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      const anthropic = provider("anthropic", {
        providerType: "anthropic",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      const openai = provider("openai");
      const retired = configuredModel("retired-claude", anthropic.providerId, "claude-old");
      const fallback = configuredModel("safe-model", openai.providerId, "gpt-5", "GPT-5");
      setChatInventory([anthropic, openai], [retired, fallback], [fallback.configuredModelId]);

      const { result } = renderHook(() => useChatBackendModelOptions());

      expect(result.current.options).toEqual([{ label: "GPT-5", value: "safe-model" }]);
      expect(result.current.resolveSelectionId(retired.configuredModelId)).toBe("safe-model");
    });

    it("keeps a retained disabled official DeepSeek Pro model unavailable instead of selecting an enabled proxy (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
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

      const { result } = renderHook(() => useChatBackendModelOptions());

      expect(result.current.options).toEqual([{ label: "deepseek-v4-pro", value: "proxy-pro" }]);
      expect(result.current.resolveSelectionId(retainedOfficial.configuredModelId)).toBeUndefined();
    });

    it("fails closed when a retained disabled official account and an enabled proxy both own a legacy DeepSeek Pro selection (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
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

      const { result } = renderHook(() => useChatBackendModelOptions());

      expect(result.current.resolveSelectionId("deepseek-v4-pro|deepseek")).toBeUndefined();
    });
  });
});
