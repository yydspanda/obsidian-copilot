import { createFileContentHash, normalizeCitationText } from "@/knowledge/model/fingerprint";
import {
  validateSourceLocatorAgainstArtifact,
  type MarkdownArtifactObservation,
  type MarkdownHeadingObservation,
} from "@/knowledge/model/locatorMaterialValidation";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";
import { validateClaimCitation } from "@/knowledge/model/validation";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";

/** Zero-based position accepted by Obsidian's Editor API. */
export interface KnowledgeCitationEditorPosition {
  line: number;
  ch: number;
}

/** Exact Markdown selection target proven against the current source content. */
export interface KnowledgeCitationMarkdownRangeTarget {
  kind: "markdown_range";
  sourcePath: string;
  from: KnowledgeCitationEditorPosition;
  to: KnowledgeCitationEditorPosition;
}

/** Sanitized result of resolving one grounded citation against current Markdown. */
export type KnowledgeCitationTargetResolution =
  | { status: "resolved"; target: KnowledgeCitationMarkdownRangeTarget }
  | { status: "stale" }
  | { status: "unsupported" }
  | { status: "unavailable" };

/** Pure input required to resolve one citation without Vault or UI access. */
export interface KnowledgeCitationTargetResolverInput {
  sourcePath: string;
  citation: ClaimCitation;
  content: string;
}

interface ParsedMarkdownHeading extends MarkdownHeadingObservation {
  level: number;
}

const STALE_RESULT = Object.freeze({ status: "stale" as const });
const UNSUPPORTED_RESULT = Object.freeze({ status: "unsupported" as const });
const UNAVAILABLE_RESULT = Object.freeze({ status: "unavailable" as const });

/**
 * Reads one ATX heading from a Markdown line.
 *
 * Heading-like text inside fenced code is excluded by the caller. This parser
 * deliberately matches the ATX semantics used by scoped knowledge retrieval.
 *
 * @param line - One normalized Markdown line without its newline
 * @returns Heading level and text, or undefined when the line is not an ATX heading
 */
function parseAtxHeading(line: string): Readonly<{ level: number; heading: string }> | undefined {
  const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
  if (!match) return undefined;
  const heading = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
  if (heading.length === 0) return undefined;
  return Object.freeze({ level: match[1].length, heading });
}

/**
 * Parses deterministic ATX heading sections and duplicate-heading occurrences.
 *
 * A section extends through nested subsections and ends immediately before the
 * next heading at the same or a higher level. Fenced code blocks never produce
 * headings.
 *
 * @param content - Exact Markdown content whose line endings may be LF or CRLF
 * @returns Material heading observations using 1-based inclusive line bounds
 */
function parseMarkdownHeadings(content: string): readonly ParsedMarkdownHeading[] {
  const lines = normalizeCitationText(content).split("\n");
  const candidates: Array<Pick<ParsedMarkdownHeading, "heading" | "level" | "startLine">> = [];
  let openFence: Readonly<{ marker: "`" | "~"; length: number }> | undefined;
  let frontmatterEndIndex = -1;
  if (lines[0]?.replace(/^\uFEFF/, "").trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "---" || lines[index].trim() === "...") {
        frontmatterEndIndex = index;
        break;
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (frontmatterEndIndex >= 0 && index <= frontmatterEndIndex) continue;
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
      continue;
    }
    if (openFence) continue;

    const heading = parseAtxHeading(line);
    if (heading) {
      candidates.push({ ...heading, startLine: index + 1 });
    }
  }

  const occurrences = new Map<string, number>();
  const endLines = new Array<number>(candidates.length).fill(lines.length);
  const openHeadingIndexes: number[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    while (
      openHeadingIndexes.length > 0 &&
      candidates[openHeadingIndexes[openHeadingIndexes.length - 1]].level >= candidates[index].level
    ) {
      const completedIndex = openHeadingIndexes.pop();
      if (completedIndex !== undefined) {
        endLines[completedIndex] = candidates[index].startLine - 1;
      }
    }
    openHeadingIndexes.push(index);
  }
  return Object.freeze(
    candidates.map((candidate, index) => {
      const occurrence = (occurrences.get(candidate.heading) ?? 0) + 1;
      occurrences.set(candidate.heading, occurrence);
      return Object.freeze({
        ...candidate,
        occurrence,
        endLine: endLines[index],
      });
    })
  );
}

/**
 * Converts one normalized UTF-16 offset into an Obsidian Editor position.
 *
 * @param content - Markdown with normalized LF line endings
 * @param offset - Inclusive UTF-16 offset within the normalized content
 * @returns Zero-based Editor line and character coordinates
 */
function offsetToEditorPosition(content: string, offset: number): KnowledgeCitationEditorPosition {
  const before = content.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  const line = before.split("\n").length - 1;
  const ch = lastNewline < 0 ? offset : offset - lastNewline - 1;
  return Object.freeze({ line, ch });
}

/**
 * Resolves a 1-based inclusive line range to zero-based Editor coordinates.
 *
 * @param content - Exact Markdown content
 * @param startLine - First 1-based source line
 * @param endLine - Last inclusive 1-based source line
 * @returns Editor selection range, or undefined for out-of-bounds coordinates
 */
function resolveLineRange(
  content: string,
  startLine: number,
  endLine: number
):
  | Readonly<{ from: KnowledgeCitationEditorPosition; to: KnowledgeCitationEditorPosition }>
  | undefined {
  const lines = normalizeCitationText(content).split("\n");
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return undefined;
  return Object.freeze({
    from: Object.freeze({ line: startLine - 1, ch: 0 }),
    to: Object.freeze({ line: endLine - 1, ch: lines[endLine - 1].length }),
  });
}

/**
 * Locates the one quote occurrence admitted by material validation.
 *
 * Prefix and suffix matching intentionally mirrors
 * `validateSourceLocatorAgainstArtifact`, including whitespace trimming at the
 * context boundary and overlapping occurrence discovery.
 *
 * @param content - Exact Markdown content
 * @param locator - Structurally valid quote locator
 * @returns Exact excerpt offsets, or undefined unless exactly one context match exists
 */
function resolveQuoteOffsets(
  content: string,
  locator: Extract<SourceLocator, { kind: "quote" }>
): Readonly<{ start: number; end: number }> | undefined {
  const material = normalizeCitationText(content);
  const excerpt = normalizeCitationText(locator.excerpt);
  const prefix = locator.prefix === undefined ? undefined : normalizeCitationText(locator.prefix);
  const suffix = locator.suffix === undefined ? undefined : normalizeCitationText(locator.suffix);
  const matches: number[] = [];
  let searchFrom = 0;

  while (searchFrom <= material.length - excerpt.length) {
    const index = material.indexOf(excerpt, searchFrom);
    if (index < 0) break;
    const before = material.slice(0, index);
    const after = material.slice(index + excerpt.length);
    const prefixMatches = prefix === undefined || before.trimEnd().endsWith(prefix);
    const suffixMatches = suffix === undefined || after.trimStart().startsWith(suffix);
    if (prefixMatches && suffixMatches) matches.push(index);
    searchFrom = index + 1;
  }

  if (matches.length !== 1) return undefined;
  return Object.freeze({ start: matches[0], end: matches[0] + excerpt.length });
}

/**
 * Builds the parser-neutral Markdown artifact required by material validation.
 *
 * @param content - Exact current Markdown content
 * @param locator - Citation locator supplying durable artifact identity
 * @returns Current material observation with deterministic heading sections
 */
function createMarkdownArtifactObservation(
  content: string,
  locator: SourceLocator
): MarkdownArtifactObservation {
  return Object.freeze({
    kind: "markdown",
    sourceId: locator.sourceId,
    artifactId: locator.artifactId,
    artifactContentHash: createFileContentHash(content),
    text: content,
    headings: parseMarkdownHeadings(content),
  });
}

/**
 * Resolves a grounded citation to an exact Markdown Editor range.
 *
 * The exact-content SHA-256 must match before coordinates are trusted. Every
 * supported locator is then checked with the shared material validator. The
 * function performs no I/O and never falls back to a nearby or similarly named
 * source when grounding is stale.
 *
 * @param input - Source path, typed citation, and current exact Markdown content
 * @returns A resolved range or one sanitized failure category
 */
export function resolveKnowledgeCitationTarget(
  input: KnowledgeCitationTargetResolverInput
): KnowledgeCitationTargetResolution {
  if (typeof input !== "object" || input === null) return UNAVAILABLE_RESULT;
  if (typeof input.sourcePath !== "string" || typeof input.content !== "string") {
    return UNAVAILABLE_RESULT;
  }
  const parsedPath = parseVaultPath(input.sourcePath);
  if (!parsedPath.ok || parsedPath.path !== input.sourcePath) return UNAVAILABLE_RESULT;

  const citationValidation = validateClaimCitation(input.citation);
  if (!citationValidation.valid) return UNAVAILABLE_RESULT;
  const locator = input.citation.locator;
  if (locator.kind === "pdf_page") return UNSUPPORTED_RESULT;

  const artifact = createMarkdownArtifactObservation(input.content, locator);
  if (artifact.artifactContentHash !== locator.artifactContentHash) return STALE_RESULT;
  if (!validateSourceLocatorAgainstArtifact(locator, artifact).valid) return STALE_RESULT;

  let range:
    | Readonly<{ from: KnowledgeCitationEditorPosition; to: KnowledgeCitationEditorPosition }>
    | undefined;
  if (locator.kind === "markdown_lines") {
    range = resolveLineRange(input.content, locator.startLine, locator.endLine);
  } else if (locator.kind === "heading") {
    const heading = artifact.headings.find(
      (candidate) =>
        candidate.heading === locator.heading && candidate.occurrence === locator.occurrence
    );
    if (heading) {
      range = resolveLineRange(input.content, heading.startLine, heading.endLine);
    }
  } else {
    const offsets = resolveQuoteOffsets(input.content, locator);
    if (offsets) {
      const normalized = normalizeCitationText(input.content);
      range = Object.freeze({
        from: offsetToEditorPosition(normalized, offsets.start),
        to: offsetToEditorPosition(normalized, offsets.end),
      });
    }
  }

  if (!range) return STALE_RESULT;
  return Object.freeze({
    status: "resolved",
    target: Object.freeze({
      kind: "markdown_range",
      sourcePath: parsedPath.path,
      from: range.from,
      to: range.to,
    }),
  });
}
