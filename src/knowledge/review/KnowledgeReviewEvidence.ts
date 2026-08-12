import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";
import { validateKnowledgeChangeSet } from "@/knowledge/model/validation";
import { sha256 } from "@/utils/hash";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_REF_NAMESPACE = "knowledge-review-evidence-v1";

/** Fixed disclosure bounds for one Review evidence projection. */
export const KNOWLEDGE_REVIEW_EVIDENCE_LIMITS = Object.freeze({
  maxSummaries: 64,
  maxExcerptLength: 320,
  maxHeadingLength: 160,
});

/** Safe location metadata that cannot identify or open an artifact by itself. */
export type KnowledgeReviewEvidenceLocationSummary =
  | Readonly<{
      kind: "markdown_lines";
      startLine: number;
      endLine: number;
      heading?: string;
      headingTruncated?: boolean;
    }>
  | Readonly<{
      kind: "heading";
      heading: string;
      headingTruncated: boolean;
      occurrence: number;
    }>
  | Readonly<{ kind: "pdf_page"; page: number }>
  | Readonly<{ kind: "quote" }>;

/** Bounded, non-actionable evidence metadata rendered at plan level. */
export interface KnowledgeReviewEvidenceSummary {
  readonly evidenceRef: string;
  readonly relation: ClaimCitation["relation"];
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly location: KnowledgeReviewEvidenceLocationSummary;
}

/** Bounded evidence collection attached to one immutable Review plan. */
export interface KnowledgeReviewEvidenceProjection {
  readonly evidence: readonly Readonly<KnowledgeReviewEvidenceSummary>[];
  readonly omittedEvidenceCount: number;
}

/** Strict opaque request emitted when a user asks to open one evidence item. */
export interface KnowledgeReviewEvidenceOpenRequest {
  readonly changeSetId: string;
  readonly proposalDigest: string;
  readonly expectedSnapshotToken: string;
  readonly evidenceRef: string;
}

/** Closed result returned after one evidence navigation attempt. */
export type KnowledgeReviewEvidenceOpenResult = Readonly<{
  kind: "opened" | "stale" | "unsupported" | "unavailable";
}>;

/** Reports malformed evidence identities or open requests without retaining input data. */
export class KnowledgeReviewEvidenceRequestError extends Error {
  /** Creates one sanitized strict-boundary error. */
  constructor() {
    super("Knowledge review evidence request is invalid");
    this.name = "KnowledgeReviewEvidenceRequestError";
  }
}

/** Reports whether one identifier is canonical without normalizing user input. */
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Reads one exact plain data record without invoking property accessors. */
function readExactRecord(
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
      !expectedKeys.every((key) => keys.includes(key))
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/**
 * Creates the proposal-bound opaque reference for one citation identifier.
 *
 * @param proposalDigest - Exact digest of the proposed ChangeSet
 * @param citationId - Citation identifier retained only behind the Core boundary
 * @returns Lowercase SHA-256 evidence reference
 */
export function createKnowledgeReviewEvidenceRef(
  proposalDigest: string,
  citationId: string
): string {
  if (!SHA256_PATTERN.test(proposalDigest) || !isIdentifier(citationId)) {
    throw new KnowledgeReviewEvidenceRequestError();
  }
  return sha256(`${EVIDENCE_REF_NAMESPACE}\n${proposalDigest}\n${citationId}`);
}

/** Reduces an actionable locator to frozen display-only location metadata. */
function createLocationSummary(
  locator: Readonly<SourceLocator>
): KnowledgeReviewEvidenceLocationSummary {
  switch (locator.kind) {
    case "markdown_lines": {
      const heading =
        locator.heading === undefined
          ? undefined
          : createBoundedText(locator.heading, KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength);
      return Object.freeze({
        kind: locator.kind,
        startLine: locator.startLine,
        endLine: locator.endLine,
        ...(heading === undefined
          ? {}
          : { heading: heading.value, headingTruncated: heading.truncated }),
      });
    }
    case "heading": {
      const heading = createBoundedText(
        locator.heading,
        KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength
      );
      return Object.freeze({
        kind: locator.kind,
        heading: heading.value,
        headingTruncated: heading.truncated,
        occurrence: locator.occurrence,
      });
    }
    case "pdf_page":
      return Object.freeze({ kind: locator.kind, page: locator.page });
    case "quote":
      return Object.freeze({ kind: locator.kind });
  }
}

/** Creates one UTF-16-safe bounded display string and explicit truncation marker. */
function createBoundedText(
  value: string,
  maxLength: number
): Readonly<{ value: string; truncated: boolean }> {
  if (value.length <= maxLength) {
    return Object.freeze({ value, truncated: false });
  }
  let bounded = value.slice(0, maxLength);
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    bounded = bounded.slice(0, -1);
  }
  return Object.freeze({ value: bounded, truncated: true });
}

/**
 * Projects proposal citations into a bounded, deeply frozen Review disclosure.
 *
 * Artifact identifiers, hashes, paths, quote anchors, claim ids, citation ids,
 * and the actionable locator object deliberately remain outside this result.
 *
 * @param citations - Validated citations from the exact proposed ChangeSet
 * @param proposalDigest - Exact digest binding every opaque evidence reference
 * @returns Bounded summaries plus an explicit omitted count
 */
export function createKnowledgeReviewEvidenceProjection(
  citations: readonly Readonly<ClaimCitation>[],
  proposalDigest: string
): Readonly<KnowledgeReviewEvidenceProjection> {
  if (!SHA256_PATTERN.test(proposalDigest)) {
    throw new KnowledgeReviewEvidenceRequestError();
  }
  const visible = citations.slice(0, KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxSummaries);
  const evidence = visible.map((citation): Readonly<KnowledgeReviewEvidenceSummary> => {
    const bounded = createBoundedText(
      citation.locator.excerpt,
      KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxExcerptLength
    );
    return Object.freeze({
      evidenceRef: createKnowledgeReviewEvidenceRef(proposalDigest, citation.citationId),
      relation: citation.relation,
      excerpt: bounded.value,
      truncated: bounded.truncated,
      location: createLocationSummary(citation.locator),
    });
  });
  return Object.freeze({
    evidence: Object.freeze(evidence),
    omittedEvidenceCount: citations.length - evidence.length,
  });
}

/** Creates one deeply frozen citation copy for private adapter navigation. */
function freezeCitation(citation: Readonly<ClaimCitation>): Readonly<ClaimCitation> {
  const locator = Object.freeze({ ...citation.locator }) as Readonly<SourceLocator>;
  return Object.freeze({
    citationId: citation.citationId,
    claimId: citation.claimId,
    relation: citation.relation,
    locator,
  });
}

/**
 * Resolves one visible opaque evidence reference against an exact fresh proposal.
 *
 * Omitted citations are intentionally not resolvable. The supplied proposal is
 * reparsed, semantically validated, required to remain proposed, and rebound to
 * the caller's digest before any actionable citation material is returned.
 *
 * @param value - Fresh unknown pending proposal read through the production boundary
 * @param proposalDigest - Digest carried by the current Review plan and open request
 * @param evidenceRef - Opaque reference issued by the bounded plan projection
 * @returns Detached frozen full citation, or undefined when any proof fails
 */
export function resolveKnowledgeReviewEvidenceCitation(
  value: unknown,
  proposalDigest: string,
  evidenceRef: string
): Readonly<ClaimCitation> | undefined {
  if (!SHA256_PATTERN.test(proposalDigest) || !SHA256_PATTERN.test(evidenceRef)) return undefined;
  const parsed = parseKnowledgeChangeSet(value);
  if (!parsed.ok || parsed.value.status !== "proposed") return undefined;
  const validation = validateKnowledgeChangeSet(parsed.value);
  if (!validation.valid || createKnowledgeChangeSetDigest(parsed.value) !== proposalDigest) {
    return undefined;
  }
  const visible = parsed.value.citations.slice(0, KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxSummaries);
  const matches = visible.filter(
    (citation) =>
      createKnowledgeReviewEvidenceRef(proposalDigest, citation.citationId) === evidenceRef
  );
  return matches.length === 1 ? freezeCitation(matches[0]) : undefined;
}

/**
 * Strictly captures an opaque evidence-open request without reading locator data.
 *
 * @param value - Unknown UI request crossing the evidence navigation boundary
 * @returns Detached and frozen identity-only request
 */
export function snapshotKnowledgeReviewEvidenceOpenRequest(
  value: unknown
): Readonly<KnowledgeReviewEvidenceOpenRequest> {
  const request = readExactRecord(value, [
    "changeSetId",
    "proposalDigest",
    "expectedSnapshotToken",
    "evidenceRef",
  ]);
  if (
    !request ||
    !isIdentifier(request.changeSetId) ||
    typeof request.proposalDigest !== "string" ||
    !SHA256_PATTERN.test(request.proposalDigest) ||
    typeof request.expectedSnapshotToken !== "string" ||
    !SHA256_PATTERN.test(request.expectedSnapshotToken) ||
    typeof request.evidenceRef !== "string" ||
    !SHA256_PATTERN.test(request.evidenceRef)
  ) {
    throw new KnowledgeReviewEvidenceRequestError();
  }
  return Object.freeze({
    changeSetId: request.changeSetId,
    proposalDigest: request.proposalDigest,
    expectedSnapshotToken: request.expectedSnapshotToken,
    evidenceRef: request.evidenceRef,
  });
}
