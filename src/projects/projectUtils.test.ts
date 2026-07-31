import { App, TFile } from "obsidian";
import {
  ensureProjectFrontmatter,
  parseProjectConfigFile,
  ProjectStateLifecycleEndedError,
  sanitizeVaultPathSegment,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import { mockTFile } from "@/__tests__/mockObsidian";
import { COPILOT_PROJECT_KNOWLEDGE_BUNDLE } from "@/projects/constants";
import { isProjectStateOwnerActive, ProjectStateOwner } from "@/projects/state";

// Mock deep dependencies to avoid transitive import chains
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

jest.mock("@/projects/state", () => ({
  acquireProjectFileWrite: jest.fn(() => ({})),
  isProjectStateOwnerActive: jest.fn(() => true),
  releaseProjectFileWrite: jest.fn(() => true),
  isPendingFileWrite: jest.fn(() => false),
  updateCachedProjectRecordsForOwner: jest.fn(() => true),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

// Helper: create a minimal TFile mock for a project config path
function makeMockFile(path: string): TFile {
  return mockTFile({
    path,
    name: "project.md",
    basename: "project",
    extension: "md",
    stat: { ctime: 1000, mtime: 1000, size: 0 },
    vault: {} as never,
    parent: null,
  });
}

// Helper: set up the explicit App owner used by parseProjectConfigFile
function setupAppMock(rawContent: string, frontmatter: Record<string, unknown> | null): App {
  const appContext = {
    vault: {
      read: jest.fn().mockResolvedValue(rawContent),
      // Reason: parseProjectConfigFile uses `cachedFile instanceof TFile` to detect synthetic TFiles.
      // Return an object with TFile prototype so tests exercise the vault.read() path by default.
      getAbstractFileByPath: jest.fn((path: string): TFile => mockTFile({ path })),
      adapter: { read: jest.fn().mockResolvedValue(rawContent) },
    },
    metadataCache: {
      // Reason: returning null forces the fallback YAML parse path in parseProjectConfigFile
      getFileCache: jest.fn().mockReturnValue(frontmatter ? { frontmatter } : null),
    },
  };
  (window as unknown as Record<string, unknown>).app = appContext;
  return appContext as unknown as App;
}

describe("parseProjectConfigFile", () => {
  const VALID_PATH = "copilot-projects/my-project/project.md";

  it("returns null when YAML frontmatter is malformed", async () => {
    // Malformed YAML: unbalanced braces cause a parse error
    const malformedContent = "---\nname: {bad: yaml: here\n---\nBody text";
    // Force the metadata-cache miss so the fallback YAML parser runs
    const appContext = setupAppMock(malformedContent, null);

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(appContext, file);

    expect(result).toBeNull();
  });

  it("correctly parses valid frontmatter with all fields", async () => {
    const rawContent = [
      "---",
      "copilot-project-id: my-project",
      "copilot-project-name: My Project",
      "copilot-project-description: A test project",
      "copilot-project-model-key: gpt-4",
      "copilot-project-temperature: 0.7",
      "copilot-project-max-tokens: 2048",
      "copilot-project-inclusions: notes/",
      "copilot-project-exclusions: archive/",
      "copilot-project-web-urls:",
      "  - https://example.com",
      "copilot-project-youtube-urls: []",
      "copilot-project-created: 1700000000000",
      "copilot-project-last-used: 1700000001000",
      "---",
      "System prompt body",
    ].join("\n");

    // Use metadata-cache path (non-null frontmatter) for the happy path
    const appContext = setupAppMock(rawContent, {
      "copilot-project-id": "my-project",
      "copilot-project-name": "My Project",
      "copilot-project-description": "A test project",
      "copilot-project-model-key": "gpt-4",
      "copilot-project-temperature": 0.7,
      "copilot-project-max-tokens": 2048,
      "copilot-project-inclusions": "notes/",
      "copilot-project-exclusions": "archive/",
      "copilot-project-web-urls": ["https://example.com"],
      "copilot-project-youtube-urls": [],
      "copilot-project-created": 1700000000000,
      "copilot-project-last-used": 1700000001000,
    });

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(appContext, file);

    expect(result).not.toBeNull();
    expect(result!.project.id).toBe("my-project");
    expect(result!.project.name).toBe("My Project");
    expect(result!.project.description).toBe("A test project");
    expect(result!.project.projectModelKey).toBe("gpt-4");
    expect(result!.project.modelConfigs?.temperature).toBe(0.7);
    expect(result!.project.modelConfigs?.maxTokens).toBe(2048);
    expect(result!.project.contextSource?.inclusions).toBe("notes/");
    expect(result!.project.contextSource?.exclusions).toBe("archive/");
    expect(result!.project.contextSource?.webUrls).toBe("https://example.com");
    expect(result!.project.created).toBe(1700000000000);
    expect(result!.project.UsageTimestamps).toBe(1700000001000);
    expect(result!.filePath).toBe(VALID_PATH);
    expect(result!.folderName).toBe("my-project");
  });

  it("returns null when copilot-project-id is missing from frontmatter", async () => {
    const rawContent = ["---", "copilot-project-name: My Project", "---", "Body text"].join("\n");

    const appContext = setupAppMock(rawContent, {
      "copilot-project-name": "My Project",
    });

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(appContext, file);

    // Reason: files without copilot-project-id are treated as corrupted and skipped.
    // With name-based folders, folderName can no longer serve as id fallback.
    expect(result).toBeNull();
  });

  it("preserves untrusted knowledge Bundle frontmatter without validating or repairing it", async () => {
    const rawContent = [
      "---",
      "copilot-project-id: my-project",
      "copilot-project-name: My Project",
      "copilot-project-knowledge-bundle:",
      "  version: unsupported",
      "  wikiRoot: Wiki\\\\Native",
      "  extra: true",
      "---",
      "Body text",
    ].join("\n");
    const appContext = setupAppMock(rawContent, null);

    const result = await parseProjectConfigFile(appContext, makeMockFile(VALID_PATH));

    expect(result?.project.knowledgeBundle).toEqual({
      version: "unsupported",
      wikiRoot: "Wiki\\\\Native",
      extra: true,
    });
  });

  it("reads only from the explicitly supplied App when another global App exists", async () => {
    const ownedContent = [
      "---",
      "copilot-project-id: owned",
      "copilot-project-name: Owned",
      "---",
      "Owned body",
    ].join("\n");
    const foreignContent = [
      "---",
      "copilot-project-id: foreign",
      "copilot-project-name: Foreign",
      "---",
      "Foreign body",
    ].join("\n");
    const ownedApp = setupAppMock(ownedContent, null);
    const foreignApp = setupAppMock(foreignContent, null);

    const result = await parseProjectConfigFile(ownedApp, makeMockFile(VALID_PATH));

    expect(result?.project.id).toBe("owned");
    expect(ownedApp.vault.read).toHaveBeenCalledTimes(1);
    expect(foreignApp.vault.read).not.toHaveBeenCalled();
  });
});

describe("writeProjectFrontmatter knowledge Bundle persistence", () => {
  const file = makeMockFile("copilot-projects/my-project/project.md");

  /**
   * Creates the required non-knowledge fields for serialization tests.
   *
   * @param knowledgeBundle - Optional untrusted Bundle value
   * @returns Complete project configuration
   */
  function makeProject(knowledgeBundle?: unknown) {
    return {
      id: "my-project",
      name: "My Project",
      systemPrompt: "",
      projectModelKey: "",
      modelConfigs: {},
      contextSource: {},
      created: 1,
      UsageTimestamps: 2,
      ...(knowledgeBundle === undefined ? {} : { knowledgeBundle }),
    };
  }

  it("writes the exact configured value and deletes a stale value when unconfigured", async () => {
    const frontmatter: Record<string, unknown> = {
      [COPILOT_PROJECT_KNOWLEDGE_BUNDLE]: { stale: true },
    };
    const appContext = {
      fileManager: {
        processFrontMatter: jest.fn(
          async (
            _file: TFile,
            update: (current: Record<string, unknown>) => void
          ): Promise<void> => {
            update(frontmatter);
          }
        ),
      },
    } as unknown as App;
    (window as unknown as Record<string, unknown>).app = appContext;
    const configuredValue = {
      version: 1,
      id: "bundle",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Schema/rules.md",
      reviewMode: "always",
    };

    await writeProjectFrontmatter(appContext, file, makeProject(configuredValue), "my-project", {
      createdMs: 1,
      lastUsedMs: 2,
    });
    expect(frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]).toBe(configuredValue);

    await writeProjectFrontmatter(appContext, file, makeProject(), "my-project", {
      createdMs: 1,
      lastUsedMs: 2,
    });
    expect(frontmatter).not.toHaveProperty(COPILOT_PROJECT_KNOWLEDGE_BUNDLE);
  });

  it("does not mutate frontmatter when its lifecycle assertion expires before the callback", async () => {
    const frontmatter: Record<string, unknown> = { preserved: true };
    let runUpdate: (() => void) | undefined;
    const processFrontMatter = jest.fn(
      (_file: TFile, update: (current: Record<string, unknown>) => void): Promise<void> =>
        new Promise((resolve, reject) => {
          runUpdate = () => {
            try {
              update(frontmatter);
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          };
        })
    );
    const appContext = { fileManager: { processFrontMatter } } as unknown as App;
    let active = true;
    const assertActive = () => {
      if (!active) throw new ProjectStateLifecycleEndedError();
    };

    const write = writeProjectFrontmatter(
      appContext,
      file,
      makeProject({ version: 1 }),
      "my-project",
      { createdMs: 1, lastUsedMs: 2 },
      assertActive
    );
    await Promise.resolve();
    active = false;
    runUpdate?.();

    await expect(write).rejects.toBeInstanceOf(ProjectStateLifecycleEndedError);
    expect(frontmatter).toEqual({ preserved: true });
  });
});

describe("ensureProjectFrontmatter lifecycle ownership", () => {
  it("rejects a deferred callback without mutating after a new owner takes over", async () => {
    const file = makeMockFile("copilot-projects/my-project/project.md");
    const owner = {} as ProjectStateOwner;
    const frontmatter: Record<string, unknown> = { preserved: true };
    let runUpdate: (() => void) | undefined;
    const processFrontMatter = jest.fn(
      (_file: TFile, update: (current: Record<string, unknown>) => void): Promise<void> =>
        new Promise((resolve, reject) => {
          runUpdate = () => {
            try {
              update(frontmatter);
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          };
        })
    );
    const appContext = { fileManager: { processFrontMatter } } as unknown as App;
    const isOwnerActiveMock = jest.mocked(isProjectStateOwnerActive);
    isOwnerActiveMock.mockReturnValue(true);

    const repair = ensureProjectFrontmatter(appContext, owner, file, {
      project: {
        id: "my-project",
        name: "My Project",
        systemPrompt: "",
        projectModelKey: "",
        modelConfigs: {},
        contextSource: {},
        created: 1,
        UsageTimestamps: 2,
      },
      filePath: file.path,
      folderName: "my-project",
    });
    await Promise.resolve();
    isOwnerActiveMock.mockReturnValue(false);
    runUpdate?.();

    await expect(repair).rejects.toBeInstanceOf(ProjectStateLifecycleEndedError);
    expect(frontmatter).toEqual({ preserved: true });
  });
});

describe("sanitizeVaultPathSegment", () => {
  it("blocks path traversal with ../", () => {
    // Reason: the slash is the dangerous part — removing it prevents escaping the project folder.
    // The dots themselves are harmless once the separator is gone.
    const result = sanitizeVaultPathSegment("../foo");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result.length).toBeGreaterThan(0);
  });

  it("replaces forward slashes in nested paths", () => {
    // "foo/bar" would escape the project folder — slash must be replaced
    const result = sanitizeVaultPathSegment("foo/bar");
    expect(result).not.toContain("/");
  });

  it("handles double-dot without slash (foo..bar)", () => {
    // "foo..bar" is not a traversal segment but should pass through safely
    const result = sanitizeVaultPathSegment("foo..bar");
    // Must not be empty and must not equal the traversal sentinels
    expect(result).not.toBe(".");
    expect(result).not.toBe("..");
    expect(result.length).toBeGreaterThan(0);
  });

  it("replaces all invalid filename characters with underscores", () => {
    const result = sanitizeVaultPathSegment('<>:"/\\|?*');
    expect(result).toBe("_________");
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("handles mixed valid and invalid characters", () => {
    const result = sanitizeVaultPathSegment("My Project: v1.0 <beta>");
    expect(result).not.toContain(":");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("My Project");
  });

  it("preserves CJK characters unchanged", () => {
    expect(sanitizeVaultPathSegment("我的项目")).toBe("我的项目");
    expect(sanitizeVaultPathSegment("プロジェクト")).toBe("プロジェクト");
    expect(sanitizeVaultPathSegment("프로젝트")).toBe("프로젝트");
  });

  it("preserves emoji characters", () => {
    const result = sanitizeVaultPathSegment("🎵 Piano Notes");
    expect(result).toContain("🎵");
    expect(result).toContain("Piano Notes");
  });

  it("does not truncate long names", () => {
    const longName = "a".repeat(300);
    expect(sanitizeVaultPathSegment(longName)).toBe(longName);
  });

  it("converts all-special-characters to underscores", () => {
    expect(sanitizeVaultPathSegment("***")).toBe("___");
  });

  it("returns fallback for whitespace-only input", () => {
    expect(sanitizeVaultPathSegment("   ")).toBe("_");
  });

  it("strips trailing dots and spaces (Windows compat)", () => {
    expect(sanitizeVaultPathSegment("project...")).toBe("project");
    expect(sanitizeVaultPathSegment("project   ")).toBe("project");
    expect(sanitizeVaultPathSegment("project. . .")).toBe("project");
  });

  it("prefixes Windows reserved device names", () => {
    expect(sanitizeVaultPathSegment("CON")).toBe("_CON");
    expect(sanitizeVaultPathSegment("prn")).toBe("_prn");
    expect(sanitizeVaultPathSegment("NUL")).toBe("_NUL");
    expect(sanitizeVaultPathSegment("COM1")).toBe("_COM1");
    expect(sanitizeVaultPathSegment("LPT9")).toBe("_LPT9");
  });

  it("replaces control characters with underscores", () => {
    expect(sanitizeVaultPathSegment("abc\x00def")).toBe("abc_def");
    expect(sanitizeVaultPathSegment("test\x1Fname")).toBe("test_name");
  });

  it("returns fallback for empty string", () => {
    expect(sanitizeVaultPathSegment("")).toBe("_");
  });

  it("converts lone dot and double-dot to fallback", () => {
    // Reason: "." and ".." have trailing dots stripped first, then become empty → fallback "_"
    expect(sanitizeVaultPathSegment(".")).toBe("_");
    expect(sanitizeVaultPathSegment("..")).toBe("_");
  });
});
