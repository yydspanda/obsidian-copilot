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

/** Creates the full-material locator for one text or Markdown artifact. */
function createTextLocator(
  artifact: Exclude<SourceArtifactObservation, { kind: "pdf" }>
): SourceLocator {
  const excerpt = requireEvidenceText(artifact.text);
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
      startLine: 1,
      endLine: normalizeCitationText(excerpt).split("\n").length,
    };
  }
  return { ...common, kind: "quote" };
}

/** Derives complete, parser-grounded evidence without language-specific chunking rules. */
function createEvidence(artifacts: readonly SourceArtifactObservation[]): CompilerEvidence[] {
  const sortedArtifacts = [...artifacts].sort(compareArtifacts);
  const locators: SourceLocator[] = [];
  for (const artifact of sortedArtifacts) {
    if (artifact.kind !== "pdf") {
      locators.push(createTextLocator(artifact));
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
