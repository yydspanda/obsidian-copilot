import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeQueryPanel } from "@/components/knowledge/KnowledgeQueryPanel";
import type {
  KnowledgeGroundedAnswerResult,
  KnowledgeGroundedRetrievalResult,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";

/** Creates one grounded result containing Markdown and PDF citation controls. */
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
        writebackAvailable={false}
        onOpenCitation={jest.fn()}
        onQuery={onQuery}
        onSaveToWiki={jest.fn()}
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
        writebackAvailable={false}
        onOpenCitation={onOpenCitation}
        onQuery={jest.fn()}
        onSaveToWiki={jest.fn()}
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

  it("renders exact excerpts and forwards only opaque Markdown and PDF citation references", () => {
    const onOpenCitation = jest.fn();
    render(
      <KnowledgeQueryPanel
        state={{ status: "ready", result: createResult() }}
        writebackAvailable={false}
        onOpenCitation={onOpenCitation}
        onQuery={jest.fn()}
        onSaveToWiki={jest.fn()}
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
    expect(pdfCitation.hasAttribute("disabled")).toBe(false);
    expect(pdfCitation.getAttribute("title")).toBe("Open Sources/Topic.pdf at PDF page 4");

    fireEvent.click(markdownCitation);
    fireEvent.click(pdfCitation);

    expect(onOpenCitation).toHaveBeenCalledTimes(2);
    expect(onOpenCitation).toHaveBeenNthCalledWith(1, "citation-markdown");
    expect(onOpenCitation).toHaveBeenNthCalledWith(2, "citation-pdf");
  });

  it("shows loading, empty, and sanitized error states without inventing an answer", () => {
    const { rerender } = render(
      <KnowledgeQueryPanel
        state={{ status: "loading" }}
        writebackAvailable={false}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
        onSaveToWiki={jest.fn()}
      />
    );
    expect(screen.getByRole("status").textContent).toContain("generating a grounded answer");

    rerender(
      <KnowledgeQueryPanel
        state={{ status: "ready", result: { ...createResult(), hits: [] } }}
        writebackAvailable={false}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
        onSaveToWiki={jest.fn()}
      />
    );
    expect(screen.getByText("No applied Wiki excerpt matched")).toBeTruthy();

    rerender(
      <KnowledgeQueryPanel
        state={{ status: "error", error: "Scoped Query is unavailable." }}
        writebackAvailable={false}
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
        onSaveToWiki={jest.fn()}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe("Scoped Query is unavailable.");
  });

  it("shows Save to Wiki only for writeback-enabled answered or partial results with claims", () => {
    const partial = createAnswerResult();
    const answered: KnowledgeGroundedAnswerResult = {
      ...partial,
      answer: { ...partial.answer, status: "answered" },
    };
    const withoutClaims: KnowledgeGroundedAnswerResult = {
      ...partial,
      answer: { ...partial.answer, claims: [] },
    };
    const insufficient: KnowledgeGroundedAnswerResult = {
      ...partial,
      answer: {
        ...partial.answer,
        status: "insufficient_evidence",
        insufficientEvidence: ["No current source-backed evidence supports an answer."],
      },
    };
    const callbacks = {
      onOpenCitation: jest.fn(),
      onQuery: jest.fn(),
      onSaveToWiki: jest.fn(),
    };
    const { rerender } = render(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: partial }}
        writebackAvailable={false}
      />
    );

    expect(screen.queryByRole("button", { name: "Save to Wiki" })).toBeNull();

    rerender(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: createResult() }}
        writebackAvailable
      />
    );
    expect(screen.queryByRole("button", { name: "Save to Wiki" })).toBeNull();

    rerender(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: withoutClaims }}
        writebackAvailable
      />
    );
    expect(screen.queryByRole("button", { name: "Save to Wiki" })).toBeNull();

    rerender(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: insufficient }}
        writebackAvailable
      />
    );
    expect(screen.queryByRole("button", { name: "Save to Wiki" })).toBeNull();

    rerender(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: partial }}
        writebackAvailable
      />
    );
    expect(screen.getByRole("button", { name: "Save to Wiki" })).toBeTruthy();

    rerender(
      <KnowledgeQueryPanel
        {...callbacks}
        state={{ status: "ready", result: answered }}
        writebackAvailable
      />
    );
    expect(screen.getByRole("button", { name: "Save to Wiki" })).toBeTruthy();
  });

  it("trims the writeback title and disables the writeback form while saving", () => {
    const onSaveToWiki = jest.fn();
    const state = { status: "ready" as const, result: createAnswerResult() };
    const { rerender } = render(
      <KnowledgeQueryPanel
        state={state}
        writebackAvailable
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
        onSaveToWiki={onSaveToWiki}
      />
    );
    const title = screen.getByRole("textbox", { name: "Wiki writeback title" });
    const save = screen.getByRole("button", { name: "Save to Wiki" });

    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(title, { target: { value: "   Durable insight   " } });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    expect(onSaveToWiki).toHaveBeenCalledTimes(1);
    expect(onSaveToWiki).toHaveBeenCalledWith("Durable insight");

    rerender(
      <KnowledgeQueryPanel
        state={{ ...state, savingToWiki: true }}
        writebackAvailable
        onOpenCitation={jest.fn()}
        onQuery={jest.fn()}
        onSaveToWiki={onSaveToWiki}
      />
    );
    expect(title.hasAttribute("disabled")).toBe(true);
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(onSaveToWiki).toHaveBeenCalledTimes(1);
  });
});
