import {
  createKnowledgeProductionCompileInput,
  KnowledgeProductionCompileInputError,
} from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import type { CompilerAnalysisRequest } from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import type { KnowledgeAuthorizedCompilePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  createKnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  type SourceArtifactObservation,
  validateSourceLocatorAgainstArtifact,
} from "@/knowledge/model/locatorMaterialValidation";
import type { GeneratedPageReference, SourceManifest } from "@/knowledge/model/types";

const SOURCE_ID = "source-primary";
const SCHEMA_CONTENT = "# Knowledge schema\n";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** Creates one valid source compilation snapshot with caller-selected pages. */
function createLastSuccessful(generatedPages: GeneratedPageReference[]) {
  return {
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    generatedPages,
    changeSetId: "changeset-previous",
    completedAt: 40,
  };
}

/** Creates a complete plain preparation fixture for pure input derivation. */
function createPreparation(
  artifacts: readonly SourceArtifactObservation[],
  manifest?: SourceManifest
): Readonly<KnowledgeAuthorizedCompilePreparation> {
  return {
    operation: "ingest",
    bundle: {
      version: 1,
      id: "personal",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Schema/knowledge.md",
      reviewMode: "always",
    },
    manifest:
      manifest ??
      ({
        version: 1,
        bundleId: "personal",
        revision: 3,
        entries: [
          {
            sourceId: SOURCE_ID,
            sourceKey: "sources/primary.md",
            sourcePath: "Sources/Primary.md",
            custody: "user_managed",
          },
        ],
      } satisfies SourceManifest),
    schema: {
      path: "Schema/knowledge.md",
      content: SCHEMA_CONTENT,
      contentHash: createFileContentHash(SCHEMA_CONTENT),
    },
    source: {
      sourceId: SOURCE_ID,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
    },
    artifacts,
  };
}

/** Creates one plain text artifact with a valid exact content hash. */
function createTextArtifact(text = "Exact primary source text"): SourceArtifactObservation {
  return {
    kind: "text",
    sourceId: SOURCE_ID,
    artifactId: "text",
    artifactContentHash: createFileContentHash(text),
    text,
  };
}

describe("createKnowledgeProductionCompileInput", () => {
  it("derives deterministic complete evidence for text, Markdown, and PDF artifacts", () => {
    const markdownText = "# Heading\r\nGrounded Markdown\r\n";
    const textArtifact = createTextArtifact();
    const markdownArtifact: SourceArtifactObservation = {
      kind: "markdown",
      sourceId: SOURCE_ID,
      artifactId: "markdown",
      artifactContentHash: createFileContentHash(markdownText),
      text: markdownText,
      headings: [{ heading: "Heading", occurrence: 1, startLine: 1, endLine: 3 }],
    };
    const pdfArtifact: SourceArtifactObservation = {
      kind: "pdf",
      sourceId: SOURCE_ID,
      artifactId: "pdf",
      artifactContentHash: HASH_A,
      pages: [
        { page: 2, text: "Second page" },
        { page: 1, text: "First page" },
        { page: 3, text: "   " },
      ],
    };
    const input = createKnowledgeProductionCompileInput(
      createPreparation([textArtifact, pdfArtifact, markdownArtifact]),
      42
    );
    const reordered = createKnowledgeProductionCompileInput(
      createPreparation([markdownArtifact, textArtifact, pdfArtifact]),
      42
    );

    expect(input.createdAt).toBe(42);
    expect(input.contextPages).toEqual([]);
    expect(reordered.evidence).toEqual(input.evidence);
    expect(input.evidence.map(({ evidenceId, locator }) => [evidenceId, locator.kind])).toEqual([
      ["evidence-0001", "markdown_lines"],
      ["evidence-0002", "pdf_page"],
      ["evidence-0003", "pdf_page"],
      ["evidence-0004", "quote"],
    ]);
    expect(input.evidence[0]?.locator).toMatchObject({ startLine: 1, endLine: 3 });
    expect(input.evidence[1]?.locator).toMatchObject({ page: 1, excerpt: "First page" });
    expect(input.evidence[2]?.locator).toMatchObject({ page: 2, excerpt: "Second page" });
    for (const evidence of input.evidence) {
      const artifact = input.artifacts.find(
        (candidate) => candidate.artifactId === evidence.locator.artifactId
      );
      expect(artifact).toBeDefined();
      expect(validateSourceLocatorAgainstArtifact(evidence.locator, artifact!)).toEqual({
        valid: true,
        diagnostics: [],
      });
    }
  });

  it("derives write-only grounded authority from all exact Manifest page owners", () => {
    const personalHash = createFileContentHash("personal page");
    const sharedHash = createFileContentHash("shared page");
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 4,
      entries: [
        {
          sourceId: SOURCE_ID,
          sourceKey: "sources/primary.md",
          sourcePath: "Sources/Primary.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful([
            { path: "Wiki/Shared.md", ownership: "shared", contentHash: sharedHash },
            { path: "Wiki/Personal.md", ownership: "generated", contentHash: personalHash },
          ]),
        },
        {
          sourceId: "source-other",
          sourceKey: "sources/other.md",
          sourcePath: "Sources/Other.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful([
            { path: "Wiki/Shared.md", ownership: "shared", contentHash: sharedHash },
          ]),
        },
      ],
    };

    const input = createKnowledgeProductionCompileInput(
      createPreparation([createTextArtifact()], manifest),
      43
    );

    expect(input.targetAuthorizations).toEqual([
      {
        path: "Wiki/Personal.md",
        allowedIntents: ["write"],
        contentPolicy: "grounded",
        ownership: "generated",
        sourceRefs: [SOURCE_ID],
        expectedContentHash: personalHash,
      },
      {
        path: "Wiki/Shared.md",
        allowedIntents: ["write"],
        contentPolicy: "grounded",
        ownership: "shared",
        sourceRefs: ["source-other", SOURCE_ID],
        expectedContentHash: sharedHash,
      },
    ]);
  });

  it("rejects a Schema-directed write to another source's managed page before target reads or generation — https://github.com/yydspanda/obsidian-copilot/issues/8", async () => {
    const targetPath = "Wiki/Existing.md";
    const schemaContent = `# Knowledge schema\nEvery ingest must write only ${targetPath}.\n`;
    const preparation = createPreparation([createTextArtifact()]);
    const manifest: SourceManifest = {
      ...preparation.manifest,
      entries: [
        ...preparation.manifest.entries,
        {
          sourceId: "source-other",
          sourceKey: "sources/other.md",
          sourcePath: "Sources/Other.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful([
            {
              path: targetPath,
              ownership: "generated",
              contentHash: createFileContentHash("Other source's accepted page"),
            },
          ]),
        },
      ],
    };
    const beforeManifest = JSON.stringify(manifest);
    const input = createKnowledgeProductionCompileInput(
      {
        ...preparation,
        manifest,
        schema: {
          ...preparation.schema,
          content: schemaContent,
          contentHash: createFileContentHash(schemaContent),
        },
      },
      43
    );
    const analyze = jest.fn(async (request: CompilerAnalysisRequest) => ({
      version: 1,
      summary: "Follow the schema's required target",
      concepts: [],
      entities: [],
      claims: [{ ref: "claim-primary", text: "Exact primary source text" }],
      relations: [],
      citations: [
        {
          claimRef: "claim-primary",
          evidenceId: request.evidence[0].evidenceId,
          relation: "supports",
        },
      ],
      targets: [
        {
          ref: "target-existing",
          path: targetPath,
          intent: "write",
          reason: "The schema requires this target",
          claimRefs: ["claim-primary"],
        },
      ],
    }));
    const generate = jest.fn(async () => {
      throw new Error("Generation must not run without target authority");
    });
    const resolve = jest.fn(async () => {
      throw new Error("Target reads must not run without target authority");
    });
    const validate = jest.fn(async () => {
      throw new Error("Candidate validation must not run without target authority");
    });
    const compiler = new KnowledgeCompiler({
      model: { analyze, generate },
      targetResolver: { resolve },
      candidateValidator: { validate },
    });

    // Schema policy cannot grant one source another source's persisted page authority.
    // https://github.com/yydspanda/obsidian-copilot/issues/8
    expect(input.targetAuthorizations).toEqual([]);
    const result = await compiler.compile(input, new AbortController().signal);

    expect(result).toEqual({
      kind: "failed",
      stage: "analysis",
      retryable: false,
      diagnostics: [
        {
          code: "compiler_target_manifest_authorization_missing",
          severity: "error",
          field: "targets[0].path",
          message:
            "A Manifest-tracked target requires explicit caller-owned authorization even when its file is missing",
        },
      ],
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0].schema.content).toBe(schemaContent);
    expect(generate).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(JSON.stringify(manifest)).toBe(beforeManifest);
  });

  it("uses the active forward-revision head without rewriting the source-applied base", () => {
    const sourceAppliedContentHash = createFileContentHash("source applied");
    const effectiveContentHash = createFileContentHash("forward effective");
    const overlay = createKnowledgeForwardRevisionOverlayEntry({
      bundleId: "personal",
      pagePath: "Wiki/Personal.md",
      sourceId: SOURCE_ID,
      sourceBaseDigest: "c".repeat(64),
      sourceAppliedContentHash,
      previousEffectiveContentHash: sourceAppliedContentHash,
      effectiveContentHash,
      forwardTransactionId: "forward-transaction-1",
      acceptedDecisionDigest: "d".repeat(64),
      forwardLedgerIdentityDigest: "e".repeat(64),
      appliedAt: 50,
    });
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 5,
      entries: [
        {
          sourceId: SOURCE_ID,
          sourceKey: "sources/primary.md",
          sourcePath: "Sources/Primary.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful([
            {
              path: "Wiki/Personal.md",
              ownership: "generated",
              contentHash: sourceAppliedContentHash,
            },
          ]),
        },
      ],
      extensions: {
        [KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]: {
          version: 2,
          kind: "forward_revision_overlay_extension",
          entries: [overlay],
        },
      },
    };

    const input = createKnowledgeProductionCompileInput(
      createPreparation([createTextArtifact()], manifest),
      51
    );

    expect(input.targetAuthorizations[0]?.expectedContentHash).toBe(effectiveContentHash);
    expect(manifest.entries[0].lastSuccessful?.generatedPages[0].contentHash).toBe(
      sourceAppliedContentHash
    );
  });

  it("fails closed for empty material, absent primary authority, missing hashes, and bounds", () => {
    expect(() =>
      createKnowledgeProductionCompileInput(createPreparation([createTextArtifact(" ")]), 1)
    ).toThrow(KnowledgeProductionCompileInputError);
    expect(() =>
      createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact()], {
          version: 1,
          bundleId: "personal",
          revision: 1,
          entries: [],
        }),
        1
      )
    ).toThrow(KnowledgeProductionCompileInputError);

    const missingHashManifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 1,
      entries: [
        {
          sourceId: SOURCE_ID,
          sourceKey: "sources/primary.md",
          sourcePath: "Sources/Primary.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful([
            { path: "Wiki/Unhashed.md", ownership: "generated" },
          ]),
        },
      ],
    };
    expect(() =>
      createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact()], missingHashManifest),
        1
      )
    ).toThrow(KnowledgeProductionCompileInputError);

    const oversizedPdf: SourceArtifactObservation = {
      kind: "pdf",
      sourceId: SOURCE_ID,
      artifactId: "pdf",
      artifactContentHash: HASH_A,
      pages: Array.from({ length: 2_049 }, (_, index) => ({
        page: index + 1,
        text: `page-${index + 1}`,
      })),
    };
    expect(() =>
      createKnowledgeProductionCompileInput(createPreparation([oversizedPdf]), 1)
    ).toThrow(KnowledgeProductionCompileInputError);
    for (const createdAt of [-1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        createKnowledgeProductionCompileInput(createPreparation([createTextArtifact()]), createdAt)
      ).toThrow(KnowledgeProductionCompileInputError);
    }
  });

  it("accepts exact collection bounds and rejects the next item", () => {
    const boundedPdf: SourceArtifactObservation = {
      kind: "pdf",
      sourceId: SOURCE_ID,
      artifactId: "pdf",
      artifactContentHash: HASH_A,
      pages: Array.from({ length: 2_048 }, (_, index) => ({
        page: index + 1,
        text: `page-${index + 1}`,
      })),
    };
    expect(
      createKnowledgeProductionCompileInput(createPreparation([boundedPdf]), 1).evidence
    ).toHaveLength(2_048);

    /** Creates one primary-source Manifest with an exact generated-page count. */
    const createManifestWithPages = (count: number): SourceManifest => ({
      version: 1,
      bundleId: "personal",
      revision: 1,
      entries: [
        {
          sourceId: SOURCE_ID,
          sourceKey: "sources/primary.md",
          sourcePath: "Sources/Primary.md",
          custody: "user_managed",
          lastSuccessful: createLastSuccessful(
            Array.from({ length: count }, (_, index) => ({
              path: `Wiki/Page-${String(index + 1).padStart(3, "0")}.md`,
              ownership: "generated",
              contentHash: HASH_A,
            }))
          ),
        },
      ],
    });
    expect(
      createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact()], createManifestWithPages(256)),
        1
      ).targetAuthorizations
    ).toHaveLength(256);
    expect(() =>
      createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact()], createManifestWithPages(257)),
        1
      )
    ).toThrow(KnowledgeProductionCompileInputError);
  });
});
