import {
  backendPickerAtomFamily,
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

/**
 * Minimal `ChatInput.modelPickerOverride` shape for the non-agent chat picker.
 * Omitting `effort`/`commitSelection` makes `ChatInput` render the flat
 * `ModelSelector` (decision: no per-pick effort stepper for legacy chat).
 */
export interface ChatModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
}

const NOOP = () => {};

/** See AGENTS.md → "Referential stability". */
const EMPTY_LOCKED_ROWS: readonly ModelSelectorEntry[] = Object.freeze([]);

/**
 * Synthetic disabled row shown when no chat model is enabled, so the picker
 * trigger guides the user instead of rendering an empty dropdown.
 */
const EMPTY_ENTRY: ModelSelectorEntry = {
  name: "__chat_no_models__",
  provider: "",
  displayName: "No models — enable in Basic → Agents → Quick Chat",
  enabled: true,
  _disabledReason: "Add a model",
};
const EMPTY_ENTRY_KEY = getModelKeyFromModel(EMPTY_ENTRY);

/**
 * Synthetic disabled row shown when a retained selection is intentionally not
 * allowed to fall through to a different model.
 */
const UNAVAILABLE_ENTRY: ModelSelectorEntry = {
  name: "__chat_model_unavailable__",
  provider: "",
  displayName: "Model unavailable — choose another",
  enabled: true,
  _disabledReason: "Choose another model",
};
const UNAVAILABLE_ENTRY_KEY = getModelKeyFromModel(UNAVAILABLE_ENTRY);

/**
 * Drives the chat model picker off the model-management "chat" backend
 * (`backends.chat.enabledModels`) instead of the legacy `settings.activeModels`.
 *
 * Picker entries are keyed by `configuredModelId` (a UUID) rather than the
 * legacy `name|provider` key; `value`/`onChange` translate between that id
 * (what the caller stores) and the `ModelSelector` model key internally. The
 * displayed value reflects the *effective* model — the stored selection if it's
 * still enabled, otherwise the runtime resolver's fallback or fail-closed result.
 */
export function useChatModelPicker(params: {
  /** Current selection — a `configuredModelId`. */
  value: string;
  /** Persist a new `configuredModelId` selection. */
  onChange: (configuredModelId: string) => void;
}): ChatModelPickerOverride {
  const { value, onChange } = params;
  const entries = useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore });
  const settings = useSettingsValue();

  // Advertised, never selectable: kept out of `models` below so selection,
  // fallback, and the stored value can never resolve to one.
  const lockedRows = React.useMemo(
    () =>
      shouldPreviewCopilotModels(settings.providers) ? lockedCopilotEntries() : EMPTY_LOCKED_ROWS,
    [settings.providers]
  );

  const { models, byModelKey, idToModelKey } = React.useMemo(() => {
    const models: ModelSelectorEntry[] = [];
    const byModelKey = new Map<string, string>();
    const idToModelKey = new Map<string, string>();
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      const { configuredModel, provider, configuredModelId } = entry;
      // Leave capabilities `undefined` when the snapshot carries no modality
      // data so unknown models stay unblocked; only a populated array (which may
      // be empty) asserts "known". See the image guard in `Chat.tsx`.
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
    const resolvedId = resolveChatModelSelectionId(entries, value, {
      configuredModels: settings.configuredModels,
      providers: Object.values(settings.providers),
    });
    const current = resolvedId ? idToModelKey.get(resolvedId) : undefined;
    if (current) return current;
    // Some direct-provider selections deliberately fail closed instead of
    // inheriting another account or provider. Keep that security decision
    // visible and let the user make the replacement choice explicitly.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    return models.length > 0 ? UNAVAILABLE_ENTRY_KEY : "";
  }, [entries, value, idToModelKey, models.length, settings.configuredModels, settings.providers]);

  // Display order only: Self-Host Mode sinks cloud (warned) models to the
  // bottom via a stable partition. Selection/fallback stay on the unsorted
  // `models` above, so this never shifts which model a stale selection lands on.
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
    // A brand-new user has no models at all, which is exactly who most needs to
    // learn the Copilot lineup exists — so the locked rows lead, and the
    // guidance row still explains how to add one of their own.
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
