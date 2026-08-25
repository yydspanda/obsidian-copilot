import type { GeneratedPageOwnership, SourceCustody } from "@/knowledge/model/types";
import type { KnowledgeReviewEvidenceSummary } from "@/knowledge/review/KnowledgeReviewEvidence";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import type { KnowledgeEffectivePageOrigin } from "@/knowledge/manifest/KnowledgeEffectivePageProjection";

/** Fixed disclosure bounds for one applied-Wiki inspection session. */
export const KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS = Object.freeze({
  maxDisplayPathLength: 1_024,
  maxSources: 16,
  maxEvidence: 64,
});

/** Citations prove the retained Source apply, never later manually revised wording. */
export const KNOWLEDGE_APPLIED_WIKI_EVIDENCE_SCOPE = "source_applied_content" as const;

/** Canonical user-owned page selection captured synchronously from an Obsidian TFile. */
export interface KnowledgeAppliedWikiPageInspectionRequest {
  readonly pagePath: string;
}

/** Strictly captures a canonical path request without invoking property accessors. */
export function snapshotKnowledgeAppliedWikiPageInspectionRequest(
  value: unknown
): Readonly<KnowledgeAppliedWikiPageInspectionRequest> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== 1
    ) {
      throw new KnowledgeAppliedWikiPageInspectorError("invalid_request");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "pagePath");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KnowledgeAppliedWikiPageInspectorError("invalid_request");
    }
    if (
      typeof descriptor.value !== "string" ||
      descriptor.value.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
    ) {
      throw new KnowledgeAppliedWikiPageInspectorError("invalid_request");
    }
    const parsed = parseVaultPath(descriptor.value);
    if (!parsed.ok || parsed.path !== descriptor.value) {
      throw new KnowledgeAppliedWikiPageInspectorError("invalid_request");
    }
    return Object.freeze({ pagePath: parsed.path });
  } catch (error) {
    throw error instanceof KnowledgeAppliedWikiPageInspectorError
      ? error
      : new KnowledgeAppliedWikiPageInspectorError("invalid_request");
  }
}

/** Review evidence metadata nested below its display-only contributing Source. */
export type KnowledgeAppliedWikiEvidenceSummary = KnowledgeReviewEvidenceSummary;

/** Bounded display-only Source metadata for one current applied page. */
export interface KnowledgeAppliedWikiSourceSummary {
  readonly sourceRef: string;
  readonly displaySourcePath: string;
  readonly custody: SourceCustody;
  readonly acceptedAt: number;
  readonly evidence: readonly Readonly<KnowledgeAppliedWikiEvidenceSummary>[];
  readonly omittedEvidenceCount: number;
}

/**
 * Frozen display capability for one exact current applied Wiki page.
 *
 * Source and effective hashes plus the exact origin disclose whether the current
 * bytes came from Source apply or a forward revision. Evidence remains scoped to
 * the retained Source-applied material and does not prove manually revised text.
 * The DTO contains no actionable locator or file-operation authority. Its object
 * identity is the capability accepted by `openEvidence`.
 */
export interface KnowledgeAppliedWikiPageInspectionSession {
  readonly pageRef: string;
  readonly displayPagePath: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceAppliedContentHash: string;
  readonly effectiveContentHash: string;
  readonly origin: Readonly<KnowledgeEffectivePageOrigin>;
  readonly evidenceScope: typeof KNOWLEDGE_APPLIED_WIKI_EVIDENCE_SCOPE;
  readonly sources: readonly Readonly<KnowledgeAppliedWikiSourceSummary>[];
  readonly omittedSourceCount: number;
}

/** Closed, value-free outcome from one evidence navigation attempt. */
export type KnowledgeAppliedWikiEvidenceOpenResult = Readonly<{
  kind: "opened" | "stale" | "unsupported" | "unavailable";
}>;

/** Stable, value-free inspection failures safe for a UI boundary to classify. */
export type KnowledgeAppliedWikiPageInspectorErrorCode =
  | "invalid_request"
  | "not_applied"
  | "drifted"
  | "unavailable";

const inspectorErrorCodes = new WeakMap<object, KnowledgeAppliedWikiPageInspectorErrorCode>();

/** Sanitized inspection failure that never retains a path or adapter cause. */
export class KnowledgeAppliedWikiPageInspectorError extends Error {
  readonly code: KnowledgeAppliedWikiPageInspectorErrorCode;

  /** Creates one stable display-safe failure category. */
  constructor(code: KnowledgeAppliedWikiPageInspectorErrorCode) {
    if (
      code !== "invalid_request" &&
      code !== "not_applied" &&
      code !== "drifted" &&
      code !== "unavailable"
    ) {
      throw new TypeError("The applied knowledge Wiki inspector error code is invalid");
    }
    super("The applied knowledge Wiki page could not be inspected");
    this.name = "KnowledgeAppliedWikiPageInspectorError";
    this.code = code;
    inspectorErrorCodes.set(this, code);
    Object.freeze(this);
  }
}

/** Returns a code only for an authentic error minted by this module. */
export function getKnowledgeAppliedWikiPageInspectorErrorCode(
  value: unknown
): KnowledgeAppliedWikiPageInspectorErrorCode | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeAppliedWikiPageInspectorError.prototype
    ) {
      return undefined;
    }
    return inspectorErrorCodes.get(value);
  } catch {
    return undefined;
  }
}

/** Narrow stable command surface consumed by the Wiki inspector UI. */
export interface KnowledgeAppliedWikiPageInspectorPort {
  /** Re-proves one canonical page and returns an opaque current-applied capability. */
  inspectPage(
    request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>>;

  /** Re-proves and opens evidence bound to the exact authentic session object. */
  openEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>;
}

Object.freeze(KnowledgeAppliedWikiPageInspectorError.prototype);
Object.freeze(KnowledgeAppliedWikiPageInspectorError);
