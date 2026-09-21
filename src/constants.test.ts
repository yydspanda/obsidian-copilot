import { BUILTIN_CHAT_MODELS, ChatModelProviders, ChatModels, ProviderInfo } from "@/constants";

describe("constants", () => {
  describe("BUILTIN_CHAT_MODELS", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 offers canonical Flash and V4 Pro for direct DeepSeek", () => {
      const directDeepSeekModels = BUILTIN_CHAT_MODELS.filter(
        (model) => String(model.provider) === String(ChatModelProviders.DEEPSEEK)
      ).map((model) => model.name);

      expect(directDeepSeekModels).toContain(ChatModels.DEEPSEEK_FLASH);
      expect(directDeepSeekModels).toContain("deepseek-v4-pro");
    });
  });

  describe("ProviderInfo", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 verifies DeepSeek credentials with canonical Flash", () => {
      expect(ProviderInfo[ChatModelProviders.DEEPSEEK].testModel).toBe(ChatModels.DEEPSEEK_FLASH);
    });
  });
});
