import type {
  CompilerGenerationRequest,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import { createKnowledgeProductionCompileInput } from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";

const ORIGINAL = "Research requires observations under different conditions.";
const EXTENSION = "Reader suggestion: distinguish observations from possible explanations.";
const EXISTING = "---\ntype: knowledge\n---\nResearch uses observations.\n";

function createInput(): KnowledgeCompileInput {
  const text = `${ORIGINAL}\n\n${EXTENSION}`;
  const sourceContentHash = createFileContentHash(text);
  const pipelineFingerprint = "b".repeat(64);
  const input = createKnowledgeProductionCompileInput(
    {
      bundle: {
        version: 1,
        id: "reading",
        sourceRoots: ["Sources"],
        wikiRoot: "Wiki",
        schemaRef: "Config/schema.md",
        reviewMode: "always",
      },
      operation: "ingest",
      source: {
        sourceId: "reading-source",
        sourceContentHash,
        pipelineFingerprint,
        inputRevision: 2,
      },
      schema: {
        path: "Config/schema.md",
        content: "Summarize supported observations.",
        contentHash: createFileContentHash("Summarize supported observations."),
      },
      manifest: {
        version: 1,
        bundleId: "reading",
        revision: 1,
        entries: [
          {
            sourceId: "reading-source",
            sourceKey: "sources/chapter.md",
            sourcePath: "Sources/Chapter.md",
            custody: "user_managed",
            lastSuccessful: {
              sourceContentHash: createFileContentHash(ORIGINAL),
              pipelineFingerprint,
              generatedPages: [
                {
                  path: "Wiki/Reading.md",
                  ownership: "generated",
                  contentHash: createFileContentHash(EXISTING),
                },
              ],
              changeSetId: "previous-apply",
              completedAt: 1,
            },
          },
        ],
      },
      artifacts: [
        {
          kind: "text",
          sourceId: "reading-source",
          artifactId: "primary",
          artifactContentHash: sourceContentHash,
          text,
        },
      ],
    },
    10
  );
  // Isolate the coverage contract from the production partition strategy.
  input.evidence = [ORIGINAL, EXTENSION].map((excerpt, index) => ({
    evidenceId: `evidence-${index}`,
    locator: {
      kind: "quote",
      sourceId: "reading-source",
      artifactId: "primary",
      artifactContentHash: sourceContentHash,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
    },
  }));
  return input;
}

async function compileNoChanges(
  options: {
    input?: KnowledgeCompileInput;
    analyzeExtension?: boolean;
    targetExtension?: boolean;
    noTargets?: boolean;
    explicitUnchanged?: boolean;
    relatedExtension?: boolean;
    maxEvidenceItems?: number;
  } = {}
) {
  const input = options.input ?? createInput();
  const generate = jest.fn(async (request: CompilerGenerationRequest) => ({
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target: { targetId: string }) =>
      options.explicitUnchanged
        ? { targetId: target.targetId, outcome: "unchanged" }
        : { targetId: target.targetId, outcome: "write", afterContent: EXISTING }
    ),
  }));
  const compiler = new KnowledgeCompiler({
    limits: { maxEvidenceItems: options.maxEvidenceItems ?? 2048 },
    model: {
      analyze: async () => ({
        version: 1,
        summary: "Source review",
        concepts: [],
        entities: [],
        relations: [],
        claims: [
          { ref: "old", text: ORIGINAL },
          ...(options.analyzeExtension ? [{ ref: "new", text: EXTENSION }] : []),
        ],
        citations: [
          { claimRef: "old", evidenceId: input.evidence[0].evidenceId, relation: "supports" },
          ...(options.analyzeExtension
            ? [{ claimRef: "new", evidenceId: input.evidence[1].evidenceId, relation: "supports" }]
            : []),
          ...(options.relatedExtension
            ? [{ claimRef: "old", evidenceId: input.evidence[1].evidenceId, relation: "context" }]
            : []),
        ],
        targets: options.noTargets
          ? []
          : [
              {
                ref: "page",
                path: "Wiki/Reading.md",
                intent: "write",
                reason: "Refresh the reading note",
                claimRefs: ["old", ...(options.targetExtension ? ["new"] : [])],
              },
            ],
      }),
      generate,
    },
    targetResolver: {
      resolve: async (targets) =>
        targets.map((target) => ({
          targetId: target.targetId,
          kind: "file",
          path: target.path,
          content: EXISTING,
        })),
    },
    candidateValidator: {
      validate: async () => {
        throw new Error("No Wiki candidate should be created");
      },
    },
  });
  const result = await compiler.compile(input, new AbortController().signal);
  expect(result.kind).toBe("no_changes");
  if (result.kind !== "no_changes") throw new Error(JSON.stringify(result));
  return { result, generate };
}

describe("KnowledgeCompiler evidence selection diagnostics", () => {
  describe("KnowledgeCompiler", () => {
    describe("compile()", () => {
      it("retains selected evidence after generation repeats old bytes without claiming semantic coverage — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const { result } = await compileNoChanges({
          analyzeExtension: true,
          targetExtension: true,
        });
        expect(result.manifestCommitPlan).toMatchObject({
          evidenceCoverage: [
            { quoteHash: createQuoteHash(ORIGINAL), supportingClaimCount: 1, targetClaimCount: 1 },
            { quoteHash: createQuoteHash(EXTENSION), supportingClaimCount: 1, targetClaimCount: 1 },
          ],
          generationOutcomes: { explicitUnchanged: 0, identicalWrites: 1 },
        });
        expect(JSON.stringify(result.manifestCommitPlan)).not.toContain(EXTENSION);
        expect(JSON.stringify(result.manifestCommitPlan)).not.toContain(ORIGINAL);
      });

      it("distinguishes an unselected addition from one selected by analysis but not a write target — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const ignored = await compileNoChanges();
        const analyzed = await compileNoChanges({ analyzeExtension: true });
        expect(ignored.result.manifestCommitPlan).toHaveProperty("evidenceCoverage.1", {
          quoteHash: createQuoteHash(EXTENSION),
          supportingClaimCount: 0,
          targetClaimCount: 0,
        });
        expect(analyzed.result.manifestCommitPlan).toHaveProperty("evidenceCoverage.1", {
          quoteHash: createQuoteHash(EXTENSION),
          supportingClaimCount: 1,
          targetClaimCount: 0,
        });
      });

      it("retains analysis-only selection when no targets are approved without calling generation — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const { result, generate } = await compileNoChanges({
          analyzeExtension: true,
          noTargets: true,
        });
        expect(result.manifestCommitPlan).toMatchObject({
          reason: "analysis_no_targets",
          evidenceCoverage: [
            { quoteHash: createQuoteHash(ORIGINAL), supportingClaimCount: 1, targetClaimCount: 0 },
            { quoteHash: createQuoteHash(EXTENSION), supportingClaimCount: 1, targetClaimCount: 0 },
          ],
        });
        expect(result.manifestCommitPlan).not.toHaveProperty("generationOutcomes");
        expect(generate).not.toHaveBeenCalled();
      });

      it("counts only supporting citations and preserves explicit unchanged outcomes — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const { result } = await compileNoChanges({
          relatedExtension: true,
          explicitUnchanged: true,
        });
        expect(result.manifestCommitPlan).toMatchObject({
          evidenceCoverage: [
            { quoteHash: createQuoteHash(ORIGINAL), supportingClaimCount: 1, targetClaimCount: 1 },
            { quoteHash: createQuoteHash(EXTENSION), supportingClaimCount: 0, targetClaimCount: 0 },
          ],
          generationOutcomes: { explicitUnchanged: 1, identicalWrites: 0 },
        });
      });

      it("does not credit a different artifact merely because its quote hash matches — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const input = createInput();
        input.artifacts.push({ ...input.artifacts[0], artifactId: "duplicate-copy" });
        input.evidence[1] = {
          evidenceId: "evidence-1",
          locator: { ...input.evidence[0].locator, artifactId: "duplicate-copy" },
        };
        const { result } = await compileNoChanges({ input });
        expect(result.manifestCommitPlan).toHaveProperty("evidenceCoverage", [
          { quoteHash: createQuoteHash(ORIGINAL), supportingClaimCount: 1, targetClaimCount: 1 },
          { quoteHash: createQuoteHash(ORIGINAL), supportingClaimCount: 0, targetClaimCount: 0 },
        ]);
      });

      it("omits optional selection diagnostics without truncating evidence admitted by a larger custom limit — https://github.com/yydspanda/obsidian-copilot/issues/17", async () => {
        const input = createInput();
        const originalEvidence = input.evidence[0];
        input.evidence = Array.from({ length: 2049 }, (_, index) => ({
          ...originalEvidence,
          evidenceId: `evidence-${index.toString().padStart(4, "0")}`,
        }));
        const { result, generate } = await compileNoChanges({
          input,
          noTargets: true,
          maxEvidenceItems: 2049,
        });
        expect(result.manifestCommitPlan).not.toHaveProperty("evidenceCoverage");
        expect(generate).not.toHaveBeenCalled();
      });
    });
  });
});
