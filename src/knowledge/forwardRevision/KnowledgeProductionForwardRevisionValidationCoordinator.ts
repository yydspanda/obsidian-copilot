import {
  validateProductionCandidateCitations,
  validateProductionGeneratedDocuments,
} from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import {
  ObsidianKnowledgeCompilerTargetResolver,
  ObsidianKnowledgeCompilerTargetResolverError,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionReviewCommandDigest,
  snapshotKnowledgeForwardRevisionReviewCommandForProposal,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionValidationAuthorityQuery,
  snapshotKnowledgeForwardRevisionValidationAuthority,
  type KnowledgeForwardRevisionValidationAuthorityV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import {
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
  snapshotKnowledgeForwardRevisionValidationReceiptForCandidate,
  type KnowledgeForwardRevisionValidationArtifactIdentityV1,
  type KnowledgeForwardRevisionValidationProfileV1,
  type KnowledgeForwardRevisionValidationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import {
  KnowledgeSourceExecutionPlan,
  type KnowledgeSourceParsePreparation,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  canonicalizeJson,
  createFileContentHash,
  createKnowledgeBundleConfigDigest,
} from "@/knowledge/model/fingerprint";
import type {
  ClaimCitation,
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
} from "@/knowledge/model/types";
import { validateKnowledgeFileChange } from "@/knowledge/model/validation";
import { isPathWithinRoot, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { KnowledgeRuntimeForwardRevisionValidationPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { sha256 } from "@/utils/hash";

const MAX_WIKI_PAGE_BYTES = 8_000_000;
const MAX_WIKI_PAGE_CHARACTERS = 2_000_000;
const MAX_VALIDATION_DIAGNOSTICS = 10_000;
const CAPABILITY_TOKEN = Symbol("KnowledgeForwardRevisionValidationCapability.constructor");
const VALIDATOR_IMPLEMENTATION_ID = "knowledge-production-forward-revision-validator";
const VALIDATOR_IMPLEMENTATION_VERSION = 1;
const VALIDATOR_IMPLEMENTATION_DIGEST = sha256(
  "knowledge-production-forward-revision-validator-v1\n" +
    "runtime-sandwich+workflow-plan+bounded-vault-read+review-validator"
);

/** Stable value-free failures exposed by the read-only validation coordinator. */
export type KnowledgeForwardRevisionValidationCoordinatorErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "authority_unavailable"
  | "authority_changed"
  | "source_stale"
  | "page_stale"
  | "validation_failed"
  | "resource_limit"
  | "aborted";

/** Exact request whose proposal and command are rejoined to current Runtime authority. */
export interface KnowledgeForwardRevisionValidationRequest {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly command: unknown;
}

/** Detached material cryptographically and process-locally bound by a genuine capability. */
export interface KnowledgeForwardRevisionValidationCapabilityProjectionV1 {
  readonly version: 1;
  readonly kind: "forward_revision_validation_capability_projection";
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly command: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
  readonly commandDigest: string;
  readonly afterContent: string;
  readonly acceptedAfterHash: string;
  readonly candidate: Readonly<KnowledgeForwardRevisionValidatedCandidateV1>;
  readonly candidateDigest: string;
  readonly receipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>;
  readonly receiptDigest: string;
  readonly beforeAuthorityDigest: string;
  readonly afterAuthorityDigest: string;
  readonly validationReadSet: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[];
}

/** Exact forward-only candidate validated without entering the legacy Review protocol. */
export interface KnowledgeForwardRevisionValidatedCandidateV1 {
  readonly version: 1;
  readonly kind: "forward_revision_validated_candidate";
  readonly bundleId: string;
  readonly pagePath: string;
  readonly sourceRefs: readonly [string];
  readonly change: Readonly<Extract<KnowledgeFileChange, { operation: "update" }>>;
  readonly citations: readonly Readonly<ClaimCitation>[];
  readonly validation: Readonly<{
    okfValid: true;
    citationsValid: true;
    linksValid: true;
  }>;
}

/** Closed read-only result; a byte-identical edited body deliberately mints no capability. */
export type KnowledgeForwardRevisionValidationCoordinatorResult =
  | Readonly<{
      kind: "validated";
      capability: KnowledgeForwardRevisionValidationCapability;
    }>
  | Readonly<{
      kind: "no_change";
      proposalId: string;
      commandId: string;
      contentHash: string;
    }>;

const coordinatorErrorCodes = new WeakMap<
  object,
  KnowledgeForwardRevisionValidationCoordinatorErrorCode
>();

/** Sanitized coordinator failure that never retains caller material or dependency causes. */
export class KnowledgeForwardRevisionValidationCoordinatorError extends Error {
  /** Creates an authentic error only for this module's private failure path. */
  private constructor(token: symbol, code: KnowledgeForwardRevisionValidationCoordinatorErrorCode) {
    super("Forward revision validation could not be completed");
    if (token !== CAPABILITY_TOKEN) throw new TypeError("Invalid validation error");
    this.name =
      code === "aborted" ? "AbortError" : "KnowledgeForwardRevisionValidationCoordinatorError";
    coordinatorErrorCodes.set(this, code);
    Object.freeze(this);
  }

  /** Returns the stable category only for a module-minted sanitized failure. */
  static inspect(
    value: unknown
  ): KnowledgeForwardRevisionValidationCoordinatorErrorCode | undefined {
    return typeof value === "object" && value !== null
      ? coordinatorErrorCodes.get(value)
      : undefined;
  }

  /** Returns this authentic error's stable value-free category. */
  get code(): KnowledgeForwardRevisionValidationCoordinatorErrorCode {
    const code = KnowledgeForwardRevisionValidationCoordinatorError.inspect(this);
    if (!code) throw new TypeError("Invalid validation error");
    return code;
  }

  /** Mints one frozen sanitized failure for an internal coordinator boundary. */
  static create(
    token: symbol,
    code: KnowledgeForwardRevisionValidationCoordinatorErrorCode
  ): KnowledgeForwardRevisionValidationCoordinatorError {
    if (token !== CAPABILITY_TOKEN) throw new TypeError("Invalid validation error");
    return new KnowledgeForwardRevisionValidationCoordinatorError(CAPABILITY_TOKEN, code);
  }
}

Object.freeze(KnowledgeForwardRevisionValidationCoordinatorError.prototype);
Object.freeze(KnowledgeForwardRevisionValidationCoordinatorError);

interface CoordinatorState {
  readonly runtime: KnowledgeRuntimeForwardRevisionValidationPort;
  readonly plan: KnowledgeSourceExecutionPlan;
  readonly targetVisitor: ObsidianKnowledgeCompilerTargetResolver;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

interface ValidationCapabilityState {
  readonly projection: Readonly<KnowledgeForwardRevisionValidationCapabilityProjectionV1>;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

const coordinatorStates = new WeakMap<object, Readonly<CoordinatorState>>();
const capabilityStates = new WeakMap<object, Readonly<ValidationCapabilityState>>();
let mintValidationCapability:
  | ((state: Readonly<ValidationCapabilityState>) => KnowledgeForwardRevisionValidationCapability)
  | undefined;

/** Throws one authentic fixed coordinator failure. */
function fail(code: KnowledgeForwardRevisionValidationCoordinatorErrorCode): never {
  throw KnowledgeForwardRevisionValidationCoordinatorError.create(CAPABILITY_TOKEN, code);
}

/** Stops work without retaining an arbitrary AbortSignal reason. */
function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) fail("aborted");
}

/** Re-proves one exact Runtime/workflow/Vault owner and its generation lease. */
function assertCoordinatorCurrent(state: Readonly<CoordinatorState>): void {
  try {
    state.assertCurrent();
    if (
      !KnowledgeRuntimeForwardRevisionValidationPort.matchesExecutionOwner(
        state.runtime,
        state.executionOwner
      ) ||
      !state.plan.matchesExecutionOwner(state.executionOwner) ||
      !ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(
        state.targetVisitor,
        state.executionOwner
      )
    ) {
      fail("dependency_invalid");
    }
  } catch (error) {
    if (KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)) throw error;
    fail("dependency_invalid");
  }
}

/** Hashes one internal JSON projection under an explicit protocol namespace. */
function digestValue(namespace: string, value: JsonValue): string {
  return sha256(`${namespace}\n${canonicalizeJson(value)}`);
}

/** Snapshots the three-field validation request without invoking caller accessors. */
function snapshotValidationRequest(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationRequest> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    ) {
      fail("request_invalid");
    }
    const keys = Reflect.ownKeys(value);
    const expected = ["proposal", "proposalDigest", "command"];
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string") ||
      expected.some((key) => !keys.includes(key))
    ) {
      fail("request_invalid");
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        fail("request_invalid");
      }
      captured[key] = descriptor.value;
    }
    if (typeof captured.proposalDigest !== "string") fail("request_invalid");
    return Object.freeze({
      proposal: captured.proposal,
      proposalDigest: captured.proposalDigest,
      command: captured.command,
    });
  } catch (error) {
    if (KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)) throw error;
    fail("request_invalid");
  }
}

/** Detaches already-validated historical citations for the forward candidate. */
function cloneCitations(values: readonly Readonly<ClaimCitation>[]): ClaimCitation[] {
  return values.map((citation) => ({
    citationId: citation.citationId,
    claimId: citation.claimId,
    relation: citation.relation,
    locator: { ...citation.locator },
  }));
}

/** Derives the single deterministic update owned by the forward protocol. */
function createForwardChange(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string,
  commandDigest: string,
  afterContent: string
): Readonly<Extract<KnowledgeFileChange, { operation: "update" }>> {
  const request = proposal.request;
  const sourceId = request.intent.current.primarySourceId;
  const afterHash = createFileContentHash(afterContent);
  const identityDigest = digestValue("knowledge-forward-revision-candidate-identity-v1", {
    proposalDigest,
    commandDigest,
    afterHash,
  });
  const sourceRefs = [sourceId];
  Object.freeze(sourceRefs);
  return Object.freeze({
    id: `forward-revision-change-${identityDigest}`,
    operation: "update",
    path: request.pagePath,
    sourceRefs,
    reason: "Apply the reviewed forward revision",
    beforeHash: request.intent.current.vaultObservedBeforeHash,
    afterContent,
    afterHash,
  });
}

/** Freezes one successfully validated forward-only candidate and its full body. */
function createValidatedCandidate(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  change: Readonly<Extract<KnowledgeFileChange, { operation: "update" }>>,
  citationsValue: readonly Readonly<ClaimCitation>[]
): Readonly<KnowledgeForwardRevisionValidatedCandidateV1> {
  const sourceRefs = Object.freeze([proposal.request.intent.current.primarySourceId] as [string]);
  const citations = cloneCitations(citationsValue);
  for (const citation of citations) {
    Object.freeze(citation.locator);
    Object.freeze(citation);
  }
  Object.freeze(citations);
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_validated_candidate" as const,
    bundleId: proposal.request.bundleId,
    pagePath: proposal.request.pagePath,
    sourceRefs,
    change,
    citations,
    validation: Object.freeze({
      okfValid: true as const,
      citationsValid: true as const,
      linksValid: true as const,
    }),
  });
}

/** Computes the canonical identity of one complete forward-only candidate. */
function createForwardCandidateDigest(
  value: Readonly<KnowledgeForwardRevisionValidatedCandidateV1>
): string {
  return digestValue(
    "knowledge-forward-revision-validated-candidate-v1",
    value as unknown as JsonValue
  );
}

/** Removes only enclosing Runtime-envelope volatility from an authority comparison. */
function projectAuthoritySemantics(
  value: Readonly<KnowledgeForwardRevisionValidationAuthorityV1>
): JsonValue {
  const {
    runtimeRevision: _runtimeRevision,
    runtimeDigest: _runtimeDigest,
    authorityDigest: _authorityDigest,
    forwardReviewStoreRevision: _forwardReviewStoreRevision,
    acceptanceAuthority,
    ...authority
  } = value;
  const {
    runtimeRevision: _acceptanceRuntimeRevision,
    runtimeDigest: _acceptanceRuntimeDigest,
    currentSourceFreshness,
    ...acceptance
  } = acceptanceAuthority;
  const {
    runtimeRevision: _freshnessRuntimeRevision,
    runtimeDigest: _freshnessRuntimeDigest,
    ...freshness
  } = currentSourceFreshness;
  void _runtimeRevision;
  void _runtimeDigest;
  void _authorityDigest;
  void _forwardReviewStoreRevision;
  void _acceptanceRuntimeRevision;
  void _acceptanceRuntimeDigest;
  void _freshnessRuntimeRevision;
  void _freshnessRuntimeDigest;
  return {
    ...(authority as unknown as Record<string, JsonValue>),
    acceptanceAuthority: {
      ...(acceptance as unknown as Record<string, JsonValue>),
      currentSourceFreshness: freshness as unknown as JsonValue,
    },
  };
}

/** Requires one later Runtime proof to retain identical proposal/source semantics. */
function assertAuthoritySandwich(
  before: Readonly<KnowledgeForwardRevisionValidationAuthorityV1>,
  after: Readonly<KnowledgeForwardRevisionValidationAuthorityV1>
): void {
  if (
    after.runtimeRevision < before.runtimeRevision ||
    (after.runtimeRevision === before.runtimeRevision &&
      after.runtimeDigest !== before.runtimeDigest) ||
    after.forwardReviewStoreRevision < before.forwardReviewStoreRevision ||
    canonicalizeJson(projectAuthoritySemantics(after)) !==
      canonicalizeJson(projectAuthoritySemantics(before))
  ) {
    fail("authority_changed");
  }
}

/** Projects parser observations into the strict identity-only durable read-set. */
export function createKnowledgeForwardRevisionValidationReadSet(
  preparation: Readonly<KnowledgeSourceParsePreparation>
): readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[] {
  return Object.freeze(
    preparation.artifacts.map((artifact) =>
      Object.freeze({
        version: 1 as const,
        kind: "forward_revision_validation_artifact_identity" as const,
        artifactKind: artifact.kind,
        sourceId: artifact.sourceId,
        artifactId: artifact.artifactId,
        artifactContentHash: artifact.artifactContentHash,
      })
    )
  );
}

/** Captures one exact fresh Wiki page through the genuine bounded visitor. */
async function readCurrentPage(
  state: Readonly<CoordinatorState>,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  signal: AbortSignal
): Promise<string> {
  let content: string | undefined;
  let visits = 0;
  await state.targetVisitor.visit(
    [
      {
        targetId: proposal.proposalId,
        path: proposal.request.pagePath,
        intent: "write",
        access: "authorized",
      },
    ],
    signal,
    { maxFileBytes: MAX_WIKI_PAGE_BYTES },
    (observation, fileByteSize) => {
      visits += 1;
      if (
        visits !== 1 ||
        observation.targetId !== proposal.proposalId ||
        observation.kind !== "file" ||
        observation.path !== proposal.request.pagePath ||
        fileByteSize === undefined ||
        !Number.isSafeInteger(fileByteSize) ||
        fileByteSize < 0 ||
        fileByteSize > MAX_WIKI_PAGE_BYTES ||
        observation.content.length > MAX_WIKI_PAGE_CHARACTERS ||
        new TextEncoder().encode(observation.content).byteLength !== fileByteSize
      ) {
        fail(
          fileByteSize !== undefined && fileByteSize > MAX_WIKI_PAGE_BYTES
            ? "resource_limit"
            : "page_stale"
        );
      }
      content = observation.content;
    }
  );
  if (visits !== 1 || content === undefined) fail("page_stale");
  return content;
}

/** Requires the authentic preparation to equal the current Runtime source/Manifest tuple. */
function assertPreparationAuthority(
  preparation: Readonly<KnowledgeSourceParsePreparation>,
  authority: Readonly<KnowledgeForwardRevisionValidationAuthorityV1>
): void {
  const current = authority.proposal.request.intent.current;
  const source = preparation.manifest.entries.find(
    (entry) => entry.sourceId === current.primarySourceId
  );
  if (
    preparation.authority !== "unbound_read_only" ||
    preparation.operation !== "ingest" ||
    preparation.bundle.id !== authority.proposal.request.bundleId ||
    preparation.source.sourceId !== current.primarySourceId ||
    preparation.source.sourceContentHash !== current.sourceContentHash ||
    preparation.source.pipelineFingerprint !== current.pipelineFingerprint ||
    preparation.source.inputRevision !== current.inputRevision ||
    preparation.manifest.bundleId !== authority.proposal.request.bundleId ||
    preparation.manifest.revision !== authority.acceptanceAuthority.manifestRevision ||
    createSourceManifestDigest(preparation.manifest) !==
      authority.acceptanceAuthority.manifestDigest ||
    !source?.lastSuccessful ||
    source.lastSuccessful.sourceContentHash !== current.sourceContentHash ||
    source.lastSuccessful.pipelineFingerprint !== current.pipelineFingerprint ||
    !source.lastSuccessful.generatedPages.some(
      (page) =>
        page.path === authority.proposal.request.pagePath &&
        page.ownership === "generated" &&
        page.contentHash === authority.acceptanceAuthority.manifestBaseHash
    ) ||
    preparation.artifacts.length < 1 ||
    preparation.artifacts.some((artifact) => artifact.sourceId !== current.primarySourceId)
  ) {
    fail("source_stale");
  }
}

/** Creates the exact public validator/profile identity used by one receipt. */
export function createKnowledgeForwardRevisionValidationProfile(
  preparation: Readonly<KnowledgeSourceParsePreparation>,
  pipelineProfile: JsonValue,
  executionPlanDigest: string
): Readonly<KnowledgeForwardRevisionValidationProfileV1> {
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_validation_profile" as const,
    profileId: "knowledge-forward-revision-validation-v1",
    profileVersion: 1,
    profileConfigurationDigest: digestValue(
      "knowledge-forward-revision-validation-profile-configuration-v1",
      {
        executionPlanDigest,
        pipelineProfile,
        schema: {
          path: preparation.schema.path,
          contentHash: preparation.schema.contentHash,
        },
      }
    ),
    bundleConfigurationDigest: createKnowledgeBundleConfigDigest(preparation.bundle),
    validatorImplementationId: VALIDATOR_IMPLEMENTATION_ID,
    validatorImplementationVersion: VALIDATOR_IMPLEMENTATION_VERSION,
    validatorImplementationDigest: VALIDATOR_IMPLEMENTATION_DIGEST,
  });
}

/** Requires the genuine deterministic validator's exact successful result shape. */
export function requireSuccessfulKnowledgeForwardRevisionValidation(value: unknown): {
  readonly validation: Readonly<{ okfValid: true; citationsValid: true; linksValid: true }>;
  readonly warningSummary: Readonly<{
    version: 1;
    kind: "forward_revision_validation_warning_summary";
    count: number;
    digest: string;
  }> | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("validation_failed");
  }
  const result = value as {
    validation?: { okfValid?: unknown; citationsValid?: unknown; linksValid?: unknown };
    diagnostics?: unknown;
  };
  if (
    result.validation?.okfValid !== true ||
    result.validation.citationsValid !== true ||
    result.validation.linksValid !== true ||
    !Array.isArray(result.diagnostics) ||
    result.diagnostics.length > MAX_VALIDATION_DIAGNOSTICS
  ) {
    fail(
      result.diagnostics instanceof Array && result.diagnostics.length > MAX_VALIDATION_DIAGNOSTICS
        ? "resource_limit"
        : "validation_failed"
    );
  }
  const diagnostics = result.diagnostics as KnowledgeDiagnostic[];
  if (
    diagnostics.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        (item.severity !== "error" && item.severity !== "warning") ||
        typeof item.code !== "string" ||
        typeof item.field !== "string" ||
        typeof item.message !== "string"
    ) ||
    diagnostics.some((item) => item.severity === "error")
  ) {
    fail("validation_failed");
  }
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return Object.freeze({
    validation: Object.freeze({
      okfValid: true as const,
      citationsValid: true as const,
      linksValid: true as const,
    }),
    warningSummary:
      warnings.length === 0
        ? null
        : Object.freeze({
            version: 1 as const,
            kind: "forward_revision_validation_warning_summary" as const,
            count: warnings.length,
            digest: digestValue(
              "knowledge-forward-revision-validation-warnings-v1",
              warnings as unknown as JsonValue
            ),
          }),
  });
}

/** Returns hidden dependencies only for one exact coordinator instance. */
function requireCoordinatorState(value: unknown): Readonly<CoordinatorState> {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    fail("dependency_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== KnowledgeProductionForwardRevisionValidationCoordinator.prototype
  ) {
    fail("dependency_invalid");
  }
  const state = coordinatorStates.get(value);
  if (!state) fail("dependency_invalid");
  return state;
}

/** Opaque process-local proof minted only after every genuine read and validator succeeds. */
export class KnowledgeForwardRevisionValidationCapability {
  /** Installs only module-private fully validated capability state. */
  private constructor(token: symbol, state: Readonly<ValidationCapabilityState>) {
    if (token !== CAPABILITY_TOKEN) fail("dependency_invalid");
    capabilityStates.set(this, state);
    Object.freeze(this);
  }

  static {
    mintValidationCapability = (state) =>
      new KnowledgeForwardRevisionValidationCapability(CAPABILITY_TOKEN, state);
  }

  /** Requires an exact-prototype capability minted by this module in this process. */
  static assert(value: unknown): asserts value is KnowledgeForwardRevisionValidationCapability {
    let prototype: object | null;
    try {
      prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
    } catch {
      fail("dependency_invalid");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      prototype !== KnowledgeForwardRevisionValidationCapability.prototype ||
      !capabilityStates.has(value)
    ) {
      fail("dependency_invalid");
    }
    try {
      capabilityStates.get(value)?.assertCurrent();
    } catch {
      fail("dependency_invalid");
    }
  }

  /** Requires this live capability to belong to one exact opaque execution lifecycle. */
  static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
    KnowledgeForwardRevisionValidationCapability.assert(value);
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      if (capabilityStates.get(value)?.executionOwner !== executionOwner) {
        fail("dependency_invalid");
      }
    } catch (error) {
      if (KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /** Projects immutable receipt, command, candidate body, and sandwich correlations. */
  static project(
    value: unknown
  ): Readonly<KnowledgeForwardRevisionValidationCapabilityProjectionV1> {
    KnowledgeForwardRevisionValidationCapability.assert(value);
    const state = capabilityStates.get(value);
    if (!state) fail("dependency_invalid");
    return state.projection;
  }
}

Object.freeze(KnowledgeForwardRevisionValidationCapability.prototype);
Object.freeze(KnowledgeForwardRevisionValidationCapability);

/** Genuine deterministic coordinator with no model, persistence, or write capability. */
export class KnowledgeProductionForwardRevisionValidationCoordinator {
  /** Captures only authentic Runtime, workflow-plan, and bounded Vault read capabilities. */
  constructor(
    runtime: KnowledgeRuntimeForwardRevisionValidationPort,
    plan: KnowledgeSourceExecutionPlan,
    targetVisitor: ObsidianKnowledgeCompilerTargetResolver,
    executionOwner: KnowledgeExecutionOwner,
    assertCurrent: () => void
  ) {
    try {
      KnowledgeRuntimeForwardRevisionValidationPort.assert(runtime);
      KnowledgeSourceExecutionPlan.assert(plan);
      ObsidianKnowledgeCompilerTargetResolver.assert(targetVisitor);
      KnowledgeExecutionOwner.assert(executionOwner);
      if (typeof assertCurrent !== "function") throw new TypeError();
      const state = Object.freeze({
        runtime,
        plan,
        targetVisitor,
        executionOwner,
        assertCurrent,
      });
      assertCoordinatorCurrent(state);
      coordinatorStates.set(this, state);
      Object.freeze(this);
    } catch {
      fail("dependency_invalid");
    }
  }

  /** Requires one live exact coordinator owned by the supplied execution lifecycle. */
  static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      const state = requireCoordinatorState(value);
      assertCoordinatorCurrent(state);
      if (state.executionOwner !== executionOwner) fail("dependency_invalid");
    } catch (error) {
      if (KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /**
   * Revalidates one accepted forward body under a Runtime/parser/Vault/Runtime sandwich.
   *
   * The method performs no writes and never invokes a model or network capability.
   */
  async validate(
    requestValue: unknown,
    signal: AbortSignal
  ): Promise<KnowledgeForwardRevisionValidationCoordinatorResult> {
    const state = requireCoordinatorState(this);
    let stage: "request" | "authority" | "page" | "source" | "validation" = "request";
    try {
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      const request = snapshotValidationRequest(requestValue);
      const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(request.proposal);
      const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
      if (request.proposalDigest !== proposalDigest) fail("request_invalid");
      const command = snapshotKnowledgeForwardRevisionReviewCommandForProposal(
        request.command,
        proposal,
        proposalDigest
      );
      if (command.action === "reject") fail("request_invalid");
      const commandDigest = createKnowledgeForwardRevisionReviewCommandDigest(command);
      const afterContent =
        command.action === "accept_exact" ? proposal.request.selectedContent : command.afterContent;
      const acceptedAfterHash = createFileContentHash(afterContent);
      const query = createKnowledgeForwardRevisionValidationAuthorityQuery({
        proposal,
        proposalDigest,
      });
      stage = "source";
      const planDigestBefore = state.plan.getDigest();
      stage = "authority";
      const beforeValue = await state.runtime.readForwardRevisionValidationAuthority(query);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (!beforeValue) fail("authority_unavailable");
      const before = snapshotKnowledgeForwardRevisionValidationAuthority(beforeValue);
      stage = "page";
      const currentContent = await readCurrentPage(state, proposal, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (
        createFileContentHash(currentContent) !== before.acceptanceAuthority.vaultObservedBeforeHash
      ) {
        fail("page_stale");
      }

      if (command.action === "accept_edited" && currentContent === afterContent) {
        stage = "page";
        const confirmedContent = await readCurrentPage(state, proposal, signal);
        assertCoordinatorCurrent(state);
        assertNotAborted(signal);
        if (
          confirmedContent !== currentContent ||
          createFileContentHash(confirmedContent) !==
            before.acceptanceAuthority.vaultObservedBeforeHash
        ) {
          fail("page_stale");
        }
        stage = "authority";
        const afterValue = await state.runtime.readForwardRevisionValidationAuthority(query);
        assertCoordinatorCurrent(state);
        assertNotAborted(signal);
        if (!afterValue) fail("authority_changed");
        const after = snapshotKnowledgeForwardRevisionValidationAuthority(afterValue);
        assertAuthoritySandwich(before, after);
        stage = "source";
        if (state.plan.getDigest() !== planDigestBefore) fail("source_stale");
        assertCoordinatorCurrent(state);
        return Object.freeze({
          kind: "no_change" as const,
          proposalId: proposal.proposalId,
          commandId: command.commandId,
          contentHash: acceptedAfterHash,
        });
      }

      stage = "source";
      const pipelineProfile = state.plan.getBundlePipelineProfile(proposal.request.bundleId);
      if (!pipelineProfile) fail("source_stale");
      const pipelineProfileSnapshot = canonicalizeJson(pipelineProfile as unknown as JsonValue);
      const sourceJob = Object.freeze({
        bundleId: proposal.request.bundleId,
        sourceId: proposal.request.intent.current.primarySourceId,
        sourceContentHash: proposal.request.intent.current.sourceContentHash,
        pipelineFingerprint: proposal.request.intent.current.pipelineFingerprint,
        inputRevision: proposal.request.intent.current.inputRevision,
      });
      const preparation = await state.plan.prepare(sourceJob, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      assertPreparationAuthority(preparation, before);
      const preparationSnapshot = canonicalizeJson(preparation as unknown as JsonValue);

      stage = "validation";
      const change = createForwardChange(proposal, proposalDigest, commandDigest, afterContent);
      const diagnostics: KnowledgeDiagnostic[] = [];
      const structural = validateKnowledgeFileChange(change);
      diagnostics.push(...structural.diagnostics);
      const primarySourceId = proposal.request.intent.current.primarySourceId;
      const forwardBoundaryValid =
        change.operation === "update" &&
        change.path === proposal.request.pagePath &&
        change.beforeHash === before.acceptanceAuthority.vaultObservedBeforeHash &&
        change.sourceRefs.length === 1 &&
        change.sourceRefs[0] === primarySourceId &&
        isPathWithinRoot(change.path, preparation.bundle.wikiRoot) &&
        toWindowsPathKey(change.path) !== toWindowsPathKey(preparation.bundle.wikiRoot) &&
        !preparation.bundle.sourceRoots.some((root) => isPathWithinRoot(change.path, root)) &&
        before.historicalCitations.every(
          (citation) => citation.locator.sourceId === primarySourceId
        );
      const citationsValid = structural.valid
        ? validateProductionCandidateCitations(
            preparation.artifacts,
            before.historicalCitations,
            diagnostics
          )
        : false;
      const generated =
        structural.valid && forwardBoundaryValid
          ? validateProductionGeneratedDocuments(
              preparation.bundle.wikiRoot,
              [change],
              before.historicalCitations,
              diagnostics
            )
          : { okfValid: false, linksValid: false };
      assertNotAborted(signal);
      const validated = requireSuccessfulKnowledgeForwardRevisionValidation({
        validation: {
          okfValid: generated.okfValid,
          citationsValid,
          linksValid: generated.linksValid,
        },
        diagnostics,
      });
      const acceptedCandidate = createValidatedCandidate(
        proposal,
        change,
        before.historicalCitations
      );

      stage = "page";
      const confirmedContent = await readCurrentPage(state, proposal, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (
        confirmedContent !== currentContent ||
        createFileContentHash(confirmedContent) !==
          before.acceptanceAuthority.vaultObservedBeforeHash
      ) {
        fail("page_stale");
      }
      stage = "source";
      const confirmedPreparation = await state.plan.prepare(sourceJob, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      assertPreparationAuthority(confirmedPreparation, before);
      if (canonicalizeJson(confirmedPreparation as unknown as JsonValue) !== preparationSnapshot) {
        fail("source_stale");
      }
      stage = "authority";
      const afterValue = await state.runtime.readForwardRevisionValidationAuthority(query);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (!afterValue) fail("authority_changed");
      const after = snapshotKnowledgeForwardRevisionValidationAuthority(afterValue);
      assertAuthoritySandwich(before, after);
      stage = "source";
      assertPreparationAuthority(confirmedPreparation, after);
      const planDigestAfter = state.plan.getDigest();
      const pipelineProfileAfter = state.plan.getBundlePipelineProfile(proposal.request.bundleId);
      if (
        planDigestAfter !== planDigestBefore ||
        !pipelineProfileAfter ||
        canonicalizeJson(pipelineProfileAfter as unknown as JsonValue) !== pipelineProfileSnapshot
      ) {
        fail("source_stale");
      }

      stage = "validation";
      const validationReadSet =
        createKnowledgeForwardRevisionValidationReadSet(confirmedPreparation);
      const bindingDigest = createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        after.acceptanceAuthority,
        validationReadSet
      );
      const validatedAt = Math.max(
        proposal.recordedAt,
        proposal.request.historicalReviewAuthority.acceptedAt,
        after.acceptanceAuthority.currentSourceFreshness.completedAt
      );
      const receipt = createKnowledgeForwardRevisionValidationReceipt({
        proposal,
        proposalDigest,
        command,
        afterContent,
        validation: validated.validation,
        validationProfile: createKnowledgeForwardRevisionValidationProfile(
          confirmedPreparation,
          pipelineProfile as unknown as JsonValue,
          planDigestAfter
        ),
        acceptanceAuthority: after.acceptanceAuthority,
        historicalCitations: after.historicalCitations,
        validationReadSet,
        sourceArtifactObservationBindingDigest: bindingDigest,
        warningSummary: validated.warningSummary,
        validatedAt,
      });
      snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
        receipt,
        proposal,
        proposalDigest,
        command,
        afterContent
      );
      const projection = Object.freeze({
        version: 1 as const,
        kind: "forward_revision_validation_capability_projection" as const,
        proposal,
        proposalDigest,
        command,
        commandDigest,
        afterContent,
        acceptedAfterHash,
        candidate: acceptedCandidate,
        candidateDigest: createForwardCandidateDigest(acceptedCandidate),
        receipt,
        receiptDigest: receipt.receiptDigest,
        beforeAuthorityDigest: before.authorityDigest,
        afterAuthorityDigest: after.authorityDigest,
        validationReadSet: receipt.validationReadSet,
      });
      assertCoordinatorCurrent(state);
      const capability = mintValidationCapability?.(
        Object.freeze({
          projection,
          executionOwner: state.executionOwner,
          assertCurrent: () => assertCoordinatorCurrent(state),
        })
      );
      if (!capability) fail("dependency_invalid");
      KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
        capability,
        state.executionOwner
      );
      return Object.freeze({ kind: "validated" as const, capability });
    } catch (error) {
      if (KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)) throw error;
      if (signal?.aborted) fail("aborted");
      const resolverCode = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
      if (resolverCode === "resource_limit") fail("resource_limit");
      if (resolverCode === "aborted") fail("aborted");
      if (resolverCode) fail("page_stale");
      if (stage === "request") fail("request_invalid");
      if (stage === "page") fail("page_stale");
      if (stage === "source") fail("source_stale");
      if (stage === "validation") fail("validation_failed");
      fail("authority_unavailable");
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionValidationCoordinator.prototype);
Object.freeze(KnowledgeProductionForwardRevisionValidationCoordinator);
