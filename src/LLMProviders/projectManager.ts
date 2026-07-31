import {
  FailedItem,
  getChainType,
  getCurrentProject,
  isProjectMode,
  ProjectConfig,
  setCurrentProject,
  setProjectLoading,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
  subscribeToProjectChange,
} from "@/aiParams";
import { ContextCache, ProjectContextCache } from "@/cache/projectContextCache";
import { ChainType } from "@/chainType";
import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjects, subscribeToProjectRecords } from "@/projects/state";
import { ProjectFileRecord } from "@/projects/type";
import { getSettings } from "@/settings/model";
import { FileParserManager, saveConvertedDocOutput } from "@/tools/FileParserManager";
import { err2String } from "@/utils";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { App, Notice, TFile, Vault } from "obsidian";
import { BrevilabsClient } from "./brevilabsClient";
import ChainManager from "./chainManager";
import { ProjectLoadTracker } from "./projectLoadTracker";

/** Error thrown when code uses a ProjectManager after its plugin lifecycle ended. */
export class ProjectManagerDisposedError extends Error {
  /**
   * Create a lifecycle error for a disposed ProjectManager.
   */
  public constructor() {
    super("ProjectManager has been disposed");
    this.name = "ProjectManagerDisposedError";
  }
}

/** Error thrown when the active ProjectManager accessor is used before initialization. */
export class ProjectManagerNotInitializedError extends Error {
  /**
   * Create an error for a missing active ProjectManager.
   */
  public constructor() {
    super("ProjectManager has not been initialized");
    this.name = "ProjectManagerNotInitializedError";
  }
}

export default class ProjectManager {
  private static activeInstance?: ProjectManager;
  private currentProjectId: string | null;
  private readonly app: App;
  private readonly vault: Vault;
  private readonly plugin: CopilotPlugin;
  private readonly chainMangerInstance: ChainManager;
  private readonly projectContextCache: ProjectContextCache;
  private fileParserManager: FileParserManager;
  private readonly loadTracker: ProjectLoadTracker;
  private disposed = false;
  private lifecycleGeneration = 0;
  private switchRequestId = 0;
  private modelKeyUnsubscriber?: () => void;
  private chainTypeUnsubscriber?: () => void;
  private projectUnsubscriber?: () => void;
  private projectRecordsUnsubscriber?: () => void;

  private constructor(app: App, plugin: CopilotPlugin) {
    this.app = app;
    this.vault = app.vault;
    this.plugin = plugin;
    this.currentProjectId = null;
    this.chainMangerInstance = new ChainManager(app);
    this.projectContextCache = ProjectContextCache.getInstance(this.vault);
    this.fileParserManager = new FileParserManager(
      BrevilabsClient.getInstance(),
      this.vault,
      true,
      null
    );
    this.loadTracker = ProjectLoadTracker.startLifecycle(this.app);

    // Set up subscriptions
    this.modelKeyUnsubscriber = subscribeToModelKeyChange(() => {
      if (this.disposed) {
        return;
      }
      void this.getCurrentChainManager()
        .createChainWithNewModel()
        .catch((error) => {
          if (!this.disposed) {
            logError("[ProjectManager] Failed to apply model change", error);
          }
        });
    });

    this.chainTypeUnsubscriber = subscribeToChainTypeChange(() => {
      if (this.disposed) {
        return;
      }
      // When switching from other modes to project mode, no need to update the chain.
      if (isProjectMode()) {
        return;
      }
      const settings = getSettings();
      const shouldAutoIndex =
        settings.enableSemanticSearchV3 &&
        (settings.indexVaultToVectorStore as VAULT_VECTOR_STORE_STRATEGY) ===
          VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
        (getChainType() === ChainType.VAULT_QA_CHAIN ||
          getChainType() === ChainType.COPILOT_PLUS_CHAIN);
      void this.getCurrentChainManager()
        .createChainWithNewModel({
          refreshIndex: shouldAutoIndex,
        })
        .catch((error) => {
          if (!this.disposed) {
            logError("[ProjectManager] Failed to apply chain-type change", error);
          }
        });
    });

    // Subscribe to Project changes
    this.projectUnsubscriber = subscribeToProjectChange((project) => {
      if (this.disposed) {
        return;
      }
      void this.switchProject(project).catch((error) => {
        if (!(error instanceof ProjectManagerDisposedError)) {
          logError("[ProjectManager] Failed to switch project", error);
        }
      });
    });

    // Subscribe to project cache changes to monitor project modifications
    this.setupProjectListChangeMonitor();
  }

  private previousProjectRecords: ProjectFileRecord[] = [];

  private setupProjectListChangeMonitor() {
    this.previousProjectRecords = [];
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = subscribeToProjectRecords((nextRecords) => {
      if (this.disposed) {
        return;
      }
      const prevProjects = this.previousProjectRecords.map((r) => r.project);
      const nextProjects = nextRecords.map((r) => r.project);
      this.previousProjectRecords = nextRecords;

      // Reason: if the active project's id disappeared (e.g. manual frontmatter id edit),
      // clear selection so state doesn't point at a phantom project.
      // Reason: if the active project disappeared externally (file deleted/moved/invalidated),
      // use switchProject(null) which saves the current chat first, then clears the atom.
      // Calling setCurrentProject(null) directly would cause saveChat() to misclassify
      // the project chat as non-project because it reads the atom at save time.
      if (
        this.currentProjectId &&
        !nextProjects.some((p) => p.id === this.currentProjectId) &&
        getCurrentProject()?.id === this.currentProjectId
      ) {
        logWarn(
          `[ProjectManager] Active project id="${this.currentProjectId}" no longer exists, clearing selection`
        );
        void this.switchProject(null).catch((error) => {
          if (!(error instanceof ProjectManagerDisposedError)) {
            logError("[ProjectManager] Failed to switch away from removed project", error);
          }
        });
      }

      // Find modified projects
      for (const nextProject of nextProjects) {
        const prevProject = prevProjects.find((p) => p.id === nextProject.id);
        if (prevProject) {
          // Check if project configuration has changed (ignoring UsageTimestamps)
          if (this.hasMeaningfulProjectConfigChange(prevProject, nextProject)) {
            // Compare project configuration changes and selectively update cache
            void this.compareAndUpdateCache(prevProject, nextProject).catch((err) =>
              logError("[ProjectManager] compareAndUpdateCache failed", err)
            );

            // If this is the current project, reload its context and recreate chain
            // Reason: also check getCurrentProject()?.id to avoid overwriting the atom
            // during a switchProject() transition (where currentProjectId is still the old id
            // but the atom has already been updated to the new project).
            if (
              this.currentProjectId === nextProject.id &&
              getCurrentProject()?.id === nextProject.id
            ) {
              // Reason: keep aiParams.getCurrentProject() fresh so PromptManager/ChainManager
              // observe updated systemPrompt and modelConfigs when vault files change.
              setCurrentProject(nextProject);
              void Promise.all([
                this.loadProjectContext(nextProject, true),
                // Recreate chain to pick up new system prompt
                this.getCurrentChainManager().createChainWithNewModel(),
              ]).catch((error) => {
                logError(
                  `[Projects] Failed to refresh current project after config change id=${nextProject.id}`,
                  error
                );
              });
            }
          }
        }
      }
    });
  }

  /**
   * Determine whether a project configuration change should trigger cache reloads.
   * Ignores `UsageTimestamps` updates used for "recently used" sorting.
   */
  private hasMeaningfulProjectConfigChange(
    prevProject: ProjectConfig,
    nextProject: ProjectConfig
  ): boolean {
    const prevComparable = { ...prevProject, UsageTimestamps: 0 };
    const nextComparable = { ...nextProject, UsageTimestamps: 0 };
    return JSON.stringify(prevComparable) !== JSON.stringify(nextComparable);
  }

  /**
   * Return the ProjectManager owned by the active plugin lifecycle.
   *
   * @throws ProjectManagerNotInitializedError when the plugin has not initialized it
   */
  public static get instance(): ProjectManager {
    if (!ProjectManager.activeInstance) {
      throw new ProjectManagerNotInitializedError();
    }
    return ProjectManager.activeInstance;
  }

  /**
   * Synchronously retires the manager from an earlier plugin lifecycle.
   *
   * The plugin calls this before a new ProjectRegister establishes its state
   * owner. That ordering prevents state-reset notifications from starting work
   * through the old plugin while the new lifecycle is being constructed.
   */
  public static retireActive(): void {
    ProjectManager.activeInstance?.onunload();
  }

  /**
   * Get the manager for one exact plugin, App, and Vault ownership tuple.
   *
   * A changed plugin instance represents a hot reload. A changed App or Vault
   * represents a cross-vault lifecycle. Either change disposes the old manager
   * before constructing the replacement.
   *
   * @param app - App owned by the current plugin lifecycle
   * @param plugin - Current Copilot plugin instance
   * @returns Active ProjectManager for this lifecycle
   */
  public static getInstance(app: App, plugin: CopilotPlugin): ProjectManager {
    const current = ProjectManager.activeInstance;
    if (current && !current.isOwnedBy(app, plugin)) {
      ProjectManager.retireActive();
    }
    if (!ProjectManager.activeInstance) {
      ProjectManager.activeInstance = new ProjectManager(app, plugin);
    }
    return ProjectManager.activeInstance;
  }

  /**
   * Check whether this manager belongs to an exact plugin lifecycle.
   *
   * @param app - Candidate App
   * @param plugin - Candidate plugin
   * @returns Whether both lifecycle owners and the captured Vault match
   */
  private isOwnedBy(app: App, plugin: CopilotPlugin): boolean {
    return !this.disposed && this.app === app && this.vault === app.vault && this.plugin === plugin;
  }

  /**
   * Reject work attempted through a stale manager reference.
   *
   * @throws ProjectManagerDisposedError when this lifecycle has ended
   */
  private assertActive(expectedGeneration: number = this.lifecycleGeneration): void {
    if (this.disposed || expectedGeneration !== this.lifecycleGeneration) {
      throw new ProjectManagerDisposedError();
    }
  }

  /**
   * Capture the current lifecycle generation before asynchronous work.
   *
   * @returns Current generation
   * @throws ProjectManagerDisposedError when this manager is stale
   */
  private captureGeneration(): number {
    this.assertActive();
    return this.lifecycleGeneration;
  }

  /**
   * Check whether an asynchronous continuation still owns this lifecycle.
   *
   * @param expectedGeneration - Generation captured before an await
   * @returns Whether this manager remains active for that generation
   */
  private isActiveGeneration(expectedGeneration: number): boolean {
    return !this.disposed && expectedGeneration === this.lifecycleGeneration;
  }

  /**
   * Check whether one switch still owns both the manager lifecycle and latest-wins slot.
   *
   * @param expectedGeneration - Manager generation captured by the switch
   * @param requestId - Switch request identity
   * @returns Whether the request may publish another side effect
   */
  private isCurrentSwitch(expectedGeneration: number, requestId: number): boolean {
    return this.isActiveGeneration(expectedGeneration) && requestId === this.switchRequestId;
  }

  /**
   * Run one cleanup action without preventing the remaining lifecycle teardown.
   *
   * @param action - Synchronous teardown action
   * @param label - Safe component label for diagnostics
   */
  private runCleanupAction(action: (() => void) | undefined, label: string): void {
    if (!action) {
      return;
    }
    try {
      action();
    } catch (error) {
      logError(`[ProjectManager] Failed to clean up ${label}`, error);
    }
  }

  /**
   * Get the ChainManager owned by this plugin lifecycle.
   *
   * @returns Active ChainManager
   */
  public getCurrentChainManager(): ChainManager {
    this.assertActive();
    return this.chainMangerInstance;
  }

  /**
   * Get the active project identifier.
   *
   * @returns Active project identifier, or null outside project mode
   */
  public getCurrentProjectId(): string | null {
    this.assertActive();
    return this.currentProjectId;
  }

  /**
   * Touch the project's usage timestamp with throttled persistence.
   * Delegates to ProjectFileManager for vault file writes.
   */
  private touchProjectUsageTimestamps(project: ProjectConfig): void {
    const manager = ProjectFileManager.getInstance(this.app);
    void manager.touchProjectLastUsed(project.id);
  }

  /**
   * Get the project usage timestamps manager for use in sorting.
   * This allows UI components to use in-memory values for immediate feedback.
   */
  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    this.assertActive();
    return ProjectFileManager.getInstance(this.app).getProjectUsageTimestampsManager();
  }

  public async switchProject(project: ProjectConfig | null): Promise<void> {
    const generation = this.captureGeneration();
    // Reason: setCurrentProject(updatedConfig) fires this callback even for same-id updates
    // (e.g. when vault file content changes). Skip early to avoid loading-state churn.
    if (project && this.currentProjectId === project.id) {
      return;
    }
    if (!project && this.currentProjectId === null) {
      return;
    }
    const requestId = ++this.switchRequestId;

    try {
      // Clear all project context loading states
      this.loadTracker.clearAllLoadStates();
      setProjectLoading(true);
      logInfo("Project loading started...");

      // 1. save current project message. 2. load next project message

      // switch default project
      if (!project) {
        await this.saveCurrentProjectMessage();
        this.assertActive(generation);
        if (requestId !== this.switchRequestId) return;
        this.currentProjectId = null; // ensure set currentProjectId

        // Reason: update the atom AFTER saving so saveChat() uses the correct project context.
        // The guard at the top of switchProject prevents re-entry when this fires the subscriber.
        if (getCurrentProject() !== null) {
          setCurrentProject(null);
        }

        await this.loadNextProjectMessage();
        this.assertActive(generation);
        if (requestId !== this.switchRequestId) return;
        this.refreshChatView();
        return;
      }

      // else
      const projectId = project.id;

      await this.saveCurrentProjectMessage();
      this.assertActive(generation);
      if (requestId !== this.switchRequestId) return;
      this.currentProjectId = projectId; // ensure set currentProjectId

      // Use sequential operations to ensure loading state is maintained
      // through the entire process
      await this.loadNextProjectMessage();
      this.assertActive(generation);
      if (requestId !== this.switchRequestId) return;
      await this.getCurrentChainManager().createChainWithNewModel();
      this.assertActive(generation);
      if (requestId !== this.switchRequestId) return;
      // Update FileParserManager with the current project
      this.fileParserManager = new FileParserManager(
        BrevilabsClient.getInstance(),
        this.vault,
        true,
        project
      );
      await this.loadProjectContext(project);
      this.assertActive(generation);
      if (requestId !== this.switchRequestId) return;

      // fresh chat view
      this.refreshChatView();

      // Touch "recently used" timestamp only after a successful switch.
      this.touchProjectUsageTimestamps(project);

      logInfo(`Switched to project: ${project.name}`);
    } catch (error) {
      this.assertActive(generation);
      if (requestId !== this.switchRequestId) return;
      logError(`Failed to switch project: ${error}`);
      throw error;
    } finally {
      if (this.isCurrentSwitch(generation, requestId)) {
        setProjectLoading(false);
      }
    }
  }

  private async saveCurrentProjectMessage() {
    // The new ChatManager handles message persistence internally
    // during project switches, so we just need to trigger autosave
    await this.plugin.autosaveCurrentChat();
  }

  private async loadNextProjectMessage() {
    // Notify ChatUIState about the project switch
    // This will trigger ChatManager to switch to the correct message repository
    // and update the UI with the appropriate messages
    await this.plugin.chatUIState.handleProjectSwitch();
  }

  private async loadProjectContext(
    project: ProjectConfig,
    forUpdate: boolean = false
  ): Promise<ContextCache | null> {
    const generation = this.captureGeneration();
    // for update context condition
    if (forUpdate) {
      this.loadTracker.clearAllLoadStates();
      setProjectLoading(true);
    }

    try {
      if (!project.contextSource) {
        logWarn(`[loadProjectContext] Project ${project.name}: No contextSource. Aborting.`);
        return null;
      }
      logInfo(`[loadProjectContext] Starting for project: ${project.name}`);

      const contextCache = await this.projectContextCache.getOrInitializeCache(project);
      this.assertActive(generation);

      const projectAllFiles = this.getProjectAllFiles(project);

      // Pre-count all items that need to be processed
      this.loadTracker.preComputeAllItems(project, projectAllFiles);
      this.loadTracker.markAllCachedItemsAsSuccess(project, contextCache, projectAllFiles);

      const [updatedContextCacheAfterSources] = await Promise.all([
        this.processMarkdownFiles(project, contextCache, projectAllFiles),
        this.processWebUrls(project, contextCache),
        this.processYoutubeUrls(project, contextCache),
      ]);
      this.assertActive(generation);

      updatedContextCacheAfterSources.timestamp = Date.now();
      // Note: Since non-markdown files cannot pass cache parameters , so we need to save the context cache first
      await this.projectContextCache.setCacheSafely(project, updatedContextCacheAfterSources);
      this.assertActive(generation);

      // After other contexts are processed, ensure all referenced non-markdown files are parsed and cached
      await this.processNonMarkdownFiles(project, projectAllFiles, updatedContextCacheAfterSources);
      this.assertActive(generation);

      logInfo(`[loadProjectContext] Completed for project: ${project.name}.`);
      return updatedContextCacheAfterSources;
    } catch (error) {
      this.assertActive(generation);
      logError(`[loadProjectContext] Failed for project ${project.name}:`, error);
      throw error;
    } finally {
      if (forUpdate && this.isActiveGeneration(generation)) {
        setProjectLoading(false);
      }
    }
  }

  private async compareAndUpdateCache(prevProject: ProjectConfig, nextProject: ProjectConfig) {
    try {
      const cache = await this.projectContextCache.get(prevProject);

      // If no cache exists, return true to create a new cache later
      if (!cache) {
        return true;
      }

      // Check if Markdown configuration has changed
      const prevInclusions = prevProject.contextSource?.inclusions || "";
      const nextInclusions = nextProject.contextSource?.inclusions || "";
      const prevExclusions = prevProject.contextSource?.exclusions || "";
      const nextExclusions = nextProject.contextSource?.exclusions || "";

      if (prevInclusions !== nextInclusions || prevExclusions !== nextExclusions) {
        // Markdown config changed, invalidate markdown context
        await this.projectContextCache.invalidateMarkdownContext(nextProject);
        logInfo(
          `Markdown configuration changed for project ${nextProject.name}, marking for reload`
        );
      }

      // Check if Web URLs configuration has changed
      const prevWebUrls = prevProject.contextSource?.webUrls || "";
      const nextWebUrls = nextProject.contextSource?.webUrls || "";

      if (prevWebUrls !== nextWebUrls) {
        // Find removed URLs
        const prevUrls = prevWebUrls.split("\n").filter((url) => url.trim());
        const nextUrls = nextWebUrls.split("\n").filter((url) => url.trim());

        // Remove context for URLs that no longer exist
        await this.projectContextCache.removeWebUrls(
          nextProject,
          prevUrls.filter((url) => !nextUrls.includes(url))
        );
      }

      // Check if YouTube URLs configuration has changed
      const prevYoutubeUrls = prevProject.contextSource?.youtubeUrls || "";
      const nextYoutubeUrls = nextProject.contextSource?.youtubeUrls || "";

      if (prevYoutubeUrls !== nextYoutubeUrls) {
        // Find removed URLs
        const prevUrls = prevYoutubeUrls.split("\n").filter((url) => url.trim());
        const nextUrls = nextYoutubeUrls.split("\n").filter((url) => url.trim());

        // Remove context for URLs that no longer exist
        await this.projectContextCache.removeYoutubeUrls(
          nextProject,
          prevUrls.filter((url) => !nextUrls.includes(url))
        );
      }
    } catch (error) {
      logError(`Error comparing project configurations: ${error}`);
    }
  }

  private refreshChatView() {
    // get chat view
    const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
    if (chatView) {
      chatView.updateView();
    }
  }

  public async getProjectContext(projectId: string): Promise<string | null> {
    const generation = this.captureGeneration();
    const project = getCachedProjects().find((p) => p.id === projectId);
    if (!project) {
      logWarn(`[getProjectContext] Project not found for ID: ${projectId}`);
      return null;
    }
    logInfo(`[getProjectContext] Getting context for project: ${project.name} (ID: ${projectId})`);

    let contextCache = this.projectContextCache.getSync(project);

    if (!contextCache || contextCache.markdownNeedsReload) {
      if (!contextCache) {
        logInfo(
          `[getProjectContext] Project ${project.name}: Memory cache miss. Triggering full load.`
        );
      } else {
        logInfo(
          `[getProjectContext] Project ${project.name}: Markdown needs reload. Triggering full load.`
        );
      }

      const updatedCache = await this.loadProjectContext(project, true);
      this.assertActive(generation);
      if (!updatedCache) {
        logError(`[getProjectContext] Project ${project.name}: loadProjectContext returned null.`);
        return null;
      }
      contextCache = updatedCache;
    } else {
      logInfo(
        `[getProjectContext] Project ${project.name}: Memory cache hit and markdown OK. Using existing context.`
      );
    }

    const formattedContext = await this.formatProjectContextWithFiles(contextCache, project);
    this.assertActive(generation);
    return formattedContext;
  }

  private async formatProjectContextWithFiles(
    contextCache: ContextCache,
    project: ProjectConfig
  ): Promise<string> {
    const generation = this.captureGeneration();
    const contextParts = [];

    if (contextCache.markdownContext) {
      contextParts.push(`## Markdown Files\n${contextCache.markdownContext}`);
    }

    if (Object.keys(contextCache.webContexts).length > 0) {
      contextParts.push(`## Web Content\n${Object.values(contextCache.webContexts).join("\n\n")}`);
    }

    if (Object.keys(contextCache.youtubeContexts).length > 0) {
      contextParts.push(
        `## YouTube Content\n${Object.values(contextCache.youtubeContexts).join("\n\n")}`
      );
    }

    // Add file contexts section with content loaded from FileCache
    if (Object.keys(contextCache.fileContexts).length > 0) {
      const otherFileContextEntries = Object.entries(contextCache.fileContexts).filter(
        ([filePath]) => {
          const extension = filePath.split(".").pop()?.toLowerCase();
          return extension !== "md"; // Exclude markdown files from "Other Files" section
        }
      );

      if (otherFileContextEntries.length > 0) {
        const fileContextPromises = otherFileContextEntries.map(async ([filePath, fileContext]) => {
          const pathParts = filePath.split("/");
          const fileName = pathParts[pathParts.length - 1];
          const fileType = fileName.split(".").pop() || "";

          // Retrieve file content from FileCache
          const content =
            (await this.projectContextCache.getOrReuseFileContext(project, filePath)) ||
            "[Content not available]"; // This is expected for files not processed into FileCache

          return `[[${fileName}]]\npath: ${filePath}\ntype: ${fileType}\nmodified: ${new Date(fileContext.timestamp).toISOString()}\n\n${content}`;
        });

        const fileContextsStrings = await Promise.all(fileContextPromises);
        this.assertActive(generation);
        if (fileContextsStrings.length > 0) {
          contextParts.push(`## Other Files\n${fileContextsStrings.join("\n\n")}`);
        }
      }
    }

    return `
# Project Context
The following information is the relevant context for this project. Use this information to inform your responses when appropriate:

<ProjectContext>
${contextParts.join("\n\n")}
</ProjectContext>
`;
  }

  // Keep the original formatProjectContext as a fallback for non-async contexts
  private formatProjectContext(contextCache: ContextCache): string {
    const contextParts = [];

    if (contextCache.markdownContext) {
      contextParts.push(`## Markdown Files\n${contextCache.markdownContext}`);
    }

    if (Object.keys(contextCache.webContexts).length > 0) {
      contextParts.push(`## Web Content\n${Object.values(contextCache.webContexts).join("\n\n")}`);
    }

    if (Object.keys(contextCache.youtubeContexts).length > 0) {
      contextParts.push(
        `## YouTube Content\n${Object.values(contextCache.youtubeContexts).join("\n\n")}`
      );
    }

    // Add file contexts section - just include metadata without content
    if (Object.keys(contextCache.fileContexts).length > 0) {
      let fileContextsStr = "";

      for (const [filePath, fileContext] of Object.entries(contextCache.fileContexts)) {
        const pathParts = filePath.split("/");
        const fileName = pathParts[pathParts.length - 1];
        const fileType = fileName.split(".").pop() || "";

        fileContextsStr += `[[${fileName}]]
path: ${filePath}
type: ${fileType}
modified: ${new Date(fileContext.timestamp).toISOString()}\n\n`;
      }

      if (fileContextsStr) {
        contextParts.push(`## Other Files\n${fileContextsStr}`);
      }
    }

    return `
# Project Context
The following information is the relevant context for this project. Use this information to inform your responses when appropriate:

<ProjectContext>
${contextParts.join("\n\n")}
</ProjectContext>
`;
  }

  private async processMarkdownFiles(
    project: ProjectConfig,
    contextCache: ContextCache,
    projectAllFiles: TFile[]
  ): Promise<ContextCache> {
    logInfo(`[processMarkdownFiles] Starting for project: ${project.name}`);

    if (
      contextCache.markdownNeedsReload ||
      !contextCache.markdownContext ||
      !contextCache.markdownContext.trim()
    ) {
      logInfo(`[processMarkdownFiles] Project ${project.name}: Processing markdown content.`);
      const markdownContent = await this.processMarkdownFileContext(projectAllFiles);

      // add context reference to markdown file
      this.projectContextCache.updateProjectMarkdownFilesFromPatterns(
        project,
        contextCache,
        projectAllFiles
      );

      contextCache.markdownContext = markdownContent;
      contextCache.markdownNeedsReload = false;

      logInfo(`[processMarkdownFiles] Project ${project.name}: Markdown content updated.`);
    } else {
      logInfo(
        `[processMarkdownFiles] Project ${project.name}: Markdown content already up-to-date.`
      );
    }

    logInfo(
      `[processMarkdownFiles] Completed for project: ${project.name}. Total fileContexts: ${Object.keys(contextCache.fileContexts || {}).length}`
    );
    return contextCache;
  }

  private async processMarkdownFileContext(projectAllFiles: TFile[]): Promise<string> {
    // FileParserManager will be used to process these files when they're accessed,
    // either immediately or on-demand when the context is formatted

    // Get all markdown files that match the inclusion/exclusion patterns
    // Note: We're only processing markdown files here, other file types
    // are handled by FileParserManager and stored in the file cache
    const files = projectAllFiles.filter((file) => file.extension === "md");

    logInfo(`Found ${files.length} markdown files to process for project context`);

    // Process each markdown file with its metadata
    const processedNotes = await Promise.all(
      files.map(async (file: TFile) => {
        let content = "";
        let metadata = "";

        try {
          // Only process markdown files here
          const [stat, fileContent] = await this.loadTracker.executeWithProcessTracking(
            file.path,
            "md",
            async () => {
              return Promise.all([this.vault.adapter.stat(file.path), this.vault.read(file)]);
            }
          );

          metadata = `[[${file.basename}]]
path: ${file.path}
type: ${file.extension}
created: ${stat ? new Date(stat.ctime).toISOString() : "unknown"}
modified: ${stat ? new Date(stat.mtime).toISOString() : "unknown"}`;

          content = fileContent;
          logInfo(`Completed processing markdown file: ${file.path}`);
        } catch (error) {
          logError(`Error processing file ${file.path}: ${error}`);
          content = `[Error: ${err2String(error)}]`;
        }

        return `${metadata}\n\n${content}`;
      })
    );

    logInfo("All markdown files processed for project context");

    // Join all processed notes with double newlines
    return processedNotes.join("\n\n");
  }

  private async processWebUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    logInfo(`[processWebUrls] Starting for project: ${project.name}`);
    const configuredUrlsString = project.contextSource?.webUrls?.trim() || "";

    if (!configuredUrlsString) {
      if (Object.keys(contextCache.webContexts).length > 0) {
        logInfo(
          `[processWebUrls] Project ${project.name}: Clearing all Web contexts as none are configured.`
        );
        contextCache.webContexts = {};
      }
      // No need to log if no URLs are configured and cache is already empty.
      return contextCache;
    }

    const urlsInConfig = configuredUrlsString.split("\n").filter((url) => url.trim());
    logInfo(
      `[processWebUrls] Project ${project.name}: Found ${urlsInConfig.length} URLs in config.`
    );
    const currentCachedUrls = Object.keys(contextCache.webContexts);

    const urlsToFetch = urlsInConfig.filter((url) => !contextCache.webContexts[url]);
    if (urlsToFetch.length > 0) {
      logInfo(
        `[processWebUrls] Project ${project.name}: Fetching content for ${urlsToFetch.length} new/updated Web URLs.`
      );
    }

    const urlsToRemove = currentCachedUrls.filter((url) => !urlsInConfig.includes(url));
    if (urlsToRemove.length > 0) {
      logInfo(
        `[processWebUrls] Project ${project.name}: Removing ${urlsToRemove.length} obsolete Web URL contexts.`
      );
      for (const url of urlsToRemove) {
        delete contextCache.webContexts[url];
      }
    }

    const webContextPromises = urlsToFetch.map(async (url) => {
      // processWebUrlContext itself should log errors if a specific URL fetch fails.
      const webContext = await this.processWebUrlContext(url);
      if (webContext) {
        logInfo(
          `[processWebUrls] Project ${project.name}: Successfully fetched content for URL: ${url.substring(0, 50)}...`
        );
      }
      return { url, context: webContext };
    });

    const results = await Promise.all(webContextPromises);
    results.forEach((result) => {
      if (result && result.context) {
        contextCache.webContexts[result.url] = result.context;
      } else if (result && !result.context) {
        logWarn(
          `[processWebUrls] Project ${project.name}: Fetched empty content for Web URL: ${result.url}`
        );
      }
    });
    logInfo(
      `[processWebUrls] Completed for project: ${project.name}. Total Web contexts: ${Object.keys(contextCache.webContexts).length}`
    );
    return contextCache;
  }

  private async processYoutubeUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    logInfo(`[processYoutubeUrls] Starting for project: ${project.name}`);
    const configuredUrlsString = project.contextSource?.youtubeUrls?.trim() || "";

    if (!configuredUrlsString) {
      if (Object.keys(contextCache.youtubeContexts).length > 0) {
        logInfo(
          `[processYoutubeUrls] Project ${project.name}: Clearing all YouTube contexts as none are configured.`
        );
        contextCache.youtubeContexts = {};
      }
      return contextCache;
    }

    const urlsInConfig = configuredUrlsString.split("\n").filter((url) => url.trim());
    logInfo(
      `[processYoutubeUrls] Project ${project.name}: Found ${urlsInConfig.length} YouTube URLs in config.`
    );
    const currentCachedUrls = Object.keys(contextCache.youtubeContexts);

    const urlsToFetch = urlsInConfig.filter((url) => !contextCache.youtubeContexts[url]);
    if (urlsToFetch.length > 0) {
      logInfo(
        `[processYoutubeUrls] Project ${project.name}: Fetching transcripts for ${urlsToFetch.length} new/updated YouTube URLs.`
      );
    }

    const urlsToRemove = currentCachedUrls.filter((url) => !urlsInConfig.includes(url));
    if (urlsToRemove.length > 0) {
      logInfo(
        `[processYoutubeUrls] Project ${project.name}: Removing ${urlsToRemove.length} obsolete YouTube URL contexts.`
      );
      for (const url of urlsToRemove) {
        delete contextCache.youtubeContexts[url];
      }
    }

    const youtubeContextPromises = urlsToFetch.map(async (url) => {
      const youtubeContext = await this.processYoutubeUrlContext(url);
      if (youtubeContext) {
        logInfo(
          `[processYoutubeUrls] Project ${project.name}: Successfully fetched transcript for YouTube URL: ${url.substring(0, 50)}...`
        );
      }
      return { url, context: youtubeContext };
    });

    const results = await Promise.all(youtubeContextPromises);
    results.forEach((result) => {
      if (result && result.context) {
        contextCache.youtubeContexts[result.url] = result.context;
      } else if (result && !result.context) {
        logWarn(
          `[processYoutubeUrls] Project ${project.name}: Fetched empty transcript for YouTube URL: ${result.url}`
        );
      }
    });
    logInfo(
      `[processYoutubeUrls] Completed for project: ${project.name}. Total YouTube contexts: ${Object.keys(contextCache.youtubeContexts).length}`
    );
    return contextCache;
  }

  private async processWebUrlContext(webUrl?: string): Promise<string> {
    if (!webUrl?.trim()) {
      return "";
    }

    try {
      const mention = Mention.getInstance();
      const { urlContext } = await this.loadTracker.executeWithProcessTracking(
        webUrl,
        "web",
        async () => {
          const result = await mention.processUrls(webUrl);

          if (result.processedErrorUrls[webUrl]) {
            throw new Error(result.processedErrorUrls[webUrl]);
          }
          return result;
        }
      );
      return urlContext || "";
    } catch (error) {
      logError(`Failed to process web URL: ${error}`);
      return "";
    }
  }

  private async processYoutubeUrlContext(youtubeUrl?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      return "";
    }

    try {
      const response = await this.loadTracker.executeWithProcessTracking(
        youtubeUrl,
        "youtube",
        async () => {
          return BrevilabsClient.getInstance().youtube4llm(youtubeUrl);
        }
      );
      if (response.response.transcript) {
        return `\n\nYouTube transcript from ${youtubeUrl}:\n${response.response.transcript}`;
      }
      return "";
    } catch (error) {
      logError(`Failed to process YouTube URL ${youtubeUrl}: ${error}`);
      new Notice(`Failed to process YouTube URL ${youtubeUrl}: ${err2String(error)}`);
      return "";
    }
  }

  private async processNonMarkdownFiles(
    project: ProjectConfig,
    projectAllFiles: TFile[],
    contextCache: ContextCache
  ): Promise<void> {
    const nonMarkdownFiles = projectAllFiles.filter((file) => file.extension !== "md");

    logInfo(
      `[loadProjectContext] Project ${project.name}: Checking for non-markdown processing: ${nonMarkdownFiles.length} files .`
    );

    if (nonMarkdownFiles.length <= 0) {
      return;
    }

    this.fileParserManager = new FileParserManager(
      BrevilabsClient.getInstance(),
      this.vault,
      true,
      project
    );

    // Reason: reorder so files with existing cache references are processed first.
    // This is a heuristic — fileContexts[path] is a cacheKey reference, not a guarantee
    // that content exists — but in practice, referenced files almost always have valid
    // cached content, so they complete near-instantly via getOrReuseFileContext().
    // This prevents slow/failing uncached items from blocking already-cached ones.
    const likelyCachedFiles: TFile[] = [];
    const remainingFiles: TFile[] = [];
    for (const file of nonMarkdownFiles) {
      if (contextCache.fileContexts[file.path]?.cacheKey) {
        likelyCachedFiles.push(file);
      } else {
        remainingFiles.push(file);
      }
    }
    const orderedFiles = [...likelyCachedFiles, ...remainingFiles];

    let processedNonMdCount = 0;

    // TODO: Add batch progress feedback (e.g. Notice or status bar update) so users
    // know how many files remain. Consider bounded concurrency (e.g. p-limit) instead
    // of sequential processing for faster throughput on large vaults.
    for (const file of orderedFiles) {
      const filePath = file.path;
      if (this.fileParserManager.supportsExtension(file.extension)) {
        try {
          await this.loadTracker.executeWithProcessTracking(filePath, "nonMd", async () => {
            const existingContent = await this.projectContextCache.getOrReuseFileContext(
              project,
              filePath
            );
            if (existingContent) {
              // Export cached content when the output folder is enabled
              await saveConvertedDocOutput(file, existingContent, this.vault);
              processedNonMdCount++;
            } else {
              logInfo(
                `[loadProjectContext] Project ${project.name}: Parsing/caching new/updated file: ${filePath}`
              );

              await this.fileParserManager.parseFile(file, this.vault);
              processedNonMdCount++;
            }
          });
        } catch (error) {
          logError(
            `[loadProjectContext] Project ${project.name}: Error parsing file ${filePath}:`,
            error
          );

          // Check if this is a rate limit error and re-throw it to fail the entire operation
          if (isRateLimitError(error)) {
            throw error; // Re-throw to fail the entire operation
          }
        }
      }
    }

    if (processedNonMdCount > 0) {
      logInfo(
        `[loadProjectContext] Project ${project.name}: Processed and cached ${processedNonMdCount} non-markdown files.`
      );
    }
  }

  /**
   * Retry failed item
   * @param failedItem Failed item information
   */
  public async retryFailedItem(failedItem: FailedItem): Promise<void> {
    const generation = this.captureGeneration();
    try {
      if (!this.currentProjectId) {
        logWarn("[retryFailedItem] No current project, aborting retry");
        return;
      }

      const project = getCachedProjects().find((p) => p.id === this.currentProjectId);
      if (!project) {
        logError(`[retryFailedItem] Current project not found: ${this.currentProjectId}`);
        return;
      }

      logInfo(`[retryFailedItem] Starting retry for ${failedItem.type} item: ${failedItem.path}`);

      // Handle different retry types
      switch (failedItem.type) {
        case "web":
          await this.retryWebUrl(project, failedItem.path);
          break;
        case "youtube":
          await this.retryYoutubeUrl(project, failedItem.path);
          break;
        case "md":
          await this.retryMarkdownFile(project, failedItem.path);
          break;
        case "nonMd":
          await this.retryNonMarkdownFile(project, failedItem.path);
          break;
        default:
          logWarn("[retryFailedItem] Unknown item type:", failedItem.type);
          return;
      }

      this.assertActive(generation);
      logInfo(`[retryFailedItem] Successfully retried ${failedItem.type} item: ${failedItem.path}`);
      new Notice(`Retry successful: ${failedItem.path}`);
    } catch (error) {
      this.assertActive(generation);
      logError(
        `[retryFailedItem] Failed to retry ${failedItem.type} item ${failedItem.path}:`,
        error
      );
      new Notice(`Retry failed: ${err2String(error)}`);
    }
  }

  private async retryWebUrl(project: ProjectConfig, url: string): Promise<void> {
    const webContext = await this.processWebUrlContext(url);
    if (!webContext) {
      logWarn(`[retryWebUrl] Project ${project.name}: Fetched empty content for Web URL: ${url}`);
      return;
    }

    logInfo(
      `[retryWebUrl] Project ${project.name}: Successfully fetched content for URL: ${url.substring(0, 50)}...`
    );
    await this.projectContextCache.updateWebUrl(project, url, webContext);
  }

  private async retryYoutubeUrl(project: ProjectConfig, url: string): Promise<void> {
    const youtubeContext = await this.processYoutubeUrlContext(url);
    if (!youtubeContext) {
      logWarn(
        `[retryYoutubeUrl] Project ${project.name}: Fetched empty transcript for YouTube URL: ${url}`
      );
      return;
    }

    logInfo(
      `[retryYoutubeUrl] Project ${project.name}: Successfully fetched transcript for YouTube URL: ${url.substring(0, 50)}...`
    );
    await this.projectContextCache.updateYoutubeUrl(project, url, youtubeContext);
  }

  private async retryMarkdownFile(project: ProjectConfig, filePath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`File not found or not a markdown file: ${filePath}`);
    }

    try {
      // add flag to track reprocessing of Markdown
      await this.loadTracker.executeWithProcessTracking(file.path, "md", async () => {});

      logInfo(`[retryMarkdownFile] Successfully reprocessed markdown file: ${filePath}`);

      // flag the markdown context as needing a reload
      await this.projectContextCache.invalidateMarkdownContext(project);
    } catch (error) {
      logError(`[retryMarkdownFile] Error processing file ${filePath}: ${error}`);
      throw error;
    }
  }

  private async retryNonMarkdownFile(project: ProjectConfig, filePath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension === "md") {
      throw new Error(`File not found or is a markdown file: ${filePath}`);
    }

    if (!this.fileParserManager.supportsExtension(file.extension)) {
      throw new Error(`Unsupported file extension: ${file.extension}`);
    }

    try {
      await this.loadTracker.executeWithProcessTracking(filePath, "nonMd", async () => {
        return this.fileParserManager.parseFile(file, this.vault);
      });

      logInfo(`[retryNonMarkdownFile] Successfully reprocessed non-markdown file: ${filePath}`);
    } catch (error) {
      logError(`[retryNonMarkdownFile] Error processing file ${filePath}: ${error}`);
      throw error;
    }
  }

  private getProjectAllFiles(project: ProjectConfig) {
    // NOTE: Must not fallback to GLOBAL inclusions and exclusions in Copilot settings in Projects!
    // This is to avoid project inclusions in the project that conflict with the global ones
    // Project UI should be the ONLY source of truth for project inclusions and exclusions
    const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = getMatchingPatterns({
      inclusions: project.contextSource.inclusions,
      exclusions: project.contextSource.exclusions,
      isProject: true,
    });

    return this.vault.getFiles().filter((file: TFile) => {
      return shouldIndexFile(file, inclusionPatterns, exclusionPatterns, true);
    });
  }

  /**
   * Permanently end this manager's plugin lifecycle.
   *
   * The operation is synchronous and idempotent. It removes every subscription,
   * releases the Vault-owned context cache, and clears the static accessor only
   * when this object is still the active owner.
   */
  public onunload(): void {
    if (this.disposed) {
      return;
    }
    const ownsActiveInstance = ProjectManager.activeInstance === this;
    this.disposed = true;
    this.lifecycleGeneration++;
    this.switchRequestId++;

    const modelKeyUnsubscriber = this.modelKeyUnsubscriber;
    this.modelKeyUnsubscriber = undefined;
    const chainTypeUnsubscriber = this.chainTypeUnsubscriber;
    this.chainTypeUnsubscriber = undefined;
    const projectUnsubscriber = this.projectUnsubscriber;
    this.projectUnsubscriber = undefined;
    const projectRecordsUnsubscriber = this.projectRecordsUnsubscriber;
    this.projectRecordsUnsubscriber = undefined;

    this.runCleanupAction(modelKeyUnsubscriber, "model-key subscription");
    this.runCleanupAction(chainTypeUnsubscriber, "chain-type subscription");
    this.runCleanupAction(projectUnsubscriber, "project subscription");
    this.runCleanupAction(projectRecordsUnsubscriber, "project-records subscription");
    this.runCleanupAction(() => this.loadTracker.dispose(), "project load tracker");
    this.runCleanupAction(() => this.chainMangerInstance.dispose(), "chain manager");
    this.runCleanupAction(() => this.projectContextCache.dispose(), "project context cache");

    if (ownsActiveInstance) {
      this.currentProjectId = null;
      if (getCurrentProject() !== null) {
        this.runCleanupAction(() => setCurrentProject(null), "active project selection");
      }
      this.runCleanupAction(() => setProjectLoading(false), "project loading state");
      ProjectManager.activeInstance = undefined;
    }
  }
}
