import type { ProjectConfig } from "@/aiParams";
import type { Vault } from "obsidian";

import { ProjectContextCache, ProjectContextCacheDisposedError } from "@/cache/projectContextCache";

jest.mock("@/cache/fileCache", () => ({
  FileCache: {
    getInstance: jest.fn(),
  },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/projects/state", () => ({
  getCachedProjects: jest.fn(() => []),
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => ({ exclusions: [], inclusions: [] })),
  shouldIndexFile: jest.fn(() => false),
}));

jest.mock("@/utils/debounce", () => ({
  debounce: jest.fn((callback: (...args: unknown[]) => void) => {
    const debounced = jest.fn(callback) as jest.Mock & { cancel: jest.Mock };
    debounced.cancel = jest.fn();
    return debounced;
  }),
}));

jest.mock("@/utils/hash", () => ({
  md5: jest.fn((value: string) => `hash:${value}`),
}));

jest.mock("obsidian", () => ({
  TAbstractFile: class MockTAbstractFile {},
  TFile: class MockTFile {},
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface VaultFixture {
  adapter: {
    exists: jest.Mock;
    list: jest.Mock;
    mkdir: jest.Mock;
    read: jest.Mock;
    remove: jest.Mock;
    write: jest.Mock;
  };
  off: jest.Mock;
  on: jest.Mock;
  vault: Vault;
}

interface FileCacheMock {
  dispose: jest.Mock;
}

/**
 * Create an externally resolved Promise for in-flight disposal tests.
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
 * Build a Vault with observable listener and adapter operations.
 *
 * @returns Minimal Vault mock
 */
function createVault(): VaultFixture {
  const adapter = {
    exists: jest.fn(async () => false),
    list: jest.fn(async () => ({ files: [], folders: [] })),
    mkdir: jest.fn(async () => {}),
    read: jest.fn(async () => ""),
    remove: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
  };
  const off = jest.fn();
  const on = jest.fn();
  return {
    adapter,
    off,
    on,
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn(() => null),
      getFiles: jest.fn(() => []),
      off,
      on,
    } as unknown as Vault,
  };
}

/**
 * Count listener calls for one Vault event.
 *
 * @param listenerMock - Vault on/off mock
 * @param eventName - Event name to count
 * @returns Number of matching listener calls
 */
function countListenerCalls(listenerMock: jest.Mock, eventName: string): number {
  return listenerMock.mock.calls.filter(([observedName]) => observedName === eventName).length;
}

const project = {
  contextSource: {
    exclusions: "",
    inclusions: "",
  },
  id: "project-a",
  name: "Project A",
} as ProjectConfig;

describe("ProjectContextCache Vault lifecycle", () => {
  let activeCache: ProjectContextCache | undefined;
  let fileCaches: FileCacheMock[];

  beforeEach(() => {
    activeCache?.dispose();
    activeCache = undefined;
    jest.clearAllMocks();
    fileCaches = [];

    const { FileCache } = jest.requireMock<{
      FileCache: { getInstance: jest.Mock };
    }>("@/cache/fileCache");
    FileCache.getInstance.mockImplementation(() => {
      const fileCache = {
        dispose: jest.fn(),
      };
      fileCaches.push(fileCache);
      return fileCache;
    });
  });

  afterEach(() => {
    activeCache?.dispose();
  });

  it("reuses one cache and registers one listener set for the same Vault", () => {
    const vault = createVault();

    const first = ProjectContextCache.getInstance(vault.vault);
    activeCache = first;
    const second = ProjectContextCache.getInstance(vault.vault);

    expect(second).toBe(first);
    for (const eventName of ["create", "modify", "delete", "rename"]) {
      expect(countListenerCalls(vault.on, eventName)).toBe(1);
    }
    expect(fileCaches).toHaveLength(1);
  });

  it("rebinds to a new Vault and releases every old listener and memory owner", async () => {
    const firstVault = createVault();
    const secondVault = createVault();
    firstVault.adapter.exists.mockResolvedValueOnce(true);
    firstVault.adapter.read.mockResolvedValueOnce(
      JSON.stringify({
        fileContexts: {},
        markdownContext: "old-vault-context",
        markdownNeedsReload: false,
        timestamp: 1,
        webContexts: {},
        youtubeContexts: {},
      })
    );
    const first = ProjectContextCache.getInstance(firstVault.vault);
    await expect(first.get(project)).resolves.toMatchObject({
      markdownContext: "old-vault-context",
    });

    const second = ProjectContextCache.getInstance(secondVault.vault);
    activeCache = second;

    expect(second).not.toBe(first);
    for (const eventName of ["create", "modify", "delete", "rename"]) {
      expect(countListenerCalls(firstVault.off, eventName)).toBe(1);
      expect(countListenerCalls(secondVault.on, eventName)).toBe(1);
    }
    expect(fileCaches[0].dispose).toHaveBeenCalledTimes(1);
    expect(() => first.getSync(project)).toThrow(ProjectContextCacheDisposedError);
    await expect(second.get(project)).resolves.toBeNull();
    expect(secondVault.adapter.read).not.toHaveBeenCalled();
  });

  it("fails closed when a read is disposed while Vault I/O is in flight", async () => {
    const pendingExists = createDeferred<boolean>();
    const firstVault = createVault();
    firstVault.adapter.exists.mockReturnValueOnce(pendingExists.promise);
    const secondVault = createVault();
    const first = ProjectContextCache.getInstance(firstVault.vault);

    const staleRead = first.get(project);
    activeCache = ProjectContextCache.getInstance(secondVault.vault);
    pendingExists.resolve(false);

    await expect(staleRead).rejects.toBeInstanceOf(ProjectContextCacheDisposedError);
    expect(firstVault.adapter.read).not.toHaveBeenCalled();
    expect(secondVault.adapter.read).not.toHaveBeenCalled();
  });

  it("disposes idempotently and creates a clean replacement for the same Vault", () => {
    const vault = createVault();
    const first = ProjectContextCache.getInstance(vault.vault);

    first.dispose();
    first.dispose();
    const second = ProjectContextCache.getInstance(vault.vault);
    activeCache = second;

    expect(second).not.toBe(first);
    expect(fileCaches[0].dispose).toHaveBeenCalledTimes(1);
    for (const eventName of ["create", "modify", "delete", "rename"]) {
      expect(countListenerCalls(vault.off, eventName)).toBe(1);
      expect(countListenerCalls(vault.on, eventName)).toBe(2);
    }
  });

  it("finishes disposal when one Vault listener removal throws", () => {
    const vault = createVault();
    const first = ProjectContextCache.getInstance(vault.vault);
    vault.off.mockImplementationOnce(() => {
      throw new Error("listener removal failed");
    });

    expect(() => first.dispose()).not.toThrow();
    const second = ProjectContextCache.getInstance(vault.vault);
    activeCache = second;

    expect(second).not.toBe(first);
    expect(vault.off).toHaveBeenCalledTimes(4);
    expect(fileCaches[0].dispose).toHaveBeenCalledTimes(1);
  });
});
