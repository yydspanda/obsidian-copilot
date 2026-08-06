import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";
import {
  createInsufficientKnowledgeGroundedAnswer,
  createKnowledgeGroundedAnswerRequest,
  KNOWLEDGE_GROUNDED_ANSWER_LIMITS,
  parseKnowledgeGroundedAnswerModelOutput,
  type KnowledgeGroundedAnswer,
  type KnowledgeGroundedAnswerClaimKind,
  type KnowledgeGroundedAnswerModelPort,
} from "@/knowledge/query/KnowledgeGroundedAnswer";
import type {
  KnowledgeVerifiedWikiPage,
  KnowledgeVerifiedWikiSnapshot,
} from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import {
  KNOWLEDGE_SCOPED_LEXICAL_LIMITS,
  type KnowledgeScopedLexicalHit,
  type KnowledgeScopedPageSnapshot,
} from "@/knowledge/query/KnowledgeScopedLexicalRetriever";
import {
  createKnowledgeQueryWritebackCapture,
  type KnowledgeQueryWritebackSubmissionPort,
  type KnowledgeStudioQueryWritebackPort,
  type KnowledgeStudioQueryWritebackRequest,
  type KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";

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
  /** Re-proves an exact source citation without changing the workspace. */
  verify(
    target: Readonly<KnowledgeCitationNavigationTarget>,
    signal: AbortSignal
  ): Promise<boolean>;

  /** Opens an exact source target selected through an opaque citation reference. */
  open(target: Readonly<KnowledgeCitationNavigationTarget>, signal: AbortSignal): Promise<void>;
}

/** Purpose of an opaque identifier requested from the injected factory. */
export type KnowledgeQueryOpaqueIdKind = "query" | "citation";

/** Creates unpredictable identifier material without coupling core query code to a platform RNG. */
export type KnowledgeQueryIdFactory = (kind: KnowledgeQueryOpaqueIdKind) => string;

/** Strict request accepted by the scoped retrieval and answer boundary. */
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

/** One validated answer claim whose references were mapped by Core, never by the model. */
export interface KnowledgeGroundedAnswerResultClaim {
  readonly claimId: string;
  readonly kind: KnowledgeGroundedAnswerClaimKind;
  readonly text: string;
  readonly citations: readonly Readonly<KnowledgeSourceCitationSummary>[];
}

/** User-visible answer projection with explicit support and insufficiency categories. */
export interface KnowledgeGroundedAnswerResultBody {
  readonly status: KnowledgeGroundedAnswer["status"];
  readonly claims: readonly Readonly<KnowledgeGroundedAnswerResultClaim>[];
  readonly insufficientEvidence: readonly string[];
}

/** Frozen read-only model answer over one exact applied-Wiki and source generation. */
export interface KnowledgeGroundedAnswerResult {
  readonly mode: "grounded_answer";
  readonly bundleId: string;
  readonly queryId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly answer: Readonly<KnowledgeGroundedAnswerResultBody>;
  readonly hits: readonly Readonly<KnowledgeGroundedRetrievalHit>[];
}

/** H.1 retrieval or H.2 synthesized answer returned through the stable Query port. */
export type KnowledgeStudioQueryResult =
  | KnowledgeGroundedRetrievalResult
  | KnowledgeGroundedAnswerResult;

/** Independent UI boundary for scoped retrieval and opaque citation navigation. */
export interface KnowledgeStudioQueryPort {
  /** Runs one retrieval-only query against the current exact applied Wiki. */
  query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult>;

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
  readonly answerModel?: KnowledgeGroundedAnswerModelPort;
  readonly writeback?: KnowledgeQueryWritebackSubmissionPort;
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
  readonly question: string;
  readonly snapshot: Readonly<KnowledgeVerifiedWikiSnapshot>;
  readonly result: Readonly<KnowledgeStudioQueryResult>;
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
  let keys: PropertyKey[];
  let descriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(request);
    descriptor = Object.getOwnPropertyDescriptor(request, "query");
  } catch {
    throw new KnowledgeScopedQueryError();
  }
  if (
    keys.length !== 1 ||
    keys[0] !== "query" ||
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable ||
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

/** Captures the only user-authored field accepted by Save to Wiki. */
function captureWritebackTitle(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new KnowledgeScopedQueryError();
  }
  let keys: PropertyKey[];
  let descriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(request);
    descriptor = Object.getOwnPropertyDescriptor(request, "title");
  } catch {
    throw new KnowledgeScopedQueryError();
  }
  if (
    keys.length !== 1 ||
    keys[0] !== "title" ||
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable ||
    typeof descriptor.value !== "string"
  ) {
    throw new KnowledgeScopedQueryError();
  }
  const title = descriptor.value.trim();
  if (title.length < 1 || title.length > 256 || /[\r\n]/.test(title)) {
    throw new KnowledgeScopedQueryError();
  }
  return title;
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

/** Compares every immutable source and citation field in one applied-page provenance record. */
function isSameAppliedSourceProvenance(
  before: Readonly<KnowledgeVerifiedWikiPage>["sources"][number],
  after: Readonly<KnowledgeVerifiedWikiPage>["sources"][number]
): boolean {
  return (
    before.sourceId === after.sourceId &&
    before.sourcePath === after.sourcePath &&
    before.custody === after.custody &&
    before.sourceContentHash === after.sourceContentHash &&
    before.pipelineFingerprint === after.pipelineFingerprint &&
    before.inputRevision === after.inputRevision &&
    before.changeSetId === after.changeSetId &&
    before.changeSetDigest === after.changeSetDigest &&
    before.acceptedAt === after.acceptedAt &&
    before.citations.length === after.citations.length &&
    before.citations.every(
      (citation, index) =>
        after.citations[index] !== undefined &&
        createCitationKey(before.sourcePath, citation) ===
          createCitationKey(after.sourcePath, after.citations[index])
    )
  );
}

/** Compares the exact Wiki material that was proven before and after model I/O. */
function isSameVerifiedWikiSnapshot(
  before: Readonly<KnowledgeVerifiedWikiSnapshot>,
  after: Readonly<KnowledgeVerifiedWikiSnapshot>
): boolean {
  if (
    before.bundleId !== after.bundleId ||
    before.runtimeRevision !== after.runtimeRevision ||
    before.manifestRevision !== after.manifestRevision ||
    before.pages.length !== after.pages.length
  ) {
    return false;
  }
  return before.pages.every((page, index) => {
    const current = after.pages[index];
    return (
      current !== undefined &&
      page.evidenceId === current.evidenceId &&
      page.path === current.path &&
      page.windowsPathKey === current.windowsPathKey &&
      page.ownership === current.ownership &&
      page.contentHash === current.contentHash &&
      page.content === current.content &&
      page.sources.length === current.sources.length &&
      page.sources.every(
        (source: Readonly<KnowledgeVerifiedWikiPage>["sources"][number], sourceIndex: number) =>
          current.sources[sourceIndex] !== undefined &&
          isSameAppliedSourceProvenance(source, current.sources[sourceIndex])
      )
    );
  });
}

/** Reports whether one citation can participate in the H.2 Markdown-only answer contract. */
function isEligibleAnswerTarget(target: Readonly<StoredCitationTarget>): boolean {
  const locator = target.target.citation.locator;
  return (
    locator.kind !== "pdf_page" &&
    locator.excerpt.length > 0 &&
    locator.excerpt.length <= KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxSourceExcerptCharacters
  );
}

interface KnowledgeAnswerModelMaterial {
  readonly request: ReturnType<typeof createKnowledgeGroundedAnswerRequest>;
  readonly targetsByEvidenceId: ReadonlyMap<string, Readonly<StoredCitationTarget>>;
}

/**
 * Coordinates exact applied-Wiki retrieval and opaque source-citation navigation.
 *
 * An optional narrow answer model can synthesize only from source-reproved
 * evidence prepared inside the same query generation. The coordinator has no
 * Queue, Review, Apply, or file-write dependency. Starting a new query
 * immediately revokes the previous generation and every citation reference it
 * issued.
 */
export class KnowledgeScopedQueryCoordinator
  implements KnowledgeStudioQueryPort, KnowledgeStudioQueryWritebackPort
{
  private readonly bundleId: string;
  private readonly reader: KnowledgeAppliedWikiSnapshotReadPort;
  private readonly retriever: KnowledgeScopedLexicalRetrievalPort;
  private readonly citationNavigation: KnowledgeCitationNavigationPort;
  private readonly idFactory: KnowledgeQueryIdFactory;
  private readonly answerModel: KnowledgeGroundedAnswerModelPort | undefined;
  private readonly writeback: KnowledgeQueryWritebackSubmissionPort | undefined;
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
      typeof input.citationNavigation?.verify !== "function" ||
      typeof input.citationNavigation?.open !== "function" ||
      typeof input.idFactory !== "function" ||
      (input.answerModel !== undefined && typeof input.answerModel.generate !== "function") ||
      (input.writeback !== undefined && typeof input.writeback.submit !== "function")
    ) {
      throw new KnowledgeScopedQueryError();
    }
    this.bundleId = input.bundleId;
    this.reader = input.reader;
    this.retriever = input.retriever;
    this.citationNavigation = input.citationNavigation;
    this.idFactory = input.idFactory;
    this.answerModel = input.answerModel;
    this.writeback = input.writeback;
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

  /** Builds only source-reproved model evidence and keeps citation authority private. */
  private async createAnswerModelMaterial(
    question: string,
    hits: readonly Readonly<KnowledgeGroundedRetrievalHit>[],
    targetsByPageEvidenceId: ReadonlyMap<string, readonly Readonly<StoredCitationTarget>[]>,
    generation: number,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAnswerModelMaterial>> {
    const contexts: Array<{
      contextId: string;
      pagePath: string;
      pageContentHash: string;
      heading: string;
      headingPath: readonly string[];
      content: string;
    }> = [];
    const evidence: Array<{
      evidenceId: string;
      contextId: string;
      sourceExcerpt: string;
      sourceRelation: ClaimCitation["relation"];
    }> = [];
    const targetsByEvidenceId = new Map<string, Readonly<StoredCitationTarget>>();
    let totalCharacters = 0;

    for (const hit of hits) {
      if (
        contexts.length >= KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxContextItems ||
        evidence.length >= KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceItems
      ) {
        break;
      }
      const candidates = targetsByPageEvidenceId.get(hit.pageEvidenceId) ?? [];
      let contextId: string | undefined;
      for (const candidate of candidates) {
        if (evidence.length >= KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceItems) break;
        if (!isEligibleAnswerTarget(candidate)) continue;
        const sourceExcerpt = candidate.target.citation.locator.excerpt;
        const contextCost = contextId === undefined ? hit.snippet.length : 0;
        if (
          totalCharacters + contextCost + sourceExcerpt.length >
          KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxTotalEvidenceCharacters
        ) {
          continue;
        }
        const verified = await this.citationNavigation.verify(candidate.target, signal);
        this.assertCurrent(generation, signal);
        if (verified !== true) continue;
        if (contextId === undefined) {
          contextId = `context-${contexts.length + 1}`;
          contexts.push(
            Object.freeze({
              contextId,
              pagePath: hit.pagePath,
              pageContentHash: hit.pageContentHash,
              heading: hit.heading,
              headingPath: Object.freeze([...hit.headingPath]),
              content: hit.snippet,
            })
          );
          totalCharacters += hit.snippet.length;
        }
        const evidenceId = `evidence-${evidence.length + 1}`;
        evidence.push(
          Object.freeze({
            evidenceId,
            contextId,
            sourceExcerpt,
            sourceRelation: candidate.target.citation.relation,
          })
        );
        targetsByEvidenceId.set(evidenceId, candidate);
        totalCharacters += sourceExcerpt.length;
      }
    }

    const request = createKnowledgeGroundedAnswerRequest(
      question,
      Object.freeze(contexts),
      Object.freeze(evidence)
    );
    return Object.freeze({ request, targetsByEvidenceId });
  }

  /** Maps validated evidence ids to deduplicated opaque UI citation summaries. */
  private createAnswerResultBody(
    answer: Readonly<KnowledgeGroundedAnswer>,
    targetsByEvidenceId: ReadonlyMap<string, Readonly<StoredCitationTarget>>
  ): Readonly<KnowledgeGroundedAnswerResultBody> {
    const claims = answer.claims.map((claim) => {
      const citationsByRef = new Map<string, Readonly<KnowledgeSourceCitationSummary>>();
      for (const evidenceId of claim.evidenceIds) {
        const target = targetsByEvidenceId.get(evidenceId);
        if (!target) throw new KnowledgeScopedQueryError();
        citationsByRef.set(target.summary.citationRef, target.summary);
      }
      return Object.freeze({
        claimId: claim.claimId,
        kind: claim.kind,
        text: claim.text,
        citations: Object.freeze([...citationsByRef.values()]),
      });
    });
    return Object.freeze({
      status: answer.status,
      claims: Object.freeze(claims),
      insufficientEvidence: Object.freeze([...answer.insufficientEvidence]),
    });
  }

  /**
   * Runs one scoped retrieval and optional grounded answer against the exact current applied Wiki.
   *
   * @param bundleId - Exact Bundle identity owned by this coordinator
   * @param request - Strict one-field query request
   * @param signal - Caller cancellation signal
   * @returns Frozen grounded result and opaque citation references
   */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
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
      const storedTargetsByEvidenceId = new Map<
        string,
        readonly Readonly<StoredCitationTarget>[]
      >();
      const hits = lexicalHits.map((hit) => {
        const page = pagesByEvidenceId.get(hit.evidenceId);
        if (!page) throw new KnowledgeScopedQueryError();
        assertExactHit(hit, page);

        let citations = citationsByEvidenceId.get(page.evidenceId);
        if (!citations) {
          const storedTargets = Object.freeze(
            collectCitationCandidates(page).map((candidate) =>
              this.resolveCitationTarget(candidate, generation, targetsByKey, targetsByRef)
            )
          );
          storedTargetsByEvidenceId.set(page.evidenceId, storedTargets);
          citations = Object.freeze(storedTargets.map(({ summary }) => summary));
          citationsByEvidenceId.set(page.evidenceId, citations);
        }
        return createGroundedHit(hit, citations);
      });
      this.assertCurrent(generation, linked.signal);

      let result: KnowledgeStudioQueryResult;
      if (!this.answerModel) {
        result = Object.freeze({
          mode: "grounded_retrieval" as const,
          bundleId: this.bundleId,
          queryId,
          runtimeRevision: snapshot.runtimeRevision,
          manifestRevision: snapshot.manifestRevision,
          hits: Object.freeze(hits),
        });
      } else {
        const material = await this.createAnswerModelMaterial(
          query,
          hits,
          storedTargetsByEvidenceId,
          generation,
          linked.signal
        );
        this.assertCurrent(generation, linked.signal);
        const answer =
          material.request.evidence.length === 0
            ? createInsufficientKnowledgeGroundedAnswer(material.request.contextDigest)
            : parseKnowledgeGroundedAnswerModelOutput(
                await this.answerModel.generate(material.request, linked.signal),
                material.request
              );
        this.assertCurrent(generation, linked.signal);

        const freshSnapshot = await this.reader.read(linked.signal);
        this.assertCurrent(generation, linked.signal);
        if (!isSameVerifiedWikiSnapshot(snapshot, freshSnapshot)) {
          throw new KnowledgeScopedQueryError();
        }
        const usedEvidenceIds = new Set(
          answer.claims.flatMap(({ evidenceIds }) => [...evidenceIds])
        );
        for (const evidenceId of usedEvidenceIds) {
          const target = material.targetsByEvidenceId.get(evidenceId);
          if (!target) throw new KnowledgeScopedQueryError();
          const verified = await this.citationNavigation.verify(target.target, linked.signal);
          this.assertCurrent(generation, linked.signal);
          if (verified !== true) throw new KnowledgeScopedQueryError();
        }
        result = Object.freeze({
          mode: "grounded_answer" as const,
          bundleId: this.bundleId,
          queryId,
          runtimeRevision: snapshot.runtimeRevision,
          manifestRevision: snapshot.manifestRevision,
          answer: this.createAnswerResultBody(answer, material.targetsByEvidenceId),
          hits: Object.freeze(hits),
        });
      }
      this.current = Object.freeze({
        generation,
        queryId,
        question: query,
        snapshot,
        result,
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
   * Captures the current grounded answer as a managed source for reviewed writeback.
   *
   * The coordinator re-proves the complete applied-Wiki snapshot and every
   * actually used source citation before handing a content-addressed capture to
   * the narrow production submission edge. It never receives a path or Wiki
   * payload from the UI and cannot apply the eventual ChangeSet.
   *
   * @param bundleId - Exact Bundle identity owned by this coordinator
   * @param queryId - Opaque current query identity returned by query
   * @param request - Single user-authored display title
   * @param signal - Caller cancellation signal
   * @returns Truthful durable registration result
   */
  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    this.assertOpen();
    assertIdentifier(bundleId);
    assertIdentifier(queryId);
    assertAbortSignal(signal);
    const title = captureWritebackTitle(request);
    throwIfAborted(signal);
    const current = this.current;
    const generationController = this.generationController;
    const result = current?.result;
    if (
      bundleId !== this.bundleId ||
      !this.writeback ||
      !current ||
      !generationController ||
      current.queryId !== queryId ||
      !result ||
      result.mode !== "grounded_answer" ||
      result.answer.status === "insufficient_evidence" ||
      result.answer.claims.length === 0
    ) {
      throw new KnowledgeScopedQueryError();
    }

    const linked = linkAbortSignals([signal, generationController.signal]);
    try {
      const freshBeforeEvidence = await this.reader.read(linked.signal);
      this.assertCurrent(current.generation, linked.signal);
      if (!isSameVerifiedWikiSnapshot(current.snapshot, freshBeforeEvidence)) {
        throw new KnowledgeScopedQueryError();
      }

      const citationRefs: string[] = [];
      const seenReferences = new Set<string>();
      for (const claim of result.answer.claims) {
        for (const citation of claim.citations) {
          if (!seenReferences.has(citation.citationRef)) {
            seenReferences.add(citation.citationRef);
            citationRefs.push(citation.citationRef);
          }
        }
      }
      const evidence = [];
      for (const citationRef of citationRefs) {
        const target = current.citationsByRef.get(citationRef);
        if (!target) throw new KnowledgeScopedQueryError();
        const verified = await this.citationNavigation.verify(target, linked.signal);
        this.assertCurrent(current.generation, linked.signal);
        if (verified !== true) throw new KnowledgeScopedQueryError();
        evidence.push(
          Object.freeze({
            citationRef,
            sourcePath: target.sourcePath,
            citation: target.citation,
          })
        );
      }
      const freshAfterEvidence = await this.reader.read(linked.signal);
      this.assertCurrent(current.generation, linked.signal);
      if (!isSameVerifiedWikiSnapshot(current.snapshot, freshAfterEvidence)) {
        throw new KnowledgeScopedQueryError();
      }

      const capture = createKnowledgeQueryWritebackCapture({
        bundleId: this.bundleId,
        query: current.question,
        title,
        runtimeRevision: current.snapshot.runtimeRevision,
        manifestRevision: current.snapshot.manifestRevision,
        answerStatus: result.answer.status,
        claims: result.answer.claims.map((claim) =>
          Object.freeze({
            claimId: claim.claimId,
            kind: claim.kind,
            text: claim.text,
            citationRefs: Object.freeze(claim.citations.map((citation) => citation.citationRef)),
          })
        ),
        insufficientEvidence: result.answer.insufficientEvidence,
        evidence: Object.freeze(evidence),
      });
      const submission = await this.writeback.submit(capture, linked.signal);
      this.assertCurrent(current.generation, linked.signal);
      if (
        typeof submission !== "object" ||
        submission === null ||
        Array.isArray(submission) ||
        Reflect.ownKeys(submission).length !== 1 ||
        Object.getOwnPropertyDescriptor(submission, "kind")?.value !== "registered"
      ) {
        throw new KnowledgeScopedQueryError();
      }
      return Object.freeze({ kind: "registered" as const });
    } catch (error) {
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
