import { normalizeCitationText } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeDiagnostic,
  KnowledgeValidationResult,
  SourceLocator,
} from "@/knowledge/model/types";
import { validateSourceLocator } from "@/knowledge/model/validation";

export interface MarkdownHeadingObservation {
  heading: string;
  occurrence: number;
  startLine: number;
  endLine: number;
}

export interface PdfPageObservation {
  page: number;
  text: string;
}

export interface MarkdownArtifactObservation {
  kind: "markdown";
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
  text: string;
  headings: readonly MarkdownHeadingObservation[];
}

export interface PdfArtifactObservation {
  kind: "pdf";
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
  pages: readonly PdfPageObservation[];
}

export interface TextArtifactObservation {
  kind: "text";
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
  text: string;
}

export type SourceArtifactObservation =
  | MarkdownArtifactObservation
  | PdfArtifactObservation
  | TextArtifactObservation;

function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

function toResult(diagnostics: KnowledgeDiagnostic[]): KnowledgeValidationResult {
  return { valid: diagnostics.length === 0, diagnostics };
}

function getNormalizedArtifactText(artifact: SourceArtifactObservation): string {
  if (artifact.kind === "pdf") {
    return artifact.pages.map((page) => normalizeCitationText(page.text)).join("\n");
  }
  return normalizeCitationText(artifact.text);
}

function readMarkdownLineRange(
  text: string,
  startLine: number,
  endLine: number
): string | undefined {
  const lines = normalizeCitationText(text).split("\n");
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    return undefined;
  }
  return lines.slice(startLine - 1, endLine).join("\n");
}

export function validateSourceLocatorAgainstArtifact(
  locator: SourceLocator,
  artifact: SourceArtifactObservation
): KnowledgeValidationResult {
  const structural = validateSourceLocator(locator);
  if (!structural.valid) {
    return structural;
  }

  const diagnostics: KnowledgeDiagnostic[] = [];
  if (locator.sourceId !== artifact.sourceId) {
    addError(
      diagnostics,
      "locator_source_mismatch",
      "sourceId",
      "Locator sourceId does not match the artifact"
    );
  }
  if (locator.artifactId !== artifact.artifactId) {
    addError(
      diagnostics,
      "locator_artifact_mismatch",
      "artifactId",
      "Locator artifactId does not match the artifact"
    );
  }
  if (locator.artifactContentHash !== artifact.artifactContentHash) {
    addError(
      diagnostics,
      "locator_artifact_hash_mismatch",
      "artifactContentHash",
      "Locator artifact hash does not match the observed artifact"
    );
  }

  const excerpt = normalizeCitationText(locator.excerpt);
  if (locator.kind === "markdown_lines") {
    if (artifact.kind !== "markdown") {
      addError(
        diagnostics,
        "locator_artifact_kind_mismatch",
        "kind",
        "Markdown line locators require a Markdown artifact observation"
      );
    } else {
      const range = readMarkdownLineRange(artifact.text, locator.startLine, locator.endLine);
      if (range === undefined) {
        addError(
          diagnostics,
          "locator_line_range_missing",
          "endLine",
          "Markdown line range exceeds the observed artifact"
        );
      } else if (!range.includes(excerpt)) {
        addError(
          diagnostics,
          "locator_excerpt_missing",
          "excerpt",
          "Citation excerpt does not occur inside the Markdown line range"
        );
      }
      if (
        locator.heading !== undefined &&
        !artifact.headings.some(
          (heading) =>
            heading.heading === locator.heading &&
            heading.startLine <= locator.startLine &&
            heading.endLine >= locator.endLine
        )
      ) {
        addError(
          diagnostics,
          "locator_heading_range_mismatch",
          "heading",
          "Markdown line locator heading must contain the referenced line range"
        );
      }
    }
  } else if (locator.kind === "heading") {
    if (artifact.kind !== "markdown") {
      addError(
        diagnostics,
        "locator_artifact_kind_mismatch",
        "kind",
        "Heading locators require a Markdown artifact observation"
      );
    } else {
      const heading = artifact.headings.find(
        (candidate) =>
          candidate.heading === locator.heading && candidate.occurrence === locator.occurrence
      );
      const range = heading
        ? readMarkdownLineRange(artifact.text, heading.startLine, heading.endLine)
        : undefined;
      if (!heading || range === undefined) {
        addError(
          diagnostics,
          "locator_heading_missing",
          "heading",
          "Referenced heading occurrence is not present in the observed artifact"
        );
      } else if (!range.includes(excerpt)) {
        addError(
          diagnostics,
          "locator_excerpt_missing",
          "excerpt",
          "Citation excerpt does not occur inside the referenced heading section"
        );
      }
    }
  } else if (locator.kind === "pdf_page") {
    if (artifact.kind !== "pdf") {
      addError(
        diagnostics,
        "locator_artifact_kind_mismatch",
        "kind",
        "PDF page locators require a PDF artifact observation"
      );
    } else {
      const page = artifact.pages.find((candidate) => candidate.page === locator.page);
      if (!page) {
        addError(
          diagnostics,
          "locator_pdf_page_missing",
          "page",
          "Referenced PDF page is not present in the observed artifact"
        );
      } else if (!normalizeCitationText(page.text).includes(excerpt)) {
        addError(
          diagnostics,
          "locator_excerpt_missing",
          "excerpt",
          "Citation excerpt does not occur on the referenced PDF page"
        );
      }
    }
  } else {
    const material = getNormalizedArtifactText(artifact);
    const prefix = locator.prefix === undefined ? undefined : normalizeCitationText(locator.prefix);
    const suffix = locator.suffix === undefined ? undefined : normalizeCitationText(locator.suffix);
    let excerptOccurrences = 0;
    let matchingOccurrences = 0;
    let searchFrom = 0;
    while (searchFrom <= material.length - excerpt.length) {
      const index = material.indexOf(excerpt, searchFrom);
      if (index < 0) {
        break;
      }
      excerptOccurrences += 1;
      const before = material.slice(0, index);
      const after = material.slice(index + excerpt.length);
      const prefixMatches = prefix === undefined || before.trimEnd().endsWith(prefix);
      const suffixMatches = suffix === undefined || after.trimStart().startsWith(suffix);
      if (prefixMatches && suffixMatches) {
        matchingOccurrences += 1;
      }
      searchFrom = index + 1;
    }

    if (excerptOccurrences === 0) {
      addError(
        diagnostics,
        "locator_excerpt_missing",
        "excerpt",
        "Citation excerpt does not occur in the observed artifact"
      );
    } else if (matchingOccurrences === 0) {
      addError(
        diagnostics,
        "locator_quote_context_mismatch",
        "excerpt",
        "Quote prefix, excerpt, and suffix do not resolve together in the artifact"
      );
    } else if (matchingOccurrences > 1) {
      addError(
        diagnostics,
        "locator_quote_ambiguous",
        "excerpt",
        "Quote locator must resolve to exactly one artifact occurrence"
      );
    }
  }

  return toResult(diagnostics);
}
