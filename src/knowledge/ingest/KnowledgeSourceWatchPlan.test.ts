import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  buildKnowledgeSourceWatchPlan,
  createKnowledgeSourceParserProfileDigest,
  KNOWLEDGE_CITATION_CONTRACT_VERSION,
  KNOWLEDGE_PIPELINE_PROFILE_VERSION,
  type KnowledgeBundlePipelineProfile,
  type KnowledgeBundleWatchAuthority,
  type KnowledgeBundleWatchPlanInput,
  type KnowledgeSourceParserProfile,
  type WatchedKnowledgeSource,
  KnowledgeSourceWatchPlan,
  KnowledgeSourceWatchPlanBuildError,
  type KnowledgeSourceWatchPlanBuildErrorCode,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  createKnowledgeBundleConfigDigest,
  createPipelineFingerprint,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  PipelineFingerprintInput,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { KNOWLEDGE_CONTRACT_VERSION, SUPPORTED_OKF_VERSION } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\r\n\r\n语言：中文\r\n");

interface FixtureOptions {
  bundleId?: string;
  sourceRoots?: string[];
  wikiRoot?: string;
  schemaRef?: string;
  schemaBytes?: Uint8Array;
  revision?: number;
  entries?: SourceManifestEntry[];
  parsers?: KnowledgeSourceParserProfile[];
  compilerVersion?: string;
  compilerConfiguration?: JsonValue;
  model?: KnowledgeBundlePipelineProfile["model"];
  outputLanguage?: string;
}

interface BehaviorMutationCase {
  name: string;
  changesProfileDigest: boolean;
  mutate: (input: KnowledgeBundleWatchPlanInput) => void;
}

/** Creates one durable Manifest source with a Windows-normalized path key. */
function createEntry(sourcePath: string, sourceId = "source-1"): SourceManifestEntry {
  return {
    sourceId,
    sourcePath,
    sourceKey: toWindowsPathKey(sourcePath),
    custody: "user_managed",
  };
}

/** Creates a fresh generic parser registry for fixture isolation. */
function createDefaultParsers(): KnowledgeSourceParserProfile[] {
  return [
    {
      id: "markdown",
      version: "parser-1",
      pathSuffixes: [".md"],
      configuration: { preserveHeadings: true, chunkSizes: [512, 1024] },
    },
  ];
}

/** Creates one complete strict Bundle authority input. */
function createFixture(options: FixtureOptions = {}): KnowledgeBundleWatchPlanInput {
  const bundleId = options.bundleId ?? "personal";
  const sourceRoots = options.sourceRoots ?? ["Sources"];
  const wikiRoot = options.wikiRoot ?? `Wiki/${bundleId}`;
  const schemaRef = options.schemaRef ?? `Schemas/${bundleId}.md`;
  const entries = options.entries ?? [createEntry(`${sourceRoots[0]}/研究.md`)];

  return {
    bundle: {
      version: KNOWLEDGE_CONTRACT_VERSION,
      id: bundleId,
      sourceRoots,
      wikiRoot,
      schemaRef,
      reviewMode: "multi_file",
    },
    manifest: {
      version: KNOWLEDGE_CONTRACT_VERSION,
      bundleId,
      revision: options.revision ?? 7,
      entries,
    },
    schema: {
      path: schemaRef,
      bytes: options.schemaBytes ?? DEFAULT_SCHEMA_BYTES.slice(),
    },
    pipeline: {
      version: KNOWLEDGE_PIPELINE_PROFILE_VERSION,
      bundleId,
      compiler: {
        version: options.compilerVersion ?? "compiler-1",
        configuration: options.compilerConfiguration ?? {
          maxContextPages: 20,
          maxTargets: 50,
        },
      },
      parsers: options.parsers ?? createDefaultParsers(),
      model: options.model ?? {
        provider: "deepseek",
        model: "deepseek-chat",
        configuration: { temperature: 0, maxTokens: 4096 },
      },
      outputLanguage: options.outputLanguage ?? "zh-CN",
      okfVersion: SUPPORTED_OKF_VERSION,
      citationContractVersion: KNOWLEDGE_CITATION_CONTRACT_VERSION,
    },
  };
}

/** Computes the public source fingerprint expected for one fixture parser. */
function createExpectedFingerprint(
  input: KnowledgeBundleWatchPlanInput,
  parser: KnowledgeSourceParserProfile
): string {
  const fingerprintInput: PipelineFingerprintInput = {
    version: KNOWLEDGE_CONTRACT_VERSION,
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    compilerVersion: input.pipeline.compiler.version,
    compilerConfiguration: input.pipeline.compiler.configuration,
    bundleConfigDigest: createKnowledgeBundleConfigDigest(input.bundle),
    parser: {
      id: parser.id,
      version: parser.version,
      configuration: parser.configuration,
    },
    schemaHash: createSourceContentHash(input.schema.bytes),
    model: input.pipeline.model,
    outputLanguage: input.pipeline.outputLanguage,
    okfVersion: input.pipeline.okfVersion,
    citationContractVersion: input.pipeline.citationContractVersion,
  };
  return createPipelineFingerprint(fingerprintInput);
}

/** Returns the only watched source or fails the test fixture loudly. */
function requireOnlySource(plan: KnowledgeSourceWatchPlan): Readonly<WatchedKnowledgeSource> {
  const sources = plan.getSources();
  if (sources.length !== 1) {
    throw new Error(`Expected one watched source, received ${sources.length}`);
  }
  return sources[0];
}

/** Returns the only Bundle authority or fails the test fixture loudly. */
function requireOnlyAuthority(
  plan: KnowledgeSourceWatchPlan
): Readonly<KnowledgeBundleWatchAuthority> {
  const authorities = plan.getBundleAuthorities();
  if (authorities.length !== 1) {
    throw new Error(`Expected one Bundle authority, received ${authorities.length}`);
  }
  return authorities[0];
}

/** Captures and verifies one sanitized strict-builder error. */
function expectBuildError(
  action: () => unknown,
  code: KnowledgeSourceWatchPlanBuildErrorCode
): KnowledgeSourceWatchPlanBuildError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeSourceWatchPlanBuildError);
    expect(error).toMatchObject({
      code,
      message: "The knowledge source watch plan could not be built",
    });
    return error as KnowledgeSourceWatchPlanBuildError;
  }
  throw new Error(`Expected watch-plan build error '${code}'`);
}

const BEHAVIOR_MUTATIONS: readonly BehaviorMutationCase[] = [
  {
    name: "exact schema bytes",
    changesProfileDigest: false,
    mutate: (input) => {
      input.schema.bytes = new TextEncoder().encode("# Knowledge schema\n\n语言：中文\n");
    },
  },
  {
    name: "parser identity",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.parsers[0].version = "parser-2";
    },
  },
  {
    name: "parser id",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.parsers[0].id = "markdown-v2";
    },
  },
  {
    name: "parser configuration",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.parsers[0].configuration = { preserveHeadings: false };
    },
  },
  {
    name: "model identity",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.model.model = "deepseek-reasoner";
    },
  },
  {
    name: "model provider",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.model.provider = "local-provider";
    },
  },
  {
    name: "model configuration",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.model.configuration = { temperature: 0.2, maxTokens: 4096 };
    },
  },
  {
    name: "compiler version",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.compiler.version = "compiler-2";
    },
  },
  {
    name: "compiler configuration",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.compiler.configuration = { maxContextPages: 21, maxTargets: 50 };
    },
  },
  {
    name: "output language",
    changesProfileDigest: true,
    mutate: (input) => {
      input.pipeline.outputLanguage = "en-US";
    },
  },
];

describe("KnowledgeSourceWatchPlan strict projection", () => {
  it("projects exact source identity, Manifest authority, schema hash, and public digests", () => {
    const input = createFixture();
    const expectedParser = input.pipeline.parsers[0];
    const plan = buildKnowledgeSourceWatchPlan([input]);

    expect(plan.getSources()).toEqual([
      {
        bundleId: "personal",
        sourceId: "source-1",
        sourcePath: "Sources/研究.md",
        sourceKey: "sources/研究.md",
        pipelineFingerprint: createExpectedFingerprint(input, expectedParser),
      },
    ]);
    expect(plan.getSource("personal", "source-1")).toBe(plan.getSources()[0]);
    expect(plan.getSource("personal", "missing")).toBeUndefined();
    expect(plan.getSourcesForPathKey("sources/研究.md")).toEqual(plan.getSources());
    expect(plan.getSourcesForPathKey("SOURCES/研究.MD")).toEqual([]);
    const parserAuthority = plan.getSourceParserAuthority("personal", "source-1");
    expect(parserAuthority).toEqual({
      bundleId: "personal",
      sourceId: "source-1",
      parserId: expectedParser.id,
      parserVersion: expectedParser.version,
      parserProfileDigest: createKnowledgeSourceParserProfileDigest(expectedParser),
    });
    expect(Object.isFrozen(parserAuthority)).toBe(true);
    expect(plan.getSourceParserAuthority("personal", "missing")).toBeUndefined();

    const authority = requireOnlyAuthority(plan);
    expect(authority).toMatchObject({
      bundleId: "personal",
      bundleConfigDigest: createKnowledgeBundleConfigDigest(input.bundle),
      manifestRevision: 7,
      manifestDigest: createSourceManifestDigest(input.manifest),
      schemaContentHash: createSourceContentHash(input.schema.bytes),
      sourceCount: 1,
    });
    expect(authority.pipelineProfileDigest).toMatch(SHA256_PATTERN);
    expect(plan.getBundleAuthority("personal")).toBe(authority);
    expect(plan.getBundleAuthority("missing")).toBeUndefined();
    expect(plan.getDigest()).toMatch(SHA256_PATTERN);
    expect(plan.getDigest()).not.toBe(authority.manifestDigest);
  });

  it("is independent of Bundle, parser, and suffix input ordering", () => {
    const markdownParser: KnowledgeSourceParserProfile = {
      id: "markdown",
      version: "parser-1",
      pathSuffixes: [".markdown", ".md"],
      configuration: { preserveHeadings: true },
    };
    const pdfParser: KnowledgeSourceParserProfile = {
      id: "pdf",
      version: "parser-1",
      pathSuffixes: [".pdf"],
      configuration: { extractImages: false },
    };
    const firstAlpha = createFixture({
      bundleId: "alpha",
      parsers: [markdownParser, pdfParser],
    });
    const firstBeta = createFixture({ bundleId: "beta" });
    const secondAlpha = createFixture({
      bundleId: "alpha",
      parsers: [
        { ...pdfParser, pathSuffixes: [...pdfParser.pathSuffixes].reverse() },
        { ...markdownParser, pathSuffixes: [...markdownParser.pathSuffixes].reverse() },
      ],
    });
    const secondBeta = createFixture({ bundleId: "beta" });

    const first = buildKnowledgeSourceWatchPlan([firstBeta, firstAlpha]);
    const second = buildKnowledgeSourceWatchPlan([secondAlpha, secondBeta]);

    expect(second.getDigest()).toBe(first.getDigest());
    expect(second.getSources()).toEqual(first.getSources());
    expect(second.getSourceParserAuthority("alpha", "source-1")).toEqual(
      first.getSourceParserAuthority("alpha", "source-1")
    );
    expect(second.getBundleAuthorities()).toEqual(first.getBundleAuthorities());
    expect(second.getBundleAuthorities().map(({ bundleId }) => bundleId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns detached and deeply frozen public projection structures", () => {
    const input = createFixture();
    const plan = buildKnowledgeSourceWatchPlan([input]);
    const originalDigest = plan.getDigest();
    const sources = plan.getSources();
    const source = requireOnlySource(plan);
    const authorities = plan.getBundleAuthorities();
    const authority = requireOnlyAuthority(plan);
    const pathMatches = plan.getSourcesForPathKey(source.sourceKey);
    const noMatches = plan.getSourcesForPathKey("missing.md");

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(authorities)).toBe(true);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(pathMatches)).toBe(true);
    expect(Object.isFrozen(noMatches)).toBe(true);
    expect(() => Object.defineProperty(source, "sourceId", { value: "forged" })).toThrow(TypeError);
    expect(() => Object.defineProperty(authority, "sourceCount", { value: 99 })).toThrow(TypeError);

    input.schema.bytes.fill(0);
    input.manifest.entries[0].sourcePath = "Sources/mutated.md";
    input.pipeline.model.configuration = { temperature: 1 };

    expect(plan.getDigest()).toBe(originalDigest);
    expect(requireOnlySource(plan).sourcePath).toBe("Sources/研究.md");
    expect(requireOnlyAuthority(plan).sourceCount).toBe(1);
  });

  it("selects different parsers and fingerprints for generic source suffixes", () => {
    const markdownParser: KnowledgeSourceParserProfile = {
      id: "markdown",
      version: "markdown-1",
      pathSuffixes: [".md"],
      configuration: { preserveHeadings: true },
    };
    const pdfParser: KnowledgeSourceParserProfile = {
      id: "pdf",
      version: "pdf-2",
      pathSuffixes: [".pdf"],
      configuration: { extractImages: true },
    };
    const input = createFixture({
      entries: [
        createEntry("Sources/研究.md", "markdown-source"),
        createEntry("Sources/论文.PDF", "pdf-source"),
      ],
      parsers: [pdfParser, markdownParser],
    });
    const plan = buildKnowledgeSourceWatchPlan([input]);

    expect(plan.getSource("personal", "markdown-source")?.pipelineFingerprint).toBe(
      createExpectedFingerprint(input, markdownParser)
    );
    expect(plan.getSource("personal", "pdf-source")?.pipelineFingerprint).toBe(
      createExpectedFingerprint(input, pdfParser)
    );
    expect(plan.getSource("personal", "pdf-source")?.pipelineFingerprint).not.toBe(
      plan.getSource("personal", "markdown-source")?.pipelineFingerprint
    );
    expect(plan.getSourceParserAuthority("personal", "markdown-source")).toMatchObject({
      parserId: "markdown",
      parserVersion: "markdown-1",
      parserProfileDigest: createKnowledgeSourceParserProfileDigest(markdownParser),
    });
    expect(plan.getSourceParserAuthority("personal", "pdf-source")).toMatchObject({
      parserId: "pdf",
      parserVersion: "pdf-2",
      parserProfileDigest: createKnowledgeSourceParserProfileDigest(pdfParser),
    });
  });

  it("binds parser capability changes without coupling the binding to model behavior", () => {
    const baselineInput = createFixture();
    const baseline = buildKnowledgeSourceWatchPlan([baselineInput]);
    const parserChangedInput = createFixture();
    parserChangedInput.pipeline.parsers[0].configuration = { preserveHeadings: false };
    const parserChanged = buildKnowledgeSourceWatchPlan([parserChangedInput]);
    const modelChangedInput = createFixture();
    modelChangedInput.pipeline.model.configuration = { temperature: 0.4, maxTokens: 4096 };
    const modelChanged = buildKnowledgeSourceWatchPlan([modelChangedInput]);

    expect(
      parserChanged.getSourceParserAuthority("personal", "source-1")?.parserProfileDigest
    ).not.toBe(baseline.getSourceParserAuthority("personal", "source-1")?.parserProfileDigest);
    expect(modelChanged.getSourceParserAuthority("personal", "source-1")?.parserProfileDigest).toBe(
      baseline.getSourceParserAuthority("personal", "source-1")?.parserProfileDigest
    );
    expect(requireOnlySource(modelChanged).pipelineFingerprint).not.toBe(
      requireOnlySource(baseline).pipelineFingerprint
    );
  });

  it.each(BEHAVIOR_MUTATIONS)(
    "changes source and plan identity when $name changes",
    ({ mutate, changesProfileDigest }) => {
      const baseline = buildKnowledgeSourceWatchPlan([createFixture()]);
      const changedInput = createFixture();
      mutate(changedInput);
      const changed = buildKnowledgeSourceWatchPlan([changedInput]);

      expect(requireOnlySource(changed).pipelineFingerprint).not.toBe(
        requireOnlySource(baseline).pipelineFingerprint
      );
      expect(changed.getDigest()).not.toBe(baseline.getDigest());
      if (changesProfileDigest) {
        expect(requireOnlyAuthority(changed).pipelineProfileDigest).not.toBe(
          requireOnlyAuthority(baseline).pipelineProfileDigest
        );
      } else {
        expect(requireOnlyAuthority(changed).pipelineProfileDigest).toBe(
          requireOnlyAuthority(baseline).pipelineProfileDigest
        );
      }
    }
  );

  it.each([
    {
      name: "source roots",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.bundle.sourceRoots = ["Sources", "Archive"];
      },
    },
    {
      name: "Wiki root",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.bundle.wikiRoot = "AnotherWiki/personal";
      },
    },
    {
      name: "schema reference",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.bundle.schemaRef = "Schemas/personal-v2.md";
        input.schema.path = input.bundle.schemaRef;
      },
    },
    {
      name: "review mode",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.bundle.reviewMode = "always";
      },
    },
  ])("binds Bundle $name into source and plan identity", ({ mutate }) => {
    const baseline = buildKnowledgeSourceWatchPlan([createFixture()]);
    const changedInput = createFixture();
    mutate(changedInput);
    const changed = buildKnowledgeSourceWatchPlan([changedInput]);

    expect(requireOnlyAuthority(changed).bundleConfigDigest).not.toBe(
      requireOnlyAuthority(baseline).bundleConfigDigest
    );
    expect(requireOnlySource(changed).pipelineFingerprint).not.toBe(
      requireOnlySource(baseline).pipelineFingerprint
    );
    expect(changed.getDigest()).not.toBe(baseline.getDigest());
    expect(requireOnlyAuthority(changed).pipelineProfileDigest).toBe(
      requireOnlyAuthority(baseline).pipelineProfileDigest
    );
  });

  it("keeps source projection stable while Manifest order or revision changes plan identity", () => {
    const firstEntry = createEntry("Sources/A.md", "source-a");
    const secondEntry = createEntry("Sources/B.md", "source-b");
    const first = buildKnowledgeSourceWatchPlan([
      createFixture({ entries: [firstEntry, secondEntry] }),
    ]);
    const second = buildKnowledgeSourceWatchPlan([
      createFixture({ entries: [secondEntry, firstEntry] }),
    ]);
    const revised = buildKnowledgeSourceWatchPlan([
      createFixture({ entries: [firstEntry, secondEntry], revision: 8 }),
    ]);

    expect(second.getSources()).toEqual(first.getSources());
    expect(revised.getSources()).toEqual(first.getSources());
    expect(requireOnlyAuthority(second).manifestDigest).not.toBe(
      requireOnlyAuthority(first).manifestDigest
    );
    expect(requireOnlyAuthority(revised).manifestRevision).toBe(8);
    expect(requireOnlyAuthority(revised).manifestDigest).not.toBe(
      requireOnlyAuthority(first).manifestDigest
    );
    expect(second.getDigest()).not.toBe(first.getDigest());
    expect(revised.getDigest()).not.toBe(first.getDigest());
  });

  it("hashes BOM, CRLF, and Chinese schema snapshots as exact bytes", () => {
    const snapshots = [
      new TextEncoder().encode("中文 schema\n"),
      new TextEncoder().encode("中文 schema\r\n"),
      new TextEncoder().encode("\ufeff中文 schema\r\n"),
    ];
    const plans = snapshots.map((bytes) =>
      buildKnowledgeSourceWatchPlan([createFixture({ schemaBytes: bytes })])
    );

    expect(plans.map((plan) => requireOnlyAuthority(plan).schemaContentHash)).toEqual(
      snapshots.map(createSourceContentHash)
    );
    expect(new Set(plans.map((plan) => requireOnlyAuthority(plan).schemaContentHash)).size).toBe(3);
    expect(new Set(plans.map((plan) => requireOnlySource(plan).pipelineFingerprint)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.getDigest())).size).toBe(3);
  });

  it("allows one physical source to feed independent Bundles", () => {
    const sourcePath = "Shared/研究.md";
    const alpha = createFixture({
      bundleId: "alpha",
      sourceRoots: ["Shared"],
      entries: [createEntry(sourcePath, "alpha-source")],
    });
    const beta = createFixture({
      bundleId: "beta",
      sourceRoots: ["Shared"],
      entries: [createEntry(sourcePath, "beta-source")],
    });
    const plan = buildKnowledgeSourceWatchPlan([beta, alpha]);

    expect(plan.getSourcesForPathKey(toWindowsPathKey(sourcePath))).toEqual([
      expect.objectContaining({ bundleId: "alpha", sourceId: "alpha-source" }),
      expect.objectContaining({ bundleId: "beta", sourceId: "beta-source" }),
    ]);
    expect(plan.getBundleAuthorities()).toHaveLength(2);
  });

  it("retains authority for an empty durable Bundle Manifest", () => {
    const input = createFixture({ entries: [], revision: 11 });
    const plan = buildKnowledgeSourceWatchPlan([input]);

    expect(plan.getSources()).toEqual([]);
    const authority = requireOnlyAuthority(plan);
    expect(authority).toMatchObject({
      bundleId: "personal",
      manifestRevision: 11,
      manifestDigest: createSourceManifestDigest(input.manifest),
      schemaContentHash: createSourceContentHash(input.schema.bytes),
      sourceCount: 0,
    });
    expect(authority.pipelineProfileDigest).toMatch(SHA256_PATTERN);
    expect(plan.getDigest()).toMatch(SHA256_PATTERN);
  });
});

describe("KnowledgeSourceWatchPlan strict rejection", () => {
  it("rejects a Bundle and Manifest ownership mismatch", () => {
    const input = createFixture();
    input.manifest.bundleId = "another-bundle";

    const error = expectBuildError(
      () => buildKnowledgeSourceWatchPlan([input]),
      "manifest_bundle_invalid"
    );

    expect(error.bundleIndex).toBe(0);
    expect(JSON.stringify(error)).not.toContain("another-bundle");
  });

  it.each([
    {
      name: "outside every source root",
      prepare: () => createFixture({ entries: [createEntry("Other/研究.md")] }),
    },
    {
      name: "inside the generated Wiki",
      prepare: () => createFixture({ entries: [createEntry("Wiki/personal/研究.md")] }),
    },
    {
      name: "equal to the schema artifact",
      prepare: () =>
        createFixture({
          schemaRef: "Sources/schema.md",
          entries: [createEntry("Sources/schema.md")],
        }),
    },
  ])("rejects a source $name", ({ prepare }) => {
    expectBuildError(() => buildKnowledgeSourceWatchPlan([prepare()]), "manifest_bundle_invalid");
  });

  it.each([
    {
      name: "a non-exact schema path",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.schema.path = "Schemas/other.md";
      },
    },
    {
      name: "an ArrayBuffer instead of exact bytes",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.schema.bytes = new ArrayBuffer(8) as unknown as Uint8Array;
      },
    },
    {
      name: "text instead of exact bytes",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.schema.bytes = "schema" as unknown as Uint8Array;
      },
    },
  ])("rejects $name in the schema snapshot", ({ mutate }) => {
    const input = createFixture();
    mutate(input);

    expectBuildError(() => buildKnowledgeSourceWatchPlan([input]), "schema_snapshot_invalid");
  });

  it("rejects spoofed byte views and ignores an instance-level slice override", () => {
    const spoofed = new Uint16Array([0x1234]);
    Object.defineProperty(spoofed, Symbol.toStringTag, { value: "Uint8Array" });
    const invalid = createFixture();
    invalid.schema.bytes = spoofed as unknown as Uint8Array;

    expectBuildError(() => buildKnowledgeSourceWatchPlan([invalid]), "schema_snapshot_invalid");

    const exactBytes = new Uint8Array([1, 2, 3]);
    const sliceOverride = jest.fn(() => new Uint8Array([9]));
    Object.defineProperty(exactBytes, "slice", {
      value: sliceOverride,
    });
    const valid = buildKnowledgeSourceWatchPlan([createFixture({ schemaBytes: exactBytes })]);

    expect(sliceOverride).not.toHaveBeenCalled();
    expect(requireOnlyAuthority(valid).schemaContentHash).toBe(
      createSourceContentHash(new Uint8Array([1, 2, 3]))
    );
  });

  it("rejects a source with no parser-owned suffix", () => {
    const input = createFixture({ entries: [createEntry("Sources/研究.txt")] });

    const error = expectBuildError(
      () => buildKnowledgeSourceWatchPlan([input]),
      "source_parser_missing"
    );

    expect(error).toMatchObject({ bundleIndex: 0, sourceIndex: 0 });
  });

  it.each([
    {
      name: "overlapping suffix ownership",
      parsers: [
        {
          id: "markdown",
          version: "1",
          pathSuffixes: [".md"],
          configuration: {},
        },
        {
          id: "note-markdown",
          version: "1",
          pathSuffixes: [".note.md"],
          configuration: {},
        },
      ],
    },
    {
      name: "a duplicate parser id",
      parsers: [
        {
          id: "document",
          version: "1",
          pathSuffixes: [".md"],
          configuration: {},
        },
        {
          id: "document",
          version: "2",
          pathSuffixes: [".pdf"],
          configuration: {},
        },
      ],
    },
    {
      name: "case-insensitive duplicate suffixes",
      parsers: [
        {
          id: "markdown",
          version: "1",
          pathSuffixes: [".md", ".MD"],
          configuration: {},
        },
      ],
    },
  ] satisfies { name: string; parsers: KnowledgeSourceParserProfile[] }[])(
    "rejects parser registry with $name",
    ({ parsers }) => {
      expectBuildError(
        () => buildKnowledgeSourceWatchPlan([createFixture({ parsers })]),
        "parser_registry_invalid"
      );
    }
  );

  it.each(["parser", "model"] as const)(
    "rejects secret-like fields in %s configuration without echoing them",
    (target) => {
      const input = createFixture();
      const configuration: JsonValue = {
        behavior: { API_KEY: "must-never-enter-a-plan" },
      };
      if (target === "parser") {
        input.pipeline.parsers[0].configuration = configuration;
      } else {
        input.pipeline.model.configuration = configuration;
      }

      const error = expectBuildError(
        () => buildKnowledgeSourceWatchPlan([input]),
        "pipeline_profile_invalid"
      );
      expect(error.message).not.toContain("API_KEY");
      expect(JSON.stringify(error)).not.toContain("must-never-enter-a-plan");
    }
  );

  it("rejects Date and cyclic runtime configuration values", () => {
    const withDate = createFixture();
    withDate.pipeline.model.configuration = new Date(0) as unknown as JsonValue;

    expectBuildError(() => buildKnowledgeSourceWatchPlan([withDate]), "pipeline_profile_invalid");

    const cyclic = {} as Record<string, JsonValue>;
    cyclic.self = cyclic;
    const withCycle = createFixture();
    withCycle.pipeline.parsers[0].configuration = cyclic;

    expectBuildError(() => buildKnowledgeSourceWatchPlan([withCycle]), "pipeline_profile_invalid");
  });

  it("sanitizes unexpected runtime accessor failures", () => {
    const untrusted = Object.defineProperty({}, "bundle", {
      enumerable: true,
      get: () => {
        throw new Error("must-not-escape-from-untrusted-input");
      },
    });

    const error = expectBuildError(
      () => buildKnowledgeSourceWatchPlan([untrusted as unknown as KnowledgeBundleWatchPlanInput]),
      "input_invalid"
    );

    expect(error.message).not.toContain("must-not-escape-from-untrusted-input");
  });

  it("rejects nested configuration accessors before hashing any profile identity", () => {
    const input = createFixture();
    input.pipeline.model.configuration = Object.defineProperty({}, "temperature", {
      enumerable: true,
      get: () => 0,
    });

    expectBuildError(() => buildKnowledgeSourceWatchPlan([input]), "pipeline_profile_invalid");
  });

  it("snapshots JSON array length from its data descriptor exactly once", () => {
    const target: JsonValue[] = [{ mode: "strict" }];
    let lengthGetterCalls = 0;
    let lengthDescriptorCalls = 0;
    const unstableLength = new Proxy(target, {
      get: (array, property, receiver) => {
        if (property === "length") {
          lengthGetterCalls += 1;
          return lengthGetterCalls === 1 ? 1 : 0;
        }
        return Reflect.get(array, property, receiver) as unknown;
      },
      getOwnPropertyDescriptor: (array, property) => {
        if (property === "length") {
          lengthDescriptorCalls += 1;
        }
        return Reflect.getOwnPropertyDescriptor(array, property);
      },
    });
    const proxied = createFixture();
    proxied.pipeline.model.configuration = unstableLength;
    const plain = createFixture();
    plain.pipeline.model.configuration = [{ mode: "strict" }];

    const proxiedPlan = buildKnowledgeSourceWatchPlan([proxied]);
    const plainPlan = buildKnowledgeSourceWatchPlan([plain]);

    expect(lengthGetterCalls).toBe(0);
    expect(lengthDescriptorCalls).toBe(1);
    expect(requireOnlySource(proxiedPlan).pipelineFingerprint).toBe(
      requireOnlySource(plainPlan).pipelineFingerprint
    );
    expect(proxiedPlan.getDigest()).toBe(plainPlan.getDigest());
  });

  it("preserves an own __proto__ JSON field instead of dropping or applying it", () => {
    const withProto = createFixture();
    withProto.pipeline.model.configuration = JSON.parse(
      '{"__proto__":null,"temperature":0}'
    ) as JsonValue;
    const withoutProto = createFixture();
    withoutProto.pipeline.model.configuration = { temperature: 0 };

    const first = buildKnowledgeSourceWatchPlan([withProto]);
    const second = buildKnowledgeSourceWatchPlan([withoutProto]);

    expect(requireOnlySource(first).pipelineFingerprint).not.toBe(
      requireOnlySource(second).pipelineFingerprint
    );
  });

  it.each([
    {
      name: "an unexpected profile field",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        (input.pipeline as unknown as Record<string, unknown>).unexpected = true;
      },
    },
    {
      name: "a mismatched profile Bundle",
      mutate: (input: KnowledgeBundleWatchPlanInput) => {
        input.pipeline.bundleId = "another-bundle";
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const input = createFixture();
    mutate(input);

    expectBuildError(() => buildKnowledgeSourceWatchPlan([input]), "pipeline_profile_invalid");
  });

  it("delegates Windows case-collision rejection to the strict Manifest", () => {
    const input = createFixture({
      entries: [
        createEntry("Sources/Page.md", "source-1"),
        createEntry("sources/page.md", "source-2"),
      ],
    });

    expectBuildError(() => buildKnowledgeSourceWatchPlan([input]), "manifest_bundle_invalid");
  });

  it("rejects one durable source id assigned to two different paths", () => {
    const input = createFixture({
      entries: [createEntry("Sources/A.md", "source-1"), createEntry("Sources/B.md", "source-1")],
    });

    expectBuildError(() => buildKnowledgeSourceWatchPlan([input]), "manifest_bundle_invalid");
  });

  it("rejects duplicate Bundle identities even when their structures differ", () => {
    const first = createFixture({ bundleId: "personal" });
    const second = createFixture({
      bundleId: "personal",
      wikiRoot: "AnotherWiki",
      schemaRef: "Schemas/another.md",
    });

    expectBuildError(() => buildKnowledgeSourceWatchPlan([first, second]), "bundle_id_duplicate");
  });

  it.each([
    {
      name: "overlapping Wiki roots",
      createInputs: () => [
        createFixture({ bundleId: "alpha", wikiRoot: "Wiki/shared" }),
        createFixture({ bundleId: "beta", wikiRoot: "Wiki/shared/child" }),
      ],
    },
    {
      name: "a Wiki overlapping another Bundle source root",
      createInputs: () => [
        createFixture({
          bundleId: "alpha",
          sourceRoots: ["AlphaSources"],
          wikiRoot: "Generated/alpha",
        }),
        createFixture({ bundleId: "beta", sourceRoots: ["Generated"] }),
      ],
    },
    {
      name: "a schema inside another Bundle Wiki",
      createInputs: () => [
        createFixture({ bundleId: "alpha", schemaRef: "Wiki/beta/schema/alpha.md" }),
        createFixture({ bundleId: "beta", wikiRoot: "Wiki/beta" }),
      ],
    },
  ])("rejects cross-Bundle boundary conflict from $name", ({ createInputs }) => {
    expectBuildError(
      () => buildKnowledgeSourceWatchPlan(createInputs()),
      "bundle_boundary_conflict"
    );
  });

  it("rejects divergent exact bytes for one shared schema path", () => {
    const alpha = createFixture({
      bundleId: "alpha",
      schemaRef: "Schemas/shared.md",
      schemaBytes: new TextEncoder().encode("alpha schema"),
    });
    const beta = createFixture({
      bundleId: "beta",
      schemaRef: "Schemas/shared.md",
      schemaBytes: new TextEncoder().encode("beta schema"),
    });

    expectBuildError(
      () => buildKnowledgeSourceWatchPlan([alpha, beta]),
      "schema_snapshot_conflict"
    );
  });

  it("accepts only module-authoritative plans at installation boundaries", () => {
    const plan = buildKnowledgeSourceWatchPlan([createFixture()]);
    expect(() => KnowledgeSourceWatchPlan.assert(plan)).not.toThrow();

    const runtimeConstructor = KnowledgeSourceWatchPlan as unknown as new (
      ...args: never[]
    ) => KnowledgeSourceWatchPlan;
    expectBuildError(
      () => Reflect.construct(runtimeConstructor, [Symbol("wrong-token"), [], []]),
      "plan_not_authoritative"
    );

    const prototypeForgery = Object.create(
      KnowledgeSourceWatchPlan.prototype
    ) as KnowledgeSourceWatchPlan;
    expectBuildError(
      () => KnowledgeSourceWatchPlan.assert(prototypeForgery),
      "plan_not_authoritative"
    );
    expectBuildError(() => KnowledgeSourceWatchPlan.assert({ ...plan }), "plan_not_authoritative");

    expect(Reflect.ownKeys(plan)).toEqual([]);
    expect(Object.isFrozen(KnowledgeSourceWatchPlan)).toBe(true);
    expect(Object.isFrozen(KnowledgeSourceWatchPlan.prototype)).toBe(true);
    expect(() => Object.defineProperty(plan, "sourcesByPathKey", { value: new Map() })).toThrow(
      TypeError
    );
    expect(() =>
      Object.defineProperty(KnowledgeSourceWatchPlan.prototype, "getSources", {
        value: () => [],
      })
    ).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(KnowledgeSourceWatchPlan, "build", {
        value: () => prototypeForgery,
      })
    ).toThrow(TypeError);
    expect(requireOnlySource(plan).sourceId).toBe("source-1");
  });
});
