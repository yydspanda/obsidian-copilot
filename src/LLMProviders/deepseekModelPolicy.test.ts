import {
  createDeepSeekChatModelPolicy,
  DEEPSEEK_FLASH_WIRE_IDENTITY,
  DeepSeekModelPolicyError,
  isCurrentDeepSeekModelIdentity,
  isDeepSeekThinkingEffort,
  resolveDeepSeekTemperatureOverride,
  resolveDeepSeekWireModelIdentity,
  shouldBlockDeepSeekThinkingAgentTools,
} from "@/LLMProviders/deepseekModelPolicy";

describe("deepseekModelPolicy", () => {
  describe("isCurrentDeepSeekModelIdentity()", () => {
    it("recognizes only the canonical Flash identity (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(isCurrentDeepSeekModelIdentity("deepseek-flash")).toBe(true);
      expect(isCurrentDeepSeekModelIdentity("deepseek-v4-flash")).toBe(false);
      expect(isCurrentDeepSeekModelIdentity("deepseek-v4-pro")).toBe(false);
      expect(isCurrentDeepSeekModelIdentity("deepseek-chat")).toBe(false);
    });
  });

  describe("resolveDeepSeekWireModelIdentity()", () => {
    it("returns the canonical Flash wire identity for a current model (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(resolveDeepSeekWireModelIdentity("deepseek-flash")).toBe(DEEPSEEK_FLASH_WIRE_IDENTITY);
    });

    it("maps the persisted Flash alias to the canonical wire identity (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(resolveDeepSeekWireModelIdentity("deepseek-v4-flash")).toBe(
        DEEPSEEK_FLASH_WIRE_IDENTITY
      );
    });

    it("rejects retired Pro and unrelated identities instead of substituting a model (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(resolveDeepSeekWireModelIdentity("deepseek-v4-pro")).toBeUndefined();
      expect(resolveDeepSeekWireModelIdentity("deepseek-chat")).toBeUndefined();
      expect(resolveDeepSeekWireModelIdentity("deepseek-reasoner")).toBeUndefined();
    });
  });

  describe("isDeepSeekThinkingEffort()", () => {
    it("recognizes only the explicit thinking efforts", () => {
      expect(isDeepSeekThinkingEffort("high")).toBe(true);
      expect(isDeepSeekThinkingEffort("xhigh")).toBe(true);
      expect(isDeepSeekThinkingEffort("minimal")).toBe(false);
      expect(isDeepSeekThinkingEffort(undefined)).toBe(false);
    });
  });

  describe("resolveDeepSeekTemperatureOverride()", () => {
    it("forces temperature zero for thinking and preserves it otherwise", () => {
      expect(resolveDeepSeekTemperatureOverride("high", 0.1)).toBe(0);
      expect(resolveDeepSeekTemperatureOverride("minimal", 0.1)).toBe(0.1);
    });
  });

  describe("shouldBlockDeepSeekThinkingAgentTools()", () => {
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

  describe("createDeepSeekChatModelPolicy()", () => {
    it("makes the wire identity, disabled thinking, and sampling explicit for Flash (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(
        createDeepSeekChatModelPolicy({
          model: "deepseek-flash",
          reasoningEffort: "minimal",
          temperature: 0.2,
          topP: 0.8,
        })
      ).toEqual({
        wireModelIdentity: DEEPSEEK_FLASH_WIRE_IDENTITY,
        thinkingEnabled: false,
        temperature: 0.2,
        topP: 0.8,
        modelKwargs: { thinking: { type: "disabled" } },
      });
    });

    it("uses the canonical wire identity for a persisted Flash alias (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      expect(
        createDeepSeekChatModelPolicy({
          model: "deepseek-v4-flash",
          reasoningEffort: "minimal",
          temperature: 0.2,
        })
      ).toMatchObject({
        wireModelIdentity: DEEPSEEK_FLASH_WIRE_IDENTITY,
        thinkingEnabled: false,
      });
    });

    it.each([
      ["high", "high"],
      ["xhigh", "max"],
    ] as const)("maps %s thinking without sampling fields", (effort, wireEffort) => {
      expect(
        createDeepSeekChatModelPolicy({
          model: "deepseek-flash",
          reasoningEffort: effort,
          temperature: 0,
        })
      ).toEqual({
        wireModelIdentity: DEEPSEEK_FLASH_WIRE_IDENTITY,
        thinkingEnabled: true,
        modelKwargs: {
          thinking: { type: "enabled" },
          reasoning_effort: wireEffort,
        },
      });
    });

    it.each([
      [
        { model: "deepseek-flash", reasoningEffort: "low", temperature: 0 },
        "reasoning_effort_unsupported",
      ],
      [
        { model: "deepseek-flash", reasoningEffort: "medium", temperature: 0 },
        "reasoning_effort_unsupported",
      ],
      [
        { model: "deepseek-flash", reasoningEffort: "high", temperature: 0.1 },
        "sampling_unsupported",
      ],
      [
        { model: "deepseek-flash", reasoningEffort: "high", temperature: 0, topP: 0.8 },
        "sampling_unsupported",
      ],
      [
        {
          model: "deepseek-flash",
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

    it("rejects retired Pro before request creation (https://github.com/yydspanda/obsidian-copilot/issues/3)", () => {
      try {
        createDeepSeekChatModelPolicy({
          model: "deepseek-v4-pro",
          reasoningEffort: "high",
          temperature: 0,
        });
        throw new Error("Expected DeepSeek policy rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(DeepSeekModelPolicyError);
        expect((error as DeepSeekModelPolicyError).code).toBe("model_unsupported");
      }
    });
  });
});
