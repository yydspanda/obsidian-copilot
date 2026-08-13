import {
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, JsonValue } from "@/knowledge/model/types";
import { validateClaimCitation } from "@/knowledge/model/validation";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict query version for one pending forward-validation authority read. */
export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_QUERY_VERSION = 1 as const;

/** Current strict version of detached Runtime validation proof material. */
export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_VERSION = 1 as const;

/** Defensive limits for one detached validation-authority response. */
export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxHistoricalCitations: 4_096,
  maxHistoricalCitationCharacters: 4_000_000,
  maxHistoricalCitationStringCharacters: 2_000_000,
});

/** Exact identity of one pending proposal to rejoin inside a Runtime envelope. */
export interface KnowledgeForwardRevisionValidationAuthorityQueryV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_QUERY_VERSION;
  readonly kind: "forward_revision_validation_authority_query";
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly expectedRecordRevision: 0;
}

/** Input whose query identity is derived only from one strict pending proposal. */
export interface CreateKnowledgeForwardRevisionValidationAuthorityQueryInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
}

/** Runtime-only structural creator input for one detached validation authority. */
export interface CreateKnowledgeForwardRevisionValidationAuthorityInput {
  readonly query: unknown;
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly forwardReviewStoreRevision: number;
  readonly acceptanceAuthority: unknown;
  readonly historicalAcceptedDigest: string;
  readonly historicalSourceRefs: unknown;
  readonly historicalCitations: unknown;
}

/**
 * Detached, non-mutating proof for deterministic validation of one pending proposal.
 *
 * Authenticity comes only from a genuine Runtime read facade. In particular,
 * `acceptanceAuthority.vaultObservedBeforeHash` is the proposal-time external
 * observation echoed by Runtime correlation; it is not a fresh Vault-byte proof.
 */
export interface KnowledgeForwardRevisionValidationAuthorityV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_VERSION;
  readonly kind: "forward_revision_validation_authority";
  readonly query: Readonly<KnowledgeForwardRevisionValidationAuthorityQueryV1>;
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly proposalRecordRevision: 0;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly forwardReviewStoreRevision: number;
  readonly acceptanceAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  readonly historicalAcceptedDigest: string;
  readonly historicalSourceRefs: readonly [string];
  readonly historicalCitations: readonly Readonly<ClaimCitation>[];
  readonly historicalCitationSetDigest: string;
  readonly authorityDigest: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const QUERY_KEYS = [
  "version",
  "kind",
  "runtimeId",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "requestId",
  "requestDigest",
  "intentId",
  "intentDigest",
  "expectedRecordRevision",
] as const;
const QUERY_CREATE_KEYS = ["proposal", "proposalDigest"] as const;
const AUTHORITY_CREATE_KEYS = [
  "query",
  "proposal",
  "proposalDigest",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
  "forwardReviewStoreRevision",
  "acceptanceAuthority",
  "historicalAcceptedDigest",
  "historicalSourceRefs",
  "historicalCitations",
] as const;
const AUTHORITY_KEYS = [
  "version",
  "kind",
  "query",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "proposal",
  "proposalDigest",
  "proposalRecordRevision",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
  "forwardReviewStoreRevision",
  "acceptanceAuthority",
  "historicalAcceptedDigest",
  "historicalSourceRefs",
  "historicalCitations",
  "historicalCitationSetDigest",
  "authorityDigest",
] as const;
const CITATION_KEYS = ["citationId", "claimId", "relation", "locator"] as const;
const LOCATOR_BASE_KEYS = [
  "kind",
  "sourceId",
  "artifactId",
  "artifactContentHash",
  "excerpt",
  "quoteHash",
] as const;
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionValidationAuthorityValidationError>();

/** Fixed value-free failure for malformed validation-authority protocol material. */
export class KnowledgeForwardRevisionValidationAuthorityValidationError extends TypeError {
  /** Creates one sanitized failure; only module-thrown instances are authentic. */
  constructor() {
    super("Forward revision validation authority is invalid");
    this.name = "KnowledgeForwardRevisionValidationAuthorityValidationError";
  }
}

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionValidationAuthorityValidationError();
  authenticValidationErrors.add(error);
  Object.freeze(error);
  throw error;
}

/** Reports whether a caught failure was minted by this module. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionValidationAuthorityValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(
      value as KnowledgeForwardRevisionValidationAuthorityValidationError
    )
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
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(result, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Captures one bounded dense ordinary array through data descriptors only. */
function snapshotArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
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

/** Captures only one dense ordinary array's bounded length without reading its elements. */
function snapshotArrayLength(value: unknown, maximum: number): number | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
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
    return Number(length.value);
  } catch {
    return undefined;
  }
}

/** Reads one dense array element through its own enumerable data descriptor only. */
function readArrayElement(value: unknown, index: number): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
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

/** Reports whether text contains a C0 or C1 control character. */
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
    value.length <=
      KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether a value is a lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether a value is a non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Captures one exact canonical Vault-relative page path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxPagePathCharacters ||
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

/** Derives a domain-separated digest for one canonical JSON value. */
function digestValue(domain: string, value: unknown): string {
  return sha256(`${domain}\n${canonicalizeJson(value as JsonValue)}`);
}

/** Strictly snapshots one pending-proposal-derived authority query. */
export function snapshotKnowledgeForwardRevisionValidationAuthorityQuery(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationAuthorityQueryV1> {
  try {
    const record = snapshotRecord(value, QUERY_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_QUERY_VERSION ||
      record.kind !== "forward_revision_validation_authority_query" ||
      !isIdentifier(record.runtimeId) ||
      !isIdentifier(record.bundleId) ||
      !pagePath ||
      !isIdentifier(record.proposalId) ||
      !isDigest(record.proposalDigest) ||
      !isIdentifier(record.requestId) ||
      !isDigest(record.requestDigest) ||
      !isIdentifier(record.intentId) ||
      !isDigest(record.intentDigest) ||
      record.expectedRecordRevision !== 0
    ) {
      invalid();
    }
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_QUERY_VERSION,
      kind: "forward_revision_validation_authority_query" as const,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      pagePath,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      requestId: record.requestId,
      requestDigest: record.requestDigest,
      intentId: record.intentId,
      intentDigest: record.intentDigest,
      expectedRecordRevision: 0 as const,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Creates one strict lookup query from an exact pending proposal. */
export function createKnowledgeForwardRevisionValidationAuthorityQuery(
  value: CreateKnowledgeForwardRevisionValidationAuthorityQueryInput
): Readonly<KnowledgeForwardRevisionValidationAuthorityQueryV1> {
  try {
    const input = snapshotRecord(value, QUERY_CREATE_KEYS);
    if (!input || !isDigest(input.proposalDigest)) invalid();
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(input.proposal);
    if (
      input.proposalDigest !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalid();
    }
    const request = proposal.request;
    return snapshotKnowledgeForwardRevisionValidationAuthorityQuery({
      version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_QUERY_VERSION,
      kind: "forward_revision_validation_authority_query",
      runtimeId: request.runtimeId,
      bundleId: request.bundleId,
      pagePath: request.pagePath,
      proposalId: proposal.proposalId,
      proposalDigest: input.proposalDigest,
      requestId: request.requestId,
      requestDigest: proposal.requestDigest,
      intentId: request.intent.intentId,
      intentDigest: request.intentDigest,
      expectedRecordRevision: 0,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Captures one exact locator variant before shared semantic validation. */
function snapshotLocator(value: unknown): Readonly<ClaimCitation["locator"]> {
  const kind = readDataProperty(value, "kind");
  const required =
    kind === "markdown_lines"
      ? [...LOCATOR_BASE_KEYS, "startLine", "endLine"]
      : kind === "heading"
        ? [...LOCATOR_BASE_KEYS, "heading", "occurrence"]
        : kind === "pdf_page"
          ? [...LOCATOR_BASE_KEYS, "page"]
          : kind === "quote"
            ? [...LOCATOR_BASE_KEYS]
            : [];
  const optional =
    kind === "markdown_lines" ? ["heading"] : kind === "quote" ? ["prefix", "suffix"] : [];
  let record = snapshotRecord(value, required);
  for (let mask = 1; !record && mask < 1 << optional.length; mask += 1) {
    record = snapshotRecord(value, [
      ...required,
      ...optional.filter((_key, index) => (mask & (1 << index)) !== 0),
    ]);
  }
  if (!record) invalid();
  if (
    typeof record.kind !== "string" ||
    !isIdentifier(record.sourceId) ||
    !isIdentifier(record.artifactId) ||
    !isDigest(record.artifactContentHash) ||
    typeof record.excerpt !== "string" ||
    record.excerpt.length === 0 ||
    !isUnicodeScalarText(record.excerpt) ||
    !isDigest(record.quoteHash)
  ) {
    invalid();
  }
  if (
    record.kind === "markdown_lines" &&
    (!Number.isSafeInteger(record.startLine) ||
      Number(record.startLine) < 1 ||
      !Number.isSafeInteger(record.endLine) ||
      Number(record.endLine) < 1 ||
      Number(record.startLine) > Number(record.endLine) ||
      (record.heading !== undefined &&
        (typeof record.heading !== "string" ||
          record.heading.length === 0 ||
          !isUnicodeScalarText(record.heading))))
  ) {
    invalid();
  }
  if (
    record.kind === "heading" &&
    (typeof record.heading !== "string" ||
      record.heading.length === 0 ||
      !isUnicodeScalarText(record.heading) ||
      !Number.isSafeInteger(record.occurrence) ||
      Number(record.occurrence) < 1)
  ) {
    invalid();
  }
  if (
    record.kind === "pdf_page" &&
    (!Number.isSafeInteger(record.page) || Number(record.page) < 1)
  ) {
    invalid();
  }
  if (
    record.kind === "quote" &&
    ((record.prefix !== undefined &&
      (typeof record.prefix !== "string" || !isUnicodeScalarText(record.prefix))) ||
      (record.suffix !== undefined &&
        (typeof record.suffix !== "string" || !isUnicodeScalarText(record.suffix))))
  ) {
    invalid();
  }
  return Object.freeze({ ...record }) as Readonly<ClaimCitation["locator"]>;
}

/** Counts every retained citation string against one aggregate budget. */
function countCitationCharacters(citation: Readonly<ClaimCitation>): number {
  const locator = citation.locator;
  const values = [
    citation.citationId,
    citation.claimId,
    citation.relation,
    locator.kind,
    locator.sourceId,
    locator.artifactId,
    locator.artifactContentHash,
    locator.excerpt,
    locator.quoteHash,
    ...(locator.kind === "markdown_lines" ? [locator.heading ?? ""] : []),
    ...(locator.kind === "heading" ? [locator.heading] : []),
    ...(locator.kind === "quote" ? [locator.prefix ?? "", locator.suffix ?? ""] : []),
  ];
  if (
    values.some(
      (item) =>
        item.length >
        KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxHistoricalCitationStringCharacters
    )
  ) {
    invalid();
  }
  return values.reduce((total, item) => total + item.length, 0);
}

/** Snapshots complete historical accepted-Review citations within fixed caps. */
function snapshotHistoricalCitations(
  value: unknown,
  expectedPrimarySourceId?: string
): readonly Readonly<ClaimCitation>[] {
  const length = snapshotArrayLength(
    value,
    KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxHistoricalCitations
  );
  if (length === undefined) invalid();
  if (expectedPrimarySourceId !== undefined && !isIdentifier(expectedPrimarySourceId)) invalid();
  let characters = 0;
  const citationIds = new Set<string>();
  let primarySourceId = expectedPrimarySourceId;
  const citations: Readonly<ClaimCitation>[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = readArrayElement(value, index);
    const record = snapshotRecord(item, CITATION_KEYS);
    if (
      !record ||
      !isIdentifier(record.citationId) ||
      !isIdentifier(record.claimId) ||
      (record.relation !== "supports" &&
        record.relation !== "contradicts" &&
        record.relation !== "context")
    ) {
      invalid();
    }
    const citation = Object.freeze({
      citationId: record.citationId,
      claimId: record.claimId,
      relation: record.relation,
      locator: snapshotLocator(record.locator),
    }) as Readonly<ClaimCitation>;
    if (citationIds.has(citation.citationId)) invalid();
    citationIds.add(citation.citationId);
    characters += countCitationCharacters(citation);
    if (
      characters >
      KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxHistoricalCitationCharacters
    ) {
      invalid();
    }
    primarySourceId ??= citation.locator.sourceId;
    if (citation.locator.sourceId !== primarySourceId || !validateClaimCitation(citation).valid) {
      invalid();
    }
    citations.push(citation);
  }
  return Object.freeze(citations);
}

/** Creates a digest binding the complete ordered historical citation collection. */
export function snapshotKnowledgeForwardRevisionHistoricalCitationSet(
  value: unknown,
  expectedPrimarySourceId?: string
): readonly Readonly<ClaimCitation>[] {
  return snapshotHistoricalCitations(value, expectedPrimarySourceId);
}

/** Creates the shared ordered digest of exact accepted-Review ClaimCitation values. */
export function createKnowledgeForwardRevisionHistoricalCitationSetDigest(
  value: unknown,
  expectedPrimarySourceId?: string
): string {
  const citations = snapshotKnowledgeForwardRevisionHistoricalCitationSet(
    value,
    expectedPrimarySourceId
  );
  return digestValue("knowledge-forward-revision-historical-citation-set-v1", citations);
}

/** Creates one strict detached validation authority from Runtime-projected facts. */
export function createKnowledgeForwardRevisionValidationAuthority(
  value: CreateKnowledgeForwardRevisionValidationAuthorityInput
): Readonly<KnowledgeForwardRevisionValidationAuthorityV1> {
  try {
    const input = snapshotRecord(value, AUTHORITY_CREATE_KEYS);
    if (
      !input ||
      !isDigest(input.proposalDigest) ||
      !isNonNegativeInteger(input.publishedRuntimeRevision) ||
      !isNonNegativeInteger(input.proposalStoreRevision) ||
      !isNonNegativeInteger(input.forwardReviewStoreRevision) ||
      !isDigest(input.historicalAcceptedDigest)
    ) {
      invalid();
    }
    const query = snapshotKnowledgeForwardRevisionValidationAuthorityQuery(input.query);
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(input.proposal);
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const request = proposal.request;
    if (
      input.proposalDigest !== proposalDigest ||
      query.runtimeId !== request.runtimeId ||
      query.bundleId !== request.bundleId ||
      query.pagePath !== request.pagePath ||
      query.proposalId !== proposal.proposalId ||
      query.proposalDigest !== proposalDigest ||
      query.requestId !== request.requestId ||
      query.requestDigest !== proposal.requestDigest ||
      query.intentId !== request.intent.intentId ||
      query.intentDigest !== request.intentDigest ||
      Number(input.publishedRuntimeRevision) < 1 ||
      Number(input.proposalStoreRevision) < 1 ||
      Number(input.forwardReviewStoreRevision) < Number(input.proposalStoreRevision) ||
      input.historicalAcceptedDigest !== request.historicalReviewAuthority.acceptedDigest ||
      input.historicalAcceptedDigest !== request.intent.historical.changeSetDigest
    ) {
      invalid();
    }
    const sourceRefs = snapshotArray(input.historicalSourceRefs, 1);
    const primarySourceId = request.intent.current.primarySourceId;
    if (
      !sourceRefs ||
      sourceRefs.length !== 1 ||
      sourceRefs[0] !== primarySourceId ||
      request.historicalReviewAuthority.targetChange.sourceRefs.length !== 1 ||
      request.historicalReviewAuthority.targetChange.sourceRefs[0] !== primarySourceId
    ) {
      invalid();
    }
    const acceptanceAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      input.acceptanceAuthority,
      proposal
    );
    if (
      request.requestRevision > Number(input.proposalStoreRevision) ||
      Number(input.proposalStoreRevision) > Number(input.publishedRuntimeRevision) ||
      Number(input.publishedRuntimeRevision) > acceptanceAuthority.runtimeRevision ||
      Number(input.forwardReviewStoreRevision) < Number(input.proposalStoreRevision) ||
      Number(input.forwardReviewStoreRevision) > acceptanceAuthority.runtimeRevision
    ) {
      invalid();
    }
    const historicalCitations = snapshotKnowledgeForwardRevisionHistoricalCitationSet(
      input.historicalCitations,
      primarySourceId
    );
    const historicalCitationSetDigest = createKnowledgeForwardRevisionHistoricalCitationSetDigest(
      historicalCitations,
      primarySourceId
    );
    const payload = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_VERSION,
      kind: "forward_revision_validation_authority" as const,
      query,
      runtimeId: acceptanceAuthority.runtimeId,
      runtimeRevision: acceptanceAuthority.runtimeRevision,
      runtimeDigest: acceptanceAuthority.runtimeDigest,
      proposal,
      proposalDigest,
      proposalRecordRevision: 0 as const,
      publishedRuntimeRevision: Number(input.publishedRuntimeRevision),
      proposalStoreRevision: Number(input.proposalStoreRevision),
      forwardReviewStoreRevision: Number(input.forwardReviewStoreRevision),
      acceptanceAuthority,
      historicalAcceptedDigest: input.historicalAcceptedDigest,
      historicalSourceRefs: Object.freeze([primarySourceId] as [string]),
      historicalCitations,
      historicalCitationSetDigest,
    });
    return Object.freeze({
      ...payload,
      authorityDigest: digestValue("knowledge-forward-revision-validation-authority-v1", payload),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots and verifies one detached validation-authority response. */
export function snapshotKnowledgeForwardRevisionValidationAuthority(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationAuthorityV1> {
  try {
    const record = snapshotRecord(value, AUTHORITY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_VERSION ||
      record.kind !== "forward_revision_validation_authority" ||
      !isIdentifier(record.runtimeId) ||
      !isNonNegativeInteger(record.runtimeRevision) ||
      !isDigest(record.runtimeDigest) ||
      record.proposalRecordRevision !== 0 ||
      !isDigest(record.historicalCitationSetDigest) ||
      !isDigest(record.authorityDigest)
    ) {
      invalid();
    }
    const recreated = createKnowledgeForwardRevisionValidationAuthority({
      query: record.query,
      proposal: record.proposal,
      proposalDigest: record.proposalDigest as string,
      publishedRuntimeRevision: Number(record.publishedRuntimeRevision),
      proposalStoreRevision: Number(record.proposalStoreRevision),
      forwardReviewStoreRevision: Number(record.forwardReviewStoreRevision),
      acceptanceAuthority: record.acceptanceAuthority,
      historicalAcceptedDigest: record.historicalAcceptedDigest as string,
      historicalSourceRefs: record.historicalSourceRefs,
      historicalCitations: record.historicalCitations,
    });
    if (
      record.runtimeId !== recreated.runtimeId ||
      record.runtimeRevision !== recreated.runtimeRevision ||
      record.runtimeDigest !== recreated.runtimeDigest ||
      record.historicalCitationSetDigest !== recreated.historicalCitationSetDigest ||
      record.authorityDigest !== recreated.authorityDigest
    ) {
      invalid();
    }
    return recreated;
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Derives the exact digest of one already strict validation authority. */
export function createKnowledgeForwardRevisionValidationAuthorityDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionValidationAuthority(value).authorityDigest;
}

/** Returns a deterministic validation result for unknown authority material. */
export function validateKnowledgeForwardRevisionValidationAuthority(value: unknown): {
  readonly valid: boolean;
} {
  try {
    snapshotKnowledgeForwardRevisionValidationAuthority(value);
    return Object.freeze({ valid: true });
  } catch {
    return Object.freeze({ valid: false });
  }
}
