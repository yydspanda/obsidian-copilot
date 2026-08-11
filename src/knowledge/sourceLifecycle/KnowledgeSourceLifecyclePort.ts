import type { KnowledgeSourceLifecycleModel } from "@/knowledge/ui/sourceLifecycleModel";

/** Explicit source-retirement confirmation forwarded to the Runtime boundary. */
export interface KnowledgeSourceRetirementRequest {
  readonly sourceId: string;
  readonly retirementRef: string;
  readonly reason: "user_requested" | "source_missing";
}

/** Path-free user receipt after a durable source-retirement transition. */
export interface KnowledgeSourceRetirementUiReceipt {
  readonly outcome: "retired" | "already_retired";
  readonly retainedWikiPageCount: number;
}

/** Stable lifecycle failures safe for Controller feedback and user documentation. */
export type KnowledgeSourceLifecycleErrorCode =
  | "unavailable"
  | "invalid_request"
  | "source_not_missing"
  | "source_changed"
  | "retirement_blocked"
  | "refresh_failed";

/** Sanitized lifecycle error that never retains a path, filename, bytes, or adapter cause. */
export class KnowledgeSourceLifecycleError extends Error {
  /** Creates one stable source-lifecycle failure category. */
  constructor(public readonly code: KnowledgeSourceLifecycleErrorCode) {
    super("The Knowledge source lifecycle action could not be completed");
    this.name = "KnowledgeSourceLifecycleError";
  }
}

/**
 * Generation-owned source lifecycle boundary used by Knowledge Studio.
 *
 * Read models are detached presentation material. Every mutation must re-read
 * current Runtime/watcher authority and must not trust action flags rendered by
 * an earlier snapshot.
 */
export interface KnowledgeSourceLifecyclePort {
  /** Loads active registered sources plus any recoverable missing state. */
  loadSources(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceLifecycleModel>>;

  /** Requests a full source-plan recheck without inventing a successful observation. */
  checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void>;

  /** Atomically retires one exact source while retaining existing Wiki bytes. */
  retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>>;
}
