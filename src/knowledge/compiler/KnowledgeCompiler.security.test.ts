import type {
  KnowledgeCompileInput,
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";

import { KnowledgeCompilerAbortError } from "@/knowledge/compiler/KnowledgeCompiler";

import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";

import {
  createCompileInput as createBaseInput,
  createTargetAuthorization,
  createHarness,
  createGenerationOutput,
  createMissingObservations,
  requireFailure,
  diagnosticCodes,
  SOURCE_TEXT,
  PIPELINE_FINGERPRINT,
  VALIDATION_SUCCESS,
} from "@/knowledge/compiler/KnowledgeCompiler.testHelpers";

function createCompileInput(overrides: Partial<KnowledgeCompileInput> = {}): KnowledgeCompileInput {
  return createBaseInput({
    targetAuthorizations: [createTargetAuthorization("Wiki/Page.md")],
    ...overrides,
  });
}

/** Creates compile input backed by one quote locator over caller-supplied text. */
function createQuoteCompileInput(
  text: string,
  excerpt: string,
  prefix?: string,
  suffix?: string
): KnowledgeCompileInput {
  const artifactContentHash = createFileContentHash(text);
  return createCompileInput({
    source: {
      sourceId: "source-1",
      sourceContentHash: createSourceContentHash(text),
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    artifacts: [
      {
        kind: "text",
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash,
        text,
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-1",
        locator: {
          kind: "quote",
          sourceId: "source-1",
          artifactId: "artifact-1",
          artifactContentHash,
          excerpt,
          quoteHash: createQuoteHash(excerpt),
          ...(prefix === undefined ? {} : { prefix }),
          ...(suffix === undefined ? {} : { suffix }),
        },
      },
    ],
  });
}

describe("KnowledgeCompiler", () => {
  describe("KnowledgeCompiler", () => {
    describe("compile()", () => {
      it.each(["context", "contradicts"] as const)(
        "rejects an unsupported %s relation field instead of accepting non-supporting evidence — https://github.com/yydspanda/obsidian-copilot/issues/20",
        async (relation) => {
          const harness = createHarness({
            generate: async (request) => ({
              ...createGenerationOutput(request),
              files: [
                {
                  targetId: request.targets[0].targetId,
                  outcome: "write",
                  afterContent: SOURCE_TEXT,
                  claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"], relation }],
                },
              ],
            }),
          });

          const result = requireFailure(
            await harness.compiler.compile(createCompileInput(), new AbortController().signal)
          );

          expect(result.stage).toBe("generation");
          expect(diagnosticCodes(result)).toContain("schema_unrecognized_keys");
          expect(harness.validator.inputs).toHaveLength(0);
        }
      );

      it("rejects duplicate citations that hide the same locator behind different evidence ids", async () => {
        const baseInput = createCompileInput();
        const locator = baseInput.evidence[0].locator;
        const harness = createHarness({
          generate: async (request) => ({
            ...createGenerationOutput(request),
            files: [
              {
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: SOURCE_TEXT,
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-a", "evidence-b"] }],
              },
            ],
          }),
        });
        const input = createCompileInput({
          evidence: [
            { evidenceId: "evidence-a", locator },
            { evidenceId: "evidence-b", locator },
          ],
        });

        const result = requireFailure(
          await harness.compiler.compile(input, new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(diagnosticCodes(result)).toContain("compiler_citation_duplicate");
        expect(harness.validator.inputs.length).toBe(0);
      });

      const REPEATED_TEXT = "first:repeated:one\nsecond:repeated:two";

      it("rejects a repeated quote without disambiguating context", async () => {
        const harness = createHarness();

        const result = requireFailure(
          await harness.compiler.compile(
            createQuoteCompileInput(REPEATED_TEXT, "repeated"),
            new AbortController().signal
          )
        );

        expect(result.stage).toBe("input");
        expect(diagnosticCodes(result)).toContain("locator_quote_ambiguous");
        expect(harness.model.generationRequests.length).toBe(0);
      });

      it("accepts prefix and suffix context that selects exactly one quote occurrence", async () => {
        const harness = createHarness();

        const result = await harness.compiler.compile(
          createQuoteCompileInput(REPEATED_TEXT, "repeated", "first:", ":one"),
          new AbortController().signal
        );

        expect(result.kind).toBe("proposed");
        expect(harness.model.generationRequests.length).toBe(1);
        expect(harness.validator.inputs.length).toBe(1);
      });

      it("rejects quote context that does not adjoin the excerpt", async () => {
        const harness = createHarness();

        const result = requireFailure(
          await harness.compiler.compile(
            createQuoteCompileInput(REPEATED_TEXT, "repeated", "missing:", ":one"),
            new AbortController().signal
          )
        );

        expect(result.stage).toBe("input");
        expect(diagnosticCodes(result)).toContain("locator_quote_context_mismatch");
        expect(harness.model.generationRequests.length).toBe(0);
      });

      it("rejects a Markdown line locator whose named heading does not contain its range", async () => {
        const markdown = "# Section\ninside section\noutside evidence\n";
        const artifactContentHash = createFileContentHash(markdown);
        const harness = createHarness();
        const input = createCompileInput({
          source: {
            sourceId: "source-1",
            sourceContentHash: createSourceContentHash(markdown),
            pipelineFingerprint: PIPELINE_FINGERPRINT,
            inputRevision: 1,
          },
          artifacts: [
            {
              kind: "markdown",
              sourceId: "source-1",
              artifactId: "artifact-1",
              artifactContentHash,
              text: markdown,
              headings: [{ heading: "Section", occurrence: 1, startLine: 1, endLine: 2 }],
            },
          ],
          evidence: [
            {
              evidenceId: "evidence-1",
              locator: {
                kind: "markdown_lines",
                sourceId: "source-1",
                artifactId: "artifact-1",
                artifactContentHash,
                excerpt: "outside evidence",
                quoteHash: createQuoteHash("outside evidence"),
                startLine: 3,
                endLine: 3,
                heading: "Section",
              },
            },
          ],
        });

        const result = requireFailure(
          await harness.compiler.compile(input, new AbortController().signal)
        );

        expect(result.stage).toBe("input");
        expect(diagnosticCodes(result)).toContain("locator_heading_range_mismatch");
        expect(harness.model.generationRequests.length).toBe(0);
      });

      it("enforces written claim collection limits after strict parsing — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const harness = createHarness({
          generate: async (request) => ({
            ...createGenerationOutput(request),
            files: [
              {
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: SOURCE_TEXT,
                claims: [
                  { text: SOURCE_TEXT, evidenceIds: ["evidence-1"] },
                  { text: "A distinct supported statement", evidenceIds: ["evidence-1"] },
                ],
              },
            ],
          }),
          limits: { maxClaims: 1 },
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ code: "compiler_output_limit_exceeded", field: "claims" })
        );
        expect(harness.validator.inputs.length).toBe(0);
      });

      it.each([
        {
          name: "repeated claims",
          limits: { maxClaims: 1 },
          claims: [
            { text: SOURCE_TEXT, evidenceIds: ["evidence-1"] },
            { text: SOURCE_TEXT, evidenceIds: ["evidence-1"] },
          ],
          code: "compiler_output_limit_exceeded",
          field: "claims",
        },
        {
          name: "repeated evidence references",
          limits: { maxCitations: 1 },
          claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1", "evidence-1"] }],
          code: "compiler_output_limit_exceeded",
          field: "citations",
        },
        {
          name: "repeated claim text",
          limits: { maxAnalysisCharacters: 1400 },
          claims: Array.from({ length: 10 }, () => ({
            text: "A".repeat(200),
            evidenceIds: ["evidence-1"],
          })),
          code: "compiler_analysis_character_limit_exceeded",
          field: "analysis",
        },
      ])(
        "rejects raw $name beyond the writing budget before deduplication can hide it — https://github.com/yydspanda/obsidian-copilot/issues/20",
        async ({ limits, claims, code, field }) => {
          const harness = createHarness({
            generate: async (request) => ({
              version: 1,
              targetSetDigest: request.targetSetDigest,
              files: [
                {
                  targetId: request.targets[0].targetId,
                  outcome: "write",
                  afterContent: SOURCE_TEXT,
                  claims,
                },
              ],
            }),
            limits,
          });

          const result = requireFailure(
            await harness.compiler.compile(createCompileInput(), new AbortController().signal)
          );

          expect(result.stage).toBe("generation");
          expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, field }));
          expect(harness.validator.inputs).toHaveLength(0);
        }
      );

      it("enforces the total serialized written-claim metadata limit — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const harness = createHarness({
          generate: async (request) => ({
            ...createGenerationOutput(request),
            files: [
              {
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: SOURCE_TEXT,
                claims: [{ text: "x".repeat(5000), evidenceIds: ["evidence-1"] }],
              },
            ],
          }),
          limits: { maxAnalysisCharacters: 1200 },
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(diagnosticCodes(result)).toContain("compiler_analysis_character_limit_exceeded");
        expect(harness.validator.inputs.length).toBe(0);
      });

      it("rejects an oversized exact update request before invoking generation", async () => {
        const currentContent = "x".repeat(10_000);
        const harness = createHarness({
          resolve: async (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "file",
              path: targets[0].path,
              content: currentContent,
            },
          ],
          limits: { maxModelContextCharacters: 3_000 },
        });
        const input = createCompileInput({
          targetAuthorizations: [
            createTargetAuthorization("Wiki/Page.md", {
              expectedContentHash: createFileContentHash(currentContent),
            }),
          ],
        });

        const result = requireFailure(
          await harness.compiler.compile(input, new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "compiler_model_context_limit_exceeded",
            field: "generationRequest",
          })
        );
        expect(harness.resolver.requests.length).toBe(1);
        expect(harness.model.generationRequests.length).toBe(0);
        expect(harness.validator.inputs.length).toBe(0);
      });

      it("enforces the aggregate generated-content limit across approved files", async () => {
        const harness = createHarness({
          generate: async (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: request.targets.map((target) => ({
              claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
              targetId: target.targetId,
              outcome: "write" as const,
              afterContent: "123456",
            })),
          }),
          limits: { maxTotalGeneratedCharacters: 10 },
        });
        const input = createCompileInput({
          targetAuthorizations: [
            createTargetAuthorization("Wiki/One.md"),
            createTargetAuthorization("Wiki/Two.md"),
          ],
        });

        const result = requireFailure(
          await harness.compiler.compile(input, new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(diagnosticCodes(result)).toContain("compiler_generated_total_limit_exceeded");
        expect(harness.validator.inputs.length).toBe(0);
      });

      it("rejects candidate-validator diagnostics beyond the configured bound", async () => {
        const harness = createHarness({
          validate: async () => ({
            validation: VALIDATION_SUCCESS.validation,
            diagnostics: [
              { code: "warning_one", severity: "warning", field: "one", message: "First warning" },
              { code: "warning_two", severity: "warning", field: "two", message: "Second warning" },
            ],
          }),
          limits: { maxValidationDiagnostics: 1 },
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("candidate_validation");
        expect(diagnosticCodes(result)).toContain("compiler_validation_diagnostic_limit_exceeded");
      });

      it("exposes only minimal update DTOs and omits delete and authorization metadata", async () => {
        const updateContent = "---\ntype: concept\n---\n\nExisting update\n";
        const deleteContent = "---\ntype: concept\n---\n\nDelete me\n";
        const harness = createHarness({
          resolve: async (requests) =>
            requests.map((request) => ({
              targetId: request.targetId,
              kind: "file" as const,
              path: request.path,
              content: request.path === "Wiki/Update.md" ? updateContent : deleteContent,
            })),
        });
        const input = createCompileInput({
          targetAuthorizations: [
            createTargetAuthorization("Wiki/Update.md", {
              ownership: "shared",
              sourceRefs: ["source-1", "source-historical"],
              expectedContentHash: createFileContentHash(updateContent),
            }),
            createTargetAuthorization("Wiki/Delete.md", {
              allowedIntents: ["delete"],
              contentPolicy: "structural",
              ownership: "generated",
              sourceRefs: ["source-1"],
              expectedContentHash: createFileContentHash(deleteContent),
            }),
          ],
        });

        const result = await harness.compiler.compile(input, new AbortController().signal);

        expect(result.kind).toBe("proposed");
        expect(harness.model.generationRequests).toHaveLength(1);
        const request = harness.model.generationRequests[0];
        expect(request).not.toHaveProperty("analysis");
        expect(request.evidence).toEqual(input.evidence);
        expect(request.targets).toHaveLength(1);
        const generationTarget = request.targets[0];
        expect(generationTarget.targetId).toMatch(/^target-[a-f0-9]{64}$/);
        expect(generationTarget).not.toHaveProperty("claimIds");
        expect(request.targets).toEqual([
          {
            targetId: generationTarget.targetId,
            path: "Wiki/Update.md",
            reason: "Organize the complete source material.",
            contentPolicy: "grounded",
            operation: "update",
            currentContent: updateContent,
          },
        ]);
        expect(Object.keys(request.targets[0]).sort()).toEqual(
          ["targetId", "path", "reason", "contentPolicy", "operation", "currentContent"].sort()
        );
        expect(request.targets.some((target) => target.path === "Wiki/Delete.md")).toBe(false);
        for (const field of [
          "access",
          "ownership",
          "sourceRefs",
          "expectedContentHash",
          "beforeHash",
        ]) {
          expect(request.targets[0]).not.toHaveProperty(field);
          expect(request).not.toHaveProperty(field);
        }
      });

      it("sanitizes target-resolver accessors that throw during structural parsing", async () => {
        const canary = "private target accessor canary";
        let getterCalls = 0;
        const harness = createHarness({
          resolve: async () => {
            const observation: Record<string, unknown> = {
              kind: "missing",
              windowsPathKey: "wiki/page.md",
            };
            Object.defineProperty(observation, "targetId", {
              enumerable: true,
              get: () => {
                getterCalls += 1;
                throw new Error(canary);
              },
            });
            return [observation];
          },
        });
        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(getterCalls).toBe(0);
        expect(result.stage).toBe("target_resolution");
        expect(JSON.stringify(result)).not.toContain(canary);
      });

      it("sanitizes candidate-validator accessors that throw during structural parsing", async () => {
        const canary = "private validation accessor canary";
        let getterCalls = 0;
        const harness = createHarness({
          validate: async () => {
            const result: Record<string, unknown> = { diagnostics: [] };
            Object.defineProperty(result, "validation", {
              enumerable: true,
              get: () => {
                getterCalls += 1;
                throw new Error(canary);
              },
            });
            return result;
          },
        });
        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(getterCalls).toBe(0);
        expect(result.stage).toBe("candidate_validation");
        expect(JSON.stringify(result)).not.toContain(canary);
      });

      const stages: Exclude<KnowledgeCompilerStage, "input">[] = [
        "target_resolution",
        "generation",
        "candidate_validation",
      ];

      it.each(stages)(
        "throws AbortError when the %s dependency ignores the signal and resolves after cancellation",
        async (stage) => {
          const controller = new AbortController();
          const harness = createHarness({
            resolve: async (targets) => {
              const output = createMissingObservations(targets);
              if (stage === "target_resolution") {
                controller.abort("private cancellation reason");
              }
              return output;
            },
            generate: async (request) => {
              const output = createGenerationOutput(request);
              if (stage === "generation") {
                controller.abort("private cancellation reason");
              }
              return output;
            },
            validate: async () => {
              if (stage === "candidate_validation") {
                controller.abort("private cancellation reason");
              }
              return VALIDATION_SUCCESS;
            },
          });
          let thrown: unknown;

          try {
            await harness.compiler.compile(createCompileInput(), controller.signal);
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeInstanceOf(KnowledgeCompilerAbortError);
          expect(thrown).toMatchObject({ name: "AbortError", stage });
          expect(String(thrown)).not.toContain("private cancellation reason");
        }
      );
    });
  });
});
