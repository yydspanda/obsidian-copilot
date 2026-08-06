import {
  createInsufficientKnowledgeGroundedAnswer,
  createKnowledgeGroundedAnswerRequest,
  KnowledgeGroundedAnswerError,
  parseKnowledgeGroundedAnswerModelOutput,
} from "@/knowledge/query/KnowledgeGroundedAnswer";

const PAGE_HASH = "a".repeat(64);

/** Creates one authentic request containing two exact source excerpts. */
function createRequest() {
  return createKnowledgeGroundedAnswerRequest(
    "What does the knowledge system do?",
    [
      {
        contextId: "context-1",
        pagePath: "Wiki/System.md",
        pageContentHash: PAGE_HASH,
        heading: "System",
        headingPath: ["Knowledge", "System"],
        content: "The system compiles reviewed knowledge.",
      },
    ],
    [
      {
        evidenceId: "evidence-1",
        contextId: "context-1",
        sourceExcerpt: "Every generated update requires review.",
        sourceRelation: "supports",
      },
      {
        evidenceId: "evidence-2",
        contextId: "context-1",
        sourceExcerpt: "Review state survives restart.",
        sourceRelation: "context",
      },
    ]
  );
}

/** Produces one valid mixed fact-and-inference response for an exact request. */
function createOutput(request = createRequest()): string {
  return JSON.stringify({
    version: 1,
    contextDigest: request.contextDigest,
    status: "answered",
    claims: [
      {
        claimId: "claim-review",
        kind: "source_fact",
        text: "Generated updates require review.",
        evidenceIds: ["evidence-1"],
      },
      {
        claimId: "claim-durable",
        kind: "inference",
        text: "This implies review can continue after a restart.",
        evidenceIds: ["evidence-1", "evidence-2"],
      },
    ],
    insufficientEvidence: [],
  });
}

describe("KnowledgeGroundedAnswer", () => {
  it("captures a frozen request and validates every answer evidence id", () => {
    const request = createRequest();
    const answer = parseKnowledgeGroundedAnswerModelOutput(createOutput(request), request);

    expect(request.contextDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(answer).toEqual({
      version: 1,
      contextDigest: request.contextDigest,
      status: "answered",
      claims: [
        {
          claimId: "claim-review",
          kind: "source_fact",
          text: "Generated updates require review.",
          evidenceIds: ["evidence-1"],
        },
        {
          claimId: "claim-durable",
          kind: "inference",
          text: "This implies review can continue after a restart.",
          evidenceIds: ["evidence-1", "evidence-2"],
        },
      ],
      insufficientEvidence: [],
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.contexts)).toBe(true);
    expect(Object.isFrozen(request.evidence[0])).toBe(true);
    expect(Object.isFrozen(answer)).toBe(true);
    expect(Object.isFrozen(answer.claims[0].evidenceIds)).toBe(true);
  });

  it("rejects cross-query response splicing and evidence not sent to the model", () => {
    const request = createRequest();
    const wrongDigest = JSON.parse(createOutput(request)) as Record<string, unknown>;
    wrongDigest.contextDigest = "b".repeat(64);
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(wrongDigest), request)
    ).toThrow(KnowledgeGroundedAnswerError);

    const unknownEvidence = JSON.parse(createOutput(request)) as {
      claims: Array<{ evidenceIds: string[] }>;
    };
    unknownEvidence.claims[0].evidenceIds = ["evidence-never-read"];
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(unknownEvidence), request)
    ).toThrow(KnowledgeGroundedAnswerError);
  });

  it("rejects duplicate ids, extra fields, and invalid status semantics", () => {
    const request = createRequest();
    const duplicate = JSON.parse(createOutput(request)) as {
      claims: Array<{ claimId: string; evidenceIds: string[] }>;
    };
    duplicate.claims[1].claimId = duplicate.claims[0].claimId;
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(duplicate), request)
    ).toThrow(KnowledgeGroundedAnswerError);

    const duplicateEvidence = JSON.parse(createOutput(request)) as {
      claims: Array<{ evidenceIds: string[] }>;
    };
    duplicateEvidence.claims[0].evidenceIds = ["evidence-1", "evidence-1"];
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(duplicateEvidence), request)
    ).toThrow(KnowledgeGroundedAnswerError);

    const extra = JSON.parse(createOutput(request)) as Record<string, unknown>;
    extra.answer = "uncited escape hatch";
    expect(() => parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(extra), request)).toThrow(
      KnowledgeGroundedAnswerError
    );

    const invalidStatus = JSON.parse(createOutput(request)) as Record<string, unknown>;
    invalidStatus.status = "insufficient_evidence";
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(JSON.stringify(invalidStatus), request)
    ).toThrow(KnowledgeGroundedAnswerError);
  });

  it("supports partial and deterministic insufficient-evidence results", () => {
    const request = createRequest();
    const partial = parseKnowledgeGroundedAnswerModelOutput(
      JSON.stringify({
        version: 1,
        contextDigest: request.contextDigest,
        status: "partial",
        claims: [
          {
            claimId: "claim-partial",
            kind: "source_fact",
            text: "Generated updates require review.",
            evidenceIds: ["evidence-1"],
          },
        ],
        insufficientEvidence: ["No evidence states how long review takes."],
      }),
      request
    );
    expect(partial.status).toBe("partial");

    const emptyRequest = createKnowledgeGroundedAnswerRequest("Unknown?", [], []);
    expect(createInsufficientKnowledgeGroundedAnswer(emptyRequest.contextDigest)).toEqual({
      version: 1,
      contextDigest: emptyRequest.contextDigest,
      status: "insufficient_evidence",
      claims: [],
      insufficientEvidence: ["No current source-backed applied Wiki excerpt supports an answer."],
    });
  });

  it("requires source evidence for every visible context and rejects forged requests", () => {
    expect(() =>
      createKnowledgeGroundedAnswerRequest(
        "Question",
        [
          {
            contextId: "context-1",
            pagePath: "Wiki/System.md",
            pageContentHash: PAGE_HASH,
            heading: "System",
            headingPath: [],
            content: "Context without source evidence.",
          },
        ],
        []
      )
    ).toThrow(KnowledgeGroundedAnswerError);

    const request = createRequest();
    expect(() =>
      parseKnowledgeGroundedAnswerModelOutput(createOutput(request), { ...request })
    ).toThrow(KnowledgeGroundedAnswerError);
  });
});
