import {
  hasChatModelLocalCredentials,
  isSupportedChatModelProvider,
  type ChatModelLocalReadinessSettingsInput,
} from "@/LLMProviders/chatModelLocalReadiness";
import { ChatModelProviders } from "@/constants";

/** Creates an empty credential projection with explicit test overrides. */
function createSettings(
  overrides: Partial<ChatModelLocalReadinessSettingsInput> = {}
): ChatModelLocalReadinessSettingsInput {
  return {
    plusLicenseKey: "",
    openAIApiKey: "",
    cohereApiKey: "",
    anthropicApiKey: "",
    azureOpenAIApiKey: "",
    googleApiKey: "",
    openRouterAiApiKey: "",
    xaiApiKey: "",
    groqApiKey: "",
    mistralApiKey: "",
    deepseekApiKey: "",
    amazonBedrockApiKey: "",
    siliconflowApiKey: "",
    githubCopilotAccessToken: "",
    githubCopilotToken: "",
    ...overrides,
  };
}

describe("chatModelLocalReadiness", () => {
  it.each([
    [ChatModelProviders.OPENAI, "openAIApiKey"],
    [ChatModelProviders.AZURE_OPENAI, "azureOpenAIApiKey"],
    [ChatModelProviders.COPILOT_PLUS, "plusLicenseKey"],
    [ChatModelProviders.DEEPSEEK, "deepseekApiKey"],
    [ChatModelProviders.AMAZON_BEDROCK, "amazonBedrockApiKey"],
  ] as const)("requires the local %s credential field", (provider, field) => {
    expect(hasChatModelLocalCredentials({ provider }, createSettings())).toBe(false);
    expect(
      hasChatModelLocalCredentials({ provider }, createSettings({ [field]: "configured" }))
    ).toBe(true);
  });

  it.each([
    ChatModelProviders.OLLAMA,
    ChatModelProviders.LM_STUDIO,
    ChatModelProviders.OPENAI_FORMAT,
  ])("does not require a credential for local provider %s", (provider) => {
    expect(hasChatModelLocalCredentials({ provider }, createSettings())).toBe(true);
  });

  it("accepts either GitHub OAuth token and a model-specific credential override", () => {
    expect(
      hasChatModelLocalCredentials(
        { provider: ChatModelProviders.GITHUB_COPILOT },
        createSettings({ githubCopilotAccessToken: "access" })
      )
    ).toBe(true);
    expect(
      hasChatModelLocalCredentials(
        { provider: ChatModelProviders.GITHUB_COPILOT },
        createSettings({ githubCopilotToken: "token" })
      )
    ).toBe(true);
    expect(
      hasChatModelLocalCredentials(
        { provider: ChatModelProviders.OPENAI, apiKey: "model-specific" },
        createSettings()
      )
    ).toBe(true);
  });

  it("does not treat stale model-level credentials as Plus or GitHub authority", () => {
    expect(
      hasChatModelLocalCredentials(
        { provider: ChatModelProviders.COPILOT_PLUS, apiKey: "stale-model-key" },
        createSettings()
      )
    ).toBe(false);
    expect(
      hasChatModelLocalCredentials(
        { provider: ChatModelProviders.GITHUB_COPILOT, apiKey: "stale-model-key" },
        createSettings()
      )
    ).toBe(false);
  });

  it("fails closed for an unknown provider instead of treating it as keyless", () => {
    expect(isSupportedChatModelProvider("unknown-provider")).toBe(false);
    expect(
      hasChatModelLocalCredentials(
        { provider: "unknown-provider", apiKey: "SECRET_CANARY" },
        createSettings()
      )
    ).toBe(false);
  });

  it("returns only a boolean and never exposes credential material", () => {
    const secret = "SECRET_API_KEY_CANARY";
    const result = hasChatModelLocalCredentials(
      { provider: ChatModelProviders.OPENAI },
      createSettings({ openAIApiKey: secret })
    );

    expect(result).toBe(true);
    expect(JSON.stringify({ result })).not.toContain(secret);
  });
});
