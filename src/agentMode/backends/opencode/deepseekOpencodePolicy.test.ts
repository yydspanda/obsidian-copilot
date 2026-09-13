import type {
  ConfiguredModel,
  EnabledBackendEntry,
  Provider,
  ProviderOrigin,
} from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import type { EnabledModelEntry } from "@/agentMode/session/types";
import {
  deepSeekOpencodeProviderIdOverride,
  hasAmbiguousDeepSeekOpencodeRoute,
  normalizeOpencodeSelectionBaseId,
  reconcileDeepSeekOpencodePickerCandidates,
  resolveOpencodeConfiguredModelIdentity,
} from "@/agentMode/backends/opencode/deepseekOpencodePolicy";

function provider(providerId: string, origin: ProviderOrigin, baseUrl?: string): Provider {
  return {
    providerId,
    providerType: "openai-compatible",
    displayName: providerId,
    origin,
    baseUrl,
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string, identity: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: identity, displayName: identity },
    configuredAt: 0,
  };
}

function settings(args: {
  providers?: Record<string, Provider>;
  configuredModels?: ConfiguredModel[];
  enabledModels?: string[];
}): CopilotSettings {
  return {
    providers: args.providers ?? {},
    configuredModels: args.configuredModels ?? [],
    backends: { opencode: { enabledModels: args.enabledModels ?? [] } },
  } as unknown as CopilotSettings;
}

function pickerEntry(baseModelId: string, name = baseModelId): EnabledModelEntry {
  return { baseModelId, name, credentialState: "ok" };
}

describe("deepseekOpencodePolicy", () => {
  describe("deepSeekOpencodeProviderIdOverride()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 isolates only custom compatible DeepSeek endpoints", () => {
      const official = provider(
        "official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://api.deepseek.com/v1"
      );
      const proxy = provider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://proxy.example/v1"
      );
      const openrouter = provider(
        "openrouter-row",
        { kind: "byok", catalogProviderId: "openrouter" },
        "https://proxy.example/v1"
      );

      expect(deepSeekOpencodeProviderIdOverride(official)).toBeUndefined();
      expect(deepSeekOpencodeProviderIdOverride(proxy)).toBe("proxy");
      expect(deepSeekOpencodeProviderIdOverride(openrouter)).toBeUndefined();
    });
  });

  describe("resolveOpencodeConfiguredModelIdentity()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 canonicalizes Flash and rejects Pro on the official route", () => {
      const official = provider(
        "official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://api.deepseek.com"
      );

      expect(
        resolveOpencodeConfiguredModelIdentity(
          official,
          model("flash", "official", "deepseek-v4-flash")
        )
      ).toBe("deepseek-flash");
      expect(
        resolveOpencodeConfiguredModelIdentity(
          official,
          model("pro", "official", "deepseek-v4-pro")
        )
      ).toBeNull();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 applies the official identity policy to native DeepSeek only", () => {
      const native = provider("opencode", { kind: "agent", agentType: "opencode" });
      const proxy = provider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://proxy.example/v1"
      );

      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          model("flash", "opencode", "deepseek/deepseek-v4-flash")
        )
      ).toBe("deepseek/deepseek-flash");
      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          model("pro", "opencode", "deepseek/deepseek-v4-pro")
        )
      ).toBeNull();
      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          model("other", "opencode", "opencode/big-pickle")
        )
      ).toBe("opencode/big-pickle");
      expect(
        resolveOpencodeConfiguredModelIdentity(
          proxy,
          model("proxy-pro", "proxy", "deepseek-v4-pro")
        )
      ).toBe("deepseek-v4-pro");
    });
  });

  describe("normalizeOpencodeSelectionBaseId()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 normalizes official Flash and rejects retired Pro", () => {
      const official = provider(
        "official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://api.deepseek.com/v1"
      );
      const snapshot = settings({
        providers: { official },
        configuredModels: [
          model("flash", "official", "deepseek-v4-flash"),
          model("pro", "official", "deepseek-v4-pro"),
        ],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", snapshot)).toBe(
        "deepseek/deepseek-flash"
      );
      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", snapshot)).toBeNull();
      expect(normalizeOpencodeSelectionBaseId("openrouter/deepseek-v4-pro", snapshot)).toBe(
        "openrouter/deepseek-v4-pro"
      );
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 migrates a sole enabled custom owner and blocks it while disabled", () => {
      const proxy = provider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://proxy.example/v1"
      );
      const configuredModel = model("proxy-pro", "proxy", "deepseek-v4-pro");
      const enabled = settings({
        providers: { proxy },
        configuredModels: [configuredModel],
        enabledModels: [configuredModel.configuredModelId],
      });
      const disabled = settings({ providers: { proxy }, configuredModels: [configuredModel] });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", enabled)).toBe(
        "proxy/deepseek-v4-pro"
      );
      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", disabled)).toBeNull();
    });

    it.each([true, false])(
      "https://github.com/yydspanda/obsidian-copilot/issues/3 rejects a shared alias with official and custom owners when proxyFirst=%s",
      (proxyFirst) => {
        const official = provider(
          "official",
          { kind: "byok", catalogProviderId: "deepseek" },
          "https://api.deepseek.com"
        );
        const proxy = provider(
          "proxy",
          { kind: "byok", catalogProviderId: "deepseek" },
          "https://proxy.example/v1"
        );
        const officialModel = model("official-flash", "official", "deepseek-flash");
        const proxyModel = model("proxy-flash", "proxy", "deepseek-v4-flash");
        const configuredModels = proxyFirst
          ? [proxyModel, officialModel]
          : [officialModel, proxyModel];
        const snapshot = settings({
          providers: { official, proxy },
          configuredModels,
          enabledModels: [officialModel.configuredModelId],
        });

        expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", snapshot)).toBeNull();
      }
    );

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects aliases shared by two official accounts and orphaned shared ids", () => {
      const first = provider("first", { kind: "byok", catalogProviderId: "deepseek" });
      const second = provider("second", { kind: "byok", catalogProviderId: "deepseek" });
      const snapshot = settings({
        providers: { first, second },
        configuredModels: [
          model("first-flash", "first", "deepseek-v4-flash"),
          model("second-flash", "second", "deepseek-flash"),
        ],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", snapshot)).toBeNull();
      expect(
        normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", settings({}))
      ).toBeNull();
    });
  });

  describe("reconcileDeepSeekOpencodePickerCandidates()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 prefers one provider's canonical row without reordering other entries", () => {
      const official = provider("official", {
        kind: "byok",
        catalogProviderId: "deepseek",
      });
      const alias = model("alias", "official", "deepseek-v4-flash");
      const canonical = model("canonical", "official", "deepseek-flash");
      const entries = reconcileDeepSeekOpencodePickerCandidates([
        {
          entry: pickerEntry("deepseek/deepseek-flash", "legacy"),
          provider: official,
          configuredModel: alias,
        },
        {
          entry: pickerEntry("openrouter/other", "other"),
          provider: provider("openrouter", { kind: "byok", catalogProviderId: "openrouter" }),
          configuredModel: model("other", "openrouter", "other"),
        },
        {
          entry: pickerEntry("deepseek/deepseek-flash", "canonical"),
          provider: official,
          configuredModel: canonical,
        },
      ]);

      expect(entries.map((entry) => entry.name)).toEqual(["canonical", "other"]);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 removes a shared picker route owned by two accounts", () => {
      const first = provider("first", { kind: "byok", catalogProviderId: "deepseek" });
      const second = provider("second", { kind: "byok", catalogProviderId: "deepseek" });

      expect(
        reconcileDeepSeekOpencodePickerCandidates([
          {
            entry: pickerEntry("deepseek/deepseek-flash"),
            provider: first,
            configuredModel: model("first", "first", "deepseek-v4-flash"),
          },
          {
            entry: pickerEntry("deepseek/deepseek-flash"),
            provider: second,
            configuredModel: model("second", "second", "deepseek-flash"),
          },
        ])
      ).toEqual([]);
    });
  });

  describe("hasAmbiguousDeepSeekOpencodeRoute()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 reports only supported official routes owned by multiple accounts", () => {
      const first = provider("first", { kind: "byok", catalogProviderId: "deepseek" });
      const second = provider("second", { kind: "byok", catalogProviderId: "deepseek" });
      const proxy = provider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "https://proxy.example/v1"
      );
      const ok = (owner: Provider, configuredModel: ConfiguredModel): EnabledBackendEntry => ({
        configuredModelId: configuredModel.configuredModelId,
        state: "ok",
        provider: owner,
        configuredModel,
      });

      expect(
        hasAmbiguousDeepSeekOpencodeRoute([
          ok(first, model("first", "first", "deepseek-v4-flash")),
          ok(second, model("second", "second", "deepseek-flash")),
        ])
      ).toBe(true);
      expect(
        hasAmbiguousDeepSeekOpencodeRoute([
          ok(first, model("alias", "first", "deepseek-v4-flash")),
          ok(first, model("canonical", "first", "deepseek-flash")),
          ok(second, model("retired", "second", "deepseek-v4-pro")),
          ok(proxy, model("proxy", "proxy", "deepseek-v4-flash")),
          { configuredModelId: "broken", state: "broken" },
        ])
      ).toBe(false);
    });
  });
});
