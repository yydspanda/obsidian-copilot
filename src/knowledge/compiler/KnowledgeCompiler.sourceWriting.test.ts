import type {
  CompilerGenerationRequest,
  CompilerTargetRequest,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import { createKnowledgeProductionCompileInput } from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/20";
const ORIGINAL = "Two demonstrations succeeded under the observed conditions.";
const ADDITION = "Reader suggestion, not yet tested: record conditions and seek counterexamples.";
const SOURCE = `${ORIGINAL}\n\n${ADDITION}`;
const BEFORE = "---\ntype: knowledge\n---\nTwo demonstrations succeeded.\n";
const AFTER = `---\ntype: knowledge\n---\n${ORIGINAL}\n\n${ADDITION}\n`;

function createInput(paths: string[] = []): KnowledgeCompileInput {
  const sourceContentHash = createFileContentHash(SOURCE);
  const pipelineFingerprint = "b".repeat(64);
  return createKnowledgeProductionCompileInput(
    {
      bundle: {
        version: 1,
        id: "reading",
        sourceRoots: ["Materials"],
        wikiRoot: "Notes",
        schemaRef: "Rules.md",
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
        path: "Rules.md",
        content: "Explain the source and distinguish reader interpretations.",
        contentHash: createFileContentHash(
          "Explain the source and distinguish reader interpretations."
        ),
      },
      manifest: {
        version: 1,
        bundleId: "reading",
        revision: 1,
        entries: [
          {
            sourceId: "reading-source",
            sourceKey: "materials/chapter.md",
            sourcePath: "Materials/Chapter.md",
            custody: "user_managed",
            ...(paths.length === 0
              ? {}
              : {
                  lastSuccessful: {
                    sourceContentHash: createFileContentHash(ORIGINAL),
                    pipelineFingerprint,
                    generatedPages: paths.map((path) => ({
                      path,
                      ownership: "generated" as const,
                      contentHash: createFileContentHash(BEFORE),
                    })),
                    changeSetId: "previous-apply",
                    completedAt: 1,
                  },
                }),
          },
        ],
      },
      artifacts: [
        {
          kind: "text",
          sourceId: "reading-source",
          artifactId: "primary",
          artifactContentHash: sourceContentHash,
          text: SOURCE,
        },
      ],
    },
    10
  );
}

function response(request: CompilerGenerationRequest) {
  return {
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write",
      afterContent: AFTER,
      claims: [{ text: ADDITION, evidenceIds: [request.evidence[1].evidenceId] }],
    })),
  };
}

function harness(input = createInput(), generateOutput = response) {
  const generate = jest.fn(async (request: CompilerGenerationRequest) => generateOutput(request));
  const resolve = jest.fn(
    async (targets: readonly CompilerTargetRequest[]): Promise<unknown> =>
      targets.map((target) =>
        input.targetAuthorizations.some((a) => a.path === target.path)
          ? { targetId: target.targetId, kind: "file", path: target.path, content: BEFORE }
          : {
              targetId: target.targetId,
              kind: "missing",
              windowsPathKey: toWindowsPathKey(target.path),
            }
      )
  );
  const validate = jest.fn(async () => ({
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    diagnostics: [],
  }));
  const compiler = new KnowledgeCompiler({
    model: { generate },
    targetResolver: { resolve },
    candidateValidator: { validate },
  });
  return { input, compiler, generate, resolve, validate };
}

describe("KnowledgeCompiler source writing", () => {
  describe("KnowledgeCompiler", () => {
    describe("compile()", () => {
      it(`writes a new source in one model call with complete evidence and no analysis gate — ${ISSUE}`, async () => {
        const h = harness();
        const result = await h.compiler.compile(h.input, new AbortController().signal);
        expect(result.kind).toBe("proposed");
        expect(h.generate).toHaveBeenCalledTimes(1);
        const request = h.generate.mock.calls[0][0];
        expect(request).not.toHaveProperty("analysis");
        expect(request).not.toHaveProperty("analysisDigest");
        expect(request.evidence.map((e) => e.locator.excerpt).join("")).toBe(SOURCE);
        expect(request.targets).toHaveLength(1);
        expect(request.targets[0]).toMatchObject({ operation: "create" });
        expect(request.targets[0]).not.toHaveProperty("claimIds");
        if (result.kind !== "proposed") throw new Error("Expected proposal");
        expect(result.changeSet.changes[0]).toMatchObject({
          operation: "create",
          afterContent: AFTER,
        });
        expect(result.analysis.claims.map((c) => c.text)).toEqual([ADDITION]);
        expect(result.changeSet.citations).toHaveLength(1);
        expect(result.changeSet.citations[0].locator.excerpt).toBe(ADDITION);
        expect(h.input.manifest.entries[0]).not.toHaveProperty("lastSuccessful");
      });

      it(`updates all previously owned pages without silently consolidating or deleting them — ${ISSUE}`, async () => {
        const h = harness(createInput(["Notes/B.md", "Notes/A.md"]));
        const result = await h.compiler.compile(h.input, new AbortController().signal);
        expect(result.kind).toBe("proposed");
        expect(
          h.generate.mock.calls[0][0].targets.map((t) => ({
            path: t.path,
            operation: t.operation,
            content: "currentContent" in t ? t.currentContent : null,
          }))
        ).toEqual([
          { path: "Notes/A.md", operation: "update", content: BEFORE },
          { path: "Notes/B.md", operation: "update", content: BEFORE },
        ]);
        expect(h.generate).toHaveBeenCalledTimes(1);
      });

      it(`rejects an occupied create-only destination before any model call — ${ISSUE}`, async () => {
        const h = harness();
        h.resolve.mockImplementationOnce(async (targets) =>
          targets.map((t) => ({ targetId: t.targetId, kind: "occupied", path: t.path }))
        );
        const result = await h.compiler.compile(h.input, new AbortController().signal);
        expect(result).toMatchObject({ kind: "failed", stage: "target_resolution" });
        expect(h.generate).not.toHaveBeenCalled();
        expect(h.validate).not.toHaveBeenCalled();
      });

      it(`rejects a claim citing evidence absent from the complete source request — ${ISSUE}`, async () => {
        const h = harness(createInput(), (request) => {
          const output = response(request);
          output.files[0].claims[0].evidenceIds = ["foreign-evidence"];
          return output;
        });
        expect(await h.compiler.compile(h.input, new AbortController().signal)).toMatchObject({
          kind: "failed",
          stage: "generation",
        });
        expect(h.validate).not.toHaveBeenCalled();
      });

      it(`rejects a write without actual supported claims instead of manufacturing citations — ${ISSUE}`, async () => {
        const h = harness(createInput(), (request) => {
          const output = response(request);
          output.files[0].claims = [];
          return output;
        });
        expect(await h.compiler.compile(h.input, new AbortController().signal)).toMatchObject({
          kind: "failed",
          stage: "generation",
        });
        expect(h.validate).not.toHaveBeenCalled();
      });
    });
  });
});
