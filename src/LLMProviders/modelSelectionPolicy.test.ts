import {
  assertSavedModelReferenceCanRun,
  findFirstRunnableFallbackModel,
  isModelReferenceRunnable,
  SavedModelReferenceError,
} from "@/LLMProviders/modelSelectionPolicy";

describe("saved model reference policy", () => {
  it.each([
    ["deepseek-chat|deepseek", undefined, "model_retired"],
    [
      "deepseek-v4-pro|deepseek",
      {
        name: "deepseek-v4-pro",
        provider: "deepseek",
        enabled: false,
        retired: true,
      },
      "model_retired",
    ],
  ] as const)("blocks %s without considering a fallback", (modelKey, model, code) => {
    try {
      assertSavedModelReferenceCanRun(modelKey, model);
      throw new Error("Expected saved model reference rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SavedModelReferenceError);
      expect((error as SavedModelReferenceError).code).toBe(code);
    }
  });

  it("allows ordinary stale references to retain their historical fallback behavior", () => {
    expect(() => assertSavedModelReferenceCanRun("missing-model|openai")).not.toThrow();
  });

  it("never chooses retired or unsupported direct models as fallback candidates", () => {
    expect(
      findFirstRunnableFallbackModel([
        {
          name: "deepseek-v4-pro",
          provider: "deepseek",
          enabled: true,
          retired: true,
        },
        { name: "future-deepseek", provider: "deepseek", enabled: true },
        { name: "safe-model", provider: "openai", enabled: true },
      ])
    ).toMatchObject({ name: "safe-model", provider: "openai" });
  });

  it("https://github.com/yydspanda/obsidian-copilot/issues/3 marks only reviewed direct DeepSeek identities as runnable catalog records", () => {
    expect(
      isModelReferenceRunnable({
        name: "deepseek-flash",
        provider: "deepseek",
        enabled: true,
      })
    ).toBe(true);
    expect(
      isModelReferenceRunnable({
        name: "future-deepseek",
        provider: "deepseek",
        enabled: true,
      })
    ).toBe(false);
  });
});
