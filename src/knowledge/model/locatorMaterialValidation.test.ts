import { createQuoteHash } from "@/knowledge/model/fingerprint";
import {
  validateSourceLocatorAgainstArtifact,
  type MarkdownArtifactObservation,
  type PdfArtifactObservation,
  type TextArtifactObservation,
} from "@/knowledge/model/locatorMaterialValidation";
import type { SourceLocator } from "@/knowledge/model/types";

const ARTIFACT_HASH = "a".repeat(64);

/** Creates fields shared by material locator fixtures. */
function createLocatorBase(excerpt: string) {
  return {
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: ARTIFACT_HASH,
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
}

/** Creates a parsed Markdown observation with duplicate headings and CRLF text. */
function createMarkdownArtifact(): MarkdownArtifactObservation {
  return {
    kind: "markdown",
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: ARTIFACT_HASH,
    text: "# Intro\r\nOverview\r\n# Findings\r\nFirst result\r\n# Findings\r\nTarget evidence\r\nEnd",
    headings: [
      { heading: "Findings", occurrence: 1, startLine: 3, endLine: 4 },
      { heading: "Findings", occurrence: 2, startLine: 5, endLine: 7 },
    ],
  };
}

/** Extracts stable material-validation codes. */
function diagnosticCodes(result: { diagnostics: { code: string }[] }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("validateSourceLocatorAgainstArtifact", () => {
  it("resolves a CRLF Markdown excerpt inside a 1-based inclusive line range", () => {
    const locator: SourceLocator = {
      ...createLocatorBase("# Findings\nTarget evidence"),
      kind: "markdown_lines",
      startLine: 5,
      endLine: 6,
    };

    expect(validateSourceLocatorAgainstArtifact(locator, createMarkdownArtifact())).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("uses heading occurrence to disambiguate duplicate headings", () => {
    const locator: SourceLocator = {
      ...createLocatorBase("Target evidence"),
      kind: "heading",
      heading: "Findings",
      occurrence: 2,
    };

    expect(validateSourceLocatorAgainstArtifact(locator, createMarkdownArtifact()).valid).toBe(
      true
    );
    expect(
      diagnosticCodes(
        validateSourceLocatorAgainstArtifact(
          { ...locator, occurrence: 1 },
          createMarkdownArtifact()
        )
      )
    ).toContain("locator_excerpt_missing");
  });

  it("rejects Markdown ranges beyond the observed artifact", () => {
    const locator: SourceLocator = {
      ...createLocatorBase("Target evidence"),
      kind: "markdown_lines",
      startLine: 7,
      endLine: 20,
    };

    expect(
      diagnosticCodes(validateSourceLocatorAgainstArtifact(locator, createMarkdownArtifact()))
    ).toContain("locator_line_range_missing");
  });

  it("resolves an excerpt only on the referenced PDF page", () => {
    const artifact: PdfArtifactObservation = {
      kind: "pdf",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: ARTIFACT_HASH,
      pages: [
        { page: 1, text: "Earlier evidence" },
        { page: 2, text: "图数据库支持时序事实。" },
      ],
    };
    const locator: SourceLocator = {
      ...createLocatorBase("图数据库支持时序事实。"),
      kind: "pdf_page",
      page: 2,
    };

    expect(validateSourceLocatorAgainstArtifact(locator, artifact).valid).toBe(true);
    expect(
      diagnosticCodes(validateSourceLocatorAgainstArtifact({ ...locator, page: 1 }, artifact))
    ).toContain("locator_excerpt_missing");
    expect(
      diagnosticCodes(validateSourceLocatorAgainstArtifact({ ...locator, page: 3 }, artifact))
    ).toContain("locator_pdf_page_missing");
  });

  it("resolves quote locators against plain artifact text", () => {
    const artifact: TextArtifactObservation = {
      kind: "text",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: ARTIFACT_HASH,
      text: "Before\r\nExact quote\r\nAfter",
    };
    const locator: SourceLocator = {
      ...createLocatorBase("Exact quote"),
      kind: "quote",
      prefix: "Before",
      suffix: "After",
    };

    expect(validateSourceLocatorAgainstArtifact(locator, artifact).valid).toBe(true);
  });

  it("rejects source, artifact, and exact content-hash mismatches", () => {
    const locator: SourceLocator = {
      ...createLocatorBase("Exact quote"),
      kind: "quote",
    };
    const artifact: TextArtifactObservation = {
      kind: "text",
      sourceId: "source-2",
      artifactId: "artifact-2",
      artifactContentHash: "b".repeat(64),
      text: "Exact quote",
    };

    expect(diagnosticCodes(validateSourceLocatorAgainstArtifact(locator, artifact))).toEqual(
      expect.arrayContaining([
        "locator_source_mismatch",
        "locator_artifact_mismatch",
        "locator_artifact_hash_mismatch",
      ])
    );
  });

  it("rejects a coordinate locator paired with the wrong parser observation", () => {
    const artifact: TextArtifactObservation = {
      kind: "text",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: ARTIFACT_HASH,
      text: "Target evidence",
    };
    const locator: SourceLocator = {
      ...createLocatorBase("Target evidence"),
      kind: "pdf_page",
      page: 1,
    };

    expect(diagnosticCodes(validateSourceLocatorAgainstArtifact(locator, artifact))).toContain(
      "locator_artifact_kind_mismatch"
    );
  });
});
