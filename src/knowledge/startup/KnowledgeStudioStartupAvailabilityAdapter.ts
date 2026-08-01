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
      return "A project Knowledge Bundle configuration is invalid or conflicts with another Bundle. Fix project.md and reload the plugin.";
    case "recovery_unavailable":
      return "Knowledge startup recovery could not be completed safely. New ingest work remains stopped and no unreviewed knowledge was generated.";
    case "recovery_attention_required":
      return "Knowledge startup found durable work that needs an explicit recovery decision. New ingest work remains stopped.";
    case "recovery_blocked":
      return "Knowledge startup is blocked by durable recovery state. New ingest work remains stopped to protect existing notes.";
    case "workflow_adapters_unavailable":
      return state.bundleIds.length === 1
        ? "The project Knowledge Bundle is valid and startup recovery is clear. Queue release, ingest, watcher, compiler worker, and query adapters remain unavailable until the complete Golden Flow is connected."
        : "The project Knowledge Bundles are valid and startup recovery is clear. Bundle selection, Queue release, ingest, watcher, compiler workers, and query adapters remain unavailable until the complete Golden Flow is connected.";
  }
}

/** Selects one exact configured Bundle for an unavailable recovery/workflow state. */
function selectUnavailableBundleId(state: KnowledgePluginStartupState): string | undefined {
  if (
    (state.status === "recovery_unavailable" ||
      state.status === "recovery_attention_required" ||
      state.status === "recovery_blocked" ||
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
export class KnowledgeStudioStartupAvailabilityAdapter
  implements KnowledgeStudioStartupAvailabilityPort
{
  /**
   * Creates the one-way unavailable adapter.
   *
   * @param port - Stable delegate-replacement boundary retained by every View
   * @param sessions - Dynamic exact Bundle selection observed by every View
   */
  constructor(
    private readonly port: Pick<DelegatingKnowledgeStudioPort, "replaceDelegate">,
    private readonly sessions: Pick<KnowledgeStudioSessionStore, "replaceSelection">
  ) {}

  /** Installs a fresh unavailable delegate before publishing the matching session selection. */
  setUnavailable(state: KnowledgePluginStartupState): void {
    const notice = getKnowledgeStartupNotice(state);
    this.port.replaceDelegate(new UnavailableKnowledgeStudioPort(notice));
    this.sessions.replaceSelection(selectUnavailableBundleId(state), notice);
  }
}
