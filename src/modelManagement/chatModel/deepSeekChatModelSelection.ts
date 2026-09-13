import { ChatModelProviders } from "@/constants";
import { resolveDeepSeekWireModelIdentity } from "@/LLMProviders/deepseekModelPolicy";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";
import { isCatalogProviderDefaultEndpoint } from "@/utils/providerBaseUrl";

type ResolvedChatBackendEntry = Extract<EnabledBackendEntry, { state: "ok" }>;

const EMPTY_MATCHES: readonly ResolvedChatBackendEntry[] = Object.freeze([]);
const DEEPSEEK_LEGACY_SUFFIX = `|${ChatModelProviders.DEEPSEEK}`;

/** Complete persisted inventory used to distinguish a missing row from a disabled owner. */
export interface ChatModelSelectionInventory {
  configuredModels: readonly ConfiguredModel[];
  providers: readonly Provider[];
}

function isOfficialDeepSeekEntry(entry: ResolvedChatBackendEntry): boolean {
  return (
    entry.provider.origin.kind === "byok" &&
    entry.provider.origin.catalogProviderId === "deepseek" &&
    (!entry.provider.baseUrl ||
      isCatalogProviderDefaultEndpoint("deepseek", entry.provider.baseUrl))
  );
}

function isCompatibleOfficialFlashSelection(
  entry: ResolvedChatBackendEntry,
  selection: string
): boolean {
  if (!selection.endsWith(DEEPSEEK_LEGACY_SUFFIX) || !isOfficialDeepSeekEntry(entry)) {
    return false;
  }
  const selectionIdentity = selection.slice(0, -DEEPSEEK_LEGACY_SUFFIX.length);
  const selectionWireIdentity = resolveDeepSeekWireModelIdentity(selectionIdentity);
  return (
    selectionWireIdentity !== undefined &&
    resolveDeepSeekWireModelIdentity(entry.configuredModel.info.id) === selectionWireIdentity
  );
}

/**
 * Applies the direct DeepSeek alias, retained-owner, and fail-closed policy to generic matches.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 *
 * @param entries - Enabled candidates in registry order
 * @param selection - Persisted configured-model ID or legacy selection key
 * @param isExactMatch - Upstream matcher for configured IDs and unchanged legacy keys
 * @param inventory - Optional retained rows used to detect disabled or ambiguous owners
 */
export function resolveDeepSeekChatModelSelection(
  entries: readonly ResolvedChatBackendEntry[],
  selection: string,
  isExactMatch: (entry: ResolvedChatBackendEntry, selection: string) => boolean,
  inventory?: ChatModelSelectionInventory
) {
  let matches: readonly ResolvedChatBackendEntry[] = entries.filter((entry) =>
    isExactMatch(entry, selection)
  );
  if (matches.length === 0) {
    const compatibleMatches = entries.filter((entry) =>
      isCompatibleOfficialFlashSelection(entry, selection)
    );
    matches = compatibleMatches.length > 0 ? compatibleMatches : EMPTY_MATCHES;
  }

  const providers = new Map(
    (inventory?.providers ?? []).map((provider) => [provider.providerId, provider])
  );
  const ownerProviderIds = new Set<string>();
  let exactOfficialSelection: ResolvedChatBackendEntry | undefined;
  for (const configuredModel of inventory?.configuredModels ?? []) {
    const provider = providers.get(configuredModel.providerId);
    if (!provider) continue;
    const entry: ResolvedChatBackendEntry = {
      configuredModelId: configuredModel.configuredModelId,
      state: "ok",
      configuredModel,
      provider,
    };
    if (isExactMatch(entry, selection) || isCompatibleOfficialFlashSelection(entry, selection)) {
      ownerProviderIds.add(provider.providerId);
    }
    if (configuredModel.configuredModelId === selection && isOfficialDeepSeekEntry(entry)) {
      exactOfficialSelection = entry;
    }
  }

  if (matches.length === 0 && exactOfficialSelection) {
    const wireIdentity = resolveDeepSeekWireModelIdentity(
      exactOfficialSelection.configuredModel.info.id
    );
    if (wireIdentity) {
      const replacementMatches = entries.filter(
        (entry) =>
          entry.provider.providerId === exactOfficialSelection.provider.providerId &&
          isOfficialDeepSeekEntry(entry) &&
          resolveDeepSeekWireModelIdentity(entry.configuredModel.info.id) === wireIdentity
      );
      matches = replacementMatches.length > 0 ? replacementMatches : EMPTY_MATCHES;
    }
  }

  const hasAmbiguousOwner = ownerProviderIds.size > 1;
  const requiresExplicitSelection =
    selection.endsWith(DEEPSEEK_LEGACY_SUFFIX) || exactOfficialSelection !== undefined;
  return {
    matches,
    hasAmbiguousOwner,
    mustFailClosed: requiresExplicitSelection && (matches.length !== 1 || hasAmbiguousOwner),
  };
}
