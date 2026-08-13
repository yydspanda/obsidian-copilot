import {
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeValidationResult } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Current strict terminal forward-Review decision version. */
export const KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION = 1 as const;

/** Current strict dedicated forward-Apply claim version. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION = 1 as const;

/** Defensive limits for terminal forward-Review material. */
export const KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxAfterContentCharacters:
    KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters,
  maxAfterContentBytes: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes,
});

/** Supported exact Runtime no-changes completion reasons. */
export type KnowledgeForwardRevisionNoChangesReason =
  | "analysis_no_targets"
  | "resolved_no_targets"
  | "all_targets_unchanged";

/** Fields shared by exact current source-freshness completion projections. */
export interface KnowledgeForwardRevisionSourceFreshnessBase {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly committedManifestRevision: number;
  readonly completedAt: number;
}

/** Exact latest applied-source completion identity captured at acceptance. */
export interface KnowledgeForwardRevisionAppliedFreshness
  extends KnowledgeForwardRevisionSourceFreshnessBase {
  readonly kind: "applied";
  readonly transactionId: string;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly manifestIntentDigest: string;
  readonly committedManifestDigest: string;
}

/** Exact latest no-changes source completion identity captured at acceptance. */
export interface KnowledgeForwardRevisionNoChangesFreshness
  extends KnowledgeForwardRevisionSourceFreshnessBase {
  readonly kind: "no_changes";
  readonly noChangesId: string;
  readonly reason: KnowledgeForwardRevisionNoChangesReason;
  readonly planDigest: string;
  readonly jobId: string;
  readonly attempt: number;
}

/** Exact latest source completion selected from one coherent Runtime snapshot. */
export type KnowledgeForwardRevisionSourceFreshness =
  | KnowledgeForwardRevisionAppliedFreshness
  | KnowledgeForwardRevisionNoChangesFreshness;

/** Current base and completion tuple that a Runtime CAS must freshly re-prove. */
export interface KnowledgeForwardRevisionAcceptanceAuthority {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly manifestBaseHash: string;
  readonly vaultObservedBeforeHash: string;
  readonly currentSourceFreshness: Readonly<KnowledgeForwardRevisionSourceFreshness>;
}

/** Immutable evidence inherited from the selected proposal and original source. */
export interface KnowledgeForwardRevisionSourceEvidence {
  readonly version: 1;
  readonly kind: "forward_revision_proposal_source_evidence";
  readonly evidenceScope: "selected_historical_output_and_original_source";
  readonly manualOverrideEvidence: "not_asserted";
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly historicalTransactionId: string;
  readonly historicalChangeSetId: string;
  readonly historicalAcceptedDigest: string;
  readonly historicalManifestIntentDigest: string;
  readonly selectedHistoricalHash: string;
  readonly sourceRefs: readonly [string];
}

/** Dedicated NON-authoritative claim minted only as part of acceptance. */
export interface KnowledgeForwardRevisionApplyClaimV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION;
  readonly kind: "forward_revision_apply_claim";
  readonly claimId: string;
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly selectedHistoricalHash: string;
  readonly acceptedAfterHash: string;
  readonly manualOverride: boolean;
  readonly acceptedDecisionDigest: string;
  readonly acceptedAt: number;
}

/** Terminal accepted forward-Review record with exact body and dedicated claim. */
export interface KnowledgeForwardRevisionAcceptedDecisionRecordV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION;
  readonly kind: "forward_revision_decision_record";
  readonly state: "accepted";
  readonly recordRevision: 1;
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly selectedHistoricalHash: string;
  readonly afterContent: string;
  readonly acceptedAfterHash: string;
  readonly manualOverride: boolean;
  readonly sourceEvidence: Readonly<KnowledgeForwardRevisionSourceEvidence>;
  readonly acceptanceAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  readonly acceptedAt: number;
  readonly acceptedDecisionDigest: string;
  readonly applyClaim: Readonly<KnowledgeForwardRevisionApplyClaimV1>;
  readonly applyClaimDigest: string;
}

/** Terminal rejected forward-Review record; rejection never carries an Apply claim. */
export interface KnowledgeForwardRevisionRejectedDecisionRecordV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION;
  readonly kind: "forward_revision_decision_record";
  readonly state: "rejected";
  readonly recordRevision: 1;
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly rejectionReason: "user_rejected";
  readonly rejectedAt: number;
  readonly rejectedDecisionDigest: string;
}

/** Strict terminal state of one independently published forward proposal. */
export type KnowledgeForwardRevisionTerminalDecisionRecordV1 =
  | KnowledgeForwardRevisionAcceptedDecisionRecordV1
  | KnowledgeForwardRevisionRejectedDecisionRecordV1;

/** Creator input whose only user-editable proposal material is `afterContent`. */
export interface CreateKnowledgeForwardRevisionAcceptedDecisionInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly afterContent: string;
  readonly acceptanceAuthority: unknown;
  readonly acceptedAt: number;
}

/** Creator input for a terminal rejection without any claim. */
export interface CreateKnowledgeForwardRevisionRejectedDecisionInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly rejectedAt: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CLAIM_ID_PATTERN = /^forward-revision-apply-claim-[a-f0-9]{64}$/;
const NO_CHANGES_ID_PATTERN = /^knowledge-no-changes-[a-f0-9]{64}$/;
const ACCEPT_CREATE_KEYS = [
  "proposal",
  "proposalDigest",
  "afterContent",
  "acceptanceAuthority",
  "acceptedAt",
] as const;
const REJECT_CREATE_KEYS = ["proposal", "proposalDigest", "rejectedAt"] as const;
const ACCEPTED_KEYS = [
  "version",
  "kind",
  "state",
  "recordRevision",
  "proposal",
  "proposalDigest",
  "selectedHistoricalHash",
  "afterContent",
  "acceptedAfterHash",
  "manualOverride",
  "sourceEvidence",
  "acceptanceAuthority",
  "acceptedAt",
  "acceptedDecisionDigest",
  "applyClaim",
  "applyClaimDigest",
] as const;
const REJECTED_KEYS = [
  "version",
  "kind",
  "state",
  "recordRevision",
  "proposal",
  "proposalDigest",
  "rejectionReason",
  "rejectedAt",
  "rejectedDecisionDigest",
] as const;
const AUTHORITY_KEYS = [
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "manifestRevision",
  "manifestDigest",
  "manifestBaseHash",
  "vaultObservedBeforeHash",
  "currentSourceFreshness",
] as const;
const FRESHNESS_COMMON_KEYS = [
  "kind",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "bundleId",
  "sourceId",
  "sourceContentHash",
  "pipelineFingerprint",
  "inputRevision",
  "manifestRevision",
  "manifestDigest",
  "committedManifestRevision",
  "completedAt",
] as const;
const APPLIED_FRESHNESS_KEYS = [
  ...FRESHNESS_COMMON_KEYS,
  "transactionId",
  "changeSetId",
  "changeSetDigest",
  "manifestIntentDigest",
  "committedManifestDigest",
] as const;
const NO_CHANGES_FRESHNESS_KEYS = [
  ...FRESHNESS_COMMON_KEYS,
  "noChangesId",
  "reason",
  "planDigest",
  "jobId",
  "attempt",
] as const;
const EVIDENCE_KEYS = [
  "version",
  "kind",
  "evidenceScope",
  "manualOverrideEvidence",
  "proposalId",
  "proposalDigest",
  "requestId",
  "requestDigest",
  "intentId",
  "intentDigest",
  "historicalTransactionId",
  "historicalChangeSetId",
  "historicalAcceptedDigest",
  "historicalManifestIntentDigest",
  "selectedHistoricalHash",
  "sourceRefs",
] as const;
const CLAIM_KEYS = [
  "version",
  "kind",
  "claimId",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "requestId",
  "requestDigest",
  "intentId",
  "intentDigest",
  "selectedHistoricalHash",
  "acceptedAfterHash",
  "manualOverride",
  "acceptedDecisionDigest",
  "acceptedAt",
] as const;
const NO_CHANGES_REASONS: readonly KnowledgeForwardRevisionNoChangesReason[] = Object.freeze([
  "analysis_no_targets",
  "resolved_no_targets",
  "all_targets_unchanged",
]);

/** Fixed value-free failure for malformed terminal forward-Review material. */
export class KnowledgeForwardRevisionDecisionValidationError extends TypeError {
  /** Creates a sanitized strict-contract failure. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision decision material does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionDecisionValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionDecisionValidationError");
const authenticValidationErrors = new WeakSet<KnowledgeForwardRevisionDecisionValidationError>();

/** Reads an exact plain record through own enumerable data descriptors only. */
function snapshotRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(captured, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

/** Captures one exact single-string tuple without invoking accessors. */
function snapshotSingleStringTuple(value: unknown): readonly [string] | undefined {
  try {
    if (!Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    const item = Object.getOwnPropertyDescriptor(value, "0");
    if (
      !length ||
      !("value" in length) ||
      length.value !== 1 ||
      !item ||
      !item.enumerable ||
      !("value" in item) ||
      !isIdentifier(item.value)
    ) {
      return undefined;
    }
    return Object.freeze([item.value] as [string]);
  } catch {
    return undefined;
  }
}

/** Reports whether text consists only of paired Unicode scalar values. */
function isUnicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Reports whether identifier text contains an unsupported C0 or C1 control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Validates exact Review body text without Unicode normalization. */
function isValidAfterContentText(value: string): boolean {
  if (!isUnicodeScalarText(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return false;
    }
  }
  return true;
}

/** Reports whether one value is a bounded canonical identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether one value is a lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether one value is a non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Reports whether one value is a positive safe integer. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Hashes one strict value with explicit domain separation. */
function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/** Throws one authentic frozen sanitized failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionDecisionValidationError(VALIDATION_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught failure was minted inside this module. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionDecisionValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionDecisionValidationError)
  );
}

/** Reads a union discriminant without invoking a hostile accessor. */
function readDataDiscriminant(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Strictly captures a projected latest source-freshness completion. */
function snapshotSourceFreshness(
  value: unknown
): Readonly<KnowledgeForwardRevisionSourceFreshness> {
  const kind = readDataDiscriminant(value, "kind");
  const expectedKeys =
    kind === "applied"
      ? APPLIED_FRESHNESS_KEYS
      : kind === "no_changes"
        ? NO_CHANGES_FRESHNESS_KEYS
        : undefined;
  const record = expectedKeys ? snapshotRecord(value, expectedKeys) : undefined;
  if (
    !record ||
    !isIdentifier(record.runtimeId) ||
    !isPositiveInteger(record.runtimeRevision) ||
    !isDigest(record.runtimeDigest) ||
    !isIdentifier(record.bundleId) ||
    !isIdentifier(record.sourceId) ||
    !isDigest(record.sourceContentHash) ||
    !isDigest(record.pipelineFingerprint) ||
    !isPositiveInteger(record.inputRevision) ||
    !isNonNegativeInteger(record.manifestRevision) ||
    !isDigest(record.manifestDigest) ||
    !isNonNegativeInteger(record.committedManifestRevision) ||
    Number(record.committedManifestRevision) > Number(record.manifestRevision) ||
    !isNonNegativeInteger(record.completedAt)
  ) {
    invalid();
  }
  const common = Object.freeze({
    runtimeId: record.runtimeId,
    runtimeRevision: Number(record.runtimeRevision),
    runtimeDigest: record.runtimeDigest,
    bundleId: record.bundleId,
    sourceId: record.sourceId,
    sourceContentHash: record.sourceContentHash,
    pipelineFingerprint: record.pipelineFingerprint,
    inputRevision: Number(record.inputRevision),
    manifestRevision: Number(record.manifestRevision),
    manifestDigest: record.manifestDigest,
    committedManifestRevision: Number(record.committedManifestRevision),
    completedAt: Number(record.completedAt),
  });
  if (kind === "applied") {
    if (
      !isIdentifier(record.transactionId) ||
      !isIdentifier(record.changeSetId) ||
      !isDigest(record.changeSetDigest) ||
      !isDigest(record.manifestIntentDigest) ||
      !isDigest(record.committedManifestDigest)
    ) {
      invalid();
    }
    return Object.freeze({
      ...common,
      kind: "applied" as const,
      transactionId: record.transactionId,
      changeSetId: record.changeSetId,
      changeSetDigest: record.changeSetDigest,
      manifestIntentDigest: record.manifestIntentDigest,
      committedManifestDigest: record.committedManifestDigest,
    });
  }
  if (
    !isIdentifier(record.noChangesId) ||
    !NO_CHANGES_ID_PATTERN.test(record.noChangesId) ||
    !NO_CHANGES_REASONS.includes(record.reason as KnowledgeForwardRevisionNoChangesReason) ||
    !isDigest(record.planDigest) ||
    !isIdentifier(record.jobId) ||
    !isPositiveInteger(record.attempt)
  ) {
    invalid();
  }
  return Object.freeze({
    ...common,
    kind: "no_changes" as const,
    noChangesId: record.noChangesId,
    reason: record.reason as KnowledgeForwardRevisionNoChangesReason,
    planDigest: record.planDigest,
    jobId: record.jobId,
    attempt: Number(record.attempt),
  });
}

/** Strictly captures one exact internally coherent acceptance-authority value. */
export function snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(
  value: unknown
): Readonly<KnowledgeForwardRevisionAcceptanceAuthority> {
  const record = snapshotRecord(value, AUTHORITY_KEYS);
  if (
    !record ||
    !isIdentifier(record.runtimeId) ||
    !isPositiveInteger(record.runtimeRevision) ||
    !isDigest(record.runtimeDigest) ||
    !isNonNegativeInteger(record.manifestRevision) ||
    !isDigest(record.manifestDigest) ||
    !isDigest(record.manifestBaseHash) ||
    !isDigest(record.vaultObservedBeforeHash)
  ) {
    invalid();
  }
  const freshness = snapshotSourceFreshness(record.currentSourceFreshness);
  if (
    Number(record.runtimeRevision) !== freshness.runtimeRevision ||
    record.runtimeDigest !== freshness.runtimeDigest ||
    Number(record.manifestRevision) !== freshness.manifestRevision ||
    record.manifestDigest !== freshness.manifestDigest ||
    record.manifestBaseHash !== record.vaultObservedBeforeHash ||
    record.runtimeId !== freshness.runtimeId
  ) {
    invalid();
  }
  return Object.freeze({
    runtimeId: record.runtimeId,
    runtimeRevision: Number(record.runtimeRevision),
    runtimeDigest: record.runtimeDigest,
    manifestRevision: Number(record.manifestRevision),
    manifestDigest: record.manifestDigest,
    manifestBaseHash: record.manifestBaseHash,
    vaultObservedBeforeHash: record.vaultObservedBeforeHash,
    currentSourceFreshness: freshness,
  });
}

/**
 * Captures one coherent current Runtime tuple and correlates it to a proposal.
 *
 * The Runtime revision and digest identify the current decision-time envelope;
 * the Manifest, source, and completion tuple must remain exactly the proposal's
 * proposal-time current state. The Vault-observed hash remains externally
 * observed and is not made self-authentic by this structural snapshot.
 */
export function snapshotKnowledgeForwardRevisionAcceptanceAuthority(
  value: unknown,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>
): Readonly<KnowledgeForwardRevisionAcceptanceAuthority> {
  const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(value);
  const request = proposal.request;
  const current = request.intent.current;
  const freshness = authority.currentSourceFreshness;
  if (
    authority.runtimeId !== request.runtimeId ||
    authority.manifestBaseHash !== current.manifestBaseHash ||
    authority.vaultObservedBeforeHash !== current.vaultObservedBeforeHash ||
    authority.manifestRevision !== current.manifestRevision ||
    authority.manifestDigest !== current.manifestDigest ||
    freshness.runtimeId !== request.runtimeId ||
    freshness.bundleId !== request.bundleId ||
    freshness.sourceId !== current.primarySourceId ||
    freshness.sourceContentHash !== current.sourceContentHash ||
    freshness.pipelineFingerprint !== current.pipelineFingerprint ||
    freshness.inputRevision !== current.inputRevision
  ) {
    invalid();
  }
  return authority;
}

/** Derives immutable proposal/original-source evidence with fixed scope semantics. */
function deriveSourceEvidence(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string
): Readonly<KnowledgeForwardRevisionSourceEvidence> {
  const request = proposal.request;
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_proposal_source_evidence" as const,
    evidenceScope: "selected_historical_output_and_original_source" as const,
    manualOverrideEvidence: "not_asserted" as const,
    proposalId: proposal.proposalId,
    proposalDigest,
    requestId: request.requestId,
    requestDigest: proposal.requestDigest,
    intentId: request.intent.intentId,
    intentDigest: request.intentDigest,
    historicalTransactionId: request.intent.historical.transactionId,
    historicalChangeSetId: request.intent.historical.changeSetId,
    historicalAcceptedDigest: request.historicalReviewAuthority.acceptedDigest,
    historicalManifestIntentDigest: request.historicalReviewAuthority.manifestCommitIntentDigest,
    selectedHistoricalHash: request.selectedContentHash,
    sourceRefs: Object.freeze([request.historicalReviewAuthority.targetChange.sourceRefs[0]] as [
      string,
    ]),
  });
}

/** Strictly verifies fixed-scope evidence against its proposal. */
function snapshotSourceEvidence(
  value: unknown,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string
): Readonly<KnowledgeForwardRevisionSourceEvidence> {
  const record = snapshotRecord(value, EVIDENCE_KEYS);
  const sourceRefs = snapshotSingleStringTuple(record?.sourceRefs);
  if (
    !record ||
    !sourceRefs ||
    record.version !== 1 ||
    record.kind !== "forward_revision_proposal_source_evidence" ||
    record.evidenceScope !== "selected_historical_output_and_original_source" ||
    record.manualOverrideEvidence !== "not_asserted"
  ) {
    invalid();
  }
  const expected = deriveSourceEvidence(proposal, proposalDigest);
  const captured = Object.freeze({ ...record, sourceRefs });
  if (
    canonicalizeJson(captured as unknown as JsonValue) !==
    canonicalizeJson(expected as unknown as JsonValue)
  ) {
    invalid();
  }
  return expected;
}

/** Creates the digest-bound terminal accepted payload before a claim exists. */
function acceptedDecisionPayload(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string,
  afterContent: string,
  authority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>,
  acceptedAt: number
) {
  const selectedHistoricalHash = proposal.request.selectedContentHash;
  const acceptedAfterHash = createFileContentHash(afterContent);
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION,
    kind: "forward_revision_decision_record" as const,
    state: "accepted" as const,
    recordRevision: 1 as const,
    proposal,
    proposalDigest,
    selectedHistoricalHash,
    afterContent,
    acceptedAfterHash,
    manualOverride: acceptedAfterHash !== selectedHistoricalHash,
    sourceEvidence: deriveSourceEvidence(proposal, proposalDigest),
    acceptanceAuthority: authority,
    acceptedAt,
  });
}

/** Computes the canonical digest of an accepted terminal payload excluding its claim. */
function digestAcceptedDecisionPayload(value: ReturnType<typeof acceptedDecisionPayload>): string {
  return digestValue("knowledge-forward-revision-accepted-decision-v1", value);
}

/** Derives the complete dedicated claim payload except its opaque id. */
function applyClaimPayload(
  accepted: ReturnType<typeof acceptedDecisionPayload>,
  acceptedDecisionDigest: string
): Omit<KnowledgeForwardRevisionApplyClaimV1, "claimId"> {
  const request = accepted.proposal.request;
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION,
    kind: "forward_revision_apply_claim" as const,
    runtimeId: accepted.acceptanceAuthority.runtimeId,
    runtimeRevision: accepted.acceptanceAuthority.runtimeRevision,
    runtimeDigest: accepted.acceptanceAuthority.runtimeDigest,
    bundleId: request.bundleId,
    pagePath: request.pagePath,
    proposalId: accepted.proposal.proposalId,
    proposalDigest: accepted.proposalDigest,
    requestId: request.requestId,
    requestDigest: accepted.proposal.requestDigest,
    intentId: request.intent.intentId,
    intentDigest: request.intentDigest,
    selectedHistoricalHash: accepted.selectedHistoricalHash,
    acceptedAfterHash: accepted.acceptedAfterHash,
    manualOverride: accepted.manualOverride,
    acceptedDecisionDigest,
    acceptedAt: accepted.acceptedAt,
  });
}

/** Derives a dedicated claim id from its accepted-decision-bound payload. */
function deriveApplyClaimId(
  payload: Omit<KnowledgeForwardRevisionApplyClaimV1, "claimId">
): string {
  return `forward-revision-apply-claim-${digestValue(
    "knowledge-forward-revision-apply-claim-id-v1",
    payload
  )}`;
}

/** Mints a claim only from a complete accepted terminal payload. */
function createApplyClaim(
  accepted: ReturnType<typeof acceptedDecisionPayload>,
  acceptedDecisionDigest: string
): Readonly<KnowledgeForwardRevisionApplyClaimV1> {
  const payload = applyClaimPayload(accepted, acceptedDecisionDigest);
  return Object.freeze({ ...payload, claimId: deriveApplyClaimId(payload) });
}

/** Hashes one already-correlated dedicated claim. */
function digestApplyClaim(value: Readonly<KnowledgeForwardRevisionApplyClaimV1>): string {
  return digestValue("knowledge-forward-revision-apply-claim-v1", value);
}

/** Strictly verifies one dedicated claim against its complete accepted payload. */
function snapshotApplyClaimAgainstAccepted(
  value: unknown,
  accepted: ReturnType<typeof acceptedDecisionPayload>,
  acceptedDecisionDigest: string
): Readonly<KnowledgeForwardRevisionApplyClaimV1> {
  const record = snapshotRecord(value, CLAIM_KEYS);
  if (
    !record ||
    record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION ||
    record.kind !== "forward_revision_apply_claim" ||
    !isIdentifier(record.claimId) ||
    !CLAIM_ID_PATTERN.test(record.claimId)
  ) {
    invalid();
  }
  const expected = createApplyClaim(accepted, acceptedDecisionDigest);
  if (canonicalizeJson(record as unknown as JsonValue) !== canonicalizeJson(expected)) {
    invalid();
  }
  return expected;
}

/** Creates a terminal accepted record and atomically mints its dedicated claim. */
export function createKnowledgeForwardRevisionAcceptedDecisionRecord(
  value: CreateKnowledgeForwardRevisionAcceptedDecisionInput
): Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1> {
  try {
    const record = snapshotRecord(value, ACCEPT_CREATE_KEYS);
    if (
      !record ||
      !isDigest(record.proposalDigest) ||
      typeof record.afterContent !== "string" ||
      record.afterContent.length >
        KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxAfterContentCharacters ||
      !isUnicodeScalarText(record.afterContent) ||
      new TextEncoder().encode(record.afterContent).byteLength >
        KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxAfterContentBytes ||
      !isNonNegativeInteger(record.acceptedAt)
    ) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalid();
    }
    if (
      record.afterContent !== proposal.request.selectedContent &&
      !isValidAfterContentText(record.afterContent)
    ) {
      invalid();
    }
    const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      record.acceptanceAuthority,
      proposal
    );
    const acceptedAt = Number(record.acceptedAt);
    if (
      acceptedAt < proposal.recordedAt ||
      acceptedAt < authority.currentSourceFreshness.completedAt
    ) {
      invalid();
    }
    const payload = acceptedDecisionPayload(
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority,
      acceptedAt
    );
    const acceptedDecisionDigest = digestAcceptedDecisionPayload(payload);
    const applyClaim = createApplyClaim(payload, acceptedDecisionDigest);
    return snapshotKnowledgeForwardRevisionAcceptedDecisionRecord({
      ...payload,
      acceptedDecisionDigest,
      applyClaim,
      applyClaimDigest: digestApplyClaim(applyClaim),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one terminal accepted forward-Review record. */
export function snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1> {
  try {
    const record = snapshotRecord(value, ACCEPTED_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION ||
      record.kind !== "forward_revision_decision_record" ||
      record.state !== "accepted" ||
      record.recordRevision !== 1 ||
      !isDigest(record.proposalDigest) ||
      !isDigest(record.selectedHistoricalHash) ||
      typeof record.afterContent !== "string" ||
      record.afterContent.length >
        KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxAfterContentCharacters ||
      !isUnicodeScalarText(record.afterContent) ||
      new TextEncoder().encode(record.afterContent).byteLength >
        KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxAfterContentBytes ||
      !isDigest(record.acceptedAfterHash) ||
      typeof record.manualOverride !== "boolean" ||
      !isNonNegativeInteger(record.acceptedAt) ||
      !isDigest(record.acceptedDecisionDigest) ||
      !isDigest(record.applyClaimDigest)
    ) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalid();
    }
    if (
      record.afterContent !== proposal.request.selectedContent &&
      !isValidAfterContentText(record.afterContent)
    ) {
      invalid();
    }
    const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      record.acceptanceAuthority,
      proposal
    );
    const acceptedAt = Number(record.acceptedAt);
    if (
      acceptedAt < proposal.recordedAt ||
      acceptedAt < authority.currentSourceFreshness.completedAt
    ) {
      invalid();
    }
    const payload = acceptedDecisionPayload(
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority,
      acceptedAt
    );
    if (
      record.selectedHistoricalHash !== payload.selectedHistoricalHash ||
      record.acceptedAfterHash !== payload.acceptedAfterHash ||
      record.manualOverride !== payload.manualOverride ||
      record.acceptedDecisionDigest !== digestAcceptedDecisionPayload(payload) ||
      payload.acceptedAfterHash === authority.manifestBaseHash
    ) {
      invalid();
    }
    snapshotSourceEvidence(record.sourceEvidence, proposal, record.proposalDigest);
    const applyClaim = snapshotApplyClaimAgainstAccepted(
      record.applyClaim,
      payload,
      record.acceptedDecisionDigest
    );
    if (record.applyClaimDigest !== digestApplyClaim(applyClaim)) {
      invalid();
    }
    return Object.freeze({
      ...payload,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaim,
      applyClaimDigest: record.applyClaimDigest,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots a dedicated claim as part of its accepted record. */
export function snapshotKnowledgeForwardRevisionApplyClaim(
  value: unknown,
  acceptedRecord: unknown
): Readonly<KnowledgeForwardRevisionApplyClaimV1> {
  const accepted = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(acceptedRecord);
  const record = snapshotRecord(value, CLAIM_KEYS);
  if (
    !record ||
    canonicalizeJson(record as unknown as JsonValue) !== canonicalizeJson(accepted.applyClaim)
  ) {
    invalid();
  }
  return accepted.applyClaim;
}

/**
 * Computes a self-consistency digest for one structurally canonical claim.
 *
 * This does not establish claim authenticity or write authority. Every Apply
 * boundary must snapshot the claim together with its exact accepted terminal
 * record and freshly re-prove the Runtime/Vault/Manifest transaction prestate.
 */
export function createKnowledgeForwardRevisionApplyClaimDigest(value: unknown): string {
  const record = snapshotRecord(value, CLAIM_KEYS);
  if (!record) invalid();
  const claim = Object.freeze(record) as unknown as Readonly<KnowledgeForwardRevisionApplyClaimV1>;
  if (
    claim.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION ||
    claim.kind !== "forward_revision_apply_claim" ||
    !isIdentifier(claim.claimId) ||
    !CLAIM_ID_PATTERN.test(claim.claimId) ||
    !isIdentifier(claim.runtimeId) ||
    !isPositiveInteger(claim.runtimeRevision) ||
    !isDigest(claim.runtimeDigest) ||
    !isIdentifier(claim.bundleId) ||
    !isIdentifier(claim.pagePath) ||
    !isIdentifier(claim.proposalId) ||
    !isDigest(claim.proposalDigest) ||
    !isIdentifier(claim.requestId) ||
    !isDigest(claim.requestDigest) ||
    !isIdentifier(claim.intentId) ||
    !isDigest(claim.intentDigest) ||
    !isDigest(claim.selectedHistoricalHash) ||
    !isDigest(claim.acceptedAfterHash) ||
    typeof claim.manualOverride !== "boolean" ||
    !isDigest(claim.acceptedDecisionDigest) ||
    !isNonNegativeInteger(claim.acceptedAt)
  ) {
    invalid();
  }
  const payload = Object.freeze({
    version: claim.version,
    kind: claim.kind,
    runtimeId: claim.runtimeId,
    runtimeRevision: claim.runtimeRevision,
    runtimeDigest: claim.runtimeDigest,
    bundleId: claim.bundleId,
    pagePath: claim.pagePath,
    proposalId: claim.proposalId,
    proposalDigest: claim.proposalDigest,
    requestId: claim.requestId,
    requestDigest: claim.requestDigest,
    intentId: claim.intentId,
    intentDigest: claim.intentDigest,
    selectedHistoricalHash: claim.selectedHistoricalHash,
    acceptedAfterHash: claim.acceptedAfterHash,
    manualOverride: claim.manualOverride,
    acceptedDecisionDigest: claim.acceptedDecisionDigest,
    acceptedAt: claim.acceptedAt,
  });
  if (claim.claimId !== deriveApplyClaimId(payload)) invalid();
  return digestApplyClaim(Object.freeze({ ...payload, claimId: claim.claimId }));
}

/** Creates a terminal rejected record without minting an Apply claim. */
export function createKnowledgeForwardRevisionRejectedDecisionRecord(
  value: CreateKnowledgeForwardRevisionRejectedDecisionInput
): Readonly<KnowledgeForwardRevisionRejectedDecisionRecordV1> {
  try {
    const record = snapshotRecord(value, REJECT_CREATE_KEYS);
    if (!record || !isDigest(record.proposalDigest) || !isNonNegativeInteger(record.rejectedAt)) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !==
        createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      Number(record.rejectedAt) < proposal.recordedAt
    ) {
      invalid();
    }
    const payload = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION,
      kind: "forward_revision_decision_record" as const,
      state: "rejected" as const,
      recordRevision: 1 as const,
      proposal,
      proposalDigest: record.proposalDigest,
      rejectionReason: "user_rejected" as const,
      rejectedAt: Number(record.rejectedAt),
    });
    return snapshotKnowledgeForwardRevisionRejectedDecisionRecord({
      ...payload,
      rejectedDecisionDigest: digestValue(
        "knowledge-forward-revision-rejected-decision-v1",
        payload
      ),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one terminal rejected forward-Review record. */
export function snapshotKnowledgeForwardRevisionRejectedDecisionRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionRejectedDecisionRecordV1> {
  try {
    const record = snapshotRecord(value, REJECTED_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION ||
      record.kind !== "forward_revision_decision_record" ||
      record.state !== "rejected" ||
      record.recordRevision !== 1 ||
      !isDigest(record.proposalDigest) ||
      record.rejectionReason !== "user_rejected" ||
      !isNonNegativeInteger(record.rejectedAt) ||
      !isDigest(record.rejectedDecisionDigest)
    ) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !==
        createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      Number(record.rejectedAt) < proposal.recordedAt
    ) {
      invalid();
    }
    const payload = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION,
      kind: "forward_revision_decision_record" as const,
      state: "rejected" as const,
      recordRevision: 1 as const,
      proposal,
      proposalDigest: record.proposalDigest,
      rejectionReason: "user_rejected" as const,
      rejectedAt: Number(record.rejectedAt),
    });
    if (
      record.rejectedDecisionDigest !==
      digestValue("knowledge-forward-revision-rejected-decision-v1", payload)
    ) {
      invalid();
    }
    return Object.freeze({ ...payload, rejectedDecisionDigest: record.rejectedDecisionDigest });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly dispatches one terminal accepted or rejected forward-Review record. */
export function snapshotKnowledgeForwardRevisionTerminalDecisionRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionTerminalDecisionRecordV1> {
  return readDataDiscriminant(value, "state") === "accepted"
    ? snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(value)
    : snapshotKnowledgeForwardRevisionRejectedDecisionRecord(value);
}

/** Computes one canonical digest over a complete strict terminal decision record. */
export function createKnowledgeForwardRevisionTerminalDecisionRecordDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-terminal-decision-record-v1",
    snapshotKnowledgeForwardRevisionTerminalDecisionRecord(value)
  );
}

/** Validates terminal decision material without retaining rejected values. */
export function validateKnowledgeForwardRevisionTerminalDecisionRecord(
  value: unknown
): KnowledgeValidationResult {
  try {
    snapshotKnowledgeForwardRevisionTerminalDecisionRecord(value);
    return { valid: true, diagnostics: [] };
  } catch {
    return {
      valid: false,
      diagnostics: [
        {
          code: "forward_revision_decision_invalid",
          severity: "error",
          field: "forwardRevisionDecision",
          message: "Forward revision decision does not satisfy its strict contract",
        },
      ],
    };
  }
}

Object.freeze(KnowledgeForwardRevisionDecisionValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionDecisionValidationError);
