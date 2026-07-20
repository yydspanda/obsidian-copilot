import {
  createTransactionCommitReceipt,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
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
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { SourceManifestRevisionConflictError } from "@/knowledge/manifest/SourceManifestStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { ReviewStorageRevisionConflictError } from "@/knowledge/review/ReviewStorage";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeApplyCommitLedgerConflictError,
  KnowledgeApplyCommitManifestConflictError,
  KnowledgeApplyCommitProofError,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeAtomicWriteError,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeManifestProtectedStateError,
  KnowledgeRuntimeManifestReservationError,
  KnowledgeRuntimeMigrationUnsafeError,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeStoreCorruptError,
  KnowledgeRuntimeTransactionStorage,
  KNOWLEDGE_RUNTIME_STORE_VERSION,
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  SourceInputRevisionOverflowError,
  createEmptyKnowledgeRuntimeStoreSnapshot,
  type KnowledgeApplyCommitLedgerRecord,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** In-memory atomic file that serializes synchronous transforms for unit tests. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();
  private misreportNextWrite = false;
  private repeatNextTransform = false;
  private skipNextTransform = false;
  private throwAfterNextCommit = false;

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
      if (this.throwAfterNextCommit) {
        this.throwAfterNextCommit = false;
        throw new Error("Simulated post-commit transport failure");
      }
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

  /** Commits the next transformed bytes and then rejects the caller. */
  throwAfterCommitOnNextWrite(): void {
    this.throwAfterNextCommit = true;
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
    version: 2 as const,
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

/** Creates one idle outer-runtime-v1 snapshot eligible for automatic migration. */
function createLegacyRuntimeSnapshot(): Record<string, unknown> {
  return {
    version: 1,
    revision: 7,
    queues: [{ bundleId: "personal", value: createQueueSnapshot(4) }],
    reviews: [
      {
        bundleId: "personal",
        value: { version: 1, bundleId: "personal", revision: 3, records: [] },
      },
    ],
    manifests: [{ bundleId: "personal", value: createManifest(5) }],
    activeTransaction: null,
    inputRevisions: [
      { bundleId: "personal", sources: [{ sourceId: "source-1", inputRevision: 9 }] },
    ],
    applyCommits: [],
  };
}

/** Creates one valid Queue-v3 snapshot carrying unresolved review work. */
function createLegacyAwaitingReviewQueue(): IngestQueueSnapshot {
  return {
    ...createQueueSnapshot(4),
    jobs: [
      {
        id: "job-review",
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 100,
        updatedAt: 120,
        status: "awaiting_review",
        stage: "review",
        changeSetId: "changeset-review",
      },
    ],
    sourceHighWatermarks: [
      {
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 120,
      },
    ],
    pendingReviews: [
      {
        kind: "durable",
        jobId: "job-review",
        changeSetId: "changeset-review",
        proposalDigest: HASH_A,
        reviewRecordRevision: 0,
        recordedAt: 110,
      },
    ],
  };
}

/** Creates one valid Queue-v3 snapshot carrying an active apply claim. */
function createLegacyApplyingQueue(): IngestQueueSnapshot {
  return {
    ...createQueueSnapshot(4),
    jobs: [
      {
        id: "job-apply",
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 100,
        updatedAt: 110,
        status: "processing",
        stage: "applying",
        startedAt: 110,
      },
    ],
    sourceHighWatermarks: [
      {
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 110,
      },
    ],
    applyClaim: {
      jobId: "job-apply",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
      startedAt: 110,
      reviewedChangeSet: { changeSetId: "changeset-apply", changeSetDigest: HASH_A },
      acceptedReview: { proposalDigest: HASH_A, recordRevision: 1, acceptedAt: 110 },
    },
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
  const manifestCommitIntent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    manifestCommitPlanDigest: HASH_A,
    changeSetId: changeSet.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_A,
    generatedPages: [{ path: change.path, ownership: "generated", contentHash: change.afterHash }],
  };
  return {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId,
    revision: 0,
    bundleId: "personal",
    bundle: createBundle(),
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
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

/** Creates one Manifest containing a registered source ready for its first commit. */
function createRegisteredManifest(
  revision = 1,
  sourceOverrides: Partial<SourceManifest["entries"][number]> = {}
): SourceManifest {
  return {
    version: 1,
    bundleId: "personal",
    revision,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/source-1.md",
        sourcePath: "Sources/Source-1.md",
        custody: "user_managed",
        ...sourceOverrides,
      },
    ],
  };
}

/** Creates exact committed journal and receipt proof against one Manifest read-set. */
function createCommittedApplyProof(
  manifest: SourceManifest,
  transactionId = "transaction-apply",
  inputRevision = 1
): {
  journal: ChangeSetTransactionJournal & { phase: "committed" };
  receipt: TransactionCommitReceipt;
} {
  const prepared = createPreparedJournal(transactionId);
  const change = prepared.changeSet.changes[0];
  if (change.operation !== "create") {
    throw new Error("Expected a create fixture");
  }
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  if (!source) {
    throw new Error("Expected a registered source fixture");
  }
  const basePages = (source.lastSuccessful?.generatedPages ?? []).map((page) => {
    if (!page.contentHash) {
      throw new Error("Expected content-addressed generated page fixture");
    }
    return { path: page.path, ownership: page.ownership, contentHash: page.contentHash };
  });
  const manifestCommitIntent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision,
    manifestCommitPlanDigest: HASH_A,
    changeSetId: prepared.changeSetId,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: [
      ...basePages,
      { path: change.path, ownership: "generated" as const, contentHash: change.afterHash },
    ].sort((left, right) =>
      left.path.toLowerCase() < right.path.toLowerCase()
        ? -1
        : left.path.toLowerCase() > right.path.toLowerCase()
          ? 1
          : 0
    ),
  };
  const journal: ChangeSetTransactionJournal & { phase: "committed" } = {
    ...prepared,
    revision: 4,
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    jobClaim: { ...prepared.jobClaim, inputRevision },
    appliedCount: prepared.targets.length,
    phase: "committed",
    committedAt: 240,
    updatedAt: 240,
  };
  return { journal, receipt: createTransactionCommitReceipt(journal) };
}

/** Creates one prepared revision-zero journal against an exact Manifest read-set. */
function createPreparedApplyJournal(
  manifest: SourceManifest,
  transactionId: string,
  inputRevision = 1
): ChangeSetTransactionJournal & { phase: "prepared" } {
  const { committedAt: _committedAt, ...committed } = createCommittedApplyProof(
    manifest,
    transactionId,
    inputRevision
  ).journal;
  void _committedAt;
  return {
    ...committed,
    revision: 0,
    appliedCount: 0,
    phase: "prepared",
    updatedAt: 200,
  };
}

/** Creates a valid two-target prepared journal for progress-transition tests. */
function createTwoTargetPreparedApplyJournal(
  manifest: SourceManifest,
  transactionId: string
): ChangeSetTransactionJournal & { phase: "prepared" } {
  const prepared = createPreparedApplyJournal(manifest, transactionId);
  const afterContent = "# Additional target\n";
  const afterHash = createFileContentHash(afterContent);
  const secondChange = {
    id: `change-${transactionId}-additional`,
    operation: "create" as const,
    path: "Wiki/Additional.md",
    sourceRefs: ["source-1"],
    reason: "Create an additional grounded page",
    expectedAbsent: true as const,
    afterContent,
    afterHash,
  };
  const changeSet: KnowledgeChangeSet = {
    ...prepared.changeSet,
    changes: [...prepared.changeSet.changes, secondChange],
  };
  const manifestCommitIntent: ManifestCommitIntent = {
    ...prepared.manifestCommitIntent,
    generatedPages: [
      ...prepared.manifestCommitIntent.generatedPages,
      { path: secondChange.path, ownership: "generated", contentHash: afterHash } as const,
    ].sort((left, right) => {
      const leftKey = toWindowsPathKey(left.path);
      const rightKey = toWindowsPathKey(right.path);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  };
  return {
    ...prepared,
    changeSet,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    targets: [
      ...prepared.targets,
      {
        changeId: secondChange.id,
        path: secondChange.path,
        windowsPathKey: toWindowsPathKey(secondChange.path),
        operation: secondChange.operation,
        before: { kind: "missing" } as const,
        after: { kind: "file", content: afterContent, contentHash: afterHash } as const,
      },
    ].sort((left, right) =>
      left.windowsPathKey < right.windowsPathKey
        ? -1
        : left.windowsPathKey > right.windowsPathKey
          ? 1
          : 0
    ),
  };
}

/** Creates one strict historical ledger proof for source-extension fixtures. */
function createHistoricalLedgerRecord(
  transactionId: string,
  sourceId: string,
  inputRevision: number,
  changeSetId: string,
  recordedAt: number,
  manifestAfterRevision: number,
  manifestAfterDigest = HASH_B,
  sourceContentHash = HASH_A,
  pipelineFingerprint = HASH_B,
  manifestBeforeDigest = HASH_A
): KnowledgeApplyCommitLedgerRecord {
  return {
    transactionId,
    commitRevision: 4,
    bundleId: "personal",
    sourceId,
    sourceContentHash,
    pipelineFingerprint,
    inputRevision,
    changeSetId,
    changeSetDigest: HASH_A,
    manifestIntentDigest: HASH_A,
    journalDigest: HASH_A,
    receiptDigest: HASH_B,
    manifestBeforeRevision: manifestAfterRevision - 1,
    manifestBeforeDigest,
    manifestAfterRevision,
    manifestAfterDigest,
    recordedAt,
  };
}

/** Creates a two-source shared-page update with an exact final primary projection. */
function createSharedUpdateProof(manifest: SourceManifest): {
  journal: ChangeSetTransactionJournal & { phase: "committed" };
  receipt: TransactionCommitReceipt;
} {
  const beforeContent = "# Shared before\n";
  const afterContent = "# Shared after\n";
  const changeSet: KnowledgeChangeSet = {
    id: "changeset-shared-update",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1", "source-2"],
    changes: [
      {
        id: "change-shared-update",
        operation: "update",
        path: "Wiki/Shared.md",
        sourceRefs: ["source-1", "source-2"],
        reason: "Update one co-owned shared page",
        beforeHash: createFileContentHash(beforeContent),
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 200,
  };
  const intent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 2,
    manifestCommitPlanDigest: HASH_A,
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: [
      {
        path: "Wiki/Shared.md",
        ownership: "shared",
        contentHash: createFileContentHash(afterContent),
      },
    ],
  };
  const journal: ChangeSetTransactionJournal & { phase: "committed" } = {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: "transaction-shared-update",
    revision: 4,
    bundleId: "personal",
    bundle: createBundle(),
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(intent),
    jobClaim: {
      jobId: "job-shared-update",
      attempt: 1,
      startedAt: 190,
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
    },
    changeSet,
    targets: [
      {
        changeId: "change-shared-update",
        path: "Wiki/Shared.md",
        windowsPathKey: "wiki/shared.md",
        operation: "update",
        before: {
          kind: "file",
          content: beforeContent,
          contentHash: createFileContentHash(beforeContent),
        },
        after: {
          kind: "file",
          content: afterContent,
          contentHash: createFileContentHash(afterContent),
        },
      },
    ],
    appliedCount: 1,
    createdAt: 200,
    updatedAt: 240,
    phase: "committed",
    committedAt: 240,
  };
  return { journal, receipt: createTransactionCommitReceipt(journal) };
}

/** Creates one runtime whose active slot contains the supplied committed proof. */
async function createApplyHarness(
  manifest: SourceManifest,
  proof = createCommittedApplyProof(manifest)
): Promise<{
  file: MemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  port: KnowledgeRuntimeApplyCommitManifestPort;
  journal: ChangeSetTransactionJournal & { phase: "committed" };
  receipt: TransactionCommitReceipt;
}> {
  const file = new MemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file);
  await runtime.initialize();
  const state: KnowledgeRuntimeStoreSnapshot = {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(),
    revision: 10,
    manifests: [{ bundleId: manifest.bundleId, value: manifest }],
    activeTransaction: proof.journal,
  };
  file.replaceContent(JSON.stringify(state));
  return {
    file,
    runtime,
    port: new KnowledgeRuntimeApplyCommitManifestPort(runtime),
    ...proof,
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

  it("atomically migrates one idle runtime-v1 envelope and preserves durable subsystem state", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const legacy = createLegacyRuntimeSnapshot();
    await file.initialize(JSON.stringify(legacy));
    const runtime = new KnowledgeRuntimeStore(file);

    await runtime.initialize();

    expect(JSON.parse(await file.read())).toEqual({
      ...legacy,
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      revision: 8,
      reviews: [
        {
          bundleId: "personal",
          value: { version: 2, bundleId: "personal", revision: 3, records: [] },
        },
      ],
    });
    await expect(new KnowledgeRuntimeQueueStorage(runtime).read("personal")).resolves.toEqual(
      createQueueSnapshot(4)
    );
    await expect(new KnowledgeRuntimeManifestStorage(runtime).read("personal")).resolves.toEqual(
      createManifest(5)
    );
    await expect(
      new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
        bundleId: "personal",
        sourceId: "source-1",
      })
    ).resolves.toEqual({ inputRevision: 10 });
  });

  it("keeps exact bytes and revision when initialize repeats after migration", async () => {
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(createLegacyRuntimeSnapshot()));
    const runtime = new KnowledgeRuntimeStore(file);
    await runtime.initialize();
    const migrated = await file.read();

    await runtime.initialize();

    expect(await file.read()).toBe(migrated);
  });

  it.each([
    {
      reason: "active_transaction_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        activeTransaction: { transactionId: "legacy-active" },
      }),
    },
    {
      reason: "apply_commit_ledger_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        applyCommits: [{ transactionId: "legacy-commit" }],
      }),
    },
    {
      reason: "review_records_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        reviews: [
          {
            bundleId: "personal",
            value: { version: 1, bundleId: "personal", revision: 3, records: [{}] },
          },
        ],
      }),
    },
    {
      reason: "queue_review_state_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        queues: [{ bundleId: "personal", value: createLegacyAwaitingReviewQueue() }],
      }),
    },
    {
      reason: "queue_apply_state_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        queues: [{ bundleId: "personal", value: createLegacyApplyingQueue() }],
      }),
    },
    {
      reason: "manifest_success_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        manifests: [
          {
            bundleId: "personal",
            value: createRegisteredManifest(5, {
              lastSuccessful: {
                sourceContentHash: HASH_A,
                pipelineFingerprint: HASH_B,
                generatedPages: [
                  {
                    path: "Wiki/Legacy.md",
                    ownership: "generated",
                    contentHash: HASH_A,
                  },
                ],
                changeSetId: "changeset-legacy",
                completedAt: 100,
              },
            }),
          },
        ],
      }),
    },
    {
      reason: "manifest_reserved_commit_metadata_present",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        manifests: [
          {
            bundleId: "personal",
            value: createRegisteredManifest(5, {
              extensions: {
                [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
                  version: 1,
                  inputRevision: 1,
                  transactionId: "transaction-legacy",
                  manifestIntentDigest: HASH_A,
                },
              },
            }),
          },
        ],
      }),
    },
    {
      reason: "revision_overflow",
      mutate: (legacy: Record<string, unknown>) => ({
        ...legacy,
        revision: Number.MAX_SAFE_INTEGER - 1,
      }),
    },
  ] as const)("fails closed for unsafe legacy state: $reason", async ({ reason, mutate }) => {
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(mutate(createLegacyRuntimeSnapshot())));
    const before = await file.read();
    const runtime = new KnowledgeRuntimeStore(file);

    await expect(runtime.initialize()).rejects.toMatchObject({
      name: KnowledgeRuntimeMigrationUnsafeError.name,
      reason,
    });
    expect(await file.read()).toBe(before);
  });

  it("atomically advances the source Manifest and appends one content-addressed ledger record", async () => {
    const manifest = createRegisteredManifest();
    const harness = await createApplyHarness(manifest);

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const committedManifest = state.manifests[0].value as SourceManifest;
    expect(state.revision).toBe(11);
    expect(state.activeTransaction).toEqual(harness.journal);
    expect(committedManifest.revision).toBe(2);
    expect(committedManifest.entries[0].lastSuccessful).toEqual({
      sourceContentHash: harness.journal.jobClaim.sourceContentHash,
      pipelineFingerprint: harness.journal.jobClaim.pipelineFingerprint,
      generatedPages: harness.journal.manifestCommitIntent.generatedPages,
      changeSetId: harness.journal.changeSetId,
      completedAt: harness.receipt.committedAt,
    });
    expect(
      committedManifest.entries[0].extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
    ).toEqual({
      version: 1,
      inputRevision: 1,
      transactionId: harness.journal.transactionId,
      manifestIntentDigest: harness.journal.manifestCommitIntentDigest,
    });
    expect(state.applyCommits).toEqual([
      expect.objectContaining({
        transactionId: harness.journal.transactionId,
        commitRevision: harness.journal.revision,
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: harness.journal.jobClaim.sourceContentHash,
        pipelineFingerprint: harness.journal.jobClaim.pipelineFingerprint,
        inputRevision: 1,
        changeSetId: harness.journal.changeSetId,
        changeSetDigest: harness.journal.changeSetDigest,
        manifestIntentDigest: harness.journal.manifestCommitIntentDigest,
        manifestBeforeRevision: 1,
        manifestBeforeDigest: createSourceManifestDigest(manifest),
        manifestAfterRevision: 2,
        manifestAfterDigest: createSourceManifestDigest(committedManifest),
        recordedAt: harness.receipt.committedAt,
      }),
    ]);
  });

  it("rejects torn Manifest, reserved metadata, and ledger relationships at startup", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const valid = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const scenarios: Array<{
      name: string;
      mutate: (state: KnowledgeRuntimeStoreSnapshot) => void;
    }> = [
      {
        name: "success without reserved metadata",
        mutate: (state) => {
          const manifest = state.manifests[0].value as SourceManifest;
          delete manifest.entries[0].extensions;
        },
      },
      {
        name: "reserved metadata without success",
        mutate: (state) => {
          const manifest = state.manifests[0].value as SourceManifest;
          delete manifest.entries[0].lastSuccessful;
        },
      },
      {
        name: "reserved metadata referencing another transaction",
        mutate: (state) => {
          const manifest = state.manifests[0].value as SourceManifest;
          const entry = manifest.entries[0];
          entry.extensions = {
            ...entry.extensions,
            [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
              version: 1,
              inputRevision: 1,
              transactionId: "transaction-missing",
              manifestIntentDigest: harness.journal.manifestCommitIntentDigest,
            },
          };
        },
      },
      {
        name: "success source identity diverging from its ledger",
        mutate: (state) => {
          const manifest = state.manifests[0].value as SourceManifest;
          const success = manifest.entries[0].lastSuccessful;
          if (!success) {
            throw new Error("Expected committed source success fixture");
          }
          success.sourceContentHash = HASH_C;
        },
      },
      {
        name: "ledger referencing a missing source",
        mutate: (state) => {
          state.applyCommits[0].sourceId = "source-missing";
        },
      },
      {
        name: "current Manifest digest diverging from its latest ledger",
        mutate: (state) => {
          state.applyCommits[0].manifestAfterDigest = HASH_C;
        },
      },
    ];

    for (const scenario of scenarios) {
      const state = JSON.parse(JSON.stringify(valid)) as KnowledgeRuntimeStoreSnapshot;
      scenario.mutate(state);
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(state));
      const before = await file.read();

      await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
      expect(await file.read()).toBe(before);
    }
  });

  it("atomically propagates a shared-page after hash to every exact co-owner", async () => {
    const beforeHash = createFileContentHash("# Shared before\n");
    const primaryExtension = {
      version: 1 as const,
      inputRevision: 1,
      transactionId: "transaction-primary-old",
      manifestIntentDigest: HASH_A,
    };
    const coOwnerExtension = {
      version: 1 as const,
      inputRevision: 1,
      transactionId: "transaction-coowner-old",
      manifestIntentDigest: HASH_A,
    };
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 3,
      entries: [
        {
          sourceId: "source-1",
          sourceKey: "sources/source-1.md",
          sourcePath: "Sources/Source-1.md",
          custody: "user_managed",
          lastSuccessful: {
            sourceContentHash: HASH_A,
            pipelineFingerprint: HASH_B,
            generatedPages: [
              { path: "Wiki/Shared.md", ownership: "shared", contentHash: beforeHash },
            ],
            changeSetId: "changeset-primary-old",
            completedAt: 100,
          },
          extensions: { [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: primaryExtension },
        },
        {
          sourceId: "source-2",
          sourceKey: "sources/source-2.md",
          sourcePath: "Sources/Source-2.md",
          custody: "user_managed",
          lastSuccessful: {
            sourceContentHash: HASH_B,
            pipelineFingerprint: HASH_A,
            generatedPages: [
              { path: "Wiki/Shared.md", ownership: "shared", contentHash: beforeHash },
            ],
            changeSetId: "changeset-coowner-old",
            completedAt: 110,
          },
          extensions: { [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: coOwnerExtension },
        },
      ],
    };
    const proof = createSharedUpdateProof(manifest);
    const harness = await createApplyHarness(manifest, proof);
    const stateBefore = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    stateBefore.applyCommits = [
      createHistoricalLedgerRecord(
        "transaction-primary-old",
        "source-1",
        1,
        "changeset-primary-old",
        100,
        1,
        HASH_B,
        HASH_A,
        HASH_B
      ),
      createHistoricalLedgerRecord(
        "transaction-coowner-old",
        "source-2",
        1,
        "changeset-coowner-old",
        110,
        2,
        HASH_C,
        HASH_B,
        HASH_A,
        HASH_B
      ),
    ].sort((left, right) => left.transactionId.localeCompare(right.transactionId));
    harness.file.replaceContent(JSON.stringify(stateBefore));

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const committedManifest = state.manifests[0].value as SourceManifest;
    const afterHash = createFileContentHash("# Shared after\n");
    expect(committedManifest.revision).toBe(4);
    expect(
      committedManifest.entries.map((entry) => ({
        sourceId: entry.sourceId,
        contentHash: entry.lastSuccessful?.generatedPages[0]?.contentHash,
      }))
    ).toEqual([
      { sourceId: "source-1", contentHash: afterHash },
      { sourceId: "source-2", contentHash: afterHash },
    ]);
    expect(committedManifest.entries[1].lastSuccessful?.changeSetId).toBe("changeset-coowner-old");
    expect(state.applyCommits).toHaveLength(3);
    expect(
      state.applyCommits.find((record) => record.transactionId === proof.journal.transactionId)
    ).toMatchObject({
      manifestAfterRevision: 4,
      manifestAfterDigest: createSourceManifestDigest(committedManifest),
    });

    const tornState = JSON.parse(JSON.stringify(state)) as KnowledgeRuntimeStoreSnapshot;
    const tornManifest = tornState.manifests[0].value as SourceManifest;
    const coOwnerPage = tornManifest.entries[1].lastSuccessful?.generatedPages[0];
    if (!coOwnerPage) {
      throw new Error("Expected a co-owned page fixture");
    }
    tornManifest.revision += 1;
    coOwnerPage.contentHash = HASH_A;
    const tornFile = new MemoryAtomicRuntimeFile();
    await tornFile.initialize(JSON.stringify(tornState));
    await expect(new KnowledgeRuntimeStore(tornFile).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
  });

  it("treats exact ledger replay as a byte- and revision-preserving no-op", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const later = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    later.revision += 1;
    later.activeTransaction = null;
    later.manifests = later.manifests.map((slot) => ({
      ...slot,
      value: {
        ...(slot.value as SourceManifest),
        revision: (slot.value as SourceManifest).revision + 1,
      },
    }));
    harness.file.replaceContent(JSON.stringify(later));
    const committed = await harness.file.read();

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    expect(await harness.file.read()).toBe(committed);
  });

  it("rejects a ledgered transaction id before publishing a new prepared journal", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    await harness.runtime.clearActiveTransaction({
      transactionId: harness.journal.transactionId,
      revision: harness.journal.revision,
    });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const manifest = state.manifests[0].value as SourceManifest;
    const prepared: ChangeSetTransactionJournal = {
      ...createPreparedApplyJournal(
        manifest,
        "transaction-new-payload",
        harness.journal.jobClaim.inputRevision + 1
      ),
      transactionId: harness.journal.transactionId,
    };
    const before = await harness.file.read();

    await expect(
      new KnowledgeRuntimeTransactionStorage(harness.runtime).writeActive(prepared, null)
    ).rejects.toBeInstanceOf(KnowledgeApplyCommitLedgerConflictError);
    expect(await harness.file.read()).toBe(before);
  });

  it("converges after the atomic file commits both artifacts and then rejects", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    harness.file.throwAfterCommitOnNextWrite();

    await expect(harness.port.recordCommitted(harness.journal, harness.receipt)).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    const committed = await harness.file.read();
    expect(JSON.parse(committed)).toMatchObject({
      manifests: [{ value: { revision: 2 } }],
      applyCommits: [{ transactionId: harness.journal.transactionId }],
    });

    await harness.port.recordCommitted(harness.journal, harness.receipt);
    expect(await harness.file.read()).toBe(committed);
  });

  it("serializes concurrent exact commits into one Manifest revision and one ledger record", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());

    await Promise.all([
      harness.port.recordCommitted(harness.journal, harness.receipt),
      harness.port.recordCommitted(harness.journal, harness.receipt),
    ]);

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(state.revision).toBe(11);
    expect((state.manifests[0].value as SourceManifest).revision).toBe(2);
    expect(state.applyCommits).toHaveLength(1);
  });

  it("fails closed when one transaction id is reused for a different exact identity", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const before = await harness.file.read();
    const conflictingIntent: ManifestCommitIntent = {
      ...harness.journal.manifestCommitIntent,
      sourceContentHash: HASH_B,
    };
    const conflictingJournal: ChangeSetTransactionJournal & { phase: "committed" } = {
      ...harness.journal,
      manifestCommitIntent: conflictingIntent,
      manifestCommitIntentDigest: createManifestCommitIntentDigest(conflictingIntent),
      jobClaim: { ...harness.journal.jobClaim, sourceContentHash: HASH_B },
    };
    const conflictingReceipt = createTransactionCommitReceipt(conflictingJournal);

    await expect(
      harness.port.recordCommitted(conflictingJournal, conflictingReceipt)
    ).rejects.toBeInstanceOf(KnowledgeApplyCommitLedgerConflictError);
    expect(await harness.file.read()).toBe(before);
  });

  it("fails closed when the actual Manifest no longer matches the accepted read-set", async () => {
    const manifest = createRegisteredManifest();
    const harness = await createApplyHarness(manifest);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.manifests = [
      { bundleId: "personal", value: { ...manifest, revision: manifest.revision + 1 } },
    ];
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    await expect(
      harness.port.recordCommitted(harness.journal, harness.receipt)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitManifestConflictError.name,
      reason: "intent_invalid",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("requires every new commit to advance runtime-owned source input revision metadata", async () => {
    const oldContent = "# Old\n";
    const manifest = createRegisteredManifest(2, {
      lastSuccessful: {
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        generatedPages: [
          {
            path: "Wiki/Old.md",
            ownership: "generated",
            contentHash: createFileContentHash(oldContent),
          },
        ],
        changeSetId: "changeset-old",
        completedAt: 120,
      },
      extensions: {
        [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
          version: 1,
          inputRevision: 5,
          transactionId: "transaction-old",
          manifestIntentDigest: HASH_A,
        },
      },
    });
    const proof = createCommittedApplyProof(manifest, "transaction-next", 5);
    const harness = await createApplyHarness(manifest, proof);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.applyCommits = [
      {
        transactionId: "transaction-old",
        commitRevision: 4,
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 5,
        changeSetId: "changeset-old",
        changeSetDigest: HASH_A,
        manifestIntentDigest: HASH_A,
        journalDigest: HASH_A,
        receiptDigest: HASH_B,
        manifestBeforeRevision: 1,
        manifestBeforeDigest: HASH_A,
        manifestAfterRevision: 2,
        manifestAfterDigest: createSourceManifestDigest(manifest),
        recordedAt: 120,
      },
    ];
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    await expect(
      harness.port.recordCommitted(harness.journal, harness.receipt)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitManifestConflictError.name,
      reason: "input_revision_not_newer",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("re-proves the exact active committed journal inside the atomic transform", async () => {
    const manifest = createRegisteredManifest();
    const harness = await createApplyHarness(manifest);
    const other = createCommittedApplyProof(manifest, "transaction-other");
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.activeTransaction = other.journal;
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    await expect(
      harness.port.recordCommitted(harness.journal, harness.receipt)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitProofError.name,
      reason: "active_journal_mismatch",
    });
    expect(await harness.file.read()).toBe(before);
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

  it("does not publish a prepared journal after its Manifest read-set becomes stale", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-stale-prepare");
    const renamed: SourceManifest = {
      ...manifest,
      revision: 2,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        sourcePath: "Sources/Renamed.md",
        sourceKey: "sources/renamed.md",
      })),
    };
    await harness.manifest.write("personal", renamed, 1);
    const before = await harness.file.read();

    await expect(harness.transaction.writeActive(prepared, null)).rejects.toMatchObject({
      name: KnowledgeApplyCommitManifestConflictError.name,
      reason: "intent_invalid",
    });
    expect(await harness.file.read()).toBe(before);
    await expect(harness.transaction.readActive()).resolves.toBeNull();
  });

  it("does not reserve an apply whose source input revision is already committed", async () => {
    const oldContent = "# Old\n";
    const manifest = createRegisteredManifest(2, {
      lastSuccessful: {
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        generatedPages: [
          {
            path: "Wiki/Old.md",
            ownership: "generated",
            contentHash: createFileContentHash(oldContent),
          },
        ],
        changeSetId: "changeset-old",
        completedAt: 120,
      },
      extensions: {
        [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
          version: 1,
          inputRevision: 5,
          transactionId: "transaction-old",
          manifestIntentDigest: HASH_A,
        },
      },
    });
    const prepared = createPreparedApplyJournal(manifest, "transaction-duplicate-input", 5);
    const file = new MemoryAtomicRuntimeFile();
    const runtime = new KnowledgeRuntimeStore(file);
    await runtime.initialize();
    const state: KnowledgeRuntimeStoreSnapshot = {
      ...createEmptyKnowledgeRuntimeStoreSnapshot(),
      revision: 8,
      manifests: [{ bundleId: "personal", value: manifest }],
      applyCommits: [
        createHistoricalLedgerRecord(
          "transaction-old",
          "source-1",
          5,
          "changeset-old",
          120,
          2,
          createSourceManifestDigest(manifest)
        ),
      ],
    };
    file.replaceContent(JSON.stringify(state));
    const before = await file.read();
    const transaction = new KnowledgeRuntimeTransactionStorage(runtime);

    await expect(transaction.writeActive(prepared, null)).rejects.toMatchObject({
      name: KnowledgeApplyCommitManifestConflictError.name,
      reason: "input_revision_not_newer",
    });
    expect(await file.read()).toBe(before);
    await expect(transaction.readActive()).resolves.toBeNull();
  });

  it("blocks ordinary Manifest writes throughout every active transaction phase", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-reservation");
    const candidate: SourceManifest = {
      ...manifest,
      revision: 2,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        sourcePath: "Sources/Renamed.md",
        sourceKey: "sources/renamed.md",
      })),
    };
    await harness.transaction.writeActive(prepared, null);

    const phases: ChangeSetTransactionJournal[] = [
      prepared,
      { ...prepared, revision: 1, phase: "applying", updatedAt: 210 },
      {
        ...prepared,
        revision: 2,
        phase: "applying",
        appliedCount: prepared.targets.length,
        updatedAt: 230,
      },
      {
        ...prepared,
        revision: 3,
        phase: "committed",
        appliedCount: prepared.targets.length,
        committedAt: 240,
        updatedAt: 240,
      },
    ];
    for (let index = 0; index < phases.length; index += 1) {
      if (index > 0) {
        const previous = phases[index - 1];
        await harness.transaction.writeActive(phases[index], {
          transactionId: previous.transactionId,
          revision: previous.revision,
        });
      }
      const before = await harness.file.read();
      await expect(harness.manifest.write("personal", candidate, 1)).rejects.toMatchObject({
        name: KnowledgeRuntimeManifestReservationError.name,
        transactionId: prepared.transactionId,
      });
      expect(await harness.file.read()).toBe(before);
    }
  });

  it("makes the atomic apply adapter the only writer of Manifest success state", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const successCandidate: SourceManifest = {
      ...manifest,
      revision: 2,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        lastSuccessful: {
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          generatedPages: [
            { path: "Wiki/Bypass.md", ownership: "generated" as const, contentHash: HASH_A },
          ],
          changeSetId: "changeset-bypass",
          completedAt: 100,
        },
      })),
    };
    const before = await harness.file.read();

    await expect(harness.manifest.write("personal", successCandidate, 1)).rejects.toMatchObject({
      name: KnowledgeRuntimeManifestProtectedStateError.name,
      state: "last_successful",
    });
    expect(await harness.file.read()).toBe(before);

    const reservedCandidate: SourceManifest = {
      ...manifest,
      revision: 2,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        extensions: {
          [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
            version: 1,
            inputRevision: 1,
            transactionId: "transaction-bypass",
            manifestIntentDigest: HASH_A,
          },
        },
      })),
    };
    await expect(harness.manifest.write("personal", reservedCandidate, 1)).rejects.toMatchObject({
      name: KnowledgeRuntimeManifestProtectedStateError.name,
      state: "reserved_commit_extension",
    });
    expect(await harness.file.read()).toBe(before);

    const repository = new SourceManifestRepository(harness.manifest);
    await expect(
      repository.recordSuccessfulCompile("personal", "source-1", {
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        generatedPages: [{ path: "Wiki/Bypass.md", ownership: "generated", contentHash: HASH_A }],
        changeSetId: "changeset-repository-bypass",
        completedAt: 101,
      })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeManifestProtectedStateError);
    expect(await harness.file.read()).toBe(before);

    const firstCreation = await createHarness();
    const firstSuccess: SourceManifest = { ...successCandidate, revision: 1 };
    const firstBefore = await firstCreation.file.read();
    await expect(
      firstCreation.manifest.write("personal", firstSuccess, null)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeManifestProtectedStateError);
    expect(await firstCreation.file.read()).toBe(firstBefore);
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
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const first = createPreparedApplyJournal(manifest, "transaction-1");
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
    await expect(
      harness.transaction.clearActive({ transactionId: first.transactionId, revision: 1 })
    ).rejects.toBeInstanceOf(TypeError);
    const committed: ChangeSetTransactionJournal = {
      ...applying,
      revision: 3,
      phase: "committed",
      appliedCount: applying.targets.length,
      updatedAt: 240,
      committedAt: 240,
    };
    const progressed: ChangeSetTransactionJournal = {
      ...applying,
      revision: 2,
      appliedCount: applying.targets.length,
      updatedAt: 230,
    };
    await harness.transaction.writeActive(progressed, {
      transactionId: applying.transactionId,
      revision: applying.revision,
    });
    await harness.transaction.writeActive(committed, {
      transactionId: progressed.transactionId,
      revision: progressed.revision,
    });
    await harness.transaction.clearActive({ transactionId: first.transactionId, revision: 3 });
    await expect(harness.transaction.readActive()).resolves.toBeNull();

    const second = createPreparedApplyJournal(manifest, "transaction-2");
    await harness.transaction.writeActive(second, null);
    await expect(
      harness.transaction.clearActive({ transactionId: first.transactionId, revision: 1 })
    ).rejects.toMatchObject({
      name: TransactionStorageRevisionConflictError.name,
      actualToken: { transactionId: second.transactionId, revision: 0 },
    });
    await expect(harness.transaction.readActive()).resolves.toEqual(second);
  });

  it("enforces prepared creation, immutable payload, and legal transaction phase transitions", async () => {
    const initial = await createHarness();
    const manifest = createRegisteredManifest();
    await initial.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-state-machine");
    const invalidInitial: ChangeSetTransactionJournal = {
      ...prepared,
      phase: "applying",
    };
    const initialBefore = await initial.file.read();

    await expect(initial.transaction.writeActive(invalidInitial, null)).rejects.toBeInstanceOf(
      TypeError
    );
    expect(await initial.file.read()).toBe(initialBefore);

    await initial.transaction.writeActive(prepared, null);
    const beforeReplacement = await initial.file.read();
    const payloadDrift: ChangeSetTransactionJournal = {
      ...prepared,
      revision: 1,
      phase: "applying",
      updatedAt: prepared.updatedAt + 1,
      jobClaim: { ...prepared.jobClaim, jobId: "job-other" },
    };
    await expect(
      initial.transaction.writeActive(payloadDrift, {
        transactionId: prepared.transactionId,
        revision: prepared.revision,
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(await initial.file.read()).toBe(beforeReplacement);

    const skippedCommit: ChangeSetTransactionJournal = {
      ...prepared,
      revision: 1,
      phase: "committed",
      appliedCount: prepared.targets.length,
      updatedAt: prepared.updatedAt + 1,
      committedAt: prepared.updatedAt + 1,
    };
    await expect(
      initial.transaction.writeActive(skippedCommit, {
        transactionId: prepared.transactionId,
        revision: prepared.revision,
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(await initial.file.read()).toBe(beforeReplacement);

    const applying: ChangeSetTransactionJournal = {
      ...prepared,
      revision: 1,
      phase: "applying",
      updatedAt: prepared.updatedAt + 1,
    };
    await initial.transaction.writeActive(applying, {
      transactionId: prepared.transactionId,
      revision: prepared.revision,
    });
    const beforePrematureCommit = await initial.file.read();
    const prematureCommit: ChangeSetTransactionJournal = {
      ...applying,
      revision: 2,
      phase: "committed",
      appliedCount: applying.targets.length,
      updatedAt: applying.updatedAt + 1,
      committedAt: applying.updatedAt + 1,
    };
    await expect(
      initial.transaction.writeActive(prematureCommit, {
        transactionId: applying.transactionId,
        revision: applying.revision,
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(await initial.file.read()).toBe(beforePrematureCommit);
  });

  it("rejects an applying journal that skips durable target progress", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createTwoTargetPreparedApplyJournal(manifest, "transaction-progress-skip");
    await harness.transaction.writeActive(prepared, null);
    const applying: ChangeSetTransactionJournal = {
      ...prepared,
      revision: 1,
      phase: "applying",
      updatedAt: prepared.updatedAt + 1,
    };
    await harness.transaction.writeActive(applying, {
      transactionId: prepared.transactionId,
      revision: prepared.revision,
    });
    const before = await harness.file.read();
    const skippedProgress: ChangeSetTransactionJournal = {
      ...applying,
      revision: 2,
      appliedCount: applying.appliedCount + 2,
      updatedAt: applying.updatedAt + 1,
    };

    await expect(
      harness.transaction.writeActive(skippedProgress, {
        transactionId: applying.transactionId,
        revision: applying.revision,
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(await harness.file.read()).toBe(before);
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
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      changeSetId: "changeset-1",
      changeSetDigest: HASH_A,
      manifestIntentDigest: HASH_B,
      journalDigest: HASH_B,
      receiptDigest: HASH_A,
      manifestBeforeRevision: 0,
      manifestBeforeDigest: HASH_A,
      manifestAfterRevision: 1,
      manifestAfterDigest: HASH_B,
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
      {
        name: "duplicate Manifest commit revision",
        value: {
          ...base,
          applyCommits: [commit, { ...commit, transactionId: "transaction-2", inputRevision: 2 }],
        },
      },
      {
        name: "non-monotonic source commit revision",
        value: {
          ...base,
          applyCommits: [
            commit,
            {
              ...commit,
              transactionId: "transaction-2",
              manifestBeforeRevision: 1,
              manifestBeforeDigest: HASH_B,
              manifestAfterRevision: 2,
              manifestAfterDigest: HASH_A,
            },
          ],
        },
      },
      {
        name: "unchanged Manifest commit digest",
        value: {
          ...base,
          applyCommits: [{ ...commit, manifestAfterDigest: commit.manifestBeforeDigest }],
        },
      },
      { name: "unknown top-level field", value: { ...base, unexpected: true } },
      { name: "unsupported version", value: { ...base, version: 3 } },
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
