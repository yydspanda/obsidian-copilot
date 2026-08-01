import type {
  CompilerSourceIdentity,
  CompilerSchemaSnapshot,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeIngestExecutionAuthority,
  type KnowledgeAuthorizedExecutionStage,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import {
  KnowledgeSourceExecutionPlan,
  type KnowledgeSourceBundleAuthoritySnapshot,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type { JsonValue, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

const AUTHORIZED_PREPARATION_TOKEN = Symbol("KnowledgeAuthorizedSourcePreparation.constructor");

/** Compiler foundation released only through an authentic execution capability. */
export interface KnowledgeAuthorizedCompilePreparation {
  operation: "ingest";
  bundle: KnowledgeBundleConfig;
  manifest: SourceManifest;
  schema: CompilerSchemaSnapshot;
  source: CompilerSourceIdentity;
  artifacts: readonly SourceArtifactObservation[];
}

/** Stable, value-free authorization failure categories. */
export type KnowledgeAuthorizedSourcePreparationErrorCode =
  | "authority_invalid"
  | "authority_reused"
  | "plan_invalid"
  | "authority_stale"
  | "owner_mismatch"
  | "manifest_mismatch"
  | "profile_mismatch"
  | "preparation_mismatch"
  | "preparation_invalid";

/** Sanitized source-authorization failure retaining no path, source text, or lower-level cause. */
export class KnowledgeAuthorizedSourcePreparationError extends Error {
  /** Creates one stable authorization failure. */
  constructor(public readonly code: KnowledgeAuthorizedSourcePreparationErrorCode) {
    super("The knowledge source preparation is not authorized for execution");
    this.name = "KnowledgeAuthorizedSourcePreparationError";
  }
}

interface KnowledgeAuthorizedSourcePreparationState {
  authority: KnowledgeIngestExecutionAuthority;
  plan: KnowledgeSourceExecutionPlan;
  signal: AbortSignal;
  claim: Readonly<KnowledgeIngestExecutionProofRequest>;
  profile: KnowledgeBundlePipelineProfile;
  profileDigest: string;
  preparation: Readonly<KnowledgeAuthorizedCompilePreparation>;
  preparationDigest: string;
  manifestRevision: number;
  manifestDigest: string;
  planDigest: string;
}

const authorizedPreparationStates = new WeakMap<
  object,
  KnowledgeAuthorizedSourcePreparationState
>();
const reservedPreparationAuthorities = new WeakSet<KnowledgeIngestExecutionAuthority>();

/** Creates a sanitized cancellation without retaining an arbitrary abort reason. */
function createAbortError(): Error {
  const error = new Error("The authorized knowledge source operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Creates one deterministic digest for detached JSON-compatible authority material. */
function digestJson(domain: string, value: unknown): string {
  try {
    return sha256(`${domain}\n${canonicalizeJson(value as JsonValue)}`);
  } catch {
    throw new KnowledgeAuthorizedSourcePreparationError("preparation_invalid");
  }
}

/** Returns hidden state only for an authentic module-issued preparation. */
function requireAuthorizedPreparationState(
  value: unknown
): KnowledgeAuthorizedSourcePreparationState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeAuthorizedSourcePreparationError("preparation_invalid");
  }
  const state = authorizedPreparationStates.get(value);
  if (!state) {
    throw new KnowledgeAuthorizedSourcePreparationError("preparation_invalid");
  }
  return state;
}

/** Requires the exact Runtime Manifest authority before any source or parser work. */
function assertManifestAuthority(
  snapshot: Readonly<KnowledgeSourceBundleAuthoritySnapshot>,
  expectedRevision: number,
  expectedDigest: string
): void {
  let digest: string;
  try {
    digest = createSourceManifestDigest(snapshot.manifest);
  } catch {
    throw new KnowledgeAuthorizedSourcePreparationError("manifest_mismatch");
  }
  if (snapshot.manifest.revision !== expectedRevision || digest !== expectedDigest) {
    throw new KnowledgeAuthorizedSourcePreparationError("manifest_mismatch");
  }
}

/** Requires an exact secret-free profile and schema across two authority reads. */
function assertBundleAuthorityStable(
  initial: Readonly<KnowledgeSourceBundleAuthoritySnapshot>,
  current: Readonly<KnowledgeSourceBundleAuthoritySnapshot>
): void {
  if (
    digestJson("knowledge-authorized-schema-v1", initial.schema) !==
      digestJson("knowledge-authorized-schema-v1", current.schema) ||
    digestJson("knowledge-authorized-profile-v1", initial.pipeline) !==
      digestJson("knowledge-authorized-profile-v1", current.pipeline)
  ) {
    throw new KnowledgeAuthorizedSourcePreparationError("profile_mismatch");
  }
}

/** Requires the parsed foundation to echo the exact durable claim and re-proved Bundle data. */
function createAuthorizedPreparation(
  value: Awaited<ReturnType<KnowledgeSourceExecutionPlan["prepare"]>>,
  claim: Readonly<KnowledgeIngestExecutionProofRequest>,
  bundleAuthority: Readonly<KnowledgeSourceBundleAuthoritySnapshot>
): Readonly<KnowledgeAuthorizedCompilePreparation> {
  if (
    value.authority !== "unbound_read_only" ||
    value.bundle.id !== claim.bundleId ||
    value.source.sourceId !== claim.sourceId ||
    value.source.sourceContentHash !== claim.sourceContentHash ||
    value.source.pipelineFingerprint !== claim.pipelineFingerprint ||
    value.source.inputRevision !== claim.inputRevision ||
    createSourceManifestDigest(value.manifest) !==
      createSourceManifestDigest(bundleAuthority.manifest) ||
    digestJson("knowledge-authorized-schema-v1", value.schema) !==
      digestJson("knowledge-authorized-schema-v1", bundleAuthority.schema)
  ) {
    throw new KnowledgeAuthorizedSourcePreparationError("preparation_mismatch");
  }
  return Object.freeze({
    operation: "ingest" as const,
    bundle: value.bundle,
    manifest: value.manifest,
    schema: value.schema,
    source: Object.freeze({
      sourceId: claim.sourceId,
      sourceContentHash: claim.sourceContentHash,
      pipelineFingerprint: claim.pipelineFingerprint,
      inputRevision: claim.inputRevision,
    }),
    artifacts: value.artifacts,
  });
}

/** Re-proves Runtime around the complete mutable workflow authority set. */
async function reproveState(
  state: KnowledgeAuthorizedSourcePreparationState,
  expectedStage: KnowledgeAuthorizedExecutionStage
): Promise<void> {
  if (state.signal.aborted) throw createAbortError();
  try {
    if (!state.plan.matchesExecutionOwner(state.authority.getExecutionOwner())) {
      throw new KnowledgeAuthorizedSourcePreparationError("owner_mismatch");
    }
    await state.authority.reprove(expectedStage);
    const current = await state.plan.reproveBundleAuthorities(state.claim.bundleId, state.signal);
    assertManifestAuthority(current, state.manifestRevision, state.manifestDigest);
    if (
      state.plan.getDigest() !== state.planDigest ||
      digestJson("knowledge-authorized-profile-v1", current.pipeline) !== state.profileDigest
    ) {
      throw new KnowledgeAuthorizedSourcePreparationError("profile_mismatch");
    }
    await state.authority.reprove(expectedStage);
    if (state.plan.getDigest() !== state.planDigest) {
      throw new KnowledgeAuthorizedSourcePreparationError("profile_mismatch");
    }
    if (state.signal.aborted) throw createAbortError();
  } catch (error) {
    if (
      error instanceof KnowledgeAuthorizedSourcePreparationError ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new KnowledgeAuthorizedSourcePreparationError("authority_stale");
  }
}

/** Opaque source foundation joined to one exact durable Queue/Runtime authority. */
export class KnowledgeAuthorizedSourcePreparation {
  /** Rejects direct construction without the module-private binder token. */
  constructor(token: symbol) {
    if (token !== AUTHORIZED_PREPARATION_TOKEN) {
      throw new KnowledgeAuthorizedSourcePreparationError("preparation_invalid");
    }
    Object.freeze(this);
  }

  /** Requires an authentic process-local authorized preparation. */
  static assert(value: unknown): asserts value is KnowledgeAuthorizedSourcePreparation {
    requireAuthorizedPreparationState(value);
  }

  /** Returns the exact Queue-owned cancellation signal. */
  getSignal(): AbortSignal {
    return requireAuthorizedPreparationState(this).signal;
  }

  /** Returns the immutable non-secret durable claim identity. */
  getClaim(): Readonly<KnowledgeIngestExecutionProofRequest> {
    return requireAuthorizedPreparationState(this).claim;
  }

  /** Returns the exact retained secret-free pipeline profile. */
  getProfile(): KnowledgeBundlePipelineProfile {
    return requireAuthorizedPreparationState(this).profile;
  }

  /** Returns parsed compiler input that remains gated by this authentic capability. */
  getPreparation(): Readonly<KnowledgeAuthorizedCompilePreparation> {
    return requireAuthorizedPreparationState(this).preparation;
  }

  /** Re-proves Runtime before and after all current Manifest/schema/profile authority. */
  async reprove(expectedStage: KnowledgeAuthorizedExecutionStage): Promise<void> {
    const state = requireAuthorizedPreparationState(this);
    await reproveState(state, expectedStage);
    if (
      digestJson("knowledge-authorized-preparation-v1", state.preparation) !==
      state.preparationDigest
    ) {
      throw new KnowledgeAuthorizedSourcePreparationError("preparation_mismatch");
    }
  }
}

Object.freeze(KnowledgeAuthorizedSourcePreparation.prototype);
Object.freeze(KnowledgeAuthorizedSourcePreparation);

/** Issues authorized preparations only after a Runtime→workflow→Runtime proof sandwich. */
export class KnowledgeAuthorizedSourcePreparationBinder {
  /** Authenticates and parses one exact claimed source without accepting caller job DTOs. */
  async prepare(
    plan: KnowledgeSourceExecutionPlan,
    authority: KnowledgeIngestExecutionAuthority
  ): Promise<KnowledgeAuthorizedSourcePreparation> {
    try {
      KnowledgeSourceExecutionPlan.assert(plan);
    } catch {
      throw new KnowledgeAuthorizedSourcePreparationError("plan_invalid");
    }
    try {
      KnowledgeIngestExecutionAuthority.assert(authority);
    } catch {
      throw new KnowledgeAuthorizedSourcePreparationError("authority_invalid");
    }
    try {
      if (!plan.matchesExecutionOwner(authority.getExecutionOwner())) {
        throw new KnowledgeAuthorizedSourcePreparationError("owner_mismatch");
      }
    } catch (error) {
      if (error instanceof KnowledgeAuthorizedSourcePreparationError) throw error;
      throw new KnowledgeAuthorizedSourcePreparationError("authority_stale");
    }
    const signal = authority.getSignal();
    const claim = authority.getClaim();
    if (signal.aborted) throw createAbortError();
    if (reservedPreparationAuthorities.has(authority)) {
      throw new KnowledgeAuthorizedSourcePreparationError("authority_reused");
    }
    reservedPreparationAuthorities.add(authority);
    try {
      await authority.reprove("parsing");
      const initial = await plan.reproveBundleAuthorities(claim.bundleId, signal);
      const manifestAuthority = authority.getManifestAuthority();
      assertManifestAuthority(initial, manifestAuthority.revision, manifestAuthority.digest);
      await authority.reprove("parsing");

      const parsed = await plan.prepare(
        {
          bundleId: claim.bundleId,
          sourceId: claim.sourceId,
          sourceContentHash: claim.sourceContentHash,
          pipelineFingerprint: claim.pipelineFingerprint,
          inputRevision: claim.inputRevision,
        },
        signal
      );

      await authority.reprove("parsing");
      const final = await plan.reproveBundleAuthorities(claim.bundleId, signal);
      assertManifestAuthority(final, manifestAuthority.revision, manifestAuthority.digest);
      assertBundleAuthorityStable(initial, final);
      await authority.reprove("parsing");
      if (signal.aborted) throw createAbortError();
      const planDigest = plan.getDigest();
      const preparation = createAuthorizedPreparation(parsed, claim, final);
      const profile = final.pipeline;
      const issued = new KnowledgeAuthorizedSourcePreparation(AUTHORIZED_PREPARATION_TOKEN);
      authorizedPreparationStates.set(issued, {
        authority,
        plan,
        signal,
        claim,
        profile,
        profileDigest: digestJson("knowledge-authorized-profile-v1", profile),
        preparation,
        preparationDigest: digestJson("knowledge-authorized-preparation-v1", preparation),
        manifestRevision: manifestAuthority.revision,
        manifestDigest: manifestAuthority.digest,
        planDigest,
      });
      return issued;
    } catch (error) {
      if (
        error instanceof KnowledgeAuthorizedSourcePreparationError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      throw new KnowledgeAuthorizedSourcePreparationError("authority_stale");
    }
  }
}

Object.freeze(KnowledgeAuthorizedSourcePreparationBinder.prototype);
Object.freeze(KnowledgeAuthorizedSourcePreparationBinder);
