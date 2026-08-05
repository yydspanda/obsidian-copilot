import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";
import type {
  KnowledgeVerifiedWikiPage,
  KnowledgeVerifiedWikiSnapshot,
} from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import {
  KNOWLEDGE_SCOPED_LEXICAL_LIMITS,
  type KnowledgeScopedLexicalHit,
  type KnowledgeScopedPageSnapshot,
} from "@/knowledge/query/KnowledgeScopedLexicalRetriever";

const MAX_CITATION_TARGETS = 512;
const OPAQUE_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/** Minimal exact-reader boundary used by one query generation. */
export interface KnowledgeAppliedWikiSnapshotReadPort {
  /** Reads one stable, exact applied-Wiki snapshot. */
  read(signal: AbortSignal): Promise<KnowledgeVerifiedWikiSnapshot>;
}

/** Minimal pure lexical boundary used by the coordinator. */
export interface KnowledgeScopedLexicalRetrievalPort {
  /** Ranks only the supplied in-memory page snapshots. */
  retrieve(
    query: string,
    pages: readonly Readonly<KnowledgeScopedPageSnapshot>[]
  ): readonly Readonly<KnowledgeScopedLexicalHit>[];
}

/** Exact source navigation authority kept outside the UI-facing query result. */
export interface KnowledgeCitationNavigationTarget {
  readonly sourcePath: string;
  readonly citation: Readonly<ClaimCitation>;
}

/** Platform adapter that opens one coordinator-authorized source citation. */
export interface KnowledgeCitationNavigationPort {
  /** Opens an exact source target selected through an opaque citation reference. */
  open(target: Readonly<KnowledgeCitationNavigationTarget>, signal: AbortSignal): Promise<void>;
}

/** Purpose of an opaque identifier requested from the injected factory. */
export type KnowledgeQueryOpaqueIdKind = "query" | "citation";

/** Creates unpredictable identifier material without coupling core query code to a platform RNG. */
export type KnowledgeQueryIdFactory = (kind: KnowledgeQueryOpaqueIdKind) => string;

/** Strict request accepted by the retrieval-only query boundary. */
export interface KnowledgeStudioQueryRequest {
  readonly query: string;
}

/** Safe location metadata shown by the UI without exposing an actionable locator object. */
export type KnowledgeSourceCitationLocationSummary =
  | Readonly<{
      kind: "markdown_lines";
      startLine: number;
      endLine: number;
      heading?: string;
    }>
  | Readonly<{ kind: "heading"; heading: string; occurrence: number }>
  | Readonly<{ kind: "pdf_page"; page: number }>
  | Readonly<{ kind: "quote" }>;

/** Opaque UI summary for one exact source-backed citation target. */
export interface KnowledgeSourceCitationSummary {
  readonly citationRef: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly relation: ClaimCitation["relation"];
  readonly location: KnowledgeSourceCitationLocationSummary;
}

/** One exact applied-Wiki lexical hit with source-backed navigation summaries. */
export interface KnowledgeGroundedRetrievalHit {
  readonly pageEvidenceId: string;
  readonly pagePath: string;
  readonly pageContentHash: string;
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly snippet: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly score: number;
  readonly citations: readonly Readonly<KnowledgeSourceCitationSummary>[];
}

/** Frozen retrieval-only result; it intentionally contains no generated answer or write command. */
export interface KnowledgeGroundedRetrievalResult {
  readonly mode: "grounded_retrieval";
  readonly bundleId: string;
  readonly queryId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly hits: readonly Readonly<KnowledgeGroundedRetrievalHit>[];
}

/** Independent UI boundary for scoped retrieval and opaque citation navigation. */
export interface KnowledgeStudioQueryPort {
  /** Runs one retrieval-only query against the current exact applied Wiki. */
  query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeGroundedRetrievalResult>;

  /** Opens one source citation previously issued by the current query generation. */
  openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void>;

  /** Revokes one exact result, or all current Bundle Query authority when no id is supplied. */
  revokeCurrent(bundleId: string, queryId?: string): void;

  /** Revokes every issued query and citation reference permanently. */
  close(): void;
}

/** Dependencies captured by one Bundle-scoped query coordinator. */
export interface KnowledgeScopedQueryCoordinatorInput {
  readonly bundleId: string;
  readonly reader: KnowledgeAppliedWikiSnapshotReadPort;
  readonly retriever: KnowledgeScopedLexicalRetrievalPort;
  readonly citationNavigation: KnowledgeCitationNavigationPort;
  readonly idFactory: KnowledgeQueryIdFactory;
}

/** Sanitized failure that never retains a query, path, locator, or adapter cause. */
export class KnowledgeScopedQueryError extends Error {
  /** Creates one value-free query boundary failure. */
  constructor() {
    super("The grounded knowledge query is unavailable");
    this.name = "KnowledgeScopedQueryError";
  }
}

interface LinkedAbortSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

interface StoredCitationTarget {
  readonly target: Readonly<KnowledgeCitationNavigationTarget>;
  readonly summary: Readonly<KnowledgeSourceCitationSummary>;
}

interface StoredQueryGeneration {
  readonly generation: number;
  readonly queryId: string;
  readonly citationsByRef: ReadonlyMap<string, Readonly<KnowledgeCitationNavigationTarget>>;
}

interface CitationCandidate {
  readonly key: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly citation: Readonly<ClaimCitation>;
}

/** Throws the platform-standard cancellation category at an async boundary. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

/** Reports whether a rejection is already the platform cancellation category. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Compares strings by code unit without locale-dependent behavior. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Requires one strict non-empty identifier without returning its value in an error. */
function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new KnowledgeScopedQueryError();
  }
}

/** Requires the structural AbortSignal methods used by this cross-realm core boundary. */
function assertAbortSignal(value: unknown): asserts value is AbortSignal {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<AbortSignal>).aborted !== "boolean" ||
    typeof (value as Partial<AbortSignal>).addEventListener !== "function" ||
    typeof (value as Partial<AbortSignal>).removeEventListener !== "function"
  ) {
    throw new KnowledgeScopedQueryError();
  }
}

/** Captures one exact single-field query request without evaluating accessors. */
function captureQuery(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new KnowledgeScopedQueryError();
  }
  let keys: string[];
  let descriptor: PropertyDescriptor | undefined;
  try {
    keys = Object.keys(request);
    descriptor = Object.getOwnPropertyDescriptor(request, "query");
  } catch {
    throw new KnowledgeScopedQueryError();
  }
  if (
    keys.length !== 1 ||
    keys[0] !== "query" ||
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  ) {
    throw new KnowledgeScopedQueryError();
  }
  const query = descriptor.value.trim();
  if (query.length < 1 || query.length > KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxQueryCharacters) {
    throw new KnowledgeScopedQueryError();
  }
  return query;
}

/** Links caller and generation cancellation without letting one caller revoke the generation. */
function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbortSignal {
  const controller = new AbortController();

  /** Propagates one parent cancellation to this operation only. */
  function abort(): void {
    controller.abort();
  }

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  /** Removes every parent listener after the operation settles. */
  function dispose(): void {
    for (const signal of signals) {
      signal.removeEventListener("abort", abort);
    }
  }

  return Object.freeze({ signal: controller.signal, dispose });
}

/** Deep-freezes a detached exact ClaimCitation for the navigation authority. */
function freezeCitation(citation: Readonly<ClaimCitation>): Readonly<ClaimCitation> {
  return Object.freeze({
    ...citation,
    locator: Object.freeze({ ...citation.locator }),
  });
}

/** Serializes one locator into a deterministic exact de-duplication key. */
function createLocatorKey(locator: Readonly<SourceLocator>): string {
  const common = [
    locator.kind,
    locator.sourceId,
    locator.artifactId,
    locator.artifactContentHash,
    locator.excerpt,
    locator.quoteHash,
  ];
  switch (locator.kind) {
    case "markdown_lines":
      return JSON.stringify([
        ...common,
        locator.startLine,
        locator.endLine,
        locator.heading ?? null,
      ]);
    case "heading":
      return JSON.stringify([...common, locator.heading, locator.occurrence]);
    case "pdf_page":
      return JSON.stringify([...common, locator.page]);
    case "quote":
      return JSON.stringify([...common, locator.prefix ?? null, locator.suffix ?? null]);
  }
}

/** Creates one exact source-and-citation key without trusting citation ids alone. */
function createCitationKey(sourcePath: string, citation: Readonly<ClaimCitation>): string {
  return JSON.stringify([
    sourcePath,
    citation.citationId,
    citation.claimId,
    citation.relation,
    createLocatorKey(citation.locator),
  ]);
}

/** Reduces an exact locator to safe, non-actionable UI location metadata. */
function createLocationSummary(
  locator: Readonly<SourceLocator>
): KnowledgeSourceCitationLocationSummary {
  switch (locator.kind) {
    case "markdown_lines":
      return Object.freeze({
        kind: locator.kind,
        startLine: locator.startLine,
        endLine: locator.endLine,
        ...(locator.heading === undefined ? {} : { heading: locator.heading }),
      });
    case "heading":
      return Object.freeze({
        kind: locator.kind,
        heading: locator.heading,
        occurrence: locator.occurrence,
      });
    case "pdf_page":
      return Object.freeze({ kind: locator.kind, page: locator.page });
    case "quote":
      return Object.freeze({ kind: locator.kind });
  }
}

/** Aggregates and exactly de-duplicates all accepted source citations for one page. */
function collectCitationCandidates(
  page: Readonly<KnowledgeVerifiedWikiPage>
): readonly Readonly<CitationCandidate>[] {
  const byKey = new Map<string, Readonly<CitationCandidate>>();
  for (const source of page.sources) {
    const sourceCitations: unknown = source.citations;
    if (
      typeof source.sourceId !== "string" ||
      source.sourceId.length < 1 ||
      typeof source.sourcePath !== "string" ||
      source.sourcePath.length < 1 ||
      !Array.isArray(sourceCitations)
    ) {
      throw new KnowledgeScopedQueryError();
    }
    for (const citation of source.citations) {
      if (
        typeof citation !== "object" ||
        citation === null ||
        citation.locator.sourceId !== source.sourceId
      ) {
        throw new KnowledgeScopedQueryError();
      }
      const detached = freezeCitation(citation);
      const key = createCitationKey(source.sourcePath, detached);
      if (!byKey.has(key)) {
        byKey.set(
          key,
          Object.freeze({
            key,
            sourceId: source.sourceId,
            sourcePath: source.sourcePath,
            citation: detached,
          })
        );
      }
    }
  }
  return Object.freeze([...byKey.values()].sort((left, right) => compareText(left.key, right.key)));
}

/** Verifies that an injected lexical hit is one exact slice of its proven page. */
function assertExactHit(
  hit: Readonly<KnowledgeScopedLexicalHit>,
  page: Readonly<KnowledgeVerifiedWikiPage>
): void {
  if (
    hit.path !== page.path ||
    hit.contentHash !== page.contentHash ||
    !Number.isSafeInteger(hit.startOffset) ||
    !Number.isSafeInteger(hit.endOffset) ||
    hit.startOffset < 0 ||
    hit.endOffset <= hit.startOffset ||
    hit.endOffset > page.content.length ||
    hit.content !== page.content.slice(hit.startOffset, hit.endOffset) ||
    !Number.isSafeInteger(hit.chunkIndex) ||
    hit.chunkIndex < 0 ||
    typeof hit.heading !== "string" ||
    !Array.isArray(hit.headingPath) ||
    !Number.isFinite(hit.score)
  ) {
    throw new KnowledgeScopedQueryError();
  }
}

/** Freezes one exact retrieval hit and its already-authorized citation summaries. */
function createGroundedHit(
  hit: Readonly<KnowledgeScopedLexicalHit>,
  citations: readonly Readonly<KnowledgeSourceCitationSummary>[]
): Readonly<KnowledgeGroundedRetrievalHit> {
  return Object.freeze({
    pageEvidenceId: hit.evidenceId,
    pagePath: hit.path,
    pageContentHash: hit.contentHash,
    chunkId: hit.chunkId,
    chunkIndex: hit.chunkIndex,
    heading: hit.heading,
    headingPath: Object.freeze([...hit.headingPath]),
    snippet: hit.content,
    startOffset: hit.startOffset,
    endOffset: hit.endOffset,
    score: hit.score,
    citations: Object.freeze([...citations]),
  });
}

/**
 * Coordinates exact applied-Wiki retrieval and opaque source-citation navigation.
 *
 * The coordinator has no model, answer-generation, Queue, Review, Apply, or file
 * write dependency. Starting a new query immediately revokes the previous
 * generation and every citation reference it issued.
 */
export class KnowledgeScopedQueryCoordinator implements KnowledgeStudioQueryPort {
  private readonly bundleId: string;
  private readonly reader: KnowledgeAppliedWikiSnapshotReadPort;
  private readonly retriever: KnowledgeScopedLexicalRetrievalPort;
  private readonly citationNavigation: KnowledgeCitationNavigationPort;
  private readonly idFactory: KnowledgeQueryIdFactory;
  private closed = false;
  private generation = 0;
  private generationController: AbortController | undefined;
  private current: StoredQueryGeneration | undefined;

  /** Captures one Bundle-specific, read-only query generation. */
  constructor(input: KnowledgeScopedQueryCoordinatorInput) {
    if (
      !input ||
      typeof input.bundleId !== "string" ||
      input.bundleId.length < 1 ||
      typeof input.reader?.read !== "function" ||
      typeof input.retriever?.retrieve !== "function" ||
      typeof input.citationNavigation?.open !== "function" ||
      typeof input.idFactory !== "function"
    ) {
      throw new KnowledgeScopedQueryError();
    }
    this.bundleId = input.bundleId;
    this.reader = input.reader;
    this.retriever = input.retriever;
    this.citationNavigation = input.citationNavigation;
    this.idFactory = input.idFactory;
  }

  /** Rejects all work after this coordinator generation has been closed. */
  private assertOpen(): void {
    if (this.closed) {
      throw new KnowledgeScopedQueryError();
    }
  }

  /** Creates one generation-scoped opaque id from caller-injected random material. */
  private createOpaqueId(
    kind: KnowledgeQueryOpaqueIdKind,
    generation: number,
    ordinal: number
  ): string {
    let token: unknown;
    try {
      token = this.idFactory(kind);
    } catch {
      throw new KnowledgeScopedQueryError();
    }
    if (typeof token !== "string" || !OPAQUE_TOKEN_PATTERN.test(token)) {
      throw new KnowledgeScopedQueryError();
    }
    return `knowledge-${kind}-${generation}-${ordinal}-${token}`;
  }

  /** Starts one new generation and revokes all prior query and citation references. */
  private beginGeneration(): Readonly<{ generation: number; controller: AbortController }> {
    this.generationController?.abort();
    this.current = undefined;
    this.generation += 1;
    const controller = new AbortController();
    this.generationController = controller;
    return Object.freeze({ generation: this.generation, controller });
  }

  /** Requires that an async operation still belongs to the active open generation. */
  private assertCurrent(generation: number, signal: AbortSignal): void {
    throwIfAborted(signal);
    if (this.closed || generation !== this.generation) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
  }

  /** Allocates or reuses one opaque navigation target within a query result. */
  private resolveCitationTarget(
    candidate: Readonly<CitationCandidate>,
    generation: number,
    targetsByKey: Map<string, Readonly<StoredCitationTarget>>,
    targetsByRef: Map<string, Readonly<KnowledgeCitationNavigationTarget>>
  ): Readonly<StoredCitationTarget> {
    const existing = targetsByKey.get(candidate.key);
    if (existing) return existing;
    if (targetsByKey.size >= MAX_CITATION_TARGETS) {
      throw new KnowledgeScopedQueryError();
    }

    const citationRef = this.createOpaqueId("citation", generation, targetsByKey.size + 1);
    if (targetsByRef.has(citationRef)) {
      throw new KnowledgeScopedQueryError();
    }
    const target = Object.freeze({
      sourcePath: candidate.sourcePath,
      citation: candidate.citation,
    });
    const summary = Object.freeze({
      citationRef,
      sourceId: candidate.sourceId,
      sourcePath: candidate.sourcePath,
      relation: candidate.citation.relation,
      location: createLocationSummary(candidate.citation.locator),
    });
    const stored = Object.freeze({ target, summary });
    targetsByKey.set(candidate.key, stored);
    targetsByRef.set(citationRef, target);
    return stored;
  }

  /**
   * Runs one retrieval-only query against the exact current applied Wiki.
   *
   * @param bundleId - Exact Bundle identity owned by this coordinator
   * @param request - Strict one-field query request
   * @param signal - Caller cancellation signal
   * @returns Frozen grounded retrieval result and opaque citation references
   */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeGroundedRetrievalResult> {
    this.assertOpen();
    assertIdentifier(bundleId);
    assertAbortSignal(signal);
    if (bundleId !== this.bundleId) throw new KnowledgeScopedQueryError();
    const query = captureQuery(request);
    throwIfAborted(signal);

    const { generation, controller } = this.beginGeneration();
    const linked = linkAbortSignals([signal, controller.signal]);
    try {
      const queryId = this.createOpaqueId("query", generation, 1);
      const snapshot = await this.reader.read(linked.signal);
      this.assertCurrent(generation, linked.signal);
      const snapshotPages: unknown = snapshot.pages;
      if (
        snapshot.bundleId !== this.bundleId ||
        !Number.isSafeInteger(snapshot.runtimeRevision) ||
        snapshot.runtimeRevision < 0 ||
        !Number.isSafeInteger(snapshot.manifestRevision) ||
        snapshot.manifestRevision < 0 ||
        !Array.isArray(snapshotPages)
      ) {
        throw new KnowledgeScopedQueryError();
      }

      const pagesByEvidenceId = new Map<string, Readonly<KnowledgeVerifiedWikiPage>>();
      for (const page of snapshot.pages) {
        if (pagesByEvidenceId.has(page.evidenceId)) {
          throw new KnowledgeScopedQueryError();
        }
        pagesByEvidenceId.set(page.evidenceId, page);
      }
      const lexicalPages = snapshot.pages.map((page) =>
        Object.freeze({
          evidenceId: page.evidenceId,
          path: page.path,
          contentHash: page.contentHash,
          content: page.content,
        })
      );
      const lexicalHits = this.retriever.retrieve(query, Object.freeze(lexicalPages));
      this.assertCurrent(generation, linked.signal);
      const lexicalHitValues: unknown = lexicalHits;
      if (
        !Array.isArray(lexicalHitValues) ||
        lexicalHits.length > KNOWLEDGE_SCOPED_LEXICAL_LIMITS.defaultMaxResults
      ) {
        throw new KnowledgeScopedQueryError();
      }

      const targetsByKey = new Map<string, Readonly<StoredCitationTarget>>();
      const targetsByRef = new Map<string, Readonly<KnowledgeCitationNavigationTarget>>();
      const citationsByEvidenceId = new Map<
        string,
        readonly Readonly<KnowledgeSourceCitationSummary>[]
      >();
      const hits = lexicalHits.map((hit) => {
        const page = pagesByEvidenceId.get(hit.evidenceId);
        if (!page) throw new KnowledgeScopedQueryError();
        assertExactHit(hit, page);

        let citations = citationsByEvidenceId.get(page.evidenceId);
        if (!citations) {
          citations = Object.freeze(
            collectCitationCandidates(page).map(
              (candidate) =>
                this.resolveCitationTarget(candidate, generation, targetsByKey, targetsByRef)
                  .summary
            )
          );
          citationsByEvidenceId.set(page.evidenceId, citations);
        }
        return createGroundedHit(hit, citations);
      });
      this.assertCurrent(generation, linked.signal);

      const result = Object.freeze({
        mode: "grounded_retrieval" as const,
        bundleId: this.bundleId,
        queryId,
        runtimeRevision: snapshot.runtimeRevision,
        manifestRevision: snapshot.manifestRevision,
        hits: Object.freeze(hits),
      });
      this.current = Object.freeze({
        generation,
        queryId,
        citationsByRef: targetsByRef,
      });
      return result;
    } catch (error) {
      if (generation === this.generation) {
        this.current = undefined;
      }
      if (linked.signal.aborted || signal.aborted || isAbortError(error)) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      throw error instanceof KnowledgeScopedQueryError ? error : new KnowledgeScopedQueryError();
    } finally {
      linked.dispose();
    }
  }

  /**
   * Opens one exact source citation authorized by the current opaque reference.
   *
   * @param bundleId - Exact Bundle identity owned by this coordinator
   * @param queryId - Opaque current query identity returned by query
   * @param citationRef - Opaque source citation reference returned inside a hit
   * @param signal - Caller cancellation signal
   */
  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    this.assertOpen();
    assertIdentifier(bundleId);
    assertIdentifier(queryId);
    assertIdentifier(citationRef);
    assertAbortSignal(signal);
    throwIfAborted(signal);
    const current = this.current;
    const generationController = this.generationController;
    if (
      bundleId !== this.bundleId ||
      !current ||
      !generationController ||
      current.queryId !== queryId
    ) {
      throw new KnowledgeScopedQueryError();
    }
    const target = current.citationsByRef.get(citationRef);
    if (!target) throw new KnowledgeScopedQueryError();

    const linked = linkAbortSignals([signal, generationController.signal]);
    try {
      await this.citationNavigation.open(target, linked.signal);
      this.assertCurrent(current.generation, linked.signal);
      if (this.current !== current) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    } catch (error) {
      if (linked.signal.aborted || signal.aborted || isAbortError(error)) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      throw new KnowledgeScopedQueryError();
    } finally {
      linked.dispose();
    }
  }

  /** Revokes exact or Bundle-wide Query authority without permanently closing the coordinator. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    this.assertOpen();
    assertIdentifier(bundleId);
    if (bundleId !== this.bundleId) throw new KnowledgeScopedQueryError();
    if (queryId !== undefined) {
      assertIdentifier(queryId);
      if (this.current?.queryId !== queryId) return;
    }
    if (!this.current && !this.generationController) return;
    this.current = undefined;
    this.generation += 1;
    const controller = this.generationController;
    this.generationController = undefined;
    controller?.abort();
  }

  /** Permanently closes this generation and revokes every opaque reference. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.current = undefined;
    this.generation += 1;
    this.generationController?.abort();
    this.generationController = undefined;
  }
}

Object.freeze(KnowledgeScopedQueryCoordinator.prototype);
Object.freeze(KnowledgeScopedQueryCoordinator);
