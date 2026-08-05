import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";

import { resolveKnowledgeCitationTarget } from "./KnowledgeCitationTargetResolver";

const SOURCE_PATH = "Sources/Research.md";
const SOURCE_ID = "source-1";
const ARTIFACT_ID = "artifact-1";

/** Creates fields shared by exact source locator fixtures. */
function createLocatorBase(content: string, excerpt: string) {
  return {
    sourceId: SOURCE_ID,
    artifactId: ARTIFACT_ID,
    artifactContentHash: createFileContentHash(content),
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
}

/** Creates one structurally valid typed claim citation. */
function createCitation(locator: SourceLocator): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator,
  };
}

describe("resolveKnowledgeCitationTarget", () => {
  it("resolves 1-based CRLF line coordinates to a zero-based Editor range", () => {
    const content = "# Intro\r\nOverview\r\n# Findings\r\nTarget evidence\r\nEnd";
    const citation = createCitation({
      ...createLocatorBase(content, "# Findings\nTarget evidence"),
      kind: "markdown_lines",
      startLine: 3,
      endLine: 4,
      heading: "Findings",
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "resolved",
      target: {
        kind: "markdown_range",
        sourcePath: SOURCE_PATH,
        from: { line: 2, ch: 0 },
        to: { line: 3, ch: 15 },
      },
    });
  });

  it("uses duplicate heading occurrence and excludes fenced heading-like text", () => {
    const content = [
      "# Findings",
      "First result",
      "```md",
      "# Findings",
      "not a heading",
      "```",
      "# Findings",
      "Target evidence",
      "End",
    ].join("\n");
    const citation = createCitation({
      ...createLocatorBase(content, "Target evidence"),
      kind: "heading",
      heading: "Findings",
      occurrence: 2,
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "resolved",
      target: {
        kind: "markdown_range",
        sourcePath: SOURCE_PATH,
        from: { line: 6, ch: 0 },
        to: { line: 8, ch: 3 },
      },
    });
  });

  it("keeps nested subsections inside their parent heading range", () => {
    const content = "# Parent\nSummary\n## Child\nGrounded detail\n# Next\nOther";
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded detail"),
      kind: "heading",
      heading: "Parent",
      occurrence: 1,
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "resolved",
      target: {
        kind: "markdown_range",
        sourcePath: SOURCE_PATH,
        from: { line: 0, ch: 0 },
        to: { line: 3, ch: 15 },
      },
    });
  });

  it("does not count YAML frontmatter comments as heading occurrences", () => {
    const content = [
      "---",
      "# Findings",
      "title: Research",
      "---",
      "# Findings",
      "Target evidence",
    ].join("\n");
    const citation = createCitation({
      ...createLocatorBase(content, "Target evidence"),
      kind: "heading",
      heading: "Findings",
      occurrence: 1,
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "resolved",
      target: {
        kind: "markdown_range",
        sourcePath: SOURCE_PATH,
        from: { line: 4, ch: 0 },
        to: { line: 5, ch: 15 },
      },
    });
  });

  it("resolves a unique quote with prefix and suffix to its exact character range", () => {
    const content = "Alpha\r\nTarget evidence\r\nOmega";
    const citation = createCitation({
      ...createLocatorBase(content, "Target evidence"),
      kind: "quote",
      prefix: "Alpha",
      suffix: "Omega",
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "resolved",
      target: {
        kind: "markdown_range",
        sourcePath: SOURCE_PATH,
        from: { line: 1, ch: 0 },
        to: { line: 1, ch: 15 },
      },
    });
  });

  it("fails closed when a quote remains ambiguous", () => {
    const content = "Repeated evidence\nRepeated evidence";
    const citation = createCitation({
      ...createLocatorBase(content, "Repeated evidence"),
      kind: "quote",
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "stale",
    });
  });

  it("reports stale before trusting coordinates when exact source SHA-256 changes", () => {
    const original = "# Evidence\nOriginal fact";
    const citation = createCitation({
      ...createLocatorBase(original, "Original fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });

    expect(
      resolveKnowledgeCitationTarget({
        sourcePath: SOURCE_PATH,
        citation,
        content: "# Evidence\nChanged fact",
      })
    ).toEqual({ status: "stale" });
  });

  it("reports stale when exact bytes match but locator material does not", () => {
    const content = "# Evidence\nCurrent fact";
    const citation = createCitation({
      ...createLocatorBase(content, "Missing fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "stale",
    });
  });

  it("returns unsupported for a structurally valid PDF page locator", () => {
    const content = "%PDF exact bytes represented as text";
    const citation = createCitation({
      ...createLocatorBase(content, "exact bytes"),
      kind: "pdf_page",
      page: 1,
    });

    expect(
      resolveKnowledgeCitationTarget({ sourcePath: "Sources/Paper.pdf", citation, content })
    ).toEqual({
      status: "unsupported",
    });
  });

  it("returns unavailable for an invalid citation or non-canonical Vault path", () => {
    const content = "Grounded fact";
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      quoteHash: "f".repeat(64),
      kind: "quote",
    });

    expect(resolveKnowledgeCitationTarget({ sourcePath: SOURCE_PATH, citation, content })).toEqual({
      status: "unavailable",
    });
    expect(
      resolveKnowledgeCitationTarget({
        sourcePath: "Sources\\Research.md",
        citation: createCitation({
          ...createLocatorBase(content, "Grounded fact"),
          kind: "quote",
        }),
        content,
      })
    ).toEqual({ status: "unavailable" });
  });
});
