import {
  createKnowledgeProductionCompileInput,
  KnowledgeProductionCompileInputError,
} from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import {
  DEFAULT_KNOWLEDGE_COMPILER_LIMITS,
  type CompilerGenerationRequest,
  type CompilerTargetRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import type { KnowledgeAuthorizedCompilePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  createKnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import {
  createFileContentHash,
  createQuoteHash,
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import {
  type SourceArtifactObservation,
  validateSourceLocatorAgainstArtifact,
} from "@/knowledge/model/locatorMaterialValidation";
import type { GeneratedPageReference, SourceManifest } from "@/knowledge/model/types";
import { verifyKnowledgeParsedSource } from "@/knowledge/parser/KnowledgeByteParser";
import { Utf8TextKnowledgeByteParser } from "@/knowledge/parser/Utf8TextKnowledgeByteParser";
import { resolveKnowledgeCitationTarget } from "@/knowledge/query/KnowledgeCitationTargetResolver";

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

describe("KnowledgeProductionCompileInput", () => {
  describe("createKnowledgeProductionCompileInput()", () => {
    it("exposes original and appended paragraphs as separate complete evidence with stable artifact ordering — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const text = "Original observation.\n\nA different condition.\n\nA counterexample.\n";
      const first = { ...createTextArtifact(text), artifactId: "first" };
      const second = { ...createTextArtifact("Independent material."), artifactId: "second" };
      const input = createKnowledgeProductionCompileInput(createPreparation([second, first]), 42);

      expect(input.evidence.map(({ locator }) => locator.excerpt)).toEqual([
        "Original observation.\n\n",
        "A different condition.\n\n",
        "A counterexample.\n",
        "Independent material.",
      ]);
      expect(input.evidence.map(({ evidenceId }) => evidenceId)).toEqual([
        "evidence-0001",
        "evidence-0002",
        "evidence-0003",
        "evidence-0004",
      ]);
      expect(input.evidence).toEqual(
        createKnowledgeProductionCompileInput(createPreparation([first, second]), 42).evidence
      );
      for (const { locator } of input.evidence) {
        const artifact = locator.artifactId === "first" ? first : second;
        expect(locator.artifactContentHash).toBe(artifact.artifactContentHash);
        expect(locator.quoteHash).toBe(createQuoteHash(locator.excerpt));
        expect(validateSourceLocatorAgainstArtifact(locator, artifact)).toEqual({
          valid: true,
          diagnostics: [],
        });
      }
      expect(
        input.evidence
          .slice(0, 3)
          .map(({ locator }) => locator.excerpt)
          .join("")
      ).toBe(text);
    });

    it.each(["\n", "\r\n", "\r"])(
      "preserves BOM, whitespace, Unicode, and all paragraph material across %j line endings — https://github.com/yydspanda/obsidian-copilot/issues/17",
      (newline) => {
        const text = ["\ufeff", " \t", "第一段 🦌", " \t", "第二段 é", "", " \t"].join(newline);
        const artifact = createTextArtifact(text);
        const { evidence } = createKnowledgeProductionCompileInput(
          createPreparation([artifact]),
          1
        );

        expect(evidence).toHaveLength(2);
        expect(evidence.map(({ locator }) => locator.excerpt).join("")).toBe(
          normalizeCitationText(text)
        );
        expect(evidence[0].locator.excerpt.startsWith("\ufeff")).toBe(true);
        for (const { locator } of evidence) {
          expect(locator.artifactContentHash).toBe(createFileContentHash(text));
          expect(validateSourceLocatorAgainstArtifact(locator, artifact).valid).toBe(true);
        }
      }
    );

    it("retains original line endings when one paragraph needs no split — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const text = "\ufeff# Heading\r\nOne paragraph 🦌\r\n";
      const { evidence } = createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact(text)]),
        1
      );
      expect(evidence).toHaveLength(1);
      expect(evidence[0].locator.excerpt).toBe(text);
    });

    it.each([
      [
        "repeated opening paragraphs",
        "Repeated.\n\nFirst context.\n\nRepeated.\n\nSecond context.",
        ["Repeated.\n\nFirst context.\n\n", "Repeated.\n\nSecond context."],
      ],
      [
        "an ambiguous final paragraph",
        "Repeated.\n\nFirst context.\n\nLast context.\n\nRepeated.",
        ["Repeated.\n\n", "First context.\n\n", "Last context.\n\nRepeated."],
      ],
      [
        "repeated paragraphs requiring a complete-artifact locator",
        "Repeated.\n\nRepeated.\n\nRepeated.\n\nRepeated.",
        ["Repeated.\n\nRepeated.\n\nRepeated.\n\nRepeated."],
      ],
    ])(
      "merges %s into uniquely resolvable adjacent quotes without dropping material — https://github.com/yydspanda/obsidian-copilot/issues/17",
      (_name, text, expected) => {
        const artifact = createTextArtifact(text);
        const { evidence } = createKnowledgeProductionCompileInput(
          createPreparation([artifact]),
          1
        );
        expect(evidence.map(({ locator }) => locator.excerpt)).toEqual(expected);
        expect(evidence.map(({ locator }) => locator.excerpt).join("")).toBe(text);
        for (const { locator } of evidence) {
          expect(locator.kind).toBe("quote");
          expect(validateSourceLocatorAgainstArtifact(locator, artifact)).toEqual({
            valid: true,
            diagnostics: [],
          });
        }
      }
    );

    it("keeps Markdown paragraph locators on non-overlapping normalized line ranges — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const text = "# Heading\r\nFirst paragraph.\r\n\r\nRepeated.\r\n\r\nRepeated.";
      const artifact: SourceArtifactObservation = {
        kind: "markdown",
        sourceId: SOURCE_ID,
        artifactId: "markdown",
        artifactContentHash: createFileContentHash(text),
        text,
        headings: [{ heading: "Heading", occurrence: 1, startLine: 1, endLine: 6 }],
      };
      const { evidence } = createKnowledgeProductionCompileInput(createPreparation([artifact]), 1);
      expect(evidence.map(({ locator }) => locator)).toEqual([
        expect.objectContaining({ kind: "markdown_lines", startLine: 1, endLine: 3 }),
        expect.objectContaining({ kind: "markdown_lines", startLine: 4, endLine: 5 }),
        expect.objectContaining({ kind: "markdown_lines", startLine: 6, endLine: 6 }),
      ]);
      expect(evidence.map(({ locator }) => locator.excerpt).join("\n")).toBe(
        normalizeCitationText(text)
      );
      for (const { locator } of evidence) {
        expect(validateSourceLocatorAgainstArtifact(locator, artifact).valid).toBe(true);
      }
      expect(
        resolveKnowledgeCitationTarget({
          sourcePath: "Sources/Primary.md",
          content: text,
          citation: {
            citationId: "citation-1",
            claimId: "claim-1",
            relation: "supports",
            locator: evidence[0].locator,
          },
        })
      ).toMatchObject({
        status: "resolved",
        target: { from: { line: 0, ch: 0 }, to: { line: 2, ch: 0 } },
      });
    });

    it("bounds source scanning for repetitive large text by retaining a complete artifact instead of repeatedly merging long quotes — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const text = Array.from({ length: 256 }, () => "Repeated material. ".repeat(200)).join(
        "\n\n"
      );
      const artifact = createTextArtifact(text);
      // Count inspected source characters instead of asserting machine-dependent
      // elapsed time; the complete result alone would miss the synchronous stall.
      // https://github.com/yydspanda/obsidian-copilot/issues/17
      const indexOf = jest.spyOn(String.prototype, "indexOf");
      try {
        const { evidence } = createKnowledgeProductionCompileInput(
          createPreparation([artifact]),
          1
        );
        expect(evidence).toHaveLength(1);
        expect(evidence[0].locator.excerpt).toBe(text);
        const sourceScans = indexOf.mock.contexts.filter(
          (context: unknown) => context === text
        ).length;
        expect(sourceScans).toBeGreaterThan(0);
        expect(sourceScans * text.length).toBeLessThanOrEqual(
          4 * DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxModelContextCharacters
        );
      } finally {
        indexOf.mockRestore();
      }
    });

    it("accepts the exact paragraph count for line-addressed material and retains complete text on evidence overflow — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const limit = DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxEvidenceItems;
      const paragraphs = Array.from({ length: limit }, (_, index) => `Paragraph ${index}.`);
      const bounded = paragraphs.join("\n\n");
      const boundedMarkdown: SourceArtifactObservation = {
        kind: "markdown",
        sourceId: SOURCE_ID,
        artifactId: "markdown",
        artifactContentHash: createFileContentHash(bounded),
        text: bounded,
        headings: [],
      };
      expect(
        createKnowledgeProductionCompileInput(createPreparation([boundedMarkdown]), 1).evidence
      ).toHaveLength(limit);

      const overflow = `${bounded}\n\nFinal paragraph beyond the evidence budget.`;
      const { evidence } = createKnowledgeProductionCompileInput(
        createPreparation([createTextArtifact(overflow)]),
        1
      );
      expect(evidence).toHaveLength(1);
      expect(evidence[0].locator.excerpt).toBe(overflow);
    });

    it("reserves complete evidence for other artifacts and PDF pages before splitting paragraphs — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const text = "Opening material.\n\nClosing material.";
      const pdf: SourceArtifactObservation = {
        kind: "pdf",
        sourceId: SOURCE_ID,
        artifactId: "z-pdf",
        artifactContentHash: HASH_A,
        pages: Array.from(
          { length: DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxEvidenceItems - 1 },
          (_, index) => ({ page: index + 1, text: `Page ${index + 1}` })
        ),
      };
      const { evidence } = createKnowledgeProductionCompileInput(
        createPreparation([pdf, createTextArtifact(text)]),
        1
      );
      expect(evidence).toHaveLength(DEFAULT_KNOWLEDGE_COMPILER_LIMITS.maxEvidenceItems);
      expect(evidence[0].locator.excerpt).toBe(text);
      expect(evidence[evidence.length - 1].locator).toMatchObject({
        kind: "pdf_page",
        page: pdf.pages.length,
        excerpt: `Page ${pdf.pages.length}`,
      });
    });

    it("passes every production text paragraph to both compiler stages while repeated claims cite only their selected paragraph — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
      const text =
        "# Reading\r\nOriginal claim.\r\n\r\n## Supplement\r\nA limiting counterexample.\r\n";
      const parser = new Utf8TextKnowledgeByteParser({
        id: "utf8-text",
        pathSuffixes: [".md"],
        maxBytes: 1024,
        maxCharacters: 1024,
      });
      const request = {
        sourceId: SOURCE_ID,
        sourcePath: "Sources/Primary.md",
        sourceContentHash: createFileContentHash(text),
        bytes: new TextEncoder().encode(text),
      };
      const signal = new AbortController().signal;
      const parsed = verifyKnowledgeParsedSource(
        await parser.parse(request, signal),
        request,
        1024
      );
      const generate = jest.fn(async (request: CompilerGenerationRequest) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: request.targets.map(({ targetId }) => ({
          targetId,
          outcome: "write",
          afterContent: "# Reading\nA limiting counterexample.\n",
          claims: [
            "The supplement limits the original claim.",
            "The supplement contains a counterexample.",
          ].map((text) => ({
            text,
            evidenceIds: [
              request.evidence.find(({ locator }) => locator.excerpt.includes("Supplement"))!
                .evidenceId,
            ],
          })),
        })),
      }));
      const compiler = new KnowledgeCompiler({
        model: { generate },
        targetResolver: {
          resolve: async (targets: readonly CompilerTargetRequest[]) =>
            targets.map(({ targetId, path }) => ({
              targetId,
              kind: "missing",
              windowsPathKey: path.toLowerCase(),
            })),
        },
        candidateValidator: {
          validate: async () => ({
            validation: { okfValid: true, citationsValid: true, linksValid: true },
            diagnostics: [],
          }),
        },
      });
      const input = createKnowledgeProductionCompileInput(createPreparation([parsed.artifact]), 1);
      const result = await compiler.compile(input, signal);

      expect(parsed.artifact.kind).toBe("text");
      expect(result.kind).toBe("proposed");
      expect(generate.mock.calls[0][0].evidence.map(({ locator }) => locator.excerpt)).toEqual([
        "# Reading\nOriginal claim.\n\n",
        "## Supplement\nA limiting counterexample.\n",
      ]);
      expect(generate).toHaveBeenCalledTimes(1);
      if (result.kind !== "proposed") throw new Error("Expected a source writing proposal");
      expect(result.analysis.citations.map(({ locator }) => locator.excerpt)).toEqual([
        "## Supplement\nA limiting counterexample.\n",
        "## Supplement\nA limiting counterexample.\n",
      ]);
      expect(
        result.analysis.citations.every(
          ({ locator }) => locator.artifactContentHash === request.sourceContentHash
        )
      ).toBe(true);
      expect(
        resolveKnowledgeCitationTarget({
          sourcePath: request.sourcePath,
          content: text,
          citation: result.analysis.citations[0],
        })
      ).toMatchObject({
        status: "resolved",
        target: { from: { line: 3, ch: 0 }, to: { line: 5, ch: 0 } },
      });
      expect(
        resolveKnowledgeCitationTarget({
          sourcePath: request.sourcePath,
          content: `${text}Changed source.`,
          citation: result.analysis.citations[0],
        })
      ).toEqual({ status: "stale" });
    });

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

    it("keeps Schema-directed foreign pages outside the target set and rejects an unauthorized output — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
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
      const generate = jest.fn(async (request: CompilerGenerationRequest) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: [
          {
            targetId: "foreign-page",
            outcome: "write",
            afterContent: "Foreign write",
            claims: [
              { text: "Exact primary source text", evidenceIds: [request.evidence[0].evidenceId] },
            ],
          },
        ],
      }));
      const resolve = jest.fn(async (targets: readonly CompilerTargetRequest[]) =>
        targets.map((target) => ({
          targetId: target.targetId,
          kind: "missing",
          windowsPathKey: target.path.toLowerCase(),
        }))
      );
      const validate = jest.fn(async () => {
        throw new Error("Candidate validation must not run without target authority");
      });
      const compiler = new KnowledgeCompiler({
        model: { generate },
        targetResolver: { resolve },
        candidateValidator: { validate },
      });

      // Schema policy cannot grant one source another source's persisted page authority.
      // https://github.com/yydspanda/obsidian-copilot/issues/8
      expect(input.targetAuthorizations).toEqual([]);
      const result = await compiler.compile(input, new AbortController().signal);

      expect(result).toMatchObject({
        kind: "failed",
        stage: "generation",
        retryable: false,
      });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0].schema.content).toBe(schemaContent);
      expect(generate.mock.calls[0][0].targets.every((target) => target.path !== targetPath)).toBe(
        true
      );
      expect(resolve.mock.calls[0][0].every((target) => target.path !== targetPath)).toBe(true);
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
          createKnowledgeProductionCompileInput(
            createPreparation([createTextArtifact()]),
            createdAt
          )
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
});
