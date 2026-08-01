import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
  ChatModelProviders,
  ChatModels,
  ReasoningEffort,
  SEND_SHORTCUT,
} from "@/constants";
import {
  migrateDeepSeekModelCatalog,
  sanitizeQaExclusions,
  sanitizeSettings,
  CopilotSettings,
} from "@/settings/model";
import { getEffectiveUserPrompt, getSystemPrompt } from "@/system-prompts/systemPromptBuilder";
import * as systemPromptsState from "@/system-prompts/state";
import * as settingsModel from "@/settings/model";

// Mock system-prompts state
jest.mock("@/system-prompts/state", () => ({
  getEffectiveSystemPromptContent: jest.fn(() => ""),
  getDisableBuiltinSystemPrompt: jest.fn(() => false),
}));

// Mock settings/model getSettings for legacy fallback tests
jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<object>("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(() => ({ userSystemPrompt: "" })),
  };
});

describe("sanitizeQaExclusions", () => {
  it("defaults to copilot root when value is not a string", () => {
    expect(sanitizeQaExclusions(undefined)).toBe(encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING));
  });

  it("keeps slash-only patterns distinct from canonical entries", () => {
    const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(COPILOT_FOLDER_ROOT)}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("///"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });

  it("normalizes trailing slashes to canonical path keys", () => {
    const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("folder/"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });
});

describe("sanitizeSettings - defaultSendShortcut migration", () => {
  it("should use default when defaultSendShortcut is missing", () => {
    const settingsWithoutShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settingsWithoutShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should use default when defaultSendShortcut is invalid", () => {
    const settingsWithInvalidShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: "invalid-shortcut",
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settingsWithInvalidShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid ENTER shortcut", () => {
    const settingsWithEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid SHIFT_ENTER shortcut", () => {
    const settingsWithShiftEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.SHIFT_ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithShiftEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.SHIFT_ENTER);
  });
});

describe("sanitizeSettings - autoAddActiveContentToContext migration", () => {
  it("should migrate from old includeActiveNoteAsContext=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
      includeActiveNoteAsContext: true,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(true);
  });

  it("should migrate from old includeActiveNoteAsContext=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
      includeActiveNoteAsContext: false,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(
      DEFAULT_SETTINGS.autoAddActiveContentToContext
    );
  });
});

describe("sanitizeSettings - autoAddSelectionToContext migration", () => {
  it("should migrate from old autoIncludeTextSelection=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
      autoIncludeTextSelection: true,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(true);
  });

  it("should migrate from old autoIncludeTextSelection=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
      autoIncludeTextSelection: false,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(DEFAULT_SETTINGS.autoAddSelectionToContext);
  });
});

describe("sanitizeSettings - legacy Miyo settings cleanup", () => {
  it("migrates legacy Miyo settings and strips obsolete remote vault path state", () => {
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      enableMiyo: undefined,
      enableMiyoSearch: true,
      miyoServerUrl: "http://127.0.0.1:8742",
      miyoRemoteVaultPath: "\\\\Mac\\Home\\Downloads\\graham-essays-main",
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(legacySettings);

    expect(sanitized.enableMiyo).toBe(true);
    expect(sanitized.miyoServerUrl).toBe("http://127.0.0.1:8742");
    const sanitizedRecord = sanitized as unknown as Record<string, unknown>;

    expect("miyoRemoteVaultPath" in sanitizedRecord).toBe(false);
    expect("enableMiyoSearch" in sanitizedRecord).toBe(false);
  });

  it("preserves embedding provider migrations while stripping obsolete Miyo keys", () => {
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      userId: "",
      activeEmbeddingModels: [
        {
          name: "legacy-embedding",
          provider: "azure_openai",
          enabled: true,
        },
      ],
      miyoRemoteVaultPath: "\\\\Mac\\Home\\Downloads\\graham-essays-main",
    };

    const sanitized = sanitizeSettings(legacySettings);
    const sanitizedRecord = sanitized as unknown as Record<string, unknown>;

    expect(sanitized.userId).toBeTruthy();
    expect(sanitized.activeEmbeddingModels[0].provider).not.toBe("azure_openai");
    expect("miyoRemoteVaultPath" in sanitizedRecord).toBe(false);
  });
});

describe("DeepSeek V4 model catalog migration", () => {
  it("keeps retired built-ins visible but disabled without rewriting saved selections", () => {
    const retiredChatKey = "deepseek-chat|deepseek";
    const retiredReasonerKey = "deepseek-reasoner|deepseek";
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      defaultModelKey: retiredChatKey,
      quickCommandModelKey: retiredReasonerKey,
      activeModels: [
        {
          name: "deepseek-chat",
          provider: ChatModelProviders.DEEPSEEK,
          enabled: true,
          isBuiltIn: true,
        },
        {
          name: "deepseek-reasoner",
          provider: ChatModelProviders.DEEPSEEK,
          enabled: true,
          isBuiltIn: true,
          projectEnabled: true,
        },
      ],
    } as CopilotSettings;

    const sanitized = sanitizeSettings(legacySettings);
    const retired = sanitized.activeModels.filter((model) => model.retired);

    expect(retired).toHaveLength(2);
    expect(retired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "deepseek-chat", enabled: false }),
        expect.objectContaining({
          name: "deepseek-reasoner",
          enabled: false,
          projectEnabled: false,
        }),
      ])
    );
    expect(sanitized.defaultModelKey).toBe(retiredChatKey);
    expect(sanitized.quickCommandModelKey).toBe(retiredReasonerKey);
  });

  it("installs current V4 built-ins exactly once and retires direct-provider aliases", () => {
    const customAlias = {
      name: "deepseek-chat",
      provider: ChatModelProviders.DEEPSEEK,
      enabled: true,
      isBuiltIn: false,
      baseUrl: "https://example.test/v1",
    };

    const once = migrateDeepSeekModelCatalog([customAlias]);
    const twice = migrateDeepSeekModelCatalog(once);

    expect(
      twice.filter((model) => model.name === String(ChatModels.DEEPSEEK_V4_FLASH))
    ).toHaveLength(1);
    expect(twice.filter((model) => model.name === String(ChatModels.DEEPSEEK_V4_PRO))).toHaveLength(
      1
    );
    const preservedAlias = twice.find((model) => model.name === "deepseek-chat");
    expect(preservedAlias).toMatchObject({
      enabled: false,
      isBuiltIn: false,
      projectEnabled: false,
      retired: true,
      baseUrl: "https://example.test/v1",
    });
  });

  it("deduplicates shadowed current identities and restores reviewed defaults", () => {
    const migrated = migrateDeepSeekModelCatalog([
      {
        name: ChatModels.DEEPSEEK_V4_PRO,
        provider: ChatModelProviders.DEEPSEEK,
        enabled: true,
        isBuiltIn: false,
        apiKey: "model-key",
        baseUrl: "https://proxy.example.test/v1",
        reasoningEffort: "medium" as never,
        temperature: 0.7,
        topP: 0.8,
        frequencyPenalty: 0,
        retired: true,
      },
      {
        name: ChatModels.DEEPSEEK_V4_PRO,
        provider: ChatModelProviders.DEEPSEEK,
        enabled: false,
        isBuiltIn: true,
        projectEnabled: true,
      },
    ]);
    const matches = migrated.filter(
      (model) =>
        model.name === String(ChatModels.DEEPSEEK_V4_PRO) &&
        model.provider === String(ChatModelProviders.DEEPSEEK)
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      enabled: true,
      isBuiltIn: true,
      projectEnabled: true,
      apiKey: "model-key",
      baseUrl: "https://proxy.example.test/v1",
      reasoningEffort: "high",
      temperature: 0,
    });
    expect(matches[0].retired).toBeUndefined();
    expect(matches[0].topP).toBeUndefined();
    expect(matches[0].frequencyPenalty).toBeUndefined();
  });

  it("is deeply idempotent after restoring a retired current identity", () => {
    const input = [
      {
        name: ChatModels.DEEPSEEK_V4_FLASH,
        provider: ChatModelProviders.DEEPSEEK,
        enabled: true,
        isBuiltIn: false,
        projectEnabled: false,
        retired: true,
        reasoningEffort: ReasoningEffort.MINIMAL,
      },
    ];

    const once = migrateDeepSeekModelCatalog(input);
    const twice = migrateDeepSeekModelCatalog(once);

    expect(twice).toEqual(once);
    expect(
      twice.filter((model) => model.name === String(ChatModels.DEEPSEEK_V4_FLASH))
    ).toHaveLength(1);
    expect(twice[0]).toMatchObject({
      enabled: true,
      isBuiltIn: true,
      projectEnabled: false,
      reasoningEffort: "minimal",
    });
    expect(twice[0].retired).toBeUndefined();
  });

  it("gives Flash and Pro explicit project-safe behavior defaults", () => {
    const models = migrateDeepSeekModelCatalog([]);

    expect(
      models.find((model) => model.name === String(ChatModels.DEEPSEEK_V4_FLASH))
    ).toMatchObject({
      projectEnabled: true,
      reasoningEffort: "minimal",
    });
    expect(models.find((model) => model.name === String(ChatModels.DEEPSEEK_V4_PRO))).toMatchObject(
      {
        projectEnabled: true,
        reasoningEffort: "high",
        temperature: 0,
      }
    );
  });
});

describe("getSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns only builtin prompt when no user prompt and builtin not disabled", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns builtin prompt with user custom instructions when user prompt exists", () => {
    const userPrompt = "Always be concise and helpful.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(`${DEFAULT_SYSTEM_PROMPT}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`);
  });

  it("returns only user prompt when builtin is disabled", () => {
    const userPrompt = "Custom system prompt only.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe(userPrompt);
    expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns empty string when builtin is disabled and no user prompt", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe("");
  });

  it("wraps user prompt in user_custom_instructions tags", () => {
    const userPrompt = "Be professional.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain("<user_custom_instructions>");
    expect(result).toContain("</user_custom_instructions>");
    expect(result).toContain(userPrompt);
  });

  it("preserves multiline user prompts", () => {
    const userPrompt = "Line 1\nLine 2\nLine 3";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(userPrompt);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("calls getEffectiveSystemPromptContent to get user prompt", () => {
    getSystemPrompt();

    expect(systemPromptsState.getEffectiveSystemPromptContent).toHaveBeenCalled();
  });

  it("calls getDisableBuiltinSystemPrompt to check builtin status", () => {
    getSystemPrompt();

    expect(systemPromptsState.getDisableBuiltinSystemPrompt).toHaveBeenCalled();
  });

  it("respects priority: session > global default > empty", () => {
    // This is tested indirectly through getEffectiveSystemPromptContent
    // which is already tested in state.test.ts
    const sessionPrompt = "Session prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      sessionPrompt
    );
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(sessionPrompt);
  });
});

describe("getEffectiveUserPrompt - legacy fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns file-based prompt when available", () => {
    const fileBasedPrompt = "File-based prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "Legacy prompt",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
  });

  it("falls back to legacy userSystemPrompt when file-based is empty", () => {
    const legacyPrompt = "Legacy system prompt from settings";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(legacyPrompt);
  });

  it("returns empty string when both file-based and legacy are empty", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });

  it("file-based prompt takes priority over legacy prompt", () => {
    const fileBasedPrompt = "File-based wins";
    const legacyPrompt = "Legacy loses";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
    expect(result).not.toBe(legacyPrompt);
  });

  it("handles undefined getSettings gracefully", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue(undefined);

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });
});

describe("normalizeModelProvider", () => {
  it("maps azure_openai to the EmbeddingModelProviders.AZURE_OPENAI value", () => {
    const { normalizeModelProvider } = jest.requireActual<{
      normalizeModelProvider: (provider: string) => string;
    }>("@/settings/model");
    // Reason: EmbeddingModelProviders.AZURE_OPENAI = "azure openai" (with space)
    expect(normalizeModelProvider("azure_openai")).toBe("azure openai");
  });

  it("passes through already-normalized and unrelated providers", () => {
    const { normalizeModelProvider } = jest.requireActual<{
      normalizeModelProvider: (provider: string) => string;
    }>("@/settings/model");
    expect(normalizeModelProvider("azure openai")).toBe("azure openai");
    expect(normalizeModelProvider("openai")).toBe("openai");
    expect(normalizeModelProvider("")).toBe("");
  });
});
