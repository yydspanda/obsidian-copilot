import { KNOWLEDGE_STUDIO_VIEW_TYPE, KnowledgeStudioView } from "@/components/KnowledgeStudioView";
import { KnowledgeAppliedWikiInspectorModal } from "@/components/knowledge/KnowledgeAppliedWikiInspectorModal";
import { checkKnowledgeWikiInspectionCommand } from "@/commands/knowledgeWikiCommand";
import { registerKnowledgeSourceMenu } from "@/commands/knowledgeSourceMenu";
import { registerKnowledgeWikiMenu } from "@/commands/knowledgeWikiMenu";
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
import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { prepareKnowledgeConfiguredModelPreflight } from "@/knowledge/compiler/KnowledgeConfiguredModelBridge";
import { DelegatingKnowledgeForwardRevisionProposalActionPort } from "@/knowledge/forwardRevision/DelegatingKnowledgeForwardRevisionProposalActionPort";
import { KnowledgeForwardRevisionProposalActionGenerationLease } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionGenerationLease";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import {
  KnowledgeRuntimeManifestStorage,
  type KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import type { KnowledgeChatModelReadiness } from "@/knowledge/setup/KnowledgeChatModelReadiness";
import { KnowledgeSetupNavigation } from "@/knowledge/setup/KnowledgeSetupNavigation";
import {
  createKnowledgeSetupUnloadedProjection,
  projectKnowledgeSetupReadiness,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";
import { publishKnowledgeSetupThenStudioAuthority } from "@/knowledge/setup/KnowledgeSetupStartupPublication";
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
import { tryPublishKnowledgeAppliedWikiPageInspectorGeneration } from "@/knowledge/startup/KnowledgeAppliedWikiPageInspectorPublication";
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
import { KnowledgeProductionObservationComposer } from "@/knowledge/startup/KnowledgeProductionObservationComposer";
import { KnowledgeProductionRecoveryActionCoordinator } from "@/knowledge/startup/KnowledgeProductionRecoveryActionCoordinator";
import { KnowledgeProductionRecoveryComposer } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";
import { initializeKnowledgeRuntimeForCurrentGeneration } from "@/knowledge/startup/KnowledgeRuntimeFoundationInitializer";
import { KnowledgePluginProductionRecoveryPort } from "@/knowledge/startup/KnowledgePluginProductionRecoveryPort";
import { createSourceObservationPreReleaseResult } from "@/knowledge/startup/KnowledgeSourceObservationPreRelease";
import {
  KnowledgePluginStartupBarrier,
  type KnowledgePluginBundleConfigLoadResult,
  type KnowledgePluginObservationStartupPort,
  type KnowledgePluginRecoveryStartupPort,
  type KnowledgePluginStartupState,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { createKnowledgeProductionWorkflowExecutionPairing } from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";
import type { KnowledgeProductionWorkerScheduler } from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgeStudioStartupAvailabilityAdapter } from "@/knowledge/startup/KnowledgeStudioStartupAvailabilityAdapter";
import {
  hasExactKnowledgeBundleSequence,
  KnowledgeStudioReadGenerationLease,
} from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import { KnowledgeStudioRecoveryOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioRecoveryOnlyAdapter";
import { KnowledgeStudioSourceLifecycleOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioSourceLifecycleOnlyAdapter";
import { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";
import {
  captureKnowledgeStudioPresentationHint,
  planKnowledgeStudioPresentationNavigation,
  type KnowledgeStudioPresentationHint,
} from "@/knowledge/ui/KnowledgeStudioWindowNavigation";
import { isKnowledgeStudioPlatformSupported } from "@/knowledge/ui/platform";
import { DelegatingKnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/DelegatingKnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPageInspectorGenerationLease } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorGenerationLease";
import type { KnowledgeAppliedWikiPageInspectionRequest } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import { KnowledgeKnownAppliedWikiOutputsGenerationLease } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsGenerationLease";
import { logWarn } from "@/logger";
import {
  findChatBackendEntry,
  providerNeedsResolvedApiKey,
  type ModelManagementApi,
} from "@/modelManagement";
import { getCachedProjectRecords, subscribeToProjectRecords } from "@/projects/state";
import { getSettings } from "@/settings/model";
import { App, Menu, Notice, Plugin, TFile, ViewCreator, WorkspaceLeaf } from "obsidian";

/** Throws before an obsolete or unloaded Knowledge startup generation can continue. */
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

/** Host callbacks kept outside the Knowledge runtime ownership boundary. */
export interface KnowledgePluginIntegrationDependencies {
  plugin: Plugin;
  modelManagement: ModelManagementApi;
  ensureProjectsInitialized(): Promise<unknown>;
  getCurrentProjectId(): string | undefined;
  subscribeCurrentProjectChange(listener: () => void): () => void;
  openChat(): void | Promise<void>;
}

/**
 * Owns the optional Knowledge Studio runtime and every capability published from it.
 *
 * The integration boundary registers Obsidian surfaces and coordinates Knowledge
 * generations; ordinary Projects, Quick Chat, and Agent Chat remain owned by the host.
 */
export class KnowledgePluginIntegration {
  private readonly app: App;
  private readonly plugin: Plugin;
  private readonly modelManagement: ModelManagementApi;
  private readonly dependencies: KnowledgePluginIntegrationDependencies;
  private readonly knowledgeProductionRuntimeExecutionClaim: ReturnType<
    typeof createKnowledgeProductionWorkflowExecutionPairing
  >["runtimeClaim"];
  private readonly knowledgeProductionPreflightLifecycle: KnowledgePluginProductionPreflightLifecycle;
  private readonly knowledgeStudioPort = new DelegatingKnowledgeStudioPort();
  private readonly knowledgeChatCapturePort = new DelegatingKnowledgeChatCapturePort();
  private readonly knowledgeFolderImportPort = new DelegatingKnowledgeFolderImportPort();
  private readonly knowledgeSourcePathIndex = new KnowledgeSourcePathIndex();
  private readonly knowledgeAppliedWikiPageInspectorPort =
    new DelegatingKnowledgeAppliedWikiPageInspectorPort();
  private readonly knowledgeKnownAppliedWikiOutputsPort =
    new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
  private readonly knowledgeForwardRevisionProposalActionPort =
    new DelegatingKnowledgeForwardRevisionProposalActionPort();
  private readonly knowledgeAppliedWikiPathIndex = new KnowledgeAppliedWikiPathIndex();
  private readonly knowledgeAppliedWikiInspectorModals =
    new Set<KnowledgeAppliedWikiInspectorModal>();
  private readonly knowledgeSourceIssueNotificationSink =
    createKnowledgeSourceIssueNotificationSink((message) => {
      if (this.knowledgeLifecycleClosed) return;
      new Notice(message);
    });
  private readonly knowledgeStudioSessionStore = new KnowledgeStudioSessionStore();
  private knowledgeSetupStartupState: KnowledgePluginStartupState = Object.freeze({
    generation: 0,
    status: "waiting_for_layout",
  });
  private readonly knowledgeSetupReadinessStore = new KnowledgeSetupReadinessStore(
    projectKnowledgeSetupReadiness(this.knowledgeSetupStartupState, {
      projectCount: 0,
      chatModel: Object.freeze({ reason: "missing" }),
    })
  );
  private readonly knowledgeSetupNavigation: KnowledgeSetupNavigation;
  private readonly knowledgeStudioStartupAvailability =
    new KnowledgeStudioStartupAvailabilityAdapter(
      this.knowledgeStudioPort,
      this.knowledgeStudioSessionStore
    );
  private readonly knowledgeLayoutCoordinator: KnowledgePluginLayoutCoordinator;
  private knowledgeRuntime?: KnowledgeRuntimeStore;
  private knowledgeProductionRecovery?: KnowledgeProductionRecoveryComposer;
  private knowledgeProductionObservation?: KnowledgePluginObservationStartupPort;
  private knowledgeProductionRelease?: KnowledgeProductionRecoveryComposer;
  private knowledgeProjectRecordsUnsubscriber?: () => void;
  private knowledgeSetupSelectionUnsubscriber?: () => void;
  private knowledgeModelManagementUnsubscriber?: () => void;
  private knowledgeLifecycleClosed = false;
  private knowledgeRuntimeStartupGeneration = 0;
  private loaded = false;

  constructor(dependencies: KnowledgePluginIntegrationDependencies) {
    this.dependencies = dependencies;
    this.plugin = dependencies.plugin;
    this.app = dependencies.plugin.app;
    this.modelManagement = dependencies.modelManagement;
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();
    this.knowledgeProductionRuntimeExecutionClaim = pairing.runtimeClaim;
    this.knowledgeProductionPreflightLifecycle = new KnowledgePluginProductionPreflightLifecycle({
      executionPreflightClaim: pairing.preflightClaim,
      getProjectRecords: () => getCachedProjectRecords(),
      fetchPort: captureKnowledgeRendererFetchPort(),
      createResources: () => createKnowledgeProductionPipelineResources(),
      prepareConfiguredModelPreflight: (input) =>
        prepareKnowledgeConfiguredModelPreflight({
          ...input,
          modelManagement: this.modelManagement,
        }),
    });
    this.knowledgeSetupNavigation = new KnowledgeSetupNavigation({
      getProjectRecords: () => getCachedProjectRecords(),
      getCurrentProjectId: () => dependencies.getCurrentProjectId(),
      openCopilotSettings: () => this.openCopilotSettingsForKnowledgeSetup(),
      openVaultFile: (path) => this.openKnowledgeSetupVaultFile(path),
      openChat: () => {
        if (!this.knowledgeLifecycleClosed) return dependencies.openChat();
      },
      refreshDisplayedStatus: () => this.refreshKnowledgeSetupReadiness(),
      notify: (message) => {
        if (!this.knowledgeLifecycleClosed) new Notice(message);
      },
    });
    this.knowledgeLayoutCoordinator = new KnowledgePluginLayoutCoordinator({
      ensureInitialized: () => dependencies.ensureProjectsInitialized().then(() => undefined),
    });
  }

  /** Registers the optional Studio surfaces and begins the fail-closed startup lifecycle. */
  load(): void {
    if (this.loaded || this.knowledgeLifecycleClosed) return;
    this.loaded = true;
    try {
      this.plugin.register(() => this.close());
      this.knowledgeSetupSelectionUnsubscriber = this.dependencies.subscribeCurrentProjectChange(
        () => this.refreshKnowledgeSetupReadiness()
      );

      if (isKnowledgeStudioPlatformSupported()) {
        this.knowledgeModelManagementUnsubscriber = this.modelManagement.providerRegistry.subscribe(
          () => {
            if (this.knowledgeLifecycleClosed) return;
            this.invalidateKnowledgeProductionGeneration();
            this.refreshKnowledgeSetupReadiness();
          }
        );
        void this.initializeKnowledgeStartupPrerequisites();
        this.safeRegisterView(KNOWLEDGE_STUDIO_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
          const port = this.knowledgeStudioPort;
          const controller = new KnowledgeStudioController(port, port, port, port, port, port);
          return new KnowledgeStudioView(
            leaf,
            controller,
            this.knowledgeStudioSessionStore,
            this.knowledgeFolderImportPort,
            this.knowledgeSetupReadinessStore,
            this.knowledgeSetupNavigation
          );
        });
        this.plugin.addRibbonIcon("library-big", "Open Knowledge Studio", () => {
          void this.activateKnowledgeStudio();
        });
      }

      this.plugin.addCommand({
        id: "open-knowledge-studio",
        name: "Open Knowledge Studio",
        callback: () => void this.activateKnowledgeStudio(),
      });
      this.plugin.addCommand({
        id: "inspect-applied-knowledge-page",
        name: "Inspect applied Knowledge page",
        editorCheckCallback: (checking, _editor, context) =>
          checkKnowledgeWikiInspectionCommand(checking, context.file, {
            index: this.knowledgeAppliedWikiPathIndex,
            openInspector: (request) => this.openKnowledgeAppliedWikiInspector(request),
          }),
      });
      this.plugin.registerEvent(
        this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
          registerKnowledgeSourceMenu(menu, file, {
            index: this.knowledgeSourcePathIndex,
            openKnowledgeStudio: () => void this.activateKnowledgeStudio(),
          });
          registerKnowledgeWikiMenu(menu, file, {
            index: this.knowledgeAppliedWikiPathIndex,
            openInspector: (request) => this.openKnowledgeAppliedWikiInspector(request),
          });
        })
      );
      this.knowledgeProjectRecordsUnsubscriber = subscribeToProjectRecords(() => {
        this.invalidateKnowledgeProductionGeneration();
        this.refreshKnowledgeSetupReadiness();
      });
      this.app.workspace.onLayoutReady(() => {
        if (!this.knowledgeLifecycleClosed) {
          this.knowledgeLayoutCoordinator.onLayoutReady();
        }
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Rebuilds the optional Knowledge generation after a persisted settings change. */
  onSettingsChanged(): void {
    if (!this.loaded || this.knowledgeLifecycleClosed) return;
    this.invalidateKnowledgeProductionGeneration();
    this.refreshKnowledgeSetupReadiness();
  }

  /** Returns the stable least-authority Add-to-Knowledge command surface for Chat views. */
  getChatCapturePort(): KnowledgeChatCapturePort {
    return this.knowledgeChatCapturePort;
  }

  /** Permanently revokes every Knowledge capability before the host begins async teardown. */
  close(): void {
    if (this.knowledgeLifecycleClosed) return;
    this.knowledgeLifecycleClosed = true;
    this.closeKnowledgeAppliedWikiInspectorModals();
    try {
      this.knowledgeSetupReadinessStore.publish(createKnowledgeSetupUnloadedProjection());
    } catch {
      // Closed presentation state cannot reopen runtime authority.
    }
    this.knowledgeSetupSelectionUnsubscriber?.();
    this.knowledgeSetupSelectionUnsubscriber = undefined;
    this.knowledgeModelManagementUnsubscriber?.();
    this.knowledgeModelManagementUnsubscriber = undefined;
    this.knowledgeProjectRecordsUnsubscriber?.();
    this.knowledgeProjectRecordsUnsubscriber = undefined;
    this.knowledgeSetupReadinessStore.dispose();
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
    this.knowledgeAppliedWikiPageInspectorPort.dispose();
    this.knowledgeForwardRevisionProposalActionPort.dispose();
    this.knowledgeKnownAppliedWikiOutputsPort.dispose();
    this.knowledgeAppliedWikiPathIndex.dispose();
    this.knowledgeRuntime = undefined;
  }

  /** Registers a view without letting stale Obsidian state abort the remaining integration load. */
  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.plugin.registerView(type, viewCreator);
    } catch (error) {
      logWarn(`Copilot: view type "${type}" already registered; skipping re-registration.`, error);
    }
  }

  /**
   * Initializes the singleton Windows durable state foundation while keeping
   * the user surface fail-closed until parser/compiler/startup coordination is
   * complete.
   */
  private async initializeKnowledgeRuntimeFoundation(): Promise<void> {
    const generation = ++this.knowledgeRuntimeStartupGeneration;
    const pluginDirectory = this.plugin.manifest.dir;
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
          return new KnowledgeRuntimeStore(runtimeFile, {
            productionExecutionClaim: this.knowledgeProductionRuntimeExecutionClaim,
          });
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

  /** Projects the exact Quick Chat selection into a secret-free local status. */
  private projectKnowledgeChatReadiness(): KnowledgeChatModelReadiness {
    const settings = getSettings();
    const selection = settings.defaultModelKey;
    const selected = findChatBackendEntry(
      this.modelManagement.backendConfigRegistry.resolveEnabled("chat"),
      selection,
      {
        configuredModels: settings.configuredModels,
        providers: Object.values(settings.providers),
      }
    );
    if (!selected) {
      return Object.freeze({ reason: "missing" });
    }
    const credentialConfigured =
      !providerNeedsResolvedApiKey(selected.provider) ||
      (typeof selected.provider.apiKeyKeychainId === "string" &&
        selected.provider.apiKeyKeychainId.length > 0);
    return Object.freeze({
      reason: credentialConfigured ? "configured" : "credential_missing",
    });
  }

  /** Publishes one typed startup observation and the independent local Chat lane. */
  private publishKnowledgeSetupReadiness(state: KnowledgePluginStartupState): void {
    if (this.knowledgeLifecycleClosed) return;
    this.knowledgeSetupStartupState = state;
    this.knowledgeSetupReadinessStore.publishStartup(state, {
      projectCount: getCachedProjectRecords().length,
      chatModel: this.projectKnowledgeChatReadiness(),
    });
  }

  /** Reprojects current local state without rebuilding a workflow or contacting a provider. */
  private refreshKnowledgeSetupReadiness(): void {
    if (this.knowledgeLifecycleClosed) return;
    this.publishKnowledgeSetupReadiness(this.knowledgeSetupStartupState);
  }

  /** Opens the existing Copilot settings page without changing a setting. */
  private openCopilotSettingsForKnowledgeSetup(): void {
    if (this.knowledgeLifecycleClosed) return;
    try {
      const settingsApp = this.app as unknown as {
        setting?: { openTabById?: (id: string) => { display?: () => void } | undefined };
      };
      const tab = settingsApp.setting?.openTabById?.("copilot");
      if (!tab || typeof tab.display !== "function") {
        throw new TypeError("Copilot settings are unavailable");
      }
      tab.display();
    } catch {
      if (!this.knowledgeLifecycleClosed) {
        new Notice("Copilot settings could not be opened. Use Obsidian Settings → Copilot.");
      }
    }
  }

  /** Opens one currently re-proved Vault file for setup inspection. */
  private async openKnowledgeSetupVaultFile(path: string): Promise<void> {
    if (this.knowledgeLifecycleClosed || typeof path !== "string" || path.trim().length === 0) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.path !== path) {
      new Notice("That setup file is not available at its current Vault path.");
      return;
    }
    try {
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch {
      if (!this.knowledgeLifecycleClosed) {
        new Notice("That setup file could not be opened. No file was changed.");
      }
    }
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
          await this.dependencies.ensureProjectsInitialized();
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
          publishKnowledgeSetupThenStudioAuthority(
            state,
            (nextState) => this.publishKnowledgeSetupReadiness(nextState),
            (nextState) => this.knowledgeStudioStartupAvailability.setUnavailable(nextState)
          );
        },
        setReadReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          publishKnowledgeSetupThenStudioAuthority(
            state,
            (nextState) => this.publishKnowledgeSetupReadiness(nextState),
            (nextState) => this.knowledgeStudioStartupAvailability.setReadReady(nextState)
          );
        },
        setRecoveryReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          publishKnowledgeSetupThenStudioAuthority(
            state,
            (nextState) => this.publishKnowledgeSetupReadiness(nextState),
            (nextState) => this.knowledgeStudioStartupAvailability.setRecoveryReady(nextState)
          );
        },
        setSourceRecoveryReady: (state) => {
          if (this.knowledgeLifecycleClosed) {
            return;
          }
          publishKnowledgeSetupThenStudioAuthority(
            state,
            (nextState) => this.publishKnowledgeSetupReadiness(nextState),
            (nextState) => this.knowledgeStudioStartupAvailability.setSourceRecoveryReady(nextState)
          );
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
    const runtime = this.knowledgeRuntime;
    if (!runtime) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const observationCandidate = new KnowledgeProductionObservationComposer({
      app: this.app,
      runtime,
      workflowLease: result.admission.workflowLease,
      workflowCompositionClaim: result.admission.workflowCompositionClaim,
      notificationSink: this.knowledgeSourceIssueNotificationSink,
    });
    let recovery: KnowledgePluginRecoveryStartupPort | undefined;
    try {
      const forwardRevisionApplyRecovery =
        observationCandidate.createForwardRevisionApplyRecoveryRunner();
      recovery = this.createKnowledgeProductionRecoveryPort(
        result.admission,
        signal,
        forwardRevisionApplyRecovery
      );
      const observation = this.createKnowledgeProductionObservationPort(
        result.admission,
        signal,
        observationCandidate
      );
      return { kind: "configured", bundleIds: result.bundleIds, recovery, observation };
    } catch (error) {
      recovery?.close();
      observationCandidate.close();
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
   * @param forwardRevisionApplyRecovery - Genuine pre-Gate commit-wins recovery runner
   * @returns One-shot recovery capability consumed and closed by the startup barrier
   */
  private createKnowledgeProductionRecoveryPort(
    admission: KnowledgePluginProductionPreflightAdmission,
    startupSignal: AbortSignal,
    forwardRevisionApplyRecovery: ReturnType<
      KnowledgeProductionObservationComposer["createForwardRevisionApplyRecoveryRunner"]
    >
  ): KnowledgePluginRecoveryStartupPort {
    const runtime = this.knowledgeRuntime;
    if (!runtime) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    const candidate = new KnowledgeProductionRecoveryComposer({
      runtime,
      vault: this.app.vault,
      bundles: admission.owners.map(({ config }) => config),
      forwardRevisionApplyRecovery,
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

  /** Opens and lifecycle-tracks one value-only applied-Wiki inspection Modal. */
  private openKnowledgeAppliedWikiInspector(
    request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>
  ): void {
    if (this.knowledgeLifecycleClosed) return;
    let modal: KnowledgeAppliedWikiInspectorModal | undefined;
    try {
      const proposalAction = this.knowledgeForwardRevisionProposalActionPort.isAvailable()
        ? this.knowledgeForwardRevisionProposalActionPort
        : undefined;
      modal = new KnowledgeAppliedWikiInspectorModal(
        this.app,
        request,
        this.knowledgeAppliedWikiPageInspectorPort,
        (closedModal) => this.knowledgeAppliedWikiInspectorModals.delete(closedModal),
        this.knowledgeKnownAppliedWikiOutputsPort,
        proposalAction,
        (reviewRef) => {
          if (
            this.knowledgeLifecycleClosed ||
            !modal ||
            !this.knowledgeAppliedWikiInspectorModals.has(modal)
          ) {
            return;
          }
          const presentationHint = captureKnowledgeStudioPresentationHint(modal.contentEl);
          modal.close();
          void this.activateKnowledgeStudio("review", reviewRef, presentationHint);
        }
      );
      this.knowledgeAppliedWikiInspectorModals.add(modal);
      modal.open();
    } catch {
      if (modal) {
        this.knowledgeAppliedWikiInspectorModals.delete(modal);
        try {
          modal.close();
        } catch {
          // A partially opened presentation retains no production authority.
        }
      }
    }
  }

  /** Synchronously closes every active applied-Wiki inspector presentation. */
  private closeKnowledgeAppliedWikiInspectorModals(): void {
    const modals = [...this.knowledgeAppliedWikiInspectorModals];
    this.knowledgeAppliedWikiInspectorModals.clear();
    for (const modal of modals) {
      try {
        modal.close();
      } catch {
        // The stable delegate is revoked separately, so presentation cleanup is best-effort.
      }
    }
  }

  /**
   * Creates the long-lived observation port bound to the exact preflight generation.
   *
   * @param admission - Current generation's strict Bundle owners
   * @param startupSignal - Outer startup generation cancellation
   * @param candidate - Already-composed owner of the paired startup recovery runner
   * @returns Observation startup boundary retained after recovery is clear
   */
  private createKnowledgeProductionObservationPort(
    admission: KnowledgePluginProductionPreflightAdmission,
    startupSignal: AbortSignal,
    candidate: KnowledgeProductionObservationComposer
  ): KnowledgePluginObservationStartupPort {
    const runtime = this.knowledgeRuntime;
    if (!runtime) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
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
    let appliedWikiInspectorGeneration:
      | KnowledgeAppliedWikiPageInspectorGenerationLease
      | undefined;
    let knownAppliedWikiOutputsGeneration:
      | KnowledgeKnownAppliedWikiOutputsGenerationLease
      | undefined;
    let forwardRevisionProposalActionGeneration:
      | KnowledgeForwardRevisionProposalActionGenerationLease
      | undefined;
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
            appliedWikiInspectorGeneration =
              await tryPublishKnowledgeAppliedWikiPageInspectorGeneration({
                signal,
                createDelegate: () => candidate.createAppliedWikiPageInspectorCoordinator(),
                subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
                replaceDelegate: (delegate) =>
                  this.knowledgeAppliedWikiPageInspectorPort.replaceDelegate(delegate),
                revokeDelegate: (delegate) =>
                  this.knowledgeAppliedWikiPageInspectorPort.revokeDelegate(delegate),
                installPathIndex: (rows) => this.knowledgeAppliedWikiPathIndex.install(rows),
                revokePathIndex: (lease) => this.knowledgeAppliedWikiPathIndex.revoke(lease),
                assertCurrent,
                closePresentations: () => this.closeKnowledgeAppliedWikiInspectorModals(),
              });
            try {
              const delegate = candidate.createKnownAppliedWikiOutputsCoordinator();
              knownAppliedWikiOutputsGeneration =
                new KnowledgeKnownAppliedWikiOutputsGenerationLease({
                  delegate,
                  subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
                  replaceDelegate: (next) =>
                    this.knowledgeKnownAppliedWikiOutputsPort.replaceDelegate(next),
                  revokeDelegate: (next) =>
                    this.knowledgeKnownAppliedWikiOutputsPort.revokeDelegate(next),
                  assertCurrent,
                });
              try {
                if (admission.owners.length !== 1) throw new TypeError();
                const proposalAction = candidate.createForwardRevisionProposalActionAdapter(
                  this.knowledgeKnownAppliedWikiOutputsPort,
                  delegate,
                  (drain) => retainKnowledgeProductionDrain(this.app.vault, drain)
                );
                forwardRevisionProposalActionGeneration =
                  new KnowledgeForwardRevisionProposalActionGenerationLease({
                    delegate: proposalAction,
                    subscribeInvalidation: (listener) => candidate.subscribeClose(listener),
                    replaceDelegate: (next) =>
                      this.knowledgeForwardRevisionProposalActionPort.replaceDelegate(next),
                    revokeDelegate: (next) =>
                      this.knowledgeForwardRevisionProposalActionPort.revokeDelegate(next),
                    assertCurrent,
                  });
              } catch {
                this.knowledgeForwardRevisionProposalActionPort.setUnavailable();
              }
            } catch {
              this.knowledgeKnownAppliedWikiOutputsPort.setUnavailable();
              this.knowledgeForwardRevisionProposalActionPort.setUnavailable();
            }
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
          appliedWikiInspectorGeneration?.close();
          appliedWikiInspectorGeneration = undefined;
          forwardRevisionProposalActionGeneration?.close();
          forwardRevisionProposalActionGeneration = undefined;
          knownAppliedWikiOutputsGeneration?.close();
          knownAppliedWikiOutputsGeneration = undefined;
          this.closeKnowledgeAppliedWikiInspectorModals();
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
        appliedWikiInspectorGeneration?.close();
        appliedWikiInspectorGeneration = undefined;
        forwardRevisionProposalActionGeneration?.close();
        forwardRevisionProposalActionGeneration = undefined;
        knownAppliedWikiOutputsGeneration?.close();
        knownAppliedWikiOutputsGeneration = undefined;
        this.closeKnowledgeAppliedWikiInspectorModals();
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
   * Opens the Windows-only personal Knowledge Studio workspace.
   *
   * @param initialTab - Optional first Studio tab to select
   * @param forwardRevisionReviewRef - Optional opaque forward Review row to focus
   * @param presentationHint - Non-authoritative renderer realm that initiated navigation
   */
  async activateKnowledgeStudio(
    initialTab?: "review",
    forwardRevisionReviewRef?: string,
    presentationHint?: Readonly<KnowledgeStudioPresentationHint>
  ): Promise<void> {
    if (!isKnowledgeStudioPlatformSupported()) {
      new Notice("Knowledge Studio is currently available only in Obsidian Desktop on Windows.");
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType(KNOWLEDGE_STUDIO_VIEW_TYPE);
    if (presentationHint) {
      const allLeaves: WorkspaceLeaf[] = [];
      this.app.workspace.iterateAllLeaves((leaf) => allLeaves.push(leaf));
      const plan = planKnowledgeStudioPresentationNavigation(leaves, allLeaves, presentationHint);
      if (plan.kind === "existing") {
        this.app.workspace.revealLeaf(plan.leaf);
        if (initialTab === "review" && plan.leaf.view instanceof KnowledgeStudioView) {
          if (forwardRevisionReviewRef) {
            plan.leaf.view.focusPublishedForwardRevision(forwardRevisionReviewRef);
          } else {
            plan.leaf.view.selectReviewTab();
          }
        }
        return;
      }
      if (plan.kind === "create_adjacent") {
        const leaf = this.app.workspace.createLeafBySplit(plan.anchor);
        await leaf.setViewState({
          type: KNOWLEDGE_STUDIO_VIEW_TYPE,
          active: true,
        });
        this.app.workspace.revealLeaf(leaf);
        if (initialTab === "review" && leaf.view instanceof KnowledgeStudioView) {
          if (forwardRevisionReviewRef) {
            leaf.view.focusPublishedForwardRevision(forwardRevisionReviewRef);
          } else {
            leaf.view.selectReviewTab();
          }
        }
        return;
      }
    }

    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      if (initialTab === "review" && leaves[0].view instanceof KnowledgeStudioView) {
        if (forwardRevisionReviewRef) {
          leaves[0].view.focusPublishedForwardRevision(forwardRevisionReviewRef);
        } else {
          leaves[0].view.selectReviewTab();
        }
      }
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: KNOWLEDGE_STUDIO_VIEW_TYPE,
      active: true,
    });
    if (initialTab === "review" && leaf.view instanceof KnowledgeStudioView) {
      if (forwardRevisionReviewRef) {
        leaf.view.focusPublishedForwardRevision(forwardRevisionReviewRef);
      } else {
        leaf.view.selectReviewTab();
      }
    }
  }
}
