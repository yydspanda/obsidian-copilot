import { IngestExecutionClaim } from "@/knowledge/ingest/queue/IngestQueue";
import type { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import type { KnowledgeIngestJob } from "@/knowledge/model/types";
import { KnowledgeRuntimeIngestExecutionProofPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
  verifyKnowledgeIngestExecutionProofRequest,
  type KnowledgeAuthorizedExecutionStage,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionProof";

export {
  KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
  verifyKnowledgeIngestExecutionProofRequest,
  type KnowledgeAuthorizedExecutionStage,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofPort,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionProof";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const AUTHORITY_TOKEN = Symbol("KnowledgeIngestExecutionAuthority.constructor");
const MODEL_SAFE_STAGES = [
  "parsing",
  "analyzing",
  "associating",
  "generating",
  "validating",
] as const satisfies readonly KnowledgeAuthorizedExecutionStage[];

export type KnowledgeIngestExecutionAuthorityErrorCode =
  | "dependency_invalid"
  | "claim_invalid"
  | "claim_stale"
  | "claim_not_authorized"
  | "proof_invalid"
  | "proof_changed"
  | "stage_invalid"
  | "authority_invalid";

export class KnowledgeIngestExecutionAuthorityError extends Error {
  constructor(public readonly code: KnowledgeIngestExecutionAuthorityErrorCode) {
    super("The knowledge ingest execution authority is invalid");
    this.name = "KnowledgeIngestExecutionAuthorityError";
  }
}

interface KnowledgeIngestExecutionAuthorityState {
  queueClaim: IngestExecutionClaim;
  signal: AbortSignal;
  request: Readonly<KnowledgeIngestExecutionProofRequest>;
  prove: (
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ) => Promise<unknown>;
  runtimeIdentityDigest: string;
  observationIdentityDigest: string;
  manifestRevision: number;
  manifestDigest: string;
  lastRuntimeRevision: number;
  lastQueueRevision: number;
  lastStageRank: number;
  executionOwner: KnowledgeExecutionOwner;
}

interface KnowledgeIngestExecutionAuthorityBinderState {
  prove: KnowledgeIngestExecutionAuthorityState["prove"];
  executionOwner: KnowledgeExecutionOwner;
  assertClaimOwner: (claim: IngestExecutionClaim) => void;
}

const authorityStates = new WeakMap<object, KnowledgeIngestExecutionAuthorityState>();
const binderStates = new WeakMap<object, KnowledgeIngestExecutionAuthorityBinderState>();
const boundQueueClaims = new WeakSet<object>();

function captureRuntimeProofPortMethod(): KnowledgeRuntimeIngestExecutionProofPort["prove"] {
  const descriptor = Object.getOwnPropertyDescriptor(
    KnowledgeRuntimeIngestExecutionProofPort.prototype,
    "prove"
  );
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError("The Runtime ingest execution-proof facade is invalid");
  }
  return descriptor.value as KnowledgeRuntimeIngestExecutionProofPort["prove"];
}

const runtimeProofPortMethod = captureRuntimeProofPortMethod();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createAbortError(): Error {
  const error = new Error("The knowledge ingest execution was aborted");
  error.name = "AbortError";
  return error;
}

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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function getStageRank(value: unknown): number {
  return MODEL_SAFE_STAGES.indexOf(value as KnowledgeAuthorizedExecutionStage);
}

function projectQueueClaim(
  claim: IngestExecutionClaim
): Readonly<KnowledgeIngestExecutionProofRequest> {
  try {
    IngestExecutionClaim.assert(claim);
  } catch {
    throw new KnowledgeIngestExecutionAuthorityError("claim_invalid");
  }
  const job = claim.getJob() as Readonly<KnowledgeIngestJob>;
  if (job.status !== "processing" || job.stage !== "parsing" || !claim.isCurrent()) {
    throw new KnowledgeIngestExecutionAuthorityError("claim_stale");
  }
  try {
    return verifyKnowledgeIngestExecutionProofRequest({
      bundleId: job.bundleId,
      jobId: job.id,
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
      attempt: job.attempt,
      startedAt: job.startedAt,
    });
  } catch {
    throw new KnowledgeIngestExecutionAuthorityError("claim_invalid");
  }
}

function verifyProof(
  value: unknown,
  request: Readonly<KnowledgeIngestExecutionProofRequest>
): Readonly<KnowledgeIngestExecutionProof> {
  const snapshot = snapshotExactRecord(value, [
    "version",
    "bundleId",
    "jobId",
    "sourceId",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
    "attempt",
    "startedAt",
    "stage",
    "runtimeIdentityDigest",
    "runtimeRevision",
    "queueRevision",
    "observationIdentityDigest",
    "manifestRevision",
    "manifestDigest",
  ]);
  const stageRank = snapshot ? getStageRank(snapshot.stage) : -1;
  if (
    !snapshot ||
    snapshot.version !== KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION ||
    snapshot.bundleId !== request.bundleId ||
    snapshot.jobId !== request.jobId ||
    snapshot.sourceId !== request.sourceId ||
    snapshot.sourceContentHash !== request.sourceContentHash ||
    snapshot.pipelineFingerprint !== request.pipelineFingerprint ||
    snapshot.inputRevision !== request.inputRevision ||
    snapshot.attempt !== request.attempt ||
    snapshot.startedAt !== request.startedAt ||
    stageRank < 0 ||
    typeof snapshot.runtimeIdentityDigest !== "string" ||
    !HASH_PATTERN.test(snapshot.runtimeIdentityDigest) ||
    !isNonNegativeInteger(snapshot.runtimeRevision) ||
    !isNonNegativeInteger(snapshot.queueRevision) ||
    typeof snapshot.observationIdentityDigest !== "string" ||
    !HASH_PATTERN.test(snapshot.observationIdentityDigest) ||
    !isNonNegativeInteger(snapshot.manifestRevision) ||
    typeof snapshot.manifestDigest !== "string" ||
    !HASH_PATTERN.test(snapshot.manifestDigest)
  ) {
    throw new KnowledgeIngestExecutionAuthorityError("proof_invalid");
  }
  return Object.freeze({
    version: KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
    bundleId: request.bundleId,
    jobId: request.jobId,
    sourceId: request.sourceId,
    sourceContentHash: request.sourceContentHash,
    pipelineFingerprint: request.pipelineFingerprint,
    inputRevision: request.inputRevision,
    attempt: request.attempt,
    startedAt: request.startedAt,
    stage: snapshot.stage as KnowledgeAuthorizedExecutionStage,
    runtimeIdentityDigest: snapshot.runtimeIdentityDigest,
    runtimeRevision: snapshot.runtimeRevision,
    queueRevision: snapshot.queueRevision,
    observationIdentityDigest: snapshot.observationIdentityDigest,
    manifestRevision: snapshot.manifestRevision,
    manifestDigest: snapshot.manifestDigest,
  });
}

function assertLocalClaimCurrent(
  state: Pick<KnowledgeIngestExecutionAuthorityState, "signal" | "queueClaim">
): void {
  if (state.signal.aborted) throw createAbortError();
  if (!state.queueClaim.isCurrent()) {
    throw new KnowledgeIngestExecutionAuthorityError("claim_stale");
  }
}

async function callProof(
  state: Pick<KnowledgeIngestExecutionAuthorityState, "request" | "prove" | "signal" | "queueClaim">
): Promise<Readonly<KnowledgeIngestExecutionProof>> {
  assertLocalClaimCurrent(state);
  let value: unknown;
  try {
    value = await state.prove(state.request, state.signal);
  } catch {
    assertLocalClaimCurrent(state);
    throw new KnowledgeIngestExecutionAuthorityError("claim_not_authorized");
  }
  assertLocalClaimCurrent(state);
  return verifyProof(value, state.request);
}

function requireAuthorityState(value: unknown): KnowledgeIngestExecutionAuthorityState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeIngestExecutionAuthorityError("authority_invalid");
  }
  const state = authorityStates.get(value);
  if (!state) {
    throw new KnowledgeIngestExecutionAuthorityError("authority_invalid");
  }
  return state;
}

function requireBinderState(value: unknown): KnowledgeIngestExecutionAuthorityBinderState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeIngestExecutionAuthorityError("authority_invalid");
  }
  const state = binderStates.get(value);
  if (!state) {
    throw new KnowledgeIngestExecutionAuthorityError("authority_invalid");
  }
  return state;
}

export class KnowledgeIngestExecutionAuthority {
  constructor(token: symbol) {
    if (token !== AUTHORITY_TOKEN) {
      throw new KnowledgeIngestExecutionAuthorityError("authority_invalid");
    }
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeIngestExecutionAuthority {
    requireAuthorityState(value);
  }

  getClaim(): Readonly<KnowledgeIngestExecutionProofRequest> {
    return requireAuthorityState(this).request;
  }

  getSignal(): AbortSignal {
    return requireAuthorityState(this).signal;
  }

  getManifestAuthority(): Readonly<{ revision: number; digest: string }> {
    const state = requireAuthorityState(this);
    return Object.freeze({ revision: state.manifestRevision, digest: state.manifestDigest });
  }

  getExecutionOwner(): KnowledgeExecutionOwner {
    return requireAuthorityState(this).executionOwner;
  }

  async reprove(expectedStage: KnowledgeAuthorizedExecutionStage): Promise<void> {
    const state = requireAuthorityState(this);
    const expectedRank = getStageRank(expectedStage);
    if (expectedRank < 0 || expectedRank < state.lastStageRank) {
      throw new KnowledgeIngestExecutionAuthorityError("stage_invalid");
    }
    const proof = await callProof(state);
    const proofRank = getStageRank(proof.stage);
    if (proof.stage !== expectedStage) {
      throw new KnowledgeIngestExecutionAuthorityError("stage_invalid");
    }
    if (
      proof.runtimeIdentityDigest !== state.runtimeIdentityDigest ||
      proof.observationIdentityDigest !== state.observationIdentityDigest ||
      proof.manifestRevision !== state.manifestRevision ||
      proof.manifestDigest !== state.manifestDigest ||
      proof.runtimeRevision < state.lastRuntimeRevision ||
      proof.queueRevision < state.lastQueueRevision ||
      proofRank < state.lastStageRank
    ) {
      throw new KnowledgeIngestExecutionAuthorityError("proof_changed");
    }
    state.lastRuntimeRevision = proof.runtimeRevision;
    state.lastQueueRevision = proof.queueRevision;
    state.lastStageRank = proofRank;
  }
}

Object.freeze(KnowledgeIngestExecutionAuthority.prototype);
Object.freeze(KnowledgeIngestExecutionAuthority);

export class KnowledgeIngestExecutionAuthorityBinder {
  constructor(proofPort: KnowledgeRuntimeIngestExecutionProofPort) {
    try {
      KnowledgeRuntimeIngestExecutionProofPort.assert(proofPort);
    } catch {
      throw new KnowledgeIngestExecutionAuthorityError("dependency_invalid");
    }
    binderStates.set(
      this,
      Object.freeze({
        executionOwner: KnowledgeRuntimeIngestExecutionProofPort.getExecutionOwner(proofPort),
        assertClaimOwner: (claim: IngestExecutionClaim) =>
          KnowledgeRuntimeIngestExecutionProofPort.assertClaimOwner(proofPort, claim),
        prove: async (
          request: Readonly<KnowledgeIngestExecutionProofRequest>,
          signal: AbortSignal
        ) => await Reflect.apply(runtimeProofPortMethod, proofPort, [request, signal]),
      })
    );
    Object.freeze(this);
  }

  async bind(queueClaim: IngestExecutionClaim): Promise<KnowledgeIngestExecutionAuthority> {
    const request = projectQueueClaim(queueClaim);
    const binderState = requireBinderState(this);
    try {
      binderState.assertClaimOwner(queueClaim);
    } catch {
      throw new KnowledgeIngestExecutionAuthorityError("claim_not_authorized");
    }
    if (boundQueueClaims.has(queueClaim)) {
      throw new KnowledgeIngestExecutionAuthorityError("claim_not_authorized");
    }
    boundQueueClaims.add(queueClaim);
    const signal = queueClaim.getSignal();
    const { prove, executionOwner } = binderState;
    const proof = await callProof({ request, prove, signal, queueClaim });
    if (proof.stage !== "parsing") {
      throw new KnowledgeIngestExecutionAuthorityError("stage_invalid");
    }
    const authority = new KnowledgeIngestExecutionAuthority(AUTHORITY_TOKEN);
    authorityStates.set(authority, {
      queueClaim,
      signal,
      request,
      prove,
      runtimeIdentityDigest: proof.runtimeIdentityDigest,
      observationIdentityDigest: proof.observationIdentityDigest,
      manifestRevision: proof.manifestRevision,
      manifestDigest: proof.manifestDigest,
      lastRuntimeRevision: proof.runtimeRevision,
      lastQueueRevision: proof.queueRevision,
      lastStageRank: getStageRank(proof.stage),
      executionOwner,
    });
    return authority;
  }
}

Object.freeze(KnowledgeIngestExecutionAuthorityBinder.prototype);
Object.freeze(KnowledgeIngestExecutionAuthorityBinder);
