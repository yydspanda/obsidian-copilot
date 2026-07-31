import type { App, Vault } from "obsidian";

import { ProjectRegister, ProjectRegisterDisposedError } from "@/projects/projectRegister";

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
  deleteCachedProjectRecordByFilePath: jest.fn(),
  getCachedProjectRecordByFilePath: jest.fn(),
  getCachedProjectRecordById: jest.fn(),
  getCachedProjectRecords: jest.fn(() => []),
  isPendingFileWrite: jest.fn(() => false),
  replaceCachedProjectRecordByFilePath: jest.fn(),
  updateCachedProjectRecords: jest.fn(),
  upsertCachedProjectRecord: jest.fn(),
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

describe("ProjectRegister lifecycle", () => {
  const manager = {
    initialize: jest.fn<Promise<void>, []>(),
    fetchProjects: jest.fn(async () => []),
  };
  let vault: jest.Mocked<Vault>;
  let subscribeToSettingsChange: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    vault = createVault();
    manager.initialize.mockResolvedValue(undefined);
    const { ProjectFileManager } = jest.requireMock<{
      ProjectFileManager: { getInstance: jest.Mock };
    }>("@/projects/ProjectFileManager");
    ProjectFileManager.getInstance.mockReturnValue(manager);
    ({ subscribeToSettingsChange } = jest.requireMock<{
      subscribeToSettingsChange: jest.Mock;
    }>("@/settings/model"));
    subscribeToSettingsChange.mockReturnValue(jest.fn());
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
    expect(subscribeToSettingsChange).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "delete", "rename", "modify"]) {
      expect(countEventCalls(vault.on, eventName)).toBe(1);
      expect(countEventCalls(vault.off, eventName)).toBe(1);
    }
  });
});
