import type {
  CompilerAnalysisModelOutput,
  CompilerAnalysisTargetDraft,
} from "@/knowledge/compiler/analysisSchema";
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
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeCompiler,
  KnowledgeCompilerAbortError,
  KnowledgeCompilerInfrastructureError,
} from "@/knowledge/compiler/KnowledgeCompiler";
import type { CompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";
import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SOURCE_TEXT = "The source says deterministic compilation is safer.";
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_TEXT);
const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const SCHEMA_CONTENT = "type: knowledge-schema\n";
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

  /** Creates a fake with explicit handlers for both compiler stages. */
  constructor(
    private readonly analysisHandler: AnalysisHandler,
    private readonly generationHandler: GenerationHandler
  ) {}

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
}

interface CompilerHarness {
  compiler: KnowledgeCompiler;
  model: FakeCompilerModel;
  resolver: FakeTargetResolver;
  validator: FakeCandidateValidator;
}

/** Creates a valid deterministic compile input with optional top-level replacements. */
function createCompileInput(overrides: Partial<KnowledgeCompileInput> = {}): KnowledgeCompileInput {
  return {
    bundle: {
      version: 1,
      id: "personal",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Config/knowledge-schema.md",
      reviewMode: "always",
    },
    operation: "ingest",
    source: {
      sourceId: "source-1",
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
    },
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
    targetAuthorizations: [],
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
    ...overrides,
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
      createTargetAuthorization("Wiki/Update.md"),
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
    expect(harness.validator.inputs[0].draft).not.toHaveProperty("status");
    expect(harness.validator.inputs[0].draft).not.toHaveProperty("validation");
    expect(harness.model.generationRequests).toHaveLength(2);
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
          targetAuthorizations: [createTargetAuthorization("Wiki/Page.md")],
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
          targetAuthorizations: [createTargetAuthorization("Wiki/CaseAlias.md")],
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

    expect(thrown).toBeInstanceOf(KnowledgeCompilerInfrastructureError);
    expect(thrown).toMatchObject({
      name: "KnowledgeCompilerInfrastructureError",
      stage,
      retryable: true,
    });
    expect(String(thrown)).not.toContain("sk-test-secret");
    expect(JSON.stringify(thrown)).not.toContain("sk-test-secret");
    expect(thrown).not.toHaveProperty("cause");
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
