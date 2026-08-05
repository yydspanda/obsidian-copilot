import type { KnowledgeProjectionValidationInput } from "@/knowledge/changeset/ChangeSetValidator";
import {
  KnowledgeProductionProjectionValidator,
  KnowledgeProductionReviewCandidateValidator,
  KnowledgeProductionSourceArtifactResolver,
} from "@/knowledge/changeset/KnowledgeProductionApplyValidation";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { TextArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type {
  ClaimCitation,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
  SourceLocator,
} from "@/knowledge/model/types";
import type { KnowledgeReviewCandidateValidationInput } from "@/knowledge/review/ReviewDecision";

const SOURCE_ID = "source-1";
const ARTIFACT_ID = "primary";
const SOURCE_TEXT = "The accepted page is grounded in this exact parser artifact.";
const ARTIFACT_HASH = createFileContentHash(SOURCE_TEXT);
const VALIDATION_PASSED: KnowledgeValidationSummary = {
  okfValid: true,
  citationsValid: true,
  linksValid: true,
};
const VALIDATION_PENDING: KnowledgeValidationSummary = {
  okfValid: false,
  citationsValid: false,
  linksValid: false,
};

/** Creates the exact Windows knowledge Bundle used by apply-validator tests. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Schema/knowledge.md",
    reviewMode: "always",
  };
}

/** Creates one parser-owned text artifact with an optionally distinct identity. */
function createArtifact(overrides: Partial<TextArtifactObservation> = {}): TextArtifactObservation {
  return {
    kind: "text",
    sourceId: SOURCE_ID,
    artifactId: ARTIFACT_ID,
    artifactContentHash: ARTIFACT_HASH,
    text: SOURCE_TEXT,
    ...overrides,
  };
}

/** Creates one structurally valid quote locator for the primary artifact. */
function createLocator(excerpt = SOURCE_TEXT): SourceLocator {
  return {
    kind: "quote",
    sourceId: SOURCE_ID,
    artifactId: ARTIFACT_ID,
    artifactContentHash: ARTIFACT_HASH,
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
}

/** Creates one material citation backed by the primary parser artifact. */
function createCitation(excerpt = SOURCE_TEXT): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: createLocator(excerpt),
  };
}

/** Creates one valid generated OKF concept page. */
function createConceptChange(
  afterContent = `---\ntype: topic\ntitle: Apply Validation\ntags: [knowledge]\nconfidence: 0.9\n---\n\n# Apply Validation\n\n${SOURCE_TEXT}\n`,
  path = "Wiki/Apply Validation.md"
): Extract<KnowledgeFileChange, { operation: "create" }> {
  return {
    id: `change-${createFileContentHash(path).slice(0, 12)}`,
    operation: "create",
    path,
    sourceRefs: [SOURCE_ID],
    reason: "Create one grounded knowledge page",
    expectedAbsent: true,
    afterContent,
    afterHash: createFileContentHash(afterContent),
  };
}

/** Creates one structurally valid delete that production generation must reject. */
function createDeleteChange(): Extract<KnowledgeFileChange, { operation: "delete" }> {
  return {
    id: "change-delete",
    operation: "delete",
    path: "Wiki/Obsolete.md",
    sourceRefs: [SOURCE_ID],
    reason: "Remove an obsolete generated page",
    beforeHash: createFileContentHash("# Obsolete\n"),
  };
}

/** Creates one proposed review ChangeSet around exact supplied material. */
function createChangeSet(
  changes: KnowledgeFileChange[] = [createConceptChange()],
  citations: ClaimCitation[] = [createCitation()],
  validation: KnowledgeValidationSummary = VALIDATION_PASSED
): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes,
    citations,
    validation: { ...validation },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates the exact input passed to deterministic review-time validation. */
function createReviewInput(
  candidate: KnowledgeChangeSet,
  proposal: KnowledgeChangeSet = createChangeSet()
): KnowledgeReviewCandidateValidationInput {
  return {
    proposal,
    candidate,
    proposalDigest: "proposal-digest",
    snapshotToken: "snapshot-token",
    observations: candidate.changes.map((change) =>
      change.operation === "create"
        ? { changeId: change.id, kind: "missing" as const }
        : { changeId: change.id, kind: "file" as const, content: "# Obsolete\n" }
    ),
  };
}

/** Runs one review validation with a live caller-owned cancellation signal. */
async function validateReview(candidate: KnowledgeChangeSet) {
  const validator = new KnowledgeProductionReviewCandidateValidator(createBundle(), [
    createArtifact(),
  ]);
  return validator.validate(createReviewInput(candidate), new AbortController().signal);
}

describe("KnowledgeProductionSourceArtifactResolver", () => {
  it("resolves only the complete source, artifact, and content-hash identity", async () => {
    const exact = createArtifact();
    const resolver = new KnowledgeProductionSourceArtifactResolver([
      exact,
      createArtifact({ artifactId: "secondary" }),
    ]);

    await expect(resolver.resolve(createLocator())).resolves.toBe(exact);
    await expect(
      resolver.resolve({ ...createLocator(), artifactContentHash: "f".repeat(64) })
    ).resolves.toBeNull();
  });

  it("returns null when duplicate artifacts make an exact identity ambiguous", async () => {
    const artifact = createArtifact();
    const resolver = new KnowledgeProductionSourceArtifactResolver([artifact, { ...artifact }]);

    await expect(resolver.resolve(createLocator())).resolves.toBeNull();
  });
});

describe("KnowledgeProductionReviewCandidateValidator", () => {
  it("accepts a valid selected create with exact parser-backed citation material", async () => {
    const candidate = createChangeSet(undefined, undefined, VALIDATION_PENDING);

    await expect(validateReview(candidate)).resolves.toEqual({
      validation: VALIDATION_PASSED,
      diagnostics: [],
    });
  });

  it("rejects a citation whose excerpt is absent from the exact artifact", async () => {
    const citation = createCitation("Material absent from the parser artifact");
    const result = await validateReview(createChangeSet(undefined, [citation], VALIDATION_PENDING));

    expect(result.validation).toEqual({
      okfValid: true,
      citationsValid: false,
      linksValid: true,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_locator_excerpt_missing" }),
    ]);
  });

  it("rejects selected Markdown containing an unsupported outbound link", async () => {
    const linked = createConceptChange("---\ntype: topic\n---\n\n# Linked\n\n[[Another Page]]\n");
    const result = await validateReview(createChangeSet([linked], undefined, VALIDATION_PENDING));

    expect(result.validation).toEqual({
      okfValid: true,
      citationsValid: true,
      linksValid: false,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_links_unsupported" }),
    ]);
  });

  it("rejects a selected delete before it can become an apply candidate", async () => {
    const result = await validateReview(
      createChangeSet([createDeleteChange()], undefined, VALIDATION_PENDING)
    );

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: true,
      linksValid: true,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_delete_unsupported" }),
    ]);
  });
});

describe("KnowledgeProductionProjectionValidator", () => {
  it("recomputes projected OKF and link failures from exact transaction changes", async () => {
    const linked = createConceptChange(
      "---\ntype: topic\n---\n\n# Linked\n\nhttps://example.com/reference\n"
    );
    const changeSet = createChangeSet([linked, createDeleteChange()]);
    const input: KnowledgeProjectionValidationInput = {
      bundle: createBundle(),
      changeSet: { ...changeSet, status: "accepted" },
      targets: [],
    };

    await expect(new KnowledgeProductionProjectionValidator().validate(input)).resolves.toEqual({
      okfValid: false,
      linksValid: false,
      diagnostics: [
        expect.objectContaining({ code: "production_candidate_links_unsupported" }),
        expect.objectContaining({ code: "production_candidate_delete_unsupported" }),
      ],
    });
  });
});
