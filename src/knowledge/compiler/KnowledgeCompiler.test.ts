import type {
  CompilerAnalysisModelOutput,
  CompilerAnalysisTargetDraft,
} from "@/knowledge/compiler/analysisSchema";
import { createKnowledgeSourceOriginExtensions } from "@/knowledge/capture/KnowledgeSourceOrigin";
import type {
  CompilerAnalysisRequest,
  CompilerCandidateValidationInput,
  CompilerCandidateValidator,
  CompilerGenerationRequest,
  CompilerModelPort,
  CompilerTargetAuthorization,
  CompilerTargetRequest,
  CompilerTargetResolver,
  KnowledgeCompileFailure,
  KnowledgeCompileInput,
  KnowledgeCompileNoChanges,
  KnowledgeCompileProposal,
  KnowledgeCompileResult,
  KnowledgeCompilerDependencyFailureClassifier,
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeCompiler,
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
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SOURCE_TEXT = "The source says deterministic compilation is safer.";
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_TEXT);
const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const SCHEMA_CONTENT = "type: knowledge-schema\n";
const DEFAULT_EXISTING_PAGE_HASH = createFileContentHash("default tracked page");
const VALIDATION_SUCCESS = {
  validation: { okfValid: true, citationsValid: true, linksValid: true },
  diagnostics: [],
} as const;

type AnalysisHandler = (request: CompilerAnalysisRequest, signal: AbortSignal) => Promise<unknown>;
type GenerationHandler = (
  request: CompilerGenerationRequest,
  signal: AbortSignal
) => Promise<unknown>;
type ResolverHandler = (
  targets: readonly CompilerTargetRequest[],
  signal: AbortSignal
) => Promise<unknown>;
type CandidateHandler = (
  input: CompilerCandidateValidationInput,
  signal: AbortSignal
) => Promise<unknown>;

/** Scriptable provider-neutral model that retains every request and signal. */
class FakeCompilerModel implements CompilerModelPort {
  readonly analysisRequests: CompilerAnalysisRequest[] = [];
  readonly analysisSignals: AbortSignal[] = [];
  readonly generationRequests: CompilerGenerationRequest[] = [];
  readonly generationSignals: AbortSignal[] = [];
  readonly modelCallAuthorizations: unknown[] = [];
  authorizationHandler?: (authorization: unknown) => void;

  /** Creates a fake with explicit handlers for both compiler stages. */
  constructor(
    private readonly analysisHandler: AnalysisHandler,
    private readonly generationHandler: GenerationHandler
  ) {}

  /** Records and optionally consumes one compiler-issued model-call authorization. */
  authorizeModelCall(authorization: unknown): void {
    this.modelCallAuthorizations.push(authorization);
    this.authorizationHandler?.(authorization);
  }

  /** Records and delegates one analysis request. */
  async analyze(request: CompilerAnalysisRequest, signal: AbortSignal): Promise<unknown> {
    this.analysisRequests.push(request);
    this.analysisSignals.push(signal);
    return this.analysisHandler(request, signal);
  }

  /** Records and delegates one generation request. */
  async generate(request: CompilerGenerationRequest, signal: AbortSignal): Promise<unknown> {
    this.generationRequests.push(request);
    this.generationSignals.push(signal);
    return this.generationHandler(request, signal);
  }
}

/** Scriptable read-only target resolver that retains every request and signal. */
class FakeTargetResolver implements CompilerTargetResolver {
  readonly requests: (readonly CompilerTargetRequest[])[] = [];
  readonly signals: AbortSignal[] = [];

  /** Creates a resolver around one explicit handler. */
  constructor(private readonly handler: ResolverHandler) {}

  /** Records and delegates exact target observation. */
  async resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown> {
    this.requests.push(targets);
    this.signals.push(signal);
    return this.handler(targets, signal);
  }
}

/** Scriptable deterministic candidate validator that retains input and signal identity. */
class FakeCandidateValidator implements CompilerCandidateValidator {
  readonly inputs: CompilerCandidateValidationInput[] = [];
  readonly signals: AbortSignal[] = [];

  /** Creates a validator around one explicit handler. */
  constructor(private readonly handler: CandidateHandler) {}

  /** Records and delegates one generated candidate validation. */
  async validate(input: CompilerCandidateValidationInput, signal: AbortSignal): Promise<unknown> {
    this.inputs.push(input);
    this.signals.push(signal);
    return this.handler(input, signal);
  }
}

interface CompilerHarnessOptions {
  analyze?: AnalysisHandler;
  generate?: GenerationHandler;
  resolve?: ResolverHandler;
  validate?: CandidateHandler;
  classifyModelFailure?: KnowledgeCompilerDependencyFailureClassifier;
}

interface CompilerHarness {
  compiler: KnowledgeCompiler;
  model: FakeCompilerModel;
  resolver: FakeTargetResolver;
  validator: FakeCandidateValidator;
}

/** Creates a valid deterministic compile input with optional top-level replacements. */
function createCompileInput(overrides: Partial<KnowledgeCompileInput> = {}): KnowledgeCompileInput {
  const bundle = overrides.bundle ?? {
    version: 1 as const,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Config/knowledge-schema.md",
    reviewMode: "always" as const,
  };
  const targetAuthorizations = overrides.targetAuthorizations ?? [];
  const manifest = overrides.manifest ?? createManifest(bundle.id, targetAuthorizations);
  return {
    bundle,
    operation: "ingest",
    source: {
      sourceId: "source-1",
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    manifest,
    schema: {
      path: "Config/knowledge-schema.md",
      content: SCHEMA_CONTENT,
      contentHash: createFileContentHash(SCHEMA_CONTENT),
    },
    artifacts: [
      {
        kind: "text",
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash: ARTIFACT_CONTENT_HASH,
        text: SOURCE_TEXT,
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-1",
        locator: {
          kind: "quote",
          sourceId: "source-1",
          artifactId: "artifact-1",
          artifactContentHash: ARTIFACT_CONTENT_HASH,
          excerpt: SOURCE_TEXT,
          quoteHash: createQuoteHash(SOURCE_TEXT),
        },
      },
    ],
    contextPages: [],
    targetAuthorizations,
    createdAt: 1_000,
    ...overrides,
  };
}

/** Creates one caller-owned target authorization for a known Wiki path. */
function createTargetAuthorization(
  path: string,
  overrides: Partial<CompilerTargetAuthorization> = {}
): CompilerTargetAuthorization {
  return {
    path,
    allowedIntents: ["write"],
    contentPolicy: "grounded",
    ownership: "generated",
    sourceRefs: ["source-1"],
    expectedContentHash: DEFAULT_EXISTING_PAGE_HASH,
    ...overrides,
  };
}

/** Creates an exact Manifest read-set matching caller-owned target authorities. */
function createManifest(
  bundleId: string,
  authorizations: readonly CompilerTargetAuthorization[]
): SourceManifest {
  const sourceIds = new Set<string>(["source-1"]);
  authorizations.forEach((authorization) =>
    authorization.sourceRefs.forEach((sourceId) => sourceIds.add(sourceId))
  );
  return {
    version: 1,
    bundleId,
    revision: 0,
    entries: [...sourceIds].sort().map((sourceId) => {
      const pages = authorizations
        .filter((authorization) => authorization.sourceRefs.includes(sourceId))
        .map((authorization) => ({
          path: authorization.path,
          ownership: authorization.ownership,
          contentHash: authorization.expectedContentHash ?? DEFAULT_EXISTING_PAGE_HASH,
        }))
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
      return {
        sourceId,
        sourceKey: `sources/${sourceId}.md`,
        sourcePath: `Sources/${sourceId}.md`,
        custody: "user_managed" as const,
        ...(pages.length === 0
          ? {}
          : {
              lastSuccessful: {
                sourceContentHash: SOURCE_CONTENT_HASH,
                pipelineFingerprint: PIPELINE_FINGERPRINT,
                generatedPages: pages,
                changeSetId: "previous-changeset",
                completedAt: 1,
              },
            }),
      };
    }),
  };
}

/** Creates one valid grounded analysis response with replaceable target intents. */
function createAnalysisOutput(
  targets: CompilerAnalysisTargetDraft[] = [
    {
      ref: "target-page",
      path: "Wiki/Page.md",
      intent: "write",
      reason: "Compile the grounded claim",
      claimRefs: ["claim-main"],
    },
  ],
  overrides: Partial<CompilerAnalysisModelOutput> = {}
): CompilerAnalysisModelOutput {
  return {
    version: 1,
    summary: "A deterministic grounded analysis",
    concepts: [{ ref: "concept-main", name: "Deterministic compilation" }],
    entities: [],
    claims: [{ ref: "claim-main", text: SOURCE_TEXT }],
    relations: [],
    citations: [{ claimRef: "claim-main", evidenceId: "evidence-1", relation: "supports" }],
    targets,
    ...overrides,
  };
}

/** Returns one missing observation for every runtime-approved target. */
async function resolveAllMissing(targets: readonly CompilerTargetRequest[]): Promise<unknown> {
  return targets.map((target) => ({
    targetId: target.targetId,
    kind: "missing" as const,
    windowsPathKey: toWindowsPathKey(target.path),
  }));
}

/** Generates deterministic content for every writable target in one request. */
async function generateAllWritable(request: CompilerGenerationRequest): Promise<unknown> {
  return {
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write" as const,
      afterContent: `---\ntype: concept\n---\n\n# ${target.path}\n`,
    })),
  } satisfies CompilerGenerationModelOutput;
}

/** Returns affirmative deterministic candidate validation. */
async function validateCandidateSuccessfully(): Promise<unknown> {
  return VALIDATION_SUCCESS;
}

/** Creates a compiler and inspectable scripted dependencies. */
function createHarness(options: CompilerHarnessOptions = {}): CompilerHarness {
  const model = new FakeCompilerModel(
    options.analyze ?? (async () => createAnalysisOutput()),
    options.generate ?? generateAllWritable
  );
  const resolver = new FakeTargetResolver(options.resolve ?? resolveAllMissing);
  const validator = new FakeCandidateValidator(options.validate ?? validateCandidateSuccessfully);
  return {
    compiler: new KnowledgeCompiler({
      model,
      ...(options.classifyModelFailure === undefined
        ? {}
        : { classifyModelFailure: options.classifyModelFailure }),
      targetResolver: resolver,
      candidateValidator: validator,
    }),
    model,
    resolver,
    validator,
  };
}

/** Requires one successful proposal and narrows its result type. */
function requireProposal(result: KnowledgeCompileResult): KnowledgeCompileProposal {
  if (result.kind !== "proposed") {
    throw new Error(`Expected a proposed compile result, received '${result.kind}'`);
  }
  return result;
}

/** Requires one controlled failure and narrows its result type. */
function requireFailure(result: KnowledgeCompileResult): KnowledgeCompileFailure {
  if (result.kind !== "failed") {
    throw new Error(`Expected a failed compile result, received '${result.kind}'`);
  }
  return result;
}

/** Requires one no-change outcome and narrows its result type. */
function requireNoChanges(result: KnowledgeCompileResult): KnowledgeCompileNoChanges {
  if (result.kind !== "no_changes") {
    throw new Error(`Expected a no_changes result, received '${result.kind}'`);
  }
  return result;
}

/** Extracts stable diagnostic codes for concise protocol assertions. */
function diagnosticCodes(result: KnowledgeCompileFailure | KnowledgeCompileNoChanges): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("KnowledgeCompiler deterministic ChangeSet projection", () => {
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

  it("produces byte-stable proposed create/update/delete changes with runtime-owned identity", async () => {
    const analysis = createAnalysisOutput([
      {
        ref: "target-update",
        path: "Wiki/Update.md",
        intent: "write",
        reason: "Update an existing page",
        claimRefs: ["claim-main"],
      },
      {
        ref: "target-create",
        path: "Wiki/Create.md",
        intent: "write",
        reason: "Create a new page",
        claimRefs: ["claim-main"],
      },
      {
        ref: "target-delete",
        path: "Wiki/Delete.md",
        intent: "delete",
        reason: "Remove an obsolete generated page",
        claimRefs: ["claim-main"],
      },
    ]);
    const oldUpdate = "---\ntype: concept\n---\n\nOld update\n";
    const oldDelete = "---\ntype: concept\n---\n\nObsolete\n";
    const newCreate = "---\ntype: concept\n---\n\n# Created\n";
    const newUpdate = "---\ntype: concept\n---\n\n# Updated\n";
    const targetAuthorizations = [
      createTargetAuthorization("Wiki/Update.md", {
        expectedContentHash: createFileContentHash(oldUpdate),
      }),
      createTargetAuthorization("Wiki/Delete.md", {
        allowedIntents: ["delete"],
        contentPolicy: "structural",
        expectedContentHash: createFileContentHash(oldDelete),
      }),
    ];
    const harness = createHarness({
      analyze: async () => analysis,
      resolve: async (targets) =>
        targets.map((target) => {
          if (target.path === "Wiki/Create.md") {
            return {
              targetId: target.targetId,
              kind: "missing" as const,
              windowsPathKey: toWindowsPathKey(target.path),
            };
          }
          return {
            targetId: target.targetId,
            kind: "file" as const,
            path: target.path,
            content: target.path === "Wiki/Update.md" ? oldUpdate : oldDelete,
          };
        }),
      generate: async (request) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: request.targets.map((target) => ({
          targetId: target.targetId,
          outcome: "write" as const,
          afterContent: target.path === "Wiki/Create.md" ? newCreate : newUpdate,
        })),
      }),
    });
    const input = createCompileInput({ targetAuthorizations });

    const first = requireProposal(
      await harness.compiler.compile(input, new AbortController().signal)
    );
    const second = requireProposal(
      await harness.compiler.compile(
        createCompileInput({ targetAuthorizations }),
        new AbortController().signal
      )
    );

    expect(second).toEqual(first);
    const nextObservation = requireProposal(
      await harness.compiler.compile(
        createCompileInput({
          targetAuthorizations,
          source: { ...input.source, inputRevision: 2 },
        }),
        new AbortController().signal
      )
    );
    expect(nextObservation.changeSet.id).not.toBe(first.changeSet.id);
    expect(first.changeSet).toMatchObject({
      bundleId: "personal",
      operation: "ingest",
      status: "proposed",
      createdAt: 1_000,
      validation: { okfValid: true, citationsValid: true, linksValid: true },
    });
    expect(first.changeSet.id).toMatch(/^changeset-[a-f0-9]{64}$/);
    expect(first.changeSet.changes).toEqual([
      expect.objectContaining({
        operation: "create",
        path: "Wiki/Create.md",
        expectedAbsent: true,
        afterContent: newCreate,
        afterHash: createFileContentHash(newCreate),
      }),
      expect.objectContaining({
        operation: "delete",
        path: "Wiki/Delete.md",
        beforeHash: createFileContentHash(oldDelete),
      }),
      expect.objectContaining({
        operation: "update",
        path: "Wiki/Update.md",
        beforeHash: createFileContentHash(oldUpdate),
        afterContent: newUpdate,
        afterHash: createFileContentHash(newUpdate),
      }),
    ]);
    for (const change of first.changeSet.changes) {
      expect(change.id).toMatch(/^change-[a-f0-9]{64}$/);
      expect(["target-create", "target-update", "target-delete"]).not.toContain(change.id);
    }
    expect(first.proposalDigest).toBe(createChangeSetTransactionDigest(first.changeSet));
    expect(first.manifestCommitPlanDigest).toBe(
      createManifestCommitPlanDigest(first.manifestCommitPlan)
    );
    expect(first.manifestCommitPlan).toMatchObject({
      version: 1,
      kind: "source_compile",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: input.source.sourceContentHash,
      pipelineFingerprint: input.source.pipelineFingerprint,
      inputRevision: 1,
      changeSetId: first.changeSet.id,
      expectedManifestRevision: input.manifest.revision,
      expectedManifestDigest: createSourceManifestDigest(input.manifest),
    });
    expect(first.manifestCommitPlan.baseGeneratedPages).toEqual([
      {
        path: "Wiki/Delete.md",
        ownership: "generated",
        contentHash: createFileContentHash(oldDelete),
      },
      {
        path: "Wiki/Update.md",
        ownership: "generated",
        contentHash: createFileContentHash(oldUpdate),
      },
    ]);
    expect(first.manifestCommitPlan.mutations).toEqual([
      expect.objectContaining({
        path: "Wiki/Create.md",
        operation: "create",
        ownership: "generated",
        wasTrackedByPrimarySource: false,
      }),
      expect.objectContaining({
        path: "Wiki/Delete.md",
        operation: "delete",
        ownership: "generated",
        wasTrackedByPrimarySource: true,
      }),
      expect.objectContaining({
        path: "Wiki/Update.md",
        operation: "update",
        ownership: "generated",
        wasTrackedByPrimarySource: true,
      }),
    ]);
    expect(nextObservation.manifestCommitPlanDigest).not.toBe(first.manifestCommitPlanDigest);
    expect(harness.validator.inputs[0].draft).not.toHaveProperty("status");
    expect(harness.validator.inputs[0].draft).not.toHaveProperty("validation");
    expect(harness.model.generationRequests).toHaveLength(3);
    for (const request of harness.model.generationRequests) {
      expect(request.targets.map((target) => [target.path, target.operation])).toEqual([
        ["Wiki/Create.md", "create"],
        ["Wiki/Update.md", "update"],
      ]);
      expect(request.targets).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "Wiki/Delete.md" })])
      );
      expect(JSON.stringify(request)).not.toContain(oldDelete);
    }
  });

  it("allows an unlisted target only after a Windows-keyed missing observation", async () => {
    const harness = createHarness();

    const result = requireProposal(
      await harness.compiler.compile(createCompileInput(), new AbortController().signal)
    );

    expect(harness.resolver.requests[0]).toEqual([
      expect.objectContaining({
        path: "Wiki/Page.md",
        intent: "write",
        access: "create_only",
      }),
    ]);
    expect(result.analysis.targets[0]).toMatchObject({
      path: "Wiki/Page.md",
      access: "create_only",
      ownership: "new",
    });
    expect(result.changeSet.changes).toEqual([
      expect.objectContaining({
        operation: "create",
        path: "Wiki/Page.md",
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

  it("returns no_changes without resolving or generating when analysis approves no targets", async () => {
    const harness = createHarness({ analyze: async () => createAnalysisOutput([]) });

    const result = requireNoChanges(
      await harness.compiler.compile(createCompileInput(), new AbortController().signal)
    );

    expect(result.analysis.targets).toEqual([]);
    expect(harness.resolver.requests).toHaveLength(0);
    expect(harness.model.generationRequests).toHaveLength(0);
    expect(harness.validator.inputs).toHaveLength(0);
  });

  it("treats a byte-identical update as no change before candidate validation", async () => {
    const existing = "---\ntype: concept\n---\n\nUnchanged\n";
    const harness = createHarness({
      resolve: async (targets) => [
        { targetId: targets[0].targetId, kind: "file", path: targets[0].path, content: existing },
      ],
      generate: async (request) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: [
          { targetId: request.targets[0].targetId, outcome: "write", afterContent: existing },
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
    expect(harness.validator.inputs).toHaveLength(0);
  });
});

describe("KnowledgeCompiler fail-closed analysis and generation", () => {
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
      expect(harness.model.analysisRequests).toHaveLength(0);
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
      await harness.compiler.compile(createCompileInput({ manifest }), new AbortController().signal)
    );

    expect(result.stage).toBe("input");
    expect(diagnosticCodes(result)).toContain("compiler_manifest_page_hash_missing");
    expect(harness.model.analysisRequests).toHaveLength(0);
    expect(harness.resolver.requests).toHaveLength(0);
  });

  it("rejects an unlisted Manifest-tracked missing target but permits an authorized repair", async () => {
    const authority = createTargetAuthorization("Wiki/Page.md");
    const manifest = createManifest("personal", [authority]);
    const unlistedHarness = createHarness();

    const rejected = requireFailure(
      await unlistedHarness.compiler.compile(
        createCompileInput({ manifest, targetAuthorizations: [] }),
        new AbortController().signal
      )
    );

    expect(rejected.stage).toBe("analysis");
    expect(diagnosticCodes(rejected)).toContain("compiler_target_manifest_authorization_missing");
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
      path: "Wiki/Page.md",
      operation: "create",
    });
    expect(repaired.manifestCommitPlan.mutations[0]).toMatchObject({
      access: "authorized",
      wasTrackedByPrimarySource: true,
    });
  });

  it.each([
    {
      name: "strictly malformed output",
      output: { ...createAnalysisOutput(), status: "accepted" },
      code: "schema_unrecognized_keys",
    },
    {
      name: "target outside the Wiki boundary",
      output: createAnalysisOutput([
        {
          ref: "target-raw",
          path: "Sources/Raw.md",
          intent: "write",
          reason: "Attempt to overwrite source material",
          claimRefs: ["claim-main"],
        },
      ]),
      code: "compiler_target_outside_wiki",
    },
  ])("rejects $name before resolver or generation", async ({ output, code }) => {
    const harness = createHarness({ analyze: async () => output });

    const result = requireFailure(
      await harness.compiler.compile(createCompileInput(), new AbortController().signal)
    );

    expect(result.stage).toBe("analysis");
    expect(diagnosticCodes(result)).toContain(code);
    expect(harness.resolver.requests).toHaveLength(0);
    expect(harness.model.generationRequests).toHaveLength(0);
    expect(harness.validator.inputs).toHaveLength(0);
  });

  it("rejects deletion when the known path lacks explicit delete authorization", async () => {
    const harness = createHarness({
      analyze: async () =>
        createAnalysisOutput([
          {
            ref: "target-delete",
            path: "Wiki/Delete.md",
            intent: "delete",
            reason: "Attempt an unauthorized deletion",
            claimRefs: ["claim-main"],
          },
        ]),
    });

    const result = requireFailure(
      await harness.compiler.compile(
        createCompileInput({
          targetAuthorizations: [createTargetAuthorization("Wiki/Delete.md")],
        }),
        new AbortController().signal
      )
    );

    expect(result.stage).toBe("analysis");
    expect(diagnosticCodes(result)).toContain("compiler_target_delete_unauthorized");
    expect(harness.resolver.requests).toHaveLength(0);
    expect(harness.model.generationRequests).toHaveLength(0);
    expect(harness.validator.inputs).toHaveLength(0);
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
    expect(harness.model.analysisRequests).toHaveLength(0);
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
        files: [{ targetId: "target-not-approved", outcome: "write", afterContent: "unknown" }],
      }),
    },
    {
      name: "duplicate target",
      code: "compiler_generation_target_duplicate",
      build: (request) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: [
          { targetId: request.targets[0].targetId, outcome: "write", afterContent: "one" },
          { targetId: request.targets[0].targetId, outcome: "write", afterContent: "two" },
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
});

describe("KnowledgeCompiler target resolver boundary", () => {
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
        path: "wiki/PAGE.md",
      }),
    },
    {
      name: "malicious file-content result",
      observation: (target: CompilerTargetRequest) => ({
        targetId: target.targetId,
        kind: "file" as const,
        path: "wiki/PAGE.md",
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
      path: "Wiki/Page.md",
      access: "create_only",
    });
    expect(harness.model.generationRequests).toHaveLength(0);
    expect(harness.validator.inputs).toHaveLength(0);
  });

  it("rejects deletion when the current page differs from the manifest-generated hash", async () => {
    const lastGenerated = "---\ntype: concept\n---\n\nGenerated content\n";
    const manuallyEdited = "---\ntype: concept\n---\n\nMy manual edit\n";
    const harness = createHarness({
      analyze: async () =>
        createAnalysisOutput([
          {
            ref: "target-delete",
            path: "Wiki/Delete.md",
            intent: "delete",
            reason: "Remove a generated page",
            claimRefs: ["claim-main"],
          },
        ]),
      resolve: async (targets) => [
        {
          targetId: targets[0].targetId,
          kind: "file",
          path: targets[0].path,
          content: manuallyEdited,
        },
      ],
    });

    const result = requireFailure(
      await harness.compiler.compile(
        createCompileInput({
          targetAuthorizations: [
            createTargetAuthorization("Wiki/Delete.md", {
              allowedIntents: ["delete"],
              contentPolicy: "structural",
              expectedContentHash: createFileContentHash(lastGenerated),
            }),
          ],
        }),
        new AbortController().signal
      )
    );

    expect(result.stage).toBe("target_resolution");
    expect(diagnosticCodes(result)).toContain("compiler_delete_content_changed");
    expect(harness.resolver.requests[0][0]).toMatchObject({
      path: "Wiki/Delete.md",
      intent: "delete",
      access: "authorized",
    });
    expect(harness.model.generationRequests).toHaveLength(0);
    expect(harness.validator.inputs).toHaveLength(0);
  });

  it("uses the resolver's canonical Windows case alias for an existing file", async () => {
    const existing = "---\ntype: concept\n---\n\nOld alias\n";
    const replacement = "---\ntype: concept\n---\n\nNew alias\n";
    const harness = createHarness({
      analyze: async () =>
        createAnalysisOutput([
          {
            ref: "target-alias",
            path: "Wiki/CaseAlias.md",
            intent: "write",
            reason: "Update the canonical existing path",
            claimRefs: ["claim-main"],
          },
        ]),
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
});

describe("KnowledgeCompiler candidate validation boundary", () => {
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
});

/** Creates a harness whose selected dependency rejects with sensitive raw text. */
function createThrowingHarness(stage: Exclude<KnowledgeCompilerStage, "input">): CompilerHarness {
  const secretFailure = async (): Promise<never> => {
    throw new Error("provider failed with api_key=sk-test-secret-that-must-not-leak");
  };
  if (stage === "analysis") {
    return createHarness({ analyze: secretFailure });
  }
  if (stage === "target_resolution") {
    return createHarness({ resolve: secretFailure });
  }
  if (stage === "generation") {
    return createHarness({ generate: secretFailure });
  }
  return createHarness({ validate: secretFailure });
}

describe("KnowledgeCompiler model-call authorization", () => {
  it("issues opaque one-shot authorizations containing exact frozen compiler objects", async () => {
    const rawAnalysis = createAnalysisOutput();
    const harness = createHarness({ analyze: async () => rawAnalysis });
    const calls: KnowledgeCompilerModelCall[] = [];
    harness.model.authorizationHandler = (authorization) => {
      const expectedStage = calls.length === 0 ? "analysis" : "generation";
      expect(Object.isFrozen(authorization)).toBe(true);
      expect(Reflect.ownKeys(authorization as object)).toEqual([]);
      expect(() =>
        KnowledgeCompilerModelCallAuthorization.consume(
          { ...(authorization as object) },
          expectedStage
        )
      ).toThrow(TypeError);
      expect(() =>
        KnowledgeCompilerModelCallAuthorization.consume(
          Object.create(KnowledgeCompilerModelCallAuthorization.prototype),
          expectedStage
        )
      ).toThrow(TypeError);
      const wrongStage = expectedStage === "analysis" ? "generation" : "analysis";
      expect(() =>
        KnowledgeCompilerModelCallAuthorization.consume(authorization, wrongStage)
      ).toThrow(TypeError);
      const call = KnowledgeCompilerModelCallAuthorization.consume(authorization, expectedStage);
      expect(() =>
        KnowledgeCompilerModelCallAuthorization.consume(authorization, expectedStage)
      ).toThrow(TypeError);
      calls.push(call);
    };
    const controller = new AbortController();

    const result = requireProposal(
      await harness.compiler.compile(createCompileInput(), controller.signal)
    );

    expect(calls).toHaveLength(2);
    const analysisCall = calls[0];
    const generationCall = calls[1];
    expect(analysisCall.stage).toBe("analysis");
    expect(analysisCall.request).toBe(harness.model.analysisRequests[0]);
    expect(analysisCall.signal).toBe(controller.signal);
    expect(analysisCall.session).toBe(generationCall.session);
    KnowledgeCompilerModelSession.assert(analysisCall.session);
    expect(Object.isFrozen(analysisCall.session)).toBe(true);
    expect(Reflect.ownKeys(analysisCall.session)).toEqual([]);
    expect(Object.isFrozen(analysisCall)).toBe(true);
    expect(Object.isFrozen(analysisCall.request)).toBe(true);
    expect(generationCall.stage).toBe("generation");
    if (generationCall.stage !== "generation") {
      throw new Error("Expected a generation authorization");
    }
    expect(generationCall.request).toBe(harness.model.generationRequests[0]);
    expect(generationCall.signal).toBe(controller.signal);
    expect(generationCall.rawAnalysis).toBe(rawAnalysis);
    expect(generationCall.analysis).toBe(result.analysis);
    expect(generationCall.targets).toBe(harness.validator.inputs[0].targets);
    expect(Object.isFrozen(generationCall)).toBe(true);
    expect(Object.isFrozen(generationCall.analysis)).toBe(true);
    expect(Object.isFrozen(generationCall.analysis.targets)).toBe(true);
    expect(Object.isFrozen(generationCall.targets)).toBe(true);
    expect(Object.isFrozen(KnowledgeCompilerModelCallAuthorization.prototype)).toBe(true);
    expect(Object.isFrozen(KnowledgeCompilerModelCallAuthorization)).toBe(true);
    expect(Object.isFrozen(KnowledgeCompilerModelSession.prototype)).toBe(true);
    expect(Object.isFrozen(KnowledgeCompilerModelSession)).toBe(true);
    expect(() => KnowledgeCompilerModelSession.assert({ ...analysisCall.session })).toThrow(
      TypeError
    );
    expect(() =>
      KnowledgeCompilerModelSession.assert(Object.create(KnowledgeCompilerModelSession.prototype))
    ).toThrow(TypeError);
    expect(() => new KnowledgeCompilerModelSession(Symbol("forged"))).toThrow(TypeError);
    expect(() => new KnowledgeCompilerModelCallAuthorization(Symbol("forged"))).toThrow(TypeError);
  });

  it("mints a distinct model session for every compile invocation", async () => {
    const harness = createHarness();
    const calls: KnowledgeCompilerModelCall[] = [];
    harness.model.authorizationHandler = (authorization) => {
      const expectedStage = calls.length % 2 === 0 ? "analysis" : "generation";
      calls.push(KnowledgeCompilerModelCallAuthorization.consume(authorization, expectedStage));
    };

    await expect(
      harness.compiler.compile(createCompileInput(), new AbortController().signal)
    ).resolves.toMatchObject({ kind: "proposed" });
    await expect(
      harness.compiler.compile(createCompileInput(), new AbortController().signal)
    ).resolves.toMatchObject({ kind: "proposed" });

    expect(calls).toHaveLength(4);
    expect(calls[0].session).toBe(calls[1].session);
    expect(calls[2].session).toBe(calls[3].session);
    expect(calls[0].session).not.toBe(calls[2].session);
  });

  it.each(["analysis", "generation"] as const)(
    "sanitizes a rejected %s authorization hook before invoking that model stage",
    async (stage) => {
      const secretCanary = "sk-model-authorization-secret-canary";
      const harness = createHarness();
      let authorizationCalls = 0;
      harness.model.authorizationHandler = () => {
        authorizationCalls += 1;
        if (stage === "analysis" || authorizationCalls === 2) {
          throw new Error(secretCanary);
        }
      };
      let caught: unknown;

      try {
        await harness.compiler.compile(createCompileInput(), new AbortController().signal);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
      expect(caught).toMatchObject({ stage });
      expect(String(caught)).not.toContain(secretCanary);
      expect(JSON.stringify(caught)).not.toContain(secretCanary);
      expect(harness.model.analysisRequests).toHaveLength(stage === "analysis" ? 0 : 1);
      expect(harness.model.generationRequests).toHaveLength(0);
    }
  );
});

describe("KnowledgeCompiler dependency isolation and cancellation", () => {
  it.each<Exclude<KnowledgeCompilerStage, "input">>([
    "analysis",
    "target_resolution",
    "generation",
    "candidate_validation",
  ])("sanitizes a raw %s dependency rejection", async (stage) => {
    const harness = createThrowingHarness(stage);
    let thrown: unknown;

    try {
      await harness.compiler.compile(createCompileInput(), new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    const modelStage = stage === "analysis" || stage === "generation";
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
      analyze: async () => {
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
      requireProposal(await harness.compiler.compile(createCompileInput(), controller.signal)).kind
    ).toBe("proposed");

    expect(harness.model.analysisSignals).toEqual([controller.signal]);
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
    expect(thrown).toMatchObject({ name: "AbortError", stage: "analysis" });
    expect(String(thrown)).not.toContain("sk-private-abort-reason");
    expect(harness.model.analysisRequests).toHaveLength(0);
  });
});
