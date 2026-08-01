import {
  IngestQueue,
  type IngestExecutionContext,
  type IngestExecutionResult,
} from "@/knowledge/ingest/queue/IngestQueue";
import type { RetryPolicy } from "@/knowledge/ingest/queue/RetryPolicy";
import type { SourceManifest } from "@/knowledge/model/types";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";

/** In-memory atomic boundary used by authentic execution-authority tests. */
export class KnowledgeExecutionMemoryRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();

  /** Initializes the memory file without replacing existing bytes. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) this.content = initialContent;
  }

  /** Reads the exact current memory bytes. */
  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("The test Runtime is not initialized");
    return this.content;
  }

  /** Serializes one synchronous atomic transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) throw new Error("The test Runtime is not initialized");
      this.content = transform(this.content);
      return this.content;
    } finally {
      release();
    }
  }

  /** Replaces persisted bytes to exercise fail-closed proof drift and corruption paths. */
  replaceContent(content: string): void {
    this.content = content;
  }

  /** Replaces one Manifest slot while retaining a structurally valid Runtime envelope. */
  async replaceManifest(manifest: SourceManifest): Promise<void> {
    const state = JSON.parse(await this.read()) as KnowledgeRuntimeStoreSnapshot;
    state.revision += 1;
    state.manifests = state.manifests.map((slot) =>
      slot.bundleId === manifest.bundleId ? { bundleId: slot.bundleId, value: manifest } : slot
    );
    this.replaceContent(JSON.stringify(state));
  }
}

/** Inputs needed to create one real Runtime-backed Queue execution attempt. */
export interface KnowledgeExecutionTestHarnessOptions {
  manifest: SourceManifest;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  execute(context: IngestExecutionContext): Promise<IngestExecutionResult>;
  jobId?: string;
  clock?: number;
  executionOwner?: KnowledgeExecutionOwner;
  retryPolicy?: RetryPolicy;
}

/** Real Runtime, Queue, observation, Manifest, and proof capabilities for one test attempt. */
export interface KnowledgeExecutionTestHarness {
  file: KnowledgeExecutionMemoryRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  executionOwner: KnowledgeExecutionOwner;
  queueStorage: KnowledgeRuntimeQueueStorage;
  proofPort: KnowledgeRuntimeIngestExecutionProofPort;
  queue: IngestQueue;
}

/**
 * Creates one authentic Runtime-backed Queue attempt with a consumed observation.
 *
 * @param options - Exact Manifest, source identity, and executor
 * @returns Initialized test capabilities with the job ready to claim
 */
export async function createKnowledgeExecutionTestHarness(
  options: KnowledgeExecutionTestHarnessOptions
): Promise<KnowledgeExecutionTestHarness> {
  const file = new KnowledgeExecutionMemoryRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  const executionOwner = options.executionOwner ?? createKnowledgeExecutionOwner();
  const queueStorage = new KnowledgeRuntimeQueueStorage(runtime, executionOwner);
  const manifestStorage = new KnowledgeRuntimeManifestStorage(runtime);
  await manifestStorage.write(options.manifest.bundleId, options.manifest, null);

  const revisions = new KnowledgeRuntimeInputRevisionAllocator(runtime);
  const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
  const allocation = await revisions.allocate({
    bundleId: options.manifest.bundleId,
    sourceId: options.sourceId,
    captureId: `capture-${options.jobId ?? "execution"}`,
  });
  const binding = await observations.bind({
    observationToken: allocation.observationToken,
    sourceContentHash: options.sourceContentHash,
    pipelineFingerprint: options.pipelineFingerprint,
  });
  if (binding.kind !== "ready") {
    throw new Error("Expected a Queue-ready source observation");
  }

  const queue = new IngestQueue(
    queueStorage,
    { execute: (context) => options.execute(context) },
    {
      clock: () => options.clock ?? 100,
      jobIdFactory: () => options.jobId ?? "job-execution",
      retryPolicy:
        options.retryPolicy ??
        ({ decide: () => ({ kind: "fail", reason: "not_retryable" }) } as const),
    }
  );
  await queue.enqueue(binding.observation);
  return {
    file,
    runtime,
    executionOwner,
    queueStorage,
    proofPort: new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage),
    queue,
  };
}
