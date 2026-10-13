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
  isPendingFileWrite,
  isProjectStateOwnerActive,
  ProjectStateOwner,
  replaceCachedProjectRecordByFilePathForOwner,
  upsertCachedProjectRecordForOwner,
} from "@/projects/state";
import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { deriveProjectsFolder } from "@/settings/copilotFolder";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { debounce, type DebouncedFunction } from "@/utils/debounce";
import { App, Notice, TAbstractFile, Vault } from "obsidian";

export class ProjectRegisterDisposedError extends Error {
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

export class ProjectRegister {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly manager: ProjectFileManager;
  private readonly stateOwner: ProjectStateOwner;
  private settingsUnsubscriber?: () => void;

  private eventListenersRegistered = false;

  private initialized = false;

  private disposed = false;

  private initializePromise?: Promise<StartupMigrationItem | null>;

  private lifecycleGeneration = 0;

  private folderChangeRequestId = 0;
  private fileModifyDebouncers = new Map<
    string,
    DebouncedFunction<(pendingModify: PendingFileModify) => void>
  >();

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.manager = ProjectFileManager.startLifecycle(app);
    this.stateOwner = this.manager.getStateOwner();
  }

  initialize(): Promise<StartupMigrationItem | null> {
    if (this.disposed) {
      return Promise.reject(new ProjectRegisterDisposedError());
    }
    if (this.initialized) {
      return Promise.resolve(null);
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

  private async performInitialization(generation: number): Promise<StartupMigrationItem | null> {
    try {
      const migrationResult = await this.manager.initialize();
      if (generation === this.lifecycleGeneration) {
        this.initialized = true;
      }
      return migrationResult;
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

  private initializeEventListeners(): void {
    if (this.eventListenersRegistered) return;

    this.eventListenersRegistered = true;
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  private runCleanupAction(action: () => void, label: string): void {
    try {
      action();
    } catch (error) {
      logError(`[Projects] Failed to remove ${label}`, error);
    }
  }

  private isLifecycleCurrent(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.lifecycleGeneration &&
      isProjectStateOwnerActive(this.stateOwner)
    );
  }

  private captureProjectEventAuthority(): ProjectEventAuthority {
    return {
      lifecycleGeneration: this.lifecycleGeneration,
      folderChangeRequestId: this.folderChangeRequestId,
    };
  }

  private isProjectEventAuthorityCurrent(authority: ProjectEventAuthority): boolean {
    return (
      this.isLifecycleCurrent(authority.lifecycleGeneration) &&
      authority.folderChangeRequestId === this.folderChangeRequestId
    );
  }

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

  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
    const nextFolder = deriveProjectsFolder(next);
    if (deriveProjectsFolder(prev) !== nextFolder) {
      const requestId = ++this.folderChangeRequestId;
      this.manager.invalidateProjectsFolder();
      this.debouncedFolderChange({ nextFolder, requestId });
    }
  };

  private debouncedFolderChange = debounce(
    ({ nextFolder, requestId }: FolderChangeRequest) => {
      if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
      void this.handleProjectsFolderChange(nextFolder, requestId);
    },
    1000,
    { leading: false, trailing: true }
  );

  private scheduleFolderChangeRetry(nextFolder: string, requestId: number): void {
    if (
      !this.isLifecycleCurrent(this.lifecycleGeneration) ||
      requestId !== this.folderChangeRequestId
    ) {
      return;
    }
    this.debouncedFolderChange({ nextFolder, requestId });
  }

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

      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.isPreparedProjectScanCurrent(preparedScan)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      if (!this.manager.commitPreparedProjectScan(preparedScan, nextRecords)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      logInfo(`[Projects] Folder changed -> reloaded: ${nextFolder}`);
      new Notice(`Projects folder updated: ${nextFolder}`);
    } catch (error) {
      if (!this.isLifecycleCurrent(generation) || currentRequestId !== this.folderChangeRequestId) {
        return;
      }
      if (!this.manager.isPreparedProjectScanCurrent(preparedScan)) {
        this.scheduleFolderChangeRetry(nextFolder, currentRequestId);
        return;
      }

      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

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

  private isProjectConfigPathString(oldPath: string): boolean {
    const folder = getProjectsFolder();
    if (!oldPath.startsWith(folder + "/")) return false;

    const relativePath = oldPath.slice(folder.length + 1);
    if (relativePath.startsWith(`${PROJECTS_UNSUPPORTED_FOLDER_NAME}/`)) return false;

    const parts = relativePath.split("/");
    return parts.length === 2 && parts[1] === PROJECT_CONFIG_FILE_NAME;
  }

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

      if (record) {
        this.reloadProjectsAfterEvent("[Projects] Rescan after delete failed");
      }
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file deletion: ${file.path}`, error);
    }
  };

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

      if (wasValid && !isValidNow && oldRecord) {
        this.reloadProjectsAfterEvent("[Projects] Rescan after rename-out failed");
      }
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file rename: ${oldPath} -> ${file.path}`, error);
    }
  };

  private evictFileModifyDebouncer(filePath: string): void {
    const d = this.fileModifyDebouncers.get(filePath);
    if (d) {
      d.cancel();
      this.fileModifyDebouncers.delete(filePath);
    }
  }

  private reloadProjectsAfterEvent(errorMessage: string): void {
    if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
    void this.manager.reloadProjects().catch((error) => {
      if (this.disposed || !isProjectStateOwnerActive(this.stateOwner)) return;
      logError(errorMessage, error);
    });
  }

  private async processFileModify({ file, authority }: PendingFileModify): Promise<void> {
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
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path);
        if (staleRecord) {
          this.reloadProjectsAfterEvent("[Projects] Rescan after invalid edit failed");
        }
        return;
      }

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        if (!this.isProjectEventAuthorityCurrent(authority)) return;
        this.manager.invalidatePreparedProjectScans();
        deleteCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path);
        if (staleRecord) {
          this.reloadProjectsAfterEvent("[Projects] Rescan after duplicate edit failed");
        }
        logWarn(
          `[Projects] Duplicate id="${record.project.id}" on modify: ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      this.manager.invalidatePreparedProjectScans();
      replaceCachedProjectRecordByFilePathForOwner(this.stateOwner, file.path, record);
    } catch (error) {
      if (!this.isProjectEventAuthorityCurrent(authority)) return;
      logError(`[Projects] Error on file modify: ${file.path}`, error);
    }
  }

  private getFileModifyDebouncer(
    filePath: string
  ): DebouncedFunction<(pendingModify: PendingFileModify) => void> {
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
