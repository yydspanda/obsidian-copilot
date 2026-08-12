import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, KnowledgeChangeSet, SourceLocator } from "@/knowledge/model/types";
import {
  createKnowledgeReviewEvidenceProjection,
  createKnowledgeReviewEvidenceRef,
  KNOWLEDGE_REVIEW_EVIDENCE_LIMITS,
  KnowledgeReviewEvidenceRequestError,
  resolveKnowledgeReviewEvidenceCitation,
  snapshotKnowledgeReviewEvidenceOpenRequest,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import { sha256 } from "@/utils/hash";

const DIGEST = "a".repeat(64);
const SNAPSHOT = "b".repeat(64);

/** Creates one valid locator around an exact location subtype. */
function createLocator(
  location: SourceLocator = {
    kind: "markdown_lines",
    sourceId: "source-1",
    artifactId: "artifact-private",
    artifactContentHash: "c".repeat(64),
    excerpt: "bounded evidence",
    quoteHash: createQuoteHash("bounded evidence"),
    startLine: 2,
    endLine: 3,
    heading: "Evidence",
  }
): SourceLocator {
  return location;
}

/** Creates one citation whose private locator may be varied by a test. */
function createCitation(
  citationId: string,
  locator: SourceLocator = createLocator()
): ClaimCitation {
  return {
    citationId,
    claimId: `claim-${citationId}`,
    relation: "supports",
    locator,
  };
}

/** Creates a semantically valid proposed ChangeSet for resolver tests. */
function createProposal(citations: ClaimCitation[]): KnowledgeChangeSet {
  const afterContent = "# Generated\n";
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: "change-1",
        operation: "create",
        path: "Wiki/Generated.md",
        sourceRefs: ["source-1"],
        reason: "Create one generated page",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 10,
  };
}

describe("createKnowledgeReviewEvidenceRef", () => {
  it("binds a raw opaque SHA-256 reference to namespace, proposal, and citation id", () => {
    expect(createKnowledgeReviewEvidenceRef(DIGEST, "citation-1")).toBe(
      sha256(`knowledge-review-evidence-v1\n${DIGEST}\ncitation-1`)
    );
    expect(createKnowledgeReviewEvidenceRef(DIGEST, "citation-1")).not.toBe(
      createKnowledgeReviewEvidenceRef("d".repeat(64), "citation-1")
    );
    expect(() => createKnowledgeReviewEvidenceRef("not-a-digest", "citation-1")).toThrow(
      KnowledgeReviewEvidenceRequestError
    );
  });
});

describe("createKnowledgeReviewEvidenceProjection", () => {
  it("emits only bounded display metadata and freezes every evidence object", () => {
    const excerpt = `${"x".repeat(KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxExcerptLength - 1)}😀tail`;
    const citation = createCitation(
      "citation-1",
      createLocator({
        kind: "markdown_lines",
        sourceId: "source-1",
        artifactId: "artifact-private",
        artifactContentHash: "c".repeat(64),
        excerpt,
        quoteHash: createQuoteHash(excerpt),
        startLine: 4,
        endLine: 8,
        heading: "Bounded",
      })
    );

    const result = createKnowledgeReviewEvidenceProjection([citation], DIGEST);

    expect(result.evidence).toHaveLength(1);
    expect(result.omittedEvidenceCount).toBe(0);
    expect(result.evidence[0]).toEqual({
      evidenceRef: createKnowledgeReviewEvidenceRef(DIGEST, "citation-1"),
      relation: "supports",
      excerpt: "x".repeat(KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxExcerptLength - 1),
      truncated: true,
      location: {
        kind: "markdown_lines",
        startLine: 4,
        endLine: 8,
        heading: "Bounded",
        headingTruncated: false,
      },
    });
    expect(result.evidence[0]).not.toHaveProperty("citationId");
    expect(result.evidence[0]).not.toHaveProperty("claimId");
    expect(result.evidence[0]).not.toHaveProperty("locator");
    expect(result.evidence[0]).not.toHaveProperty("path");
    expect(result.evidence[0]).not.toHaveProperty("sourceId");
    expect(JSON.stringify(result)).not.toContain("artifact-private");
    expect(JSON.stringify(result)).not.toContain("artifactContentHash");
    expect(JSON.stringify(result)).not.toContain("quoteHash");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(Object.isFrozen(result.evidence[0])).toBe(true);
    expect(Object.isFrozen(result.evidence[0].location)).toBe(true);
  });

  it("preserves safe location variants without actionable locator material", () => {
    const base = {
      sourceId: "source-1",
      artifactId: "artifact-private",
      artifactContentHash: "c".repeat(64),
      excerpt: "evidence",
      quoteHash: createQuoteHash("evidence"),
    };
    const citations = [
      createCitation("heading", { ...base, kind: "heading", heading: "Topic", occurrence: 2 }),
      createCitation("pdf", { ...base, kind: "pdf_page", page: 7 }),
      createCitation("quote", { ...base, kind: "quote", prefix: "private", suffix: "private" }),
    ];

    const result = createKnowledgeReviewEvidenceProjection(citations, DIGEST);

    expect(result.evidence.map((item) => item.location)).toEqual([
      { kind: "heading", heading: "Topic", headingTruncated: false, occurrence: 2 },
      { kind: "pdf_page", page: 7 },
      { kind: "quote" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("omits source identity and bounds headings without splitting a surrogate pair", () => {
    const heading = `${"h".repeat(KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength - 1)}😀tail`;
    const sourceId = `source-${"s".repeat(1_000_000)}`;
    const result = createKnowledgeReviewEvidenceProjection(
      [
        createCitation("bounded-heading", {
          kind: "heading",
          sourceId,
          artifactId: "artifact-private",
          artifactContentHash: "c".repeat(64),
          excerpt: "evidence",
          quoteHash: createQuoteHash("evidence"),
          heading,
          occurrence: 1,
        }),
      ],
      DIGEST
    );

    expect(result.evidence[0].location).toEqual({
      kind: "heading",
      heading: "h".repeat(KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength - 1),
      headingTruncated: true,
      occurrence: 1,
    });
    expect(JSON.stringify(result)).not.toContain(sourceId);
    expect(JSON.stringify(result)).not.toContain("😀tail");
  });

  it("caps the evidence count and reports every omitted citation explicitly", () => {
    const citations = Array.from(
      { length: KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxSummaries + 3 },
      (_, index) => createCitation(`citation-${index}`)
    );

    const result = createKnowledgeReviewEvidenceProjection(citations, DIGEST);

    expect(result.evidence).toHaveLength(KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxSummaries);
    expect(result.omittedEvidenceCount).toBe(3);
  });
});

describe("snapshotKnowledgeReviewEvidenceOpenRequest", () => {
  it("captures a detached frozen exact identity-only request", () => {
    const request = {
      changeSetId: "changeset-1",
      proposalDigest: DIGEST,
      expectedSnapshotToken: SNAPSHOT,
      evidenceRef: "c".repeat(64),
    };

    const captured = snapshotKnowledgeReviewEvidenceOpenRequest(request);

    expect(captured).toEqual(request);
    expect(captured).not.toBe(request);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it("rejects extra keys, accessors, non-canonical identifiers, and invalid hashes", () => {
    const valid = {
      changeSetId: "changeset-1",
      proposalDigest: DIGEST,
      expectedSnapshotToken: SNAPSHOT,
      evidenceRef: "c".repeat(64),
    };
    const accessor = { ...valid };
    Object.defineProperty(accessor, "evidenceRef", {
      enumerable: true,
      get: () => "c".repeat(64),
    });

    expect(() =>
      snapshotKnowledgeReviewEvidenceOpenRequest({ ...valid, path: "private.md" })
    ).toThrow(KnowledgeReviewEvidenceRequestError);
    expect(() => snapshotKnowledgeReviewEvidenceOpenRequest(accessor)).toThrow(
      KnowledgeReviewEvidenceRequestError
    );
    expect(() =>
      snapshotKnowledgeReviewEvidenceOpenRequest({ ...valid, changeSetId: " changeset-1" })
    ).toThrow(KnowledgeReviewEvidenceRequestError);
    expect(() =>
      snapshotKnowledgeReviewEvidenceOpenRequest({ ...valid, evidenceRef: "invalid" })
    ).toThrow(KnowledgeReviewEvidenceRequestError);
  });
});

describe("resolveKnowledgeReviewEvidenceCitation", () => {
  it("re-proves and returns only a detached deeply frozen visible citation", () => {
    const citation = createCitation("citation-1");
    const proposal = createProposal([citation]);
    const proposalDigest = createKnowledgeChangeSetDigest(proposal);
    const evidenceRef = createKnowledgeReviewEvidenceRef(proposalDigest, citation.citationId);

    const resolved = resolveKnowledgeReviewEvidenceCitation(proposal, proposalDigest, evidenceRef);

    expect(resolved).toEqual(citation);
    expect(resolved).not.toBe(citation);
    expect(resolved?.locator).not.toBe(citation.locator);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved?.locator)).toBe(true);
  });

  it("fails closed for stale, invalid, ambiguous, and omitted citation authority", () => {
    const citations = Array.from(
      { length: KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxSummaries + 1 },
      (_, index) => createCitation(`citation-${index}`)
    );
    const proposal = createProposal(citations);
    const digest = createKnowledgeChangeSetDigest(proposal);
    const visibleRef = createKnowledgeReviewEvidenceRef(digest, citations[0].citationId);
    const omittedRef = createKnowledgeReviewEvidenceRef(
      digest,
      citations[citations.length - 1].citationId
    );
    const stale = { ...proposal, createdAt: proposal.createdAt + 1 };
    const ambiguous = createProposal([createCitation("duplicate"), createCitation("duplicate")]);
    const ambiguousDigest = createKnowledgeChangeSetDigest(ambiguous);

    expect(resolveKnowledgeReviewEvidenceCitation(stale, digest, visibleRef)).toBeUndefined();
    expect(resolveKnowledgeReviewEvidenceCitation(proposal, digest, omittedRef)).toBeUndefined();
    expect(
      resolveKnowledgeReviewEvidenceCitation(
        { ...proposal, status: "accepted" },
        digest,
        visibleRef
      )
    ).toBeUndefined();
    expect(
      resolveKnowledgeReviewEvidenceCitation(
        ambiguous,
        ambiguousDigest,
        createKnowledgeReviewEvidenceRef(ambiguousDigest, "duplicate")
      )
    ).toBeUndefined();
  });
});
