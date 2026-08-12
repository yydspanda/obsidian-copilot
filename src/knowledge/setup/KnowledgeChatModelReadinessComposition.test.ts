import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import type { ChatModelLocalReadinessSettingsInput } from "@/LLMProviders/chatModelLocalReadiness";
import { composeKnowledgeChatModelReadiness } from "@/knowledge/setup/KnowledgeChatModelReadinessComposition";

const DEFAULT_KEY = `default|${ChatModelProviders.OPENAI}`;
const PROJECT_KEY = `project|${ChatModelProviders.DEEPSEEK}`;

/** Creates an empty credential projection with explicit test overrides. */
function createCredentials(
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

/** Creates one enabled catalog model with explicit overrides. */
function createModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "default",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    projectEnabled: true,
    ...overrides,
  };
}

describe("composeKnowledgeChatModelReadiness", () => {
  it("uses the default model and its local credential outside Project mode", () => {
    expect(
      composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: PROJECT_KEY,
        activeModels: [createModel()],
        credentialSettings: createCredentials({ openAIApiKey: "configured" }),
      })
    ).toEqual({ reason: "configured" });
  });

  it("never falls back to a configured default model in Project mode", () => {
    expect(
      composeKnowledgeChatModelReadiness({
        mode: "project",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: undefined,
        activeModels: [createModel()],
        credentialSettings: createCredentials({ openAIApiKey: "configured" }),
      })
    ).toEqual({ reason: "missing" });
  });

  it("requires the exact Project selection to be Project-enabled", () => {
    expect(
      composeKnowledgeChatModelReadiness({
        mode: "project",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: PROJECT_KEY,
        activeModels: [
          createModel({
            name: "project",
            provider: ChatModelProviders.DEEPSEEK,
            projectEnabled: false,
          }),
        ],
        credentialSettings: createCredentials({ deepseekApiKey: "configured" }),
      })
    ).toEqual({ reason: "not_project_enabled" });
  });

  it("fails closed for duplicate identities, unknown providers, and absent credentials", () => {
    const duplicate = createModel();
    expect(
      composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: undefined,
        activeModels: [duplicate, { ...duplicate }],
        credentialSettings: createCredentials({ openAIApiKey: "configured" }),
      })
    ).toEqual({ reason: "ambiguous" });

    expect(
      composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: "unknown|unknown-provider",
        projectModelKey: undefined,
        activeModels: [createModel({ name: "unknown", provider: "unknown-provider" })],
        credentialSettings: createCredentials(),
      })
    ).toEqual({ reason: "unsupported" });

    expect(
      composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: undefined,
        activeModels: [createModel()],
        credentialSettings: createCredentials(),
      })
    ).toEqual({ reason: "credential_missing" });

    expect(
      composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: `name|with-separator|${ChatModelProviders.OPENAI}`,
        projectModelKey: undefined,
        activeModels: [
          createModel({ name: "name|with-separator", provider: ChatModelProviders.OPENAI }),
        ],
        credentialSettings: createCredentials({ openAIApiKey: "configured" }),
      })
    ).toEqual({ reason: "unsupported" });
  });

  it("retains no model identity or credential canary and performs no network work", () => {
    const secret = "SECRET_API_KEY_CANARY";
    const originalFetch = window.fetch;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy;
    try {
      const result = composeKnowledgeChatModelReadiness({
        mode: "default",
        defaultModelKey: DEFAULT_KEY,
        projectModelKey: undefined,
        activeModels: [createModel()],
        credentialSettings: createCredentials({ openAIApiKey: secret }),
      });

      expect(result).toEqual({ reason: "configured" });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(DEFAULT_KEY);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      window.fetch = originalFetch;
    }
  });
});
