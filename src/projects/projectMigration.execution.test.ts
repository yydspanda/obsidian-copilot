import { App, TAbstractFile, TFile } from "obsidian";
import { parse, stringify } from "yaml";

import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import type { ProjectConfig } from "@/aiParams";
import { migrateProjectsFromSettingsToVault } from "@/projects/projectMigration";
import { beginProjectStateLifecycle, releaseProjectStateLifecycle } from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";
import { stripFrontmatter } from "@/utils";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(), updateSetting: jest.fn() }));

const ROOT = "Migration fixtures/projects";
const TARGET = `${ROOT}/Research/project.md`;
const BACKUP = `${ROOT}/unsupported/Project Migration Failed - legacy-1.md`;

function legacyProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "legacy-1",
    name: "Research",
    description: "Preserved project description",
    systemPrompt: "First line\r\n  Indented second line\r\n",
    projectModelKey: "configured-model|test-provider",
    modelConfigs: { temperature: 0.2, maxTokens: 2048 },
    contextSource: { inclusions: "Notes/**", exclusions: "Private/**" },
    knowledgeBundle: {
      version: 1,
      id: "migration-fixture",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Rules.md",
      reviewMode: "always",
    },
    created: 1700000000000,
    UsageTimestamps: 1700000001000,
    ...overrides,
  };
}

function createMemoryMigration(projects: ProjectConfig[]) {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const events: string[] = [];
  const settings = { copilotFolder: "Migration fixtures", projectList: projects };
  const read = (path: string): string => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`Missing fixture: ${path}`);
    events.push(`read:${path}`);
    return content;
  };
  const vault = {
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
      read: jest.fn(async (path: string) => read(path)),
      mkdir: jest.fn(async (path: string) => {
        folders.add(path);
      }),
    },
    getAbstractFileByPath: jest.fn((path: string) => {
      if (files.has(path)) return mockTFile({ path });
      if (!folders.has(path)) return null;
      return mockTFolder({
        path,
        children: [...files.keys()]
          .filter((filePath) => filePath.startsWith(`${path}/`))
          .map((filePath) => mockTFile({ path: filePath })),
      });
    }),
    create: jest.fn(async (path: string, content: string) => {
      if (files.has(path)) throw new Error(`Fixture already exists: ${path}`);
      files.set(path, content);
      events.push(`create:${path}`);
      return mockTFile({ path });
    }),
    read: jest.fn(async (file: TFile) => read(file.path)),
    cachedRead: jest.fn(async (file: TFile) => read(file.path)),
  };
  const processFrontMatter = jest.fn(
    async (file: TFile, change: (frontmatter: Record<string, unknown>) => void) => {
      const raw = read(file.path);
      const header = raw.match(/^---\n([\s\S]*?)\n---\n/);
      const frontmatter = (header ? parse(header[1]) : {}) as Record<string, unknown>;
      change(frontmatter);
      files.set(
        file.path,
        `---\n${stringify(frontmatter)}---\n${stripFrontmatter(raw, { trimStart: false })}`
      );
      events.push(`frontmatter:${file.path}`);
    }
  );
  const app = {
    vault,
    metadataCache: { getFileCache: jest.fn(() => null) },
    fileManager: {
      processFrontMatter,
      trashFile: jest.fn(async (file: TAbstractFile) => {
        files.delete(file.path);
        folders.delete(file.path);
        events.push(`trash:${file.path}`);
      }),
    },
  } as unknown as App;
  jest.mocked(getSettings).mockImplementation(() => settings as ReturnType<typeof getSettings>);
  jest.mocked(updateSetting).mockImplementation((key, value) => {
    Object.assign(settings, { [key]: value });
    events.push(`settings:${key}`);
  });
  return { app, vault, files, settings, events, processFrontMatter };
}

function backupProject(content: string | undefined): ProjectConfig {
  const json = content?.match(/```json\n([\s\S]*?)\n```/);
  if (!json) throw new Error("Recovery copy is missing its project JSON");
  return JSON.parse(json[1]) as ProjectConfig;
}

// Unlike the cancellation suite, this executes the actual frontmatter, content
// verification, rollback and backup helpers against an inspectable memory Vault.
describe("projectMigration", () => {
  describe("migrateProjectsFromSettingsToVault()", () => {
    let owner: ReturnType<typeof beginProjectStateLifecycle>;

    beforeEach(() => {
      jest.clearAllMocks();
      owner = beginProjectStateLifecycle();
    });

    afterEach(() => {
      releaseProjectStateLifecycle(owner);
    });

    it("writes the complete project and clears legacy settings only after reading back its body", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);

      const result = await migrateProjectsFromSettingsToVault(memory.app, owner);

      const content = memory.files.get(TARGET)!;
      expect(stripFrontmatter(content, { trimStart: false })).toBe(project.systemPrompt);
      expect(parse(content.match(/^---\n([\s\S]*?)\n---\n/)![1])).toMatchObject({
        "copilot-project-id": project.id,
        "copilot-project-name": project.name,
        "copilot-project-description": project.description,
        "copilot-project-model-key": project.projectModelKey,
        "copilot-project-temperature": 0.2,
        "copilot-project-max-tokens": 2048,
        "copilot-project-inclusions": "Notes/**",
        "copilot-project-exclusions": "Private/**",
        "copilot-project-created": project.created,
        "copilot-project-last-used": project.UsageTimestamps,
        "copilot-project-knowledge-bundle": project.knowledgeBundle,
      });
      expect(memory.events.slice(-2)).toEqual([`read:${TARGET}`, "settings:projectList"]);
      expect(memory.settings.projectList).toEqual([]);
      expect(result).toMatchObject({ status: "success" });
      expect([...memory.files.keys()]).toEqual([TARGET]);
    });

    it("does nothing on a second pass after successful migration", async () => {
      const memory = createMemoryMigration([legacyProject()]);
      await migrateProjectsFromSettingsToVault(memory.app, owner);
      const firstFiles = [...memory.files];
      const firstEvents = [...memory.events];

      await expect(migrateProjectsFromSettingsToVault(memory.app, owner)).resolves.toBeNull();

      expect([...memory.files]).toEqual(firstFiles);
      expect(memory.events).toEqual(firstEvents);
    });

    it("reuses a verified existing project after interrupted settings cleanup without duplicating it", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      await migrateProjectsFromSettingsToVault(memory.app, owner);
      const firstFiles = [...memory.files];
      memory.settings.projectList = [project];
      memory.vault.create.mockClear();

      const result = await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(result).toMatchObject({ status: "success" });
      expect([...memory.files]).toEqual(firstFiles);
      expect(memory.vault.create).not.toHaveBeenCalled();
      expect(memory.settings.projectList).toEqual([]);
    });

    it("rolls back a target whose read-back body differs and preserves the full original in a recovery copy (https://github.com/yydspanda/obsidian-copilot/issues/10)", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      memory.vault.read.mockResolvedValueOnce("Truncated body");

      const result = await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(result).toMatchObject({ status: "error" });
      expect(memory.files.has(TARGET)).toBe(false);
      expect(backupProject(memory.files.get(BACKUP))).toEqual(project);
      expect(memory.events.indexOf(`trash:${TARGET}`)).toBeLessThan(
        memory.events.indexOf(`create:${BACKUP}`)
      );
      expect(memory.events.at(-1)).toBe("settings:projectList");
      expect(memory.settings.projectList).toEqual([]);
      expect(result?.details).toEqual([`Recover backed-up projects from ${ROOT}/unsupported.`]);
    });

    it("leaves an occupied target untouched and backs up the conflicting legacy project", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      const occupied = "---\ncopilot-project-id: another-project\n---\nExisting user body";
      memory.files.set(TARGET, occupied);

      await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(memory.files.get(TARGET)).toBe(occupied);
      expect(backupProject(memory.files.get(BACKUP))).toEqual(project);
      expect(memory.settings.projectList).toEqual([]);
    });

    it("does not duplicate an identical recovery copy when a failed migration is replayed (https://github.com/yydspanda/obsidian-copilot/issues/10)", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      memory.vault.create.mockRejectedValueOnce(new Error("Target is not writable"));
      await migrateProjectsFromSettingsToVault(memory.app, owner);
      const firstFiles = [...memory.files];
      memory.settings.projectList = [project];
      memory.vault.create.mockRejectedValueOnce(new Error("Target is still not writable"));

      await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(backupProject(memory.files.get(BACKUP))).toEqual(project);
      expect([...memory.files]).toEqual(firstFiles);
      expect(memory.settings.projectList).toEqual([]);
    });

    it("retains the original legacy project when neither its target nor its recovery copy can be written (https://github.com/yydspanda/obsidian-copilot/issues/10)", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      memory.vault.create.mockRejectedValue(new Error("Storage is not writable"));

      const result = await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(memory.files.size).toBe(0);
      expect(memory.settings.projectList).toEqual([project]);
      expect(result?.summary).not.toContain("recovery copies were created");
      expect(result?.details?.join(" ")).toContain("legacy settings");
    });

    it("clears successfully migrated entries but retains an entry whose target and backup both fail (https://github.com/yydspanda/obsidian-copilot/issues/10)", async () => {
      const failed = legacyProject();
      const successful = legacyProject({ id: "legacy-2", name: "Writable project" });
      const memory = createMemoryMigration([failed, successful]);
      memory.vault.create
        .mockRejectedValueOnce(new Error("Target is not writable"))
        .mockRejectedValueOnce(new Error("Backup is not writable"));

      const result = await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(result).toMatchObject({ status: "action-required" });
      expect(memory.files.has(`${ROOT}/Writable project/project.md`)).toBe(true);
      expect(memory.files.has(BACKUP)).toBe(false);
      expect(memory.settings.projectList).toEqual([failed]);
      expect(result?.details?.join(" ")).toContain("legacy settings");
    });

    it("retains the legacy project when a resolved backup write reads back incomplete data (https://github.com/yydspanda/obsidian-copilot/issues/10)", async () => {
      const project = legacyProject();
      const memory = createMemoryMigration([project]);
      memory.vault.create
        .mockRejectedValueOnce(new Error("Target is not writable"))
        .mockImplementationOnce(async (path, content) => {
          memory.files.set(path, content.slice(0, 30));
          return mockTFile({ path });
        });

      await migrateProjectsFromSettingsToVault(memory.app, owner);

      expect(memory.files.has(BACKUP)).toBe(true);
      expect(memory.settings.projectList).toEqual([project]);
    });
  });
});
