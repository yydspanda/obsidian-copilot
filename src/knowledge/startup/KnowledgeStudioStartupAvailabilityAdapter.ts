import type {
  KnowledgePluginStartupState,
  KnowledgeStudioStartupAvailabilityPort,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import type { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";

/**
 * Maps one safe startup state to a user-facing fail-closed Studio explanation.
 *
 * @param state - Sanitized plugin startup observation
 * @returns Notice containing no project paths, raw configuration, or error text
 */
export function getKnowledgeStartupNotice(state: KnowledgePluginStartupState): string {
  switch (state.status) {
    case "waiting_for_layout":
      return "Knowledge Studio is waiting for durable storage, the Vault layout, and project configuration.";
    case "runtime_unavailable":
      return "Durable knowledge storage needs attention before Knowledge Studio can start. No knowledge files were changed.";
    case "projects_unavailable":
      return "Projects could not be loaded, so Knowledge Studio remains unavailable. No knowledge files were changed.";
    case "bundle_unconfigured":
      return "No project has a Knowledge Bundle configuration. Add one to project.md before using Knowledge Studio.";
    case "bundle_invalid":
      return "A project Knowledge Bundle configuration is invalid or conflicts with another Bundle. Fix project.md; startup will retry after Projects refresh.";
    case "recovery_unavailable":
      return "Knowledge startup recovery could not be completed safely. New ingest, model calls, and Wiki writes remain stopped.";
    case "recovery_attention_required":
      return "Knowledge startup found durable work that needs an explicit recovery decision. Open Recovery to continue eligible work or abandon an eligible no-journal apply; new ingest work remains stopped.";
    case "recovery_blocked":
      if (state.attentionKinds.includes("forward_revision_apply_recovery_required")) {
        return "A reviewed Wiki revision could not be safely reconciled with the current note, so Knowledge startup remains blocked. No new AI or Wiki work will run until the durable conflict is resolved and startup is retried.";
      }
      return "Knowledge startup is blocked by durable recovery state. Open Recovery to inspect and recheck it; unsafe actions remain disabled to protect existing notes.";
    case "source_recovery_required":
      return "Knowledge startup found a missing or moved source. Open Sources to recheck it or remove its registration; ingest, model calls, Review, Apply, Query, and Wiki writes remain stopped.";
    case "workflow_adapters_unavailable":
      return state.bundleIds.length === 1
        ? "The project Knowledge Bundle is valid and startup recovery is clear, but the live workflow adapter is unavailable. Activity, Review, Apply, and Query remain disabled."
        : "The project Knowledge Bundles are valid and startup recovery is clear, but the live workflow adapter and Bundle selection are unavailable. Activity, Review, Apply, and Query remain disabled.";
    case "workflow_read_ready":
      return state.bundleIds.length === 1
        ? "Live durable Activity and Review are connected. Whole-proposal rejection and explicit reviewed create/update apply are available; delete acceptance and Query remain disabled."
        : "Live durable Activity and Review are available, but Bundle selection is not connected yet.";
  }
}

/** Selects one exact configured Bundle for an unavailable recovery/workflow state. */
function selectUnavailableBundleId(state: KnowledgePluginStartupState): string | undefined {
  if (
    (state.status === "recovery_attention_required" || state.status === "recovery_blocked") &&
    state.bundleIds.includes(state.recoveryBundleId)
  ) {
    return state.recoveryBundleId;
  }
  if (
    state.status === "source_recovery_required" &&
    state.bundleIds.includes(state.sourceRecoveryBundleId)
  ) {
    return state.sourceRecoveryBundleId;
  }
  if (
    (state.status === "recovery_unavailable" ||
      state.status === "recovery_attention_required" ||
      state.status === "recovery_blocked" ||
      state.status === "source_recovery_required" ||
      state.status === "workflow_adapters_unavailable") &&
    state.bundleIds.length === 1
  ) {
    return state.bundleIds[0];
  }
  return undefined;
}

/**
 * Fail-closed adapter from safe startup observations to stable Studio boundaries.
 *
 * It can only install unavailable delegates. Exactly one validated Bundle becomes
 * the current session identity; zero or multiple Bundles clear selection instead
 * of inventing a default.
 */
export class KnowledgeStudioStartupAvailabilityAdapter implements KnowledgeStudioStartupAvailabilityPort {
  /**
   * Creates the one-way unavailable adapter.
   *
   * @param port - Stable delegate-replacement boundary retained by every View
   * @param sessions - Dynamic exact Bundle selection observed by every View
   */
  constructor(
    private readonly port: Pick<DelegatingKnowledgeStudioPort, "replaceDelegate">,
    private readonly sessions: Pick<
      KnowledgeStudioSessionStore,
      "publishRefreshing" | "replaceSelection"
    >
  ) {}

  /**
   * Revokes the prior delegate before publishing either transient refresh or durable failure.
   *
   * Only layout-waiting is transient. Every runtime, project, configuration,
   * recovery, and workflow failure remains an explicit unavailable selection.
   */
  setUnavailable(state: KnowledgePluginStartupState): void {
    const notice = getKnowledgeStartupNotice(state);
    this.port.replaceDelegate(new UnavailableKnowledgeStudioPort(notice));
    if (state.status === "waiting_for_layout") {
      this.sessions.publishRefreshing();
      return;
    }
    this.sessions.replaceSelection(selectUnavailableBundleId(state), notice);
  }

  /** Publishes one exact Studio-ready Bundle after its live delegate was staged. */
  setReadReady(
    state: Extract<KnowledgePluginStartupState, { status: "workflow_read_ready" }>
  ): void {
    const notice = getKnowledgeStartupNotice(state);
    if (state.bundleIds.length !== 1) {
      this.port.replaceDelegate(new UnavailableKnowledgeStudioPort(notice));
      this.sessions.replaceSelection(undefined, notice);
      return;
    }
    this.sessions.replaceSelection(state.bundleIds[0], notice);
  }

  /** Publishes one staged recovery-only delegate for the exact stopped Bundle. */
  setRecoveryReady(
    state: Extract<
      KnowledgePluginStartupState,
      { status: "recovery_attention_required" | "recovery_blocked" }
    >
  ): void {
    const notice = getKnowledgeStartupNotice(state);
    if (!state.bundleIds.includes(state.recoveryBundleId)) {
      this.port.replaceDelegate(new UnavailableKnowledgeStudioPort(notice));
      this.sessions.replaceSelection(undefined, notice);
      return;
    }
    this.sessions.replaceSelection(state.recoveryBundleId, notice);
  }

  /** Publishes one staged source-lifecycle-only delegate for the exact stopped Bundle. */
  setSourceRecoveryReady(
    state: Extract<KnowledgePluginStartupState, { status: "source_recovery_required" }>
  ): void {
    const notice = getKnowledgeStartupNotice(state);
    if (!state.bundleIds.includes(state.sourceRecoveryBundleId)) {
      this.port.replaceDelegate(new UnavailableKnowledgeStudioPort(notice));
      this.sessions.replaceSelection(undefined, notice);
      return;
    }
    this.sessions.replaceSelection(state.sourceRecoveryBundleId, notice);
  }
}
