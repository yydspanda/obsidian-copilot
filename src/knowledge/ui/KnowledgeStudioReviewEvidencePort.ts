import type {
  KnowledgeReviewEvidenceOpenRequest,
  KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";

export interface KnowledgeStudioReviewEvidencePort {
  openReviewEvidence(
    bundleId: string,
    request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>>;
}
