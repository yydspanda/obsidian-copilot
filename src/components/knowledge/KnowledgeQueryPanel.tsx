import * as React from "react";
import { ExternalLink, FileSearch, Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  KnowledgeSourceCitationSummary,
  KnowledgeSourceCitationLocationSummary,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type { KnowledgeStudioQueryState } from "@/knowledge/ui/KnowledgeStudioController";

/** Props for the retrieval-only applied-Wiki Query surface. */
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
 * Renders scoped lexical evidence from only hash-verified applied Wiki pages.
 *
 * This first Query slice deliberately performs no model synthesis and exposes
 * no write action. Answer generation and Save to Wiki remain later reviewed
 * capabilities.
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
              Searches only accepted, applied, SHA-256 verified Wiki pages. This checkpoint returns
              grounded excerpts; model synthesis and Save to Wiki are not connected yet.
            </p>
          </div>
          <Badge variant="outline">Grounded retrieval</Badge>
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
          Proving the applied Wiki snapshot and ranking exact excerpts…
        </div>
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
