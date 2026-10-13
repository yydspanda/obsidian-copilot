import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeStartupGateResult } from "@/knowledge/recovery/KnowledgeStartupGate";

export interface KnowledgeStartupReleaseRequest {
  bundleId: string;
  expectedRuntimeRevision: number;
  expectedReviewRevision: number;
  expectedQueueRevision: number;
}

export type KnowledgeStartupReleaseChangedBoundary = "runtime" | "review" | "queue";

export type KnowledgeStartupReleaseBlockedReason =
  | "active_transaction_present"
  | "other_bundle_apply_recovery_present"
  | "apply_commit_present"
  | "apply_claim_present"
  | "failed_apply_present"
  | "processing_job_present"
  | "paused_job_present"
  | "source_observation_pending"
  | "accepted_review_unresolved"
  | "queue_pause_not_releasable"
  | "revision_overflow";

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
      reason:
        | "queue_absent"
        | "already_running"
        | "user_pause_preserved"
        | "rate_limit_pause_preserved";
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

export interface KnowledgeStartupReleasePort {
  release(request: KnowledgeStartupReleaseRequest): Promise<KnowledgeStartupReleaseResult>;
}

export class KnowledgeStartupReleaseRequestError extends TypeError {
  constructor() {
    super("Knowledge startup release request is invalid");
    this.name = "KnowledgeStartupReleaseRequestError";
  }
}

export class KnowledgeStartupReleaseDispositionError extends Error {
  constructor(public readonly disposition: KnowledgeStartupGateResult["disposition"]) {
    super("Only an observed-clear startup result can request conditional release");
    this.name = "KnowledgeStartupReleaseDispositionError";
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

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

export class KnowledgeStartupReleaseCoordinator {
  constructor(private readonly port: KnowledgeStartupReleasePort) {}

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
