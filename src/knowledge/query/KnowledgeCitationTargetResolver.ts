import { createFileContentHash, normalizeCitationText } from "@/knowledge/model/fingerprint";
import {
  validateSourceLocatorAgainstArtifact,
  type MarkdownArtifactObservation,
  type MarkdownHeadingObservation,
} from "@/knowledge/model/locatorMaterialValidation";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";
import { validateClaimCitation } from "@/knowledge/model/validation";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";

export interface KnowledgeCitationEditorPosition {
  line: number;
  ch: number;
}

export interface KnowledgeCitationMarkdownRangeTarget {
  kind: "markdown_range";
  sourcePath: string;
  from: KnowledgeCitationEditorPosition;
  to: KnowledgeCitationEditorPosition;
}

export type KnowledgeCitationTargetResolution =
  | { status: "resolved"; target: KnowledgeCitationMarkdownRangeTarget }
  | { status: "stale" }
  | { status: "unsupported" }
  | { status: "unavailable" };

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

function parseAtxHeading(line: string): Readonly<{ level: number; heading: string }> | undefined {
  const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
  if (!match) return undefined;
  const heading = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
  if (heading.length === 0) return undefined;
  return Object.freeze({ level: match[1].length, heading });
}

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

function offsetToEditorPosition(content: string, offset: number): KnowledgeCitationEditorPosition {
  const before = content.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  const line = before.split("\n").length - 1;
  const ch = lastNewline < 0 ? offset : offset - lastNewline - 1;
  return Object.freeze({ line, ch });
}

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
