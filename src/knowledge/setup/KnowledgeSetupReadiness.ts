import type {
  KnowledgePluginStartupState,
  KnowledgePluginStartupStatus,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import type {
  KnowledgeChatModelReadiness,
  KnowledgeChatModelReadinessReason,
} from "@/knowledge/setup/KnowledgeChatModelReadiness";

/** Closed readiness levels rendered by the guided Knowledge setup surface. */
export type KnowledgeSetupReadinessLevel =
  | "checking"
  | "locally_ready"
  | "needs_action"
  | "blocked"
  | "not_applicable";

/** Closed reasons describing Project, Bundle, storage, and workflow readiness. */
export type KnowledgeSetupWorkspaceReason =
  | "startup_checking"
  | "plugin_unloaded"
  | "workspace_ready"
  | "durable_storage_unavailable"
  | "projects_unavailable"
  | "no_project"
  | "bundle_missing"
  | "bundle_configuration_invalid"
  | "multiple_bundles"
  | "configuration_needs_attention"
  | "recovery_unavailable"
  | "recovery_attention_required"
  | "recovery_blocked"
  | "source_recovery_required"
  | "workflow_adapters_unavailable";

/** Closed reasons describing only the Knowledge compiler/model lane. */
export type KnowledgeSetupKnowledgeModelReason =
  | "startup_checking"
  | "plugin_unloaded"
  | "knowledge_model_configured"
  | "workspace_unavailable"
  | "workspace_configuration_needs_attention"
  | "knowledge_model_missing"
  | "knowledge_model_ambiguous"
  | "knowledge_model_disabled"
  | "knowledge_model_not_project_enabled"
  | "knowledge_model_unsupported"
  | "knowledge_model_configuration_invalid"
  | "knowledge_model_endpoint_invalid"
  | "knowledge_model_credential_missing"
  | "knowledge_model_route_unavailable"
  | "configuration_needs_attention";

/** Exact, secret-free result of resolving the ordinary Chat model catalog locally. */
export type KnowledgeSetupChatModelSelectedState = KnowledgeChatModelReadinessReason;

/** Closed reasons describing the optional ordinary Chat lane. */
export type KnowledgeSetupChatModelReason =
  | "plugin_unloaded"
  | "chat_model_missing"
  | "chat_model_ambiguous"
  | "chat_model_disabled"
  | "chat_model_unsupported"
  | "chat_model_not_project_enabled"
  | "chat_model_credential_missing"
  | "chat_model_configured";

/** One immutable readiness item whose reason cannot contain a path, model key, or credential. */
export interface KnowledgeSetupReadinessItem<Reason extends string> {
  level: KnowledgeSetupReadinessLevel;
  reason: Reason;
}

/** Plain edge projection supplied without settings, application, network, or I/O authority. */
export interface KnowledgeSetupReadinessContext {
  /** Number of locally discovered Project records. */
  projectCount: number;
  /** Secret-free result of resolving the separate ordinary Chat model locally. */
  chatModel: KnowledgeChatModelReadiness;
}

/** Immutable, revision-free projection produced from one local startup observation. */
export interface KnowledgeSetupReadinessProjection {
  startupStatus: KnowledgePluginStartupStatus | "plugin_unloaded";
  workspace: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupWorkspaceReason>>;
  knowledgeModel: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupKnowledgeModelReason>>;
  /** Optional lane; its state never blocks Knowledge startup readiness. */
  chatModel: Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupChatModelReason>>;
  /** This local projector deliberately performs no provider request. */
  networkVerification: "not_tested";
}

/** Fixed input failure that never retains caller-owned settings or diagnostic text. */
export class KnowledgeSetupReadinessInputError extends TypeError {
  /** Creates one sanitized projection-boundary failure. */
  constructor() {
    super("Knowledge setup readiness input is invalid");
    this.name = "KnowledgeSetupReadinessInputError";
  }
}

type WorkspaceItem = Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupWorkspaceReason>>;
type KnowledgeModelItem = Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupKnowledgeModelReason>>;
type ChatModelItem = Readonly<KnowledgeSetupReadinessItem<KnowledgeSetupChatModelReason>>;

const STARTUP_STATUSES = new Set<KnowledgePluginStartupStatus>([
  "waiting_for_layout",
  "runtime_unavailable",
  "projects_unavailable",
  "bundle_unconfigured",
  "bundle_invalid",
  "recovery_unavailable",
  "recovery_attention_required",
  "recovery_blocked",
  "source_recovery_required",
  "workflow_adapters_unavailable",
  "workflow_read_ready",
]);

const CHAT_SELECTED_STATES = new Set<KnowledgeSetupChatModelSelectedState>([
  "missing",
  "ambiguous",
  "disabled",
  "unsupported",
  "not_project_enabled",
  "credential_missing",
  "configured",
]);

const WORKSPACE_DIAGNOSTICS = new Set([
  "project_id_invalid",
  "bundle_schema_invalid",
  "bundle_semantic_invalid",
  "bundle_id_duplicate",
  "wiki_root_overlap",
  "wiki_source_overlap",
  "schema_inside_wiki",
  "bundle_config_load_failed",
  "bundle_config_result_invalid",
  "bundle_config_invalid",
  "production_preflight_bundle_duplicate",
]);

const KNOWLEDGE_DIAGNOSTIC_REASONS = new Map<string, KnowledgeSetupKnowledgeModelReason>([
  ["production_preflight_profile_project_missing", "knowledge_model_configuration_invalid"],
  ["production_preflight_profile_model_key_invalid", "knowledge_model_missing"],
  ["production_preflight_profile_model_missing", "knowledge_model_missing"],
  ["production_preflight_profile_model_ambiguous", "knowledge_model_ambiguous"],
  ["production_preflight_profile_model_disabled", "knowledge_model_disabled"],
  ["production_preflight_profile_model_not_project_enabled", "knowledge_model_not_project_enabled"],
  ["production_preflight_profile_provider_unsupported", "knowledge_model_unsupported"],
  ["production_preflight_profile_model_unsupported", "knowledge_model_unsupported"],
  ["production_preflight_model_unsupported", "knowledge_model_unsupported"],
  ["production_preflight_route_model_unsupported", "knowledge_model_unsupported"],
  [
    "production_preflight_profile_configuration_unsupported",
    "knowledge_model_configuration_invalid",
  ],
  ["production_preflight_profile_model_behavior_invalid", "knowledge_model_configuration_invalid"],
  ["production_preflight_route_profile_invalid", "knowledge_model_configuration_invalid"],
  ["production_preflight_route_configuration_unsupported", "knowledge_model_configuration_invalid"],
  ["production_preflight_input_invalid", "knowledge_model_configuration_invalid"],
  ["production_preflight_profile_input_invalid", "knowledge_model_configuration_invalid"],
  ["production_preflight_profile_endpoint_invalid", "knowledge_model_endpoint_invalid"],
  ["production_preflight_route_endpoint_mismatch", "knowledge_model_endpoint_invalid"],
  ["production_preflight_route_credential_invalid", "knowledge_model_credential_missing"],
  ["production_preflight_route_dependency_invalid", "knowledge_model_route_unavailable"],
  ["production_preflight_route_invalid", "knowledge_model_route_unavailable"],
  ["production_preflight_closed", "knowledge_model_route_unavailable"],
]);

const KNOWLEDGE_REASON_PRIORITY: readonly KnowledgeSetupKnowledgeModelReason[] = Object.freeze([
  "knowledge_model_credential_missing",
  "knowledge_model_missing",
  "knowledge_model_ambiguous",
  "knowledge_model_disabled",
  "knowledge_model_not_project_enabled",
  "knowledge_model_unsupported",
  "knowledge_model_endpoint_invalid",
  "knowledge_model_configuration_invalid",
  "knowledge_model_route_unavailable",
]);

/** Creates and freezes one closed readiness item. */
function createItem<Reason extends string>(
  level: KnowledgeSetupReadinessLevel,
  reason: Reason
): Readonly<KnowledgeSetupReadinessItem<Reason>> {
  return Object.freeze({ level, reason });
}

/** Creates the immutable revision-free output shared by projector branches. */
function createProjection(
  startupStatus: KnowledgePluginStartupStatus | "plugin_unloaded",
  workspace: WorkspaceItem,
  knowledgeModel: KnowledgeModelItem,
  chatModel: ChatModelItem
): KnowledgeSetupReadinessProjection {
  return Object.freeze({
    startupStatus,
    workspace,
    knowledgeModel,
    chatModel,
    networkVerification: "not_tested" as const,
  });
}

/** Reads one enumerable own data field without executing an accessor. */
function readOwnData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSetupReadinessInputError();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new KnowledgeSetupReadinessInputError();
  }
  return descriptor.value;
}

/** Captures and validates the non-authoritative edge context. */
function readContext(context: KnowledgeSetupReadinessContext): {
  projectCount: number;
  chatState: KnowledgeSetupChatModelSelectedState;
} {
  const projectCount = readOwnData(context, "projectCount");
  const chatModel = readOwnData(context, "chatModel");
  const chatState = readOwnData(chatModel, "reason");
  if (
    !Number.isSafeInteger(projectCount) ||
    (projectCount as number) < 0 ||
    typeof chatState !== "string" ||
    !CHAT_SELECTED_STATES.has(chatState as KnowledgeSetupChatModelSelectedState)
  ) {
    throw new KnowledgeSetupReadinessInputError();
  }
  return {
    projectCount: projectCount as number,
    chatState: chatState as KnowledgeSetupChatModelSelectedState,
  };
}

/** Captures only the startup status after proving the state is a current closed-vocabulary value. */
function readStartupStatus(state: KnowledgePluginStartupState): KnowledgePluginStartupStatus {
  const generation = readOwnData(state, "generation");
  const status = readOwnData(state, "status");
  if (
    !Number.isSafeInteger(generation) ||
    (generation as number) < 0 ||
    typeof status !== "string" ||
    !STARTUP_STATUSES.has(status as KnowledgePluginStartupStatus)
  ) {
    throw new KnowledgeSetupReadinessInputError();
  }
  return status as KnowledgePluginStartupStatus;
}

/** Reads a bounded dense string array without retaining any caller-owned element. */
function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new KnowledgeSetupReadinessInputError();
  }
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new KnowledgeSetupReadinessInputError();
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

/** Returns only the configured Bundle count, discarding every identity immediately. */
function readBundleCount(state: KnowledgePluginStartupState): number {
  return readStringArray(readOwnData(state, "bundleIds")).length;
}

/** Projects the ordinary Chat catalog result without affecting either Knowledge lane. */
function projectChatModel(state: KnowledgeSetupChatModelSelectedState): ChatModelItem {
  switch (state) {
    case "missing":
      return createItem("needs_action", "chat_model_missing");
    case "ambiguous":
      return createItem("needs_action", "chat_model_ambiguous");
    case "disabled":
      return createItem("needs_action", "chat_model_disabled");
    case "unsupported":
      return createItem("needs_action", "chat_model_unsupported");
    case "not_project_enabled":
      return createItem("needs_action", "chat_model_not_project_enabled");
    case "credential_missing":
      return createItem("needs_action", "chat_model_credential_missing");
    case "configured":
      return createItem("locally_ready", "chat_model_configured");
  }
}

/** Chooses a deterministic model reason when several safe diagnostics are present. */
function selectKnowledgeReason(
  reasons: ReadonlySet<KnowledgeSetupKnowledgeModelReason>
): KnowledgeSetupKnowledgeModelReason | undefined {
  return KNOWLEDGE_REASON_PRIORITY.find((reason) => reasons.has(reason));
}

/** Maps invalid-Bundle diagnostics to the two separate configuration lanes. */
function projectInvalidBundle(state: KnowledgePluginStartupState): {
  workspace: WorkspaceItem;
  knowledgeModel: KnowledgeModelItem;
} {
  const diagnostics = readStringArray(readOwnData(state, "diagnosticCodes"));
  if (diagnostics.length === 0) {
    return {
      workspace: createItem("needs_action", "configuration_needs_attention"),
      knowledgeModel: createItem("needs_action", "configuration_needs_attention"),
    };
  }

  let hasWorkspaceDiagnostic = false;
  let hasUnknownDiagnostic = false;
  const modelReasons = new Set<KnowledgeSetupKnowledgeModelReason>();
  for (const diagnostic of diagnostics) {
    if (WORKSPACE_DIAGNOSTICS.has(diagnostic)) {
      hasWorkspaceDiagnostic = true;
      continue;
    }
    const modelReason = KNOWLEDGE_DIAGNOSTIC_REASONS.get(diagnostic);
    if (modelReason) {
      modelReasons.add(modelReason);
      continue;
    }
    hasUnknownDiagnostic = true;
  }

  if (hasUnknownDiagnostic) {
    return {
      workspace: createItem("needs_action", "configuration_needs_attention"),
      knowledgeModel: createItem("needs_action", "configuration_needs_attention"),
    };
  }

  const modelReason = selectKnowledgeReason(modelReasons);
  const workspace = hasWorkspaceDiagnostic
    ? createItem("needs_action", "bundle_configuration_invalid" as const)
    : createItem("locally_ready", "workspace_ready" as const);
  if (modelReason) {
    return {
      workspace,
      knowledgeModel: createItem(
        modelReason === "knowledge_model_route_unavailable" ? "blocked" : "needs_action",
        modelReason
      ),
    };
  }
  return {
    workspace,
    knowledgeModel: hasWorkspaceDiagnostic
      ? createItem("not_applicable", "workspace_configuration_needs_attention")
      : createItem("needs_action", "configuration_needs_attention"),
  };
}

/** Projects one preflight-admitted status with exact Bundle-selection semantics. */
function projectConfiguredStatus(
  status: KnowledgePluginStartupStatus,
  bundleCount: number
): { workspace: WorkspaceItem; knowledgeModel: KnowledgeModelItem } {
  const knowledgeModel = createItem("locally_ready", "knowledge_model_configured" as const);
  switch (status) {
    case "recovery_unavailable":
      return { workspace: createItem("blocked", "recovery_unavailable"), knowledgeModel };
    case "recovery_attention_required":
      return {
        workspace: createItem("blocked", "recovery_attention_required"),
        knowledgeModel,
      };
    case "recovery_blocked":
      return { workspace: createItem("blocked", "recovery_blocked"), knowledgeModel };
    case "source_recovery_required":
      return { workspace: createItem("blocked", "source_recovery_required"), knowledgeModel };
    case "workflow_adapters_unavailable":
      if (bundleCount !== 1) {
        return {
          workspace: createItem("needs_action", "multiple_bundles"),
          knowledgeModel,
        };
      }
      return {
        workspace: createItem("blocked", "workflow_adapters_unavailable"),
        knowledgeModel,
      };
    case "workflow_read_ready":
      if (bundleCount !== 1) {
        return {
          workspace: createItem("needs_action", "multiple_bundles"),
          knowledgeModel,
        };
      }
      return { workspace: createItem("locally_ready", "workspace_ready"), knowledgeModel };
    default:
      throw new KnowledgeSetupReadinessInputError();
  }
}

/** Creates the fixed fail-closed projection published immediately before plugin unload. */
export function createKnowledgeSetupUnloadedProjection(): KnowledgeSetupReadinessProjection {
  return createProjection(
    "plugin_unloaded",
    createItem("blocked", "plugin_unloaded"),
    createItem("blocked", "plugin_unloaded"),
    createItem("blocked", "plugin_unloaded")
  );
}

/**
 * Projects one local startup observation into a secret-free guided setup snapshot.
 *
 * A `locally_ready` result proves only catalog/configuration preflight. The
 * projector never performs provider connectivity, billing, quota, or model calls.
 * The ordinary Chat lane is optional and cannot downgrade Knowledge readiness.
 *
 * @param startupState - Sanitized state from the Knowledge startup barrier
 * @param context - Plain Project count and exact local Chat catalog result
 * @returns Frozen local readiness projection with closed reasons only
 */
export function projectKnowledgeSetupReadiness(
  startupState: KnowledgePluginStartupState,
  context: KnowledgeSetupReadinessContext
): KnowledgeSetupReadinessProjection {
  try {
    const status = readStartupStatus(startupState);
    const { projectCount, chatState } = readContext(context);
    const chatModel = projectChatModel(chatState);

    switch (status) {
      case "waiting_for_layout":
        return createProjection(
          status,
          createItem("checking", "startup_checking"),
          createItem("checking", "startup_checking"),
          chatModel
        );
      case "runtime_unavailable":
        return createProjection(
          status,
          createItem("blocked", "durable_storage_unavailable"),
          createItem("blocked", "workspace_unavailable"),
          chatModel
        );
      case "projects_unavailable":
        return createProjection(
          status,
          createItem("blocked", "projects_unavailable"),
          createItem("blocked", "workspace_unavailable"),
          chatModel
        );
      case "bundle_unconfigured": {
        const hasProject = projectCount > 0;
        return createProjection(
          status,
          createItem("needs_action", hasProject ? "bundle_missing" : "no_project"),
          createItem(
            "not_applicable",
            hasProject ? "workspace_configuration_needs_attention" : "workspace_unavailable"
          ),
          chatModel
        );
      }
      case "bundle_invalid": {
        const projection = projectInvalidBundle(startupState);
        return createProjection(status, projection.workspace, projection.knowledgeModel, chatModel);
      }
      case "recovery_unavailable":
      case "recovery_attention_required":
      case "recovery_blocked":
      case "source_recovery_required":
      case "workflow_adapters_unavailable":
      case "workflow_read_ready": {
        const projection = projectConfiguredStatus(status, readBundleCount(startupState));
        return createProjection(status, projection.workspace, projection.knowledgeModel, chatModel);
      }
    }
  } catch (error) {
    if (error instanceof KnowledgeSetupReadinessInputError) {
      throw error;
    }
    throw new KnowledgeSetupReadinessInputError();
  }
}
