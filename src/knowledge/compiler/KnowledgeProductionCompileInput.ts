import {
  DEFAULT_KNOWLEDGE_COMPILER_LIMITS,
  CompilerEvidence,
  CompilerTargetAuthorization,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeAuthorizedCompilePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { projectKnowledgeEffectiveManifestPages } from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import { createQuoteHash, normalizeCitationText } from "@/knowledge/model/fingerprint";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type { SourceLocator } from "@/knowledge/model/types";

/** Stable failure emitted when authentic preparation cannot form bounded Compiler input. */
export class KnowledgeProductionCompileInputError extends Error {
  /** Creates a value-free input-derivation failure. */
  constructor() {
    super("The production Knowledge compile input is unavailable");
    this.name = "KnowledgeProductionCompileInputError";
  }
}

/** Compares strings by code unit without locale-dependent behavior. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Orders artifacts by their two independent stable identifiers. */
function compareArtifacts(
  left: SourceArtifactObservation,
  right: SourceArtifactObservation
): number {
  return (
    compareText(left.sourceId, right.sourceId) || compareText(left.artifactId, right.artifactId)
  );
}

/** Requires model-visible material instead of manufacturing an empty citation. */
function requireEvidenceText(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KnowledgeProductionCompileInputError();
  }
  return value;
}

/** Creates one deterministic opaque evidence identifier. */
function createEvidenceId(index: number): string {
  return `evidence-${String(index + 1).padStart(4, "0")}`;
}

/** Keeps the artifact hash tied to original bytes even when the excerpt is a paragraph. */
function createTextLocator(
  artifact: Exclude<SourceArtifactObservation, { kind: "pdf" }>,
  excerpt = requireEvidenceText(artifact.text),
  startLine = 1
): SourceLocator {
  const common = {
    sourceId: artifact.sourceId,
    artifactId: artifact.artifactId,
    artifactContentHash: artifact.artifactContentHash,
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
  if (artifact.kind === "markdown") {
    return {
      ...common,
      kind: "markdown_lines",
      startLine,
      endLine: startLine + normalizeCitationText(excerpt).split("\n").length - 1,
    };
  }
  return { ...common, kind: "quote" };
}

function createTextLocators(
  artifact: Exclude<SourceArtifactObservation, { kind: "pdf" }>,
  maxItems: number
): SourceLocator[] {
  const text = normalizeCitationText(requireEvidenceText(artifact.text));
  const excerpts: string[] = [];
  let start = 0;
  // Paragraph evidence makes a supplement independently selectable without changing
  // parser or prompt contracts. Keep separators and leading whitespace with material.
  // https://github.com/yydspanda/obsidian-copilot/issues/17
  for (const separator of text.matchAll(/\n(?:[^\S\n]*\n)+/g)) {
    const end = separator.index + separator[0].length;
    const excerpt = text.slice(start, end);
    if (excerpt.trim().length === 0) continue;
    excerpts.push(excerpt);
    start = end;
    // Excess paragraphs must never discard source material or displace another
    // artifact's evidence; retain the original full-material locator instead.
    // https://github.com/yydspanda/obsidian-copilot/issues/17
    if (excerpts.length > maxItems) return [createTextLocator(artifact)];
  }
  const tail = text.slice(start);
  if (tail.trim().length === 0 && excerpts.length > 0) {
    excerpts[excerpts.length - 1] += tail;
  } else {
    excerpts.push(tail);
  }
  if (excerpts.length > maxItems) return [createTextLocator(artifact)];

  // A quote must identify one occurrence in the full normalized artifact. Merge
  // adjacent paragraphs when repeated text is ambiguous, including an ambiguous
  // final paragraph that can only acquire context by merging backwards.
  // https://github.com/yydspanda/obsidian-copilot/issues/17
  if (artifact.kind === "text") {
    let index = 0;
    let remainingWork = 4 * DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxModelContextCharacters;
    while (index < excerpts.length) {
      // Repetitive large sources otherwise spend quadratic work growing ambiguous
      // quotes. Charge two full scans and at most one source-length concatenation;
      // exceeding this bounded work budget preserves the complete original evidence.
      // https://github.com/yydspanda/obsidian-copilot/issues/17
      remainingWork -= 3 * text.length;
      if (remainingWork < 0) return [createTextLocator(artifact)];
      const excerpt = excerpts[index];
      if (text.indexOf(excerpt, text.indexOf(excerpt) + 1) < 0) {
        index += 1;
      } else {
        const mergeAt = index + 1 < excerpts.length ? index : index - 1;
        excerpts.splice(mergeAt, 2, excerpts[mergeAt] + excerpts[mergeAt + 1]);
        index = mergeAt;
      }
    }
  }
  if (excerpts.length === 1) return [createTextLocator(artifact)];
  let startLine = 1;
  return excerpts.map((excerpt) => {
    // Line locators include their end line, so retaining a terminal LF would
    // highlight the following paragraph's first line as part of this evidence.
    // https://github.com/yydspanda/obsidian-copilot/issues/17
    const lineExcerpt =
      artifact.kind === "markdown" && excerpt.endsWith("\n") ? excerpt.slice(0, -1) : excerpt;
    const locator = createTextLocator(artifact, lineExcerpt, startLine);
    startLine += excerpt.split("\n").length - 1;
    return locator;
  });
}

/** Derives complete, parser-grounded evidence without language-specific chunking rules. */
function createEvidence(artifacts: readonly SourceArtifactObservation[]): CompilerEvidence[] {
  const sortedArtifacts = [...artifacts].sort(compareArtifacts);
  // Reserve existing artifact/page evidence before spending the remaining budget
  // on paragraph granularity. PDF page behavior stays unchanged.
  // https://github.com/yydspanda/obsidian-copilot/issues/17
  let remainingSplits =
    DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxEvidenceItems -
    sortedArtifacts.reduce(
      (count, artifact) =>
        count +
        (artifact.kind === "pdf"
          ? artifact.pages.filter((page) => page.text.trim().length > 0).length
          : 1),
      0
    );
  if (remainingSplits < 0) throw new KnowledgeProductionCompileInputError();
  const locators: SourceLocator[] = [];
  for (const artifact of sortedArtifacts) {
    if (artifact.kind !== "pdf") {
      const textLocators = createTextLocators(artifact, remainingSplits + 1);
      remainingSplits -= textLocators.length - 1;
      locators.push(...textLocators);
      continue;
    }
    const pages = [...artifact.pages].sort((left, right) => left.page - right.page);
    for (const page of pages) {
      if (page.text.trim().length === 0) continue;
      const excerpt = page.text;
      locators.push({
        kind: "pdf_page",
        sourceId: artifact.sourceId,
        artifactId: artifact.artifactId,
        artifactContentHash: artifact.artifactContentHash,
        excerpt,
        quoteHash: createQuoteHash(excerpt),
        page: page.page,
      });
    }
  }
  if (locators.length < 1 || locators.length > DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxEvidenceItems) {
    throw new KnowledgeProductionCompileInputError();
  }
  return locators.map((locator, index) => ({
    evidenceId: createEvidenceId(index),
    locator,
  }));
}

/** Derives write-only authority for pages already tracked by the primary source. */
function createTargetAuthorizations(
  preparation: Readonly<KnowledgeAuthorizedCompilePreparation>
): CompilerTargetAuthorization[] {
  const primaryEntry = preparation.manifest.entries.find(
    (entry) => entry.sourceId === preparation.source.sourceId
  );
  if (!primaryEntry) {
    throw new KnowledgeProductionCompileInputError();
  }
  const pages = projectKnowledgeEffectiveManifestPages(preparation.manifest).filter((page) =>
    page.sourceIds.includes(primaryEntry.sourceId)
  );
  if (pages.length > DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxTargetAuthorizations) {
    throw new KnowledgeProductionCompileInputError();
  }
  return pages.map((page) => {
    return {
      path: page.path,
      allowedIntents: ["write"],
      contentPolicy: "grounded",
      ownership: page.ownership,
      sourceRefs: [...page.sourceIds],
      expectedContentHash: page.effectiveContentHash,
    };
  });
}

/**
 * Derives the complete Compiler DTO exclusively from an authorized preparation and Queue time.
 *
 * Context pages remain empty in the first production slice because no retrieval
 * capability has authorized additional Wiki reads. Existing target authority is
 * write-only; delete stays unavailable until production compare-and-delete exists.
 */
export function createKnowledgeProductionCompileInput(
  preparation: Readonly<KnowledgeAuthorizedCompilePreparation>,
  createdAt: number
): KnowledgeCompileInput {
  try {
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new KnowledgeProductionCompileInputError();
    }
    return {
      bundle: preparation.bundle,
      operation: preparation.operation,
      source: preparation.source,
      manifest: preparation.manifest,
      schema: preparation.schema,
      artifacts: [...preparation.artifacts],
      evidence: createEvidence(preparation.artifacts),
      contextPages: [],
      targetAuthorizations: createTargetAuthorizations(preparation),
      createdAt,
    };
  } catch (error) {
    if (error instanceof KnowledgeProductionCompileInputError) throw error;
    throw new KnowledgeProductionCompileInputError();
  }
}
