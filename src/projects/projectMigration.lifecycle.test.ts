import { App, TFile } from "obsidian";

import { mockTFile } from "@/__tests__/mockObsidian";
import { ProjectConfig } from "@/aiParams";
import {
  ensureProjectsMigratedIfNeeded,
  migrateProjectsFromSettingsToVault,
} from "@/projects/projectMigration";
import {
  ProjectStateLifecycleEndedError,
  scanAllProjectConfigFiles,
} from "@/projects/projectUtils";
import { beginProjectStateLifecycle } from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";

const mockModalOpen = jest.fn();

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation(() => ({ open: mockModalOpen })),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async (_path: string, _vault: unknown, assertActive?: () => void) => {
    assertActive?.();
  }),
  stripFrontmatter: jest.fn((content: string) => content),
}));

jest.mock("@/utils/vaultAdapterUtils", () => ({
  trashFile: jest.fn(async () => {}),
}));

jest.mock("@/projects/projectUtils", () => {
  const actual =
    jest.requireActual<typeof import("@/projects/projectUtils")>("@/projects/projectUtils");
  return {
    ...actual,
    scanAllProjectConfigFiles: jest.fn(),
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Creates a controllable Promise for lifecycle interleaving tests.
 *
 * @returns Deferred promise controls
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Builds the smallest explicit App/Vault surface used by Projects migration.
 *
 * @returns App plus directly inspectable Vault methods
 */
function createMigrationApp(): {
  app: App;
  adapter: {
    exists: jest.Mock;
    read: jest.Mock;
    rename: jest.Mock;
  };
  vault: {
    adapter: {
      exists: jest.Mock;
      read: jest.Mock;
      rename: jest.Mock;
    };
    create: jest.Mock;
    getAbstractFileByPath: jest.Mock;
    read: jest.Mock;
    rename: jest.Mock;
  };
  processFrontMatter: jest.Mock;
} {
  const adapter = {
    exists: jest.fn().mockResolvedValue(false),
    read: jest.fn().mockResolvedValue(""),
    rename: jest.fn().mockResolvedValue(undefined),
  };
  const processFrontMatter = jest.fn().mockResolvedValue(undefined);
  const vault = {
    adapter,
    create: jest
      .fn()
      .mockResolvedValue(mockTFile({ path: "copilot-projects/My Project/project.md" })),
    getAbstractFileByPath: jest.fn().mockReturnValue(null),
    read: jest.fn().mockResolvedValue("Body"),
    rename: jest.fn().mockResolvedValue(undefined),
  };
  const app = {
    vault,
    fileManager: { processFrontMatter },
    metadataCache: { getFileCache: jest.fn().mockReturnValue(null) },
  } as unknown as App;
  return { app, adapter, vault, processFrontMatter };
}

/** Creates a complete legacy project fixture. */
function createLegacyProject(): ProjectConfig {
  return {
    id: "project-1",
    name: "My Project",
    systemPrompt: "Body",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 1,
    UsageTimestamps: 2,
  };
}

describe("Projects migration lifecycle ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSettings).mockReturnValue({
      projectsFolder: "copilot-projects",
      projectList: [createLegacyProject()],
    } as unknown as ReturnType<typeof getSettings>);
  });

  it("does not write, clear settings, or open a modal after an exists read yields to a new owner", async () => {
    const { app, adapter, vault, processFrontMatter } = createMigrationApp();
    const existsStarted = createDeferred<void>();
    const existsResult = createDeferred<boolean>();
    adapter.exists.mockImplementationOnce(async () => {
      existsStarted.resolve();
      return existsResult.promise;
    });
    const oldOwner = beginProjectStateLifecycle();

    const migration = migrateProjectsFromSettingsToVault(app, oldOwner);
    await existsStarted.promise;
    beginProjectStateLifecycle();
    existsResult.resolve(false);

    await expect(migration).rejects.toBeInstanceOf(ProjectStateLifecycleEndedError);
    expect(vault.create).not.toHaveBeenCalled();
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(updateSetting).not.toHaveBeenCalled();
    expect(mockModalOpen).not.toHaveBeenCalled();
  });

  it("allows an issued create to finish but performs no frontmatter, rollback, or settings work", async () => {
    const { app, vault, processFrontMatter } = createMigrationApp();
    const createStarted = createDeferred<void>();
    const createResult = createDeferred<TFile>();
    vault.create.mockImplementationOnce(async () => {
      createStarted.resolve();
      return createResult.promise;
    });
    const oldOwner = beginProjectStateLifecycle();

    const migration = migrateProjectsFromSettingsToVault(app, oldOwner);
    await createStarted.promise;
    beginProjectStateLifecycle();
    createResult.resolve(mockTFile({ path: "copilot-projects/My Project/project.md" }));

    await expect(migration).rejects.toBeInstanceOf(ProjectStateLifecycleEndedError);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(updateSetting).not.toHaveBeenCalled();
    expect(mockModalOpen).not.toHaveBeenCalled();
  });

  it("does not continue folder renames after a rename yields to a new owner", async () => {
    const { app, adapter } = createMigrationApp();
    jest.mocked(getSettings).mockReturnValue({
      projectsFolder: "copilot-projects",
      projectList: [],
    } as unknown as ReturnType<typeof getSettings>);
    jest.mocked(scanAllProjectConfigFiles).mockResolvedValue({
      records: [
        {
          project: createLegacyProject(),
          filePath: "copilot-projects/project-1/project.md",
          folderName: "project-1",
        },
      ],
      diagnostics: { duplicateIdIndex: {}, ignoredFiles: [] },
    });
    const renameStarted = createDeferred<void>();
    const renameResult = createDeferred<void>();
    adapter.rename.mockImplementationOnce(async () => {
      renameStarted.resolve();
      return renameResult.promise;
    });
    const oldOwner = beginProjectStateLifecycle();

    const migration = ensureProjectsMigratedIfNeeded(app, oldOwner);
    await renameStarted.promise;
    beginProjectStateLifecycle();
    renameResult.resolve();

    await expect(migration).rejects.toBeInstanceOf(ProjectStateLifecycleEndedError);
    expect(adapter.rename).toHaveBeenCalledTimes(1);
    expect(updateSetting).not.toHaveBeenCalled();
    expect(mockModalOpen).not.toHaveBeenCalled();
  });
});
