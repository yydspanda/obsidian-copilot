import { ChatModelProviders } from "@/constants";
import {
  type ChatModelSelectionInventory,
  resolveDeepSeekChatModelSelection,
} from "@/modelManagement/chatModel/deepSeekChatModelSelection";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import {
  CATALOG_ID_TO_CHAT_PROVIDER,
  mapProviderTypeToChatModelProvider,
} from "./configuredModelToCustomModel";

export type ResolvedChatBackendEntry = Extract<EnabledBackendEntry, { state: "ok" }>;
export type { ChatModelSelectionInventory } from "@/modelManagement/chatModel/deepSeekChatModelSelection";

const EMPTY_RESOLVED_CHAT_BACKEND_ENTRIES: readonly ResolvedChatBackendEntry[] = Object.freeze([]);

const DISPLAY_NAME_TO_LEGACY_PROVIDER: Record<string, ChatModelProviders> = {
  ollama: ChatModelProviders.OLLAMA,
  "lm studio": ChatModelProviders.LM_STUDIO,
  "openai format": ChatModelProviders.OPENAI_FORMAT,
  cohere: ChatModelProviders.COHEREAI,
  siliconflow: ChatModelProviders.SILICONFLOW,
};

function getLegacyChatModelKeys(entry: ResolvedChatBackendEntry): readonly string[] {
  const providers = new Set<ChatModelProviders>([
    mapProviderTypeToChatModelProvider(entry.provider),
  ]);
  if (entry.provider.origin.kind === "copilot-plus") {
    providers.add(ChatModelProviders.COPILOT_PLUS);
  }
  if (entry.provider.origin.kind === "byok" && entry.provider.origin.catalogProviderId) {
    const catalogProvider = CATALOG_ID_TO_CHAT_PROVIDER[entry.provider.origin.catalogProviderId];
    if (catalogProvider) providers.add(catalogProvider);
  }
  const displayProvider = DISPLAY_NAME_TO_LEGACY_PROVIDER[entry.provider.displayName.toLowerCase()];
  if (displayProvider) providers.add(displayProvider);

  return [...providers].map((provider) => `${entry.configuredModel.info.id}|${provider}`);
}

export function isChatModelSelectionForEntry(
  entry: ResolvedChatBackendEntry,
  selection: string
): boolean {
  return entry.configuredModelId === selection || getLegacyChatModelKeys(entry).includes(selection);
}

/**
 * Whether a legacy selection can name more than one retained provider, including disabled rows.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 *
 * @param inventory - All retained configured models and their provider accounts
 * @param selection - Persisted configured-model ID or legacy selection key
 */
export function hasAmbiguousPersistedChatModelSelection(
  inventory: ChatModelSelectionInventory,
  selection: string
): boolean {
  return resolveDeepSeekChatModelSelection(
    EMPTY_RESOLVED_CHAT_BACKEND_ENTRIES,
    selection,
    isChatModelSelectionForEntry,
    inventory
  ).hasAmbiguousOwner;
}

export function findChatBackendEntryMatches(
  entries: readonly EnabledBackendEntry[],
  selection: string
): readonly ResolvedChatBackendEntry[] {
  const okEntries = entries.filter(
    (entry): entry is ResolvedChatBackendEntry => entry.state === "ok"
  );
  return resolveDeepSeekChatModelSelection(okEntries, selection, isChatModelSelectionForEntry)
    .matches;
}

export function findChatBackendEntry(
  entries: readonly EnabledBackendEntry[],
  preferredSelection: string | undefined,
  fallbackToFirst = true,
  inventory?: ChatModelSelectionInventory
): ResolvedChatBackendEntry | undefined {
  const okEntries = entries.filter(
    (entry): entry is ResolvedChatBackendEntry => entry.state === "ok"
  );
  // Commands must ask for a model instead of silently changing providers. https://github.com/Brevilabs/obsidian-copilot-private/issues/616
  const fallback = fallbackToFirst ? okEntries[0] : undefined;
  if (!preferredSelection) return fallback;

  const resolution = resolveDeepSeekChatModelSelection(
    okEntries,
    preferredSelection,
    isChatModelSelectionForEntry,
    inventory
  );
  // Direct DeepSeek selections must not inherit an unrelated first enabled
  // row or another account when the saved identity is retired or ambiguous.
  // Retained disabled rows participate because they preserve the historical
  // provider owner even though they are not eligible request targets. Other
  // providers retain the historical stale-selection fallback.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (resolution.mustFailClosed) return undefined;
  return resolution.matches[0] ?? fallback;
}

export function resolveChatModelSelectionId(
  entries: readonly EnabledBackendEntry[],
  selection: string | undefined,
  fallbackToFirst = true,
  inventory?: ChatModelSelectionInventory
): string | undefined {
  return findChatBackendEntry(entries, selection, fallbackToFirst, inventory)?.configuredModelId;
}
