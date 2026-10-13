import { ProjectConfig } from "@/aiParams";
import { removeGeneratedInstructionFiles } from "@/instructions/agentsFile";
import { logError, logInfo, logWarn } from "@/logger";
import {
  COPILOT_PROJECT_CREATED,
  COPILOT_PROJECT_DESCRIPTION,
  COPILOT_PROJECT_EXCLUSIONS,
  COPILOT_PROJECT_ID,
  COPILOT_PROJECT_INCLUSIONS,
  COPILOT_PROJECT_KNOWLEDGE_BUNDLE,
  COPILOT_PROJECT_LAST_USED,
  COPILOT_PROJECT_MAX_TOKENS,
  COPILOT_PROJECT_MODEL_KEY,
  COPILOT_PROJECT_NAME,
  COPILOT_PROJECT_TEMPERATURE,
  COPILOT_PROJECT_WEB_URLS,
  COPILOT_PROJECT_YOUTUBE_URLS,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import { ProjectFileRecord } from "@/projects/type";
import {
  fetchAllProjects,
  getProjectAnchorFromConfigPath,
  getProjectConfigFilePath,
  getProjectsFolder,
  sanitizeVaultPathSegment,
  splitUrlsStringToArray,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import {
  acquireProjectFileWrite,
  beginProjectStateLifecycle,
  deleteCachedProjectRecordByIdForOwner,
  getCachedProjectRecordById,
  getCachedProjectRecords,
  isProjectStateOwnerActive,
  ProjectFileWriteLease,
  ProjectStateOwner,
  releaseProjectFileWrite,
  releaseProjectStateLifecycle,
  updateCachedProjectRecordsForOwner,
  upsertCachedProjectRecordForOwner,
} from "@/projects/state";
import { ensureFolderExists } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  isInVaultCache,
  patchFrontmatter,
  readFrontmatterViaAdapter,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { App, normalizePath, stringifyYaml, TFile, TFolder, Vault } from "obsidian";
import { ensureProjectsMigratedIfNeeded } from "@/projects/projectMigration";
import type { StartupMigrationItem } from "@/services/startupMigration";

function resolveProjectKnowledgeBundleUpdate(
  existing: ProjectConfig,
  update: ProjectConfig
): ProjectConfig {
  const resolved = { ...update };
  const explicitlyUpdated = Object.prototype.hasOwnProperty.call(update, "knowledgeBundle");

  if (!explicitlyUpdated) {
    if (Object.prototype.hasOwnProperty.call(existing, "knowledgeBundle")) {
      resolved.knowledgeBundle = existing.knowledgeBundle;
    }
    return resolved;
  }

  if (update.knowledgeBundle === undefined) {
    delete resolved.knowledgeBundle;
  }
  return resolved;
}

export function buildHiddenProjectFrontmatter(
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): Record<string, unknown> {
  const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
  const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

  const fm: Record<string, unknown> = {
    [COPILOT_PROJECT_ID]: project.id.trim(),
    [COPILOT_PROJECT_NAME]: (project.name || folderName).trim(),
    [COPILOT_PROJECT_DESCRIPTION]: (project.description || "").trim(),
    [COPILOT_PROJECT_MODEL_KEY]: (project.projectModelKey || "").trim(),
    [COPILOT_PROJECT_INCLUSIONS]: project.contextSource?.inclusions || "",
    [COPILOT_PROJECT_EXCLUSIONS]: project.contextSource?.exclusions || "",
    [COPILOT_PROJECT_WEB_URLS]: webUrls,
    [COPILOT_PROJECT_YOUTUBE_URLS]: youtubeUrls,
    [COPILOT_PROJECT_CREATED]: timestamps.createdMs,
    [COPILOT_PROJECT_LAST_USED]: timestamps.lastUsedMs,
  };

  if (project.modelConfigs?.temperature != null) {
    fm[COPILOT_PROJECT_TEMPERATURE] = project.modelConfigs.temperature;
  }
  if (project.modelConfigs?.maxTokens != null) {
    fm[COPILOT_PROJECT_MAX_TOKENS] = project.modelConfigs.maxTokens;
  }
  if (project.knowledgeBundle !== undefined) {
    fm[COPILOT_PROJECT_KNOWLEDGE_BUNDLE] = project.knowledgeBundle;
  }

  return fm;
}

function buildProjectFileContent(
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): string {
  const fm = buildHiddenProjectFrontmatter(project, folderName, timestamps);
  return `---\n${stringifyYaml(fm)}---\n${project.systemPrompt || ""}`;
}

function getVaultParentPath(filePath: string): string {
  const separatorIndex = filePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : filePath.slice(0, separatorIndex);
}

export class ProjectFileManagerDisposedError extends Error {
  constructor() {
    super("ProjectFileManager cannot be used after disposal");
    this.name = "ProjectFileManagerDisposedError";
  }
}

export class ProjectFileManagerFolderChangedError extends Error {
  constructor() {
    super("ProjectFileManager operation belongs to an obsolete projects folder");
    this.name = "ProjectFileManagerFolderChangedError";
  }
}

interface ProjectScanAuthority {
  manager: ProjectFileManager;
  lifecycleGeneration: number;
  revision: number;
}

interface ProjectFileOperationAuthority {
  lifecycleGeneration: number;
  projectFolderRevision: number;
  projectsFolder: string;
}

const preparedProjectScanAuthorities = new WeakMap<
  PreparedProjectScanToken,
  ProjectScanAuthority
>();

class PreparedProjectScanToken {
  private readonly preparedProjectScanBrand = true;

  constructor(authority: ProjectScanAuthority) {
    preparedProjectScanAuthorities.set(this, authority);
    Object.freeze(this);
  }
}

export type PreparedProjectScan = PreparedProjectScanToken;

export class ProjectFileManager {
  private static instance: ProjectFileManager | undefined;
  private readonly app: App;
  private readonly vault: Vault;

  private readonly stateOwner: ProjectStateOwner;
  private readonly projectLastUsedManager = new RecentUsageManager<string>();

  private disposed = false;

  private initialized = false;

  private initializePromise?: Promise<StartupMigrationItem | null>;

  private lifecycleGeneration = 0;

  private projectStateRevision = 0;

  private projectFolderRevision = 0;

  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.stateOwner = beginProjectStateLifecycle();
  }

  public static getInstance(app?: App): ProjectFileManager {
    const current = ProjectFileManager.instance;
    if (current && app && (current.app !== app || current.vault !== app.vault)) {
      current.dispose();
    }

    if (!ProjectFileManager.instance) {
      if (!app) throw new Error("App is required when no active ProjectFileManager exists");
      ProjectFileManager.instance = new ProjectFileManager(app);
    }
    return ProjectFileManager.instance;
  }

  public static startLifecycle(app: App): ProjectFileManager {
    ProjectFileManager.instance?.dispose();
    const manager = new ProjectFileManager(app);
    ProjectFileManager.instance = manager;
    return manager;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.projectStateRevision += 1;
    this.projectFolderRevision += 1;
    this.initialized = false;
    this.initializePromise = undefined;

    if (ProjectFileManager.instance === this) {
      ProjectFileManager.instance = undefined;
    }
    releaseProjectStateLifecycle(this.stateOwner);
  }

  public initialize(): Promise<StartupMigrationItem | null> {
    this.assertActive();
    if (this.initialized) return Promise.resolve(null);
    if (this.initializePromise) return this.initializePromise;

    const generation = this.lifecycleGeneration;
    const initialization = this.performInitialization(generation);
    this.initializePromise = initialization;
    return initialization;
  }

  private async performInitialization(generation: number): Promise<StartupMigrationItem | null> {
    logInfo("[Projects] Initializing ProjectFileManager");
    try {
      const migrationResult = await ensureProjectsMigratedIfNeeded(this.app, this.stateOwner);
      this.assertGeneration(generation);

      let installed = false;
      while (!installed) {
        const preparedScan = this.prepareProjectScan();
        const records = await this.fetchPreparedProjectScan(preparedScan);
        this.assertGeneration(generation);
        installed = this.commitPreparedProjectScan(preparedScan, records);
      }
      this.initialized = true;
      return migrationResult;
    } catch (error) {
      this.assertGeneration(generation);
      this.initialized = false;
      throw error;
    } finally {
      if (generation === this.lifecycleGeneration) {
        this.initializePromise = undefined;
      }
    }
  }

  public async reloadProjects(): Promise<ProjectFileRecord[]> {
    const generation = this.captureActiveGeneration();
    const pendingInitialization = this.initializePromise;
    if (pendingInitialization) {
      await pendingInitialization;
      this.assertGeneration(generation);
    }

    const preparedScan = this.prepareProjectScan();
    const records = await this.fetchPreparedProjectScan(preparedScan);
    this.assertGeneration(generation);
    this.commitPreparedProjectScan(preparedScan, records);
    return records;
  }

  public prepareProjectScan(): PreparedProjectScan {
    const generation = this.captureActiveGeneration();
    const revision = ++this.projectStateRevision;
    return new PreparedProjectScanToken({
      manager: this,
      lifecycleGeneration: generation,
      revision,
    });
  }

  public async fetchPreparedProjectScan(
    preparedScan: PreparedProjectScan
  ): Promise<ProjectFileRecord[]> {
    const authority = preparedProjectScanAuthorities.get(preparedScan);
    if (!authority || authority.manager !== this) {
      throw new ProjectFileManagerDisposedError();
    }
    this.assertGeneration(authority.lifecycleGeneration);
    const records = await fetchAllProjects(this.app);
    this.assertGeneration(authority.lifecycleGeneration);
    return records;
  }

  public isPreparedProjectScanCurrent(preparedScan: PreparedProjectScan): boolean {
    const authority = preparedProjectScanAuthorities.get(preparedScan);
    return (
      authority?.manager === this &&
      !this.disposed &&
      ProjectFileManager.instance === this &&
      isProjectStateOwnerActive(this.stateOwner) &&
      authority.lifecycleGeneration === this.lifecycleGeneration &&
      authority.revision === this.projectStateRevision
    );
  }

  public commitPreparedProjectScan(
    preparedScan: PreparedProjectScan,
    records: ProjectFileRecord[]
  ): boolean {
    if (!this.isPreparedProjectScanCurrent(preparedScan)) return false;

    this.projectStateRevision += 1;
    return updateCachedProjectRecordsForOwner(this.stateOwner, records);
  }

  public invalidatePreparedProjectScans(): void {
    this.assertActive();
    this.projectStateRevision += 1;
  }

  public invalidateProjectsFolder(): void {
    this.assertActive();
    this.projectFolderRevision += 1;
    this.projectStateRevision += 1;
  }

  public async fetchProjects(): Promise<ProjectFileRecord[]> {
    const generation = this.captureActiveGeneration();
    const records = await fetchAllProjects(this.app);
    this.assertGeneration(generation);
    return records;
  }

  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    this.assertActive();
    return this.projectLastUsedManager;
  }

  public getStateOwner(): ProjectStateOwner {
    this.assertActive();
    return this.stateOwner;
  }

  private captureActiveGeneration(): number {
    this.assertActive();
    return this.lifecycleGeneration;
  }

  private captureFileOperationAuthority(): ProjectFileOperationAuthority {
    return {
      lifecycleGeneration: this.captureActiveGeneration(),
      projectFolderRevision: this.projectFolderRevision,
      projectsFolder: getProjectsFolder(),
    };
  }

  private assertActive(): void {
    if (
      this.disposed ||
      ProjectFileManager.instance !== this ||
      !isProjectStateOwnerActive(this.stateOwner)
    ) {
      throw new ProjectFileManagerDisposedError();
    }
  }

  private assertGeneration(generation: number): void {
    if (
      this.disposed ||
      ProjectFileManager.instance !== this ||
      !isProjectStateOwnerActive(this.stateOwner) ||
      generation !== this.lifecycleGeneration
    ) {
      throw new ProjectFileManagerDisposedError();
    }
  }

  private assertFileOperationAuthority(authority: ProjectFileOperationAuthority): void {
    this.assertGeneration(authority.lifecycleGeneration);
    if (
      authority.projectFolderRevision !== this.projectFolderRevision ||
      authority.projectsFolder !== getProjectsFolder()
    ) {
      throw new ProjectFileManagerFolderChangedError();
    }
  }

  private acquireFileWrite(filePath: string): ProjectFileWriteLease {
    const lease = acquireProjectFileWrite(this.stateOwner, filePath);
    if (!lease) {
      throw new ProjectFileManagerDisposedError();
    }
    return lease;
  }

  private sanitizeFolderName(input: string): string {
    const sanitized = sanitizeVaultPathSegment(input);
    if (sanitized.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
      return `_${sanitized}`;
    }
    return sanitized;
  }

  private async rollbackCreatedFile(
    filePath: string,
    folderPath: string,
    generation: number
  ): Promise<void> {
    this.assertGeneration(generation);
    try {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await trashFile(this.app, file);
        this.assertGeneration(generation);
      } else if (await this.vault.adapter.exists(filePath)) {
        this.assertGeneration(generation);

        await this.vault.adapter.remove(filePath);
        this.assertGeneration(generation);
      } else {
        this.assertGeneration(generation);
      }
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder && folder.children.length === 0) {
        await trashFile(this.app, folder);
        this.assertGeneration(generation);
      } else if (await this.vault.adapter.exists(folderPath)) {
        this.assertGeneration(generation);
        const listing = await this.vault.adapter.list(folderPath);
        this.assertGeneration(generation);
        if (listing.files.length === 0 && listing.folders.length === 0) {
          await this.vault.adapter.rmdir(folderPath, false);
          this.assertGeneration(generation);
        }
      }
    } catch (rollbackError) {
      if (rollbackError instanceof ProjectFileManagerDisposedError) {
        throw rollbackError;
      }
      this.assertGeneration(generation);
      logError(`[Projects] Rollback failed for ${filePath}`, rollbackError);
    }
  }

  private getLeadingFrontmatterBlock(raw: string): string | null {
    const content = raw.replace(/^\uFEFF/, "");
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? match[0] : null;
  }

  public async createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;

    const projectId = (project.id || "").trim();
    if (!projectId) throw new Error("Project id cannot be empty");

    if (getCachedProjectRecordById(projectId)) {
      throw new Error(`Project id already exists: ${projectId}`);
    }

    const trimmedName = (project.name || "").trim();
    if (trimmedName) {
      const nameExists = getCachedProjectRecords().some(
        (r) => r.project.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameExists) {
        throw new Error(`A project with the name "${trimmedName}" already exists`);
      }
    }

    const folderName = this.sanitizeFolderName(trimmedName || projectId);
    const filePath = getProjectConfigFilePath(folderName, authority.projectsFolder);
    const folderPath = getVaultParentPath(filePath);

    const folderKey = folderName.toLowerCase();
    const cachedRecords = getCachedProjectRecords();
    const existingFolderConflict = cachedRecords.find(
      (r) => r.folderName.toLowerCase() === folderKey && r.project.id !== projectId
    );
    if (existingFolderConflict) {
      throw new Error(
        `Folder name collision: project id "${projectId}" sanitizes to folder "${folderName}" ` +
          `which conflicts with existing project "${existingFolderConflict.project.id}"`
      );
    }

    const fileWriteLease = this.acquireFileWrite(filePath);
    try {
      await ensureFolderExists(this.vault, authority.projectsFolder, () =>
        this.assertFileOperationAuthority(authority)
      );
      this.assertFileOperationAuthority(authority);
      await ensureFolderExists(this.vault, folderPath, () =>
        this.assertFileOperationAuthority(authority)
      );
      this.assertFileOperationAuthority(authority);

      const fileAlreadyExists = await this.vault.adapter.exists(filePath);
      this.assertFileOperationAuthority(authority);
      if (fileAlreadyExists) {
        throw new Error(
          `Project file already exists at "${filePath}". ` +
            `This may be a folder name collision — project id "${projectId}" sanitizes to folder "${folderName}"`
        );
      }

      const now = Date.now();
      const createdMs =
        Number.isFinite(project.created) && project.created > 0 ? project.created : now;
      const lastUsedMs =
        Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
          ? project.UsageTimestamps
          : 0;

      const file = await this.vault.create(filePath, project.systemPrompt || "");
      this.assertFileOperationAuthority(authority);

      try {
        await writeProjectFrontmatter(
          this.app,
          file,
          project,
          folderName,
          {
            createdMs,
            lastUsedMs,
          },
          () => this.assertFileOperationAuthority(authority)
        );
        this.assertFileOperationAuthority(authority);
      } catch (fmError) {
        this.assertGeneration(generation);
        await this.rollbackCreatedFile(filePath, folderPath, generation);
        this.assertGeneration(generation);
        throw fmError;
      }

      const record: ProjectFileRecord = {
        project: { ...project, id: projectId, created: createdMs, UsageTimestamps: lastUsedMs },
        filePath,
        folderName,
      };

      this.assertFileOperationAuthority(authority);
      this.invalidatePreparedProjectScans();
      upsertCachedProjectRecordForOwner(this.stateOwner, record);
      logInfo(`[Projects] Created project: ${projectId} -> ${filePath}`);
      return record;
    } finally {
      releaseProjectFileWrite(fileWriteLease);
    }
  }

  public async updateProject(
    projectId: string,
    nextProject: ProjectConfig
  ): Promise<ProjectFileRecord> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;
    const normalizedId = (projectId || "").trim();
    if (!normalizedId) throw new Error("Project id cannot be empty");
    if ((nextProject.id || "").trim() !== normalizedId) {
      throw new Error("Project id mismatch: cannot change id via update");
    }

    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) throw new Error(`Project not found: ${normalizedId}`);
    const projectForUpdate = resolveProjectKnowledgeBundleUpdate(existing.project, nextProject);

    const trimmedName = (projectForUpdate.name || "").trim();
    if (trimmedName) {
      const nameConflict = getCachedProjectRecords().some(
        (r) =>
          r.project.id !== normalizedId &&
          r.project.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameConflict) {
        throw new Error(`A project with the name "${trimmedName}" already exists`);
      }
    }

    let filePath = existing.filePath;
    let folderName = existing.folderName;
    const fileWriteLeases: ProjectFileWriteLease[] = [];

    const { projectsRoot } = getProjectAnchorFromConfigPath(existing.filePath);
    const projectFolderIn = (name: string) => normalizePath(`${projectsRoot}/${name}`);

    const nextFolderName = this.sanitizeFolderName(trimmedName || normalizedId);
    let oldFilePathForPending: string | null = null;

    if (nextFolderName !== existing.folderName) {
      const newFolderPath = projectFolderIn(nextFolderName);
      const newFilePath = getProjectConfigFilePath(nextFolderName, projectsRoot);

      const folderKey = nextFolderName.toLowerCase();
      const folderConflict = getCachedProjectRecords().find(
        (r) => r.project.id !== normalizedId && r.folderName.toLowerCase() === folderKey
      );
      if (folderConflict) {
        throw new Error(
          `Cannot rename project folder: "${nextFolderName}" conflicts with project "${folderConflict.project.name}"`
        );
      }
      const isCaseOnlyRename =
        newFolderPath.toLowerCase() === projectFolderIn(existing.folderName).toLowerCase();
      const newFolderExists = !isCaseOnlyRename && (await this.vault.adapter.exists(newFolderPath));
      this.assertFileOperationAuthority(authority);
      if (newFolderExists) {
        throw new Error(`Cannot rename project folder: "${newFolderPath}" already exists on disk`);
      }

      oldFilePathForPending = filePath;
      fileWriteLeases.push(this.acquireFileWrite(oldFilePathForPending));
      fileWriteLeases.push(this.acquireFileWrite(newFilePath));

      try {
        const oldFolderPath = projectFolderIn(existing.folderName);
        const folderObj = this.vault.getAbstractFileByPath(oldFolderPath);
        if (folderObj instanceof TFolder) {
          await this.vault.rename(folderObj, newFolderPath);
        } else {
          await this.vault.adapter.rename(oldFolderPath, newFolderPath);
        }
        this.assertFileOperationAuthority(authority);
      } catch (renameError) {
        for (const lease of fileWriteLeases.splice(0)) {
          releaseProjectFileWrite(lease);
        }
        if (renameError instanceof ProjectFileManagerDisposedError) {
          throw renameError;
        }
        this.assertGeneration(generation);
        throw renameError;
      }

      filePath = newFilePath;
      folderName = nextFolderName;
      logInfo(
        `[Projects] Renamed project folder: "${existing.folderName}" → "${nextFolderName}" for project ${normalizedId}`
      );
    }

    try {
      if (!oldFilePathForPending) {
        fileWriteLeases.push(this.acquireFileWrite(filePath));
      }

      let file = await resolveFileByPath(this.app, filePath);
      this.assertFileOperationAuthority(authority);
      let materialized = false;

      if (!file) {
        logInfo(`[Projects] Materializing missing vault file for project: ${normalizedId}`);
        const folderPath = projectFolderIn(folderName);
        await ensureFolderExists(this.vault, projectsRoot, () =>
          this.assertFileOperationAuthority(authority)
        );
        this.assertFileOperationAuthority(authority);
        await ensureFolderExists(this.vault, folderPath, () =>
          this.assertFileOperationAuthority(authority)
        );
        this.assertFileOperationAuthority(authority);
        file = await this.vault.create(filePath, projectForUpdate.systemPrompt || "");
        this.assertFileOperationAuthority(authority);
        materialized = true;
      }

      const createdMs =
        Number.isFinite(existing.project.created) && existing.project.created > 0
          ? existing.project.created
          : Date.now();
      const cachedLastUsed =
        Number.isFinite(existing.project.UsageTimestamps) && existing.project.UsageTimestamps > 0
          ? existing.project.UsageTimestamps
          : 0;
      const memoryLastUsed = this.projectLastUsedManager.getLastTouchedAt(normalizedId) ?? 0;
      const lastUsedMs = Math.max(cachedLastUsed, memoryLastUsed);

      const projectForWrite = {
        ...projectForUpdate,
        created: createdMs,
        UsageTimestamps: lastUsedMs,
      };

      if (isInVaultCache(this.app, filePath)) {
        try {
          await writeProjectFrontmatter(
            this.app,
            file,
            projectForWrite,
            folderName,
            {
              createdMs,
              lastUsedMs,
            },
            () => this.assertFileOperationAuthority(authority)
          );
          this.assertFileOperationAuthority(authority);
        } catch (fmError) {
          if (fmError instanceof ProjectFileManagerDisposedError) {
            throw fmError;
          }
          this.assertGeneration(generation);
          if (materialized) {
            const materializedFolderPath = getVaultParentPath(filePath);
            await this.rollbackCreatedFile(filePath, materializedFolderPath, generation);
            this.assertGeneration(generation);
          }
          throw fmError;
        }

        const rawWithFrontmatter = await this.vault.read(file);
        this.assertFileOperationAuthority(authority);
        const frontmatterBlock = this.getLeadingFrontmatterBlock(rawWithFrontmatter);
        if (!frontmatterBlock) {
          throw new Error(`Expected frontmatter block after update: ${file.path}`);
        }
        const separator = frontmatterBlock.endsWith("\n") ? "" : "\n";
        await this.vault.modify(
          file,
          frontmatterBlock + separator + (projectForUpdate.systemPrompt || "")
        );
        this.assertFileOperationAuthority(authority);
      } else {
        const content = buildProjectFileContent(projectForWrite, folderName, {
          createdMs,
          lastUsedMs,
        });
        await this.vault.adapter.write(filePath, content);
        this.assertFileOperationAuthority(authority);
      }

      const updated: ProjectFileRecord = {
        project: {
          ...projectForUpdate,
          created: createdMs,
          UsageTimestamps: lastUsedMs,
        },
        filePath,
        folderName,
      };

      this.assertFileOperationAuthority(authority);
      this.invalidatePreparedProjectScans();
      upsertCachedProjectRecordForOwner(this.stateOwner, updated);

      logInfo(`[Projects] Updated project: ${normalizedId} -> ${filePath}`);
      return updated;
    } catch (writeError) {
      if (writeError instanceof ProjectFileManagerDisposedError) {
        throw writeError;
      }
      if (writeError instanceof ProjectFileManagerFolderChangedError) {
        throw writeError;
      }
      this.assertGeneration(generation);

      if (oldFilePathForPending && folderName !== existing.folderName) {
        try {
          const oldFolderPath = projectFolderIn(existing.folderName);
          const newFolderPath = projectFolderIn(folderName);
          const renamedFolder = this.vault.getAbstractFileByPath(newFolderPath);
          if (renamedFolder instanceof TFolder) {
            await this.vault.rename(renamedFolder, oldFolderPath);
          } else {
            await this.vault.adapter.rename(newFolderPath, oldFolderPath);
          }
          this.assertGeneration(generation);
          logWarn(
            `[Projects] Rolled back folder rename "${folderName}" → "${existing.folderName}" after write failure`
          );
        } catch (rollbackError) {
          if (rollbackError instanceof ProjectFileManagerDisposedError) {
            throw rollbackError;
          }
          this.assertGeneration(generation);
          logError(
            `[Projects] Failed to rollback folder rename for ${normalizedId}`,
            rollbackError
          );
        }
      }
      throw writeError;
    } finally {
      for (const lease of fileWriteLeases) {
        releaseProjectFileWrite(lease);
      }
    }
  }

  public async deleteProject(projectId: string): Promise<void> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;
    const normalizedId = (projectId || "").trim();
    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) {
      logWarn(`[Projects] deleteProject: not found: ${normalizedId}`);
      return;
    }

    const { projectFolderPath: folderPath } = getProjectAnchorFromConfigPath(existing.filePath);
    const fileWriteLease = this.acquireFileWrite(existing.filePath);

    try {
      const configFile = this.vault.getAbstractFileByPath(existing.filePath);
      if (configFile instanceof TFile) {
        await trashFile(this.app, configFile);
        this.assertFileOperationAuthority(authority);
      } else {
        const configFileExists = await this.vault.adapter.exists(existing.filePath);
        this.assertFileOperationAuthority(authority);
        if (configFileExists) {
          await this.vault.adapter.remove(existing.filePath);
          this.assertFileOperationAuthority(authority);
        }
      }

      this.assertFileOperationAuthority(authority);
      this.invalidatePreparedProjectScans();
      deleteCachedProjectRecordByIdForOwner(this.stateOwner, normalizedId);

      await removeGeneratedInstructionFiles(this.app, folderPath);
      this.assertFileOperationAuthority(authority);

      try {
        const folder = this.vault.getAbstractFileByPath(folderPath);
        if (folder instanceof TFolder && folder.children.length === 0) {
          await trashFile(this.app, folder);
          this.assertFileOperationAuthority(authority);
        } else {
          const folderExists = await this.vault.adapter.exists(folderPath);
          this.assertFileOperationAuthority(authority);
          if (folderExists) {
            const listing = await this.vault.adapter.list(folderPath);
            this.assertFileOperationAuthority(authority);
            if (listing.files.length === 0 && listing.folders.length === 0) {
              await this.vault.adapter.rmdir(folderPath, false);
              this.assertFileOperationAuthority(authority);
            }
          }
        }
      } catch (cleanupError) {
        if (cleanupError instanceof ProjectFileManagerDisposedError) {
          throw cleanupError;
        }
        if (cleanupError instanceof ProjectFileManagerFolderChangedError) {
          throw cleanupError;
        }
        this.assertGeneration(generation);
        logWarn(`[Projects] Failed to clean up empty project folder: ${folderPath}`, cleanupError);
      }

      if (isDesktopRuntime()) {
        const { clearProjectMarkers } = await import("@/context/projectMarkerCleanup");
        await clearProjectMarkers(this.app, normalizedId).catch((err) =>
          logError(`[Projects] Failed to clear off-vault failure markers on delete`, err)
        );
        this.assertFileOperationAuthority(authority);
      }

      logInfo(`[Projects] Deleted project: ${normalizedId} -> ${folderPath}`);

      void this.reloadProjects().catch((err) => {
        if (err instanceof ProjectFileManagerDisposedError) return;
        logError("[Projects] Rescan after delete failed", err);
      });
    } finally {
      releaseProjectFileWrite(fileWriteLease);
    }
  }

  public async touchProjectLastUsed(projectId: string): Promise<void> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;
    const normalizedId = (projectId || "").trim();
    const record = getCachedProjectRecordById(normalizedId);
    if (!record) return;

    try {
      this.projectLastUsedManager.touch(normalizedId);

      const timestampToPersist = this.projectLastUsedManager.shouldPersist(
        normalizedId,
        record.project.UsageTimestamps
      );
      if (timestampToPersist === null) return;

      const filePath = normalizePath(record.filePath);
      const file = await resolveFileByPath(this.app, filePath);
      this.assertFileOperationAuthority(authority);
      if (!file) return;

      const fileWriteLease = this.acquireFileWrite(filePath);
      let actualPersistedValue = timestampToPersist;
      try {
        if (isInVaultCache(this.app, filePath)) {
          await this.app.fileManager.processFrontMatter(
            file,
            (frontmatter: Record<string, unknown>) => {
              this.assertFileOperationAuthority(authority);
              const existing = Number(frontmatter[COPILOT_PROJECT_LAST_USED]);
              const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
              actualPersistedValue = Math.max(existingMs, timestampToPersist);
              if (existingMs === actualPersistedValue) return;
              frontmatter[COPILOT_PROJECT_LAST_USED] = actualPersistedValue;
            }
          );
          this.assertFileOperationAuthority(authority);
        } else {
          const adapterFm = await readFrontmatterViaAdapter(this.app, filePath);
          this.assertFileOperationAuthority(authority);
          const existing = Number(adapterFm?.[COPILOT_PROJECT_LAST_USED]);
          const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
          actualPersistedValue = Math.max(existingMs, timestampToPersist);
          if (existingMs !== actualPersistedValue) {
            await patchFrontmatter(this.app, filePath, {
              [COPILOT_PROJECT_LAST_USED]: actualPersistedValue,
            });
            this.assertFileOperationAuthority(authority);
          }
        }
      } finally {
        releaseProjectFileWrite(fileWriteLease);
      }

      this.assertFileOperationAuthority(authority);
      this.projectLastUsedManager.markPersisted(normalizedId, actualPersistedValue);

      const freshRecord = getCachedProjectRecordById(normalizedId);
      if (freshRecord) {
        this.assertFileOperationAuthority(authority);
        this.invalidatePreparedProjectScans();
        upsertCachedProjectRecordForOwner(this.stateOwner, {
          ...freshRecord,
          project: { ...freshRecord.project, UsageTimestamps: actualPersistedValue },
        });
      }
    } catch (error) {
      if (error instanceof ProjectFileManagerDisposedError) return;
      if (error instanceof ProjectFileManagerFolderChangedError) return;
      try {
        this.assertGeneration(generation);
      } catch (lifecycleError) {
        if (lifecycleError instanceof ProjectFileManagerDisposedError) return;
        throw lifecycleError;
      }
      logError(`[Projects] Failed to touch last-used for projectId=${projectId}`, error);
    }
  }
}
