import { App, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import {
  buildHiddenProjectFrontmatter,
  ProjectFileManager,
  ProjectFileManagerDisposedError,
  ProjectFileManagerFolderChangedError,
} from "@/projects/ProjectFileManager";
import { mockTFile } from "@/__tests__/mockObsidian";
import { COPILOT_PROJECT_KNOWLEDGE_BUNDLE } from "@/projects/constants";
import { ProjectFileRecord } from "@/projects/type";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects", projectList: [] })),
  updateSetting: jest.fn(),
}));

jest.mock("@/projects/state", () => ({
  acquireProjectFileWrite: jest.fn(() => ({})),
  beginProjectStateLifecycle: jest.fn(() => ({})),
  isProjectStateOwnerActive: jest.fn(() => true),
  releaseProjectFileWrite: jest.fn(() => true),
  releaseProjectStateLifecycle: jest.fn(() => true),
  isPendingFileWrite: jest.fn(() => false),
  upsertCachedProjectRecordForOwner: jest.fn(() => true),
  deleteCachedProjectRecordByIdForOwner: jest.fn(() => true),
  updateCachedProjectRecordsForOwner: jest.fn(() => true),
  // Reason: overridden per-test to simulate cache state
  getCachedProjectRecords: jest.fn(() => []),
  getCachedProjectRecordById: jest.fn(() => undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/projects/projectUtils", () => ({
  sanitizeVaultPathSegment: jest.fn((s: string) => s.replace(/[/\\]/g, "_")),
  fetchAllProjects: jest.fn(async () => []),
  loadAllProjects: jest.fn(async () => []),
  writeProjectFrontmatter: jest.fn(async () => {}),
  getProjectsFolder: jest.fn(() => "copilot-projects"),
  getProjectFolderPath: jest.fn((name: string) => `copilot-projects/${name}`),
  getProjectConfigFilePath: jest.fn((name: string) => `copilot-projects/${name}/project.md`),
  splitUrlsStringToArray: jest.fn((value: string) => (value ? value.split("\n") : [])),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => {}),
}));

jest.mock("@/utils/vaultAdapterUtils", () => ({
  isInVaultCache: jest.fn(() => true),
  patchFrontmatter: jest.fn(async () => {}),
  readFrontmatterViaAdapter: jest.fn(async () => ({})),
  resolveFileByPath: jest.fn(),
  trashFile: jest.fn(async () => {}),
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({
      clearForProject: jest.fn(async () => {}),
      dispose: jest.fn(),
    })),
  },
}));

jest.mock("@/utils/recentUsageManager", () => ({
  RecentUsageManager: jest.fn().mockImplementation(() => ({
    touch: jest.fn(),
    shouldPersist: jest.fn(() => null),
    markPersisted: jest.fn(),
    getLastTouchedAt: jest.fn(() => null),
    getRecentItems: jest.fn(() => []),
  })),
}));

jest.mock("@/projects/projectMigration", () => ({
  ensureProjectsMigratedIfNeeded: jest.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  getCachedProjectRecords,
  getCachedProjectRecordById,
  releaseProjectStateLifecycle,
  updateCachedProjectRecordsForOwner,
} from "@/projects/state";
import { fetchAllProjects } from "@/projects/projectUtils";
import { ensureProjectsMigratedIfNeeded } from "@/projects/projectMigration";

/** Minimal valid ProjectConfig for test use. */
function makeConfig(
  overrides: { id: string; name: string } & Partial<ProjectConfig>
): ProjectConfig {
  return {
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

/** Build a minimal Vault mock. */
function makeMockVault(): jest.Mocked<Vault> {
  return {
    create: jest.fn(async (path: string) => mockTFile({ path })),
    read: jest.fn(async () => "---\ncopilot-project-id: project\n---\nOld body"),
    modify: jest.fn(async () => {}),
    // Reason: null = file does not exist yet, avoids collision error in createProject
    getAbstractFileByPath: jest.fn(() => null),
    adapter: { exists: jest.fn(async () => false) },
  } as unknown as jest.Mocked<Vault>;
}

/** Build a minimal App mock wrapping a vault. */
function makeMockApp(vault: Vault): App {
  return {
    vault,
    fileManager: { trashFile: jest.fn(async () => {}) },
  } as unknown as App;
}

/** Reset the singleton so each test gets a fresh instance. */
function resetSingleton() {
  (ProjectFileManager as unknown as Record<string, unknown>)["instance"] = undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * Creates an externally settled Promise for lifecycle interleaving tests.
 *
 * @returns Deferred Promise and settlement callbacks
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
 * Flushes Promise continuations without relying on timers.
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectFileManager lifecycle ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
  });

  it("requires an App when no active singleton exists", () => {
    expect(() => ProjectFileManager.getInstance()).toThrow(
      "App is required when no active ProjectFileManager exists"
    );
  });

  it("rebinds to a different App/Vault and permanently rejects the old reference", () => {
    const firstApp = makeMockApp(makeMockVault());
    const secondApp = makeMockApp(makeMockVault());
    const first = ProjectFileManager.getInstance(firstApp);
    const firstOwner = first.getStateOwner();

    expect(ProjectFileManager.getInstance(firstApp)).toBe(first);

    const second = ProjectFileManager.getInstance(secondApp);

    expect(second).not.toBe(first);
    expect(releaseProjectStateLifecycle).toHaveBeenCalledWith(firstOwner);
    expect(() => first.getProjects()).toThrow(ProjectFileManagerDisposedError);
    expect(ProjectFileManager.getInstance()).toBe(second);
  });

  it("starts a fresh owner for overlapping hot reloads on the same App", () => {
    const firstContextCache = {
      clearForProject: jest.fn(async () => {}),
      dispose: jest.fn(),
    };
    const secondContextCache = {
      clearForProject: jest.fn(async () => {}),
      dispose: jest.fn(),
    };
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance
      .mockReturnValueOnce(firstContextCache)
      .mockReturnValueOnce(secondContextCache);
    const appContext = makeMockApp(makeMockVault());
    const first = ProjectFileManager.startLifecycle(appContext);
    const firstOwner = first.getStateOwner();

    const second = ProjectFileManager.startLifecycle(appContext);
    const secondOwner = second.getStateOwner();
    first.dispose();

    expect(second).not.toBe(first);
    expect(secondOwner).not.toBe(firstOwner);
    expect(releaseProjectStateLifecycle).toHaveBeenCalledTimes(1);
    expect(jest.mocked(releaseProjectStateLifecycle).mock.calls[0]?.[0]).toBe(firstOwner);
    expect(jest.mocked(releaseProjectStateLifecycle).mock.calls[0]?.[0]).not.toBe(secondOwner);
    expect(firstContextCache.dispose).toHaveBeenCalledTimes(1);
    expect(secondContextCache.dispose).not.toHaveBeenCalled();
    expect(ProjectFileManager.getInstance()).toBe(second);
    expect(() => second.getProjects()).not.toThrow();
  });

  it("shares initialization and prevents a disposed in-flight scan from committing", async () => {
    const pendingScan = createDeferred<ProjectFileRecord[]>();
    (fetchAllProjects as jest.Mock).mockReturnValueOnce(pendingScan.promise);
    const manager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));

    const first = manager.initialize();
    const second = manager.initialize();

    expect(second).toBe(first);
    await flushPromises();
    expect(ensureProjectsMigratedIfNeeded).toHaveBeenCalledTimes(1);
    expect(fetchAllProjects).toHaveBeenCalledTimes(1);

    manager.dispose();
    pendingScan.resolve([]);

    await expect(first).rejects.toBeInstanceOf(ProjectFileManagerDisposedError);
    expect(updateCachedProjectRecordsForOwner).not.toHaveBeenCalled();
  });

  it("permits a clean initialization retry after an active-lifecycle failure", async () => {
    (ensureProjectsMigratedIfNeeded as jest.Mock).mockRejectedValueOnce(
      new Error("migration failed")
    );
    const manager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const owner = manager.getStateOwner();

    await expect(manager.initialize()).rejects.toThrow("migration failed");
    await expect(manager.initialize()).resolves.toBeUndefined();

    expect(ensureProjectsMigratedIfNeeded).toHaveBeenCalledTimes(2);
    expect(fetchAllProjects).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledWith(owner, []);
  });

  it("cannot let an old App scan overwrite the cache installed by a rebound App", async () => {
    const staleScan = createDeferred<ProjectFileRecord[]>();
    const currentRecords = [
      {
        project: makeConfig({ id: "current", name: "Current" }),
        filePath: "copilot-projects/Current/project.md",
        folderName: "Current",
      },
    ];
    (fetchAllProjects as jest.Mock)
      .mockReturnValueOnce(staleScan.promise)
      .mockResolvedValueOnce(currentRecords);
    const oldManager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const oldInitialization = oldManager.initialize();
    await flushPromises();
    expect(fetchAllProjects).toHaveBeenCalledTimes(1);

    const newManager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const newOwner = newManager.getStateOwner();
    await newManager.initialize();
    staleScan.resolve([
      {
        project: makeConfig({ id: "stale", name: "Stale" }),
        filePath: "copilot-projects/Stale/project.md",
        folderName: "Stale",
      },
    ]);
    await expect(oldInitialization).rejects.toBeInstanceOf(ProjectFileManagerDisposedError);

    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledWith(newOwner, currentRecords);
  });

  it("installs only the latest concurrent reload result", async () => {
    const firstScan = createDeferred<ProjectFileRecord[]>();
    const secondScan = createDeferred<ProjectFileRecord[]>();
    const firstRecords = [
      {
        project: makeConfig({ id: "first", name: "First" }),
        filePath: "copilot-projects/First/project.md",
        folderName: "First",
      },
    ];
    const secondRecords = [
      {
        project: makeConfig({ id: "second", name: "Second" }),
        filePath: "copilot-projects/Second/project.md",
        folderName: "Second",
      },
    ];
    (fetchAllProjects as jest.Mock)
      .mockReturnValueOnce(firstScan.promise)
      .mockReturnValueOnce(secondScan.promise);
    const manager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const owner = manager.getStateOwner();

    const firstReload = manager.reloadProjects();
    const secondReload = manager.reloadProjects();
    secondScan.resolve(secondRecords);
    await expect(secondReload).resolves.toBe(secondRecords);
    firstScan.resolve(firstRecords);
    await expect(firstReload).resolves.toBe(firstRecords);

    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledWith(owner, secondRecords);
  });

  it("uses one authority across a reload and a separately prepared folder scan", async () => {
    const reloadScan = createDeferred<ProjectFileRecord[]>();
    const folderScan = createDeferred<ProjectFileRecord[]>();
    const reloadRecords = [
      {
        project: makeConfig({ id: "reload", name: "Reload" }),
        filePath: "copilot-projects/Reload/project.md",
        folderName: "Reload",
      },
    ];
    const folderRecords = [
      {
        project: makeConfig({ id: "folder", name: "Folder" }),
        filePath: "copilot-projects/Folder/project.md",
        folderName: "Folder",
      },
    ];
    (fetchAllProjects as jest.Mock)
      .mockReturnValueOnce(reloadScan.promise)
      .mockReturnValueOnce(folderScan.promise);
    const manager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const owner = manager.getStateOwner();

    const reload = manager.reloadProjects();
    const preparedFolderScan = manager.prepareProjectScan();
    const folderFetch = manager.fetchPreparedProjectScan(preparedFolderScan);
    folderScan.resolve(folderRecords);
    await expect(folderFetch).resolves.toBe(folderRecords);
    expect(manager.commitPreparedProjectScan(preparedFolderScan, folderRecords)).toBe(true);

    reloadScan.resolve(reloadRecords);
    await expect(reload).resolves.toBe(reloadRecords);

    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledWith(owner, folderRecords);
  });

  it("does not let an in-flight scan overwrite a newer CRUD mutation", async () => {
    const staleScan = createDeferred<ProjectFileRecord[]>();
    const staleRecords = [
      {
        project: makeConfig({ id: "stale", name: "Stale" }),
        filePath: "copilot-projects/Stale/project.md",
        folderName: "Stale",
      },
    ];
    (fetchAllProjects as jest.Mock).mockReturnValueOnce(staleScan.promise);
    const manager = ProjectFileManager.getInstance(makeMockApp(makeMockVault()));
    const reload = manager.reloadProjects();

    await manager.createProject(makeConfig({ id: "created", name: "Created" }));
    staleScan.resolve(staleRecords);
    await expect(reload).resolves.toBe(staleRecords);

    const { upsertCachedProjectRecordForOwner } = jest.requireMock<{
      upsertCachedProjectRecordForOwner: jest.Mock;
    }>("@/projects/state");
    expect(upsertCachedProjectRecordForOwner).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).not.toHaveBeenCalled();
  });

  it("does not let an old-folder create overwrite a committed new-folder scan", async () => {
    const fileExists = createDeferred<boolean>();
    const newFolderRecords = [
      {
        project: makeConfig({ id: "new-folder", name: "New Folder" }),
        filePath: "new-projects/New Folder/project.md",
        folderName: "New Folder",
      },
    ];
    const vault = makeMockVault();
    (vault.adapter.exists as jest.Mock).mockReturnValueOnce(fileExists.promise);
    (fetchAllProjects as jest.Mock).mockResolvedValueOnce(newFolderRecords);
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));
    const owner = manager.getStateOwner();

    const staleCreate = manager.createProject(makeConfig({ id: "old-folder", name: "Old Folder" }));
    await flushPromises();
    manager.invalidateProjectsFolder();
    await manager.reloadProjects();
    fileExists.resolve(false);

    await expect(staleCreate).rejects.toBeInstanceOf(ProjectFileManagerFolderChangedError);
    const { upsertCachedProjectRecordForOwner } = jest.requireMock<{
      upsertCachedProjectRecordForOwner: jest.Mock;
    }>("@/projects/state");
    expect(vault.create).not.toHaveBeenCalled();
    expect(upsertCachedProjectRecordForOwner).not.toHaveBeenCalled();
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledTimes(1);
    expect(updateCachedProjectRecordsForOwner).toHaveBeenCalledWith(owner, newFolderRecords);
  });

  it("passes the exact owning App into every lifecycle scan", async () => {
    const appContext = makeMockApp(makeMockVault());
    const manager = ProjectFileManager.getInstance(appContext);

    const preparedScan = manager.prepareProjectScan();
    await manager.fetchPreparedProjectScan(preparedScan);
    await manager.reloadProjects();

    expect(fetchAllProjects).toHaveBeenNthCalledWith(1, appContext);
    expect(fetchAllProjects).toHaveBeenNthCalledWith(2, appContext);
  });

  it("does not continue a deferred create write after a newer lifecycle starts", async () => {
    const fileExists = createDeferred<boolean>();
    const vault = makeMockVault();
    (vault.adapter.exists as jest.Mock).mockReturnValueOnce(fileExists.promise);
    const appContext = makeMockApp(vault);
    const oldManager = ProjectFileManager.startLifecycle(appContext);

    const creation = oldManager.createProject(makeConfig({ id: "deferred", name: "Deferred" }));
    await flushPromises();
    expect(vault.adapter.exists).toHaveBeenCalledTimes(1);

    ProjectFileManager.startLifecycle(appContext);
    fileExists.resolve(false);

    await expect(creation).rejects.toBeInstanceOf(ProjectFileManagerDisposedError);
    expect(vault.create).not.toHaveBeenCalled();
  });

  it("does not roll back a completed create I/O after lifecycle replacement", async () => {
    const frontmatterWrite = createDeferred<void>();
    const vault = makeMockVault();
    const appContext = makeMockApp(vault);
    const { writeProjectFrontmatter } = jest.requireMock<{
      writeProjectFrontmatter: jest.Mock;
    }>("@/projects/projectUtils");
    const { trashFile } = jest.requireMock<{
      trashFile: jest.Mock;
    }>("@/utils/vaultAdapterUtils");
    writeProjectFrontmatter.mockReturnValueOnce(frontmatterWrite.promise);
    const oldManager = ProjectFileManager.startLifecycle(appContext);

    const creation = oldManager.createProject(makeConfig({ id: "deferred", name: "Deferred" }));
    await flushPromises();
    await flushPromises();
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(writeProjectFrontmatter).toHaveBeenCalledTimes(1);

    ProjectFileManager.startLifecycle(appContext);
    frontmatterWrite.reject(new Error("frontmatter failed"));

    await expect(creation).rejects.toBeInstanceOf(ProjectFileManagerDisposedError);
    expect(trashFile).not.toHaveBeenCalled();
  });
});

describe("ProjectFileManager.createProject", () => {
  let vault: jest.Mocked<Vault>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
    vault = makeMockVault();
    (getCachedProjectRecords as jest.Mock).mockReturnValue([]);
    (getCachedProjectRecordById as jest.Mock).mockReturnValue(undefined);
  });

  it("rejects duplicate project names (case-insensitive)", async () => {
    (getCachedProjectRecords as jest.Mock).mockReturnValue([
      {
        project: makeConfig({ id: "existing", name: "My Project" }),
        filePath: "copilot-projects/existing/project.md",
        folderName: "existing",
      },
    ]);

    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    // "my project" (lowercase) collides with "My Project"
    await expect(
      manager.createProject(makeConfig({ id: "new-project", name: "my project" }))
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects empty project id", async () => {
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    await expect(manager.createProject(makeConfig({ id: "", name: "Valid Name" }))).rejects.toThrow(
      /cannot be empty/i
    );
  });

  it("rejects whitespace-only project id", async () => {
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    await expect(
      manager.createProject(makeConfig({ id: "   ", name: "Valid Name" }))
    ).rejects.toThrow(/cannot be empty/i);
  });
});

describe("ProjectFileManager.updateProject knowledge Bundle intent", () => {
  let vault: jest.Mocked<Vault>;
  let writeProjectFrontmatter: jest.Mock;
  let resolveFileByPath: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
    vault = makeMockVault();
    ({ writeProjectFrontmatter } = jest.requireMock<{
      writeProjectFrontmatter: jest.Mock;
    }>("@/projects/projectUtils"));
    ({ resolveFileByPath } = jest.requireMock<{
      resolveFileByPath: jest.Mock;
    }>("@/utils/vaultAdapterUtils"));
    resolveFileByPath.mockResolvedValue(mockTFile({ path: "copilot-projects/Project/project.md" }));
  });

  it("preserves the existing advanced Bundle when the update omits knowledgeBundle", async () => {
    const knowledgeBundle = {
      version: 1,
      id: "advanced",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Schemas/knowledge.md",
      reviewMode: "always",
    };
    const existing = {
      project: makeConfig({
        id: "project",
        name: "Project",
        knowledgeBundle,
        created: 10,
      }),
      filePath: "copilot-projects/Project/project.md",
      folderName: "Project",
    };
    (getCachedProjectRecordById as jest.Mock).mockReturnValue(existing);
    (getCachedProjectRecords as jest.Mock).mockReturnValue([existing]);
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    const updated = await manager.updateProject(
      "project",
      makeConfig({ id: "project", name: "Project", systemPrompt: "Updated" })
    );

    const serializedProject = writeProjectFrontmatter.mock.calls[0][2] as ProjectConfig;
    expect(serializedProject.knowledgeBundle).toBe(knowledgeBundle);
    expect(updated.project.knowledgeBundle).toBe(knowledgeBundle);
  });

  it("deletes the existing Bundle when the update owns knowledgeBundle with undefined", async () => {
    const existing = {
      project: makeConfig({
        id: "project",
        name: "Project",
        knowledgeBundle: { version: "advanced" },
        created: 10,
      }),
      filePath: "copilot-projects/Project/project.md",
      folderName: "Project",
    };
    (getCachedProjectRecordById as jest.Mock).mockReturnValue(existing);
    (getCachedProjectRecords as jest.Mock).mockReturnValue([existing]);
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    const updated = await manager.updateProject(
      "project",
      makeConfig({
        id: "project",
        name: "Project",
        systemPrompt: "Updated",
        knowledgeBundle: undefined,
      })
    );

    const serializedProject = writeProjectFrontmatter.mock.calls[0][2] as ProjectConfig;
    expect(serializedProject).not.toHaveProperty("knowledgeBundle");
    expect(updated.project).not.toHaveProperty("knowledgeBundle");
  });
});

describe("buildHiddenProjectFrontmatter knowledge Bundle persistence", () => {
  it("preserves the exact value and omits the key when hidden-folder content is unconfigured", () => {
    const knowledgeBundle = {
      version: "untrusted",
      wikiRoot: "Wiki\\Native",
      extra: true,
    };

    const configuredFrontmatter = buildHiddenProjectFrontmatter(
      makeConfig({ id: "project", name: "Project", knowledgeBundle }),
      "Project",
      { createdMs: 1, lastUsedMs: 2 }
    );
    expect(configuredFrontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]).toBe(knowledgeBundle);

    const unconfiguredFrontmatter = buildHiddenProjectFrontmatter(
      makeConfig({ id: "project", name: "Project" }),
      "Project",
      {
        createdMs: 1,
        lastUsedMs: 2,
      }
    );
    expect(unconfiguredFrontmatter).not.toHaveProperty(COPILOT_PROJECT_KNOWLEDGE_BUNDLE);
  });
});
