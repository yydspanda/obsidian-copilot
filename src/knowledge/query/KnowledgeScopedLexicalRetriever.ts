import MiniSearch, { SearchResult } from "minisearch";

import { tokenizeMixed } from "@/search/v3/utils/tokenizeMixed";

/** Immutable accepted-Wiki page material supplied by a proof-owning caller. */
export interface KnowledgeScopedPageSnapshot {
  readonly evidenceId: string;
  readonly path: string;
  readonly contentHash: string;
  readonly content: string;
}

/** Bounded knobs for one in-memory lexical retrieval pass. */
export interface KnowledgeScopedLexicalOptions {
  readonly maxResults?: number;
  readonly maxChunkCharacters?: number;
}

/** One exact, ranked excerpt derived from a caller-provided page snapshot. */
export interface KnowledgeScopedLexicalHit {
  readonly evidenceId: string;
  readonly path: string;
  readonly contentHash: string;
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly content: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly matchedFields: readonly string[];
}

/** Stable limits applied without consulting global settings. */
export const KNOWLEDGE_SCOPED_LEXICAL_LIMITS = Object.freeze({
  defaultMaxResults: 12,
  maxResults: 100,
  defaultMaxChunkCharacters: 4_000,
  minChunkCharacters: 64,
  maxChunkCharacters: 16_000,
  maxPages: 5_000,
  maxChunks: 50_000,
  maxQueryCharacters: 1_000,
});

interface CapturedPageSnapshot extends KnowledgeScopedPageSnapshot {
  readonly title: string;
}

interface MarkdownHeading {
  readonly offset: number;
  readonly text: string;
  readonly path: readonly string[];
}

interface KnowledgeScopedChunk {
  readonly searchId: string;
  readonly evidenceId: string;
  readonly path: string;
  readonly contentHash: string;
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly title: string;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly content: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface ChunkSection {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly heading: string;
  readonly headingPath: readonly string[];
}

const FIELD_WEIGHTS = Object.freeze({
  title: 5,
  heading: 2.5,
  path: 1.5,
  body: 1,
});

/** Compares strings by code unit so ordering is independent of host locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Derives a display/search title without consulting Vault metadata. */
function deriveTitle(path: string): string {
  const lastSeparator = path.lastIndexOf("/");
  const basename = lastSeparator >= 0 ? path.slice(lastSeparator + 1) : path;
  return basename.toLowerCase().endsWith(".md") ? basename.slice(0, -3) : basename;
}

/** Requires one non-empty metadata string without retaining foreign objects. */
function captureRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Knowledge page snapshot ${field} must be a non-empty string`);
  }
  return value;
}

/** Captures and deterministically orders the exact caller-owned corpus. */
function capturePages(
  pages: readonly Readonly<KnowledgeScopedPageSnapshot>[]
): readonly CapturedPageSnapshot[] {
  if (!Array.isArray(pages)) {
    throw new TypeError("Knowledge page snapshots must be an array");
  }
  if (pages.length > KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxPages) {
    throw new RangeError("Knowledge page snapshot count exceeds the lexical retrieval limit");
  }

  const evidenceIds = new Set<string>();
  const captured: CapturedPageSnapshot[] = [];
  for (let index = 0; index < pages.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(pages, index)) {
      throw new TypeError("Knowledge page snapshots must be a dense array");
    }
    const page = pages[index] as Readonly<KnowledgeScopedPageSnapshot>;
    if (typeof page !== "object" || page === null) {
      throw new TypeError("Knowledge page snapshot must be an object");
    }

    const evidenceId = captureRequiredString(page.evidenceId, "evidenceId");
    if (evidenceIds.has(evidenceId)) {
      throw new TypeError("Knowledge page snapshot evidenceId must be unique");
    }
    evidenceIds.add(evidenceId);

    const path = captureRequiredString(page.path, "path");
    const contentHash = captureRequiredString(page.contentHash, "contentHash");
    if (typeof page.content !== "string") {
      throw new TypeError("Knowledge page snapshot content must be a string");
    }
    captured.push(
      Object.freeze({
        evidenceId,
        path,
        contentHash,
        content: page.content,
        title: deriveTitle(path),
      })
    );
  }

  captured.sort(
    (left, right) =>
      compareText(left.path, right.path) || compareText(left.evidenceId, right.evidenceId)
  );
  return Object.freeze(captured);
}

/** Builds a stable heading breadcrumb from the current Markdown heading stack. */
function createHeadingPath(stack: readonly (string | undefined)[]): readonly string[] {
  return Object.freeze(stack.filter((value): value is string => typeof value === "string"));
}

/** Parses ATX headings while ignoring heading-like text inside fenced code blocks. */
function findMarkdownHeadings(content: string): readonly MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const headingStack: Array<string | undefined> = [];
  let openFence: Readonly<{ marker: "`" | "~"; length: number }> | undefined;
  let offset = 0;

  while (offset < content.length) {
    const newlineOffset = content.indexOf("\n", offset);
    const nextOffset = newlineOffset < 0 ? content.length : newlineOffset + 1;
    const lineWithEnding = content.slice(offset, nextOffset);
    const line = lineWithEnding.replace(/\r?\n$/, "");
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!openFence) {
        openFence = Object.freeze({ marker, length: fenceMatch[1].length });
      } else if (
        openFence.marker === marker &&
        fenceMatch[1].length >= openFence.length &&
        line.slice(fenceMatch[0].length).trim().length === 0
      ) {
        openFence = undefined;
      }
      offset = nextOffset;
      continue;
    }

    if (!openFence) {
      const headingMatch = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
        if (text.length > 0) {
          headingStack.length = level;
          headingStack[level - 1] = text;
          headings.push(
            Object.freeze({
              offset,
              text,
              path: createHeadingPath(headingStack),
            })
          );
        }
      }
    }
    offset = nextOffset;
  }

  return Object.freeze(headings);
}

/** Creates heading-first sections while retaining the exact page offsets. */
function createSections(
  content: string,
  headings: readonly MarkdownHeading[],
  maxChunkCharacters: number
): readonly ChunkSection[] {
  if (content.length === 0) {
    return Object.freeze([]);
  }

  if (content.length <= maxChunkCharacters || headings.length === 0) {
    const firstHeading = headings[0];
    return Object.freeze([
      Object.freeze({
        startOffset: 0,
        endOffset: content.length,
        heading: firstHeading?.text ?? "",
        headingPath: firstHeading?.path ?? Object.freeze([]),
      }),
    ]);
  }

  return Object.freeze(
    headings.map((heading, index) =>
      Object.freeze({
        startOffset: index === 0 ? 0 : heading.offset,
        endOffset: headings[index + 1]?.offset ?? content.length,
        heading: heading.text,
        headingPath: heading.path,
      })
    )
  );
}

/** Avoids splitting a UTF-16 surrogate pair at a hard character boundary. */
function preserveCodePointBoundary(
  content: string,
  startOffset: number,
  endOffset: number
): number {
  if (endOffset <= startOffset || endOffset >= content.length) {
    return endOffset;
  }
  const previous = content.charCodeAt(endOffset - 1);
  const next = content.charCodeAt(endOffset);
  const splitsSurrogatePair =
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
  return splitsSurrogatePair ? endOffset - 1 : endOffset;
}

/** Finds the latest readable exact-slice boundary within one size cap. */
function findChunkEnd(content: string, startOffset: number, hardEndOffset: number): number {
  const minimumPreferredOffset = startOffset + Math.floor((hardEndOffset - startOffset) / 2);
  const paragraphMarkers = ["\r\n\r\n", "\n\n", "\r\r"] as const;
  for (const marker of paragraphMarkers) {
    const markerOffset = content.lastIndexOf(marker, hardEndOffset - 1);
    const candidate = markerOffset + marker.length;
    if (markerOffset >= minimumPreferredOffset && candidate <= hardEndOffset) {
      return preserveCodePointBoundary(content, startOffset, candidate);
    }
  }

  const newlineOffset = Math.max(
    content.lastIndexOf("\n", hardEndOffset - 1),
    content.lastIndexOf("\r", hardEndOffset - 1)
  );
  if (newlineOffset >= minimumPreferredOffset) {
    return preserveCodePointBoundary(content, startOffset, newlineOffset + 1);
  }

  for (let offset = hardEndOffset - 1; offset >= minimumPreferredOffset; offset--) {
    if (/\s/.test(content[offset])) {
      return preserveCodePointBoundary(content, startOffset, offset + 1);
    }
  }
  return preserveCodePointBoundary(content, startOffset, hardEndOffset);
}

/** Splits one section into bounded, contiguous exact slices. */
function splitSection(
  content: string,
  section: Readonly<ChunkSection>,
  maxChunkCharacters: number
): readonly Readonly<{ startOffset: number; endOffset: number }>[] {
  const slices: Array<Readonly<{ startOffset: number; endOffset: number }>> = [];
  let startOffset = section.startOffset;
  while (startOffset < section.endOffset) {
    const hardEndOffset = Math.min(startOffset + maxChunkCharacters, section.endOffset);
    const endOffset =
      hardEndOffset < section.endOffset
        ? findChunkEnd(content, startOffset, hardEndOffset)
        : hardEndOffset;
    if (endOffset <= startOffset) {
      throw new TypeError("Knowledge lexical chunking could not make progress");
    }
    slices.push(Object.freeze({ startOffset, endOffset }));
    startOffset = endOffset;
  }
  return Object.freeze(slices);
}

/** Converts exact immutable pages into deterministic heading-first search chunks. */
function createChunks(
  pages: readonly CapturedPageSnapshot[],
  maxChunkCharacters: number
): readonly KnowledgeScopedChunk[] {
  const chunks: KnowledgeScopedChunk[] = [];
  for (const page of pages) {
    const headings = findMarkdownHeadings(page.content);
    const sections = createSections(page.content, headings, maxChunkCharacters);
    let chunkIndex = 0;
    for (const section of sections) {
      for (const slice of splitSection(page.content, section, maxChunkCharacters)) {
        const content = page.content.slice(slice.startOffset, slice.endOffset);
        if (content.trim().length === 0) {
          continue;
        }
        if (chunks.length >= KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxChunks) {
          throw new RangeError("Knowledge lexical chunk count exceeds the retrieval limit");
        }
        const currentChunkIndex = chunkIndex++;
        chunks.push(
          Object.freeze({
            searchId: `knowledge-search-chunk-${chunks.length}`,
            evidenceId: page.evidenceId,
            path: page.path,
            contentHash: page.contentHash,
            chunkId: `${page.evidenceId}#${currentChunkIndex}`,
            chunkIndex: currentChunkIndex,
            title: page.title,
            heading: section.heading,
            headingPath: section.headingPath,
            content,
            startOffset: slice.startOffset,
            endOffset: slice.endOffset,
          })
        );
      }
    }
  }
  return Object.freeze(chunks);
}

/** Coerces one numeric option into a deterministic integer range. */
function boundInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

/** Creates the ephemeral in-memory BM25 index used for exactly one retrieval. */
function createIndex(): MiniSearch {
  return new MiniSearch({
    fields: ["title", "heading", "path", "body"],
    storeFields: ["id"],
    tokenize: tokenizeMixed,
    searchOptions: {
      boost: FIELD_WEIGHTS,
      prefix: true,
      fuzzy: false,
      combineWith: "OR",
    },
  });
}

/** Orders ranked chunks by score and then by stable corpus identity. */
function compareHits(left: KnowledgeScopedLexicalHit, right: KnowledgeScopedLexicalHit): number {
  return (
    right.score - left.score ||
    compareText(left.path, right.path) ||
    compareText(left.evidenceId, right.evidenceId) ||
    left.chunkIndex - right.chunkIndex
  );
}

/** Collects a stable, de-duplicated list of fields responsible for a match. */
function collectMatchedFields(result: SearchResult): readonly string[] {
  const fields = new Set<string>();
  for (const matchedFields of Object.values(result.match)) {
    for (const field of matchedFields) {
      fields.add(field);
    }
  }
  return Object.freeze([...fields].sort(compareText));
}

/** Converts one MiniSearch result back to its exact caller-provided slice. */
function createHit(
  result: SearchResult,
  chunksBySearchId: ReadonlyMap<string, KnowledgeScopedChunk>
): Readonly<KnowledgeScopedLexicalHit> | undefined {
  const chunk = chunksBySearchId.get(String(result.id));
  if (!chunk || !Number.isFinite(result.score)) {
    return undefined;
  }
  return Object.freeze({
    evidenceId: chunk.evidenceId,
    path: chunk.path,
    contentHash: chunk.contentHash,
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    heading: chunk.heading,
    headingPath: chunk.headingPath,
    content: chunk.content,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    score: result.score,
    matchedTerms: Object.freeze([...new Set(result.queryTerms)].sort(compareText)),
    matchedFields: collectMatchedFields(result),
  });
}

/** Selects bounded top-K chunks while giving each page one slot before repeats. */
function selectDiverseTopK(
  ranked: readonly Readonly<KnowledgeScopedLexicalHit>[],
  limit: number
): readonly Readonly<KnowledgeScopedLexicalHit>[] {
  if (ranked.length <= limit) {
    return Object.freeze([...ranked]);
  }

  const selected: KnowledgeScopedLexicalHit[] = [];
  const selectedChunkIds = new Set<string>();
  const representedEvidence = new Set<string>();
  for (const hit of ranked) {
    if (representedEvidence.has(hit.evidenceId)) {
      continue;
    }
    selected.push(hit);
    selectedChunkIds.add(hit.chunkId);
    representedEvidence.add(hit.evidenceId);
    if (selected.length === limit) {
      return Object.freeze(selected.sort(compareHits));
    }
  }

  for (const hit of ranked) {
    if (selectedChunkIds.has(hit.chunkId)) {
      continue;
    }
    selected.push(hit);
    if (selected.length === limit) {
      break;
    }
  }
  return Object.freeze(selected.sort(compareHits));
}

/**
 * Performs scoped lexical retrieval over exact in-memory accepted-Wiki pages.
 *
 * This stateless leaf has no fallback corpus and no authority to read paths.
 * Every returned character is an exact slice of a supplied page snapshot.
 */
export class KnowledgeScopedLexicalRetriever {
  /**
   * Ranks heading-first chunks from only the supplied immutable page snapshots.
   *
   * @param query - User query to match with Search v3 token semantics
   * @param pages - Exact page snapshots already proven by the caller
   * @param options - Local bounded retrieval options
   * @returns Frozen, deterministic and page-diverse top-K hits
   */
  retrieve(
    query: string,
    pages: readonly Readonly<KnowledgeScopedPageSnapshot>[],
    options: Readonly<KnowledgeScopedLexicalOptions> = {}
  ): readonly Readonly<KnowledgeScopedLexicalHit>[] {
    if (typeof query !== "string" || query.trim().length === 0) {
      return Object.freeze([]);
    }

    const maxResults = boundInteger(
      options.maxResults,
      KNOWLEDGE_SCOPED_LEXICAL_LIMITS.defaultMaxResults,
      1,
      KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxResults
    );
    const maxChunkCharacters = boundInteger(
      options.maxChunkCharacters,
      KNOWLEDGE_SCOPED_LEXICAL_LIMITS.defaultMaxChunkCharacters,
      KNOWLEDGE_SCOPED_LEXICAL_LIMITS.minChunkCharacters,
      KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxChunkCharacters
    );
    const boundedQuery = query.trim().slice(0, KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxQueryCharacters);
    const capturedPages = capturePages(pages);
    const chunks = createChunks(capturedPages, maxChunkCharacters);
    if (chunks.length === 0) {
      return Object.freeze([]);
    }

    const index = createIndex();
    const chunksBySearchId = new Map<string, KnowledgeScopedChunk>();
    for (const chunk of chunks) {
      chunksBySearchId.set(chunk.searchId, chunk);
      index.add({
        id: chunk.searchId,
        title: chunk.title,
        heading: chunk.headingPath.join(" "),
        path: chunk.path.replace(/\.md$/i, "").replace(/\//g, " "),
        body: chunk.content,
      });
    }

    const ranked = index
      .search(boundedQuery, {
        boost: FIELD_WEIGHTS,
        prefix: true,
        fuzzy: false,
        combineWith: "OR",
      })
      .map((result) => createHit(result, chunksBySearchId))
      .filter((hit): hit is Readonly<KnowledgeScopedLexicalHit> => hit !== undefined)
      .sort(compareHits);
    return selectDiverseTopK(ranked, maxResults);
  }
}

Object.freeze(KnowledgeScopedLexicalRetriever.prototype);
Object.freeze(KnowledgeScopedLexicalRetriever);
