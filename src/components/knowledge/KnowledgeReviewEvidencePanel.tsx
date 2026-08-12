import { ExternalLink, Loader2 } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  KnowledgeReviewEvidenceLocationSummary,
  KnowledgeReviewEvidenceSummary,
} from "@/knowledge/review/KnowledgeReviewEvidence";

/** Props for the bounded, proposal-level Review evidence surface. */
export interface KnowledgeReviewEvidencePanelProps {
  headingId: string;
  evidence: readonly Readonly<KnowledgeReviewEvidenceSummary>[];
  omittedEvidenceCount: number;
  busy: boolean;
  openingEvidenceRef?: string;
  evidenceError?: string;
  onOpenEvidence?(this: void, evidenceRef: string): void | Promise<void>;
}

/** Returns a user-facing label for one citation relationship. */
function formatEvidenceRelation(relation: KnowledgeReviewEvidenceSummary["relation"]): string {
  switch (relation) {
    case "supports":
      return "Supports generated claim";
    case "contradicts":
      return "Contradicts generated claim";
    case "context":
      return "Context for generated claim";
  }
}

/** Returns a compact user-facing source location without exposing an actionable path. */
function formatEvidenceLocation(location: KnowledgeReviewEvidenceLocationSummary): string {
  switch (location.kind) {
    case "markdown_lines": {
      const lines =
        location.startLine === location.endLine
          ? `line ${location.startLine}`
          : `lines ${location.startLine}–${location.endLine}`;
      return location.heading
        ? `${location.heading}${location.headingTruncated ? "…" : ""} · ${lines}`
        : lines;
    }
    case "heading":
      return `${location.heading}${location.headingTruncated ? "…" : ""} · occurrence ${location.occurrence}`;
    case "pdf_page":
      return `PDF page ${location.page}`;
    case "quote":
      return "Exact quote";
  }
}

/** Renders one immutable evidence excerpt using plain React text only. */
function EvidenceExcerpt({
  evidence,
  index,
  busy,
  openingEvidenceRef,
  onOpenEvidence,
}: {
  evidence: Readonly<KnowledgeReviewEvidenceSummary>;
  index: number;
  busy: boolean;
  openingEvidenceRef?: string;
  onOpenEvidence?(this: void, evidenceRef: string): void | Promise<void>;
}): React.ReactElement {
  const opening = openingEvidenceRef === evidence.evidenceRef;

  return (
    <article
      aria-busy={opening}
      className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3"
    >
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
          <Badge variant="secondary">Evidence {index + 1}</Badge>
          <span className="tw-text-xs tw-font-medium">
            {formatEvidenceRelation(evidence.relation)}
          </span>
          <span className="tw-text-xs tw-text-muted">
            {formatEvidenceLocation(evidence.location)}
          </span>
        </div>
        {onOpenEvidence ? (
          <Button
            className="tw-shrink-0"
            disabled={busy || opening}
            size="sm"
            type="button"
            variant="secondary"
            aria-label={`Open exact source location ${index + 1}`}
            onClick={() => void onOpenEvidence(evidence.evidenceRef)}
          >
            {opening ? (
              <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
            ) : (
              <ExternalLink aria-hidden="true" className="tw-size-3" />
            )}
            <span role={opening ? "status" : undefined}>
              {opening ? "Opening…" : "Open exact source location"}
            </span>
          </Button>
        ) : null}
      </div>
      <p className="tw-m-0 tw-mt-2 tw-whitespace-pre-wrap tw-break-words tw-text-sm">
        {evidence.excerpt}
      </p>
      {evidence.truncated ? (
        <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted">Excerpt shortened for review.</p>
      ) : null}
    </article>
  );
}

/**
 * Renders bounded proposal evidence without claiming block-level proof.
 *
 * Evidence controls emit only the current opaque evidence reference. The
 * controller owns snapshot binding and source navigation authority.
 */
export function KnowledgeReviewEvidencePanel({
  headingId,
  evidence,
  omittedEvidenceCount,
  busy,
  openingEvidenceRef,
  evidenceError,
  onOpenEvidence,
}: KnowledgeReviewEvidencePanelProps): React.ReactElement {
  return (
    <aside
      aria-labelledby={headingId}
      className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-4"
    >
      <h3 className="tw-m-0 tw-text-sm tw-font-semibold" id={headingId}>
        Source evidence for this proposal
      </h3>
      <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
        These excerpts are linked to the proposal as a whole. They help you check its basis, but do
        not prove every changed block.
      </p>

      {evidenceError ? (
        <div
          className="tw-mt-3 tw-rounded-lg tw-bg-error tw-p-3 tw-text-xs tw-text-error"
          role="alert"
        >
          {evidenceError}
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="tw-mt-3 tw-space-y-3">
          {evidence.map((item, index) => (
            <EvidenceExcerpt
              key={item.evidenceRef}
              busy={busy}
              evidence={item}
              index={index}
              openingEvidenceRef={openingEvidenceRef}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      ) : (
        <p className="tw-m-0 tw-mt-3 tw-rounded-lg tw-bg-primary tw-p-3 tw-text-sm tw-text-muted">
          No source excerpt is available for this proposal. Review the diff and source references
          before deciding.
        </p>
      )}

      {omittedEvidenceCount > 0 ? (
        <p className="tw-m-0 tw-mt-3 tw-text-xs tw-text-muted" role="note">
          {omittedEvidenceCount} additional evidence {omittedEvidenceCount === 1 ? "item" : "items"}{" "}
          omitted from this bounded preview.
        </p>
      ) : null}
    </aside>
  );
}
