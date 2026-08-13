import {
  ChangeSetTransaction,
  createTransactionCommitReceipt,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ObsidianKnowledgeCompilerTargetResolver,
  type ObsidianKnowledgeCompilerTargetVisitPort,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
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
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { KnowledgeProductionForwardRevisionProposalCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import { KnowledgeProductionForwardRevisionDecisionCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator";
import { KnowledgeProductionForwardRevisionValidationCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import { KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY } from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionPublishedProposal,
  snapshotKnowledgeForwardRevisionReviewSnapshot,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshot";
import { migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2 } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import { createKnowledgeForwardRevisionProposalAuthorityQuery } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalAuthority";
import {
  createKnowledgeForwardRevisionValidationAuthorityQuery,
  snapshotKnowledgeForwardRevisionValidationAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import { createKnowledgeForwardRevisionReviewCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  IngestQueue,
  type IngestExecutor,
  type IngestSourceFreshnessAdmissionPort,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { buildKnowledgeSourceWatchPlan } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { SourceObservationHandoff } from "@/knowledge/ingest/SourceObservationHandoff";
import {
  KnowledgeIngestExecutionAuthorityBinder,
  KnowledgeIngestExecutionAuthorityError,
  type KnowledgeIngestExecutionAuthority,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  validateIngestQueueSnapshot,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY,
  createKnowledgeNoChangesCommitMarker,
  createNoChangesManifestCommitPlan,
  createNoChangesManifestCommitPlanDigest,
  parseKnowledgeNoChangesCommitMarker,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { SourceManifestRevisionConflictError } from "@/knowledge/manifest/SourceManifestStorage";
import {
  createKnowledgeSourceRetirementRecord,
  parseKnowledgeSourceRetirements,
  projectKnowledgeSourceRetirement,
} from "@/knowledge/manifest/SourceRetirement";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
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
import {
  KnowledgeLiteralRejectCommandError,
  KnowledgeReviewRejectConflictError,
  type KnowledgeLiteralRejectCommand,
} from "@/knowledge/review/ReviewRejectTransition";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import { projectKnowledgeKnownAppliedWikiOutputIndex } from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import {
  KnowledgeApplyCommitAuthorityError,
  KnowledgeApplyCommitLedgerConflictError,
  KnowledgeApplyCommitManifestConflictError,
  KnowledgeApplyCommitProofError,
  KnowledgeNoJournalApplyRecoveryConflictError,
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeAtomicWriteError,
  KnowledgeRuntimeForwardRevisionProposalPublicationPort,
  KnowledgeRuntimeForwardRevisionDecisionPort,
  KnowledgeForwardRevisionDecisionPortError,
  KnowledgeRuntimeForwardRevisionValidationPort,
  KnowledgeForwardRevisionPublicationConflictError,
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeIngestExecutionProofError,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeManifestProtectedStateError,
  KnowledgeRuntimeManifestReservationError,
  KnowledgeRuntimeMigrationUnsafeError,
  KnowledgeRuntimeNoChangesCommitConflictError,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueObservationAuthorityError,
  KnowledgeRuntimeQueueRecoveryGateProtectedError,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStartupReleasePort,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeStoreCorruptError,
  KnowledgeRuntimeSourceRetiredError,
  KnowledgeRuntimeTransactionStorage,
  KnowledgeSourceRetirementConflictError,
  KNOWLEDGE_RUNTIME_STORE_VERSION,
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  SourceInputCaptureConflictError,
  SourceInputObservationBindingConflictError,
  SourceInputObservationTokenError,
  SourceInputRevisionOverflowError,
  createEmptyKnowledgeRuntimeStoreSnapshot,
  type KnowledgeApplyCommitLedgerRecord,
  type KnowledgeForwardRevisionProposalPublicationEvidence,
  type KnowledgeRuntimeStudioBundleSnapshot,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgePluginProductionPreflightLifecycle,
  KnowledgePluginProductionWorkflowLease,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import {
  createKnowledgeProductionWorkflowExecutionPairing,
  type KnowledgeProductionWorkflowExecutionPreflightClaim,
  type KnowledgeProductionWorkflowExecutionRuntimeClaim,
} from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import { KnowledgeProductionKnownAppliedWikiOutputsCoordinator } from "@/knowledge/wiki/KnowledgeProductionKnownAppliedWikiOutputsCoordinator";
import type { App, DataAdapter, Vault } from "obsidian";
import { TFile } from "obsidian";

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
  private readCallCount = 0;
  private misreportNextWrite = false;
  private repeatNextTransform = false;
  private skipNextTransform = false;
  private throwAfterCommitCountdown = 0;
  private beforeNextTransform?: () => void;
  private afterNextCommit?: () => void;

  /** Creates the initial content only when the memory file is absent. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) {
      this.content = initialContent;
    }
  }

  /** Reads the exact current memory file. */
  async read(): Promise<string> {
    this.readCallCount += 1;
    if (this.content === undefined) {
      throw new Error("Memory runtime file is not initialized");
    }
    return this.content;
  }

  /** Returns how many complete plaintext reads crossed this atomic boundary. */
  getReadCallCount(): number {
    return this.readCallCount;
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
      const beforeTransform = this.beforeNextTransform;
      this.beforeNextTransform = undefined;
      beforeTransform?.();
      const next = transform(this.content);
      if (this.repeatNextTransform) {
        this.repeatNextTransform = false;
        transform(this.content);
      }
      this.content = next;
      const afterCommit = this.afterNextCommit;
      this.afterNextCommit = undefined;
      afterCommit?.();
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

  /** Runs one synchronous test hook immediately before the next atomic transform. */
  runBeforeNextTransform(callback: () => void): void {
    this.beforeNextTransform = callback;
  }

  /** Runs one synchronous test hook after the next commit and before its acknowledgement. */
  runAfterNextCommit(callback: () => void): void {
    this.afterNextCommit = callback;
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

/** Creates one outer runtime whose current fingerprint has only shape-level completion. */
function createMarkerlessCompletionRuntimeSnapshot(
  version: 3 | typeof KNOWLEDGE_RUNTIME_STORE_VERSION,
  control: IngestQueueSnapshot["control"] = { status: "running" }
): Record<string, unknown> {
  const queue: IngestQueueSnapshot = {
    ...createQueueSnapshot(1),
    control,
    jobs: [
      {
        id: "job-markerless-completion",
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 90,
        updatedAt: 120,
        status: "completed",
        stage: "completed",
        changeSetId: "markerless-completion",
        completedAt: 120,
      },
    ],
    sourceHighWatermarks: [
      {
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 100,
      },
    ],
  };
  return {
    version,
    runtimeId: "1".repeat(32),
    revision: 7,
    queues: [{ bundleId: "personal", value: queue }],
    reviews: [],
    ...(version === KNOWLEDGE_RUNTIME_STORE_VERSION ? { forwardRevisionReviews: [] } : {}),
    manifests: [{ bundleId: "personal", value: createRegisteredManifest() }],
    activeTransaction: null,
    inputRevisions: [
      {
        bundleId: "personal",
        sources: [
          {
            sourceId: "source-1",
            inputRevision: 1,
            managedAfterRevision: 0,
            observations: [
              {
                observationToken: "2".repeat(32),
                captureId: "markerless-completion-capture",
                inputRevision: 1,
                allocatedAt: 80,
                status: "consumed",
                sourceContentHash: HASH_A,
                pipelineFingerprint: HASH_B,
                boundAt: 90,
                settledAt: 100,
                queueRevision: 1,
              },
            ],
          },
        ],
      },
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

/** Creates one valid source citation for applied-provenance tests. */
function createSourceCitation(
  sourceId = "source-1",
  artifactContentHash = HASH_A,
  artifactId = `artifact-${sourceId}`
): KnowledgeChangeSet["citations"][number] {
  const excerpt = `Grounded evidence for ${sourceId}`;
  return {
    citationId: `citation-${sourceId}`,
    claimId: `claim-${sourceId}`,
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId,
      artifactId,
      artifactContentHash,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
      startLine: 1,
      endLine: 1,
    },
  };
}

/** Creates one text-parser-backed quote citation for genuine production validation. */
function createSourceQuoteCitation(
  sourceId: string,
  artifactContentHash: string,
  artifactId: string
): KnowledgeChangeSet["citations"][number] {
  const excerpt = `Grounded evidence for ${sourceId}`;
  return {
    citationId: `citation-${sourceId}`,
    claimId: `claim-${sourceId}`,
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId,
      artifactId,
      artifactContentHash,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
    },
  };
}

/** Creates one accepted create-only ChangeSet for transaction storage tests. */
function createAcceptedChangeSet(
  transactionId = "transaction-1",
  citations: KnowledgeChangeSet["citations"] = [],
  afterContent = `# ${transactionId}\n`
): KnowledgeChangeSet {
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
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

/** Creates a valid prepared journal at revision zero. */
function createPreparedJournal(
  transactionId = "transaction-1",
  citations: KnowledgeChangeSet["citations"] = [],
  afterContent?: string
): ChangeSetTransactionJournal {
  const changeSet = createAcceptedChangeSet(transactionId, citations, afterContent);
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

/** Creates one strict zero-page no-change plan over an exact Manifest read-set. */
function createRuntimeNoChangesPlan(
  manifest: SourceManifest,
  inputRevision = 1,
  sourceContentHash = HASH_A,
  pipelineFingerprint = HASH_B
) {
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  const baseGeneratedPages = (source?.lastSuccessful?.generatedPages ?? []).map((page) => {
    if (page.contentHash === undefined) {
      throw new Error("Runtime no-change fixture requires exact generated-page hashes");
    }
    return { ...page, contentHash: page.contentHash };
  });
  return createNoChangesManifestCommitPlan({
    bundleId: manifest.bundleId,
    sourceId: "source-1",
    sourceContentHash,
    pipelineFingerprint,
    inputRevision,
    compileContextDigest: HASH_A,
    analysisDigest: HASH_B,
    evidenceDigest: HASH_C,
    reason: "analysis_no_targets",
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    baseGeneratedPages,
    sourceAuthority: { operation: "ingest" },
  });
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
  inputRevision: number,
  sourceContentHash = HASH_A,
  pipelineFingerprint = HASH_B
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
    sourceContentHash,
    pipelineFingerprint,
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
  inputRevision = 1,
  citations: KnowledgeChangeSet["citations"] = [],
  fixture?: Readonly<{
    afterContent?: string;
    sourceContentHash?: string;
    pipelineFingerprint?: string;
  }>
): {
  journal: ChangeSetTransactionJournal & { phase: "committed" };
  receipt: TransactionCommitReceipt;
} {
  const sourceContentHash = fixture?.sourceContentHash ?? HASH_A;
  const pipelineFingerprint = fixture?.pipelineFingerprint ?? HASH_B;
  const prepared = createPreparedJournal(transactionId, citations, fixture?.afterContent);
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
    inputRevision,
    sourceContentHash,
    pipelineFingerprint
  );
  const manifestCommitIntent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash,
    pipelineFingerprint,
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
    jobClaim: {
      ...prepared.jobClaim,
      sourceContentHash,
      pipelineFingerprint,
      inputRevision,
    },
    appliedCount: prepared.targets.length,
    phase: "committed",
    committedAt: 240,
    updatedAt: 240,
  };
  return { journal, receipt: createTransactionCommitReceipt(journal) };
}

/** Creates a second exact Apply that replaces one historical generated page. */
function createForwardCurrentUpdateProof(
  manifest: SourceManifest,
  pagePath: string,
  beforeContent: string,
  afterContent = "# Current forward target\n",
  sourceContentHash = HASH_A,
  pipelineFingerprint = HASH_B
): {
  journal: ChangeSetTransactionJournal & { phase: "committed" };
  receipt: TransactionCommitReceipt;
} {
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  const basePage = source?.lastSuccessful?.generatedPages.find((page) => page.path === pagePath);
  if (!source || !basePage?.contentHash) {
    throw new Error("Expected one exact historical generated page");
  }
  const afterHash = createFileContentHash(afterContent);
  const changeSet: KnowledgeChangeSet = {
    id: "changeset-forward-current",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: "change-forward-current",
        operation: "update",
        path: pagePath,
        sourceRefs: ["source-1"],
        reason: "Advance one generated page",
        beforeHash: basePage.contentHash,
        afterContent,
        afterHash,
      },
    ],
    citations: [createSourceCitation()],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 330,
  };
  const plan = createManifestCommitPlanFixture(
    manifest,
    changeSet,
    2,
    sourceContentHash,
    pipelineFingerprint
  );
  const generatedPages = (source.lastSuccessful?.generatedPages ?? [])
    .map((page) => ({
      path: page.path,
      ownership: page.ownership,
      contentHash: page.path === pagePath ? afterHash : page.contentHash,
    }))
    .sort((left, right) => toWindowsPathKey(left.path).localeCompare(toWindowsPathKey(right.path)));
  if (generatedPages.some((page) => page.contentHash === undefined)) {
    throw new Error("Expected content-addressed current generated pages");
  }
  const intent: ManifestCommitIntent = {
    version: 1,
    kind: "source_compile",
    bundleId: manifest.bundleId,
    sourceId: source.sourceId,
    sourceContentHash,
    pipelineFingerprint,
    inputRevision: 2,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(plan),
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: generatedPages as ManifestCommitIntent["generatedPages"],
  };
  const journal: ChangeSetTransactionJournal & { phase: "committed" } = {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: "transaction-forward-current",
    revision: 4,
    bundleId: manifest.bundleId,
    bundle: createBundle(),
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(intent),
    jobClaim: {
      jobId: "job-forward-current",
      attempt: 1,
      startedAt: 330,
      sourceId: source.sourceId,
      sourceContentHash,
      pipelineFingerprint,
      inputRevision: 2,
    },
    changeSet,
    targets: [
      {
        changeId: "change-forward-current",
        path: pagePath,
        windowsPathKey: toWindowsPathKey(pagePath),
        operation: "update",
        before: { kind: "file", content: beforeContent, contentHash: basePage.contentHash },
        after: { kind: "file", content: afterContent, contentHash: afterHash },
      },
    ],
    appliedCount: 1,
    createdAt: 330,
    updatedAt: 340,
    phase: "committed",
    committedAt: 340,
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

/** Creates two exact historical co-owners of one content-addressed shared page. */
function createSharedPageManifest(): SourceManifest {
  const beforeHash = createFileContentHash("# Shared before\n");
  return {
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
        extensions: {
          [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
            version: 1,
            inputRevision: 1,
            transactionId: "transaction-primary-old",
            manifestIntentDigest: HASH_A,
          },
        },
      },
      {
        sourceId: "source-2",
        sourceKey: "sources/source-2.md",
        sourcePath: "Sources/Source-2.md",
        custody: "managed_copy",
        lastSuccessful: {
          sourceContentHash: HASH_B,
          pipelineFingerprint: HASH_A,
          generatedPages: [
            { path: "Wiki/Shared.md", ownership: "shared", contentHash: beforeHash },
          ],
          changeSetId: "changeset-coowner-old",
          completedAt: 110,
        },
        extensions: {
          [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
            version: 1,
            inputRevision: 1,
            transactionId: "transaction-coowner-old",
            manifestIntentDigest: HASH_A,
          },
        },
      },
    ],
  };
}

/** Creates exact historical ledger entries required by the shared-page fixture. */
function createSharedPageHistoricalLedgers(): KnowledgeApplyCommitLedgerRecord[] {
  return [
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
    citations: [createSourceCitation("source-1")],
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
  const plan = createManifestCommitPlanFixture(
    manifest,
    proposal,
    journal.jobClaim.inputRevision,
    journal.jobClaim.sourceContentHash,
    journal.jobClaim.pipelineFingerprint
  );
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

/** Reconstructs exact forward-publication evidence from a two-Apply Runtime history. */
function createForwardPublicationEvidence(
  state: KnowledgeRuntimeStoreSnapshot,
  selectedContent = "# transaction-forward-historical\n"
): KnowledgeForwardRevisionProposalPublicationEvidence {
  const pagePath = "Wiki/transaction-forward-historical.md";
  const selectedContentHash = createFileContentHash(selectedContent);
  const historical = state.applyCommits.find(
    (record) => record.transactionId === "transaction-forward-historical"
  );
  const review = state.reviews.find((slot) => slot.bundleId === "personal")
    ?.value as ChangeSetReviewSnapshot;
  const accepted = review.records.find(
    (record) =>
      record.outcome === "accepted" &&
      record.acceptedChangeSet.id === "changeset-transaction-forward-historical"
  );
  const manifest = state.manifests.find((slot) => slot.bundleId === "personal")
    ?.value as SourceManifest;
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  const currentPage = source?.lastSuccessful?.generatedPages.find((page) => page.path === pagePath);
  if (
    !historical ||
    !accepted ||
    accepted.outcome !== "accepted" ||
    !source ||
    !source.lastSuccessful ||
    !currentPage?.contentHash
  ) {
    throw new Error("Expected exact forward publication authority fixtures");
  }
  const noChanges = parseKnowledgeNoChangesCommitMarker(
    source.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
  );
  const currentInput = noChanges.ok
    ? {
        sourceContentHash: noChanges.value.sourceContentHash,
        pipelineFingerprint: noChanges.value.pipelineFingerprint,
        inputRevision: noChanges.value.inputRevision,
      }
    : {
        sourceContentHash: source.lastSuccessful.sourceContentHash,
        pipelineFingerprint: source.lastSuccessful.pipelineFingerprint,
        inputRevision: 2,
      };
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath,
    historical: {
      bundleId: "personal",
      pagePath,
      transactionId: historical.transactionId,
      sourceId: historical.sourceId,
      sourceContentHash: historical.sourceContentHash,
      pipelineFingerprint: historical.pipelineFingerprint,
      inputRevision: historical.inputRevision,
      changeSetId: historical.changeSetId,
      changeSetDigest: historical.changeSetDigest,
      manifestIntentDigest: historical.manifestIntentDigest,
      manifestAfterRevision: historical.manifestAfterRevision,
      manifestAfterDigest: historical.manifestAfterDigest,
      appliedAt: historical.recordedAt,
      selectedContentHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: [source.sourceId],
      primarySourceId: source.sourceId,
      ...currentInput,
      manifestRevision: manifest.revision,
      manifestDigest: createSourceManifestDigest(manifest),
      manifestBaseHash: currentPage.contentHash,
      vaultObservedBeforeHash: currentPage.contentHash,
    },
  });
  const historicalChange = accepted.acceptedChangeSet.changes.find(
    (change) => change.path === pagePath
  );
  const historicalPage = accepted.manifestCommitIntent.generatedPages.find(
    (page) => page.path === pagePath
  );
  if (
    !historicalChange ||
    (historicalChange.operation !== "create" && historicalChange.operation !== "update") ||
    !historicalPage?.contentHash
  ) {
    throw new Error("Expected exact selected historical page fixtures");
  }
  return {
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: accepted.proposalDigest,
      acceptedDigest: accepted.acceptedDigest,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
      acceptedAt: accepted.acceptedAt,
      targetChange: {
        changeId: historicalChange.id,
        path: historicalChange.path,
        operation: historicalChange.operation,
        afterHash: historicalChange.afterHash,
        sourceRefs: [historicalChange.sourceRefs[0]],
      },
      manifestPage: {
        path: historicalPage.path,
        ownership: "generated",
        contentHash: historicalPage.contentHash,
      },
    },
    selectedContent,
    selectedContentHash,
    vaultObservedBeforeHash: currentPage.contentHash,
  };
}

/** Creates the exact R3b observation query for the historical forward output. */
function createForwardAuthorityQuery(state: KnowledgeRuntimeStoreSnapshot) {
  const evidence = createForwardPublicationEvidence(state);
  const intent = evidence.intent as ReturnType<typeof createKnowledgeForwardRevisionIntent>;
  const selected = projectKnowledgeKnownAppliedWikiOutputIndexForTest(state).outputs.find(
    (item) => item.contentHash === evidence.selectedContentHash
  );
  if (!selected) throw new Error("Expected selected strict known output");
  return createKnowledgeForwardRevisionProposalAuthorityQuery({
    bundleId: "personal",
    pagePath: intent.pagePath,
    selectedContentHash: evidence.selectedContentHash,
    selectedAppliedAt: selected.newestAppliedAt,
    selectedVerifiedApplyCount: selected.verifiedApplyCount,
    vaultObservedBeforeHash: evidence.vaultObservedBeforeHash,
  });
}

/** Projects the strict known-output index from one test Runtime envelope. */
function projectKnowledgeKnownAppliedWikiOutputIndexForTest(state: KnowledgeRuntimeStoreSnapshot) {
  const evidence = createForwardPublicationEvidence(state);
  const intent = evidence.intent as ReturnType<typeof createKnowledgeForwardRevisionIntent>;
  const manifest = state.manifests.find((slot) => slot.bundleId === "personal")
    ?.value as SourceManifest;
  const review = state.reviews.find((slot) => slot.bundleId === "personal")
    ?.value as ChangeSetReviewSnapshot;
  const source = manifest.entries.find((entry) => entry.sourceId === "source-1");
  const page = source?.lastSuccessful?.generatedPages.find(
    (candidate) => candidate.path === intent.pagePath
  );
  if (!page?.contentHash) throw new Error("Expected current forward target page");
  return projectKnowledgeKnownAppliedWikiOutputIndex({
    runtimeId: state.runtimeId,
    runtimeRevision: state.revision,
    bundleId: "personal",
    pagePath: intent.pagePath,
    applyCommits: state.applyCommits,
    review,
    manifestRevision: manifest.revision,
    currentManifestPage: {
      path: page.path,
      windowsPathKey: toWindowsPathKey(page.path),
      ownership: page.ownership,
      contentHash: page.contentHash,
    },
  });
}

/** Creates clean exact historical/current Apply authority for forward publication tests. */
async function createForwardPublicationHarness(
  clock: () => number = () => 1,
  createPublicationPort: (
    runtime: KnowledgeRuntimeStore
  ) => KnowledgeRuntimeForwardRevisionProposalPublicationPort = (runtime) =>
    new KnowledgeRuntimeForwardRevisionProposalPublicationPort(runtime),
  fixture?: Readonly<{
    historicalContent?: string;
    currentContent?: string;
    sourceContentHash?: string;
    pipelineFingerprint?: string;
    citationArtifactContentHash?: string;
    citationArtifactId?: string;
    historicalCitation?: KnowledgeChangeSet["citations"][number];
    productionExecutionClaim?: KnowledgeProductionWorkflowExecutionRuntimeClaim;
  }>
) {
  const historicalContent = fixture?.historicalContent ?? "# transaction-forward-historical\n";
  const currentContent = fixture?.currentContent ?? "# Current forward target\n";
  const sourceContentHash = fixture?.sourceContentHash ?? HASH_A;
  const pipelineFingerprint = fixture?.pipelineFingerprint ?? HASH_B;
  const historicalManifest = createRegisteredManifest();
  const historicalProof = createCommittedApplyProof(
    historicalManifest,
    "transaction-forward-historical",
    1,
    [
      fixture?.historicalCitation ??
        createSourceCitation(
          "source-1",
          fixture?.citationArtifactContentHash ?? HASH_A,
          fixture?.citationArtifactId ?? "artifact-source-1"
        ),
    ],
    { afterContent: historicalContent, sourceContentHash, pipelineFingerprint }
  );
  const first = await createApplyHarness(historicalManifest, historicalProof);
  await first.port.recordCommitted(first.journal, first.receipt);
  const firstState = JSON.parse(await first.file.read()) as KnowledgeRuntimeStoreSnapshot;
  const firstCommittedManifest = firstState.manifests[0].value as SourceManifest;
  const currentProof = createForwardCurrentUpdateProof(
    firstCommittedManifest,
    "Wiki/transaction-forward-historical.md",
    historicalContent,
    currentContent,
    sourceContentHash,
    pipelineFingerprint
  );
  const current = await createApplyHarness(firstCommittedManifest, currentProof);
  const currentState = JSON.parse(await current.file.read()) as KnowledgeRuntimeStoreSnapshot;
  const historicalReview = firstState.reviews[0].value as ChangeSetReviewSnapshot;
  const currentReview = currentState.reviews[0].value as ChangeSetReviewSnapshot;
  currentReview.revision = 2;
  currentReview.records = [...historicalReview.records, ...currentReview.records];
  currentState.applyCommits = firstState.applyCommits;
  current.file.replaceContent(JSON.stringify(currentState));
  await current.port.recordCommitted(current.journal, current.receipt);

  const clean = JSON.parse(await current.file.read()) as KnowledgeRuntimeStoreSnapshot;
  clean.activeTransaction = null;
  clean.queues = [];
  clean.inputRevisions = [
    {
      bundleId: "personal",
      sources: [
        {
          sourceId: "source-1",
          inputRevision: 2,
          managedAfterRevision: 2,
          observations: [],
        },
      ],
    },
  ];
  current.file.replaceContent(JSON.stringify(clean));
  const runtime = new KnowledgeRuntimeStore(current.file, {
    clock,
    productionExecutionClaim: fixture?.productionExecutionClaim,
  });
  return {
    file: current.file,
    runtime,
    port: createPublicationPort(runtime),
    evidence: createForwardPublicationEvidence(clean, historicalContent),
    currentJournal: current.journal,
  };
}

/** Creates one authentic preflight lease and consumes its exact composition owner. */
async function createForwardDecisionExecutionLease(
  executionPreflightClaim: KnowledgeProductionWorkflowExecutionPreflightClaim
) {
  const modelName = "deepseek-v4-pro";
  const lifecycle = new KnowledgePluginProductionPreflightLifecycle({
    executionPreflightClaim,
    getProjectRecords: () => [
      {
        project: {
          id: "project-personal",
          knowledgeBundle: {
            version: 1,
            id: "personal",
            sourceRoots: ["Sources"],
            wikiRoot: "Wiki",
            schemaRef: "Knowledge/schema.md",
            reviewMode: "always",
          },
          projectModelKey: `${modelName}|deepseek`,
          modelConfigs: {},
        },
      },
    ],
    getSettings: () => ({
      temperature: 0,
      maxTokens: 8_192,
      reasoningEffort: "high",
      verbosity: "medium",
      activeModels: [
        {
          name: modelName,
          provider: "deepseek",
          enabled: true,
          projectEnabled: true,
          temperature: 0,
          reasoningEffort: "high",
          apiKey: "test-only-model-key",
        },
      ],
      deepseekApiKey: "test-only-provider-key",
    }),
    fetchPort: async () => {
      throw new Error("Decision tests must not invoke the model route");
    },
    createResources: () => createKnowledgeProductionPipelineResources(),
  });
  const result = await lifecycle.load(new AbortController().signal);
  if (result.kind !== "configured") throw new Error("Expected configured preflight");
  const { workflowLease, workflowCompositionClaim } = result.admission;
  const executionOwner = KnowledgePluginProductionWorkflowLease.consumeCompositionClaim(
    workflowLease,
    workflowCompositionClaim
  );
  const executionLease = KnowledgePluginProductionWorkflowLease.getExecutionLease(
    workflowLease,
    executionOwner
  );
  return { lifecycle, workflowLease, executionOwner, executionLease };
}

/** Creates one genuine decision facade whose hidden pairing matches its Runtime. */
async function createPairedForwardDecisionPort(
  runtime: KnowledgeRuntimeStore,
  executionPreflightClaim: KnowledgeProductionWorkflowExecutionPreflightClaim
) {
  const lifecycle = await createForwardDecisionExecutionLease(executionPreflightClaim);
  const queue = new KnowledgeRuntimeQueueStorage(runtime, lifecycle.executionOwner);
  const proof = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queue);
  return {
    ...lifecycle,
    port: new KnowledgeRuntimeForwardRevisionDecisionPort(runtime, proof, lifecycle.executionLease),
  };
}

const FORWARD_DECISION_SOURCE_TEXT = "Grounded evidence for source-1";
const FORWARD_DECISION_SCHEMA_TEXT = "type: schema\n";
const FORWARD_DECISION_HISTORICAL_CONTENT = `---
type: topic
title: Historical revision
tags: [knowledge]
confidence: 0.9
---

# Historical revision

Grounded evidence for source-1
`;
const FORWARD_DECISION_CURRENT_CONTENT = `---
type: topic
title: Current revision
tags: [knowledge]
confidence: 0.9
---

# Current revision

Grounded evidence for source-1
`;

/** Builds a genuine paired preflight/Runtime/Vault/validator/decision production chain. */
async function createForwardDecisionCoordinatorFixture() {
  const pairing = createKnowledgeProductionWorkflowExecutionPairing();
  const lifecycle = await createForwardDecisionExecutionLease(pairing.preflightClaim);
  const sourcePath = "Sources/Source-1.md";
  const schemaPath = "Knowledge/schema.md";
  const pagePath = "Wiki/transaction-forward-historical.md";
  const sourceBytes = new TextEncoder().encode(FORWARD_DECISION_SOURCE_TEXT);
  const schemaBytes = new TextEncoder().encode(FORWARD_DECISION_SCHEMA_TEXT);
  const owners = lifecycle.workflowLease.getOwners();
  const owner = owners[0];
  if (!owner) throw new Error("Expected one production Bundle owner");
  const signal = new AbortController().signal;
  const pipeline = lifecycle.workflowLease.resolve(owner, signal);
  const watched = buildKnowledgeSourceWatchPlan([
    {
      bundle: owner.config,
      manifest: createRegisteredManifest(),
      schema: { path: schemaPath, bytes: schemaBytes },
      pipeline,
    },
  ]).getSource("personal", "source-1");
  if (!watched) throw new Error("Expected one watched production source");
  const harness = await createForwardPublicationHarness(() => 500, undefined, {
    historicalContent: FORWARD_DECISION_HISTORICAL_CONTENT,
    currentContent: FORWARD_DECISION_CURRENT_CONTENT,
    sourceContentHash: createSourceContentHash(sourceBytes),
    pipelineFingerprint: watched.pipelineFingerprint,
    historicalCitation: createSourceQuoteCitation(
      "source-1",
      createFileContentHash(FORWARD_DECISION_SOURCE_TEXT),
      "primary"
    ),
    productionExecutionClaim: pairing.runtimeClaim,
  });
  await harness.port.publishForwardRevisionProposalAtomically(harness.evidence);
  const review = await harness.port.readForwardRevisionReview("personal");
  const pending = review.records[0];
  if (!pending || pending.state !== "pending") throw new Error("Expected pending proposal");
  const files = new Map<string, string>([
    [sourcePath, FORWARD_DECISION_SOURCE_TEXT],
    [schemaPath, FORWARD_DECISION_SCHEMA_TEXT],
    [pagePath, FORWARD_DECISION_CURRENT_CONTENT],
  ]);
  const FileConstructor = TFile as unknown as new (path: string) => TFile;
  const loaded = [...files.keys()].map((path) => new FileConstructor(path));
  const adapter = {
    /** Returns stable exact size metadata for one in-memory Vault file. */
    stat: async (path: string) => {
      const content = files.get(path);
      return content === undefined
        ? null
        : {
            type: "file" as const,
            ctime: 1,
            mtime: 1,
            size: new TextEncoder().encode(content).byteLength,
          };
    },
    /** Returns exact text for the genuine target resolver. */
    read: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error("Missing in-memory Vault file");
      return content;
    },
  } as unknown as DataAdapter;
  const vault = {
    adapter,
    getAllLoadedFiles: () => loaded,
  } as unknown as Vault;
  const app = { vault } as App;
  KnowledgeExecutionOwner.bindVaultLifecycle(lifecycle.executionOwner, app, vault, adapter);
  const encodeArtifact = (path: string) => {
    const content = files.get(path);
    if (content === undefined) throw new Error("Missing in-memory artifact");
    const bytes = new TextEncoder().encode(content);
    return Object.freeze({
      sourcePath: path,
      bytes,
      sourceContentHash: createSourceContentHash(bytes),
    });
  };
  const artifactReader: KnowledgeExactArtifactReaderPort = Object.freeze({
    read: async (path: string) => encodeArtifact(path),
    readExpected: async (path: string, expectedHash: string) => {
      const artifact = encodeArtifact(path);
      if (artifact.sourceContentHash !== expectedHash) {
        throw new Error("In-memory artifact hash changed");
      }
      return artifact;
    },
  });
  const plan = await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner: lifecycle.executionOwner,
    manifest: {
      load: (bundleId: string) => harness.runtime.readManifest(bundleId),
    },
    artifactReader,
    pipelineProfile: lifecycle.workflowLease,
    parsers: lifecycle.workflowLease.getParsers(),
    generation: { isCurrent: () => lifecycle.workflowLease.isCurrent() },
  }).load(owners, new AbortController().signal);
  const queue = new KnowledgeRuntimeQueueStorage(harness.runtime, lifecycle.executionOwner);
  const proof = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, queue);
  const assertCurrent = () => lifecycle.workflowLease.assertCurrent();
  const validator = new KnowledgeProductionForwardRevisionValidationCoordinator(
    new KnowledgeRuntimeForwardRevisionValidationPort(harness.runtime, proof),
    plan,
    new ObsidianKnowledgeCompilerTargetResolver(app, lifecycle.executionOwner),
    lifecycle.executionOwner,
    assertCurrent
  );
  const decisions = new KnowledgeRuntimeForwardRevisionDecisionPort(
    harness.runtime,
    proof,
    lifecycle.executionLease
  );
  return {
    ...harness,
    ...lifecycle,
    files,
    pending,
    validator,
    decisions,
    coordinator: new KnowledgeProductionForwardRevisionDecisionCoordinator(
      validator,
      decisions,
      lifecycle.executionOwner,
      assertCurrent
    ),
  };
}

/** Captures one expected promise rejection for authentic error-category assertions. */
async function captureForwardDecisionRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected forward decision rejection");
}

/** Creates a minimal production Vault observer for one exact current Wiki page. */
function createForwardCurrentTargetVisitor(
  pagePath: string,
  currentContent: string,
  sessions: unknown[]
): ObsidianKnowledgeCompilerTargetVisitPort {
  return {
    /** Reports the requested page with its exact current bytes. */
    async visit(requests, signal, options, visitor): Promise<void> {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      if (requests.length !== 1 || requests[0].path !== pagePath || options.maxFileBytes < 1) {
        throw new Error("Unexpected production target visit");
      }
      sessions.push(requests);
      await visitor(
        {
          targetId: requests[0].targetId,
          kind: "file",
          path: pagePath,
          content: currentContent,
        },
        new TextEncoder().encode(currentContent).byteLength
      );
    },
  };
}

/** Commits one exact latest no-changes outcome over the forward target source. */
async function commitForwardNoChanges(
  harness: Awaited<ReturnType<typeof createForwardPublicationHarness>>,
  sourceContentHash: string
): Promise<void> {
  const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
  const manifest = state.manifests[0].value as SourceManifest;
  const allocation = await new KnowledgeRuntimeInputRevisionAllocator(harness.runtime).allocate({
    bundleId: "personal",
    sourceId: "source-1",
    captureId: `forward-no-changes-${sourceContentHash.slice(0, 8)}`,
  });
  const bound = await new KnowledgeRuntimeInputObservationBinder(harness.runtime).bind({
    observationToken: allocation.observationToken,
    sourceContentHash,
    pipelineFingerprint: HASH_B,
  });
  if (bound.kind !== "ready") throw new Error("Expected one fresh no-changes observation");
  const plan = createRuntimeNoChangesPlan(
    manifest,
    allocation.inputRevision,
    sourceContentHash,
    HASH_B
  );
  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(harness.runtime),
    {
      /** Returns the exact no-changes plan for the test observation. */
      execute: async () => ({
        kind: "no_changes",
        changeSetId: plan.noChangesId,
        manifestCommitPlan: plan,
        manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
      }),
    },
    { clock: () => 400, jobIdFactory: () => "job-forward-no-changes" }
  );
  await queue.enqueue(bound.observation);
  await expect(queue.runNext("personal")).resolves.toMatchObject({
    kind: "executed",
    status: "completed",
  });
}

/** Creates one structurally strict standalone forward publication wrapper fixture. */
function createForwardPublishedFixture(
  bundleId: string,
  pagePath: string,
  runtimeId: string,
  selectedContent: string,
  requestRevision: number,
  publishedRuntimeRevision: number
) {
  const selectedContentHash = createFileContentHash(selectedContent);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId,
    pagePath,
    historical: {
      bundleId,
      pagePath,
      transactionId: `transaction-${bundleId}-${requestRevision}`,
      sourceId: "source-1",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_C,
      inputRevision: 1,
      changeSetId: `changeset-${bundleId}-${requestRevision}`,
      changeSetDigest: HASH_B,
      manifestIntentDigest: HASH_C,
      manifestAfterRevision: 1,
      manifestAfterDigest: HASH_B,
      appliedAt: 100,
      selectedContentHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: ["source-1"],
      primarySourceId: "source-1",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_C,
      inputRevision: 2,
      manifestRevision: 2,
      manifestDigest: HASH_C,
      manifestBaseHash: HASH_A,
      vaultObservedBeforeHash: HASH_A,
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision,
    runtimeId,
    bundleId,
    pagePath,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_A,
      acceptedDigest: HASH_B,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_C,
      acceptedAt: 100,
      targetChange: {
        changeId: `change-${bundleId}-${requestRevision}`,
        path: pagePath,
        operation: "update",
        afterHash: selectedContentHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: pagePath,
        ownership: "generated",
        contentHash: selectedContentHash,
      },
    },
    selectedContent,
    selectedContentHash,
    requestedAt: 100,
  });
  return createKnowledgeForwardRevisionPublishedProposal({
    proposal: createKnowledgeForwardRevisionPendingProposalRecord({
      request,
      recordedAt: 100,
    }),
    publishedRuntimeRevision,
    proposalStoreRevision: requestRevision,
  });
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

/** Creates one exact pending Review and Queue pair for atomic Reject tests. */
async function createReviewRejectHarness(): Promise<{
  file: MemoryAtomicRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  port: KnowledgeRuntimeReviewRejectPort;
  command: KnowledgeLiteralRejectCommand;
  initialState: KnowledgeRuntimeStoreSnapshot;
}> {
  const file = new MemoryAtomicRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(file, { clock: () => 130 });
  await runtime.initialize();
  const manifest = createRegisteredManifest();
  const proposal: KnowledgeChangeSet = {
    ...createAcceptedChangeSet("runtime-review-reject"),
    status: "proposed",
  };
  const proposalDigest = createChangeSetTransactionDigest(proposal);
  const manifestCommitPlan = createManifestCommitPlanFixture(manifest, proposal, 1);
  const sourceHighWatermark = {
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    observedAt: 100,
  };
  const queue: IngestQueueSnapshot = {
    ...createQueueSnapshot(3),
    jobs: [
      {
        id: "job-runtime-review-reject",
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
        changeSetId: proposal.id,
      },
    ],
    sourceHighWatermarks: [sourceHighWatermark],
    pendingReviews: [
      {
        kind: "durable",
        jobId: "job-runtime-review-reject",
        changeSetId: proposal.id,
        proposalDigest,
        reviewRecordRevision: 0,
        recordedAt: 110,
      },
    ],
  };
  const review: ChangeSetReviewSnapshot = {
    version: 2,
    bundleId: "personal",
    revision: 2,
    records: [
      {
        changeSetId: proposal.id,
        proposal,
        proposalDigest,
        manifestCommitPlan,
        manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
        jobClaim: {
          jobId: "job-runtime-review-reject",
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 1,
          attempt: 1,
        },
        recordedAt: 110,
        outcome: "pending",
        recordRevision: 0,
      },
    ],
  };
  const initialState: KnowledgeRuntimeStoreSnapshot = {
    ...createEmptyKnowledgeRuntimeStoreSnapshot(),
    revision: 9,
    queues: [{ bundleId: "personal", value: queue }],
    reviews: [{ bundleId: "personal", value: review }],
    manifests: [{ bundleId: "personal", value: manifest }],
    inputRevisions: [
      {
        bundleId: "personal",
        sources: [
          {
            sourceId: "source-1",
            inputRevision: 1,
            managedAfterRevision: 1,
            legacyCheckpoint: sourceHighWatermark,
            observations: [],
          },
        ],
      },
    ],
  };
  file.replaceContent(JSON.stringify(initialState));
  return {
    file,
    runtime,
    port: new KnowledgeRuntimeReviewRejectPort(runtime),
    command: {
      changeSetId: proposal.id,
      proposalDigest,
      expectedSnapshotToken: HASH_C,
      decisions: proposal.changes.map((change) => ({
        changeId: change.id,
        decision: "reject" as const,
      })),
    },
    initialState,
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

  it("rejects oversized persisted text before JSON parsing and preserves exact bytes", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const validText = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32)));
    const oversizedText = `${validText} `;
    await file.initialize(oversizedText);
    const runtime = new KnowledgeRuntimeStore(file, {
      maxTextCharacters: validText.length,
    });
    const parseSpy = jest.spyOn(JSON, "parse");

    try {
      await expect(runtime.initialize()).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
    expect(await file.read()).toBe(oversizedText);
  });

  it("rejects externally enlarged Runtime text before a read-side JSON parse", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const validText = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32)));
    await file.initialize(validText);
    const runtime = new KnowledgeRuntimeStore(file, {
      maxTextCharacters: validText.length,
    });
    await runtime.initialize();
    const oversizedText = `${validText} `;
    file.replaceContent(oversizedText);
    const parseSpy = jest.spyOn(JSON, "parse");

    try {
      await expect(runtime.readStudioBundle("personal")).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
    expect(await file.read()).toBe(oversizedText);
  });

  it("accepts persisted Runtime text at the exact configured character limit", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const text = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32)));
    await file.initialize(text);

    await expect(
      new KnowledgeRuntimeStore(file, { maxTextCharacters: text.length }).initialize()
    ).resolves.toBeUndefined();

    expect(await file.read()).toBe(text);
  });

  it("rejects invalid or enlarged Runtime text limits before file access", () => {
    const file = new MemoryAtomicRuntimeFile();

    expect(() => new KnowledgeRuntimeStore(file, { maxTextCharacters: 0 })).toThrow(
      "Knowledge Runtime text limit is invalid"
    );
    expect(
      () =>
        new KnowledgeRuntimeStore(file, {
          maxTextCharacters: 64 * 1024 * 1024 + 1,
        })
    ).toThrow("Knowledge Runtime text limit is invalid");
    expect(file.getReadCallCount()).toBe(0);
  });

  it("rejects an atomic mutation whose serialized Runtime would exceed the text limit", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const text = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32)));
    await file.initialize(text);
    const runtime = new KnowledgeRuntimeStore(file, { maxTextCharacters: text.length });
    await runtime.initialize();

    await expect(
      new KnowledgeRuntimeQueueStorage(runtime).write("personal", createQueueSnapshot(1), null)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);

    expect(await file.read()).toBe(text);
  });

  it("does not commit a migration whose serialized Runtime exceeds the text limit", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const legacyText = JSON.stringify(createLegacyRuntimeSnapshot());
    await file.initialize(legacyText);

    await expect(
      new KnowledgeRuntimeStore(file, { maxTextCharacters: legacyText.length }).initialize()
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);

    expect(await file.read()).toBe(legacyText);
  });

  it("returns detached revision-zero Studio state when Queue and Review slots are absent", async () => {
    const harness = await createHarness();

    const first = await harness.runtime.readStudioBundle("personal");

    expect(first).toEqual({
      bundleId: "personal",
      runtimeRevision: 0,
      queue: createQueueSnapshot(0),
      review: createReviewSnapshot(0),
    });

    first.queue.control = { status: "paused", reason: "user", pausedAt: 1 };
    first.review.records.push({} as never);

    await expect(harness.runtime.readStudioBundle("personal")).resolves.toEqual({
      bundleId: "personal",
      runtimeRevision: 0,
      queue: createQueueSnapshot(0),
      review: createReviewSnapshot(0),
    });
  });

  it("reads detached Queue and Review snapshots from one exact Runtime envelope", async () => {
    const harness = await createHarness();
    await harness.queue.write("personal", createQueueSnapshot(1), null);
    await harness.review.write("personal", createReviewSnapshot(1), null);
    const readsBeforeStudioLoad = harness.file.getReadCallCount();

    const first = await harness.runtime.readStudioBundle("personal");

    expect(harness.file.getReadCallCount()).toBe(readsBeforeStudioLoad + 1);
    expect(first).toEqual({
      bundleId: "personal",
      runtimeRevision: 2,
      queue: createQueueSnapshot(1),
      review: createReviewSnapshot(1),
    });

    first.queue.revision = 99;
    first.review.revision = 99;
    const second = await harness.runtime.readStudioBundle("personal");

    expect(second).toEqual({
      bundleId: "personal",
      runtimeRevision: 2,
      queue: createQueueSnapshot(1),
      review: createReviewSnapshot(1),
    });
    expect(second.queue).not.toBe(first.queue);
    expect(second.review).not.toBe(first.review);
  });

  it("publishes post-commit Studio hints only to the changed Bundle", async () => {
    const harness = await createHarness();
    const personalReads: Promise<KnowledgeRuntimeStudioBundleSnapshot>[] = [];
    let workHints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      personalReads.push(harness.runtime.readStudioBundle("personal"));
    });
    harness.runtime.subscribeStudioBundle("work", () => {
      workHints += 1;
    });

    await harness.queue.write("personal", createQueueSnapshot(1), null);
    await harness.review.write("personal", createReviewSnapshot(1), null);

    await expect(Promise.all(personalReads)).resolves.toEqual([
      expect.objectContaining({ runtimeRevision: 1, queue: createQueueSnapshot(1) }),
      expect.objectContaining({ runtimeRevision: 2, review: createReviewSnapshot(1) }),
    ]);
    expect(personalReads).toHaveLength(2);
    expect(workHints).toBe(0);

    await harness.review.write("work", createReviewSnapshot(1, "work"), null);
    expect(workHints).toBe(1);
    expect(personalReads).toHaveLength(2);
  });

  it("stops Studio hints after idempotent unsubscribe", async () => {
    const harness = await createHarness();
    let hints = 0;
    const unsubscribe = harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });

    unsubscribe();
    unsubscribe();
    await harness.queue.write("personal", createQueueSnapshot(1), null);
    await harness.review.write("personal", createReviewSnapshot(1), null);

    expect(hints).toBe(0);
  });

  it("isolates throwing Studio listeners from durable writes and sibling hints", async () => {
    const harness = await createHarness();
    let siblingHints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      throw new Error("Studio view closed during notification");
    });
    harness.runtime.subscribeStudioBundle("personal", () => {
      siblingHints += 1;
    });

    await expect(
      harness.queue.write("personal", createQueueSnapshot(1), null)
    ).resolves.toBeUndefined();
    await expect(harness.queue.read("personal")).resolves.toEqual(createQueueSnapshot(1));
    expect(siblingHints).toBe(1);
  });

  it("returns one frozen revision-zero applied projection from one Runtime read", async () => {
    const harness = await createHarness();
    const readsBefore = harness.file.getReadCallCount();

    const projection = await harness.runtime.readAppliedProvenance("personal");

    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    expect(projection).toEqual({
      bundleId: "personal",
      runtimeRevision: 0,
      manifestRevision: 0,
      pages: [],
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.pages)).toBe(true);
  });

  it("projects one exact current committed accepted page as detached frozen provenance", async () => {
    const manifest = createRegisteredManifest();
    const citation = createSourceCitation();
    const proof = createCommittedApplyProof(manifest, "transaction-applied-provenance", 1, [
      citation,
    ]);
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const readsBefore = harness.file.getReadCallCount();

    const projection = await harness.runtime.readAppliedProvenance("personal");

    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    expect(projection).toEqual({
      bundleId: "personal",
      runtimeRevision: 11,
      manifestRevision: 2,
      pages: [
        {
          path: "Wiki/transaction-applied-provenance.md",
          windowsPathKey: "wiki/transaction-applied-provenance.md",
          ownership: "generated",
          contentHash: createFileContentHash("# transaction-applied-provenance\n"),
          sources: [
            {
              sourceId: "source-1",
              sourcePath: "Sources/Source-1.md",
              custody: "user_managed",
              sourceContentHash: HASH_A,
              pipelineFingerprint: HASH_B,
              inputRevision: 1,
              changeSetId: "changeset-transaction-applied-provenance",
              changeSetDigest: proof.journal.changeSetDigest,
              acceptedAt: 140,
              citations: [citation],
            },
          ],
        },
      ],
    });
    const page = projection.pages[0];
    const source = page.sources[0];
    const projectedCitation = source.citations[0];
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.pages)).toBe(true);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.sources)).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.citations)).toBe(true);
    expect(Object.isFrozen(projectedCitation)).toBe(true);
    expect(Object.isFrozen(projectedCitation.locator)).toBe(true);
    expect(projectedCitation).not.toBe(citation);
    expect(projectedCitation.locator).not.toBe(citation.locator);
  });

  it("indexes metadata then rejoins one known applied body from separate Runtime reads", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest, "transaction-known-output", 1, [
      createSourceCitation(),
    ]);
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const pagePath = "Wiki/transaction-known-output.md";
    const readsBefore = harness.file.getReadCallCount();

    const index = await harness.runtime.readKnownAppliedWikiOutputIndex("personal", pagePath);

    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    expect(index.outputs).toHaveLength(1);
    expect(index.outputs[0]).toMatchObject({
      path: pagePath,
      contentHash: createFileContentHash("# transaction-known-output\n"),
      characterCount: 27,
      newestAppliedAt: proof.receipt.committedAt,
      verifiedApplyCount: 1,
      detailAvailability: "available",
    });
    expect(index.outputs[0]).not.toHaveProperty("content");
    expect(index.currentManifestPage).toMatchObject({
      path: pagePath,
      contentHash: createFileContentHash("# transaction-known-output\n"),
    });
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.outputs[0]?.authority)).toBe(true);

    const detail = await harness.runtime.readKnownAppliedWikiOutputDetail(
      "personal",
      pagePath,
      index.outputs[0].authority
    );

    expect(harness.file.getReadCallCount()).toBe(readsBefore + 2);
    expect(detail).toEqual({
      kind: "available",
      runtimeId: index.runtimeId,
      runtimeRevision: index.runtimeRevision,
      contentHash: createFileContentHash("# transaction-known-output\n"),
      content: "# transaction-known-output\n",
      characterCount: 27,
    });
    expect(Object.isFrozen(detail)).toBe(true);
  });

  it("projects one exact latest Apply as detached frozen source freshness authority", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest, "transaction-applied-freshness", 1, [
      createSourceCitation(),
    ]);
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const committedManifest = state.manifests[0].value as SourceManifest;
    const readsBefore = harness.file.getReadCallCount();

    const authority = await harness.runtime.readSourceFreshnessAuthority("personal", "source-1");

    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    if (!authority) throw new Error("Expected applied source freshness authority");
    expect(authority.runtimeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(authority).toEqual({
      version: 1,
      kind: "applied",
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      runtimeDigest: authority.runtimeDigest,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      manifestRevision: committedManifest.revision,
      manifestDigest: createSourceManifestDigest(committedManifest),
      generatedPages: [
        {
          path: "Wiki/transaction-applied-freshness.md",
          windowsPathKey: "wiki/transaction-applied-freshness.md",
          ownership: "generated",
          contentHash: createFileContentHash("# transaction-applied-freshness\n"),
        },
      ],
      transactionId: "transaction-applied-freshness",
      changeSetId: "changeset-transaction-applied-freshness",
      changeSetDigest: proof.journal.changeSetDigest,
      manifestIntentDigest: proof.journal.manifestCommitIntentDigest,
      committedManifestRevision: committedManifest.revision,
      committedManifestDigest: createSourceManifestDigest(committedManifest),
      completedAt: proof.receipt.committedAt,
    });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority?.generatedPages)).toBe(true);
    expect(Object.isFrozen(authority?.generatedPages[0])).toBe(true);
  });

  it("returns no source freshness authority without exact Runtime outcome proof", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);

    await expect(
      harness.runtime.readSourceFreshnessAuthority("personal", "source-1")
    ).resolves.toBeNull();
    await expect(
      harness.runtime.readSourceFreshnessAuthority("personal", "missing-source")
    ).resolves.toBeNull();
    await expect(
      harness.runtime.readSourceFreshnessAuthority("missing-bundle", "source-1")
    ).resolves.toBeNull();
  });

  it("excludes accepted work until its exact Manifest success and ledger commit exist", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest, "transaction-uncommitted", 1, [
      createSourceCitation(),
    ]);
    const harness = await createApplyHarness(manifest, proof);

    await expect(harness.runtime.readAppliedProvenance("personal")).resolves.toMatchObject({
      manifestRevision: 1,
      pages: [],
    });
  });

  it("excludes a committed page whose accepted record has no exact source citation", async () => {
    const manifest = createRegisteredManifest();
    const harness = await createApplyHarness(manifest);
    await harness.port.recordCommitted(harness.journal, harness.receipt);

    await expect(harness.runtime.readAppliedProvenance("personal")).resolves.toMatchObject({
      manifestRevision: 2,
      pages: [],
    });
  });

  it.each(["pending", "rejected"] as const)(
    "excludes a current ledger-backed page when its Review outcome is %s",
    async (outcome) => {
      const manifest = createRegisteredManifest();
      const proof = createCommittedApplyProof(manifest, `transaction-${outcome}-projection`, 1, [
        createSourceCitation(),
      ]);
      const harness = await createApplyHarness(manifest, proof);
      await harness.port.recordCommitted(harness.journal, harness.receipt);
      const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
      const review = state.reviews[0].value as ChangeSetReviewSnapshot;
      const accepted = review.records[0];
      if (accepted.outcome !== "accepted") throw new Error("Expected accepted Review fixture");
      const base = {
        changeSetId: accepted.changeSetId,
        proposal: accepted.proposal,
        proposalDigest: accepted.proposalDigest,
        manifestCommitPlan: accepted.manifestCommitPlan,
        manifestCommitPlanDigest: accepted.manifestCommitPlanDigest,
        jobClaim: accepted.jobClaim,
        recordedAt: accepted.recordedAt,
      };
      review.revision += 1;
      review.records = [
        outcome === "pending"
          ? { ...base, outcome: "pending", recordRevision: 0 }
          : {
              ...base,
              outcome: "rejected",
              recordRevision: 1,
              rejectedAt: accepted.acceptedAt,
            },
      ];
      state.activeTransaction = null;
      state.queues = [];
      state.inputRevisions = [];
      harness.file.replaceContent(JSON.stringify(state));

      await expect(harness.runtime.readAppliedProvenance("personal")).resolves.toMatchObject({
        manifestRevision: 2,
        pages: [],
      });
    }
  );

  it("excludes a retained unchanged page from a later exact source commit", async () => {
    const firstManifest = createRegisteredManifest();
    const firstProof = createCommittedApplyProof(firstManifest, "transaction-retained-first", 1, [
      createSourceCitation(),
    ]);
    const first = await createApplyHarness(firstManifest, firstProof);
    await first.port.recordCommitted(first.journal, first.receipt);
    const firstState = JSON.parse(await first.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const committedManifest = firstState.manifests[0].value as SourceManifest;
    const secondProof = createCommittedApplyProof(
      committedManifest,
      "transaction-retained-second",
      2,
      [createSourceCitation()]
    );
    const second = await createApplyHarness(committedManifest, secondProof);
    const secondState = JSON.parse(await second.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const firstReview = firstState.reviews[0].value as ChangeSetReviewSnapshot;
    const secondReview = secondState.reviews[0].value as ChangeSetReviewSnapshot;
    secondReview.revision = 2;
    secondReview.records = [...firstReview.records, ...secondReview.records];
    secondState.applyCommits = firstState.applyCommits;
    second.file.replaceContent(JSON.stringify(secondState));

    await second.port.recordCommitted(second.journal, second.receipt);
    const projection = await second.runtime.readAppliedProvenance("personal");

    expect(projection.pages.map((page) => page.path)).toEqual([
      "Wiki/transaction-retained-second.md",
    ]);
    expect(projection.pages[0].sources[0].changeSetId).toBe(
      "changeset-transaction-retained-second"
    );
  });

  it("de-duplicates a shared page and retains only its exact current-version writer", async () => {
    const manifest = createSharedPageManifest();
    const proof = createSharedUpdateProof(manifest);
    const harness = await createApplyHarness(manifest, proof);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.applyCommits = createSharedPageHistoricalLedgers();
    harness.file.replaceContent(JSON.stringify(state));
    await harness.port.recordCommitted(harness.journal, harness.receipt);

    const projection = await harness.runtime.readAppliedProvenance("personal");

    expect(projection.pages).toHaveLength(1);
    expect(projection.pages[0]).toMatchObject({
      path: "Wiki/Shared.md",
      windowsPathKey: "wiki/shared.md",
      ownership: "shared",
      contentHash: createFileContentHash("# Shared after\n"),
      sources: [{ sourceId: "source-1", changeSetId: "changeset-shared-update" }],
    });
    expect(projection.pages[0].sources).toHaveLength(1);
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
      revision: 12,
      forwardRevisionReviews: [],
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
      revision: 12,
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
      revision: 12,
    });
  });

  it("rejects a direct current runtime whose completion has no durable proof", async () => {
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(
      JSON.stringify(createMarkerlessCompletionRuntimeSnapshot(KNOWLEDGE_RUNTIME_STORE_VERSION))
    );
    const before = await file.read();

    await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
    expect(await file.read()).toBe(before);
  });

  it("atomically demotes one markerless runtime-v3 completion and replays idempotently", async () => {
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(createMarkerlessCompletionRuntimeSnapshot(3)));
    const runtime = new KnowledgeRuntimeStore(file);

    await runtime.initialize();

    const migratedText = await file.read();
    const migrated = JSON.parse(migratedText) as KnowledgeRuntimeStoreSnapshot;
    expect(migrated).toMatchObject({
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      runtimeId: "1".repeat(32),
      revision: 11,
      queues: [
        {
          bundleId: "personal",
          value: {
            revision: 2,
            control: {
              status: "paused",
              reason: "startup_recovery",
              pausedAt: 120,
            },
            jobs: [
              {
                id: "job-markerless-completion",
                status: "pending",
                stage: "queued",
                attempt: 1,
                inputRevision: 1,
              },
            ],
          },
        },
      ],
    });
    expect((migrated.queues[0].value as IngestQueueSnapshot).jobs[0]).not.toHaveProperty(
      "changeSetId"
    );
    expect((migrated.queues[0].value as IngestQueueSnapshot).jobs[0]).not.toHaveProperty(
      "completedAt"
    );
    expect(migrated.inputRevisions).toEqual(
      createMarkerlessCompletionRuntimeSnapshot(3).inputRevisions
    );
    await expect(runtime.readSourceFreshnessAuthority("personal", "source-1")).resolves.toBeNull();

    await runtime.initialize();
    expect(await file.read()).toBe(migratedText);
  });

  it("re-runs a migrated current fingerprint and writes its exact no-change marker", async () => {
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(
      JSON.stringify(
        createMarkerlessCompletionRuntimeSnapshot(3, {
          status: "paused",
          reason: "user",
          pausedAt: 120,
        })
      )
    );
    const runtime = new KnowledgeRuntimeStore(file);
    await runtime.initialize();
    const manifest = createRegisteredManifest();
    const plan = createRuntimeNoChangesPlan(manifest);
    const queue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(runtime),
      {
        /** Produces the proof that the legacy completion did not retain. */
        execute: async () => ({
          kind: "no_changes",
          changeSetId: plan.noChangesId,
          manifestCommitPlan: plan,
          manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
        }),
      },
      { clock: () => 200 }
    );
    await queue.resume("personal");

    await expect(queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      jobId: "job-markerless-completion",
      status: "completed",
      generationEffect: "manifest_no_changes_committed",
    });

    const state = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
    const persistedQueue = state.queues[0].value as IngestQueueSnapshot;
    const persistedManifest = state.manifests[0].value as SourceManifest;
    expect(persistedQueue.jobs[0]).toMatchObject({
      id: "job-markerless-completion",
      attempt: 2,
      status: "completed",
      changeSetId: plan.noChangesId,
    });
    expect(
      persistedManifest.entries[0].extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toMatchObject({
      jobId: "job-markerless-completion",
      attempt: 2,
      noChangesId: plan.noChangesId,
    });
    await expect(new KnowledgeRuntimeStore(file).initialize()).resolves.toBeUndefined();
  });

  it("keeps an exact Apply-ledger completion terminal during runtime-v3 migration", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest, "transaction-v3-proven-apply");
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const previous = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = previous.queues[0].value as IngestQueueSnapshot;
    const applying = queue.jobs[0];
    if (applying.status !== "processing") throw new Error("Expected applying Queue fixture");
    const completedAt = harness.receipt.committedAt;
    const completed: IngestQueueSnapshot["jobs"][number] = {
      id: applying.id,
      bundleId: applying.bundleId,
      sourceId: applying.sourceId,
      sourceContentHash: applying.sourceContentHash,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: applying.inputRevision,
      attempt: applying.attempt,
      rerunRequested: false,
      createdAt: applying.createdAt,
      updatedAt: completedAt,
      status: "completed",
      stage: "completed",
      changeSetId: harness.receipt.changeSetId,
      completedAt,
    };
    const completedQueue: IngestQueueSnapshot = {
      ...queue,
      revision: queue.revision + 1,
      control: { status: "running" },
      jobs: [completed],
    };
    delete completedQueue.applyClaim;
    const { forwardRevisionReviews: _forwardRevisionReviews, ...previousWithoutForward } = previous;
    void _forwardRevisionReviews;
    const previousV3 = {
      ...previousWithoutForward,
      version: 3,
      activeTransaction: null,
      queues: [{ bundleId: "personal", value: completedQueue }],
    };
    harness.file.replaceContent(JSON.stringify(previousV3));
    const beforeQueue = JSON.stringify(completedQueue);

    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();

    const migrated = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(migrated.version).toBe(KNOWLEDGE_RUNTIME_STORE_VERSION);
    expect(JSON.stringify(migrated.queues[0].value)).toBe(beforeQueue);
    expect((migrated.queues[0].value as IngestQueueSnapshot).jobs[0]).toMatchObject({
      status: "completed",
      changeSetId: harness.receipt.changeSetId,
    });

    const covered = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const coveredQueue = covered.queues[0].value as IngestQueueSnapshot;
    coveredQueue.jobs.unshift({
      id: "job-older-unproved-completion",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 0,
      attempt: 1,
      rerunRequested: false,
      createdAt: 1,
      updatedAt: 2,
      status: "completed",
      stage: "completed",
      changeSetId: "older-unproved-completion",
      completedAt: 2,
    });
    harness.file.replaceContent(JSON.stringify(covered));
    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();
  });

  it("accepts an older unproved completion covered by a newer divergent active rerun", async () => {
    const state = createMarkerlessCompletionRuntimeSnapshot(
      KNOWLEDGE_RUNTIME_STORE_VERSION
    ) as unknown as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    queue.revision = 2;
    queue.jobs[0].rerunRequested = false;
    queue.jobs.push({
      id: "job-divergent-active",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      attempt: 0,
      rerunRequested: true,
      createdAt: 130,
      updatedAt: 150,
      status: "pending",
      stage: "queued",
    });
    queue.reruns = [
      {
        jobId: "job-current-rerun",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 3,
        requestedAt: 140,
        updatedAt: 150,
      },
    ];
    queue.sourceHighWatermarks[0] = {
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      observedAt: 150,
    };
    state.inputRevisions = [
      {
        bundleId: "personal",
        sources: [
          {
            sourceId: "source-1",
            inputRevision: 3,
            managedAfterRevision: 2,
            observations: [
              {
                observationToken: "3".repeat(32),
                captureId: "current-divergent-rerun-capture",
                inputRevision: 3,
                allocatedAt: 140,
                status: "consumed",
                sourceContentHash: HASH_A,
                pipelineFingerprint: HASH_B,
                boundAt: 145,
                settledAt: 150,
                queueRevision: 2,
              },
            ],
          },
        ],
      },
    ];
    const file = new MemoryAtomicRuntimeFile();
    expect(validateIngestQueueSnapshot(queue)).toEqual({ valid: true, diagnostics: [] });
    await file.initialize(JSON.stringify(state));

    await expect(new KnowledgeRuntimeStore(file).initialize()).resolves.toBeUndefined();
  });

  it("accepts an older unproved success behind a newer same-payload failure", async () => {
    const state = createMarkerlessCompletionRuntimeSnapshot(
      KNOWLEDGE_RUNTIME_STORE_VERSION
    ) as unknown as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    queue.revision = 2;
    queue.jobs.push({
      id: "job-newer-failure",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      attempt: 1,
      rerunRequested: false,
      createdAt: 130,
      updatedAt: 150,
      status: "failed",
      stage: "generating",
      failure: {
        code: "model_failure",
        message: "The latest attempt failed",
        retryable: true,
        occurredAt: 150,
      },
    });
    queue.sourceHighWatermarks[0] = {
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      observedAt: 140,
    };
    state.inputRevisions = [
      {
        bundleId: "personal",
        sources: [
          {
            sourceId: "source-1",
            inputRevision: 2,
            managedAfterRevision: 1,
            observations: [
              {
                observationToken: "4".repeat(32),
                captureId: "newer-failed-observation",
                inputRevision: 2,
                allocatedAt: 130,
                status: "consumed",
                sourceContentHash: HASH_A,
                pipelineFingerprint: HASH_B,
                boundAt: 135,
                settledAt: 140,
                queueRevision: 2,
              },
            ],
          },
        ],
      },
    ];
    const file = new MemoryAtomicRuntimeFile();
    await file.initialize(JSON.stringify(state));

    await expect(new KnowledgeRuntimeStore(file).initialize()).resolves.toBeUndefined();
  });

  it.each([3, KNOWLEDGE_RUNTIME_STORE_VERSION] as const)(
    "rejects runtime-v%s when its latest terminal payload diverges from the high-watermark",
    async (version) => {
      const state = createMarkerlessCompletionRuntimeSnapshot(version) as unknown as {
        queues: Array<{ value: IngestQueueSnapshot }>;
        inputRevisions: KnowledgeRuntimeStoreSnapshot["inputRevisions"];
      };
      const queue = state.queues[0].value;
      queue.jobs[0] = {
        id: "job-divergent-terminal",
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 90,
        updatedAt: 120,
        status: "failed",
        stage: "generating",
        failure: {
          code: "model_failure",
          message: "The retained terminal belongs to an older payload",
          retryable: true,
          occurredAt: 120,
        },
      };
      queue.sourceHighWatermarks[0] = {
        sourceId: "source-1",
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
        inputRevision: 2,
        observedAt: 130,
      };
      state.inputRevisions = [
        {
          bundleId: "personal",
          sources: [
            {
              sourceId: "source-1",
              inputRevision: 2,
              managedAfterRevision: 1,
              observations: [
                {
                  observationToken: "5".repeat(32),
                  captureId: `divergent-terminal-${version}`,
                  inputRevision: 2,
                  allocatedAt: 121,
                  status: "consumed",
                  sourceContentHash: HASH_C,
                  pipelineFingerprint: HASH_B,
                  boundAt: 125,
                  settledAt: 130,
                  queueRevision: 1,
                },
              ],
            },
          ],
        },
      ];
      const file = new MemoryAtomicRuntimeFile();
      await file.initialize(JSON.stringify(state));
      const before = await file.read();

      await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
      expect(await file.read()).toBe(before);
    }
  );

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
    "preserves a safe %s pause while admitting the live generation",
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
        kind: "unchanged",
        bundleId: "personal",
        reason: reason === "user" ? "user_pause_preserved" : "rate_limit_pause_preserved",
        runtimeRevision: request.expectedRuntimeRevision,
        reviewRevision: request.expectedReviewRevision,
        queueSnapshot: paused,
      });
      expect(await harness.file.read()).toBe(before);
    }
  );

  it.each([
    { reason: "user", stage: "generating" },
    { reason: "rate_limit", stage: "parsing" },
  ] as const)(
    "preserves a safe $reason pause with one non-applying paused job",
    async ({ reason, stage }) => {
      const harness = await createHarness();
      await harness.queue.write("personal", createQueueSnapshot(1), null);
      const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
      const sourceHighWatermark = {
        sourceId: "source-1",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 90,
      };
      const paused: IngestQueueSnapshot = {
        ...createQueueSnapshot(1),
        control: { status: "paused", reason, pausedAt: 100 },
        jobs: [
          {
            id: "job-paused",
            bundleId: "personal",
            sourceId: "source-1",
            sourceContentHash: HASH_A,
            pipelineFingerprint: HASH_B,
            inputRevision: 1,
            attempt: 1,
            rerunRequested: false,
            createdAt: 90,
            updatedAt: 100,
            status: "paused",
            stage,
            pausedAt: 100,
          },
        ],
        sourceHighWatermarks: [sourceHighWatermark],
      };
      state.queues[0].value = paused;
      state.inputRevisions = [
        {
          bundleId: "personal",
          sources: [
            {
              sourceId: "source-1",
              inputRevision: 1,
              managedAfterRevision: 1,
              legacyCheckpoint: sourceHighWatermark,
              observations: [],
            },
          ],
        },
      ];
      harness.file.replaceContent(JSON.stringify(state));
      const request = await createStartupReleaseRequest(harness);
      const before = await harness.file.read();

      await expect(harness.release.release(request)).resolves.toEqual({
        kind: "unchanged",
        bundleId: "personal",
        reason: reason === "user" ? "user_pause_preserved" : "rate_limit_pause_preserved",
        runtimeRevision: request.expectedRuntimeRevision,
        reviewRevision: request.expectedReviewRevision,
        queueSnapshot: paused,
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

  it("atomically retires a recovered successor when Apply satisfies the latest input", async () => {
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
        id: "job-obsolete-successor",
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
        jobId: "job-satisfied-repair",
        sourceId: oldApply.sourceId,
        sourceContentHash: oldApply.sourceContentHash,
        pipelineFingerprint: oldApply.pipelineFingerprint,
        inputRevision: 3,
        requestedAt: 160,
        updatedAt: 170,
      },
    ];
    queue.sourceHighWatermarks[0] = {
      sourceId: oldApply.sourceId,
      sourceContentHash: oldApply.sourceContentHash,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 3,
      observedAt: 170,
    };
    state.inputRevisions[0].sources[0].inputRevision = 3;
    recordFixtureWatermarkAsConsumed(state);
    harness.file.replaceContent(JSON.stringify(state));

    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const runtimeQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(harness.runtime),
      {
        /** Recovery does not execute new source work. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 250, jobIdFactory: () => "job-unused" }
    );
    await runtimeQueue.resolveApplyRecovery(harness.receipt);
    const recovered = await runtimeQueue.load("personal");

    expect(
      recovered.jobs.filter((job) => !["failed", "completed", "cancelled"].includes(job.status))
    ).toEqual([]);
    expect(recovered.jobs.find((job) => job.id === "job-obsolete-successor")).toMatchObject({
      status: "cancelled",
      rerunRequested: false,
      sourceContentHash: oldApply.sourceContentHash,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 3,
    });
    expect(recovered.reruns).toEqual([]);
    expect(recovered.sourceHighWatermarks[0]).toMatchObject({
      sourceContentHash: oldApply.sourceContentHash,
      pipelineFingerprint: oldApply.pipelineFingerprint,
      inputRevision: 3,
    });
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
    const coOwnerNoChangesPlan = createNoChangesManifestCommitPlan({
      bundleId: "personal",
      sourceId: "source-2",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
      inputRevision: 2,
      compileContextDigest: HASH_A,
      analysisDigest: HASH_B,
      evidenceDigest: HASH_C,
      reason: "all_targets_unchanged",
      expectedManifestRevision: manifest.revision,
      expectedManifestDigest: createSourceManifestDigest(manifest),
      baseGeneratedPages: [
        { path: "Wiki/Shared.md", ownership: "shared", contentHash: beforeHash },
      ],
      sourceAuthority: { operation: "ingest" },
    });
    const coOwnerNoChangesMarker = createKnowledgeNoChangesCommitMarker({
      plan: coOwnerNoChangesPlan,
      jobClaim: {
        jobId: "job-coowner-no-changes",
        sourceId: "source-2",
        sourceContentHash: HASH_B,
        pipelineFingerprint: HASH_A,
        inputRevision: 2,
        attempt: 1,
        startedAt: 210,
      },
      completedAt: 220,
      manifestAfterRevision: manifest.revision + 1,
    });
    manifest.revision += 1;
    manifest.entries[1].extensions = {
      ...manifest.entries[1].extensions,
      [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: coOwnerNoChangesMarker as unknown as JsonValue,
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
    const queueBefore = stateBefore.queues[0].value as IngestQueueSnapshot;
    queueBefore.jobs.push({
      id: "job-coowner-no-changes",
      bundleId: "personal",
      sourceId: "source-2",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
      inputRevision: 2,
      attempt: 1,
      rerunRequested: false,
      createdAt: 200,
      updatedAt: 220,
      status: "completed",
      stage: "completed",
      changeSetId: coOwnerNoChangesPlan.noChangesId,
      completedAt: 220,
    });
    queueBefore.sourceHighWatermarks.push({
      sourceId: "source-2",
      sourceContentHash: HASH_B,
      pipelineFingerprint: HASH_A,
      inputRevision: 2,
      observedAt: 200,
    });
    stateBefore.inputRevisions[0].sources.push({
      sourceId: "source-2",
      inputRevision: 2,
      managedAfterRevision: 1,
      observations: [
        {
          observationToken: "c".repeat(32),
          captureId: "coowner-no-changes",
          inputRevision: 2,
          allocatedAt: 200,
          status: "consumed",
          sourceContentHash: HASH_B,
          pipelineFingerprint: HASH_A,
          boundAt: 205,
          settledAt: 220,
          queueRevision: queueBefore.revision,
        },
      ],
    });
    harness.file.replaceContent(JSON.stringify(stateBefore));

    await harness.port.recordCommitted(harness.journal, harness.receipt);

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const committedManifest = state.manifests[0].value as SourceManifest;
    const afterHash = createFileContentHash("# Shared after\n");
    expect(committedManifest.revision).toBe(5);
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
      manifestAfterRevision: 5,
      manifestAfterDigest: createSourceManifestDigest(committedManifest),
    });
    expect(
      committedManifest.entries[1].extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toEqual(coOwnerNoChangesMarker);
    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();

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

  it("atomically commits first-source no-change success with Queue completion", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "atomic-no-changes",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound no-change observation");
    const plan = createRuntimeNoChangesPlan(manifest);
    let executions = 0;
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Returns one production-shaped no-change result with exact Manifest authority. */
        execute: async () => {
          executions += 1;
          return {
            kind: "no_changes",
            changeSetId: plan.noChangesId,
            manifestCommitPlan: plan,
            manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
          };
        },
      },
      { clock: () => 100, jobIdFactory: () => "job-atomic-no-changes" }
    );

    await queue.enqueue(bound.observation);
    await expect(queue.runNext("personal")).resolves.toEqual({
      kind: "executed",
      jobId: "job-atomic-no-changes",
      status: "completed",
      generationEffect: "manifest_no_changes_committed",
    });

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queueState = state.queues.find((slot) => slot.bundleId === "personal")
      ?.value as IngestQueueSnapshot;
    const manifestState = state.manifests.find((slot) => slot.bundleId === "personal")
      ?.value as SourceManifest;
    const markerValue =
      manifestState.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
    const marker = parseKnowledgeNoChangesCommitMarker(markerValue);
    expect(queueState.jobs).toEqual([
      expect.objectContaining({
        id: "job-atomic-no-changes",
        status: "completed",
        changeSetId: plan.noChangesId,
      }),
    ]);
    expect(manifestState).toMatchObject({ revision: 2 });
    expect(manifestState.entries[0]?.lastSuccessful).toBeUndefined();
    expect(marker).toMatchObject({
      ok: true,
      value: {
        noChangesId: plan.noChangesId,
        jobId: "job-atomic-no-changes",
        inputRevision: 1,
        baseGeneratedPages: [],
        manifestAfterRevision: 2,
      },
    });
    expect(state.reviews).toEqual([]);
    expect(state.applyCommits).toEqual([]);
    expect(state.activeTransaction).toBeNull();
    expect(executions).toBe(1);

    const freshnessAuthority = await harness.runtime.readSourceFreshnessAuthority(
      "personal",
      "source-1"
    );
    if (!freshnessAuthority) throw new Error("Expected no-change source freshness authority");
    expect(freshnessAuthority.runtimeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(freshnessAuthority).toEqual({
      version: 1,
      kind: "no_changes",
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      runtimeDigest: freshnessAuthority.runtimeDigest,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      manifestRevision: manifestState.revision,
      manifestDigest: createSourceManifestDigest(manifestState),
      generatedPages: [],
      noChangesId: plan.noChangesId,
      reason: plan.reason,
      planDigest: createNoChangesManifestCommitPlanDigest(plan),
      jobId: "job-atomic-no-changes",
      attempt: 1,
      committedManifestRevision: manifestState.revision,
      completedAt: 100,
    });
    expect(Object.isFrozen(freshnessAuthority)).toBe(true);
    expect(Object.isFrozen(freshnessAuthority?.generatedPages)).toBe(true);

    const duplicateAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "atomic-no-changes-duplicate",
    });
    const duplicate = await harness.observations.bind({
      observationToken: duplicateAllocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (duplicate.kind !== "ready") throw new Error("Expected a duplicate observation");
    await expect(queue.enqueue(duplicate.observation)).resolves.toMatchObject({
      kind: "deduplicated",
      job: { id: "job-atomic-no-changes" },
    });
    expect(executions).toBe(1);
    const unchangedManifest = (
      JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot
    ).manifests.find((slot) => slot.bundleId === "personal")?.value as SourceManifest;
    expect(unchangedManifest).toEqual(manifestState);

    const bypassEntry = { ...manifestState.entries[0] };
    const bypassExtensions = { ...bypassEntry.extensions };
    delete bypassExtensions[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
    bypassEntry.extensions = bypassExtensions;
    await expect(
      harness.manifest.write(
        "personal",
        { ...manifestState, revision: 3, entries: [bypassEntry] },
        2
      )
    ).rejects.toMatchObject({
      name: KnowledgeRuntimeManifestProtectedStateError.name,
      state: "reserved_no_changes_extension",
    });

    const corrupted = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const corruptedManifest = corrupted.manifests[0]?.value as SourceManifest;
    const corruptedMarker = corruptedManifest.entries[0]?.extensions?.[
      KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY
    ] as Record<string, JsonValue>;
    corruptedMarker.jobId = "job-forged-no-changes";
    harness.file.replaceContent(JSON.stringify(corrupted));
    await expect(
      harness.runtime.readSourceFreshnessAuthority("personal", "source-1")
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
  });

  it("atomically records a newer no-change observation without replacing applied success provenance", async () => {
    const manifest = createRegisteredManifest();
    const citation = createSourceCitation();
    const proof = createCommittedApplyProof(manifest, "transaction-apply-then-no-changes", 1, [
      citation,
    ]);
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);

    const recoveryQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(harness.runtime),
      {
        /** Recovery does not execute new source work. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 250, jobIdFactory: () => "job-unused-after-apply" }
    );
    await recoveryQueue.resolveApplyRecovery(harness.receipt);
    await new KnowledgeRuntimeTransactionStorage(harness.runtime).clearActive({
      transactionId: harness.journal.transactionId,
      revision: harness.journal.revision,
    });
    await recoveryQueue.finalizeApplyRecovery("personal", harness.receipt.transactionId);
    await expect(
      new KnowledgeRuntimeStartupReleasePort(harness.runtime).release(
        await createStartupReleaseRequest(harness)
      )
    ).resolves.toMatchObject({ kind: "released", bundleId: "personal" });

    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const manifestBefore = before.manifests[0]?.value as SourceManifest;
    const sourceBefore = manifestBefore.entries[0];
    if (!sourceBefore?.lastSuccessful) {
      throw new Error("Expected one real applied source success before no-change completion");
    }
    const provenanceBefore = await harness.runtime.readAppliedProvenance("personal");
    expect(provenanceBefore.pages).toHaveLength(1);
    expect(before.activeTransaction).toBeNull();

    const revisions = new KnowledgeRuntimeInputRevisionAllocator(harness.runtime);
    const observations = new KnowledgeRuntimeInputObservationBinder(harness.runtime);
    const allocation = await revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "apply-then-no-changes-revision-2",
    });
    expect(allocation.inputRevision).toBe(2);
    const bound = await observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") {
      throw new Error("Expected a newer bound source observation after applied success");
    }
    const plan = createRuntimeNoChangesPlan(
      manifestBefore,
      allocation.inputRevision,
      HASH_C,
      HASH_B
    );
    const noChangesQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(harness.runtime),
      {
        /** Returns an exact no-change plan over the post-Apply Manifest read-set. */
        execute: async () => ({
          kind: "no_changes",
          changeSetId: plan.noChangesId,
          manifestCommitPlan: plan,
          manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
        }),
      },
      { clock: () => 300, jobIdFactory: () => "job-no-changes-after-apply" }
    );
    await noChangesQueue.enqueue(bound.observation);

    await expect(noChangesQueue.runNext("personal")).resolves.toEqual({
      kind: "executed",
      jobId: "job-no-changes-after-apply",
      status: "completed",
      generationEffect: "manifest_no_changes_committed",
    });

    const after = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const manifestAfter = after.manifests[0]?.value as SourceManifest;
    const sourceAfter = manifestAfter.entries[0];
    const parsedMarker = parseKnowledgeNoChangesCommitMarker(
      sourceAfter?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    );
    expect(manifestAfter.revision).toBe(manifestBefore.revision + 1);
    expect(sourceAfter?.lastSuccessful).toEqual(sourceBefore.lastSuccessful);
    expect(after.applyCommits).toEqual(before.applyCommits);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.activeTransaction).toBeNull();
    expect(parsedMarker).toMatchObject({
      ok: true,
      value: {
        noChangesId: plan.noChangesId,
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
        inputRevision: 2,
        jobId: "job-no-changes-after-apply",
        manifestAfterRevision: manifestAfter.revision,
        baseGeneratedPages: sourceBefore.lastSuccessful.generatedPages,
      },
    });

    await expect(
      harness.runtime.readSourceFreshnessAuthority("personal", "source-1")
    ).resolves.toMatchObject({
      kind: "no_changes",
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      noChangesId: plan.noChangesId,
      committedManifestRevision: manifestAfter.revision,
      manifestRevision: manifestAfter.revision,
      manifestDigest: createSourceManifestDigest(manifestAfter),
      generatedPages: sourceBefore.lastSuccessful.generatedPages.map((page) => ({
        ...page,
        windowsPathKey: toWindowsPathKey(page.path),
      })),
    });

    const provenanceAfter = await harness.runtime.readAppliedProvenance("personal");
    expect(provenanceAfter).toEqual({
      ...provenanceBefore,
      runtimeRevision: after.revision,
      manifestRevision: manifestAfter.revision,
    });
    expect(provenanceAfter.pages).toEqual(provenanceBefore.pages);
  });

  it("atomically commits an older no-change attempt and promotes its exact newer rerun", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const firstAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "no-changes-rerun-first",
    });
    const firstBound = await harness.observations.bind({
      observationToken: firstAllocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (firstBound.kind !== "ready") throw new Error("Expected the first no-change observation");
    const plan = createRuntimeNoChangesPlan(manifest);
    let signalStarted: (() => void) | undefined;
    let releaseExecution: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    let jobNumber = 0;
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Holds the exact first result while a newer source observation schedules a rerun. */
        execute: async () => {
          signalStarted?.();
          await executionGate;
          return {
            kind: "no_changes",
            changeSetId: plan.noChangesId,
            manifestCommitPlan: plan,
            manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
          };
        },
      },
      {
        clock: () => 100,
        jobIdFactory: () => `job-no-changes-rerun-${(jobNumber += 1)}`,
      }
    );
    await queue.enqueue(firstBound.observation);
    const running = queue.runNext("personal");
    await started;

    const newerAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "no-changes-rerun-newer",
    });
    const newerBound = await harness.observations.bind({
      observationToken: newerAllocation.observationToken,
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
    });
    if (newerBound.kind !== "ready") throw new Error("Expected the newer rerun observation");
    await expect(queue.enqueue(newerBound.observation)).resolves.toMatchObject({
      kind: "rerun_scheduled",
    });
    if (!releaseExecution) throw new Error("Expected an active no-change execution gate");
    releaseExecution();

    await expect(running).resolves.toEqual({
      kind: "executed",
      jobId: "job-no-changes-rerun-1",
      status: "completed",
      generationEffect: "manifest_no_changes_committed",
    });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queueState = state.queues[0]?.value as IngestQueueSnapshot;
    const manifestState = state.manifests[0]?.value as SourceManifest;
    expect(queueState).toMatchObject({
      reruns: [],
      jobs: [
        {
          id: "job-no-changes-rerun-1",
          status: "completed",
          inputRevision: 1,
          changeSetId: plan.noChangesId,
        },
        {
          id: "job-no-changes-rerun-2",
          status: "pending",
          inputRevision: 2,
          sourceContentHash: HASH_C,
        },
      ],
    });
    expect(
      manifestState.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toMatchObject({
      jobId: "job-no-changes-rerun-1",
      inputRevision: 1,
      noChangesId: plan.noChangesId,
    });
    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();
  });

  it("rejects a production no-change Queue completion without its exact plan authority", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "missing-no-changes-authority",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound no-change observation");
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Omits the production Manifest plan and also avoids its reserved id namespace. */
        execute: async () => ({
          kind: "no_changes",
          changeSetId: "untrusted-queue-only-no-changes",
        }),
      },
      { clock: () => 100, jobIdFactory: () => "job-missing-no-changes-authority" }
    );
    await queue.enqueue(bound.observation);

    await expect(queue.runNext("personal")).rejects.toBeInstanceOf(
      KnowledgeRuntimeNoChangesCommitConflictError
    );
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const persistedManifest = state.manifests[0]?.value as SourceManifest;
    expect(
      persistedManifest.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toBeUndefined();
    expect((state.queues[0]?.value as IngestQueueSnapshot).jobs[0]?.status).not.toBe("completed");
  });

  it("keeps Queue and no-change marker uncommitted when the Manifest read-set drifts", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "no-changes-manifest-drift",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound no-change observation");
    const plan = createRuntimeNoChangesPlan(manifest);
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Advances unrelated Manifest metadata after compile captured its exact read-set. */
        execute: async () => {
          const source = manifest.entries[0];
          await harness.manifest.write(
            "personal",
            {
              ...manifest,
              revision: manifest.revision + 1,
              entries: [
                {
                  ...source,
                  extensions: { ...source.extensions, concurrentObservation: true },
                },
              ],
            },
            manifest.revision
          );
          return {
            kind: "no_changes",
            changeSetId: plan.noChangesId,
            manifestCommitPlan: plan,
            manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
          };
        },
      },
      { clock: () => 100, jobIdFactory: () => "job-no-changes-manifest-drift" }
    );
    await queue.enqueue(bound.observation);

    await expect(queue.runNext("personal")).rejects.toMatchObject({
      name: KnowledgeRuntimeNoChangesCommitConflictError.name,
      reason: "manifest_mismatch",
    });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const persistedManifest = state.manifests[0]?.value as SourceManifest;
    expect(persistedManifest).toMatchObject({
      revision: 2,
      entries: [{ extensions: { concurrentObservation: true } }],
    });
    expect(
      persistedManifest.entries[0]?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
    ).toBeUndefined();
    expect((state.queues[0]?.value as IngestQueueSnapshot).jobs[0]?.status).not.toBe("completed");
  });

  it("keeps atomic no-change success after commit acknowledgement is lost", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "no-changes-post-commit",
    });
    const bound = await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (bound.kind !== "ready") throw new Error("Expected a bound no-change observation");
    const plan = createRuntimeNoChangesPlan(manifest);
    const queue = new IngestQueue(
      harness.queue,
      {
        /** Arms an acknowledgement loss immediately before the atomic final write. */
        execute: async () => {
          harness.file.throwAfterCommitOnNextWrite();
          return {
            kind: "no_changes",
            changeSetId: plan.noChangesId,
            manifestCommitPlan: plan,
            manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
          };
        },
      },
      { clock: () => 100, jobIdFactory: () => "job-no-changes-post-commit" }
    );
    await queue.enqueue(bound.observation);

    await expect(queue.runNext("personal")).rejects.toThrow(
      "Simulated post-commit transport failure"
    );
    const committed = await harness.file.read();
    const state = JSON.parse(committed) as KnowledgeRuntimeStoreSnapshot;
    expect((state.queues[0]?.value as IngestQueueSnapshot).jobs[0]).toMatchObject({
      id: "job-no-changes-post-commit",
      status: "completed",
      changeSetId: plan.noChangesId,
    });
    expect(
      (state.manifests[0]?.value as SourceManifest).entries[0]?.extensions?.[
        KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY
      ]
    ).toBeDefined();

    const reconstructed = new KnowledgeRuntimeStore(harness.file);
    await expect(reconstructed.initialize()).resolves.toBeUndefined();
    expect(await harness.file.read()).toBe(committed);
    let replayExecutions = 0;
    const replayQueue = new IngestQueue(new KnowledgeRuntimeQueueStorage(reconstructed), {
      /** Must remain unreachable because the committed attempt is already terminal. */
      execute: async () => {
        replayExecutions += 1;
        return { kind: "no_changes", changeSetId: "unexpected-replay" };
      },
    });
    await expect(replayQueue.runNext("personal")).resolves.toEqual({ kind: "idle" });
    expect(replayExecutions).toBe(0);
    expect(await harness.file.read()).toBe(committed);
  });

  it("accepts an old Runtime's retained no-change marker after a newer Apply", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const firstAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "downgrade-no-change",
    });
    const firstBound = await harness.observations.bind({
      observationToken: firstAllocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (firstBound.kind !== "ready") throw new Error("Expected the no-change observation");
    const noChangesPlan = createRuntimeNoChangesPlan(manifest);
    const noChangesQueue = new IngestQueue(
      harness.queue,
      {
        /** Commits one exact marker that an older Runtime will later retain. */
        execute: async () => ({
          kind: "no_changes",
          changeSetId: noChangesPlan.noChangesId,
          manifestCommitPlan: noChangesPlan,
          manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(noChangesPlan),
        }),
      },
      { clock: () => 100, jobIdFactory: () => "job-downgrade-no-change" }
    );
    await noChangesQueue.enqueue(firstBound.observation);
    await noChangesQueue.runNext("personal");

    const afterNoChanges = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const manifestBeforeApply = afterNoChanges.manifests[0].value as SourceManifest;
    const retainedMarker =
      manifestBeforeApply.entries[0].extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
    if (retainedMarker === undefined) throw new Error("Expected a durable no-change marker");

    const secondAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "downgrade-newer-apply",
    });
    const secondBound = await harness.observations.bind({
      observationToken: secondAllocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    if (secondBound.kind !== "ready") throw new Error("Expected the newer Apply observation");
    const applyTransactionId = "transaction-downgrade-newer-apply";
    const pendingQueue = new IngestQueue(
      harness.queue,
      {
        /** The executor is not invoked while this fixture creates Apply authority. */
        execute: async () => ({ kind: "no_changes", changeSetId: "unused" }),
      },
      { jobIdFactory: () => `job-${applyTransactionId}` }
    );
    await pendingQueue.enqueue(secondBound.observation);

    const proof = createCommittedApplyProof(manifestBeforeApply, applyTransactionId, 2);
    const authority = createApplyAuthoritySlots(manifestBeforeApply, proof.journal);
    const stateBeforeApply = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const currentQueue = stateBeforeApply.queues[0].value as IngestQueueSnapshot;
    const applyingQueue = authority.queues[0].value as IngestQueueSnapshot;
    applyingQueue.revision = currentQueue.revision + 1;
    applyingQueue.jobs = [
      ...currentQueue.jobs.filter((job) => job.id === "job-downgrade-no-change"),
      ...applyingQueue.jobs,
    ];
    applyingQueue.sourceHighWatermarks = currentQueue.sourceHighWatermarks;
    stateBeforeApply.revision += 1;
    stateBeforeApply.queues = [{ bundleId: "personal", value: applyingQueue }];
    stateBeforeApply.reviews = authority.reviews;
    stateBeforeApply.activeTransaction = proof.journal;
    harness.file.replaceContent(JSON.stringify(stateBeforeApply));
    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();

    const applyPort = new KnowledgeRuntimeApplyCommitManifestPort(harness.runtime);
    await applyPort.recordCommitted(proof.journal, proof.receipt);
    const downgraded = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const downgradedManifest = downgraded.manifests[0].value as SourceManifest;
    downgradedManifest.entries[0].extensions = {
      ...downgradedManifest.entries[0].extensions,
      [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: retainedMarker,
    };
    const applyLedger = downgraded.applyCommits.find(
      (record) => record.transactionId === applyTransactionId
    );
    if (!applyLedger) throw new Error("Expected the newer Apply ledger");
    applyLedger.manifestAfterDigest = createSourceManifestDigest(downgradedManifest);
    harness.file.replaceContent(JSON.stringify(downgraded));

    await expect(new KnowledgeRuntimeStore(harness.file).initialize()).resolves.toBeUndefined();
    await expect(
      harness.runtime.readSourceFreshnessAuthority("personal", "source-1")
    ).resolves.toMatchObject({
      kind: "applied",
      transactionId: applyTransactionId,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      manifestRevision: downgradedManifest.revision,
      manifestDigest: createSourceManifestDigest(downgradedManifest),
    });
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
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const noChangesPlan = createRuntimeNoChangesPlan(manifest);
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
          return {
            kind: "no_changes",
            changeSetId: noChangesPlan.noChangesId,
            manifestCommitPlan: noChangesPlan,
            manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(noChangesPlan),
          };
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
    await expect(queue.runNext("personal")).rejects.toBeInstanceOf(
      KnowledgeRuntimeNoChangesCommitConflictError
    );
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

  it("consumes repeated stale-output observations behind a durable blocker and rearms after restoration", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    await harness.manifest.write("personal", manifest, null);
    const noChangesPlan = createRuntimeNoChangesPlan(manifest);
    let outputCurrent = false;
    let executions = 0;
    const freshnessAdmission: IngestSourceFreshnessAdmissionPort = {
      /** Returns identity-bound output freshness controlled by this cross-layer fixture. */
      async evaluate(request) {
        return Object.freeze({
          ...request,
          decision: outputCurrent
            ? Object.freeze({ kind: "up_to_date" as const })
            : Object.freeze({
                kind: "needs_ingest" as const,
                reasons: Object.freeze(["output_missing" as const]),
              }),
        });
      },
    };
    const executor: IngestExecutor = {
      /** Simulates a model that cannot produce targets for the missing output. */
      async execute() {
        executions += 1;
        return {
          kind: "no_changes",
          changeSetId: noChangesPlan.noChangesId,
          manifestCommitPlan: noChangesPlan,
          manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(noChangesPlan),
        };
      },
    };
    const queue = new IngestQueue(harness.queue, executor, {
      clock: () => 100,
      jobIdFactory: () => "job-output-repair-blocker",
      sourceFreshnessAdmission: freshnessAdmission,
    });
    const handoff = new SourceObservationHandoff(harness.revisions, harness.observations, queue);
    const first = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "output-repair-first",
    });

    await expect(
      handoff.commit({
        observationToken: first.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({ kind: "committed", queueRevision: 1 });
    await expect(queue.runNext("personal")).resolves.toEqual({
      kind: "executed",
      jobId: "job-output-repair-blocker",
      status: "failed",
    });
    expect(executions).toBe(1);

    const repeated = await handoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "output-repair-repeated-stale",
    });
    const queueBeforeRepeatedCommit = await queue.load("personal");
    const repeatedSettlement = await handoff.commit({
      observationToken: repeated.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    const queueAfterRepeatedCommit = await queue.load("personal");

    expect(repeatedSettlement).toMatchObject({
      kind: "committed",
      observation: { inputRevision: 2 },
      queueRevision: queueBeforeRepeatedCommit.revision + 1,
    });
    expect(queueAfterRepeatedCommit).toMatchObject({
      revision: queueBeforeRepeatedCommit.revision + 1,
      sourceHighWatermarks: [expect.objectContaining({ inputRevision: 2 })],
    });
    expect(queueAfterRepeatedCommit.jobs).toHaveLength(1);
    const repeatedBlocker = queueAfterRepeatedCommit.jobs[0];
    expect(repeatedBlocker).toMatchObject({
      id: "job-output-repair-blocker",
      inputRevision: 2,
      status: "failed",
    });
    if (repeatedBlocker.status !== "failed") {
      throw new Error("Expected the output repair blocker to remain failed");
    }
    expect(repeatedBlocker.failure).toEqual({
      code: "output_repair_unresolved",
      message: "Generated output remains stale after a no-change repair attempt",
      occurredAt: 100,
      retryable: false,
    });
    expect(executions).toBe(1);
    await expect(handoff.loadRecoveryWork("personal")).resolves.toEqual([]);

    const reconstructed = new KnowledgeRuntimeStore(harness.file);
    await reconstructed.initialize();
    const restartQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(reconstructed),
      executor,
      {
        clock: () => 200,
        jobIdFactory: () => "job-output-repair-rearmed",
        sourceFreshnessAdmission: freshnessAdmission,
      }
    );
    const restartHandoff = new SourceObservationHandoff(
      new KnowledgeRuntimeInputRevisionAllocator(reconstructed),
      new KnowledgeRuntimeInputObservationBinder(reconstructed),
      restartQueue
    );

    await expect(restartHandoff.loadRecoveryWork("personal")).resolves.toEqual([]);
    await expect(restartQueue.load("personal")).resolves.toMatchObject({
      jobs: [
        expect.objectContaining({
          id: "job-output-repair-blocker",
          inputRevision: 2,
          status: "failed",
        }),
      ],
      sourceHighWatermarks: [expect.objectContaining({ inputRevision: 2 })],
    });
    expect(executions).toBe(1);

    outputCurrent = true;
    const restored = await restartHandoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "output-repair-restored",
    });
    await expect(
      restartHandoff.commit({
        observationToken: restored.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({
      kind: "committed",
      observation: { inputRevision: 3 },
    });
    await expect(restartQueue.load("personal")).resolves.toMatchObject({
      jobs: [expect.objectContaining({ inputRevision: 2, status: "failed" })],
      sourceHighWatermarks: [expect.objectContaining({ inputRevision: 3 })],
    });

    outputCurrent = false;
    const driftedAgain = await restartHandoff.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "output-repair-drifted-again",
    });
    await expect(
      restartHandoff.commit({
        observationToken: driftedAgain.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({
      kind: "committed",
      observation: { inputRevision: 4 },
    });
    await expect(restartQueue.load("personal")).resolves.toMatchObject({
      jobs: [
        expect.objectContaining({ id: "job-output-repair-blocker", status: "failed" }),
        expect.objectContaining({
          id: "job-output-repair-rearmed",
          inputRevision: 4,
          status: "pending",
        }),
      ],
      sourceHighWatermarks: [expect.objectContaining({ inputRevision: 4 })],
    });
    expect(executions).toBe(1);
    await expect(restartHandoff.loadRecoveryWork("personal")).resolves.toEqual([]);
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

  it("atomically projects literal Reject across Review and Queue only", async () => {
    const harness = await createReviewRejectHarness();
    let hints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });

    const receipt = await harness.port.rejectReviewAtomically("personal", harness.command);
    const after = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = after.queues[0].value as IngestQueueSnapshot;
    const review = after.reviews[0].value as ChangeSetReviewSnapshot;

    expect(receipt).toMatchObject({
      outcome: "rejected",
      bundleId: "personal",
      changeSetId: harness.command.changeSetId,
      proposalDigest: harness.command.proposalDigest,
      recordRevision: 1,
      rejectedAt: 130,
      cancelledAt: 130,
      queueRevision: 4,
      reviewRevision: 3,
      runtimeRevision: 10,
    });
    expect(review).toMatchObject({
      revision: 3,
      records: [
        {
          outcome: "rejected",
          recordRevision: 1,
          rejectedAt: 130,
        },
      ],
    });
    expect(queue).toMatchObject({
      revision: 4,
      pendingReviews: [],
      jobs: [
        {
          id: "job-runtime-review-reject",
          status: "cancelled",
          stage: "cancelled",
          cancelledAt: 130,
        },
      ],
      reviewRejections: [
        {
          jobId: "job-runtime-review-reject",
          changeSetId: harness.command.changeSetId,
          proposalDigest: harness.command.proposalDigest,
          reviewRecordRevision: 1,
          decisionAt: 130,
          rejectedAt: 130,
        },
      ],
    });
    expect(after.manifests).toEqual(harness.initialState.manifests);
    expect(after.activeTransaction).toEqual(harness.initialState.activeTransaction);
    expect(after.inputRevisions).toEqual(harness.initialState.inputRevisions);
    expect(after.applyCommits).toEqual(harness.initialState.applyCommits);
    expect(hints).toBe(1);
  });

  it("replays one exact final Reject as a byte-preserving no-op", async () => {
    const harness = await createReviewRejectHarness();
    const first = await harness.port.rejectReviewAtomically("personal", harness.command);
    const afterFirst = await harness.file.read();

    const replay = await harness.port.rejectReviewAtomically("personal", harness.command);

    expect(replay).toEqual(first);
    expect(await harness.file.read()).toBe(afterFirst);
  });

  it("confirms an exact committed Reject after the atomic transport throws", async () => {
    const harness = await createReviewRejectHarness();
    let hints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });
    harness.file.throwAfterCommitOnNextWrite();

    await expect(
      harness.port.rejectReviewAtomically("personal", harness.command)
    ).resolves.toMatchObject({
      outcome: "rejected",
      runtimeRevision: 10,
      queueRevision: 4,
      reviewRevision: 3,
    });

    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    expect(queue.reviewRejections).toHaveLength(1);
    expect(state.revision).toBe(10);
    expect(hints).toBe(1);
  });

  it("does not invent success when the atomic transform never ran", async () => {
    const harness = await createReviewRejectHarness();
    const before = await harness.file.read();
    harness.file.skipTransformOnNextWrite();

    await expect(
      harness.port.rejectReviewAtomically("personal", harness.command)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeAtomicWriteError);
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects mixed acceptance and durable-anchor drift without changing bytes", async () => {
    const mixed = await createReviewRejectHarness();
    const mixedBefore = await mixed.file.read();
    const mixedCommand = {
      ...mixed.command,
      decisions: mixed.command.decisions.map((decision) => ({
        ...decision,
        decision: "accept_exact" as const,
      })),
    };

    await expect(
      mixed.port.rejectReviewAtomically("personal", mixedCommand)
    ).rejects.toBeInstanceOf(KnowledgeLiteralRejectCommandError);
    expect(await mixed.file.read()).toBe(mixedBefore);

    const drifted = await createReviewRejectHarness();
    const driftedState = JSON.parse(await drifted.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const driftedQueue = driftedState.queues[0].value as IngestQueueSnapshot;
    const anchor = driftedQueue.pendingReviews[0];
    if (anchor.kind !== "durable") throw new Error("Expected a durable pending Review");
    anchor.proposalDigest = HASH_C;
    drifted.file.replaceContent(JSON.stringify(driftedState));
    const driftedBefore = await drifted.file.read();

    await expect(
      drifted.port.rejectReviewAtomically("personal", drifted.command)
    ).rejects.toBeInstanceOf(KnowledgeReviewRejectConflictError);
    expect(await drifted.file.read()).toBe(driftedBefore);
  });

  it("serializes concurrent identical Rejects into one transition and one tombstone", async () => {
    const harness = await createReviewRejectHarness();
    let hints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });

    const receipts = await Promise.all([
      harness.port.rejectReviewAtomically("personal", harness.command),
      harness.port.rejectReviewAtomically("personal", harness.command),
    ]);

    expect(receipts[0]).toEqual(receipts[1]);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const queue = state.queues[0].value as IngestQueueSnapshot;
    expect(state.revision).toBe(10);
    expect(queue.reviewRejections).toHaveLength(1);
    expect(hints).toBe(1);
  });

  it("exposes no Queue, Review, apply, or Runtime handles from the Reject-only port", async () => {
    const harness = await createReviewRejectHarness();

    expect(Object.keys(harness.port)).toEqual([]);
    expect(Object.isFrozen(harness.port)).toBe(true);
    expect("read" in harness.port).toBe(false);
    expect("writeQueue" in harness.port).toBe(false);
    expect("writeReview" in harness.port).toBe(false);
    expect("beginReviewApply" in harness.port).toBe(false);
    expect("runtime" in harness.port).toBe(false);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(harness.port)).sort()).toEqual([
      "constructor",
      "rejectReviewAtomically",
    ]);
  });
});

describe("KnowledgeRuntimeStore forward revision proposal publication", () => {
  it("atomically migrates v5 through empty v1 and v2 forward namespaces", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const current = createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    const { forwardRevisionReviews: _forwardRevisionReviews, ...withoutForward } = current;
    void _forwardRevisionReviews;
    const previous = { ...withoutForward, version: 5, revision: 7 };
    await file.initialize(JSON.stringify(previous));

    await new KnowledgeRuntimeStore(file).initialize();

    expect(JSON.parse(await file.read())).toEqual({
      ...previous,
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      revision: 9,
      forwardRevisionReviews: [],
    });
  });

  it("migrates v6 forward v1 slots to v7 v2 without changing publication identity", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const current = createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    const published = createForwardPublishedFixture(
      "personal",
      "Wiki/Migrated.md",
      current.runtimeId,
      "# migrated\n",
      1,
      3
    );
    const previous = {
      ...current,
      version: 6,
      revision: 3,
      forwardRevisionReviews: [
        {
          bundleId: "personal",
          value: snapshotKnowledgeForwardRevisionReviewSnapshot({
            version: 1,
            bundleId: "personal",
            revision: 1,
            lastRequestRevision: 1,
            records: [published],
          }),
        },
      ],
    };
    await file.initialize(JSON.stringify(previous));

    await new KnowledgeRuntimeStore(file).initialize();

    const migrated = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(migrated).toMatchObject({ version: 7, revision: 4 });
    expect(migrated.forwardRevisionReviews[0].value).toMatchObject({
      version: 2,
      revision: 1,
      lastRequestRevision: 1,
      records: [
        {
          state: "pending",
          proposal: { proposalId: published.proposal.proposalId },
          proposalDigest: published.proposalDigest,
          publishedRuntimeRevision: 3,
          proposalStoreRevision: 1,
        },
      ],
    });
  });

  it("migrates multiple v6 forward Bundles and rejects outer revision overflow", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const current = createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    const previous = {
      ...current,
      version: 6,
      revision: 2,
      forwardRevisionReviews: ["personal", "work"].map((bundleId, index) => ({
        bundleId,
        value: snapshotKnowledgeForwardRevisionReviewSnapshot({
          version: 1,
          bundleId,
          revision: 1,
          lastRequestRevision: 1,
          records: [
            createForwardPublishedFixture(
              bundleId,
              `Wiki/${bundleId}.md`,
              current.runtimeId,
              `# ${bundleId}\n`,
              1,
              index + 1
            ),
          ],
        }),
      })),
    };
    await file.initialize(JSON.stringify(previous));
    await expect(new KnowledgeRuntimeStore(file).initialize()).resolves.toBeUndefined();
    const migrated = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(migrated.forwardRevisionReviews.map((slot) => slot.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 2, bundleId: "personal" }),
        expect.objectContaining({ version: 2, bundleId: "work" }),
      ])
    );

    const overflowFile = new MemoryAtomicRuntimeFile();
    await overflowFile.initialize(
      JSON.stringify({ ...previous, revision: Number.MAX_SAFE_INTEGER })
    );
    await expect(new KnowledgeRuntimeStore(overflowFile).initialize()).rejects.toMatchObject({
      name: KnowledgeRuntimeMigrationUnsafeError.name,
      reason: "revision_overflow",
    });
  });

  it("publishes once, preserves legacy slots, and replays original publication revisions", async () => {
    let clockCalls = 0;
    const harness = await createForwardPublicationHarness(() => {
      clockCalls += 1;
      return 1;
    });
    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    let personalHints = 0;
    let workHints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      personalHints += 1;
    });
    harness.runtime.subscribeStudioBundle("work", () => {
      workHints += 1;
    });

    const published = await harness.port.publish(harness.evidence);

    expect(published).toMatchObject({
      outcome: "published",
      requestRevision: 1,
      proposalStoreRevision: 1,
      publishedAt: 340,
    });
    const after = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.queues).toEqual(before.queues);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.manifests).toEqual(before.manifests);
    expect(after.activeTransaction).toEqual(before.activeTransaction);
    expect(after.inputRevisions).toEqual(before.inputRevisions);
    expect(after.applyCommits).toEqual(before.applyCommits);
    expect(after.forwardRevisionReviews).toHaveLength(1);
    expect(personalHints).toBe(1);
    expect(workHints).toBe(0);

    await new KnowledgeRuntimeQueueStorage(harness.runtime).write(
      "unrelated",
      createQueueSnapshot(1, "unrelated"),
      null
    );
    const callsBeforeReplay = clockCalls;
    const replayed = await harness.port.publish(harness.evidence);

    expect(replayed).toEqual({ ...published, outcome: "already_published" });
    expect(replayed.publicationId).toBe(published.publicationId);
    expect(replayed.runtimeRevision).toBe(published.runtimeRevision);
    expect(clockCalls).toBe(callsBeforeReplay);
    expect(personalHints).toBe(1);
    expect(workHints).toBe(0);
  });

  it("confirms an exact publication after an uncertain post-commit result", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    harness.file.throwAfterCommitOnNextWrite();

    await expect(harness.port.publish(harness.evidence)).resolves.toMatchObject({
      outcome: "published",
      proposalStoreRevision: 1,
    });
    await expect(harness.runtime.readForwardRevisionReview("personal")).resolves.toMatchObject({
      revision: 1,
      records: [{ proposalStoreRevision: 1 }],
    });
  });

  it("rejects a mismatched external Vault observation without changing Runtime bytes", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const before = await harness.file.read();

    await expect(
      harness.port.publish({ ...harness.evidence, vaultObservedBeforeHash: HASH_C })
    ).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "request_invalid",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects historical Review authority substitution without changing Runtime bytes", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const before = await harness.file.read();
    const authority = harness.evidence.historicalReviewAuthority as Record<string, unknown>;

    await expect(
      harness.port.publish({
        ...harness.evidence,
        historicalReviewAuthority: { ...authority, proposalDigest: HASH_C },
      })
    ).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "historical_authority_changed",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("blocks publication behind a valid active global transaction", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    state.activeTransaction = harness.currentJournal;
    harness.file.replaceContent(JSON.stringify(state));
    const before = await harness.file.read();

    await expect(harness.port.publish(harness.evidence)).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "transaction_busy",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects a second intent for the same Windows-equivalent pending page", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    await harness.port.publish(harness.evidence);
    const original = harness.evidence.intent as ReturnType<
      typeof createKnowledgeForwardRevisionIntent
    >;
    const conflictingIntent = createKnowledgeForwardRevisionIntent({
      bundleId: original.bundleId,
      pagePath: original.pagePath,
      historical: {
        ...original.historical,
        transactionId: "transaction-forward-other-history",
      },
      current: original.current,
    });
    const conflicting = {
      ...harness.evidence,
      intent: conflictingIntent,
      intentDigest: createKnowledgeForwardRevisionIntentDigest(conflictingIntent),
    };

    await expect(harness.port.publish(conflicting)).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "page_conflict",
    });
  });

  it("accepts latest same-payload no-changes freshness and rejects an older intent after drift", async () => {
    const samePayload = await createForwardPublicationHarness(() => 500);
    await commitForwardNoChanges(samePayload, HASH_A);
    const samePayloadState = JSON.parse(
      await samePayload.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    const refreshedEvidence = createForwardPublicationEvidence(samePayloadState);

    await expect(samePayload.port.publish(refreshedEvidence)).resolves.toMatchObject({
      outcome: "published",
    });

    const changedPayload = await createForwardPublicationHarness(() => 500);
    const staleEvidence = changedPayload.evidence;
    await commitForwardNoChanges(changedPayload, HASH_C);
    await expect(changedPayload.port.publish(staleEvidence)).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "current_authority_changed",
    });
  });

  it("keeps the narrow port authentic and invokes the captured canonical Runtime method", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const prototype = KnowledgeRuntimeStore.prototype;
    const originalUpdateState = Object.getOwnPropertyDescriptor(prototype, "updateState");
    if (!originalUpdateState) throw new Error("Expected the canonical Runtime atomic boundary");
    Object.defineProperty(prototype, "updateState", {
      configurable: true,
      value: () => Promise.resolve({ outcome: "forged" }),
    });
    try {
      const canonicalRuntime = new KnowledgeRuntimeStore(harness.file, { clock: () => 500 });
      const canonicalPort = new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
        canonicalRuntime
      );
      await expect(canonicalPort.publish(harness.evidence)).resolves.toMatchObject({
        outcome: "published",
      });
    } finally {
      Object.defineProperty(prototype, "updateState", originalUpdateState);
    }

    const tamperedRuntime = new KnowledgeRuntimeStore(harness.file, { clock: () => 500 });
    Object.defineProperty(tamperedRuntime, "updateState", {
      configurable: true,
      value: () => Promise.resolve({ outcome: "forged" }),
    });
    expect(
      () => new KnowledgeRuntimeForwardRevisionProposalPublicationPort(tamperedRuntime)
    ).toThrow(TypeError);

    class UntrustedRuntimeSubclass extends KnowledgeRuntimeStore {
      /** Installs a forged own atomic boundary that an authentic port must never accept. */
      constructor(file: AtomicRuntimeFile) {
        super(file, { clock: () => 500 });
        Object.defineProperty(this, "updateState", {
          value: () => Promise.resolve({}),
        });
      }
    }
    expect(
      () =>
        new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
          new UntrustedRuntimeSubclass(harness.file)
        )
    ).toThrow(TypeError);
    expect(
      () =>
        new KnowledgeRuntimeForwardRevisionProposalPublicationPort(new Proxy(harness.runtime, {}))
    ).toThrow(TypeError);

    class SubclassPort extends KnowledgeRuntimeForwardRevisionProposalPublicationPort {
      /** Deliberately forged dynamic override. */
      override async publish() {
        return {} as never;
      }
    }
    const subclass = new SubclassPort(harness.runtime);
    expect(() => KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(subclass)).toThrow(
      TypeError
    );
    const forged: unknown = Object.create(
      KnowledgeRuntimeForwardRevisionProposalPublicationPort.prototype
    );
    expect(() => KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(forged)).toThrow(
      TypeError
    );
    expect(() =>
      KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(new Proxy(harness.port, {}))
    ).toThrow(TypeError);
  });

  it("maps aggregate proposal capacity exhaustion to the closed resource conflict", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const selectedContent = "x".repeat(2_000_000);
    const records = Array.from({ length: 8 }, (_, index) =>
      createForwardPublishedFixture(
        "personal",
        `Wiki/Capacity-${index + 1}.md`,
        state.runtimeId,
        selectedContent,
        index + 1,
        index + 1
      )
    );
    state.forwardRevisionReviews = [
      {
        bundleId: "personal",
        value: migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2(
          snapshotKnowledgeForwardRevisionReviewSnapshot({
            version: 1,
            bundleId: "personal",
            revision: records.length,
            lastRequestRevision: records.length,
            records,
          })
        ),
      },
    ];
    harness.file.replaceContent(JSON.stringify(state));

    await expect(harness.port.publish(harness.evidence)).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "resource_limit",
    });
  });

  it("maps an enclosing Runtime text-bound overflow to resource_limit without writing", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const before = await harness.file.read();
    const limitedRuntime = new KnowledgeRuntimeStore(harness.file, {
      clock: () => 500,
      maxTextCharacters: before.length,
    });
    const limitedPort = new KnowledgeRuntimeForwardRevisionProposalPublicationPort(limitedRuntime);

    await expect(limitedPort.publish(harness.evidence)).rejects.toMatchObject({
      name: KnowledgeForwardRevisionPublicationConflictError.name,
      reason: "resource_limit",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("rejects two Bundle records claiming the same original Runtime revision", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const state = createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    state.revision = 1;
    state.forwardRevisionReviews = ["personal", "work"].map((bundleId) => ({
      bundleId,
      value: migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2(
        snapshotKnowledgeForwardRevisionReviewSnapshot({
          version: 1,
          bundleId,
          revision: 1,
          lastRequestRevision: 1,
          records: [
            createForwardPublishedFixture(
              bundleId,
              `Wiki/${bundleId}.md`,
              state.runtimeId,
              `# ${bundleId}\n`,
              1,
              1
            ),
          ],
        })
      ),
    }));
    await file.initialize(JSON.stringify(state));

    await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toBeInstanceOf(
      KnowledgeRuntimeStoreCorruptError
    );
  });
});

describe("KnowledgeRuntimeStore forward revision proposal authority", () => {
  it("projects exact historical/current authority from one read without writing", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const query = createForwardAuthorityQuery(state);
    const before = await harness.file.read();
    const readsBefore = harness.file.getReadCallCount();

    const authority = await harness.port.readForwardRevisionProposalAuthority(query);

    expect(authority).toMatchObject({
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      query,
      intent: {
        bundleId: "personal",
        pagePath: query.pagePath,
        historical: {
          selectedContentHash: query.selectedContentHash,
          appliedAt: query.selectedAppliedAt,
          sourceId: "source-1",
          inputRevision: 1,
        },
        current: {
          ownership: "generated",
          sourceOrigin: "ingest",
          sourceIds: ["source-1"],
          manifestBaseHash: query.vaultObservedBeforeHash,
          vaultObservedBeforeHash: query.vaultObservedBeforeHash,
        },
      },
      historicalReviewAuthority: {
        acceptedRecordRevision: 1,
        targetChange: {
          path: query.pagePath,
          operation: "create",
          afterHash: query.selectedContentHash,
          sourceRefs: ["source-1"],
        },
        manifestPage: {
          path: query.pagePath,
          ownership: "generated",
          contentHash: query.selectedContentHash,
        },
      },
    });
    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    expect(await harness.file.read()).toBe(before);
  });

  it("returns null for selected metadata, current hash, and current-output staleness", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const query = createForwardAuthorityQuery(state);

    for (const stale of [
      { ...query, selectedAppliedAt: query.selectedAppliedAt + 1 },
      { ...query, selectedVerifiedApplyCount: query.selectedVerifiedApplyCount + 1 },
      { ...query, selectedContentHash: HASH_C },
      { ...query, vaultObservedBeforeHash: HASH_C },
      {
        ...query,
        selectedContentHash: query.vaultObservedBeforeHash,
        selectedAppliedAt: 340,
      },
    ]) {
      await expect(harness.port.readForwardRevisionProposalAuthority(stale)).resolves.toBeNull();
    }
  });

  it("rejects persisted shared-proof and source-origin drift", async () => {
    const sharedHarness = await createForwardPublicationHarness(() => 500);
    const sharedState = JSON.parse(
      await sharedHarness.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    const sharedQuery = createForwardAuthorityQuery(sharedState);
    const sharedManifest = sharedState.manifests[0].value as SourceManifest;
    const sharedPage = sharedManifest.entries[0].lastSuccessful?.generatedPages[0];
    if (sharedPage) sharedPage.ownership = "shared";
    sharedHarness.file.replaceContent(JSON.stringify(sharedState));
    await expect(
      sharedHarness.port.readForwardRevisionProposalAuthority(sharedQuery)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);

    for (const mutate of [
      (state: KnowledgeRuntimeStoreSnapshot) => {
        const manifest = state.manifests[0].value as SourceManifest;
        manifest.entries[0].custody = "managed_copy";
        manifest.entries[0].extensions = {
          ...manifest.entries[0].extensions,
          [KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY]: {
            version: 1,
            operation: "query_writeback",
            captureDigest: HASH_A,
            captureContentHash: HASH_A,
          },
        };
      },
    ]) {
      const harness = await createForwardPublicationHarness(() => 500);
      const clean = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
      const query = createForwardAuthorityQuery(clean);
      mutate(clean);
      harness.file.replaceContent(JSON.stringify(clean));
      await expect(harness.port.readForwardRevisionProposalAuthority(query)).rejects.toBeInstanceOf(
        KnowledgeRuntimeStoreCorruptError
      );
    }
  });

  it("treats exact-case path drift as persisted corruption and retired history as unavailable", async () => {
    const caseHarness = await createForwardPublicationHarness(() => 500);
    const caseState = JSON.parse(await caseHarness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const caseQuery = createForwardAuthorityQuery(caseState);
    const caseManifest = caseState.manifests[0].value as SourceManifest;
    const casePage = caseManifest.entries[0].lastSuccessful?.generatedPages[0];
    if (casePage) casePage.path = casePage.path.toLowerCase();
    caseHarness.file.replaceContent(JSON.stringify(caseState));
    await expect(
      caseHarness.port.readForwardRevisionProposalAuthority(caseQuery)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);

    const retiredHarness = await createForwardPublicationHarness(() => 500);
    const retiredState = JSON.parse(
      await retiredHarness.file.read()
    ) as KnowledgeRuntimeStoreSnapshot;
    const retiredQuery = createForwardAuthorityQuery(retiredState);
    const manifest = retiredState.manifests[0].value as SourceManifest;
    const retiredManifest = projectKnowledgeSourceRetirement(
      manifest,
      createKnowledgeSourceRetirementRecord({
        bundleId: manifest.bundleId,
        requestToken: HASH_A,
        reason: "user_requested",
        retiredAt: 500,
        retiredManifestRevision: manifest.revision + 1,
        source: manifest.entries[0],
      })
    );
    retiredState.manifests[0].value = retiredManifest;
    retiredHarness.file.replaceContent(JSON.stringify(retiredState));
    await expect(
      retiredHarness.port.readForwardRevisionProposalAuthority(retiredQuery)
    ).resolves.toBeNull();
  });

  it("projects latest no-changes freshness and rejects historical/source proof drift", async () => {
    const noChanges = await createForwardPublicationHarness(() => 500);
    await commitForwardNoChanges(noChanges, HASH_A);
    const noChangesState = JSON.parse(await noChanges.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const refreshed = createForwardAuthorityQuery(noChangesState);
    await expect(
      noChanges.port.readForwardRevisionProposalAuthority(refreshed)
    ).resolves.toMatchObject({
      intent: { current: { inputRevision: 3, sourceContentHash: HASH_A } },
    });

    const drifted = await createForwardPublicationHarness(() => 500);
    const driftedState = JSON.parse(await drifted.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const driftedQuery = createForwardAuthorityQuery(driftedState);
    driftedState.applyCommits[0].inputRevision = 99;
    drifted.file.replaceContent(JSON.stringify(driftedState));
    await expect(
      drifted.port.readForwardRevisionProposalAuthority(driftedQuery)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeStoreCorruptError);
  });

  it("exposes only pinned authority/review/publish methods and rejects forged ports", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const query = createForwardAuthorityQuery(state);
    const prototype = KnowledgeRuntimeStore.prototype;
    const originalRead = Object.getOwnPropertyDescriptor(
      prototype,
      "readForwardRevisionProposalAuthority"
    );
    if (!originalRead) throw new Error("Expected canonical forward authority read");
    Object.defineProperty(prototype, "readForwardRevisionProposalAuthority", {
      configurable: true,
      value: () => Promise.resolve({ kind: "forged" }),
    });
    try {
      await expect(harness.port.readForwardRevisionProposalAuthority(query)).resolves.toMatchObject(
        { kind: "forward_revision_proposal_authority" }
      );
    } finally {
      Object.defineProperty(prototype, "readForwardRevisionProposalAuthority", originalRead);
    }
    await expect(harness.port.readForwardRevisionReview("personal")).resolves.toMatchObject({
      bundleId: "personal",
    });
    await expect(
      harness.port.publishForwardRevisionProposalAtomically(harness.evidence)
    ).resolves.toMatchObject({ outcome: "published" });

    class ForgedPortSubclass extends KnowledgeRuntimeForwardRevisionProposalPublicationPort {
      /** Deliberately replaces the trusted proposal-authority read. */
      override async readForwardRevisionProposalAuthority() {
        return null;
      }
    }
    const subclass = new ForgedPortSubclass(harness.runtime);
    expect(() => KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(subclass)).toThrow(
      TypeError
    );
    const forged = Object.create(
      KnowledgeRuntimeForwardRevisionProposalPublicationPort.prototype
    ) as unknown;
    expect(() => KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(forged)).toThrow(
      TypeError
    );
    expect(() =>
      KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(new Proxy(harness.port, {}))
    ).toThrow(TypeError);
  });

  it("chains the genuine facade authority read, atomic publication, and Review read", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const query = createForwardAuthorityQuery(state);

    const authority = await harness.port.readForwardRevisionProposalAuthority(query);
    if (!authority) throw new Error("Expected genuine Runtime proposal authority");
    const published = await harness.port.publishForwardRevisionProposalAtomically({
      intent: authority.intent,
      intentDigest: authority.intentDigest,
      historicalReviewAuthority: authority.historicalReviewAuthority,
      selectedContent: harness.evidence.selectedContent,
      selectedContentHash: query.selectedContentHash,
      vaultObservedBeforeHash: query.vaultObservedBeforeHash,
    });
    const review = await harness.port.readForwardRevisionReview("personal");

    expect(published).toMatchObject({ outcome: "published", proposalStoreRevision: 1 });
    expect(review).toMatchObject({
      revision: 1,
      records: [
        {
          proposal: {
            proposalId: published.proposalId,
            request: { intentDigest: authority.intentDigest },
          },
        },
      ],
    });
  });

  it("publishes through genuine production known-output and Runtime capabilities", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const query = createForwardAuthorityQuery(state);
    const currentContent = "# Current forward target\n";
    const targetVisits: unknown[] = [];
    const targetVisitor = createForwardCurrentTargetVisitor(
      query.pagePath,
      currentContent,
      targetVisits
    );
    const knownOutputsDelegate = new KnowledgeProductionKnownAppliedWikiOutputsCoordinator({
      runtime: harness.runtime,
      bundles: [{ bundle: createBundle(), targetVisitor }],
      assertCurrent: () => undefined,
    });
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(knownOutputsDelegate);
    const session = await knownOutputs.inspectKnownOutputs(
      { pagePath: query.pagePath },
      new AbortController().signal
    );
    const selected = session.items.find(
      (item) =>
        item.appliedAt === query.selectedAppliedAt &&
        item.verifiedApplyCount === query.selectedVerifiedApplyCount
    );
    if (!selected) throw new Error("Expected the historical production output selection");

    const coordinator = new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate,
      runtime: harness.port,
      bundles: [{ bundleId: "personal", wikiRoot: "Wiki" }],
      assertCurrent: () => undefined,
    });
    const wrongDelegate = new KnowledgeProductionKnownAppliedWikiOutputsCoordinator({
      runtime: harness.runtime,
      bundles: [{ bundle: createBundle(), targetVisitor }],
      assertCurrent: () => undefined,
    });
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate: wrongDelegate,
          runtime: harness.port,
          bundles: [{ bundleId: "personal", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);

    const copiedSession = JSON.parse(JSON.stringify(session)) as typeof session;
    await expect(
      coordinator.proposeKnownOutput(
        copiedSession,
        selected.outputRef,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    const result = await coordinator.proposeKnownOutput(
      session,
      selected.outputRef,
      new AbortController().signal
    );
    if (result.kind !== "published") throw new Error("Expected one production publication");
    const review = await harness.port.readForwardRevisionReview("personal");

    expect(session).toMatchObject({ currentState: "applied", currentMatch: "current_applied" });
    expect(selected.relation).toBe("earlier_known");
    expect(result.receipt).toMatchObject({ outcome: "published", proposalStoreRevision: 1 });
    expect(review).toMatchObject({
      version: 2,
      revision: 1,
      records: [
        {
          state: "pending",
          proposal: {
            proposalId: result.receipt.proposalId,
            request: { selectedContentHash: query.selectedContentHash },
          },
        },
      ],
    });
    expect(targetVisits.length).toBeGreaterThan(0);
  });
});

describe("KnowledgeRuntimeStore forward revision validation authority", () => {
  /** Creates one validation facade through an authentic Queue execution-proof lifecycle. */
  function createValidationPort(runtime: KnowledgeRuntimeStore): {
    port: KnowledgeRuntimeForwardRevisionValidationPort;
    proofPort: KnowledgeRuntimeIngestExecutionProofPort;
  } {
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
    return {
      port: new KnowledgeRuntimeForwardRevisionValidationPort(runtime, proofPort),
      proofPort,
    };
  }

  /** Publishes one pending proposal and derives its exact validation query. */
  async function publishForValidation(
    harness: Awaited<ReturnType<typeof createForwardPublicationHarness>>,
    evidence: KnowledgeForwardRevisionProposalPublicationEvidence = harness.evidence
  ) {
    const receipt = await harness.port.publishForwardRevisionProposalAtomically(evidence);
    const review = await harness.port.readForwardRevisionReview("personal");
    const pending = review.records[0];
    if (!pending || pending.state !== "pending") throw new Error("Expected pending proposal");
    return {
      receipt,
      pending,
      query: createKnowledgeForwardRevisionValidationAuthorityQuery({
        proposal: pending.proposal,
        proposalDigest: pending.proposalDigest,
      }),
    };
  }

  it("projects exact pending/current/history/citations from one read without writing", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const published = await publishForValidation(harness);
    const { port } = createValidationPort(harness.runtime);
    const before = await harness.file.read();
    const readsBefore = harness.file.getReadCallCount();

    const authority = await port.readForwardRevisionValidationAuthority(published.query);

    expect(authority).toMatchObject({
      query: published.query,
      proposal: { proposalId: published.receipt.proposalId },
      proposalDigest: published.receipt.proposalDigest,
      proposalRecordRevision: 0,
      publishedRuntimeRevision: published.receipt.runtimeRevision,
      proposalStoreRevision: published.receipt.proposalStoreRevision,
      forwardReviewStoreRevision: 1,
      runtimeRevision: published.receipt.runtimeRevision,
      historicalAcceptedDigest:
        published.pending.proposal.request.historicalReviewAuthority.acceptedDigest,
      historicalSourceRefs: ["source-1"],
      historicalCitations: [
        {
          citationId: "citation-source-1",
          locator: { sourceId: "source-1", artifactContentHash: HASH_A },
        },
      ],
      acceptanceAuthority: {
        manifestBaseHash: published.pending.proposal.request.intent.current.manifestBaseHash,
        currentSourceFreshness: { kind: "applied", inputRevision: 2 },
      },
    });
    expect(snapshotKnowledgeForwardRevisionValidationAuthority(authority)).toEqual(authority);
    expect(harness.file.getReadCallCount()).toBe(readsBefore + 1);
    expect(await harness.file.read()).toBe(before);
  });

  it("permits an unrelated Runtime advance while keeping the proposal-time tuple exact", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const published = await publishForValidation(harness);
    const { port } = createValidationPort(harness.runtime);
    const before = await port.readForwardRevisionValidationAuthority(published.query);
    if (!before) throw new Error("Expected initial validation authority");

    await new KnowledgeRuntimeQueueStorage(harness.runtime).write(
      "unrelated",
      createQueueSnapshot(1, "unrelated"),
      null
    );
    const after = await port.readForwardRevisionValidationAuthority(published.query);

    expect(after).not.toBeNull();
    expect(after?.runtimeRevision).toBe(before.runtimeRevision + 1);
    expect(after?.runtimeDigest).not.toBe(before.runtimeDigest);
    expect(after?.acceptanceAuthority.manifestDigest).toBe(
      before.acceptanceAuthority.manifestDigest
    );
    expect(after?.acceptanceAuthority.currentSourceFreshness.completedAt).toBe(
      before.acceptanceAuthority.currentSourceFreshness.completedAt
    );
  });

  it("returns null for identity staleness and decision-time Manifest/source tuple drift", async () => {
    const identity = await createForwardPublicationHarness(() => 500);
    const published = await publishForValidation(identity);
    const { port: identityPort } = createValidationPort(identity.runtime);
    for (const stale of [
      { ...published.query, proposalDigest: HASH_C },
      { ...published.query, requestDigest: HASH_C },
      { ...published.query, intentDigest: HASH_C },
    ]) {
      await expect(identityPort.readForwardRevisionValidationAuthority(stale)).resolves.toBeNull();
    }

    const drifted = await createForwardPublicationHarness(() => 500);
    const driftedPublished = await publishForValidation(drifted);
    await commitForwardNoChanges(drifted, HASH_C);
    await expect(
      createValidationPort(drifted.runtime).port.readForwardRevisionValidationAuthority(
        driftedPublished.query
      )
    ).resolves.toBeNull();
  });

  it("accepts latest same-input no-changes freshness and retains historical citations", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    await commitForwardNoChanges(harness, HASH_A);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const published = await publishForValidation(harness, createForwardPublicationEvidence(state));
    const authority = await createValidationPort(
      harness.runtime
    ).port.readForwardRevisionValidationAuthority(published.query);

    expect(authority).toMatchObject({
      historicalCitations: [{ citationId: "citation-source-1" }],
      acceptanceAuthority: {
        currentSourceFreshness: {
          kind: "no_changes",
          inputRevision: 3,
          attempt: 1,
        },
      },
    });
  });

  it("shares one pinned Runtime call graph in both facade construction orders", async () => {
    let firstValidation: KnowledgeRuntimeForwardRevisionValidationPort | undefined;
    const first = await createForwardPublicationHarness(
      () => 500,
      (runtime) => {
        firstValidation = createValidationPort(runtime).port;
        return new KnowledgeRuntimeForwardRevisionProposalPublicationPort(runtime);
      }
    );
    if (!firstValidation) throw new Error("Expected validation-first facade");
    KnowledgeRuntimeForwardRevisionValidationPort.assert(firstValidation);
    const firstPublished = await publishForValidation(first);
    await expect(
      firstValidation.readForwardRevisionValidationAuthority(firstPublished.query)
    ).resolves.toMatchObject({ proposalDigest: firstPublished.pending.proposalDigest });

    const second = await createForwardPublicationHarness(() => 500);
    const { port: secondValidation } = createValidationPort(second.runtime);
    KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(second.port);
    KnowledgeRuntimeForwardRevisionValidationPort.assert(secondValidation);
    const secondPublished = await publishForValidation(second);
    await expect(
      secondValidation.readForwardRevisionValidationAuthority(secondPublished.query)
    ).resolves.toMatchObject({ proposalDigest: secondPublished.pending.proposalDigest });
  });

  it("keeps same-Runtime validation facades isolated by exact execution owner", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const first = createValidationPort(harness.runtime);
    const second = createValidationPort(harness.runtime);
    const firstOwner = KnowledgeRuntimeIngestExecutionProofPort.getExecutionOwner(first.proofPort);
    const secondOwner = KnowledgeRuntimeIngestExecutionProofPort.getExecutionOwner(
      second.proofPort
    );

    expect(
      KnowledgeRuntimeForwardRevisionValidationPort.matchesExecutionOwner(first.port, firstOwner)
    ).toBe(true);
    expect(
      KnowledgeRuntimeForwardRevisionValidationPort.matchesExecutionOwner(first.port, secondOwner)
    ).toBe(false);
    expect(
      KnowledgeRuntimeForwardRevisionValidationPort.matchesExecutionOwner(second.port, firstOwner)
    ).toBe(false);
    expect(
      KnowledgeRuntimeForwardRevisionValidationPort.matchesExecutionOwner(
        new Proxy(first.port, {}),
        firstOwner
      )
    ).toBe(false);
  });

  it("pins the canonical read and rejects own tampering, subclasses, proxies, and forgeries", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const published = await publishForValidation(harness);
    const { port, proofPort } = createValidationPort(harness.runtime);
    const prototype = KnowledgeRuntimeStore.prototype;
    const original = Object.getOwnPropertyDescriptor(
      prototype,
      "readForwardRevisionValidationAuthority"
    );
    if (!original) throw new Error("Expected canonical validation read");
    Object.defineProperty(prototype, "readForwardRevisionValidationAuthority", {
      configurable: true,
      value: () => Promise.resolve({ kind: "forged" }),
    });
    try {
      await expect(
        port.readForwardRevisionValidationAuthority(published.query)
      ).resolves.toMatchObject({ kind: "forward_revision_validation_authority" });
    } finally {
      Object.defineProperty(prototype, "readForwardRevisionValidationAuthority", original);
    }

    const tampered = new KnowledgeRuntimeStore(harness.file, { clock: () => 500 });
    Object.defineProperty(tampered, "readForwardRevisionValidationAuthority", {
      configurable: true,
      value: () => Promise.resolve(null),
    });
    expect(() => new KnowledgeRuntimeForwardRevisionValidationPort(tampered, proofPort)).toThrow(
      TypeError
    );
    class RuntimeSubclass extends KnowledgeRuntimeStore {}
    const subclass = new RuntimeSubclass(harness.file);
    const subclassQueue = new KnowledgeRuntimeQueueStorage(subclass);
    const subclassProof = new KnowledgeRuntimeIngestExecutionProofPort(subclass, subclassQueue);
    expect(
      () => new KnowledgeRuntimeForwardRevisionValidationPort(subclass, subclassProof)
    ).toThrow(TypeError);
    const proxiedRuntime = new Proxy(harness.runtime, {});
    expect(
      () => new KnowledgeRuntimeForwardRevisionValidationPort(proxiedRuntime, proofPort)
    ).toThrow(TypeError);

    class PortSubclass extends KnowledgeRuntimeForwardRevisionValidationPort {}
    expect(() =>
      KnowledgeRuntimeForwardRevisionValidationPort.assert(
        new PortSubclass(harness.runtime, proofPort)
      )
    ).toThrow(TypeError);
    expect(() =>
      KnowledgeRuntimeForwardRevisionValidationPort.assert(
        Object.create(KnowledgeRuntimeForwardRevisionValidationPort.prototype)
      )
    ).toThrow(TypeError);
    expect(() => KnowledgeRuntimeForwardRevisionValidationPort.assert(new Proxy(port, {}))).toThrow(
      TypeError
    );
  });
});

describe("KnowledgeRuntimeStore forward revision atomic decision", () => {
  /** Publishes and returns the sole strict pending proposal for one decision test. */
  async function createPendingDecisionFixture() {
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();
    const harness = await createForwardPublicationHarness(() => 500, undefined, {
      productionExecutionClaim: pairing.runtimeClaim,
    });
    await harness.port.publishForwardRevisionProposalAtomically(harness.evidence);
    const review = await harness.port.readForwardRevisionReview("personal");
    const pending = review.records[0];
    if (!pending || pending.state !== "pending") throw new Error("Expected pending proposal");
    const decision = await createPairedForwardDecisionPort(harness.runtime, pairing.preflightClaim);
    return { ...harness, ...decision, pending };
  }

  it("requires genuine one-shot mutation authority and atomically rejects only the target slot", async () => {
    const fixture = await createPendingDecisionFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    const beforeText = await fixture.file.read();
    const before = JSON.parse(beforeText) as KnowledgeRuntimeStoreSnapshot;
    let personalHints = 0;
    let workHints = 0;
    fixture.runtime.subscribeStudioBundle("personal", () => {
      personalHints += 1;
    });
    fixture.runtime.subscribeStudioBundle("work", () => {
      workHints += 1;
    });

    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          fixture.runtime.decideForwardRevisionAtomically(command)
        )
      )
    ).toBe("dependency_invalid");
    expect(await fixture.file.read()).toBe(beforeText);

    await expect(
      fixture.port.readPending(command, new AbortController().signal)
    ).resolves.toMatchObject({
      kind: "pending",
      proposalDigest: fixture.pending.proposalDigest,
    });
    const decided = await fixture.port.decide({ command }, new AbortController().signal);
    const after = JSON.parse(await fixture.file.read()) as KnowledgeRuntimeStoreSnapshot;

    expect(decided).toMatchObject({
      kind: "rejected",
      outcome: "decided",
      runtimeRevision: before.revision + 1,
      decisionStoreRevision: 2,
      decision: { state: "rejected", rejectedAt: 500 },
    });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.forwardRevisionReviews[0]?.value).toMatchObject({
      revision: 2,
      records: [{ state: "rejected", decidedRuntimeRevision: before.revision + 1 }],
    });
    expect(personalHints).toBe(1);
    expect(workHints).toBe(0);
    for (const key of [
      "queues",
      "reviews",
      "manifests",
      "activeTransaction",
      "inputRevisions",
      "applyCommits",
    ] as const) {
      expect(after[key]).toEqual(before[key]);
    }

    await new KnowledgeRuntimeQueueStorage(fixture.runtime).write(
      "unrelated",
      createQueueSnapshot(1, "unrelated"),
      null
    );
    const replay = await fixture.port.decide({ command }, new AbortController().signal);
    expect(replay).toEqual({ ...decided, outcome: "already_decided" });
    expect(personalHints).toBe(1);
    expect(workHints).toBe(0);
    await expect(fixture.port.readPending(command, new AbortController().signal)).resolves.toEqual({
      kind: "terminal",
      result: replay,
    });

    const conflicting = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          fixture.port.decide({ command: conflicting }, new AbortController().signal)
        )
      )
    ).toBe("conflict");
    fixture.lifecycle.close();
  });

  it("confirms a commit-then-throw result and fails closed after lease revocation or overflow", async () => {
    const committed = await createPendingDecisionFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: committed.pending.proposal,
      proposalDigest: committed.pending.proposalDigest,
    });
    committed.file.throwAfterCommitOnNextWrite();

    await expect(
      committed.port.decide({ command }, new AbortController().signal)
    ).resolves.toMatchObject({ kind: "rejected", outcome: "already_decided" });
    committed.lifecycle.close();

    const revoked = await createPendingDecisionFixture();
    const revokedCommand = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: revoked.pending.proposal,
      proposalDigest: revoked.pending.proposalDigest,
    });
    const revokedBefore = await revoked.file.read();
    revoked.lifecycle.invalidate();
    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          revoked.port.decide({ command: revokedCommand }, new AbortController().signal)
        )
      )
    ).toBe("aborted");
    expect(await revoked.file.read()).toBe(revokedBefore);

    const overflow = await createPendingDecisionFixture();
    const overflowCommand = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: overflow.pending.proposal,
      proposalDigest: overflow.pending.proposalDigest,
    });
    const overflowState = JSON.parse(await overflow.file.read()) as KnowledgeRuntimeStoreSnapshot;
    overflowState.revision = Number.MAX_SAFE_INTEGER;
    overflow.file.replaceContent(JSON.stringify(overflowState));
    const overflowBefore = await overflow.file.read();
    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          overflow.port.decide({ command: overflowCommand }, new AbortController().signal)
        )
      )
    ).toBe("resource_limit");
    expect(await overflow.file.read()).toBe(overflowBefore);
    overflow.lifecycle.close();
  });

  it("accepts through the genuine paired validator and atomically mints the durable Apply claim", async () => {
    const fixture = await createForwardDecisionCoordinatorFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    await new KnowledgeRuntimeQueueStorage(fixture.runtime).write(
      "unrelated",
      createQueueSnapshot(1, "unrelated"),
      null
    );
    const beforeText = await fixture.file.read();
    const before = JSON.parse(beforeText) as KnowledgeRuntimeStoreSnapshot;

    const accepted = await fixture.coordinator.decide(command, new AbortController().signal);
    if (accepted.kind !== "accepted") throw new Error("Expected accepted forward decision");
    const afterText = await fixture.file.read();
    const after = JSON.parse(afterText) as KnowledgeRuntimeStoreSnapshot;

    expect(accepted).toMatchObject({
      kind: "accepted",
      outcome: "decided",
      proposalId: fixture.pending.proposal.proposalId,
      commandId: command.commandId,
      runtimeRevision: before.revision + 1,
      decisionStoreRevision: 2,
    });
    expect(Reflect.ownKeys(accepted)).toEqual([
      "kind",
      "outcome",
      "proposalId",
      "commandId",
      "decisionDigest",
      "runtimeRevision",
      "decisionStoreRevision",
    ]);
    const terminal = after.forwardRevisionReviews[0]?.value as {
      revision: number;
      records: Array<{
        state: string;
        decidedRuntimeRevision: number;
        decisionStoreRevision: number;
        decision: {
          state: string;
          afterContent: string;
          acceptedDecisionDigest: string;
          validationReceipt: { commandId: string; receiptId: string };
          validationReceiptDigest: string;
          applyClaim: {
            acceptedDecisionDigest: string;
            validationReceiptId: string;
            validationReceiptDigest: string;
            runtimeRevision: number;
          };
        };
      }>;
    };
    const record = terminal.records[0];
    expect(terminal.revision).toBe(2);
    expect(record).toMatchObject({
      state: "accepted",
      decidedRuntimeRevision: before.revision + 1,
      decisionStoreRevision: 2,
      decision: {
        state: "accepted",
        afterContent: FORWARD_DECISION_HISTORICAL_CONTENT,
        validationReceipt: { commandId: command.commandId },
      },
    });
    expect(record.decision.applyClaim).toMatchObject({
      acceptedDecisionDigest: record.decision.acceptedDecisionDigest,
      validationReceiptId: record.decision.validationReceipt.receiptId,
      validationReceiptDigest: record.decision.validationReceiptDigest,
      runtimeRevision: before.revision,
    });
    const {
      revision: _beforeRevision,
      forwardRevisionReviews: _beforeForward,
      ...beforeIsolated
    } = before;
    const {
      revision: _afterRevision,
      forwardRevisionReviews: _afterForward,
      ...afterIsolated
    } = after;
    void _beforeRevision;
    void _beforeForward;
    void _afterRevision;
    void _afterForward;
    expect(afterIsolated).toEqual(beforeIsolated);

    const replay = await fixture.coordinator.decide(command, new AbortController().signal);
    expect(replay).toEqual({ ...accepted, outcome: "already_decided" });
    expect(await fixture.file.read()).toBe(afterText);

    fixture.lifecycle.invalidate();
    const restarted = await fixture.lifecycle.load(new AbortController().signal);
    if (restarted.kind !== "configured") throw new Error("Expected restarted preflight");
    const restartedOwner = KnowledgePluginProductionWorkflowLease.consumeCompositionClaim(
      restarted.admission.workflowLease,
      restarted.admission.workflowCompositionClaim
    );
    const restartedQueue = new KnowledgeRuntimeQueueStorage(fixture.runtime, restartedOwner);
    const restartedProof = new KnowledgeRuntimeIngestExecutionProofPort(
      fixture.runtime,
      restartedQueue
    );
    const restartedPort = new KnowledgeRuntimeForwardRevisionDecisionPort(
      fixture.runtime,
      restartedProof,
      KnowledgePluginProductionWorkflowLease.getExecutionLease(
        restarted.admission.workflowLease,
        restartedOwner
      )
    );
    await expect(
      restartedPort.decide({ command }, new AbortController().signal)
    ).resolves.toMatchObject({
      kind: "accepted",
      outcome: "already_decided",
      decisionDigest: accepted.decisionDigest,
      runtimeRevision: accepted.runtimeRevision,
      decisionStoreRevision: accepted.decisionStoreRevision,
      decision: {
        state: "accepted",
        proposal: { proposalId: fixture.pending.proposal.proposalId },
      },
    });
    expect(await fixture.file.read()).toBe(afterText);
    fixture.lifecycle.close();
  });

  it("returns edited no_change without terminalizing or writing Runtime bytes", async () => {
    const fixture = await createForwardDecisionCoordinatorFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
      afterContent: FORWARD_DECISION_CURRENT_CONTENT,
    });
    const beforeText = await fixture.file.read();
    let hints = 0;
    fixture.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });

    await expect(
      fixture.coordinator.decide(command, new AbortController().signal)
    ).resolves.toEqual({
      kind: "no_change",
      proposalId: fixture.pending.proposal.proposalId,
      commandId: command.commandId,
      contentHash: createFileContentHash(FORWARD_DECISION_CURRENT_CONTENT),
    });
    expect(await fixture.file.read()).toBe(beforeText);
    expect(hints).toBe(0);
    await expect(fixture.runtime.readForwardRevisionReview("personal")).resolves.toMatchObject({
      revision: 1,
      records: [{ state: "pending" }],
    });
    fixture.lifecycle.close();
  });

  it("revokes the genuine coordinator generation before validation with zero Runtime writes", async () => {
    const fixture = await createForwardDecisionCoordinatorFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    const beforeText = await fixture.file.read();
    fixture.lifecycle.close();

    await expect(
      fixture.coordinator.decide(command, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await fixture.file.read()).toBe(beforeText);
  });

  it("rechecks the genuine validation capability after a pre-transform lease revocation", async () => {
    const fixture = await createForwardDecisionCoordinatorFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    const beforeText = await fixture.file.read();
    fixture.file.runBeforeNextTransform(() => fixture.lifecycle.close());

    await expect(
      fixture.coordinator.decide(command, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await fixture.file.read()).toBe(beforeText);
  });

  it("confirms an accepted commit after its lease closes before transport failure", async () => {
    const fixture = await createForwardDecisionCoordinatorFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    const before = JSON.parse(await fixture.file.read()) as KnowledgeRuntimeStoreSnapshot;
    fixture.file.runAfterNextCommit(() => fixture.lifecycle.close());
    fixture.file.throwAfterCommitOnNextWrite();

    await expect(
      fixture.coordinator.decide(command, new AbortController().signal)
    ).resolves.toMatchObject({
      kind: "accepted",
      outcome: "already_decided",
      proposalId: fixture.pending.proposal.proposalId,
      commandId: command.commandId,
      runtimeRevision: before.revision + 1,
      decisionStoreRevision: 2,
    });
    await expect(fixture.runtime.readForwardRevisionReview("personal")).resolves.toMatchObject({
      revision: 2,
      records: [
        {
          state: "accepted",
          decidedRuntimeRevision: before.revision + 1,
          decisionStoreRevision: 2,
        },
      ],
    });
  });

  it("rejects a genuine cross-pair execution lease before creating any mutation port", async () => {
    const runtimePairing = createKnowledgeProductionWorkflowExecutionPairing();
    const harness = await createForwardPublicationHarness(() => 500, undefined, {
      productionExecutionClaim: runtimePairing.runtimeClaim,
    });
    const otherPairing = createKnowledgeProductionWorkflowExecutionPairing();
    const other = await createForwardDecisionExecutionLease(otherPairing.preflightClaim);
    const queue = new KnowledgeRuntimeQueueStorage(harness.runtime, other.executionOwner);
    const proof = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, queue);
    const beforeText = await harness.file.read();
    const runtimeOwnValues = Reflect.ownKeys(harness.runtime).map(
      (key) => Object.getOwnPropertyDescriptor(harness.runtime, key)?.value as unknown
    );

    expect(runtimeOwnValues).not.toContain(runtimePairing.runtimeClaim);
    expect(runtimeOwnValues).not.toContain(runtimePairing.preflightClaim);
    expect(runtimeOwnValues).not.toContain(otherPairing.runtimeClaim);
    expect(runtimeOwnValues).not.toContain(otherPairing.preflightClaim);

    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        (() => {
          try {
            new KnowledgeRuntimeForwardRevisionDecisionPort(
              harness.runtime,
              proof,
              other.executionLease
            );
          } catch (error: unknown) {
            return error;
          }
          throw new Error("Expected the cross-pair decision port to reject");
        })()
      )
    ).toBe("dependency_invalid");
    expect(await harness.file.read()).toBe(beforeText);
    other.lifecycle.close();
  });

  it("rejects a genuine lease against an unpaired Runtime without changing bytes", async () => {
    const harness = await createForwardPublicationHarness(() => 500);
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();
    const execution = await createForwardDecisionExecutionLease(pairing.preflightClaim);
    const queue = new KnowledgeRuntimeQueueStorage(harness.runtime, execution.executionOwner);
    const proof = new KnowledgeRuntimeIngestExecutionProofPort(harness.runtime, queue);
    const beforeText = await harness.file.read();

    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        (() => {
          try {
            new KnowledgeRuntimeForwardRevisionDecisionPort(
              harness.runtime,
              proof,
              execution.executionLease
            );
          } catch (error: unknown) {
            return error;
          }
          throw new Error("Expected the unpaired Runtime decision port to reject");
        })()
      )
    ).toBe("dependency_invalid");
    expect(await harness.file.read()).toBe(beforeText);
    execution.lifecycle.close();
  });

  it("normalizes a revoked decision-port receiver without reading or writing Runtime bytes", async () => {
    const fixture = await createPendingDecisionFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: fixture.pending.proposal,
      proposalDigest: fixture.pending.proposalDigest,
    });
    const beforeText = await fixture.file.read();
    const readsBefore = fixture.file.getReadCallCount();
    const revoked = Proxy.revocable(fixture.port, {});
    revoked.revoke();

    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          Reflect.apply(
            KnowledgeRuntimeForwardRevisionDecisionPort.prototype.readPending,
            revoked.proxy,
            [command, new AbortController().signal]
          )
        )
      )
    ).toBe("dependency_invalid");
    expect(
      KnowledgeForwardRevisionDecisionPortError.inspect(
        await captureForwardDecisionRejection(
          Reflect.apply(
            KnowledgeRuntimeForwardRevisionDecisionPort.prototype.decide,
            revoked.proxy,
            [{ command }, new AbortController().signal]
          )
        )
      )
    ).toBe("dependency_invalid");
    expect(fixture.file.getReadCallCount()).toBe(readsBefore);
    expect(await fixture.file.read()).toBe(beforeText);
    fixture.lifecycle.close();
  });
});

describe("KnowledgeRuntimeStore source retirement", () => {
  it("migrates runtime v4 through the v5, v6, and v7 downgrade fences", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const current = createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    const { forwardRevisionReviews: _forwardRevisionReviews, ...previousV4 } = current;
    void _forwardRevisionReviews;
    await file.initialize(
      JSON.stringify({
        ...previousV4,
        version: 4,
        revision: 7,
      })
    );

    await new KnowledgeRuntimeStore(file).initialize();

    expect(JSON.parse(await file.read())).toEqual({
      ...current,
      version: KNOWLEDGE_RUNTIME_STORE_VERSION,
      revision: 10,
    });
  });

  it("rejects a runtime-v4 envelope carrying reserved source-retirement state", async () => {
    const file = new MemoryAtomicRuntimeFile();
    const manifest = createRegisteredManifest();
    const retiredManifest = projectKnowledgeSourceRetirement(
      manifest,
      createKnowledgeSourceRetirementRecord({
        bundleId: "personal",
        requestToken: HASH_A,
        reason: "user_requested",
        retiredAt: 100,
        retiredManifestRevision: 2,
        source: manifest.entries[0],
      })
    );
    const { forwardRevisionReviews: _forwardRevisionReviews, ...previousV4 } =
      createEmptyKnowledgeRuntimeStoreSnapshot("1".repeat(32));
    void _forwardRevisionReviews;
    await file.initialize(
      JSON.stringify({
        ...previousV4,
        version: 4,
        revision: 7,
        manifests: [{ bundleId: "personal", value: retiredManifest }],
      })
    );
    const before = await file.read();

    await expect(new KnowledgeRuntimeStore(file).initialize()).rejects.toMatchObject({
      name: KnowledgeRuntimeMigrationUnsafeError.name,
      reason: "source_retirement_state_present",
      bundleId: "personal",
    });
    expect(await file.read()).toBe(before);
  });

  it("projects one token-bound source and retires it without changing adjacent histories", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const beforeGenericRemoval = await harness.file.read();
    await expect(
      new SourceManifestRepository(harness.manifest).removeSource("personal", "source-1")
    ).rejects.toMatchObject({
      name: KnowledgeRuntimeManifestProtectedStateError.name,
      state: "source_identity",
    });
    expect(await harness.file.read()).toBe(beforeGenericRemoval);

    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    expect(projection).toMatchObject({
      bundleId: "personal",
      manifestRevision: 1,
      candidates: [
        {
          sourceId: "source-1",
          sourcePath: "Sources/Source-1.md",
          custody: "user_managed",
          generatedPageCount: 0,
          status: "ready",
          blockers: [],
        },
      ],
    });
    const candidate = projection.candidates[0];
    const command = {
      version: 1 as const,
      bundleId: "personal",
      sourceId: "source-1",
      expectedToken: candidate.expectedToken,
      reason: "user_requested" as const,
      confirm: {
        keepWikiFiles: true as const,
        revokeProvenance: true as const,
        reserveIdentity: true as const,
      },
    };
    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const beforeManifest = before.manifests[0].value as SourceManifest;
    let hints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });

    await expect(harness.runtime.retireSourceAtomically(command)).resolves.toMatchObject({
      outcome: "retired",
      bundleId: "personal",
      sourceId: "source-1",
      sourcePath: "Sources/Source-1.md",
      manifestRevision: 2,
      runtimeRevision: before.revision + 1,
      generatedPages: [],
    });
    const committedText = await harness.file.read();
    const committed = JSON.parse(committedText) as KnowledgeRuntimeStoreSnapshot;
    const retiredManifest = committed.manifests[0].value as SourceManifest;
    const retirements = parseKnowledgeSourceRetirements(retiredManifest);
    expect(retiredManifest.entries).toEqual([]);
    expect(retirements).toMatchObject({
      ok: true,
      value: [{ source: beforeManifest.entries[0] }],
    });
    expect({
      queues: committed.queues,
      reviews: committed.reviews,
      inputRevisions: committed.inputRevisions,
      applyCommits: committed.applyCommits,
    }).toEqual({
      queues: before.queues,
      reviews: before.reviews,
      inputRevisions: before.inputRevisions,
      applyCommits: before.applyCommits,
    });
    expect((await harness.runtime.readAppliedProvenance("personal")).pages).toEqual([]);
    await expect(harness.runtime.retireSourceAtomically(command)).resolves.toMatchObject({
      outcome: "already_retired",
      runtimeRevision: committed.revision,
    });
    expect(await harness.file.read()).toBe(committedText);
    expect(hints).toBe(1);
    await expect(
      harness.revisions.allocate({
        bundleId: "personal",
        sourceId: "source-1",
        captureId: "capture-after-retirement",
      })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);
  });

  it("rejects a stale retirement token after an unrelated atomic Runtime commit", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    await harness.queue.write("other", createQueueSnapshot(1, "other"), null);
    const before = await harness.file.read();

    await expect(
      harness.runtime.retireSourceAtomically({
        version: 1,
        bundleId: "personal",
        sourceId: "source-1",
        expectedToken: projection.candidates[0].expectedToken,
        reason: "user_requested",
        confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
      })
    ).rejects.toMatchObject({
      name: KnowledgeSourceRetirementConflictError.name,
      reason: "state_changed",
    });
    expect(await harness.file.read()).toBe(before);
  });

  it("serializes retirement against a concurrent generic Manifest rename", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    const repository = new SourceManifestRepository(harness.manifest);

    const results = await Promise.allSettled([
      harness.runtime.retireSourceAtomically({
        version: 1,
        bundleId: "personal",
        sourceId: "source-1",
        expectedToken: projection.candidates[0].expectedToken,
        reason: "user_requested",
        confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
      }),
      repository.renameSource("personal", "source-1", "Sources/Renamed.md"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const manifest = state.manifests[0].value as SourceManifest;
    const retirements = parseKnowledgeSourceRetirements(manifest);
    expect(retirements.ok).toBe(true);
    if (!retirements.ok) throw new Error("Expected strict source retirement history");
    const isRetired = retirements.value.length === 1;
    expect(isRetired ? manifest.entries.length : retirements.value.length).toBe(0);
    if (!isRetired) {
      expect(manifest.entries[0].sourcePath).toBe("Sources/Renamed.md");
    }
  });

  it("confirms the exact retirement after the atomic file commits and reports failure", async () => {
    const harness = await createHarness();
    await harness.manifest.write("personal", createRegisteredManifest(), null);
    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    let hints = 0;
    harness.runtime.subscribeStudioBundle("personal", () => {
      hints += 1;
    });
    harness.file.throwAfterCommitOnNextWrite();

    const command = {
      version: 1 as const,
      bundleId: "personal",
      sourceId: "source-1",
      expectedToken: projection.candidates[0].expectedToken,
      reason: "user_requested" as const,
      confirm: {
        keepWikiFiles: true as const,
        revokeProvenance: true as const,
        reserveIdentity: true as const,
      },
    };
    const receipt = await harness.runtime.retireSourceAtomically(command);
    expect(receipt).toMatchObject({ outcome: "already_retired", runtimeRevision: 2 });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const retiredManifest = state.manifests[0].value as SourceManifest;
    expect(retiredManifest.entries).toEqual([]);
    expect(parseKnowledgeSourceRetirements(retiredManifest)).toMatchObject({
      ok: true,
      value: [{ requestToken: projection.candidates[0].expectedToken }],
    });
    const committed = await harness.file.read();
    await expect(harness.runtime.retireSourceAtomically(command)).resolves.toEqual(receipt);
    expect(await harness.file.read()).toBe(committed);
    expect(hints).toBe(1);
  });

  it("atomically terminalizes only the retired source observation and rejects late work", async () => {
    const harness = await createHarness();
    const manifest = createRegisteredManifest();
    manifest.entries.push({
      sourceId: "source-2",
      sourceKey: "sources/source-2.md",
      sourcePath: "Sources/Source-2.md",
      custody: "user_managed",
    });
    await harness.manifest.write("personal", manifest, null);
    const allocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-1",
      captureId: "capture-pending-at-retirement",
    });
    await harness.observations.bind({
      observationToken: allocation.observationToken,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
    });
    const otherAllocation = await harness.revisions.allocate({
      bundleId: "personal",
      sourceId: "source-2",
      captureId: "capture-other-source",
    });
    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    const candidate = projection.candidates.find((entry) => entry.sourceId === "source-1");
    if (!candidate) throw new Error("Expected the target source retirement candidate");
    expect(candidate).toMatchObject({ status: "ready", blockers: [] });

    await expect(
      harness.runtime.retireSourceAtomically({
        version: 1,
        bundleId: "personal",
        sourceId: "source-1",
        expectedToken: candidate.expectedToken,
        reason: "source_missing",
        confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
      })
    ).resolves.toMatchObject({ outcome: "retired" });
    const state = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const retiredManifest = state.manifests[0].value as SourceManifest;
    const retirements = parseKnowledgeSourceRetirements(retiredManifest);
    if (!retirements.ok) throw new Error("Expected strict source retirement history");
    const targetSource = state.inputRevisions[0].sources.find(
      (source) => source.sourceId === "source-1"
    );
    const otherSource = state.inputRevisions[0].sources.find(
      (source) => source.sourceId === "source-2"
    );
    const observation = targetSource?.observations[0] as unknown as {
      status: string;
      retirementId: string;
      sourceContentHash: string;
      pipelineFingerprint: string;
    };
    expect(observation.status).toBe("retired");
    expect(observation.retirementId).toBe(retirements.value[0].retirementId);
    expect(observation.sourceContentHash).toBe(HASH_A);
    expect(observation.pipelineFingerprint).toBe(HASH_B);
    expect(otherSource?.observations).toHaveLength(1);
    expect(otherSource?.observations[0].observationToken).toBe(otherAllocation.observationToken);
    expect(otherSource?.observations[0].captureId).toBe("capture-other-source");
    expect(otherSource?.observations[0].inputRevision).toBe(1);
    expect(otherSource?.observations[0].status).toBe("allocated");
    await expect(
      harness.observations.bind({
        observationToken: allocation.observationToken,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
      })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);
    await expect(
      harness.runtime.settleInputObservation(allocation.observationToken)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);

    const lateQueue: IngestQueueSnapshot = {
      ...createQueueSnapshot(1),
      jobs: [
        {
          id: "job-late-retired-source",
          bundleId: "personal",
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 1,
          attempt: 0,
          rerunRequested: false,
          createdAt: 100,
          updatedAt: 100,
          status: "pending",
          stage: "queued",
        },
      ],
      sourceHighWatermarks: [
        {
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 1,
          observedAt: 100,
        },
      ],
    };
    await expect(
      harness.queue.write("personal", lateQueue, null, {
        kind: "source_observation",
        observationToken: allocation.observationToken,
      })
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);

    await expect(
      harness.observations.bind({
        observationToken: otherAllocation.observationToken,
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
      })
    ).resolves.toMatchObject({ kind: "ready" });
    const activeQueue: IngestQueueSnapshot = {
      ...createQueueSnapshot(1),
      jobs: [
        {
          ...lateQueue.jobs[0],
          id: "job-active-other-source",
          sourceId: "source-2",
          sourceContentHash: HASH_C,
        },
      ],
      sourceHighWatermarks: [
        {
          sourceId: "source-2",
          sourceContentHash: HASH_C,
          pipelineFingerprint: HASH_B,
          inputRevision: 1,
          observedAt: 101,
        },
      ],
    };
    await expect(
      harness.queue.write("personal", activeQueue, null, {
        kind: "source_observation",
        observationToken: otherAllocation.observationToken,
      })
    ).resolves.toBeUndefined();
  });

  it("archives an applied source while retaining its accepted Review and Apply ledger", async () => {
    const manifest = createRegisteredManifest();
    const proof = createCommittedApplyProof(manifest, "transaction-retirement-history", 1, [
      createSourceCitation(),
    ]);
    const harness = await createApplyHarness(manifest, proof);
    await harness.port.recordCommitted(harness.journal, harness.receipt);
    const recoveryQueue = new IngestQueue(
      new KnowledgeRuntimeQueueStorage(harness.runtime),
      {
        /** Recovery does not execute new source work. */
        execute: async () => ({ kind: "no_changes", changeSetId: "changeset-unused" }),
      },
      { clock: () => 250, jobIdFactory: () => "job-unused-after-retirement" }
    );
    await recoveryQueue.resolveApplyRecovery(harness.receipt);
    await new KnowledgeRuntimeTransactionStorage(harness.runtime).clearActive({
      transactionId: harness.journal.transactionId,
      revision: harness.journal.revision,
    });
    await recoveryQueue.finalizeApplyRecovery("personal", harness.receipt.transactionId);
    await new KnowledgeRuntimeStartupReleasePort(harness.runtime).release(
      await createStartupReleaseRequest(harness)
    );
    const before = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const projection = await harness.runtime.readSourceRetirementCandidates("personal");
    expect(projection.candidates[0]).toMatchObject({
      status: "ready",
      generatedPageCount: 1,
    });

    await harness.runtime.retireSourceAtomically({
      version: 1,
      bundleId: "personal",
      sourceId: "source-1",
      expectedToken: projection.candidates[0].expectedToken,
      reason: "user_requested",
      confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
    });

    const after = JSON.parse(await harness.file.read()) as KnowledgeRuntimeStoreSnapshot;
    const afterManifest = after.manifests[0].value as SourceManifest;
    const retirements = parseKnowledgeSourceRetirements(afterManifest);
    expect(after.applyCommits).toEqual(before.applyCommits);
    expect(after.queues).toEqual(before.queues);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.inputRevisions).toEqual(before.inputRevisions);
    expect(retirements.ok).toBe(true);
    if (!retirements.ok) throw new Error("Expected strict source retirement history");
    expect(retirements.value[0].source.sourceId).toBe("source-1");
    expect(retirements.value[0].source.lastSuccessful?.generatedPages).toEqual(
      harness.journal.manifestCommitIntent.generatedPages
    );
    expect((await harness.runtime.readAppliedProvenance("personal")).pages).toEqual([]);

    const queue = (await new KnowledgeRuntimeQueueStorage(harness.runtime).read(
      "personal"
    )) as IngestQueueSnapshot;
    const changedQueue: IngestQueueSnapshot = {
      ...queue,
      revision: queue.revision + 1,
      jobs: queue.jobs.map((job) => ({
        ...job,
        updatedAt: job.updatedAt + 1,
        ...(job.status === "completed" ? { completedAt: job.completedAt + 1 } : {}),
      })),
    };
    await expect(
      new KnowledgeRuntimeQueueStorage(harness.runtime).write(
        "personal",
        changedQueue,
        queue.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);

    const review = (await new KnowledgeRuntimeReviewStorage(harness.runtime).read(
      "personal"
    )) as ChangeSetReviewSnapshot;
    await expect(
      new KnowledgeRuntimeReviewStorage(harness.runtime).write(
        "personal",
        { ...review, revision: review.revision + 1, records: [] },
        review.revision
      )
    ).rejects.toBeInstanceOf(KnowledgeRuntimeSourceRetiredError);
  });
});
