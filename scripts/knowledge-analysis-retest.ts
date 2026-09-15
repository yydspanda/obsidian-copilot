import { Plugin, type App, type DataAdapter, type Vault } from "obsidian";
import { DEEPSEEK_FLASH_WIRE_IDENTITY } from "@/LLMProviders/deepseekModelPolicy";
import {
  prepareKnowledgeConfiguredModelPreflight,
  type KnowledgeConfiguredModelProjectInput,
  type PrepareKnowledgeConfiguredModelPreflightInput,
} from "@/knowledge/compiler/KnowledgeConfiguredModelBridge";
import {
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  type KnowledgeDeepSeekFetchPort,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { KnowledgeProductionCandidateValidator } from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import { parseSourceManifest } from "@/knowledge/model/schemas";
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
import { sha256 } from "@/utils/hash";

const MAX_REQUESTS = 2;
const TIMEOUT_MS = 120_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Read-only live capabilities and a complete paused Runtime snapshot retained only in memory. */
export interface KnowledgeAnalysisRetestInput {
  runtimeText: string;
  app: Pick<App, "vault">;
  modelManagement: PrepareKnowledgeConfiguredModelPreflightInput["modelManagement"];
  owner: ConfiguredProjectKnowledgeBundle;
  project: KnowledgeConfiguredModelProjectInput;
  sourceId: string;
}

interface SafeRequest {
  stage: "analysis" | "generation";
  requestedModel: typeof DEEPSEEK_FLASH_WIRE_IDENTITY;
  bodyHash: string;
  modelParametersHash: string;
  requestBytes: number;
  requestStartedAt: number;
  headerReceivedAt?: number;
  responseStatus?: number;
}

interface RetestSession {
  execute: () => Promise<Record<string, unknown>>;
  snapshot: () => Record<string, unknown>;
  close: () => void;
  used: boolean;
}

let session: RetestSession | undefined;
let preparing = false;
let preparationController: AbortController | undefined;

/**
 * Builds an isolated production compile chain without releasing its network capability.
 *
 * @param input - One explicitly selected source, its owner/model selection, and a complete paused snapshot
 */
export async function prepare(
  input: KnowledgeAnalysisRetestInput
): Promise<Record<string, unknown>> {
  if (session || preparing) return { kind: "diagnostic", code: "session_already_prepared" };
  preparing = true;
  const preparationSignal = new AbortController();
  preparationController = preparationSignal;
  let queue: IngestQueue | undefined;
  let closeRoute: (() => void) | undefined;
  let current = true;
  let phase = "runtime_clone";
  const controllers: AbortController[] = [];
  const unlinkSignals: (() => void)[] = [];
  const release = (): void => {
    current = false;
    preparationSignal.abort();
    queue?.close();
    closeRoute?.();
    // Queue settlement may already have released its controller while the HTTP body is still open.
    // https://github.com/yydspanda/obsidian-copilot/issues/8
    for (const controller of controllers) controller.abort();
    for (const unlink of unlinkSignals) unlink();
  };
  try {
    const owner = JSON.parse(JSON.stringify(input.owner)) as ConfiguredProjectKnowledgeBundle;
    const project = JSON.parse(
      JSON.stringify(input.project)
    ) as KnowledgeConfiguredModelProjectInput;
    const sourceId = input.sourceId;
    // A single-source authorization must never fall back to another source that can incur model charges.
    // https://github.com/yydspanda/obsidian-copilot/issues/8
    if (
      typeof sourceId !== "string" ||
      sourceId.trim() !== sourceId ||
      !sourceId ||
      owner.projectId !== project.id
    ) {
      return { kind: "diagnostic", code: "selection_invalid" };
    }
    const bundleId = owner.config.id;
    const file = new KnowledgeExecutionMemoryRuntimeFile();
    await file.initialize(input.runtimeText);
    const runtime = new KnowledgeRuntimeStore(file);
    await runtime.initialize();
    const executionOwner = createKnowledgeExecutionOwner();
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime, executionOwner);
    const manifestStorage = new KnowledgeRuntimeManifestStorage(runtime);
    const parsedManifest = parseSourceManifest(await manifestStorage.read(bundleId));
    if (!parsedManifest.ok) return { kind: "diagnostic", code: "manifest_invalid" };
    const manifest = parsedManifest.value;
    const source = manifest.entries.find((entry) => entry.sourceId === sourceId);
    if (!source) return { kind: "diagnostic", code: "source_missing" };
    const initialQueue = (await runtime.readQueue(bundleId)) as {
      control?: { status: string };
      jobs?: { status: string; sourceId: string }[];
    } | null;
    // A copied history must retain every Review/Manifest/ledger cross-reference. Never prune it to select a source.
    // https://github.com/yydspanda/obsidian-copilot/issues/8
    if (initialQueue?.control?.status !== "paused" || !Array.isArray(initialQueue.jobs)) {
      return { kind: "diagnostic", code: "snapshot_not_paused" };
    }
    if (
      initialQueue.jobs.some((job) => !TERMINAL.has(job.status) && job.status !== "awaiting_review")
    ) {
      return { kind: "diagnostic", code: "snapshot_contains_runnable_or_unsettled_work" };
    }
    if (initialQueue.jobs.some((job) => job.sourceId === sourceId && !TERMINAL.has(job.status))) {
      return { kind: "diagnostic", code: "source_already_active" };
    }

    const liveVault = input.app.vault;
    const adapter = liveVault.adapter;
    const stat: DataAdapter["stat"] = adapter.stat.bind(adapter);
    const read: DataAdapter["read"] = adapter.read.bind(adapter);
    const readBinary: DataAdapter["readBinary"] = adapter.readBinary.bind(adapter);
    const readOnlyApp = Object.freeze({
      vault: Object.freeze({
        adapter: Object.freeze({ stat, read }) as unknown as DataAdapter,
        getAllLoadedFiles: liveVault.getAllLoadedFiles.bind(liveVault),
      }) as unknown as Vault,
    }) as App;
    const allowedPaths = new Set([source.sourcePath, owner.config.schemaRef]);
    const artifactReader: KnowledgeExactArtifactReaderPort = {
      async read(path, signal) {
        if (!current || preparationSignal.signal.aborted || signal?.aborted)
          throw new DOMException("Aborted", "AbortError");
        if (!allowedPaths.has(path)) throw new Error("retest_artifact_out_of_scope");
        const info = await stat(path);
        const limit = path === owner.config.schemaRef ? 1_000_000 : 8_388_608;
        if (info?.type !== "file" || info.size > limit)
          throw new Error("retest_artifact_unavailable");
        const bytes = new Uint8Array(await readBinary(path));
        if (bytes.byteLength > limit) throw new Error("retest_artifact_too_large");
        if (!current || preparationSignal.signal.aborted || signal?.aborted)
          throw new DOMException("Aborted", "AbortError");
        return { sourcePath: path, bytes, sourceContentHash: createSourceContentHash(bytes) };
      },
      async readExpected(path, expectedHash, signal) {
        const artifact = await artifactReader.read(path, signal);
        if (artifact.sourceContentHash !== expectedHash) throw new Error("retest_artifact_changed");
        return artifact;
      },
    };
    phase = "artifacts";
    const sourceArtifact = await artifactReader.read(source.sourcePath);
    const schemaArtifact = await artifactReader.read(owner.config.schemaRef);
    const requests: SafeRequest[] = [];
    let networkReleased = false;
    // Native fetch is necessary here for real AbortSignal cancellation; requestUrl cannot provide it.
    const nativeFetch: typeof window.fetch = window.fetch.bind(window);
    const fetchPort: KnowledgeDeepSeekFetchPort = async (url, init) => {
      if (
        !networkReleased ||
        !current ||
        requests.length >= MAX_REQUESTS ||
        !init.signal ||
        init.signal.aborted
      )
        throw new Error("retest_request_fenced");
      if (
        url !== KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT ||
        init.method !== "POST" ||
        typeof init.body !== "string"
      )
        throw new Error("retest_request_invalid");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (body.model !== DEEPSEEK_FLASH_WIRE_IDENTITY) throw new Error("retest_model_out_of_scope");
      const parameters: Record<string, unknown> = {};
      for (const key of [
        "model",
        "max_tokens",
        "temperature",
        "top_p",
        "thinking",
        "reasoning_effort",
        "response_format",
        "stream",
      ]) {
        if (Object.hasOwn(body, key)) parameters[key] = body[key];
      }
      const record: SafeRequest = {
        stage: requests.length === 0 ? "analysis" : "generation",
        requestedModel: DEEPSEEK_FLASH_WIRE_IDENTITY,
        bodyHash: sha256(init.body),
        modelParametersHash: sha256(JSON.stringify(parameters)),
        requestBytes: new TextEncoder().encode(init.body).byteLength,
        requestStartedAt: Date.now(),
      };
      requests.push(record);
      const controller = new AbortController();
      controllers.push(controller);
      const signal = init.signal;
      const onAbort = (): void => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      unlinkSignals.push(() => signal.removeEventListener("abort", onAbort));
      const response = await nativeFetch(url, { ...init, signal: controller.signal });
      record.headerReceivedAt = Date.now();
      record.responseStatus = response.status;
      // The production transport is the only response consumer. Auxiliary readers can mask its settled failure.
      // https://github.com/yydspanda/obsidian-copilot/issues/8
      return response;
    };
    const resources = createKnowledgeProductionPipelineResources();
    phase = "configured_preflight";
    const prepared = await prepareKnowledgeConfiguredModelPreflight({
      owners: [owner],
      projects: [project],
      modelManagement: input.modelManagement,
      profileOptions: resources.profileOptions,
      fetchPort,
      signal: preparationSignal.signal,
    });
    if (prepared.kind !== "ready") return { ...prepared };
    closeRoute = () => prepared.preflight.close();
    const routeLease = prepared.preflight.getModelRouteLeaseOwner().getLease();
    phase = "workflow_plan";
    const workflowLoader = new KnowledgeSourceWorkflowPlanLoader({
      executionOwner,
      manifest: { load: (id) => manifestStorage.read(id) },
      artifactReader,
      pipelineProfile: prepared.profileSource,
      parsers: resources.parsers,
      generation: { isCurrent: () => current && !preparationSignal.signal.aborted },
    });
    const plan = await workflowLoader.load([owner], preparationSignal.signal);
    const plannedSource = plan.getWatchPlan().getSource(bundleId, sourceId);
    if (!plannedSource) throw new Error("retest_source_not_planned");
    phase = "execution_composition";
    const reviews = new ChangeSetReviewRepository(
      new KnowledgeRuntimeReviewStorage(runtime, executionOwner)
    );
    const handler = new KnowledgeProductionCompileReviewHandler({
      routeLease,
      targetResolver: new ObsidianKnowledgeCompilerTargetResolver(readOnlyApp),
      candidateValidator: new KnowledgeProductionCandidateValidator(),
      reviews,
    });
    const proof = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
    const executor = new KnowledgeProductionPreparationExecutor(plan, proof, handler);
    const jobId = `isolated-retest-${crypto.randomUUID()}`;
    queue = new IngestQueue(queueStorage, executor, {
      jobIdFactory: () => jobId,
      retryPolicy: { decide: () => ({ kind: "fail", reason: "not_retryable" }) },
    });
    const cloneQueue = queue;
    const initialReviews = await reviews.load(bundleId);
    const originalReviewHashes = initialReviews.records.map((record) =>
      sha256(JSON.stringify(record))
    );
    const pipelineProfile = prepared.profileSource.resolve(owner);
    const summary = {
      sourceId,
      sourceContentHash: sourceArtifact.sourceContentHash,
      schemaContentHash: schemaArtifact.sourceContentHash,
      pipelineFingerprint: plannedSource.pipelineFingerprint,
      pipelineProfileHash: sha256(JSON.stringify(pipelineProfile)),
      modelProfileHash: sha256(JSON.stringify(pipelineProfile.model)),
      modelConfigurationHash: sha256(JSON.stringify(pipelineProfile.model.configuration)),
      compilerConfigurationHash: sha256(JSON.stringify(pipelineProfile.compiler.configuration)),
      runtimeSnapshotHash: sha256(input.runtimeText),
      manifestDigest: createSourceManifestDigest(manifest),
      existingReviews: originalReviewHashes.length,
    };
    let queueResult: Awaited<ReturnType<IngestQueue["runNext"]>> | undefined;
    const snapshot = (): Record<string, unknown> =>
      JSON.parse(JSON.stringify({ ...summary, phase, requests, queueResult })) as Record<
        string,
        unknown
      >;
    phase = "prepared";
    session = {
      close: release,
      snapshot,
      used: false,
      async execute() {
        phase = "source_reproof";
        await artifactReader.readExpected(source.sourcePath, sourceArtifact.sourceContentHash);
        await artifactReader.readExpected(owner.config.schemaRef, schemaArtifact.sourceContentHash);
        phase = "enqueue";
        const allocator = new KnowledgeRuntimeInputRevisionAllocator(runtime);
        const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
        const allocation = await allocator.allocate({
          bundleId,
          sourceId,
          captureId: `capture-${crypto.randomUUID()}`,
        });
        const binding = await observations.bind({
          observationToken: allocation.observationToken,
          sourceContentHash: sourceArtifact.sourceContentHash,
          pipelineFingerprint: plannedSource.pipelineFingerprint,
        });
        if (binding.kind !== "ready") return { kind: "diagnostic", code: "observation_not_ready" };
        const enqueued = await cloneQueue.enqueue(binding.observation);
        if (enqueued.kind !== "enqueued" || enqueued.job.id !== jobId)
          return { kind: "diagnostic", code: "single_job_enqueue_failed" };
        await cloneQueue.resume(bundleId);
        const before = await cloneQueue.load(bundleId);
        if (
          before.jobs.filter((job) => job.status === "pending").length !== 1 ||
          !before.jobs.some(
            (job) => job.id === jobId && job.status === "pending" && job.sourceId === sourceId
          )
        )
          return { kind: "diagnostic", code: "single_job_scope_failed" };
        networkReleased = true;
        phase = "queue_execution";
        queueResult = await cloneQueue.runNext(bundleId);
        networkReleased = false;
        phase = "queue_settled";
        const finalQueue = await cloneQueue.load(bundleId);
        const job = finalQueue.jobs.find((entry) => entry.id === jobId);
        const finalReviews = await reviews.load(bundleId);
        const record = finalReviews.records.find((entry) => entry.jobClaim.jobId === jobId);
        const finalManifest = parseSourceManifest(await manifestStorage.read(bundleId));
        return {
          status: job?.status,
          stage: job?.stage,
          failureCode: job?.status === "failed" ? job.failure.code : undefined,
          staticCodes:
            job?.status === "failed" && job.failure.code === "knowledge_compiler_analysis_rejected"
              ? (job.failure.message
                  .match(/\. Checks: ([a-z_]+(?:, [a-z_]+){0,4})\.$/)?.[1]
                  .split(", ") ?? [])
              : [],
          priorReviewsUnchanged: originalReviewHashes.every((hash) =>
            finalReviews.records.some((entry) => sha256(JSON.stringify(entry)) === hash)
          ),
          manifestUnchanged:
            finalManifest.ok &&
            createSourceManifestDigest(finalManifest.value) === summary.manifestDigest,
          targets:
            record?.outcome === "pending"
              ? record.proposal.changes.map((change) => ({
                  path: change.path,
                  operation: change.operation,
                  afterContentHash:
                    "afterContent" in change
                      ? createFileContentHash(change.afterContent)
                      : undefined,
                }))
              : [],
        };
      },
    };
    return {
      kind: "prepared",
      requestCount: 0,
      maxRequests: MAX_REQUESTS,
      timeoutMs: TIMEOUT_MS,
      ...snapshot(),
    };
  } catch {
    return { kind: "diagnostic", code: "prepare_failed", phase };
  } finally {
    preparing = false;
    preparationController = undefined;
    if (!session) release();
  }
}

/** Runs one prepared attempt; a second call cannot reuse its authority or request budget. */
export async function run(): Promise<Record<string, unknown>> {
  const active = session;
  if (!active || active.used) return { kind: "diagnostic", code: "run_not_available" };
  active.used = true;
  const started = Date.now();
  let timer: number | undefined;
  try {
    const timeout = new Promise<Record<string, unknown>>((resolve) => {
      timer = window.setTimeout(() => {
        active.close();
        resolve({ kind: "timeout", code: "retest_deadline" });
      }, TIMEOUT_MS);
    });
    const result = await Promise.race([
      active.execute().catch(() => ({ kind: "diagnostic", code: "run_failed" })),
      timeout,
    ]);
    return {
      ...result,
      kind: result.kind ?? "settled",
      durationMs: Date.now() - started,
      ...active.snapshot(),
    };
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    active.close();
  }
}

/** Releases only the isolated session; a new run requires explicit preparation again. */
export function close(): void {
  preparationController?.abort();
  session?.close();
  session = undefined;
}

/** Optional development-only loader shell; loading never starts preparation, models, or real Queue work. */
export default class KnowledgeAnalysisRetestPlugin extends Plugin {
  readonly api = Object.freeze({ prepare, run, close });
  onload(): void {
    this.register(close);
  }
}
