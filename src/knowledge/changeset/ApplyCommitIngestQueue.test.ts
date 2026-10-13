import {
  ApplyCommitCoordinator,
  type ApplyCommitManifestPort,
  type ApplyCommitQueuePort,
  type ApplyCommitTransactionPort,
  type CommittedChangeSetTransactionJournal,
} from "@/knowledge/changeset/ApplyCommitCoordinator";
import type {
  TransactionCommitReceipt,
  TransactionRecoveryResult,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  TRANSACTION_JOURNAL_VERSION,
  createChangeSetTransactionDigest,
  type ChangeSetTransactionJournal,
} from "@/knowledge/changeset/TransactionStorage";
import {
  IngestQueue,
  type IngestExecutionContext,
  type IngestExecutionResult,
  type IngestExecutor,
  type RunNextResult,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  IngestQueueRevisionConflictError,
  type IngestApplyCommitMarker,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeIngestJob,
  SourceManifest,
} from "@/knowledge/model/types";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-1";
const SOURCE_CONTENT_HASH = "a".repeat(64);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const INPUT_REVISION = 7;
const JOB_ID = "job-1";
const TRANSACTION_ID = "transaction-1";
const CHANGE_SET_ID = "changeset-1";
const PAGE_CONTENT = "# Generated page\n";
const PAGE_HASH = createFileContentHash(PAGE_CONTENT);

type CoordinationOperation =
  | "transaction.recover"
  | "transaction.load"
  | "queue.verify"
  | "manifest.record"
  | "queue.resolve"
  | "transaction.ack"
  | "queue.get_pending"
  | "queue.finalize";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

function createChangeSet(): KnowledgeChangeSet {
  return {
    id: CHANGE_SET_ID,
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes: [
      {
        id: "change-1",
        operation: "create",
        path: "Wiki/Generated page.md",
        sourceRefs: [SOURCE_ID],
        reason: "Create a generated knowledge page",
        expectedAbsent: true,
        afterContent: PAGE_CONTENT,
        afterHash: PAGE_HASH,
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

function createManifestCommitIntent(changeSet: KnowledgeChangeSet): ManifestCommitIntent {
  const manifest: SourceManifest = {
    version: 1,
    bundleId: changeSet.bundleId,
    revision: 0,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourceKey: "sources/source.md",
        sourcePath: "Sources/source.md",
        custody: "user_managed",
      },
    ],
  };
  return {
    version: 1,
    kind: "source_compile",
    bundleId: changeSet.bundleId,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: INPUT_REVISION,
    manifestCommitPlanDigest: "c".repeat(64),
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: [
      { path: "Wiki/Generated page.md", ownership: "generated", contentHash: PAGE_HASH },
    ],
  };
}

function createCommittedJournal(
  job: Readonly<Extract<KnowledgeIngestJob, { status: "processing" }>>,
  bundle: KnowledgeBundleConfig
): CommittedChangeSetTransactionJournal {
  const changeSet = createChangeSet();
  const manifestCommitIntent = createManifestCommitIntent(changeSet);
  return {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: TRANSACTION_ID,
    revision: 3,
    bundleId: bundle.id,
    bundle,
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    jobClaim: {
      jobId: job.id,
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
      attempt: job.attempt,
      startedAt: job.startedAt,
    },
    changeSet,
    targets: [
      {
        changeId: "change-1",
        path: "Wiki/Generated page.md",
        windowsPathKey: "wiki/generated page.md",
        operation: "create",
        before: { kind: "missing" },
        after: { kind: "file", content: PAGE_CONTENT, contentHash: PAGE_HASH },
      },
    ],
    appliedCount: 1,
    createdAt: job.startedAt,
    updatedAt: job.startedAt + 10,
    phase: "committed",
    committedAt: job.startedAt + 10,
  };
}

function createReceipt(journal: CommittedChangeSetTransactionJournal): TransactionCommitReceipt {
  return {
    transactionId: journal.transactionId,
    commitRevision: journal.revision,
    bundleId: journal.bundleId,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    jobClaim: { ...journal.jobClaim },
    committedAt: journal.committedAt,
    targets: journal.targets.map((target) =>
      target.after.kind === "missing"
        ? { path: target.path, kind: "missing" as const }
        : {
            path: target.path,
            kind: "file" as const,
            contentHash: target.after.contentHash,
          }
    ),
  };
}

interface CommittedTransactionState {
  active: CommittedChangeSetTransactionJournal | null;
}

class MemoryQueueStorage implements QueueStorage {
  private readonly snapshots = new Map<string, IngestQueueSnapshot>();
  writeAttempts = 0;
  failAtWriteAttempt?: number;

  async read(bundleId: string): Promise<unknown> {
    const snapshot = this.snapshots.get(bundleId);
    return snapshot ? cloneJson(snapshot) : null;
  }

  async write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    this.writeAttempts += 1;
    if (this.writeAttempts === this.failAtWriteAttempt) {
      throw new Error("simulated queue storage failure");
    }
    const current = this.snapshots.get(bundleId);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    this.snapshots.set(bundleId, cloneJson(snapshot));
  }
}

class CommitReadyExecutor implements IngestExecutor {
  lastReceipt?: TransactionCommitReceipt;

  constructor(
    private readonly bundle: KnowledgeBundleConfig,
    private readonly transactionState: CommittedTransactionState
  ) {}

  async execute(context: IngestExecutionContext): Promise<IngestExecutionResult> {
    await context.reportStage("applying");
    const journal = createCommittedJournal(context.job, this.bundle);
    const receipt = createReceipt(journal);
    this.transactionState.active = cloneJson(journal);
    this.lastReceipt = cloneJson(receipt);
    return { kind: "completed", changeSetId: CHANGE_SET_ID, commitReceipt: receipt };
  }
}

class MemoryTransactionPort implements ApplyCommitTransactionPort {
  constructor(
    private readonly state: CommittedTransactionState,
    private readonly operations: CoordinationOperation[]
  ) {}

  async recoverOnStartup(_bundle: KnowledgeBundleConfig): Promise<TransactionRecoveryResult> {
    this.operations.push("transaction.recover");
    const active = this.state.active;
    return active
      ? { kind: "committed", action: "already_committed", receipt: createReceipt(active) }
      : { kind: "none" };
  }

  async loadActive(): Promise<ChangeSetTransactionJournal | null> {
    this.operations.push("transaction.load");
    return this.state.active ? cloneJson(this.state.active) : null;
  }

  async acknowledgeCommitted(receipt: TransactionCommitReceipt): Promise<boolean> {
    this.operations.push("transaction.ack");
    if (!this.state.active || this.state.active.transactionId !== receipt.transactionId) {
      return false;
    }
    this.state.active = null;
    return true;
  }
}

class ObservedQueuePort implements ApplyCommitQueuePort {
  constructor(
    private readonly queue: IngestQueue,
    private readonly operations: CoordinationOperation[]
  ) {}

  async verifyApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    this.operations.push("queue.verify");
    return this.queue.verifyApplyRecovery(receipt);
  }

  async resolveApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    this.operations.push("queue.resolve");
    return this.queue.resolveApplyRecovery(receipt);
  }

  async getPendingApplyCommit(bundleId: string): Promise<IngestApplyCommitMarker | null> {
    this.operations.push("queue.get_pending");
    return this.queue.getPendingApplyCommit(bundleId);
  }

  async finalizeApplyRecovery(
    bundleId: string,
    transactionId: string
  ): Promise<IngestQueueSnapshot> {
    this.operations.push("queue.finalize");
    return this.queue.finalizeApplyRecovery(bundleId, transactionId);
  }
}

class ProbingManifestPort implements ApplyCommitManifestPort {
  failOnce = false;
  attempts = 0;
  durableWrites = 0;

  constructor(
    private readonly queue: IngestQueue,
    private readonly operations: CoordinationOperation[]
  ) {}

  async recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    _receipt: TransactionCommitReceipt
  ): Promise<void> {
    expect(this.operations[this.operations.length - 1]).toBe("queue.verify");
    this.operations.push("manifest.record");
    this.attempts += 1;
    const snapshot = await this.queue.load(journal.bundleId);
    expect(snapshot.applyCommit).toBeUndefined();
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      id: journal.jobClaim.jobId,
      sourceId: journal.jobClaim.sourceId,
      sourceContentHash: journal.jobClaim.sourceContentHash,
      pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
      inputRevision: journal.jobClaim.inputRevision,
      attempt: journal.jobClaim.attempt,
      startedAt: journal.jobClaim.startedAt,
      status: "processing",
      stage: "applying",
    });
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("simulated manifest failure");
    }
    this.durableWrites = 1;
  }
}

interface CommitReadyHarness {
  bundle: KnowledgeBundleConfig;
  storage: MemoryQueueStorage;
  queue: IngestQueue;
  transactionState: CommittedTransactionState;
  manifest: ProbingManifestPort;
  coordinator: ApplyCommitCoordinator;
  operations: CoordinationOperation[];
  runResult: RunNextResult;
  receipt: TransactionCommitReceipt;
}

async function createCommitReadyHarness(): Promise<CommitReadyHarness> {
  const bundle = createBundle();
  const transactionState: CommittedTransactionState = { active: null };
  const operations: CoordinationOperation[] = [];
  const executor = new CommitReadyExecutor(bundle, transactionState);
  const storage = new MemoryQueueStorage();
  const queue = new IngestQueue(storage, executor, {
    clock: () => 1_000,
    jobIdFactory: () => JOB_ID,
  });
  await queue.enqueue({
    bundleId: bundle.id,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: INPUT_REVISION,
  });
  const runResult = await queue.runNext(bundle.id);
  if (!executor.lastReceipt) {
    throw new Error("Commit-ready executor did not publish a receipt");
  }
  const transaction = new MemoryTransactionPort(transactionState, operations);
  const manifest = new ProbingManifestPort(queue, operations);
  const coordinator = new ApplyCommitCoordinator({
    transaction,
    queue: new ObservedQueuePort(queue, operations),
    manifest,
  });
  return {
    bundle,
    storage,
    queue,
    transactionState,
    manifest,
    coordinator,
    operations,
    runResult,
    receipt: executor.lastReceipt,
  };
}

async function expectCommitReadyQueue(harness: CommitReadyHarness): Promise<void> {
  const snapshot = await harness.queue.load(harness.bundle.id);
  expect(snapshot.control).toEqual({ status: "running" });
  expect(snapshot.applyCommit).toBeUndefined();
  expect(snapshot.applyClaim).toEqual({
    jobId: JOB_ID,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: INPUT_REVISION,
    attempt: 1,
    startedAt: 1_000,
  });
  expect(snapshot.jobs).toHaveLength(1);
  expect(snapshot.jobs[0]).toMatchObject({
    id: JOB_ID,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: INPUT_REVISION,
    attempt: 1,
    status: "processing",
    stage: "applying",
  });
}

describe("ApplyCommitCoordinator with the real IngestQueue", () => {
  it("keeps commit-ready applying state until coordinated manifest success", async () => {
    const harness = await createCommitReadyHarness();

    expect(harness.runResult).toEqual({
      kind: "commit_ready",
      jobId: JOB_ID,
      receipt: harness.receipt,
    });
    expect(harness.transactionState.active?.version).toBe(3);
    await expectCommitReadyQueue(harness);

    await expect(harness.coordinator.reconcile(harness.bundle)).resolves.toMatchObject({
      kind: "committed",
      job: { id: JOB_ID, status: "completed" },
      queueSnapshot: {
        control: { status: "paused", reason: "startup_recovery" },
        jobs: [{ id: JOB_ID, status: "completed", changeSetId: CHANGE_SET_ID }],
      },
    });

    expect(harness.operations).toEqual([
      "transaction.recover",
      "transaction.load",
      "queue.verify",
      "manifest.record",
      "queue.resolve",
      "transaction.ack",
      "queue.finalize",
    ]);
    expect(harness.manifest.durableWrites).toBe(1);
    expect(harness.transactionState.active).toBeNull();
    const finalSnapshot = await harness.queue.load(harness.bundle.id);
    expect(finalSnapshot.control).toMatchObject({
      status: "paused",
      reason: "startup_recovery",
    });
    expect(finalSnapshot.applyCommit).toBeUndefined();
    expect(finalSnapshot.jobs[0]).toMatchObject({
      status: "completed",
      stage: "completed",
      changeSetId: CHANGE_SET_ID,
    });
  });

  it("leaves journal and applying queue intact after manifest failure, then converges", async () => {
    const harness = await createCommitReadyHarness();
    harness.manifest.failOnce = true;

    await expect(harness.coordinator.reconcile(harness.bundle)).rejects.toThrow(
      "simulated manifest failure"
    );
    expect(harness.transactionState.active?.transactionId).toBe(TRANSACTION_ID);
    await expectCommitReadyQueue(harness);
    expect(harness.operations).toEqual([
      "transaction.recover",
      "transaction.load",
      "queue.verify",
      "manifest.record",
    ]);

    await expect(harness.coordinator.reconcile(harness.bundle)).resolves.toMatchObject({
      kind: "committed",
      job: { id: JOB_ID, status: "completed" },
    });
    expect(harness.operations).toEqual([
      "transaction.recover",
      "transaction.load",
      "queue.verify",
      "manifest.record",
      "transaction.recover",
      "transaction.load",
      "queue.verify",
      "manifest.record",
      "queue.resolve",
      "transaction.ack",
      "queue.finalize",
    ]);
    expect(harness.manifest.attempts).toBe(2);
    expect(harness.manifest.durableWrites).toBe(1);
    expect(harness.transactionState.active).toBeNull();
    const finalSnapshot = await harness.queue.load(harness.bundle.id);
    expect(finalSnapshot.control).toMatchObject({ reason: "startup_recovery" });
    expect(finalSnapshot.applyCommit).toBeUndefined();
    expect(finalSnapshot.jobs[0]).toMatchObject({ status: "completed", stage: "completed" });
  });

  it("retries a real queue resolve write without losing the committed journal", async () => {
    const harness = await createCommitReadyHarness();
    harness.storage.failAtWriteAttempt = harness.storage.writeAttempts + 1;

    await expect(harness.coordinator.reconcile(harness.bundle)).rejects.toThrow(
      "simulated queue storage failure"
    );
    expect(harness.transactionState.active?.transactionId).toBe(TRANSACTION_ID);
    await expectCommitReadyQueue(harness);
    expect(harness.manifest.durableWrites).toBe(1);

    await expect(harness.coordinator.reconcile(harness.bundle)).resolves.toMatchObject({
      kind: "committed",
      job: { id: JOB_ID, status: "completed" },
    });
    expect(harness.transactionState.active).toBeNull();
    expect((await harness.queue.load(harness.bundle.id)).applyCommit).toBeUndefined();
  });

  it("finishes a real queue marker after journal acknowledgement precedes release", async () => {
    const harness = await createCommitReadyHarness();
    harness.storage.failAtWriteAttempt = harness.storage.writeAttempts + 2;

    await expect(harness.coordinator.reconcile(harness.bundle)).rejects.toThrow(
      "simulated queue storage failure"
    );
    expect(harness.transactionState.active).toBeNull();
    expect(await harness.queue.getPendingApplyCommit(harness.bundle.id)).toMatchObject({
      transactionId: TRANSACTION_ID,
      jobId: JOB_ID,
    });

    await expect(harness.coordinator.reconcile(harness.bundle)).resolves.toMatchObject({
      kind: "finalized_pending_ack",
      transactionId: TRANSACTION_ID,
    });
    const finalSnapshot = await harness.queue.load(harness.bundle.id);
    expect(finalSnapshot.applyCommit).toBeUndefined();
    expect(finalSnapshot.control).toMatchObject({
      status: "paused",
      reason: "startup_recovery",
    });
  });
});
