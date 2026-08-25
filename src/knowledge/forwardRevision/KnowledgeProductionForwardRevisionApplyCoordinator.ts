import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  projectKnowledgeForwardRevisionApplyJournalApplying,
  projectKnowledgeForwardRevisionApplyJournalCommitted,
  projectKnowledgeForwardRevisionApplyJournalRecoveryRequired,
  projectKnowledgeForwardRevisionRecoveryJournalCommitted,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionApplyJournalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  knowledgeForwardRevisionApplyRecoveryExpectationMatchesJournal,
  snapshotKnowledgeForwardRevisionApplyRecoveryExpectation,
  type KnowledgeForwardRevisionApplyRecoveryExpectationV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRecoveryExpectation";
import {
  snapshotKnowledgeForwardRevisionApplyLedgerRecord,
  type KnowledgeForwardRevisionApplyLedgerRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  validateProductionCandidateCitations,
  validateProductionGeneratedDocuments,
} from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import {
  ObsidianKnowledgeCompilerTargetResolver,
  ObsidianKnowledgeCompilerTargetResolverError,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import {
  createKnowledgeForwardRevisionApplyRevalidationReceipt,
  createKnowledgeForwardRevisionApplyRevalidationReceiptDigest,
  type KnowledgeForwardRevisionApplyRevalidationReceiptV1,
  type KnowledgeForwardRevisionSourceBaseV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import {
  isForwardApplyBody,
  isForwardApplyDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import { type KnowledgeForwardRevisionAcceptedDecisionRecordV1 } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionReviewCommand,
  createKnowledgeForwardRevisionReviewCommandDigest,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
  type KnowledgeForwardRevisionValidationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import {
  createKnowledgeForwardRevisionValidationProfile,
  createKnowledgeForwardRevisionValidationReadSet,
  requireSuccessfulKnowledgeForwardRevisionValidation,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceExecutionPlan,
  type KnowledgeSourceParsePreparation,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY } from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeDiagnostic, KnowledgeFileChange } from "@/knowledge/model/types";
import { validateKnowledgeFileChange } from "@/knowledge/model/validation";
import { isPathWithinRoot, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeRuntimeForwardRevisionApplyPort,
  KnowledgeRuntimeForwardRevisionApplyRecoveryPort,
  snapshotKnowledgeForwardRevisionApplyAuthority,
  snapshotKnowledgeForwardRevisionApplyAuthorityQuery,
  type KnowledgeForwardRevisionApplyAuthority,
  type KnowledgeForwardRevisionApplyAuthorityQuery,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeFileObservationLimitError,
  ObsidianKnowledgeFileStore,
} from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import { sha256 } from "@/utils/hash";

const CAPABILITY_TOKEN = Symbol("KnowledgeForwardRevisionApplyCapability.constructor");
const TRANSITION_CAPABILITY_TOKEN = Symbol(
  "KnowledgeForwardRevisionApplyTransitionCapability.constructor"
);
const MAX_WIKI_PAGE_BYTES = 8_000_000;
const MAX_WIKI_PAGE_CHARACTERS = 2_000_000;
const MAX_VALIDATION_DIAGNOSTICS = 10_000;

/** Stable value-free failures exposed before a durable forward Apply journal exists. */
export type KnowledgeForwardRevisionApplyCoordinatorErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "authority_unavailable"
  | "authority_changed"
  | "source_stale"
  | "page_stale"
  | "validation_failed"
  | "resource_limit"
  | "aborted";

/** Scalar-only request selecting one exact accepted decision and Apply claim. */
export type KnowledgeForwardRevisionApplyRequest = KnowledgeForwardRevisionApplyAuthorityQuery;

/** Complete detached material bound by one newly minted process-local Apply capability. */
export interface KnowledgeForwardRevisionApplyCapabilityProjectionV1 {
  readonly version: 1;
  readonly kind: "forward_revision_apply_capability_projection";
  readonly request: Readonly<KnowledgeForwardRevisionApplyRequest>;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly acceptedDecisionDigest: string;
  readonly beforeAuthority: Readonly<KnowledgeForwardRevisionApplyAuthority>;
  readonly afterAuthority: Readonly<KnowledgeForwardRevisionApplyAuthority>;
  readonly applyAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  readonly sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>;
  readonly sourceBaseDigest: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
  readonly afterContent: string;
  readonly afterHash: string;
  readonly reviewCommand: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
  readonly reviewCommandDigest: string;
  readonly freshValidationReceipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>;
  readonly freshValidationReceiptDigest: string;
  readonly revalidationReceipt: Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1>;
  readonly revalidationReceiptDigest: string;
}

/** Content-free file observation retained by a post-journal transition proof. */
export type KnowledgeForwardRevisionApplyTransitionObservationV1 =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "directory" }>
  | Readonly<{ kind: "oversized_file" }>
  | Readonly<{ kind: "file"; contentHash: string }>;

/** Exact durable transition or finalization authorized by one physical observation. */
export type KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1 =
  | Readonly<{
      version: 1;
      kind: "forward_revision_apply_transition_capability_projection";
      transition: "applying" | "committed" | "recovery_required";
      previousJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      previousJournalDigest: string;
      nextJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      nextJournalDigest: string;
      observation: KnowledgeForwardRevisionApplyTransitionObservationV1;
    }>
  | Readonly<{
      version: 1;
      kind: "forward_revision_apply_transition_capability_projection";
      transition: "recovery_committed";
      previousJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      previousJournalDigest: string;
      nextJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      nextJournalDigest: string;
      observation: Readonly<{ kind: "file"; contentHash: string }>;
      observedAt: number;
    }>
  | Readonly<{
      version: 1;
      kind: "forward_revision_apply_transition_capability_projection";
      transition: "finalize";
      previousJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      previousJournalDigest: string;
      observation: Readonly<{ kind: "file"; contentHash: string }>;
    }>
  | Readonly<{
      version: 1;
      kind: "forward_revision_apply_transition_capability_projection";
      transition: "terminalize";
      previousJournal: Readonly<KnowledgeForwardRevisionApplyJournalV1>;
      previousJournalDigest: string;
      observation: KnowledgeForwardRevisionApplyTransitionObservationV1;
      observedAt: number;
    }>;

/** Scalar-only outcome of converging one already-durable forward Apply journal. */
export type KnowledgeProductionForwardRevisionApplyRecoveryResult =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "committed";
      bundleId: string;
      transactionId: string;
      ledgerId: string;
      ledgerDigest: string;
      appliedAt: number;
    }>
  | Readonly<{
      kind: "recovery_required";
      bundleId: string;
      transactionId: string;
      journalRevision: number;
      conflictCode: "file_state_conflict" | "post_write_verification_failed";
    }>
  | Readonly<{
      kind: "kept_current";
      bundleId: string;
      transactionId: string;
      outcome:
        | "abandoned_before_write"
        | "write_outcome_uncertain_external_supersession"
        | "committed_then_external_supersession";
      terminalizedAt: number;
    }>
  | Readonly<{
      kind: "in_progress";
      bundleId: string;
      transactionId: string;
      phase: "prepared" | "applying" | "committed";
    }>;

interface ObservedForwardRevisionApplyTarget {
  readonly observation: KnowledgeForwardRevisionApplyTransitionObservationV1;
  readonly matchesBefore: boolean;
  readonly matchesAfter: boolean;
}

interface CoordinatorState {
  readonly runtime: KnowledgeRuntimeForwardRevisionApplyPort;
  readonly transactionRunner: KnowledgeProductionForwardRevisionApplyTransactionRunner;
  readonly plan: KnowledgeSourceExecutionPlan;
  readonly targetVisitor: ObsidianKnowledgeCompilerTargetResolver;
  readonly fileStore: ObsidianKnowledgeFileStore;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

interface CapabilityState {
  readonly projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

interface TransitionCapabilityState {
  readonly projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

interface TransactionRunnerState {
  readonly recovery: KnowledgeRuntimeForwardRevisionApplyRecoveryPort;
  readonly fileStore: ObsidianKnowledgeFileStore;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly clock: () => number;
}

const coordinatorStates = new WeakMap<object, Readonly<CoordinatorState>>();
const coordinatorOperationTails = new WeakMap<object, Promise<void>>();
const capabilityStates = new WeakMap<object, Readonly<CapabilityState>>();
const transitionCapabilityStates = new WeakMap<object, Readonly<TransitionCapabilityState>>();
const transactionRunnerStates = new WeakMap<object, Readonly<TransactionRunnerState>>();
const errorCodes = new WeakMap<object, KnowledgeForwardRevisionApplyCoordinatorErrorCode>();
let mintApplyCapability:
  | ((state: Readonly<CapabilityState>) => KnowledgeForwardRevisionApplyCapability)
  | undefined;
let mintTransitionCapability:
  | ((
      state: Readonly<TransitionCapabilityState>
    ) => KnowledgeForwardRevisionApplyTransitionCapability)
  | undefined;

/** Sanitized pre-journal failure that never retains candidate or Vault content. */
export class KnowledgeForwardRevisionApplyCoordinatorError extends Error {
  /** Creates an authentic value-free failure only for this module. */
  private constructor(token: symbol, code: KnowledgeForwardRevisionApplyCoordinatorErrorCode) {
    super(`Forward revision Apply preparation failed: ${code}`);
    this.name = "KnowledgeForwardRevisionApplyCoordinatorError";
    if (token === CAPABILITY_TOKEN) errorCodes.set(this, code);
    Object.freeze(this);
  }

  /** Returns the stable code only for a module-authentic error. */
  static inspect(value: unknown): KnowledgeForwardRevisionApplyCoordinatorErrorCode | undefined {
    return (typeof value === "object" || typeof value === "function") && value !== null
      ? errorCodes.get(value)
      : undefined;
  }

  /** Mints one internal sanitized error. */
  static create(
    token: symbol,
    code: KnowledgeForwardRevisionApplyCoordinatorErrorCode
  ): KnowledgeForwardRevisionApplyCoordinatorError {
    if (token !== CAPABILITY_TOKEN) throw new TypeError("Invalid forward Apply error token");
    return new KnowledgeForwardRevisionApplyCoordinatorError(CAPABILITY_TOKEN, code);
  }
}

Object.freeze(KnowledgeForwardRevisionApplyCoordinatorError.prototype);
Object.freeze(KnowledgeForwardRevisionApplyCoordinatorError);

/** Throws one authentic fixed coordinator failure. */
function fail(code: KnowledgeForwardRevisionApplyCoordinatorErrorCode): never {
  throw KnowledgeForwardRevisionApplyCoordinatorError.create(CAPABILITY_TOKEN, code);
}

/** Stops pre-journal work without retaining an arbitrary AbortSignal reason. */
function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) fail("aborted");
}

/** Re-proves all same-owner process-local dependencies around every await. */
function assertCoordinatorCurrent(state: Readonly<CoordinatorState>): void {
  try {
    state.assertCurrent();
    if (
      !KnowledgeRuntimeForwardRevisionApplyPort.matchesExecutionOwner(
        state.runtime,
        state.executionOwner
      ) ||
      !KnowledgeProductionForwardRevisionApplyTransactionRunner.matchesExecutionOwner(
        state.transactionRunner,
        state.executionOwner
      ) ||
      !state.plan.matchesExecutionOwner(state.executionOwner) ||
      !ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(
        state.targetVisitor,
        state.executionOwner
      ) ||
      !ObsidianKnowledgeFileStore.matchesExecutionOwner(state.fileStore, state.executionOwner)
    ) {
      fail("dependency_invalid");
    }
  } catch (error) {
    if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
    fail("dependency_invalid");
  }
}

/** Re-proves the owner-bound physical store retained after a durable begin. */
function assertTransactionRunnerCurrent(state: Readonly<TransactionRunnerState>): void {
  try {
    KnowledgeRuntimeForwardRevisionApplyRecoveryPort.assert(state.recovery);
    if (
      !KnowledgeRuntimeForwardRevisionApplyRecoveryPort.matchesExecutionOwner(
        state.recovery,
        state.executionOwner
      ) ||
      !ObsidianKnowledgeFileStore.matchesExecutionOwner(state.fileStore, state.executionOwner)
    ) {
      fail("dependency_invalid");
    }
  } catch (error) {
    if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
    fail("dependency_invalid");
  }
}

/** Returns hidden recovery dependencies only for one exact runner. */
function requireTransactionRunnerState(value: unknown): Readonly<TransactionRunnerState> {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    fail("dependency_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== KnowledgeProductionForwardRevisionApplyTransactionRunner.prototype
  ) {
    fail("dependency_invalid");
  }
  const state = transactionRunnerStates.get(value);
  if (!state) fail("dependency_invalid");
  assertTransactionRunnerCurrent(state);
  return state;
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
    prototype !== KnowledgeProductionForwardRevisionApplyCoordinator.prototype
  ) {
    fail("dependency_invalid");
  }
  const state = coordinatorStates.get(value);
  if (!state) fail("dependency_invalid");
  return state;
}

/** Detaches and cross-validates one genuine Runtime Apply authority projection. */
function snapshotAuthority(
  value: unknown,
  request: Readonly<KnowledgeForwardRevisionApplyRequest>
): Readonly<KnowledgeForwardRevisionApplyAuthority> {
  try {
    return snapshotKnowledgeForwardRevisionApplyAuthority(value, request);
  } catch (error) {
    if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
    fail("authority_unavailable");
  }
}

/** Removes only enclosing Runtime volatility before a two-read semantic comparison. */
function projectAuthoritySemantics(
  authority: Readonly<KnowledgeForwardRevisionApplyAuthority>
): JsonValue {
  const {
    runtimeRevision: _runtimeRevision,
    runtimeDigest: _runtimeDigest,
    sourceBase,
    ...stable
  } = authority;
  const freshness = { ...sourceBase.currentSourceFreshness } as Record<string, unknown>;
  delete freshness.runtimeId;
  delete freshness.runtimeRevision;
  delete freshness.runtimeDigest;
  delete freshness.manifestRevision;
  delete freshness.manifestDigest;
  void _runtimeRevision;
  void _runtimeDigest;
  return {
    ...(stable as unknown as Record<string, JsonValue>),
    sourceBase: {
      ...sourceBase,
      currentSourceFreshness: freshness,
    } as unknown as JsonValue,
  };
}

/** Requires a later Runtime read to preserve every Apply-relevant semantic fact. */
function assertAuthoritySandwich(
  before: Readonly<KnowledgeForwardRevisionApplyAuthority>,
  after: Readonly<KnowledgeForwardRevisionApplyAuthority>
): void {
  if (
    after.runtimeRevision < before.runtimeRevision ||
    (after.runtimeRevision === before.runtimeRevision &&
      after.runtimeDigest !== before.runtimeDigest) ||
    canonicalizeJson(projectAuthoritySemantics(after)) !==
      canonicalizeJson(projectAuthoritySemantics(before))
  ) {
    fail("authority_changed");
  }
}

/** Requires parser preparation to identify the exact current accepted source base. */
function assertPreparationAuthority(
  preparation: Readonly<KnowledgeSourceParsePreparation>,
  authority: Readonly<KnowledgeForwardRevisionApplyAuthority>
): void {
  const accepted = authority.acceptedDecision;
  const sourceBase = authority.sourceBase;
  const freshness = sourceBase.currentSourceFreshness;
  const source = preparation.manifest.entries.find(
    (entry) => entry.sourceId === sourceBase.sourceId
  );
  if (
    preparation.authority !== "unbound_read_only" ||
    preparation.operation !== "ingest" ||
    preparation.bundle.id !== authority.query.bundleId ||
    preparation.source.sourceId !== sourceBase.sourceId ||
    preparation.source.sourceContentHash !== freshness.sourceContentHash ||
    preparation.source.pipelineFingerprint !== freshness.pipelineFingerprint ||
    preparation.source.inputRevision !== freshness.inputRevision ||
    preparation.manifest.bundleId !== authority.query.bundleId ||
    preparation.manifest.revision !== authority.manifestRevision ||
    createSourceManifestDigest(preparation.manifest) !== authority.manifestDigest ||
    !source?.lastSuccessful ||
    canonicalizeJson(source.lastSuccessful as unknown as JsonValue) !==
      canonicalizeJson(sourceBase.lastSuccessful as unknown as JsonValue) ||
    canonicalizeJson(
      source.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY] as JsonValue
    ) !== canonicalizeJson(sourceBase.runtimeSourceCommitExtension) ||
    !source.lastSuccessful.generatedPages.some(
      (page) =>
        page.path === authority.query.pagePath &&
        page.ownership === "generated" &&
        page.contentHash === accepted.acceptanceAuthority.manifestBaseHash
    ) ||
    preparation.artifacts.length < 1 ||
    preparation.artifacts.some((artifact) => artifact.sourceId !== sourceBase.sourceId)
  ) {
    fail("source_stale");
  }
}

/** Creates the exact single-page update validated for this accepted decision. */
function createForwardApplyChange(
  authority: Readonly<KnowledgeForwardRevisionApplyAuthority>,
  commandDigest: string
): Readonly<Extract<KnowledgeFileChange, { operation: "update" }>> {
  const accepted = authority.acceptedDecision;
  const afterHash = createFileContentHash(accepted.afterContent);
  const identity = sha256(
    `knowledge-forward-revision-apply-candidate-v1\n${canonicalizeJson({
      acceptedDecisionDigest: accepted.acceptedDecisionDigest,
      commandDigest,
      afterHash,
    })}`
  );
  const sourceRefs = [authority.sourceBase.sourceId];
  Object.freeze(sourceRefs);
  return Object.freeze({
    id: `forward-revision-apply-change-${identity}`,
    operation: "update" as const,
    path: authority.query.pagePath,
    sourceRefs,
    reason: "Apply the reviewed forward revision",
    beforeHash: accepted.acceptanceAuthority.vaultObservedBeforeHash,
    afterContent: accepted.afterContent,
    afterHash,
  });
}

/** Reads one bounded exact Wiki target through the genuine owner-bound visitor. */
async function readCurrentPage(
  state: Readonly<CoordinatorState>,
  path: string,
  signal: AbortSignal
): Promise<string> {
  let visits = 0;
  let content: string | undefined;
  await state.targetVisitor.visit(
    [
      {
        targetId: "forward-revision-apply-target",
        path,
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
        observation.targetId !== "forward-revision-apply-target" ||
        observation.kind !== "file" ||
        observation.path !== path ||
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
  assertCoordinatorCurrent(state);
  assertNotAborted(signal);
  if (visits !== 1 || content === undefined || !isForwardApplyBody(content)) {
    fail(content === undefined ? "page_stale" : "resource_limit");
  }
  return content;
}

/** Rebuilds the exact accepted Review command retained by the durable validation receipt. */
function createAcceptedCommand(
  accepted: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>
): Readonly<KnowledgeForwardRevisionReviewCommandV1> {
  const receipt = accepted.validationReceipt;
  const command = createKnowledgeForwardRevisionReviewCommand(
    receipt.action === "accept_exact"
      ? {
          action: "accept_exact",
          proposal: accepted.proposal,
          proposalDigest: accepted.proposalDigest,
        }
      : {
          action: "accept_edited",
          proposal: accepted.proposal,
          proposalDigest: accepted.proposalDigest,
          afterContent: accepted.afterContent,
        }
  );
  if (
    command.commandId !== receipt.commandId ||
    createKnowledgeForwardRevisionReviewCommandDigest(command) !== receipt.commandDigest
  ) {
    fail("authority_unavailable");
  }
  return command;
}

/** Opaque process-local proof minted only by a complete fresh Apply revalidation. */
export class KnowledgeForwardRevisionApplyCapability {
  /** Installs fully detached hidden state behind the private module token. */
  private constructor(token: symbol, state: Readonly<CapabilityState>) {
    if (token !== CAPABILITY_TOKEN) fail("dependency_invalid");
    capabilityStates.set(this, state);
    Object.freeze(this);
  }

  static {
    mintApplyCapability = (state) =>
      new KnowledgeForwardRevisionApplyCapability(CAPABILITY_TOKEN, state);
  }

  /** Requires one exact-prototype current capability minted in this process. */
  static assert(value: unknown): asserts value is KnowledgeForwardRevisionApplyCapability {
    let prototype: object | null;
    try {
      prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
    } catch {
      fail("dependency_invalid");
    }
    const state = typeof value === "object" && value !== null ? capabilityStates.get(value) : null;
    if (prototype !== KnowledgeForwardRevisionApplyCapability.prototype || !state) {
      fail("dependency_invalid");
    }
    try {
      state.assertCurrent();
    } catch {
      fail("dependency_invalid");
    }
  }

  /** Requires this proof to belong to one exact live execution owner. */
  static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
    KnowledgeForwardRevisionApplyCapability.assert(value);
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      if (capabilityStates.get(value)?.executionOwner !== executionOwner) {
        fail("dependency_invalid");
      }
    } catch (error) {
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /** Projects immutable accepted bytes and revalidation facts for the Runtime begin CAS. */
  static project(value: unknown): Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1> {
    KnowledgeForwardRevisionApplyCapability.assert(value);
    const state = capabilityStates.get(value);
    if (!state) fail("dependency_invalid");
    return state.projection;
  }
}

Object.freeze(KnowledgeForwardRevisionApplyCapability.prototype);
Object.freeze(KnowledgeForwardRevisionApplyCapability);

/**
 * Opaque process-local proof of one post-journal physical observation.
 *
 * Unlike the pre-journal Apply capability, this proof deliberately does not
 * depend on the workflow lease remaining live. Once a prepared journal is
 * durable, recovery must converge according to the observed file state even
 * after the originating UI generation is revoked.
 */
export class KnowledgeForwardRevisionApplyTransitionCapability {
  /** Installs one detached transition behind the private module token. */
  private constructor(token: symbol, state: Readonly<TransitionCapabilityState>) {
    if (token !== TRANSITION_CAPABILITY_TOKEN) fail("dependency_invalid");
    transitionCapabilityStates.set(this, state);
    Object.freeze(this);
  }

  static {
    mintTransitionCapability = (state) =>
      new KnowledgeForwardRevisionApplyTransitionCapability(TRANSITION_CAPABILITY_TOKEN, state);
  }

  /** Requires one exact-prototype current transition proof minted by this module. */
  static assert(
    value: unknown
  ): asserts value is KnowledgeForwardRevisionApplyTransitionCapability {
    let prototype: object | null;
    try {
      prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
    } catch {
      fail("dependency_invalid");
    }
    const state =
      typeof value === "object" && value !== null
        ? transitionCapabilityStates.get(value)
        : undefined;
    if (prototype !== KnowledgeForwardRevisionApplyTransitionCapability.prototype || !state) {
      fail("dependency_invalid");
    }
    try {
      state.assertCurrent();
    } catch (error) {
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /** Requires this proof to belong to one exact execution owner. */
  static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
    KnowledgeForwardRevisionApplyTransitionCapability.assert(value);
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      if (transitionCapabilityStates.get(value)?.executionOwner !== executionOwner) {
        fail("dependency_invalid");
      }
    } catch (error) {
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /** Projects the exact journal transition authorized by the physical observation. */
  static project(
    value: unknown
  ): Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1> {
    KnowledgeForwardRevisionApplyTransitionCapability.assert(value);
    const state = transitionCapabilityStates.get(value);
    if (!state) fail("dependency_invalid");
    return state.projection;
  }
}

Object.freeze(KnowledgeForwardRevisionApplyTransitionCapability.prototype);
Object.freeze(KnowledgeForwardRevisionApplyTransitionCapability);

/** Returns a monotonic safe transition timestamp from the retained clock. */
function readTransitionTime(
  state: Readonly<TransactionRunnerState>,
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): number {
  let value: number;
  try {
    value = state.clock();
  } catch {
    fail("dependency_invalid");
  }
  if (!Number.isSafeInteger(value) || value < 0) fail("dependency_invalid");
  return Math.max(value, journal.updatedAt);
}

/** Creates one frozen content-free physical observation. */
function snapshotTransitionObservation(
  value: KnowledgeForwardRevisionApplyTransitionObservationV1
): KnowledgeForwardRevisionApplyTransitionObservationV1 {
  try {
    if (value.kind === "file") {
      if (!isForwardApplyDigest(value.contentHash)) throw new TypeError();
      return Object.freeze({ kind: "file" as const, contentHash: value.contentHash });
    }
    if (value.kind !== "missing" && value.kind !== "directory" && value.kind !== "oversized_file") {
      throw new TypeError();
    }
    return Object.freeze({ kind: value.kind });
  } catch {
    fail("dependency_invalid");
  }
}

/** Mints one exact journal-advance proof from detached strict material. */
function mintJournalAdvanceCapability(
  state: Readonly<TransactionRunnerState>,
  transition: "applying" | "committed" | "recovery_required",
  previousValue: unknown,
  nextValue: unknown,
  observationValue: KnowledgeForwardRevisionApplyTransitionObservationV1
): KnowledgeForwardRevisionApplyTransitionCapability {
  const previousJournal = snapshotKnowledgeForwardRevisionApplyJournal(previousValue);
  const nextJournal = snapshotKnowledgeForwardRevisionApplyJournal(nextValue);
  const observation = snapshotTransitionObservation(observationValue);
  const projection = Object.freeze({
    version: 1 as const,
    kind: "forward_revision_apply_transition_capability_projection" as const,
    transition,
    previousJournal,
    previousJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(previousJournal),
    nextJournal,
    nextJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(nextJournal),
    observation,
  });
  const capability = mintTransitionCapability?.(
    Object.freeze({
      projection,
      executionOwner: state.executionOwner,
      assertCurrent: () => assertTransactionRunnerCurrent(state),
    })
  );
  if (!capability) fail("dependency_invalid");
  KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
    capability,
    state.executionOwner
  );
  return capability;
}

/** Mints the dedicated recovery-to-committed proof after a fresh exact-after observation. */
function mintRecoveryCommittedCapability(
  state: Readonly<TransactionRunnerState>,
  previousValue: unknown,
  nextValue: unknown,
  observedAt: number
): KnowledgeForwardRevisionApplyTransitionCapability {
  const previousJournal = snapshotKnowledgeForwardRevisionApplyJournal(previousValue);
  const nextJournal = snapshotKnowledgeForwardRevisionApplyJournal(nextValue);
  if (
    previousJournal.phase !== "recovery_required" ||
    nextJournal.phase !== "committed" ||
    !Number.isSafeInteger(observedAt) ||
    observedAt < previousJournal.updatedAt
  ) {
    fail("dependency_invalid");
  }
  const observation = Object.freeze({
    kind: "file" as const,
    contentHash: previousJournal.afterHash,
  });
  const projection = Object.freeze({
    version: 1 as const,
    kind: "forward_revision_apply_transition_capability_projection" as const,
    transition: "recovery_committed" as const,
    previousJournal,
    previousJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(previousJournal),
    nextJournal,
    nextJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(nextJournal),
    observation,
    observedAt,
  });
  const capability = mintTransitionCapability?.(
    Object.freeze({
      projection,
      executionOwner: state.executionOwner,
      assertCurrent: () => assertTransactionRunnerCurrent(state),
    })
  );
  if (!capability) fail("dependency_invalid");
  KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
    capability,
    state.executionOwner
  );
  return capability;
}

/** Mints one exact committed-journal finalization proof. */
function mintJournalFinalizeCapability(
  state: Readonly<TransactionRunnerState>,
  journalValue: unknown
): KnowledgeForwardRevisionApplyTransitionCapability {
  const previousJournal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
  if (previousJournal.phase !== "committed") fail("dependency_invalid");
  const observation = Object.freeze({
    kind: "file" as const,
    contentHash: previousJournal.afterHash,
  });
  const projection = Object.freeze({
    version: 1 as const,
    kind: "forward_revision_apply_transition_capability_projection" as const,
    transition: "finalize" as const,
    previousJournal,
    previousJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(previousJournal),
    observation,
  });
  const capability = mintTransitionCapability?.(
    Object.freeze({
      projection,
      executionOwner: state.executionOwner,
      assertCurrent: () => assertTransactionRunnerCurrent(state),
    })
  );
  if (!capability) fail("dependency_invalid");
  KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
    capability,
    state.executionOwner
  );
  return capability;
}

/** Mints one exact no-write terminalization proof from a fresh physical observation. */
function mintJournalTerminalizationCapability(
  state: Readonly<TransactionRunnerState>,
  journalValue: unknown,
  observationValue: KnowledgeForwardRevisionApplyTransitionObservationV1,
  observedAt: number
): KnowledgeForwardRevisionApplyTransitionCapability {
  const previousJournal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
  if (
    previousJournal.phase !== "recovery_required" ||
    !Number.isSafeInteger(observedAt) ||
    observedAt < previousJournal.updatedAt
  ) {
    fail("dependency_invalid");
  }
  const observation = snapshotTransitionObservation(observationValue);
  const projection = Object.freeze({
    version: 1 as const,
    kind: "forward_revision_apply_transition_capability_projection" as const,
    transition: "terminalize" as const,
    previousJournal,
    previousJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(previousJournal),
    observation,
    observedAt,
  });
  const capability = mintTransitionCapability?.(
    Object.freeze({
      projection,
      executionOwner: state.executionOwner,
      assertCurrent: () => assertTransactionRunnerCurrent(state),
    })
  );
  if (!capability) fail("dependency_invalid");
  KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
    capability,
    state.executionOwner
  );
  return capability;
}

/** Observes one journal target without retaining oversized or conflicting bytes. */
async function observeJournalTarget(
  state: Readonly<TransactionRunnerState>,
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): Promise<Readonly<ObservedForwardRevisionApplyTarget>> {
  assertTransactionRunnerCurrent(state);
  try {
    const observed = await state.fileStore.observeBounded(journal.pagePath, {
      maxBytes: MAX_WIKI_PAGE_BYTES,
      maxCharacters: MAX_WIKI_PAGE_CHARACTERS,
    });
    assertTransactionRunnerCurrent(state);
    if (observed.kind === "file") {
      const contentHash = createFileContentHash(observed.content);
      return Object.freeze({
        observation: Object.freeze({ kind: "file" as const, contentHash }),
        matchesBefore: observed.content === journal.beforeContent,
        matchesAfter: observed.content === journal.afterContent,
      });
    }
    return Object.freeze({
      observation: Object.freeze({ kind: observed.kind }),
      matchesBefore: false,
      matchesAfter: false,
    });
  } catch (error) {
    if (KnowledgeFileObservationLimitError.inspect(error)) {
      return Object.freeze({
        observation: Object.freeze({ kind: "oversized_file" as const }),
        matchesBefore: false,
        matchesAfter: false,
      });
    }
    throw error;
  }
}

/** Projects one durable sticky conflict matching an exact physical observation. */
async function persistRecoveryRequired(
  state: Readonly<TransactionRunnerState>,
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>,
  observed: Readonly<ObservedForwardRevisionApplyTarget>,
  code: "file_state_conflict" | "post_write_verification_failed"
): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1>> {
  const detectedAt = readTransitionTime(state, journal);
  const next = projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(journal, {
    code,
    actualKind: observed.observation.kind,
    ...(observed.observation.kind === "file"
      ? { actualHash: observed.observation.contentHash }
      : {}),
    detectedAt,
  });
  return state.recovery.advance(
    mintJournalAdvanceCapability(state, "recovery_required", journal, next, observed.observation)
  );
}

/** Projects one content-free committed result from a strict durable ledger. */
function projectCommittedResult(
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
): Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult> {
  return Object.freeze({
    kind: "committed" as const,
    bundleId: ledger.bundleId,
    transactionId: ledger.transactionId,
    ledgerId: ledger.ledgerId,
    ledgerDigest: ledger.ledgerDigest,
    appliedAt: ledger.appliedAt,
  });
}

/** Projects one content-free sticky-recovery result. */
function projectRecoveryResult(
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult> {
  if (journal.phase !== "recovery_required") fail("dependency_invalid");
  return Object.freeze({
    kind: "recovery_required" as const,
    bundleId: journal.bundleId,
    transactionId: journal.transactionId,
    journalRevision: journal.revision,
    conflictCode: journal.conflict.code,
  });
}

/**
 * Genuine post-journal runner for forward Apply and startup recovery.
 *
 * Construction authenticates a live paired Runtime generation, but the runner
 * intentionally retains only the recovery facade, Vault store, and execution
 * owner. Once a prepared journal is durable, caller abort and workflow-lease
 * revocation cannot cancel the commit-wins recovery protocol.
 */
export class KnowledgeProductionForwardRevisionApplyTransactionRunner {
  /** Captures one exact Runtime/Vault pair without retaining a UI workflow lease. */
  constructor(
    recovery: KnowledgeRuntimeForwardRevisionApplyRecoveryPort,
    fileStore: ObsidianKnowledgeFileStore,
    executionOwner: KnowledgeExecutionOwner,
    clock: () => number = Date.now
  ) {
    try {
      KnowledgeRuntimeForwardRevisionApplyRecoveryPort.assert(recovery);
      ObsidianKnowledgeFileStore.assert(fileStore);
      KnowledgeExecutionOwner.assert(executionOwner);
      if (typeof clock !== "function") throw new TypeError();
      const state = Object.freeze({ recovery, fileStore, executionOwner, clock });
      assertTransactionRunnerCurrent(state);
      transactionRunnerStates.set(this, state);
      Object.freeze(this);
    } catch (error) {
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /** Requires one exact-prototype runner with current Runtime/Vault dependencies. */
  static assert(
    value: unknown
  ): asserts value is KnowledgeProductionForwardRevisionApplyTransactionRunner {
    requireTransactionRunnerState(value);
  }

  /** Reports whether a runner is paired with one exact Runtime and Vault. */
  static matchesRuntimeAndVault(value: unknown, runtime: unknown, vault: unknown): boolean {
    try {
      const state = requireTransactionRunnerState(value);
      return (
        KnowledgeRuntimeForwardRevisionApplyRecoveryPort.matchesRuntime(state.recovery, runtime) &&
        ObsidianKnowledgeFileStore.matchesVault(state.fileStore, vault)
      );
    } catch {
      return false;
    }
  }

  /** Reports whether this runner belongs to one exact execution owner. */
  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      return requireTransactionRunnerState(value).executionOwner === executionOwner;
    } catch {
      return false;
    }
  }

  /**
   * Rechecks one sticky conflict and performs only the explicitly selected safe action.
   *
   * Exact-after bytes converge to ledger finalization without another Wiki write.
   * Exact-before bytes may retry the original exact CAS only for recovery revisions
   * one and two. `keep_current` never mutates the Wiki and terminalizes only an
   * externally superseded state.
   */
  async resolveRecovery(
    expectationValue: unknown,
    action: "retry_exact" | "keep_current",
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult>> {
    const state = requireTransactionRunnerState(this);
    let expectation: Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1>;
    try {
      expectation = snapshotKnowledgeForwardRevisionApplyRecoveryExpectation(expectationValue);
    } catch {
      fail("request_invalid");
    }
    if ((action !== "retry_exact" && action !== "keep_current") || signal.aborted) {
      fail(signal.aborted ? "aborted" : "request_invalid");
    }
    const initial = await state.recovery.readActive(signal);
    if (
      initial === null ||
      !knowledgeForwardRevisionApplyRecoveryExpectationMatchesJournal(expectation, initial)
    ) {
      fail("authority_changed");
    }
    let journal = snapshotKnowledgeForwardRevisionApplyJournal(initial);
    if (journal.phase !== "recovery_required") fail("authority_changed");

    let observed = await observeJournalTarget(state, journal);
    let observedAt = readTransitionTime(state, journal);
    if (observed.matchesAfter) {
      const committed = projectKnowledgeForwardRevisionRecoveryJournalCommitted(
        journal,
        observedAt
      );
      journal = await state.recovery.advance(
        mintRecoveryCommittedCapability(state, journal, committed, observedAt)
      );
      return this.recoverActive(new AbortController().signal);
    }

    if (action === "retry_exact") {
      if (!observed.matchesBefore || journal.revision === 3) {
        return projectRecoveryResult(journal);
      }
      let resultKind: "applied" | "already_after" | "conflict" | "threw" = "threw";
      try {
        const result = await state.fileStore.compareAndSwap(
          journal.pagePath,
          { kind: "file", content: journal.beforeContent, contentHash: journal.beforeHash },
          { kind: "file", content: journal.afterContent, contentHash: journal.afterHash }
        );
        assertTransactionRunnerCurrent(state);
        resultKind = result.kind;
      } catch {
        assertTransactionRunnerCurrent(state);
      }
      observed =
        resultKind === "applied" || resultKind === "already_after"
          ? Object.freeze({
              observation: Object.freeze({
                kind: "file" as const,
                contentHash: journal.afterHash,
              }),
              matchesBefore: false,
              matchesAfter: true,
            })
          : await observeJournalTarget(state, journal);
      if (!observed.matchesAfter) return projectRecoveryResult(journal);
      observedAt = readTransitionTime(state, journal);
      const committed = projectKnowledgeForwardRevisionRecoveryJournalCommitted(
        journal,
        observedAt
      );
      await state.recovery.advance(
        mintRecoveryCommittedCapability(state, journal, committed, observedAt)
      );
      return this.recoverActive(new AbortController().signal);
    }

    if (observed.matchesBefore && journal.revision !== 3) {
      return projectRecoveryResult(journal);
    }
    const terminal = await state.recovery.terminalize(
      mintJournalTerminalizationCapability(state, journal, observed.observation, observedAt)
    );
    return Object.freeze({
      kind: "kept_current" as const,
      bundleId: terminal.acceptedIdentity.resource.bundleId,
      transactionId: terminal.journal.transactionId,
      outcome: terminal.outcome,
      terminalizedAt: terminal.terminalizedAt,
    });
  }

  /**
   * Converges the active journal without parser, model, source, or network work.
   *
   * Cancellation is honored only while discovering whether a durable journal
   * exists. After a journal is returned, the method follows commit-wins rules:
   * applying is persisted before Wiki CAS, exact after bytes become committed,
   * and any unrecognizable state becomes a sticky content-free conflict.
   */
  async recoverActive(
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult>> {
    const state = requireTransactionRunnerState(this);
    const initial = await state.recovery.readActive(signal);
    if (initial === null) return Object.freeze({ kind: "idle" as const });
    let journal = snapshotKnowledgeForwardRevisionApplyJournal(initial);
    let casAttempted = false;

    for (let transitionCount = 0; transitionCount < 6; transitionCount += 1) {
      assertTransactionRunnerCurrent(state);
      if (journal.phase === "recovery_required") return projectRecoveryResult(journal);

      const observed = await observeJournalTarget(state, journal);
      if (journal.phase === "prepared") {
        if (!observed.matchesBefore && !observed.matchesAfter) {
          journal = await persistRecoveryRequired(state, journal, observed, "file_state_conflict");
          return projectRecoveryResult(journal);
        }
        const applying = projectKnowledgeForwardRevisionApplyJournalApplying(
          journal,
          readTransitionTime(state, journal)
        );
        journal = await state.recovery.advance(
          mintJournalAdvanceCapability(state, "applying", journal, applying, observed.observation)
        );
        continue;
      }

      if (journal.phase === "committed") {
        if (!observed.matchesAfter) {
          journal = await persistRecoveryRequired(
            state,
            journal,
            observed,
            "post_write_verification_failed"
          );
          return projectRecoveryResult(journal);
        }
        const ledger = snapshotKnowledgeForwardRevisionApplyLedgerRecord(
          await state.recovery.finalize(mintJournalFinalizeCapability(state, journal))
        );
        return projectCommittedResult(ledger);
      }

      if (observed.matchesAfter) {
        const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(
          journal,
          readTransitionTime(state, journal)
        );
        journal = await state.recovery.advance(
          mintJournalAdvanceCapability(state, "committed", journal, committed, observed.observation)
        );
        continue;
      }
      if (!observed.matchesBefore) {
        journal = await persistRecoveryRequired(
          state,
          journal,
          observed,
          "post_write_verification_failed"
        );
        return projectRecoveryResult(journal);
      }
      if (casAttempted) {
        return Object.freeze({
          kind: "in_progress" as const,
          bundleId: journal.bundleId,
          transactionId: journal.transactionId,
          phase: journal.phase,
        });
      }
      casAttempted = true;

      let casKind: "applied" | "already_after" | "conflict" | "threw" = "threw";
      try {
        const result = await state.fileStore.compareAndSwap(
          journal.pagePath,
          { kind: "file", content: journal.beforeContent, contentHash: journal.beforeHash },
          { kind: "file", content: journal.afterContent, contentHash: journal.afterHash }
        );
        assertTransactionRunnerCurrent(state);
        casKind = result.kind;
      } catch {
        assertTransactionRunnerCurrent(state);
      }

      if (casKind === "applied" || casKind === "already_after") {
        const afterObservation = Object.freeze({
          kind: "file" as const,
          contentHash: journal.afterHash,
        });
        const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(
          journal,
          readTransitionTime(state, journal)
        );
        journal = await state.recovery.advance(
          mintJournalAdvanceCapability(state, "committed", journal, committed, afterObservation)
        );
        continue;
      }

      const afterAttempt = await observeJournalTarget(state, journal);
      if (afterAttempt.matchesAfter) {
        const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(
          journal,
          readTransitionTime(state, journal)
        );
        journal = await state.recovery.advance(
          mintJournalAdvanceCapability(
            state,
            "committed",
            journal,
            committed,
            afterAttempt.observation
          )
        );
        continue;
      }
      if (afterAttempt.matchesBefore) {
        return Object.freeze({
          kind: "in_progress" as const,
          bundleId: journal.bundleId,
          transactionId: journal.transactionId,
          phase: journal.phase,
        });
      }
      journal = await persistRecoveryRequired(
        state,
        journal,
        afterAttempt,
        casKind === "conflict" ? "file_state_conflict" : "post_write_verification_failed"
      );
      return projectRecoveryResult(journal);
    }

    if (journal.phase === "recovery_required") return projectRecoveryResult(journal);
    return Object.freeze({
      kind: "in_progress" as const,
      bundleId: journal.bundleId,
      transactionId: journal.transactionId,
      phase: journal.phase,
    });
  }
}

Object.freeze(KnowledgeProductionForwardRevisionApplyTransactionRunner.prototype);
Object.freeze(KnowledgeProductionForwardRevisionApplyTransactionRunner);

/** Genuine no-model coordinator that freshly validates one accepted body before journaling. */
export class KnowledgeProductionForwardRevisionApplyCoordinator {
  /** Captures one exact Runtime/parser/Vault generation and no structural mutation authority. */
  constructor(
    runtime: KnowledgeRuntimeForwardRevisionApplyPort,
    transactionRunner: KnowledgeProductionForwardRevisionApplyTransactionRunner,
    plan: KnowledgeSourceExecutionPlan,
    targetVisitor: ObsidianKnowledgeCompilerTargetResolver,
    fileStore: ObsidianKnowledgeFileStore,
    executionOwner: KnowledgeExecutionOwner,
    assertCurrent: () => void
  ) {
    try {
      KnowledgeRuntimeForwardRevisionApplyPort.assert(runtime);
      KnowledgeProductionForwardRevisionApplyTransactionRunner.assert(transactionRunner);
      KnowledgeSourceExecutionPlan.assert(plan);
      ObsidianKnowledgeCompilerTargetResolver.assert(targetVisitor);
      ObsidianKnowledgeFileStore.assert(fileStore);
      KnowledgeExecutionOwner.assert(executionOwner);
      if (typeof assertCurrent !== "function") throw new TypeError();
      const state = Object.freeze({
        runtime,
        transactionRunner,
        plan,
        targetVisitor,
        fileStore,
        executionOwner,
        assertCurrent,
      });
      assertCoordinatorCurrent(state);
      coordinatorStates.set(this, state);
      coordinatorOperationTails.set(this, Promise.resolve());
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
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      fail("dependency_invalid");
    }
  }

  /**
   * Freshly revalidates, durably journals, and converges one accepted update.
   *
   * Calls on one coordinator are serialized to make double-clicks deterministic.
   * Caller cancellation and generation revocation are honored through the begin
   * CAS. Once begin returns a durable journal, a private non-aborted recovery
   * signal is used and the operation follows commit-wins to a final or sticky state.
   */
  async apply(
    requestValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult>> {
    const state = requireCoordinatorState(this);
    const previous = coordinatorOperationTails.get(this) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        assertCoordinatorCurrent(state);
        assertNotAborted(signal);
        const ready = await this.revalidate(requestValue, signal);
        assertCoordinatorCurrent(state);
        assertNotAborted(signal);
        await state.runtime.begin(ready.capability, signal);

        // The prepared journal is now the only cancellation boundary that matters.
        return state.transactionRunner.recoverActive(new AbortController().signal);
      });
    coordinatorOperationTails.set(
      this,
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    return operation;
  }

  /** Serializes one explicit sticky-recovery recheck with every Apply operation. */
  async resolveRecovery(
    expectationValue: unknown,
    action: "retry_exact" | "keep_current",
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult>> {
    const state = requireCoordinatorState(this);
    let expectation: Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1>;
    try {
      expectation = snapshotKnowledgeForwardRevisionApplyRecoveryExpectation(expectationValue);
    } catch {
      fail("request_invalid");
    }
    const previous = coordinatorOperationTails.get(this) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        assertCoordinatorCurrent(state);
        assertNotAborted(signal);
        return state.transactionRunner.resolveRecovery(expectation, action, signal);
      });
    coordinatorOperationTails.set(
      this,
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    return operation;
  }

  /**
   * Performs Runtime→Vault/source validation→Vault/source→Runtime reproof.
   *
   * This method performs no mutation. A successful result is process-local and
   * must still be consumed by the owner-bound Runtime begin CAS before any Wiki write.
   */
  async revalidate(
    requestValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<{ kind: "ready"; capability: KnowledgeForwardRevisionApplyCapability }>> {
    const state = requireCoordinatorState(this);
    let stage: "request" | "authority" | "page" | "source" | "validation" = "request";
    try {
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      let request: Readonly<KnowledgeForwardRevisionApplyRequest>;
      try {
        request = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(requestValue);
      } catch {
        fail("request_invalid");
      }
      stage = "authority";
      const beforeValue = await state.runtime.readAuthority(request, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (!beforeValue) fail("authority_unavailable");
      const before = snapshotAuthority(beforeValue, request);
      const accepted = before.acceptedDecision;
      const command = createAcceptedCommand(accepted);
      const commandDigest = createKnowledgeForwardRevisionReviewCommandDigest(command);

      stage = "page";
      const beforeContent = await readCurrentPage(state, request.pagePath, signal);
      const beforeHash = createFileContentHash(beforeContent);
      if (beforeHash !== accepted.acceptanceAuthority.vaultObservedBeforeHash) {
        fail("page_stale");
      }

      stage = "source";
      const pipelineProfile = state.plan.getBundlePipelineProfile(request.bundleId);
      if (!pipelineProfile) fail("source_stale");
      const pipelineProfileSnapshot = canonicalizeJson(pipelineProfile as unknown as JsonValue);
      const planDigestBefore = state.plan.getDigest();
      const freshness = before.sourceBase.currentSourceFreshness;
      const sourceJob = Object.freeze({
        bundleId: request.bundleId,
        sourceId: before.sourceBase.sourceId,
        sourceContentHash: freshness.sourceContentHash,
        pipelineFingerprint: freshness.pipelineFingerprint,
        inputRevision: freshness.inputRevision,
      });
      const preparation = await state.plan.prepare(sourceJob, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      assertPreparationAuthority(preparation, before);
      const preparationSnapshot = canonicalizeJson(preparation as unknown as JsonValue);

      stage = "validation";
      const change = createForwardApplyChange(before, commandDigest);
      const diagnostics: KnowledgeDiagnostic[] = [];
      const structural = validateKnowledgeFileChange(change);
      diagnostics.push(...structural.diagnostics);
      const citations = accepted.validationReceipt.historicalCitations;
      const boundaryValid =
        structural.valid &&
        change.operation === "update" &&
        change.path === request.pagePath &&
        change.beforeHash === beforeHash &&
        change.sourceRefs.length === 1 &&
        change.sourceRefs[0] === before.sourceBase.sourceId &&
        isPathWithinRoot(change.path, preparation.bundle.wikiRoot) &&
        toWindowsPathKey(change.path) !== toWindowsPathKey(preparation.bundle.wikiRoot) &&
        !preparation.bundle.sourceRoots.some((root) => isPathWithinRoot(change.path, root)) &&
        citations.every((citation) => citation.locator.sourceId === before.sourceBase.sourceId);
      const citationsValid = structural.valid
        ? validateProductionCandidateCitations(preparation.artifacts, citations, diagnostics)
        : false;
      const generated = boundaryValid
        ? validateProductionGeneratedDocuments(
            preparation.bundle.wikiRoot,
            [change],
            citations,
            diagnostics
          )
        : { okfValid: false, linksValid: false };
      if (diagnostics.length > MAX_VALIDATION_DIAGNOSTICS) fail("resource_limit");
      const validated = requireSuccessfulKnowledgeForwardRevisionValidation({
        validation: {
          okfValid: generated.okfValid,
          citationsValid,
          linksValid: generated.linksValid,
        },
        diagnostics,
      });

      stage = "page";
      const confirmedContent = await readCurrentPage(state, request.pagePath, signal);
      if (
        confirmedContent !== beforeContent ||
        createFileContentHash(confirmedContent) !== beforeHash
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
      const planDigestAfter = state.plan.getDigest();
      const pipelineProfileAfter = state.plan.getBundlePipelineProfile(request.bundleId);
      if (
        planDigestAfter !== planDigestBefore ||
        !pipelineProfileAfter ||
        canonicalizeJson(pipelineProfileAfter as unknown as JsonValue) !== pipelineProfileSnapshot
      ) {
        fail("source_stale");
      }

      stage = "authority";
      const afterValue = await state.runtime.readAuthority(request, signal);
      assertCoordinatorCurrent(state);
      assertNotAborted(signal);
      if (!afterValue) fail("authority_changed");
      const after = snapshotAuthority(afterValue, request);
      assertAuthoritySandwich(before, after);
      assertPreparationAuthority(confirmedPreparation, after);

      stage = "validation";
      const applyAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
        {
          runtimeId: after.runtimeId,
          runtimeRevision: after.runtimeRevision,
          runtimeDigest: after.runtimeDigest,
          manifestRevision: after.manifestRevision,
          manifestDigest: after.manifestDigest,
          manifestBaseHash: accepted.acceptanceAuthority.manifestBaseHash,
          vaultObservedBeforeHash: beforeHash,
          currentSourceFreshness: after.sourceBase.currentSourceFreshness,
        },
        accepted.proposal
      );
      const validationReadSet =
        createKnowledgeForwardRevisionValidationReadSet(confirmedPreparation);
      const bindingDigest = createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        applyAuthority,
        validationReadSet
      );
      const validatedAt = Math.max(
        accepted.acceptedAt,
        accepted.proposal.recordedAt,
        accepted.proposal.request.historicalReviewAuthority.acceptedAt,
        applyAuthority.currentSourceFreshness.completedAt,
        after.lineageAppliedAtFloor
      );
      const freshValidationReceipt = createKnowledgeForwardRevisionValidationReceipt({
        proposal: accepted.proposal,
        proposalDigest: accepted.proposalDigest,
        command,
        afterContent: accepted.afterContent,
        validation: validated.validation,
        validationProfile: createKnowledgeForwardRevisionValidationProfile(
          confirmedPreparation,
          pipelineProfileAfter as unknown as JsonValue,
          planDigestAfter
        ),
        acceptanceAuthority: applyAuthority,
        historicalCitations: citations,
        validationReadSet,
        sourceArtifactObservationBindingDigest: bindingDigest,
        warningSummary: validated.warningSummary,
        validatedAt,
      });
      const revalidationReceipt = createKnowledgeForwardRevisionApplyRevalidationReceipt({
        acceptedDecision: accepted,
        freshValidationReceipt,
        applyAuthority,
        sourceBase: after.sourceBase,
        vaultObservedBeforeHash: beforeHash,
        vaultObservedAfterHash: createFileContentHash(confirmedContent),
        revalidatedAt: validatedAt,
      });
      const projection = Object.freeze({
        version: 1 as const,
        kind: "forward_revision_apply_capability_projection" as const,
        request,
        acceptedDecision: accepted,
        acceptedDecisionDigest: accepted.acceptedDecisionDigest,
        beforeAuthority: before,
        afterAuthority: after,
        applyAuthority,
        sourceBase: after.sourceBase,
        sourceBaseDigest: after.sourceBaseDigest,
        beforeContent,
        beforeHash,
        afterContent: accepted.afterContent,
        afterHash: accepted.acceptedAfterHash,
        reviewCommand: command,
        reviewCommandDigest: commandDigest,
        freshValidationReceipt,
        freshValidationReceiptDigest: freshValidationReceipt.receiptDigest,
        revalidationReceipt,
        revalidationReceiptDigest:
          createKnowledgeForwardRevisionApplyRevalidationReceiptDigest(revalidationReceipt),
      });
      assertCoordinatorCurrent(state);
      const capability = mintApplyCapability?.(
        Object.freeze({
          projection,
          executionOwner: state.executionOwner,
          assertCurrent: () => assertCoordinatorCurrent(state),
        })
      );
      if (!capability) fail("dependency_invalid");
      KnowledgeForwardRevisionApplyCapability.assertExecutionOwner(
        capability,
        state.executionOwner
      );
      return Object.freeze({ kind: "ready" as const, capability });
    } catch (error) {
      if (KnowledgeForwardRevisionApplyCoordinatorError.inspect(error)) throw error;
      if (signal.aborted) fail("aborted");
      const resolverCode = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
      if (resolverCode === "resource_limit") fail("resource_limit");
      if (resolverCode === "aborted") fail("aborted");
      if (stage === "request") fail("request_invalid");
      if (stage === "authority") fail("authority_unavailable");
      if (stage === "page") fail("page_stale");
      if (stage === "source") fail("source_stale");
      fail("validation_failed");
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionApplyCoordinator.prototype);
Object.freeze(KnowledgeProductionForwardRevisionApplyCoordinator);
