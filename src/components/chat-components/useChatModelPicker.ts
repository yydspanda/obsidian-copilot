import {
  chatBackendPickerAtom,
  capabilitiesFromConfiguredInfo,
  mapProviderTypeToChatModelProvider,
  providerRequiresApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { getModelKeyFromModel, settingsStore, useSettingsValue } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import { useAtomValue } from "jotai";
import React from "react";

export interface ChatModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
}

const NOOP = () => {};

const EMPTY_LOCKED_ROWS: readonly ModelSelectorEntry[] = Object.freeze([]);

const EMPTY_ENTRY: ModelSelectorEntry = {
  name: "__chat_no_models__",
  provider: "",
  displayName: "No models — enable in Basic → Agents → Quick Chat",
  enabled: true,
  _disabledReason: "Add a model",
};
const EMPTY_ENTRY_KEY = getModelKeyFromModel(EMPTY_ENTRY);

const UNAVAILABLE_ENTRY: ModelSelectorEntry = {
  name: "__chat_model_unavailable__",
  provider: "",
  displayName: "Model unavailable — choose another",
  enabled: true,
  _disabledReason: "Choose another model",
};
const UNAVAILABLE_ENTRY_KEY = getModelKeyFromModel(UNAVAILABLE_ENTRY);

export function useChatModelPicker(params: {
  value: string | undefined;
  fallbackToFirst?: boolean;
  onChange: (configuredModelId: string) => void;
}): ChatModelPickerOverride {
  const { value, onChange, fallbackToFirst = true } = params;
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  const settings = useSettingsValue();

  const lockedRows = React.useMemo(
    () =>
      shouldPreviewCopilotModels(settings.providers)
        ? lockedCopilotEntries(settings.copilotPlusCatalog)
        : EMPTY_LOCKED_ROWS,
    [settings.providers, settings.copilotPlusCatalog]
  );

  const { models, byModelKey, idToModelKey } = React.useMemo(() => {
    const models: ModelSelectorEntry[] = [];
    const byModelKey = new Map<string, string>();
    const idToModelKey = new Map<string, string>();
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      const { configuredModel, provider, configuredModelId } = entry;
      const capabilities = capabilitiesFromConfiguredInfo(configuredModel.info);
      const needsKey = providerRequiresApiKey(provider) && !provider.apiKeyKeychainId;
      const modelEntry: ModelSelectorEntry = {
        name: configuredModelId,
        provider: mapProviderTypeToChatModelProvider(provider),
        displayName: configuredModel.info.displayName || configuredModel.info.id,
        enabled: true,
        capabilities,
        _disabledReason: needsKey ? "Add API key" : undefined,
        _needsSelfHostWarning: entry.needsSelfHostWarning,
      };
      const modelKey = getModelKeyFromModel(modelEntry);
      models.push(modelEntry);
      byModelKey.set(modelKey, configuredModelId);
      idToModelKey.set(configuredModelId, modelKey);
    }
    return { models, byModelKey, idToModelKey };
  }, [entries]);

  const resolvedValue = React.useMemo(() => {
    const resolvedId = resolveChatModelSelectionId(entries, value, fallbackToFirst, {
      configuredModels: settings.configuredModels,
      providers: Object.values(settings.providers),
    });
    const current = resolvedId ? idToModelKey.get(resolvedId) : undefined;
    if (current) return current;
    // Some direct-provider selections deliberately fail closed instead of
    // inheriting another account or provider. Keep that security decision
    // visible and let the user make the replacement choice explicitly.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    return fallbackToFirst && models.length > 0 ? UNAVAILABLE_ENTRY_KEY : "";
  }, [
    entries,
    value,
    idToModelKey,
    models.length,
    settings.configuredModels,
    settings.providers,
    fallbackToFirst,
  ]);

  const displayModels = React.useMemo(() => {
    if (!models.some((m) => m._needsSelfHostWarning)) return models;
    const local: ModelSelectorEntry[] = [];
    const cloud: ModelSelectorEntry[] = [];
    for (const m of models) (m._needsSelfHostWarning ? cloud : local).push(m);
    return [...local, ...cloud];
  }, [models]);

  const handleChange = React.useCallback(
    (modelKey: string) => {
      const id = byModelKey.get(modelKey);
      if (id) onChange(id);
    },
    [byModelKey, onChange]
  );

  if (displayModels.length === 0) {
    return { models: [...lockedRows, EMPTY_ENTRY], value: EMPTY_ENTRY_KEY, onChange: NOOP };
  }

  const pickerModels =
    resolvedValue === UNAVAILABLE_ENTRY_KEY ? [UNAVAILABLE_ENTRY, ...displayModels] : displayModels;

  return {
    models: lockedRows.length > 0 ? [...lockedRows, ...pickerModels] : pickerModels,
    value: resolvedValue,
    onChange: handleChange,
  };
}
