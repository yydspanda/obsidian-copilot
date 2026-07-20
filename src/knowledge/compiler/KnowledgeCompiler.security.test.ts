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
  KnowledgeCompileResult,
  KnowledgeCompilerLimits,
  KnowledgeCompilerStage,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  KnowledgeCompiler,
  KnowledgeCompilerAbortError,
} from "@/knowledge/compiler/KnowledgeCompiler";
import type { CompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";
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

/** Minimal scriptable model used only by the compiler security boundary tests. */
class SecurityCompilerModel implements CompilerModelPort {
  public analysisCalls = 0;
  public generationCalls = 0;
  public readonly analysisRequests: CompilerAnalysisRequest[] = [];
  public readonly generationRequests: CompilerGenerationRequest[] = [];

  /** Creates a fake with explicit handlers for both structured-output stages. */
  constructor(
    private readonly analysisHandler: AnalysisHandler,
    private readonly generationHandler: GenerationHandler
  ) {}

  /** Delegates one analysis call while retaining only a call count. */
  async analyze(request: CompilerAnalysisRequest, signal: AbortSignal): Promise<unknown> {
    this.analysisCalls += 1;
    this.analysisRequests.push(request);
    return this.analysisHandler(request, signal);
  }

  /** Delegates one generation call while retaining only a call count. */
  async generate(request: CompilerGenerationRequest, signal: AbortSignal): Promise<unknown> {
    this.generationCalls += 1;
    this.generationRequests.push(request);
    return this.generationHandler(request, signal);
  }
}

/** Minimal read-only resolver fake for exact target-state binding. */
class SecurityTargetResolver implements CompilerTargetResolver {
  public calls = 0;

  /** Creates a resolver around one explicit handler. */
  constructor(private readonly handler: ResolverHandler) {}

  /** Delegates one resolver call while retaining only a call count. */
  async resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    return this.handler(targets, signal);
  }
}

/** Minimal candidate-validator fake for the final deterministic boundary. */
class SecurityCandidateValidator implements CompilerCandidateValidator {
  public calls = 0;

  /** Creates a validator around one explicit handler. */
  constructor(private readonly handler: CandidateHandler) {}

  /** Delegates one validation call while retaining only a call count. */
  async validate(input: CompilerCandidateValidationInput, signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    return this.handler(input, signal);
  }
}

interface SecurityHarnessOptions {
  analyze?: AnalysisHandler;
  generate?: GenerationHandler;
  resolve?: ResolverHandler;
  validate?: CandidateHandler;
  limits?: Partial<KnowledgeCompilerLimits>;
}

interface SecurityHarness {
  compiler: KnowledgeCompiler;
  model: SecurityCompilerModel;
  resolver: SecurityTargetResolver;
  validator: SecurityCandidateValidator;
}

/** Creates one valid caller-owned target authorization including source provenance. */
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
  const targetAuthorizations = overrides.targetAuthorizations ?? [
    createTargetAuthorization("Wiki/Page.md"),
  ];
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

/** Creates a valid grounded analysis response with replaceable fields. */
function createAnalysisOutput(
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
    targets: [
      {
        ref: "target-page",
        path: "Wiki/Page.md",
        intent: "write",
        reason: "Compile the grounded claim",
        claimRefs: ["claim-main"],
      },
    ],
    ...overrides,
  };
}

/** Creates exact missing observations for every runtime-approved target. */
function createMissingObservations(targets: readonly CompilerTargetRequest[]): unknown[] {
  return targets.map((target) => ({
    targetId: target.targetId,
    kind: "missing" as const,
    windowsPathKey: toWindowsPathKey(target.path),
  }));
}

/** Returns exact missing observations for every runtime-approved target. */
async function resolveAllMissing(targets: readonly CompilerTargetRequest[]): Promise<unknown> {
  return createMissingObservations(targets);
}

/** Creates valid generation output for every writable target. */
function createGenerationOutput(request: CompilerGenerationRequest): CompilerGenerationModelOutput {
  return {
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write" as const,
      afterContent: `---\ntype: concept\n---\n\n# ${target.path}\n`,
    })),
  };
}

/** Generates valid content for every writable target. */
async function generateAllWritable(request: CompilerGenerationRequest): Promise<unknown> {
  return createGenerationOutput(request);
}

/** Returns affirmative deterministic candidate validation. */
async function validateCandidateSuccessfully(): Promise<unknown> {
  return VALIDATION_SUCCESS;
}

/** Creates the compiler and inspectable security-test fakes. */
function createHarness(options: SecurityHarnessOptions = {}): SecurityHarness {
  const model = new SecurityCompilerModel(
    options.analyze ?? (async () => createAnalysisOutput()),
    options.generate ?? generateAllWritable
  );
  const resolver = new SecurityTargetResolver(options.resolve ?? resolveAllMissing);
  const validator = new SecurityCandidateValidator(
    options.validate ?? validateCandidateSuccessfully
  );
  return {
    compiler: new KnowledgeCompiler({
      model,
      targetResolver: resolver,
      candidateValidator: validator,
      limits: options.limits,
    }),
    model,
    resolver,
    validator,
  };
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

/** Requires one controlled compiler failure and narrows its type. */
function requireFailure(result: KnowledgeCompileResult): KnowledgeCompileFailure {
  if (result.kind !== "failed") {
    throw new Error(`Expected a failed compile result, received '${result.kind}'`);
  }
  return result;
}

/** Extracts stable diagnostic codes from one controlled failure. */
function diagnosticCodes(result: KnowledgeCompileFailure): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("KnowledgeCompiler security grounding boundaries", () => {
  it.each(["context", "contradicts"] as const)(
    "does not treat a %s citation as supporting evidence",
    async (relation) => {
      const harness = createHarness({
        analyze: async () =>
          createAnalysisOutput({
            citations: [{ claimRef: "claim-main", evidenceId: "evidence-1", relation }],
          }),
      });

      const result = requireFailure(
        await harness.compiler.compile(createCompileInput(), new AbortController().signal)
      );

      expect(result.stage).toBe("analysis");
      expect(diagnosticCodes(result)).toContain("compiler_claim_ungrounded");
      expect(harness.resolver.calls).toBe(0);
      expect(harness.model.generationCalls).toBe(0);
    }
  );

  it("rejects duplicate citations that hide the same locator behind different evidence ids", async () => {
    const baseInput = createCompileInput();
    const locator = baseInput.evidence[0].locator;
    const harness = createHarness({
      analyze: async () =>
        createAnalysisOutput({
          citations: [
            { claimRef: "claim-main", evidenceId: "evidence-a", relation: "supports" },
            { claimRef: "claim-main", evidenceId: "evidence-b", relation: "supports" },
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

    expect(result.stage).toBe("analysis");
    expect(diagnosticCodes(result)).toContain("compiler_citation_duplicate");
    expect(harness.resolver.calls).toBe(0);
  });
});

describe("KnowledgeCompiler security locator anchors", () => {
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
    expect(harness.model.analysisCalls).toBe(0);
  });

  it("accepts prefix and suffix context that selects exactly one quote occurrence", async () => {
    const harness = createHarness();

    const result = await harness.compiler.compile(
      createQuoteCompileInput(REPEATED_TEXT, "repeated", "first:", ":one"),
      new AbortController().signal
    );

    expect(result.kind).toBe("proposed");
    expect(harness.model.analysisCalls).toBe(1);
    expect(harness.validator.calls).toBe(1);
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
    expect(harness.model.analysisCalls).toBe(0);
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
    expect(harness.model.analysisCalls).toBe(0);
  });
});

describe("KnowledgeCompiler security resource bounds", () => {
  it("enforces analysis collection limits after strict parsing", async () => {
    const harness = createHarness({
      analyze: async () =>
        createAnalysisOutput({
          concepts: [
            { ref: "concept-one", name: "One" },
            { ref: "concept-two", name: "Two" },
          ],
        }),
      limits: { maxConcepts: 1 },
    });

    const result = requireFailure(
      await harness.compiler.compile(createCompileInput(), new AbortController().signal)
    );

    expect(result.stage).toBe("analysis");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "compiler_output_limit_exceeded", field: "concepts" })
    );
    expect(harness.resolver.calls).toBe(0);
  });

  it("enforces the total serialized analysis character limit", async () => {
    const harness = createHarness({ limits: { maxAnalysisCharacters: 1 } });

    const result = requireFailure(
      await harness.compiler.compile(createCompileInput(), new AbortController().signal)
    );

    expect(result.stage).toBe("analysis");
    expect(diagnosticCodes(result)).toContain("compiler_analysis_character_limit_exceeded");
    expect(harness.resolver.calls).toBe(0);
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
    expect(harness.model.analysisCalls).toBe(1);
    expect(harness.resolver.calls).toBe(1);
    expect(harness.model.generationCalls).toBe(0);
    expect(harness.validator.calls).toBe(0);
  });

  it("enforces the aggregate generated-content limit across approved files", async () => {
    const targets: CompilerAnalysisTargetDraft[] = [
      {
        ref: "target-one",
        path: "Wiki/One.md",
        intent: "write",
        reason: "Write one",
        claimRefs: ["claim-main"],
      },
      {
        ref: "target-two",
        path: "Wiki/Two.md",
        intent: "write",
        reason: "Write two",
        claimRefs: ["claim-main"],
      },
    ];
    const harness = createHarness({
      analyze: async () => createAnalysisOutput({ targets }),
      generate: async (request) => ({
        version: 1,
        targetSetDigest: request.targetSetDigest,
        files: request.targets.map((target) => ({
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
    expect(harness.validator.calls).toBe(0);
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
});

describe("KnowledgeCompiler minimal generation disclosure", () => {
  it("exposes only minimal update DTOs and omits delete and authorization metadata", async () => {
    const updateContent = "---\ntype: concept\n---\n\nExisting update\n";
    const deleteContent = "---\ntype: concept\n---\n\nDelete me\n";
    const targets: CompilerAnalysisTargetDraft[] = [
      {
        ref: "target-update",
        path: "Wiki/Update.md",
        intent: "write",
        reason: "Refresh the grounded page",
        claimRefs: ["claim-main"],
      },
      {
        ref: "target-delete",
        path: "Wiki/Delete.md",
        intent: "delete",
        reason: "Remove the obsolete generated page",
        claimRefs: [],
      },
    ];
    const harness = createHarness({
      analyze: async () => createAnalysisOutput({ targets }),
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
    expect(Object.keys(request.analysis).sort()).toEqual(
      ["version", "summary", "concepts", "entities", "claims", "relations", "citations"].sort()
    );
    expect(request.analysis).not.toHaveProperty("targets");
    expect(request.targets).toHaveLength(1);
    const generationTarget = request.targets[0];
    expect(generationTarget.targetId).toMatch(/^target-[a-f0-9]{64}$/);
    expect(generationTarget.claimIds).toHaveLength(1);
    expect(generationTarget.claimIds[0]).toMatch(/^claim-[a-f0-9]{64}$/);
    expect(request.targets).toEqual([
      {
        targetId: generationTarget.targetId,
        path: "Wiki/Update.md",
        reason: "Refresh the grounded page",
        claimIds: generationTarget.claimIds,
        contentPolicy: "grounded",
        operation: "update",
        currentContent: updateContent,
      },
    ]);
    expect(Object.keys(request.targets[0]).sort()).toEqual(
      [
        "targetId",
        "path",
        "reason",
        "claimIds",
        "contentPolicy",
        "operation",
        "currentContent",
      ].sort()
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
      expect(request.analysis).not.toHaveProperty(field);
    }
  });
});

describe("KnowledgeCompiler post-dependency cancellation", () => {
  const stages: Exclude<KnowledgeCompilerStage, "input">[] = [
    "analysis",
    "target_resolution",
    "generation",
    "candidate_validation",
  ];

  it.each(stages)(
    "throws AbortError when the %s dependency ignores the signal and resolves after cancellation",
    async (stage) => {
      const controller = new AbortController();
      const harness = createHarness({
        analyze: async () => {
          const output = createAnalysisOutput();
          if (stage === "analysis") {
            controller.abort("private cancellation reason");
          }
          return output;
        },
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
