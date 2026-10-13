import type { GeneratedPageOwnership, SourceCustody } from "@/knowledge/model/types";
import type { KnowledgeReviewEvidenceSummary } from "@/knowledge/review/KnowledgeReviewEvidence";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import type { KnowledgeEffectivePageOrigin } from "@/knowledge/manifest/KnowledgeEffectivePageProjection";

export const KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS = Object.freeze({
  maxDisplayPathLength: 1_024,
  maxSources: 16,
  maxEvidence: 64,
});

export const KNOWLEDGE_APPLIED_WIKI_EVIDENCE_SCOPE = "source_applied_content" as const;

export interface KnowledgeAppliedWikiPageInspectionRequest {
  readonly pagePath: string;
}

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

export type KnowledgeAppliedWikiEvidenceSummary = KnowledgeReviewEvidenceSummary;

export interface KnowledgeAppliedWikiSourceSummary {
  readonly sourceRef: string;
  readonly displaySourcePath: string;
  readonly custody: SourceCustody;
  readonly acceptedAt: number;
  readonly evidence: readonly Readonly<KnowledgeAppliedWikiEvidenceSummary>[];
  readonly omittedEvidenceCount: number;
}

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

export type KnowledgeAppliedWikiEvidenceOpenResult = Readonly<{
  kind: "opened" | "stale" | "unsupported" | "unavailable";
}>;

export type KnowledgeAppliedWikiPageInspectorErrorCode =
  | "invalid_request"
  | "not_applied"
  | "drifted"
  | "unavailable";

const inspectorErrorCodes = new WeakMap<object, KnowledgeAppliedWikiPageInspectorErrorCode>();

export class KnowledgeAppliedWikiPageInspectorError extends Error {
  readonly code: KnowledgeAppliedWikiPageInspectorErrorCode;

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

export interface KnowledgeAppliedWikiPageInspectorPort {
  inspectPage(
    request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>>;

  openEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>;
}

Object.freeze(KnowledgeAppliedWikiPageInspectorError.prototype);
Object.freeze(KnowledgeAppliedWikiPageInspectorError);
