import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceExecutionPlan,
  KnowledgeSourceWorkflowPlanError,
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  type KnowledgePipelineProfilePort,
  type KnowledgeSourceParseJob,
  type KnowledgeSourceWorkflowPlanDependencies,
  type KnowledgeWorkflowGenerationPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  KnowledgeByteParser,
  KnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";

const BUNDLE_ID = "personal";
const PROJECT_ID = "project-personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const PARSER_ID = "markdown-utf8";
const PARSER_VERSION = "1";

/** Creates one strict project-owned knowledge Bundle. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  const config: KnowledgeBundleConfig = {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
  return { projectId: PROJECT_ID, config };
}

/** Creates the durable Manifest used by one loader collection. */
function createManifest(revision = 1): SourceManifest {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    revision,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourcePath: SOURCE_PATH,
        sourceKey: toWindowsPathKey(SOURCE_PATH),
        custody: "user_managed",
      },
    ],
  };
}

/** Creates an empty durable Manifest for parser-registry boundary tests. */
function createEmptyManifest(): SourceManifest {
  return { version: 1, bundleId: BUNDLE_ID, revision: 0, entries: [] };
}

/** Creates the exact profile advertised by the default fake parser. */
function createParserProfile(
  overrides: Partial<KnowledgeSourceParserProfile> = {}
): KnowledgeSourceParserProfile {
  return {
    id: PARSER_ID,
    version: PARSER_VERSION,
    pathSuffixes: [".md"],
    configuration: {
      encoding: "utf-8-fatal",
      artifactContractVersion: 1,
    },
    ...overrides,
  };
}

/** Creates one complete secret-free behavior profile. */
function createPipelineProfile(
  parsers: readonly KnowledgeSourceParserProfile[] = [createParserProfile()]
): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: {
      version: "knowledge-compiler-v1",
      configuration: { protocolVersion: 1, promptVersion: 1 },
    },
    parsers,
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      configuration: {
        behaviorContractVersion: 1,
        structuredOutput: "json-schema-v1",
        temperature: 0.2,
        maxTokens: 4096,
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates a detached exact-reader success around the supplied byte reference. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return {
    sourcePath,
    bytes,
    sourceContentHash: createSourceContentHash(bytes),
  };
}

/** Creates one strict parser result for the supplied source. */
function createParsedSource(sourceId = SOURCE_ID, text = "parsed source text") {
  return {
    artifact: {
      kind: "text" as const,
      sourceId,
      artifactId: "primary",
      artifactContentHash: createFileContentHash(text),
      text,
    },
  };
}

interface HarnessOptions {
  executionOwner?: KnowledgeExecutionOwner;
  manifest?: SourceManifest;
  schemaBytes?: Uint8Array;
  sourceBytes?: Uint8Array;
  profile?: KnowledgeBundlePipelineProfile;
  parsers?: readonly KnowledgeByteParser[];
  maxSchemaBytes?: number;
  maxParsedCharacters?: number;
}

interface Harness {
  executionOwner: KnowledgeExecutionOwner;
  dependencies: KnowledgeSourceWorkflowPlanDependencies;
  owner: ConfiguredProjectKnowledgeBundle;
  loader: KnowledgeSourceWorkflowPlanLoader;
  parser: KnowledgeByteParser;
  manifestPort: KnowledgeManifestSnapshotPort;
  readerPort: KnowledgeExactArtifactReaderPort;
  profilePort: KnowledgePipelineProfilePort;
  generationPort: KnowledgeWorkflowGenerationPort;
  state: {
    manifest: SourceManifest;
    schemaBytes: Uint8Array;
    sourceBytes: Uint8Array;
    profile: KnowledgeBundlePipelineProfile;
    current: boolean;
    manifestCalls: number;
    schemaReadCalls: number;
    sourceReadCalls: number;
    profileCalls: number;
    parserCalls: number;
    parserRequests: Readonly<KnowledgeByteParserRequest>[];
    parse: (request: Readonly<KnowledgeByteParserRequest>, signal: AbortSignal) => Promise<unknown>;
    loadManifest?: (bundleId: string, call: number) => unknown;
    readSchema?: (path: string, call: number) => unknown;
    readSource?: (path: string, hash: string, call: number) => unknown;
    resolveProfile?: (owner: ConfiguredProjectKnowledgeBundle, call: number) => unknown;
  };
}

/** Creates narrow mutable fake ports around immutable production payloads. */
function createHarness(options: HarnessOptions = {}): Harness {
  const owner = createOwner();
  const executionOwner = options.executionOwner ?? createKnowledgeExecutionOwner();
  const state: Harness["state"] = {
    manifest: options.manifest ?? createManifest(),
    schemaBytes: options.schemaBytes ?? new TextEncoder().encode("# Knowledge schema\n"),
    sourceBytes: options.sourceBytes ?? new TextEncoder().encode("# Source\r\nExact text\r\n"),
    profile: options.profile ?? createPipelineProfile(),
    current: true,
    manifestCalls: 0,
    schemaReadCalls: 0,
    sourceReadCalls: 0,
    profileCalls: 0,
    parserCalls: 0,
    parserRequests: [],
    parse: async () => createParsedSource(),
  };

  const parser: KnowledgeByteParser = {
    getProfile: () => createParserProfile(),
    parse: async (request, signal) => {
      state.parserCalls += 1;
      state.parserRequests.push(request);
      return state.parse(request, signal);
    },
  };
  const manifestPort: KnowledgeManifestSnapshotPort = {
    load: async (bundleId) => {
      state.manifestCalls += 1;
      return state.loadManifest
        ? state.loadManifest(bundleId, state.manifestCalls)
        : state.manifest;
    },
  };
  const readerPort: KnowledgeExactArtifactReaderPort = {
    read: async (path) => {
      state.schemaReadCalls += 1;
      const value = state.readSchema
        ? await state.readSchema(path, state.schemaReadCalls)
        : createExactArtifact(path, state.schemaBytes);
      return value as ExactSourceArtifact;
    },
    readExpected: async (path, hash) => {
      state.sourceReadCalls += 1;
      const value = state.readSource
        ? await state.readSource(path, hash, state.sourceReadCalls)
        : createExactArtifact(path, state.sourceBytes);
      return value as ExactSourceArtifact;
    },
  };
  const profilePort: KnowledgePipelineProfilePort = {
    resolve: async (resolvedOwner) => {
      state.profileCalls += 1;
      return state.resolveProfile
        ? state.resolveProfile(resolvedOwner, state.profileCalls)
        : state.profile;
    },
  };
  const generationPort: KnowledgeWorkflowGenerationPort = {
    isCurrent: () => state.current,
  };
  const dependencies: KnowledgeSourceWorkflowPlanDependencies = {
    executionOwner,
    manifest: manifestPort,
    artifactReader: readerPort,
    pipelineProfile: profilePort,
    parsers: options.parsers ?? [parser],
    generation: generationPort,
    maxSchemaBytes: options.maxSchemaBytes,
    maxParsedCharacters: options.maxParsedCharacters,
  };
  return {
    executionOwner,
    dependencies,
    owner,
    loader: new KnowledgeSourceWorkflowPlanLoader(dependencies),
    parser,
    manifestPort,
    readerPort,
    profilePort,
    generationPort,
    state,
  };
}

/** Loads an authentic plan and builds a matching Queue-owned job projection. */
async function loadPlanAndJob(
  harness: Harness
): Promise<{ plan: KnowledgeSourceExecutionPlan; job: KnowledgeSourceParseJob }> {
  const plan = await harness.loader.load([harness.owner], new AbortController().signal);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected watched source");
  return {
    plan,
    job: {
      bundleId: BUNDLE_ID,
      sourceId: SOURCE_ID,
      sourceContentHash: createSourceContentHash(harness.state.sourceBytes),
      pipelineFingerprint: source.pipelineFingerprint,
      inputRevision: 1,
    },
  };
}

/** Captures one sanitized workflow error from an asynchronous operation. */
async function expectWorkflowError(
  action: () => Promise<unknown>,
  code: KnowledgeSourceWorkflowPlanError["code"],
  stage: KnowledgeSourceWorkflowPlanError["stage"]
): Promise<KnowledgeSourceWorkflowPlanError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeSourceWorkflowPlanError);
  const failure = caught as KnowledgeSourceWorkflowPlanError;
  expect(failure).toMatchObject({ code, stage });
  expect(failure.message).toBe("The knowledge source workflow plan could not be prepared");
  return failure;
}

/** Captures one sanitized workflow error from a synchronous operation. */
function expectWorkflowErrorSync(
  action: () => unknown,
  code: KnowledgeSourceWorkflowPlanError["code"],
  stage: KnowledgeSourceWorkflowPlanError["stage"]
): KnowledgeSourceWorkflowPlanError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeSourceWorkflowPlanError);
  const failure = caught as KnowledgeSourceWorkflowPlanError;
  expect(failure).toMatchObject({ code, stage });
  expect(failure.message).toBe("The knowledge source workflow plan could not be prepared");
  return failure;
}

describe("KnowledgeSourceWorkflowPlanLoader", () => {
  it("prevents one lifecycle owner from being registered to another workflow generation", () => {
    const harness = createHarness();

    expectWorkflowErrorSync(
      () => new KnowledgeSourceWorkflowPlanLoader(harness.dependencies),
      "dependency_invalid",
      "dependencies"
    );
  });

  it("double-collects every read-only authority before publishing one plan", async () => {
    const harness = createHarness();

    const plan = await harness.loader.load([harness.owner], new AbortController().signal);

    expect(plan.getDigest()).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.state.manifestCalls).toBe(2);
    expect(harness.state.schemaReadCalls).toBe(2);
    expect(harness.state.profileCalls).toBe(2);
    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("retains the exact detached secret-free profile selected by the matching collection", async () => {
    const harness = createHarness();

    const plan = await harness.loader.load([harness.owner], new AbortController().signal);
    const profile = plan.getBundlePipelineProfile(BUNDLE_ID);

    expect(profile).toEqual(harness.state.profile);
    expect(profile).not.toBe(harness.state.profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile?.compiler)).toBe(true);
    expect(Object.isFrozen(profile?.compiler.configuration)).toBe(true);
    expect(Object.isFrozen(profile?.parsers)).toBe(true);
    expect(Object.isFrozen(profile?.parsers[0])).toBe(true);
    expect(Object.isFrozen(profile?.model)).toBe(true);
    expect(Object.isFrozen(profile?.model.configuration)).toBe(true);
    expect(plan.getBundlePipelineProfile("unknown-bundle")).toBeUndefined();
    expect(plan.matchesExecutionOwner(harness.executionOwner)).toBe(true);
    expect(plan.matchesExecutionOwner(createKnowledgeExecutionOwner())).toBe(false);
  });

  it("prevents stale generations from exposing a watch plan or retained profile", async () => {
    const harness = createHarness();
    const plan = await harness.loader.load([harness.owner], new AbortController().signal);
    harness.state.current = false;

    expectWorkflowErrorSync(() => plan.getWatchPlan(), "generation_stale", "plan");
    expectWorkflowErrorSync(() => plan.getDigest(), "generation_stale", "plan");
    expectWorkflowErrorSync(
      () => plan.getBundlePipelineProfile(BUNDLE_ID),
      "generation_stale",
      "plan"
    );
  });

  it("rejects a changed collection instead of publishing mixed generations", async () => {
    const harness = createHarness();
    harness.state.loadManifest = (_bundleId, call) => createManifest(call);

    await expectWorkflowError(
      () => harness.loader.load([harness.owner], new AbortController().signal),
      "collection_changed",
      "plan"
    );

    expect(harness.state.manifestCalls).toBe(2);
    expect(harness.state.parserCalls).toBe(0);
    expect(harness.state.sourceReadCalls).toBe(0);
  });

  it("rejects a parser-registry mismatch even when the Manifest is empty", async () => {
    const pdfProfile = createParserProfile({
      id: "pdf-pages",
      pathSuffixes: [".pdf"],
      configuration: { pageContractVersion: 1 },
    });
    const harness = createHarness({
      manifest: createEmptyManifest(),
      profile: createPipelineProfile([createParserProfile(), pdfProfile]),
    });

    await expectWorkflowError(
      () => harness.loader.load([harness.owner], new AbortController().signal),
      "parser_binding_invalid",
      "profile"
    );

    expect(harness.state.profileCalls).toBe(1);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("enforces the execution-owned schema byte limit while loading", async () => {
    const harness = createHarness({ maxSchemaBytes: 4 });

    await expectWorkflowError(
      () => harness.loader.load([harness.owner], new AbortController().signal),
      "schema_too_large",
      "schema"
    );

    expect(harness.state.manifestCalls).toBe(1);
    expect(harness.state.schemaReadCalls).toBe(1);
    expect(harness.state.profileCalls).toBe(0);
  });

  it("keeps execution authority opaque and rejects wrong-token and WeakMap forgeries", async () => {
    const harness = createHarness();
    const plan = await harness.loader.load([harness.owner], new AbortController().signal);

    expect(() => KnowledgeSourceExecutionPlan.assert(plan)).not.toThrow();
    expect(() => KnowledgeSourceExecutionPlan.assert({ ...plan })).toThrow(
      KnowledgeSourceWorkflowPlanError
    );
    expect(() =>
      KnowledgeSourceExecutionPlan.assert(Object.create(KnowledgeSourceExecutionPlan.prototype))
    ).toThrow(KnowledgeSourceWorkflowPlanError);

    const RuntimeConstructor = KnowledgeSourceExecutionPlan as unknown as new (
      token: symbol,
      state: object
    ) => KnowledgeSourceExecutionPlan;
    expect(() => new RuntimeConstructor(Symbol("wrong-token"), {})).toThrow(
      KnowledgeSourceWorkflowPlanError
    );
    expect(() => KnowledgeSourceExecutionPlan.create(Symbol("wrong-token"), {} as never)).toThrow(
      KnowledgeSourceWorkflowPlanError
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(KnowledgeSourceExecutionPlan)).toBe(true);
    expect(Object.isFrozen(KnowledgeSourceExecutionPlan.prototype)).toBe(true);
    expect(Reflect.ownKeys(harness.loader)).toEqual([]);
    expect(Object.isFrozen(harness.loader)).toBe(true);

    const forgedLoader = Object.create(
      KnowledgeSourceWorkflowPlanLoader.prototype
    ) as KnowledgeSourceWorkflowPlanLoader;
    await expectWorkflowError(
      () => forgedLoader.load([harness.owner], new AbortController().signal),
      "plan_not_authoritative",
      "plan"
    );
  });

  it("rejects reader and parser capability getters without invoking them", () => {
    const harness = createHarness();
    let readerGetterCalls = 0;
    const malformedReader: Record<string, unknown> = {
      read: harness.readerPort.read,
    };
    Object.defineProperty(malformedReader, "readExpected", {
      enumerable: true,
      get: () => {
        readerGetterCalls += 1;
        return harness.readerPort.readExpected;
      },
    });

    expect(
      () =>
        new KnowledgeSourceWorkflowPlanLoader({
          executionOwner: harness.executionOwner,
          manifest: harness.manifestPort,
          artifactReader: malformedReader as unknown as KnowledgeExactArtifactReaderPort,
          pipelineProfile: harness.profilePort,
          parsers: [harness.parser],
          generation: harness.generationPort,
        })
    ).toThrow(KnowledgeSourceWorkflowPlanError);
    expect(readerGetterCalls).toBe(0);

    let parserGetterCalls = 0;
    const malformedParser: Record<string, unknown> = {
      getProfile: () => createParserProfile(),
    };
    Object.defineProperty(malformedParser, "parse", {
      enumerable: true,
      get: () => {
        parserGetterCalls += 1;
        return harness.parser.parse;
      },
    });

    expect(
      () =>
        new KnowledgeSourceWorkflowPlanLoader({
          executionOwner: harness.executionOwner,
          manifest: harness.manifestPort,
          artifactReader: harness.readerPort,
          pipelineProfile: harness.profilePort,
          parsers: [malformedParser as unknown as KnowledgeByteParser],
          generation: harness.generationPort,
        })
    ).toThrow(KnowledgeSourceWorkflowPlanError);
    expect(parserGetterCalls).toBe(0);
  });

  it("rejects a parser registry beyond the captured resource limit", () => {
    const harness = createHarness();
    const parsers = Array<KnowledgeByteParser>(10_001).fill(harness.parser);
    let caught: unknown;

    try {
      new KnowledgeSourceWorkflowPlanLoader({
        executionOwner: harness.executionOwner,
        manifest: harness.manifestPort,
        artifactReader: harness.readerPort,
        pipelineProfile: harness.profilePort,
        parsers,
        generation: harness.generationPort,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KnowledgeSourceWorkflowPlanError);
    expect(caught).toMatchObject({ code: "dependency_invalid", stage: "dependencies" });
  });

  it("does not expose a secret-bearing profile-port closure through digest, JSON, or errors", async () => {
    const secretCanary = "sk-secret-canary-workflow-plan-91a7";
    const harness = createHarness();
    Object.defineProperty(harness.profilePort, "privateCredential", {
      value: secretCanary,
      enumerable: true,
    });

    const plan = await harness.loader.load([harness.owner], new AbortController().signal);

    expect(plan.getDigest()).not.toContain(secretCanary);
    expect(JSON.stringify(plan)).not.toContain(secretCanary);
    expect(JSON.stringify(plan.getWatchPlan())).not.toContain(secretCanary);

    const failing = createHarness();
    failing.state.resolveProfile = () => {
      throw new Error(secretCanary);
    };
    const failure = await expectWorkflowError(
      () => failing.loader.load([failing.owner], new AbortController().signal),
      "profile_invalid",
      "profile"
    );
    expect(JSON.stringify(failure)).not.toContain(secretCanary);
    expect(failure.message).not.toContain(secretCanary);
  });
});

describe("KnowledgeSourceExecutionPlan.prepare", () => {
  it("re-proves the current Manifest, schema, and profile as one retained authority snapshot", async () => {
    const harness = createHarness();
    const { plan } = await loadPlanAndJob(harness);

    const authority = await plan.reproveBundleAuthorities(BUNDLE_ID, new AbortController().signal);

    expect(harness.state.manifestCalls).toBe(3);
    expect(harness.state.schemaReadCalls).toBe(3);
    expect(harness.state.profileCalls).toBe(3);
    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
    expect(authority.manifest).toEqual(createManifest());
    expect(authority.schema.content).toBe("# Knowledge schema\n");
    expect(authority.pipeline).toBe(plan.getBundlePipelineProfile(BUNDLE_ID));
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.manifest)).toBe(true);
    expect(Object.isFrozen(authority.schema)).toBe(true);
    expect(Object.isFrozen(authority.pipeline)).toBe(true);
  });

  it("rejects a changed current pipeline profile before source bytes or a parser are used", async () => {
    const harness = createHarness();
    const { plan } = await loadPlanAndJob(harness);
    harness.state.profile = {
      ...createPipelineProfile(),
      outputLanguage: "en",
    };

    await expectWorkflowError(
      () => plan.reproveBundleAuthorities(BUNDLE_ID, new AbortController().signal),
      "profile_stale",
      "profile"
    );

    expect(harness.state.manifestCalls).toBe(3);
    expect(harness.state.schemaReadCalls).toBe(3);
    expect(harness.state.profileCalls).toBe(3);
    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("sanitizes a failed current pipeline-profile reproof", async () => {
    const secretCanary = "sk-profile-reproof-private-error-77d9";
    const harness = createHarness();
    const { plan } = await loadPlanAndJob(harness);
    harness.state.resolveProfile = () => {
      throw new Error(secretCanary);
    };

    const failure = await expectWorkflowError(
      () => plan.reproveBundleAuthorities(BUNDLE_ID, new AbortController().signal),
      "profile_stale",
      "profile"
    );

    expect(harness.state.manifestCalls).toBe(3);
    expect(harness.state.schemaReadCalls).toBe(3);
    expect(harness.state.profileCalls).toBe(3);
    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
    expect(JSON.stringify(failure)).not.toContain(secretCanary);
    expect(failure.message).not.toContain(secretCanary);
  });

  it("rejects an unknown Bundle reproof before calling any retained authority port", async () => {
    const harness = createHarness();
    const { plan } = await loadPlanAndJob(harness);
    const callsAfterLoad = {
      manifest: harness.state.manifestCalls,
      schema: harness.state.schemaReadCalls,
      profile: harness.state.profileCalls,
    };

    await expectWorkflowError(
      () => plan.reproveBundleAuthorities("unknown-bundle", new AbortController().signal),
      "job_not_authorized",
      "job"
    );

    expect(harness.state.manifestCalls).toBe(callsAfterLoad.manifest);
    expect(harness.state.schemaReadCalls).toBe(callsAfterLoad.schema);
    expect(harness.state.profileCalls).toBe(callsAfterLoad.profile);
  });

  it("passes the exact reader-owned byte reference to the selected parser", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);

    await plan.prepare(job, new AbortController().signal);

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.parserRequests[0].bytes).toBe(harness.state.sourceBytes);
    expect(harness.state.parserRequests[0]).toMatchObject({
      sourceId: SOURCE_ID,
      sourcePath: SOURCE_PATH,
      sourceContentHash: job.sourceContentHash,
    });
  });

  it("detects parser mutation of the retained exact bytes", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async (request) => {
      request.bytes[0] ^= 0xff;
      return createParsedSource();
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "parser_mutated_bytes",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("prioritizes byte mutation when the parser rejects", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async (request) => {
      request.bytes[0] ^= 0xff;
      throw new Error("parser-private failure");
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "parser_mutated_bytes",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("detects byte mutation performed by a valid parser-result Proxy during verification", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async (request) => {
      let mutated = false;
      return new Proxy(createParsedSource(), {
        getPrototypeOf: (target) => {
          if (!mutated) {
            request.bytes[0] ^= 0xff;
            mutated = true;
          }
          return Reflect.getPrototypeOf(target);
        },
      });
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "parser_mutated_bytes",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("prioritizes Proxy-triggered byte mutation over an invalid parser result", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async (request) =>
      new Proxy(createParsedSource(), {
        getPrototypeOf: () => {
          request.bytes[0] ^= 0xff;
          return Date.prototype;
        },
      });

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "parser_mutated_bytes",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("fails a stale Manifest before reading source bytes or invoking the parser", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.manifest = createManifest(2);

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "manifest_stale",
      "manifest"
    );

    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("fails stale schema bytes before reading source bytes or invoking the parser", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.schemaBytes = new TextEncoder().encode("# Changed schema\n");

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "schema_stale",
      "schema"
    );

    expect(harness.state.sourceReadCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("fails a stale generation before any preparation port is called", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    const callsAfterLoad = {
      manifest: harness.state.manifestCalls,
      schema: harness.state.schemaReadCalls,
      source: harness.state.sourceReadCalls,
    };
    harness.state.current = false;

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "generation_stale",
      "plan"
    );

    expect(harness.state.manifestCalls).toBe(callsAfterLoad.manifest);
    expect(harness.state.schemaReadCalls).toBe(callsAfterLoad.schema);
    expect(harness.state.sourceReadCalls).toBe(callsAfterLoad.source);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("stops after parsing when the workflow generation becomes stale", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async () => {
      harness.state.current = false;
      return createParsedSource();
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "generation_stale",
      "plan"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
    expect(harness.state.schemaReadCalls).toBe(3);
    expect(harness.state.sourceReadCalls).toBe(1);
  });

  it("re-proves authority after parsing and rejects a late Manifest change", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async () => {
      harness.state.manifest = createManifest(2);
      return createParsedSource();
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "manifest_stale",
      "manifest"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(4);
  });

  it("re-proves authority after parsing and rejects a late schema change", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async () => {
      harness.state.schemaBytes = new TextEncoder().encode("# Late schema change\n");
      return createParsedSource();
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "schema_stale",
      "schema"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(4);
    expect(harness.state.schemaReadCalls).toBe(4);
  });

  it("re-proves authority after parsing and rejects a late pipeline-profile change", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    harness.state.parse = async () => {
      harness.state.profile = {
        ...createPipelineProfile(),
        outputLanguage: "en",
      };
      return createParsedSource();
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "profile_stale",
      "profile"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(4);
    expect(harness.state.schemaReadCalls).toBe(4);
    expect(harness.state.profileCalls).toBe(4);
  });

  it("rejects a reader payload accessor without invoking it or the parser", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    let getterCalls = 0;
    harness.state.readSource = (path) => {
      const malformed: Record<string, unknown> = {
        sourcePath: path,
        sourceContentHash: job.sourceContentHash,
      };
      Object.defineProperty(malformed, "bytes", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return harness.state.sourceBytes;
        },
      });
      return malformed;
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "artifact_invalid",
      "job"
    );

    expect(getterCalls).toBe(0);
    expect(harness.state.parserCalls).toBe(0);
  });

  it("rejects a parser success accessor without invoking it", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);
    let getterCalls = 0;
    harness.state.parse = async () => {
      const malformed: Record<string, unknown> = {};
      Object.defineProperty(malformed, "artifact", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return createParsedSource().artifact;
        },
      });
      return malformed;
    };

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "artifact_invalid",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(getterCalls).toBe(0);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("enforces the execution-owned parsed-character limit", async () => {
    const harness = createHarness({ maxParsedCharacters: 4 });
    const { plan, job } = await loadPlanAndJob(harness);

    await expectWorkflowError(
      () => plan.prepare(job, new AbortController().signal),
      "artifact_invalid",
      "parser"
    );

    expect(harness.state.parserCalls).toBe(1);
    expect(harness.state.manifestCalls).toBe(3);
  });

  it("bridges BOM and CRLF schema bytes without normalization", async () => {
    const schemaText = "\ufeff# Knowledge schema\r\nrule: exact\r\n";
    const schemaBytes = new TextEncoder().encode(schemaText);
    const harness = createHarness({ schemaBytes });
    const { plan, job } = await loadPlanAndJob(harness);

    const prepared = await plan.prepare(job, new AbortController().signal);

    expect(prepared.schema.content).toBe(schemaText);
    expect(prepared.schema.contentHash).toBe(createFileContentHash(schemaText));
    expect(prepared.schema.contentHash).toBe(createSourceContentHash(schemaBytes));
    expect(plan.getWatchPlan().getBundleAuthority(BUNDLE_ID)?.schemaContentHash).toBe(
      createSourceContentHash(schemaBytes)
    );
  });

  it("returns a detached deeply frozen preparation", async () => {
    const harness = createHarness();
    const { plan, job } = await loadPlanAndJob(harness);

    const prepared = await plan.prepare(job, new AbortController().signal);

    expect(prepared.authority).toBe("unbound_read_only");
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.bundle)).toBe(true);
    expect(Object.isFrozen(prepared.bundle.sourceRoots)).toBe(true);
    expect(Object.isFrozen(prepared.manifest)).toBe(true);
    expect(Object.isFrozen(prepared.manifest.entries)).toBe(true);
    expect(Object.isFrozen(prepared.manifest.entries[0])).toBe(true);
    expect(Object.isFrozen(prepared.schema)).toBe(true);
    expect(Object.isFrozen(prepared.source)).toBe(true);
    expect(Object.isFrozen(prepared.artifacts)).toBe(true);
    expect(Object.isFrozen(prepared.artifacts[0])).toBe(true);
    expect(prepared.bundle).not.toBe(harness.owner.config);
    expect(prepared.manifest).not.toBe(harness.state.manifest);
  });
});
