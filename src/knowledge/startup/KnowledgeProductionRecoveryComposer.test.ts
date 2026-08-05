jest.mock("obsidian", () => {
  class FileSystemAdapter {
    /** Returns the fake desktop Vault root. */
    getBasePath(): string {
      return "C:\\KnowledgeVault";
    }

    /** Resolves one fake native path without touching the filesystem. */
    getFullPath(path: string): string {
      return `C:\\KnowledgeVault\\${path.replaceAll("/", "\\")}`;
    }
  }

  class TFile {
    /** Creates one fake loaded file. */
    constructor(public readonly path: string) {}
  }

  return { FileSystemAdapter, TFile };
});

import { FileSystemAdapter, TFile, type Vault } from "obsidian";

import { ApplyCommitCoordinator } from "@/knowledge/changeset/ApplyCommitCoordinator";
import { ChangeSetValidator } from "@/knowledge/changeset/ChangeSetValidator";
import { ChangeSetTransaction } from "@/knowledge/changeset/ChangeSetTransaction";
import {
  TRANSACTION_JOURNAL_VERSION,
  createChangeSetTransactionDigest,
  type ChangeSetTransactionJournal,
} from "@/knowledge/changeset/TransactionStorage";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueuePauseReason,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeStartupGate,
  type KnowledgeStartupGateResult,
} from "@/knowledge/recovery/KnowledgeStartupGate";
import { NoJournalApplyRecoveryCoordinator } from "@/knowledge/recovery/NoJournalApplyRecovery";
import { KnowledgeStartupReleaseCoordinator } from "@/knowledge/recovery/KnowledgeStartupRelease";
import { ReviewQueueStartupReconciler } from "@/knowledge/review/ReviewQueueStartupReconciler";
import type { ChangeSetReviewSnapshot } from "@/knowledge/review/ReviewStorage";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeTransactionStorage,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { WindowsExclusiveKnowledgeFileCreator } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import {
  KnowledgeProductionRecoveryComposer,
  type KnowledgeProductionRecoveryState,
} from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";

/** Promise controls used to hold one recovery Gate across lifecycle transitions. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates externally controlled asynchronous work. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Minimal atomic memory file used by the real production Runtime facade graph. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();

  /** Initializes the exact first Runtime bytes once. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) this.content = initialContent;
  }

  /** Returns the exact current Runtime bytes. */
  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("Runtime is not initialized");
    return this.content;
  }

  /** Serializes one atomic plaintext transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) throw new Error("Runtime is not initialized");
      this.content = transform(this.content);
      return this.content;
    } finally {
      release();
    }
  }
}

/** Creates one strict non-overlapping Bundle configuration. */
function createBundle(id = "personal"): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: [`Sources/${id}`],
    wikiRoot: `Wiki/${id}`,
    schemaRef: `Schemas/${id}.md`,
    reviewMode: "always",
  };
}

/** Creates one mocked loaded file while preserving the Obsidian `TFile` runtime brand. */
function createTestTFile(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

/** Creates an in-memory Vault whose exact Wiki I/O remains observable. */
function createVault(): {
  vault: Vault;
  files: Map<string, string>;
  stat: jest.Mock;
  read: jest.Mock;
  process: jest.Mock;
} {
  const files = new Map<string, string>();
  const stat = jest.fn(async (path: string) =>
    files.has(path)
      ? { type: "file", ctime: 1, mtime: 1, size: files.get(path)?.length ?? 0 }
      : null
  );
  const read = jest.fn(async (path: string) => {
    const content = files.get(path);
    if (content === undefined) {
      throw new Error("The fake Wiki file is missing");
    }
    return content;
  });
  const process = jest.fn(async (file: TFile, update: (current: string) => string) => {
    const current = files.get(file.path);
    if (current === undefined) {
      throw new Error("The fake Wiki file is missing");
    }
    const next = update(current);
    files.set(file.path, next);
    return next;
  });
  const vault = {
    adapter: Object.assign(new FileSystemAdapter(), { stat, read }),
    getAbstractFileByPath: jest.fn((path: string) =>
      files.has(path) ? createTestTFile(path) : null
    ),
    process,
  } as unknown as Vault;
  return { vault, files, stat, read, process };
}

const RECOVERY_SOURCE_HASH = "a".repeat(64);
const RECOVERY_PIPELINE_FINGERPRINT = "b".repeat(64);
const RECOVERY_AFTER_CONTENT = "# Recovered durable knowledge\n";

interface AuthorizedRecoveryFixture {
  manifest: SourceManifest;
  journal: ChangeSetTransactionJournal & { phase: "prepared" };
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;
  targetPath: string;
}

/** Builds one exact accepted-review authority set for an interrupted create transaction. */
function createAuthorizedRecoveryFixture(bundle: KnowledgeBundleConfig): AuthorizedRecoveryFixture {
  const sourceId = "source-recovery";
  const sourceRoot = bundle.sourceRoots[0];
  if (!sourceRoot) {
    throw new Error("Expected one recovery source root");
  }
  const targetPath = `${bundle.wikiRoot}/Recovered.md`;
  const afterHash = createFileContentHash(RECOVERY_AFTER_CONTENT);
  const manifest: SourceManifest = {
    version: 1,
    bundleId: bundle.id,
    revision: 1,
    entries: [
      {
        sourceId,
        sourceKey: `${sourceRoot.toLowerCase()}/source-recovery.md`,
        sourcePath: `${sourceRoot}/source-recovery.md`,
        custody: "user_managed",
      },
    ],
  };
  const proposal: KnowledgeChangeSet = {
    id: "changeset-recovery",
    bundleId: bundle.id,
    operation: "ingest",
    sourceRefs: [sourceId],
    changes: [
      {
        id: "change-recovery",
        operation: "create",
        path: targetPath,
        sourceRefs: [sourceId],
        reason: "Recover one already-reviewed page",
        expectedAbsent: true,
        afterContent: RECOVERY_AFTER_CONTENT,
        afterHash,
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
  const accepted: KnowledgeChangeSet = { ...proposal, status: "accepted" };
  const plan: ManifestCommitPlan = {
    version: 1,
    kind: "source_compile",
    bundleId: bundle.id,
    sourceId,
    sourceContentHash: RECOVERY_SOURCE_HASH,
    pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
    inputRevision: 1,
    changeSetId: accepted.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    baseGeneratedPages: [],
    mutations: [
      {
        changeId: accepted.changes[0]?.id ?? "",
        path: targetPath,
        operation: "create",
        access: "create_only",
        ownership: "generated",
        wasTrackedByPrimarySource: false,
      },
    ],
  };
  const planDigest = createManifestCommitPlanDigest(plan);
  const intent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: bundle.id,
    sourceId,
    sourceContentHash: RECOVERY_SOURCE_HASH,
    pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
    inputRevision: 1,
    manifestCommitPlanDigest: planDigest,
    changeSetId: accepted.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: [{ path: targetPath, ownership: "generated", contentHash: afterHash }],
  };
  const intentDigest = createManifestCommitIntentDigest(intent);
  const acceptedDigest = createChangeSetTransactionDigest(accepted);
  const proposalDigest = createChangeSetTransactionDigest(proposal);
  const journal: ChangeSetTransactionJournal & { phase: "prepared" } = {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: "transaction-recovery",
    revision: 0,
    bundleId: bundle.id,
    bundle,
    changeSetId: accepted.id,
    changeSetDigest: acceptedDigest,
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: intentDigest,
    jobClaim: {
      jobId: "job-recovery",
      attempt: 1,
      startedAt: 150,
      sourceId,
      sourceContentHash: RECOVERY_SOURCE_HASH,
      pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    changeSet: accepted,
    targets: [
      {
        changeId: accepted.changes[0]?.id ?? "",
        path: targetPath,
        windowsPathKey: toWindowsPathKey(targetPath),
        operation: "create",
        before: { kind: "missing" },
        after: { kind: "file", content: RECOVERY_AFTER_CONTENT, contentHash: afterHash },
      },
    ],
    phase: "prepared",
    appliedCount: 0,
    createdAt: 200,
    updatedAt: 200,
  };
  const highWatermark = {
    sourceId,
    sourceContentHash: RECOVERY_SOURCE_HASH,
    pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
    inputRevision: 1,
    observedAt: 120,
  };
  const queue: IngestQueueSnapshot = {
    version: INGEST_QUEUE_VERSION,
    bundleId: bundle.id,
    revision: 1,
    control: { status: "running" },
    jobs: [
      {
        id: journal.jobClaim.jobId,
        bundleId: bundle.id,
        sourceId,
        sourceContentHash: RECOVERY_SOURCE_HASH,
        pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 100,
        updatedAt: journal.jobClaim.startedAt,
        status: "processing",
        stage: "applying",
        startedAt: journal.jobClaim.startedAt,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [highWatermark],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
    applyClaim: {
      ...journal.jobClaim,
      reviewedChangeSet: { changeSetId: accepted.id, changeSetDigest: acceptedDigest },
      acceptedReview: {
        proposalDigest,
        recordRevision: 1,
        manifestCommitIntentDigest: intentDigest,
        acceptedAt: 140,
      },
    },
  };
  const review: ChangeSetReviewSnapshot = {
    version: 2,
    bundleId: bundle.id,
    revision: 1,
    records: [
      {
        changeSetId: accepted.id,
        proposal,
        proposalDigest,
        manifestCommitPlan: plan,
        manifestCommitPlanDigest: planDigest,
        jobClaim: {
          jobId: journal.jobClaim.jobId,
          sourceId,
          sourceContentHash: RECOVERY_SOURCE_HASH,
          pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
          inputRevision: 1,
          attempt: 1,
        },
        recordedAt: 120,
        outcome: "accepted",
        recordRevision: 1,
        acceptedChangeSet: accepted,
        acceptedDigest,
        manifestCommitIntent: intent,
        manifestCommitIntentDigest: intentDigest,
        acceptedAt: 140,
      },
    ],
  };
  return { manifest, journal, queue, review, targetPath };
}

/** Persists one fully authorized interrupted journal through real Runtime facades. */
async function createAuthorizedRecoveryHarness(): Promise<{
  runtime: KnowledgeRuntimeStore;
  transaction: KnowledgeRuntimeTransactionStorage;
  manifest: KnowledgeRuntimeManifestStorage;
  queue: KnowledgeRuntimeQueueStorage;
  bundle: KnowledgeBundleConfig;
  fixture: AuthorizedRecoveryFixture;
  vault: ReturnType<typeof createVault>;
}> {
  const file = new MemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  const bundle = createBundle();
  const fixture = createAuthorizedRecoveryFixture(bundle);
  const manifest = new KnowledgeRuntimeManifestStorage(runtime);
  const queue = new KnowledgeRuntimeQueueStorage(runtime);
  const review = new KnowledgeRuntimeReviewStorage(runtime);
  const transaction = new KnowledgeRuntimeTransactionStorage(runtime);
  const revisions = new KnowledgeRuntimeInputRevisionAllocator(runtime);
  const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
  await manifest.write(bundle.id, fixture.manifest, null);
  const allocation = await revisions.allocate({
    bundleId: bundle.id,
    sourceId: fixture.journal.jobClaim.sourceId,
    captureId: "capture-authorized-recovery",
  });
  const binding = await observations.bind({
    observationToken: allocation.observationToken,
    sourceContentHash: fixture.journal.jobClaim.sourceContentHash,
    pipelineFingerprint: fixture.journal.jobClaim.pipelineFingerprint,
  });
  if (binding.kind !== "ready" || allocation.inputRevision !== 1) {
    throw new Error("Expected one Queue-ready recovery observation");
  }
  await queue.write(bundle.id, fixture.queue, null, {
    kind: "source_observation",
    observationToken: allocation.observationToken,
  });
  await review.write(bundle.id, fixture.review, null);
  await transaction.writeActive(fixture.journal, null);
  return { runtime, transaction, manifest, queue, bundle, fixture, vault: createVault() };
}

/** Creates one initialized Runtime and a recovery composer over strict Bundle values. */
async function createHarness(bundles: KnowledgeBundleConfig[] = [createBundle()]): Promise<{
  file: MemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  composer: KnowledgeProductionRecoveryComposer;
  vault: ReturnType<typeof createVault>;
}> {
  const file = new MemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  const vault = createVault();
  return {
    file,
    runtime,
    composer: new KnowledgeProductionRecoveryComposer({ runtime, vault: vault.vault, bundles }),
    vault,
  };
}

/** Creates one source-bearing Queue safely paused before an applying boundary. */
function createPausedQueue(
  bundleId: string,
  reason: Extract<IngestQueuePauseReason, "user" | "rate_limit" | "startup_recovery">
): IngestQueueSnapshot {
  const sourceId = "source-paused-at-startup";
  const createdAt = 100;
  const pausedAt = 110;
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision: 1,
    control: {
      status: "paused",
      reason,
      pausedAt,
      ...(reason === "rate_limit" ? { resumeAt: pausedAt + 1_000 } : {}),
    },
    jobs: [
      {
        id: "job-paused-at-startup",
        bundleId,
        sourceId,
        sourceContentHash: RECOVERY_SOURCE_HASH,
        pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt,
        updatedAt: pausedAt,
        status: "paused",
        stage: "generating",
        pausedAt,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId,
        sourceContentHash: RECOVERY_SOURCE_HASH,
        pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
        inputRevision: 1,
        observedAt: createdAt,
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

/** Creates one exact interrupted-apply Queue behind its sticky recovery gate. */
function createRecoveryRequiredQueue(bundleId: string): IngestQueueSnapshot {
  const sourceId = "source-interrupted-apply";
  const createdAt = 100;
  const startedAt = 105;
  const failedAt = 110;
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision: 1,
    control: { status: "paused", reason: "recovery_required", pausedAt: failedAt },
    jobs: [
      {
        id: "job-interrupted-apply",
        bundleId,
        sourceId,
        sourceContentHash: RECOVERY_SOURCE_HASH,
        pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt,
        updatedAt: failedAt,
        status: "failed",
        stage: "applying",
        failure: {
          code: "interrupted_apply_requires_recovery",
          message: "Interrupted apply requires recovery",
          retryable: false,
          occurredAt: failedAt,
        },
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId,
        sourceContentHash: RECOVERY_SOURCE_HASH,
        pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
        inputRevision: 1,
        observedAt: createdAt,
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
    applyClaim: {
      jobId: "job-interrupted-apply",
      sourceId,
      sourceContentHash: RECOVERY_SOURCE_HASH,
      pipelineFingerprint: RECOVERY_PIPELINE_FINGERPRINT,
      inputRevision: 1,
      attempt: 1,
      startedAt,
    },
  };
}

/** Persists a source-bearing Queue through the real Runtime observation authority. */
async function writeObservedQueue(
  runtime: KnowledgeRuntimeStore,
  snapshot: IngestQueueSnapshot
): Promise<void> {
  const job = snapshot.jobs[0];
  if (!job) throw new Error("Expected one source-bearing Queue job");
  const allocation = await new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
    bundleId: snapshot.bundleId,
    sourceId: job.sourceId,
    captureId: "capture-paused-at-startup",
  });
  const binding = await new KnowledgeRuntimeInputObservationBinder(runtime).bind({
    observationToken: allocation.observationToken,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
  });
  if (binding.kind !== "ready" || allocation.inputRevision !== job.inputRevision) {
    throw new Error("Expected one Queue-ready paused startup observation");
  }
  await new KnowledgeRuntimeQueueStorage(runtime).write(snapshot.bundleId, snapshot, null, {
    kind: "source_observation",
    observationToken: allocation.observationToken,
  });
}

/** Creates the minimum Gate result consumed by the sanitizing composer boundary. */
function createGateResult(
  bundleId: string,
  disposition: KnowledgeStartupGateResult["disposition"] = "observed_clear"
): KnowledgeStartupGateResult {
  const attention =
    disposition === "observed_clear"
      ? []
      : disposition === "attention_required"
        ? [
            {
              kind: "accepted_not_started" as const,
              jobId: "job-private",
              changeSetId: "changeset-private",
            },
          ]
        : [{ kind: "queue_recovery_required" as const }];
  return {
    bundleId,
    disposition,
    runtimeRevision: 0,
    reviewRevision: 0,
    queueSnapshot: {
      version: 5,
      bundleId,
      revision: 0,
      control:
        disposition === "blocked"
          ? { status: "paused", reason: "recovery_required", pausedAt: 0 }
          : { status: "running" },
      jobs: [],
      reruns: [],
      sourceHighWatermarks: [],
      pendingReviews: [],
      reviewRejections: [],
      applyAbandonments: [],
    },
    globalTransaction: null,
    applyCommit: { kind: "none" },
    reviewReconciliations: [],
    acceptedClassifications:
      disposition === "attention_required"
        ? [
            {
              kind: "accepted_not_started",
              reference: { bundleId, recoveryId: "recovery-private" },
              bundleId,
              changeSetId: "changeset-private",
              jobId: "job-private",
            },
          ]
        : [],
    attention,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KnowledgeProductionRecoveryComposer", () => {
  it("runs the real Runtime-backed Gate without worker, release, decisions, or Wiki I/O", async () => {
    const runNext = jest.spyOn(IngestQueue.prototype, "runNext");
    const resume = jest.spyOn(IngestQueue.prototype, "resume");
    const apply = jest.spyOn(ChangeSetTransaction.prototype, "apply");
    const prepare = jest.spyOn(ChangeSetValidator.prototype, "prepare");
    const release = jest.spyOn(KnowledgeStartupReleaseCoordinator.prototype, "release");
    const continueApply = jest.spyOn(NoJournalApplyRecoveryCoordinator.prototype, "continue");
    const abandon = jest.spyOn(NoJournalApplyRecoveryCoordinator.prototype, "abandon");
    const { composer, vault } = await createHarness([createBundle("zeta"), createBundle("alpha")]);

    await composer.start();

    expect(composer.getState()).toEqual({
      generation: 1,
      status: "observed_clear",
      bundleResults: [
        { bundleId: "alpha", disposition: "observed_clear", attentionKinds: [] },
        { bundleId: "zeta", disposition: "observed_clear", attentionKinds: [] },
      ],
    });
    expect(runNext).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(continueApply).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(vault.stat).not.toHaveBeenCalled();
    expect(vault.read).not.toHaveBeenCalled();
    expect(vault.process).not.toHaveBeenCalled();
    expect(Object.isFrozen(composer.getState())).toBe(true);
    const state = composer.getState();
    if (state.status === "observed_clear") {
      expect(Object.isFrozen(state.bundleResults)).toBe(true);
      expect(Object.isFrozen(state.bundleResults[0])).toBe(true);
      expect(Object.isFrozen(state.bundleResults[0].attentionKinds)).toBe(true);
    }
  });

  it.each([
    { pauseReason: "user" as const, releaseReason: "user_pause_preserved" as const },
    {
      pauseReason: "rate_limit" as const,
      releaseReason: "rate_limit_pause_preserved" as const,
    },
  ])(
    "accepts a safely preserved $pauseReason pause without changing Runtime or Queue bytes",
    async ({ pauseReason, releaseReason }) => {
      const { file, runtime, composer } = await createHarness();
      const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
      const queue = createPausedQueue("personal", pauseReason);
      await writeObservedQueue(runtime, queue);

      await composer.start();
      expect(composer.getState()).toMatchObject({
        status: "observed_clear",
        bundleResults: [{ bundleId: "personal", disposition: "observed_clear" }],
      });
      const runtimeBytesBeforeRelease = await file.read();
      const queueBeforeRelease = await queueStorage.read("personal");
      const release = jest.spyOn(runtime, "releaseStartupRecovery");

      await expect(composer.releaseFresh(jest.fn())).resolves.toEqual({
        kind: "released",
        bundleIds: ["personal"],
      });

      expect(release).toHaveBeenCalledTimes(1);
      const releaseResult = release.mock.results[0];
      if (!releaseResult || releaseResult.type !== "return") {
        throw new Error("Expected one real Runtime startup release result");
      }
      await expect(releaseResult.value).resolves.toMatchObject({
        kind: "unchanged",
        bundleId: "personal",
        reason: releaseReason,
        queueSnapshot: queue,
      });
      await expect(file.read()).resolves.toBe(runtimeBytesBeforeRelease);
      await expect(queueStorage.read("personal")).resolves.toEqual(queueBeforeRelease);
      expect(composer.getState()).toMatchObject({ status: "observed_clear" });
    }
  );

  it("keeps a real recovery-required Queue blocked without entering atomic release", async () => {
    const { file, runtime, composer } = await createHarness();
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    await writeObservedQueue(runtime, createRecoveryRequiredQueue("personal"));
    const runtimeBytesBeforeRecovery = await file.read();
    const queueBeforeRecovery = await queueStorage.read("personal");

    await composer.start();
    expect(composer.getState()).toMatchObject({
      status: "blocked",
      stoppedBundleId: "personal",
      bundleResults: [
        {
          bundleId: "personal",
          disposition: "blocked",
          attentionKinds: ["queue_recovery_required"],
        },
      ],
    });
    const release = jest.spyOn(runtime, "releaseStartupRecovery");

    await expect(composer.releaseFresh(jest.fn())).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
    });

    expect(release).not.toHaveBeenCalled();
    await expect(file.read()).resolves.toBe(runtimeBytesBeforeRecovery);
    await expect(queueStorage.read("personal")).resolves.toEqual(queueBeforeRecovery);
  });

  it("keeps a startup-recovery pause with a retained paused job blocked atomically", async () => {
    const { file, runtime, composer } = await createHarness();
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    await writeObservedQueue(runtime, createPausedQueue("personal", "startup_recovery"));

    await composer.start();
    expect(composer.getState()).toMatchObject({
      status: "observed_clear",
      bundleResults: [{ bundleId: "personal", disposition: "observed_clear" }],
    });
    const runtimeBytesBeforeRelease = await file.read();
    const queueBeforeRelease = await queueStorage.read("personal");
    const release = jest.spyOn(runtime, "releaseStartupRecovery");

    await expect(composer.releaseFresh(jest.fn())).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
    });

    expect(release).toHaveBeenCalledTimes(1);
    const releaseResult = release.mock.results[0];
    if (!releaseResult || releaseResult.type !== "return") {
      throw new Error("Expected one real Runtime startup release result");
    }
    await expect(releaseResult.value).resolves.toMatchObject({
      kind: "blocked",
      bundleId: "personal",
      reason: "paused_job_present",
    });
    await expect(file.read()).resolves.toBe(runtimeBytesBeforeRelease);
    await expect(queueStorage.read("personal")).resolves.toEqual(queueBeforeRelease);
  });

  it("rolls forward and finalizes one real authorized prepared journal", async () => {
    const harness = await createAuthorizedRecoveryHarness();
    const creator = jest
      .spyOn(WindowsExclusiveKnowledgeFileCreator.prototype, "create")
      .mockImplementation(async (path, content) => {
        if (harness.vault.files.has(path)) return "exists";
        harness.vault.files.set(path, content);
        return "created";
      });
    const composer = new KnowledgeProductionRecoveryComposer({
      runtime: harness.runtime,
      vault: harness.vault.vault,
      bundles: [harness.bundle],
    });

    await composer.start();

    expect(composer.getState()).toMatchObject({
      generation: 1,
      status: "observed_clear",
      bundleResults: [{ bundleId: harness.bundle.id, disposition: "observed_clear" }],
    });
    expect(creator).toHaveBeenCalledTimes(1);
    expect(harness.vault.files.get(harness.fixture.targetPath)).toBe(RECOVERY_AFTER_CONTENT);
    await expect(harness.transaction.readActive()).resolves.toBeNull();
    await expect(harness.queue.read(harness.bundle.id)).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [{ id: harness.fixture.journal.jobClaim.jobId, status: "completed" }],
    });
    await expect(harness.manifest.read(harness.bundle.id)).resolves.toMatchObject({
      revision: harness.fixture.manifest.revision + 1,
      entries: [
        {
          sourceId: harness.fixture.journal.jobClaim.sourceId,
          lastSuccessful: {
            generatedPages: [
              {
                path: harness.fixture.targetPath,
                contentHash: createFileContentHash(RECOVERY_AFTER_CONTENT),
              },
            ],
          },
        },
      ],
    });
  });

  it("persists a real recovery conflict without overwriting the existing Wiki file", async () => {
    const harness = await createAuthorizedRecoveryHarness();
    const conflictingContent = "# External user edit\n";
    harness.vault.files.set(harness.fixture.targetPath, conflictingContent);
    const creator = jest.spyOn(WindowsExclusiveKnowledgeFileCreator.prototype, "create");
    const composer = new KnowledgeProductionRecoveryComposer({
      runtime: harness.runtime,
      vault: harness.vault.vault,
      bundles: [harness.bundle],
    });

    await composer.start();

    expect(composer.getState()).toMatchObject({
      generation: 1,
      status: "blocked",
      stoppedBundleId: harness.bundle.id,
    });
    expect(harness.vault.files.get(harness.fixture.targetPath)).toBe(conflictingContent);
    expect(creator).not.toHaveBeenCalled();
    expect(harness.vault.process).not.toHaveBeenCalled();
    await expect(harness.transaction.readActive()).resolves.toMatchObject({
      phase: "recovery_required",
      conflicts: [{ path: harness.fixture.targetPath, code: "file_state_conflict" }],
    });
  });

  it("captures detached Bundle values and ignores caller mutation after construction", async () => {
    const mutable = createBundle("captured");
    const { composer } = await createHarness([mutable]);
    mutable.id = "mutated";
    mutable.sourceRoots[0] = "Private/Changed";

    await composer.start();

    expect(composer.getState()).toMatchObject({
      status: "observed_clear",
      bundleResults: [{ bundleId: "captured" }],
    });
    expect(JSON.stringify(composer.getState())).not.toContain("Private/Changed");
  });

  it("runs the Vault-global active transaction owner before lexical Bundle order", async () => {
    const { composer } = await createHarness([createBundle("alpha"), createBundle("zeta")]);
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue({
      bundleId: "zeta",
    } as never);
    const order: string[] = [];
    jest.spyOn(KnowledgeStartupGate.prototype, "run").mockImplementation(async (bundle) => {
      const bundleId = (bundle as KnowledgeBundleConfig).id;
      order.push(bundleId);
      return createGateResult(bundleId);
    });

    await composer.start();

    expect(order).toEqual(["zeta", "alpha"]);
    expect(composer.getState()).toMatchObject({
      status: "observed_clear",
      bundleResults: [{ bundleId: "zeta" }, { bundleId: "alpha" }],
    });
  });

  it("fails closed without running any Gate when the active owner is not configured", async () => {
    const rawOwner = "C:\\private\\missing-bundle";
    const { composer } = await createHarness([createBundle("personal")]);
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue({
      bundleId: rawOwner,
    } as never);
    const gate = jest.spyOn(KnowledgeStartupGate.prototype, "run");

    await composer.start();

    expect(composer.getState()).toEqual({
      generation: 1,
      status: "diagnostic",
      code: "active_transaction_owner_unconfigured",
    });
    expect(gate).not.toHaveBeenCalled();
    expect(JSON.stringify(composer.getState())).not.toContain(rawOwner);
  });

  it("sanitizes an unreadable active transaction before any per-Bundle Gate runs", async () => {
    const rawFailure = "C:\\private\\runtime.json contains private journal bytes";
    const { composer } = await createHarness();
    jest
      .spyOn(ChangeSetTransaction.prototype, "loadActive")
      .mockRejectedValue(new Error(rawFailure));
    const gate = jest.spyOn(KnowledgeStartupGate.prototype, "run");

    await composer.start();

    expect(composer.getState()).toEqual({
      generation: 1,
      status: "diagnostic",
      code: "runtime_state_invalid",
    });
    expect(gate).not.toHaveBeenCalled();
    expect(JSON.stringify(composer.getState())).not.toContain(rawFailure);
  });

  it.each(["attention_required", "blocked"] as const)(
    "stops the global sequence when the owner reports %s",
    async (disposition) => {
      const { composer } = await createHarness([createBundle("alpha"), createBundle("zeta")]);
      jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue({
        bundleId: "zeta",
      } as never);
      const gate = jest
        .spyOn(KnowledgeStartupGate.prototype, "run")
        .mockResolvedValue(createGateResult("zeta", disposition));

      await composer.start();

      expect(gate).toHaveBeenCalledTimes(1);
      expect(composer.getState()).toEqual({
        generation: 1,
        status: disposition,
        stoppedBundleId: "zeta",
        bundleResults: [
          {
            bundleId: "zeta",
            disposition,
            attentionKinds: [
              disposition === "attention_required"
                ? "accepted_not_started"
                : "queue_recovery_required",
            ],
          },
        ],
      });
      expect(JSON.stringify(composer.getState())).not.toContain("job-private");
      expect(JSON.stringify(composer.getState())).not.toContain("changeset-private");
      const studio = composer.getStudioObservation("zeta");
      expect(studio).toMatchObject({
        bundleId: "zeta",
        recovery: {
          items: [
            {
              status:
                disposition === "attention_required"
                  ? "accepted_not_started"
                  : "queue_recovery_required",
            },
          ],
        },
      });
      expect(Object.isFrozen(studio)).toBe(true);
      expect(Object.isFrozen(studio?.activity)).toBe(true);
      expect(Object.isFrozen(studio?.recovery.items)).toBe(true);
    }
  );

  it("serializes reruns and prevents an older generation from publishing stale completion", async () => {
    const { composer } = await createHarness();
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue(null);
    const firstGate = createDeferred<KnowledgeStartupGateResult>();
    const firstStarted = createDeferred<void>();
    const gate = jest
      .spyOn(KnowledgeStartupGate.prototype, "run")
      .mockImplementationOnce(async () => {
        firstStarted.resolve(undefined);
        return firstGate.promise;
      })
      .mockResolvedValueOnce(createGateResult("personal"));
    const publications: KnowledgeProductionRecoveryState[] = [];
    composer.subscribe(() => publications.push(composer.getState()));

    const stale = composer.start();
    await firstStarted.promise;
    const current = composer.start();
    expect(composer.getState()).toMatchObject({ generation: 2, status: "recovering" });
    expect(gate).toHaveBeenCalledTimes(1);

    firstGate.resolve(createGateResult("personal", "blocked"));
    await stale;
    await current;

    expect(gate).toHaveBeenCalledTimes(2);
    expect(composer.getState()).toEqual({
      generation: 2,
      status: "observed_clear",
      bundleResults: [{ bundleId: "personal", disposition: "observed_clear", attentionKinds: [] }],
    });
    const generationTwoIndex = publications.findIndex((state) => state.generation === 2);
    expect(
      publications
        .slice(generationTwoIndex)
        .some((state) => state.generation === 1 && state.status !== "recovering")
    ).toBe(false);
  });

  it("closes permanently and suppresses completion from in-flight recovery", async () => {
    const { composer } = await createHarness();
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue(null);
    const gateResult = createDeferred<KnowledgeStartupGateResult>();
    const gateStarted = createDeferred<void>();
    jest.spyOn(KnowledgeStartupGate.prototype, "run").mockImplementation(async () => {
      gateStarted.resolve(undefined);
      return gateResult.promise;
    });
    const publications: KnowledgeProductionRecoveryState[] = [];
    composer.subscribe(() => publications.push(composer.getState()));

    const recovery = composer.start();
    await gateStarted.promise;
    composer.close();
    gateResult.resolve(createGateResult("personal"));
    await recovery;
    await composer.start();

    expect(composer.getState()).toEqual({ generation: 2, status: "closed" });
    expect(publications.at(-1)).toEqual({ generation: 2, status: "closed" });
    expect(publications.filter((state) => state.status === "observed_clear")).toEqual([]);
  });

  it("re-proves generation after Queue recovery before starting apply reconciliation", async () => {
    const { composer, vault } = await createHarness();
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue(null);
    const queueStarted = createDeferred<void>();
    const queueRecovery = createDeferred<KnowledgeStartupGateResult["queueSnapshot"]>();
    jest.spyOn(IngestQueue.prototype, "recoverOnStartup").mockImplementation(async () => {
      queueStarted.resolve(undefined);
      return queueRecovery.promise;
    });
    const applyReconciliation = jest.spyOn(ApplyCommitCoordinator.prototype, "reconcile");

    const recovery = composer.start();
    await queueStarted.promise;
    composer.close();
    queueRecovery.resolve(createGateResult("personal").queueSnapshot);
    await recovery;

    expect(applyReconciliation).not.toHaveBeenCalled();
    expect(composer.getState()).toEqual({ generation: 2, status: "closed" });
    expect(vault.stat).not.toHaveBeenCalled();
    expect(vault.read).not.toHaveBeenCalled();
    expect(vault.process).not.toHaveBeenCalled();
  });

  it("lets an entered apply reconciliation finish but starts no later recovery phase after close", async () => {
    const { composer } = await createHarness();
    jest.spyOn(ChangeSetTransaction.prototype, "loadActive").mockResolvedValue(null);
    const applyStarted = createDeferred<void>();
    const applyResult = createDeferred<{ kind: "none" }>();
    const applyReconciliation = jest
      .spyOn(ApplyCommitCoordinator.prototype, "reconcile")
      .mockImplementation(async () => {
        applyStarted.resolve(undefined);
        return applyResult.promise;
      });
    const reviewReconciliation = jest.spyOn(ReviewQueueStartupReconciler.prototype, "reconcile");

    const recovery = composer.start();
    await applyStarted.promise;
    composer.close();
    applyResult.resolve({ kind: "none" });
    await recovery;

    expect(applyReconciliation).toHaveBeenCalledTimes(1);
    expect(reviewReconciliation).not.toHaveBeenCalled();
    expect(composer.getState()).toEqual({ generation: 2, status: "closed" });
  });

  it("isolates listener failures so recovery and later observers still complete", async () => {
    const { composer } = await createHarness();
    const laterListener = jest.fn();
    composer.subscribe(() => {
      throw new Error("untrusted observer failure");
    });
    composer.subscribe(laterListener);

    await expect(composer.start()).resolves.toBeUndefined();

    expect(laterListener).toHaveBeenCalledTimes(2);
    expect(composer.getState()).toMatchObject({ status: "observed_clear" });
  });

  it("publishes only a static diagnostic for malformed Bundle input", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const runtime = new KnowledgeRuntimeStore(file);
    await runtime.initialize();
    const { vault } = createVault();
    const rawPath = "C:\\private\\schema.md";
    const composer = new KnowledgeProductionRecoveryComposer({
      runtime,
      vault,
      bundles: [{ ...createBundle(), schemaRef: rawPath }],
    });

    await composer.start();

    expect(composer.getState()).toEqual({
      generation: 1,
      status: "diagnostic",
      code: "input_invalid",
    });
    expect(JSON.stringify(composer.getState())).not.toContain(rawPath);
  });
});
