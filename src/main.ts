import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ProjectManager from "@/LLMProviders/projectManager";
import {
  CustomModel,
  getCurrentProject,
  setSelectedTextContexts,
  getSelectedTextContexts,
} from "@/aiParams";
import { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import { APPLY_VIEW_TYPE, ApplyView } from "@/components/composer/ApplyView";
import { KNOWLEDGE_STUDIO_VIEW_TYPE, KnowledgeStudioView } from "@/components/KnowledgeStudioView";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";

import { registerContextMenu } from "@/commands/contextMenu";
import { registerKnowledgeSourceMenu } from "@/commands/knowledgeSourceMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { migrateCommands, suggestDefaultCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import { ProjectRegister } from "@/projects/projectRegister";
import { ABORT_REASON, CHAT_VIEWTYPE, DEFAULT_OPEN_AREA, EVENT_NAMES } from "@/constants";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { DelegatingKnowledgeChatCapturePort } from "@/knowledge/capture/DelegatingKnowledgeChatCapturePort";
import { DelegatingKnowledgeFolderImportPort } from "@/knowledge/capture/DelegatingKnowledgeFolderImportPort";
import type { KnowledgeChatCapturePort } from "@/knowledge/capture/KnowledgeChatCapturePort";
import { KnowledgeChatCaptureGenerationLease } from "@/knowledge/capture/KnowledgeChatCaptureGenerationLease";
import { KnowledgeFolderImportGenerationLease } from "@/knowledge/capture/KnowledgeFolderImportGenerationLease";
import { ObsidianKnowledgeFolderImportFileStore } from "@/knowledge/capture/ObsidianKnowledgeFolderImportFileStore";
import {
  KnowledgeProductionChatCaptureCoordinator,
  ObsidianKnowledgeVaultSourcePresence,
} from "@/knowledge/capture/KnowledgeProductionChatCaptureCoordinator";
import { KnowledgeProductionFolderImportCoordinator } from "@/knowledge/capture/KnowledgeProductionFolderImportCoordinator";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import {
  KnowledgeSourcePathIndex,
  type KnowledgeSourcePathIndexLease,
} from "@/knowledge/sourceLifecycle/KnowledgeSourcePathIndex";
import { createKnowledgeSourceIssueNotificationSink } from "@/knowledge/sourceLifecycle/KnowledgeSourceIssueNotificationSink";
import { KnowledgeProductionSourceLifecycleCoordinator } from "@/knowledge/sourceLifecycle/KnowledgeProductionSourceLifecycleCoordinator";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KnowledgePluginLayoutCoordinator } from "@/knowledge/startup/KnowledgePluginLayoutCoordinator";
import {
  KnowledgePluginProductionPreflightLifecycle,
  type KnowledgePluginProductionPreflightAdmission,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import {
  awaitKnowledgeProductionDrain,
  retainKnowledgeProductionDrain,
} from "@/knowledge/startup/KnowledgeProductionDrainRegistry";
import { KnowledgeProductionRecoveryComposer } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";
import { KnowledgeProductionRecoveryActionCoordinator } from "@/knowledge/startup/KnowledgeProductionRecoveryActionCoordinator";
import { KnowledgeProductionObservationComposer } from "@/knowledge/startup/KnowledgeProductionObservationComposer";
import { createSourceObservationPreReleaseResult } from "@/knowledge/startup/KnowledgeSourceObservationPreRelease";
import type { KnowledgeProductionWorkerScheduler } from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgePluginProductionRecoveryPort } from "@/knowledge/startup/KnowledgePluginProductionRecoveryPort";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import {
  KnowledgeRuntimeManifestStorage,
  type KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { initializeKnowledgeRuntimeForCurrentGeneration } from "@/knowledge/startup/KnowledgeRuntimeFoundationInitializer";
import {
  KnowledgePluginStartupBarrier,
  type KnowledgePluginBundleConfigLoadResult,
  type KnowledgePluginObservationStartupPort,
  type KnowledgePluginRecoveryStartupPort,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { KnowledgeStudioStartupAvailabilityAdapter } from "@/knowledge/startup/KnowledgeStudioStartupAvailabilityAdapter";
import {
  hasExactKnowledgeBundleSequence,
  KnowledgeStudioReadGenerationLease,
} from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { KnowledgeStudioRecoveryOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioRecoveryOnlyAdapter";
import { KnowledgeStudioSourceLifecycleOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioSourceLifecycleOnlyAdapter";
import { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { KeychainService } from "@/services/keychainService";
import {
  persistSettings,
  loadSettingsWithKeychain,
  flushPersistence,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import { isKnowledgeStudioPlatformSupported } from "@/knowledge/ui/platform";
import { getCachedProjectRecords, subscribeToProjectRecords } from "@/projects/state";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { checkIsPlusUser, refreshSelfHostModeValidation } from "@/plusUtils";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";
import VectorStoreManager from "@/search/vectorStoreManager";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getModelKeyFromModel,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import { ChatUIState } from "@/state/ChatUIState";
import { VaultDataManager } from "@/state/vaultDataAtoms";
import { FileParserManager } from "@/tools/FileParserManager";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
  QuickAskController,
  SelectionHighlight,
} from "@/editor";
import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  extractChatDate,
  extractChatLastAccessedAtMs,
  extractChatTitle,
  filterChatHistoryFiles,
} from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  listMarkdownFiles,
  patchFrontmatter,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { v4 as uuidv4 } from "uuid";

// Removed unused FileTrackingState interface

/** Throws before an obsolete or unloaded knowledge startup generation can continue. */
function throwIfKnowledgeStartupStopped(signal: AbortSignal, lifecycleClosed: boolean): void {
  if (signal.aborted || lifecycleClosed) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

/** Captures one renderer window's native fetch capability with a stable receiver. */
function captureKnowledgeRendererFetchPort(): KnowledgeDeepSeekFetchPort | undefined {
  const rendererWindow: Window = activeWindow;
  const rendererFetchValue: unknown = Reflect.get(rendererWindow, "fetch");
  if (typeof rendererFetchValue !== "function") {
    return undefined;
  }
  const rendererFetch = rendererFetchValue as (
    this: Window,
    url: string,
    init: RequestInit
  ) => Promise<Response>;
  return async (url, init): Promise<Response> => {
    const pendingResponse: unknown = Reflect.apply(rendererFetch, rendererWindow, [url, init]);
    return (await pendingResponse) as Response;
  };
}

/** Captures one exact renderer timer realm for a plugin-owned worker generation. */
function createKnowledgeWorkerScheduler(win: Window): KnowledgeProductionWorkerScheduler {
  return Object.freeze({
    now: () => Date.now(),
    schedule: (callback: () => void, delayMs: number) => win.setTimeout(callback, delayMs),
    cancel: (handle: unknown) => {
      if (typeof handle === "number") {
        win.clearTimeout(handle);
      }
    },
  });
}

export default class CopilotPlugin extends Plugin {
  // Plugin components
  projectManager: ProjectManager;
  brevilabsClient: BrevilabsClient;
  userMessageHistory: string[] = [];
  vectorStoreManager: VectorStoreManager;
  fileParserManager: FileParserManager;
  customCommandRegister: CustomCommandRegister;
  systemPromptRegister: SystemPromptRegister;
  projectRegister: ProjectRegister;
  settingsUnsubscriber?: () => void;
  chatUIState: ChatUIState;
  userMemoryManager: UserMemoryManager;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private selectionDebounceTimer?: number;
  private selectionChangeHandler?: () => void;
  private selectionListenerDocument?: Document;
  private lastSelectionSignature?: string;
  private webSelectionTracker?: WebSelectionTracker;
  private vaultDataManager?: VaultDataManager;
  private knowledgeRuntime?: KnowledgeRuntimeStore;
  private knowledgeProductionRecovery?: KnowledgeProductionRecoveryComposer;
  private knowledgeProductionObservation?: KnowledgePluginObservationStartupPort;
  private knowledgeProductionRelease?: KnowledgeProductionRecoveryComposer;
  private knowledgeProjectRecordsUnsubscriber?: () => void;
  private readonly knowledgeRendererFetchPort = captureKnowledgeRendererFetchPort();
  private readonly knowledgeProductionPreflightLifecycle =
    new KnowledgePluginProductionPreflightLifecycle({
      getProjectRecords: () => getCachedProjectRecords(),
      getSettings: () => getSettings(),
      fetchPort: this.knowledgeRendererFetchPort,
      createResources: () => createKnowledgeProductionPipelineResources(),
    });
  private readonly knowledgeStudioPort = new DelegatingKnowledgeStudioPort();
  private readonly knowledgeChatCapturePort = new DelegatingKnowledgeChatCapturePort();
  private readonly knowledgeFolderImportPort = new DelegatingKnowledgeFolderImportPort();
  private readonly knowledgeSourcePathIndex = new KnowledgeSourcePathIndex();
  private readonly knowledgeSourceIssueNotificationSink =
    createKnowledgeSourceIssueNotificationSink((message) => {
      if (this.knowledgeLifecycleClosed) return;
      new Notice(message);
    });
  private readonly knowledgeStudioSessionStore = new KnowledgeStudioSessionStore();
  private readonly knowledgeStudioStartupAvailability =
    new KnowledgeStudioStartupAvailabilityAdapter(
      this.knowledgeStudioPort,
      this.knowledgeStudioSessionStore
    );
  private knowledgeLifecycleClosed = false;
  private knowledgeRuntimeStartupGeneration = 0;
  private projectsInitialization?: Promise<void>;
  private readonly knowledgeLayoutCoordinator = new KnowledgePluginLayoutCoordinator({
    ensureInitialized: () => this.ensureProjectsInitializedAfterLayout(),
  });
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();

  /** Returns the stable least-authority Add-to-Knowledge command surface for Chat views. */
  getKnowledgeChatCapturePort(): KnowledgeChatCapturePort {
    return this.knowledgeChatCapturePort;
  }

  async onload(): Promise<void> {
    this.knowledgeLifecycleClosed = false;
    // Reason: clear stale module-level persistence state + KeychainService
    // singleton left over from a previous plugin lifecycle in the same
    // process (disable→enable, dev hot reload, "Open another vault" without
    // restart). Doing this at the START of onload (instead of at the end of
    // onunload) avoids a race: onunload is fire-and-forget from Obsidian's
    // perspective, so its `await flushPersistence()` continuation can fire
    // AFTER the next onload has already initialized — and would then null
    // out the new instance, breaking saves until another full reload.
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      this.invalidateKnowledgeProductionGeneration();
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          // Reason: Do NOT rollback memory state on persist failure.
          // The writeQueue serializes I/O, so a later setSettings() may already
          // be queued. Rolling back memory would create a split where memory is S0
          // but disk ends up at S2 when the later write succeeds.
          // Instead, just notify the user — the in-memory state remains current,
          // and the next successful persist will reconcile disk with memory.
          logError("Failed to persist settings.", error);
          new Notice("Copilot failed to save settings. Check logs and try again.");
        }
        registerCommands(this, prev, next);
      })();
    });
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    // Core plugin initialization

    // Initialize built-in tools with vault access
    initializeBuiltinTools(this.app.vault);

    // Initialize BrevilabsClient
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    void checkIsPlusUser();
    void refreshSelfHostModeValidation();

    // Retire the previous plugin's subscriber before replacing project state.
    // Otherwise owner reset notifications can start a stale autosave through
    // the old plugin during an overlapping hot reload.
    ProjectManager.retireActive();

    // Start the project-file lifecycle before the new ProjectManager subscribes
    // so stale scans cannot publish into the new plugin lifecycle.
    this.projectRegister = new ProjectRegister(this.app);
    this.knowledgeProjectRecordsUnsubscriber = subscribeToProjectRecords(() => {
      this.invalidateKnowledgeProductionGeneration();
    });

    // Initialize ProjectManager after the new project state owner is active.
    this.projectManager = ProjectManager.getInstance(this.app, this);

    // Always construct VectorStoreManager; it internally no-ops when semantic search is disabled
    this.vectorStoreManager = VectorStoreManager.getInstance();

    // Initialize VaultDataManager for centralized vault data (notes, folders, tags)
    // Note: VaultDataManager tracks ALL data; hooks filter based on parameters
    this.vaultDataManager = VaultDataManager.startLifecycle(this.app);
    this.vaultDataManager.initialize();

    // Initialize FileParserManager early with other core services
    this.fileParserManager = new FileParserManager(this.brevilabsClient, this.app.vault);

    // Initialize ChatUIState with new architecture
    const messageRepo = new MessageRepository();
    const chainManager = this.projectManager.getCurrentChainManager();
    const chatManager = new ChatManager(messageRepo, chainManager, this.fileParserManager, this);
    this.chatUIState = new ChatUIState(chatManager);

    // Initialize UserMemoryManager
    this.userMemoryManager = new UserMemoryManager(this.app);

    // Initialize QuickAskController and register CM6 extension
    this.quickAskController = new QuickAskController(this);
    this.registerEditorExtension(this.quickAskController.createExtension());

    // Initialize Chat selection highlight controller
    this.chatSelectionHighlightController = new ChatSelectionHighlightController(this, {
      closeQuickAskOnChatFocus: false,
    });
    this.chatSelectionHighlightController.initialize();

    // Single source of truth for Active Web Tab ({activeWebTab}) state
    // Preserves activeWebTab when switching to Chat view
    // Only run on desktop - Web Viewer is not available on mobile
    if (Platform.isDesktopApp) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));
    this.registerView(APPLY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ApplyView(leaf));

    this.customCommandRegister = new CustomCommandRegister(this, this.app.vault);
    this.systemPromptRegister = new SystemPromptRegister(this, this.app.vault);

    this.app.workspace.onLayoutReady(() => {
      if (this.knowledgeLifecycleClosed) {
        return;
      }
      // Reason: projects must initialize after vault file tree is indexed (onLayoutReady),
      // not in onload(). Otherwise getAbstractFileByPath() returns null for non-hidden
      // folders and the adapter fallback creates synthetic TFiles that crash vault.read().
      // The coordinator keeps this ordinary feature independent from Knowledge Runtime I/O.
      this.knowledgeLayoutCoordinator.onLayoutReady();

      // Initialize custom commands
      void this.customCommandRegister
        .initialize()
        .then(migrateCommands)
        .then(suggestDefaultCommands);

      // Initialize system prompts (independent from custom commands)
      void this.systemPromptRegister
        .initialize()
        .then(() => migrateSystemPromptsFromSettings(this.app.vault));
    });

    if (isKnowledgeStudioPlatformSupported()) {
      void this.initializeKnowledgeStartupPrerequisites();
      this.registerView(KNOWLEDGE_STUDIO_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
        const port = this.knowledgeStudioPort;
        const controller = new KnowledgeStudioController(port, port, port, port, port);
        return new KnowledgeStudioView(
          leaf,
          controller,
          this.knowledgeStudioSessionStore,
          this.knowledgeFolderImportPort
        );
      });
      this.addRibbonIcon("library-big", "Open Knowledge Studio", () => {
        void this.activateKnowledgeStudio();
      });
    }
    this.addCommand({
      id: "open-knowledge-studio",
      name: "Open Knowledge Studio",
      callback: () => void this.activateKnowledgeStudio(),
    });

    this.initActiveLeafChangeHandler();

    this.addRibbonIcon("message-square", "Open Copilot Chat", (evt: MouseEvent) => {
      void this.activateView();
    });

    registerCommands(this, undefined, getSettings());

    // Tool initialization is now handled automatically in CopilotPlusChainRunner and AutonomousAgentChainRunner

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        registerContextMenu(menu, this.app);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        registerKnowledgeSourceMenu(menu, file, {
          index: this.knowledgeSourcePathIndex,
          openKnowledgeStudio: () => void this.activateKnowledgeStudio(),
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        // Delegate to chat selection highlight controller
        this.chatSelectionHighlightController.handleActiveLeafChange(leaf ?? null);

        if (leaf && leaf.view instanceof MarkdownView) {
          const file = leaf.view.file;
          if (file) {
            // Note: File tracking and real-time reindexing removed for simplicity
            // Semantic search indexes are rebuilt manually or on startup as needed
            const activeCopilotView = this.app.workspace
              .getLeavesOfType(CHAT_VIEWTYPE)
              .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

            if (activeCopilotView) {
              const event = new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE);
              activeCopilotView.eventTarget.dispatchEvent(event);
            }
          }
        }
      })
    );

    // Initialize automatic selection handler
    this.initSelectionHandler();

    // Initialize web selection watcher (Desktop only)
    this.initWebSelectionWatcher();
  }

  /**
   * Initializes the singleton Windows durable state foundation while keeping
   * the user surface fail-closed until parser/compiler/startup coordination is
   * complete.
   */
  private async initializeKnowledgeRuntimeFoundation(): Promise<void> {
    const generation = ++this.knowledgeRuntimeStartupGeneration;
    const pluginDirectory = this.manifest.dir;
    if (!pluginDirectory) {
      logWarn("Knowledge runtime foundation is unavailable: plugin directory is missing.");
      return;
    }
    try {
      const runtime = await initializeKnowledgeRuntimeForCurrentGeneration(
        async () => {
          const [{ KnowledgeRuntimeStore }, { ObsidianAtomicRuntimeFile }] = await Promise.all([
            import("@/knowledge/runtime/KnowledgeRuntimeStore"),
            import("@/knowledge/runtime/ObsidianAtomicRuntimeFile"),
          ]);
          return { KnowledgeRuntimeStore, ObsidianAtomicRuntimeFile };
        },
        () =>
          !this.knowledgeLifecycleClosed && generation === this.knowledgeRuntimeStartupGeneration,
        ({ KnowledgeRuntimeStore, ObsidianAtomicRuntimeFile }) => {
          const runtimeFile = new ObsidianAtomicRuntimeFile(
            this.app.vault.adapter,
            `${pluginDirectory}/knowledge-runtime-v1.json`
          );
          return new KnowledgeRuntimeStore(runtimeFile);
        },
        async (candidate) => candidate.initialize()
      );
      if (!runtime) {
        return;
      }
      this.knowledgeRuntime = runtime;
    } catch (error) {
      if (this.knowledgeLifecycleClosed || generation !== this.knowledgeRuntimeStartupGeneration) {
        return;
      }
      this.knowledgeRuntime = undefined;
      logWarn(
        "Knowledge runtime foundation initialization failed.",
        error instanceof Error ? error.name : "unknown_error"
      );
    }
  }

  /**
   * Initializes optional Runtime I/O without blocking normal plugin or Projects startup.
   *
   * Layout readiness and Runtime completion may arrive in either order. The
   * coordinator starts the fail-closed barrier exactly once after both exist.
   */
  private async initializeKnowledgeStartupPrerequisites(): Promise<void> {
    await this.initializeKnowledgeRuntimeFoundation();
    if (this.knowledgeLifecycleClosed) {
      return;
    }
    const barrier = this.initializeKnowledgeStartupBarrier();
    this.knowledgeLayoutCoordinator.attachBarrier(barrier);
  }

  /**
   * Creates the plugin-level fail-closed barrier over Runtime, Projects, and Bundle config.
   *
   * The barrier composes the recovery-only Gate and, after a fresh
   * observation/release proof, may start the background Compiler→Review worker
   * and publish its same-generation Activity/Review adapter. Exact Activity
   * commands, Review decisions, explicit reviewed Apply, and eligible
   * no-journal recovery decisions are exposed through separate narrow owners.
   * Query remains unavailable.
   */
  private initializeKnowledgeStartupBarrier(): KnowledgePluginStartupBarrier {
    const barrier = new KnowledgePluginStartupBarrier({
      runtime: {
        isAvailable: () => !this.knowledgeLifecycleClosed && this.knowledgeRuntime !== undefined,
      },
      projects: {
        initialize: async (signal) => {
          throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
          await this.ensureProjectsInitializedAfterLayout();
          throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
        },
      },
      bundleConfig: {
        load: async (signal) => this.loadKnowledgeBundleStartupConfig(signal),
      },
      studio: {
        setUnavailable: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          this.knowledgeStudioStartupAvailability.setUnavailable(state);
        },
        setReadReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          this.knowledgeStudioStartupAvailability.setReadReady(state);
        },
        setRecoveryReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          this.knowledgeStudioStartupAvailability.setRecoveryReady(state);
        },
        setSourceRecoveryReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          this.knowledgeStudioStartupAvailability.setSourceRecoveryReady(state);
        },
      },
    });
    return barrier;
  }

  /**
   * Loads and strictly validates every project-owned Bundle after project initialization.
   *
   * @param signal - Current startup generation cancellation
   * @returns Safe aggregate containing no raw invalid configuration
   */
  private async loadKnowledgeBundleStartupConfig(
    signal: AbortSignal
  ): Promise<KnowledgePluginBundleConfigLoadResult> {
    throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
    this.closeKnowledgeProductionRecovery();
    this.closeKnowledgeProductionObservation();
    await awaitKnowledgeProductionDrain(this.app.vault, signal);
    throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
    const result = await this.knowledgeProductionPreflightLifecycle.load(signal);
    throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
    if (result.kind !== "configured") {
      return result;
    }
    this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(result.admission);
    const recovery = this.createKnowledgeProductionRecoveryPort(result.admission, signal);
    try {
      const observation = this.createKnowledgeProductionObservationPort(result.admission, signal);
      return { kind: "configured", bundleIds: result.bundleIds, recovery, observation };
    } catch (error) {
      recovery.close();
      throw error;
    }
  }

  /**
   * Creates one one-shot recovery port over the exact preflight admission.
   *
   * The resulting Gate may only converge already-durable recovery evidence.
   * Its staged Studio adapter can explicitly continue or abandon an exact
   * recovery item, but it has no startup Release, watcher, worker, or model.
   *
   * @param admission - Current generation's strict Bundle owners
   * @param startupSignal - Outer startup generation cancellation
   * @returns One-shot recovery capability consumed and closed by the startup barrier
   */
  private createKnowledgeProductionRecoveryPort(
    admission: KnowledgePluginProductionPreflightAdmission,
    startupSignal: AbortSignal
  ): KnowledgePluginRecoveryStartupPort {
    const runtime = this.knowledgeRuntime;
    if (!runtime) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const candidate = new KnowledgeProductionRecoveryComposer({
      runtime,
      vault: this.app.vault,
      bundles: admission.owners.map(({ config }) => config),
    });
    this.knowledgeProductionRecovery = candidate;
    try {
      throwIfKnowledgeStartupStopped(startupSignal, this.knowledgeLifecycleClosed);
      this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
      const assertCurrent = (): void =>
        this.assertCurrentKnowledgeRecovery(candidate, admission, runtime);
      const recoveryActions = new KnowledgeProductionRecoveryActionCoordinator({
        app: this.app,
        runtime,
        workflowLease: admission.workflowLease,
        assertCurrent,
        onGenerationRefreshRequired: () =>
          this.deferKnowledgeProductionGenerationInvalidation(assertCurrent),
      });
      const recoveryAdapter = new KnowledgeStudioRecoveryOnlyAdapter({
        composer: candidate,
        bundleIds: admission.owners.map(({ config }) => config.id),
        actions: {
          continue: (bundleId, recoveryId, expectedRuntimeRevision, signal) =>
            this.retainKnowledgeProductionRecoveryAction(
              recoveryActions.continue(bundleId, recoveryId, expectedRuntimeRevision, signal)
            ),
          abandon: (bundleId, recoveryId, expectedRuntimeRevision, signal) =>
            this.retainKnowledgeProductionRecoveryAction(
              recoveryActions.abandon(bundleId, recoveryId, expectedRuntimeRevision, signal)
            ),
        },
        assertCurrent,
        onRecoveryStateChanged: () =>
          this.deferKnowledgeProductionGenerationInvalidation(assertCurrent),
      });
      this.knowledgeStudioPort.replaceDelegate(recoveryAdapter);
    } catch (error) {
      candidate.close();
      if (this.knowledgeProductionRecovery === candidate) {
        this.knowledgeProductionRecovery = undefined;
      }
      throw error;
    }
    return new KnowledgePluginProductionRecoveryPort({
      composer: candidate,
      assertCurrent: () => this.assertCurrentKnowledgeRecovery(candidate, admission, runtime),
      onClose: () => {
        if (this.knowledgeProductionRecovery === candidate) {
          this.knowledgeProductionRecovery = undefined;
        }
      },
    });
  }

  /** Creates the long-lived observation port bound to the exact preflight generation. */
  private createKnowledgeProductionObservationPort(
    admission: KnowledgePluginProductionPreflightAdmission,
    startupSignal: AbortSignal
  ): KnowledgePluginObservationStartupPort {
    const runtime = this.knowledgeRuntime;
    if (!runtime) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const candidate = new KnowledgeProductionObservationComposer({
      app: this.app,
      runtime,
      workflowLease: admission.workflowLease,
      notificationSink: this.knowledgeSourceIssueNotificationSink,
    });
    const releaseComposer = new KnowledgeProductionRecoveryComposer({
      runtime,
      vault: this.app.vault,
      bundles: admission.owners.map(({ config }) => config),
    });
    let released = false;
    let releaseState: "held" | "releasing" | "released" | "closed" = "held";
    let workerController:
      | ReturnType<KnowledgeProductionObservationComposer["createCompileReviewWorkerController"]>
      | undefined;
    let studioReadGeneration: KnowledgeStudioReadGenerationLease | undefined;
    let preReleaseStudioGeneration: KnowledgeStudioReadGenerationLease | undefined;
    let captureGeneration: KnowledgeChatCaptureGenerationLease | undefined;
    let folderImportGeneration: KnowledgeFolderImportGenerationLease | undefined;
    let sourcePathIndexLease: Readonly<KnowledgeSourcePathIndexLease> | undefined;
    try {
      throwIfKnowledgeStartupStopped(startupSignal, this.knowledgeLifecycleClosed);
      this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
    } catch (error) {
      candidate.close();
      releaseComposer.close();
      throw error;
    }
    const port: KnowledgePluginObservationStartupPort = {
      start: async (signal) => {
        const result = await candidate.start(signal);
        const bundleId = admission.owners[0]?.config.id;
        if (
          !bundleId ||
          admission.owners.length !== 1 ||
          result.kind !== "blocked" ||
          result.blockerKinds.length !== 1 ||
          result.blockerKinds[0] !== "source_observation_pending"
        ) {
          return result;
        }
        const issues = candidate.getSourceIssues();
        const sourceRecoveryResult = createSourceObservationPreReleaseResult(
          result,
          admission.owners.map(({ config }) => config.id),
          issues
        );
        if (!sourceRecoveryResult) {
          return result;
        }
        const assertPreReleaseCurrent = (): void => {
          if (
            releaseState !== "held" ||
            this.knowledgeLifecycleClosed ||
            this.knowledgeRuntime !== runtime ||
            this.knowledgeProductionObservation !== port
          ) {
            throw new DOMException("The operation was aborted", "AbortError");
          }
          this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
          candidate.getSourceIssues();
        };
        const coordinator = new KnowledgeProductionSourceLifecycleCoordinator({
          runtime,
          getSourceIssues: () => candidate.getSourceIssues(),
          assertCurrent: assertPreReleaseCurrent,
          onGenerationRefreshRequired: () =>
            this.deferKnowledgeProductionGenerationInvalidation(assertPreReleaseCurrent),
        });
        const retainLifecycleAction = <T>(operation: Promise<T>): Promise<T> => {
          retainKnowledgeProductionDrain(
            this.app.vault,
            operation.then(
              () => undefined,
              () => undefined
            )
          );
          return operation;
        };
        const sourceLifecycle: KnowledgeSourceLifecyclePort = Object.freeze({
          loadSources: (nextBundleId: string, nextSignal: AbortSignal) =>
            coordinator.loadSources(nextBundleId, nextSignal),
          checkAgain: (nextBundleId: string, sourceId: string, nextSignal: AbortSignal) =>
            retainLifecycleAction(coordinator.checkAgain(nextBundleId, sourceId, nextSignal)),
          retireSource: (
            nextBundleId: string,
            request: Readonly<KnowledgeSourceRetirementRequest>,
            nextSignal: AbortSignal
          ) => retainLifecycleAction(coordinator.retireSource(nextBundleId, request, nextSignal)),
        });
        const adapter = new KnowledgeStudioSourceLifecycleOnlyAdapter({
          bundleId,
          sourceLifecycle,
          assertCurrent: assertPreReleaseCurrent,
        });
        preReleaseStudioGeneration = new KnowledgeStudioReadGenerationLease({
          delegate: adapter,
          subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
          replaceDelegate: (delegate) => this.knowledgeStudioPort.replaceDelegate(delegate),
          setUnavailable: () => {
            if (this.knowledgeLifecycleClosed) return;
            this.knowledgeStudioStartupAvailability.setUnavailable({
              generation: 0,
              status: "waiting_for_layout",
            });
          },
          assertCurrent: assertPreReleaseCurrent,
        });
        return sourceRecoveryResult;
      },
      release: async (signal) => {
        if (releaseState !== "held") {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        releaseState = "releasing";
        try {
          const reproof = await candidate.reprove(signal);
          if (reproof.kind !== "observation_reproved") {
            throw new DOMException("The operation was aborted", "AbortError");
          }
          candidate.assertHealthy();
          const result = await releaseComposer.releaseFresh(() => {
            throwIfKnowledgeStartupStopped(signal, this.knowledgeLifecycleClosed);
            this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
            candidate.assertHealthy();
          });
          if (
            result.kind === "released" &&
            hasExactKnowledgeBundleSequence(
              result.bundleIds,
              admission.owners.map(({ config }) => config.id)
            )
          ) {
            preReleaseStudioGeneration?.close();
            preReleaseStudioGeneration = undefined;
            released = true;
            const assertCurrent = (): void => {
              if (
                !released ||
                this.knowledgeLifecycleClosed ||
                this.knowledgeRuntime !== runtime ||
                this.knowledgeProductionObservation !== port
              ) {
                throw new DOMException("The operation was aborted", "AbortError");
              }
              this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
              candidate.assertHealthy();
            };
            const scheduler = createKnowledgeWorkerScheduler(this.app.workspace.containerEl.win);
            const deferGenerationRefresh = (): void =>
              this.deferKnowledgeProductionGenerationInvalidation(() => {
                if (
                  this.knowledgeLifecycleClosed ||
                  this.knowledgeRuntime !== runtime ||
                  this.knowledgeProductionObservation !== port
                ) {
                  throw new DOMException("The operation was aborted", "AbortError");
                }
                this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
              });
            workerController = candidate.createCompileReviewWorkerController(
              admission.modelRouteLease,
              () => {
                if (!released || this.knowledgeLifecycleClosed) return false;
                try {
                  assertCurrent();
                  return true;
                } catch {
                  return false;
                }
              },
              scheduler,
              deferGenerationRefresh
            );
            const studioAdapter = candidate.createKnowledgeStudioRuntimeReadAdapter(
              admission.modelRouteLease,
              (drain) => retainKnowledgeProductionDrain(this.app.vault, drain),
              () =>
                this.deferKnowledgeProductionGenerationInvalidation(() => {
                  if (
                    this.knowledgeLifecycleClosed ||
                    this.knowledgeRuntime !== runtime ||
                    this.knowledgeProductionObservation !== port
                  ) {
                    throw new DOMException("The operation was aborted", "AbortError");
                  }
                  this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
                  candidate.assertHealthy();
                })
            );
            studioReadGeneration = new KnowledgeStudioReadGenerationLease({
              delegate: studioAdapter,
              subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
              replaceDelegate: (delegate) => this.knowledgeStudioPort.replaceDelegate(delegate),
              setUnavailable: () => {
                if (this.knowledgeLifecycleClosed) return;
                this.knowledgeStudioStartupAvailability.setUnavailable({
                  generation: 0,
                  status: "waiting_for_layout",
                });
              },
              assertCurrent: () => candidate.assertHealthy(),
            });
            const registration = new KnowledgeSourceRegistrationCore(
              new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(runtime)),
              { assertCurrent }
            );
            const nextCaptureDelegate = new KnowledgeProductionChatCaptureCoordinator({
              owners: admission.owners,
              parserProfiles: admission.workflowLease
                .getParsers()
                .map((parser) => parser.getProfile()),
              sourcePresence: new ObsidianKnowledgeVaultSourcePresence(this.app.vault),
              registration,
              createFileStore: (sourceRoot) =>
                new ObsidianKnowledgeFolderImportFileStore(this.app.vault.adapter, sourceRoot, {
                  assertCurrent,
                }),
              assertCurrent,
              onGenerationRefreshRequired: () =>
                this.deferKnowledgeProductionGenerationInvalidation(assertCurrent),
              retainDrain: (drain) => retainKnowledgeProductionDrain(this.app.vault, drain),
            });
            captureGeneration = new KnowledgeChatCaptureGenerationLease({
              delegate: nextCaptureDelegate,
              subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
              replaceDelegate: (delegate) =>
                this.knowledgeChatCapturePort.replaceDelegate(delegate),
              revokeDelegate: (delegate) => this.knowledgeChatCapturePort.revokeDelegate(delegate),
              assertCurrent,
            });
            const nextFolderImportDelegate = new KnowledgeProductionFolderImportCoordinator({
              owners: admission.owners,
              parserProfiles: admission.workflowLease
                .getParsers()
                .map((parser) => parser.getProfile()),
              registration,
              createFileStore: (sourceRoot) =>
                new ObsidianKnowledgeFolderImportFileStore(this.app.vault.adapter, sourceRoot, {
                  assertCurrent,
                }),
              assertCurrent,
              onGenerationRefreshRequired: deferGenerationRefresh,
            });
            folderImportGeneration = new KnowledgeFolderImportGenerationLease({
              delegate: nextFolderImportDelegate,
              subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
              replaceDelegate: (delegate) =>
                this.knowledgeFolderImportPort.replaceDelegate(delegate),
              revokeDelegate: (delegate) => this.knowledgeFolderImportPort.revokeDelegate(delegate),
              assertCurrent,
            });
            sourcePathIndexLease = this.knowledgeSourcePathIndex.install(
              candidate.getRegisteredSourcePaths()
            );
            retainKnowledgeProductionDrain(this.app.vault, workerController.whenSettled());
            workerController.start();
            studioReadGeneration.assertCurrent();
            releaseState = "released";
          } else {
            releaseState = "closed";
          }
          return result;
        } catch (error) {
          releaseState = "closed";
          released = false;
          captureGeneration?.close();
          captureGeneration = undefined;
          folderImportGeneration?.close();
          folderImportGeneration = undefined;
          if (sourcePathIndexLease) {
            this.knowledgeSourcePathIndex.revoke(sourcePathIndexLease);
            sourcePathIndexLease = undefined;
          }
          studioReadGeneration?.close();
          studioReadGeneration = undefined;
          preReleaseStudioGeneration?.close();
          preReleaseStudioGeneration = undefined;
          workerController?.close();
          throw error;
        }
      },
      close: () => {
        releaseState = "closed";
        released = false;
        captureGeneration?.close();
        captureGeneration = undefined;
        folderImportGeneration?.close();
        folderImportGeneration = undefined;
        if (sourcePathIndexLease) {
          this.knowledgeSourcePathIndex.revoke(sourcePathIndexLease);
          sourcePathIndexLease = undefined;
        }
        studioReadGeneration?.close();
        studioReadGeneration = undefined;
        preReleaseStudioGeneration?.close();
        preReleaseStudioGeneration = undefined;
        workerController?.close();
        workerController = undefined;
        candidate.close();
        releaseComposer.close();
        if (this.knowledgeProductionObservation === port) {
          this.knowledgeProductionObservation = undefined;
        }
        if (this.knowledgeProductionRelease === releaseComposer) {
          this.knowledgeProductionRelease = undefined;
        }
      },
    };
    this.knowledgeProductionObservation = port;
    this.knowledgeProductionRelease = releaseComposer;
    return port;
  }

  /** Requires a recovery candidate to retain exact plugin and preflight ownership. */
  private assertCurrentKnowledgeRecovery(
    candidate: KnowledgeProductionRecoveryComposer,
    admission: KnowledgePluginProductionPreflightAdmission,
    runtime: KnowledgeRuntimeStore
  ): void {
    if (
      this.knowledgeLifecycleClosed ||
      this.knowledgeRuntime !== runtime ||
      this.knowledgeProductionRecovery !== candidate
    ) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    this.knowledgeProductionPreflightLifecycle.assertCurrentAdmission(admission);
  }

  /** Synchronously invalidates and replaces the full production generation. */
  private invalidateKnowledgeProductionGeneration(): void {
    this.closeKnowledgeProductionObservation();
    this.closeKnowledgeProductionRecovery();
    this.knowledgeProductionPreflightLifecycle.invalidate();
    if (!this.knowledgeLifecycleClosed) {
      this.knowledgeLayoutCoordinator.attachBarrier(this.initializeKnowledgeStartupBarrier());
    }
  }

  /** Defers a full workflow rebuild until the current command promise can settle. */
  private deferKnowledgeProductionGenerationInvalidation(assertCurrent: () => void): void {
    const win = this.app.workspace.containerEl.win;
    win.setTimeout(() => {
      if (this.knowledgeLifecycleClosed) return;
      try {
        assertCurrent();
      } catch {
        return;
      }
      this.invalidateKnowledgeProductionGeneration();
    }, 0);
  }

  /** Retains one recovery action until every durable effect and confirmation has settled. */
  private retainKnowledgeProductionRecoveryAction<T>(operation: Promise<T>): Promise<T> {
    retainKnowledgeProductionDrain(
      this.app.vault,
      operation.then(() => undefined)
    );
    return operation;
  }

  /** Synchronously closes the current recovery-only composer, if any. */
  private closeKnowledgeProductionRecovery(): void {
    this.knowledgeProductionRecovery?.close();
    this.knowledgeProductionRecovery = undefined;
  }

  /** Synchronously closes the current observation session, if any. */
  private closeKnowledgeProductionObservation(): void {
    this.knowledgeProductionObservation?.close();
    this.knowledgeProductionObservation = undefined;
    this.knowledgeProductionRelease?.close();
    this.knowledgeProductionRelease = undefined;
  }

  /**
   * Starts ordinary Projects independently from optional Knowledge Runtime readiness.
   *
   * Concurrent callers share one attempt. A failed attempt is cleared for an
   * explicit retry, while a successful attempt remains an idempotent readiness proof.
   *
   * @returns Shared Project initialization attempt
   */
  private ensureProjectsInitializedAfterLayout(): Promise<void> {
    if (this.projectsInitialization) {
      return this.projectsInitialization;
    }

    const initialization = this.projectRegister.initialize().catch((error) => {
      if (this.projectsInitialization === initialization) {
        this.projectsInitialization = undefined;
      }
      if (!this.knowledgeLifecycleClosed) {
        logError("[Projects] ProjectRegister initialization failed", error);
        new Notice("Failed to load projects. Check logs for details.");
      }
      throw error;
    });
    this.projectsInitialization = initialization;
    return initialization;
  }

  async onunload() {
    // Fail-close synchronously before the first await so no old startup
    // continuation can publish or initialize services during persistence flush.
    this.knowledgeLifecycleClosed = true;
    this.knowledgeRuntimeStartupGeneration += 1;
    this.closeKnowledgeProductionObservation();
    this.closeKnowledgeProductionRecovery();
    this.knowledgeProductionPreflightLifecycle.close();
    this.knowledgeLayoutCoordinator.close();
    this.knowledgeStudioSessionStore.dispose();
    this.knowledgeStudioPort.dispose();
    this.knowledgeChatCapturePort.dispose();
    this.knowledgeFolderImportPort.dispose();
    this.knowledgeSourcePathIndex.clear();
    this.knowledgeProjectRecordsUnsubscriber?.();
    this.knowledgeProjectRecordsUnsubscriber = undefined;
    // Unsubscribe ProjectManager before releasing project state. Reversing
    // this order can notify an unloading manager and start a stale switch.
    this.projectManager?.onunload();
    this.projectRegister?.cleanup();
    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
    this.settingsUnsubscriber?.();
    this.settingsUnsubscriber = undefined;

    // Retire the exact Vault data owner before the first await. A stale unload
    // continuation must never resolve a global singleton and clean up a newer
    // plugin lifecycle.
    this.vaultDataManager?.cleanup();
    this.vaultDataManager = undefined;

    // Clear all persistent selection highlights before unload
    // This prevents "stuck" highlights after hot reload (dev environment)
    this.clearAllPersistentSelectionHighlights();

    // Cleanup chat selection highlight controller
    this.chatSelectionHighlightController?.cleanup();

    // Cleanup selection handler
    this.cleanupSelectionHandler();
    this.cleanupWebSelectionWatcher();
    this.clearSelectionContext();

    // Cleanup Web Viewer state tracking (webview event listeners)
    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch {
      // Ignore errors if service not available
    }

    logInfo("Copilot plugin unloaded");

    // Best-effort flush of pending keychain/data.json writes.
    // Reason: onunload() is void in Obsidian's type system, but awaiting here
    // is no worse than fire-and-forget, and consistent with the log flush below.
    // (Module-level state + KeychainService singleton reset happen at the
    // START of the next onload, not here — see comment in onload above for
    // the late-write race that motivated the move.)
    // Start the log flush with this plugin's captured Vault before yielding.
    // Its adapter can never switch to a newer global App/Vault mid-flight.
    await Promise.all([flushPersistence(), logFileManager.flush(this.app.vault)]);
  }

  /**
   * Clear all persistent selection highlights across all Markdown editors.
   * Called during plugin unload to prevent "stuck" highlights after hot reload.
   */
  private clearAllPersistentSelectionHighlights(): void {
    try {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        const cm = view.editor?.cm;
        if (cm) {
          SelectionHighlight.hide(cm);
          hideChatSelectionHighlight(cm);
        }
      }
    } catch (error) {
      logWarn("Failed to clear persistent selection highlights:", error);
    }
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView) {
        await chatView.saveChat();
      }
    }
  }

  async processText(
    editor: Editor,
    eventType: string,
    eventSubtype?: string,
    checkSelectedText = true
  ) {
    const selectedText = editor.getSelection();

    const isChatWindowActive = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      await this.activateView();
    }

    // Without the timeout, the view is not yet active
    window.setTimeout(() => {
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (activeCopilotView && (!checkSelectedText || selectedText)) {
        const event = new CustomEvent(eventType, { detail: { selectedText, eventSubtype } });
        activeCopilotView.eventTarget.dispatchEvent(event);
      }
    }, 0);
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    void this.processText(editor, eventType, eventSubtype);
  }

  emitChatIsVisible() {
    const activeCopilotView = this.app.workspace
      .getLeavesOfType(CHAT_VIEWTYPE)
      .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

    if (activeCopilotView) {
      const event = new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE);
      activeCopilotView.eventTarget.dispatchEvent(event);
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        if (leaf.getViewState().type === CHAT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  /**
   * Initialize automatic text selection handler
   * Listens to selectionchange events and automatically adds selected text to chat context
   */
  initSelectionHandler() {
    this.selectionChangeHandler = () => {
      // Clear existing debounce timer
      if (this.selectionDebounceTimer) {
        window.clearTimeout(this.selectionDebounceTimer);
      }

      // Debounce selection changes to avoid excessive triggers
      this.selectionDebounceTimer = window.setTimeout(() => {
        this.handleSelectionChange();
      }, 500);
    };

    // Capture the document at registration so removal targets the same one
    // (activeDocument can change if the user focuses a popout window).
    this.selectionListenerDocument = activeDocument;
    this.selectionListenerDocument.addEventListener("selectionchange", this.selectionChangeHandler);
  }

  /**
   * Clean up selection handler on plugin unload
   */
  cleanupSelectionHandler() {
    if (this.selectionDebounceTimer) {
      window.clearTimeout(this.selectionDebounceTimer);
    }
    if (this.selectionChangeHandler && this.selectionListenerDocument) {
      this.selectionListenerDocument.removeEventListener(
        "selectionchange",
        this.selectionChangeHandler
      );
    }
    this.selectionListenerDocument = undefined;
  }

  /**
   * Clears the auto-selected text context if one was previously captured
   */
  private clearSelectionContext() {
    setSelectedTextContexts([]);
  }

  /**
   * Clears the auto-selected web text context for a specific URL.
   * Preserves contexts from other sourceTypes and other URLs.
   */
  private clearWebSelectionContextForUrl(url: string): void {
    const current = getSelectedTextContexts();
    const next = current.filter((c) => c.sourceType !== "web" || c.url !== url);
    if (next.length === current.length) {
      return;
    }
    setSelectedTextContexts(next);
  }

  /**
   * Stores the provided selection as the active selected text context.
   * Only keeps the latest selection - note and web selections are mutually exclusive.
   */
  private setSelectionContext(context: SelectedTextContext) {
    setSelectedTextContexts([context]);
  }

  /**
   * Handle text selection changes
   * Only processes selections from markdown editors
   */
  handleSelectionChange() {
    // Check if auto-inclusion is enabled
    const settings = getSettings();
    if (!settings.autoAddSelectionToContext) {
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.editor) {
      return;
    }

    const editor = activeView.editor;
    const activeFile = this.app.workspace.getActiveFile();

    // Get selection range first to validate it exists
    const selectionRange = editor.listSelections()[0];
    if (!selectionRange) {
      return;
    }

    // Compute selection signature to avoid redundant updates
    const signature = activeFile
      ? `${activeFile.path}:${selectionRange.anchor.line}:${selectionRange.anchor.ch}:${selectionRange.head.line}:${selectionRange.head.ch}`
      : "";

    // Skip if selection hasn't changed
    if (signature === this.lastSelectionSignature) {
      return;
    }
    this.lastSelectionSignature = signature;

    const selectedText = editor.getSelection();

    // If selection is empty, clear note-type contexts
    if (!selectedText || !selectedText.trim()) {
      const currentContexts = getSelectedTextContexts();
      const nonNoteContexts = currentContexts.filter((ctx) => ctx.sourceType !== "note");
      if (currentContexts.length !== nonNoteContexts.length) {
        setSelectedTextContexts(nonNoteContexts);
      }
      return;
    }

    if (!activeFile) {
      return;
    }

    const anchorLine = selectionRange.anchor.line + 1;
    const headLine = selectionRange.head.line + 1;
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);

    // Create selected text context
    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: activeFile.basename,
      notePath: activeFile.path,
      startLine,
      endLine,
    };

    this.setSelectionContext(selectedTextContext);
  }

  /**
   * Initialize web selection watcher for auto-adding web tab selections.
   * Desktop only - uses WebSelectionTracker with self-scheduling pattern.
   */
  initWebSelectionWatcher() {
    // Only run on desktop
    if (!Platform.isDesktopApp) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => getSettings().autoAddSelectionToContext,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        // Use symmetric update strategy via setSelectionContext
        this.setSelectionContext(context);
      },
      onSelectionClear: ({ url }) => {
        this.clearWebSelectionContextForUrl(url);
      },
    });

    this.webSelectionTracker.start();
  }

  /**
   * Clean up web selection watcher
   */
  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  /**
   * Suppress the current web selection so it won't be auto-captured again until it changes or is cleared.
   * Called by UI when user removes web selection or starts a new chat.
   * @param url - Optional URL to suppress (prevents leaf-binding issues when lastActiveLeaf has changed)
   */
  suppressCurrentWebSelection(url?: string): void {
    if (url && url.trim()) {
      this.webSelectionTracker?.suppressSelectionForUrl(url);
      return;
    }

    this.webSelectionTracker?.suppressCurrentSelection();
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        // Default to the entire active file if no selection
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.read(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    void this.processText(editor, eventType, customPrompt, false);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateView();
    } else {
      void this.activateView();
    }
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length === 0) {
      if (getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW) {
        await this.app.workspace.getRightLeaf(false).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      } else {
        await this.app.workspace.getLeaf(true).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      }
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
    // Small delay to ensure React component is ready to receive the focus event
    window.setTimeout(() => {
      this.emitChatIsVisible();
    }, 50);
  }

  /** Opens the Windows-only personal Knowledge Studio workspace. */
  async activateKnowledgeStudio(): Promise<void> {
    if (!isKnowledgeStudioPlatformSupported()) {
      new Notice("Knowledge Studio is currently available only in Obsidian Desktop on Windows.");
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType(KNOWLEDGE_STUDIO_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }

    await this.app.workspace.getLeaf(true).setViewState({
      type: KNOWLEDGE_STUDIO_VIEW_TYPE,
      active: true,
    });
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    const settings = await loadSettingsWithKeychain(rawData, (d) => this.saveData(d));
    setSettings(settings);
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)

    // Add or update existing models in the map
    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        // If it's a built-in model, preserve the built-in status
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
        });
      } else {
        modelMap.set(key, model);
      }
    });

    return Array.from(modelMap.values());
  }

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(
      this.app,
      chatFiles,
      this.chatHistoryLastAccessedAtManager,
      this.loadChatHistory.bind(this) as (file: TFile) => void
    ).open();
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folderFiles = await listMarkdownFiles(this.app, getSettings().defaultSaveFolder);
    if (folderFiles.length === 0) return [];

    const currentProject = getCurrentProject();

    // Reason: pass all files to filterChatHistoryFiles which checks frontmatter projectId.
    // A prefix prefilter would miss renamed or legacy files that still have correct frontmatter.
    return filterChatHistoryFiles(this.app, folderFiles, currentProject?.id);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) => {
      const createdAt = extractChatDate(file);
      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(file);

      // Use effective last used time (prefers in-memory value for immediate UI updates)
      const effectiveLastAccessedAtMs =
        this.chatHistoryLastAccessedAtManager.getEffectiveLastUsedAt(
          file.path,
          persistedLastAccessedAtMs ?? createdAt.getTime()
        );
      const lastAccessedAt = new Date(effectiveLastAccessedAtMs);

      return {
        id: file.path,
        title: extractChatTitle(file),
        createdAt,
        lastAccessedAt,
      };
    });
  }

  /**
   * Record that a chat history file was accessed by updating its `lastAccessedAt`
   * YAML frontmatter field (epoch ms), with in-memory tracking and throttled persistence.
   *
   * Memory is always updated immediately (for UI sorting), but disk writes are throttled and monotonic.
   */
  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      // Always update memory for immediate UI feedback
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      // Check if we should persist to disk (throttled)
      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(file);
      const timestampToPersist = this.chatHistoryLastAccessedAtManager.shouldPersist(
        file.path,
        persistedLastAccessedAtMs
      );

      if (timestampToPersist === null) {
        return;
      }

      let persistedAtMs = timestampToPersist;

      if (
        this.app.fileManager?.processFrontMatter &&
        this.app.vault.getAbstractFileByPath(file.path) != null
      ) {
        await this.app.fileManager.processFrontMatter(
          file,
          (frontmatter: Record<string, unknown>) => {
            // Monotonic protection: ensure we never write an older timestamp
            const existingValue = Number(frontmatter.lastAccessedAt);
            const existingAtMs =
              Number.isFinite(existingValue) && existingValue > 0 ? existingValue : 0;

            persistedAtMs = Math.max(existingAtMs, timestampToPersist);

            if (existingAtMs === persistedAtMs) {
              return;
            }

            frontmatter.lastAccessedAt = persistedAtMs;
          }
        );
      } else {
        await patchFrontmatter(this.app, file.path, { lastAccessedAt: persistedAtMs });
      }

      // Mark persistence successful for throttling purposes
      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[CopilotPlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  /**
   * Get the chat history last accessed at manager for use in sorting.
   * This allows UI components to use in-memory values for immediate feedback.
   */
  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatHistory(file: TFile) {
    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Check if the Copilot view is already active
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      // Only activate the view if it's not already open
      await this.activateView();
    }

    // Load messages using ChatUIState (which now uses ChatPersistenceManager internally)
    await this.chatUIState.loadChatHistory(file);

    // Touch "lastAccessedAt" timestamp (throttled to avoid frequent writes)
    void this.touchChatHistoryLastAccessedAt(file);

    // Update the view
    const copilotView = (existingView || this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0])
      ?.view as CopilotView;
    if (copilotView) {
      copilotView.updateView();
    }
  }

  async loadChatById(fileId: string): Promise<void> {
    const file = await resolveFileByPath(this.app, fileId);
    if (file) {
      await this.loadChatHistory(file);
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else if (await this.app.vault.adapter.exists(fileId)) {
      new Notice(
        "Cannot open source files from hidden directories. To open chat notes in the editor, save them to a non-hidden folder in settings."
      );
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          frontmatter.topic = newTitle;
        }
      );

      // Wait for metadata cache to update with improved error handling
      // This ensures that subsequent calls to extractChatTitle will get the updated data
      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        // Fallback timeout with shorter duration and better error handling
        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          // Don't reject, just resolve - the frontmatter update might have worked
          // even if we didn't catch the event
          resolve();
        }, 500); // Reduced timeout for better performance
      });

      new Notice("Chat title updated.");
    } else if (await resolveFileByPath(this.app, fileId)) {
      await patchFrontmatter(this.app, fileId, { topic: newTitle.trim() });
      new Notice("Chat title updated.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
      new Notice("Chat deleted.");
    } else if (await this.app.vault.adapter.exists(fileId)) {
      await this.app.vault.adapter.remove(fileId);
      new Notice("Chat deleted.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async handleNewChat() {
    clearRecordedPromptPayload();
    await logFileManager.clear(this.app.vault);

    // Analyze chat messages for memory if enabled
    if (getSettings().enableRecentConversations) {
      try {
        // Get the current chat model from the chain manager
        const chainManager = this.projectManager.getCurrentChainManager();
        const chatModel = chainManager.chatModelManager.getChatModel();
        this.userMemoryManager.addRecentConversation(this.chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Abort any ongoing streams before clearing chat
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      // Dispatch abort event to stop any ongoing streams
      const abortEvent = new CustomEvent(EVENT_NAMES.ABORT_STREAM, {
        detail: { reason: ABORT_REASON.NEW_CHAT },
      });
      copilotView.eventTarget.dispatchEvent(abortEvent);
    }

    // Clear messages through ChatUIState (which also clears chain memory)
    this.chatUIState.clearMessages();

    // Update view if it exists
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    } else {
      // If view doesn't exist, open it
      await this.activateView();
    }

    // Note: UI-specific state like includeActiveNote setting is handled in the Chat component
    // This ensures proper separation of concerns between plugin logic and UI state
  }

  async newChat() {
    // Just delegate to the shared method
    await this.handleNewChat();
  }

  async customSearchDB(
    query: string,
    salientTerms: string[],
    textWeight: number
  ): Promise<{ content: string; metadata: Record<string, unknown> }[]> {
    const settings = getSettings();

    // Run FilterRetriever for guaranteed title/tag matches
    const { FilterRetriever } = await import("@/search/v3/FilterRetriever");
    const { mergeFilterAndSearchResults } = await import("@/search/v3/mergeResults");
    const filterRetriever = new FilterRetriever(this.app, {
      salientTerms: salientTerms,
      maxK: 20,
    });
    const filterDocs = await filterRetriever.getRelevantDocuments(query);

    // Run main retriever for scored results
    const retriever = settings.enableSemanticSearchV3
      ? new (await import("@/search/v3/MergedSemanticRetriever")).MergedSemanticRetriever(
          this.app,
          {
            minSimilarityScore: 0.3,
            maxK: 20,
            salientTerms: salientTerms,
            textWeight: textWeight,
            returnAll: false,
          }
        )
      : new (await import("@/search/v3/TieredLexicalRetriever")).TieredLexicalRetriever(this.app, {
          minSimilarityScore: 0.3,
          maxK: 20,
          salientTerms: salientTerms,
          textWeight: textWeight,
          returnAll: false,
          useRerankerThreshold: undefined,
        });

    const searchDocs = await retriever.getRelevantDocuments(query);
    const { filterResults, searchResults } = mergeFilterAndSearchResults(filterDocs, searchDocs);
    const allDocs = [...filterResults, ...searchResults];

    return allDocs.map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
    }));
  }
}
