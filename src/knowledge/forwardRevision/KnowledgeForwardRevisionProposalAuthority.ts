import {
  createKnowledgeForwardRevisionIntentDigest,
  snapshotKnowledgeForwardRevisionIntent,
  type KnowledgeForwardRevisionIntent,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionRequest,
  type KnowledgeForwardRevisionHistoricalReviewAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";

/** Current strict query version for read-only forward-proposal authority. */
export const KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_QUERY_VERSION = 1 as const;

/** Current strict read-only forward-proposal authority version. */
export const KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION = 1 as const;

/** Defensive bounds for one authority lookup. */
export const KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxVerifiedApplyCount: 10_000,
});

/** Exact observed selection supplied to a read-only Runtime authority lookup. */
export interface KnowledgeForwardRevisionProposalAuthorityQueryV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_QUERY_VERSION;
  readonly kind: "forward_revision_proposal_authority_query";
  readonly bundleId: string;
  readonly pagePath: string;
  readonly selectedContentHash: string;
  readonly selectedAppliedAt: number;
  readonly selectedVerifiedApplyCount: number;
  readonly vaultObservedBeforeHash: string;
}

/** Creator input for one canonical read-only Runtime authority query. */
export type CreateKnowledgeForwardRevisionProposalAuthorityQueryInput = Omit<
  KnowledgeForwardRevisionProposalAuthorityQueryV1,
  "version" | "kind"
>;

/**
 * Runtime-projected proof material that still grants no mutation authority.
 *
 * The fields, including `runtimeRevision`, are trustworthy only when a genuine
 * Runtime query implementation independently rejoins every query fact. This
 * structural snapshot and its later consumer never turn an echoed caller value
 * into authority; the publication CAS must re-prove the same facts again.
 */
export interface KnowledgeForwardRevisionProposalAuthorityV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION;
  readonly kind: "forward_revision_proposal_authority";
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly query: Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1>;
  readonly intent: Readonly<KnowledgeForwardRevisionIntent>;
  readonly intentDigest: string;
  readonly historicalReviewAuthority: Readonly<KnowledgeForwardRevisionHistoricalReviewAuthority>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const QUERY_KEYS = [
  "version",
  "kind",
  "bundleId",
  "pagePath",
  "selectedContentHash",
  "selectedAppliedAt",
  "selectedVerifiedApplyCount",
  "vaultObservedBeforeHash",
] as const;
const QUERY_CREATE_KEYS = QUERY_KEYS.filter((key) => key !== "version" && key !== "kind");
const AUTHORITY_KEYS = [
  "version",
  "kind",
  "runtimeId",
  "runtimeRevision",
  "query",
  "intent",
  "intentDigest",
  "historicalReviewAuthority",
] as const;
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionProposalAuthorityValidationError>();

/** Sanitized fixed failure for malformed read-only authority material. */
export class KnowledgeForwardRevisionProposalAuthorityValidationError extends TypeError {
  /** Creates one value-free failure; only module-thrown instances are authentic. */
  constructor() {
    super("Forward revision proposal authority is invalid");
    this.name = "KnowledgeForwardRevisionProposalAuthorityValidationError";
  }
}

/** Throws one authentic frozen authority validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionProposalAuthorityValidationError();
  authenticValidationErrors.add(error);
  Object.freeze(error);
  throw error;
}

/** Reports whether a failure was minted by this module. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionProposalAuthorityValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionProposalAuthorityValidationError)
  );
}

/** Reads one exact plain data record without invoking caller accessors. */
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

/** Reports whether text contains an unsupported identifier control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether a value is one bounded protocol identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether a value is one lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Captures one exact canonical Vault-relative page path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_LIMITS.maxPagePathCharacters ||
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

/** Strictly snapshots one authority-query creator input. */
function snapshotQueryInput(
  value: unknown
): CreateKnowledgeForwardRevisionProposalAuthorityQueryInput {
  const record = snapshotRecord(value, QUERY_CREATE_KEYS);
  const pagePath = snapshotPagePath(record?.pagePath);
  if (
    !record ||
    !isIdentifier(record.bundleId) ||
    !pagePath ||
    !isDigest(record.selectedContentHash) ||
    !Number.isSafeInteger(record.selectedAppliedAt) ||
    Number(record.selectedAppliedAt) < 0 ||
    !Number.isSafeInteger(record.selectedVerifiedApplyCount) ||
    Number(record.selectedVerifiedApplyCount) < 1 ||
    Number(record.selectedVerifiedApplyCount) >
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_LIMITS.maxVerifiedApplyCount ||
    !isDigest(record.vaultObservedBeforeHash)
  ) {
    invalid();
  }
  return Object.freeze({
    bundleId: record.bundleId,
    pagePath,
    selectedContentHash: record.selectedContentHash,
    selectedAppliedAt: Number(record.selectedAppliedAt),
    selectedVerifiedApplyCount: Number(record.selectedVerifiedApplyCount),
    vaultObservedBeforeHash: record.vaultObservedBeforeHash,
  });
}

/** Creates one canonical detached lookup query from fresh R3b observations. */
export function createKnowledgeForwardRevisionProposalAuthorityQuery(
  value: CreateKnowledgeForwardRevisionProposalAuthorityQueryInput
): Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1> {
  const captured = snapshotQueryInput(value);
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_QUERY_VERSION,
    kind: "forward_revision_proposal_authority_query" as const,
    ...captured,
  });
}

/** Strictly snapshots one unknown read-only Runtime authority query. */
export function snapshotKnowledgeForwardRevisionProposalAuthorityQuery(
  value: unknown
): Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1> {
  try {
    const record = snapshotRecord(value, QUERY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_QUERY_VERSION ||
      record.kind !== "forward_revision_proposal_authority_query"
    ) {
      invalid();
    }
    return createKnowledgeForwardRevisionProposalAuthorityQuery({
      bundleId: record.bundleId as string,
      pagePath: record.pagePath as string,
      selectedContentHash: record.selectedContentHash as string,
      selectedAppliedAt: record.selectedAppliedAt as number,
      selectedVerifiedApplyCount: record.selectedVerifiedApplyCount as number,
      vaultObservedBeforeHash: record.vaultObservedBeforeHash as string,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Reports exact semantic equality for two already strict queries. */
function queriesEqual(
  left: Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1>,
  right: Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1>
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/**
 * Strictly snapshots Runtime-projected read authority and rejoins its selected body.
 *
 * A throw is fail-closed and conveys no rejected values. The dummy request is
 * never persisted; it only reuses the durable proposal validator to prove the
 * historical Review descriptor and selected bytes agree with the strict intent.
 *
 * @param value - Unknown Runtime authority response
 * @param expectedQueryValue - Exact query sent to the Runtime
 * @param selectedContent - Fresh R3b historical body
 * @returns Detached deeply frozen non-authoritative proof material
 */
export function snapshotKnowledgeForwardRevisionProposalAuthority(
  value: unknown,
  expectedQueryValue: unknown,
  selectedContent: string
): Readonly<KnowledgeForwardRevisionProposalAuthorityV1> {
  try {
    const expectedQuery =
      snapshotKnowledgeForwardRevisionProposalAuthorityQuery(expectedQueryValue);
    const record = snapshotRecord(value, AUTHORITY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION ||
      record.kind !== "forward_revision_proposal_authority" ||
      !isIdentifier(record.runtimeId) ||
      !Number.isSafeInteger(record.runtimeRevision) ||
      Number(record.runtimeRevision) < 0 ||
      typeof selectedContent !== "string"
    ) {
      invalid();
    }
    const query = snapshotKnowledgeForwardRevisionProposalAuthorityQuery(record.query);
    if (!queriesEqual(query, expectedQuery)) invalid();
    const intent = snapshotKnowledgeForwardRevisionIntent(record.intent);
    if (
      !isDigest(record.intentDigest) ||
      record.intentDigest !== createKnowledgeForwardRevisionIntentDigest(intent) ||
      intent.bundleId !== query.bundleId ||
      intent.pagePath !== query.pagePath ||
      intent.historical.selectedContentHash !== query.selectedContentHash ||
      intent.historical.appliedAt !== query.selectedAppliedAt ||
      intent.current.vaultObservedBeforeHash !== query.vaultObservedBeforeHash
    ) {
      invalid();
    }
    const validationRequest = createKnowledgeForwardRevisionRequest({
      requestRevision: 1,
      runtimeId: record.runtimeId,
      bundleId: intent.bundleId,
      pagePath: intent.pagePath,
      intent,
      intentDigest: record.intentDigest,
      historicalReviewAuthority:
        record.historicalReviewAuthority as KnowledgeForwardRevisionHistoricalReviewAuthority,
      selectedContent,
      selectedContentHash: query.selectedContentHash,
      requestedAt: intent.historical.appliedAt,
    });
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION,
      kind: "forward_revision_proposal_authority" as const,
      runtimeId: record.runtimeId,
      runtimeRevision: Number(record.runtimeRevision),
      query,
      intent,
      intentDigest: record.intentDigest,
      historicalReviewAuthority: validationRequest.historicalReviewAuthority,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

Object.freeze(KnowledgeForwardRevisionProposalAuthorityValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionProposalAuthorityValidationError);
