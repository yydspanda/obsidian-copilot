import type { App } from "obsidian";

import ChainManager from "@/LLMProviders/chainManager";

jest.mock("@/aiParams", () => ({
  getChainType: jest.fn(() => "llm_chain"),
  getCurrentProject: jest.fn(() => null),
  getModelKey: jest.fn(() => "test-model|openai"),
}));

jest.mock("@/constants", () => ({
  BUILTIN_CHAT_MODELS: [],
  USER_SENDER: "user",
}));

jest.mock("@/LLMProviders/chainRunner/index", () => {
  class MockChainRunner {}

  return {
    AutonomousAgentChainRunner: MockChainRunner,
    CopilotPlusChainRunner: MockChainRunner,
    LLMChainRunner: MockChainRunner,
    ProjectChainRunner: MockChainRunner,
    VaultQAChainRunner: MockChainRunner,
  };
});

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    activeModels: [
      {
        enabled: true,
        name: "test-model",
        provider: "openai",
        projectEnabled: true,
      },
    ],
    enableSemanticSearchV3: false,
  })),
  subscribeToSettingsChange: jest.fn(),
}));

jest.mock("@/system-prompts/systemPromptBuilder", () => ({
  getSystemPrompt: jest.fn(() => ""),
}));

jest.mock("@/utils", () => ({
  findCustomModel: jest.fn(
    (_modelKey: string, models: readonly Record<string, unknown>[]) => models[0]
  ),
  isOSeriesModel: jest.fn(() => false),
}));

jest.mock("@/LLMProviders/chatModelManager", () => {
  const instance = {
    getChatModel: jest.fn(() => ({})),
    setChatModel: jest.fn(async () => {}),
    validateChatModel: jest.fn(() => true),
  };

  return {
    __esModule: true,
    __mockInstance: instance,
    default: {
      getInstance: jest.fn(() => instance),
    },
  };
});

jest.mock("@/LLMProviders/memoryManager", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => ({})),
  },
}));

jest.mock("@/LLMProviders/promptManager", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => ({})),
  },
}));

jest.mock("@/memory/UserMemoryManager", () => ({
  UserMemoryManager: jest.fn().mockImplementation(() => ({})),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface ChatModelManagerMock {
  getChatModel: jest.Mock;
  setChatModel: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  validateChatModel: jest.Mock<boolean, [unknown]>;
}

interface ChainManagerTestSurface {
  refreshVaultIndex: () => Promise<void>;
}

/**
 * Creates an externally resolved Promise for lifecycle interleaving tests.
 *
 * @returns Deferred Promise and its resolve callback
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Flushes the short Promise chain started by the ChainManager constructor.
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ChainManager lifecycle", () => {
  let capturedSettingsCallback: (() => void) | undefined;
  let chatModelManager: ChatModelManagerMock;
  let subscribeToSettingsChange: jest.Mock;
  let unsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    ({ __mockInstance: chatModelManager } = jest.requireMock<{
      __mockInstance: ChatModelManagerMock;
    }>("@/LLMProviders/chatModelManager"));
    ({ subscribeToSettingsChange } = jest.requireMock<{
      subscribeToSettingsChange: jest.Mock;
    }>("@/settings/model"));

    unsubscribe = jest.fn();
    capturedSettingsCallback = undefined;
    subscribeToSettingsChange.mockImplementation((callback: () => void) => {
      capturedSettingsCallback = callback;
      return unsubscribe;
    });
    chatModelManager.getChatModel.mockReturnValue({});
    chatModelManager.setChatModel.mockResolvedValue(undefined);
    chatModelManager.validateChatModel.mockReturnValue(true);
  });

  it("unsubscribes exactly once and ignores a captured settings callback after dispose", async () => {
    const manager = new ChainManager({} as App);
    await flushPromises();
    chatModelManager.setChatModel.mockClear();

    manager.dispose();
    manager.dispose();
    capturedSettingsCallback?.();
    await flushPromises();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(chatModelManager.setChatModel).not.toHaveBeenCalled();
  });

  it("stops deferred model initialization before validation and refresh housekeeping", async () => {
    const manager = new ChainManager({} as App);
    await flushPromises();

    const modelInitialization = createDeferred<void>();
    const refreshVaultIndex = jest
      .spyOn(manager as unknown as ChainManagerTestSurface, "refreshVaultIndex")
      .mockResolvedValue(undefined);
    chatModelManager.setChatModel.mockClear();
    chatModelManager.validateChatModel.mockClear();
    chatModelManager.setChatModel.mockReturnValueOnce(modelInitialization.promise);

    const reconfiguration = manager.createChainWithNewModel({ refreshIndex: true });
    expect(chatModelManager.setChatModel).toHaveBeenCalledTimes(1);

    manager.dispose();
    modelInitialization.resolve();
    await reconfiguration;

    expect(chatModelManager.validateChatModel).not.toHaveBeenCalled();
    expect(refreshVaultIndex).not.toHaveBeenCalled();
  });

  it("normalizes stale project temperature against the effective DeepSeek fallback model", async () => {
    const { getChainType, getCurrentProject } = jest.requireMock<{
      getChainType: jest.Mock;
      getCurrentProject: jest.Mock;
    }>("@/aiParams");
    const { getSettings } = jest.requireMock<{ getSettings: jest.Mock }>("@/settings/model");
    const { findCustomModel } = jest.requireMock<{ findCustomModel: jest.Mock }>("@/utils");
    const originalModel = {
      enabled: true,
      name: "project-original",
      provider: "openai",
      projectEnabled: false,
    };
    const fallbackModel = {
      enabled: true,
      name: "deepseek-v4-pro",
      provider: "deepseek",
      projectEnabled: true,
      reasoningEffort: "high",
      temperature: 0,
    };
    getChainType.mockReturnValue("project");
    getCurrentProject.mockReturnValue({
      projectModelKey: "project-original|openai",
      modelConfigs: { temperature: 0.1 },
    });
    getSettings.mockReturnValue({
      activeModels: [originalModel, fallbackModel],
      temperature: 0.7,
      enableSemanticSearchV3: false,
    });
    findCustomModel.mockImplementation((modelKey: string, models: (typeof originalModel)[]) =>
      models.find((model) => `${model.name}|${model.provider}` === modelKey)
    );

    const manager = new ChainManager({} as App);
    await flushPromises();

    expect(chatModelManager.setChatModel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "deepseek-v4-pro",
        provider: "deepseek",
        reasoningEffort: "high",
        temperature: 0,
      })
    );
    manager.dispose();
  });

  it("does not let a project override hide an invalid effective model temperature", async () => {
    const { getChainType, getCurrentProject } = jest.requireMock<{
      getChainType: jest.Mock;
      getCurrentProject: jest.Mock;
    }>("@/aiParams");
    const { getSettings } = jest.requireMock<{ getSettings: jest.Mock }>("@/settings/model");
    const { findCustomModel } = jest.requireMock<{ findCustomModel: jest.Mock }>("@/utils");
    const invalidModel = {
      enabled: true,
      name: "deepseek-v4-pro",
      provider: "deepseek",
      projectEnabled: true,
      reasoningEffort: "high",
      temperature: 0.1,
    };
    getChainType.mockReturnValue("project");
    getCurrentProject.mockReturnValue({
      projectModelKey: "deepseek-v4-pro|deepseek",
      modelConfigs: { temperature: 0.1 },
    });
    getSettings.mockReturnValue({
      activeModels: [invalidModel],
      temperature: 0.7,
      enableSemanticSearchV3: false,
    });
    findCustomModel.mockReturnValue(invalidModel);

    const manager = new ChainManager({} as App);
    await flushPromises();

    expect(chatModelManager.setChatModel).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1 })
    );
    manager.dispose();
  });
});
