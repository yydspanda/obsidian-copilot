import {
  FailedItem,
  ProjectConfig,
  projectContextLoadAtom,
  setProjectContextLoadState,
  updateProjectContextLoadState,
} from "@/aiParams";
import { ContextCache } from "@/cache/projectContextCache";
import { logInfo } from "@/logger";
import { settingsStore } from "@/settings/model";
import { err2String } from "@/utils";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import type { App, TFile, Vault } from "obsidian";

/** Error thrown when a project load tracker is used outside its owning plugin lifecycle. */
export class ProjectLoadTrackerDisposedError extends Error {
  /**
   * Create a lifecycle error for a disposed project load tracker.
   */
  public constructor() {
    super("ProjectLoadTracker has been disposed");
    this.name = "ProjectLoadTrackerDisposedError";
  }
}

/**
 * ProjectLoadTracker is responsible for managing the progress tracking of project file processing
 */
export class ProjectLoadTracker {
  private static activeInstance?: ProjectLoadTracker;
  private readonly app: App;
  private readonly vault: Vault;
  private disposed = false;
  private lifecycleGeneration = 0;

  /**
   * Create a tracker owned by one exact App and Vault lifecycle.
   *
   * @param app - App owned by the current plugin lifecycle
   */
  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
  }

  /**
   * Get the tracker for one exact App and Vault ownership tuple.
   *
   * A changed App or Vault retires the previous tracker before a replacement
   * can publish progress into the shared load-state atom.
   *
   * @param app - App owned by the current plugin lifecycle
   * @returns Active tracker for this lifecycle
   */
  public static getInstance(app: App): ProjectLoadTracker {
    const current = ProjectLoadTracker.activeInstance;
    if (current && !current.isOwnedBy(app)) {
      current.dispose();
    }
    if (!ProjectLoadTracker.activeInstance) {
      ProjectLoadTracker.activeInstance = new ProjectLoadTracker(app);
    }
    return ProjectLoadTracker.activeInstance;
  }

  /**
   * Start a fresh tracker for a new plugin lifecycle.
   *
   * Unlike the reusable accessor, this always replaces an existing tracker,
   * including same-App hot reload overlap. The replacement becomes the active
   * owner before the old object is disposed, so a late old dispose cannot clear
   * the new lifecycle's state.
   *
   * @param app - App owned by the new plugin lifecycle
   * @returns Fresh tracker owned by the new lifecycle
   */
  public static startLifecycle(app: App): ProjectLoadTracker {
    const previous = ProjectLoadTracker.activeInstance;
    const replacement = new ProjectLoadTracker(app);
    ProjectLoadTracker.activeInstance = replacement;
    previous?.dispose();
    replacement.clearAllLoadStates();
    return replacement;
  }

  /**
   * Clear all project context loading states
   */
  public clearAllLoadStates(): void {
    const generation = this.captureGeneration();
    setProjectContextLoadState({
      success: [],
      failed: [],
      processingFiles: [],
      total: [],
    });
    this.assertActive(generation);
  }

  /**
   * Wrap an operation and track its execution status
   */
  public async executeWithProcessTracking<T>(
    key: string,
    type: FailedItem["type"],
    operation: () => Promise<T>
  ): Promise<T> {
    const generation = this.captureGeneration();
    this.setFileOrUrlStartProcess(key, generation);
    try {
      const result = await operation();
      this.assertActive(generation);
      this.setFileOrUrlProcessSuccessful(key, generation);
      return result;
    } catch (error) {
      this.assertActive(generation);
      const errorMessage = isRateLimitError(error)
        ? "Rate limit exceeded. (Rate limit: 50 files or 100MB per 3 hours, whichever is reached first)"
        : err2String(error);

      this.setFileOrUrlProcessFailed(key, type, errorMessage, generation);
      throw error; // throw error to outer layer
    }
  }

  /**
   * Mark a file or URL as processing started
   *
   * @param key - File path or URL being processed
   * @param generation - Lifecycle generation that started the operation
   */
  private setFileOrUrlStartProcess(key: string, generation: number): void {
    this.assertActive(generation);
    settingsStore.set(projectContextLoadAtom, (prev) => {
      const newState = { ...prev };

      // note: we remove the failed file from the failed list when it starts processing
      if (newState.failed.find((item) => item.path === key)) {
        newState.failed = newState.failed.filter((file) => file.path !== key);
      }

      // note: we remove the success file from the success list when it starts processing
      // For the case where the file cacheKey still exists, but the actual cached content is missing
      if (newState.success.includes(key)) {
        newState.success = newState.success.filter((file) => file !== key);
      }

      // Add to processing files list
      if (!newState.processingFiles.includes(key)) {
        newState.processingFiles = [...newState.processingFiles, key];
      }

      // Ensure file is in the total list
      if (!newState.total.includes(key)) {
        newState.total = [...newState.total, key];
      }

      return newState;
    });
    this.assertActive(generation);
  }

  /**
   * Mark a process as successful
   *
   * @param key - File path or URL that completed
   * @param generation - Lifecycle generation that started the operation
   */
  private setFileOrUrlProcessSuccessful(key: string, generation: number): void {
    this.assertActive(generation);
    updateProjectContextLoadState("processingFiles", (prev) => prev.filter((file) => file !== key));
    this.assertActive(generation);
    updateProjectContextLoadState("success", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });
    this.assertActive(generation);
  }

  /**
   * Mark a process as failed
   *
   * @param key - File path or URL that failed
   * @param type - Kind of source that failed
   * @param error - User-facing failure detail
   * @param generation - Lifecycle generation that started the operation
   */
  private setFileOrUrlProcessFailed(
    key: string,
    type: FailedItem["type"],
    error: string | undefined,
    generation: number
  ): void {
    this.assertActive(generation);
    updateProjectContextLoadState("processingFiles", (prev) => prev.filter((file) => file !== key));

    this.assertActive(generation);
    updateProjectContextLoadState("failed", (prev) => {
      const existingFailed = prev.find((item) => item.path === key);
      if (!existingFailed) {
        const failedItem: FailedItem = {
          path: key,
          type,
          error,
          timestamp: Date.now(),
        };
        return [...prev, failedItem];
      }
      return prev;
    });
    this.assertActive(generation);
  }

  /**
   * Pre-compute all items that need to be processed in the project
   *
   * @param project - Project whose sources will be processed
   * @param projectAllFiles - Vault files selected by the project
   */
  public preComputeAllItems(project: ProjectConfig, projectAllFiles: TFile[]): void {
    const generation = this.captureGeneration();
    logInfo(`[preComputeAllItems] Starting pre-computation for project: ${project.name}`);

    const allItems: string[] = [];

    // 1. Count all matching files (markdown and non-markdown)
    // Add all matching file paths to the list
    allItems.push(...projectAllFiles.map((file: TFile) => file.path));

    // 2. Count all Web URLs
    const configuredWebUrls = project.contextSource?.webUrls?.trim() || "";
    if (configuredWebUrls) {
      const webUrls = configuredWebUrls.split("\n").filter((url) => url.trim());
      allItems.push(...webUrls);
    }

    // 3. Count all YouTube URLs
    const configuredYoutubeUrls = project.contextSource?.youtubeUrls?.trim() || "";
    if (configuredYoutubeUrls) {
      const youtubeUrls = configuredYoutubeUrls.split("\n").filter((url) => url.trim());
      allItems.push(...youtubeUrls);
    }

    // Add all items to the total list
    if (allItems.length > 0) {
      const uniqueItems = [...new Set([...allItems])];
      this.assertActive(generation);
      updateProjectContextLoadState("total", (_) => uniqueItems);
      logInfo(
        `[preComputeAllItems] Project ${project.name}: Added ${allItems.length} items to tracking (${uniqueItems.length} total unique items)`
      );
    }
    this.assertActive(generation);
  }

  /**
   * Mark all cached items(besides Non-markdown files) as successful
   *
   * @param project - Project whose cache is being restored
   * @param contextCache - Cached project context
   * @param projectAllFiles - Vault files selected by the project
   */
  public markAllCachedItemsAsSuccess(
    project: ProjectConfig,
    contextCache: ContextCache,
    projectAllFiles: TFile[]
  ): void {
    const generation = this.captureGeneration();
    logInfo(`[markAllCachedItemsAsSuccess] Starting for project: ${project.name || "default"}`);

    // 1. Mark cached Web URLs
    const configuredWebUrls = project.contextSource?.webUrls?.trim() || "";
    if (configuredWebUrls) {
      const urlsInConfig = configuredWebUrls.split("\n").filter((url) => url.trim());
      const cachedUrls = urlsInConfig.filter((url) => contextCache.webContexts[url]);
      cachedUrls.forEach((url) => {
        this.markCachedItemAsSuccessForGeneration(url, generation);
      });
      if (cachedUrls.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${cachedUrls.length} cached Web URLs as successful`
        );
      }
    }
    this.assertActive(generation);

    // 2. Mark cached YouTube URLs
    const configuredYoutubeUrls = project.contextSource?.youtubeUrls?.trim() || "";
    if (configuredYoutubeUrls) {
      const urlsInConfig = configuredYoutubeUrls.split("\n").filter((url) => url.trim());
      const cachedUrls = urlsInConfig.filter((url) => contextCache.youtubeContexts[url]);
      cachedUrls.forEach((url) => {
        this.markCachedItemAsSuccessForGeneration(url, generation);
      });
      if (cachedUrls.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${cachedUrls.length} cached YouTube URLs as successful`
        );
      }
    }

    // 3. Only mark markdown files present in fileContexts as successful, does not include Non-markdown files.
    // because track Non-markdown in the processNonMarkdownFiles method
    if (contextCache.fileContexts) {
      // only for markdown files
      const matchingFilesSet = new Set(
        projectAllFiles.filter((file) => file.extension === "md").map((file: TFile) => file.path)
      );

      const cachedFilesToMark = Object.keys(contextCache.fileContexts).filter((filePath) =>
        matchingFilesSet.has(filePath)
      );

      cachedFilesToMark.forEach((filePath) => {
        this.markCachedItemAsSuccessForGeneration(filePath, generation);
      });

      if (cachedFilesToMark.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${
            cachedFilesToMark.length
          } cached files that match current project patterns as successful.`
        );
      }
    }
    this.assertActive(generation);
  }

  /**
   * Mark a cached item as successful
   *
   * @param key - File path or URL restored from cache
   */
  public markCachedItemAsSuccess(key: string): void {
    const generation = this.captureGeneration();
    this.markCachedItemAsSuccessForGeneration(key, generation);
  }

  /**
   * Mark a cached item as successful for one lifecycle generation.
   *
   * @param key - File path or URL restored from cache
   * @param generation - Lifecycle generation performing the update
   */
  private markCachedItemAsSuccessForGeneration(key: string, generation: number): void {
    this.assertActive(generation);
    updateProjectContextLoadState("total", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });
    this.assertActive(generation);

    // Mark as successful directly
    this.assertActive(generation);
    updateProjectContextLoadState("success", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });
    this.assertActive(generation);
  }

  /**
   * Mark an item as failed without executing a tracked operation.
   *
   * @param key - File path or URL that failed
   * @param type - Kind of source that failed
   * @param error - Optional user-facing failure detail
   */
  public makeItemFailed(key: string, type: FailedItem["type"], error?: string): void {
    const generation = this.captureGeneration();
    this.assertActive(generation);
    updateProjectContextLoadState("total", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });

    // Check if this item is already in the failed list
    this.assertActive(generation);
    updateProjectContextLoadState("failed", (prev) => {
      const existingFailed = prev.find((item) => item.path === key);
      if (!existingFailed) {
        const failedItem: FailedItem = {
          path: key,
          type,
          error,
          timestamp: Date.now(),
        };
        return [...prev, failedItem];
      }
      return prev;
    });
    this.assertActive(generation);
  }

  /**
   * Permanently end this tracker's App and Vault lifecycle.
   *
   * Disposal is synchronous and idempotent. Only the active owner clears the
   * shared state and static accessor, so a stale dispose cannot erase progress
   * published by its replacement.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    const ownsActiveInstance = ProjectLoadTracker.activeInstance === this;
    this.disposed = true;
    this.lifecycleGeneration++;

    if (ownsActiveInstance) {
      ProjectLoadTracker.activeInstance = undefined;
      setProjectContextLoadState({
        success: [],
        failed: [],
        processingFiles: [],
        total: [],
      });
    }
  }

  /**
   * Determine whether this tracker belongs to an exact App and Vault tuple.
   *
   * @param app - Candidate App
   * @returns Whether the candidate owns this tracker
   */
  private isOwnedBy(app: App): boolean {
    return this.app === app && this.vault === app.vault;
  }

  /**
   * Capture the current lifecycle generation after validating ownership.
   *
   * @returns Active lifecycle generation
   */
  private captureGeneration(): number {
    this.assertActive();
    return this.lifecycleGeneration;
  }

  /**
   * Reject work that no longer belongs to the active tracker lifecycle.
   *
   * @param generation - Optional generation captured before an asynchronous boundary
   */
  private assertActive(generation: number = this.lifecycleGeneration): void {
    if (
      this.disposed ||
      ProjectLoadTracker.activeInstance !== this ||
      generation !== this.lifecycleGeneration
    ) {
      throw new ProjectLoadTrackerDisposedError();
    }
  }
}
