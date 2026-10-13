import type { KnowledgeSourceLifecycleModel } from "@/knowledge/ui/sourceLifecycleModel";

export interface KnowledgeSourceRetirementRequest {
  readonly sourceId: string;
  readonly retirementRef: string;
  readonly reason: "user_requested" | "source_missing";
}

export interface KnowledgeSourceRetirementUiReceipt {
  readonly outcome: "retired" | "already_retired";
  readonly retainedWikiPageCount: number;
}

export type KnowledgeSourceLifecycleErrorCode =
  | "unavailable"
  | "invalid_request"
  | "source_not_missing"
  | "source_changed"
  | "retirement_blocked"
  | "refresh_failed";

export class KnowledgeSourceLifecycleError extends Error {
  constructor(public readonly code: KnowledgeSourceLifecycleErrorCode) {
    super("The Knowledge source lifecycle action could not be completed");
    this.name = "KnowledgeSourceLifecycleError";
  }
}

export interface KnowledgeSourceLifecyclePort {
  loadSources(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceLifecycleModel>>;

  checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void>;

  retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>>;
}
