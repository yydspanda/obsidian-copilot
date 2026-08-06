import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeQueryPanel } from "@/components/knowledge/KnowledgeQueryPanel";
import type {
  KnowledgeGroundedAnswerResult,
  KnowledgeGroundedRetrievalResult,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";

/** Creates one grounded result containing Markdown and intentionally disabled PDF citations. */
function createResult(): KnowledgeGroundedRetrievalResult {
  return {
    mode: "grounded_retrieval",
    bundleId: "personal",
    queryId: "knowledge-query-1",
    runtimeRevision: 7,
    manifestRevision: 3,
    hits: [
      {
        pageEvidenceId: "wiki-evidence-1",
        pagePath: "Wiki/Topic.md",
        pageContentHash: "a".repeat(64),
        chunkId: "wiki-evidence-1:0",
        chunkIndex: 0,
        heading: "Topic",
        headingPath: ["Domain", "Topic"],
        snippet: "A hash-verified applied Wiki excerpt.",
        startOffset: 0,
        endOffset: 37,
        score: 1,
        citations: [
          {
            citationRef: "citation-markdown",
            sourceId: "source-markdown",
            sourcePath: "Sources/Topic.md",
            relation: "supports",
            location: { kind: "markdown_lines", startLine: 3, endLine: 5 },
          },
          {
            citationRef: "citation-pdf",
            sourceId: "source-pdf",
            sourcePath: "Sources/Topic.pdf",
            relation: "context",
            location: { kind: "pdf_page", page: 4 },
          },
        ],
      },
    ],
  };
}

/** Creates one validated H.2 answer with fact, inference, and missing evidence. */
function createAnswerResult(): KnowledgeGroundedAnswerResult {
  const retrieval = createResult();
  return {
    ...retrieval,
    mode: "grounded_answer",
    answer: {
      status: "partial",
      claims: [
        {
          claimId: "claim-fact",
          kind: "source_fact",
          text: "The applied Wiki excerpt is hash verified.",
          citations: [retrieval.hits[0].citations[0]],
        },
        {
          claimId: "claim-inference",
          kind: "inference",
          text: "This suggests the answer is tied to durable provenance.",
          citations: [retrieval.hits[0].citations[0]],
        },
      ],
      insufficientEvidence: ["No source states how frequently the page changes."],
    },
  };
}

describe("KnowledgeQueryPanel", () => {
  it("submits only a trimmed non-empty Query and explains the read-only answer contract", () => {
    const onQuery = jest.fn();
    render(
      <KnowledgeQueryPanel
        state={{ status: "idle" }}
        onOpenCitation={jest.fn()}
        onQuery={onQuery}
      />
    );

    expect(screen.getByText("Grounded retrieval")).toBeTruthy();
    expect(
      screen.getByText(/DeepSeek may synthesize an answer only from source excerpts/i)
    ).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Knowledge query" });
    const submit = screen.getByRole("button", { name: /Search/ });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "   exact topic   " } });
    fireEvent.click(submit);

    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenCalledWith("exact topic");
  });

  it("renders fact, inference, insufficiency, and only Core-issued citation controls", () => {
    const onOpenCitation = jest.fn();
    render(
      <KnowledgeQueryPanel
        state={{ status: "ready", result: createAnswerResult() }}
        onOpenCitation={onOpenCitation}
        onQuery={jest.fn()}
      />
    );

    expect(screen.getByText("Grounded answer")).toBeTruthy();
    expect(screen.getByText("Source fact")).toBeTruthy();
    expect(screen.getByText("Inference")).toBeTruthy();
    expect(screen.getByText("The applied Wiki excerpt is hash verified.")).toBeTruthy();
    expect(screen.getByText("No source states how frequently the page changes.")).toBeTruthy();
    const claimCitations = screen.getAllByRole("button", {
      name: /Sources\/Topic\.md.*lines 3–5/,
    });
    fireEvent.click(claimCitations[0]);
    expect(onOpenCitation).toHaveBeenCalledWith("citation-markdown");
  });

  it("renders exact excerpts and forwards only the opaque Markdown citation reference", () => {
    const onOpenCitation = jest.fn();
    render(
      <KnowledgeQueryPanel
        state={{ status: "ready", result: createResult() }}
        onOpenCitation={onOpenCitation}
        onQuery={jest.fn()}
      />
    );

    expect(screen.getByText("A hash-verified applied Wiki excerpt.")).toBeTruthy();
    expect(screen.getByText("Wiki/Topic.md · Domain › Topic")).toBeTruthy();
    const markdownCitation = screen.getByRole("button", {
      name: /Sources\/Topic\.md.*lines 3–5/,
    });
    const pdfCitation = screen.getByRole("button", {
      name: /Sources\/Topic\.pdf.*PDF page 4/,
    });
    expect(pdfCitation.hasAttribute("disabled")).toBe(true);
    expect(pdfCitation.getAttribute("title")).toContain("not enabled");

    fireEvent.click(markdownCitation);

    expect(onOpenCitation).toHaveBeenCalledTimes(1);
    expect(onOpenCitation).toHaveBeenCalledWith("citation-markdown");
  });

  it("shows loading, empty, and sanitized error states without inventing an answer", () => {
    const { rerender } = render(
      <KnowledgeQueryPanel
        state={{ status: "loading" }}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
      />
    );
    expect(screen.getByRole("status").textContent).toContain("generating a grounded answer");

    rerender(
      <KnowledgeQueryPanel
        state={{ status: "ready", result: { ...createResult(), hits: [] } }}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
      />
    );
    expect(screen.getByText("No applied Wiki excerpt matched")).toBeTruthy();

    rerender(
      <KnowledgeQueryPanel
        state={{ status: "error", error: "Scoped Query is unavailable." }}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe("Scoped Query is unavailable.");
  });
});
