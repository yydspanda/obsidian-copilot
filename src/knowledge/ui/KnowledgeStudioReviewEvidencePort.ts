import type {
  KnowledgeReviewEvidenceOpenRequest,
  KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";

/** Independent read-only boundary for opening evidence from one current Review plan. */
export interface KnowledgeStudioReviewEvidencePort {
  /**
   * Re-proves and opens one opaque evidence reference from an exact Review snapshot.
   *
   * @param bundleId - Bundle that owns the currently rendered Review plan
   * @param request - Opaque evidence reference plus current plan identities
   * @param signal - Cancellation owned by the Studio controller generation
   * @returns Value-free navigation outcome
   */
  openReviewEvidence(
    bundleId: string,
    request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>>;
}
