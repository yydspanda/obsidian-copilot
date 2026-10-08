import type {
  CompilerGenerationRequest,
  KnowledgeCompileResult,
  KnowledgeCompilerLimits,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import { createKnowledgeProductionCompileInput } from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import type { CompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const OBSERVATION = "The reader proposes separating observed failures from possible causes.";
const RESEARCH =
  "The reader proposes retaining full measurements during investigation and selecting representative examples for presentation; this method has not been tested.";
const BEFORE = `---\ntype: knowledge\n---\n# Maintenance\n\n${OBSERVATION}\n`;
const AFTER = `${BEFORE}\n${RESEARCH}\n`;
const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/20";

function expectGenerationFailure(result: KnowledgeCompileResult, code: string): void {
  expect(result.kind).toBe("failed");
  if (result.kind !== "failed") throw new Error(`Expected generation failure: ${code}`);
  expect(result.stage).toBe("generation");
  expect(result.retryable).toBe(false);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
}

interface Scenario {
  before?: string;
  missing?: boolean;
  structural?: boolean;
  claimRefsByTarget?: string[][];
  limits?: Partial<KnowledgeCompilerLimits>;
}

function createResponse(request: CompilerGenerationRequest): CompilerGenerationModelOutput {
  return {
    version: 2,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write",
      afterContent: AFTER,
      claimCoverage: target.claimIds.map((claimId) => ({
        claimId,
        excerpt: request.analysis.claims.find((claim) => claim.id === claimId)!.text,
      })),
    })),
  };
}

async function compile(
  respond: (request: CompilerGenerationRequest) => CompilerGenerationModelOutput = createResponse,
  scenario: Scenario = {}
) {
  const before = scenario.before ?? BEFORE;
  const text = `${OBSERVATION}\n\n${RESEARCH}`;
  const hash = createFileContentHash(text);
  const pipelineFingerprint = "b".repeat(64);
  const claimRefsByTarget = scenario.claimRefsByTarget ?? [["observation", "research"]];
  const paths = claimRefsByTarget.map((_, index) => `Wiki/Method-${index}.md`);
  const input = createKnowledgeProductionCompileInput(
    {
      bundle: {
        version: 1,
        id: "maintenance",
        sourceRoots: ["Sources"],
        wikiRoot: "Wiki",
        schemaRef: "Config/rules.md",
        reviewMode: "always",
      },
      operation: "ingest",
      source: {
        sourceId: "source-1",
        sourceContentHash: hash,
        pipelineFingerprint,
        inputRevision: 2,
      },
      schema: {
        path: "Config/rules.md",
        content: "Organize the supported maintenance suggestions with their qualifications.",
        contentHash: createFileContentHash(
          "Organize the supported maintenance suggestions with their qualifications."
        ),
      },
      manifest: {
        version: 1,
        bundleId: "maintenance",
        revision: 1,
        entries: [
          {
            sourceId: "source-1",
            sourceKey: "sources/maintenance.md",
            sourcePath: "Sources/Maintenance.md",
            custody: "user_managed",
            ...(scenario.missing
              ? {}
              : {
                  lastSuccessful: {
                    sourceContentHash: hash,
                    pipelineFingerprint,
                    generatedPages: paths.map((path) => ({
                      path,
                      ownership: "generated" as const,
                      contentHash: createFileContentHash(before),
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
          sourceId: "source-1",
          artifactId: "primary",
          artifactContentHash: hash,
          text,
        },
      ],
    },
    10
  );
  if (scenario.structural) {
    input.targetAuthorizations.forEach((authorization) => {
      authorization.contentPolicy = "structural";
    });
  }
  const generate = jest.fn(async (request: CompilerGenerationRequest) => respond(request));
  const validate = jest.fn(async () => ({
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    diagnostics: [],
  }));
  const compiler = new KnowledgeCompiler({
    limits: scenario.limits,
    model: {
      analyze: async () => ({
        version: 1,
        summary: "Maintenance suggestions",
        concepts: [],
        entities: [],
        relations: [],
        claims: [
          { ref: "observation", text: OBSERVATION },
          { ref: "research", text: RESEARCH },
        ],
        citations: ["observation", "research"].map((claimRef) => ({
          claimRef,
          evidenceId: input.evidence[0].evidenceId,
          relation: "supports",
        })),
        targets: paths.map((path, index) => ({
          ref: `page-${index}`,
          path,
          intent: "write",
          reason: "Organize the selected suggestions",
          claimRefs: claimRefsByTarget[index],
        })),
      }),
      generate,
    },
    targetResolver: {
      resolve: async (targets) =>
        targets.map((target) =>
          scenario.missing
            ? {
                targetId: target.targetId,
                kind: "missing",
                windowsPathKey: toWindowsPathKey(target.path),
              }
            : { targetId: target.targetId, kind: "file", path: target.path, content: before }
        ),
    },
    candidateValidator: { validate },
  });
  const result = await compiler.compile(input, new AbortController().signal);
  return { result, generate, validate };
}

describe("KnowledgeCompiler claim handoff", () => {
  describe("KnowledgeCompiler", () => {
    describe("compile()", () => {
      it(`preserves complete selected claims and proposes their anchored content without persisting coverage — ${ISSUE}`, async () => {
        const { result, generate, validate } = await compile();

        expect(result.kind).toBe("proposed");
        expect(generate.mock.calls[0][0].analysis.claims.map((claim) => claim.text).sort()).toEqual(
          [OBSERVATION, RESEARCH].sort()
        );
        if (result.kind !== "proposed") throw new Error(JSON.stringify(result));
        expect(result.changeSet.changes[0]).toMatchObject({ afterContent: AFTER });
        expect(JSON.stringify(result)).not.toContain('"claimCoverage"');
        expect(JSON.stringify(validate.mock.calls)).not.toContain('"claimCoverage"');
      });

      it(`accepts unchanged only with anchors in the exact existing target content — ${ISSUE}`, async () => {
        const { result, validate } = await compile(
          (request) => ({
            ...createResponse(request),
            files: createResponse(request).files.map((file) => ({
              targetId: file.targetId,
              outcome: "unchanged",
              claimCoverage: file.claimCoverage,
            })),
          }),
          { before: AFTER }
        );

        expect(result.kind).toBe("no_changes");
        expect(validate).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('"claimCoverage"');
      });

      it(`allows merged phrasing to anchor several claims without requiring verbatim claim text — ${ISSUE}`, async () => {
        const paragraph =
          "Proposed, untested method: distinguish observed faults from hypotheses, keep all investigation measurements and select examples when presenting.";
        const { result } = await compile((request) => ({
          ...createResponse(request),
          files: createResponse(request).files.map((file) => ({
            ...file,
            outcome: "write",
            afterContent: `# Maintenance\n\n${paragraph}`,
            claimCoverage: file.claimCoverage.map((entry) => ({ ...entry, excerpt: paragraph })),
          })),
        }));

        expect(result.kind).toBe("proposed");
      });

      it(`allows the same selected claim to have independent anchors on different targets — ${ISSUE}`, async () => {
        const { result } = await compile(createResponse, {
          claimRefsByTarget: [["observation"], ["observation", "research"]],
        });

        expect(result.kind).toBe("proposed");
        if (result.kind !== "proposed") throw new Error(JSON.stringify(result));
        expect(result.changeSet.changes).toHaveLength(2);
      });

      it(`allows an empty coverage list only when the structural target selects no claims — ${ISSUE}`, async () => {
        const { result } = await compile(createResponse, {
          structural: true,
          claimRefsByTarget: [[]],
        });

        expect(result.kind).toBe("proposed");
      });

      it.each(["write", "unchanged", "identical-write"] as const)(
        `rejects a missing selected claim before accepting a %s result — ${ISSUE}`,
        async (outcome) => {
          const { result, validate } = await compile((request) => {
            const response = createResponse(request);
            response.files = response.files.map((file) => ({
              targetId: file.targetId,
              claimCoverage: file.claimCoverage.filter((entry) => entry.excerpt === OBSERVATION),
              ...(outcome === "unchanged"
                ? { outcome: "unchanged" as const }
                : {
                    outcome: "write" as const,
                    afterContent: outcome === "write" ? AFTER : BEFORE,
                  }),
            }));
            return response;
          });

          expectGenerationFailure(result, "compiler_generation_claim_missing");
          expect(validate).not.toHaveBeenCalled();
        }
      );

      it.each([
        { name: "duplicate claim", code: "compiler_generation_claim_duplicate" },
        { name: "unselected claim", code: "compiler_generation_claim_unknown" },
        { name: "nonexistent excerpt", code: "compiler_generation_claim_excerpt_missing" },
      ])(`rejects $name without constructing a candidate — ${ISSUE}`, async ({ name, code }) => {
        const { result, validate } = await compile((request) => {
          const response = createResponse(request);
          const coverage = response.files[0].claimCoverage;
          if (name === "duplicate claim") coverage[1].claimId = coverage[0].claimId;
          if (name === "unselected claim") coverage[1].claimId = "not-selected";
          if (name === "nonexistent excerpt") coverage[1].excerpt = "An invented target excerpt.";
          return response;
        });

        expectGenerationFailure(result, code);
        expect(validate).not.toHaveBeenCalled();
      });

      it(`rejects a claim belonging only to another target even when both pages contain its excerpt — ${ISSUE}`, async () => {
        const { result } = await compile(
          (request) => {
            const response = createResponse(request);
            response.files[0].claimCoverage = response.files[1].claimCoverage;
            return response;
          },
          { claimRefsByTarget: [["observation"], ["research"]] }
        );

        expectGenerationFailure(result, "compiler_generation_claim_unknown");
      });

      it.each([false, true])(
        `rejects an unchanged result whose claimed excerpt exists only in source evidence (missing target: %s) — ${ISSUE}`,
        async (missing) => {
          const { result } = await compile(
            (request) => ({
              ...createResponse(request),
              files: createResponse(request).files.map((file) => ({
                targetId: file.targetId,
                outcome: "unchanged",
                claimCoverage: file.claimCoverage,
              })),
            }),
            { missing }
          );

          expectGenerationFailure(result, "compiler_generation_claim_excerpt_missing");
        }
      );

      it(`checks nonempty structural selections using the same claim contract — ${ISSUE}`, async () => {
        const { result } = await compile(
          (request) => {
            const response = createResponse(request);
            response.files[0].claimCoverage = [];
            return response;
          },
          { structural: true }
        );

        expectGenerationFailure(result, "compiler_generation_claim_missing");
      });

      it(`includes unchanged coverage excerpts in the generated-text budget — ${ISSUE}`, async () => {
        const { result } = await compile(
          (request) => ({
            ...createResponse(request),
            files: createResponse(request).files.map((file) => ({
              targetId: file.targetId,
              outcome: "unchanged",
              claimCoverage: file.claimCoverage,
            })),
          }),
          { before: AFTER, limits: { maxTotalGeneratedCharacters: OBSERVATION.length } }
        );

        expectGenerationFailure(result, "compiler_generated_total_limit_exceeded");
      });

      it(`bounds coverage entries before scanning target text — ${ISSUE}`, async () => {
        const { result, validate } = await compile(
          (request) => {
            const response = createResponse(request);
            response.files[0].claimCoverage.push(response.files[0].claimCoverage[0]);
            return response;
          },
          { limits: { maxClaims: 2 } }
        );

        expectGenerationFailure(result, "compiler_generation_claim_limit_exceeded");
        expect(validate).not.toHaveBeenCalled();
      });

      it(`counts page text and coverage together against the per-file response budget — ${ISSUE}`, async () => {
        const { result } = await compile(createResponse, {
          limits: { maxGeneratedFileCharacters: AFTER.length },
        });

        expectGenerationFailure(result, "compiler_generated_content_limit_exceeded");
      });
    });
  });
});
