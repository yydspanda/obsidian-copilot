import {
  ChangeSetTransaction,
  createTransactionCommitReceipt,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ALL_KNOWLEDGE_FILE_MUTATIONS,
  type ChangeSetValidator,
  type KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  TRANSACTION_JOURNAL_VERSION,
  TransactionStorageRevisionConflictError,
  createChangeSetTransactionDigest,
  type ChangeSetTransactionJournal,
} from "@/knowledge/changeset/TransactionStorage";
import { IngestQueue, type IngestExecutor } from "@/knowledge/ingest/queue/IngestQueue";
import { SourceObservationHandoff } from "@/knowledge/ingest/SourceObservationHandoff";
import {
  KnowledgeIngestExecutionAuthorityBinder,
  KnowledgeIngestExecutionAuthorityError,
  type KnowledgeIngestExecutionAuthority,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
  type ManifestCommitPlan,
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
import { createNoJournalApplyRecoveryReference } from "@/knowledge/recovery/NoJournalApplyRecovery";
import type { KnowledgeStartupReleaseRequest } from "@/knowledge/recovery/KnowledgeStartupRelease";
import {
  ReviewStorageRevisionConflictError,
  type ChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeApplyCommitAuthorityError,
  KnowledgeApplyCommitLedgerConflictError,
  KnowledgeApplyCommitManifestConflictError,
  KnowledgeApplyCommitProofError,
  KnowledgeNoJournalApplyRecoveryConflictError,
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeAtomicWriteError,
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeIngestExecutionProofError,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeManifestProtectedStateError,
  KnowledgeRuntimeManifestReservationError,
  KnowledgeRuntimeMigrationUnsafeError,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueObservationAuthorityError,
  KnowledgeRuntimeQueueRecoveryGateProtectedError,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStartupReleasePort,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeStoreCorruptError,
  KnowledgeRuntimeTransactionStorage,
  KNOWLEDGE_RUNTIME_STORE_VERSION,
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  SourceInputCaptureConflictError,
  SourceInputObservationBindingConflictError,
  SourceInputObservationTokenError,
  SourceInputRevisionOverflowError,
  createEmptyKnowledgeRuntimeStoreSnapshot,
  type KnowledgeApplyCommitLedgerRecord,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
let captureSequence = 0;

/** Creates one distinct retry identity for a source-observation allocation. */
function createCaptureRequest(bundleId = "personal", sourceId = "source-1") {
  captureSequence += 1;
  return { bundleId, sourceId, captureId: `capture-${captureSequence}` };
}

/** In-memory atomic file that serializes synchronous transforms for unit tests. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();
  private misreportNextWrite = false;
  private repeatNextTransform = false;
  private skipNextTransform = false;
  private throwAfterCommitCountdown = 0;

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
      if (this.throwAfterCommitCountdown > 0) {
        this.throwAfterCommitCountdown -= 1;
      }
      if (this.throwAfterCommitCountdown === 0 && this.throwAfterCommitArmed) {
        this.throwAfterCommitArmed = false;
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
    this.throwAfterCommitOnNthWrite(1);
  }

  private throwAfterCommitArmed = false;

  /** Commits and rejects the selected future process boundary. */
  throwAfterCommitOnNthWrite(writeNumber: number): void {
    this.throwAfterCommitCountdown = writeNumber;
    this.throwAfterCommitArmed = true;
  }
}

/** Creates one empty valid queue snapshot at a caller-selected revision. */
function createQueueSnapshot(revision: number, bundleId = "personal"): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision,
    control: { status: "running" as const },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
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
      acceptedReview: {
        proposalDigest: HASH_A,
        recordRevision: 1,
        manifestCommitIntentDigest: HASH_A,
        acceptedAt: 110,
      },
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

/**
 * Reconstructs the proposal-time plan authorized by one synthetic ChangeSet.
 *
 * @param manifest - Exact Manifest read-set before the source compile
 * @param changeSet - Proposed or accepted source compile payload
 * @param inputRevision - Durable source observation revision
 * @returns Strict plan whose digest can bind Review and transaction fixtures
 */
function createManifestCommitPlanFixture(
  manifest: SourceManifest,
  changeSet: KnowledgeChangeSet,
  inputRevision: number
): ManifestCommitPlan {
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  if (!source) {
    throw new Error("Expected a registered source fixture");
  }
  const baseGeneratedPages = (source.lastSuccessful?.generatedPages ?? []).map((page) => {
    if (!page.contentHash) {
      throw new Error("Expected content-addressed generated page fixture");
    }
    return { path: page.path, ownership: page.ownership, contentHash: page.contentHash };
  });
  return {
    version: 1,
    kind: "source_compile",
    bundleId: manifest.bundleId,
    sourceId: source.sourceId,
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision,
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    baseGeneratedPages,
    mutations: changeSet.changes.map((change) => {
      const base = baseGeneratedPages.find(
        (page) => toWindowsPathKey(page.path) === toWindowsPathKey(change.path)
      );
      return {
        changeId: change.id,
        path: change.path,
        operation: change.operation,
        access: base ? ("authorized" as const) : ("create_only" as const),
        ownership: base?.ownership ?? ("generated" as const),
        wasTrackedByPrimarySource: base !== undefined,
      };
    }),
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
  const manifestCommitPlan = createManifestCommitPlanFixture(
    manifest,
    prepared.changeSet,
    inputRevision
  );
  const manifestCommitIntent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
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
  const changes = [...prepared.changeSet.changes, secondChange].sort((left, right) => {
    const leftKey = toWindowsPathKey(left.path);
    const rightKey = toWindowsPathKey(right.path);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const changeSet: KnowledgeChangeSet = {
    ...prepared.changeSet,
    changes,
  };
  const manifestCommitPlan = createManifestCommitPlanFixture(
    manifest,
    changeSet,
    prepared.jobClaim.inputRevision
  );
  const manifestCommitIntent: ManifestCommitIntent = {
    ...prepared.manifestCommitIntent,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
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
  const manifestCommitPlan = createManifestCommitPlanFixture(manifest, changeSet, 2);
  const intent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 2,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
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
      startedAt: 230,
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
    createdAt: 230,
    updatedAt: 240,
    phase: "committed",
    committedAt: 240,
  };
  return { journal, receipt: createTransactionCommitReceipt(journal) };
}

/**
 * Creates exact Queue, Review, and allocator slots for one transaction proof.
 *
 * @param manifest - Manifest used to reconstruct the immutable review plan
 * @param journal - Transaction whose apply authority must remain durable
 * @returns Shared-runtime slots accepted by the final atomic proof
 */
function createApplyAuthoritySlots(
  manifest: SourceManifest,
  journal: ChangeSetTransactionJournal
): Pick<KnowledgeRuntimeStoreSnapshot, "queues" | "reviews" | "inputRevisions"> {
  const proposal: KnowledgeChangeSet = { ...journal.changeSet, status: "proposed" };
  const plan = createManifestCommitPlanFixture(manifest, proposal, journal.jobClaim.inputRevision);
  const planDigest = createManifestCommitPlanDigest(plan);
  if (planDigest !== journal.manifestCommitIntent.manifestCommitPlanDigest) {
    throw new Error("Expected journal fixture to retain its exact Review plan digest");
  }
  const recordedAt = Math.max(proposal.createdAt, journal.jobClaim.startedAt - 20);
  const acceptedAt = Math.max(recordedAt, journal.jobClaim.startedAt - 10);
  if (acceptedAt > journal.jobClaim.startedAt) {
    throw new Error("Expected Review acceptance to precede the applying claim");
  }
  const proposalDigest = createChangeSetTransactionDigest(proposal);
  const review: ChangeSetReviewSnapshot = {
    version: 2,
    bundleId: journal.bundleId,
    revision: 1,
    records: [
      {
        changeSetId: journal.changeSetId,
        proposal,
        proposalDigest,
        manifestCommitPlan: plan,
        manifestCommitPlanDigest: planDigest,
        jobClaim: {
          jobId: journal.jobClaim.jobId,
          sourceId: journal.jobClaim.sourceId,
          sourceContentHash: journal.jobClaim.sourceContentHash,
          pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
          inputRevision: journal.jobClaim.inputRevision,
          attempt: journal.jobClaim.attempt,
        },
        recordedAt,
        outcome: "accepted",
        recordRevision: 1,
        acceptedChangeSet: journal.changeSet,
        acceptedDigest: journal.changeSetDigest,
        manifestCommitIntent: journal.manifestCommitIntent,
        manifestCommitIntentDigest: journal.manifestCommitIntentDigest,
        acceptedAt,
      },
    ],
  };
  const queue: IngestQueueSnapshot = {
    version: INGEST_QUEUE_VERSION,
    bundleId: journal.bundleId,
    revision: 1,
    control: { status: "running" },
    jobs: [
      {
        id: journal.jobClaim.jobId,
        bundleId: journal.bundleId,
        sourceId: journal.jobClaim.sourceId,
        sourceContentHash: journal.jobClaim.sourceContentHash,
        pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
        inputRevision: journal.jobClaim.inputRevision,
        attempt: journal.jobClaim.attempt,
        rerunRequested: false,
        createdAt: Math.min(proposal.createdAt, recordedAt),
        updatedAt: journal.jobClaim.startedAt,
        status: "processing",
        stage: "applying",
        startedAt: journal.jobClaim.startedAt,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId: journal.jobClaim.sourceId,
        sourceContentHash: journal.jobClaim.sourceContentHash,
        pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
        inputRevision: journal.jobClaim.inputRevision,
        observedAt: recordedAt,
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
    applyClaim: {
      ...journal.jobClaim,
      reviewedChangeSet: {
        changeSetId: journal.changeSetId,
        changeSetDigest: journal.changeSetDigest,
      },
      acceptedReview: {
        proposalDigest,
        recordRevision: 1,
        manifestCommitIntentDigest: journal.manifestCommitIntentDigest,
        acceptedAt,
      },
    },
  };
  return {
    queues: [{ bundleId: journal.bundleId, value: queue }],
    reviews: [{ bundleId: journal.bundleId, value: review }],
    inputRevisions: [
      {
        bundleId: journal.bundleId,
        sources: [
          {
            sourceId: journal.jobClaim.sourceId,
            inputRevision: journal.jobClaim.inputRevision,
            managedAfterRevision: journal.jobClaim.inputRevision,
            legacyCheckpoint: queue.sourceHighWatermarks[0],
            observations: [],
          },
        ],
      },
    ],
  };
}

/**
 * Creates the Queue hand-off retained after Manifest success and before journal acknowledgement.
 *
 * @param journal - Exact committed transaction journal
 * @param receipt - Exact commit receipt derived from the journal
 * @param markerOverrides - Optional marker fields used by corruption tests
 * @returns Strict completed Queue snapshot with one pending acknowledgement marker
 */
function createPendingApplyCommitQueue(
  journal: ChangeSetTransactionJournal & { phase: "committed" },
  receipt: TransactionCommitReceipt,
  markerOverrides: Partial<NonNullable<IngestQueueSnapshot["applyCommit"]>> = {}
): IngestQueueSnapshot {
  const completedAt = Math.max(receipt.committedAt, journal.jobClaim.startedAt);
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: journal.bundleId,
    revision: 2,
    control: { status: "paused", reason: "commit_pending_ack", pausedAt: completedAt },
    jobs: [
      {
        id: journal.jobClaim.jobId,
        bundleId: journal.bundleId,
        sourceId: journal.jobClaim.sourceId,
        sourceContentHash: journal.jobClaim.sourceContentHash,
        pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
        inputRevision: journal.jobClaim.inputRevision,
        attempt: journal.jobClaim.attempt,
        rerunRequested: false,
        createdAt: Math.min(journal.changeSet.createdAt, journal.jobClaim.startedAt),
        updatedAt: completedAt,
        status: "completed",
        stage: "completed",
        changeSetId: journal.changeSetId,
        completedAt,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId: journal.jobClaim.sourceId,
        sourceContentHash: journal.jobClaim.sourceContentHash,
        pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
        inputRevision: journal.jobClaim.inputRevision,
        observedAt: Math.max(journal.changeSet.createdAt, journal.jobClaim.startedAt - 20),
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
    applyCommit: {
      transactionId: receipt.transactionId,
      changeSetId: receipt.changeSetId,
      changeSetDigest: receipt.changeSetDigest,
      commitRevision: receipt.commitRevision,
      ...receipt.jobClaim,
      committedAt: receipt.committedAt,
      ...markerOverrides,
    },
  };
}

/**
 * Creates a runtime-v2 envelope whose active transaction still depends on
 * version-3 reviewed Queue authority that cannot prove its Manifest intent.
 *
 * @param manifest - Exact transaction Manifest read-set
 * @param journal - Prepared or applying active transaction
 * @returns Strict outer envelope containing a legacy Queue-v3 slot
 */
function createLegacyReviewedActiveState(
  manifest: SourceManifest,
  journal: ChangeSetTransactionJournal & { phase: "prepared" | "applying" }
): KnowledgeRuntimeStoreSnapshot {
  const authority = createApplyAuthoritySlots(manifest, journal);
  const queue = authority.queues[0].value as IngestQueueSnapshot;
  const claim = queue.applyClaim;
  if (!claim?.acceptedReview) {
    throw new Error("Expected reviewed apply authority fixture");
  }
  const { applyAbandonments: _applyAbandonments, ...queueBeforeAbandonmentHistory } = queue;
  const { manifestCommitIntentDigest: _manifestCommitIntentDigest, ...legacyAcceptedReview } =
    claim.acceptedReview;
  void _applyAbandonments;
  void _manifestCommitIntentDigest;
  const legacyQueue = {
    ...queueBeforeAbandonmentHistory,
    version: 3,
    applyClaim: {
      ...claim,
      acceptedReview: legacyAcceptedReview,
    },
  };
  return {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(),
    ...authority,
    queues: [{ bundleId: journal.bundleId, value: legacyQueue }],
    manifests: [{ bundleId: manifest.bundleId, value: manifest }],
    activeTransaction: journal,
  };
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
  const authority = createApplyAuthoritySlots(manifest, proof.journal);
  const state: KnowledgeRuntimeStoreSnapshot = {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(),
    ...authority,
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
  recovery: KnowledgeRuntimeNoJournalApplyRecoveryPort;
  release: KnowledgeRuntimeStartupReleasePort;
  transaction: KnowledgeRuntimeTransactionStorage;
  revisions: KnowledgeRuntimeInputRevisionAllocator;
  observations: KnowledgeRuntimeInputObservationBinder;
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
    recovery: new KnowledgeRuntimeNoJournalApplyRecoveryPort(runtime),
    release: new KnowledgeRuntimeStartupReleasePort(runtime),
    transaction: new KnowledgeRuntimeTransactionStorage(runtime),
    revisions: new KnowledgeRuntimeInputRevisionAllocator(runtime),
    observations: new KnowledgeRuntimeInputObservationBinder(runtime),
  };
}

/** Reads the current exact optimistic token for one startup release attempt. */
async function createStartupReleaseRequest(
  harness: { file: MemoryAtomicRuntimeFile },
  bundleId = "personal"
): Promise<KnowledgeStartupReleaseRequest> {
  const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
  const queue = state.queues.find((slot) => slot.bundleId === bundleId)?.value as
    | IngestQueueSnapshot
    | undefined;
  const review = state.reviews.find((slot) => slot.bundleId === bundleId)?.value as
    | ChangeSetReviewSnapshot
    | undefined;
  return {
    bundleId,
    expectedRuntimeRevision: state.revision,
    expectedReviewRevision: review?.revision ?? 0,
    expectedQueueRevision: queue?.revision ?? 0,
  };
}

/** Creates one empty Queue held behind the startup recovery gate. */
function createStartupPausedQueue(revision: number, bundleId = "personal"): IngestQueueSnapshot {
  return {
    ...createQueueSnapshot(revision, bundleId),
    control: { status: "paused", reason: "startup_recovery", pausedAt: 100 },
  };
}

/**
 * Persists the exact reviewed Queue/Review/allocator authority for a prepared journal.
 *
 * @param harness - Initialized shared-runtime test facades
 * @param manifest - Manifest used by the journal's immutable review plan
 * @param journal - Prepared journal that will reserve the global transaction slot
 */
async function persistPreparedApplyAuthority(
  harness: Awaited<ReturnType<typeof createHarness>>,
  manifest: SourceManifest,
  journal: ChangeSetTransactionJournal
): Promise<void> {
  const authority = createApplyAuthoritySlots(manifest, journal);
  const queue = authority.queues[0].value as IngestQueueSnapshot;
  const review = authority.reviews[0].value as ChangeSetReviewSnapshot;
  const currentQueue = (await harness.queue.read(journal.bundleId)) as IngestQueueSnapshot | null;
  const currentReview = (await harness.review.read(
    journal.bundleId
  )) as ChangeSetReviewSnapshot | null;
  const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
  const allocated =
    state.inputRevisions
      .find((candidate) => candidate.bundleId === journal.bundleId)
      ?.sources.find((candidate) => candidate.sourceId === journal.jobClaim.sourceId)
      ?.inputRevision ?? 0;
  let observationToken: string | undefined;
  for (
    let inputRevision = allocated;
    inputRevision < journal.jobClaim.inputRevision;
    inputRevision += 1
  ) {
    const allocation = await harness.revisions.allocate({
      bundleId: journal.bundleId,
      sourceId: journal.jobClaim.sourceId,
      captureId: `authority-${journal.transactionId}-${inputRevision + 1}`,
    });
    if (allocation.inputRevision === journal.jobClaim.inputRevision) {
      observationToken = allocation.observationToken;
      await harness.observations.bind({
        observationToken: allocation.observationToken,
        sourceContentHash: journal.jobClaim.sourceContentHash,
        pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
      });
    }
  }

  queue.revision = (currentQueue?.revision ?? 0) + 1;
  review.revision = (currentReview?.revision ?? 0) + 1;
  await harness.queue.write(
    journal.bundleId,
    queue,
    currentQueue?.revision ?? null,
    observationToken === undefined ? undefined : { kind: "source_observation", observationToken }
  );
  await harness.review.write(journal.bundleId, review, currentReview?.revision ?? null);
}

/**
 * Reconstructs the startup-safe identity retained by one accepted Review record.
 *
 * @param review - Strict review snapshot containing exactly one accepted record
 * @returns Detached identity suitable for no-journal classification
 */
function createAcceptedStartupIdentity(
  review: ChangeSetReviewSnapshot
): AcceptedReviewStartupIdentity {
  const record = review.records[0];
  if (!record || record.outcome !== "accepted") {
    throw new Error("Expected one accepted Review record fixture");
  }
  return {
    bundleId: review.bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    recordedAt: record.recordedAt,
    acceptedDigest: record.acceptedDigest,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/**
 * Creates exact accepted Queue, Review, Manifest, and allocator state without a journal.
 *
 * @param transactionId - Fixture namespace used by the accepted ChangeSet
 * @returns Initialized runtime facades plus the durable startup identity and source proof
 */
async function createNoJournalRecoveryHarness(transactionId = "transaction-no-journal") {
  const harness = await createHarness();
  const manifest = createRegisteredManifest();
  const journal = createPreparedApplyJournal(manifest, transactionId);
  const authority = createApplyAuthoritySlots(manifest, journal);
  const review = authority.reviews[0].value as ChangeSetReviewSnapshot;
  const state: KnowledgeRuntimeStoreSnapshot = {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(),
    ...authority,
    revision: 10,
    manifests: [{ bundleId: manifest.bundleId, value: manifest }],
    activeTransaction: null,
  };
  harness.file.replaceContent(JSON.stringify(state));
  return {
    ...harness,
    identity: createAcceptedStartupIdentity(review),
    journal,
    manifest,
  };
}

/**
 * Converts the exact applying Queue attempt into startup-recovered failed state.
 *
 * @param state - Runtime snapshot carrying one applying no-journal attempt
 * @param recoveredAt - Monotonic startup recovery timestamp
 */
function markNoJournalApplyFailed(state: KnowledgeRuntimeStoreSnapshot, recoveredAt: number): void {
  const queue = state.queues[0].value as IngestQueueSnapshot;
  const applying = queue.jobs[0];
  queue.revision += 1;
  queue.control = {
    status: "paused",
    reason: "recovery_required",
    pausedAt: recoveredAt,
    detail: "An interrupted apply must be recovered before queue resume",
  };
  queue.jobs = [
    {
      ...applying,
      rerunRequested: false,
      updatedAt: recoveredAt,
      status: "failed",
      stage: "applying",
      failure: {
        code: "interrupted_apply_requires_recovery",
        message: "An interrupted apply requires transaction recovery before retry",
        retryable: false,
        occurredAt: recoveredAt,
      },
    },
  ];
  delete (queue.jobs[0] as unknown as { startedAt?: number }).startedAt;
  state.revision += 1;
}

/**
 * Adds strict v3 observation records for a Queue watermark assembled by an
 * authority-focused fixture instead of the production hand-off facade.
 */
function recordFixtureWatermarkAsConsumed(
  state: KnowledgeRuntimeStoreSnapshot,
  bundleId = "personal"
): void {
  const queue = state.queues.find((slot) => slot.bundleId === bundleId)?.value as
    | IngestQueueSnapshot
    | undefined;
  const bundle = state.inputRevisions.find((candidate) => candidate.bundleId === bundleId);
  if (!queue || !bundle) {
    throw new Error("Expected Queue and allocator fixture");
  }
  for (const watermark of queue.sourceHighWatermarks) {
    const source = bundle.sources.find((candidate) => candidate.sourceId === watermark.sourceId);
    if (!source) {
      throw new Error("Expected source allocator fixture");
    }
    for (
      let inputRevision = source.managedAfterRevision + source.observations.length + 1;
      inputRevision <= source.inputRevision;
      inputRevision += 1
    ) {
      captureSequence += 1;
      const identity = captureSequence.toString(16).padStart(32, "0");
      if (inputRevision < watermark.inputRevision) {
        source.observations.push({
          observationToken: identity,
          captureId: `fixture-superseded-${captureSequence}`,
          inputRevision,
          allocatedAt: watermark.observedAt,
          status: "superseded",
          settledAt: watermark.observedAt,
          supersededByInputRevision: watermark.inputRevision,
        });
      } else if (inputRevision === watermark.inputRevision) {
        source.observations.push({
          observationToken: identity,
          captureId: `fixture-consumed-${captureSequence}`,
          inputRevision,
          allocatedAt: watermark.observedAt,
          status: "consumed",
          sourceContentHash: watermark.sourceContentHash,
          pipelineFingerprint: watermark.pipelineFingerprint,
          boundAt: watermark.observedAt,
          settledAt: watermark.observedAt,
          queueRevision: queue.revision,
        });
      } else {
        source.observations.push({
          observationToken: identity,
          captureId: `fixture-allocated-${captureSequence}`,
          inputRevision,
          allocatedAt: watermark.observedAt,
          status: "allocated",
        });
      }
    }
  }
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

    const migrated = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(migrated.runtimeId).toMatch(/^[a-f0-9]{32}$/);
    expect(migrated).toEqual({
      ...legacy,
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      runtimeId: migrated.runtimeId,
      revision: 8,
      reviews: [
        {
          bundleId: "personal",
          value: { version: 2, bundleId: "personal", revision: 3, records: [] },
        },
      ],
      inputRevisions: [
        {
          bundleId: "personal",
          sources: [
            {
              sourceId: "source-1",
              inputRevision: 9,
              managedAfterRevision: 9,
              observations: [],
            },
          ],
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
        captureId: "migration-next-capture",
      })
    ).resolves.toMatchObject({ inputRevision: 10 });
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

  it("migrates runtime v2 with active authority into a fenced observation journal", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest);
    const authority = createApplyAuthoritySlots(manifest, proof.journal);
    const previous = {
      version: 2,
      revision: 7,
      queues: authority.queues,
      reviews: authority.reviews,
      manifests: [{ bundleId: manifest.bundleId, value: manifest }],
      activeTransaction: proof.journal,
      inputRevisions: [
        {
          bundleId: proof.journal.bundleId,
          sources: [
            {
              sourceId: proof.journal.jobClaim.sourceId,
              inputRevision: proof.journal.jobClaim.inputRevision,
            },
          ],
        },
      ],
      applyCommits: [],
    };
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(previous));
    const runtime = new KnowledgeRuntimeStore(file);

    await runtime.initialize();

    const migrated = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
    const authorityQueue = authority.queues[0].value as IngestQueueSnapshot;
    expect(migrated).toMatchObject({
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      revision: 8,
      activeTransaction: { transactionId: proof.journal.transactionId },
      inputRevisions: [
        {
          bundleId: proof.journal.bundleId,
          sources: [
            {
              sourceId: proof.journal.jobClaim.sourceId,
              inputRevision: 1,
              managedAfterRevision: 1,
              legacyCheckpoint: authorityQueue.sourceHighWatermarks[0],
              observations: [],
            },
          ],
        },
      ],
    });
    await expect(
      new KnowledgeRuntimeInputRevisionAllocator(runtime).allocate({
        bundleId: proof.journal.bundleId,
        sourceId: proof.journal.jobClaim.sourceId,
        captureId: "post-v2-migration-capture",
      })
    ).resolves.toMatchObject({ inputRevision: 2 });
  });

  it("replays a committed v2 migration without generating a second runtime identity", async () => {
    const previous = {
      version: 2,
      revision: 7,
      queues: [],
      reviews: [],
      manifests: [],
      activeTransaction: null,
      inputRevisions: [],
      applyCommits: [],
    };
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(previous));
    file.throwAfterCommitOnNextWrite();
    const runtime = new KnowledgeRuntimeStore(file);

    await expect(runtime.initialize()).rejects.toThrow("Simulated post-commit transport failure");
    const committed = await file.read();
    await expect(runtime.initialize()).resolves.toBeUndefined();

    expect(await file.read()).toBe(committed);
    expect(JSON.parse(committed)).toMatchObject({
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      revision: 8,
    });
  });

  it("fails v2 migration when a Queue watermark has no allocator floor", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest);
    const authority = createApplyAuthoritySlots(manifest, proof.journal);
    const previous = {
      version: 2,
      revision: 7,
      queues: authority.queues,
      reviews: authority.reviews,
      manifests: [{ bundleId: manifest.bundleId, value: manifest }],
      activeTransaction: proof.journal,
      inputRevisions: [],
      applyCommits: [],
    };
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(previous));
    const before = await file.read();

    await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
    expect(await file.read()).toBe(before);
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

  it("classifies exact processing and startup-recovered applying attempts as requiring a decision", async () => {
    const harness = await createNoJournalRecoveryHarness();

    const processing = await harness.recovery.classify(harness.identity);
    expect(processing.kind).toBe("requires_decision");
    if (processing.kind !== "requires_decision") {
      throw new Error("Expected an explicit no-journal recovery decision");
    }
    expect(processing.candidate).toMatchObject({
      bundleId: "personal",
      jobId: harness.journal.jobClaim.jobId,
      changeSetId: harness.journal.changeSetId,
      sourceId: harness.journal.jobClaim.sourceId,
      inputRevision: harness.journal.jobClaim.inputRevision,
      startedAt: harness.journal.jobClaim.startedAt,
    });

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    markNoJournalApplyFailed(state, 220);
    harness.file.replaceContent(JSON.stringify(state));

    await expect(harness.recovery.classify(harness.identity)).resolves.toEqual({
      kind: "requires_decision",
      candidate: processing.candidate,
    });
  });

  it("loads Queue and every accepted classification from one exact runtime snapshot", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const review = (await harness.review.read("personal")) as ChangeSetReviewSnapshot;
    const before = await harness.file.read();

    const loaded = await harness.recovery.loadSnapshot("personal", review.revision);

    expect(loaded).toMatchObject({
      kind: "loaded",
      snapshot: {
        bundleId: "personal",
        runtimeRevision: 10,
        reviewRevision: review.revision,
        queueSnapshot: { bundleId: "personal" },
        classifications: [{ kind: "requires_decision" }],
      },
    });
    await expect(harness.recovery.loadSnapshot("personal", review.revision + 1)).resolves.toEqual({
      kind: "review_revision_changed",
      bundleId: "personal",
      runtimeRevision: 10,
      expectedReviewRevision: review.revision + 1,
      actualReviewRevision: review.revision,
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("returns an atomic revision-zero recovery snapshot before Queue or Review slots exist", async () => {
    const harness = await createHarness();

    await expect(harness.recovery.loadSnapshot("personal", 0)).resolves.toEqual({
      kind: "loaded",
      snapshot: {
        bundleId: "personal",
        runtimeRevision: 0,
        reviewRevision: 0,
        queueSnapshot: createQueueSnapshot(0),
        globalTransaction: null,
        classifications: [],
      },
    });
  });

  it("atomically releases only the exact startup Queue control and revision", async () => {
    const harness = await createHarness();
    const paused = createStartupPausedQueue(1);
    await harness.queue.write("personal", paused, null);
    const request = await createStartupReleaseRequest(harness);
    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "released",
      bundleId: "personal",
      previousRuntimeRevision: before.revision,
      runtimeRevision: before.revision + 1,
      previousQueueRevision: 1,
      queueSnapshot: {
        ...paused,
        revision: 2,
        control: { status: "running" },
      },
    });

    const after = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(after).toEqual({
      ...before,
      revision: before.revision + 1,
      queues: [
        {
          bundleId: "personal",
          value: { ...paused, revision: 2, control: { status: "running" } },
        },
      ],
    });
  });

  it.each(["absent", "running"] as const)(
    "keeps exact Runtime bytes when the target Queue is %s",
    async (mode) => {
      const harness = await createHarness();
      if (mode === "running") {
        await harness.queue.write("personal", createQueueSnapshot(1), null);
      }
      const request = await createStartupReleaseRequest(harness);
      const before = await harness.file.read();

      await expect(harness.release.release(request)).resolves.toMatchObject({
        kind: "unchanged",
        bundleId: "personal",
        reason: mode === "absent" ? "queue_absent" : "already_running",
      });
      expect(await harness.file.read()).toBe(before);
    }
  );

  it.each([
    { boundary: "runtime", field: "expectedRuntimeRevision" },
    { boundary: "review", field: "expectedReviewRevision" },
    { boundary: "queue", field: "expectedQueueRevision" },
  ] as const)(
    "rejects a changed $boundary observation without rewriting bytes",
    async (testCase) => {
      const harness = await createHarness();
      await harness.queue.write("personal", createStartupPausedQueue(1), null);
      const current = await createStartupReleaseRequest(harness);
      const request = { ...current, [testCase.field]: current[testCase.field] + 1 };
      const before = await harness.file.read();

      await expect(harness.release.release(request)).resolves.toEqual({
        kind: "observation_changed",
        bundleId: "personal",
        boundary: testCase.boundary,
      });
      expect(await harness.file.read()).toBe(before);
    }
  );

  it.each(["user", "rate_limit"] as const)(
    "never overwrites a %s pause during startup release",
    async (reason) => {
      const harness = await createHarness();
      const paused: IngestQueueSnapshot = {
        ...createQueueSnapshot(1),
        control: { status: "paused", reason, pausedAt: 100 },
      };
      await harness.queue.write("personal", paused, null);
      const request = await createStartupReleaseRequest(harness);
      const before = await harness.file.read();

      await expect(harness.release.release(request)).resolves.toEqual({
        kind: "blocked",
        bundleId: "personal",
        reason: "queue_pause_not_releasable",
      });
      expect(await harness.file.read()).toBe(before);
    }
  );

  it.each(["running", "user"] as const)(
    "rejects a generic startup-recovery to %s Queue write",
    async (nextControl) => {
      const harness = await createHarness();
      const paused = createStartupPausedQueue(1);
      await harness.queue.write("personal", paused, null);
      const before = await harness.file.read();
      const candidate: IngestQueueSnapshot = {
        ...paused,
        revision: 2,
        control:
          nextControl === "running"
            ? { status: "running" }
            : { status: "paused", reason: "user", pausedAt: 101 },
      };

      await expect(harness.queue.write("personal", candidate, 1)).rejects.toBeInstanceOf(
        KnowledgeRuntimeQueueRecoveryGateProtectedError
      );
      expect(await harness.file.read()).toBe(before);
    }
  );

  it("allows exact recovery strengthening but never a later generic running write", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const currentState = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const currentQueue = currentState.queues[0].value as IngestQueueSnapshot;
    currentQueue.control = { status: "paused", reason: "startup_recovery", pausedAt: 200 };
    harness.file.replaceContent(JSON.stringify(currentState));
    const recoveredState = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    markNoJournalApplyFailed(recoveredState, 220);
    const recoveredQueue = recoveredState.queues[0].value as IngestQueueSnapshot;

    await expect(
      harness.queue.write("personal", recoveredQueue, currentQueue.revision)
    ).resolves.toBeUndefined();
    await expect(harness.queue.read("personal")).resolves.toMatchObject({
      revision: currentQueue.revision + 1,
      control: { status: "paused", reason: "recovery_required" },
      jobs: [expect.objectContaining({ status: "failed", stage: "applying" })],
    });
    const strengthenedBytes = await harness.file.read();
    await expect(
      harness.queue.write(
        "personal",
        createQueueSnapshot(recoveredQueue.revision + 1),
        recoveredQueue.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(strengthenedBytes);
  });

  it("allows watcher rerun bookkeeping without weakening a startup apply claim", async () => {
    const harness = await createNoJournalRecoveryHarness("transaction-startup-rerun");
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const currentQueue = state.queues[0].value as IngestQueueSnapshot;
    currentQueue.control = { status: "paused", reason: "startup_recovery", pausedAt: 200 };
    harness.file.replaceContent(JSON.stringify(state));
    const claim = { ...currentQueue.applyClaim };
    const applying = currentQueue.jobs[0];
    const executor: IngestExecutor = {
      /** Produces no changes; enqueue does not invoke this executor. */
      execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
    };
    const queue = new IngestQueue(harness.queue, executor, {
      clock: () => 300,
      jobIdFactory: () => "job-startup-rerun",
    });
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: applying.sourceId,
      captureId: "startup-rerun-divergent",
    });
    expect(allocation.inputRevision).toBe(applying.inputRevision + 1);
    await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_C,
      pipelineFingerprint: applying.pipelineFingerprint,
    });

    await expect(
      queue.enqueue({
        bundleId: "personal",
        sourceId: applying.sourceId,
        sourceContentHash: HASH_C,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: allocation.inputRevision,
        observationToken: allocation.observationToken,
      })
    ).resolves.toMatchObject({ kind: "rerun_scheduled", job: { id: applying.id } });
    await expect(queue.load("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery", pausedAt: 200 },
      applyClaim: claim,
      jobs: [
        expect.objectContaining({
          id: applying.id,
          status: "processing",
          stage: "applying",
          startedAt: currentQueue.applyClaim?.startedAt,
          rerunRequested: true,
          updatedAt: 300,
        }),
      ],
      reruns: [
        expect.objectContaining({
          jobId: "job-startup-rerun",
          inputRevision: allocation.inputRevision,
        }),
      ],
    });

    const afterEnqueue = await queue.load("personal");
    const beforeRollback = await harness.file.read();
    const originalHighWatermark = currentQueue.sourceHighWatermarks.find(
      (watermark) => watermark.sourceId === applying.sourceId
    );
    if (!originalHighWatermark) {
      throw new Error("Expected original source high-watermark fixture");
    }
    const rolledBackObservation: IngestQueueSnapshot = {
      ...afterEnqueue,
      revision: afterEnqueue.revision + 1,
      jobs: afterEnqueue.jobs.map((job) =>
        job.id === applying.id
          ? { ...job, rerunRequested: false, updatedAt: Math.max(job.updatedAt, 301) }
          : job
      ),
      reruns: afterEnqueue.reruns.filter((rerun) => rerun.sourceId !== applying.sourceId),
      sourceHighWatermarks: afterEnqueue.sourceHighWatermarks.map((watermark) =>
        watermark.sourceId === applying.sourceId ? { ...originalHighWatermark } : watermark
      ),
    };
    await expect(
      harness.queue.write("personal", rolledBackObservation, afterEnqueue.revision)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueObservationAuthorityError);
    expect(await harness.file.read()).toBe(beforeRollback);

    const matchingAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: applying.sourceId,
      captureId: "startup-rerun-matching",
    });
    expect(matchingAllocation.inputRevision).toBe(allocation.inputRevision + 1);
    await harness.observations.bind({
      observationToken: matchingAllocation.observationToken,
      sourceContentHash: applying.sourceContentHash,
      pipelineFingerprint: applying.pipelineFingerprint,
    });
    await expect(
      queue.enqueue({
        bundleId: "personal",
        sourceId: applying.sourceId,
        sourceContentHash: applying.sourceContentHash,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: matchingAllocation.inputRevision,
        observationToken: matchingAllocation.observationToken,
      })
    ).resolves.toMatchObject({ kind: "updated", job: { id: applying.id } });
    await expect(queue.load("personal")).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery", pausedAt: 200 },
      applyClaim: claim,
      jobs: [
        expect.objectContaining({
          id: applying.id,
          status: "processing",
          stage: "applying",
          rerunRequested: false,
        }),
      ],
      reruns: [],
      sourceHighWatermarks: [
        expect.objectContaining({
          sourceId: applying.sourceId,
          sourceContentHash: applying.sourceContentHash,
          inputRevision: matchingAllocation.inputRevision,
        }),
      ],
    });
  });

  it("keeps the current failed apply claim sticky across same-reason Queue writes", async () => {
    const harness = await createNoJournalRecoveryHarness("transaction-current-recovery");
    const currentState = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    markNoJournalApplyFailed(currentState, 220);
    harness.file.replaceContent(JSON.stringify(currentState));
    const currentQueue = currentState.queues[0].value as IngestQueueSnapshot;

    const replacementHarness = await createNoJournalRecoveryHarness(
      "transaction-replacement-recovery"
    );
    const replacementState = JSON.parse(
      await replacementHarness.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    markNoJournalApplyFailed(replacementState, 220);
    const replacementQueue = replacementState.queues[0].value as IngestQueueSnapshot;
    replacementQueue.revision = currentQueue.revision + 1;
    replacementQueue.control = { ...currentQueue.control };
    const before = await harness.file.read();

    await expect(
      harness.queue.write("personal", replacementQueue, currentQueue.revision)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects replacing a current recovery claim with an unrelated historical commit", async () => {
    const history = await createApplyHarness(createRegisteredManifest());
    await history.port.recordCommitted(history.journal, history.receipt);
    const state = JSON.parse(await history.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const unrelated = await createNoJournalRecoveryHarness("transaction-current-unresolved");
    const unrelatedState = JSON.parse(await unrelated.file.read()) as KnowledgeRuntimeStoreSnapshot;
    markNoJournalApplyFailed(unrelatedState, 220);
    state.queues = unrelatedState.queues;
    state.reviews = unrelatedState.reviews;
    state.inputRevisions = unrelatedState.inputRevisions;
    history.file.replaceContent(JSON.stringify(state));
    const currentQueue = state.queues[0].value as IngestQueueSnapshot;
    const historicalCandidate = createPendingApplyCommitQueue(history.journal, history.receipt);
    historicalCandidate.revision = currentQueue.revision + 1;
    const before = await history.file.read();

    await expect(
      new KnowledgeRuntimeQueueStorage(history.runtime).write(
        "personal",
        historicalCandidate,
        currentQueue.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await history.file.read()).toBe(before);
  });

  it.each([
    { state: "claimed", reason: "apply_claim_present" },
    { state: "failed", reason: "failed_apply_present" },
  ] as const)(
    "blocks $state no-journal apply evidence without rewriting bytes",
    async (testCase) => {
      const harness = await createNoJournalRecoveryHarness();
      if (testCase.state === "failed") {
        const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
        markNoJournalApplyFailed(state, 220);
        harness.file.replaceContent(JSON.stringify(state));
      }
      const request = await createStartupReleaseRequest(harness);
      const before = await harness.file.read();

      await expect(harness.release.release(request)).resolves.toEqual({
        kind: "blocked",
        bundleId: "personal",
        reason: testCase.reason,
      });
      expect(await harness.file.read()).toBe(before);
    }
  );

  it("blocks a Vault-global active transaction without rewriting bytes", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.activeTransaction = harness.journal;
    harness.file.replaceContent(JSON.stringify(state));
    const request = await createStartupReleaseRequest(harness);
    const before = await harness.file.read();

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "active_transaction_present",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("blocks another Bundle's apply recovery evidence without rewriting bytes", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.queues.push({ bundleId: "other", value: createStartupPausedQueue(1, "other") });
    state.queues.sort((left, right) => left.bundleId.localeCompare(right.bundleId));
    harness.file.replaceContent(JSON.stringify(state));
    const request = await createStartupReleaseRequest(harness, "other");
    const before = await harness.file.read();

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "other",
      reason: "other_bundle_apply_recovery_present",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("blocks a pending acknowledgement marker without rewriting bytes", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.activeTransaction = null;
    state.queues[0].value = createPendingApplyCommitQueue(harness.journal, harness.receipt);
    harness.file.replaceContent(JSON.stringify(state));
    const release = new KnowledgeRuntimeStartupReleasePort(harness.runtime);
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const review = state.reviews[0].value as ChangeSetReviewSnapshot;
    const request: KnowledgeStartupReleaseRequest = {
      bundleId: "personal",
      expectedRuntimeRevision: state.revision,
      expectedReviewRevision: review.revision,
      expectedQueueRevision: queue.revision,
    };
    const before = await harness.file.read();

    const runningCandidate: IngestQueueSnapshot = {
      ...queue,
      revision: queue.revision + 1,
      control: { status: "running" },
    };
    delete runningCandidate.applyCommit;
    await expect(
      new KnowledgeRuntimeQueueStorage(harness.runtime).write(
        "personal",
        runningCandidate,
        queue.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(before);

    const forgedFinalization: IngestQueueSnapshot = {
      ...queue,
      revision: queue.revision + 1,
      control: {
        status: "paused",
        reason: "startup_recovery",
        pausedAt: queue.applyCommit?.committedAt ?? 0,
        detail: "Forged finalization metadata",
      },
    };
    delete forgedFinalization.applyCommit;
    await expect(
      new KnowledgeRuntimeQueueStorage(harness.runtime).write(
        "personal",
        forgedFinalization,
        queue.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(before);

    await expect(release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "apply_commit_present",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("serializes concurrent releases so only one Queue transition commits", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createStartupPausedQueue(1), null);
    const request = await createStartupReleaseRequest(harness);

    const results = await Promise.all([
      harness.release.release(request),
      new KnowledgeRuntimeStartupReleasePort(harness.runtime).release(request),
    ]);

    expect(results.filter((result) => result.kind === "released")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "observation_changed")).toEqual([
      { kind: "observation_changed", bundleId: "personal", boundary: "runtime" },
    ]);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(state.revision).toBe(request.expectedRuntimeRevision + 1);
    expect(state.queues[0].value).toMatchObject({
      revision: request.expectedQueueRevision + 1,
      control: { status: "running" },
    });
  });

  it("requires a fresh Gate token after release commits but its caller observes failure", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createStartupPausedQueue(1), null);
    const request = await createStartupReleaseRequest(harness);
    harness.file.throwAfterCommitOnNextWrite();

    await expect(harness.release.release(request)).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    const committed = await harness.file.read();
    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "observation_changed",
      bundleId: "personal",
      boundary: "runtime",
    });
    expect(await harness.file.read()).toBe(committed);

    const freshRequest = await createStartupReleaseRequest(harness);
    await expect(harness.release.release(freshRequest)).resolves.toMatchObject({
      kind: "unchanged",
      reason: "already_running",
    });
    expect(await harness.file.read()).toBe(committed);
  });

  it("includes the Vault-global transaction slot in the same recovery snapshot", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const review = state.reviews[0].value as ChangeSetReviewSnapshot;
    state.activeTransaction = harness.journal;
    harness.file.replaceContent(JSON.stringify(state));

    await expect(harness.recovery.loadSnapshot("personal", review.revision)).resolves.toMatchObject(
      {
        kind: "loaded",
        snapshot: {
          globalTransaction: {
            transactionId: harness.journal.transactionId,
            bundleId: harness.journal.bundleId,
            changeSetId: harness.journal.changeSetId,
            phase: "prepared",
          },
          classifications: [
            {
              kind: "active",
              transactionId: harness.journal.transactionId,
              phase: "prepared",
            },
          ],
        },
      }
    );
  });

  it("keeps an accepted Review not started and rejects a fabricated abandonment", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const applying = queue.jobs[0];
    const review = state.reviews[0].value as ChangeSetReviewSnapshot;
    const record = review.records[0];
    if (!record || record.outcome !== "accepted") {
      throw new Error("Expected accepted Review fixture");
    }
    queue.jobs = [
      {
        id: applying.id,
        bundleId: applying.bundleId,
        sourceId: applying.sourceId,
        sourceContentHash: applying.sourceContentHash,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: applying.inputRevision,
        attempt: applying.attempt,
        rerunRequested: false,
        createdAt: applying.createdAt,
        updatedAt: record.recordedAt,
        status: "awaiting_review",
        stage: "review",
        changeSetId: record.changeSetId,
      },
    ];
    queue.pendingReviews = [
      {
        kind: "durable",
        jobId: applying.id,
        changeSetId: record.changeSetId,
        proposalDigest: record.proposalDigest,
        reviewRecordRevision: 0,
        recordedAt: record.recordedAt,
      },
    ];
    delete queue.applyClaim;
    queue.control = { status: "paused", reason: "startup_recovery", pausedAt: 200 };
    harness.file.replaceContent(JSON.stringify(state));

    await expect(harness.recovery.classify(harness.identity)).resolves.toEqual({
      kind: "accepted_not_started",
      reference: createNoJournalApplyRecoveryReference("personal", harness.identity),
      bundleId: "personal",
      changeSetId: harness.journal.changeSetId,
      jobId: harness.journal.jobClaim.jobId,
    });
    const request = await createStartupReleaseRequest(harness);
    const beforeRelease = await harness.file.read();
    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "accepted_review_unresolved",
    });
    expect(await harness.file.read()).toBe(beforeRelease);

    const awaiting = queue.jobs[0];
    const startedAt = Math.max(record.acceptedAt, awaiting.createdAt);
    const abandonedAt = Math.max(startedAt, awaiting.updatedAt);
    const fabricated: IngestQueueSnapshot = {
      ...queue,
      revision: queue.revision + 1,
      jobs: [
        {
          id: awaiting.id,
          bundleId: awaiting.bundleId,
          sourceId: awaiting.sourceId,
          sourceContentHash: awaiting.sourceContentHash,
          pipelineFingerprint: awaiting.pipelineFingerprint,
          inputRevision: awaiting.inputRevision,
          attempt: awaiting.attempt,
          rerunRequested: false,
          createdAt: awaiting.createdAt,
          updatedAt: abandonedAt,
          status: "cancelled",
          stage: "cancelled",
          cancelledAt: abandonedAt,
        },
      ],
      pendingReviews: [],
      applyAbandonments: [
        {
          jobId: awaiting.id,
          sourceId: awaiting.sourceId,
          sourceContentHash: awaiting.sourceContentHash,
          pipelineFingerprint: awaiting.pipelineFingerprint,
          inputRevision: awaiting.inputRevision,
          attempt: awaiting.attempt,
          startedAt,
          changeSetId: record.changeSetId,
          changeSetDigest: record.acceptedDigest,
          proposalDigest: record.proposalDigest,
          recordRevision: record.recordRevision,
          manifestCommitIntentDigest: record.manifestCommitIntentDigest,
          acceptedAt: record.acceptedAt,
          abandonedAt,
        },
      ],
    };
    await expect(
      harness.queue.write("personal", fabricated, queue.revision)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(beforeRelease);

    queue.control = { status: "running" };
    harness.file.replaceContent(JSON.stringify(state));
    const runningBefore = await harness.file.read();
    const cancelledWithoutAbandonment: IngestQueueSnapshot = {
      ...fabricated,
      control: { status: "running" },
      applyAbandonments: [],
    };
    await expect(
      harness.queue.write("personal", cancelledWithoutAbandonment, queue.revision)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueRecoveryGateProtectedError);
    expect(await harness.file.read()).toBe(runningBefore);

    const executor: IngestExecutor = {
      /** Produces no changes; beginning an accepted apply does not invoke this executor. */
      execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
    };
    const runtimeQueue = new IngestQueue(harness.queue, executor, { clock: () => 300 });
    await expect(
      runtimeQueue.beginReviewApply("personal", {
        outcome: "accepted",
        bundleId: "personal",
        changeSetId: record.changeSetId,
        proposalDigest: record.proposalDigest,
        recordRevision: record.recordRevision,
        acceptedDigest: record.acceptedDigest,
        manifestCommitIntentDigest: record.manifestCommitIntentDigest,
        acceptedAt: record.acceptedAt,
        jobClaim: { ...record.jobClaim },
      })
    ).resolves.toMatchObject({
      id: awaiting.id,
      status: "processing",
      stage: "applying",
      startedAt: 300,
    });
    await expect(runtimeQueue.load("personal")).resolves.toMatchObject({
      control: { status: "running" },
      pendingReviews: [],
      applyClaim: {
        jobId: awaiting.id,
        reviewedChangeSet: {
          changeSetId: record.changeSetId,
          changeSetDigest: record.acceptedDigest,
        },
      },
    });
  });

  it("classifies exact active phases and blocks both recovery-required and unrelated journals", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const initial = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    initial.activeTransaction = harness.journal;
    harness.file.replaceContent(JSON.stringify(initial));

    const prepared = await harness.recovery.classify(harness.identity);
    expect(prepared).toMatchObject({
      kind: "active",
      transactionId: harness.journal.transactionId,
      phase: "prepared",
    });
    if (prepared.kind !== "active") {
      throw new Error("Expected active prepared classification");
    }

    const applying: ChangeSetTransactionJournal = {
      ...harness.journal,
      revision: 1,
      phase: "applying",
      updatedAt: harness.journal.updatedAt + 1,
    };
    initial.activeTransaction = applying;
    harness.file.replaceContent(JSON.stringify(initial));
    await expect(harness.recovery.classify(harness.identity)).resolves.toEqual({
      ...prepared,
      phase: "applying",
    });

    initial.activeTransaction = {
      ...applying,
      revision: 2,
      phase: "recovery_required",
      conflicts: [
        {
          path: applying.targets[0].path,
          code: "file_state_conflict",
          detectedAt: applying.updatedAt + 1,
        },
      ],
      updatedAt: applying.updatedAt + 1,
    };
    harness.file.replaceContent(JSON.stringify(initial));
    await expect(harness.recovery.classify(harness.identity)).resolves.toMatchObject({
      kind: "blocked",
      transactionId: harness.journal.transactionId,
      reason: "transaction_recovery_required",
    });

    const unrelated = await createNoJournalRecoveryHarness("transaction-blocked-candidate");
    const unrelatedState = JSON.parse(await unrelated.file.read()) as KnowledgeRuntimeStoreSnapshot;
    unrelatedState.activeTransaction = createPreparedJournal("unrelated-global-transaction");
    unrelated.file.replaceContent(JSON.stringify(unrelatedState));
    await expect(unrelated.recovery.classify(unrelated.identity)).resolves.toMatchObject({
      kind: "blocked",
      transactionId: "unrelated-global-transaction",
      reason: "other_transaction_active",
    });
  });

  it("distinguishes finalizing commit evidence from a fully acknowledged historical commit", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const review = state.reviews[0].value as ChangeSetReviewSnapshot;
    const identity = createAcceptedStartupIdentity(review);
    const recovery = new KnowledgeRuntimeNoJournalApplyRecoveryPort(harness.runtime);
    state.queues[0].value = createPendingApplyCommitQueue(harness.journal, harness.receipt);
    harness.file.replaceContent(JSON.stringify(state));

    await expect(recovery.classify(identity)).resolves.toMatchObject({
      kind: "finalizing",
      transactionId: harness.journal.transactionId,
    });

    const historical = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const completedQueue = historical.queues[0].value as IngestQueueSnapshot;
    delete completedQueue.applyCommit;
    completedQueue.control = { status: "running" };
    historical.activeTransaction = null;
    historical.revision += 1;
    completedQueue.revision += 1;
    harness.file.replaceContent(JSON.stringify(historical));

    await expect(recovery.classify(identity)).resolves.toMatchObject({
      kind: "committed",
      transactionId: harness.journal.transactionId,
    });
  });

  it("reloads exact continuation input but leaves stale-Manifest attempts abandonable", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const classification = await harness.recovery.classify(harness.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    const reference = classification.candidate;

    await expect(harness.recovery.loadContinueInput(reference, createBundle())).resolves.toEqual({
      changeSet: harness.journal.changeSet,
      bundle: harness.journal.bundle,
      jobClaim: harness.journal.jobClaim,
      manifestCommitIntent: harness.journal.manifestCommitIntent,
      manifestCommitIntentDigest: harness.journal.manifestCommitIntentDigest,
    });

    const stale = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const staleManifest = stale.manifests[0].value as SourceManifest;
    staleManifest.revision += 1;
    harness.file.replaceContent(JSON.stringify(stale));

    await expect(harness.recovery.classify(harness.identity)).resolves.toEqual(classification);
    await expect(
      harness.recovery.loadContinueInput(reference, createBundle())
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitManifestConflictError.name,
      reason: "intent_invalid",
    });
    await expect(harness.recovery.abandon(reference, 300)).resolves.toMatchObject({
      bundleId: reference.bundleId,
      recoveryId: reference.recoveryId,
      jobId: harness.journal.jobClaim.jobId,
      changeSetId: harness.journal.changeSetId,
      abandonedAt: 300,
    });
  });

  it("atomically abandons an exact apply while retaining immutable review evidence", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const classification = await harness.recovery.classify(harness.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const beforeReview = before.reviews[0].value;

    const receipt = await harness.recovery.abandon(classification.candidate, 300);
    const abandonedText = await harness.file.read();
    const abandoned = JSON.parse(abandonedText) as KnowledgeRuntimeStoreSnapshot;
    const queue = abandoned.queues[0].value as IngestQueueSnapshot;

    expect(receipt).toEqual({
      bundleId: "personal",
      recoveryId: classification.candidate.recoveryId,
      jobId: harness.journal.jobClaim.jobId,
      changeSetId: harness.journal.changeSetId,
      abandonedAt: 300,
    });
    expect(queue.control).toMatchObject({
      status: "paused",
      reason: "startup_recovery",
      pausedAt: 300,
    });
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        id: harness.journal.jobClaim.jobId,
        status: "cancelled",
        stage: "cancelled",
        rerunRequested: false,
        cancelledAt: 300,
      }),
    ]);
    expect(queue.applyClaim).toBeUndefined();
    expect(queue.applyAbandonments).toEqual([
      {
        ...harness.journal.jobClaim,
        changeSetId: harness.journal.changeSetId,
        changeSetDigest: harness.journal.changeSetDigest,
        proposalDigest: harness.identity.proposalDigest,
        recordRevision: 1,
        manifestCommitIntentDigest: harness.journal.manifestCommitIntentDigest,
        acceptedAt: harness.identity.acceptedAt,
        abandonedAt: 300,
      },
    ]);
    expect(abandoned.reviews[0].value).toEqual(beforeReview);
    expect(abandoned.activeTransaction).toBeNull();

    await expect(harness.recovery.classify(harness.identity)).resolves.toEqual({
      kind: "abandoned",
      reference: {
        bundleId: "personal",
        recoveryId: classification.candidate.recoveryId,
      },
      jobId: harness.journal.jobClaim.jobId,
      changeSetId: harness.journal.changeSetId,
      abandonedAt: 300,
    });
    await expect(harness.recovery.abandon(classification.candidate, 999)).resolves.toEqual(receipt);
    expect(await harness.file.read()).toBe(abandonedText);

    const request = await createStartupReleaseRequest(harness);
    await expect(harness.release.release(request)).resolves.toMatchObject({
      kind: "released",
      bundleId: "personal",
      previousQueueRevision: queue.revision,
      queueSnapshot: { control: { status: "running" } },
    });
  });

  it("converges an abandonment after the atomic file commits and then rejects", async () => {
    const harness = await createNoJournalRecoveryHarness();
    const classification = await harness.recovery.classify(harness.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    harness.file.throwAfterCommitOnNextWrite();

    await expect(harness.recovery.abandon(classification.candidate, 300)).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    const committedText = await harness.file.read();
    await expect(harness.recovery.classify(harness.identity)).resolves.toMatchObject({
      kind: "abandoned",
      abandonedAt: 300,
    });
    await expect(harness.recovery.abandon(classification.candidate, 400)).resolves.toMatchObject({
      recoveryId: classification.candidate.recoveryId,
      abandonedAt: 300,
    });
    expect(await harness.file.read()).toBe(committedText);
  });

  it("fails closed for stale references, startup identities, and conflicting source-input ledgers", async () => {
    const staleReference = await createNoJournalRecoveryHarness("transaction-stale-reference");
    const classification = await staleReference.recovery.classify(staleReference.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    const beforeReference = await staleReference.file.read();
    await expect(
      staleReference.recovery.abandon(
        {
          ...classification.candidate,
          recoveryId: `knowledge-no-journal-${HASH_C}`,
        },
        300
      )
    ).rejects.toMatchObject({
      name: KnowledgeNoJournalApplyRecoveryConflictError.name,
      reason: "recovery_id_unknown",
    });
    expect(await staleReference.file.read()).toBe(beforeReference);

    await expect(
      staleReference.recovery.classify({
        ...staleReference.identity,
        acceptedDigest: HASH_C,
      })
    ).rejects.toMatchObject({
      name: KnowledgeNoJournalApplyRecoveryConflictError.name,
      reason: "review_record_mismatch",
    });

    const ledgerHarness = await createApplyHarness(createRegisteredManifest());
    await ledgerHarness.port.recordCommitted(ledgerHarness.journal, ledgerHarness.receipt);
    const ledgerState = JSON.parse(
      await ledgerHarness.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    const ledgerIdentity = createAcceptedStartupIdentity(
      ledgerState.reviews[0].value as ChangeSetReviewSnapshot
    );
    ledgerState.activeTransaction = null;
    ledgerState.applyCommits[0].changeSetDigest = HASH_C;
    ledgerHarness.file.replaceContent(JSON.stringify(ledgerState));
    const ledgerBefore = await ledgerHarness.file.read();

    await expect(
      new KnowledgeRuntimeNoJournalApplyRecoveryPort(ledgerHarness.runtime).classify(ledgerIdentity)
    ).rejects.toMatchObject({
      name: KnowledgeNoJournalApplyRecoveryConflictError.name,
      reason: "write_evidence_conflict",
    });
    expect(await ledgerHarness.file.read()).toBe(ledgerBefore);

    const abandonedHarness = await createNoJournalRecoveryHarness(
      "transaction-abandoned-ledger-conflict"
    );
    const abandonedClassification = await abandonedHarness.recovery.classify(
      abandonedHarness.identity
    );
    if (abandonedClassification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    await abandonedHarness.recovery.abandon(abandonedClassification.candidate, 300);
    const abandonedState = JSON.parse(
      await abandonedHarness.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    abandonedState.manifests = ledgerState.manifests;
    abandonedState.applyCommits = ledgerState.applyCommits;
    abandonedHarness.file.replaceContent(JSON.stringify(abandonedState));
    const abandonedBefore = await abandonedHarness.file.read();

    await expect(
      abandonedHarness.recovery.classify(abandonedHarness.identity)
    ).rejects.toMatchObject({
      name: KnowledgeNoJournalApplyRecoveryConflictError.name,
      reason: "write_evidence_conflict",
    });
    expect(await abandonedHarness.file.read()).toBe(abandonedBefore);
  });

  it("serializes prepared publication against abandonment without split-brain evidence", async () => {
    const harness = await createNoJournalRecoveryHarness("transaction-racing-apply");
    const classification = await harness.recovery.classify(harness.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }

    const results = await Promise.allSettled([
      harness.recovery.abandon(classification.candidate, 300),
      harness.transaction.writeActive(harness.journal, null),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(state.activeTransaction !== null && queue.applyAbandonments.length > 0).toBe(false);
    expect(
      state.activeTransaction !== null ||
        (queue.applyAbandonments.length === 1 && queue.jobs[0].status === "cancelled")
    ).toBe(true);
  });

  it("abandons only the old attempt while preserving its promoted successor and latest rerun", async () => {
    const harness = await createNoJournalRecoveryHarness("transaction-three-generation");
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const oldApply = queue.jobs[0];
    markNoJournalApplyFailed(state, 220);
    queue.jobs.push({
      id: "job-successor",
      bundleId: oldApply.bundleId,
      sourceId: oldApply.sourceId,
      sourceContentHash: HASH_C,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 2,
      attempt: 0,
      rerunRequested: true,
      createdAt: 180,
      updatedAt: 220,
      status: "pending",
      stage: "queued",
    });
    queue.reruns = [
      {
        jobId: "job-latest",
        sourceId: oldApply.sourceId,
        sourceContentHash: HASH_B,
        pipelineFingerprint: oldApply.pipelineFingerprint,
        inputRevision: 3,
        requestedAt: 200,
        updatedAt: 220,
      },
    ];
    queue.sourceHighWatermarks[0] = {
      sourceId: oldApply.sourceId,
      sourceContentHash: HASH_B,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 3,
      observedAt: 220,
    };
    state.inputRevisions[0].sources[0].inputRevision = 3;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    const classification = await harness.recovery.classify(harness.identity);
    if (classification.kind !== "requires_decision") {
      throw new Error("Expected no-journal decision candidate");
    }
    await harness.recovery.abandon(classification.candidate, 300);
    const abandoned = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const abandonedQueue = abandoned.queues[0].value as IngestQueueSnapshot;

    expect(abandonedQueue.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldApply.id, status: "cancelled" }),
        expect.objectContaining({
          id: "job-successor",
          status: "pending",
          inputRevision: 2,
          rerunRequested: true,
        }),
      ])
    );
    expect(abandonedQueue.reruns).toEqual([
      expect.objectContaining({ jobId: "job-latest", inputRevision: 3 }),
    ]);
  });

  it("blocks legacy reviewed prepared and applying recovery before any Wiki file access", async () => {
    const manifest = createRegisteredManifest();
    const prepared = createPreparedApplyJournal(manifest, "transaction-legacy-authority");
    const journals: Array<ChangeSetTransactionJournal & { phase: "prepared" | "applying" }> = [
      prepared,
      { ...prepared, revision: 1, phase: "applying", updatedAt: prepared.updatedAt + 1 },
    ];

    for (const journal of journals) {
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(createLegacyReviewedActiveState(manifest, journal)));
      const runtime = new KnowledgeRuntimeStore(file);
      await runtime.initialize();
      const before = await file.read();
      let observations = 0;
      let mutations = 0;
      const fileStore: KnowledgeFileStore = {
        mutationCapabilities: ALL_KNOWLEDGE_FILE_MUTATIONS,
        /** Records any forbidden recovery observation. */
        async observe() {
          observations += 1;
          return { kind: "missing" } as const;
        },
        /** Records any forbidden recovery mutation. */
        async compareAndSwap() {
          mutations += 1;
          return { kind: "applied" } as const;
        },
      };
      const transaction = new ChangeSetTransaction({
        storage: new KnowledgeRuntimeTransactionStorage(runtime),
        fileStore,
        validator: {} as ChangeSetValidator,
        authority: new KnowledgeRuntimeApplyAuthorityPort(runtime),
      });

      await expect(runtime.readActiveTransaction()).rejects.toMatchObject({
        name: KnowledgeApplyCommitAuthorityError.name,
        reason: "queue_review_unverified",
      });
      await expect(transaction.recoverOnStartup(createBundle())).rejects.toMatchObject({
        name: KnowledgeApplyCommitAuthorityError.name,
        reason: "queue_review_unverified",
      });
      expect({ observations, mutations }).toEqual({ observations: 0, mutations: 0 });
      expect(await file.read()).toBe(before);
    }
  });

  it("blocks stale-Manifest prepared and applying recovery before any Wiki file access", async () => {
    const manifest = createRegisteredManifest();
    const prepared = createPreparedApplyJournal(manifest, "transaction-stale-startup-manifest");
    const journals: Array<ChangeSetTransactionJournal & { phase: "prepared" | "applying" }> = [
      prepared,
      { ...prepared, revision: 1, phase: "applying", updatedAt: prepared.updatedAt + 1 },
    ];

    for (const journal of journals) {
      const authority = createApplyAuthoritySlots(manifest, journal);
      const driftedManifest: SourceManifest = {
        ...manifest,
        revision: manifest.revision + 1,
        entries: manifest.entries.map((entry) => ({
          ...entry,
          sourcePath: "Sources/Renamed.md",
          sourceKey: "sources/renamed.md",
        })),
      };
      const state: KnowledgeRuntimeStoreSnapshot = {
        ...createEmptyKnowledgeRuntimeStoreSnapshot(),
        ...authority,
        revision: 8,
        manifests: [{ bundleId: manifest.bundleId, value: driftedManifest }],
        activeTransaction: journal,
      };
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(state));
      const runtime = new KnowledgeRuntimeStore(file);
      await runtime.initialize();
      const before = await file.read();
      let observations = 0;
      let mutations = 0;
      const fileStore: KnowledgeFileStore = {
        mutationCapabilities: ALL_KNOWLEDGE_FILE_MUTATIONS,
        /** Records any forbidden recovery observation. */
        async observe() {
          observations += 1;
          return { kind: "missing" } as const;
        },
        /** Records any forbidden recovery mutation. */
        async compareAndSwap() {
          mutations += 1;
          return { kind: "applied" } as const;
        },
      };
      const transaction = new ChangeSetTransaction({
        storage: new KnowledgeRuntimeTransactionStorage(runtime),
        fileStore,
        validator: {} as ChangeSetValidator,
        authority: new KnowledgeRuntimeApplyAuthorityPort(runtime),
      });

      await expect(runtime.readActiveTransaction()).rejects.toMatchObject({
        name: KnowledgeApplyCommitManifestConflictError.name,
        reason: "intent_invalid",
      });
      await expect(transaction.recoverOnStartup(createBundle())).rejects.toMatchObject({
        name: KnowledgeApplyCommitManifestConflictError.name,
        reason: "intent_invalid",
      });
      expect({ observations, mutations }).toEqual({ observations: 0, mutations: 0 });
      expect(await file.read()).toBe(before);
    }
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

  it.each([
    {
      reason: "queue_missing" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        state.queues = [];
      },
    },
    {
      reason: "queue_claim_mismatch" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        const queue = state.queues[0].value as IngestQueueSnapshot;
        queue.jobs[0].id = "job-other";
        if (!queue.applyClaim) {
          throw new Error("Expected apply claim fixture");
        }
        queue.applyClaim.jobId = "job-other";
      },
    },
    {
      reason: "queue_review_unverified" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        const queue = state.queues[0].value as IngestQueueSnapshot;
        if (!queue.applyClaim) {
          throw new Error("Expected apply claim fixture");
        }
        delete queue.applyClaim.acceptedReview;
        queue.applyClaim.legacyReview = {
          kind: "legacy_unverified",
          migratedFromVersion: 3,
        };
      },
    },
    {
      reason: "review_missing" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        state.reviews = [];
      },
    },
    {
      reason: "review_record_mismatch" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        const review = state.reviews[0].value as ChangeSetReviewSnapshot;
        const record = review.records[0];
        if (record.outcome !== "accepted") {
          throw new Error("Expected accepted Review fixture");
        }
        record.acceptedAt += 1;
      },
    },
    {
      reason: "input_revision_missing" as const,
      mutate(state: KnowledgeRuntimeStoreSnapshot): void {
        state.inputRevisions = [];
      },
    },
  ])("rejects $reason inside the atomic Manifest/ledger transform", async ({ reason, mutate }) => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    mutate(state);
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    const result = expect(harness.port.recordCommitted(harness.journal, harness.receipt)).rejects;
    if (reason === "input_revision_missing" || reason === "queue_missing") {
      await result.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
    } else {
      await result.toMatchObject({
        name: KnowledgeApplyCommitAuthorityError.name,
        reason,
      });
    }
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects an unreviewed apply until auto-apply policy has durable authorization", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    if (!queue.applyClaim) {
      throw new Error("Expected apply claim fixture");
    }
    delete queue.applyClaim.reviewedChangeSet;
    delete queue.applyClaim.acceptedReview;
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    await expect(
      harness.port.recordCommitted(harness.journal, harness.receipt)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitAuthorityError.name,
      reason: "queue_review_unverified",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("allows a newer same-payload source observation while an older reviewed apply commits", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    queue.sourceHighWatermarks[0] = {
      ...queue.sourceHighWatermarks[0],
      inputRevision: 2,
      observedAt: 155,
    };
    state.inputRevisions[0].sources[0].inputRevision = 3;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    expect(
      (JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot).applyCommits
    ).toHaveLength(1);
  });

  it("allows an exact divergent rerun retained behind an applying reviewed claim", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const applying = queue.jobs[0];
    applying.rerunRequested = true;
    applying.updatedAt = 155;
    queue.reruns = [
      {
        jobId: "job-rerun",
        sourceId: applying.sourceId,
        sourceContentHash: HASH_C,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: 2,
        requestedAt: 155,
        updatedAt: 155,
      },
    ];
    queue.sourceHighWatermarks[0] = {
      sourceId: applying.sourceId,
      sourceContentHash: HASH_C,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: 2,
      observedAt: 155,
    };
    state.inputRevisions[0].sources[0].inputRevision = 2;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    expect(
      (JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot).applyCommits
    ).toHaveLength(1);
  });

  it("allows an exact divergent successor promoted before failed-apply recovery commits", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const applying = queue.jobs[0];
    queue.control = {
      status: "paused",
      reason: "recovery_required",
      pausedAt: 160,
    };
    queue.jobs = [
      {
        ...applying,
        rerunRequested: false,
        updatedAt: 160,
        status: "failed",
        stage: "applying",
        failure: {
          code: "interrupted_apply_requires_recovery",
          message: "Interrupted apply requires transaction recovery",
          retryable: false,
          occurredAt: 160,
        },
      },
      {
        id: "job-rerun",
        bundleId: applying.bundleId,
        sourceId: applying.sourceId,
        sourceContentHash: HASH_C,
        pipelineFingerprint: applying.pipelineFingerprint,
        inputRevision: 2,
        attempt: 0,
        rerunRequested: false,
        createdAt: 160,
        updatedAt: 160,
        status: "pending",
        stage: "queued",
      },
    ];
    delete (queue.jobs[0] as unknown as { startedAt?: number }).startedAt;
    queue.sourceHighWatermarks[0] = {
      sourceId: applying.sourceId,
      sourceContentHash: HASH_C,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: 2,
      observedAt: 160,
    };
    state.inputRevisions[0].sources[0].inputRevision = 2;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    expect(
      (JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot).applyCommits
    ).toHaveLength(1);
  });

  it("keeps a latest rerun owned by a promoted successor while the old apply commits", async () => {
    const harness = await createApplyHarness(createRegisteredManifest());
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    const oldApply = queue.jobs[0];
    queue.control = {
      status: "paused",
      reason: "recovery_required",
      pausedAt: 170,
    };
    queue.jobs = [
      {
        ...oldApply,
        rerunRequested: false,
        updatedAt: 170,
        status: "failed",
        stage: "applying",
        failure: {
          code: "interrupted_apply_requires_recovery",
          message: "Interrupted apply requires transaction recovery",
          retryable: false,
          occurredAt: 170,
        },
      },
      {
        id: "job-successor",
        bundleId: oldApply.bundleId,
        sourceId: oldApply.sourceId,
        sourceContentHash: HASH_C,
        pipelineFingerprint: oldApply.pipelineFingerprint,
        inputRevision: 2,
        attempt: 0,
        rerunRequested: true,
        createdAt: 155,
        updatedAt: 170,
        status: "pending",
        stage: "queued",
      },
    ];
    delete (queue.jobs[0] as unknown as { startedAt?: number }).startedAt;
    queue.reruns = [
      {
        jobId: "job-latest",
        sourceId: oldApply.sourceId,
        sourceContentHash: HASH_B,
        pipelineFingerprint: oldApply.pipelineFingerprint,
        inputRevision: 3,
        requestedAt: 160,
        updatedAt: 170,
      },
    ];
    queue.sourceHighWatermarks[0] = {
      sourceId: oldApply.sourceId,
      sourceContentHash: HASH_B,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 3,
      observedAt: 170,
    };
    state.inputRevisions[0].sources[0].inputRevision = 3;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const executor: IngestExecutor = {
      /** Produces no work; recovery never invokes this executor. */
      async execute() {
        return { kind: "no_changes", changeSetId: "changeset-unused" };
      },
    };
    const runtimeQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(harness.runtime),
      executor,
      { clock: () => 250, jobIdFactory: () => "job-unused" }
    );
    await runtimeQueue.resolveApplyRecovery(harness.receipt);
    const recovered = await runtimeQueue.load("personal");

    expect(
      recovered.jobs.filter((job) => !["failed", "completed", "cancelled"].includes(job.status))
    ).toEqual([expect.objectContaining({ id: "job-successor", inputRevision: 2 })]);
    expect(recovered.reruns).toEqual([
      expect.objectContaining({ jobId: "job-latest", inputRevision: 3 }),
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

  it("requires every pending Queue commit marker to match one exact apply-ledger record", async () => {
    const manifest = createRegisteredManifest();
    const harness = await createApplyHarness(manifest);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const valid = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    valid.activeTransaction = null;
    valid.queues = [
      {
        bundleId: harness.journal.bundleId,
        value: createPendingApplyCommitQueue(harness.journal, harness.receipt),
      },
    ];

    const validFile = new MemoryAtomicRuntimeFile();
    await validFile.initialize(JSON.stringify(valid));
    await expect(new KnowledgeRuntimeStore(validFile).initialize()).resolves.toBeUndefined();

    const scenarios = [
      { name: "transaction", marker: { transactionId: "transaction-other" } },
      { name: "ChangeSet digest", marker: { changeSetDigest: HASH_C } },
      { name: "commit revision", marker: { commitRevision: harness.receipt.commitRevision + 1 } },
      { name: "commit timestamp", marker: { committedAt: harness.receipt.committedAt - 1 } },
    ] as const;
    for (const scenario of scenarios) {
      const state = JSON.parse(JSON.stringify(valid)) as KnowledgeRuntimeStoreSnapshot;
      state.queues[0].value = createPendingApplyCommitQueue(
        harness.journal,
        harness.receipt,
        scenario.marker
      );
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(state));
      const before = await file.read();

      await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
      expect(await file.read()).toBe(before);
    }
  });

  it("rejects a pending Queue commit marker when no Manifest success ledger exists", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest);
    const state: KnowledgeRuntimeStoreSnapshot = {
      ...createEmptyKnowledgeRuntimeStoreSnapshot(),
      queues: [
        {
          bundleId: proof.journal.bundleId,
          value: createPendingApplyCommitQueue(proof.journal, proof.receipt),
        },
      ],
      manifests: [{ bundleId: manifest.bundleId, value: manifest }],
    };
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(state));
    const before = await file.read();

    await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
    expect(await file.read()).toBe(before);
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
    later.queues = [];
    later.reviews = [];
    later.inputRevisions = [];
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

  it("does not publish a prepared journal without exact Queue and Review authority", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-missing-authority");
    const before = await harness.file.read();

    await expect(harness.transaction.writeActive(prepared, null)).rejects.toMatchObject({
      name: KnowledgeApplyCommitAuthorityError.name,
      reason: "queue_missing",
    });
    expect(await harness.file.read()).toBe(before);
    await expect(harness.transaction.readActive()).resolves.toBeNull();
  });

  it("does not publish a prepared journal after its Manifest read-set becomes stale", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-stale-prepare");
    await persistPreparedApplyAuthority(harness, manifest, prepared);
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

  it("re-proves durable authority when prepared advances to applying", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-prepare-to-apply");
    await persistPreparedApplyAuthority(harness, manifest, prepared);
    await harness.transaction.writeActive(prepared, null);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.reviews = [];
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();
    const applying: ChangeSetTransactionJournal = {
      ...prepared,
      revision: 1,
      phase: "applying",
      updatedAt: prepared.updatedAt + 1,
    };

    await expect(
      harness.transaction.writeActive(applying, {
        transactionId: prepared.transactionId,
        revision: prepared.revision,
      })
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitAuthorityError.name,
      reason: "review_missing",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("preserves unfinished apply authority across Queue and Review mutations", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const prepared = createPreparedApplyJournal(manifest, "transaction-authority-preservation");
    await persistPreparedApplyAuthority(harness, manifest, prepared);
    await harness.transaction.writeActive(prepared, null);
    const applying: ChangeSetTransactionJournal & { phase: "applying" } = {
      ...prepared,
      revision: 1,
      phase: "applying",
      updatedAt: prepared.updatedAt + 1,
    };
    await harness.transaction.writeActive(applying, {
      transactionId: prepared.transactionId,
      revision: prepared.revision,
    });

    const queue = (await harness.queue.read("personal")) as IngestQueueSnapshot;
    const unreviewedQueue = JSON.parse(JSON.stringify(queue)) as IngestQueueSnapshot;
    unreviewedQueue.revision += 1;
    if (!unreviewedQueue.applyClaim) {
      throw new Error("Expected apply claim fixture");
    }
    delete unreviewedQueue.applyClaim.reviewedChangeSet;
    delete unreviewedQueue.applyClaim.acceptedReview;
    const beforeQueue = await harness.file.read();
    await expect(
      harness.queue.write("personal", unreviewedQueue, queue.revision)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitAuthorityError.name,
      reason: "queue_review_unverified",
    });
    expect(await harness.file.read()).toBe(beforeQueue);

    const review = (await harness.review.read("personal")) as ChangeSetReviewSnapshot;
    const emptyReview: ChangeSetReviewSnapshot = {
      ...review,
      revision: review.revision + 1,
      records: [],
    };
    const beforeReview = await harness.file.read();
    await expect(
      harness.review.write("personal", emptyReview, review.revision)
    ).rejects.toMatchObject({
      name: KnowledgeApplyCommitAuthorityError.name,
      reason: "review_record_missing",
    });
    expect(await harness.file.read()).toBe(beforeReview);

    const progressed: ChangeSetTransactionJournal & { phase: "applying" } = {
      ...applying,
      revision: 2,
      appliedCount: applying.targets.length,
      updatedAt: applying.updatedAt + 1,
    };
    await harness.transaction.writeActive(progressed, {
      transactionId: applying.transactionId,
      revision: applying.revision,
    });
    await expect(harness.transaction.readActive()).resolves.toEqual(progressed);
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
    const authority = createApplyAuthoritySlots(manifest, prepared);
    const state: KnowledgeRuntimeStoreSnapshot = {
      ...createEmptyKnowledgeRuntimeStoreSnapshot(),
      ...authority,
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
    await persistPreparedApplyAuthority(harness, manifest, prepared);
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
    await persistPreparedApplyAuthority(harness, manifest, first);
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
    await persistPreparedApplyAuthority(harness, manifest, second);
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

    await persistPreparedApplyAuthority(initial, manifest, prepared);
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
    await persistPreparedApplyAuthority(harness, manifest, prepared);
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
    for (const inputRevision of [1, 2, 3, 4]) {
      await expect(harness.revisions.allocate(createCaptureRequest())).resolves.toMatchObject({
        inputRevision,
      });
    }

    const executor: IngestExecutor = {
      /** Produces no changes; the rejected first enqueue never invokes this executor. */
      execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
    };
    const queue = new IngestQueue(harness.queue, executor, {
      clock: () => 100,
      jobIdFactory: () => "job-unallocated-observation",
    });
    const before = await harness.file.read();
    for (const inputRevision of [0, 4, 5]) {
      await expect(
        queue.enqueue({
          bundleId: "personal",
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision,
        })
      ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueObservationAuthorityError);
    }
    expect(await harness.file.read()).toBe(before);
  });

  it("replays an exact capture id after a post-commit allocation failure", async () => {
    const harness = await createHarness();
    const request = {
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "retryable-capture",
    };
    harness.file.throwAfterCommitOnNextWrite();

    await expect(harness.revisions.allocate(request)).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    const committed = await harness.file.read();
    const replay = await harness.revisions.allocate(request);

    expect(replay).toMatchObject({ ...request, inputRevision: 1 });
    expect(replay.observationToken).toMatch(/^[a-f0-9]{32}$/);
    expect(await harness.file.read()).toBe(committed);
  });

  it("rejects capture-id identity reuse without changing durable bytes", async () => {
    const harness = await createHarness();
    await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "identity-conflict-capture",
    });
    const before = await harness.file.read();

    await expect(
      harness.revisions.allocate({
        bundleId: "other",
        sourceId: "source-2",
        captureId: "identity-conflict-capture",
      })
    ).rejects.toBeInstanceOf(SourceInputCaptureConflictError);
    expect(await harness.file.read()).toBe(before);
  });

  it("binds first-write-wins and rejects forged or conflicting tokens", async () => {
    const harness = await createHarness();
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "binding-capture",
    });
    const request = {
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    };

    await expect(harness.observations.bind(request)).resolves.toMatchObject({
      kind: "ready",
      observation: {
        bundleId: "personal",
        sourceId: "source-1",
        captureId: "binding-capture",
        inputRevision: 1,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      },
    });
    const bound = await harness.file.read();
    await expect(harness.observations.bind(request)).resolves.toMatchObject({ kind: "ready" });
    expect(await harness.file.read()).toBe(bound);

    await expect(
      harness.observations.bind({ ...request, sourceContentHash: HASH_C })
    ).rejects.toBeInstanceOf(SourceInputObservationBindingConflictError);
    await expect(
      harness.observations.bind({ ...request, observationToken: "f".repeat(32) })
    ).rejects.toBeInstanceOf(SourceInputObservationTokenError);
    expect(await harness.file.read()).toBe(bound);
  });

  it("serializes conflicting concurrent bindings with exactly one winner", async () => {
    const harness = await createHarness();
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "concurrent-binding-capture",
    });

    const results = await Promise.allSettled([
      harness.observations.bind({
        observationToken: allocation.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      }),
      harness.observations.bind({
        observationToken: allocation.observationToken,
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status !== "rejected") {
      throw new Error("Expected one rejected conflicting binding");
    }
    expect(rejected.reason).toBeInstanceOf(SourceInputObservationBindingConflictError);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(state.inputRevisions[0].sources[0].observations[0]).toMatchObject({ status: "bound" });
  });

  it("atomically consumes an exact binding when Queue advances its watermark", async () => {
    const harness = await createHarness();
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "atomic-consume-capture",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") {
      throw new Error("Expected a Queue-ready source observation");
    }
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises source hand-off. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-atomic-consume" }
    );

    const { observationToken: _observationToken, ...forgedWithoutToken } = bound.observation;
    void _observationToken;
    const beforeForgery = await harness.file.read();
    await expect(queue.enqueue(forgedWithoutToken)).rejects.toBeInstanceOf(
      KnowledgeRuntimeQueueObservationAuthorityError
    );
    await expect(
      queue.enqueue({ ...bound.observation, observationToken: "f".repeat(32) })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeQueueObservationAuthorityError);
    expect(await harness.file.read()).toBe(beforeForgery);
    await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({ kind: "enqueued" });
    await expect(harness.observations.settle(allocation.observationToken)).resolves.toEqual({
      kind: "consumed",
      queueRevision: 1,
    });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(state.inputRevisions[0].sources[0].observations).toEqual([
      expect.objectContaining({
        observationToken: allocation.observationToken,
        status: "consumed",
        queueRevision: 1,
      }),
    ]);
  });

  it("proves a claimed Queue job, consumed observation, and Manifest without changing bytes", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "execution-proof-capture",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound execution observation");
    const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, harness.queue);
    let proof: Readonly<KnowledgeIngestExecutionProof> | undefined;
    let authority: KnowledgeIngestExecutionAuthority | undefined;
    let beforeProof = "";
    let afterProof = "";
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Captures one real same-envelope execution proof. */
        execute: async (context) => {
          const job = context.job;
          const request: KnowledgeIngestExecutionProofRequest = {
            bundleId: job.bundleId,
            jobId: job.id,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            startedAt: job.startedAt,
          };
          beforeProof = await harness.file.read();
          proof = (await proofPort.prove(
            request,
            context.signal
          )) as Readonly<KnowledgeIngestExecutionProof>;
          afterProof = await harness.file.read();
          authority = await new KnowledgeIngestExecutionAuthorityBinder(proofPort).bind(
            context.executionClaim
          );
          await authority.reprove("parsing");
          await context.reportStage("analyzing");
          await authority.reprove("analyzing");
          return { kind: "no_changes", changeSetId: "changeset-proof" };
        },
      },
      { clock: () => 100, jobIdFactory: () => "job-execution-proof" }
    );

    await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({ kind: "enqueued" });
    await expect(queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });

    expect(proof).toMatchObject({
      version: 1,
      bundleId: "personal",
      jobId: "job-execution-proof",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
      startedAt: 100,
      stage: "parsing",
      manifestRevision: 1,
      manifestDigest: createSourceManifestDigest(createRegisteredManifest()),
    });
    expect(proof?.runtimeIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(proof?.observationIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterProof).toBe(beforeProof);
    if (!authority) throw new Error("Expected a bound execution authority");
    await expect(authority.reprove("analyzing")).rejects.toBeInstanceOf(
      KnowledgeIngestExecutionAuthorityError
    );
  });

  it("rejects a processing job whose consumed-observation tuple is shared by Queue history", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "execution-proof-duplicate-job-capture",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound execution observation");
    const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, harness.queue);
    let proofRejected = false;
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Injects valid terminal history sharing the active observation tuple. */
        execute: async (context) => {
          const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
          const queueSlot = state.queues.find((slot) => slot.bundleId === "personal");
          if (!queueSlot) throw new Error("Expected the personal Queue slot");
          const queueSnapshot = queueSlot.value as IngestQueueSnapshot;
          queueSnapshot.jobs.push({
            id: "job-execution-proof-history",
            bundleId: context.job.bundleId,
            sourceId: context.job.sourceId,
            sourceContentHash: context.job.sourceContentHash,
            pipelineFingerprint: context.job.pipelineFingerprint,
            inputRevision: context.job.inputRevision,
            attempt: 1,
            rerunRequested: false,
            createdAt: 90,
            updatedAt: 95,
            status: "completed",
            stage: "completed",
            changeSetId: "changeset-execution-proof-history",
            completedAt: 95,
          });
          harness.file.replaceContent(JSON.stringify(state));
          const request: KnowledgeIngestExecutionProofRequest = {
            bundleId: context.job.bundleId,
            jobId: context.job.id,
            sourceId: context.job.sourceId,
            sourceContentHash: context.job.sourceContentHash,
            pipelineFingerprint: context.job.pipelineFingerprint,
            inputRevision: context.job.inputRevision,
            attempt: context.job.attempt,
            startedAt: context.job.startedAt,
          };
          try {
            await proofPort.prove(request, context.signal);
          } catch (error) {
            expect(error).toBeInstanceOf(KnowledgeRuntimeIngestExecutionProofError);
            proofRejected = true;
          }
          return { kind: "no_changes", changeSetId: "changeset-proof-duplicate-history" };
        },
      },
      { clock: () => 100, jobIdFactory: () => "job-execution-proof-active" }
    );

    await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({ kind: "enqueued" });
    await expect(queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
    expect(proofRejected).toBe(true);
  });

  it("rejects a processing high-watermark that has no exact consumed observation", async () => {
    const harness = await createHarness();
    const request: KnowledgeIngestExecutionProofRequest = {
      bundleId: "personal",
      jobId: "job-high-watermark-only",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
      startedAt: 100,
    };
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.revision = 5;
    state.queues = [
      {
        bundleId: "personal",
        value: {
          ...createQueueSnapshot(2),
          jobs: [
            {
              id: request.jobId,
              bundleId: request.bundleId,
              sourceId: request.sourceId,
              sourceContentHash: request.sourceContentHash,
              pipelineFingerprint: request.pipelineFingerprint,
              inputRevision: request.inputRevision,
              attempt: request.attempt,
              rerunRequested: false,
              createdAt: 90,
              updatedAt: 100,
              status: "processing",
              stage: "parsing",
              startedAt: request.startedAt,
            },
          ],
          sourceHighWatermarks: [
            {
              sourceId: request.sourceId,
              sourceContentHash: request.sourceContentHash,
              pipelineFingerprint: request.pipelineFingerprint,
              inputRevision: request.inputRevision,
              observedAt: 90,
            },
          ],
        },
      },
    ];
    state.manifests = [{ bundleId: "personal", value: createRegisteredManifest() }];
    state.inputRevisions = [
      {
        bundleId: "personal",
        sources: [
          {
            sourceId: request.sourceId,
            inputRevision: request.inputRevision,
            managedAfterRevision: request.inputRevision,
            legacyCheckpoint: {
              sourceId: request.sourceId,
              sourceContentHash: request.sourceContentHash,
              pipelineFingerprint: request.pipelineFingerprint,
              inputRevision: request.inputRevision,
              observedAt: 90,
            },
            observations: [],
          },
        ],
      },
    ];
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();
    const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, harness.queue);

    await expect(proofPort.prove(request, new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeRuntimeIngestExecutionProofError
    );
    expect(await harness.file.read()).toBe(before);
  });

  it("lets a bound read commit while a newer allocation is still unbound", async () => {
    const harness = await createHarness();
    const older = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "bound-before-new-allocation",
    });
    const bound = await harness.observations.bind({
      observationToken: older.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "newer-unbound-allocation",
    });
    if (bound.kind !== "ready") {
      throw new Error("Expected the older read to remain bound");
    }
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises source ordering. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-bound-before-newer" }
    );

    await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({ kind: "enqueued" });
    await expect(harness.observations.settle(older.observationToken)).resolves.toEqual({
      kind: "consumed",
      queueRevision: 1,
    });
  });

  it("reconciles Queue commit-then-throw without duplicating a job or revision", async () => {
    const harness = await createHarness();
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "queue-post-commit-capture",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") {
      throw new Error("Expected a Queue-ready source observation");
    }
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises source hand-off. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-post-commit" }
    );
    harness.file.throwAfterCommitOnNextWrite();

    await expect(queue.enqueue(bound.observation)).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    await expect(harness.observations.settle(allocation.observationToken)).resolves.toEqual({
      kind: "consumed",
      queueRevision: 1,
    });
    const committed = await harness.file.read();
    await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({
      kind: "deduplicated",
      job: { id: "job-post-commit" },
    });
    await expect(harness.observations.settle(allocation.observationToken)).resolves.toEqual({
      kind: "consumed",
      queueRevision: 1,
    });
    expect(await harness.file.read()).toBe(committed);
  });

  it("keeps commit-then-throw recovery behind the narrow production hand-off facade", async () => {
    const harness = await createHarness();
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises the watcher hand-off facade. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-handoff-facade" }
    );
    const handoff = new SourceObservationHandoff(harness.revisions, harness.observations, queue);
    const allocation = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "handoff-facade-capture",
    });
    harness.file.throwAfterCommitOnNthWrite(2);

    await expect(
      handoff.commit({
        observationToken: allocation.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({
      kind: "committed",
      observation: { captureId: "handoff-facade-capture" },
      queueRevision: 1,
    });
    await expect(queue.load("personal")).resolves.toMatchObject({
      revision: 1,
      jobs: [{ id: "job-handoff-facade" }],
    });
  });

  it("recovers a bind commit acknowledgement loss through the narrow hand-off", async () => {
    const harness = await createHarness();
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises source hand-off. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-bind-retry" }
    );
    const handoff = new SourceObservationHandoff(harness.revisions, harness.observations, queue);
    const allocation = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "bind-post-commit-capture",
    });
    harness.file.throwAfterCommitOnNextWrite();

    await expect(
      handoff.commit({
        observationToken: allocation.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({
      kind: "committed",
      observation: { captureId: "bind-post-commit-capture" },
      queueRevision: 1,
    });
    await expect(queue.load("personal")).resolves.toMatchObject({
      revision: 1,
      jobs: [{ id: "job-bind-retry" }],
    });
  });

  it("replays a historical consumed capture without calling Queue or fresh entropy", async () => {
    const harness = await createHarness();
    let jobSequence = 0;
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only exercises source hand-off. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => `job-${++jobSequence}` }
    );
    const handoff = new SourceObservationHandoff(harness.revisions, harness.observations, queue);
    const firstRequest = {
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "historical-capture-a",
    };
    const first = await handoff.allocate(firstRequest);
    await handoff.commit({
      observationToken: first.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    const second = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "historical-capture-b",
    });
    await handoff.commit({
      observationToken: second.observationToken,
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
    });

    const reconstructed = new KnowledgeRuntimeStore(harness.file, {
      clock: () => {
        throw new Error("Replay must not read the clock");
      },
      opaqueIdFactory: () => {
        throw new Error("Replay must not generate an id");
      },
    });
    await reconstructed.initialize();
    let queueCalls = 0;
    const replay = new SourceObservationHandoff(
      new KnowledgeRuntimeInputRevisionAllocator(reconstructed),
      new KnowledgeRuntimeInputObservationBinder(reconstructed),
      {
        /** Fails if a terminal replay incorrectly reaches Queue. */
        enqueue: async () => {
          queueCalls += 1;
          throw new Error("Terminal replay must not call Queue");
        },
      }
    );
    const replayedAllocation = await replay.allocate(firstRequest);

    await expect(
      replay.commit({
        observationToken: replayedAllocation.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({
      kind: "committed",
      observation: {
        captureId: "historical-capture-a",
        inputRevision: 1,
        sourceContentHash: HASH_A,
      },
      queueRevision: 1,
    });
    expect(queueCalls).toBe(0);
    await expect(queue.load("personal")).resolves.toMatchObject({
      revision: 2,
      sourceHighWatermarks: [{ inputRevision: 2, sourceContentHash: HASH_C }],
    });
  });

  it("enumerates bound restart work and removes it only after exact Queue consumption", async () => {
    const harness = await createHarness();
    const boundAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-z",
      captureId: "restart-bound-capture",
    });
    const bound = await harness.observations.bind({
      observationToken: boundAllocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") {
      throw new Error("Expected restart work to be bound");
    }
    const allocated = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-a",
      captureId: "restart-allocated-capture",
    });

    const reconstructed = new KnowledgeRuntimeStore(harness.file);
    await reconstructed.initialize();
    const observations = new KnowledgeRuntimeInputObservationBinder(reconstructed);
    const queue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(reconstructed),
      {
        /** Produces no changes; this test only exercises restart recovery. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-restart-recovery" }
    );
    const handoff = new SourceObservationHandoff(
      new KnowledgeRuntimeInputRevisionAllocator(reconstructed),
      observations,
      queue
    );
    await expect(handoff.loadRecoveryWork("personal")).resolves.toEqual([
      { kind: "allocated", allocation: allocated },
      { kind: "bound", observation: bound.observation },
    ]);

    await handoff.commit({
      observationToken: bound.observation.observationToken,
      sourceContentHash: bound.observation.sourceContentHash,
      pipelineFingerprint: bound.observation.pipelineFingerprint,
    });

    await expect(handoff.loadRecoveryWork("personal")).resolves.toEqual([
      { kind: "allocated", allocation: allocated },
    ]);
  });

  it("blocks startup release while a bound observation still needs Queue settlement", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createStartupPausedQueue(1), null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "startup-bound-observation",
    });
    await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    const request = await createStartupReleaseRequest(harness);
    const before = await harness.file.read();

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "source_observation_pending",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("blocks startup release while an allocated observation still needs capture settlement", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createStartupPausedQueue(1), null);
    await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "startup-allocated-observation",
    });
    const request = await createStartupReleaseRequest(harness);
    const before = await harness.file.read();

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "source_observation_pending",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("maps another Bundle's allocated observation to the global recovery blocker", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createStartupPausedQueue(1), null);
    await harness.revisions.allocate({
      bundleId: "other",
      sourceId: "source-1",
      captureId: "other-bundle-allocated-observation",
    });
    const request = await createStartupReleaseRequest(harness);
    const before = await harness.file.read();

    await expect(harness.release.release(request)).resolves.toEqual({
      kind: "blocked",
      bundleId: "personal",
      reason: "other_bundle_apply_recovery_present",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("serializes concurrent observation allocation without duplicate revisions", async () => {
    const harness = await createHarness();

    const allocations = await Promise.all([
      harness.revisions.allocate(createCaptureRequest()),
      harness.revisions.allocate(createCaptureRequest()),
      harness.revisions.allocate(createCaptureRequest()),
    ]);

    expect(allocations.map(({ inputRevision }) => inputRevision).sort()).toEqual([1, 2, 3]);
  });

  it("returns one capability for concurrent retries of the same capture", async () => {
    const harness = await createHarness();
    const request = {
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "concurrent-identical-capture",
    };

    const allocations = await Promise.all([
      harness.revisions.allocate(request),
      harness.revisions.allocate(request),
      harness.revisions.allocate(request),
    ]);

    expect(allocations).toEqual([allocations[0], allocations[0], allocations[0]]);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(state.inputRevisions[0].sources[0].observations).toHaveLength(1);
  });

  it("preserves allocation across runtime reconstruction and isolates Bundle/source namespaces", async () => {
    const harness = await createHarness();
    await harness.revisions.allocate(createCaptureRequest("personal", "source-1"));
    await harness.revisions.allocate(createCaptureRequest("personal", "source-1"));

    const reconstructedRuntime = new KnowledgeRuntimeStore(harness.file);
    await reconstructedRuntime.initialize();
    const reconstructed = new KnowledgeRuntimeInputRevisionAllocator(reconstructedRuntime);

    await expect(
      reconstructed.allocate(createCaptureRequest("personal", "source-1"))
    ).resolves.toMatchObject({ inputRevision: 3 });
    await expect(
      reconstructed.allocate(createCaptureRequest("personal", "source-2"))
    ).resolves.toMatchObject({ inputRevision: 1 });
    await expect(
      reconstructed.allocate(createCaptureRequest("another", "source-1"))
    ).resolves.toMatchObject({ inputRevision: 1 });
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
      captureId: "ordering-older",
    });
    const newer = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "ordering-newer",
    });

    await harness.observations.bind({
      observationToken: newer.observationToken,
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
    });
    await expect(
      harness.observations.bind({
        observationToken: older.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_A,
      })
    ).resolves.toMatchObject({ kind: "superseded" });

    await queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
      inputRevision: newer.inputRevision,
      observationToken: newer.observationToken,
    });
    await queue.enqueue({
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_A,
      inputRevision: older.inputRevision,
      observationToken: older.observationToken,
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
          sources: [
            {
              sourceId: "source-1",
              inputRevision: Number.MAX_SAFE_INTEGER,
              managedAfterRevision: Number.MAX_SAFE_INTEGER,
              observations: [],
            },
          ],
        },
      ],
    };
    harness.file.replaceContent(JSON.stringify(saturated));
    const before = await harness.file.read();

    await expect(
      harness.revisions.allocate({
        bundleId: "personal",
        sourceId: "source-1",
        captureId: "overflow-capture",
      })
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
        captureId: "corrupt-store-capture",
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

  it("rejects observation journals that no Runtime API transition can produce", async () => {
    const harness = await createHarness();
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Produces no changes; this test only assembles valid consumed history. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 100, jobIdFactory: () => "job-journal-semantics" }
    );
    const handoff = new SourceObservationHandoff(harness.revisions, harness.observations, queue);
    const first = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "journal-first",
    });
    await handoff.commit({
      observationToken: first.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    const second = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "journal-second",
    });
    await handoff.commit({
      observationToken: second.observationToken,
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
    });
    const valid = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const validSource = valid.inputRevisions[0]?.sources[0];
    const validQueue = valid.queues[0]?.value as IngestQueueSnapshot | undefined;
    const firstRecord = validSource?.observations[0];
    const secondRecord = validSource?.observations[1];
    if (!validSource || !validQueue || !firstRecord || !secondRecord) {
      throw new Error("Expected two consumed source observations");
    }

    const olderAllocated = JSON.parse(JSON.stringify(valid)) as KnowledgeRuntimeStoreSnapshot;
    olderAllocated.inputRevisions[0].sources[0].observations[0] = {
      observationToken: firstRecord.observationToken,
      captureId: firstRecord.captureId,
      inputRevision: firstRecord.inputRevision,
      allocatedAt: firstRecord.allocatedAt,
      status: "allocated",
    };

    const impossibleSupersession = JSON.parse(
      JSON.stringify(valid)
    ) as KnowledgeRuntimeStoreSnapshot;
    impossibleSupersession.queues = [];
    impossibleSupersession.inputRevisions[0].sources[0].observations = [
      {
        observationToken: firstRecord.observationToken,
        captureId: firstRecord.captureId,
        inputRevision: firstRecord.inputRevision,
        allocatedAt: firstRecord.allocatedAt,
        status: "superseded",
        settledAt: 100,
        supersededByInputRevision: secondRecord.inputRevision,
      },
      {
        observationToken: secondRecord.observationToken,
        captureId: secondRecord.captureId,
        inputRevision: secondRecord.inputRevision,
        allocatedAt: secondRecord.allocatedAt,
        status: "allocated",
      },
    ];

    const rolledBackWatermark = JSON.parse(JSON.stringify(valid)) as KnowledgeRuntimeStoreSnapshot;
    const rollbackQueue = rolledBackWatermark.queues[0].value as IngestQueueSnapshot;
    rollbackQueue.sourceHighWatermarks = [
      {
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 100,
      },
    ];
    rollbackQueue.jobs[0] = {
      ...rollbackQueue.jobs[0],
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
    };

    const managedFallback = JSON.parse(
      JSON.stringify(rolledBackWatermark)
    ) as KnowledgeRuntimeStoreSnapshot;
    const fallbackSource = managedFallback.inputRevisions[0].sources[0];
    fallbackSource.managedAfterRevision = 1;
    fallbackSource.legacyCheckpoint = {
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      observedAt: 100,
    };
    fallbackSource.observations = [fallbackSource.observations[1]];

    const reversedConsumptionRevisions = JSON.parse(
      JSON.stringify(valid)
    ) as KnowledgeRuntimeStoreSnapshot;
    const reversedObservations =
      reversedConsumptionRevisions.inputRevisions[0].sources[0].observations;
    const earlierConsumption = reversedObservations[0];
    const laterConsumption = reversedObservations[1];
    if (earlierConsumption.status !== "consumed" || laterConsumption.status !== "consumed") {
      throw new Error("Expected two consumed observations");
    }
    earlierConsumption.queueRevision = 2;
    laterConsumption.queueRevision = 1;

    for (const corrupt of [
      olderAllocated,
      impossibleSupersession,
      rolledBackWatermark,
      managedFallback,
      reversedConsumptionRevisions,
    ]) {
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(corrupt));
      const runtime = new KnowledgeRuntimeStore(file);

      await expect(runtime.readQueue("personal")).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
    }
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
      {
        name: "unsupported version",
        value: { ...base, version: KNOWLEDGE_RUNTIME_STORE_VERSION + 1 },
      },
    ];

    for (const scenario of scenarios) {
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(scenario.value));
      const runtime = new KnowledgeRuntimeStore(file);
      const allocator = new KnowledgeRuntimeInputRevisionAllocator(runtime);
      const before = await file.read();

      await expect(
        allocator.allocate({
          bundleId: "unrelated",
          sourceId: scenario.name,
          captureId: `corruption-${scenario.name}`,
        })
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
