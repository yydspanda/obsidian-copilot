import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  KnowledgeAuthorizedSourcePreparation,
  KnowledgeAuthorizedSourcePreparationBinder,
  KnowledgeAuthorizedSourcePreparationError,
} from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import { KnowledgeIngestExecutionAuthorityBinder } from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeSourceWorkflowPlanDependencies,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type {
  IngestExecutionContext,
  IngestExecutionResult,
} from "@/knowledge/ingest/queue/IngestQueue";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import {
  createKnowledgeExecutionTestHarness,
  type KnowledgeExecutionTestHarness,
} from "@/knowledge/testing/KnowledgeExecutionTestHarness";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_BYTES = new TextEncoder().encode("# Source\nExact text\n");
const SOURCE_HASH = createSourceContentHash(SOURCE_BYTES);

/** Creates the one project-owned Bundle used by authorization tests. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  const config: KnowledgeBundleConfig = {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
  return { projectId: "project-personal", config };
}

/** Creates the exact durable Manifest shared by Runtime and workflow authorities. */
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

/** Creates a valid same-revision Runtime Manifest that disagrees with workflow authority. */
function createMismatchedRuntimeManifest(): SourceManifest {
  const manifest = createManifest();
  const sourcePath = "Sources/Runtime-Only.md";
  return {
    ...manifest,
    entries: [{ ...manifest.entries[0], sourcePath, sourceKey: toWindowsPathKey(sourcePath) }],
  };
}

/** Creates the one parser profile advertised by the test plan. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates a detached, credential-free pipeline profile. */
function createProfile(temperature = 0.2): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: { version: "knowledge-compiler-v1", configuration: { protocolVersion: 1 } },
    parsers: [createParserProfile()],
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-object-core-schema-v1",
        streaming: false,
        modelFallback: false,
        temperature,
        maxTokens: 4096,
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

interface WorkflowHarness {
  executionOwner: KnowledgeExecutionOwner;
  loader: KnowledgeSourceWorkflowPlanLoader;
  owner: ConfiguredProjectKnowledgeBundle;
  state: {
    manifest: SourceManifest;
    profile: KnowledgeBundlePipelineProfile;
    current: boolean;
    sourceReads: number;
    parserCalls: number;
  };
}

/** Creates a strict authentic workflow-plan loader with mutable test authorities. */
function createWorkflowHarness(): WorkflowHarness {
  const owner = createOwner();
  const executionOwner = createKnowledgeExecutionOwner();
  const state: WorkflowHarness["state"] = {
    manifest: createManifest(),
    profile: createProfile(),
    current: true,
    sourceReads: 0,
    parserCalls: 0,
  };
  const parser: KnowledgeByteParser = {
    getProfile: () => createParserProfile(),
    parse: async () => {
      state.parserCalls += 1;
      const text = new TextDecoder().decode(SOURCE_BYTES);
      return {
        artifact: {
          kind: "text",
          sourceId: SOURCE_ID,
          artifactId: "primary",
          artifactContentHash: createFileContentHash(text),
          text,
        },
      };
    },
  };
  const dependencies: KnowledgeSourceWorkflowPlanDependencies = {
    executionOwner,
    manifest: { load: async () => state.manifest },
    artifactReader: {
      read: async (path) => ({
        sourcePath: path,
        bytes: SCHEMA_BYTES,
        sourceContentHash: createSourceContentHash(SCHEMA_BYTES),
      }),
      readExpected: async (path) => {
        state.sourceReads += 1;
        return { sourcePath: path, bytes: SOURCE_BYTES, sourceContentHash: SOURCE_HASH };
      },
    },
    pipelineProfile: { resolve: async () => state.profile },
    parsers: [parser],
    generation: { isCurrent: () => state.current },
  };
  return {
    executionOwner,
    loader: new KnowledgeSourceWorkflowPlanLoader(dependencies),
    owner,
    state,
  };
}

/** Runs one handler inside an authentic Runtime-backed Queue execution context. */
async function runWithClaim(
  pipelineFingerprint: string,
  executionOwner: KnowledgeExecutionOwner,
  handler: (
    context: IngestExecutionContext,
    harness: KnowledgeExecutionTestHarness
  ) => Promise<IngestExecutionResult>,
  runtimeManifest: SourceManifest = createManifest()
): Promise<void> {
  let harness: KnowledgeExecutionTestHarness;
  harness = await createKnowledgeExecutionTestHarness({
    manifest: runtimeManifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint,
    executionOwner,
    execute: (context) => handler(context, harness),
    clock: 100,
    jobId: "job-authorized-preparation",
  });
  const result = await harness.queue.runNext(BUNDLE_ID);
  expect(result).toMatchObject({ kind: "executed", status: "completed" });
}

/** Captures one sanitized preparation error. */
async function expectPreparationError(
  action: () => Promise<unknown>,
  code: KnowledgeAuthorizedSourcePreparationError["code"]
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeAuthorizedSourcePreparationError);
  expect(caught).toMatchObject({ code });
}

describe("KnowledgeAuthorizedSourcePreparation", () => {
  it("binds parsed material only through an exact Runtime and workflow proof sandwich", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();
    let preparation: KnowledgeAuthorizedSourcePreparation | undefined;

    await runWithClaim(
      source.pipelineFingerprint,
      workflow.executionOwner,
      async (context, execution) => {
        const authorityBinder = new KnowledgeIngestExecutionAuthorityBinder(execution.proofPort);
        const authority = await authorityBinder.bind(context.executionClaim);
        preparation = await preparationBinder.prepare(plan, authority);
        KnowledgeAuthorizedSourcePreparation.assert(preparation);
        expect(preparation.getSignal()).toBe(context.signal);
        expect(preparation.getClaim()).toMatchObject({ jobId: "job-authorized-preparation" });
        expect(preparation.getProfile()).toEqual(createProfile());
        expect(preparation.getPreparation()).toMatchObject({
          operation: "ingest",
          bundle: { id: BUNDLE_ID },
          source: {
            sourceId: SOURCE_ID,
            sourceContentHash: SOURCE_HASH,
            pipelineFingerprint: source.pipelineFingerprint,
            inputRevision: 1,
          },
        });
        expect(Object.keys(preparation)).toEqual([]);
        expect(Object.isFrozen(preparation)).toBe(true);
        await preparation.reprove("parsing");
        return { kind: "no_changes", changeSetId: "changeset-authorized" };
      }
    );

    expect(workflow.state.sourceReads).toBe(1);
    expect(workflow.state.parserCalls).toBe(1);
    expect(preparation).toBeDefined();
    await expectPreparationError(() => preparation!.reprove("parsing"), "authority_stale");
  });

  it("rejects a Runtime/Manifest mismatch before any source read or parser call", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();

    await runWithClaim(
      source.pipelineFingerprint,
      workflow.executionOwner,
      async (context, execution) => {
        const authorityBinder = new KnowledgeIngestExecutionAuthorityBinder(execution.proofPort);
        const authority = await authorityBinder.bind(context.executionClaim);
        await expectPreparationError(
          () => preparationBinder.prepare(plan, authority),
          "manifest_mismatch"
        );
        return { kind: "no_changes", changeSetId: "changeset-mismatch" };
      },
      createMismatchedRuntimeManifest()
    );

    expect(workflow.state.sourceReads).toBe(0);
    expect(workflow.state.parserCalls).toBe(0);
  });

  it("rejects an otherwise equal workflow plan from another execution lifecycle", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();

    await runWithClaim(
      source.pipelineFingerprint,
      createKnowledgeExecutionOwner(),
      async (context, execution) => {
        const authority = await new KnowledgeIngestExecutionAuthorityBinder(
          execution.proofPort
        ).bind(context.executionClaim);
        await expectPreparationError(
          () => preparationBinder.prepare(plan, authority),
          "owner_mismatch"
        );
        return { kind: "no_changes", changeSetId: "changeset-owner-mismatch" };
      }
    );

    expect(workflow.state.sourceReads).toBe(0);
    expect(workflow.state.parserCalls).toBe(0);
  });

  it("rejects marker DTOs, spread copies, prototype forgeries, and stale profiles", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();

    expect(() =>
      KnowledgeAuthorizedSourcePreparation.assert({ authority: "unbound_read_only" })
    ).toThrow(KnowledgeAuthorizedSourcePreparationError);
    expect(() =>
      KnowledgeAuthorizedSourcePreparation.assert(
        Object.create(KnowledgeAuthorizedSourcePreparation.prototype)
      )
    ).toThrow(KnowledgeAuthorizedSourcePreparationError);

    await runWithClaim(
      source.pipelineFingerprint,
      workflow.executionOwner,
      async (context, execution) => {
        const authorityBinder = new KnowledgeIngestExecutionAuthorityBinder(execution.proofPort);
        const authority = await authorityBinder.bind(context.executionClaim);
        const preparation = await preparationBinder.prepare(plan, authority);
        expect(() => KnowledgeAuthorizedSourcePreparation.assert({ ...preparation })).toThrow(
          KnowledgeAuthorizedSourcePreparationError
        );
        workflow.state.profile = createProfile(0.7);
        await expectPreparationError(() => preparation.reprove("parsing"), "authority_stale");
        return { kind: "no_changes", changeSetId: "changeset-profile-drift" };
      }
    );
  });

  it("reserves each execution authority once across concurrent and repeated preparation", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();

    await runWithClaim(
      source.pipelineFingerprint,
      workflow.executionOwner,
      async (context, execution) => {
        const authorityBinder = new KnowledgeIngestExecutionAuthorityBinder(execution.proofPort);
        const authority = await authorityBinder.bind(context.executionClaim);
        const first = preparationBinder.prepare(plan, authority);
        await expectPreparationError(
          () => preparationBinder.prepare(plan, authority),
          "authority_reused"
        );
        await expect(first).resolves.toBeInstanceOf(KnowledgeAuthorizedSourcePreparation);
        await expectPreparationError(
          () => preparationBinder.prepare(plan, authority),
          "authority_reused"
        );
        return { kind: "no_changes", changeSetId: "changeset-authority-one-shot" };
      }
    );

    expect(workflow.state.sourceReads).toBe(1);
    expect(workflow.state.parserCalls).toBe(1);
  });

  it("rejects publication when the workflow generation expires during the final Runtime proof", async () => {
    const workflow = createWorkflowHarness();
    const plan = await workflow.loader.load([workflow.owner], new AbortController().signal);
    const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
    if (!source) throw new Error("Expected a watched source");
    const preparationBinder = new KnowledgeAuthorizedSourcePreparationBinder();
    let proofCalls = 0;

    await runWithClaim(
      source.pipelineFingerprint,
      workflow.executionOwner,
      async (context, execution) => {
        const process = execution.file.process.bind(execution.file) as OmitThisParameter<
          typeof execution.file.process
        >;
        execution.file.process = async (transform) => {
          const result = await process(transform);
          proofCalls += 1;
          if (proofCalls === 5) workflow.state.current = false;
          return result;
        };
        const authorityBinder = new KnowledgeIngestExecutionAuthorityBinder(execution.proofPort);
        const authority = await authorityBinder.bind(context.executionClaim);
        await expectPreparationError(
          () => preparationBinder.prepare(plan, authority),
          "authority_stale"
        );
        return { kind: "no_changes", changeSetId: "changeset-final-generation-check" };
      }
    );

    expect(proofCalls).toBeGreaterThanOrEqual(5);
    expect(workflow.state.sourceReads).toBe(1);
    expect(workflow.state.parserCalls).toBe(1);
  });
});
