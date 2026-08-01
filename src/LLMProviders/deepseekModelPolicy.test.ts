import {
  createDeepSeekChatModelPolicy,
  DeepSeekModelPolicyError,
  isCurrentDeepSeekModelIdentity,
  isDeepSeekThinkingEffort,
  resolveDeepSeekTemperatureOverride,
  shouldBlockDeepSeekThinkingAgentTools,
} from "@/LLMProviders/deepseekModelPolicy";

describe("DeepSeek model policy", () => {
  it("accepts only the current reviewed V4 identities", () => {
    expect(isCurrentDeepSeekModelIdentity("deepseek-v4-flash")).toBe(true);
    expect(isCurrentDeepSeekModelIdentity("deepseek-v4-pro")).toBe(true);
    expect(isCurrentDeepSeekModelIdentity("deepseek-chat")).toBe(false);
    expect(isCurrentDeepSeekModelIdentity("deepseek-reasoner")).toBe(false);
  });

  it("makes disabled thinking and sampling explicit for Flash", () => {
    expect(
      createDeepSeekChatModelPolicy({
        model: "deepseek-v4-flash",
        reasoningEffort: "minimal",
        temperature: 0.2,
        topP: 0.8,
      })
    ).toEqual({
      thinkingEnabled: false,
      temperature: 0.2,
      topP: 0.8,
      modelKwargs: { thinking: { type: "disabled" } },
    });
  });

  it.each([
    ["high", "high"],
    ["xhigh", "max"],
  ] as const)("maps %s thinking without sampling fields", (effort, wireEffort) => {
    expect(
      createDeepSeekChatModelPolicy({
        model: "deepseek-v4-pro",
        reasoningEffort: effort,
        temperature: 0,
      })
    ).toEqual({
      thinkingEnabled: true,
      modelKwargs: {
        thinking: { type: "enabled" },
        reasoning_effort: wireEffort,
      },
    });
  });

  it.each([
    [
      { model: "deepseek-v4-pro", reasoningEffort: "low", temperature: 0 },
      "reasoning_effort_unsupported",
    ],
    [
      { model: "deepseek-v4-pro", reasoningEffort: "medium", temperature: 0 },
      "reasoning_effort_unsupported",
    ],
    [
      { model: "deepseek-v4-pro", reasoningEffort: "high", temperature: 0.1 },
      "sampling_unsupported",
    ],
    [
      { model: "deepseek-v4-pro", reasoningEffort: "high", temperature: 0, topP: 0.8 },
      "sampling_unsupported",
    ],
    [
      {
        model: "deepseek-v4-pro",
        reasoningEffort: "minimal",
        temperature: 0.1,
        frequencyPenalty: 0,
      },
      "frequency_penalty_unsupported",
    ],
  ] as const)("rejects unsupported configuration before request creation", (override, code) => {
    try {
      createDeepSeekChatModelPolicy(override);
      throw new Error("Expected DeepSeek policy rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekModelPolicyError);
      expect((error as DeepSeekModelPolicyError).code).toBe(code);
    }
  });

  it("preserves temperature zero for internal thinking-model overrides", () => {
    expect(isDeepSeekThinkingEffort("high")).toBe(true);
    expect(resolveDeepSeekTemperatureOverride("high", 0.1)).toBe(0);
    expect(resolveDeepSeekTemperatureOverride("minimal", 0.1)).toBe(0.1);
  });

  it("blocks only direct DeepSeek thinking models that would bind Agent tools", () => {
    expect(
      shouldBlockDeepSeekThinkingAgentTools("deepseek", { thinking: { type: "enabled" } }, 1)
    ).toBe(true);
    expect(
      shouldBlockDeepSeekThinkingAgentTools("deepseek", { thinking: { type: "disabled" } }, 1)
    ).toBe(false);
    expect(
      shouldBlockDeepSeekThinkingAgentTools("deepseek", { thinking: { type: "enabled" } }, 0)
    ).toBe(false);
    expect(
      shouldBlockDeepSeekThinkingAgentTools("openai", { thinking: { type: "enabled" } }, 1)
    ).toBe(false);
  });
});
