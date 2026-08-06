import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";
import {
  assertKnowledgeQueryWritebackCapture,
  createKnowledgeQueryWritebackCapture,
  KnowledgeQueryWritebackCaptureError,
  type KnowledgeQueryWritebackCaptureInput,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";

const EXCERPT = "The durable source states the exact fact.";

/** Creates one exact source citation used by a captured answer claim. */
function createCitation(): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "source-claim-1",
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId: "source-1",
      artifactId: "source-1:markdown",
      artifactContentHash: "a".repeat(64),
      excerpt: EXCERPT,
      quoteHash: createQuoteHash(EXCERPT),
      startLine: 4,
      endLine: 4,
    },
  };
}

/** Creates one complete supported-answer capture input. */
function createInput(): KnowledgeQueryWritebackCaptureInput {
  return {
    bundleId: "personal",
    query: "What does the durable source establish?",
    title: "Durable source finding",
    runtimeRevision: 17,
    manifestRevision: 5,
    answerStatus: "answered",
    claims: [
      {
        claimId: "claim-1",
        kind: "source_fact",
        text: "The source establishes a durable fact.",
        citationRefs: ["citation-ref-1"],
      },
    ],
    insufficientEvidence: [],
    evidence: [
      {
        citationRef: "citation-ref-1",
        sourcePath: "Sources/Durable.md",
        citation: createCitation(),
      },
    ],
  };
}

describe("KnowledgeQueryWritebackCapture", () => {
  it("creates deterministic, content-addressed Markdown without writing a Wiki target", () => {
    const first = createKnowledgeQueryWritebackCapture(createInput());
    const second = createKnowledgeQueryWritebackCapture(createInput());

    expect(first).toEqual(second);
    expect(first.sourceContentHash).toBe(createFileContentHash(first.sourceContent));
    expect(first.sourceContent).toContain("type: query-writeback");
    expect(first.sourceContent).toContain("## Question");
    expect(first.sourceContent).toContain("### Source fact");
    expect(first.sourceContent).toContain('### [1] "Sources/Durable.md"');
    expect(first.sourceContent).toContain(`> ${EXCERPT}`);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => assertKnowledgeQueryWritebackCapture(first)).not.toThrow();
    expect(() => assertKnowledgeQueryWritebackCapture({ ...first })).toThrow(
      KnowledgeQueryWritebackCaptureError
    );
  });

  it("changes identity when the exact answer, evidence, or revision read-set changes", () => {
    const base = createKnowledgeQueryWritebackCapture(createInput());
    const answerInput = createInput();
    const answerChanged = {
      ...answerInput,
      claims: [{ ...answerInput.claims[0], text: "The source establishes a different fact." }],
    };
    const evidenceInput = createInput();
    const evidenceChanged = {
      ...evidenceInput,
      evidence: [
        {
          ...evidenceInput.evidence[0],
          sourcePath: "Sources/Other.md",
        },
      ],
    };
    const revisionChanged = { ...createInput(), runtimeRevision: 18 };

    expect(createKnowledgeQueryWritebackCapture(answerChanged).captureDigest).not.toBe(
      base.captureDigest
    );
    expect(createKnowledgeQueryWritebackCapture(evidenceChanged).captureDigest).not.toBe(
      base.captureDigest
    );
    expect(createKnowledgeQueryWritebackCapture(revisionChanged).captureDigest).not.toBe(
      base.captureDigest
    );
  });

  it("captures partial answers and preserves explicit evidence gaps", () => {
    const input = {
      ...createInput(),
      answerStatus: "partial" as const,
      insufficientEvidence: ["A second source is still required."],
    };

    const capture = createKnowledgeQueryWritebackCapture(input);

    expect(capture.sourceContent).toContain("## Evidence still needed");
    expect(capture.sourceContent).toContain("- A second source is still required.");
  });

  it("rejects insufficient answers, ungrounded claims, unused evidence, and unknown refs", () => {
    expect(() =>
      createKnowledgeQueryWritebackCapture({
        ...createInput(),
        answerStatus: "insufficient_evidence" as "answered",
      })
    ).toThrow(KnowledgeQueryWritebackCaptureError);

    const noCitationsInput = createInput();
    const noCitations = {
      ...noCitationsInput,
      claims: [{ ...noCitationsInput.claims[0], citationRefs: [] }],
    };
    expect(() => createKnowledgeQueryWritebackCapture(noCitations)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );

    const unusedEvidenceInput = createInput();
    const unusedEvidence = {
      ...unusedEvidenceInput,
      evidence: [
        ...unusedEvidenceInput.evidence,
        { ...unusedEvidenceInput.evidence[0], citationRef: "unused-ref" },
      ],
    };
    expect(() => createKnowledgeQueryWritebackCapture(unusedEvidence)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );

    const unknownReferenceInput = createInput();
    const unknownReference = {
      ...unknownReferenceInput,
      claims: [
        {
          ...unknownReferenceInput.claims[0],
          citationRefs: ["unknown-reference"],
        },
      ],
    };
    expect(() => createKnowledgeQueryWritebackCapture(unknownReference)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );
  });

  it("rejects malformed paths, citation hashes, multiline titles, accessors, and sparse arrays", () => {
    const invalidPathInput = createInput();
    const invalidPath = {
      ...invalidPathInput,
      evidence: [{ ...invalidPathInput.evidence[0], sourcePath: "../outside.md" }],
    };
    expect(() => createKnowledgeQueryWritebackCapture(invalidPath)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );

    const invalidCitationInput = createInput();
    const invalidCitation = {
      ...invalidCitationInput,
      evidence: [
        {
          ...invalidCitationInput.evidence[0],
          citation: {
            ...invalidCitationInput.evidence[0].citation,
            locator: {
              ...invalidCitationInput.evidence[0].citation.locator,
              quoteHash: "b".repeat(64),
            },
          },
        },
      ],
    };
    expect(() => createKnowledgeQueryWritebackCapture(invalidCitation)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );

    expect(() =>
      createKnowledgeQueryWritebackCapture({ ...createInput(), title: "Two\nlines" })
    ).toThrow(KnowledgeQueryWritebackCaptureError);

    const accessor = createInput() as KnowledgeQueryWritebackCaptureInput & { title: string };
    Object.defineProperty(accessor, "title", { enumerable: true, get: () => "Hidden getter" });
    expect(() => createKnowledgeQueryWritebackCapture(accessor)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );

    const sparse = { ...createInput(), claims: new Array(1) };
    expect(() => createKnowledgeQueryWritebackCapture(sparse)).toThrow(
      KnowledgeQueryWritebackCaptureError
    );
  });
});
