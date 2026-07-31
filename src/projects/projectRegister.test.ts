import type { App, Vault } from "obsidian";

import { ProjectRegister, ProjectRegisterDisposedError } from "@/projects/projectRegister";
import { ProjectFileRecord } from "@/projects/type";

jest.mock("@/aiParams", () => ({
  getCurrentProject: jest.fn(() => null),
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({
      clearForProject: jest.fn(async () => {}),
    })),
  },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(),
    startLifecycle: jest.fn(),
  },
}));

jest.mock("@/projects/projectUtils", () => ({
  ensureProjectFrontmatter: jest.fn(async () => {}),
  getProjectsFolder: jest.fn(() => "Projects"),
  isProjectConfigFile: jest.fn(() => false),
  loadAllProjects: jest.fn(async () => []),
  parseProjectConfigFile: jest.fn(async () => null),
}));

jest.mock("@/projects/state", () => ({
  deleteCachedProjectRecordByFilePathForOwner: jest.fn(),
  getCachedProjectRecordByFilePath: jest.fn(),
  getCachedProjectRecordById: jest.fn(),
  getCachedProjectRecords: jest.fn(() => []),
  isPendingFileWrite: jest.fn(() => false),
  isProjectStateOwnerActive: jest.fn(() => true),
  replaceCachedProjectRecordByFilePathForOwner: jest.fn(),
  updateCachedProjectRecordsForOwner: jest.fn(),
  upsertCachedProjectRecordForOwner: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "Projects" })),
  subscribeToSettingsChange: jest.fn(),
}));

jest.mock("@/utils/debounce", () => ({
  debounce: jest.fn((callback: (...args: unknown[]) => void) => {
    const debounced = jest.fn(callback) as jest.Mock & { cancel: jest.Mock };
    debounced.cancel = jest.fn();
    return debounced;
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * Creates an externally settled Promise for lifecycle interleaving tests.
 *
 * @returns Deferred Promise and its settlement callbacks
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Builds the minimal Vault event surface used by ProjectRegister.
 *
 * @returns Vault mock with observable on/off calls
 */
function createVault(): jest.Mocked<Vault> {
  return {
    on: jest.fn(),
    off: jest.fn(),
  } as unknown as jest.Mocked<Vault>;
}

/**
 * Builds an App around one Vault mock.
 *
 * @param vault - Vault supplied to ProjectRegister
 * @returns Minimal App
 */
function createApp(vault: Vault): App {
  return { vault } as App;
}

/**
 * Counts registrations or removals for one Vault event name.
 *
 * @param mock - Vault on/off mock
 * @param eventName - Event name to count
 * @returns Number of matching calls
 */
function countEventCalls(
  mock: { mock: { calls: readonly (readonly unknown[])[] } },
  eventName: string
): number {
  return mock.mock.calls.filter(([observedName]) => observedName === eventName).length;
}

/**
 * Returns the callback registered for one Vault event.
 *
 * @param vault - Vault mock containing registration calls
 * @param eventName - Event whose callback should be returned
 * @returns Registered callback
 */
function getVaultHandler(
  vault: jest.Mocked<Vault>,
  eventName: string
): (...args: unknown[]) => Promise<void> {
  const call = vault.on.mock.calls.find(([observedName]) => observedName === eventName);
  if (!call) throw new Error(`Missing Vault handler: ${eventName}`);
  return call[1];
}

/**
 * Flushes Promise continuations without relying on timers.
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Builds one complete project file record for event/scan interleaving tests.
 *
 * @param id - Stable project id and display-name seed
 * @returns Project record under the configured Projects folder
 */
function createProjectRecord(id: string): ProjectFileRecord {
  return {
    project: {
      id,
      name: id,
      systemPrompt: "",
      projectModelKey: "",
      modelConfigs: {},
      contextSource: {},
      created: 1,
      UsageTimestamps: 0,
    },
    filePath: `Projects/${id}/project.md`,
    folderName: id,
  };
}

describe("ProjectRegister lifecycle", () => {
  const projectStateOwner = {};
  interface MockPreparedScan {
    revision: number;
  }
  let scanRevision = 0;
  const manager = {
    initialize: jest.fn<Promise<void>, []>(),
    prepareProjectScan: jest.fn<MockPreparedScan, []>(),
    fetchPreparedProjectScan: jest.fn<Promise<ProjectFileRecord[]>, [MockPreparedScan]>(
      async () => []
    ),
    isPreparedProjectScanCurrent: jest.fn<boolean, [MockPreparedScan]>(),
    commitPreparedProjectScan: jest.fn<boolean, [MockPreparedScan, ProjectFileRecord[]]>(),
    invalidatePreparedProjectScans: jest.fn<void, []>(),
    invalidateProjectsFolder: jest.fn<void, []>(),
    reloadProjects: jest.fn<Promise<ProjectFileRecord[]>, []>(async () => []),
    dispose: jest.fn(),
    getStateOwner: jest.fn(() => projectStateOwner),
  };
  let vault: jest.Mocked<Vault>;
  let subscribeToSettingsChange: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    scanRevision = 0;
    vault = createVault();
    manager.initialize.mockResolvedValue(undefined);
    manager.prepareProjectScan.mockImplementation(() => ({ revision: ++scanRevision }));
    manager.fetchPreparedProjectScan.mockResolvedValue([]);
    manager.isPreparedProjectScanCurrent.mockImplementation(
      (preparedScan) => preparedScan.revision === scanRevision
    );
    manager.commitPreparedProjectScan.mockImplementation((preparedScan) => {
      if (preparedScan.revision !== scanRevision) return false;
      scanRevision += 1;
      return true;
    });
    manager.invalidatePreparedProjectScans.mockImplementation(() => {
      scanRevision += 1;
    });
    manager.invalidateProjectsFolder.mockImplementation(() => {
      scanRevision += 1;
    });
    manager.reloadProjects.mockResolvedValue([]);
    const { ProjectFileManager } = jest.requireMock<{
      ProjectFileManager: { startLifecycle: jest.Mock };
    }>("@/projects/ProjectFileManager");
    ProjectFileManager.startLifecycle.mockReturnValue(manager);
    ({ subscribeToSettingsChange } = jest.requireMock<{
      subscribeToSettingsChange: jest.Mock;
    }>("@/settings/model"));
    subscribeToSettingsChange.mockReturnValue(jest.fn());

    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance.mockReturnValue({
      clearForProject: jest.fn(async () => {}),
    });

    const { isProjectConfigFile, parseProjectConfigFile } = jest.requireMock<{
      isProjectConfigFile: jest.Mock;
      parseProjectConfigFile: jest.Mock;
    }>("@/projects/projectUtils");
    isProjectConfigFile.mockReturnValue(false);
    parseProjectConfigFile.mockResolvedValue(null);

    const {
      getCachedProjectRecordByFilePath,
      getCachedProjectRecordById,
      getCachedProjectRecords,
      isPendingFileWrite,
      isProjectStateOwnerActive,
    } = jest.requireMock<{
      getCachedProjectRecordByFilePath: jest.Mock;
      getCachedProjectRecordById: jest.Mock;
      getCachedProjectRecords: jest.Mock;
      isPendingFileWrite: jest.Mock;
      isProjectStateOwnerActive: jest.Mock;
    }>("@/projects/state");
    getCachedProjectRecordByFilePath.mockReturnValue(undefined);
    getCachedProjectRecordById.mockReturnValue(undefined);
    getCachedProjectRecords.mockReturnValue([]);
    isPendingFileWrite.mockReturnValue(false);
    isProjectStateOwnerActive.mockReturnValue(true);
  });

  it("shares one in-flight initialize and registers each lifecycle hook once", async () => {
    const pending = createDeferred<void>();
    manager.initialize.mockReturnValueOnce(pending.promise);
    const register = new ProjectRegister(createApp(vault));

    const first = register.initialize();
    const second = register.initialize();

    expect(second).toBe(first);
    expect(manager.initialize).toHaveBeenCalledTimes(1);
    expect(subscribeToSettingsChange).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.on, eventName)).toBe(1);
    }

    pending.resolve();
    await Promise.all([first, second]);
  });

  it("does not repeat manager initialization or hook registration after success", async () => {
    const register = new ProjectRegister(createApp(vault));

    await register.initialize();
    await register.initialize();

    expect(manager.initialize).toHaveBeenCalledTimes(1);
    expect(subscribeToSettingsChange).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.on, eventName)).toBe(1);
    }
  });

  it("rolls back failed initialization and permits a clean retry", async () => {
    const firstUnsubscribe = jest.fn();
    const secondUnsubscribe = jest.fn();
    subscribeToSettingsChange
      .mockReturnValueOnce(firstUnsubscribe)
      .mockReturnValueOnce(secondUnsubscribe);
    manager.initialize
      .mockRejectedValueOnce(new Error("initial load failed"))
      .mockResolvedValueOnce(undefined);
    const register = new ProjectRegister(createApp(vault));

    await expect(register.initialize()).rejects.toThrow("initial load failed");

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(manager.dispose).not.toHaveBeenCalled();
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.off, eventName)).toBe(1);
    }

    await register.initialize();

    expect(manager.initialize).toHaveBeenCalledTimes(2);
    expect(subscribeToSettingsChange).toHaveBeenCalledTimes(2);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.on, eventName)).toBe(2);
    }
    expect(secondUnsubscribe).not.toHaveBeenCalled();
  });

  it("permanently disposes during in-flight initialization and cannot be revived", async () => {
    const firstInitialization = createDeferred<void>();
    const firstUnsubscribe = jest.fn();
    manager.initialize.mockReturnValueOnce(firstInitialization.promise);
    subscribeToSettingsChange.mockReturnValueOnce(firstUnsubscribe);
    const register = new ProjectRegister(createApp(vault));

    const staleInitialization = register.initialize();
    register.cleanup();
    register.cleanup();

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.off, eventName)).toBe(1);
    }

    await expect(register.initialize()).rejects.toBeInstanceOf(ProjectRegisterDisposedError);
    firstInitialization.resolve();
    await staleInitialization;

    await expect(register.initialize()).rejects.toBeInstanceOf(ProjectRegisterDisposedError);
    expect(manager.initialize).toHaveBeenCalledTimes(1);
    expect(manager.dispose).toHaveBeenCalledTimes(1);
    expect(subscribeToSettingsChange).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.on, eventName)).toBe(1);
      expect(countEventCalls(vault.off, eventName)).toBe(1);
    }
  });

  it("does not let a deferred create callback write project state after cleanup", async () => {
    const parsed = createDeferred<{
      project: {
        id: string;
        name: string;
        systemPrompt: string;
        projectModelKey: string;
        modelConfigs: Record<string, never>;
        contextSource: Record<string, never>;
        created: number;
        UsageTimestamps: number;
      };
      filePath: string;
      folderName: string;
    } | null>();
    const { isProjectConfigFile, parseProjectConfigFile } = jest.requireMock<{
      isProjectConfigFile: jest.Mock;
      parseProjectConfigFile: jest.Mock;
    }>("@/projects/projectUtils");
    const { upsertCachedProjectRecordForOwner } = jest.requireMock<{
      upsertCachedProjectRecordForOwner: jest.Mock;
    }>("@/projects/state");
    isProjectConfigFile.mockReturnValue(true);
    parseProjectConfigFile.mockReturnValueOnce(parsed.promise);
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();
    const file = { path: "Projects/Deferred/project.md" };

    const callback = getVaultHandler(vault, "create")(file);
    await flushPromises();
    register.cleanup();
    parsed.resolve({
      project: {
        id: "deferred",
        name: "Deferred",
        systemPrompt: "",
        projectModelKey: "",
        modelConfigs: {},
        contextSource: {},
        created: 1,
        UsageTimestamps: 0,
      },
      filePath: file.path,
      folderName: "Deferred",
    });
    await callback;

    expect(upsertCachedProjectRecordForOwner).not.toHaveBeenCalled();
  });

  it("does not install folder-scan records after cleanup during context-cache clearing", async () => {
    const contextClear = createDeferred<void>();
    const nextRecords = [
      {
        project: {
          id: "next",
          name: "Next",
          systemPrompt: "",
          projectModelKey: "",
          modelConfigs: {},
          contextSource: {},
          created: 1,
          UsageTimestamps: 0,
        },
        filePath: "Projects/Next/project.md",
        folderName: "Next",
      },
    ];
    manager.fetchPreparedProjectScan.mockResolvedValueOnce(nextRecords);
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance.mockReturnValue({
      clearForProject: jest.fn(() => contextClear.promise),
    });
    const { getCachedProjectRecords } = jest.requireMock<{
      getCachedProjectRecords: jest.Mock;
    }>("@/projects/state");
    getCachedProjectRecords.mockReturnValue(nextRecords);
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();

    const folderChange = (
      register as unknown as {
        handleProjectsFolderChange: (folder: string) => Promise<void>;
      }
    ).handleProjectsFolderChange("Next Projects");
    await flushPromises();
    register.cleanup();
    contextClear.resolve();
    await folderChange;

    expect(manager.commitPreparedProjectScan).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight folder scan immediately before an event mutation", async () => {
    const pendingFolderScan = createDeferred<ProjectFileRecord[]>();
    const eventRecord = createProjectRecord("Event");
    manager.fetchPreparedProjectScan
      .mockReturnValueOnce(pendingFolderScan.promise)
      .mockResolvedValueOnce([eventRecord]);
    const { isProjectConfigFile, parseProjectConfigFile } = jest.requireMock<{
      isProjectConfigFile: jest.Mock;
      parseProjectConfigFile: jest.Mock;
    }>("@/projects/projectUtils");
    isProjectConfigFile.mockReturnValue(true);
    parseProjectConfigFile.mockResolvedValueOnce(eventRecord).mockResolvedValueOnce(eventRecord);
    const { upsertCachedProjectRecordForOwner } = jest.requireMock<{
      upsertCachedProjectRecordForOwner: jest.Mock;
    }>("@/projects/state");
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();

    const folderChange = (
      register as unknown as {
        handleProjectsFolderChange: (folder: string) => Promise<void>;
      }
    ).handleProjectsFolderChange("Next Projects");
    await flushPromises();

    await getVaultHandler(vault, "create")({ path: eventRecord.filePath });
    pendingFolderScan.resolve([createProjectRecord("Stale")]);
    await folderChange;
    await flushPromises();
    await flushPromises();

    expect(upsertCachedProjectRecordForOwner).toHaveBeenCalledWith(projectStateOwner, eventRecord);
    expect(manager.commitPreparedProjectScan).toHaveBeenCalledTimes(1);
    expect(manager.commitPreparedProjectScan.mock.calls[0]?.[1]).toEqual([eventRecord]);
    const mutationInvalidationOrder =
      manager.invalidatePreparedProjectScans.mock.invocationCallOrder.at(-1);
    const stateMutationOrder = upsertCachedProjectRecordForOwner.mock.invocationCallOrder[0];
    expect(mutationInvalidationOrder).toBeLessThan(stateMutationOrder);
  });

  it("does not let an old-folder create event write after the new-folder scan commits", async () => {
    const oldFolderParse = createDeferred<ProjectFileRecord | null>();
    const oldFolderRecord = createProjectRecord("Old event");
    const newFolderRecords = [createProjectRecord("New folder")];
    const { ensureProjectFrontmatter, isProjectConfigFile, parseProjectConfigFile } =
      jest.requireMock<{
        ensureProjectFrontmatter: jest.Mock;
        isProjectConfigFile: jest.Mock;
        parseProjectConfigFile: jest.Mock;
      }>("@/projects/projectUtils");
    isProjectConfigFile.mockReturnValue(true);
    parseProjectConfigFile.mockReturnValueOnce(oldFolderParse.promise);
    manager.fetchPreparedProjectScan.mockResolvedValueOnce(newFolderRecords);
    const { upsertCachedProjectRecordForOwner } = jest.requireMock<{
      upsertCachedProjectRecordForOwner: jest.Mock;
    }>("@/projects/state");
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();
    const settingsHandler = subscribeToSettingsChange.mock.calls[0][0] as (
      previous: { projectsFolder: string },
      next: { projectsFolder: string }
    ) => void;

    const staleCreate = getVaultHandler(
      vault,
      "create"
    )({
      path: oldFolderRecord.filePath,
    });
    await flushPromises();
    settingsHandler({ projectsFolder: "Folder A" }, { projectsFolder: "Folder B" });
    await flushPromises();
    await flushPromises();
    expect(manager.commitPreparedProjectScan.mock.calls[0]?.[1]).toBe(newFolderRecords);

    oldFolderParse.resolve(oldFolderRecord);
    await staleCreate;

    expect(ensureProjectFrontmatter).not.toHaveBeenCalled();
    expect(upsertCachedProjectRecordForOwner).not.toHaveBeenCalled();
    expect(manager.commitPreparedProjectScan).toHaveBeenCalledTimes(1);
  });

  it("uses the same folder authority for a debounced modify continuation", async () => {
    const oldFolderParse = createDeferred<ProjectFileRecord | null>();
    const oldFolderRecord = createProjectRecord("Old modify");
    const newFolderRecords = [createProjectRecord("New folder")];
    const { isProjectConfigFile, parseProjectConfigFile } = jest.requireMock<{
      isProjectConfigFile: jest.Mock;
      parseProjectConfigFile: jest.Mock;
    }>("@/projects/projectUtils");
    isProjectConfigFile.mockReturnValue(true);
    parseProjectConfigFile.mockReturnValueOnce(oldFolderParse.promise);
    manager.fetchPreparedProjectScan.mockResolvedValueOnce(newFolderRecords);
    const { replaceCachedProjectRecordByFilePathForOwner } = jest.requireMock<{
      replaceCachedProjectRecordByFilePathForOwner: jest.Mock;
    }>("@/projects/state");
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();
    const settingsHandler = subscribeToSettingsChange.mock.calls[0][0] as (
      previous: { projectsFolder: string },
      next: { projectsFolder: string }
    ) => void;

    void getVaultHandler(vault, "modify")({ path: oldFolderRecord.filePath });
    await flushPromises();
    settingsHandler({ projectsFolder: "Folder A" }, { projectsFolder: "Folder B" });
    await flushPromises();
    await flushPromises();

    oldFolderParse.resolve(oldFolderRecord);
    await flushPromises();
    await flushPromises();

    expect(replaceCachedProjectRecordByFilePathForOwner).not.toHaveBeenCalled();
    expect(manager.commitPreparedProjectScan).toHaveBeenCalledTimes(1);
    expect(manager.commitPreparedProjectScan.mock.calls[0]?.[1]).toBe(newFolderRecords);
  });

  it("invalidates folder B synchronously when settings move on to folder C", async () => {
    const folderBCacheClear = createDeferred<void>();
    const oldRecords = [createProjectRecord("Old")];
    const folderBRecords = [createProjectRecord("Folder B")];
    const folderCRecords = [createProjectRecord("Folder C")];
    manager.fetchPreparedProjectScan
      .mockResolvedValueOnce(folderBRecords)
      .mockResolvedValueOnce(folderCRecords);
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    const clearForProject = jest
      .fn()
      .mockReturnValueOnce(folderBCacheClear.promise)
      .mockResolvedValue(undefined);
    ProjectContextCache.getInstance.mockReturnValue({ clearForProject });
    const { getCachedProjectRecords } = jest.requireMock<{
      getCachedProjectRecords: jest.Mock;
    }>("@/projects/state");
    getCachedProjectRecords.mockReturnValue(oldRecords);
    const register = new ProjectRegister(createApp(vault));
    await register.initialize();
    const settingsHandler = subscribeToSettingsChange.mock.calls[0][0] as (
      previous: { projectsFolder: string },
      next: { projectsFolder: string }
    ) => void;

    settingsHandler({ projectsFolder: "Folder A" }, { projectsFolder: "Folder B" });
    await flushPromises();
    expect(clearForProject).toHaveBeenCalledTimes(1);

    settingsHandler({ projectsFolder: "Folder B" }, { projectsFolder: "Folder C" });
    await flushPromises();
    await flushPromises();

    expect(manager.commitPreparedProjectScan).toHaveBeenCalledTimes(1);
    expect(manager.commitPreparedProjectScan.mock.calls[0]?.[1]).toBe(folderCRecords);

    folderBCacheClear.resolve();
    await flushPromises();
    await flushPromises();

    expect(manager.commitPreparedProjectScan).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer same-App Register active when the older Register cleans up late", async () => {
    const firstOwner = {};
    const secondOwner = {};
    const firstManager = {
      initialize: jest.fn(async () => {}),
      fetchProjects: jest.fn(async () => []),
      reloadProjects: jest.fn(async () => []),
      dispose: jest.fn(),
      getStateOwner: jest.fn(() => firstOwner),
    };
    const secondManager = {
      initialize: jest.fn(async () => {}),
      fetchProjects: jest.fn(async () => []),
      reloadProjects: jest.fn(async () => []),
      dispose: jest.fn(),
      getStateOwner: jest.fn(() => secondOwner),
    };
    const { ProjectFileManager } = jest.requireMock<{
      ProjectFileManager: { startLifecycle: jest.Mock };
    }>("@/projects/ProjectFileManager");
    ProjectFileManager.startLifecycle
      .mockReturnValueOnce(firstManager)
      .mockReturnValueOnce(secondManager);
    const { isProjectStateOwnerActive } = jest.requireMock<{
      isProjectStateOwnerActive: jest.Mock;
    }>("@/projects/state");
    isProjectStateOwnerActive.mockImplementation((owner: unknown) => owner === secondOwner);
    const appContext = createApp(vault);

    const firstRegister = new ProjectRegister(appContext);
    const secondRegister = new ProjectRegister(appContext);
    firstRegister.cleanup();
    await secondRegister.initialize();

    expect(firstManager.dispose).toHaveBeenCalledTimes(1);
    expect(secondManager.dispose).not.toHaveBeenCalled();
    expect(secondManager.initialize).toHaveBeenCalledTimes(1);
  });
});
