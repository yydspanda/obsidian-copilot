import { ExternalLink, Loader2 } from "lucide-react";
import { App, Modal } from "obsidian";
import React, { useEffect, useId, useRef, useState } from "react";
import type { Root } from "react-dom/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KnowledgeKnownAppliedWikiOutputsView } from "@/components/knowledge/KnowledgeKnownAppliedWikiOutputsView";
import type {
  KnowledgeAppliedWikiEvidenceOpenResult,
  KnowledgeAppliedWikiPageInspectionRequest,
  KnowledgeAppliedWikiPageInspectionSession,
  KnowledgeAppliedWikiPageInspectorPort,
  KnowledgeAppliedWikiSourceSummary,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import {
  getKnowledgeAppliedWikiPageInspectorErrorCode,
  snapshotKnowledgeAppliedWikiPageInspectionRequest,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type { KnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";
import type {
  KnowledgeReviewEvidenceLocationSummary,
  KnowledgeReviewEvidenceSummary,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

/** Props for the read-only applied-Wiki inspector surface. */
export interface KnowledgeAppliedWikiInspectorContentProps {
  readonly request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>;
  readonly inspector: KnowledgeAppliedWikiPageInspectorPort;
  readonly knownOutputs?: KnowledgeKnownAppliedWikiOutputsPort;
  readonly onClose: () => void;
}

/** Returns a stable user-facing classification for an inspection failure. */
function formatInspectionError(error: unknown): string {
  const code = getKnowledgeAppliedWikiPageInspectorErrorCode(error);
  if (code) {
    switch (code) {
      case "not_applied":
        return "This file is no longer a current applied Knowledge page.";
      case "drifted":
        return "This page has changed since Knowledge applied it. The inspector will not treat the current file as the applied version.";
      case "invalid_request":
      case "unavailable":
        return "The current applied page could not be inspected.";
    }
  }
  return "The current applied page could not be inspected.";
}

/** Returns stable user-facing text for a value-free evidence-open result. */
function formatEvidenceResult(
  result: Readonly<KnowledgeAppliedWikiEvidenceOpenResult>
): string | undefined {
  switch (result.kind) {
    case "opened":
      return undefined;
    case "stale":
      return "This evidence reference is no longer current. Close and reopen the inspector.";
    case "unsupported":
      return "This source location cannot be opened in the current environment.";
    case "unavailable":
      return "The exact source location could not be reopened.";
  }
}

/** Returns a deterministic label for generated-page ownership. */
function formatOwnership(
  ownership: Readonly<KnowledgeAppliedWikiPageInspectionSession>["ownership"]
): string {
  switch (ownership) {
    case "generated":
      return "Knowledge-managed page";
    case "shared":
      return "Shared page";
    case "user":
      return "User-owned page";
  }
}

/** Returns a deterministic label for source custody. */
function formatCustody(custody: Readonly<KnowledgeAppliedWikiSourceSummary>["custody"]): string {
  return custody === "managed_copy" ? "Managed copy" : "User-managed source";
}

/** Converts an accepted timestamp into deterministic inspectable UI text. */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toISOString();
}

/** Returns a compact display-only source location. */
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

/** Returns a deterministic citation-relation label. */
function formatRelation(relation: KnowledgeReviewEvidenceSummary["relation"]): string {
  switch (relation) {
    case "supports":
      return "Supports generated claim";
    case "contradicts":
      return "Contradicts generated claim";
    case "context":
      return "Context for generated claim";
  }
}

/** Reports whether a failure is intentional cancellation. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

interface EvidenceRowProps {
  readonly evidence: Readonly<KnowledgeReviewEvidenceSummary>;
  readonly index: number;
  readonly openingEvidenceRef?: string;
  readonly onOpen: (evidenceRef: string) => void;
}

type InspectionViewState = Readonly<{
  inspector: KnowledgeAppliedWikiPageInspectorPort;
  pagePath: string;
}> &
  (
    | Readonly<{
        kind: "loaded";
        session: Readonly<KnowledgeAppliedWikiPageInspectionSession>;
      }>
    | Readonly<{ kind: "error"; message: string }>
  );

/** Evidence navigation state bound to one exact opaque inspection session. */
interface EvidenceViewState {
  readonly session: Readonly<KnowledgeAppliedWikiPageInspectionSession>;
  readonly openingEvidenceRef?: string;
  readonly error?: string;
}

/** Renders one bounded proposal-level evidence row. */
function EvidenceRow({
  evidence,
  index,
  openingEvidenceRef,
  onOpen,
}: EvidenceRowProps): React.ReactElement {
  const opening = openingEvidenceRef === evidence.evidenceRef;
  return (
    <article
      aria-busy={opening || undefined}
      className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3"
    >
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
          <Badge variant="secondary">Evidence {index + 1}</Badge>
          <span className="tw-text-xs tw-font-medium">{formatRelation(evidence.relation)}</span>
          <span className="tw-text-xs tw-text-muted">
            {formatEvidenceLocation(evidence.location)}
          </span>
        </div>
        <Button
          aria-label={`Open exact source location ${index + 1}`}
          className="tw-shrink-0"
          disabled={opening}
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => onOpen(evidence.evidenceRef)}
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
 * Renders a read-only current-applied page inspection session.
 *
 * Loading and evidence-opening generations are abortable and last-wins. The
 * evidence callback receives only a projector-issued opaque reference.
 */
export function KnowledgeAppliedWikiInspectorContent({
  request,
  inspector,
  knownOutputs,
  onClose,
}: KnowledgeAppliedWikiInspectorContentProps): React.ReactElement {
  const pagePath = request.pagePath;
  const [view, setView] = useState<"overview" | "known_outputs">("overview");
  const [inspectionState, setInspectionState] = useState<InspectionViewState>();
  const [evidenceState, setEvidenceState] = useState<EvidenceViewState>();
  const inspectGeneration = useRef(0);
  const inspectAbort = useRef<AbortController>();
  const evidenceGeneration = useRef(0);
  const evidenceAbort = useRef<AbortController>();
  const knownOutputsButtonRef = useRef<HTMLButtonElement>(null);
  const headingIdPrefix = useId();
  const versionHeadingId = `${headingIdPrefix}-version`;
  const sourcesHeadingId = `${headingIdPrefix}-sources`;
  const currentInspection =
    inspectionState?.inspector === inspector && inspectionState.pagePath === pagePath
      ? inspectionState
      : undefined;
  const loading = currentInspection === undefined;
  const session = currentInspection?.kind === "loaded" ? currentInspection.session : undefined;
  const inspectionError =
    currentInspection?.kind === "error" ? currentInspection.message : undefined;
  const currentEvidence =
    session !== undefined && evidenceState?.session === session ? evidenceState : undefined;
  const openingEvidenceRef = currentEvidence?.openingEvidenceRef;
  const evidenceError = currentEvidence?.error;

  useEffect(() => {
    if (view === "overview") knownOutputsButtonRef.current?.focus();
  }, [view]);

  useEffect(() => {
    const generation = inspectGeneration.current + 1;
    inspectGeneration.current = generation;
    inspectAbort.current?.abort();
    evidenceGeneration.current += 1;
    evidenceAbort.current?.abort();
    evidenceAbort.current = undefined;
    const abort = new AbortController();
    inspectAbort.current = abort;

    void inspector
      .inspectPage(Object.freeze({ pagePath }), abort.signal)
      .then((nextSession) => {
        if (abort.signal.aborted || generation !== inspectGeneration.current) return;
        setInspectionState(
          Object.freeze({ inspector, pagePath, kind: "loaded", session: nextSession })
        );
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation !== inspectGeneration.current) return;
        setInspectionState(
          Object.freeze({
            inspector,
            pagePath,
            kind: "error",
            message: formatInspectionError(error),
          })
        );
      });

    return () => {
      abort.abort();
      if (inspectAbort.current === abort) inspectAbort.current = undefined;
    };
  }, [inspector, pagePath]);

  useEffect(
    () => () => {
      inspectGeneration.current += 1;
      evidenceGeneration.current += 1;
      inspectAbort.current?.abort();
      evidenceAbort.current?.abort();
    },
    []
  );

  /** Opens one current opaque evidence reference with last-request-wins semantics. */
  const openEvidence = (evidenceRef: string): void => {
    if (!session || loading) return;
    const known = session.sources.some((source) =>
      source.evidence.some((evidence) => evidence.evidenceRef === evidenceRef)
    );
    if (!known) return;

    const generation = evidenceGeneration.current + 1;
    evidenceGeneration.current = generation;
    evidenceAbort.current?.abort();
    const abort = new AbortController();
    evidenceAbort.current = abort;
    setEvidenceState(Object.freeze({ session, openingEvidenceRef: evidenceRef }));

    void inspector
      .openEvidence(session, evidenceRef, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || generation !== evidenceGeneration.current) return;
        const error = formatEvidenceResult(result);
        setEvidenceState(Object.freeze({ session, ...(error === undefined ? {} : { error }) }));
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation !== evidenceGeneration.current) return;
        setEvidenceState(
          Object.freeze({
            session,
            ...(isAbortError(error)
              ? {}
              : { error: "The exact source location could not be reopened." }),
          })
        );
      });
  };

  if (view === "known_outputs" && knownOutputs) {
    return (
      <div className="tw-flex tw-max-h-[75vh] tw-flex-col tw-gap-4 tw-overflow-y-auto">
        <KnowledgeKnownAppliedWikiOutputsView
          history={knownOutputs}
          request={Object.freeze({ pagePath })}
          onBack={() => setView("overview")}
        />
        <div className="tw-flex tw-justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy={loading || openingEvidenceRef !== undefined || undefined}
      className="tw-flex tw-max-h-[75vh] tw-flex-col tw-gap-4 tw-overflow-y-auto"
    >
      <header>
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Applied Knowledge page</h2>
        <p className="tw-m-0 tw-mt-1 tw-break-words tw-text-sm tw-text-muted">
          {session?.displayPagePath ?? pagePath}
        </p>
      </header>

      {loading ? (
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm" role="status">
          <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
          Checking the current applied version…
        </div>
      ) : null}

      {inspectionError ? (
        <div className="tw-rounded-lg tw-bg-error tw-p-3 tw-text-sm tw-text-error" role="alert">
          {inspectionError}
        </div>
      ) : null}

      {session ? (
        <>
          <section
            aria-labelledby={versionHeadingId}
            className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-4"
          >
            <h3 className="tw-m-0 tw-text-sm tw-font-semibold" id={versionHeadingId}>
              Current applied version
            </h3>
            <div className="tw-mt-2 tw-text-sm">
              <Badge variant="secondary">{formatOwnership(session.ownership)}</Badge>
            </div>
            <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted">
              This inspector shows the exact page version currently proven as applied. It does not
              write, restore, or revise the Wiki.
            </p>
          </section>

          <section aria-labelledby={sourcesHeadingId}>
            <h3 className="tw-m-0 tw-text-sm tw-font-semibold" id={sourcesHeadingId}>
              Contributing Sources
            </h3>
            <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
              Evidence below was attached to each accepted proposal as a whole. It can help you
              inspect the basis, but does not prove every sentence or changed block in this page.
            </p>

            {evidenceError ? (
              <div
                className="tw-mt-3 tw-rounded-lg tw-bg-error tw-p-3 tw-text-xs tw-text-error"
                role="alert"
              >
                {evidenceError}
              </div>
            ) : null}

            <div className="tw-mt-3 tw-space-y-3">
              {session.sources.map((source, sourceIndex) => {
                const acceptedAt = formatTimestamp(source.acceptedAt);
                return (
                  <article
                    className="tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
                    key={source.sourceRef}
                  >
                    <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
                      <h4 className="tw-m-0 tw-break-words tw-text-sm tw-font-semibold">
                        {source.displaySourcePath}
                      </h4>
                      <Badge variant="outline">{formatCustody(source.custody)}</Badge>
                    </div>
                    <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
                      Accepted{" "}
                      <time dateTime={acceptedAt === "Unknown time" ? undefined : acceptedAt}>
                        {acceptedAt}
                      </time>
                    </p>

                    {source.evidence.length > 0 ? (
                      <div className="tw-mt-3 tw-space-y-2">
                        {source.evidence.map((evidence, evidenceIndex) => (
                          <EvidenceRow
                            evidence={evidence}
                            index={evidenceIndex}
                            key={evidence.evidenceRef}
                            openingEvidenceRef={openingEvidenceRef}
                            onOpen={openEvidence}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="tw-m-0 tw-mt-3 tw-rounded-lg tw-bg-primary tw-p-3 tw-text-sm tw-text-muted">
                        No proposal evidence excerpt is available for this Source.
                      </p>
                    )}

                    {source.omittedEvidenceCount > 0 ? (
                      <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted" role="note">
                        {source.omittedEvidenceCount} additional evidence{" "}
                        {source.omittedEvidenceCount === 1 ? "item" : "items"} omitted from this
                        bounded preview.
                      </p>
                    ) : null}
                    <span className="tw-sr-only">Source {sourceIndex + 1}</span>
                  </article>
                );
              })}
            </div>

            {session.omittedSourceCount > 0 ? (
              <p className="tw-m-0 tw-mt-3 tw-text-xs tw-text-muted" role="note">
                {session.omittedSourceCount} additional contributing{" "}
                {session.omittedSourceCount === 1 ? "Source" : "Sources"} omitted from this bounded
                inspection.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        {knownOutputs ? (
          <Button
            ref={knownOutputsButtonRef}
            type="button"
            variant="secondary"
            onClick={() => {
              evidenceGeneration.current += 1;
              evidenceAbort.current?.abort();
              evidenceAbort.current = undefined;
              setEvidenceState(undefined);
              setView("known_outputs");
            }}
          >
            Known applied outputs
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** Obsidian Modal wrapper for one abortable applied-page inspection session. */
export class KnowledgeAppliedWikiInspectorModal extends Modal {
  private root: Root | null = null;
  private closed = false;
  private readonly request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>;
  private readonly inspector: KnowledgeAppliedWikiPageInspectorPort;
  private readonly onClosed?: (modal: KnowledgeAppliedWikiInspectorModal) => void;
  private readonly knownOutputs?: KnowledgeKnownAppliedWikiOutputsPort;

  /** Captures one value-only page request and stable inspector capability. */
  constructor(
    app: App,
    request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    inspector: KnowledgeAppliedWikiPageInspectorPort,
    onClosed?: (modal: KnowledgeAppliedWikiInspectorModal) => void,
    knownOutputs?: KnowledgeKnownAppliedWikiOutputsPort
  ) {
    super(app);
    if (onClosed !== undefined && typeof onClosed !== "function") {
      throw new TypeError("Invalid applied Knowledge page inspector close callback");
    }
    this.request = snapshotKnowledgeAppliedWikiPageInspectionRequest(request);
    this.inspector = inspector;
    this.onClosed = onClosed;
    this.knownOutputs = knownOutputs;
  }

  /** Mounts the inspector into this Modal's owning document through the shared App root. */
  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={this.inspector}
        knownOutputs={this.knownOutputs}
        request={this.request}
        onClose={() => this.close()}
      />
    );
  }

  /** Unmounts React so component cleanup aborts all in-flight inspector work. */
  onClose(): void {
    const root = this.root;
    this.root = null;
    try {
      root?.unmount();
    } finally {
      if (!this.closed) {
        this.closed = true;
        try {
          this.onClosed?.(this);
        } catch {
          // Modal cleanup remains complete even if its lifecycle observer is stale.
        }
      }
    }
  }
}
