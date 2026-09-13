import { ChatModelProviders } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import { isChatModelSelectionForEntry } from "./chatModelSelection";
import {
  type ChatModelSelectionInventory,
  resolveDeepSeekChatModelSelection,
} from "./deepSeekChatModelSelection";

type ResolvedEntry = Extract<EnabledBackendEntry, { state: "ok" }>;

function provider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    origin: { kind: "byok", catalogProviderId: "deepseek" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function entry(configuredModelId: string, wireId: string, prov: Provider): ResolvedEntry {
  const configuredModel: ConfiguredModel = {
    configuredModelId,
    providerId: prov.providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
  return { configuredModelId, state: "ok", configuredModel, provider: prov };
}

function inventory(entries: readonly ResolvedEntry[]): ChatModelSelectionInventory {
  return {
    configuredModels: entries.map((candidate) => candidate.configuredModel),
    providers: [
      ...new Map(
        entries.map((candidate) => [candidate.provider.providerId, candidate.provider])
      ).values(),
    ],
  };
}

function resolve(
  entries: readonly ResolvedEntry[],
  selection: string,
  retainedInventory?: ChatModelSelectionInventory
) {
  return resolveDeepSeekChatModelSelection(
    entries,
    selection,
    isChatModelSelectionForEntry,
    retainedInventory
  );
}

describe("deepSeekChatModelSelection", () => {
  describe("resolveDeepSeekChatModelSelection()", () => {
    it("returns the generic exact match unchanged", () => {
      const exact = entry("exact", "deepseek-v4-flash", provider("official"));
      const compatible = entry("compatible", "deepseek-flash", provider("other"));

      expect(
        resolve([compatible, exact], `deepseek-v4-flash|${ChatModelProviders.DEEPSEEK}`).matches
      ).toEqual([exact]);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 maps the retired Flash alias only across official endpoint spellings", () => {
      const official = entry(
        "official",
        "deepseek-flash",
        provider("official", { baseUrl: "https://api.deepseek.com/v1/" })
      );
      const proxy = entry(
        "proxy",
        "deepseek-flash",
        provider("proxy", { baseUrl: "https://proxy.example/v1" })
      );

      const resolution = resolve(
        [official, proxy],
        `deepseek-v4-flash|${ChatModelProviders.DEEPSEEK}`
      );

      expect(resolution.matches).toEqual([official]);
      expect(resolution.mustFailClosed).toBe(false);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 fails closed for retired direct identities without a reviewed replacement", () => {
      const safe = entry(
        "safe",
        "gpt-5",
        provider("openai", { origin: { kind: "byok", catalogProviderId: "openai" } })
      );

      const resolution = resolve([safe], `deepseek-v4-pro|${ChatModelProviders.DEEPSEEK}`);

      expect(resolution.matches).toEqual([]);
      expect(resolution.mustFailClosed).toBe(true);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 counts aliases on one account once and rejects enabled matches across accounts", () => {
      const firstProvider = provider("first");
      const secondProvider = provider("second");
      const firstAlias = entry("first-alias", "deepseek-v4-flash", firstProvider);
      const firstCanonical = entry("first-canonical", "deepseek-flash", firstProvider);
      const secondCanonical = entry("second-canonical", "deepseek-flash", secondProvider);
      const selection = `deepseek-v4-flash|${ChatModelProviders.DEEPSEEK}`;

      const sameAccount = resolve(
        [firstCanonical],
        selection,
        inventory([firstAlias, firstCanonical])
      );
      expect(sameAccount.hasAmbiguousOwner).toBe(false);
      expect(sameAccount.mustFailClosed).toBe(false);

      const differentAccounts = resolve(
        [firstCanonical, secondCanonical],
        selection,
        inventory([firstAlias, firstCanonical, secondCanonical])
      );
      expect(differentAccounts.matches).toEqual([firstCanonical, secondCanonical]);
      expect(differentAccounts.hasAmbiguousOwner).toBe(true);
      expect(differentAccounts.mustFailClosed).toBe(true);
    });

    it.each([
      {
        description: "a disabled proxy alias and an enabled official canonical row",
        retainedKind: "proxy" as const,
      },
      {
        description: "a disabled official alias and an enabled proxy alias",
        retainedKind: "official" as const,
      },
    ])(
      "https://github.com/yydspanda/obsidian-copilot/issues/3 rejects $description owned by different accounts",
      ({ retainedKind }) => {
        const official = provider("official");
        const proxy = provider("proxy", { baseUrl: "https://proxy.example/v1" });
        const selection = `deepseek-v4-flash|${ChatModelProviders.DEEPSEEK}`;
        const retained =
          retainedKind === "proxy"
            ? entry("retained-proxy", "deepseek-v4-flash", proxy)
            : entry("retained-official", "deepseek-v4-flash", official);
        const enabled =
          retainedKind === "proxy"
            ? entry("enabled-official", "deepseek-flash", official)
            : entry("enabled-proxy", "deepseek-v4-flash", proxy);

        const resolution = resolve([enabled], selection, inventory([retained, enabled]));

        expect(resolution.hasAmbiguousOwner).toBe(true);
        expect(resolution.mustFailClosed).toBe(true);
      }
    );

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 replaces an opaque Flash UUID only with one equivalent enabled row on the same account", () => {
      const official = provider("official");
      const retired = entry("retired-uuid", "deepseek-v4-flash", official);
      const canonical = entry("canonical", "deepseek-flash", official);
      const otherAccount = entry("other", "deepseek-flash", provider("other"));
      const retainedInventory = inventory([retired, canonical, otherAccount]);

      const resolution = resolve([canonical, otherAccount], "retired-uuid", retainedInventory);

      expect(resolution.matches).toEqual([canonical]);
      expect(resolution.mustFailClosed).toBe(false);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects an opaque Flash UUID when one account has multiple equivalent enabled rows", () => {
      const official = provider("official");
      const retired = entry("retired-uuid", "deepseek-v4-flash", official);
      const canonical = entry("canonical", "deepseek-flash", official);
      const alias = entry("alias", "deepseek-v4-flash", official);

      const resolution = resolve(
        [canonical, alias],
        "retired-uuid",
        inventory([retired, canonical, alias])
      );

      expect(resolution.matches).toEqual([canonical, alias]);
      expect(resolution.hasAmbiguousOwner).toBe(false);
      expect(resolution.mustFailClosed).toBe(true);
    });

    it("leaves an ordinary provider's stale configured-model ID on the generic fallback policy", () => {
      const openai = provider("openai", {
        origin: { kind: "byok", catalogProviderId: "openai" },
      });
      const stale = entry("stale", "gpt-4", openai);
      const enabled = entry("enabled", "gpt-5", openai);

      const resolution = resolve([enabled], "stale", inventory([stale, enabled]));

      expect(resolution.matches).toEqual([]);
      expect(resolution.mustFailClosed).toBe(false);
    });
  });
});
