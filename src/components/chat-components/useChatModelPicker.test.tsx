import { act, renderHook } from "@testing-library/react";

import type { ConfiguredModel, Provider } from "@/modelManagement";
import { DEFAULT_SETTINGS } from "@/constants";
import { getModelKeyFromModel, settingsAtom, settingsStore } from "@/settings/model";

import { useChatModelPicker } from "./useChatModelPicker";

const DEEPSEEK_PROVIDER: Provider = {
  providerId: "deepseek-official",
  providerType: "openai-compatible",
  displayName: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKeyKeychainId: "deepseek-key",
  requiresApiKey: true,
  origin: { kind: "byok", catalogProviderId: "deepseek" },
  addedAt: 0,
};

const SAFE_PROVIDER: Provider = {
  providerId: "openai-official",
  providerType: "openai-compatible",
  displayName: "OpenAI",
  apiKeyKeychainId: "openai-key",
  requiresApiKey: true,
  origin: { kind: "byok", catalogProviderId: "openai" },
  addedAt: 0,
};

const RETIRED_PRO: ConfiguredModel = {
  configuredModelId: "retired-pro",
  providerId: DEEPSEEK_PROVIDER.providerId,
  info: { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
  configuredAt: 0,
};

const SAFE_MODEL: ConfiguredModel = {
  configuredModelId: "safe-model",
  providerId: SAFE_PROVIDER.providerId,
  info: { id: "gpt-5", displayName: "GPT-5" },
  configuredAt: 0,
};

describe("useChatModelPicker", () => {
  describe("useChatModelPicker()", () => {
    beforeEach(() => {
      act(() => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          providers: {
            [DEEPSEEK_PROVIDER.providerId]: DEEPSEEK_PROVIDER,
            [SAFE_PROVIDER.providerId]: SAFE_PROVIDER,
          },
          configuredModels: [RETIRED_PRO, SAFE_MODEL],
          backends: { chat: { enabledModels: [SAFE_MODEL.configuredModelId] } },
        });
      });
    });

    afterEach(() => {
      act(() => {
        settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
      });
    });

    it("shows the explicitly selected legacy model and returns configured IDs on selection", () => {
      const onChange = jest.fn();
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "gpt-5|openai", onChange, fallbackToFirst: false })
      );

      const selected = result.current.models.find(
        (model) => getModelKeyFromModel(model) === result.current.value
      );
      expect(selected?.name).toBe(SAFE_MODEL.configuredModelId);
      act(() => result.current.onChange(result.current.value));
      expect(onChange).toHaveBeenCalledWith(SAFE_MODEL.configuredModelId);
    });

    it.each([undefined, "", "removed"])(
      "keeps strict selection %s empty until the user picks (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)",
      (value) => {
        const { result } = renderHook(() =>
          useChatModelPicker({ value, onChange: jest.fn(), fallbackToFirst: false })
        );

        expect(result.current.value).toBe("");
        expect(result.current.models[0].displayName).toBe("GPT-5");
      }
    );

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 shows a disabled replacement prompt instead of disguising a retired direct selection as another provider", () => {
      const onChange = jest.fn();
      const { result } = renderHook(() =>
        useChatModelPicker({ value: RETIRED_PRO.configuredModelId, onChange })
      );

      const selected = result.current.models.find(
        (model) => getModelKeyFromModel(model) === result.current.value
      );
      expect(selected).toMatchObject({
        displayName: "Model unavailable — choose another",
        _disabledReason: "Choose another model",
      });
      const safeModel = result.current.models.find(
        (model) => model.name === SAFE_MODEL.configuredModelId
      );
      expect(safeModel).toBeDefined();
      const safeModelKey = getModelKeyFromModel(safeModel!);
      expect(result.current.value).not.toBe(safeModelKey);
      result.current.onChange(safeModelKey);
      expect(onChange).toHaveBeenCalledWith(SAFE_MODEL.configuredModelId);
    });

    it("keeps the historical first-enabled fallback for an ordinary stale selection", () => {
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "ordinary-stale-id", onChange: jest.fn() })
      );

      const selected = result.current.models.find(
        (model) => getModelKeyFromModel(model) === result.current.value
      );
      expect(selected?.name).toBe(SAFE_MODEL.configuredModelId);
    });
  });
});
