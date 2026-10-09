import type {
  CompilerTargetAuthorization,
  CompilerTargetRequest,
  CompilerGenerationRequest,
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";

import { createKnowledgeSourceOriginExtensions } from "@/knowledge/capture/KnowledgeSourceOrigin";

import {
  KnowledgeCompilerAbortError,
  KnowledgeCompilerInfrastructureError,
  KnowledgeCompilerModelCallAuthorization,
  KnowledgeCompilerModelSession,
  type KnowledgeCompilerModelCall,
} from "@/knowledge/compiler/KnowledgeCompiler";

import type { CompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";

import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";

import {
  createManifestCommitPlanDigest,
  createSourceManifestDigest,
} from "@/knowledge/manifest/ManifestCommitIntent";

import { createNoChangesManifestCommitPlanDigest } from "@/knowledge/manifest/NoChangesManifestCommit";

import { createFileContentHash } from "@/knowledge/model/fingerprint";

import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

import { createKnowledgeSourceTargetPlan } from "@/knowledge/compiler/KnowledgeSourceTargetPlan";

import {
  createCompileInput,
  createTargetAuthorization,
  createManifest,
  createHarness,
  requireProposal,
  requireFailure,
  requireNoChanges,
  diagnosticCodes,
  SOURCE_TEXT,
  SOURCE_CONTENT_HASH,
  PIPELINE_FINGERPRINT,
  VALIDATION_SUCCESS,
} from "@/knowledge/compiler/KnowledgeCompiler.testHelpers";

const DEFAULT_PATH = createKnowledgeSourceTargetPlan(createCompileInput())[0].path;

describe("KnowledgeCompiler", () => {
  describe("KnowledgeCompiler", () => {
    describe("compile()", () => {
      it("produces stable create/update proposals and preserves unselected historical pages without deletion — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const old = "An earlier source-grounded note.";
        const targetAuthorizations = [
          createTargetAuthorization("Wiki/Update.md", {
            expectedContentHash: createFileContentHash(old),
          }),
          createTargetAuthorization("Wiki/Missing.md"),
          createTargetAuthorization("Wiki/Historical.md", {
            allowedIntents: ["delete"],
            contentPolicy: "structural",
          }),
        ];
        const input = createCompileInput({ targetAuthorizations });
        const harness = createHarness({
          resolve: async (targets) =>
            targets.map((target) =>
              target.path === "Wiki/Update.md"
                ? { targetId: target.targetId, kind: "file", path: target.path, content: old }
                : {
                    targetId: target.targetId,
                    kind: "missing",
                    windowsPathKey: toWindowsPathKey(target.path),
                  }
            ),
        });
        const first = requireProposal(
          await harness.compiler.compile(input, new AbortController().signal)
        );
        const second = requireProposal(
          await harness.compiler.compile(input, new AbortController().signal)
        );
        const revised = requireProposal(
          await harness.compiler.compile(
            { ...input, source: { ...input.source, inputRevision: 2 } },
            new AbortController().signal
          )
        );

        expect(second).toEqual(first);
        expect(revised.changeSet.id).not.toBe(first.changeSet.id);
        expect(revised.manifestCommitPlanDigest).not.toBe(first.manifestCommitPlanDigest);
        expect(first.changeSet).toMatchObject({
          status: "proposed",
          operation: "ingest",
          bundleId: "personal",
          createdAt: 1000,
          validation: VALIDATION_SUCCESS.validation,
        });
        expect(first.changeSet.changes).toEqual([
          expect.objectContaining({
            path: "Wiki/Missing.md",
            operation: "create",
            expectedAbsent: true,
          }),
          expect.objectContaining({
            path: "Wiki/Update.md",
            operation: "update",
            beforeHash: createFileContentHash(old),
          }),
        ]);
        expect(first.changeSet.id).toMatch(/^changeset-[a-f0-9]{64}$/);
        expect(first.proposalDigest).toBe(createChangeSetTransactionDigest(first.changeSet));
        expect(first.manifestCommitPlanDigest).toBe(
          createManifestCommitPlanDigest(first.manifestCommitPlan)
        );
        expect(first.manifestCommitPlan.baseGeneratedPages.map((page) => page.path)).toEqual([
          "Wiki/Historical.md",
          "Wiki/Missing.md",
          "Wiki/Update.md",
        ]);
        expect(
          first.manifestCommitPlan.mutations.every((mutation) => mutation.operation !== "delete")
        ).toBe(true);
        expect(harness.validator.inputs[0].draft).not.toHaveProperty("status");
        expect(harness.validator.inputs[0].draft).not.toHaveProperty("validation");
        for (const request of harness.model.generationRequests) {
          expect(request.targets.map((target) => target.path)).toEqual([
            "Wiki/Missing.md",
            "Wiki/Update.md",
          ]);
        }
      });

      it("compiles an exact managed capture as query writeback and keeps lint-fix rejected", async () => {
        const manifest = createManifest("personal", []);
        manifest.entries[0] = {
          ...manifest.entries[0],
          custody: "managed_copy",
          extensions: createKnowledgeSourceOriginExtensions("query_writeback", {
            captureDigest: "c".repeat(64),
            captureContentHash: SOURCE_CONTENT_HASH,
          }),
        };
        const harness = createHarness();
        const queryInput = createCompileInput({ operation: "query_writeback", manifest });

        const proposal = requireProposal(
          await harness.compiler.compile(queryInput, new AbortController().signal)
        );
        expect(proposal.changeSet.operation).toBe("query_writeback");
        expect(proposal.manifestCommitPlan.kind).toBe("query_writeback_source_compile");
        if (proposal.manifestCommitPlan.kind !== "query_writeback_source_compile") {
          throw new Error("Expected a query-writeback plan");
        }
        expect(proposal.manifestCommitPlan.sourceOriginDigest).toMatch(/^[a-f0-9]{64}$/);

        const lintFailure = requireFailure(
          await harness.compiler.compile(
            createCompileInput({ operation: "lint_fix", manifest }),
            new AbortController().signal
          )
        );
        expect(diagnosticCodes(lintFailure)).toContain("compiler_manifest_operation_unsupported");
      });

      it("allows an unlisted target only after a Windows-keyed missing observation", async () => {
        const harness = createHarness();

        const result = requireProposal(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(harness.resolver.requests[0]).toEqual([
          expect.objectContaining({
            path: DEFAULT_PATH,
            intent: "write",
            access: "create_only",
          }),
        ]);
        expect(result.analysis.targets[0]).toMatchObject({
          path: DEFAULT_PATH,
          access: "create_only",
          ownership: "new",
        });
        expect(result.changeSet.changes).toEqual([
          expect.objectContaining({
            operation: "create",
            path: DEFAULT_PATH,
            expectedAbsent: true,
          }),
        ]);
      });

      it("binds proposal identity and commit read-set to the exact Manifest revision", async () => {
        const harness = createHarness();
        const firstInput = createCompileInput();
        const nextManifest = { ...firstInput.manifest, revision: firstInput.manifest.revision + 1 };

        const first = requireProposal(
          await harness.compiler.compile(firstInput, new AbortController().signal)
        );
        const next = requireProposal(
          await harness.compiler.compile(
            createCompileInput({ manifest: nextManifest }),
            new AbortController().signal
          )
        );

        expect(next.compileContextDigest).not.toBe(first.compileContextDigest);
        expect(next.changeSet.id).not.toBe(first.changeSet.id);
        expect(next.manifestCommitPlan.expectedManifestRevision).toBe(nextManifest.revision);
        expect(next.manifestCommitPlan.expectedManifestDigest).toBe(
          createSourceManifestDigest(nextManifest)
        );
        expect(next.manifestCommitPlanDigest).not.toBe(first.manifestCommitPlanDigest);
      });

      it("distinguishes byte-identical updates from explicit unchanged generation — https://github.com/yydspanda/obsidian-copilot/issues/15", async () => {
        const existing = "---\ntype: concept\n---\n\nUnchanged\n";
        const harness = createHarness({
          resolve: async (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "file",
              path: targets[0].path,
              content: existing,
            },
          ],
          generate: async (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: [
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: existing,
              },
            ],
          }),
        });

        const result = requireNoChanges(
          await harness.compiler.compile(
            createCompileInput({
              targetAuthorizations: [
                createTargetAuthorization("Wiki/Page.md", {
                  expectedContentHash: createFileContentHash(existing),
                }),
              ],
            }),
            new AbortController().signal
          )
        );

        expect(diagnosticCodes(result)).toContain("compiler_update_content_unchanged");
        expect(result.manifestCommitPlan).toMatchObject({
          reason: "all_targets_unchanged",
          generationOutcomes: { explicitUnchanged: 0, identicalWrites: 1 },
          compileContextDigest: result.compileContextDigest,
          analysisDigest: result.analysisDigest,
          baseGeneratedPages: [
            {
              path: "Wiki/Page.md",
              ownership: "generated",
              contentHash: createFileContentHash(existing),
            },
          ],
        });
        expect(result.manifestCommitPlanDigest).toBe(
          createNoChangesManifestCommitPlanDigest(result.manifestCommitPlan)
        );
        expect(harness.validator.inputs).toHaveLength(0);

        const explicitUnchanged = requireNoChanges(
          await createHarness({
            resolve: async (targets) => [
              {
                targetId: targets[0].targetId,
                kind: "file",
                path: targets[0].path,
                content: existing,
              },
            ],
            generate: async (request) => ({
              version: 1,
              targetSetDigest: request.targetSetDigest,
              files: request.targets.map((target) => ({
                targetId: target.targetId,
                outcome: "unchanged" as const,
              })),
            }),
          }).compiler.compile(
            createCompileInput({
              targetAuthorizations: [
                createTargetAuthorization("Wiki/Page.md", {
                  expectedContentHash: createFileContentHash(existing),
                }),
              ],
            }),
            new AbortController().signal
          )
        );
        expect(explicitUnchanged.compileContextDigest).toBe(result.compileContextDigest);
        expect(explicitUnchanged.manifestCommitPlan).toHaveProperty("generationOutcomes", {
          explicitUnchanged: 1,
          identicalWrites: 0,
        });
        expect(explicitUnchanged.analysis.claims).toEqual([]);
        expect(result.analysis.claims).toHaveLength(1);
        expect(explicitUnchanged.manifestCommitPlan.evidenceDigest).not.toBe(
          result.manifestCommitPlan.evidenceDigest
        );
        expect(explicitUnchanged.noChangesId).not.toBe(result.noChangesId);
      });

      it("counts mixed explicit and byte-identical outcomes without retaining generated content — https://github.com/yydspanda/obsidian-copilot/issues/15", async () => {
        const existing = "A source-grounded page with a manual correction.";
        const paths = ["Wiki/Alpha.md", "Wiki/Beta.md"];
        const harness = createHarness({
          resolve: async (targets) =>
            targets.map((target) => ({
              targetId: target.targetId,
              kind: "file",
              path: target.path,
              content: existing,
            })),
          generate: async (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: request.targets.map((target, index) =>
              index === 0
                ? { targetId: target.targetId, outcome: "unchanged" }
                : {
                    claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                    targetId: target.targetId,
                    outcome: "write",
                    afterContent: existing,
                  }
            ),
          }),
        });
        const result = requireNoChanges(
          await harness.compiler.compile(
            createCompileInput({
              targetAuthorizations: paths.map((path) =>
                createTargetAuthorization(path, {
                  expectedContentHash: createFileContentHash(existing),
                })
              ),
            }),
            new AbortController().signal
          )
        );

        expect(result.manifestCommitPlan).toHaveProperty("generationOutcomes", {
          explicitUnchanged: 1,
          identicalWrites: 1,
        });
        expect(JSON.stringify(result.manifestCommitPlan)).not.toContain(existing);
        expect(harness.validator.inputs).toHaveLength(0);
      });

      it.each([
        {
          name: "content hash",
          code: "compiler_authorization_manifest_hash_mismatch",
          mutate: (authorization: CompilerTargetAuthorization): CompilerTargetAuthorization => ({
            ...authorization,
            expectedContentHash: "f".repeat(64),
          }),
        },
        {
          name: "ownership",
          code: "compiler_authorization_manifest_authority_mismatch",
          mutate: (authorization: CompilerTargetAuthorization): CompilerTargetAuthorization => ({
            ...authorization,
            ownership: "shared",
          }),
        },
        {
          name: "source provenance",
          code: "compiler_authorization_manifest_sources_mismatch",
          mutate: (authorization: CompilerTargetAuthorization): CompilerTargetAuthorization => ({
            ...authorization,
            sourceRefs: ["source-1", "source-forged"],
          }),
        },
      ])(
        "rejects caller authorization drift in $name before model access",
        async ({ code, mutate }) => {
          const authority = createTargetAuthorization("Wiki/Page.md");
          const manifest = createManifest("personal", [authority]);
          const harness = createHarness();

          const result = requireFailure(
            await harness.compiler.compile(
              createCompileInput({ manifest, targetAuthorizations: [mutate(authority)] }),
              new AbortController().signal
            )
          );

          expect(result.stage).toBe("input");
          expect(diagnosticCodes(result)).toContain(code);
          expect(harness.model.generationRequests).toHaveLength(0);
          expect(harness.resolver.requests).toHaveLength(0);
        }
      );

      it("rejects an incomplete primary Manifest projection before model access", async () => {
        const harness = createHarness();
        const manifest = createManifest("personal", []);
        manifest.entries[0].lastSuccessful = {
          sourceContentHash: SOURCE_CONTENT_HASH,
          pipelineFingerprint: PIPELINE_FINGERPRINT,
          generatedPages: [{ path: "Wiki/Legacy.md", ownership: "generated" }],
          changeSetId: "legacy-changeset",
          completedAt: 1,
        };

        const result = requireFailure(
          await harness.compiler.compile(
            createCompileInput({ manifest }),
            new AbortController().signal
          )
        );

        expect(result.stage).toBe("input");
        expect(diagnosticCodes(result)).toContain("compiler_manifest_page_hash_missing");
        expect(harness.model.generationRequests).toHaveLength(0);
        expect(harness.resolver.requests).toHaveLength(0);
      });

      it("rejects an unlisted Manifest-tracked missing target but permits an authorized repair", async () => {
        const authority = createTargetAuthorization(DEFAULT_PATH);
        const manifest = createManifest("personal", [authority]);
        const unlistedHarness = createHarness();

        const rejected = requireFailure(
          await unlistedHarness.compiler.compile(
            createCompileInput({ manifest, targetAuthorizations: [] }),
            new AbortController().signal
          )
        );

        expect(rejected.stage).toBe("target_resolution");
        expect(diagnosticCodes(rejected)).toContain(
          "compiler_target_manifest_authorization_missing"
        );
        expect(unlistedHarness.resolver.requests).toHaveLength(0);
        expect(unlistedHarness.model.generationRequests).toHaveLength(0);
        expect(unlistedHarness.validator.inputs).toHaveLength(0);

        const authorizedHarness = createHarness();
        const repaired = requireProposal(
          await authorizedHarness.compiler.compile(
            createCompileInput({ manifest, targetAuthorizations: [authority] }),
            new AbortController().signal
          )
        );
        expect(repaired.changeSet.changes[0]).toMatchObject({
          path: DEFAULT_PATH,
          operation: "create",
        });
        expect(repaired.manifestCommitPlan.mutations[0]).toMatchObject({
          access: "authorized",
          wasTrackedByPrimarySource: true,
        });
      });

      it("rejects delete authorization shared by the primary and another source", async () => {
        const harness = createHarness();

        const result = requireFailure(
          await harness.compiler.compile(
            createCompileInput({
              targetAuthorizations: [
                createTargetAuthorization("Wiki/Delete.md", {
                  allowedIntents: ["delete"],
                  contentPolicy: "structural",
                  sourceRefs: ["source-1", "source-other"],
                  expectedContentHash: createFileContentHash("manifest-owned content"),
                }),
              ],
            }),
            new AbortController().signal
          )
        );

        expect(result.stage).toBe("input");
        expect(diagnosticCodes(result)).toContain("compiler_authorization_delete_source_mismatch");
        expect(harness.model.generationRequests).toHaveLength(0);
        expect(harness.resolver.requests).toHaveLength(0);
      });

      const generationCases: Array<{
        name: string;
        code: string;
        build: (request: CompilerGenerationRequest) => CompilerGenerationModelOutput;
      }> = [
        {
          name: "unknown target",
          code: "compiler_generation_target_unknown",
          build: (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: [
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: "target-not-approved",
                outcome: "write",
                afterContent: "unknown",
              },
            ],
          }),
        },
        {
          name: "duplicate target",
          code: "compiler_generation_target_duplicate",
          build: (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: [
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: "one",
              },
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: "two",
              },
            ],
          }),
        },
        {
          name: "missing target",
          code: "compiler_generation_target_missing",
          build: (request) => ({ version: 1, targetSetDigest: request.targetSetDigest, files: [] }),
        },
        {
          name: "wrong target-set digest",
          code: "compiler_generation_target_set_mismatch",
          build: (request) => ({
            version: 1,
            targetSetDigest: "0".repeat(64),
            files: [
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: "wrong target set",
              },
            ],
          }),
        },
      ];

      it.each(generationCases)("rejects generation with $name", async ({ build, code }) => {
        const harness = createHarness({ generate: async (request) => build(request) });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("generation");
        expect(diagnosticCodes(result)).toContain(code);
        expect(harness.validator.inputs).toHaveLength(0);
      });

      const resolverCases: Array<{
        name: string;
        code: string;
        build: (targets: readonly CompilerTargetRequest[]) => unknown;
      }> = [
        {
          name: "missing observation",
          code: "compiler_observation_missing",
          build: () => [],
        },
        {
          name: "duplicate observation",
          code: "compiler_observation_duplicate",
          build: (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "missing",
              windowsPathKey: toWindowsPathKey(targets[0].path),
            },
            {
              targetId: targets[0].targetId,
              kind: "missing",
              windowsPathKey: toWindowsPathKey(targets[0].path),
            },
          ],
        },
        {
          name: "unknown observation",
          code: "compiler_observation_unknown_target",
          build: (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "missing",
              windowsPathKey: toWindowsPathKey(targets[0].path),
            },
            {
              targetId: "target-not-approved",
              kind: "missing",
              windowsPathKey: "wiki/not-approved.md",
            },
          ],
        },
        {
          name: "missing observation with the wrong Windows key",
          code: "compiler_missing_windows_key_mismatch",
          build: (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "missing",
              windowsPathKey: "wiki/different.md",
            },
          ],
        },
        {
          name: "directory observation",
          code: "compiler_target_is_directory",
          build: (targets) => [
            { targetId: targets[0].targetId, kind: "directory", path: targets[0].path },
          ],
        },
      ];

      it.each(resolverCases)("fails closed for a $name", async ({ build, code }) => {
        const harness = createHarness({ resolve: async (targets) => build(targets) });

        const result = requireFailure(
          await harness.compiler.compile(
            createCompileInput({
              targetAuthorizations: [createTargetAuthorization("Wiki/Page.md")],
            }),
            new AbortController().signal
          )
        );

        expect(result.stage).toBe("target_resolution");
        expect(diagnosticCodes(result)).toContain(code);
        expect(harness.model.generationRequests).toHaveLength(0);
        expect(harness.validator.inputs).toHaveLength(0);
      });

      it.each([
        {
          name: "opaque occupied result",
          observation: (target: CompilerTargetRequest) => ({
            targetId: target.targetId,
            kind: "occupied" as const,
            path: toWindowsPathKey(target.path),
          }),
        },
        {
          name: "malicious file-content result",
          observation: (target: CompilerTargetRequest) => ({
            targetId: target.targetId,
            kind: "file" as const,
            path: toWindowsPathKey(target.path),
            content: "private existing page content",
          }),
        },
      ])("rejects an unapproved existing target from a $name", async ({ observation }) => {
        const harness = createHarness({
          resolve: async (targets) => [observation(targets[0])],
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("target_resolution");
        expect(diagnosticCodes(result)).toContain("compiler_unapproved_existing_target");
        expect(harness.resolver.requests[0][0]).toMatchObject({
          path: DEFAULT_PATH,
          access: "create_only",
        });
        expect(harness.model.generationRequests).toHaveLength(0);
        expect(harness.validator.inputs).toHaveLength(0);
      });

      it("uses the resolver's canonical Windows case alias for an existing file", async () => {
        const existing = "---\ntype: concept\n---\n\nOld alias\n";
        const replacement = "---\ntype: concept\n---\n\nNew alias\n";
        const harness = createHarness({
          resolve: async (targets) => [
            {
              targetId: targets[0].targetId,
              kind: "file",
              path: "wiki/CASEALIAS.md",
              content: existing,
            },
          ],
          generate: async (request) => ({
            version: 1,
            targetSetDigest: request.targetSetDigest,
            files: [
              {
                claims: [{ text: SOURCE_TEXT, evidenceIds: ["evidence-1"] }],
                targetId: request.targets[0].targetId,
                outcome: "write",
                afterContent: replacement,
              },
            ],
          }),
        });

        const result = requireProposal(
          await harness.compiler.compile(
            createCompileInput({
              targetAuthorizations: [
                createTargetAuthorization("Wiki/CaseAlias.md", {
                  expectedContentHash: createFileContentHash(existing),
                }),
              ],
            }),
            new AbortController().signal
          )
        );

        expect(result.changeSet.changes).toEqual([
          expect.objectContaining({
            operation: "update",
            path: "wiki/CASEALIAS.md",
            beforeHash: createFileContentHash(existing),
            afterHash: createFileContentHash(replacement),
          }),
        ]);
      });

      it("rejects any false runtime validation flag", async () => {
        const harness = createHarness({
          validate: async () => ({
            validation: { okfValid: true, citationsValid: false, linksValid: true },
            diagnostics: [],
          }),
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("candidate_validation");
        expect(diagnosticCodes(result)).toContain("compiler_candidate_citations_invalid");
      });

      it("rejects malformed candidate-validator success payloads", async () => {
        const harness = createHarness({
          validate: async () => ({ validation: VALIDATION_SUCCESS.validation }),
        });

        const result = requireFailure(
          await harness.compiler.compile(createCompileInput(), new AbortController().signal)
        );

        expect(result.stage).toBe("candidate_validation");
        expect(diagnosticCodes(result)).toContain("schema_invalid_type");
      });

      it("issues one opaque, single-use generation authorization with the exact frozen input and binding — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const harness = createHarness();
        const calls: KnowledgeCompilerModelCall[] = [];
        harness.model.authorizationHandler = (authorization) => {
          expect(Object.isFrozen(authorization)).toBe(true);
          expect(Reflect.ownKeys(authorization as object)).toEqual([]);
          for (const forged of [
            { ...(authorization as object) },
            Object.create(KnowledgeCompilerModelCallAuthorization.prototype) as object,
          ]) {
            expect(() =>
              KnowledgeCompilerModelCallAuthorization.consume(forged, "generation")
            ).toThrow(TypeError);
          }
          expect(() =>
            KnowledgeCompilerModelCallAuthorization.consume(authorization, "analysis" as never)
          ).toThrow(TypeError);
          calls.push(KnowledgeCompilerModelCallAuthorization.consume(authorization, "generation"));
          expect(() =>
            KnowledgeCompilerModelCallAuthorization.consume(authorization, "generation")
          ).toThrow(TypeError);
        };
        const controller = new AbortController();
        requireProposal(await harness.compiler.compile(createCompileInput(), controller.signal));

        expect(calls).toHaveLength(1);
        const call = calls[0];
        expect(call.stage).toBe("generation");
        expect(call.request).toBe(harness.model.generationRequests[0]);
        expect(call.signal).toBe(controller.signal);
        KnowledgeCompilerModelSession.assert(call.session);
        for (const value of [
          call,
          call.request,
          call.session,
          call.targets,
          KnowledgeCompilerModelCallAuthorization,
          KnowledgeCompilerModelCallAuthorization.prototype,
          KnowledgeCompilerModelSession,
          KnowledgeCompilerModelSession.prototype,
        ]) {
          expect(Object.isFrozen(value)).toBe(true);
        }
        expect(call).not.toHaveProperty("rawAnalysis");
        expect(call).not.toHaveProperty("analysis");
        expect(() => KnowledgeCompilerModelSession.assert({ ...call.session })).toThrow(TypeError);
        expect(() =>
          KnowledgeCompilerModelSession.assert(
            Object.create(KnowledgeCompilerModelSession.prototype)
          )
        ).toThrow(TypeError);
        expect(() => new KnowledgeCompilerModelSession(Symbol("forged"))).toThrow(TypeError);
        expect(() => new KnowledgeCompilerModelCallAuthorization(Symbol("forged"))).toThrow(
          TypeError
        );
      });

      it("mints distinct model sessions for separate compile attempts — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const harness = createHarness();
        const calls: KnowledgeCompilerModelCall[] = [];
        harness.model.authorizationHandler = (authorization) =>
          calls.push(KnowledgeCompilerModelCallAuthorization.consume(authorization, "generation"));
        for (let attempt = 0; attempt < 2; attempt += 1) {
          requireProposal(
            await harness.compiler.compile(createCompileInput(), new AbortController().signal)
          );
        }
        expect(calls).toHaveLength(2);
        expect(calls[0].session).not.toBe(calls[1].session);
      });

      it("sanitizes a rejected generation authorization before invoking the model — https://github.com/yydspanda/obsidian-copilot/issues/20", async () => {
        const harness = createHarness();
        harness.model.authorizationHandler = () => {
          throw new Error("sk-authorization-private-canary");
        };
        let caught: unknown;
        try {
          await harness.compiler.compile(createCompileInput(), new AbortController().signal);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
        expect(caught).toMatchObject({ stage: "generation", code: "model_authority_failed" });
        expect(String(caught)).not.toContain("sk-authorization-private-canary");
        expect(JSON.stringify(caught)).not.toContain("sk-authorization-private-canary");
        expect(harness.model.generationRequests).toHaveLength(0);
      });

      it.each<Exclude<KnowledgeCompilerStage, "input">>([
        "target_resolution",
        "generation",
        "candidate_validation",
      ])("sanitizes a raw %s dependency rejection", async (stage) => {
        const reject = async (): Promise<never> => {
          throw new Error("provider failed with api_key=sk-test-secret-that-must-not-leak");
        };
        const harness = createHarness(
          stage === "target_resolution"
            ? { resolve: reject }
            : stage === "generation"
              ? { generate: reject }
              : { validate: reject }
        );
        let thrown: unknown;

        try {
          await harness.compiler.compile(createCompileInput(), new AbortController().signal);
        } catch (error) {
          thrown = error;
        }

        const modelStage = stage === "generation";
        expect(thrown).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
        expect(thrown).toMatchObject({
          name: "KnowledgeCompilerInfrastructureError",
          stage,
          code: modelStage ? "model_authority_failed" : "dependency_failed",
          retryable: !modelStage,
          rateLimited: false,
        });
        expect(String(thrown)).not.toContain("sk-test-secret");
        expect(JSON.stringify(thrown)).not.toContain("sk-test-secret");
        expect(thrown).not.toHaveProperty("cause");
      });

      it("rejects structural classifier facts instead of accepting retry booleans", async () => {
        const harness = createHarness({
          generate: async () => {
            throw new Error("raw provider failure");
          },
          classifyModelFailure: () =>
            ({
              code: "provider_rate_limited",
              retryable: true,
              rateLimited: true,
            }) as never,
        });
        let thrown: unknown;

        try {
          await harness.compiler.compile(createCompileInput(), new AbortController().signal);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toMatchObject({
          code: "model_authority_failed",
          retryable: false,
          rateLimited: false,
        });
      });

      it("passes the exact caller AbortSignal through every successful dependency", async () => {
        const harness = createHarness();
        const controller = new AbortController();

        expect(
          requireProposal(await harness.compiler.compile(createCompileInput(), controller.signal))
            .kind
        ).toBe("proposed");

        expect(harness.resolver.signals).toEqual([controller.signal]);
        expect(harness.model.generationSignals).toEqual([controller.signal]);
        expect(harness.validator.signals).toEqual([controller.signal]);
      });

      it("rejects a pre-aborted signal without invoking the model or exposing its reason", async () => {
        const harness = createHarness();
        const controller = new AbortController();
        controller.abort("sk-private-abort-reason");
        let thrown: unknown;

        try {
          await harness.compiler.compile(createCompileInput(), controller.signal);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(KnowledgeCompilerAbortError);
        expect(thrown).toMatchObject({ name: "AbortError", stage: "target_resolution" });
        expect(String(thrown)).not.toContain("sk-private-abort-reason");
        expect(harness.model.generationRequests).toHaveLength(0);
      });
    });
  });
});
