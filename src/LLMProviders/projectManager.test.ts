import type { ProjectConfig } from "@/aiParams";
import type CopilotPlugin from "@/main";
import type { ProjectFileRecord } from "@/projects/type";
import type { App, Vault } from "obsidian";

import ProjectManager, {
  ProjectManagerDisposedError,
  ProjectManagerNotInitializedError,
} from "@/LLMProviders/projectManager";

jest.mock("@/aiParams", () => ({
  getChainType: jest.fn(() => "chat"),
  getCurrentProject: jest.fn(() => null),
  isProjectMode: jest.fn(() => false),
  setCurrentProject: jest.fn(),
  setProjectLoading: jest.fn(),
  subscribeToChainTypeChange: jest.fn(),
  subscribeToModelKeyChange: jest.fn(),
  subscribeToProjectChange: jest.fn(),
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(),
  },
}));

jest.mock("@/chainType", () => ({
  ChainType: {
    COPILOT_PLUS_CHAIN: "plus",
    PROJECT_CHAIN: "project",
    VAULT_QA_CHAIN: "vault",
  },
}));

jest.mock("@/constants", () => ({
  CHAT_VIEWTYPE: "copilot-chat",
  VAULT_VECTOR_STORE_STRATEGY: {
    ON_MODE_SWITCH: "on-mode-switch",
  },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/mentions/Mention", () => ({
  Mention: {
    getInstance: jest.fn(() => ({
      processUrls: jest.fn(),
    })),
  },
}));

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(),
  },
}));

jest.mock("@/projects/state", () => ({
  getCachedProjects: jest.fn(() => []),
  subscribeToProjectRecords: jest.fn(),
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => ({ exclusions: [], inclusions: [] })),
  shouldIndexFile: jest.fn(() => false),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    enableSemanticSearchV3: false,
    indexVaultToVectorStore: "never",
  })),
}));

jest.mock("@/tools/FileParserManager", () => ({
  FileParserManager: jest.fn(),
  saveConvertedDocOutput: jest.fn(),
}));

jest.mock("@/utils", () => ({
  err2String: jest.fn((error: unknown) => String(error)),
}));

jest.mock("@/utils/rateLimitUtils", () => ({
  isRateLimitError: jest.fn(() => false),
}));

jest.mock("@/utils/recentUsageManager", () => ({
  RecentUsageManager: jest.fn(),
}));

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: class MockTFile {},
}));

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: jest.fn(() => ({})),
  },
}));

jest.mock("@/LLMProviders/chainManager", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@/LLMProviders/projectLoadTracker", () => ({
  ProjectLoadTracker: {
    startLifecycle: jest.fn(() => ({
      clearAllLoadStates: jest.fn(),
      dispose: jest.fn(),
    })),
  },
}));

interface SubscriptionMocks {
  modelKey: jest.Mock;
  chainType: jest.Mock;
  project: jest.Mock;
  records: jest.Mock;
}

interface ContextCacheMock {
  dispose: jest.Mock;
}

interface LoadTrackerMock {
  clearAllLoadStates: jest.Mock;
  dispose: jest.Mock;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * Create an externally resolved Promise for continuation lifecycle tests.
 *
 * @returns Deferred Promise and resolver
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Build a Vault identity for lifecycle ownership tests.
 *
 * @param name - Human-readable identity used only by the test
 * @returns Minimal Vault mock
 */
function createVault(name: string): Vault {
  return { name } as unknown as Vault;
}

/**
 * Build a minimal App around one Vault identity.
 *
 * @param vault - Vault owned by the App
 * @returns Minimal App
 */
function createApp(vault: Vault): App {
  return {
    vault,
    workspace: {
      getLeavesOfType: jest.fn(() => []),
    },
  } as unknown as App;
}

/**
 * Build a plugin identity without invoking the real plugin class.
 *
 * @param autosaveCurrentChat - Optional autosave implementation
 * @returns Minimal CopilotPlugin mock
 */
function createPlugin(autosaveCurrentChat: () => Promise<void> = async () => {}): CopilotPlugin {
  return {
    autosaveCurrentChat: jest.fn(autosaveCurrentChat),
    chatUIState: {
      handleProjectSwitch: jest.fn(async () => {}),
    },
  } as unknown as CopilotPlugin;
}

/**
 * Create a context cache mock that exposes lifecycle disposal.
 *
 * @returns Context cache lifecycle mock
 */
function createContextCache(): ContextCacheMock {
  return {
    dispose: jest.fn(),
  };
}

/**
 * Return a tracker created by the mocked lifecycle factory.
 *
 * @param index - Zero-based construction index
 * @returns Mock tracker created for one ProjectManager
 */
function getCreatedLoadTracker(index: number): LoadTrackerMock {
  const { ProjectLoadTracker } = jest.requireMock<{
    ProjectLoadTracker: { startLifecycle: jest.Mock };
  }>("@/LLMProviders/projectLoadTracker");
  const tracker = ProjectLoadTracker.startLifecycle.mock.results[index]?.value as
    | LoadTrackerMock
    | undefined;
  if (!tracker) {
    throw new Error(`Missing ProjectLoadTracker mock at index ${index}`);
  }
  return tracker;
}

describe("ProjectManager lifecycle ownership", () => {
  let subscriptions: SubscriptionMocks;
  let chainManagers: Array<{ createChainWithNewModel: jest.Mock; dispose: jest.Mock }>;
  let contextCaches: ContextCacheMock[];

  beforeEach(() => {
    try {
      ProjectManager.instance.onunload();
    } catch (error) {
      if (!(error instanceof ProjectManagerNotInitializedError)) {
        throw error;
      }
    }

    jest.clearAllMocks();
    chainManagers = [];
    contextCaches = [];

    const aiParams = jest.requireMock<{
      getCurrentProject: jest.Mock;
      subscribeToChainTypeChange: jest.Mock;
      subscribeToModelKeyChange: jest.Mock;
      subscribeToProjectChange: jest.Mock;
    }>("@/aiParams");
    aiParams.getCurrentProject.mockReturnValue(null);
    const projectState = jest.requireMock<{
      subscribeToProjectRecords: jest.Mock;
    }>("@/projects/state");
    const projectFileManager = jest.requireMock<{
      ProjectFileManager: { getInstance: jest.Mock };
    }>("@/projects/ProjectFileManager");
    subscriptions = {
      modelKey: jest.fn(),
      chainType: jest.fn(),
      project: jest.fn(),
      records: jest.fn(),
    };
    aiParams.subscribeToModelKeyChange.mockReturnValue(subscriptions.modelKey);
    aiParams.subscribeToChainTypeChange.mockReturnValue(subscriptions.chainType);
    aiParams.subscribeToProjectChange.mockReturnValue(subscriptions.project);
    projectState.subscribeToProjectRecords.mockReturnValue(subscriptions.records);
    projectFileManager.ProjectFileManager.getInstance.mockReturnValue({
      getProjectUsageTimestampsManager: jest.fn(),
      touchProjectLastUsed: jest.fn(async () => {}),
    });

    const ChainManager = jest.requireMock<{
      default: jest.Mock;
    }>("@/LLMProviders/chainManager").default;
    ChainManager.mockImplementation(() => {
      const manager = {
        createChainWithNewModel: jest.fn(async () => {}),
        dispose: jest.fn(),
      };
      chainManagers.push(manager);
      return manager;
    });

    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance.mockImplementation(() => {
      const cache = createContextCache();
      contextCaches.push(cache);
      return cache;
    });
  });

  afterEach(() => {
    try {
      ProjectManager.instance.onunload();
    } catch (error) {
      if (!(error instanceof ProjectManagerNotInitializedError)) {
        throw error;
      }
    }
  });

  it("reuses one manager for the exact same plugin, App, and Vault", () => {
    const app = createApp(createVault("vault-a"));
    const plugin = createPlugin();

    const first = ProjectManager.getInstance(app, plugin);
    const second = ProjectManager.getInstance(app, plugin);

    expect(second).toBe(first);
    expect(chainManagers).toHaveLength(1);
    expect(contextCaches).toHaveLength(1);
    const aiParams = jest.requireMock<{
      subscribeToChainTypeChange: jest.Mock;
      subscribeToModelKeyChange: jest.Mock;
      subscribeToProjectChange: jest.Mock;
    }>("@/aiParams");
    expect(aiParams.subscribeToModelKeyChange).toHaveBeenCalledTimes(1);
    expect(aiParams.subscribeToChainTypeChange).toHaveBeenCalledTimes(1);
    expect(aiParams.subscribeToProjectChange).toHaveBeenCalledTimes(1);
  });

  it("replaces the manager when a plugin hot reload changes the plugin owner", () => {
    const app = createApp(createVault("vault-a"));
    const first = ProjectManager.getInstance(app, createPlugin());
    const aiParams = jest.requireMock<{
      getCurrentProject: jest.Mock;
      setCurrentProject: jest.Mock;
      subscribeToModelKeyChange: jest.Mock;
    }>("@/aiParams");
    aiParams.getCurrentProject.mockReturnValue({
      id: "old-lifecycle-project",
    });
    const oldModelCallback = jest.requireMock<{
      subscribeToModelKeyChange: jest.Mock;
    }>("@/aiParams").subscribeToModelKeyChange.mock.calls[0][0] as () => void;

    const second = ProjectManager.getInstance(app, createPlugin());

    expect(second).not.toBe(first);
    expect(ProjectManager.instance).toBe(second);
    expect(contextCaches[0].dispose).toHaveBeenCalledTimes(1);
    expect(chainManagers[0].dispose).toHaveBeenCalledTimes(1);
    expect(getCreatedLoadTracker(0).dispose).toHaveBeenCalledTimes(1);
    expect(subscriptions.modelKey).toHaveBeenCalledTimes(1);
    expect(subscriptions.chainType).toHaveBeenCalledTimes(1);
    expect(subscriptions.project).toHaveBeenCalledTimes(1);
    expect(subscriptions.records).toHaveBeenCalledTimes(1);
    expect(aiParams.setCurrentProject).toHaveBeenCalledWith(null);
    expect(getCreatedLoadTracker(0).dispose.mock.invocationCallOrder[0]).toBeLessThan(
      aiParams.setCurrentProject.mock.invocationCallOrder[0]
    );

    oldModelCallback();
    expect(chainManagers[0].createChainWithNewModel).not.toHaveBeenCalled();
  });

  it("replaces the manager when App or Vault ownership changes", () => {
    const firstApp = createApp(createVault("vault-a"));
    const secondApp = createApp(createVault("vault-b"));
    const plugin = createPlugin();
    const first = ProjectManager.getInstance(firstApp, plugin);
    const aiParams = jest.requireMock<{
      getCurrentProject: jest.Mock;
      setCurrentProject: jest.Mock;
    }>("@/aiParams");
    aiParams.getCurrentProject.mockReturnValue({
      id: "old-vault-project",
    });

    const second = ProjectManager.getInstance(secondApp, plugin);

    expect(second).not.toBe(first);
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    expect(ProjectContextCache.getInstance).toHaveBeenNthCalledWith(1, firstApp.vault);
    expect(ProjectContextCache.getInstance).toHaveBeenNthCalledWith(2, secondApp.vault);
    expect(contextCaches[0].dispose).toHaveBeenCalledTimes(1);
    expect(chainManagers[0].dispose).toHaveBeenCalledTimes(1);
    expect(getCreatedLoadTracker(0).dispose).toHaveBeenCalledTimes(1);
    expect(aiParams.setCurrentProject).toHaveBeenCalledWith(null);
  });

  it("keeps operational reads bound to the captured Vault", () => {
    const getOriginalFiles = jest.fn(() => []);
    const originalVault = {
      getFiles: getOriginalFiles,
      name: "vault-a",
    } as unknown as Vault;
    const app = createApp(originalVault);
    const manager = ProjectManager.getInstance(app, createPlugin());
    const getReplacementFiles = jest.fn(() => {
      throw new Error("replacement Vault must not receive old-manager I/O");
    });
    Object.assign(app, {
      vault: {
        getFiles: getReplacementFiles,
        name: "vault-b",
      } as unknown as Vault,
    });

    const files = (
      manager as unknown as {
        getProjectAllFiles: (project: ProjectConfig) => unknown[];
      }
    ).getProjectAllFiles({
      contextSource: {
        exclusions: "",
        inclusions: "",
      },
      id: "project-a",
      name: "Project A",
    } as ProjectConfig);

    expect(files).toEqual([]);
    expect(getOriginalFiles).toHaveBeenCalledTimes(1);
    expect(getReplacementFiles).not.toHaveBeenCalled();
  });

  it("unloads idempotently, clears the active accessor, and rejects stale references", () => {
    const manager = ProjectManager.getInstance(createApp(createVault("vault-a")), createPlugin());

    manager.onunload();
    manager.onunload();

    expect(subscriptions.modelKey).toHaveBeenCalledTimes(1);
    expect(subscriptions.chainType).toHaveBeenCalledTimes(1);
    expect(subscriptions.project).toHaveBeenCalledTimes(1);
    expect(subscriptions.records).toHaveBeenCalledTimes(1);
    expect(contextCaches[0].dispose).toHaveBeenCalledTimes(1);
    expect(chainManagers[0].dispose).toHaveBeenCalledTimes(1);
    expect(getCreatedLoadTracker(0).dispose).toHaveBeenCalledTimes(1);
    expect(() => manager.getCurrentProjectId()).toThrow(ProjectManagerDisposedError);
    expect(() => manager.getCurrentChainManager()).toThrow(ProjectManagerDisposedError);
    expect(() => ProjectManager.instance).toThrow(ProjectManagerNotInitializedError);
  });

  it("finishes teardown when one subscription cleanup throws", () => {
    const manager = ProjectManager.getInstance(createApp(createVault("vault-a")), createPlugin());
    subscriptions.modelKey.mockImplementationOnce(() => {
      throw new Error("unsubscribe failed");
    });

    expect(() => manager.onunload()).not.toThrow();

    expect(subscriptions.modelKey).toHaveBeenCalledTimes(1);
    expect(subscriptions.chainType).toHaveBeenCalledTimes(1);
    expect(subscriptions.project).toHaveBeenCalledTimes(1);
    expect(subscriptions.records).toHaveBeenCalledTimes(1);
    expect(contextCaches[0].dispose).toHaveBeenCalledTimes(1);
    expect(() => ProjectManager.instance).toThrow(ProjectManagerNotInitializedError);
  });

  it("does not let a stale unload clear a newer active manager", () => {
    const app = createApp(createVault("vault-a"));
    const first = ProjectManager.getInstance(app, createPlugin());
    const second = ProjectManager.getInstance(app, createPlugin());
    const aiParams = jest.requireMock<{
      setCurrentProject: jest.Mock;
      setProjectLoading: jest.Mock;
    }>("@/aiParams");
    aiParams.setCurrentProject.mockClear();
    aiParams.setProjectLoading.mockClear();

    first.onunload();

    expect(ProjectManager.instance).toBe(second);
    expect(aiParams.setCurrentProject).not.toHaveBeenCalled();
    expect(aiParams.setProjectLoading).not.toHaveBeenCalled();
  });

  it("retires subscriptions before a project-state owner reset can notify them", async () => {
    const plugin = createPlugin();
    const manager = ProjectManager.getInstance(createApp(createVault("vault-a")), plugin);
    const project = {
      id: "project-a",
      name: "Project A",
    } as ProjectConfig;

    await manager.switchProject(project);
    const recordsCallback = jest.requireMock<{
      subscribeToProjectRecords: jest.Mock;
    }>("@/projects/state").subscribeToProjectRecords.mock.calls[0][0] as (
      records: ProjectFileRecord[]
    ) => void;
    expect(plugin.autosaveCurrentChat).toHaveBeenCalledTimes(1);

    ProjectManager.retireActive();
    recordsCallback([]);
    await Promise.resolve();

    expect(plugin.autosaveCurrentChat).toHaveBeenCalledTimes(1);
    expect(() => ProjectManager.instance).toThrow(ProjectManagerNotInitializedError);
  });

  it("lets only the latest concurrent project switch publish", async () => {
    const firstAutosave = createDeferred<void>();
    const secondAutosave = createDeferred<void>();
    let autosaveCall = 0;
    const plugin = createPlugin(() => {
      autosaveCall += 1;
      return autosaveCall === 1 ? firstAutosave.promise : secondAutosave.promise;
    });
    const manager = ProjectManager.getInstance(createApp(createVault("vault-a")), plugin);
    const projectA = { id: "project-a", name: "Project A" } as ProjectConfig;
    const projectB = { id: "project-b", name: "Project B" } as ProjectConfig;

    const firstSwitch = manager.switchProject(projectA);
    const secondSwitch = manager.switchProject(projectB);
    secondAutosave.resolve();
    await secondSwitch;
    firstAutosave.resolve();
    await firstSwitch;

    const aiParams = jest.requireMock<{
      setProjectLoading: jest.Mock;
    }>("@/aiParams");
    expect(manager.getCurrentProjectId()).toBe(projectB.id);
    expect(plugin.chatUIState.handleProjectSwitch).toHaveBeenCalledTimes(1);
    expect(aiParams.setProjectLoading.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("prevents an old switch continuation from publishing after replacement", async () => {
    const pendingAutosave = createDeferred<void>();
    const app = createApp(createVault("vault-a"));
    const first = ProjectManager.getInstance(
      app,
      createPlugin(() => pendingAutosave.promise)
    );
    const project = {
      contextSource: {
        exclusions: "",
        inclusions: "",
      },
      id: "project-a",
      name: "Project A",
    };
    const staleSwitch = first.switchProject(project as ProjectConfig);
    const aiParams = jest.requireMock<{
      getCurrentProject: jest.Mock;
      setCurrentProject: jest.Mock;
      setProjectLoading: jest.Mock;
    }>("@/aiParams");
    aiParams.getCurrentProject.mockReturnValue(project);

    const second = ProjectManager.getInstance(app, createPlugin());
    pendingAutosave.resolve();

    await expect(staleSwitch).rejects.toBeInstanceOf(ProjectManagerDisposedError);
    expect(ProjectManager.instance).toBe(second);
    expect(aiParams.setCurrentProject).toHaveBeenCalledTimes(1);
    expect(aiParams.setCurrentProject).toHaveBeenCalledWith(null);
    expect(aiParams.setProjectLoading.mock.calls).toEqual([[true], [false]]);
    expect(second.getCurrentProjectId()).toBeNull();
  });
});
