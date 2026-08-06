import * as React from "react";
import { ExternalLink, FileSearch, Loader2, Search, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  KnowledgeSourceCitationSummary,
  KnowledgeSourceCitationLocationSummary,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type { KnowledgeStudioQueryState } from "@/knowledge/ui/KnowledgeStudioController";

/** Props for the read-only applied-Wiki Query and grounded-answer surface. */
export interface KnowledgeQueryPanelProps {
  state: Readonly<KnowledgeStudioQueryState>;
  onQuery(this: void, query: string): void | Promise<void>;
  onOpenCitation(this: void, citationRef: string): void | Promise<void>;
}

/** Produces a compact human-readable citation location. */
function formatLocation(location: KnowledgeSourceCitationLocationSummary): string {
  switch (location.kind) {
    case "markdown_lines":
      return location.startLine === location.endLine
        ? `line ${location.startLine}`
        : `lines ${location.startLine}–${location.endLine}`;
    case "heading":
      return `${location.heading} #${location.occurrence}`;
    case "pdf_page":
      return `PDF page ${location.page}`;
    case "quote":
      return "exact quote";
  }
}

/** Renders one source-backed opaque citation control. */
function CitationButton({
  citation,
  busy,
  onOpen,
}: {
  citation: Readonly<KnowledgeSourceCitationSummary>;
  busy: boolean;
  onOpen(this: void): void;
}): React.ReactElement {
  const pdfNavigationPending = citation.location.kind === "pdf_page";
  return (
    <Button
      className="tw-h-auto tw-max-w-full tw-gap-1 tw-whitespace-normal tw-px-2 tw-py-1 tw-text-left tw-text-xs"
      disabled={busy || pdfNavigationPending}
      size="sm"
      title={
        pdfNavigationPending
          ? "Exact PDF page navigation is not enabled until its Windows Obsidian contract is verified."
          : `Open ${citation.sourcePath} at ${formatLocation(citation.location)}`
      }
      type="button"
      variant="secondary"
      onClick={onOpen}
    >
      <ExternalLink aria-hidden="true" className="tw-size-3 tw-shrink-0" />
      <span className="tw-truncate">{citation.sourcePath}</span>
      <span className="tw-text-muted">· {formatLocation(citation.location)}</span>
    </Button>
  );
}

/**
 * Renders a strictly validated model answer plus the exact evidence retrieval.
 * Save to Wiki remains a later reviewed capability and no Query control writes.
 */
export function KnowledgeQueryPanel({
  state,
  onQuery,
  onOpenCitation,
}: KnowledgeQueryPanelProps): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const loading = state.status === "loading";
  const result = state.result;

  /** Submits one non-empty bounded query through the controller. */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    void onQuery(trimmed);
  }

  return (
    <div className="tw-space-y-4">
      <section className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4">
        <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
          <div>
            <h2 className="tw-m-0 tw-text-sm tw-font-semibold">Query applied knowledge</h2>
            <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
              Searches only accepted, applied, SHA-256 verified Wiki pages. DeepSeek may synthesize
              an answer only from source excerpts verified for this query; Save to Wiki is not
              connected yet.
            </p>
          </div>
          <Badge variant="outline">
            {result?.mode === "grounded_answer" ? "Grounded answer" : "Grounded retrieval"}
          </Badge>
        </div>

        <form className="tw-mt-3 tw-flex tw-gap-2" onSubmit={submit}>
          <Input
            aria-label="Knowledge query"
            disabled={loading}
            maxLength={1000}
            placeholder="Search your applied knowledge…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button disabled={loading || query.trim().length === 0} type="submit">
            {loading ? (
              <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
            ) : (
              <Search aria-hidden="true" className="tw-size-4" />
            )}
            Search
          </Button>
        </form>
      </section>

      {state.error ? (
        <aside className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-sm tw-text-error" role="alert">
          {state.error}
        </aside>
      ) : null}

      {loading ? (
        <div
          className="tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-bg-secondary-alt tw-p-4 tw-text-sm tw-text-muted"
          role="status"
        >
          <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
          Proving the applied Wiki and source evidence, then generating a grounded answer…
        </div>
      ) : null}

      {state.status === "ready" && result?.mode === "grounded_answer" ? (
        <section
          aria-label="Grounded answer"
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
        >
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <h2 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold">
              <Sparkles aria-hidden="true" className="tw-size-4" />
              Answer
            </h2>
            <Badge variant="secondary">
              {result.answer.status === "answered"
                ? "Supported"
                : result.answer.status === "partial"
                  ? "Partial"
                  : "Insufficient evidence"}
            </Badge>
          </div>

          {result.answer.claims.length > 0 ? (
            <div className="tw-mt-3 tw-space-y-3">
              {result.answer.claims.map((claim) => (
                <article key={claim.claimId} className="tw-rounded-lg tw-bg-secondary-alt tw-p-3">
                  <Badge variant="outline">
                    {claim.kind === "source_fact" ? "Source fact" : "Inference"}
                  </Badge>
                  <p className="tw-m-0 tw-mt-2 tw-whitespace-pre-wrap tw-break-words tw-text-sm">
                    {claim.text}
                  </p>
                  <div
                    aria-label={`Citations for ${claim.claimId}`}
                    className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2"
                  >
                    {claim.citations.map((citation) => (
                      <CitationButton
                        key={citation.citationRef}
                        busy={state.openingCitationRef === citation.citationRef}
                        citation={citation}
                        onOpen={() => void onOpenCitation(citation.citationRef)}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {result.answer.insufficientEvidence.length > 0 ? (
            <div className="tw-mt-3 tw-rounded-lg tw-bg-secondary-alt tw-p-3">
              <p className="tw-m-0 tw-text-xs tw-font-semibold">Evidence still needed</p>
              <ul className="tw-mb-0 tw-mt-2 tw-pl-5 tw-text-sm">
                {result.answer.insufficientEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {state.status === "ready" && result?.hits.length === 0 ? (
        <div
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-6 tw-text-center"
          role="status"
        >
          <FileSearch aria-hidden="true" className="tw-mx-auto tw-size-6 tw-text-muted" />
          <p className="tw-m-0 tw-mt-2 tw-text-sm tw-font-medium">
            No applied Wiki excerpt matched
          </p>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
            Unreviewed, unapplied, or externally changed pages are intentionally excluded.
          </p>
        </div>
      ) : null}

      {result?.hits.length ? (
        <h2 className="tw-m-0 tw-text-sm tw-font-semibold">
          {result.mode === "grounded_answer" ? "Evidence used for retrieval" : "Retrieved evidence"}
        </h2>
      ) : null}

      {result?.hits.map((hit, index) => (
        <article
          key={hit.chunkId}
          className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
        >
          <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
            <div className="tw-min-w-0">
              <h3 className="tw-m-0 tw-truncate tw-text-sm tw-font-semibold">
                {hit.heading || hit.pagePath}
              </h3>
              <p className="tw-m-0 tw-mt-1 tw-truncate tw-text-xs tw-text-muted">
                {hit.pagePath}
                {hit.headingPath.length > 0 ? ` · ${hit.headingPath.join(" › ")}` : ""}
              </p>
            </div>
            <Badge variant="secondary">Match {index + 1}</Badge>
          </div>
          <p className="tw-m-0 tw-mt-3 tw-whitespace-pre-wrap tw-break-words tw-text-sm">
            {hit.snippet}
          </p>
          {hit.citations.length > 0 ? (
            <div aria-label="Source citations" className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
              {hit.citations.map((citation) => (
                <CitationButton
                  key={citation.citationRef}
                  busy={state.openingCitationRef === citation.citationRef}
                  citation={citation}
                  onOpen={() => void onOpenCitation(citation.citationRef)}
                />
              ))}
            </div>
          ) : (
            <p className="tw-m-0 tw-mt-3 tw-text-xs tw-text-muted">
              This excerpt has no currently navigable source citation.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
