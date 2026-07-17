import {
  TRANSACTION_JOURNAL_VERSION,
  TransactionStorageRevisionConflictError,
  createChangeSetTransactionDigest,
  type ChangeSetTransactionJournal,
} from "@/knowledge/changeset/TransactionStorage";
import { IngestQueue, type IngestExecutor } from "@/knowledge/ingest/queue/IngestQueue";
import {
  IngestQueueRevisionConflictError,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { SourceManifestRevisionConflictError } from "@/knowledge/manifest/SourceManifestStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  SourceManifest,
} from "@/knowledge/model/types";
import { ReviewStorageRevisionConflictError } from "@/knowledge/review/ReviewStorage";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeAtomicWriteError,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeStoreCorruptError,
  KnowledgeRuntimeTransactionStorage,
  SourceInputRevisionOverflowError,
  createEmptyKnowledgeRuntimeStoreSnapshot,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** In-memory atomic file that serializes synchronous transforms for unit tests. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();
  private misreportNextWrite = false;
  private repeatNextTransform = false;
  private skipNextTransform = false;

  /** Creates the initial content only when the memory file is absent. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) {
      this.content = initialContent;
    }
  }

  /** Reads the exact current memory file. */
  async read(): Promise<string> {
    if (this.content === undefined) {
      throw new Error("Memory runtime file is not initialized");
    }
    return this.content;
  }

  /** Serializes and commits one synchronous plaintext transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) {
        throw new Error("Memory runtime file is not initialized");
      }
      if (this.skipNextTransform) {
        this.skipNextTransform = false;
        return this.content;
      }
      const next = transform(this.content);
      if (this.repeatNextTransform) {
        this.repeatNextTransform = false;
        transform(this.content);
      }
      this.content = next;
      if (this.misreportNextWrite) {
        this.misreportNextWrite = false;
        return `${next} `;
      }
      return next;
    } finally {
      release();
    }
  }

  /** Replaces the file outside the atomic contract to simulate persisted corruption. */
  replaceContent(content: string): void {
    this.content = content;
  }

  /** Makes the next successful process call return text it did not commit. */
  misreportNextCommittedText(): void {
    this.misreportNextWrite = true;
  }

  /** Makes the next process boundary invoke its supposedly synchronous transform twice. */
  repeatTransformOnNextWrite(): void {
    this.repeatNextTransform = true;
  }

  /** Makes the next process boundary resolve without invoking its transform. */
  skipTransformOnNextWrite(): void {
    this.skipNextTransform = true;
  }
}

/** Creates one empty valid queue snapshot at a caller-selected revision. */
function createQueueSnapshot(revision: number, bundleId = "personal"): IngestQueueSnapshot {
  return {
    version: 3 as const,
    bundleId,
    revision,
    control: { status: "running" as const },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
  };
}

/** Creates one empty valid review snapshot at a caller-selected revision. */
function createReviewSnapshot(revision: number, bundleId = "personal") {
  return {
    version: 1 as const,
    bundleId,
    revision,
    records: [],
  };
}

/** Creates one empty valid Source Manifest at a caller-selected revision. */
function createManifest(revision: number, bundleId = "personal"): SourceManifest {
  return {
    version: 1,
    bundleId,
    revision,
    entries: [],
  };
}

/** Creates the Bundle boundary embedded in the transaction fixture. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates one accepted create-only ChangeSet for transaction storage tests. */
function createAcceptedChangeSet(transactionId = "transaction-1"): KnowledgeChangeSet {
  const content = `# ${transactionId}\n`;
  return {
    id: `changeset-${transactionId}`,
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: `change-${transactionId}`,
        operation: "create",
        path: `Wiki/${transactionId}.md`,
        sourceRefs: ["source-1"],
        reason: "Create one grounded page",
        expectedAbsent: true,
        afterContent: content,
        afterHash: createFileContentHash(content),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

/** Creates a valid prepared journal at revision zero. */
function createPreparedJournal(transactionId = "transaction-1"): ChangeSetTransactionJournal {
  const changeSet = createAcceptedChangeSet(transactionId);
  const change = changeSet.changes[0];
  if (change.operation !== "create") {
    throw new Error("Expected a create fixture");
  }
  return {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId,
    revision: 0,
    bundleId: "personal",
    bundle: createBundle(),
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    jobClaim: {
      jobId: `job-${transactionId}`,
      attempt: 1,
      startedAt: 150,
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
    },
    changeSet,
    targets: [
      {
        changeId: change.id,
        path: change.path,
        windowsPathKey: change.path.toLowerCase(),
        operation: "create",
        before: { kind: "missing" },
        after: {
          kind: "file",
          content: change.afterContent,
          contentHash: change.afterHash,
        },
      },
    ],
    phase: "prepared",
    appliedCount: 0,
    createdAt: 200,
    updatedAt: 200,
  };
}

/** Creates an initialized store and all persistence facades. */
async function createHarness(): Promise<{
  file: MemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  queue: KnowledgeRuntimeQueueStorage;
  review: KnowledgeRuntimeReviewStorage;
  manifest: KnowledgeRuntimeManifestStorage;
  transaction: KnowledgeRuntimeTransactionStorage;
  revisions: KnowledgeRuntimeInputRevisionAllocator;
}> {
  const file = new MemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  return {
    file,
    runtime,
    queue: new KnowledgeRuntimeQueueStorage(runtime),
    review: new KnowledgeRuntimeReviewStorage(runtime),
    manifest: new KnowledgeRuntimeManifestStorage(runtime),
    transaction: new KnowledgeRuntimeTransactionStorage(runtime),
    revisions: new KnowledgeRuntimeInputRevisionAllocator(runtime),
  };
}

describe("KnowledgeRuntimeStore", () => {
  it("initializes once and preserves an existing valid envelope", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createQueueSnapshot(1), null);

    await harness.runtime.initialize();

    await expect(harness.queue.read("personal")).resolves.toEqual(createQueueSnapshot(1));
  });

  it("stores queue, review, and manifest snapshots with exact revision CAS", async () => {
    const harness = await createHarness();
    const queue = createQueueSnapshot(1);
    const review = createReviewSnapshot(1);
    const manifest = createManifest(1);

    await harness.queue.write("personal", queue, null);
    await harness.review.write("personal", review, null);
    await harness.manifest.write("personal", manifest, null);
    queue.control = { status: "paused", reason: "user", pausedAt: 1 };
    review.records.push({} as never);
    manifest.entries.push({} as never);

    await expect(harness.queue.read("personal")).resolves.toEqual(createQueueSnapshot(1));
    await expect(harness.review.read("personal")).resolves.toEqual(createReviewSnapshot(1));
    await expect(harness.manifest.read("personal")).resolves.toEqual(createManifest(1));

    await expect(
      harness.queue.write("personal", createQueueSnapshot(1), null)
    ).rejects.toMatchObject({
      name: IngestQueueRevisionConflictError.name,
      expectedRevision: null,
      actualRevision: 1,
    });
    await expect(
      harness.review.write("personal", createReviewSnapshot(1), null)
    ).rejects.toBeInstanceOf(ReviewStorageRevisionConflictError);
    await expect(
      harness.manifest.write("personal", createManifest(1), null)
    ).rejects.toBeInstanceOf(SourceManifestRevisionConflictError);
  });

  it("allows exactly one concurrent expected-null queue creation", async () => {
    const harness = await createHarness();

    const results = await Promise.allSettled([
      harness.queue.write("personal", createQueueSnapshot(1), null),
      harness.queue.write("personal", createQueueSnapshot(1), null),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(rejected?.reason).toBeInstanceOf(IngestQueueRevisionConflictError);
  });

  it("rejects caller revision jumps before touching the durable envelope", async () => {
    const harness = await createHarness();
    const before = await harness.file.read();

    await expect(harness.queue.write("personal", createQueueSnapshot(2), null)).rejects.toThrow(
      "advance its observed revision exactly once"
    );
    expect(await harness.file.read()).toBe(before);
  });

  it("uses an ABA-safe permanent active transaction slot", async () => {
    const harness = await createHarness();
    const first = createPreparedJournal();
    await harness.transaction.writeActive(first, null);
    const applying: ChangeSetTransactionJournal = {
      ...first,
      revision: 1,
      phase: "applying",
      updatedAt: 210,
    };
    await harness.transaction.writeActive(applying, {
      transactionId: first.transactionId,
      revision: first.revision,
    });

    await expect(
      harness.transaction.clearActive({ transactionId: first.transactionId, revision: 0 })
    ).rejects.toBeInstanceOf(TransactionStorageRevisionConflictError);
    await harness.transaction.clearActive({ transactionId: first.transactionId, revision: 1 });
    await expect(harness.transaction.readActive()).resolves.toBeNull();

    const second = createPreparedJournal("transaction-2");
    await harness.transaction.writeActive(second, null);
    await expect(
      harness.transaction.clearActive({ transactionId: first.transactionId, revision: 1 })
    ).rejects.toMatchObject({
      name: TransactionStorageRevisionConflictError.name,
      actualToken: { transactionId: second.transactionId, revision: 0 },
    });
    await expect(harness.transaction.readActive()).resolves.toEqual(second);
  });

  it("allocates every captured observation monotonically before asynchronous source reads", async () => {
    const harness = await createHarness();
    const request = {
      bundleId: "personal",
      sourceId: "source-1",
    };

    await expect(harness.revisions.allocate(request)).resolves.toEqual({ inputRevision: 1 });
    await expect(harness.revisions.allocate(request)).resolves.toEqual({ inputRevision: 2 });
    await expect(harness.revisions.allocate(request)).resolves.toEqual({ inputRevision: 3 });
    await expect(harness.revisions.allocate(request)).resolves.toEqual({ inputRevision: 4 });
  });

  it("serializes concurrent observation allocation without duplicate revisions", async () => {
    const harness = await createHarness();
    const request = {
      bundleId: "personal",
      sourceId: "source-1",
    };

    const allocations = await Promise.all([
      harness.revisions.allocate(request),
      harness.revisions.allocate(request),
      harness.revisions.allocate(request),
    ]);

    expect(allocations.map(({ inputRevision }) => inputRevision).sort()).toEqual([1, 2, 3]);
  });

  it("preserves allocation across runtime reconstruction and isolates Bundle/source namespaces", async () => {
    const harness = await createHarness();
    await harness.revisions.allocate({ bundleId: "personal", sourceId: "source-1" });
    await harness.revisions.allocate({ bundleId: "personal", sourceId: "source-1" });

    const reconstructedRuntime = new KnowledgeRuntimeStore(harness.file);
    await reconstructedRuntime.initialize();
    const reconstructed = new KnowledgeRuntimeInputRevisionAllocator(reconstructedRuntime);

    await expect(
      reconstructed.allocate({ bundleId: "personal", sourceId: "source-1" })
    ).resolves.toEqual({ inputRevision: 3 });
    await expect(
      reconstructed.allocate({ bundleId: "personal", sourceId: "source-2" })
    ).resolves.toEqual({ inputRevision: 1 });
    await expect(
      reconstructed.allocate({ bundleId: "another", sourceId: "source-1" })
    ).resolves.toEqual({ inputRevision: 1 });
  });

  it("lets Queue reject an older read that completes after a newer captured event", async () => {
    const harness = await createHarness();
    const executor: IngestExecutor = {
      /** Produces no changes when this ordering-only queue is later executed. */
      execute: async () => ({ kind: "no_changes", changeSetId: "changeset-ordering" }),
    };
    let jobSequence = 0;
    const queue = new IngestQueue(harness.queue, executor, {
      clock: () => 100,
      jobIdFactory: () => `job-${++jobSequence}`,
    });
    const older = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
    });
    const newer = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
    });

    await queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
      inputRevision: newer.inputRevision,
    });
    await queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_A,
      inputRevision: older.inputRevision,
    });

    const snapshot = await queue.load("personal");
    expect(snapshot.sourceHighWatermarks).toEqual([
      expect.objectContaining({ inputRevision: 2, sourceContentHash: HASH_B }),
    ]);
    expect(snapshot.jobs).toEqual([
      expect.objectContaining({ inputRevision: 2, sourceContentHash: HASH_B }),
    ]);
  });

  it("preserves concurrent updates to different subsystems in the shared envelope", async () => {
    const harness = await createHarness();

    await Promise.all([
      harness.queue.write("queue-bundle", createQueueSnapshot(1, "queue-bundle"), null),
      harness.review.write("review-bundle", createReviewSnapshot(1, "review-bundle"), null),
      harness.manifest.write("manifest-bundle", createManifest(1, "manifest-bundle"), null),
    ]);

    await expect(harness.queue.read("queue-bundle")).resolves.toEqual(
      createQueueSnapshot(1, "queue-bundle")
    );
    await expect(harness.review.read("review-bundle")).resolves.toEqual(
      createReviewSnapshot(1, "review-bundle")
    );
    await expect(harness.manifest.read("manifest-bundle")).resolves.toEqual(
      createManifest(1, "manifest-bundle")
    );
    expect(JSON.parse(await harness.file.read())).toMatchObject({ revision: 3 });
  });

  it("rejects revision overflow without changing persisted bytes", async () => {
    const harness = await createHarness();
    const saturated: KnowledgeRuntimeStoreSnapshot = {
      ...createEmptyKnowledgeRuntimeStoreSnapshot(),
      inputRevisions: [
        {
          bundleId: "personal",
          sources: [{ sourceId: "source-1", inputRevision: Number.MAX_SAFE_INTEGER }],
        },
      ],
    };
    harness.file.replaceContent(JSON.stringify(saturated));
    const before = await harness.file.read();

    await expect(
      harness.revisions.allocate({ bundleId: "personal", sourceId: "source-1" })
    ).rejects.toBeInstanceOf(SourceInputRevisionOverflowError);
    expect(await harness.file.read()).toBe(before);
  });

  it("blocks every mutation when any embedded subsystem snapshot is corrupt", async () => {
    const harness = await createHarness();
    const corrupt: KnowledgeRuntimeStoreSnapshot = {
      ...createEmptyKnowledgeRuntimeStoreSnapshot(),
      queues: [
        {
          bundleId: "personal",
          value: { ...createQueueSnapshot(1), bundleId: "another-bundle" },
        },
      ],
    };
    harness.file.replaceContent(JSON.stringify(corrupt));

    await expect(
      harness.revisions.allocate({
        bundleId: "personal",
        sourceId: "source-1",
      })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
  });

  it("rejects malformed JSON and duplicate runtime keys as corruption", async () => {
    const harness = await createHarness();
    harness.file.replaceContent("{");
    await expect(harness.runtime.readQueue("personal")).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );

    const duplicate = createEmptyKnowledgeRuntimeStoreSnapshot();
    duplicate.inputRevisions = [
      { bundleId: "personal", sources: [] },
      { bundleId: "personal", sources: [] },
    ];
    harness.file.replaceContent(JSON.stringify(duplicate));
    await expect(harness.runtime.readQueue("personal")).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
  });

  it("blocks unrelated writes for every embedded corruption class without changing bytes", async () => {
    const base = createEmptyKnowledgeRuntimeStoreSnapshot();
    const commit = {
      transactionId: "transaction-1",
      commitRevision: 1,
      bundleId: "personal",
      sourceId: "source-1",
      changeSetId: "changeset-1",
      changeSetDigest: HASH_A,
      journalDigest: HASH_B,
      receiptDigest: HASH_A,
      recordedAt: 1,
    };
    const scenarios: Array<{ name: string; value: unknown }> = [
      {
        name: "queue semantic corruption",
        value: {
          ...base,
          queues: [
            {
              bundleId: "personal",
              value: { ...createQueueSnapshot(1), bundleId: "wrong" },
            },
          ],
        },
      },
      {
        name: "review semantic corruption",
        value: {
          ...base,
          reviews: [
            {
              bundleId: "personal",
              value: { ...createReviewSnapshot(1), bundleId: "wrong" },
            },
          ],
        },
      },
      {
        name: "manifest semantic corruption",
        value: {
          ...base,
          manifests: [
            {
              bundleId: "personal",
              value: { ...createManifest(1), bundleId: "wrong" },
            },
          ],
        },
      },
      { name: "transaction semantic corruption", value: { ...base, activeTransaction: {} } },
      {
        name: "duplicate Bundle slot",
        value: {
          ...base,
          queues: [
            { bundleId: "personal", value: createQueueSnapshot(1) },
            { bundleId: "personal", value: createQueueSnapshot(1) },
          ],
        },
      },
      {
        name: "duplicate source revision",
        value: {
          ...base,
          inputRevisions: [
            {
              bundleId: "personal",
              sources: [
                { sourceId: "source-1", inputRevision: 1 },
                { sourceId: "source-1", inputRevision: 2 },
              ],
            },
          ],
        },
      },
      { name: "duplicate commit identity", value: { ...base, applyCommits: [commit, commit] } },
      { name: "unknown top-level field", value: { ...base, unexpected: true } },
      { name: "unsupported version", value: { ...base, version: 2 } },
    ];

    for (const scenario of scenarios) {
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(scenario.value));
      const runtime = new KnowledgeRuntimeStore(file);
      const allocator = new KnowledgeRuntimeInputRevisionAllocator(runtime);
      const before = await file.read();

      await expect(
        allocator.allocate({ bundleId: "unrelated", sourceId: scenario.name })
      ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
      expect(await file.read()).toBe(before);
    }
  });

  it("verifies the exact success payload returned by the atomic file", async () => {
    const harness = await createHarness();
    harness.file.misreportNextCommittedText();

    await expect(
      harness.queue.write("personal", createQueueSnapshot(1), null)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeAtomicWriteError);
  });

  it("rejects an atomic boundary that skips or repeats its transform", async () => {
    const skipped = await createHarness();
    skipped.file.skipTransformOnNextWrite();
    await expect(
      skipped.queue.write("personal", createQueueSnapshot(1), null)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeAtomicWriteError);
    await expect(skipped.queue.read("personal")).resolves.toBeNull();

    const repeated = await createHarness();
    repeated.file.repeatTransformOnNextWrite();
    await expect(
      repeated.queue.write("personal", createQueueSnapshot(1), null)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeAtomicWriteError);
    await expect(repeated.queue.read("personal")).resolves.toBeNull();
  });
});
