import { resolveDeepSeekWireModelIdentity } from "@/LLMProviders/deepseekModelPolicy";
import type { ConfiguredModel, EnabledBackendEntry, Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import type { EnabledModelEntry } from "@/agentMode/session/types";
import { isCatalogProviderDefaultEndpoint } from "@/utils/providerBaseUrl";

const DEEPSEEK_PROVIDER_ID = "deepseek";
const DEEPSEEK_PROVIDER_PREFIX = `${DEEPSEEK_PROVIDER_ID}/`;

interface DeepSeekOpencodeRoute {
  rawBaseId: string;
  resolvedModelIdentity: string | null;
  resolvedBaseId: string | null;
  legacyCatalogBaseId: string | null;
}

/** Input retained while DeepSeek picker aliases and owners are reconciled. */
export interface DeepSeekOpencodePickerCandidate {
  entry: EnabledModelEntry;
  provider: Provider;
  configuredModel: ConfiguredModel;
}

function isOfficialDeepSeekProvider(provider: Provider): boolean {
  return (
    provider.origin.kind === "byok" &&
    provider.origin.catalogProviderId === DEEPSEEK_PROVIDER_ID &&
    (!provider.baseUrl || isCatalogProviderDefaultEndpoint(DEEPSEEK_PROVIDER_ID, provider.baseUrl))
  );
}

function isCustomDeepSeekEndpoint(provider: Provider): boolean {
  return (
    provider.origin.kind === "byok" &&
    provider.origin.catalogProviderId === DEEPSEEK_PROVIDER_ID &&
    provider.providerType === "openai-compatible" &&
    !!provider.baseUrl &&
    !isCatalogProviderDefaultEndpoint(DEEPSEEK_PROVIDER_ID, provider.baseUrl)
  );
}

function resolveDeepSeekOpencodeRoute(
  provider: Provider,
  modelIdentity: string
): DeepSeekOpencodeRoute | undefined {
  if (isOfficialDeepSeekProvider(provider)) {
    const resolvedIdentity = resolveDeepSeekWireModelIdentity(modelIdentity);
    return {
      rawBaseId: `${DEEPSEEK_PROVIDER_PREFIX}${modelIdentity}`,
      resolvedModelIdentity: resolvedIdentity ?? null,
      resolvedBaseId: resolvedIdentity ? `${DEEPSEEK_PROVIDER_PREFIX}${resolvedIdentity}` : null,
      legacyCatalogBaseId: null,
    };
  }

  if (isCustomDeepSeekEndpoint(provider)) {
    return {
      rawBaseId: `${provider.providerId}/${modelIdentity}`,
      resolvedModelIdentity: modelIdentity,
      resolvedBaseId: `${provider.providerId}/${modelIdentity}`,
      legacyCatalogBaseId: `${DEEPSEEK_PROVIDER_PREFIX}${modelIdentity}`,
    };
  }

  if (
    provider.origin.kind === "agent" &&
    provider.origin.agentType === "opencode" &&
    modelIdentity.startsWith(DEEPSEEK_PROVIDER_PREFIX)
  ) {
    const bareIdentity = modelIdentity.slice(DEEPSEEK_PROVIDER_PREFIX.length);
    const resolvedIdentity = resolveDeepSeekWireModelIdentity(bareIdentity);
    return {
      rawBaseId: modelIdentity,
      resolvedModelIdentity: resolvedIdentity
        ? `${DEEPSEEK_PROVIDER_PREFIX}${resolvedIdentity}`
        : null,
      resolvedBaseId: resolvedIdentity ? `${DEEPSEEK_PROVIDER_PREFIX}${resolvedIdentity}` : null,
      legacyCatalogBaseId: null,
    };
  }

  return undefined;
}

/**
 * Returns the isolated provider namespace required by a custom DeepSeek
 * endpoint, or `undefined` when normal OpenCode provider mapping applies.
 *
 * @param provider - Persisted provider whose OpenCode namespace is being selected.
 */
export function deepSeekOpencodeProviderIdOverride(provider: Provider): string | undefined {
  // A compatible endpoint override cannot share the official provider key:
  // doing so mixes its route and credential with any enabled official row.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  return isCustomDeepSeekEndpoint(provider) ? provider.providerId : undefined;
}

/**
 * Resolves the DeepSeek-specific model identity for an OpenCode provider row.
 * `undefined` delegates to normal OpenCode behavior; `null` rejects a retired
 * official/native identity before provider I/O.
 *
 * @param provider - Persisted provider that owns the configured model.
 * @param modelIdentity - Configured bare model id, or native provider-prefixed id.
 */
function resolveDeepSeekOpencodeModelIdentity(
  provider: Provider,
  modelIdentity: string
): string | null | undefined {
  const route = resolveDeepSeekOpencodeRoute(provider, modelIdentity);
  if (!route) return undefined;
  return route.resolvedModelIdentity;
}

/**
 * Resolves the model identity OpenCode should expose for one configured row.
 * Official and native DeepSeek aliases become canonical, retired identities
 * return `null`, and every unrelated provider keeps its configured identity.
 *
 * @param provider - Provider row that establishes endpoint ownership.
 * @param configuredModel - Configured model whose identity is being resolved.
 */
export function resolveOpencodeConfiguredModelIdentity(
  provider: Provider,
  configuredModel: ConfiguredModel
): string | null {
  const resolvedIdentity = resolveDeepSeekOpencodeModelIdentity(provider, configuredModel.info.id);
  // The DeepSeek policy owns official/native aliases and retired identities.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  return resolvedIdentity === undefined ? configuredModel.info.id : resolvedIdentity;
}

/**
 * Resolves a persisted OpenCode selection, applying owner checks to the shared
 * DeepSeek namespace and passing every other namespace through unchanged.
 *
 * @param baseModelId - Persisted OpenCode `<provider>/<model>` identity.
 * @param settings - Current provider, configured-model, and enabled-model snapshot.
 */
export function normalizeOpencodeSelectionBaseId(
  baseModelId: string,
  settings: CopilotSettings
): string | null {
  // Only the shared DeepSeek namespace needs compatibility ownership checks.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (!baseModelId.startsWith(DEEPSEEK_PROVIDER_PREFIX)) return baseModelId;

  const selectedIdentity = resolveDeepSeekWireModelIdentity(
    baseModelId.slice(DEEPSEEK_PROVIDER_PREFIX.length)
  );
  const canonicalBaseId = selectedIdentity
    ? `${DEEPSEEK_PROVIDER_PREFIX}${selectedIdentity}`
    : null;
  const enabledModelIds = new Set(settings.backends?.opencode?.enabledModels ?? []);
  const resolutions = new Set<string | null>();
  const matchingProviderIds = new Set<string>();

  for (const configuredModel of settings.configuredModels) {
    const provider = settings.providers[configuredModel.providerId];
    if (!provider) continue;
    const route = resolveDeepSeekOpencodeRoute(provider, configuredModel.info.id);
    if (!route) continue;

    // Retained custom rows remain possible owners of their former shared id,
    // even while disabled. Only a sole enabled owner may migrate into its new
    // provider-specific namespace.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    if (baseModelId === route.legacyCatalogBaseId) {
      resolutions.add(
        enabledModelIds.has(configuredModel.configuredModelId) ? route.resolvedBaseId : null
      );
      matchingProviderIds.add(provider.providerId);
      continue;
    }

    if (
      baseModelId === route.rawBaseId ||
      baseModelId === route.resolvedBaseId ||
      (canonicalBaseId !== null && route.resolvedBaseId === canonicalBaseId)
    ) {
      resolutions.add(route.resolvedBaseId);
      matchingProviderIds.add(provider.providerId);
    }
  }

  // The shared prefix cannot choose between credentials, even when aliases
  // from both accounts converge on the same canonical wire identity.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (resolutions.size > 1 || matchingProviderIds.size > 1) return null;
  if (resolutions.size === 1) return [...resolutions][0] ?? null;

  // An orphaned shared id no longer proves whether it belonged to the official
  // service or a compatible proxy, so sending it would risk credential drift.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  return null;
}

/**
 * Collapses canonical DeepSeek picker aliases and removes shared routes owned
 * by more than one provider while preserving every other candidate in order.
 *
 * @param candidates - Routable picker entries paired with their persisted owners.
 */
export function reconcileDeepSeekOpencodePickerCandidates(
  candidates: readonly DeepSeekOpencodePickerCandidate[]
): readonly EnabledModelEntry[] {
  const out: EnabledModelEntry[] = [];
  const entryIndexByBaseId = new Map<string, number>();
  const providerByBaseId = new Map<string, string>();
  const ambiguousBaseIds = new Set<string>();

  for (const candidate of candidates) {
    const { entry, provider, configuredModel } = candidate;
    if (!entry.baseModelId.startsWith(DEEPSEEK_PROVIDER_PREFIX)) {
      out.push(entry);
      continue;
    }

    const priorIndex = entryIndexByBaseId.get(entry.baseModelId);
    const priorProviderId = providerByBaseId.get(entry.baseModelId);
    if (priorIndex !== undefined && priorProviderId !== provider.providerId) {
      // A shared catalog id cannot safely represent two DeepSeek accounts.
      // https://github.com/yydspanda/obsidian-copilot/issues/3
      ambiguousBaseIds.add(entry.baseModelId);
      continue;
    }
    if (priorIndex !== undefined) {
      const resolvedIdentity = resolveDeepSeekOpencodeModelIdentity(
        provider,
        configuredModel.info.id
      );
      // Prefer a current canonical row when one provider retains both spellings.
      // https://github.com/yydspanda/obsidian-copilot/issues/3
      if (resolvedIdentity === undefined || resolvedIdentity === configuredModel.info.id) {
        out[priorIndex] = entry;
      }
      continue;
    }
    entryIndexByBaseId.set(entry.baseModelId, out.length);
    providerByBaseId.set(entry.baseModelId, provider.providerId);
    out.push(entry);
  }

  return ambiguousBaseIds.size === 0
    ? out
    : out.filter((entry) => !ambiguousBaseIds.has(entry.baseModelId));
}

/**
 * Returns whether enabled official DeepSeek rows would collapse two accounts
 * onto OpenCode's single catalog provider key.
 *
 * @param entries - Current backend registry resolution, including broken rows.
 */
export function hasAmbiguousDeepSeekOpencodeRoute(
  entries: readonly EnabledBackendEntry[]
): boolean {
  const providerIds = new Set<string>();
  for (const entry of entries) {
    if (
      entry.state !== "ok" ||
      !isOfficialDeepSeekProvider(entry.provider) ||
      !resolveDeepSeekWireModelIdentity(entry.configuredModel.info.id)
    ) {
      continue;
    }
    providerIds.add(entry.provider.providerId);
    // One shared OpenCode catalog route cannot choose between credentials.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    if (providerIds.size > 1) return true;
  }
  return false;
}
