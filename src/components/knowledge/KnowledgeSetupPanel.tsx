import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  FileCog,
  FolderCog,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings2,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";
import type {
  KnowledgeSetupChatModelReason,
  KnowledgeSetupKnowledgeModelReason,
  KnowledgeSetupReadinessItem,
  KnowledgeSetupReadinessLevel,
  KnowledgeSetupReadinessProjection,
  KnowledgeSetupWorkspaceReason,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import type { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";

/** Props for the local-only guided Knowledge setup and status surface. */
export interface KnowledgeSetupPanelProps {
  readiness: KnowledgeSetupReadinessStore;
  navigation: KnowledgeSetupNavigationPort;
  /** Safe startup notice retained for context when Studio cannot open. */
  unavailableNotice?: string;
  /** Presence turns the full-page setup surface into a reversible Studio overlay. */
  onBack?: () => void;
}

interface SetupAction {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  run: () => void | Promise<void>;
}

interface SetupCardProps<Reason extends string> {
  title: string;
  summary: string;
  item: Readonly<KnowledgeSetupReadinessItem<Reason>>;
  reasonCopy: Readonly<Record<Reason, string>>;
  actions: readonly SetupAction[];
}

const LEVEL_LABELS: Readonly<Record<KnowledgeSetupReadinessLevel, string>> = {
  checking: "Checking",
  locally_ready: "Configured locally",
  needs_action: "Needs setup",
  blocked: "Needs attention",
  not_applicable: "Waiting on another step",
};

const WORKSPACE_REASON_COPY: Readonly<Record<KnowledgeSetupWorkspaceReason, string>> = {
  startup_checking: "Obsidian is still checking the local workspace and durable state.",
  plugin_unloaded: "The plugin is unloading. Setup checks and actions are no longer available.",
  workspace_ready: "The Knowledge Bundle structure and paths passed local validation.",
  durable_storage_unavailable:
    "Knowledge Studio cannot use its Windows runtime or durable storage right now. This is not a configuration prompt, and nothing was changed.",
  projects_unavailable:
    "Project records could not be read safely. Knowledge Studio stayed closed and changed nothing.",
  no_project:
    "Create a Copilot Project first. That Project will hold the Bundle that connects your source, Wiki, and rules locations.",
  bundle_missing:
    "One or more Projects exist, but none contains one complete Knowledge Bundle configuration.",
  bundle_configuration_invalid:
    "The Bundle paths or rules configuration needs attention before Knowledge Studio can use it.",
  multiple_bundles:
    "Knowledge Studio needs exactly one active Bundle for this guided workflow. Keep the Bundle block in only one Project for now; multi-Bundle selection is not available.",
  configuration_needs_attention:
    "The local Project or Bundle configuration needs attention before Knowledge Studio can continue.",
  recovery_unavailable:
    "Durable recovery state could not be read safely. Keep the files in place; after checking Project or settings changes, reload Copilot once to retry startup.",
  recovery_attention_required:
    "A durable operation needs review in the Studio Recovery section before normal work continues.",
  recovery_blocked:
    "Recovery is blocked. Return to Studio to inspect the durable recovery item; no automatic repair was attempted.",
  source_recovery_required:
    "A configured source needs attention. Return to Studio and use the Sources or Recovery section.",
  workflow_adapters_unavailable:
    "The workspace is configured, but the safe workflow adapters are not available in this session.",
};

const KNOWLEDGE_MODEL_REASON_COPY: Readonly<Record<KnowledgeSetupKnowledgeModelReason, string>> = {
  startup_checking: "The Knowledge model configuration will be checked after startup settles.",
  plugin_unloaded: "The plugin is unloading, so this model status is no longer active.",
  knowledge_model_configured:
    "The Project's separate Knowledge model and credential are configured locally.",
  workspace_unavailable:
    "Knowledge model readiness cannot be decided until the workspace is available.",
  workspace_configuration_needs_attention:
    "Finish the Project and Bundle configuration before checking the Knowledge model.",
  knowledge_model_missing: "Choose a supported Knowledge model in the Project file.",
  knowledge_model_ambiguous:
    "More than one catalog entry matches the configured Knowledge model. Choose one exact entry.",
  knowledge_model_disabled: "The selected Knowledge model is disabled in the model catalog.",
  knowledge_model_not_project_enabled:
    "Enable the selected model for Projects before using it for Knowledge work.",
  knowledge_model_unsupported:
    "The selected model or provider is not supported by this Knowledge workflow.",
  knowledge_model_configuration_invalid:
    "The selected Knowledge model has settings that this workflow cannot use safely.",
  knowledge_model_endpoint_invalid:
    "The Knowledge model endpoint does not match the supported provider configuration.",
  knowledge_model_credential_missing:
    "Add the provider credential in Copilot settings. The credential is never displayed here.",
  knowledge_model_route_unavailable:
    "The local Knowledge model route could not be constructed safely. No provider request was made.",
  configuration_needs_attention:
    "The local Knowledge model configuration needs attention before it can be used.",
};

const CHAT_MODEL_REASON_COPY: Readonly<Record<KnowledgeSetupChatModelReason, string>> = {
  plugin_unloaded: "The plugin is unloading, so this model status is no longer active.",
  chat_model_missing:
    "No Chat model is selected for the current conversation mode. Knowledge Studio can still be configured without it.",
  chat_model_ambiguous:
    "More than one catalog entry matches the selected Chat model. Choose one exact entry.",
  chat_model_disabled:
    "The selected Chat model is disabled. This does not block the core Knowledge workflow.",
  chat_model_unsupported:
    "The selected Chat model is not runnable by ordinary Chat in its current configuration.",
  chat_model_not_project_enabled:
    "The selected Chat model is not enabled for Project conversations. This does not block the core Knowledge workflow.",
  chat_model_credential_missing:
    "Add the Chat provider credential if you want to discuss notes or create material through Chat.",
  chat_model_configured:
    "The ordinary Chat model is configured locally. It remains separate from the Knowledge model.",
};

/** Subscribes React to the immutable local readiness projection. */
function useKnowledgeSetupReadiness(
  store: KnowledgeSetupReadinessStore
): KnowledgeSetupReadinessProjection {
  const subscribe = React.useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = React.useCallback(() => store.getState(), [store]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Returns the status icon associated with one closed readiness level. */
function getLevelIcon(
  level: KnowledgeSetupReadinessLevel
): React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }> {
  switch (level) {
    case "checking":
      return Loader2;
    case "locally_ready":
      return CheckCircle2;
    case "needs_action":
      return AlertCircle;
    case "blocked":
      return ShieldAlert;
    case "not_applicable":
      return CircleDashed;
  }
}

/** Returns restrained Obsidian-theme styling for one readiness level. */
function getLevelClasses(level: KnowledgeSetupReadinessLevel): string {
  switch (level) {
    case "locally_ready":
      return "tw-text-success";
    case "needs_action":
      return "tw-text-warning";
    case "blocked":
      return "tw-text-error";
    case "checking":
    case "not_applicable":
      return "tw-text-muted";
  }
}

/** Invokes one least-authority navigation action without leaking adapter failures. */
function invokeNavigation(action: () => void | Promise<void>): void {
  try {
    void Promise.resolve(action()).catch(() => undefined);
  } catch {
    // The adapter owns user-visible navigation feedback; the panel retains no error detail.
  }
}

/** Renders one plain-language readiness card and its narrow navigation actions. */
function SetupCard<Reason extends string>({
  title,
  summary,
  item,
  reasonCopy,
  actions,
}: SetupCardProps<Reason>): React.ReactElement {
  const StatusIcon = getLevelIcon(item.level);
  const statusClasses = getLevelClasses(item.level);

  return (
    <article className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-min-w-0">
          <h2 className="tw-m-0 tw-text-sm tw-font-semibold">{title}</h2>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">{summary}</p>
        </div>
        <Badge className={`tw-shrink-0 tw-gap-1 ${statusClasses}`} variant="outline">
          <StatusIcon
            aria-hidden="true"
            className={`tw-size-3 ${item.level === "checking" ? "tw-animate-spin" : ""}`}
          />
          {LEVEL_LABELS[item.level]}
        </Badge>
      </div>
      <p className="tw-m-0 tw-mt-3 tw-text-sm">{reasonCopy[item.reason]}</p>
      {actions.length > 0 ? (
        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
          {actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.label}
                size="sm"
                variant="secondary"
                onClick={() => invokeNavigation(action.run)}
              >
                <ActionIcon aria-hidden="true" className="tw-size-3" />
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

/** Chooses safe workspace navigation without presenting recovery failures as setup prompts. */
function getWorkspaceActions(
  item: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupWorkspaceReason>>,
  navigation: KnowledgeSetupNavigationPort
): readonly SetupAction[] {
  switch (item.reason) {
    case "no_project":
      return [
        {
          label: "Open Chat",
          icon: MessageSquare,
          run: () => navigation.openChat(),
        },
      ];
    case "bundle_configuration_invalid":
    case "configuration_needs_attention":
      return [
        { label: "Open Project file", icon: FolderCog, run: () => navigation.openProjectFile() },
      ];
    case "bundle_missing":
    case "multiple_bundles":
      return [
        { label: "Open Chat", icon: MessageSquare, run: () => navigation.openChat() },
        {
          label: "Open selected Project file",
          icon: FolderCog,
          run: () => navigation.openProjectFile(),
        },
      ];
    case "workspace_ready":
      return [
        { label: "Open Project file", icon: FolderCog, run: () => navigation.openProjectFile() },
        { label: "Open Knowledge rules", icon: FileCog, run: () => navigation.openSchema() },
      ];
    case "startup_checking":
    case "plugin_unloaded":
      return [];
    case "durable_storage_unavailable":
    case "projects_unavailable":
    case "recovery_unavailable":
    case "recovery_attention_required":
    case "recovery_blocked":
    case "source_recovery_required":
    case "workflow_adapters_unavailable":
      return [];
  }
}

/** Chooses Knowledge-model navigation while keeping provider credentials out of the panel. */
function getKnowledgeModelActions(
  item: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupKnowledgeModelReason>>,
  navigation: KnowledgeSetupNavigationPort
): readonly SetupAction[] {
  switch (item.reason) {
    case "knowledge_model_credential_missing":
      return [
        {
          label: "Open Copilot settings",
          icon: Settings2,
          run: () => navigation.openCopilotSettings(),
        },
      ];
    case "knowledge_model_missing":
    case "knowledge_model_ambiguous":
    case "knowledge_model_disabled":
    case "knowledge_model_not_project_enabled":
    case "knowledge_model_unsupported":
    case "knowledge_model_configuration_invalid":
    case "knowledge_model_endpoint_invalid":
    case "configuration_needs_attention":
      return [
        { label: "Open Project file", icon: FolderCog, run: () => navigation.openProjectFile() },
        {
          label: "Open Copilot settings",
          icon: Settings2,
          run: () => navigation.openCopilotSettings(),
        },
      ];
    case "knowledge_model_route_unavailable":
      return [];
    case "startup_checking":
    case "plugin_unloaded":
    case "knowledge_model_configured":
    case "workspace_unavailable":
    case "workspace_configuration_needs_attention":
      return [];
  }
}

/** Chooses optional Chat navigation without making Chat a Knowledge startup requirement. */
function getChatModelActions(
  item: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupChatModelReason>>,
  navigation: KnowledgeSetupNavigationPort
): readonly SetupAction[] {
  if (item.reason === "plugin_unloaded") {
    return [];
  }
  if (item.reason === "chat_model_configured") {
    return [{ label: "Open Chat", icon: MessageSquare, run: () => navigation.openChat() }];
  }
  return [
    {
      label: "Open Copilot settings",
      icon: Settings2,
      run: () => navigation.openCopilotSettings(),
    },
    { label: "Open Chat", icon: MessageSquare, run: () => navigation.openChat() },
  ];
}

/**
 * Renders a guided, read-only view of local Knowledge and Chat readiness.
 *
 * The component never creates files, changes settings, reads credentials, or
 * contacts a provider. All outbound capabilities are explicit navigation only.
 */
export function KnowledgeSetupPanel({
  readiness,
  navigation,
  unavailableNotice,
  onBack,
}: KnowledgeSetupPanelProps): React.ReactElement {
  const snapshot = useKnowledgeSetupReadiness(readiness);
  const headingId = React.useId();
  const interactionsDisabled = snapshot.startupStatus === "plugin_unloaded";
  const workspaceBlocked = snapshot.workspace.level === "blocked";
  const coreConfiguredLocally =
    snapshot.workspace.level === "locally_ready" &&
    snapshot.knowledgeModel.level === "locally_ready";
  const title = workspaceBlocked
    ? "Knowledge Studio needs attention"
    : coreConfiguredLocally
      ? "Knowledge Studio setup & status"
      : "Set up Knowledge Studio";

  return (
    <main className="tw-h-full tw-overflow-auto tw-p-4">
      <section aria-labelledby={headingId} className="tw-mx-auto tw-max-w-3xl tw-space-y-4">
        <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
          <div>
            {onBack && !interactionsDisabled ? (
              <Button className="tw-mb-2" size="sm" variant="ghost" onClick={onBack}>
                <ArrowLeft aria-hidden="true" className="tw-size-3" />
                Back to Studio
              </Button>
            ) : null}
            <h1 id={headingId} className="tw-m-0 tw-text-lg tw-font-semibold">
              {title}
            </h1>
            <p className="tw-m-0 tw-mt-1 tw-max-w-2xl tw-text-sm tw-text-muted">
              See what is ready and open the right place to finish setup. This page does not change
              settings or create files.
            </p>
          </div>
          {interactionsDisabled ? null : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => invokeNavigation(() => navigation.refreshDisplayedStatus())}
            >
              <RefreshCw aria-hidden="true" className="tw-size-3" />
              Refresh displayed status
            </Button>
          )}
        </header>

        {unavailableNotice && workspaceBlocked ? (
          <aside
            className={`tw-rounded-lg tw-p-3 tw-text-sm ${
              workspaceBlocked ? "tw-bg-error tw-text-error" : "tw-bg-secondary-alt tw-text-muted"
            }`}
            role={workspaceBlocked ? "alert" : "note"}
          >
            {unavailableNotice}
          </aside>
        ) : null}

        <div aria-live="polite" className="tw-grid tw-gap-3">
          <SetupCard
            actions={
              interactionsDisabled ? [] : getWorkspaceActions(snapshot.workspace, navigation)
            }
            item={snapshot.workspace}
            reasonCopy={WORKSPACE_REASON_COPY}
            summary="Project and Bundle configuration, plus Knowledge startup state."
            title="Workspace"
          />
          <SetupCard
            actions={
              interactionsDisabled
                ? []
                : getKnowledgeModelActions(snapshot.knowledgeModel, navigation)
            }
            item={snapshot.knowledgeModel}
            reasonCopy={KNOWLEDGE_MODEL_REASON_COPY}
            summary="Runs Knowledge analysis and grounded queries. This is separate from Chat."
            title="Knowledge model"
          />
          <SetupCard
            actions={
              interactionsDisabled ? [] : getChatModelActions(snapshot.chatModel, navigation)
            }
            item={snapshot.chatModel}
            reasonCopy={CHAT_MODEL_REASON_COPY}
            summary="Optional here; used for ordinary Chat and Chat-to-source work."
            title="Chat model (optional)"
          />
        </div>

        <aside
          className="tw-rounded-lg tw-bg-secondary-alt tw-p-3 tw-text-xs tw-text-muted"
          role="note"
        >
          Local check only: this status check sent no model request. Credential validity, license
          entitlement, billing, quota, connectivity, and local model server availability were not
          tested.
        </aside>
      </section>
    </main>
  );
}
