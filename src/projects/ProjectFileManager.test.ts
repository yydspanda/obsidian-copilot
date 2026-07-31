import { App, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { buildHiddenProjectFrontmatter, ProjectFileManager } from "@/projects/ProjectFileManager";
import { mockTFile } from "@/__tests__/mockObsidian";
import { COPILOT_PROJECT_KNOWLEDGE_BUNDLE } from "@/projects/constants";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects", projectList: [] })),
  updateSetting: jest.fn(),
}));

jest.mock("@/projects/state", () => ({
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
  isPendingFileWrite: jest.fn(() => false),
  upsertCachedProjectRecord: jest.fn(),
  deleteCachedProjectRecordById: jest.fn(),
  updateCachedProjectRecords: jest.fn(),
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
    getInstance: jest.fn(() => ({ clearForProject: jest.fn(async () => {}) })),
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

import { getCachedProjectRecords, getCachedProjectRecordById } from "@/projects/state";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

    const serializedProject = writeProjectFrontmatter.mock.calls[0][1] as ProjectConfig;
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

    const serializedProject = writeProjectFrontmatter.mock.calls[0][1] as ProjectConfig;
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
