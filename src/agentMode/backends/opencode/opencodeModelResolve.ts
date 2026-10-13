import { isOpencodeZenWireId } from "@/utils/opencodeModelId";
import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import {
  capabilitiesFromConfiguredInfo,
  providerNeedsSelfHostWarning,
  providerRequiresApiKey,
} from "@/modelManagement";
import type { EnabledModelCredentialState, EnabledModelEntry } from "@/agentMode/session/types";
import {
  deepSeekOpencodeProviderIdOverride,
  normalizeOpencodeSelectionBaseId,
  reconcileDeepSeekOpencodePickerCandidates,
  resolveOpencodeConfiguredModelIdentity,
} from "@/agentMode/backends/opencode/deepseekOpencodePolicy";
import type { DeepSeekOpencodePickerCandidate } from "@/agentMode/backends/opencode/deepseekOpencodePolicy";

export { normalizeOpencodeSelectionBaseId, resolveOpencodeConfiguredModelIdentity };

export interface OpencodeProviderMapping {
  id: string;
  native: boolean;
}

export const COPILOT_PLUS_OPENCODE_PROVIDER_ID = "copilot-plus";

export function copilotPlusModelId(wireModelId: string | null | undefined): string | null {
  const prefix = `${COPILOT_PLUS_OPENCODE_PROVIDER_ID}/`;
  if (typeof wireModelId !== "string" || !wireModelId.startsWith(prefix)) return null;
  return wireModelId.slice(prefix.length);
}

const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

export function mapProviderToOpencodeId(provider: Provider): OpencodeProviderMapping | null {
  switch (provider.origin.kind) {
    case "byok": {
      const catalogProviderId = provider.origin.catalogProviderId;
      if (catalogProviderId) {
        const providerIdOverride = deepSeekOpencodeProviderIdOverride(provider);
        // Provider-specific compatibility policy may isolate a catalog route.
        // https://github.com/yydspanda/obsidian-copilot/issues/3
        if (providerIdOverride) return { id: providerIdOverride, native: false };
        return { id: catalogProviderId, native: false };
      }
      if (provider.providerType === "openai-compatible") {
        return { id: provider.providerId, native: false };
      }
      return null;
    }
    case "copilot-plus":
      return { id: COPILOT_PLUS_OPENCODE_PROVIDER_ID, native: false };
    case "agent":
      return { id: provider.providerId, native: true };
    default:
      return null;
  }
}

function opencodeWireBaseId(provider: Provider, configuredModel: ConfiguredModel): string | null {
  const mapping = mapProviderToOpencodeId(provider);
  if (!mapping) return null;
  const modelIdentity = resolveOpencodeConfiguredModelIdentity(provider, configuredModel);
  if (!modelIdentity) return null;
  return mapping.native ? modelIdentity : `${mapping.id}/${modelIdentity}`;
}

export function opencodeWireBaseIdFor(
  configuredModelId: string,
  settings: CopilotSettings
): string | null {
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === configuredModelId
  );
  if (!configuredModel) return null;
  const provider = settings.providers[configuredModel.providerId];
  if (!provider) return null;
  return opencodeWireBaseId(provider, configuredModel);
}

function credentialStateFor(provider: Provider, native: boolean): EnabledModelCredentialState {
  if (native) return "ok";
  if (providerRequiresApiKey(provider) && !provider.apiKeyKeychainId) return "missing_key";
  return "ok";
}

export function opencodeEnabledModelEntries(
  settings: CopilotSettings
): readonly EnabledModelEntry[] {
  const enabledIds = settings.backends.opencode?.enabledModels ?? [];
  if (enabledIds.length === 0) return EMPTY_ENABLED_ENTRIES;

  const modelsById = new Map<string, ConfiguredModel>();
  for (const model of settings.configuredModels) {
    modelsById.set(model.configuredModelId, model);
  }

  const candidates: DeepSeekOpencodePickerCandidate[] = [];
  for (const configuredModelId of enabledIds) {
    const configuredModel = modelsById.get(configuredModelId);
    if (!configuredModel) continue;
    const provider = settings.providers[configuredModel.providerId];
    if (!provider) continue;
    const mapping = mapProviderToOpencodeId(provider);
    if (!mapping) continue;
    const baseModelId = opencodeWireBaseId(provider, configuredModel);
    if (!baseModelId) continue;
    const name = configuredModel.info.displayName || configuredModel.info.id;
    // opencode labels models by provider id, which is a UUID for custom endpoints;
    // a blank provider name would read worse than that UUID, so it keeps opencode's label.
    // https://github.com/logancyang/obsidian-copilot/issues/3496
    const isCustomEndpoint = provider.origin.kind === "byok" && !provider.origin.catalogProviderId;
    const providerName = provider.displayName.trim();
    const entry: EnabledModelEntry = {
      baseModelId,
      name,
      label: isCustomEndpoint && providerName ? `${providerName}/${name}` : undefined,
      description: configuredModel.info.description,
      credentialState: credentialStateFor(provider, mapping.native),
      isFree: isOpencodeZenWireId(baseModelId),
      capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
      needsSelfHostWarning: providerNeedsSelfHostWarning(provider, settings),
    };
    candidates.push({ entry, provider, configuredModel });
  }
  const entries = reconcileDeepSeekOpencodePickerCandidates(candidates);
  return entries.length === 0 ? EMPTY_ENABLED_ENTRIES : entries;
}
