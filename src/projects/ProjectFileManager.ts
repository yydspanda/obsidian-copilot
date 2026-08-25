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

/**
 * Resolves the knowledge Bundle portion of an update without conflating omission and deletion.
 *
 * An omitted property preserves the cached advanced configuration. An explicit own
 * `knowledgeBundle: undefined` removes it. Any other explicit value replaces it as
 * untrusted project data for the knowledge configuration source to validate later.
 *
 * @param existing - Currently cached project configuration
 * @param update - Incoming complete project update
 * @returns Detached update with the intended Bundle property state
 */
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

/**
 * Builds the complete frontmatter map for hidden-folder adapter writes.
 *
 * @param project - Project configuration to serialize
 * @param folderName - Folder name used only as the project-name fallback
 * @param timestamps - Created and last-used timestamps
 * @returns Complete frontmatter without invented optional values
 */
export function buildHiddenProjectFrontmatter(
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): Record<string, unknown> {
  const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
  const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

  const fm: Record<string, unknown> = {
    // Reason: do NOT fallback to folderName for id — with name-based folders,
    // folderName is derived from project name, not id.
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

/**
 * Builds complete project content for hidden-folder adapter writes.
 *
 * @param project - Project configuration to serialize
 * @param folderName - Folder name used only as the project-name fallback
 * @param timestamps - Created and last-used timestamps
 * @returns Complete Markdown file with YAML frontmatter
 */
function buildProjectFileContent(
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): string {
  const fm = buildHiddenProjectFrontmatter(project, folderName, timestamps);
  return `---\n${stringifyYaml(fm)}---\n${project.systemPrompt || ""}`;
}

/**
 * Returns the normalized parent portion of one captured Vault file path.
 *
 * @param filePath - Vault-relative file path
 * @returns Parent path, or an empty string for a root-level file
 */
function getVaultParentPath(filePath: string): string {
  const separatorIndex = filePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : filePath.slice(0, separatorIndex);
}

/** Reports use of a ProjectFileManager reference after its owning plugin lifecycle ended. */
export class ProjectFileManagerDisposedError extends Error {
  /** Creates a stable disposed-lifecycle failure. */
  constructor() {
    super("ProjectFileManager cannot be used after disposal");
    this.name = "ProjectFileManagerDisposedError";
  }
}

/** Reports that an operation's configured projects folder changed while it awaited I/O. */
export class ProjectFileManagerFolderChangedError extends Error {
  /** Creates a stable folder-generation failure. */
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

/**
 * Nominal token for one prepared full-project scan.
 *
 * The concrete class is intentionally module-private. Callers can carry the
 * exported alias between manager methods, but cannot construct a valid token.
 */
class PreparedProjectScanToken {
  private readonly preparedProjectScanBrand = true;

  /**
   * Creates a token whose authority is retained outside the public object shape.
   *
   * @param authority - Exact manager lifecycle and state revision authorized to commit
   */
  constructor(authority: ProjectScanAuthority) {
    preparedProjectScanAuthorities.set(this, authority);
    Object.freeze(this);
  }
}

/** Opaque identity for one full-project scan and its conditional cache commit. */
export type PreparedProjectScan = PreparedProjectScanToken;

/**
 * Project file manager (aligned with system-prompts Manager pattern).
 *
 * Responsibilities:
 * - CRUD: create/update/delete project.md files
 * - Cache: maintain in-memory list via state.ts
 * - last-used: throttled frontmatter writes via RecentUsageManager
 */
export class ProjectFileManager {
  private static instance: ProjectFileManager | undefined;
  private readonly app: App;
  private readonly vault: Vault;
  /** Opaque authority for every Projects state mutation and pending-write lease. */
  private readonly stateOwner: ProjectStateOwner;
  private readonly projectLastUsedManager = new RecentUsageManager<string>();
  /** Permanent boundary for one plugin/App ownership generation. */
  private disposed = false;
  /** Successful initialization state for this exact App/Vault owner. */
  private initialized = false;
  /** Shared initialization work for concurrent callers. */
  private initializePromise?: Promise<StartupMigrationItem | null>;
  /** Invalidates all asynchronous work synchronously on disposal. */
  private lifecycleGeneration = 0;
  /** Shared CAS revision for scans and direct project-state mutations. */
  private projectStateRevision = 0;
  /** Exact configured-folder generation for asynchronous CRUD operations. */
  private projectFolderRevision = 0;

  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.stateOwner = beginProjectStateLifecycle();
  }

  /**
   * Get singleton instance.
   * @param app - Obsidian App (required on first call)
   * @returns ProjectFileManager singleton
   */
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

  /**
   * Starts a fresh plugin lifecycle even when the App/Vault identity is unchanged.
   *
   * This is the construction entry point for ProjectRegister. It closes a still-live
   * manager from an overlapping hot reload before publishing the new lifecycle owner.
   *
   * @param app - App/Vault owner for the new plugin lifecycle
   * @returns Fresh active ProjectFileManager
   */
  public static startLifecycle(app: App): ProjectFileManager {
    ProjectFileManager.instance?.dispose();
    const manager = new ProjectFileManager(app);
    ProjectFileManager.instance = manager;
    return manager;
  }

  /**
   * Permanently releases this App/Vault owner and invalidates all in-flight work.
   *
   * Cache clearing is restricted to the active singleton owner so an obsolete retained
   * reference can never erase records installed by a later plugin/App generation.
   */
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

  /**
   * Initialize: run one-time migration from data.json if needed, then load all
   * projects from vault files. Migration unconditionally clears settings.projectList
   * after backing up failures to unsupported/ (no retry/merge — single source of truth).
   *
   * @returns Shared initialization Promise for the current lifecycle
   */
  public initialize(): Promise<StartupMigrationItem | null> {
    this.assertActive();
    if (this.initialized) return Promise.resolve(null);
    if (this.initializePromise) return this.initializePromise;

    const generation = this.lifecycleGeneration;
    const initialization = this.performInitialization(generation);
    this.initializePromise = initialization;
    return initialization;
  }

  /**
   * Runs migration and installs one scan only while its lifecycle still owns the singleton.
   *
   * @param generation - Lifecycle generation captured by initialize()
   */
  private async performInitialization(generation: number): Promise<StartupMigrationItem | null> {
    logInfo("[Projects] Initializing ProjectFileManager");
    try {
      const migrationResult = await ensureProjectsMigratedIfNeeded(this.app, this.stateOwner);
      this.assertGeneration(generation);

      // Reason: Vault events are registered before initialization. If one mutates
      // project state while the initial scan is in flight, retry from disk instead
      // of either overwriting the event or leaving a partial initial cache.
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

  /**
   * Get cached ProjectConfig list.
   * @returns Array of ProjectConfig
   */
  public getProjects(): ProjectConfig[] {
    this.assertActive();
    return getCachedProjectRecords().map((r) => r.project);
  }

  /**
   * Get cached ProjectFileRecord list.
   * @returns Array of ProjectFileRecord
   */
  public getProjectRecords(): ProjectFileRecord[] {
    this.assertActive();
    return getCachedProjectRecords();
  }

  /**
   * Reload all projects from vault (full scan + cache replace).
   *
   * Concurrent reloads use latest-wins cache installation. A reload started before
   * disposal may finish its I/O, but it cannot commit into a later lifecycle's cache.
   *
   * @returns Records observed by this reload
   */
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

  /**
   * Prepares a latest-wins full scan and invalidates every older prepared scan.
   *
   * @returns Opaque scan identity for fetch/currentness/commit operations
   */
  public prepareProjectScan(): PreparedProjectScan {
    const generation = this.captureActiveGeneration();
    const revision = ++this.projectStateRevision;
    return new PreparedProjectScanToken({
      manager: this,
      lifecycleGeneration: generation,
      revision,
    });
  }

  /**
   * Reads all projects for a previously prepared scan without committing them.
   *
   * A token may become stale during I/O. The records are still returned so callers
   * can finish deterministically, but only commitPreparedProjectScan can publish them.
   *
   * @param preparedScan - Opaque identity returned by prepareProjectScan()
   * @returns Records observed by this scan
   */
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

  /**
   * Reports whether a prepared scan still owns the current project-state revision.
   *
   * @param preparedScan - Opaque scan identity
   * @returns True only for this active manager's latest unconsumed scan
   */
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

  /**
   * Atomically publishes a prepared scan only if no newer scan or mutation won first.
   *
   * Successful commit consumes the token by advancing the same revision immediately
   * before replacing project state.
   *
   * @param preparedScan - Opaque scan identity
   * @param records - Complete records produced by that scan
   * @returns True when this scan committed; false when it was stale
   */
  public commitPreparedProjectScan(
    preparedScan: PreparedProjectScan,
    records: ProjectFileRecord[]
  ): boolean {
    if (!this.isPreparedProjectScanCurrent(preparedScan)) return false;

    this.projectStateRevision += 1;
    return updateCachedProjectRecordsForOwner(this.stateOwner, records);
  }

  /**
   * Invalidates all prepared scans before a direct project-state mutation.
   *
   * Call this synchronously and immediately adjacent to the owner-bound state
   * mutation that establishes the newer truth.
   */
  public invalidatePreparedProjectScans(): void {
    this.assertActive();
    this.projectStateRevision += 1;
  }

  /**
   * Invalidates scans and every CRUD operation captured under the prior folder setting.
   *
   * ProjectRegister calls this synchronously when projectsFolder changes, before its
   * debounce, so old-folder continuations fail closed even after a new scan commits.
   */
  public invalidateProjectsFolder(): void {
    this.assertActive();
    this.projectFolderRevision += 1;
    this.projectStateRevision += 1;
  }

  /**
   * Fetch all projects from the Vault without updating cached records.
   *
   * @returns Project records observed during the scan
   */
  public async fetchProjects(): Promise<ProjectFileRecord[]> {
    const generation = this.captureActiveGeneration();
    const records = await fetchAllProjects(this.app);
    this.assertGeneration(generation);
    return records;
  }

  /**
   * Get the RecentUsageManager for project last-used timestamps (for UI sorting).
   */
  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    this.assertActive();
    return this.projectLastUsedManager;
  }

  /**
   * Returns the opaque Projects state authority owned by this active manager.
   *
   * @returns Current lifecycle's state owner
   */
  public getStateOwner(): ProjectStateOwner {
    this.assertActive();
    return this.stateOwner;
  }

  /**
   * Captures the current lifecycle generation after asserting this owner is active.
   *
   * @returns Current lifecycle generation
   */
  private captureActiveGeneration(): number {
    this.assertActive();
    return this.lifecycleGeneration;
  }

  /**
   * Captures both plugin lifecycle and configured-folder identity for one CRUD operation.
   *
   * @returns Authority that must be revalidated after every asynchronous boundary
   */
  private captureFileOperationAuthority(): ProjectFileOperationAuthority {
    return {
      lifecycleGeneration: this.captureActiveGeneration(),
      projectFolderRevision: this.projectFolderRevision,
      projectsFolder: getProjectsFolder(),
    };
  }

  /**
   * Rejects calls through a reference whose plugin/App lifecycle has ended.
   */
  private assertActive(): void {
    if (
      this.disposed ||
      ProjectFileManager.instance !== this ||
      !isProjectStateOwnerActive(this.stateOwner)
    ) {
      throw new ProjectFileManagerDisposedError();
    }
  }

  /**
   * Rejects an asynchronous continuation that no longer owns this lifecycle.
   *
   * @param generation - Generation captured before the asynchronous boundary
   */
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

  /**
   * Rejects an asynchronous CRUD continuation from an obsolete projects folder.
   *
   * @param authority - Operation authority captured before its first Vault access
   */
  private assertFileOperationAuthority(authority: ProjectFileOperationAuthority): void {
    this.assertGeneration(authority.lifecycleGeneration);
    if (
      authority.projectFolderRevision !== this.projectFolderRevision ||
      authority.projectsFolder !== getProjectsFolder()
    ) {
      throw new ProjectFileManagerFolderChangedError();
    }
  }

  /**
   * Acquires an exact owner-bound pending-write lease or rejects stale work.
   *
   * @param filePath - Vault path whose plugin-generated events should be suppressed
   * @returns Opaque lease that must be released in a finally block
   */
  private acquireFileWrite(filePath: string): ProjectFileWriteLease {
    const lease = acquireProjectFileWrite(this.stateOwner, filePath);
    if (!lease) {
      throw new ProjectFileManagerDisposedError();
    }
    return lease;
  }

  /**
   * Sanitize a string for use as a project folder name.
   * Typically receives the project name (or id as fallback when name is empty).
   * Replaces path separators and control characters.
   * Rejects reserved names that conflict with internal directories.
   */
  private sanitizeFolderName(input: string): string {
    const sanitized = sanitizeVaultPathSegment(input);
    // Reason: "unsupported" is reserved for migration failure backups
    if (sanitized.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
      return `_${sanitized}`;
    }
    return sanitized;
  }

  /**
   * Best-effort rollback for one still-current lifecycle.
   * Also removes the parent folder if empty. Active-lifecycle cleanup errors are logged;
   * stale lifecycle errors are rethrown so no later Vault side effect can run.
   *
   * @param filePath - Created file to remove
   * @param folderPath - Parent folder to remove when empty
   * @param generation - Lifecycle generation that created the file
   */
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
        // Reason: hidden-folder files are not indexed by vault cache.
        // Fall back to adapter-based deletion for consistent hidden-folder support.
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

  /**
   * Extract the leading YAML frontmatter block (including closing marker and trailing newline).
   * @returns The frontmatter block string, or null if none found
   */
  private getLeadingFrontmatterBlock(raw: string): string | null {
    // Reason: strip optional BOM before matching, consistent with readFrontmatterFieldFromFile
    const content = raw.replace(/^\uFEFF/, "");
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? match[0] : null;
  }

  /**
   * Create a new project record at \<projectsFolder\>/\<folderName\>/project.md.
   * @param project - ProjectConfig to create
   * @returns Newly created ProjectFileRecord
   */
  public async createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;

    // Reason: validate raw id first, then sanitize only for folder name derivation.
    // The project.id stays as-is for stable logical identity.
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

    // Reason: derive folder name from project name for user-friendly vault browsing.
    // Fall back to id when name is empty/whitespace.
    const folderName = this.sanitizeFolderName(trimmedName || projectId);
    const filePath = getProjectConfigFilePath(folderName, authority.projectsFolder);
    const folderPath = getVaultParentPath(filePath);

    // Reason: detect case-insensitive folder collisions (macOS/Windows vaults are
    // case-insensitive). Without this, "Foo" and "foo" map to the same disk folder.
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

      // Reason: detect folder name collisions where a different project id sanitizes to the
      // same folder (e.g. "a/b" and "a\\b" both produce "a_b"). Check both cache and filesystem.
      // Uses adapter.exists() instead of getAbstractFileByPath() for hidden-folder compatibility.
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

      // Reason: use vault.create() return value directly instead of re-fetching via
      // getAbstractFileByPath(), which fails for hidden folders not indexed by vault cache.
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
        // Reason: rollback the created file to avoid leaving a "poisoned" file without frontmatter
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

  /**
   * Update an existing project (located by id).
   * @param projectId - Project id to update
   * @param nextProject - New ProjectConfig (id must match)
   * @returns Updated ProjectFileRecord
   */
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
    // Every path below derives from the record's OWN location, never the live
    // projects root. A Copilot root change activates immediately while
    // ProjectRegister reloads its cache on a 1s trailing debounce, so an update
    // started in that window would otherwise rename and write inside a
    // different tree — destructively when the new root is a previously-used one
    // that already holds a project of this name.
    const { projectsRoot } = getProjectAnchorFromConfigPath(existing.filePath);
    const projectFolderIn = (name: string) => normalizePath(`${projectsRoot}/${name}`);

    // Reason: when the project name changes, the folder should be renamed to match.
    // This keeps vault browsing intuitive (folder = project name).
    const nextFolderName = this.sanitizeFolderName(trimmedName || normalizedId);
    let oldFilePathForPending: string | null = null;

    if (nextFolderName !== existing.folderName) {
      const newFolderPath = projectFolderIn(nextFolderName);
      // Reason: a folder rename keeps the config basename (`project.md`), so the new config
      // path is just `project.md` under the renamed folder.
      const newFilePath = getProjectConfigFilePath(nextFolderName, projectsRoot);

      // Check collision: cache (case-insensitive) + filesystem
      const folderKey = nextFolderName.toLowerCase();
      const folderConflict = getCachedProjectRecords().find(
        (r) => r.project.id !== normalizedId && r.folderName.toLowerCase() === folderKey
      );
      if (folderConflict) {
        throw new Error(
          `Cannot rename project folder: "${nextFolderName}" conflicts with project "${folderConflict.project.name}"`
        );
      }
      // Reason: on case-insensitive filesystems (macOS/Windows), a case-only rename
      // (e.g. "foo" → "Foo") reports the old folder as "already existing". Skip the
      // disk-conflict check when the paths differ only in case.
      const isCaseOnlyRename =
        newFolderPath.toLowerCase() === projectFolderIn(existing.folderName).toLowerCase();
      const newFolderExists = !isCaseOnlyRename && (await this.vault.adapter.exists(newFolderPath));
      this.assertFileOperationAuthority(authority);
      if (newFolderExists) {
        throw new Error(`Cannot rename project folder: "${newFolderPath}" already exists on disk`);
      }

      // Suppress vault events for both old and new project.md paths
      oldFilePathForPending = filePath;
      fileWriteLeases.push(this.acquireFileWrite(oldFilePathForPending));
      fileWriteLeases.push(this.acquireFileWrite(newFilePath));

      try {
        const oldFolderPath = projectFolderIn(existing.folderName);
        // Reason: use vault-cache-aware rename when possible, adapter fallback for hidden folders
        const folderObj = this.vault.getAbstractFileByPath(oldFolderPath);
        if (folderObj instanceof TFolder) {
          await this.vault.rename(folderObj, newFolderPath);
        } else {
          await this.vault.adapter.rename(oldFolderPath, newFolderPath);
        }
        this.assertFileOperationAuthority(authority);
      } catch (renameError) {
        // Rename failed — folder not moved, clean up pending and rethrow
        for (const lease of fileWriteLeases.splice(0)) {
          releaseProjectFileWrite(lease);
        }
        if (renameError instanceof ProjectFileManagerDisposedError) {
          throw renameError;
        }
        this.assertGeneration(generation);
        throw renameError;
      }

      // Update local variables to use new paths for subsequent writes
      filePath = newFilePath;
      folderName = nextFolderName;
      logInfo(
        `[Projects] Renamed project folder: "${existing.folderName}" → "${nextFolderName}" for project ${normalizedId}`
      );
    }

    try {
      // Reason: only add pending-write guard when no folder rename occurred.
      // When a rename happened, the new path was already guarded at L380 and will be
      // cleaned up in the finally block. Adding again would leak the ref-count.
      if (!oldFilePathForPending) {
        fileWriteLeases.push(this.acquireFileWrite(filePath));
      }

      // Reason: use resolveFileByPath to handle both vault-cached and hidden-folder files.
      // getAbstractFileByPath returns null for hidden folders even when the file exists on disk.
      let file = await resolveFileByPath(this.app, filePath);
      this.assertFileOperationAuthority(authority);
      let materialized = false;

      // Reason: if the file doesn't exist anywhere (e.g. legacy project merged into cache before
      // migration completed), materialize it now so the update can proceed.
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
      // Reason: take the maximum of cached value and in-memory manager value to avoid
      // clobbering a recent touchProjectLastUsed() write with a stale cached value.
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

      // Reason: processFrontMatter (used by writeProjectFrontmatter) does not work reliably
      // on synthetic TFiles for hidden folders. Split into cached-file and adapter-based paths.
      if (isInVaultCache(this.app, filePath)) {
        // Vault-cached file: use processFrontMatter for safe field-level updates
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

        // Read back the updated frontmatter block, then combine with new body in a single write
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
        // Hidden-folder file: build complete content and write via adapter
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
      // Reason: if the folder was already renamed but writing failed, roll the folder back
      // to prevent leaving the project in an inconsistent location.
      if (oldFilePathForPending && folderName !== existing.folderName) {
        try {
          const oldFolderPath = projectFolderIn(existing.folderName);
          const newFolderPath = projectFolderIn(folderName);
          // Reason: use vault.rename() for cached folders (same as forward rename) so
          // the vault cache stays consistent. Fall back to adapter for hidden folders.
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

  /**
   * Delete a project by id. Deletes only the managed project.md file, then removes the folder
   * if it is empty. AGENTS.md and other user-editable files are preserved.
   * @param projectId - Project id to delete
   */
  public async deleteProject(projectId: string): Promise<void> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;
    const normalizedId = (projectId || "").trim();
    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) {
      logWarn(`[Projects] deleteProject: not found: ${normalizedId}`);
      return;
    }

    // From the record's own config path: deleting via the live root would target
    // a same-named project in a different tree during the window after a root
    // change but before ProjectRegister reloads its cache.
    const { projectFolderPath: folderPath } = getProjectAnchorFromConfigPath(existing.filePath);
    const fileWriteLease = this.acquireFileWrite(existing.filePath);

    try {
      // Reason: delete only the managed config file to avoid destroying user files
      // that may have been placed in the project folder. trashFile respects the
      // user's trash behavior (system trash / .trash folder / permanent).
      const configFile = this.vault.getAbstractFileByPath(existing.filePath);
      if (configFile instanceof TFile) {
        await trashFile(this.app, configFile);
        this.assertFileOperationAuthority(authority);
      } else {
        const configFileExists = await this.vault.adapter.exists(existing.filePath);
        this.assertFileOperationAuthority(authority);
        if (configFileExists) {
          // Reason: hidden-folder files are not indexed by vault cache.
          // Fall back to adapter-based deletion for consistent hidden-folder support.
          await this.vault.adapter.remove(existing.filePath);
          this.assertFileOperationAuthority(authority);
        }
      }

      // Reason: clear cache immediately after file deletion to prevent phantom project
      // state if the subsequent folder cleanup fails.
      this.assertFileOperationAuthority(authority);
      this.invalidatePreparedProjectScans();
      deleteCachedProjectRecordByIdForOwner(this.stateOwner, normalizedId);

      // Drop Copilot's own instruction wiring (marker-owned mirror, import-only CLAUDE.md) so
      // the folder can empty and a same-named project created later cannot inherit this one's
      // instructions through the mirror conversion. User-authored files are preserved.
      await removeGeneratedInstructionFiles(this.app, folderPath);
      this.assertFileOperationAuthority(authority);

      // Cleanup: remove the folder only if it is empty after deleting project.md.
      // Best-effort: the project file is already gone, so cleanup failure
      // must not leave a phantom project in memory.
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

      // Reason: clear the off-vault failure-marker bucket
      // (markers/<md5(projectId)>). Clearing it stops a project
      // recreated under the same id from inheriting stale negative-cache state.
      // Desktop-gated + dynamically imported so node-backed cache modules never
      // load on mobile; best-effort so a cleanup failure can't strand the delete.
      if (isDesktopRuntime()) {
        const { clearProjectMarkers } = await import("@/context/projectMarkerCleanup");
        await clearProjectMarkers(this.app, normalizedId).catch((err) =>
          logError(`[Projects] Failed to clear off-vault failure markers on delete`, err)
        );
        this.assertFileOperationAuthority(authority);
      }

      logInfo(`[Projects] Deleted project: ${normalizedId} -> ${folderPath}`);

      // Reason: rescan to re-admit any previously-ignored duplicate-id files.
      // The register won't fire (pending guard), so we trigger rescan here.
      void this.reloadProjects().catch((err) => {
        if (err instanceof ProjectFileManagerDisposedError) return;
        logError("[Projects] Rescan after delete failed", err);
      });
    } finally {
      releaseProjectFileWrite(fileWriteLease);
    }
  }

  /**
   * Touch project last-used: memory updated immediately; frontmatter write throttled.
   * @param projectId - Project id to touch
   */
  public async touchProjectLastUsed(projectId: string): Promise<void> {
    const authority = this.captureFileOperationAuthority();
    const generation = authority.lifecycleGeneration;
    const normalizedId = (projectId || "").trim();
    const record = getCachedProjectRecordById(normalizedId);
    if (!record) return;

    try {
      // 1. Update memory immediately (for UI sorting feedback)
      this.projectLastUsedManager.touch(normalizedId);

      // 2. Check if persistence is needed (throttled)
      const timestampToPersist = this.projectLastUsedManager.shouldPersist(
        normalizedId,
        record.project.UsageTimestamps
      );
      if (timestampToPersist === null) return;

      const filePath = normalizePath(record.filePath);
      const file = await resolveFileByPath(this.app, filePath);
      this.assertFileOperationAuthority(authority);
      if (!file) return;

      // Reason: an exact lease cannot release another concurrent writer's guard.
      const fileWriteLease = this.acquireFileWrite(filePath);
      let actualPersistedValue = timestampToPersist;
      try {
        if (isInVaultCache(this.app, filePath)) {
          // Vault-cached file: use processFrontMatter for safe field-level update
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
          // Hidden-folder file: use adapter-based frontmatter patch
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

      // 3. Mark persistence successful with actual written value (for accurate throttling)
      this.assertFileOperationAuthority(authority);
      this.projectLastUsedManager.markPersisted(normalizedId, actualPersistedValue);

      // 4. Sync cached record so updateProject() sees the latest value.
      // Reason: re-read fresh record to avoid overwriting concurrent edits to other fields.
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
