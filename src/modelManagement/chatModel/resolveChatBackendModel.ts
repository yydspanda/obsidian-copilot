import { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";

import { findChatBackendEntry, isChatModelSelectionForEntry } from "./chatModelSelection";
import { configuredModelToCustomModel } from "./configuredModelToCustomModel";

export type ChatBackendResolution =
  | { ok: true; configuredModelId: string; customModel: CustomModel }
  | { ok: false; reason: "empty" | "selection_unavailable" };

export async function resolveChatBackendModel(
  api: Pick<
    ModelManagementApi,
    "backendConfigRegistry" | "configuredModelRegistry" | "providerRegistry"
  >,
  preferredConfiguredModelId: string | undefined
): Promise<ChatBackendResolution> {
  const enabled = api.backendConfigRegistry.resolveEnabled("chat");
  const target = findChatBackendEntry(enabled, preferredConfiguredModelId, true, {
    configuredModels: api.configuredModelRegistry.list(),
    providers: api.providerRegistry.list(),
  });
  if (!target) {
    // A retained direct-provider selection is not equivalent to an empty
    // backend: callers must tell the user to replace it explicitly.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    const hasEnabledModel = enabled.some((entry) => entry.state === "ok");
    return {
      ok: false,
      reason: hasEnabledModel ? "selection_unavailable" : "empty",
    };
  }

  if (
    preferredConfiguredModelId &&
    !isChatModelSelectionForEntry(target, preferredConfiguredModelId)
  ) {
    logWarn(
      `[chatBridge] chat model "${preferredConfiguredModelId}" is not enabled; ` +
        `falling back to configuredModelId="${target.configuredModelId}"`
    );
  }

  const apiKey = await api.providerRegistry.getApiKey(target.provider.providerId);
  const customModel = configuredModelToCustomModel({
    provider: target.provider,
    configuredModel: target.configuredModel,
    apiKey,
  });
  return { ok: true, configuredModelId: target.configuredModelId, customModel };
}
