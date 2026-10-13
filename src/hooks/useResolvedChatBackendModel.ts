import type { App } from "obsidian";
import { useMemo } from "react";
import { useAtomValue } from "jotai";

import type { CustomModel } from "@/aiParams";
import {
  chatBackendPickerAtom,
  configuredModelsAtom,
  configuredModelToCustomModel,
  findChatBackendEntry,
  providersAtom,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { settingsStore } from "@/settings/model";

export function useResolvedChatBackendModel(
  app: App,
  configuredModelId: string | undefined
): CustomModel | null {
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  return useMemo(() => {
    const target = findChatBackendEntry(entries, configuredModelId, false, {
      configuredModels,
      providers: Object.values(providers),
    });
    if (!target) return null;
    const apiKey = target.provider.apiKeyKeychainId
      ? KeychainService.getInstance(app).getSecretById(target.provider.apiKeyKeychainId)
      : null;
    return configuredModelToCustomModel({
      provider: target.provider,
      configuredModel: target.configuredModel,
      apiKey,
    });
  }, [entries, configuredModelId, configuredModels, providers, app]);
}
