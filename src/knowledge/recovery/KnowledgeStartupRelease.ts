import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeStartupGateResult } from "@/knowledge/recovery/KnowledgeStartupGate";

/** Exact optimistic observation consumed by one atomic startup release attempt. */
export interface KnowledgeStartupReleaseRequest {
  bundleId: string;
  expectedRuntimeRevision: number;
  expectedReviewRevision: number;
  expectedQueueRevision: number;
}

/** Durable boundary that changed after the startup gate observation. */
export type KnowledgeStartupReleaseChangedBoundary = "runtime" | "review" | "queue";

/** Stable reason current durable state cannot release a startup-recovery pause. */
export type KnowledgeStartupReleaseBlockedReason =
  | "active_transaction_present"
  | "other_bundle_apply_recovery_present"
  | "apply_commit_present"
  | "apply_claim_present"
  | "failed_apply_present"
  | "processing_job_present"
  | "paused_job_present"
  | "accepted_review_unresolved"
  | "queue_pause_not_releasable"
  | "revision_overflow";

/** Result of one shared-envelope conditional release attempt. */
export type KnowledgeStartupReleaseResult =
  | {
      kind: "released";
      bundleId: string;
      previousRuntimeRevision: number;
      runtimeRevision: number;
      previousQueueRevision: number;
      queueSnapshot: IngestQueueSnapshot;
    }
  | {
      kind: "unchanged";
      bundleId: string;
      reason: "queue_absent" | "already_running";
      runtimeRevision: number;
      reviewRevision: number;
      queueSnapshot: IngestQueueSnapshot;
    }
  | {
      kind: "observation_changed";
      bundleId: string;
      boundary: KnowledgeStartupReleaseChangedBoundary;
    }
  | {
      kind: "blocked";
      bundleId: string;
      reason: KnowledgeStartupReleaseBlockedReason;
    };

/** Atomic Runtime capability required by the explicit startup release coordinator. */
export interface KnowledgeStartupReleasePort {
  /** Re-proves the optimistic observation and conditionally releases one Queue. */
  release(request: KnowledgeStartupReleaseRequest): Promise<KnowledgeStartupReleaseResult>;
}

/** Reports a malformed request before Runtime state is inspected. */
export class KnowledgeStartupReleaseRequestError extends TypeError {
  /** Creates a sanitized startup release request failure. */
  constructor() {
    super("Knowledge startup release request is invalid");
    this.name = "KnowledgeStartupReleaseRequestError";
  }
}

/** Reports an attempt to release a Gate result that already requires attention. */
export class KnowledgeStartupReleaseDispositionError extends Error {
  /** Creates a sanitized non-clear observation failure. */
  constructor(public readonly disposition: KnowledgeStartupGateResult["disposition"]) {
    super("Only an observed-clear startup result can request conditional release");
    this.name = "KnowledgeStartupReleaseDispositionError";
  }
}

/** Detects one non-negative exact integer revision without coercion. */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Proves that an adapter request carries only the four authority fields. */
function hasExactRequestKeys(value: object): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === 4 &&
    keys[0] === "bundleId" &&
    keys[1] === "expectedQueueRevision" &&
    keys[2] === "expectedReviewRevision" &&
    keys[3] === "expectedRuntimeRevision"
  );
}

/** Strictly validates a narrow startup release request received through an adapter boundary. */
export function parseKnowledgeStartupReleaseRequest(
  value: unknown
): KnowledgeStartupReleaseRequest {
  if (typeof value !== "object" || value === null || !hasExactRequestKeys(value)) {
    throw new KnowledgeStartupReleaseRequestError();
  }
  const candidate = value as Partial<KnowledgeStartupReleaseRequest>;
  if (
    typeof candidate.bundleId !== "string" ||
    candidate.bundleId.trim().length === 0 ||
    !isNonNegativeSafeInteger(candidate.expectedRuntimeRevision) ||
    !isNonNegativeSafeInteger(candidate.expectedReviewRevision) ||
    !isNonNegativeSafeInteger(candidate.expectedQueueRevision)
  ) {
    throw new KnowledgeStartupReleaseRequestError();
  }
  return {
    bundleId: candidate.bundleId,
    expectedRuntimeRevision: candidate.expectedRuntimeRevision,
    expectedReviewRevision: candidate.expectedReviewRevision,
    expectedQueueRevision: candidate.expectedQueueRevision,
  };
}

/**
 * Converts a non-authoritative clear observation into an atomic Runtime release request.
 *
 * The Runtime remains the authority boundary and repeats every durable proof.
 */
export class KnowledgeStartupReleaseCoordinator {
  /** Creates the explicit release coordinator over one atomic Runtime port. */
  constructor(private readonly port: KnowledgeStartupReleasePort) {}

  /** Requests release only for a Gate result that observed no current attention. */
  async release(observation: KnowledgeStartupGateResult): Promise<KnowledgeStartupReleaseResult> {
    if (observation.disposition !== "observed_clear") {
      throw new KnowledgeStartupReleaseDispositionError(observation.disposition);
    }
    return this.port.release({
      bundleId: observation.bundleId,
      expectedRuntimeRevision: observation.runtimeRevision,
      expectedReviewRevision: observation.reviewRevision,
      expectedQueueRevision: observation.queueSnapshot.revision,
    });
  }
}
