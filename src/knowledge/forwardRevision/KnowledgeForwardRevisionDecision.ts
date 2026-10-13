import {
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import {
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  snapshotKnowledgeForwardRevisionValidationReceiptForCandidate,
  snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate,
  type KnowledgeForwardRevisionValidationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeValidationResult } from "@/knowledge/model/types";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export {
  createKnowledgeForwardRevisionAcceptanceAuthorityDigest,
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
export type {
  KnowledgeForwardRevisionAcceptanceAuthority,
  KnowledgeForwardRevisionAppliedFreshness,
  KnowledgeForwardRevisionNoChangesFreshness,
  KnowledgeForwardRevisionNoChangesReason,
  KnowledgeForwardRevisionSourceFreshness,
  KnowledgeForwardRevisionSourceFreshnessBase,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";

export const KNOWLEDGE_FORWARD_REVISION_DECISION_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_APPLY_CLAIM_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxPagePathCharacters,
  maxAfterContentCharacters:
    KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters,
  maxAfterContentBytes: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes,
});

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
  readonly validationReceiptId: string;
  readonly validationReceiptDigest: string;
  readonly acceptedDecisionDigest: string;
  readonly acceptedAt: number;
}

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
  readonly validationReceipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>;
  readonly validationReceiptDigest: string;
  readonly acceptedAt: number;
  readonly acceptedDecisionDigest: string;
  readonly applyClaim: Readonly<KnowledgeForwardRevisionApplyClaimV1>;
  readonly applyClaimDigest: string;
}

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

export type KnowledgeForwardRevisionTerminalDecisionRecordV1 =
  | KnowledgeForwardRevisionAcceptedDecisionRecordV1
  | KnowledgeForwardRevisionRejectedDecisionRecordV1;

export interface CreateKnowledgeForwardRevisionAcceptedDecisionInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly command: unknown;
  readonly afterContent: string;
  readonly acceptanceAuthority: unknown;
  readonly validationReceipt: unknown;
  readonly validationReceiptDigest: string;
  readonly acceptedAt: number;
}

export interface CreateKnowledgeForwardRevisionRejectedDecisionInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly rejectedAt: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CLAIM_ID_PATTERN = /^forward-revision-apply-claim-[a-f0-9]{64}$/;
const VALIDATION_RECEIPT_ID_PATTERN = /^forward-revision-validation-receipt-[a-f0-9]{64}$/;
const ACCEPT_CREATE_KEYS = [
  "proposal",
  "proposalDigest",
  "command",
  "afterContent",
  "acceptanceAuthority",
  "validationReceipt",
  "validationReceiptDigest",
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
  "validationReceipt",
  "validationReceiptDigest",
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
  "validationReceiptId",
  "validationReceiptDigest",
  "acceptedDecisionDigest",
  "acceptedAt",
] as const;

export class KnowledgeForwardRevisionDecisionValidationError extends TypeError {
  constructor(authenticityToken?: symbol) {
    super("Forward revision decision material does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionDecisionValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionDecisionValidationError");
const authenticValidationErrors = new WeakSet<KnowledgeForwardRevisionDecisionValidationError>();

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

function snapshotSingleStringTuple(value: unknown): readonly [string] | undefined {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== 2
    ) {
      return undefined;
    }
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

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

function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_DECISION_LIMITS.maxPagePathCharacters ||
    !isUnicodeScalarText(value) ||
    hasControlCharacter(value)
  ) {
    return undefined;
  }
  try {
    const parsed = parseVaultPath(value);
    return parsed.ok && parsed.path === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

function invalid(): never {
  const error = new KnowledgeForwardRevisionDecisionValidationError(VALIDATION_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionDecisionValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionDecisionValidationError)
  );
}

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

function acceptedDecisionPayload(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string,
  afterContent: string,
  authority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>,
  validationReceipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>,
  validationReceiptDigest: string,
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
    validationReceipt,
    validationReceiptDigest,
    acceptedAt,
  });
}

function digestAcceptedDecisionPayload(value: ReturnType<typeof acceptedDecisionPayload>): string {
  return digestValue("knowledge-forward-revision-accepted-decision-v1", value);
}

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
    validationReceiptId: accepted.validationReceipt.receiptId,
    validationReceiptDigest: accepted.validationReceiptDigest,
    acceptedDecisionDigest,
    acceptedAt: accepted.acceptedAt,
  });
}

function deriveApplyClaimId(
  payload: Omit<KnowledgeForwardRevisionApplyClaimV1, "claimId">
): string {
  return `forward-revision-apply-claim-${digestValue(
    "knowledge-forward-revision-apply-claim-id-v1",
    payload
  )}`;
}

function createApplyClaim(
  accepted: ReturnType<typeof acceptedDecisionPayload>,
  acceptedDecisionDigest: string
): Readonly<KnowledgeForwardRevisionApplyClaimV1> {
  const payload = applyClaimPayload(accepted, acceptedDecisionDigest);
  return Object.freeze({ ...payload, claimId: deriveApplyClaimId(payload) });
}

function digestApplyClaim(value: Readonly<KnowledgeForwardRevisionApplyClaimV1>): string {
  return digestValue("knowledge-forward-revision-apply-claim-v1", value);
}

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
      !isDigest(record.validationReceiptDigest) ||
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
    const receiptForCommand = snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
      record.validationReceipt,
      proposal,
      record.proposalDigest,
      record.command,
      record.afterContent
    );
    const validationReceipt = snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate(
      receiptForCommand,
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority
    );
    const acceptedAt = Number(record.acceptedAt);
    if (
      record.validationReceiptDigest !== validationReceipt.receiptDigest ||
      acceptedAt < proposal.recordedAt ||
      acceptedAt < authority.currentSourceFreshness.completedAt ||
      acceptedAt < validationReceipt.validatedAt
    ) {
      invalid();
    }
    const payload = acceptedDecisionPayload(
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority,
      validationReceipt,
      record.validationReceiptDigest,
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
      !isDigest(record.validationReceiptDigest) ||
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
    const validationReceipt = snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate(
      record.validationReceipt,
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority
    );
    const acceptedAt = Number(record.acceptedAt);
    if (
      record.validationReceiptDigest !== validationReceipt.receiptDigest ||
      acceptedAt < proposal.recordedAt ||
      acceptedAt < authority.currentSourceFreshness.completedAt ||
      acceptedAt < validationReceipt.validatedAt
    ) {
      invalid();
    }
    const payload = acceptedDecisionPayload(
      proposal,
      record.proposalDigest,
      record.afterContent,
      authority,
      validationReceipt,
      record.validationReceiptDigest,
      acceptedAt
    );
    if (
      record.selectedHistoricalHash !== payload.selectedHistoricalHash ||
      record.acceptedAfterHash !== payload.acceptedAfterHash ||
      record.manualOverride !== payload.manualOverride ||
      record.acceptedDecisionDigest !== digestAcceptedDecisionPayload(payload) ||
      payload.acceptedAfterHash === authority.vaultObservedBeforeHash
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
    !snapshotPagePath(claim.pagePath) ||
    !isIdentifier(claim.proposalId) ||
    !isDigest(claim.proposalDigest) ||
    !isIdentifier(claim.requestId) ||
    !isDigest(claim.requestDigest) ||
    !isIdentifier(claim.intentId) ||
    !isDigest(claim.intentDigest) ||
    !isDigest(claim.selectedHistoricalHash) ||
    !isDigest(claim.acceptedAfterHash) ||
    typeof claim.manualOverride !== "boolean" ||
    !isIdentifier(claim.validationReceiptId) ||
    !VALIDATION_RECEIPT_ID_PATTERN.test(claim.validationReceiptId) ||
    !isDigest(claim.validationReceiptDigest) ||
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
    validationReceiptId: claim.validationReceiptId,
    validationReceiptDigest: claim.validationReceiptDigest,
    acceptedDecisionDigest: claim.acceptedDecisionDigest,
    acceptedAt: claim.acceptedAt,
  });
  if (claim.claimId !== deriveApplyClaimId(payload)) invalid();
  return digestApplyClaim(Object.freeze({ ...payload, claimId: claim.claimId }));
}

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

export function snapshotKnowledgeForwardRevisionTerminalDecisionRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionTerminalDecisionRecordV1> {
  return readDataDiscriminant(value, "state") === "accepted"
    ? snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(value)
    : snapshotKnowledgeForwardRevisionRejectedDecisionRecord(value);
}

export function createKnowledgeForwardRevisionTerminalDecisionRecordDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-terminal-decision-record-v1",
    snapshotKnowledgeForwardRevisionTerminalDecisionRecord(value)
  );
}

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
