import { Loader2 } from "lucide-react";
import React, { useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import type {
  KnowledgeForwardRevisionProposalActionPort,
  KnowledgeForwardRevisionProposalActionResult,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import { isKnowledgeForwardRevisionProposalReviewRef } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import type { KnowledgeAppliedWikiPageInspectionRequest } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import {
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  type KnowledgeKnownAppliedWikiCurrentState,
  type KnowledgeKnownAppliedWikiOutputComparison,
  type KnowledgeKnownAppliedWikiOutputDetail,
  type KnowledgeKnownAppliedWikiOutputRelation,
  type KnowledgeKnownAppliedWikiOutputSummary,
  type KnowledgeKnownAppliedWikiOutputsPage,
  type KnowledgeKnownAppliedWikiOutputsPort,
  type KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

/** Defensive UI bounds independent from the Runtime and coordinator limits. */
export const KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS = Object.freeze({
  maxItemsPerPage: KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.pageSize,
  maxPreviewCharacters: 65_536,
  maxPreviewLines: 2_000,
});

/** Props for the bounded known-output browser. */
export interface KnowledgeKnownAppliedWikiOutputsViewProps {
  readonly request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>;
  readonly history: KnowledgeKnownAppliedWikiOutputsPort;
  readonly proposalAction?: KnowledgeForwardRevisionProposalActionPort;
  readonly onPublished?: (reviewRef: string) => void;
  readonly onBack: () => void;
}

interface PageFrame {
  readonly page: Readonly<KnowledgeKnownAppliedWikiOutputsPage>;
  readonly cursor?: string;
}

type SessionState = Readonly<{
  history: KnowledgeKnownAppliedWikiOutputsPort;
  pagePath: string;
}> &
  (
    | Readonly<{ kind: "loaded"; session: Readonly<KnowledgeKnownAppliedWikiOutputsSession> }>
    | Readonly<{ kind: "error"; message: string }>
  );

type ChildState =
  | Readonly<{ kind: "list" }>
  | Readonly<{
      kind: "loading_detail";
      summary: Readonly<KnowledgeKnownAppliedWikiOutputSummary>;
    }>
  | Readonly<{ kind: "detail"; selection: Readonly<DetailSelection> }>
  | Readonly<{
      kind: "loading_comparison";
      selection: Readonly<DetailSelection>;
    }>
  | Readonly<{
      kind: "comparison";
      selection: Readonly<DetailSelection>;
      comparison: Readonly<KnowledgeKnownAppliedWikiOutputComparison>;
    }>
  | Readonly<{ kind: "read_error"; outputRef: string; message: string }>;

interface DetailSelection {
  readonly summary: Readonly<KnowledgeKnownAppliedWikiOutputSummary>;
  readonly detail: Readonly<KnowledgeKnownAppliedWikiOutputDetail>;
}

type ProposalState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "pending";
      action: KnowledgeForwardRevisionProposalActionPort;
      session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
      outputRef: string;
    }>
  | Readonly<{
      kind: "result";
      action: KnowledgeForwardRevisionProposalActionPort;
      session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
      outputRef: string;
      tone: "success" | "error";
      message: string;
    }>;

interface ProposalFlight {
  readonly action: KnowledgeForwardRevisionProposalActionPort;
  readonly session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
  readonly outputRef: string;
}

/** Counts exact LF-delimited rows up to a strict inclusive limit. */
function hasAtMostLines(value: string, limit: number): boolean {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x0a) {
      lines += 1;
      if (lines > limit) return false;
    }
  }
  return true;
}

/** Reports whether one exact string is safe for a bounded plain-text render. */
export function isKnownAppliedWikiPreviewWithinBudget(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxPreviewCharacters &&
    hasAtMostLines(value, KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxPreviewLines)
  );
}

/** Reports whether one exact pair is safe without invoking a diff algorithm. */
export function isKnownAppliedWikiComparisonWithinBudget(
  knownContent: unknown,
  currentContent: unknown
): knownContent is string {
  return (
    isKnownAppliedWikiPreviewWithinBudget(knownContent) &&
    isKnownAppliedWikiPreviewWithinBudget(currentContent) &&
    knownContent.length + currentContent.length <=
      KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxPreviewCharacters
  );
}

/** Formats an Apply timestamp without using locale-dependent output. */
function formatAppliedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toISOString();
}

/** Formats the exact current-file relationship without implying restoration authority. */
function formatCurrentState(state: KnowledgeKnownAppliedWikiCurrentState): string {
  switch (state) {
    case "applied":
      return "Current applied";
    case "drifted":
      return "Current applied state not verified";
    case "missing":
      return "Current file unavailable";
  }
}

/** Formats one output's display relation without inventing version numbers. */
function formatOutputRelation(relation: KnowledgeKnownAppliedWikiOutputRelation): string {
  switch (relation) {
    case "current_applied":
      return "Current applied output";
    case "latest_known":
      return "Latest known output";
    case "earlier_known":
      return "Earlier known output";
  }
}

/** Maps a closed read result to a stable UI message. */
function formatReadFailure(kind: "stale" | "unavailable" | "too_large"): string {
  switch (kind) {
    case "stale":
      return "This output reference is no longer current. Return to the list and try again.";
    case "unavailable":
      return "This known applied output could not be read.";
    case "too_large":
      return "This exact text is too large for the bounded inline preview.";
  }
}

/** Maps a closed non-published proposal result to one bounded UI message. */
function formatProposalFailure(
  result: Exclude<KnowledgeForwardRevisionProposalActionResult, { kind: "published" }>
): string {
  switch (result.kind) {
    case "stale":
      return "This output reference is no longer current. Return to the list and try again.";
    case "too_large":
      return "This exact output is too large for a bounded proposal.";
    case "unavailable":
      return "A proposal could not be published. Reopen this current applied page and try again.";
    case "not_eligible":
      return result.reason === "current_not_applied"
        ? "The current page is no longer proposal-eligible. Reopen known applied outputs."
        : "This output already matches the current applied file.";
  }
}

/** Reports whether one pending mutation belongs to the exact visible selection. */
function isPendingProposal(
  state: ProposalState,
  action: KnowledgeForwardRevisionProposalActionPort | undefined,
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession> | undefined,
  outputRef: string | undefined
): boolean {
  return (
    state.kind === "pending" &&
    state.action === action &&
    state.session === session &&
    state.outputRef === outputRef
  );
}

/** Reports whether a caught error represents deliberate cancellation. */
const isAbortError = isKnowledgeAbortError;

/** Checks the runtime container shape without widening its declared element type. */
function isArrayContainer(value: unknown): boolean {
  return Array.isArray(value);
}

/** Validates the bounded first page before it becomes renderable state. */
function isSafeInitialSession(session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>): boolean {
  const items = session.items;
  if (
    !isArrayContainer(items) ||
    items.length > KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage ||
    !Number.isSafeInteger(session.knownOutputCount) ||
    session.knownOutputCount < 0 ||
    session.knownOutputCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxKnownOutputs ||
    items.length !==
      Math.min(session.knownOutputCount, KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage)
  ) {
    return false;
  }

  const refs = new Set(items.map((item) => item.outputRef));
  const stateMatchIsValid =
    (session.currentState === "applied" && session.currentMatch === "current_applied") ||
    (session.currentState === "drifted" && session.currentMatch !== "current_applied") ||
    (session.currentState === "missing" && session.currentMatch === "none");
  const relationsAreValid = items.every((item, index) => {
    if (index === 0) {
      return (
        item.relation === (session.currentState === "applied" ? "current_applied" : "latest_known")
      );
    }
    return item.relation === "earlier_known";
  });

  return (
    stateMatchIsValid &&
    relationsAreValid &&
    refs.size === items.length &&
    (session.knownOutputCount === 0) === (items.length === 0) &&
    (session.currentState !== "applied" || session.knownOutputCount > 0) &&
    (session.currentMatch !== "earlier_known" || session.knownOutputCount > 0) &&
    session.knownOutputCount > items.length === (session.nextCursor !== undefined)
  );
}

/**
 * Rejects malformed or cycling metadata pages before adding them to rendered state.
 *
 * Production delegates already authenticate these invariants. This second bound
 * prevents an accidentally weakened adapter from growing an unbounded UI stack.
 */
function isSafeNextPage(
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
  pages: readonly PageFrame[],
  requestedCursor: string,
  page: Readonly<KnowledgeKnownAppliedWikiOutputsPage>
): boolean {
  const disclosedCount = pages.reduce((total, frame) => total + frame.page.items.length, 0);
  const remaining = session.knownOutputCount - disclosedCount;
  const items = page.items;
  const expectedCount = Math.min(remaining, KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage);
  if (
    remaining <= 0 ||
    pages.length >=
      Math.ceil(session.knownOutputCount / KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage) ||
    !isArrayContainer(items) ||
    items.length !== expectedCount ||
    pages.some((frame) => frame.cursor === requestedCursor) ||
    page.nextCursor === requestedCursor ||
    pages.some((frame) => frame.cursor !== undefined && frame.cursor === page.nextCursor)
  ) {
    return false;
  }

  const existingRefs = new Set(
    pages.flatMap((frame) => frame.page.items.map((item) => item.outputRef))
  );
  const nextRefs = new Set(items.map((item) => item.outputRef));
  if (nextRefs.size !== items.length || items.some((item) => existingRefs.has(item.outputRef))) {
    return false;
  }

  const nextDisclosedCount = existingRefs.size + nextRefs.size;
  return (
    nextDisclosedCount <= session.knownOutputCount &&
    nextDisclosedCount < session.knownOutputCount === (page.nextCursor !== undefined)
  );
}

/** Renders exact plain text without parsing Markdown or HTML. */
function ExactPlainText({ children }: { readonly children: string }): React.ReactElement {
  return (
    <pre className="tw-m-0 tw-max-h-80 tw-overflow-auto tw-whitespace-pre-wrap tw-break-words tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-font-mono tw-text-xs">
      {children}
    </pre>
  );
}

/** Renders one defensive, paginated known-output browsing session. */
export function KnowledgeKnownAppliedWikiOutputsView({
  request,
  history,
  proposalAction,
  onPublished,
  onBack,
}: KnowledgeKnownAppliedWikiOutputsViewProps): React.ReactElement {
  const [sessionState, setSessionState] = useState<SessionState>();
  const [pages, setPages] = useState<readonly PageFrame[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [childState, setChildState] = useState<ChildState>({ kind: "list" });
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [proposalState, setProposalState] = useState<ProposalState>({ kind: "idle" });
  const generation = useRef(0);
  const abortRef = useRef<AbortController>();
  const proposalGeneration = useRef(0);
  const proposalAbortRef = useRef<AbortController>();
  const proposalInFlightRef = useRef<Readonly<ProposalFlight>>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const childHeadingRef = useRef<HTMLHeadingElement>(null);
  const idPrefix = useId();
  const noticeId = `${idPrefix}-notice`;
  const currentSessionState =
    sessionState?.history === history && sessionState.pagePath === request.pagePath
      ? sessionState
      : undefined;
  const session = currentSessionState?.kind === "loaded" ? currentSessionState.session : undefined;
  const visibleChildState = session ? childState : ({ kind: "list" } as const);
  const frame = pages[pageIndex];

  useEffect(() => {
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    abortRef.current?.abort();
    proposalGeneration.current += 1;
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = undefined;
    const abort = new AbortController();
    abortRef.current = abort;
    void history
      .inspectKnownOutputs(Object.freeze({ pagePath: request.pagePath }), abort.signal)
      .then((nextSession) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (!isSafeInitialSession(nextSession)) {
          setSessionState({
            history,
            pagePath: request.pagePath,
            kind: "error",
            message: "Known applied outputs could not be verified.",
          });
          setPages([]);
          return;
        }
        setSessionState({
          history,
          pagePath: request.pagePath,
          kind: "loaded",
          session: nextSession,
        });
        setPages([
          {
            page: Object.freeze({
              items: nextSession.items,
              ...(nextSession.nextCursor === undefined
                ? {}
                : { nextCursor: nextSession.nextCursor }),
            }),
          },
        ]);
        setPageIndex(0);
        setChildState({ kind: "list" });
        setPageLoading(false);
        setPageError(undefined);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (!isAbortError(error)) {
          setSessionState({
            history,
            pagePath: request.pagePath,
            kind: "error",
            message: "Known applied outputs could not be inspected.",
          });
        }
      });

    return () => abort.abort();
  }, [history, request.pagePath]);

  useEffect(
    () => () => {
      generation.current += 1;
      abortRef.current?.abort();
      proposalGeneration.current += 1;
      proposalAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    proposalGeneration.current += 1;
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = undefined;
  }, [proposalAction]);

  useEffect(() => {
    if (visibleChildState.kind === "list") headingRef.current?.focus();
    else if (
      visibleChildState.kind === "detail" ||
      visibleChildState.kind === "comparison" ||
      visibleChildState.kind === "read_error"
    ) {
      childHeadingRef.current?.focus();
    }
  }, [visibleChildState.kind]);

  /** Replaces the visible list with the next opaque page. */
  const openNextPage = (): void => {
    if (pageIndex + 1 < pages.length) {
      setPageIndex((current) => current + 1);
      setPageError(undefined);
      return;
    }
    const cursor = frame?.page.nextCursor;
    if (!session || !cursor || pageLoading) return;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setPageLoading(true);
    setPageError(undefined);
    void history
      .listMore(session, cursor, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        setPageLoading(false);
        if (result.kind === "loaded" && isSafeNextPage(session, pages, cursor, result.value)) {
          setPages((current) => [...current, { cursor, page: result.value }]);
          setPageIndex((current) => current + 1);
          return;
        }
        setPages([]);
        setChildState({ kind: "list" });
        setSessionState({
          history,
          pagePath: request.pagePath,
          kind: "error",
          message:
            result.kind === "stale"
              ? "This browsing session is no longer current. Return and reopen known applied outputs."
              : "The next bounded page could not be verified.",
        });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        setPageLoading(false);
        if (!isAbortError(error)) setPageError("The next bounded page could not be loaded.");
      });
  };

  /** Returns to the preceding already-verified page without another read. */
  const openPreviousPage = (): void => {
    if (pageIndex <= 0 || pageLoading) return;
    abortRef.current?.abort();
    generation.current += 1;
    setPageIndex((current) => current - 1);
    setPageError(undefined);
  };

  /** Loads a bounded exact output selected from the visible page. */
  const openDetail = (outputRef: string): void => {
    const summary = frame?.page.items.find((item) => item.outputRef === outputRef);
    if (!session || pageLoading || !summary) return;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setProposalState({ kind: "idle" });
    setChildState({ kind: "loading_detail", summary });
    void history
      .readOutput(session, outputRef, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (result.kind === "loaded") {
          if (
            result.value.outputRef !== outputRef ||
            result.value.appliedAt !== summary.appliedAt ||
            result.value.verifiedApplyCount !== summary.verifiedApplyCount
          ) {
            setChildState({
              kind: "read_error",
              outputRef,
              message: "This known applied output could not be verified.",
            });
          } else if (!isKnownAppliedWikiPreviewWithinBudget(result.value.content)) {
            setChildState({
              kind: "read_error",
              outputRef,
              message: formatReadFailure("too_large"),
            });
          } else {
            setChildState({
              kind: "detail",
              selection: Object.freeze({ summary, detail: result.value }),
            });
          }
          return;
        }
        setChildState({ kind: "read_error", outputRef, message: formatReadFailure(result.kind) });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (!isAbortError(error)) {
          setChildState({
            kind: "read_error",
            outputRef,
            message: "This known applied output could not be read.",
          });
        }
      });
  };

  /** Loads a bounded exact current-file comparison for the selected output. */
  const openComparison = (selection: Readonly<DetailSelection>): void => {
    if (
      !session ||
      session.currentState === "missing" ||
      isPendingProposal(proposalState, proposalAction, session, selection.detail.outputRef)
    ) {
      return;
    }
    const currentFlight = proposalInFlightRef.current;
    if (
      currentFlight !== undefined &&
      currentFlight.action === proposalAction &&
      currentFlight.session === session &&
      currentFlight.outputRef === selection.detail.outputRef
    ) {
      return;
    }
    const { detail } = selection;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setChildState({ kind: "loading_comparison", selection });
    void history
      .compareWithCurrent(session, detail.outputRef, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (result.kind === "loaded") {
          if (
            result.value.outputRef !== detail.outputRef ||
            result.value.knownContent !== detail.content ||
            result.value.currentState !== session.currentState
          ) {
            setChildState({
              kind: "read_error",
              outputRef: detail.outputRef,
              message: "The current file comparison could not be verified.",
            });
          } else if (
            !isKnownAppliedWikiComparisonWithinBudget(
              result.value.knownContent,
              result.value.currentContent
            )
          ) {
            setChildState({
              kind: "read_error",
              outputRef: detail.outputRef,
              message: formatReadFailure("too_large"),
            });
          } else {
            setChildState({ kind: "comparison", selection, comparison: result.value });
          }
          return;
        }
        setChildState({
          kind: "read_error",
          outputRef: detail.outputRef,
          message: formatReadFailure(result.kind),
        });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation.current !== nextGeneration) return;
        if (!isAbortError(error)) {
          setChildState({
            kind: "read_error",
            outputRef: detail.outputRef,
            message: "The current file comparison could not be read.",
          });
        }
      });
  };

  /** Cancels a child read and returns to the current bounded list page. */
  const returnToList = (): void => {
    abortRef.current?.abort();
    proposalGeneration.current += 1;
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = undefined;
    generation.current += 1;
    setProposalState({ kind: "idle" });
    setChildState({ kind: "list" });
  };

  /** Cancels every local generation before returning to the parent inspector. */
  const returnToInspector = (): void => {
    generation.current += 1;
    abortRef.current?.abort();
    proposalGeneration.current += 1;
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = undefined;
    onBack();
  };

  /** Publishes one opaque eligible selection without passing its rendered body. */
  const proposeOutput = (selection: Readonly<DetailSelection>): void => {
    if (
      !session ||
      !proposalAction ||
      session.currentState !== "applied" ||
      selection.summary.relation !== "earlier_known" ||
      selection.summary.outputRef !== selection.detail.outputRef ||
      isPendingProposal(proposalState, proposalAction, session, selection.detail.outputRef)
    ) {
      return;
    }
    const currentFlight = proposalInFlightRef.current;
    if (
      currentFlight !== undefined &&
      currentFlight.action === proposalAction &&
      currentFlight.session === session &&
      currentFlight.outputRef === selection.detail.outputRef
    ) {
      return;
    }
    const nextGeneration = proposalGeneration.current + 1;
    proposalGeneration.current = nextGeneration;
    proposalAbortRef.current?.abort();
    const abort = new AbortController();
    proposalAbortRef.current = abort;
    const outputRef = selection.detail.outputRef;
    const action = proposalAction;
    const proposalSession = session;
    const flight = Object.freeze({ action, session: proposalSession, outputRef });
    proposalInFlightRef.current = flight;
    setProposalState({ kind: "pending", action, session: proposalSession, outputRef });
    void action
      .proposeKnownOutput(proposalSession, outputRef, abort.signal)
      .then((result) => {
        if (
          result.kind === "published" &&
          isKnowledgeForwardRevisionProposalReviewRef(result.reviewRef)
        ) {
          if (!abort.signal.aborted && proposalGeneration.current === nextGeneration) {
            setProposalState({
              kind: "result",
              action,
              session: proposalSession,
              outputRef,
              tone: "success",
              message: "Proposal published. Open Studio Review to inspect and decide it.",
            });
            try {
              onPublished?.(result.reviewRef);
            } catch {
              // Durable publication remains successful when current presentation navigation fails.
            }
          }
          return;
        }
        if (abort.signal.aborted || proposalGeneration.current !== nextGeneration) return;
        if (result.kind === "published") {
          setProposalState({
            kind: "result",
            action,
            session: proposalSession,
            outputRef,
            tone: "error",
            message:
              "A proposal was published but its Studio Review reference could not be verified.",
          });
          return;
        }
        setProposalState({
          kind: "result",
          action,
          session: proposalSession,
          outputRef,
          tone: "error",
          message: formatProposalFailure(result),
        });
      })
      .catch((error: unknown) => {
        if (
          abort.signal.aborted ||
          proposalGeneration.current !== nextGeneration ||
          isAbortError(error)
        ) {
          return;
        }
        setProposalState({
          kind: "result",
          action,
          session: proposalSession,
          outputRef,
          tone: "error",
          message:
            "A proposal could not be published. Reopen this current applied page and try again.",
        });
      })
      .finally(() => {
        if (proposalInFlightRef.current === flight) proposalInFlightRef.current = undefined;
      });
  };

  if (visibleChildState.kind !== "list") {
    const selection =
      visibleChildState.kind === "detail" ||
      visibleChildState.kind === "loading_comparison" ||
      visibleChildState.kind === "comparison"
        ? visibleChildState.selection
        : undefined;
    const detail = selection?.detail;
    const visibleProposalState =
      detail &&
      proposalState.kind !== "idle" &&
      proposalState.action === proposalAction &&
      proposalState.session === session &&
      proposalState.outputRef === detail.outputRef
        ? proposalState
        : ({ kind: "idle" } as const);
    const proposalPending = visibleProposalState.kind === "pending";
    const proposalEligible =
      proposalAction !== undefined &&
      session?.currentState === "applied" &&
      selection?.summary.relation === "earlier_known";
    return (
      <section
        aria-busy={visibleChildState.kind.startsWith("loading_") || proposalPending || undefined}
      >
        <div className="tw-mb-3 tw-flex tw-items-center tw-justify-between tw-gap-2">
          <Button type="button" variant="ghost" onClick={returnToList}>
            Back to known outputs
          </Button>
        </div>
        <h3 className="tw-m-0 tw-text-base tw-font-semibold" ref={childHeadingRef} tabIndex={-1}>
          {visibleChildState.kind === "comparison" ||
          visibleChildState.kind === "loading_comparison"
            ? "Compare with current file"
            : "Known applied output"}
        </h3>

        {visibleChildState.kind === "loading_detail" ||
        visibleChildState.kind === "loading_comparison" ? (
          <div className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm" role="status">
            <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
            Loading bounded exact text…
          </div>
        ) : null}

        {visibleChildState.kind === "read_error" ? (
          <div
            className="tw-mt-3 tw-rounded-lg tw-bg-error tw-p-3 tw-text-sm tw-text-error"
            role="alert"
          >
            {visibleChildState.message}
          </div>
        ) : null}

        {visibleChildState.kind === "detail" && detail ? (
          <div className="tw-mt-3 tw-space-y-3">
            <p className="tw-m-0 tw-text-xs tw-text-muted">
              Applied {formatAppliedAt(detail.appliedAt)} · {detail.verifiedApplyCount} verified
              Apply
              {detail.verifiedApplyCount === 1 ? " record" : " records"}
            </p>
            <ExactPlainText>{detail.content}</ExactPlainText>
            {session?.currentState === "missing" ? (
              <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
                The current file is missing. This exact known output remains available to inspect,
                but there is no current file to compare.
              </p>
            ) : (
              <Button
                disabled={proposalPending}
                type="button"
                variant="secondary"
                onClick={() => selection && openComparison(selection)}
              >
                Compare with current file
              </Button>
            )}
            {proposalEligible && selection ? (
              <div className="tw-space-y-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3">
                <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
                  This creates a pending Studio Review proposal. It does not change the current
                  file.
                </p>
                <Button
                  disabled={proposalPending}
                  type="button"
                  onClick={() => proposeOutput(selection)}
                >
                  {proposalPending ? (
                    <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
                  ) : null}
                  {proposalPending ? "Proposing…" : "Propose this output"}
                </Button>
                {visibleProposalState.kind === "result" ? (
                  <p
                    className={
                      visibleProposalState.tone === "success"
                        ? "tw-m-0 tw-text-xs tw-text-muted"
                        : "tw-m-0 tw-text-xs tw-text-error"
                    }
                    role={visibleProposalState.tone === "success" ? "status" : "alert"}
                  >
                    {visibleProposalState.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleChildState.kind === "comparison" && detail ? (
          <div className="tw-mt-3 tw-space-y-3">
            <Badge
              variant={
                visibleChildState.comparison.currentState === "applied" ? "secondary" : "outline"
              }
            >
              {formatCurrentState(visibleChildState.comparison.currentState)}
            </Badge>
            <p className="tw-m-0 tw-text-xs tw-text-muted">
              Exact text is shown side by side. Line endings and spaces are preserved; no semantic
              or word-level diff is performed.
            </p>
            <div className="tw-grid tw-grid-cols-1 tw-gap-3 lg:tw-grid-cols-2">
              <section aria-label="Known applied output text">
                <h4 className="tw-m-0 tw-mb-1 tw-text-xs tw-font-medium">Known applied output</h4>
                <ExactPlainText>{visibleChildState.comparison.knownContent}</ExactPlainText>
              </section>
              <section aria-label="Current file text">
                <h4 className="tw-m-0 tw-mb-1 tw-text-xs tw-font-medium">Current file</h4>
                <ExactPlainText>{visibleChildState.comparison.currentContent}</ExactPlainText>
              </section>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-busy={currentSessionState === undefined || pageLoading || undefined}>
      <Button className="tw-mb-3" type="button" variant="ghost" onClick={returnToInspector}>
        Back to current page
      </Button>
      <h3 className="tw-m-0 tw-text-base tw-font-semibold" ref={headingRef} tabIndex={-1}>
        Known applied outputs
      </h3>
      <p className="tw-m-0 tw-mt-1 tw-break-words tw-text-xs tw-text-muted">
        {session?.displayPagePath ?? request.pagePath}
      </p>
      <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted" id={noticeId} role="note">
        This is a bounded record of outputs verified through Knowledge Apply. It is not complete
        file history, File Recovery, or a backup, and it cannot restore or overwrite the current
        file.
      </p>

      {currentSessionState === undefined ? (
        <div className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm" role="status">
          <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />
          Loading known applied outputs…
        </div>
      ) : null}
      {currentSessionState?.kind === "error" ? (
        <div
          className="tw-mt-3 tw-rounded-lg tw-bg-error tw-p-3 tw-text-sm tw-text-error"
          role="alert"
        >
          {currentSessionState.message}
        </div>
      ) : null}

      {session && frame ? (
        <>
          <div className="tw-mt-3">
            <Badge variant={session.currentState === "applied" ? "secondary" : "outline"}>
              {formatCurrentState(session.currentState)}
            </Badge>
            <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted">
              {session.knownOutputCount} known applied output
              {session.knownOutputCount === 1 ? "" : "s"} verified from Apply records.
            </p>
            {session.currentState === "drifted" && session.currentMatch === "earlier_known" ? (
              <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted" role="note">
                The current file matches a known applied output, but not the current applied
                version.
              </p>
            ) : null}
          </div>
          {frame.page.items.length > 0 ? (
            <ol aria-describedby={noticeId} className="tw-m-0 tw-mt-3 tw-space-y-2 tw-p-0">
              {frame.page.items
                .slice(0, KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage)
                .map((item) => {
                  const appliedAt = formatAppliedAt(item.appliedAt);
                  return (
                    <li
                      className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3"
                      key={item.outputRef}
                    >
                      <div className="tw-min-w-0">
                        <Badge variant="outline">{formatOutputRelation(item.relation)}</Badge>
                        <p className="tw-m-0 tw-text-sm tw-font-medium">
                          <time dateTime={appliedAt === "Unknown time" ? undefined : appliedAt}>
                            {appliedAt}
                          </time>
                        </p>
                        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
                          {item.verifiedApplyCount} verified Apply
                          {item.verifiedApplyCount === 1 ? " record" : " records"}
                        </p>
                      </div>
                      <Button
                        disabled={pageLoading}
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openDetail(item.outputRef)}
                      >
                        View exact output
                      </Button>
                    </li>
                  );
                })}
            </ol>
          ) : (
            <p className="tw-m-0 tw-mt-3 tw-rounded-lg tw-bg-secondary-alt tw-p-3 tw-text-sm tw-text-muted">
              No verified applied outputs are available for this page.
            </p>
          )}

          {frame.page.items.length > KNOWLEDGE_KNOWN_OUTPUTS_VIEW_LIMITS.maxItemsPerPage ? (
            <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-error" role="alert">
              Additional items from this invalid oversized page were hidden.
            </p>
          ) : null}
          {pageError ? (
            <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-error" role="alert">
              {pageError}
            </p>
          ) : null}
          <div className="tw-mt-3 tw-flex tw-justify-between tw-gap-2">
            <Button
              disabled={pageIndex <= 0 || pageLoading}
              type="button"
              variant="secondary"
              onClick={openPreviousPage}
            >
              Previous page
            </Button>
            <Button
              disabled={
                (pageIndex + 1 >= pages.length && !frame.page.nextCursor) ||
                pageLoading ||
                pageError !== undefined ||
                (pageIndex + 1 >= pages.length &&
                  pages.reduce((total, candidate) => total + candidate.page.items.length, 0) >=
                    session.knownOutputCount)
              }
              type="button"
              variant="secondary"
              onClick={openNextPage}
            >
              {pageLoading ? "Loading…" : "Next page"}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
