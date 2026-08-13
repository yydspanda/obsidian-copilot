import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of the dedicated forward-revision Review snapshot. */
export const KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_VERSION = 1 as const;

/** Defensive persisted-record bound below the enclosing Runtime text limit. */
export const KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxRecords: 10_000,
  maxTotalSelectedContentCharacters: 16_000_000,
});

/** Runtime-owned publication envelope around one immutable pending proposal. */
export interface KnowledgeForwardRevisionPublishedProposalV1 {
  readonly version: 1;
  readonly kind: "forward_revision_published_proposal";
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  /** Original outer Runtime revision committed by the publication CAS. */
  readonly publishedRuntimeRevision: number;
  /** Original dedicated Review Store revision committed by the publication CAS. */
  readonly proposalStoreRevision: number;
}

/** Complete append-only pending-proposal namespace for one Bundle. */
export interface KnowledgeForwardRevisionReviewSnapshotV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_VERSION;
  readonly bundleId: string;
  readonly revision: number;
  /** Highest Runtime-allocated request revision; zero only before first publication. */
  readonly lastRequestRevision: number;
  readonly records: readonly Readonly<KnowledgeForwardRevisionPublishedProposalV1>[];
}

/** Runtime-only input for one publication wrapper. */
export interface CreateKnowledgeForwardRevisionPublishedProposalInput {
  readonly proposal: unknown;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PUBLISHED_PROPOSAL_KEYS = [
  "version",
  "kind",
  "proposal",
  "proposalDigest",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
] as const;
const SNAPSHOT_KEYS = [
  "version",
  "bundleId",
  "revision",
  "lastRequestRevision",
  "records",
] as const;

/** Fixed value-free failure for malformed forward Review persistence. */
export class KnowledgeForwardRevisionReviewSnapshotValidationError extends TypeError {
  /** Creates a sanitized strict-contract failure. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision Review snapshot does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionReviewSnapshotValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionReviewSnapshotValidationError");
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionReviewSnapshotValidationError>();

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

/** Captures one bounded dense array without invoking element accessors. */
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
    const captured: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

/** Reports whether a value is a bounded canonical identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether text contains only paired Unicode scalar values. */
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

/** Reports whether text contains an unsupported C0 or C1 control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether a value is a lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether a value is a non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Reports whether a value is a positive safe integer. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Throws one fixed strict-contract failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionReviewSnapshotValidationError(VALIDATION_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether a caught strict-contract failure was minted by this module. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionReviewSnapshotValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionReviewSnapshotValidationError)
  );
}

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
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

/** Bounds retained proposal bodies before deep strict snapshotting. */
function requireBoundedSelectedContent(records: readonly unknown[]): void {
  let characters = 0;
  for (const published of records) {
    const proposal = readDataProperty(published, "proposal");
    const request = readDataProperty(proposal, "request");
    const selectedContent = readDataProperty(request, "selectedContent");
    if (typeof selectedContent !== "string") invalid();
    characters += selectedContent.length;
    if (
      characters >
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS.maxTotalSelectedContentCharacters
    ) {
      invalid();
    }
  }
}

/** Strictly snapshots one Runtime-owned published-proposal wrapper. */
export function snapshotKnowledgeForwardRevisionPublishedProposal(
  value: unknown
): Readonly<KnowledgeForwardRevisionPublishedProposalV1> {
  try {
    const record = snapshotRecord(value, PUBLISHED_PROPOSAL_KEYS);
    if (
      !record ||
      record.version !== 1 ||
      record.kind !== "forward_revision_published_proposal" ||
      !isDigest(record.proposalDigest) ||
      !isPositiveInteger(record.publishedRuntimeRevision) ||
      !isPositiveInteger(record.proposalStoreRevision)
    ) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !==
        createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      proposal.request.requestRevision > Number(record.proposalStoreRevision) ||
      Number(record.proposalStoreRevision) > Number(record.publishedRuntimeRevision)
    ) {
      invalid();
    }
    return Object.freeze({
      version: 1 as const,
      kind: "forward_revision_published_proposal" as const,
      proposal,
      proposalDigest: record.proposalDigest,
      publishedRuntimeRevision: Number(record.publishedRuntimeRevision),
      proposalStoreRevision: Number(record.proposalStoreRevision),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Creates one strict Runtime-owned published-proposal wrapper. */
export function createKnowledgeForwardRevisionPublishedProposal(
  value: CreateKnowledgeForwardRevisionPublishedProposalInput
): Readonly<KnowledgeForwardRevisionPublishedProposalV1> {
  const record = snapshotRecord(value, [
    "proposal",
    "publishedRuntimeRevision",
    "proposalStoreRevision",
  ]);
  if (!record) invalid();
  const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
  return snapshotKnowledgeForwardRevisionPublishedProposal({
    version: 1,
    kind: "forward_revision_published_proposal",
    proposal,
    proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
    publishedRuntimeRevision: record.publishedRuntimeRevision,
    proposalStoreRevision: record.proposalStoreRevision,
  });
}

/** Creates an empty strict forward Review snapshot without persistence. */
export function createEmptyKnowledgeForwardRevisionReviewSnapshot(
  bundleId: string
): Readonly<KnowledgeForwardRevisionReviewSnapshotV1> {
  return snapshotKnowledgeForwardRevisionReviewSnapshot({
    version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_VERSION,
    bundleId,
    revision: 0,
    lastRequestRevision: 0,
    records: [],
  });
}

/** Strictly snapshots and semantically validates one forward Review snapshot. */
export function snapshotKnowledgeForwardRevisionReviewSnapshot(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewSnapshotV1> {
  try {
    const record = snapshotRecord(value, SNAPSHOT_KEYS);
    const rawRecords = snapshotArray(
      record?.records,
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS.maxRecords
    );
    if (
      !record ||
      !rawRecords ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_VERSION ||
      !isIdentifier(record.bundleId) ||
      !isNonNegativeInteger(record.revision) ||
      !isNonNegativeInteger(record.lastRequestRevision)
    ) {
      invalid();
    }
    requireBoundedSelectedContent(rawRecords);
    const records = rawRecords.map(snapshotKnowledgeForwardRevisionPublishedProposal);
    if (
      Number(record.lastRequestRevision) !== records.length ||
      Number(record.revision) !== records.length
    ) {
      invalid();
    }

    const proposalIds = new Set<string>();
    const requestIds = new Set<string>();
    const intentIds = new Set<string>();
    const pagePathKeys = new Set<string>();
    let priorRuntimeRevision = 0;
    let priorStoreRevision = 0;
    let runtimeId: string | undefined;
    for (let index = 0; index < records.length; index += 1) {
      const published = records[index];
      const request = published.proposal.request;
      const pagePathKey = toWindowsPathKey(request.pagePath);
      if (
        request.bundleId !== record.bundleId ||
        request.requestRevision !== index + 1 ||
        published.proposalStoreRevision !== index + 1 ||
        published.proposalStoreRevision <= priorStoreRevision ||
        published.publishedRuntimeRevision <= priorRuntimeRevision ||
        published.proposalStoreRevision > Number(record.revision) ||
        (runtimeId !== undefined && request.runtimeId !== runtimeId) ||
        proposalIds.has(published.proposal.proposalId) ||
        requestIds.has(request.requestId) ||
        intentIds.has(request.intent.intentId) ||
        pagePathKeys.has(pagePathKey)
      ) {
        invalid();
      }
      runtimeId = request.runtimeId;
      priorRuntimeRevision = published.publishedRuntimeRevision;
      priorStoreRevision = published.proposalStoreRevision;
      proposalIds.add(published.proposal.proposalId);
      requestIds.add(request.requestId);
      intentIds.add(request.intent.intentId);
      pagePathKeys.add(pagePathKey);
    }
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_VERSION,
      bundleId: record.bundleId,
      revision: Number(record.revision),
      lastRequestRevision: Number(record.lastRequestRevision),
      records: Object.freeze(records),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Parses one unknown snapshot into a detached value or one safe diagnostic. */
export function parseKnowledgeForwardRevisionReviewSnapshot(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionReviewSnapshotV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionReviewSnapshot(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_review_snapshot_invalid",
          severity: "error",
          field: "forwardRevisionReview",
          message: "Forward revision Review state does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one unknown snapshot without retaining rejected data. */
export function validateKnowledgeForwardRevisionReviewSnapshot(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionReviewSnapshot(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Computes the canonical namespaced digest of one strict snapshot. */
export function createKnowledgeForwardRevisionReviewSnapshotDigest(value: unknown): string {
  const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshot(value);
  return sha256(
    `knowledge-forward-revision-review-snapshot-v1\n${canonicalizeJson(
      snapshot as unknown as JsonValue
    )}`
  );
}

/** Detaches one fixed diagnostic returned by the parser. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionReviewSnapshotValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionReviewSnapshotValidationError);
