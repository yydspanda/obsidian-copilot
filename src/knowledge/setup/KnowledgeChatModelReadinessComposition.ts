import type { CustomModel } from "@/aiParams";
import {
  hasChatModelLocalCredentials,
  isSupportedChatModelProvider,
  type ChatModelLocalReadinessSettingsInput,
} from "@/LLMProviders/chatModelLocalReadiness";
import { isModelReferenceRunnable } from "@/LLMProviders/modelSelectionPolicy";
import {
  projectKnowledgeChatModelReadiness,
  type KnowledgeChatModelReadiness,
} from "@/knowledge/setup/KnowledgeChatModelReadiness";
import { getModelKeyFromModel } from "@/settings/model";

/** Plain current Chat selection captured from the same synchronous UI observation. */
export interface KnowledgeChatModelReadinessCompositionInput {
  readonly mode: "default" | "project";
  readonly defaultModelKey: string | null | undefined;
  readonly projectModelKey: string | null | undefined;
  readonly activeModels: readonly CustomModel[];
  readonly credentialSettings: ChatModelLocalReadinessSettingsInput;
}

/**
 * Composes the current default or Project Chat selection into a secret-free status.
 *
 * Project mode consumes only `projectModelKey`; it never falls back to the
 * default selection. The selected credential is reduced to a boolean before
 * the reason-only result leaves this edge. No provider or network operation is
 * constructed.
 *
 * @param input - Current mode, selections, model catalog, and hydrated credential fields
 * @returns Frozen reason-only ordinary Chat readiness
 */
export function composeKnowledgeChatModelReadiness(
  input: KnowledgeChatModelReadinessCompositionInput
): KnowledgeChatModelReadiness {
  const selectedModelKey = input.mode === "project" ? input.projectModelKey : input.defaultModelKey;
  const matches =
    typeof selectedModelKey === "string"
      ? input.activeModels.filter((model) => getModelKeyFromModel(model) === selectedModelKey)
      : [];
  let selectedCredentialConfigured = false;
  if (matches.length === 1) {
    try {
      selectedCredentialConfigured = hasChatModelLocalCredentials(
        matches[0],
        input.credentialSettings
      );
    } catch {
      selectedCredentialConfigured = false;
    }
  }

  return projectKnowledgeChatModelReadiness({
    selection:
      input.mode === "project"
        ? { mode: "project", projectModelKey: selectedModelKey }
        : { mode: "default", selectedModelKey },
    activeModels: input.activeModels.map((model) => {
      let supported = false;
      try {
        supported =
          !model.name.includes("|") &&
          isSupportedChatModelProvider(model.provider) &&
          isModelReferenceRunnable(model);
      } catch {
        supported = false;
      }
      return {
        modelKey: getModelKeyFromModel(model),
        enabled: model.enabled,
        supported,
        projectEnabled: model.projectEnabled === true,
        credentialConfigured:
          matches.length === 1 && matches[0] === model && selectedCredentialConfigured,
      };
    }),
  });
}
