import {
  createKnowledgeForwardRevisionIntentDigest,
  snapshotKnowledgeForwardRevisionIntent,
  type KnowledgeForwardRevisionIntent,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_FORWARD_REVISION_REQUEST_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_PROPOSAL_RECORD_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_PUBLICATION_RECEIPT_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxSelectedContentCharacters: 2_000_000,
  maxSelectedContentBytes: 8_000_000,
});

export interface KnowledgeForwardRevisionHistoricalTargetChange {
  readonly changeId: string;
  readonly path: string;
  readonly operation: "create" | "update";
  readonly afterHash: string;
  readonly sourceRefs: readonly [string];
}

export interface KnowledgeForwardRevisionHistoricalManifestPage {
  readonly path: string;
  readonly ownership: "generated";
  readonly contentHash: string;
}

export interface KnowledgeForwardRevisionHistoricalReviewAuthority {
  readonly proposalDigest: string;
  readonly acceptedDigest: string;
  readonly acceptedRecordRevision: 1;
  readonly manifestCommitIntentDigest: string;
  readonly acceptedAt: number;
  readonly targetChange: Readonly<KnowledgeForwardRevisionHistoricalTargetChange>;
  readonly manifestPage: Readonly<KnowledgeForwardRevisionHistoricalManifestPage>;
}

export interface KnowledgeForwardRevisionRequestV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REQUEST_VERSION;
  readonly kind: "forward_revision_request";
  readonly requestId: string;
  readonly requestRevision: number;
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly intent: Readonly<KnowledgeForwardRevisionIntent>;
  readonly intentDigest: string;
  readonly historicalReviewAuthority: Readonly<KnowledgeForwardRevisionHistoricalReviewAuthority>;
  readonly selectedContent: string;
  readonly selectedContentHash: string;
  readonly requestedAt: number;
}

export type CreateKnowledgeForwardRevisionRequestInput = Omit<
  KnowledgeForwardRevisionRequestV1,
  "version" | "kind" | "requestId"
>;

export interface KnowledgeForwardRevisionPendingProposalRecordV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_PROPOSAL_RECORD_VERSION;
  readonly kind: "forward_revision_proposal_record";
  readonly proposalId: string;
  readonly state: "pending_review";
  readonly recordRevision: 0;
  readonly request: Readonly<KnowledgeForwardRevisionRequestV1>;
  readonly requestDigest: string;
  readonly recordedAt: number;
}

export interface CreateKnowledgeForwardRevisionPendingProposalRecordInput {
  readonly request: unknown;
  readonly recordedAt: number;
}

export interface KnowledgeForwardRevisionPublicationReceiptV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_PUBLICATION_RECEIPT_VERSION;
  readonly kind: "forward_revision_publication_receipt";
  readonly outcome: "published" | "already_published";
  readonly publicationId: string;
  readonly runtimeId: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly requestRevision: number;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly proposalRecordRevision: 0;
  readonly runtimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly publishedAt: number;
}

export interface CreateKnowledgeForwardRevisionPublicationReceiptInput {
  readonly outcome: KnowledgeForwardRevisionPublicationReceiptV1["outcome"];
  readonly proposal: unknown;
  readonly runtimeRevision: number;
  readonly proposalStoreRevision: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^forward-revision-request-[a-f0-9]{64}$/;
const PROPOSAL_ID_PATTERN = /^forward-revision-proposal-[a-f0-9]{64}$/;
const PUBLICATION_ID_PATTERN = /^forward-revision-publication-[a-f0-9]{64}$/;

const REQUEST_KEYS = [
  "version",
  "kind",
  "requestId",
  "requestRevision",
  "runtimeId",
  "bundleId",
  "pagePath",
  "intent",
  "intentDigest",
  "historicalReviewAuthority",
  "selectedContent",
  "selectedContentHash",
  "requestedAt",
] as const;
const REQUEST_CREATE_KEYS = REQUEST_KEYS.filter(
  (key) => key !== "version" && key !== "kind" && key !== "requestId"
);
const HISTORICAL_AUTHORITY_KEYS = [
  "proposalDigest",
  "acceptedDigest",
  "acceptedRecordRevision",
  "manifestCommitIntentDigest",
  "acceptedAt",
  "targetChange",
  "manifestPage",
] as const;
const TARGET_CHANGE_KEYS = ["changeId", "path", "operation", "afterHash", "sourceRefs"] as const;
const MANIFEST_PAGE_KEYS = ["path", "ownership", "contentHash"] as const;
const PROPOSAL_KEYS = [
  "version",
  "kind",
  "proposalId",
  "state",
  "recordRevision",
  "request",
  "requestDigest",
  "recordedAt",
] as const;
const RECEIPT_KEYS = [
  "version",
  "kind",
  "outcome",
  "publicationId",
  "runtimeId",
  "requestId",
  "requestDigest",
  "requestRevision",
  "proposalId",
  "proposalDigest",
  "proposalRecordRevision",
  "runtimeRevision",
  "proposalStoreRevision",
  "publishedAt",
] as const;

export class KnowledgeForwardRevisionProposalValidationError extends TypeError {
  constructor() {
    super("Forward revision durable proposal material is invalid");
    this.name = "KnowledgeForwardRevisionProposalValidationError";
  }
}

const authenticValidationErrors = new WeakSet<KnowledgeForwardRevisionProposalValidationError>();

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
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function snapshotArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
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

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
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

function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxPagePathCharacters ||
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

function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

function invalid(): never {
  const error = new KnowledgeForwardRevisionProposalValidationError();
  authenticValidationErrors.add(error);
  Object.freeze(error);
  throw error;
}

function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionProposalValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionProposalValidationError)
  );
}

function snapshotHistoricalAuthority(
  value: unknown,
  intent: Readonly<KnowledgeForwardRevisionIntent>
): Readonly<KnowledgeForwardRevisionHistoricalReviewAuthority> | undefined {
  const record = snapshotRecord(value, HISTORICAL_AUTHORITY_KEYS);
  const target = snapshotRecord(record?.targetChange, TARGET_CHANGE_KEYS);
  const manifestPage = snapshotRecord(record?.manifestPage, MANIFEST_PAGE_KEYS);
  const sourceRefs = snapshotArray(target?.sourceRefs, 1);
  const targetPath = snapshotPagePath(target?.path);
  const manifestPath = snapshotPagePath(manifestPage?.path);
  if (
    !record ||
    !target ||
    !manifestPage ||
    !sourceRefs ||
    sourceRefs.length !== 1 ||
    !isIdentifier(sourceRefs[0]) ||
    !targetPath ||
    !manifestPath ||
    !isDigest(record.proposalDigest) ||
    !isDigest(record.acceptedDigest) ||
    record.acceptedRecordRevision !== 1 ||
    !isDigest(record.manifestCommitIntentDigest) ||
    !isNonNegativeInteger(record.acceptedAt) ||
    !isIdentifier(target.changeId) ||
    (target.operation !== "create" && target.operation !== "update") ||
    !isDigest(target.afterHash) ||
    manifestPage.ownership !== "generated" ||
    !isDigest(manifestPage.contentHash) ||
    record.acceptedDigest !== intent.historical.changeSetDigest ||
    record.manifestCommitIntentDigest !== intent.historical.manifestIntentDigest ||
    Number(record.acceptedAt) > intent.historical.appliedAt ||
    targetPath !== intent.pagePath ||
    manifestPath !== intent.pagePath ||
    sourceRefs[0] !== intent.current.primarySourceId ||
    target.afterHash !== intent.historical.selectedContentHash ||
    manifestPage.contentHash !== intent.historical.selectedContentHash
  ) {
    return undefined;
  }
  return Object.freeze({
    proposalDigest: record.proposalDigest,
    acceptedDigest: record.acceptedDigest,
    acceptedRecordRevision: 1 as const,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: Number(record.acceptedAt),
    targetChange: Object.freeze({
      changeId: target.changeId,
      path: targetPath,
      operation: target.operation,
      afterHash: target.afterHash,
      sourceRefs: Object.freeze([sourceRefs[0]] as [string]),
    }),
    manifestPage: Object.freeze({
      path: manifestPath,
      ownership: "generated" as const,
      contentHash: manifestPage.contentHash,
    }),
  });
}

function requestIdPayload(
  value: Omit<KnowledgeForwardRevisionRequestV1, "version" | "kind" | "requestId">
): JsonValue {
  return value as unknown as JsonValue;
}

function deriveRequestId(
  value: Omit<KnowledgeForwardRevisionRequestV1, "version" | "kind" | "requestId">
): string {
  return `forward-revision-request-${digestValue(
    "knowledge-forward-revision-request-id-v1",
    requestIdPayload(value)
  )}`;
}

function snapshotRequestInput(
  value: unknown
): Omit<KnowledgeForwardRevisionRequestV1, "version" | "kind" | "requestId"> {
  const record = snapshotRecord(value, REQUEST_CREATE_KEYS);
  if (!record) invalid();
  let intent: Readonly<KnowledgeForwardRevisionIntent>;
  try {
    intent = snapshotKnowledgeForwardRevisionIntent(record.intent);
  } catch {
    invalid();
  }
  const pagePath = snapshotPagePath(record.pagePath);
  const authority = snapshotHistoricalAuthority(record.historicalReviewAuthority, intent);
  if (
    !isPositiveInteger(record.requestRevision) ||
    !isIdentifier(record.runtimeId) ||
    !isIdentifier(record.bundleId) ||
    !pagePath ||
    !isDigest(record.intentDigest) ||
    record.intentDigest !== createKnowledgeForwardRevisionIntentDigest(intent) ||
    !authority ||
    typeof record.selectedContent !== "string" ||
    record.selectedContent.length >
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters ||
    !isUnicodeScalarText(record.selectedContent) ||
    new TextEncoder().encode(record.selectedContent).byteLength >
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes ||
    !isDigest(record.selectedContentHash) ||
    createFileContentHash(record.selectedContent) !== record.selectedContentHash ||
    record.selectedContentHash !== intent.historical.selectedContentHash ||
    record.bundleId !== intent.bundleId ||
    pagePath !== intent.pagePath ||
    !isNonNegativeInteger(record.requestedAt) ||
    Number(record.requestedAt) < intent.historical.appliedAt
  ) {
    invalid();
  }
  return Object.freeze({
    requestRevision: Number(record.requestRevision),
    runtimeId: record.runtimeId,
    bundleId: record.bundleId,
    pagePath,
    intent,
    intentDigest: record.intentDigest,
    historicalReviewAuthority: authority,
    selectedContent: record.selectedContent,
    selectedContentHash: record.selectedContentHash,
    requestedAt: Number(record.requestedAt),
  });
}

export function createKnowledgeForwardRevisionRequest(
  value: CreateKnowledgeForwardRevisionRequestInput
): Readonly<KnowledgeForwardRevisionRequestV1> {
  const captured = snapshotRequestInput(value);
  return snapshotKnowledgeForwardRevisionRequest({
    version: KNOWLEDGE_FORWARD_REVISION_REQUEST_VERSION,
    kind: "forward_revision_request",
    requestId: deriveRequestId(captured),
    ...captured,
  });
}

export function snapshotKnowledgeForwardRevisionRequest(
  value: unknown
): Readonly<KnowledgeForwardRevisionRequestV1> {
  try {
    const record = snapshotRecord(value, REQUEST_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REQUEST_VERSION ||
      record.kind !== "forward_revision_request" ||
      !isIdentifier(record.requestId) ||
      !REQUEST_ID_PATTERN.test(record.requestId)
    ) {
      invalid();
    }
    const captured = snapshotRequestInput({
      requestRevision: record.requestRevision,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      pagePath: record.pagePath,
      intent: record.intent,
      intentDigest: record.intentDigest,
      historicalReviewAuthority: record.historicalReviewAuthority,
      selectedContent: record.selectedContent,
      selectedContentHash: record.selectedContentHash,
      requestedAt: record.requestedAt,
    });
    if (record.requestId !== deriveRequestId(captured)) invalid();
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_REQUEST_VERSION,
      kind: "forward_revision_request" as const,
      requestId: record.requestId,
      ...captured,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function createKnowledgeForwardRevisionRequestDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-request-v1",
    snapshotKnowledgeForwardRevisionRequest(value)
  );
}

function deriveProposalId(
  value: Omit<KnowledgeForwardRevisionPendingProposalRecordV1, "proposalId">
): string {
  return `forward-revision-proposal-${digestValue(
    "knowledge-forward-revision-proposal-id-v1",
    value
  )}`;
}

export function createKnowledgeForwardRevisionPendingProposalRecord(
  value: CreateKnowledgeForwardRevisionPendingProposalRecordInput
): Readonly<KnowledgeForwardRevisionPendingProposalRecordV1> {
  const record = snapshotRecord(value, ["request", "recordedAt"]);
  if (!record) invalid();
  const request = snapshotKnowledgeForwardRevisionRequest(record.request);
  if (
    !isNonNegativeInteger(record.recordedAt) ||
    Number(record.recordedAt) !== request.requestedAt
  ) {
    invalid();
  }
  const proposalWithoutId = Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_RECORD_VERSION,
    kind: "forward_revision_proposal_record" as const,
    state: "pending_review" as const,
    recordRevision: 0 as const,
    request,
    requestDigest: createKnowledgeForwardRevisionRequestDigest(request),
    recordedAt: Number(record.recordedAt),
  });
  return snapshotKnowledgeForwardRevisionPendingProposalRecord({
    ...proposalWithoutId,
    proposalId: deriveProposalId(proposalWithoutId),
  });
}

export function snapshotKnowledgeForwardRevisionPendingProposalRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionPendingProposalRecordV1> {
  try {
    const record = snapshotRecord(value, PROPOSAL_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_PROPOSAL_RECORD_VERSION ||
      record.kind !== "forward_revision_proposal_record" ||
      record.state !== "pending_review" ||
      record.recordRevision !== 0 ||
      !isIdentifier(record.proposalId) ||
      !PROPOSAL_ID_PATTERN.test(record.proposalId) ||
      !isDigest(record.requestDigest) ||
      !isNonNegativeInteger(record.recordedAt)
    ) {
      invalid();
    }
    const request = snapshotKnowledgeForwardRevisionRequest(record.request);
    if (
      record.requestDigest !== createKnowledgeForwardRevisionRequestDigest(request) ||
      Number(record.recordedAt) !== request.requestedAt
    ) {
      invalid();
    }
    const captured = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_RECORD_VERSION,
      kind: "forward_revision_proposal_record" as const,
      state: "pending_review" as const,
      recordRevision: 0 as const,
      request,
      requestDigest: record.requestDigest,
      recordedAt: Number(record.recordedAt),
    });
    if (record.proposalId !== deriveProposalId(captured)) invalid();
    return Object.freeze({ ...captured, proposalId: record.proposalId });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function createKnowledgeForwardRevisionPendingProposalRecordDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-proposal-record-v1",
    snapshotKnowledgeForwardRevisionPendingProposalRecord(value)
  );
}

function derivePublicationId(
  value: Omit<
    KnowledgeForwardRevisionPublicationReceiptV1,
    "version" | "kind" | "outcome" | "publicationId"
  >
): string {
  return `forward-revision-publication-${digestValue(
    "knowledge-forward-revision-publication-id-v1",
    value
  )}`;
}

export function createKnowledgeForwardRevisionPublicationReceipt(
  value: CreateKnowledgeForwardRevisionPublicationReceiptInput
): Readonly<KnowledgeForwardRevisionPublicationReceiptV1> {
  const record = snapshotRecord(value, [
    "outcome",
    "proposal",
    "runtimeRevision",
    "proposalStoreRevision",
  ]);
  if (!record) invalid();
  const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
  if (
    (record.outcome !== "published" && record.outcome !== "already_published") ||
    !isPositiveInteger(record.runtimeRevision) ||
    !isPositiveInteger(record.proposalStoreRevision) ||
    proposal.request.requestRevision > Number(record.proposalStoreRevision) ||
    Number(record.proposalStoreRevision) > Number(record.runtimeRevision)
  ) {
    invalid();
  }
  const receiptIdentity = Object.freeze({
    runtimeId: proposal.request.runtimeId,
    requestId: proposal.request.requestId,
    requestDigest: proposal.requestDigest,
    requestRevision: proposal.request.requestRevision,
    proposalId: proposal.proposalId,
    proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
    proposalRecordRevision: proposal.recordRevision,
    runtimeRevision: Number(record.runtimeRevision),
    proposalStoreRevision: Number(record.proposalStoreRevision),
    publishedAt: proposal.recordedAt,
  });
  return snapshotKnowledgeForwardRevisionPublicationReceipt({
    version: KNOWLEDGE_FORWARD_REVISION_PUBLICATION_RECEIPT_VERSION,
    kind: "forward_revision_publication_receipt",
    outcome: record.outcome,
    publicationId: derivePublicationId(receiptIdentity),
    ...receiptIdentity,
  });
}

export function snapshotKnowledgeForwardRevisionPublicationReceipt(
  value: unknown
): Readonly<KnowledgeForwardRevisionPublicationReceiptV1> {
  try {
    const record = snapshotRecord(value, RECEIPT_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_PUBLICATION_RECEIPT_VERSION ||
      record.kind !== "forward_revision_publication_receipt" ||
      (record.outcome !== "published" && record.outcome !== "already_published") ||
      !isIdentifier(record.publicationId) ||
      !PUBLICATION_ID_PATTERN.test(record.publicationId) ||
      !isIdentifier(record.runtimeId) ||
      !isIdentifier(record.requestId) ||
      !REQUEST_ID_PATTERN.test(record.requestId) ||
      !isDigest(record.requestDigest) ||
      !isPositiveInteger(record.requestRevision) ||
      !isIdentifier(record.proposalId) ||
      !PROPOSAL_ID_PATTERN.test(record.proposalId) ||
      !isDigest(record.proposalDigest) ||
      record.proposalRecordRevision !== 0 ||
      !isPositiveInteger(record.runtimeRevision) ||
      !isPositiveInteger(record.proposalStoreRevision) ||
      Number(record.requestRevision) > Number(record.proposalStoreRevision) ||
      Number(record.proposalStoreRevision) > Number(record.runtimeRevision) ||
      !isNonNegativeInteger(record.publishedAt)
    ) {
      invalid();
    }
    const identity = Object.freeze({
      runtimeId: record.runtimeId,
      requestId: record.requestId,
      requestDigest: record.requestDigest,
      requestRevision: Number(record.requestRevision),
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      proposalRecordRevision: 0 as const,
      runtimeRevision: Number(record.runtimeRevision),
      proposalStoreRevision: Number(record.proposalStoreRevision),
      publishedAt: Number(record.publishedAt),
    });
    if (record.publicationId !== derivePublicationId(identity)) invalid();
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_PUBLICATION_RECEIPT_VERSION,
      kind: "forward_revision_publication_receipt" as const,
      outcome: record.outcome,
      publicationId: record.publicationId,
      ...identity,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function createKnowledgeForwardRevisionPublicationReceiptDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-publication-receipt-v1",
    snapshotKnowledgeForwardRevisionPublicationReceipt(value)
  );
}

Object.freeze(KnowledgeForwardRevisionProposalValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionProposalValidationError);
