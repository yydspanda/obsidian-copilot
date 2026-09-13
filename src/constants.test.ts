import { BUILTIN_CHAT_MODELS, ChatModelProviders, ChatModels, ProviderInfo } from "@/constants";

describe("constants", () => {
  describe("BUILTIN_CHAT_MODELS", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 offers canonical Flash but not retiring Pro for direct DeepSeek", () => {
      const directDeepSeekModels = BUILTIN_CHAT_MODELS.filter(
        (model) => String(model.provider) === String(ChatModelProviders.DEEPSEEK)
      ).map((model) => model.name);

      expect(directDeepSeekModels).toContain(ChatModels.DEEPSEEK_FLASH);
      expect(directDeepSeekModels).not.toContain(ChatModels.COPILOT_PLUS_DEEPSEEK_V4_PRO);
    });
  });

  describe("ProviderInfo", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 verifies DeepSeek credentials with canonical Flash", () => {
      expect(ProviderInfo[ChatModelProviders.DEEPSEEK].testModel).toBe(ChatModels.DEEPSEEK_FLASH);
    });
  });
});
