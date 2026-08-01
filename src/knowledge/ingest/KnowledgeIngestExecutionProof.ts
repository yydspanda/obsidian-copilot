import type { KnowledgeIngestWorkStage } from "@/knowledge/model/types";

/** Current Runtime proof contract for one claimed Knowledge ingest attempt. */
export const KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION = 1 as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Processing stages at which read-only preparation or model work may remain authorized. */
export type KnowledgeAuthorizedExecutionStage = Exclude<KnowledgeIngestWorkStage, "applying">;

/** Exact immutable Queue claim projected into the Runtime proof boundary. */
export interface KnowledgeIngestExecutionProofRequest {
  bundleId: string;
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
  startedAt: number;
}

/** One-envelope proof of Queue, observation, and Manifest execution authority. */
export interface KnowledgeIngestExecutionProof extends KnowledgeIngestExecutionProofRequest {
  version: typeof KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION;
  stage: KnowledgeAuthorizedExecutionStage;
  runtimeIdentityDigest: string;
  runtimeRevision: number;
  queueRevision: number;
  observationIdentityDigest: string;
  manifestRevision: number;
  manifestDigest: string;
}

/** Narrow read-only Runtime capability used to prove one Queue-issued claim. */
export interface KnowledgeIngestExecutionProofPort {
  /** Returns an unknown proof derived from one atomic Runtime envelope. */
  prove(
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ): Promise<unknown>;
}

/** Compares strings by code unit without locale-dependent behavior. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Reads one exact plain record entirely through own enumerable data descriptors. */
function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const expected = [...keys].sort(compareText);
    const actual = Reflect.ownKeys(value);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== "string") ||
      (actual as string[]).sort(compareText).some((key, index) => key !== expected[index])
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/** Checks a non-empty canonical identity without trimming it. */
function isCanonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Checks one positive safe integer. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/** Checks one non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Strictly validates the exact claim projection accepted by Runtime.
 *
 * @param value - Unknown caller projection
 * @returns Detached frozen claim request
 */
export function verifyKnowledgeIngestExecutionProofRequest(
  value: unknown
): Readonly<KnowledgeIngestExecutionProofRequest> {
  const snapshot = snapshotExactRecord(value, [
    "bundleId",
    "jobId",
    "sourceId",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
    "attempt",
    "startedAt",
  ]);
  if (
    !snapshot ||
    !isCanonicalText(snapshot.bundleId) ||
    !isCanonicalText(snapshot.jobId) ||
    !isCanonicalText(snapshot.sourceId) ||
    typeof snapshot.sourceContentHash !== "string" ||
    !HASH_PATTERN.test(snapshot.sourceContentHash) ||
    typeof snapshot.pipelineFingerprint !== "string" ||
    !HASH_PATTERN.test(snapshot.pipelineFingerprint) ||
    !isPositiveInteger(snapshot.inputRevision) ||
    !isPositiveInteger(snapshot.attempt) ||
    !isNonNegativeInteger(snapshot.startedAt)
  ) {
    throw new TypeError("The knowledge ingest execution-proof request is invalid");
  }
  return Object.freeze({
    bundleId: snapshot.bundleId,
    jobId: snapshot.jobId,
    sourceId: snapshot.sourceId,
    sourceContentHash: snapshot.sourceContentHash,
    pipelineFingerprint: snapshot.pipelineFingerprint,
    inputRevision: snapshot.inputRevision,
    attempt: snapshot.attempt,
    startedAt: snapshot.startedAt,
  });
}
