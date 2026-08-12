import { ChatModelProviders } from "@/constants";

/** Minimal model fields required for a passive local Chat readiness check. */
export interface ChatModelLocalReadinessModelInput {
  readonly provider: unknown;
  readonly apiKey?: unknown;
}

/** Minimal hydrated settings fields used only to reduce credential presence to a boolean. */
export interface ChatModelLocalReadinessSettingsInput {
  readonly plusLicenseKey: unknown;
  readonly openAIApiKey: unknown;
  readonly cohereApiKey: unknown;
  readonly anthropicApiKey: unknown;
  readonly azureOpenAIApiKey: unknown;
  readonly googleApiKey: unknown;
  readonly openRouterAiApiKey: unknown;
  readonly xaiApiKey: unknown;
  readonly groqApiKey: unknown;
  readonly mistralApiKey: unknown;
  readonly deepseekApiKey: unknown;
  readonly amazonBedrockApiKey: unknown;
  readonly siliconflowApiKey: unknown;
  readonly githubCopilotAccessToken: unknown;
  readonly githubCopilotToken: unknown;
}

const SUPPORTED_CHAT_PROVIDERS = new Set<string>(Object.values(ChatModelProviders));

/** Returns whether a credential-shaped value is present without retaining or exposing it. */
function hasConfiguredValue(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Reports whether the ordinary Chat runtime has a constructor for one provider.
 *
 * @param provider - Persisted provider identity
 * @returns Whether the identity is in the closed Chat provider catalog
 */
export function isSupportedChatModelProvider(provider: unknown): provider is ChatModelProviders {
  return typeof provider === "string" && SUPPORTED_CHAT_PROVIDERS.has(provider);
}

/**
 * Reduces the ordinary Chat runtime's local credential policy to a boolean.
 *
 * This function performs no decryption, entitlement check, provider request, or
 * model construction. A true result means only that the runtime's required
 * local credential field is populated (or that the local provider requires no
 * credential); it does not prove connectivity, validity, quota, or balance.
 *
 * @param model - Selected model's provider and optional model-specific credential
 * @param settings - Hydrated local settings captured at the orchestration edge
 * @returns Whether the provider's local credential requirement is satisfied
 */
export function hasChatModelLocalCredentials(
  model: ChatModelLocalReadinessModelInput,
  settings: ChatModelLocalReadinessSettingsInput
): boolean {
  if (!isSupportedChatModelProvider(model.provider)) return false;
  const hasModelCredential = hasConfiguredValue(model.apiKey);

  switch (model.provider) {
    case ChatModelProviders.OLLAMA:
    case ChatModelProviders.LM_STUDIO:
    case ChatModelProviders.OPENAI_FORMAT:
      return true;
    case ChatModelProviders.OPENAI:
      return hasModelCredential || hasConfiguredValue(settings.openAIApiKey);
    case ChatModelProviders.AZURE_OPENAI:
      return hasModelCredential || hasConfiguredValue(settings.azureOpenAIApiKey);
    case ChatModelProviders.ANTHROPIC:
      return hasModelCredential || hasConfiguredValue(settings.anthropicApiKey);
    case ChatModelProviders.COHEREAI:
      return hasModelCredential || hasConfiguredValue(settings.cohereApiKey);
    case ChatModelProviders.GOOGLE:
      return hasModelCredential || hasConfiguredValue(settings.googleApiKey);
    case ChatModelProviders.XAI:
      return hasModelCredential || hasConfiguredValue(settings.xaiApiKey);
    case ChatModelProviders.OPENROUTERAI:
      return hasModelCredential || hasConfiguredValue(settings.openRouterAiApiKey);
    case ChatModelProviders.GROQ:
      return hasModelCredential || hasConfiguredValue(settings.groqApiKey);
    case ChatModelProviders.COPILOT_PLUS:
      return hasConfiguredValue(settings.plusLicenseKey);
    case ChatModelProviders.MISTRAL:
      return hasModelCredential || hasConfiguredValue(settings.mistralApiKey);
    case ChatModelProviders.DEEPSEEK:
      return hasModelCredential || hasConfiguredValue(settings.deepseekApiKey);
    case ChatModelProviders.AMAZON_BEDROCK:
      return hasModelCredential || hasConfiguredValue(settings.amazonBedrockApiKey);
    case ChatModelProviders.SILICONFLOW:
      return hasModelCredential || hasConfiguredValue(settings.siliconflowApiKey);
    case ChatModelProviders.GITHUB_COPILOT:
      return (
        hasConfiguredValue(settings.githubCopilotToken) ||
        hasConfiguredValue(settings.githubCopilotAccessToken)
      );
  }
}
