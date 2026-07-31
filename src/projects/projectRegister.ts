import { getCurrentProject } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { logError, logInfo, logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  ensureProjectFrontmatter,
  getProjectsFolder,
  isProjectConfigFile,
  parseProjectConfigFile,
} from "@/projects/projectUtils";
import {
  deleteCachedProjectRecordByFilePathForOwner,
  getCachedProjectRecordByFilePath,
  getCachedProjectRecordById,
  getCachedProjectRecords,
  isPendingFileWrite,
  isProjectStateOwnerActive,
  ProjectStateOwner,
  replaceCachedProjectRecordByFilePathForOwner,
  upsertCachedProjectRecordForOwner,
} from "@/projects/state";
import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { debounce } from "@/utils/debounce";
import { App, Notice, TAbstractFile, Vault } from "obsidian";

/** Reports an attempt to reuse a ProjectRegister after permanent plugin cleanup. */
export class ProjectRegisterDisposedError extends Error {
  /** Creates a stable disposed-lifecycle failure. */
  constructor() {
    super("ProjectRegister cannot initialize after cleanup");
    this.name = "ProjectRegisterDisposedError";
  }
}

interface FolderChangeRequest {
  nextFolder: string;
  requestId: number;
}

interface ProjectEventAuthority {
  lifecycleGeneration: number;
  folderChangeRequestId: number;
}

interface PendingFileModify {
  file: TAbstractFile;
  authority: ProjectEventAuthority;
}

/**
 * Project Register: manages vault event listeners and cache synchronization.
 * Aligned with system-prompts Register pattern.
 *
 * Responsibilities:
 * - Auto-sync project.md create/modify/delete/rename to in-memory cache
 * - Listen for projectsFolder setting changes with latest-wins reload
 * - Avoid event loops from pending file writes
 */
export class ProjectRegister {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly manager: ProjectFileManager;
  private readonly stateOwner: ProjectStateOwner;
  private readonly projectContextCache: ProjectContextCache;
  private settingsUnsubscriber?: () => void;
  /** Whether this generation currently owns the four Vault listeners. */
  private eventListenersRegistered = false;
  /** Successful initialization state for the current lifecycle generation. */
  private initialized = false;
  /** Permanent plugin-unload boundary; disposed instances cannot be revived. */
  private disposed = false;
  /** Shared initialization work for concurrent callers in the current generation. */
  private initializePromise?: Promise<void>;
  /** Monotonic lifecycle generation invalidated synchronously by cleanup. */
  private lifecycleGeneration = 0;
  /** Monotonic request id for latest-wins semantics on folder change. */
  private folderChangeRequestId = 0;
  /** Per-file debounced modify handlers to avoid cross-file debounce collisions. */
  private fileModifyDebouncers = new Map<string, ReturnType<typeof debounce>>();

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.manager = ProjectFileManager.startLifecycle(app);
    this.stateOwner = this.manager.getStateOwner();
    this.projectContextCache = ProjectContextCache.getInstance(this.vault);
  }

  /**
   * Initialize: register vault listeners and load all projects.
   *
   * Reason: listeners must be registered here (not in the constructor) because
   * the constructor runs during plugin onload(), before onLayoutReady(). Obsidian's
   * Vault.on("create") fires for every existing file during the initial vault load,
   * which would trigger premature cache mutations and ensureProjectFrontmatter writes
   * before migration has completed. Deferring to initialize() (called from
   * onLayoutReady) avoids this race.
   */
  initialize(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new ProjectRegisterDisposedError());
    }
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }

    const generation = ++this.lifecycleGeneration;
    try {
      this.initializeEventListeners();
    } catch (error) {
      this.removeEventListeners();
      const rejection =
        error instanceof Error ? error : new Error("Project listener initialization failed");
      return Promise.reject(rejection);
    }

    const initialization = this.performInitialization(generation);
    this.initializePromise = initialization;
    return initialization;
  }

  /**
   * Completes manager initialization for one still-current lifecycle generation.
   *
   * @param generation - Generation that registered the current listeners
   */
  private async performInitialization(generation: number): Promise<void> {
    try {
      await this.manager.initialize();
      if (generation === this.lifecycleGeneration) {
        this.initialized = true;
      }
    } catch (error) {
      if (generation === this.lifecycleGeneration) {
        this.initialized = false;
        this.removeEventListeners();
        this.initializePromise = undefined;
        this.lifecycleGeneration += 1;
      }
      throw error;
    } finally {
      if (generation === this.lifecycleGeneration) {
        this.initializePromise = undefined;
      }
    }
  }

  /**
   * Cleanup event listeners and invalidate any initialization still in flight.
   */
  cleanup(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.initialized = false;
    this.initializePromise = undefined;
    this.folderChangeRequestId += 1;
    this.runCleanupAction(() => this.manager.dispose(), "ProjectFileManager");

    for (const d of this.fileModifyDebouncers.values()) d.cancel();
    this.fileModifyDebouncers.clear();
    this.debouncedFolderChange.cancel();
    this.removeEventListeners();
  }

  /**
   * Wire up vault event listeners and settings subscription.
   */
  private initializeEventListeners(): void {
    if (this.eventListenersRegistered) return;

    // Reason: set ownership before registration so a partial synchronous failure
    // can remove every callback that may already have been accepted by Vault.
    this.eventListenersRegistered = true;
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  /**
   * Runs one lifecycle cleanup action without preventing the remaining removals.
   *
   * @param action - Synchronous removal callback
   * @param label - Static label used for logging
   */
  private runCleanupAction(action: () => void, label: string): void {
    try {
      action();
    } catch (error) {
      logError(`[Projects] Failed to remove ${label}`, error);
    }
  }

  /**
   * Checks whether an asynchronous event continuation still belongs to this Register.
   *
   * @param generation - Lifecycle generation captured before awaiting
   * @returns True only while this exact lifecycle remains active
   */
  private isLifecycleCurrent(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.lifecycleGeneration &&
      isProjectStateOwnerActive(this.stateOwner)
    );
  }

  /**
   * Captures the exact plugin and configured-folder generation for one Vault event.
   *
   * @returns Immutable values that every asynchronous continuation must revalidate
   */
  private captureProjectEventAuthority(): ProjectEventAuthority {
    return {
      lifecycleGeneration: this.lifecycleGeneration,
      folderChangeRequestId: this.folderChangeRequestId,
    };
  }

  /**
   * Checks that a Vault event still belongs to both this lifecycle and projects folder.
   *
   * @param authority - Values captured when the Vault event was accepted
   * @returns True only before cleanup and before any projects-folder settings change
   */
  private isProjectEventAuthorityCurrent(authority: ProjectEventAuthority): boolean {
    return (
      this.isLifecycleCurrent(authority.lifecycleGeneration) &&
      authority.folderChangeRequestId === this.folderChangeRequestId
    );
  }

  /**
   * Removes the listeners and settings subscription owned by this instance.
   */
  private removeEventListeners(): void {
    const removeVaultListeners = this.eventListenersRegistered;
    const settingsUnsubscriber = this.settingsUnsubscriber;
    this.eventListenersRegistered = false;
    this.settingsUnsubscriber = undefined;

    if (removeVaultListeners) {
      this.runCleanupAction(
        () => this.vault.off("create", this.handleFileCreation),
        "create listener"
      );
      this.runCleanupAction(
        () => this.vault.off("delete", this.handleFileDeletion),
        "delete listener"
      );
      this.runCleanupAction(
        () => this.vault.off("rename", this.handleFileRename),
        "rename listener"
      );
      this.runCleanupAction(
        () => this.vault.off("modify", this.handleFileModify),
        "modify listener"
      );
    }

    if (settingsUnsubscriber) {
      this.runCleanupAction(settingsUnsubscriber, "settings subscription");
    }
  }

  /**
   * Settings change handler: react to projectsFolder changes.
   */
  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
    if (prev.projectsFolder !== next.projectsFolder) {
      // Reason: invalidate synchronously at the settings linearization point.
      // Waiting for the debounce would let an older folder scan commit after
      // CRUD paths had already switched to the new configured folder.
      const requestId = ++this.folderChangeRequestId;
      this.manager.invalidateProjectsFolder();
      this.debouncedFolderChange({ nextFolder: next.projectsFolder, requestId });
    }
  };

  /**
   * Debounced folder change handler (avoid rapid-fire during user typing).
   */
  private debouncedFolderChange = debounce(
    ({ nextFolder, requestId }: FolderChangeRequest) => {
      if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
      void this.handleProjectsFolderChange(nextFolder, requestId);
    },
    1000,
    { leading: false, trailing: true }
  );

  /**
   * Schedules a bounded follow-up attempt when a direct state mutation wins a scan race.
   *
   * Reusing the trailing debounce prevents an active stream of Vault events from
   * producing a hot retry loop. A newer settings request replaces this retry.
   *
   * @param nextFolder - Folder that the still-current settings request selected
   * @param requestId - Settings request whose scan must converge
   */
  private scheduleFolderChangeRetry(nextFolder: string, requestId: number): void {
    if (
      !this.isLifecycleCurrent(this.lifecycleGeneration) ||
      requestId !== this.folderChangeRequestId
    ) {
      return;
    }
    this.debouncedFolderChange({ nextFolder, requestId });
  }

  /**
   * Handle projectsFolder change: success-then-replace reload with latest-wins.
   */
  private async handleProjectsFolderChange(
    nextFolder: string,
    scheduledRequestId?: number
  ): Promise<void> {
    const generation = this.lifecycleGeneration;
    if (!this.isLifecycleCurrent(generation)) return;
    const currentRequestId = scheduledRequestId ?? ++this.folderChangeRequestId;
    if (currentRequestId !== this.folderChangeRequestId) return;
    if (scheduledRequestId === undefined) {
      this.manager.invalidatePreparedProjectScans();
    }
    const preparedScan = this.manager.prepareProjectScan();

    try {
      const nextRecords = await this.manager.fetchPreparedProjectScan(preparedScan);

      // Latest-wins: discard stale results
      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.isPreparedProjectScanCurrent(preparedScan)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      // Reason: old folder's debouncers are stale after folder change
      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      // Reason: await old cache clears before installing new records to prevent
      // same-id race: fire-and-forget clears could delete freshly rebuilt cache.
      const oldRecords = getCachedProjectRecords();
      const cache = this.projectContextCache;
      await Promise.all(
        oldRecords.map((old) =>
          cache
            .clearForProject(old.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on folder switch", err)
            )
        )
      );

      // Reason: cleanup or a newer folder request may have occurred while context caches cleared.
      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.commitPreparedProjectScan(preparedScan, nextRecords)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      // Reason: don't call setCurrentProject(null) here — ProjectManager's
      // records subscriber will detect the disappearance after updateCachedProjectRecords
      // and handle save-first ordering via switchProject(null).
      const current = getCurrentProject();
      if (current) {
        const stillExists = getCachedProjectRecordById(current.id);
        if (!stillExists) {
          new Notice(`Project "${current.name}" not found in new folder. Cleared selection.`);
        }
      }

      logInfo(`[Projects] Folder changed -> reloaded: ${nextFolder}`);
      new Notice(`Projects folder updated: ${nextFolder}`);
    } catch (error) {
      // Reason: latest-wins guard — discard stale failure from an earlier request
      // that resolved after a newer successful reload.
      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.isPreparedProjectScanCurrent(preparedScan)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      // Reason: clear stale cache on failure to avoid split-brain storage where
      // creates go to the new folder while edits/deletes target old cached paths.
      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      // Reason: clear context caches before wiping records to prevent same-id
      // projects from reusing stale context on a later retry.
      const oldRecords = getCachedProjectRecords();
      const cache = this.projectContextCache;
      await Promise.all(
        oldRecords.map((old) =>
          cache
            .clearForProject(old.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on folder switch failure", err)
            )
        )
      );

      // Reason: cleanup or a newer folder request may have occurred while context caches cleared.
      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.commitPreparedProjectScan(preparedScan, [])) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      logError(`[Projects] Failed to reload after folder change: ${nextFolder}`, error);
      new Notice(
        `Failed to reload projects from "${nextFolder}". Projects cleared — reopen settings to retry.`
      );
    }
  }

  /**
   * String-level check if oldPath could be a project config path (for rename events).
   */
  private isProjectConfigPathString(oldPath: string): boolean {
    const folder = getProjectsFolder();
    if (!oldPath.startsWith(folder + "/")) return false;

    const relativePath = oldPath.slice(folder.length + 1);
    if (relativePath.startsWith(`${PROJECTS_UNSUPPORTED_FOLDER_NAME}/`)) return false;

    const parts = relativePath.split("/");
    return parts.length === 2 && parts[1] === PROJECT_CONFIG_FILE_NAME;
  }

  /**
   * File creation event: parse and upsert to cache; ensure frontmatter if needed.
   */
  private handleFileCreation = async (file: TAbstractFile) => {
    const authority = this.captureProjectEventAuthority();
    if (
      !this.isProjectEventAuthorityCurrent(authority) ||
      !isProjectConfigFile(file) ||
      isPendingFileWrite(file.path)
    ) {
      return;
    }

    try {
      const record = await parseProjectConfigFile(this.app, file);
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      if (!record) return;

      // Duplicate id: keep first in cache, ignore incoming
      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        logWarn(
          `[Projects] Duplicate id="${record.project.id}": ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      await ensureProjectFrontmatter(this.app, this.stateOwner, file, record);
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      const updated = await parseProjectConfigFile(this.app, file);
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      if (updated) {
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        upsertCachedProjectRecordForOwner(this.stateOwner, updated);
      }
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file creation: ${file.path}`, error);
    }
  };

  /**
   * File deletion event: remove from cache by filePath.
   * If deleted project is currently selected, clear the selection.
   */
  private handleFileDeletion = async (file: TAbstractFile) => {
    const authority = this.captureProjectEventAuthority();
    if (
      !this.isProjectEventAuthorityCurrent(authority) ||
      !isProjectConfigFile(file) ||
      isPendingFileWrite(file.path)
    ) {
      return;
    }

    this.evictFileModifyDebouncer(file.path);

    try {
      const record = getCachedProjectRecordByFilePath(file.path);
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      this.manager.invalidatePreparedProjectScans();
      deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path);

      // Reason: if the deleted file was the current project, clear selection to avoid UI pointing
      // to a non-existent project (aligned with system-prompts delete handler).
      if (record) {
        // Reason: await cache clear to prevent same-ID recreation from having its
        // fresh cache wiped by a stale async cleanup. Consistent with folder-switch path.
        await this.projectContextCache
          .clearForProject(record.project)
          .catch((err) =>
            logError("[Projects] Failed to clear context cache on external delete", err)
          );
        if (!this.isProjectEventAuthorityCurrent(authority)) return;

        // Reason: don't call setCurrentProject(null) here — ProjectManager's
        // records subscriber will detect the disappearance and handle save-first
        // ordering via switchProject(null) to avoid misclassifying the chat.
        const current = getCurrentProject();
        if (current?.id === record.project.id) {
          new Notice(`Project "${record.project.name}" was deleted.`);
        }

        // Reason: rescan to re-admit any previously-ignored duplicate-id files
        // that were hidden while the deleted file was the "kept" entry.
        // Re-merge legacy projects after rescan so unmigrated fallback entries stay visible.
        this.reloadProjectsAfterEvent("[Projects] Rescan after delete failed");
      }
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file deletion: ${file.path}`, error);
    }
  };

  /**
   * File rename event: sync cache for old/new paths.
   * If renamed out of projects folder and was current project, clear selection.
   */
  private handleFileRename = async (file: TAbstractFile, oldPath: string) => {
    const authority = this.captureProjectEventAuthority();
    if (
      !this.isProjectEventAuthorityCurrent(authority) ||
      isPendingFileWrite(file.path) ||
      isPendingFileWrite(oldPath)
    ) {
      return;
    }

    const wasValid = this.isProjectConfigPathString(oldPath);
    const isValidNow = isProjectConfigFile(file);

    if (!wasValid && !isValidNow) return;

    if (wasValid) this.evictFileModifyDebouncer(oldPath);

    try {
      const oldRecord = wasValid ? getCachedProjectRecordByFilePath(oldPath) : undefined;

      // Reason: validate the new file before deleting the old cache entry,
      // so a duplicate-ID rename doesn't leave a cache gap.
      if (isValidNow) {
        const record = await parseProjectConfigFile(this.app, file);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        if (!record) {
          if (wasValid) {
            if (!this.isProjectEventAuthorityCurrent(authority)) return;
            this.manager.invalidatePreparedProjectScans();
            deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, oldPath);
          }
          return;
        }

        // Reason: check for duplicate ID, but exclude the old record being renamed
        // (self-rename: existing.filePath === oldPath means it's the same project).
        const existing = getCachedProjectRecordById(record.project.id);
        const isTrueDuplicate =
          existing && existing.filePath !== record.filePath && existing.filePath !== oldPath;

        if (isTrueDuplicate) {
          if (wasValid) {
            if (!this.isProjectEventAuthorityCurrent(authority)) return;
            this.manager.invalidatePreparedProjectScans();
            deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, oldPath);
          }
          logWarn(
            `[Projects] Duplicate id="${record.project.id}" after rename: ` +
              `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
          );
          return;
        }

        await ensureProjectFrontmatter(this.app, this.stateOwner, file, record);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        const updated = await parseProjectConfigFile(this.app, file);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        if (updated) {
          // Reason: use atomic replace to avoid transient disappearance gap.
          // delete+upsert causes the subscriber to see the active project as missing
          // and trigger switchProject(null) during valid renames.
          if (wasValid) {
            if (!this.isProjectEventAuthorityCurrent(authority)) return;
            this.manager.invalidatePreparedProjectScans();
            replaceCachedProjectRecordByFilePathForOwner(this.stateOwner, oldPath, updated);
          } else {
            if (!this.isProjectEventAuthorityCurrent(authority)) return;
            this.manager.invalidatePreparedProjectScans();
            upsertCachedProjectRecordForOwner(this.stateOwner, updated);
          }
        } else if (wasValid) {
          if (!this.isProjectEventAuthorityCurrent(authority)) return;
          this.manager.invalidatePreparedProjectScans();
          deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, oldPath);
        }
      } else if (wasValid) {
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, oldPath);
      }

      // Reason: project moved out of projects folder → clear current selection and context cache
      if (wasValid && !isValidNow && oldRecord) {
        // Reason: await cache clear to prevent same-ID recreation from having its
        // fresh cache wiped by a stale async cleanup. Consistent with folder-switch path.
        await this.projectContextCache
          .clearForProject(oldRecord.project)
          .catch((err) => logError("[Projects] Failed to clear context cache on rename-out", err));
        if (!this.isProjectEventAuthorityCurrent(authority)) return;

        // Reason: don't call setCurrentProject(null) here — ProjectManager's
        // records subscriber handles save-first ordering via switchProject(null).
        const current = getCurrentProject();
        if (current?.id === oldRecord.project.id) {
          new Notice(`Project "${oldRecord.project.name}" was moved.`);
        }

        // Reason: rescan to re-admit any previously-ignored duplicate-id files
        // that were hidden while the moved file was the "kept" entry.
        this.reloadProjectsAfterEvent("[Projects] Rescan after rename-out failed");
      }
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file rename: ${oldPath} -> ${file.path}`, error);
    }
  };

  /** Cancel and remove a per-file debouncer (on delete/rename/folder change). */
  private evictFileModifyDebouncer(filePath: string): void {
    const d = this.fileModifyDebouncers.get(filePath);
    if (d) {
      d.cancel();
      this.fileModifyDebouncers.delete(filePath);
    }
  }

  /**
   * Starts an event-driven full rescan through the manager's lifecycle authority.
   *
   * @param errorMessage - Static log prefix for unexpected active-lifecycle failures
   */
  private reloadProjectsAfterEvent(errorMessage: string): void {
    if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
    void this.manager.reloadProjects().catch((error) => {
      if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
      logError(errorMessage, error);
    });
  }

  /**
   * Process a single file modify: parse and update cache.
   *
   * @param pendingModify - File and exact event authority captured before debounce
   */
  private async processFileModify({ file, authority }: PendingFileModify): Promise<void> {
    // Reason: second guard — a new pending write may have started during the debounce window
    if (
      !this.isProjectEventAuthorityCurrent(authority) ||
      !isProjectConfigFile(file) ||
      isPendingFileWrite(file.path)
    ) {
      return;
    }

    try {
      const record = await parseProjectConfigFile(this.app, file);
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      if (!record) {
        // Reason: file became invalid YAML — remove stale cache entry and clear selection
        // if this was the active project, so UI and chain don't use stale config.
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path);
        if (staleRecord) {
          await this.projectContextCache
            .clearForProject(staleRecord.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on invalid edit", err)
            );
          if (!this.isProjectEventAuthorityCurrent(authority)) return;
          // Reason: rescan to re-admit previously-ignored duplicate-id files
          this.reloadProjectsAfterEvent("[Projects] Rescan after invalid edit failed");
        }
        return;
      }

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        // Reason: another file already owns this id. Remove stale entry.
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path);
        if (staleRecord) {
          await this.projectContextCache
            .clearForProject(staleRecord.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on duplicate edit", err)
            );
          if (!this.isProjectEventAuthorityCurrent(authority)) return;
          // Reason: rescan to re-admit previously-ignored duplicate-id files
          this.reloadProjectsAfterEvent("[Projects] Rescan after duplicate edit failed");
        }
        logWarn(
          `[Projects] Duplicate id="${record.project.id}" on modify: ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      // Reason: if the user edited copilot-project-id directly, clear the old id's
      // context cache to prevent stale context resurrection when the old id is reused.
      const oldRecord = getCachedProjectRecordByFilePath(file.path);
      if (oldRecord && oldRecord.project.id !== record.project.id) {
        await this.projectContextCache
          .clearForProject(oldRecord.project)
          .catch((err) => logError("[Projects] Failed to clear context cache on id change", err));
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
      }

      // Reason: single atomic write avoids transient gap where subscribers see the project disappear
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      this.manager.invalidatePreparedProjectScans();
      replaceCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path, record);
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file modify: ${file.path}`, error);
    }
  }

  /**
   * Get or create a per-file debounced modify handler.
   * Reason: per-file debounce avoids cross-file collisions where modifying projectA
   * within the debounce window of projectB would drop projectB's cache update.
   */
  private getFileModifyDebouncer(filePath: string): ReturnType<typeof debounce> {
    let d = this.fileModifyDebouncers.get(filePath);
    if (!d) {
      d = debounce(
        (pendingModify: PendingFileModify) => {
          void this.processFileModify(pendingModify);
        },
        1000,
        { leading: false, trailing: true }
      );
      this.fileModifyDebouncers.set(filePath, d);
    }
    return d;
  }

  /**
   * File modify event: filter pending writes at event time (before debounce),
   * so the guard is checked when the event fires, not 1s later when the pending flag
   * may already be cleared. Uses per-file debounce to avoid cross-file collisions.
   */
  private handleFileModify = (file: TAbstractFile): void => {
    const authority = this.captureProjectEventAuthority();
    if (
      !this.isProjectEventAuthorityCurrent(authority) ||
      !isProjectConfigFile(file) ||
      isPendingFileWrite(file.path)
    ) {
      return;
    }
    this.getFileModifyDebouncer(file.path)({ file, authority });
  };
}
