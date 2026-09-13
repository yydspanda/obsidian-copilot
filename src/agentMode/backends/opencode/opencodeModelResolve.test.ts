import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider, ProviderOrigin, ProviderType } from "@/modelManagement";
import { ChatModelProviders } from "@/constants";
import {
  COPILOT_PLUS_OPENCODE_PROVIDER_ID,
  copilotPlusModelId,
  isOpencodeZenWireId,
  mapProviderToOpencodeId,
  normalizeOpencodeSelectionBaseId,
  opencodeEnabledModelEntries,
  opencodeWireBaseIdFor,
  resolveOpencodeConfiguredModelIdentity,
} from "./opencodeModelResolve";

/** Build a minimal `Provider` row for a given origin + type. */
function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  providerType: ProviderType = "anthropic",
  baseUrl?: string
): Provider {
  return {
    providerId,
    providerType,
    displayName: providerId,
    origin,
    baseUrl,
    addedAt: 0,
  };
}

/** Build a minimal `ConfiguredModel` row. */
function makeModel(configuredModelId: string, providerId: string, wireId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
}

/**
 * Assemble a `CopilotSettings`-shaped object with only the slices
 * `opencodeEnabledModelEntries` reads. Cast through `unknown` since the resolver
 * touches just `backends` / `configuredModels` / `providers`.
 */
function makeSettings(args: {
  enabledModels?: string[];
  configuredModels?: ConfiguredModel[];
  providers?: Record<string, Provider>;
  enableSelfHostMode?: boolean;
}): CopilotSettings {
  return {
    backends:
      args.enabledModels === undefined ? {} : { opencode: { enabledModels: args.enabledModels } },
    configuredModels: args.configuredModels ?? [],
    providers: args.providers ?? {},
    enableSelfHostMode: args.enableSelfHostMode ?? false,
  } as unknown as CopilotSettings;
}

describe("opencodeModelResolve", () => {
  describe("mapProviderToOpencodeId()", () => {
    it("maps a BYOK provider with a catalog id to that id, non-native", () => {
      const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "anthropic", native: false });
    });

    it("maps BYOK openrouter to openrouter, non-native", () => {
      const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "openrouter" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "openrouter", native: false });
    });

    it("keeps an OpenRouter endpoint override on the existing catalog route", () => {
      const provider = makeProvider(
        "p1",
        { kind: "byok", catalogProviderId: "openrouter" },
        "openai-compatible",
        "https://openrouter.example/v1"
      );
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "openrouter", native: false });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 gives a custom catalog-compatible endpoint its stable provider id", () => {
      const provider = makeProvider(
        "deepseek-proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );

      expect(mapProviderToOpencodeId(provider)).toEqual({
        id: "deepseek-proxy",
        native: false,
      });
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 keeps a nonstandard path on the DeepSeek origin in a custom provider namespace", () => {
      const provider = makeProvider(
        "deepseek-proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://api.deepseek.com/openai/v1"
      );

      expect(mapProviderToOpencodeId(provider)).toEqual({
        id: "deepseek-proxy",
        native: false,
      });
    });

    it("returns null for a non-OpenAI-compatible BYOK provider without a catalog id", () => {
      const provider = makeProvider("p1", { kind: "byok" });
      expect(mapProviderToOpencodeId(provider)).toBeNull();
    });

    it("maps an OpenAI-compatible BYOK provider without a catalog id to its providerId", () => {
      const provider = makeProvider("p1", { kind: "byok" }, "openai-compatible");
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "p1", native: false });
    });

    it("returns null for a google BYOK provider without a catalog id", () => {
      expect(mapProviderToOpencodeId(makeProvider("p1", { kind: "byok" }, "google"))).toBeNull();
    });

    it("maps copilot-plus origin to the reserved copilot-plus id, non-native", () => {
      const provider = makeProvider("p1", { kind: "copilot-plus" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "copilot-plus", native: false });
    });

    it("maps an agent-origin provider to its providerId, native", () => {
      const provider = makeProvider("opencode-provider", { kind: "agent", agentType: "opencode" });
      expect(mapProviderToOpencodeId(provider)).toEqual({
        id: "opencode-provider",
        native: true,
      });
    });
  });

  describe("isOpencodeZenWireId()", () => {
    it("matches the opencode/ prefix only", () => {
      expect(isOpencodeZenWireId("opencode/big-pickle")).toBe(true);
      expect(isOpencodeZenWireId("opencode/deepseek-v4-flash-free")).toBe(true);
      expect(isOpencodeZenWireId("lmstudio/gpt-oss-20b")).toBe(false);
      expect(isOpencodeZenWireId("openrouter/anthropic/claude")).toBe(false);
      expect(isOpencodeZenWireId("opencode-zen/x")).toBe(false); // prefix must be exactly `opencode/`
    });
  });

  describe("resolveOpencodeConfiguredModelIdentity()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 canonicalizes legacy Flash and rejects Pro only for official DeepSeek", () => {
      const official = makeProvider(
        "official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://api.deepseek.com"
      );
      const proxy = makeProvider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );

      expect(
        resolveOpencodeConfiguredModelIdentity(
          official,
          makeModel("flash", "official", "deepseek-v4-flash")
        )
      ).toBe("deepseek-flash");
      expect(
        resolveOpencodeConfiguredModelIdentity(
          official,
          makeModel("pro", "official", "deepseek-v4-pro")
        )
      ).toBeNull();
      expect(
        resolveOpencodeConfiguredModelIdentity(
          proxy,
          makeModel("proxy-pro", "proxy", "deepseek-v4-pro")
        )
      ).toBe("deepseek-v4-pro");
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 canonicalizes Flash and rejects Pro in OpenCode's native DeepSeek namespace", () => {
      const native = makeProvider("opencode", { kind: "agent", agentType: "opencode" });

      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          makeModel("flash", "opencode", "deepseek/deepseek-v4-flash")
        )
      ).toBe("deepseek/deepseek-flash");
      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          makeModel("pro", "opencode", "deepseek/deepseek-v4-pro")
        )
      ).toBeNull();
      expect(
        resolveOpencodeConfiguredModelIdentity(
          native,
          makeModel("other", "opencode", "opencode/big-pickle")
        )
      ).toBe("opencode/big-pickle");
    });
  });

  describe("normalizeOpencodeSelectionBaseId()", () => {
    it("https://github.com/yydspanda/obsidian-copilot/issues/3 normalizes persisted Flash and blocks Pro before OpenCode applies them", () => {
      const official = makeProvider(
        "official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://api.deepseek.com/v1"
      );
      const settings = makeSettings({
        providers: { official },
        configuredModels: [
          makeModel("flash", "official", "deepseek-v4-flash"),
          makeModel("pro", "official", "deepseek-v4-pro"),
        ],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", settings)).toBe(
        "deepseek/deepseek-flash"
      );
      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", settings)).toBeNull();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 preserves custom endpoints only in their unique namespace and fails closed on orphaned official selections", () => {
      const proxy = makeProvider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );
      const settings = makeSettings({
        enabledModels: ["proxy-pro"],
        providers: { proxy },
        configuredModels: [makeModel("proxy-pro", "proxy", "deepseek-v4-pro")],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", settings)).toBe(
        "proxy/deepseek-v4-pro"
      );
      expect(normalizeOpencodeSelectionBaseId("proxy/deepseek-v4-pro", settings)).toBe(
        "proxy/deepseek-v4-pro"
      );
      expect(
        normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", makeSettings({}))
      ).toBeNull();
      expect(
        normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", makeSettings({}))
      ).toBeNull();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 does not let a disabled custom proxy claim an old shared DeepSeek selection", () => {
      const proxy = makeProvider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );
      const settings = makeSettings({
        enabledModels: [],
        providers: { proxy },
        configuredModels: [makeModel("proxy-pro", "proxy", "deepseek-v4-pro")],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", settings)).toBeNull();
    });

    it.each([
      {
        description: "an enabled official canonical row after a retained disabled proxy alias",
        enabledModels: ["official-flash"],
        officialWireId: "deepseek-flash",
        proxyFirst: true,
      },
      {
        description: "an enabled official canonical row before a retained disabled proxy alias",
        enabledModels: ["official-flash"],
        officialWireId: "deepseek-flash",
        proxyFirst: false,
      },
      {
        description: "an enabled proxy alias after a retained disabled official alias",
        enabledModels: ["proxy-flash"],
        officialWireId: "deepseek-v4-flash",
        proxyFirst: false,
      },
      {
        description: "an enabled proxy alias before a retained disabled official alias",
        enabledModels: ["proxy-flash"],
        officialWireId: "deepseek-v4-flash",
        proxyFirst: true,
      },
    ])(
      "https://github.com/yydspanda/obsidian-copilot/issues/3 returns null for $description",
      ({ enabledModels, officialWireId, proxyFirst }) => {
        const official = makeProvider(
          "official",
          { kind: "byok", catalogProviderId: "deepseek" },
          "openai-compatible",
          "https://api.deepseek.com/v1"
        );
        const proxy = makeProvider(
          "proxy",
          { kind: "byok", catalogProviderId: "deepseek" },
          "openai-compatible",
          "https://proxy.example/v1"
        );
        const officialModel = makeModel("official-flash", "official", officialWireId);
        const proxyModel = makeModel("proxy-flash", "proxy", "deepseek-v4-flash");
        const configuredModels = proxyFirst
          ? [proxyModel, officialModel]
          : [officialModel, proxyModel];
        const settings = makeSettings({
          enabledModels,
          providers: { official, proxy },
          configuredModels,
        });

        expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", settings)).toBeNull();
      }
    );

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 normalizes native Flash and blocks native Pro even when a custom proxy row has the same bare id", () => {
      const native = makeProvider("opencode", { kind: "agent", agentType: "opencode" });
      const proxy = makeProvider(
        "proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );
      const settings = makeSettings({
        providers: { opencode: native, proxy },
        configuredModels: [
          makeModel("native-flash", "opencode", "deepseek/deepseek-v4-flash"),
          makeModel("native-pro", "opencode", "deepseek/deepseek-v4-pro"),
          makeModel("proxy-pro", "proxy", "deepseek-v4-pro"),
        ],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", settings)).toBe(
        "deepseek/deepseek-flash"
      );
      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-pro", settings)).toBeNull();
      expect(normalizeOpencodeSelectionBaseId("proxy/deepseek-v4-pro", settings)).toBe(
        "proxy/deepseek-v4-pro"
      );
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects a shared DeepSeek selection owned by two configured accounts", () => {
      const first = makeProvider(
        "first",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible"
      );
      const second = makeProvider(
        "second",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible"
      );
      const settings = makeSettings({
        providers: { first, second },
        configuredModels: [
          makeModel("first-flash", "first", "deepseek-v4-flash"),
          makeModel("second-flash", "second", "deepseek-flash"),
        ],
      });

      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-v4-flash", settings)).toBeNull();
      expect(normalizeOpencodeSelectionBaseId("deepseek/deepseek-flash", settings)).toBeNull();
    });
  });

  describe("opencodeEnabledModelEntries()", () => {
    const byokProvider = (overrides: Partial<Provider> = {}): Provider => ({
      ...makeProvider("p1", { kind: "byok", catalogProviderId: "openrouter" }, "openai-compatible"),
      requiresApiKey: true,
      apiKeyKeychainId: "kc-1",
      ...overrides,
    });

    it("flags a required-key provider with no key as missing_key", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: byokProvider({ apiKeyKeychainId: null }) },
        configuredModels: [makeModel("cm1", "p1", "qwen/qwen3-max")],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.baseModelId).toBe("openrouter/qwen/qwen3-max");
      expect(entry.credentialState).toBe("missing_key");
    });

    it("reports a keyed, never-failed provider as ok with its display name", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: byokProvider() },
        configuredModels: [
          {
            configuredModelId: "cm1",
            providerId: "p1",
            info: { id: "x", displayName: "Big X" },
            configuredAt: 0,
          },
        ],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.credentialState).toBe("ok");
      expect(entry.name).toBe("Big X");
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 exposes canonical Flash and omits retiring Pro for official DeepSeek", () => {
      const deepseek = makeProvider(
        "deepseek-official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://api.deepseek.com"
      );
      const settings = makeSettings({
        enabledModels: ["flash", "pro"],
        providers: { "deepseek-official": deepseek },
        configuredModels: [
          makeModel("flash", "deepseek-official", "deepseek-v4-flash"),
          makeModel("pro", "deepseek-official", "deepseek-v4-pro"),
        ],
      });

      expect(opencodeEnabledModelEntries(settings).map((entry) => entry.baseModelId)).toEqual([
        "deepseek/deepseek-flash",
      ]);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 collapses one provider's alias and canonical row to one canonical picker entry", () => {
      const deepseek = makeProvider(
        "deepseek-official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible"
      );
      const settings = makeSettings({
        enabledModels: ["alias", "canonical"],
        providers: { "deepseek-official": deepseek },
        configuredModels: [
          makeModel("alias", "deepseek-official", "deepseek-v4-flash"),
          makeModel("canonical", "deepseek-official", "deepseek-flash"),
        ],
      });

      expect(opencodeEnabledModelEntries(settings).map((entry) => entry.baseModelId)).toEqual([
        "deepseek/deepseek-flash",
      ]);
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 omits a shared DeepSeek picker entry owned by two accounts", () => {
      const first = makeProvider(
        "first",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible"
      );
      const second = makeProvider(
        "second",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible"
      );
      const settings = makeSettings({
        enabledModels: ["first-flash", "second-flash"],
        providers: { first, second },
        configuredModels: [
          makeModel("first-flash", "first", "deepseek-v4-flash"),
          makeModel("second-flash", "second", "deepseek-flash"),
        ],
      });

      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });

    it("treats agent-origin (native) models as ok regardless of key", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [makeModel("cm1", "p1", "opencode/big-pickle")],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.baseModelId).toBe("opencode/big-pickle");
      expect(entry.credentialState).toBe("ok");
    });

    it("flags opencode Zen models (opencode/ prefix) as free, others not", () => {
      const settings = makeSettings({
        enabledModels: ["zen", "lms"],
        providers: { p1: makeProvider("p1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [
          makeModel("zen", "p1", "opencode/big-pickle"),
          makeModel("lms", "p1", "lmstudio/gpt-oss-20b"),
        ],
      });
      const byId = new Map(opencodeEnabledModelEntries(settings).map((e) => [e.baseModelId, e]));
      expect(byId.get("opencode/big-pickle")?.isFree).toBe(true);
      expect(byId.get("lmstudio/gpt-oss-20b")?.isFree).toBe(false);
    });

    it("flags cloud-hosted models with needsSelfHostWarning when Self-Host Mode is on", () => {
      // opencode is self-hostable, but it can host cloud BYOK providers — those
      // models must still carry the cloud-egress warning; local ones must not.
      const settings = makeSettings({
        enableSelfHostMode: true,
        enabledModels: ["cloud", "local"],
        providers: {
          pc: makeProvider(
            "pc",
            { kind: "byok", catalogProviderId: "openai" },
            "anthropic",
            "https://api.openai.com/v1"
          ),
          pl: makeProvider(
            "pl",
            { kind: "byok", catalogProviderId: "ollama" },
            "anthropic",
            "http://localhost:11434/v1"
          ),
        },
        configuredModels: [makeModel("cloud", "pc", "gpt-4o"), makeModel("local", "pl", "llama3")],
      });
      const byId = new Map(opencodeEnabledModelEntries(settings).map((e) => [e.baseModelId, e]));
      expect(byId.get("openai/gpt-4o")?.needsSelfHostWarning).toBe(true);
      expect(byId.get("ollama/llama3")?.needsSelfHostWarning).toBe(false);
    });

    it("does not flag cloud models when Self-Host Mode is off", () => {
      const settings = makeSettings({
        enableSelfHostMode: false,
        enabledModels: ["cloud"],
        providers: {
          pc: makeProvider(
            "pc",
            { kind: "byok", catalogProviderId: "openai" },
            "anthropic",
            "https://api.openai.com/v1"
          ),
        },
        configuredModels: [makeModel("cloud", "pc", "gpt-4o")],
      });
      expect(opencodeEnabledModelEntries(settings)[0].needsSelfHostWarning).toBe(false);
    });

    it("returns the shared frozen empty array when nothing is enabled", () => {
      const first = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
      const second = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
      expect(first).toHaveLength(0);
      // Referential stability: the same frozen constant on every empty call.
      expect(first).toBe(second);
    });

    it("builds the `<provider>/<model>` wire base id for copilot-plus models", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "copilot-plus" }) },
        configuredModels: [makeModel("cm1", "p1", "copilot-plus-flash")],
      });
      expect(opencodeEnabledModelEntries(settings)[0].baseModelId).toBe(
        "copilot-plus/copilot-plus-flash"
      );
    });

    it("skips models whose provider row is missing", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: {},
        configuredModels: [makeModel("cm1", "p1", "claude-sonnet-4-6")],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });

    it("skips models whose configured-model row is missing", () => {
      const settings = makeSettings({
        enabledModels: ["missing"],
        providers: { p1: makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" }) },
        configuredModels: [],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });

    it("skips models on unroutable providers (BYOK without catalog id)", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "byok" }, "google") },
        configuredModels: [makeModel("cm1", "p1", "some-google-model")],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });
  });

  describe("COPILOT_PLUS_OPENCODE_PROVIDER_ID", () => {
    it("equals the Copilot provider id host code builds wire ids from", () => {
      // `plusUtils.isUsingLicensedModels` reconstructs the prefixed wire id from
      // `ChatModelProviders.COPILOT_PLUS`, because this module sits behind the
      // desktop-only Agent Mode barrel. Drift would silently stop it matching.
      expect(COPILOT_PLUS_OPENCODE_PROVIDER_ID).toBe(ChatModelProviders.COPILOT_PLUS);
    });
  });

  describe("copilotPlusModelId()", () => {
    it("strips opencode's Copilot Plus prefix down to the bare model id", () => {
      expect(copilotPlusModelId("copilot-plus/gemini-3-pro")).toBe("gemini-3-pro");
    });

    it.each([
      ["a BYOK model on the user's own key", "google/gemini-3-pro"],
      ["an agent-hosted model", "opencode/grok-code"],
      ["a bare id with no provider prefix", "gemini-3-pro"],
      ["null", null],
      ["undefined", undefined],
    ])("answers null for %s — Copilot Plus caps must not apply to it", (_label, wireId) => {
      expect(copilotPlusModelId(wireId)).toBeNull();
    });
  });

  describe("opencodeWireBaseIdFor()", () => {
    const plusProvider = makeProvider("plus-1", { kind: "copilot-plus" }, "openai-compatible");

    it("prefixes a Copilot model with the provider opencode routes it under", () => {
      const settings = makeSettings({
        providers: { "plus-1": plusProvider },
        configuredModels: [makeModel("cm1", "plus-1", "copilot-plus-flash")],
      });
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("copilot-plus/copilot-plus-flash");
    });

    it("answers for a configured model that no backend has enabled yet", () => {
      // No `backends.opencode` slice at all: provider sync configures a model
      // before enrolling it, and the id must be available in between.
      const settings = makeSettings({
        providers: { "plus-1": plusProvider },
        configuredModels: [makeModel("cm1", "plus-1", "copilot-plus-flash")],
      });
      expect(settings.backends.opencode).toBeUndefined();
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("copilot-plus/copilot-plus-flash");
    });

    it("leaves an agent-hosted model's own id unprefixed", () => {
      const settings = makeSettings({
        providers: { "oc-1": makeProvider("oc-1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [makeModel("cm1", "oc-1", "opencode/zen-model")],
      });
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("opencode/zen-model");
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 canonicalizes only supported models on the official DeepSeek endpoint", () => {
      const official = makeProvider(
        "deepseek-official",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://api.deepseek.com/v1/"
      );
      const settings = makeSettings({
        providers: { "deepseek-official": official },
        configuredModels: [
          makeModel("flash", "deepseek-official", "deepseek-v4-flash"),
          makeModel("pro", "deepseek-official", "deepseek-v4-pro"),
        ],
      });

      expect(opencodeWireBaseIdFor("flash", settings)).toBe("deepseek/deepseek-flash");
      expect(opencodeWireBaseIdFor("pro", settings)).toBeNull();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 canonicalizes native Flash and omits native Pro", () => {
      const native = makeProvider("opencode", { kind: "agent", agentType: "opencode" });
      const settings = makeSettings({
        providers: { opencode: native },
        configuredModels: [
          makeModel("flash", "opencode", "deepseek/deepseek-v4-flash"),
          makeModel("pro", "opencode", "deepseek/deepseek-v4-pro"),
        ],
      });

      expect(opencodeWireBaseIdFor("flash", settings)).toBe("deepseek/deepseek-flash");
      expect(opencodeWireBaseIdFor("pro", settings)).toBeNull();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 preserves a custom DeepSeek-compatible endpoint's model namespace", () => {
      const proxy = makeProvider(
        "deepseek-proxy",
        { kind: "byok", catalogProviderId: "deepseek" },
        "openai-compatible",
        "https://proxy.example/v1"
      );
      const settings = makeSettings({
        providers: { "deepseek-proxy": proxy },
        configuredModels: [makeModel("proxy-model", "deepseek-proxy", "deepseek-v4-pro")],
      });

      expect(opencodeWireBaseIdFor("proxy-model", settings)).toBe("deepseek-proxy/deepseek-v4-pro");
    });

    it("returns null for an unknown model, a missing provider, and an unroutable one", () => {
      const unroutable = makeSettings({
        providers: { p1: makeProvider("p1", { kind: "byok" }, "google") },
        configuredModels: [makeModel("cm1", "p1", "some-google-model")],
      });
      expect(opencodeWireBaseIdFor("cm1", unroutable)).toBeNull();
      expect(opencodeWireBaseIdFor("nope", unroutable)).toBeNull();

      const orphaned = makeSettings({
        providers: {},
        configuredModels: [makeModel("cm1", "gone", "copilot-plus-flash")],
      });
      expect(opencodeWireBaseIdFor("cm1", orphaned)).toBeNull();
    });
  });
});
