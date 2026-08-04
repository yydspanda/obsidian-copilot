import { type App, type DataAdapter, type Vault } from "obsidian";

import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { KnowledgeProductionCandidateValidator } from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import {
  KnowledgeProductionPreflightComposer,
  type KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProjectInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  KnowledgeSourceWorkflowPlanLoader,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeProductionCompileReviewHandler } from "@/knowledge/startup/KnowledgeProductionCompileReviewHandler";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import { KnowledgeProductionPreparationExecutor } from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";

interface NativeNodeProcess {
  env: NodeJS.ProcessEnv;
  getBuiltinModule: (specifier: string) => unknown;
  loadEnvFile: (path: string) => void;
}

interface NativeWebRuntime {
  fetch: typeof fetch;
  AbortController: typeof AbortController;
}

/** Returns Node's host process rather than Jest's detached process facade. */
function getNativeNodeProcess(): NativeNodeProcess {
  const testProcess = process as unknown as {
    getBuiltinModule?: (specifier: string) => unknown;
  };
  const nativeProcess = testProcess.getBuiltinModule?.("node:process") as
    | Partial<NativeNodeProcess>
    | undefined;
  if (
    !nativeProcess ||
    typeof nativeProcess.getBuiltinModule !== "function" ||
    typeof nativeProcess.loadEnvFile !== "function" ||
    !nativeProcess.env
  ) {
    throw new Error("The integration-test runtime cannot access Node's host process");
  }
  return nativeProcess as NativeNodeProcess;
}

/** Identifies an optional env file that is simply not present. */
function isMissingEnvFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/** Loads only the live-test credential from external env or ignored `.env.test`. */
function loadDeepSeekApiKey(): string | undefined {
  let nativeProcess: NativeNodeProcess | undefined;
  try {
    nativeProcess = getNativeNodeProcess();
    nativeProcess.loadEnvFile(".env.test");
  } catch (error) {
    if (!isMissingEnvFileError(error)) throw error;
  }

  const candidate = process.env.DEEPSEEK_API_KEY ?? nativeProcess?.env.DEEPSEEK_API_KEY;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

const DEEPSEEK_API_KEY = loadDeepSeekApiKey();

const PROJECT_ID = "project-live-deepseek";
const BUNDLE_ID = "personal-live-deepseek";
const SOURCE_ID = "source-atlas-live";
const SOURCE_PATH = "Sources/Atlas.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const ATLAS_PATH = "Wiki/Atlas.md";
const MODEL_NAME = "deepseek-v4-flash";
const JOB_ID = "job-live-deepseek-atlas";
const SOURCE_CONTENT = "# Project Atlas source\n\nProject Atlas launch date is 2026-08-01.\n";
const SCHEMA_CONTENT = `# Atlas Wiki schema

All supported Project Atlas facts belong only in \`${ATLAS_PATH}\`.
Create that page and do not create or update any other page.
Every regular page must start with YAML frontmatter containing the canonical non-empty field \`type: topic\`.
Keep the complete page concise, state the exact supported launch date, and do not add links, references, autolinks, or footnotes.
Write the complete Markdown page instead of returning unchanged.
`;
const SOURCE_BYTES = new TextEncoder().encode(SOURCE_CONTENT);
const SCHEMA_BYTES = new TextEncoder().encode(SCHEMA_CONTENT);
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);
const describeWithDeepSeek = DEEPSEEK_API_KEY ? describe : describe.skip;

interface SafeFetchMetadata {
  url: string;
  method: string;
  requestBytes: number;
  responseStatus?: number;
}

interface ReadOnlyAtlasVaultHarness {
  app: App;
  adapter: Readonly<Record<string, unknown>>;
  contents: Map<string, string>;
  stat: jest.Mock;
  read: jest.Mock;
}

/** Creates the single project-owned Bundle exercised by the live compiler. */
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

/** Creates the project record that selects the exact current DeepSeek model. */
function createProject(): ProjectKnowledgePipelineProjectInput {
  return {
    id: PROJECT_ID,
    projectModelKey: `${MODEL_NAME}|deepseek`,
    modelConfigs: {},
  };
}

/** Creates the hydrated production settings projection without logging its credential. */
function createSettings(apiKey: string): KnowledgeProductionPreflightSettingsInput {
  return {
    temperature: 0,
    maxTokens: 8_192,
    reasoningEffort: "minimal",
    verbosity: "low",
    activeModels: [
      {
        name: MODEL_NAME,
        provider: "deepseek",
        enabled: true,
        projectEnabled: true,
        temperature: 0,
        maxTokens: 8_192,
        reasoningEffort: "minimal",
        verbosity: "low",
      },
    ],
    deepseekApiKey: apiKey,
  };
}

/** Creates the exact pre-compile Manifest before this source has generated a page. */
function createManifest(): SourceManifest {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    revision: 1,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourceKey: toWindowsPathKey(SOURCE_PATH),
        sourcePath: SOURCE_PATH,
        custody: "user_managed",
      },
    ],
  };
}

/** Creates an empty App/Vault adapter that exposes only stat and read capabilities. */
function createReadOnlyAtlasVault(): ReadOnlyAtlasVaultHarness {
  const contents = new Map<string, string>();
  const stat = jest.fn(async (path: string) => {
    const content = contents.get(path);
    return content === undefined
      ? null
      : { type: "file" as const, ctime: 0, mtime: 0, size: content.length };
  });
  const read = jest.fn(async (path: string) => {
    const content = contents.get(path);
    if (content === undefined) throw new Error("The read-only Wiki fixture is unavailable");
    return content;
  });
  const adapter = Object.freeze({ stat, read });
  const vault = {
    adapter: adapter as unknown as DataAdapter,
    getAllLoadedFiles: () => [],
  } as unknown as Vault;
  return {
    app: { vault } as unknown as App,
    adapter,
    contents,
    stat,
    read,
  };
}

/** Loads Node-native web primitives from outside Jest's jsdom realm. */
function getNativeWebRuntime(): NativeWebRuntime {
  const nativeVm = getNativeNodeProcess().getBuiltinModule("node:vm") as
    | { runInThisContext?: (source: string) => unknown }
    | undefined;
  if (typeof nativeVm?.runInThisContext !== "function") {
    throw new Error("The integration-test runtime cannot load Node-native web primitives");
  }

  const nativeFetch = nativeVm.runInThisContext("globalThis.fetch");
  const nativeAbortController = nativeVm.runInThisContext("globalThis.AbortController");
  if (typeof nativeFetch !== "function" || typeof nativeAbortController !== "function") {
    throw new Error("The integration-test runtime does not provide native web primitives");
  }
  return {
    fetch: nativeFetch as typeof fetch,
    AbortController: nativeAbortController as typeof AbortController,
  };
}

/** Installs Node's AbortController for Queue-created signals and returns an exact restoration. */
function installNativeAbortController(nativeAbortController: typeof AbortController): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "AbortController");
  Object.defineProperty(window, "AbortController", {
    configurable: true,
    writable: true,
    value: nativeAbortController,
  });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(window, "AbortController", originalDescriptor);
      return;
    }
    Reflect.deleteProperty(window, "AbortController");
  };
}

/** Creates a native fetch port that retains only credential-free request metadata. */
function createSafeNativeFetchPort(
  metadata: SafeFetchMetadata[],
  nativeWebRuntime: NativeWebRuntime
): KnowledgeDeepSeekFetchPort {
  return async (url, init) => {
    if (typeof init.body !== "string") {
      throw new Error("The DeepSeek production request body must be encoded text");
    }
    const observation: SafeFetchMetadata = {
      url,
      method: init.method ?? "GET",
      requestBytes: new TextEncoder().encode(init.body).byteLength,
    };
    metadata.push(observation);
    const response = await nativeWebRuntime.fetch(url, init);
    observation.responseStatus = response.status;
    return {
      status: response.status,
      redirected: response.redirected,
      url: response.url,
      headers: response.headers,
      body: response.body,
    };
  };
}

/** Runtime-backed Manifest port used by the production workflow loader. */
class RuntimeManifestSnapshotPort implements KnowledgeManifestSnapshotPort {
  /** Captures the exact shared Runtime Manifest facade. */
  constructor(private readonly storage: KnowledgeRuntimeManifestStorage) {}

  /** Loads one detached Manifest from the shared Runtime envelope. */
  load(bundleId: string): Promise<unknown> {
    return this.storage.read(bundleId);
  }
}

/** Exact in-memory source/schema byte reader with no mutation capability. */
class ExactArtifactReader implements KnowledgeExactArtifactReaderPort {
  private readonly artifacts = new Map<string, Uint8Array>([
    [SOURCE_PATH, SOURCE_BYTES],
    [SCHEMA_PATH, SCHEMA_BYTES],
  ]);

  /** Reads exact bytes for workflow collection and reproof. */
  async read(sourcePath: string, signal?: AbortSignal): Promise<ExactSourceArtifact> {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return this.readCurrent(sourcePath);
  }

  /** Reads exact bytes only when they retain the Queue-owned source hash. */
  async readExpected(
    sourcePath: string,
    expectedContentHash: string,
    signal?: AbortSignal
  ): Promise<ExactSourceArtifact> {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const artifact = this.readCurrent(sourcePath);
    if (artifact.sourceContentHash !== expectedContentHash) {
      throw new Error("The exact source artifact changed");
    }
    return artifact;
  }

  /** Returns a detached exact-byte artifact for one known fixture path. */
  private readCurrent(sourcePath: string): ExactSourceArtifact {
    const bytes = this.artifacts.get(sourcePath);
    if (!bytes) throw new Error("The exact artifact fixture is unavailable");
    const detached = new Uint8Array(bytes);
    return Object.freeze({
      sourcePath,
      bytes: detached,
      sourceContentHash: createSourceContentHash(detached),
    });
  }
}

describeWithDeepSeek("Knowledge Compiler DeepSeek production chain", () => {
  it("persists an exact pending Review without mutating Manifest or Wiki bytes", async () => {
    const apiKey = DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for this live integration test");

    const owner = createOwner();
    const project = createProject();
    const settings = createSettings(apiKey);
    const resources = createKnowledgeProductionPipelineResources();
    const profileSource = new ProjectKnowledgePipelineProfileSource(
      [project],
      settings,
      resources.profileOptions
    );
    const nativeWebRuntime = getNativeWebRuntime();
    const restoreAbortController = installNativeAbortController(nativeWebRuntime.AbortController);
    const requestMetadata: SafeFetchMetadata[] = [];
    let preflight: KnowledgeProductionPreflightComposer | undefined;

    try {
      const fetchPort = createSafeNativeFetchPort(requestMetadata, nativeWebRuntime);
      preflight = new KnowledgeProductionPreflightComposer({
        owners: [owner],
        projects: [project],
        settings,
        profileOptions: resources.profileOptions,
        profileSource,
        fetchPort,
      });
      expect(preflight.preflight()).toEqual({ kind: "ready", bundleCount: 1 });
      expect(requestMetadata).toEqual([]);
      const routeLease = preflight.getModelRouteLeaseOwner().getLease();

      const runtimeFile = new KnowledgeExecutionMemoryRuntimeFile();
      const runtime = new KnowledgeRuntimeStore(runtimeFile);
      await runtime.initialize();
      const executionOwner = createKnowledgeExecutionOwner();
      const queueStorage = new KnowledgeRuntimeQueueStorage(runtime, executionOwner);
      const manifestStorage = new KnowledgeRuntimeManifestStorage(runtime);
      const reviewStorage = new KnowledgeRuntimeReviewStorage(runtime, executionOwner);
      const manifest = createManifest();
      await manifestStorage.write(BUNDLE_ID, manifest, null);
      const reviews = new ChangeSetReviewRepository(reviewStorage, { clock: () => 2_000 });

      const artifactReader = new ExactArtifactReader();
      const workflowLoader = new KnowledgeSourceWorkflowPlanLoader({
        executionOwner,
        manifest: new RuntimeManifestSnapshotPort(manifestStorage),
        artifactReader,
        pipelineProfile: profileSource,
        parsers: resources.parsers,
        generation: { isCurrent: () => true },
      });
      const plan = await workflowLoader.load([owner], new AbortController().signal);
      const plannedSource = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
      expect(plannedSource).toBeDefined();
      if (!plannedSource) throw new Error("The production workflow source was not planned");

      const readOnlyWiki = createReadOnlyAtlasVault();
      const targetResolver = new ObsidianKnowledgeCompilerTargetResolver(readOnlyWiki.app);
      const candidateValidator = new KnowledgeProductionCandidateValidator();
      const handler = new KnowledgeProductionCompileReviewHandler({
        routeLease,
        targetResolver,
        candidateValidator,
        reviews,
      });
      const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
      const executor = new KnowledgeProductionPreparationExecutor(plan, proofPort, handler);
      const queue = new IngestQueue(queueStorage, executor, {
        clock: () => 1_000,
        jobIdFactory: () => JOB_ID,
        retryPolicy: { decide: () => ({ kind: "fail", reason: "not_retryable" }) },
      });

      const allocator = new KnowledgeRuntimeInputRevisionAllocator(runtime);
      const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
      const allocation = await allocator.allocate({
        bundleId: BUNDLE_ID,
        sourceId: SOURCE_ID,
        captureId: "capture-live-deepseek-atlas",
      });
      const binding = await observations.bind({
        observationToken: allocation.observationToken,
        sourceContentHash: SOURCE_CONTENT_HASH,
        pipelineFingerprint: plannedSource.pipelineFingerprint,
      });
      expect(binding.kind).toBe("ready");
      if (binding.kind !== "ready") {
        throw new Error("The live source observation was not Queue-ready");
      }
      await queue.enqueue(binding.observation);

      const cancellationWatchdog = window.setTimeout(() => {
        void queue.cancel(BUNDLE_ID, JOB_ID).catch(() => undefined);
      }, 120_000);
      let queueResult;
      try {
        queueResult = await queue.runNext(BUNDLE_ID);
      } finally {
        window.clearTimeout(cancellationWatchdog);
      }
      if (queueResult.kind !== "executed" || queueResult.status !== "awaiting_review") {
        const failedSnapshot = await queue.load(BUNDLE_ID);
        const failedJob = failedSnapshot.jobs.find((job) => job.id === JOB_ID);
        throw new Error(
          `The live compiler did not reach Review: ${JSON.stringify({
            result: queueResult,
            requestCount: requestMetadata.length,
            responseStatuses: requestMetadata.map(({ responseStatus }) => responseStatus ?? null),
            jobStatus: failedJob?.status,
            jobStage: failedJob?.stage,
            failureCode: failedJob?.status === "failed" ? failedJob.failure.code : undefined,
          })}`
        );
      }
      expect(queueResult).toEqual({
        kind: "executed",
        jobId: JOB_ID,
        status: "awaiting_review",
      });

      expect(requestMetadata).toHaveLength(2);
      expect(requestMetadata.map(({ url, method }) => ({ url, method }))).toEqual([
        { url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT, method: "POST" },
        { url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT, method: "POST" },
      ]);
      expect(requestMetadata.every(({ requestBytes }) => requestBytes > 0)).toBe(true);

      const reviewSnapshot = await reviews.load(BUNDLE_ID);
      expect(reviewSnapshot.records).toHaveLength(1);
      const record = reviewSnapshot.records[0];
      expect(record).toMatchObject({ outcome: "pending", recordRevision: 0 });
      if (!record || record.outcome !== "pending") {
        throw new Error("The compiler proposal did not enter pending Review");
      }
      expect(record.jobClaim).toEqual({
        jobId: JOB_ID,
        sourceId: SOURCE_ID,
        sourceContentHash: SOURCE_CONTENT_HASH,
        pipelineFingerprint: plannedSource.pipelineFingerprint,
        inputRevision: allocation.inputRevision,
        attempt: 1,
      });
      expect(record.proposal).toMatchObject({
        id: record.changeSetId,
        bundleId: BUNDLE_ID,
        status: "proposed",
        validation: { okfValid: true, citationsValid: true, linksValid: true },
      });
      expect(record.proposal.changes).toHaveLength(1);
      const change = record.proposal.changes[0];
      expect(change).toMatchObject({
        path: ATLAS_PATH,
        operation: "create",
        expectedAbsent: true,
      });
      expect(change && "afterContent" in change ? change.afterContent : "").toContain("2026-08-01");
      expect(record.manifestCommitPlan).toMatchObject({
        bundleId: BUNDLE_ID,
        sourceId: SOURCE_ID,
        sourceContentHash: SOURCE_CONTENT_HASH,
        pipelineFingerprint: plannedSource.pipelineFingerprint,
        inputRevision: allocation.inputRevision,
        changeSetId: record.changeSetId,
        expectedManifestRevision: manifest.revision,
        expectedManifestDigest: createSourceManifestDigest(manifest),
        baseGeneratedPages: [],
        mutations: [
          {
            path: ATLAS_PATH,
            operation: "create",
            access: "create_only",
            ownership: "generated",
            wasTrackedByPrimarySource: false,
          },
        ],
      });
      expect(record.proposalDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(record.manifestCommitPlanDigest).toMatch(/^[a-f0-9]{64}$/);

      const queueSnapshot = await queue.load(BUNDLE_ID);
      expect(queueSnapshot.jobs).toContainEqual(
        expect.objectContaining({
          id: JOB_ID,
          status: "awaiting_review",
          stage: "review",
          changeSetId: record.changeSetId,
        })
      );
      expect(queueSnapshot.pendingReviews).toEqual([
        {
          kind: "durable",
          jobId: JOB_ID,
          changeSetId: record.changeSetId,
          proposalDigest: record.proposalDigest,
          reviewRecordRevision: 0,
          recordedAt: record.recordedAt,
        },
      ]);

      expect(await manifestStorage.read(BUNDLE_ID)).toEqual(manifest);
      expect(readOnlyWiki.contents.has(ATLAS_PATH)).toBe(false);
      expect(readOnlyWiki.read).not.toHaveBeenCalled();
      expect(readOnlyWiki.stat).toHaveBeenCalledTimes(1);
      expect("write" in readOnlyWiki.adapter).toBe(false);
      expect("process" in readOnlyWiki.adapter).toBe(false);
      expect("remove" in readOnlyWiki.adapter).toBe(false);
    } finally {
      try {
        preflight?.close();
      } finally {
        restoreAbortController();
      }
    }
  }, 180_000);
});
