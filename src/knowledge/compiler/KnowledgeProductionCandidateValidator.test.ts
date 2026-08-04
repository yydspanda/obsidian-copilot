import type {
  CompilerBoundTarget,
  CompilerCandidateValidationInput,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeProductionCandidateValidator } from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { ClaimCitation, KnowledgeFileChange } from "@/knowledge/model/types";

const SOURCE_ID = "source-1";
const SOURCE_TEXT = "The production validator grounds this exact durable fact.";
const ARTIFACT_ID = "primary";
const ARTIFACT_HASH = createFileContentHash(SOURCE_TEXT);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const TARGET_SET_DIGEST = "c".repeat(64);
const SCHEMA_CONTENT = "Generated pages use bounded OKF Markdown without links.";

/** Creates one exact material citation backed by the primary text artifact. */
function createCitation(excerpt = SOURCE_TEXT): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId: SOURCE_ID,
      artifactId: ARTIFACT_ID,
      artifactContentHash: ARTIFACT_HASH,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
    },
  };
}

/** Creates one generated concept page with valid OKF frontmatter. */
function createConceptChange(
  afterContent = "---\ntype: topic\ntitle: Production Validator\ntags: [knowledge]\nconfidence: 0.9\n---\n\n# Production Validator\n\nThe production validator grounds this exact durable fact.\n",
  path = "Wiki/Production Validator.md"
): Extract<KnowledgeFileChange, { operation: "create" }> {
  return {
    id: `change-${createFileContentHash(path).slice(0, 12)}`,
    path,
    sourceRefs: [SOURCE_ID],
    reason: "Compile one source-backed concept",
    operation: "create",
    expectedAbsent: true,
    afterContent,
    afterHash: createFileContentHash(afterContent),
  };
}

/** Creates a bound create target corresponding to one generated change. */
function createTarget(
  change: Extract<KnowledgeFileChange, { operation: "create" }>
): CompilerBoundTarget {
  return {
    targetId: `target-${change.id}`,
    path: change.path,
    intent: "write",
    reason: change.reason,
    claimIds: ["claim-1"],
    sourceRefs: [...change.sourceRefs],
    access: "create_only",
    contentPolicy: "grounded",
    ownership: "new",
    operation: "create",
  };
}

/** Creates a complete strict candidate-validation input for supplied file changes. */
function createInput(
  changes: KnowledgeFileChange[] = [createConceptChange()],
  citations: ClaimCitation[] = [createCitation()]
): CompilerCandidateValidationInput {
  const targets: CompilerBoundTarget[] = changes.map((change) => {
    if (change.operation === "create") return createTarget(change);
    return {
      targetId: `target-${change.id}`,
      path: change.path,
      intent: change.operation === "delete" ? "delete" : "write",
      reason: change.reason,
      claimIds: ["claim-1"],
      sourceRefs: [...change.sourceRefs],
      access: "authorized",
      contentPolicy: "grounded",
      ownership: "generated",
      expectedContentHash: change.beforeHash,
      operation: change.operation,
      beforeContent: "# Existing\n",
      beforeHash: createFileContentHash("# Existing\n"),
    };
  });
  return {
    bundle: {
      version: 1,
      id: "personal",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Schema/knowledge.md",
      reviewMode: "always",
    },
    source: {
      sourceId: SOURCE_ID,
      sourceContentHash: createSourceContentHash(SOURCE_TEXT),
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    schema: {
      path: "Schema/knowledge.md",
      content: SCHEMA_CONTENT,
      contentHash: createFileContentHash(SCHEMA_CONTENT),
    },
    artifacts: [
      {
        kind: "text",
        sourceId: SOURCE_ID,
        artifactId: ARTIFACT_ID,
        artifactContentHash: ARTIFACT_HASH,
        text: SOURCE_TEXT,
      },
    ],
    contextPages: [],
    analysis: {
      version: 1,
      summary: "Compile one exact fact",
      concepts: [{ id: "concept-1", name: "Production validation" }],
      entities: [],
      claims: [{ id: "claim-1", text: SOURCE_TEXT }],
      relations: [],
      citations,
      targets: targets.map((target) => ({
        targetId: target.targetId,
        path: target.path,
        intent: target.intent,
        reason: target.reason,
        claimIds: [...target.claimIds],
        sourceRefs: [...target.sourceRefs],
        access: target.access,
        contentPolicy: target.contentPolicy,
        ownership: target.ownership,
        ...(target.expectedContentHash === undefined
          ? {}
          : { expectedContentHash: target.expectedContentHash }),
      })),
    },
    targetSetDigest: TARGET_SET_DIGEST,
    targets,
    draft: {
      id: "changeset-production-validator",
      bundleId: "personal",
      operation: "ingest",
      sourceRefs: [SOURCE_ID],
      changes,
      citations,
      createdAt: 100,
    },
  };
}

/** Runs the stateless validator with one live, caller-owned signal. */
async function validate(input: CompilerCandidateValidationInput) {
  return new KnowledgeProductionCandidateValidator().validate(input, new AbortController().signal);
}

describe("KnowledgeProductionCandidateValidator", () => {
  it("validates a strict concept page and its exact material citation", async () => {
    await expect(validate(createInput())).resolves.toEqual({
      validation: { okfValid: true, citationsValid: true, linksValid: true },
      diagnostics: [],
    });
  });

  it("selects index and log OKF kinds from paths relative to the Wiki root", async () => {
    const index = createConceptChange(
      '---\nokfVersion: "0.1"\n---\n\n# Personal Wiki\n',
      "Wiki/index.md"
    );
    const log = createConceptChange("# Knowledge Log\n", "Wiki/history/log.md");

    await expect(validate(createInput([index, log]))).resolves.toEqual({
      validation: { okfValid: true, citationsValid: true, linksValid: true },
      diagnostics: [],
    });
  });

  it("rejects a regular page without the required type frontmatter", async () => {
    const result = await validate(createInput([createConceptChange("# Missing type\n")]));

    expect(result.validation).toMatchObject({ okfValid: false, citationsValid: true });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_okf_markdown_invalid" }),
    ]);
  });

  it("fails citation identity when no exact artifact triple exists", async () => {
    const citation = createCitation();
    citation.locator.artifactContentHash = "d".repeat(64);
    const result = await validate(createInput(undefined, [citation]));

    expect(result.validation.citationsValid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "production_candidate_citation_artifact_identity_invalid",
      }),
    ]);
  });

  it("fails a structurally valid locator whose excerpt is absent from exact material", async () => {
    const result = await validate(createInput(undefined, [createCitation("Absent excerpt")]));

    expect(result.validation.citationsValid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_locator_excerpt_missing" }),
    ]);
  });

  it.each([
    "[[Other Page]]",
    "[Other Page](Other%20Page.md)",
    "[Other Page][other]\n\n[other]: Other.md",
    "<https://example.com/reference>",
    "<custom+knowledge:reference>",
    '<a href="https://example.com/reference">External</a>',
    '<img src="https://example.com/reference.png" alt="External">',
    '<form action="/submit">External</form>',
    '<svg><use href="#external"></use></svg>',
    "</style>",
    "https://example.com/reference",
    "ftp://example.com/reference",
    "obsidian://open?vault=Personal",
    "tel:+123456789",
    "data:text/plain,reference",
    "mailto:author@example.com",
    "www.example.com/reference",
    "author@example.com",
  ])("fails closed for unsupported projected link syntax: %s", async (link) => {
    const content = `---\ntype: topic\n---\n\n# Linked\n\n${link}\n`;
    const result = await validate(createInput([createConceptChange(content)]));

    expect(result.validation.linksValid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_links_unsupported" }),
    ]);
  });

  it("rejects a bound target that does not retain its approved analysis projection", async () => {
    const input = createInput();
    input.targets[0].reason = "A different runtime reason";

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "production_candidate_bound_target_projection_invalid",
        field: "targets[0]",
      }),
      expect.objectContaining({
        code: "production_candidate_change_target_mismatch",
        field: "draft.changes[0]",
      }),
    ]);
  });

  it("rejects analysis citations and targets whose claim ids do not exist", async () => {
    const input = createInput();
    input.analysis.citations[0].claimId = "claim-missing";
    input.draft.citations[0].claimId = "claim-missing";
    input.analysis.targets[0].claimIds = ["claim-also-missing"];
    input.targets[0].claimIds = ["claim-also-missing"];

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "production_candidate_analysis_citation_claim_unknown",
      "production_candidate_analysis_target_claim_unknown",
    ]);
  });

  it("rejects draft citations that differ from the approved analysis citations", async () => {
    const input = createInput();
    input.draft.citations = input.draft.citations.map((citation) => ({
      ...citation,
      relation: "context",
    }));

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "production_candidate_draft_citations_mismatch",
        field: "draft.citations",
      }),
    ]);
  });

  it("rejects a draft change that does not retain its exact bound target", async () => {
    const input = createInput();
    input.draft.changes[0].reason = "A different draft reason";

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "production_candidate_change_target_mismatch",
        field: "draft.changes[0]",
      }),
    ]);
  });

  it("requires the canonical primary, change, and citation source-reference union", async () => {
    const input = createInput();
    input.draft.sourceRefs.push("source-unrelated");

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "production_candidate_source_refs_mismatch",
        field: "draft.sourceRefs",
      }),
    ]);
  });

  it("rejects delete candidates before any projected mutation can exist", async () => {
    const change: Extract<KnowledgeFileChange, { operation: "delete" }> = {
      id: "change-delete",
      path: "Wiki/Existing.md",
      sourceRefs: [SOURCE_ID],
      reason: "Remove an obsolete page",
      operation: "delete",
      beforeHash: createFileContentHash("# Existing\n"),
    };
    const result = await validate(createInput([change]));

    expect(result.validation.okfValid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_delete_unsupported" }),
    ]);
  });

  it("rejects malformed outer input and extra fields through the strict snapshot", async () => {
    const input = { ...createInput(), unexpected: true } as CompilerCandidateValidationInput;
    const result = await validate(input);

    expect(result).toEqual({
      validation: { okfValid: false, citationsValid: false, linksValid: false },
      diagnostics: [
        expect.objectContaining({ code: "production_candidate_input_invalid", field: "input" }),
      ],
    });
  });

  it("does not invoke input accessors or expose their hidden values", async () => {
    const canary = "candidate-accessor-secret-canary";
    let getterCalls = 0;
    const input = Object.defineProperty({ ...createInput() }, "draft", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error(canary);
      },
    });

    const result = await validate(input);

    expect(getterCalls).toBe(0);
    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("sanitizes YAML failures without copying generated material", async () => {
    const canary = "yaml-generated-secret-canary";
    const content = `---\ntype: [unterminated\nprivate: ${canary}\n---\n# Invalid\n`;
    const result = await validate(createInput([createConceptChange(content)]));

    expect(result.validation.okfValid).toBe(false);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "production_candidate_okf_markdown_invalid" }),
    ]);
  });

  it("fails closed when immutable schema or target pre-state hashes drift", async () => {
    const updateContent = "---\ntype: topic\n---\n# Updated\n";
    const update: Extract<KnowledgeFileChange, { operation: "update" }> = {
      id: "change-update",
      path: "Wiki/Existing.md",
      sourceRefs: [SOURCE_ID],
      reason: "Update one generated page",
      operation: "update",
      beforeHash: createFileContentHash("# Existing\n"),
      afterContent: updateContent,
      afterHash: createFileContentHash(updateContent),
    };
    const input = createInput([update]);
    input.schema.contentHash = "e".repeat(64);
    const target = input.targets[0];
    if (target.operation !== "update") throw new Error("Expected an update target");
    target.beforeHash = "f".repeat(64);

    const result = await validate(input);

    expect(result.validation).toEqual({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "production_candidate_schema_hash_mismatch",
      "production_candidate_target_hash_mismatch",
    ]);
  });
});
