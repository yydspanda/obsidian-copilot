import { z } from "zod";

import {
  createTransactionCommitReceipt,
  createTransactionCommitReceiptDigest,
  transactionCommitReceiptMatchesJournal,
  type ChangeSetTransactionApplyInput,
  type ChangeSetTransactionAuthorityPort,
  type ChangeSetTransactionAuthorityRequest,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type {
  ApplyCommitManifestPort,
  CommittedChangeSetTransactionJournal,
} from "@/knowledge/changeset/ApplyCommitCoordinator";
import { deriveKnowledgeSourceCompileAuthority } from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  TransactionStorageRevisionConflictError,
  TransactionStorageAuthorityError,
  createChangeSetTransactionDigest,
  createChangeSetTransactionJournalDigest,
  parseChangeSetTransactionJournal,
  validateChangeSetTransactionJournal,
  type ChangeSetTransactionJournal,
  type TransactionJobClaim,
  type TransactionStorage,
  type TransactionStorageToken,
} from "@/knowledge/changeset/TransactionStorage";
import type {
  AllocateSourceInputRevisionRequest,
  BindSourceInputObservationRequest,
  BindSourceInputObservationResult,
  BoundSourceInputObservation,
  SourceInputObservationBinder,
  SourceInputObservationRecoveryWork,
  SourceInputObservationSettlement,
  SourceInputRevisionAllocation,
  SourceInputRevisionAllocator,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  ingestExecutionClaimMatchesQueueStorage,
  type IngestExecutionClaim,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
  verifyKnowledgeIngestExecutionProofRequest,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofPort,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionProof";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestApplyAbandonment,
  type IngestApplyClaimMarker,
  type IngestQueueSnapshot,
  type IngestSourceHighWatermark,
  type QueueWriteAuthority,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  parseManifestCommitIntent,
  validateManifestCommitIntent,
  validateManifestCommitIntentForCommit,
  type ManifestCommitPage,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY,
  createKnowledgeNoChangesCommitMarker,
  createNoChangesManifestCommitPlanDigest,
  parseKnowledgeNoChangesCommitMarker,
  parseNoChangesManifestCommitPlan,
  validateNoChangesManifestCommitMarker,
  validateNoChangesManifestCommitPlan,
  type NoChangesManifestCommitMarker,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import {
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  parseKnowledgeRuntimeSourceCommitExtension,
  type KnowledgeRuntimeSourceCommitExtension,
} from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import {
  SourceManifestRevisionConflictError,
  type SourceManifestStorage,
} from "@/knowledge/manifest/SourceManifestStorage";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import {
  parseKnowledgeBundleConfig,
  parseKnowledgeChangeSet,
  parseSourceManifest,
} from "@/knowledge/model/schemas";
import type {
  ClaimCitation,
  GeneratedPageOwnership,
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeIngestJob,
  SourceCustody,
  SourceCompileSnapshot,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateSourceManifest,
} from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  createNoJournalApplyRecoveryReference,
  type NoJournalApplyAbandonReceipt,
  type NoJournalApplyRecoveryCandidate,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoveryReference,
  type NoJournalApplyRecoverySnapshotLoadResult,
  type NoJournalApplyRecoverySnapshotPort,
  type NoJournalApplyRecoveryStatePort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import {
  parseKnowledgeStartupReleaseRequest,
  type KnowledgeStartupReleasePort,
  type KnowledgeStartupReleaseRequest,
  type KnowledgeStartupReleaseResult,
} from "@/knowledge/recovery/KnowledgeStartupRelease";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  ReviewStorageRevisionConflictError,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";
import {
  parseKnowledgeLiteralRejectCommand,
  projectKnowledgeReviewRejection,
  type KnowledgeLiteralRejectCommand,
  type KnowledgeReviewRejectTransitionReceipt,
} from "@/knowledge/review/ReviewRejectTransition";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import { sha256 } from "@/utils/hash";

/** Current format of the Vault-private atomic knowledge runtime store. */
export const KNOWLEDGE_RUNTIME_STORE_VERSION = 4 as const;

export { KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY };

/** Previous runtime envelope with the observation journal but no completion proof fence. */
const PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION = 3 as const;

/** Runtime envelope with an allocator floor but no observation journal. */
const RUNTIME_V2_STORE_VERSION = 2 as const;

/** Previous outer-envelope format eligible for one constrained startup migration. */
const LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION = 1 as const;

/** One per-Bundle snapshot stored inside the atomic runtime envelope. */
interface KnowledgeRuntimeBundleSlot {
  bundleId: string;
  value: object;
}

/** One allocated source observation retained until explicit archival. */
export type KnowledgeRuntimeSourceObservationRecord =
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "allocated";
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "bound";
      sourceContentHash: string;
      pipelineFingerprint: string;
      boundAt: number;
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "consumed";
      sourceContentHash: string;
      pipelineFingerprint: string;
      boundAt: number;
      settledAt: number;
      queueRevision: number;
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "superseded";
      sourceContentHash?: string;
      pipelineFingerprint?: string;
      boundAt?: number;
      settledAt: number;
      supersededByInputRevision: number;
    };

/** Latest allocator floor and durable observation journal for one source. */
export interface KnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;
  /** Revisions at or below this migration fence have no invented observation token. */
  managedAfterRevision: number;
  /** Exact Queue watermark trusted only because it existed during v2 migration. */
  legacyCheckpoint?: IngestSourceHighWatermark;
  observations: KnowledgeRuntimeSourceObservationRecord[];
}

/** Per-Bundle input-revision namespace retained across application restarts. */
interface KnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: KnowledgeRuntimeInputRevisionRecord[];
}

/** Exact successful-commit identity reserved for the manifest ledger adapter. */
export interface KnowledgeApplyCommitLedgerRecord {
  transactionId: string;
  commitRevision: number;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSetId: string;
  changeSetDigest: string;
  manifestIntentDigest: string;
  journalDigest: string;
  receiptDigest: string;
  manifestBeforeRevision: number;
  manifestBeforeDigest: string;
  manifestAfterRevision: number;
  manifestAfterDigest: string;
  recordedAt: number;
}

/** Complete strict state committed through one atomic plaintext file. */
export interface KnowledgeRuntimeStoreSnapshot {
  version: typeof KNOWLEDGE_RUNTIME_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

/** Detached Queue and Review state read from one atomic Runtime envelope. */
export interface KnowledgeRuntimeStudioBundleSnapshot {
  bundleId: string;
  runtimeRevision: number;
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;
}

/** Immutable accepted-source evidence attached to one applied Wiki page. */
export interface KnowledgeRuntimeAppliedSourceProvenance {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly custody: SourceCustody;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly acceptedAt: number;
  readonly citations: readonly Readonly<ClaimCitation>[];
}

/** Immutable current Manifest page with all exact accepted source provenance. */
export interface KnowledgeRuntimeAppliedPageProvenance {
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly contentHash: string;
  readonly sources: readonly Readonly<KnowledgeRuntimeAppliedSourceProvenance>[];
}

/**
 * Detached, read-only applied Wiki provenance from one atomic Runtime envelope.
 *
 * This projection is evidence for retrieval only and is never a Queue, Review,
 * transaction, Manifest, or file-mutation authority.
 */
export interface KnowledgeRuntimeAppliedProvenanceSnapshot {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly pages: readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[];
}

/** Exact durable receipt returned by the atomic Runtime Reject boundary. */
export interface KnowledgeRuntimeReviewRejectReceipt
  extends KnowledgeReviewRejectTransitionReceipt {
  runtimeRevision: number;
}

/** Scalar allocator state used by runtime versions 1 and 2. */
interface PreviousKnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;
}

/** Per-Bundle scalar allocator namespace used by runtime versions 1 and 2. */
interface PreviousKnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: PreviousKnowledgeRuntimeInputRevisionRecord[];
}

type RuntimeBundleCollection = "queues" | "reviews" | "manifests";

interface RuntimeMutation<T> {
  next?: KnowledgeRuntimeStoreSnapshot;
  value: T;
}

/** Structurally strict legacy envelope read only by the startup migration. */
interface LegacyKnowledgeRuntimeStoreSnapshot {
  version: typeof LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: PreviousKnowledgeRuntimeInputRevisionBundle[];
  applyCommits: object[];
}

/** Strict runtime-v2 envelope read only by the v2-to-v3 migration. */
interface KnowledgeRuntimeStoreSnapshotV2 {
  version: typeof RUNTIME_V2_STORE_VERSION;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: PreviousKnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

/** Strict runtime-v3 envelope read only by the v3-to-v4 migration. */
interface PreviousKnowledgeRuntimeStoreSnapshot {
  version: typeof PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

/** Fields shared by runtime versions whose observation journal is authoritative. */
type KnowledgeRuntimeSemanticSnapshot =
  | KnowledgeRuntimeStoreSnapshot
  | PreviousKnowledgeRuntimeStoreSnapshot;

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();

const runtimeBundleSlotSchema: z.ZodType<KnowledgeRuntimeBundleSlot> = z
  .object({
    bundleId: nonEmptyStringSchema,
    value: z.record(z.unknown()),
  })
  .strict();

const previousRuntimeInputRevisionRecordSchema: z.ZodType<PreviousKnowledgeRuntimeInputRevisionRecord> =
  z
    .object({
      sourceId: nonEmptyStringSchema,
      inputRevision: z.number().int().safe().positive(),
    })
    .strict();

const previousRuntimeInputRevisionBundleSchema: z.ZodType<PreviousKnowledgeRuntimeInputRevisionBundle> =
  z
    .object({
      bundleId: nonEmptyStringSchema,
      sources: z.array(previousRuntimeInputRevisionRecordSchema),
    })
    .strict();

const runtimeAllocatedObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("allocated"),
  })
  .strict();

const runtimeBoundObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("bound"),
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    boundAt: nonNegativeSafeIntegerSchema,
  })
  .strict();

const runtimeConsumedObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("consumed"),
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    boundAt: nonNegativeSafeIntegerSchema,
    settledAt: nonNegativeSafeIntegerSchema,
    queueRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeSupersededObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("superseded"),
    sourceContentHash: sha256Schema.optional(),
    pipelineFingerprint: sha256Schema.optional(),
    boundAt: nonNegativeSafeIntegerSchema.optional(),
    settledAt: nonNegativeSafeIntegerSchema,
    supersededByInputRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeSourceObservationSchema: z.ZodType<KnowledgeRuntimeSourceObservationRecord> =
  z.discriminatedUnion("status", [
    runtimeAllocatedObservationSchema,
    runtimeBoundObservationSchema,
    runtimeConsumedObservationSchema,
    runtimeSupersededObservationSchema,
  ]);

const runtimeInputRevisionRecordSchema: z.ZodType<KnowledgeRuntimeInputRevisionRecord> = z
  .object({
    sourceId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    managedAfterRevision: nonNegativeSafeIntegerSchema,
    legacyCheckpoint: z
      .object({
        sourceId: nonEmptyStringSchema,
        sourceContentHash: sha256Schema,
        pipelineFingerprint: sha256Schema,
        inputRevision: z.number().int().safe().positive(),
        observedAt: nonNegativeSafeIntegerSchema,
      })
      .strict()
      .optional(),
    observations: z.array(runtimeSourceObservationSchema),
  })
  .strict();

const runtimeInputRevisionBundleSchema: z.ZodType<KnowledgeRuntimeInputRevisionBundle> = z
  .object({
    bundleId: nonEmptyStringSchema,
    sources: z.array(runtimeInputRevisionRecordSchema),
  })
  .strict();

const applyCommitLedgerRecordSchema: z.ZodType<KnowledgeApplyCommitLedgerRecord> = z
  .object({
    transactionId: nonEmptyStringSchema,
    commitRevision: nonNegativeSafeIntegerSchema,
    bundleId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeSafeIntegerSchema,
    changeSetId: nonEmptyStringSchema,
    changeSetDigest: sha256Schema,
    manifestIntentDigest: sha256Schema,
    journalDigest: sha256Schema,
    receiptDigest: sha256Schema,
    manifestBeforeRevision: nonNegativeSafeIntegerSchema,
    manifestBeforeDigest: sha256Schema,
    manifestAfterRevision: nonNegativeSafeIntegerSchema,
    manifestAfterDigest: sha256Schema,
    recordedAt: nonNegativeSafeIntegerSchema,
  })
  .strict();

const legacyKnowledgeRuntimeStoreSnapshotSchema: z.ZodType<LegacyKnowledgeRuntimeStoreSnapshot> = z
  .object({
    version: z.literal(LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION),
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.unknown()), z.null()]),
    inputRevisions: z.array(previousRuntimeInputRevisionBundleSchema),
    applyCommits: z.array(z.record(z.unknown())),
  })
  .strict();

const runtimeV2StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV2> = z
  .object({
    version: z.literal(RUNTIME_V2_STORE_VERSION),
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.unknown()), z.null()]),
    inputRevisions: z.array(previousRuntimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const previousKnowledgeRuntimeStoreSnapshotSchema: z.ZodType<PreviousKnowledgeRuntimeStoreSnapshot> =
  z
    .object({
      version: z.literal(PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION),
      runtimeId: opaqueIdSchema,
      revision: nonNegativeSafeIntegerSchema,
      queues: z.array(runtimeBundleSlotSchema),
      reviews: z.array(runtimeBundleSlotSchema),
      manifests: z.array(runtimeBundleSlotSchema),
      activeTransaction: z.union([z.record(z.unknown()), z.null()]),
      inputRevisions: z.array(runtimeInputRevisionBundleSchema),
      applyCommits: z.array(applyCommitLedgerRecordSchema),
    })
    .strict();

const legacyEmptyReviewSnapshotSchema = z
  .object({
    version: z.literal(1),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeSafeIntegerSchema,
    records: z.array(z.unknown()),
  })
  .strict();

const knowledgeRuntimeStoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshot> = z
  .object({
    version: z.literal(KNOWLEDGE_RUNTIME_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

/** Reports an unreadable, malformed, or semantically torn runtime envelope. */
export class KnowledgeRuntimeStoreCorruptError extends Error {
  /** Creates a sanitized corruption error without retaining persisted content. */
  constructor() {
    super("The durable knowledge runtime store does not satisfy its strict contract");
    this.name = "KnowledgeRuntimeStoreCorruptError";
  }
}

/** Reports a valid envelope containing one invalid subsystem snapshot. */
export class KnowledgeRuntimeSlotValidationError extends Error {
  /**
   * Creates a sanitized invalid-slot error.
   *
   * @param subsystem - Runtime subsystem whose persisted snapshot is invalid
   * @param bundleId - Bundle key used to locate the snapshot
   */
  constructor(
    public readonly subsystem: "queue" | "review" | "manifest" | "transaction",
    public readonly bundleId?: string
  ) {
    super(
      bundleId
        ? `The durable ${subsystem} snapshot for '${bundleId}' is invalid`
        : `The durable ${subsystem} snapshot is invalid`
    );
    this.name = "KnowledgeRuntimeSlotValidationError";
  }
}

/** Reports an atomic-file implementation that returned an uncommitted payload. */
export class KnowledgeRuntimeAtomicWriteError extends Error {
  /** Creates a stable atomic write verification failure. */
  constructor() {
    super("The knowledge runtime atomic file did not confirm the requested replacement");
    this.name = "KnowledgeRuntimeAtomicWriteError";
  }
}

/** Stable reasons a legacy runtime cannot be upgraded without inventing recovery evidence. */
export type KnowledgeRuntimeMigrationUnsafeReason =
  | "active_transaction_present"
  | "apply_commit_ledger_present"
  | "review_records_present"
  | "queue_review_state_present"
  | "queue_apply_state_present"
  | "queue_active_job_present"
  | "queue_revision_overflow"
  | "manifest_success_present"
  | "manifest_reserved_commit_metadata_present"
  | "revision_overflow";

/** Reports a valid v1 envelope whose durable work makes automatic migration unsafe. */
export class KnowledgeRuntimeMigrationUnsafeError extends Error {
  /**
   * Creates a sanitized fail-closed migration error.
   *
   * @param reason - Stable unsafe-state category
   * @param bundleId - Optional Bundle containing the unsafe subsystem state
   */
  constructor(
    public readonly reason: KnowledgeRuntimeMigrationUnsafeReason,
    public readonly bundleId?: string
  ) {
    super("The legacy knowledge runtime contains work that cannot be migrated automatically");
    this.name = "KnowledgeRuntimeMigrationUnsafeError";
  }
}

/** Stable failures while proving a committed journal and receipt at the atomic boundary. */
export type KnowledgeApplyCommitProofErrorReason =
  | "journal_invalid"
  | "journal_not_committed"
  | "receipt_mismatch"
  | "active_journal_missing"
  | "active_journal_mismatch";

/** Reports missing or conflicting commit proof without retaining persisted payloads. */
export class KnowledgeApplyCommitProofError extends Error {
  /**
   * Creates an exact proof failure.
   *
   * @param transactionId - Transaction whose commit proof was rejected
   * @param reason - Stable proof failure category
   */
  constructor(
    public readonly transactionId: string,
    public readonly reason: KnowledgeApplyCommitProofErrorReason
  ) {
    super(`Transaction '${transactionId}' does not have exact durable commit proof`);
    this.name = "KnowledgeApplyCommitProofError";
  }
}

/** Stable failures while proving Queue, Review, and source-observation authority. */
export type KnowledgeApplyCommitAuthorityErrorReason =
  | "request_invalid"
  | "queue_missing"
  | "queue_claim_missing"
  | "queue_claim_mismatch"
  | "queue_review_unverified"
  | "review_missing"
  | "review_record_missing"
  | "review_record_mismatch"
  | "source_high_watermark_missing"
  | "source_high_watermark_mismatch"
  | "input_revision_missing"
  | "input_revision_behind";

/** Reports missing or conflicting durable authority for one source apply. */
export class KnowledgeApplyCommitAuthorityError extends TransactionStorageAuthorityError {
  /**
   * Creates a sanitized exact-authority failure.
   *
   * @param transactionId - Transaction whose durable authority was rejected
   * @param reason - Stable Queue, Review, or source-observation mismatch
   */
  constructor(
    public readonly transactionId: string,
    public readonly reason: KnowledgeApplyCommitAuthorityErrorReason
  ) {
    super(`Transaction '${transactionId}' does not have exact durable apply authority`);
    this.name = "KnowledgeApplyCommitAuthorityError";
  }
}

/** Reports reuse of one durable transaction id for a different commit identity. */
export class KnowledgeApplyCommitLedgerConflictError extends TransactionStorageAuthorityError {
  /** Creates a fail-closed exact-ledger identity conflict. */
  constructor(public readonly transactionId: string) {
    super(`Transaction '${transactionId}' conflicts with its durable apply ledger record`);
    this.name = "KnowledgeApplyCommitLedgerConflictError";
  }
}

/** Stable Manifest/read-set failures that prevent a new ledger commit. */
export type KnowledgeApplyCommitManifestConflictReason =
  | "intent_invalid"
  | "source_missing"
  | "source_metadata_missing"
  | "source_metadata_invalid"
  | "input_revision_not_newer"
  | "revision_overflow";

/** Reports a fail-closed Manifest projection or source ordering conflict. */
export class KnowledgeApplyCommitManifestConflictError extends TransactionStorageAuthorityError {
  /**
   * Creates a sanitized Manifest commit conflict.
   *
   * @param bundleId - Bundle whose Manifest cannot accept the commit
   * @param sourceId - Source whose successful projection was proposed
   * @param reason - Stable conflict category
   * @param diagnostics - Optional safe intent diagnostics
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly reason: KnowledgeApplyCommitManifestConflictReason,
    public readonly diagnostics: readonly KnowledgeDiagnostic[] = []
  ) {
    super(`Source '${sourceId}' cannot commit its final Manifest projection in '${bundleId}'`);
    this.name = "KnowledgeApplyCommitManifestConflictError";
  }
}

/** Stable fail-closed reasons one no-journal recovery reference cannot be trusted. */
export type KnowledgeNoJournalApplyRecoveryConflictReason =
  | "request_invalid"
  | "review_missing"
  | "review_record_missing"
  | "review_record_mismatch"
  | "queue_missing"
  | "queue_state_mismatch"
  | "recovery_id_unknown"
  | "write_evidence_conflict"
  | "state_not_actionable"
  | "revision_overflow";

/** Reports torn or stale no-journal recovery evidence without exposing persisted payloads. */
export class KnowledgeNoJournalApplyRecoveryConflictError extends TransactionStorageAuthorityError {
  /**
   * Creates a sanitized recovery conflict.
   *
   * @param bundleId - Bundle whose accepted apply could not be proved
   * @param reason - Stable fail-closed conflict category
   */
  constructor(
    public readonly bundleId: string,
    public readonly reason: KnowledgeNoJournalApplyRecoveryConflictReason
  ) {
    super(`An accepted apply in '${bundleId}' does not have exact no-journal recovery authority`);
    this.name = "KnowledgeNoJournalApplyRecoveryConflictError";
  }
}

/** Reports an ordinary Manifest writer blocked by the Vault-global transaction reservation. */
export class KnowledgeRuntimeManifestReservationError extends Error {
  /**
   * Creates a sanitized active-transaction reservation conflict.
   *
   * @param bundleId - Bundle whose ordinary Manifest write was blocked
   * @param transactionId - Active Vault-global transaction holding the reservation
   */
  constructor(
    public readonly bundleId: string,
    public readonly transactionId: string
  ) {
    super(`Manifest writes for '${bundleId}' are reserved by transaction '${transactionId}'`);
    this.name = "KnowledgeRuntimeManifestReservationError";
  }
}

/** Stable protected Manifest state that generic storage writes may never mutate. */
export type KnowledgeRuntimeManifestProtectedState =
  | "last_successful"
  | "reserved_commit_extension"
  | "reserved_no_changes_extension";

/** Reports an attempt to bypass the atomic Manifest/ledger success path. */
export class KnowledgeRuntimeManifestProtectedStateError extends Error {
  /**
   * Creates a typed protected-field write error.
   *
   * @param bundleId - Bundle whose Manifest write was rejected
   * @param sourceId - Source containing the protected success state
   * @param state - Protected state changed by the generic writer
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly state: KnowledgeRuntimeManifestProtectedState
  ) {
    super(`Source '${sourceId}' has protected commit state in Manifest '${bundleId}'`);
    this.name = "KnowledgeRuntimeManifestProtectedStateError";
  }
}

/** Reports a generic Queue writer attempting to clear or weaken a recovery gate. */
export class KnowledgeRuntimeQueueRecoveryGateProtectedError extends Error {
  /** Creates a typed recovery-gate authority bypass failure. */
  constructor(public readonly bundleId: string) {
    super(`Queue '${bundleId}' cannot bypass protected recovery or review authority`);
    this.name = "KnowledgeRuntimeQueueRecoveryGateProtectedError";
  }
}

/** Reports a Queue observation that was not authorized by the shared revision allocator. */
export class KnowledgeRuntimeQueueObservationAuthorityError extends Error {
  /** Creates a typed source-observation authority failure. */
  constructor(public readonly bundleId: string) {
    super(`Queue '${bundleId}' contains an unallocated or regressing source observation`);
    this.name = "KnowledgeRuntimeQueueObservationAuthorityError";
  }
}

/** Stable reasons an atomic no-change Queue/Manifest commit can fail closed. */
export type KnowledgeRuntimeNoChangesCommitConflictReason =
  | "authority_invalid"
  | "queue_mismatch"
  | "manifest_mismatch"
  | "source_mismatch"
  | "observation_mismatch"
  | "input_revision_not_newer"
  | "transaction_active"
  | "revision_overflow";

/** Reports stale or invalid no-change evidence without exposing persisted material. */
export class KnowledgeRuntimeNoChangesCommitConflictError extends Error {
  /** Creates one sanitized atomic no-change commit conflict. */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly reason: KnowledgeRuntimeNoChangesCommitConflictReason
  ) {
    super(`Source '${sourceId}' cannot commit no-change success in Bundle '${bundleId}'`);
    this.name = "KnowledgeRuntimeNoChangesCommitConflictError";
  }
}

/** Reports a Queue attempt that lacks exact consumed-observation and Manifest authority. */
export class KnowledgeRuntimeIngestExecutionProofError extends Error {
  /** Creates a sanitized read-only execution-proof failure. */
  constructor() {
    super("The knowledge ingest execution claim is not authorized by Runtime");
    this.name = "KnowledgeRuntimeIngestExecutionProofError";
  }
}

/** Reports a monotonic source revision that can no longer advance exactly. */
export class SourceInputRevisionOverflowError extends Error {
  /**
   * Creates an exact-integer overflow error.
   *
   * @param bundleId - Bundle containing the source namespace
   * @param sourceId - Source whose revision reached the exact integer limit
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' in Bundle '${bundleId}' cannot allocate another input revision`);
    this.name = "SourceInputRevisionOverflowError";
  }
}

/** Reports reuse of one caller capture id for a different source identity. */
export class SourceInputCaptureConflictError extends Error {
  /** Creates a sanitized capture-identity conflict. */
  constructor() {
    super("The source observation capture id is already bound to another identity");
    this.name = "SourceInputCaptureConflictError";
  }
}

/** Reports an unknown, malformed, or cross-runtime observation capability. */
export class SourceInputObservationTokenError extends Error {
  /** Creates a sanitized opaque-token failure. */
  constructor() {
    super("The source observation capability is invalid or unknown");
    this.name = "SourceInputObservationTokenError";
  }
}

/** Reports a second, different payload submitted for one observation token. */
export class SourceInputObservationBindingConflictError extends Error {
  /** Creates a sanitized first-write-wins binding conflict. */
  constructor() {
    super("The source observation capability is already bound to a different payload");
    this.name = "SourceInputObservationBindingConflictError";
  }
}

/** Reports a cryptographically improbable runtime-generated token collision. */
export class SourceInputObservationTokenCollisionError extends Error {
  /** Creates a stable fail-closed token collision. */
  constructor() {
    super("The source observation capability generator produced a duplicate token");
    this.name = "SourceInputObservationTokenCollisionError";
  }
}

/** Runtime seams used for secure ids and deterministic observation timestamps. */
export interface KnowledgeRuntimeStoreOptions {
  clock?: () => number;
  opaqueIdFactory?: () => string;
}

/** Generates one browser-compatible 128-bit opaque identifier. */
function createSecureOpaqueId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Creates the first empty strict runtime envelope. */
export function createEmptyKnowledgeRuntimeStoreSnapshot(
  runtimeId = createSecureOpaqueId()
): KnowledgeRuntimeStoreSnapshot {
  return {
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    runtimeId,
    revision: 0,
    queues: [],
    reviews: [],
    manifests: [],
    activeTransaction: null,
    inputRevisions: [],
    applyCommits: [],
  };
}

/**
 * Strictly parses and semantically validates one unknown runtime envelope.
 *
 * @param value - Unknown parsed JSON value
 * @returns Detached strict runtime snapshot
 */
export function parseKnowledgeRuntimeStoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  const parsed = knowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

/**
 * Validates every embedded subsystem before any whole-envelope rewrite.
 *
 * @param snapshot - Structurally strict runtime envelope
 */
function assertRuntimeSlotSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  requireReusableCompletionProof = true
): void {
  const manifests = new Map<string, SourceManifest>();
  const queues = new Map<string, IngestQueueSnapshot>();
  for (const slot of snapshot.queues) {
    const parsed = parseIngestQueueSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateIngestQueueSnapshot(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    queues.set(slot.bundleId, parsed.value);
  }
  for (const slot of snapshot.reviews) {
    const parsed = parseChangeSetReviewSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  for (const slot of snapshot.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (
      !parsed.ok ||
      !validateSourceManifest(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    manifests.set(slot.bundleId, parsed.value);
  }
  if (snapshot.activeTransaction !== null) {
    const parsed = parseChangeSetTransactionJournal(snapshot.activeTransaction);
    if (!parsed.ok || !validateChangeSetTransactionJournal(snapshot.activeTransaction).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  assertManifestLedgerSemantics(snapshot.applyCommits, manifests);
  assertQueueApplyCommitLedgerSemantics(snapshot.applyCommits, queues);
  assertNoChangesCommitSemantics(snapshot, manifests, queues);
  if (requireReusableCompletionProof) {
    assertReusableCompletionSemantics(snapshot, manifests, queues);
  }
  assertObservationJournalSemantics(snapshot, queues);
}

/**
 * Rejects duplicate Bundle keys in one runtime collection.
 *
 * @param slots - Strictly shaped Bundle slots
 */
function assertUniqueBundleSlots(slots: readonly KnowledgeRuntimeBundleSlot[]): void {
  const bundleIds = new Set<string>();
  for (const slot of slots) {
    if (bundleIds.has(slot.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(slot.bundleId);
  }
}

/**
 * Rejects duplicate Bundle/source identities in the input revision namespace.
 *
 * @param bundles - Strictly shaped input revision namespaces
 */
function assertUniqueInputRevisionRecords(
  bundles: readonly {
    bundleId: string;
    sources: readonly { sourceId: string }[];
  }[]
): void {
  const bundleIds = new Set<string>();
  for (const bundle of bundles) {
    if (bundleIds.has(bundle.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(bundle.bundleId);
    const sourceIds = new Set<string>();
    for (const source of bundle.sources) {
      if (sourceIds.has(source.sourceId)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      sourceIds.add(source.sourceId);
    }
  }
}

/**
 * Cross-validates allocator floors, observation journals, and Queue watermarks.
 *
 * @param snapshot - Strict current runtime envelope
 * @param queues - Already parsed Queue slots indexed by Bundle
 */
function assertObservationJournalSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  const captureIds = new Set<string>();
  const observationTokens = new Set<string>();
  for (const bundle of snapshot.inputRevisions) {
    const queue = queues.get(bundle.bundleId);
    for (const source of bundle.sources) {
      if (source.managedAfterRevision > source.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (
        source.legacyCheckpoint !== undefined &&
        (source.legacyCheckpoint.sourceId !== source.sourceId ||
          source.legacyCheckpoint.inputRevision > source.managedAfterRevision)
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      let expectedRevision = source.managedAfterRevision + 1;
      let activeBoundRevision: number | undefined;
      let highestBindingRevision: number | undefined;
      let highestConsumed:
        | Extract<KnowledgeRuntimeSourceObservationRecord, { status: "consumed" }>
        | undefined;
      let previousConsumedQueueRevision = 0;
      for (const observation of source.observations) {
        if (
          observation.inputRevision !== expectedRevision ||
          observation.inputRevision > source.inputRevision ||
          observation.allocatedAt >
            ("boundAt" in observation && observation.boundAt !== undefined
              ? observation.boundAt
              : Number.MAX_SAFE_INTEGER) ||
          captureIds.has(observation.captureId) ||
          observationTokens.has(observation.observationToken)
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        captureIds.add(observation.captureId);
        observationTokens.add(observation.observationToken);
        if (observation.status === "bound") {
          if (activeBoundRevision !== undefined) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
          activeBoundRevision = observation.inputRevision;
        }
        if (
          observation.status === "bound" ||
          observation.status === "consumed" ||
          (observation.status === "superseded" &&
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined)
        ) {
          highestBindingRevision = observation.inputRevision;
        }
        if (
          observation.status === "consumed" &&
          (observation.boundAt > observation.settledAt ||
            observation.queueRevision > (queue?.revision ?? 0) ||
            observation.queueRevision <= previousConsumedQueueRevision)
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        if (observation.status === "consumed") {
          highestConsumed = observation;
          previousConsumedQueueRevision = observation.queueRevision;
        }
        if (observation.status === "superseded") {
          const hasAnyBinding =
            observation.sourceContentHash !== undefined ||
            observation.pipelineFingerprint !== undefined ||
            observation.boundAt !== undefined;
          const hasCompleteBinding =
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined;
          if (
            (hasAnyBinding && !hasCompleteBinding) ||
            observation.supersededByInputRevision <= observation.inputRevision ||
            observation.supersededByInputRevision > source.inputRevision ||
            observation.allocatedAt > observation.settledAt ||
            (observation.boundAt !== undefined && observation.boundAt > observation.settledAt)
          ) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
        }
        expectedRevision += 1;
      }
      if (expectedRevision !== source.inputRevision + 1) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const observationsByRevision = new Map(
        source.observations.map((observation) => [observation.inputRevision, observation] as const)
      );
      for (const observation of source.observations) {
        if (
          highestBindingRevision !== undefined &&
          observation.inputRevision < highestBindingRevision &&
          (observation.status === "allocated" || observation.status === "bound")
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        if (observation.status === "superseded") {
          const target = observationsByRevision.get(observation.supersededByInputRevision);
          const targetHasBinding =
            target !== undefined &&
            (target.status === "bound" ||
              target.status === "consumed" ||
              (target.status === "superseded" &&
                target.sourceContentHash !== undefined &&
                target.pipelineFingerprint !== undefined &&
                target.boundAt !== undefined));
          if (!targetHasBinding) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
        }
      }
      const highWatermark = queue?.sourceHighWatermarks.find(
        (candidate) => candidate.sourceId === source.sourceId
      );
      if (highWatermark === undefined) {
        if (highestConsumed !== undefined || source.legacyCheckpoint !== undefined) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        continue;
      }
      if (highWatermark.inputRevision > source.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const highWatermarkMatchesManagedConsumption =
        highestConsumed !== undefined &&
        highestConsumed.inputRevision === highWatermark.inputRevision &&
        highestConsumed.sourceContentHash === highWatermark.sourceContentHash &&
        highestConsumed.pipelineFingerprint === highWatermark.pipelineFingerprint;
      const highWatermarkMatchesMigrationCheckpoint =
        highestConsumed === undefined &&
        exactJsonValuesEqual(source.legacyCheckpoint, highWatermark);
      if (!highWatermarkMatchesManagedConsumption && !highWatermarkMatchesMigrationCheckpoint) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (activeBoundRevision !== undefined && activeBoundRevision <= highWatermark.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
  for (const [bundleId, queue] of queues) {
    const sources = snapshot.inputRevisions.find(
      (candidate) => candidate.bundleId === bundleId
    )?.sources;
    for (const highWatermark of queue.sourceHighWatermarks) {
      if (!sources?.some((source) => source.sourceId === highWatermark.sourceId)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

/**
 * Rejects reuse of one transaction id inside the apply-commit ledger.
 *
 * @param records - Strictly shaped commit ledger records
 */
function assertUniqueApplyCommits(records: readonly KnowledgeApplyCommitLedgerRecord[]): void {
  const transactionIds = new Set<string>();
  const manifestRevisions = new Map<string, Set<number>>();
  const sourceHistories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();
  for (const record of records) {
    if (transactionIds.has(record.transactionId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      record.manifestBeforeRevision === Number.MAX_SAFE_INTEGER ||
      record.manifestAfterRevision !== record.manifestBeforeRevision + 1 ||
      record.manifestBeforeDigest === record.manifestAfterDigest
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const revisions = manifestRevisions.get(record.bundleId) ?? new Set<number>();
    if (revisions.has(record.manifestAfterRevision)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    revisions.add(record.manifestAfterRevision);
    manifestRevisions.set(record.bundleId, revisions);
    const sourceKey = `${record.bundleId}\u0000${record.sourceId}`;
    const history = sourceHistories.get(sourceKey) ?? [];
    history.push(record);
    sourceHistories.set(sourceKey, history);
    transactionIds.add(record.transactionId);
  }
  for (const history of sourceHistories.values()) {
    history.sort((left, right) => left.manifestAfterRevision - right.manifestAfterRevision);
    for (let index = 1; index < history.length; index += 1) {
      if (history[index].inputRevision <= history[index - 1].inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

/**
 * Requires every durable success projection to have one exact latest ledger proof.
 *
 * Historical records remain valid and do not need to equal the current Manifest
 * digest after later ordinary Manifest writes or shared-page co-owner updates.
 *
 * @param records - Complete retained apply ledger
 * @param manifests - Strict current Manifests keyed by Bundle
 */
function assertManifestLedgerSemantics(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  manifests: ReadonlyMap<string, SourceManifest>
): void {
  const histories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();
  const bundleHistories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();

  for (const record of records) {
    const manifest = manifests.get(record.bundleId);
    const source = manifest?.entries.find((entry) => entry.sourceId === record.sourceId);
    if (!manifest || !source || record.manifestAfterRevision > manifest.revision) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      record.manifestAfterRevision === manifest.revision &&
      record.manifestAfterDigest !== createSourceManifestDigest(manifest)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const sourceKey = `${record.bundleId}\u0000${record.sourceId}`;
    const sourceHistory = histories.get(sourceKey) ?? [];
    sourceHistory.push(record);
    histories.set(sourceKey, sourceHistory);
    const bundleHistory = bundleHistories.get(record.bundleId) ?? [];
    bundleHistory.push(record);
    bundleHistories.set(record.bundleId, bundleHistory);
  }

  for (const history of bundleHistories.values()) {
    history.sort((left, right) => left.manifestAfterRevision - right.manifestAfterRevision);
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1];
      const current = history[index];
      if (
        current.manifestBeforeRevision === previous.manifestAfterRevision &&
        current.manifestBeforeDigest !== previous.manifestAfterDigest
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }

  for (const manifest of manifests.values()) {
    const generatedPages = new Map<
      string,
      { path: string; ownership: string; contentHash: string; sourceIds: Set<string> }
    >();
    for (const entry of manifest.entries) {
      const success = entry.lastSuccessful;
      const rawExtension = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
      const sourceKey = `${manifest.bundleId}\u0000${entry.sourceId}`;
      const history = histories.get(sourceKey) ?? [];
      if (!success || rawExtension === undefined) {
        if (success !== undefined || rawExtension !== undefined || history.length > 0) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        continue;
      }
      for (const page of success.generatedPages) {
        if (page.contentHash === undefined) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        const pathKey = toWindowsPathKey(page.path);
        const existing = generatedPages.get(pathKey);
        if (!existing) {
          generatedPages.set(pathKey, {
            path: page.path,
            ownership: page.ownership,
            contentHash: page.contentHash,
            sourceIds: new Set([entry.sourceId]),
          });
          continue;
        }
        if (
          existing.sourceIds.has(entry.sourceId) ||
          existing.path !== page.path ||
          existing.ownership !== page.ownership ||
          existing.contentHash !== page.contentHash
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        existing.sourceIds.add(entry.sourceId);
      }
      const extension = parseKnowledgeRuntimeSourceCommitExtension(rawExtension);
      if (!extension.ok || history.length === 0) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const latest = [...history].sort(
        (left, right) => right.manifestAfterRevision - left.manifestAfterRevision
      )[0];
      if (
        extension.value.transactionId !== latest.transactionId ||
        extension.value.inputRevision !== latest.inputRevision ||
        extension.value.manifestIntentDigest !== latest.manifestIntentDigest ||
        success.sourceContentHash !== latest.sourceContentHash ||
        success.pipelineFingerprint !== latest.pipelineFingerprint ||
        success.changeSetId !== latest.changeSetId ||
        success.completedAt !== latest.recordedAt
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
    for (const page of generatedPages.values()) {
      if (page.sourceIds.size > 1 && page.ownership !== "shared") {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

/**
 * Requires every pending Queue commit acknowledgement to reference one exact
 * successful apply-ledger record from the same atomic runtime envelope.
 *
 * The marker intentionally retains the receipt fields needed by Queue
 * recovery. Binding all overlapping fields prevents a torn or forged marker
 * from completing a job whose Manifest success was never recorded.
 *
 * @param records - Complete retained apply ledger
 * @param queues - Strict current Queue snapshots keyed by Bundle
 */
function assertQueueApplyCommitLedgerSemantics(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  const recordsByTransaction = new Map(
    records.map((record) => [record.transactionId, record] as const)
  );
  for (const [bundleId, queue] of queues) {
    const marker = queue.applyCommit;
    if (!marker) {
      continue;
    }
    const record = recordsByTransaction.get(marker.transactionId);
    if (
      !record ||
      record.bundleId !== bundleId ||
      record.sourceId !== marker.sourceId ||
      record.sourceContentHash !== marker.sourceContentHash ||
      record.pipelineFingerprint !== marker.pipelineFingerprint ||
      record.inputRevision !== marker.inputRevision ||
      record.changeSetId !== marker.changeSetId ||
      record.changeSetDigest !== marker.changeSetDigest ||
      record.commitRevision !== marker.commitRevision ||
      record.recordedAt !== marker.committedAt
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
}

/**
 * Compares a no-change read-set with the current applied page projection.
 *
 * Page ordering is not semantic. A later co-owner Apply may legitimately
 * advance the content hash of a shared page without invalidating another
 * source's retained no-change marker.
 *
 * @param source - Current registered source entry
 * @param basePages - Canonical pages captured by the no-change plan
 * @param allowSharedHashDrift - Whether a later shared-page writer may have advanced the hash
 * @returns Whether both projections identify the same authorized page set
 */
function noChangesBasePagesMatchSource(
  source: SourceManifestEntry,
  basePages: readonly ManifestCommitPage[],
  allowSharedHashDrift: boolean
): boolean {
  const currentPages = source.lastSuccessful?.generatedPages ?? [];
  if (basePages.length !== currentPages.length) return false;
  const currentByPathKey = new Map(
    currentPages.map((page) => [toWindowsPathKey(page.path), page] as const)
  );
  return basePages.every((page) => {
    const current = currentByPathKey.get(toWindowsPathKey(page.path));
    return (
      current !== undefined &&
      page.path === current.path &&
      page.ownership === current.ownership &&
      ((allowSharedHashDrift && page.ownership === "shared") ||
        page.contentHash === current.contentHash)
    );
  });
}

/**
 * Requires every retained no-change source marker to match one exact completed
 * Queue attempt and its consumed observation from the same Runtime envelope.
 */
function assertNoChangesCommitSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifests: ReadonlyMap<string, SourceManifest>,
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  for (const [bundleId, manifest] of manifests) {
    const queue = queues.get(bundleId);
    for (const source of manifest.entries) {
      const rawMarker = source.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
      if (rawMarker === undefined) continue;
      const parsed = parseKnowledgeNoChangesCommitMarker(rawMarker);
      if (!parsed.ok || !validateNoChangesManifestCommitMarker(parsed.value).valid || !queue) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const marker = parsed.value;
      const job = queue.jobs.find((candidate) => candidate.id === marker.jobId);
      const highWatermark = queue.sourceHighWatermarks.find(
        (candidate) => candidate.sourceId === source.sourceId
      );
      const observations =
        snapshot.inputRevisions
          .find((bundle) => bundle.bundleId === bundleId)
          ?.sources.find((candidate) => candidate.sourceId === source.sourceId)
          ?.observations.filter(
            (observation) =>
              observation.status === "consumed" &&
              observation.inputRevision === marker.inputRevision &&
              observation.sourceContentHash === marker.sourceContentHash &&
              observation.pipelineFingerprint === marker.pipelineFingerprint
          ) ?? [];
      let sourceAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
      try {
        sourceAuthority = deriveKnowledgeSourceCompileAuthority(source);
      } catch {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const sourceAuthorityMatches =
        marker.kind === "query_writeback_source_compile"
          ? sourceAuthority.operation === "query_writeback" &&
            sourceAuthority.sourceOriginDigest === marker.sourceOriginDigest &&
            sourceAuthority.expectedSourceContentHash === marker.sourceContentHash
          : sourceAuthority.operation === "ingest";
      const basePagesMatch = noChangesBasePagesMatchSource(source, marker.baseGeneratedPages, true);
      const applyExtension = readSourceCommitExtension(source, bundleId);
      const applyInputRevision = applyExtension?.inputRevision ?? 0;
      const markerIsHistorical = marker.inputRevision < applyInputRevision;
      if (
        marker.bundleId !== bundleId ||
        marker.sourceId !== source.sourceId ||
        marker.manifestAfterRevision > manifest.revision ||
        !sourceAuthorityMatches ||
        (!markerIsHistorical && !basePagesMatch) ||
        marker.inputRevision === applyInputRevision ||
        !job ||
        job.status !== "completed" ||
        job.sourceId !== marker.sourceId ||
        job.sourceContentHash !== marker.sourceContentHash ||
        job.pipelineFingerprint !== marker.pipelineFingerprint ||
        job.inputRevision !== marker.inputRevision ||
        job.attempt !== marker.attempt ||
        job.changeSetId !== marker.noChangesId ||
        job.completedAt !== marker.completedAt ||
        highWatermark === undefined ||
        highWatermark.inputRevision < marker.inputRevision ||
        observations.length !== 1 ||
        queue.pendingReviews.some((review) => review.jobId === marker.jobId) ||
        queue.applyClaim?.jobId === marker.jobId ||
        queue.applyCommit?.jobId === marker.jobId ||
        snapshot.applyCommits.some(
          (record) =>
            record.bundleId === bundleId &&
            record.sourceId === source.sourceId &&
            record.inputRevision === marker.inputRevision
        )
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

/** Completed Queue job whose terminal success may be reused by exact deduplication. */
type ReusableCompletedJob = Extract<KnowledgeIngestJob, { status: "completed" }>;

/** Compares the behavior-defining payload retained by two source records. */
function runtimeSourcePayloadMatches(
  left: Pick<KnowledgeIngestJob, "sourceContentHash" | "pipelineFingerprint">,
  right: Pick<KnowledgeIngestJob, "sourceContentHash" | "pipelineFingerprint">
): boolean {
  return (
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint
  );
}

/** Reports whether a Queue job can still absorb or schedule the latest source input. */
function runtimeQueueJobIsActive(job: KnowledgeIngestJob): boolean {
  return job.status !== "failed" && job.status !== "completed" && job.status !== "cancelled";
}

/** Current source outcome selected by the Queue's exact deduplication ordering. */
type CurrentSourceTerminalOutcome =
  | { kind: "covered" }
  | { kind: "failed_or_cancelled" }
  | { kind: "completed"; job: ReusableCompletedJob }
  | { kind: "invalid" };

/**
 * Finds the terminal result that a current exact source observation may reuse.
 *
 * Queue enqueue returns its active job first. Without active work it returns
 * the latest source job ordered by input revision, update time, then id. The
 * Runtime repeats that exact choice rather than searching older successes.
 */
function findCurrentSourceTerminalOutcome(
  queue: IngestQueueSnapshot,
  highWatermark: IngestSourceHighWatermark
): CurrentSourceTerminalOutcome {
  const activeJob = queue.jobs.some(
    (job) => job.sourceId === highWatermark.sourceId && runtimeQueueJobIsActive(job)
  );
  const rerun = queue.reruns.some((candidate) => candidate.sourceId === highWatermark.sourceId);
  if (activeJob || rerun) return { kind: "covered" };

  const latest = queue.jobs
    .filter((job) => job.sourceId === highWatermark.sourceId)
    .sort(
      (left, right) =>
        right.inputRevision - left.inputRevision ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id)
    )[0];
  if (
    !latest ||
    latest.inputRevision > highWatermark.inputRevision ||
    !runtimeSourcePayloadMatches(latest, highWatermark)
  ) {
    return { kind: "invalid" };
  }
  if (latest.status === "completed") return { kind: "completed", job: latest };
  if (latest.status === "failed" || latest.status === "cancelled") {
    return { kind: "failed_or_cancelled" };
  }
  return { kind: "invalid" };
}

/** Proves one exact reusable completion by no-change marker or Apply ledger. */
function reusableCompletionHasProof(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifest: SourceManifest | undefined,
  job: ReusableCompletedJob
): boolean {
  const source = manifest?.entries.find((entry) => entry.sourceId === job.sourceId);
  const marker = parseKnowledgeNoChangesCommitMarker(
    source?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
  );
  const exactNoChangesMarker =
    marker.ok &&
    marker.value.bundleId === job.bundleId &&
    marker.value.jobId === job.id &&
    marker.value.sourceId === job.sourceId &&
    marker.value.sourceContentHash === job.sourceContentHash &&
    marker.value.pipelineFingerprint === job.pipelineFingerprint &&
    marker.value.inputRevision === job.inputRevision &&
    marker.value.attempt === job.attempt &&
    marker.value.noChangesId === job.changeSetId &&
    marker.value.completedAt === job.completedAt;
  if (exactNoChangesMarker) return true;

  return snapshot.applyCommits.some(
    (record) =>
      record.bundleId === job.bundleId &&
      record.sourceId === job.sourceId &&
      record.sourceContentHash === job.sourceContentHash &&
      record.pipelineFingerprint === job.pipelineFingerprint &&
      record.inputRevision === job.inputRevision &&
      record.changeSetId === job.changeSetId
  );
}

/**
 * Reverse-validates every current exact-dedup completion.
 *
 * Runtime v4 never trusts Queue terminal shape alone: the newest reusable
 * completion for the current source fingerprint must be backed by either the
 * exact no-change marker or an Apply commit ledger from the same envelope.
 */
function assertReusableCompletionSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifests: ReadonlyMap<string, SourceManifest>,
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  for (const [bundleId, queue] of queues) {
    const manifest = manifests.get(bundleId);
    for (const highWatermark of queue.sourceHighWatermarks) {
      const outcome = findCurrentSourceTerminalOutcome(queue, highWatermark);
      if (
        outcome.kind === "invalid" ||
        (outcome.kind === "completed" &&
          !reusableCompletionHasProof(snapshot, manifest, outcome.job))
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

/** Caller-derived ledger fields that identify an exact replay before Manifest mutation. */
type KnowledgeApplyCommitLedgerIdentity = Omit<
  KnowledgeApplyCommitLedgerRecord,
  "manifestAfterRevision" | "manifestAfterDigest"
>;

/**
 * Compares every caller-reconstructable field of one ledger record.
 *
 * @param record - Existing durable ledger record
 * @param identity - Candidate identity derived from journal, receipt, and intent
 * @returns Whether the call is an exact replay
 */
function applyCommitLedgerIdentityMatches(
  record: KnowledgeApplyCommitLedgerRecord,
  identity: KnowledgeApplyCommitLedgerIdentity
): boolean {
  return (
    record.transactionId === identity.transactionId &&
    record.commitRevision === identity.commitRevision &&
    record.bundleId === identity.bundleId &&
    record.sourceId === identity.sourceId &&
    record.sourceContentHash === identity.sourceContentHash &&
    record.pipelineFingerprint === identity.pipelineFingerprint &&
    record.inputRevision === identity.inputRevision &&
    record.changeSetId === identity.changeSetId &&
    record.changeSetDigest === identity.changeSetDigest &&
    record.manifestIntentDigest === identity.manifestIntentDigest &&
    record.journalDigest === identity.journalDigest &&
    record.receiptDigest === identity.receiptDigest &&
    record.manifestBeforeRevision === identity.manifestBeforeRevision &&
    record.manifestBeforeDigest === identity.manifestBeforeDigest &&
    record.recordedAt === identity.recordedAt
  );
}

/**
 * Derives every replayable ledger field from exact committed proof.
 *
 * @param journal - Strict committed transaction journal
 * @param receipt - Exact journal-derived public receipt
 * @param intent - Final Manifest projection embedded in the journal
 * @returns Deterministic ledger identity excluding first-commit after proof
 */
function createApplyCommitLedgerIdentity(
  journal: CommittedChangeSetTransactionJournal,
  receipt: TransactionCommitReceipt,
  intent: ManifestCommitIntent
): KnowledgeApplyCommitLedgerIdentity {
  return {
    transactionId: journal.transactionId,
    commitRevision: journal.revision,
    bundleId: journal.bundleId,
    sourceId: journal.jobClaim.sourceId,
    sourceContentHash: journal.jobClaim.sourceContentHash,
    pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
    inputRevision: journal.jobClaim.inputRevision,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    manifestIntentDigest: journal.manifestCommitIntentDigest,
    journalDigest: createChangeSetTransactionJournalDigest(journal),
    receiptDigest: createTransactionCommitReceiptDigest(receipt),
    manifestBeforeRevision: intent.expectedManifestRevision,
    manifestBeforeDigest: intent.expectedManifestDigest,
    recordedAt: receipt.committedAt,
  };
}

/** Minimal strict identity required to prove Queue and Review apply authority. */
interface KnowledgeApplyRuntimeIdentity {
  transactionId: string;
  bundleId: string;
  changeSetId: string;
  changeSetDigest: string;
  changeSet: KnowledgeChangeSet;
  jobClaim: TransactionJobClaim;
  manifestCommitIntent: ManifestCommitIntent;
  manifestCommitIntentDigest: string;
}

/** Complete identity required to add current Bundle and Manifest file-access authority. */
interface KnowledgeApplyAuthorityProof extends KnowledgeApplyRuntimeIdentity {
  bundle: KnowledgeBundleConfig;
}

/**
 * Strictly parses one transaction preflight request without observing Wiki files.
 *
 * @param request - Detached identity supplied by the transaction runtime
 * @returns Strict proof suitable for shared Queue/Review authority validation
 */
function parseApplyAuthorityRequest(
  request: ChangeSetTransactionAuthorityRequest
): KnowledgeApplyAuthorityProof {
  const transactionId = request.transactionId;
  const bundleResult = parseKnowledgeBundleConfig(request.bundle);
  const changeSetResult = parseKnowledgeChangeSet(request.changeSet);
  const intentResult = parseManifestCommitIntent(request.manifestCommitIntent);
  const claim = request.jobClaim;
  const claimValid =
    typeof claim === "object" &&
    claim !== null &&
    typeof claim.jobId === "string" &&
    claim.jobId.trim().length > 0 &&
    Number.isSafeInteger(claim.attempt) &&
    claim.attempt > 0 &&
    Number.isSafeInteger(claim.startedAt) &&
    claim.startedAt >= 0 &&
    typeof claim.sourceId === "string" &&
    claim.sourceId.trim().length > 0 &&
    sha256Schema.safeParse(claim.sourceContentHash).success &&
    sha256Schema.safeParse(claim.pipelineFingerprint).success &&
    Number.isSafeInteger(claim.inputRevision) &&
    claim.inputRevision >= 0;
  if (
    typeof transactionId !== "string" ||
    transactionId.trim().length === 0 ||
    !bundleResult.ok ||
    !changeSetResult.ok ||
    !intentResult.ok ||
    !claimValid
  ) {
    throw new KnowledgeApplyCommitAuthorityError(transactionId, "request_invalid");
  }

  const bundle = bundleResult.value;
  const changeSet = changeSetResult.value;
  const intent = intentResult.value;
  const bundleValidation = validateKnowledgeBundleConfig(bundle);
  const changeSetValidation = validateKnowledgeChangeSet(changeSet, bundle);
  const intentValidation = validateManifestCommitIntent(intent, bundle);
  if (
    !bundleValidation.valid ||
    !changeSetValidation.valid ||
    !intentValidation.valid ||
    changeSet.status !== "accepted" ||
    request.changeSetDigest !== createChangeSetTransactionDigest(changeSet) ||
    request.manifestCommitIntentDigest !== createManifestCommitIntentDigest(intent) ||
    changeSet.bundleId !== bundle.id ||
    intent.bundleId !== bundle.id ||
    intent.changeSetId !== changeSet.id ||
    intent.sourceId !== claim.sourceId ||
    intent.sourceContentHash !== claim.sourceContentHash ||
    intent.pipelineFingerprint !== claim.pipelineFingerprint ||
    intent.inputRevision !== claim.inputRevision
  ) {
    throw new KnowledgeApplyCommitAuthorityError(transactionId, "request_invalid");
  }

  return {
    transactionId,
    bundleId: bundle.id,
    bundle,
    changeSetId: changeSet.id,
    changeSetDigest: request.changeSetDigest,
    changeSet,
    jobClaim: {
      jobId: claim.jobId,
      attempt: claim.attempt,
      startedAt: claim.startedAt,
      sourceId: claim.sourceId,
      sourceContentHash: claim.sourceContentHash,
      pipelineFingerprint: claim.pipelineFingerprint,
      inputRevision: claim.inputRevision,
    },
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: request.manifestCommitIntentDigest,
  };
}

/**
 * Compares one Queue apply claim with the immutable transaction job claim.
 *
 * @param claim - Durable Queue claim captured at the applying boundary
 * @param journal - Prepared or committed transaction owned by that claim
 * @returns Whether every persisted execution identity field is exact
 */
function queueClaimMatchesTransaction(
  claim: IngestQueueSnapshot["applyClaim"],
  journal: KnowledgeApplyRuntimeIdentity
): boolean {
  return (
    claim !== undefined &&
    claim.jobId === journal.jobClaim.jobId &&
    claim.sourceId === journal.jobClaim.sourceId &&
    claim.sourceContentHash === journal.jobClaim.sourceContentHash &&
    claim.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    claim.inputRevision === journal.jobClaim.inputRevision &&
    claim.attempt === journal.jobClaim.attempt &&
    claim.startedAt === journal.jobClaim.startedAt
  );
}

/**
 * Compares one accepted Review record's Queue claim with a transaction claim.
 *
 * Review records intentionally predate the applying `startedAt`, so only the
 * immutable source observation and attempt fields participate here.
 *
 * @param record - Exact accepted Review Store record
 * @param journal - Prepared or committed transaction under proof
 * @returns Whether the Review record belongs to the same Queue attempt
 */
function reviewClaimMatchesTransaction(
  record: AcceptedChangeSetReviewRecord,
  journal: KnowledgeApplyRuntimeIdentity
): boolean {
  return (
    record.jobClaim.jobId === journal.jobClaim.jobId &&
    record.jobClaim.sourceId === journal.jobClaim.sourceId &&
    record.jobClaim.sourceContentHash === journal.jobClaim.sourceContentHash &&
    record.jobClaim.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    record.jobClaim.inputRevision === journal.jobClaim.inputRevision &&
    record.jobClaim.attempt === journal.jobClaim.attempt
  );
}

/**
 * Compares strict persisted JSON payloads independently of property order.
 *
 * @param left - First JSON-compatible strict value
 * @param right - Second JSON-compatible strict value
 * @returns Whether both values have identical canonical JSON
 */
function exactJsonValuesEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

/**
 * Compares one startup identity with its exact immutable accepted Review record.
 *
 * @param identity - Identity returned by review startup reconciliation
 * @param record - Durable accepted Review record loaded from the shared envelope
 * @returns Whether every startup-visible identity field is exact
 */
function acceptedRecordMatchesStartupIdentity(
  identity: AcceptedReviewStartupIdentity,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    identity.changeSetId === record.changeSetId &&
    identity.proposalDigest === record.proposalDigest &&
    identity.recordRevision === record.recordRevision &&
    identity.recordedAt === record.recordedAt &&
    identity.acceptedDigest === record.acceptedDigest &&
    identity.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    identity.acceptedAt === record.acceptedAt &&
    identity.jobClaim.jobId === record.jobClaim.jobId &&
    identity.jobClaim.sourceId === record.jobClaim.sourceId &&
    identity.jobClaim.sourceContentHash === record.jobClaim.sourceContentHash &&
    identity.jobClaim.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    identity.jobClaim.inputRevision === record.jobClaim.inputRevision &&
    identity.jobClaim.attempt === record.jobClaim.attempt
  );
}

/**
 * Creates one stable opaque id from evidence retained across every apply phase.
 *
 * The applying `startedAt` is intentionally excluded because a fully finalized
 * commit retains it neither in the completed Queue job nor in the Manifest
 * ledger. The accepted Review identity remains immutable and unique for the
 * owning Queue attempt, so the id stays stable through continue and abandon.
 *
 * @param bundleId - Bundle containing the accepted record
 * @param record - Exact immutable accepted Review record
 * @returns Namespaced lowercase SHA-256 recovery identifier
 */
function createNoJournalApplyRecoveryId(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): string {
  return createNoJournalApplyRecoveryReference(bundleId, record).recoveryId;
}

/**
 * Compares one Queue job with the immutable accepted Review attempt.
 *
 * @param job - Durable Queue job
 * @param record - Exact accepted Review record
 * @returns Whether all source-observation and attempt fields match
 */
function queueJobMatchesAcceptedRecord(
  job: KnowledgeIngestJob | undefined,
  record: AcceptedChangeSetReviewRecord
): job is KnowledgeIngestJob {
  return (
    job !== undefined &&
    job.id === record.jobClaim.jobId &&
    job.sourceId === record.jobClaim.sourceId &&
    job.sourceContentHash === record.jobClaim.sourceContentHash &&
    job.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    job.inputRevision === record.jobClaim.inputRevision &&
    job.attempt === record.jobClaim.attempt
  );
}

/**
 * Compares a reviewed Queue apply claim with one accepted Review record.
 *
 * @param claim - Durable active or interrupted apply claim
 * @param record - Exact accepted Review record
 * @returns Whether the claim carries the same reviewed decision and payload ids
 */
function queueClaimMatchesAcceptedRecord(
  claim: IngestApplyClaimMarker | undefined,
  record: AcceptedChangeSetReviewRecord
): claim is IngestApplyClaimMarker {
  return (
    claim !== undefined &&
    claim.jobId === record.jobClaim.jobId &&
    claim.sourceId === record.jobClaim.sourceId &&
    claim.sourceContentHash === record.jobClaim.sourceContentHash &&
    claim.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    claim.inputRevision === record.jobClaim.inputRevision &&
    claim.attempt === record.jobClaim.attempt &&
    claim.legacyReview === undefined &&
    claim.reviewedChangeSet?.changeSetId === record.changeSetId &&
    claim.reviewedChangeSet.changeSetDigest === record.acceptedDigest &&
    claim.acceptedReview?.proposalDigest === record.proposalDigest &&
    claim.acceptedReview.recordRevision === record.recordRevision &&
    claim.acceptedReview.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    claim.acceptedReview.acceptedAt === record.acceptedAt
  );
}

/**
 * Converts exact accepted Queue and Review evidence into transaction authority.
 *
 * @param bundleId - Bundle containing the evidence
 * @param record - Exact accepted Review record
 * @param claim - Exact reviewed Queue apply claim
 * @returns Identity sufficient for Queue/Review/allocator re-proof
 */
function createNoJournalApplyRuntimeIdentity(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord,
  claim: IngestApplyClaimMarker
): KnowledgeApplyRuntimeIdentity {
  return {
    transactionId: createNoJournalApplyRecoveryId(bundleId, record),
    bundleId,
    changeSetId: record.changeSetId,
    changeSetDigest: record.acceptedDigest,
    changeSet: cloneJson(record.acceptedChangeSet),
    jobClaim: {
      jobId: claim.jobId,
      attempt: claim.attempt,
      startedAt: claim.startedAt,
      sourceId: claim.sourceId,
      sourceContentHash: claim.sourceContentHash,
      pipelineFingerprint: claim.pipelineFingerprint,
      inputRevision: claim.inputRevision,
    },
    manifestCommitIntent: cloneJson(record.manifestCommitIntent),
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
  };
}

/**
 * Creates one decision candidate only after exact Queue/Review proof succeeds.
 *
 * @param bundleId - Bundle containing the accepted apply
 * @param record - Exact immutable accepted Review record
 * @param claim - Exact durable applying claim
 * @returns Detached candidate safe to render but not itself an authority token
 */
function createNoJournalApplyRecoveryCandidate(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord,
  claim: IngestApplyClaimMarker
): NoJournalApplyRecoveryCandidate {
  return {
    ...createNoJournalApplyRecoveryReference(bundleId, record),
    jobId: claim.jobId,
    changeSetId: record.changeSetId,
    sourceId: claim.sourceId,
    sourceContentHash: claim.sourceContentHash,
    pipelineFingerprint: claim.pipelineFingerprint,
    inputRevision: claim.inputRevision,
    attempt: claim.attempt,
    startedAt: claim.startedAt,
    acceptedAt: record.acceptedAt,
  };
}

/**
 * Compares one append-only abandonment with its exact accepted Review record.
 *
 * @param abandonment - Durable Queue abandonment tombstone
 * @param record - Exact accepted Review record
 * @returns Whether every retained accepted decision field is exact
 */
function abandonmentMatchesAcceptedRecord(
  abandonment: IngestApplyAbandonment,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    abandonment.jobId === record.jobClaim.jobId &&
    abandonment.sourceId === record.jobClaim.sourceId &&
    abandonment.sourceContentHash === record.jobClaim.sourceContentHash &&
    abandonment.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    abandonment.inputRevision === record.jobClaim.inputRevision &&
    abandonment.attempt === record.jobClaim.attempt &&
    abandonment.changeSetId === record.changeSetId &&
    abandonment.changeSetDigest === record.acceptedDigest &&
    abandonment.proposalDigest === record.proposalDigest &&
    abandonment.recordRevision === record.recordRevision &&
    abandonment.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    abandonment.acceptedAt === record.acceptedAt
  );
}

/**
 * Compares one exact commit ledger record with an accepted Review outcome.
 *
 * @param ledger - Durable Manifest commit ledger record
 * @param bundleId - Bundle containing the Review record
 * @param record - Exact accepted Review record
 * @returns Whether the ledger proves this accepted source input committed
 */
function ledgerMatchesAcceptedRecord(
  ledger: KnowledgeApplyCommitLedgerRecord,
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    ledger.bundleId === bundleId &&
    ledger.sourceId === record.jobClaim.sourceId &&
    ledger.sourceContentHash === record.jobClaim.sourceContentHash &&
    ledger.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    ledger.inputRevision === record.jobClaim.inputRevision &&
    ledger.changeSetId === record.changeSetId &&
    ledger.changeSetDigest === record.acceptedDigest &&
    ledger.manifestIntentDigest === record.manifestCommitIntentDigest
  );
}

/**
 * Finds the latest retained apply ledger for one exact Bundle/source identity.
 *
 * @param records - Complete append-only apply ledger
 * @param bundleId - Bundle containing the source
 * @param sourceId - Stable source identifier
 * @returns Latest source ledger by Manifest revision, or undefined
 */
function findLatestSourceApplyLedger(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  bundleId: string,
  sourceId: string
): KnowledgeApplyCommitLedgerRecord | undefined {
  let latest: KnowledgeApplyCommitLedgerRecord | undefined;
  for (const record of records) {
    if (record.bundleId !== bundleId || record.sourceId !== sourceId) continue;
    if (!latest || record.manifestAfterRevision > latest.manifestAfterRevision) {
      latest = record;
    }
  }
  return latest;
}

/**
 * Proves that one latest ledger is the exact current source success projection.
 *
 * @param ledger - Candidate latest source apply ledger
 * @param bundleId - Bundle containing the Manifest entry
 * @param entry - Current strict Manifest source entry
 * @returns Whether Manifest success and reserved extension match the ledger
 */
function ledgerMatchesCurrentManifestEntry(
  ledger: KnowledgeApplyCommitLedgerRecord,
  bundleId: string,
  entry: SourceManifestEntry
): boolean {
  const success = entry.lastSuccessful;
  const extension = parseKnowledgeRuntimeSourceCommitExtension(
    entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
  );
  return (
    success !== undefined &&
    extension.ok &&
    ledger.bundleId === bundleId &&
    ledger.sourceId === entry.sourceId &&
    ledger.sourceContentHash === success.sourceContentHash &&
    ledger.pipelineFingerprint === success.pipelineFingerprint &&
    ledger.changeSetId === success.changeSetId &&
    ledger.recordedAt === success.completedAt &&
    ledger.transactionId === extension.value.transactionId &&
    ledger.inputRevision === extension.value.inputRevision &&
    ledger.manifestIntentDigest === extension.value.manifestIntentDigest
  );
}

/** Creates one deeply immutable detached citation projection. */
function freezeAppliedClaimCitation(citation: ClaimCitation): Readonly<ClaimCitation> {
  return Object.freeze({
    ...citation,
    locator: Object.freeze({ ...citation.locator }),
  });
}

/** Creates one deeply immutable detached accepted-source projection. */
function freezeAppliedSourceProvenance(
  source: KnowledgeRuntimeAppliedSourceProvenance
): Readonly<KnowledgeRuntimeAppliedSourceProvenance> {
  const citations = source.citations.map(freezeAppliedClaimCitation);
  return Object.freeze({
    ...source,
    citations: Object.freeze(citations),
  });
}

/** Creates one deeply immutable detached applied-page projection. */
function freezeAppliedPageProvenance(
  page: KnowledgeRuntimeAppliedPageProvenance
): Readonly<KnowledgeRuntimeAppliedPageProvenance> {
  return Object.freeze({
    ...page,
    sources: Object.freeze([...page.sources]),
  });
}

/** Creates one deeply immutable detached Runtime provenance snapshot. */
function freezeAppliedProvenanceSnapshot(
  snapshot: KnowledgeRuntimeAppliedProvenanceSnapshot
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  return Object.freeze({
    ...snapshot,
    pages: Object.freeze([...snapshot.pages]),
  });
}

/**
 * Resolves one current source to exactly one latest ledger and accepted Review.
 *
 * @param state - Complete strict Runtime snapshot
 * @param manifest - Current strict Bundle Manifest
 * @param review - Current strict Review snapshot, or undefined when absent
 * @param entry - Current Manifest source entry
 * @returns Accepted source commit evidence, or undefined when proof is incomplete
 */
function projectAppliedSourceCommitEvidence(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  review: ChangeSetReviewSnapshot | undefined,
  entry: SourceManifestEntry
): AppliedSourceCommitEvidence | undefined {
  if (!entry.lastSuccessful || !review) return undefined;
  const ledger = findLatestSourceApplyLedger(state.applyCommits, manifest.bundleId, entry.sourceId);
  if (!ledger || !ledgerMatchesCurrentManifestEntry(ledger, manifest.bundleId, entry)) {
    return undefined;
  }
  const accepted = review.records.filter(
    (record): record is AcceptedChangeSetReviewRecord =>
      record.outcome === "accepted" &&
      ledgerMatchesAcceptedRecord(ledger, manifest.bundleId, record)
  );
  if (accepted.length !== 1) return undefined;
  const record = accepted[0];
  const citations = record.acceptedChangeSet.citations
    .filter((citation) => citation.locator.sourceId === entry.sourceId)
    .map((citation) => cloneJson(citation));
  if (citations.length === 0) return undefined;
  return {
    record,
    provenance: freezeAppliedSourceProvenance({
      sourceId: entry.sourceId,
      sourcePath: entry.sourcePath,
      custody: entry.custody,
      sourceContentHash: ledger.sourceContentHash,
      pipelineFingerprint: ledger.pipelineFingerprint,
      inputRevision: ledger.inputRevision,
      changeSetId: ledger.changeSetId,
      changeSetDigest: ledger.changeSetDigest,
      acceptedAt: record.acceptedAt,
      citations,
    }),
  };
}

/** Exact accepted commit retained internally while projecting current pages. */
interface AppliedSourceCommitEvidence {
  record: AcceptedChangeSetReviewRecord;
  provenance: Readonly<KnowledgeRuntimeAppliedSourceProvenance>;
}

/**
 * Proves that an accepted commit wrote this exact current page version.
 *
 * Retained Manifest pages that were not changed by the latest source commit are
 * intentionally excluded because that Review's citations cannot ground them.
 *
 * @param evidence - Exact latest ledger-backed accepted Review
 * @param sourceId - Manifest source claiming the current page
 * @param page - Current content-addressed Manifest page
 * @returns Whether one exact accepted create/update produced this page version
 */
function acceptedCommitWroteCurrentPage(
  evidence: AppliedSourceCommitEvidence,
  sourceId: string,
  page: Pick<KnowledgeRuntimeAppliedPageProvenance, "path" | "contentHash">
): boolean {
  const windowsPathKey = toWindowsPathKey(page.path);
  const matches = evidence.record.acceptedChangeSet.changes.filter(
    (change) =>
      (change.operation === "create" || change.operation === "update") &&
      toWindowsPathKey(change.path) === windowsPathKey &&
      change.afterHash === page.contentHash &&
      change.sourceRefs.includes(sourceId)
  );
  return matches.length === 1;
}

/** Mutable grouping used only while de-duplicating current Manifest pages. */
interface AppliedPageAccumulator {
  path: string;
  windowsPathKey: string;
  ownership: GeneratedPageOwnership;
  contentHash: string;
  sourceIds: Set<string>;
}

/**
 * Projects current pages with at least one exact accepted current-version writer.
 *
 * Shared pages conservatively retain only writers whose own committed change
 * proves the current after-hash; historical co-owners are not projected.
 *
 * @param state - Complete strict Runtime snapshot
 * @param manifest - Current strict Bundle Manifest
 * @param review - Current strict Review snapshot, or undefined when absent
 * @returns Stable frozen current-page projection
 */
function projectAppliedManifestPages(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  review: ChangeSetReviewSnapshot | undefined
): readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[] {
  const sourceEvidence = new Map<string, AppliedSourceCommitEvidence>();
  const pages = new Map<string, AppliedPageAccumulator>();
  for (const entry of manifest.entries) {
    const evidence = projectAppliedSourceCommitEvidence(state, manifest, review, entry);
    if (evidence) sourceEvidence.set(entry.sourceId, evidence);
    for (const page of entry.lastSuccessful?.generatedPages ?? []) {
      if (page.contentHash === undefined) throw new KnowledgeRuntimeStoreCorruptError();
      const windowsPathKey = toWindowsPathKey(page.path);
      const existing = pages.get(windowsPathKey);
      if (!existing) {
        pages.set(windowsPathKey, {
          path: page.path,
          windowsPathKey,
          ownership: page.ownership,
          contentHash: page.contentHash,
          sourceIds: new Set([entry.sourceId]),
        });
        continue;
      }
      if (
        existing.path !== page.path ||
        existing.ownership !== page.ownership ||
        existing.contentHash !== page.contentHash ||
        existing.sourceIds.has(entry.sourceId)
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      existing.sourceIds.add(entry.sourceId);
    }
  }

  const projectedPages: Readonly<KnowledgeRuntimeAppliedPageProvenance>[] = [];
  for (const page of pages.values()) {
    const sourceIds = [...page.sourceIds].sort(compareIdentifiers);
    const sources = sourceIds.flatMap((sourceId) => {
      const evidence = sourceEvidence.get(sourceId);
      return evidence && acceptedCommitWroteCurrentPage(evidence, sourceId, page)
        ? [evidence.provenance]
        : [];
    });
    if (sources.length === 0) continue;
    projectedPages.push(
      freezeAppliedPageProvenance({
        path: page.path,
        windowsPathKey: page.windowsPathKey,
        ownership: page.ownership,
        contentHash: page.contentHash,
        sources,
      })
    );
  }
  projectedPages.sort((left, right) =>
    compareIdentifiers(left.windowsPathKey, right.windowsPathKey)
  );
  return Object.freeze(projectedPages);
}

/**
 * Compares an active journal's immutable accepted material with one Review record.
 *
 * @param journal - Strict global active transaction journal
 * @param bundleId - Bundle containing the Review record
 * @param record - Exact accepted Review record
 * @returns Whether the journal belongs to this accepted decision
 */
function transactionMatchesAcceptedRecord(
  journal: ChangeSetTransactionJournal,
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    journal.bundleId === bundleId &&
    journal.changeSetId === record.changeSetId &&
    journal.changeSetDigest === record.acceptedDigest &&
    journal.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    reviewClaimMatchesTransaction(record, journal) &&
    exactJsonValuesEqual(journal.changeSet, record.acceptedChangeSet) &&
    exactJsonValuesEqual(journal.manifestCommitIntent, record.manifestCommitIntent)
  );
}

/**
 * Reports whether a queue job still occupies source execution capacity.
 *
 * @param job - Durable Queue job
 * @returns Whether a retained rerun must wait for this job
 */
function isActiveNoJournalQueueJob(job: KnowledgeIngestJob): boolean {
  return job.status !== "failed" && job.status !== "completed" && job.status !== "cancelled";
}

/**
 * Promotes one retained latest rerun after the abandoned predecessor is terminal.
 *
 * @param snapshot - Queue already containing the cancelled predecessor
 * @param sourceId - Source whose retained rerun may be promoted
 * @param timestamp - Non-regressing promotion timestamp
 * @returns Queue with at most one newly promoted pending successor
 */
function promoteNoJournalRerun(
  snapshot: IngestQueueSnapshot,
  sourceId: string,
  timestamp: number
): IngestQueueSnapshot {
  const rerun = snapshot.reruns.find((candidate) => candidate.sourceId === sourceId);
  const existingSuccessor = snapshot.jobs.some(
    (job) => job.sourceId === sourceId && isActiveNoJournalQueueJob(job)
  );
  if (!rerun || existingSuccessor) {
    return snapshot;
  }
  const successor: KnowledgeIngestJob = {
    id: rerun.jobId,
    bundleId: snapshot.bundleId,
    sourceId: rerun.sourceId,
    sourceContentHash: rerun.sourceContentHash,
    pipelineFingerprint: rerun.pipelineFingerprint,
    inputRevision: rerun.inputRevision,
    attempt: 0,
    rerunRequested: false,
    createdAt: rerun.requestedAt,
    updatedAt: Math.max(timestamp, rerun.updatedAt),
    status: "pending",
    stage: "queued",
  };
  return {
    ...snapshot,
    jobs: [...snapshot.jobs, successor],
    reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== sourceId),
  };
}

/**
 * Re-proves the complete source-apply authority from one atomic runtime snapshot.
 *
 * The Queue claim proves the exact execution, the accepted Review proves
 * reviewed content and final Manifest intent, and the observation
 * namespaces prove neither Queue nor allocator state moved backwards. A newer
 * observation is legal while an older apply finishes; the strict Queue
 * validator has already required an exact rerun for a divergent newer payload.
 *
 * @param state - Complete runtime envelope observed inside one atomic transform
 * @param journal - Prepared or committed transaction under proof
 */
function assertApplyCommitRuntimeAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  journal: KnowledgeApplyRuntimeIdentity
): void {
  const queueRaw = findBundleSlot(state, "queues", journal.bundleId);
  if (queueRaw === null) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_missing");
  }
  const queueResult = parseIngestQueueSnapshot(queueRaw);
  if (!queueResult.ok || !validateIngestQueueSnapshot(queueRaw).valid) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_mismatch");
  }
  const queue = queueResult.value;
  const claim = queue.applyClaim;
  if (!claim) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_missing");
  }
  const job = queue.jobs.find((candidate) => candidate.id === journal.jobClaim.jobId);
  const applyingJobMatches =
    job !== undefined &&
    (job.status === "processing" || job.status === "failed") &&
    job.stage === "applying" &&
    job.sourceId === journal.jobClaim.sourceId &&
    job.sourceContentHash === journal.jobClaim.sourceContentHash &&
    job.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    job.inputRevision === journal.jobClaim.inputRevision &&
    job.attempt === journal.jobClaim.attempt &&
    (job.status === "failed" || job.startedAt === journal.jobClaim.startedAt);
  if (!applyingJobMatches || !queueClaimMatchesTransaction(claim, journal)) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_mismatch");
  }

  const highWatermark = queue.sourceHighWatermarks.find(
    (candidate) => candidate.sourceId === journal.jobClaim.sourceId
  );
  if (!highWatermark) {
    throw new KnowledgeApplyCommitAuthorityError(
      journal.transactionId,
      "source_high_watermark_missing"
    );
  }
  if (
    highWatermark.inputRevision < journal.jobClaim.inputRevision ||
    (highWatermark.inputRevision === journal.jobClaim.inputRevision &&
      (highWatermark.sourceContentHash !== journal.jobClaim.sourceContentHash ||
        highWatermark.pipelineFingerprint !== journal.jobClaim.pipelineFingerprint))
  ) {
    throw new KnowledgeApplyCommitAuthorityError(
      journal.transactionId,
      "source_high_watermark_mismatch"
    );
  }
  const highWatermarkHasNewPayload =
    highWatermark.inputRevision > journal.jobClaim.inputRevision &&
    (highWatermark.sourceContentHash !== journal.jobClaim.sourceContentHash ||
      highWatermark.pipelineFingerprint !== journal.jobClaim.pipelineFingerprint);
  if (highWatermarkHasNewPayload) {
    const exactRetainedRerun = queue.reruns.some(
      (candidate) =>
        candidate.sourceId === highWatermark.sourceId &&
        candidate.inputRevision === highWatermark.inputRevision &&
        candidate.sourceContentHash === highWatermark.sourceContentHash &&
        candidate.pipelineFingerprint === highWatermark.pipelineFingerprint
    );
    const exactPromotedSuccessor = queue.jobs.some(
      (candidate) =>
        candidate.id !== job.id &&
        (candidate.status === "pending" || candidate.status === "paused") &&
        candidate.sourceId === highWatermark.sourceId &&
        candidate.inputRevision === highWatermark.inputRevision &&
        candidate.sourceContentHash === highWatermark.sourceContentHash &&
        candidate.pipelineFingerprint === highWatermark.pipelineFingerprint
    );
    if (!exactRetainedRerun && !exactPromotedSuccessor) {
      throw new KnowledgeApplyCommitAuthorityError(
        journal.transactionId,
        "source_high_watermark_mismatch"
      );
    }
  }
  const revisionBundle = state.inputRevisions.find(
    (candidate) => candidate.bundleId === journal.bundleId
  );
  const allocatedRevision = revisionBundle?.sources.find(
    (candidate) => candidate.sourceId === journal.jobClaim.sourceId
  );
  if (!allocatedRevision) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "input_revision_missing");
  }
  if (allocatedRevision.inputRevision < highWatermark.inputRevision) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "input_revision_behind");
  }

  if (claim.legacyReview) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }
  if (!claim.reviewedChangeSet) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }
  const acceptedReview = claim.acceptedReview;
  if (
    !acceptedReview ||
    claim.reviewedChangeSet.changeSetId !== journal.changeSetId ||
    claim.reviewedChangeSet.changeSetDigest !== journal.changeSetDigest ||
    acceptedReview.manifestCommitIntentDigest !== journal.manifestCommitIntentDigest
  ) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }

  const reviewRaw = findBundleSlot(state, "reviews", journal.bundleId);
  if (reviewRaw === null) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_missing");
  }
  const reviewResult = parseChangeSetReviewSnapshot(reviewRaw);
  if (!reviewResult.ok || !validateChangeSetReviewSnapshot(reviewResult.value).valid) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_mismatch");
  }
  const record = reviewResult.value.records.find(
    (candidate) => candidate.changeSetId === journal.changeSetId
  );
  if (!record) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_missing");
  }
  if (
    record.outcome !== "accepted" ||
    record.recordRevision !== acceptedReview.recordRevision ||
    record.proposalDigest !== acceptedReview.proposalDigest ||
    record.acceptedAt !== acceptedReview.acceptedAt ||
    record.acceptedDigest !== journal.changeSetDigest ||
    record.manifestCommitIntentDigest !== acceptedReview.manifestCommitIntentDigest ||
    record.manifestCommitIntentDigest !== journal.manifestCommitIntentDigest ||
    record.manifestCommitPlanDigest !== journal.manifestCommitIntent.manifestCommitPlanDigest ||
    !reviewClaimMatchesTransaction(record, journal) ||
    !exactJsonValuesEqual(record.acceptedChangeSet, journal.changeSet) ||
    !exactJsonValuesEqual(record.manifestCommitIntent, journal.manifestCommitIntent)
  ) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_mismatch");
  }
}

/**
 * Reads strict runtime-owned monotonic metadata from one source entry.
 *
 * @param entry - Current registered source entry
 * @param bundleId - Bundle used for sanitized typed errors
 * @returns Parsed metadata, or null when the extension is absent
 */
function readSourceCommitExtension(
  entry: SourceManifestEntry,
  bundleId: string
): KnowledgeRuntimeSourceCommitExtension | null {
  const raw = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
  if (raw === undefined) {
    return null;
  }
  const parsed = parseKnowledgeRuntimeSourceCommitExtension(raw);
  if (!parsed.ok) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_invalid"
    );
  }
  return parsed.value;
}

/** Reads and validates the Runtime-owned no-change success marker from one source. */
function readSourceNoChangesCommitMarker(
  entry: SourceManifestEntry
): NoChangesManifestCommitMarker | null {
  const raw = entry.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
  if (raw === undefined) return null;
  const parsed = parseKnowledgeNoChangesCommitMarker(raw);
  if (!parsed.ok || !validateNoChangesManifestCommitMarker(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parsed.value;
}

/**
 * Requires an incoming source observation to follow its last exact ledger commit.
 *
 * @param entry - Current registered source entry
 * @param bundleId - Owning Bundle id
 * @param inputRevision - Incoming durable source observation revision
 * @param manifest - Actual current Manifest containing the source
 * @param ledger - Complete retained exact-commit ledger
 */
function assertSourceInputRevisionCanCommit(
  entry: SourceManifestEntry,
  bundleId: string,
  inputRevision: number,
  manifest: SourceManifest,
  ledger: readonly KnowledgeApplyCommitLedgerRecord[]
): void {
  const previous = readSourceCommitExtension(entry, bundleId);
  const previousNoChanges = readSourceNoChangesCommitMarker(entry);
  if (entry.lastSuccessful !== undefined && previous === null) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_missing"
    );
  }
  if (entry.lastSuccessful === undefined && previous !== null) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_invalid"
    );
  }
  if (entry.lastSuccessful !== undefined && previous !== null) {
    const proof = ledger.find((record) => record.transactionId === previous.transactionId);
    if (
      !proof ||
      proof.bundleId !== bundleId ||
      proof.sourceId !== entry.sourceId ||
      proof.sourceContentHash !== entry.lastSuccessful.sourceContentHash ||
      proof.pipelineFingerprint !== entry.lastSuccessful.pipelineFingerprint ||
      proof.inputRevision !== previous.inputRevision ||
      proof.manifestIntentDigest !== previous.manifestIntentDigest ||
      proof.changeSetId !== entry.lastSuccessful.changeSetId ||
      proof.recordedAt !== entry.lastSuccessful.completedAt ||
      proof.manifestAfterRevision > manifest.revision ||
      (proof.manifestAfterRevision === manifest.revision &&
        proof.manifestAfterDigest !== createSourceManifestDigest(manifest))
    ) {
      throw new KnowledgeApplyCommitManifestConflictError(
        bundleId,
        entry.sourceId,
        "source_metadata_invalid"
      );
    }
  }
  const latestInputRevision = Math.max(
    previous?.inputRevision ?? 0,
    previousNoChanges?.inputRevision ?? 0
  );
  if (inputRevision <= latestInputRevision) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "input_revision_not_newer"
    );
  }
}

/**
 * Creates the complete next Manifest from a verified source-compile intent.
 *
 * @param manifest - Actual pre-commit Manifest observed atomically
 * @param source - Registered primary source entry
 * @param journal - Exact committed journal
 * @param receipt - Exact journal-derived receipt
 * @param intent - Valid final page projection
 * @returns Strict candidate Manifest at the next revision
 */
function createCommittedSourceManifest(
  manifest: SourceManifest,
  source: SourceManifestEntry,
  journal: CommittedChangeSetTransactionJournal,
  receipt: TransactionCommitReceipt,
  intent: ManifestCommitIntent
): SourceManifest {
  if (manifest.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeApplyCommitManifestConflictError(
      manifest.bundleId,
      source.sourceId,
      "revision_overflow"
    );
  }
  const snapshot: SourceCompileSnapshot = {
    sourceContentHash: journal.jobClaim.sourceContentHash,
    pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
    generatedPages: intent.generatedPages.map((page) => ({ ...page })),
    changeSetId: journal.changeSetId,
    completedAt: receipt.committedAt,
  };
  const extension: KnowledgeRuntimeSourceCommitExtension = {
    version: 1,
    inputRevision: journal.jobClaim.inputRevision,
    transactionId: journal.transactionId,
    manifestIntentDigest: journal.manifestCommitIntentDigest,
  };
  const extensions: Record<string, JsonValue> = {
    ...source.extensions,
    [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: extension as unknown as JsonValue,
  };
  delete extensions[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
  const nextEntry: SourceManifestEntry = {
    ...source,
    lastSuccessful: snapshot,
    extensions,
  };
  if (
    nextEntry.lastFailure !== undefined &&
    nextEntry.lastFailure.failure.occurredAt <= receipt.committedAt
  ) {
    delete nextEntry.lastFailure;
  }
  const writtenTargets = new Map(
    journal.changeSet.changes.flatMap((change) =>
      change.operation === "delete"
        ? []
        : [
            [
              toWindowsPathKey(change.path),
              { contentHash: change.afterHash, sourceRefs: new Set(change.sourceRefs) },
            ] as const,
          ]
    )
  );
  return {
    ...manifest,
    revision: manifest.revision + 1,
    entries: manifest.entries.map((entry) => {
      if (entry.sourceId === source.sourceId) {
        return nextEntry;
      }
      if (!entry.lastSuccessful) {
        return entry;
      }
      let changed = false;
      const generatedPages = entry.lastSuccessful.generatedPages.map((page) => {
        const written = writtenTargets.get(toWindowsPathKey(page.path));
        if (!written || !written.sourceRefs.has(entry.sourceId)) {
          return page;
        }
        changed = changed || page.contentHash !== written.contentHash;
        return { ...page, contentHash: written.contentHash };
      });
      return changed
        ? { ...entry, lastSuccessful: { ...entry.lastSuccessful, generatedPages } }
        : entry;
    }),
  };
}

/**
 * Compares optional JSON values independently of object insertion order.
 *
 * @param left - First optional JSON value
 * @param right - Second optional JSON value
 * @returns Whether absence or canonical JSON is exact
 */
function optionalJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

/**
 * Prevents generic Manifest storage from bypassing the exact success ledger path.
 *
 * @param current - Actual Manifest currently stored, or null before first creation
 * @param candidate - Complete generic Manifest replacement
 */
function assertGenericManifestPreservesCommitState(
  current: SourceManifest | null,
  candidate: SourceManifest
): void {
  const currentEntries = new Map(
    (current?.entries ?? []).map((entry) => [entry.sourceId, entry] as const)
  );
  const candidateEntries = new Map(
    candidate.entries.map((entry) => [entry.sourceId, entry] as const)
  );
  const sourceIds = new Set([...currentEntries.keys(), ...candidateEntries.keys()]);
  for (const sourceId of sourceIds) {
    const before = currentEntries.get(sourceId);
    const after = candidateEntries.get(sourceId);
    if (!optionalJsonValuesEqual(before?.lastSuccessful, after?.lastSuccessful)) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "last_successful"
      );
    }
    if (
      !optionalJsonValuesEqual(
        before?.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY],
        after?.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
      )
    ) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "reserved_commit_extension"
      );
    }
    if (
      !optionalJsonValuesEqual(
        before?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY],
        after?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
      )
    ) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "reserved_no_changes_extension"
      );
    }
  }
}

/**
 * Produces a detached JSON clone and rejects non-JSON input.
 *
 * @param value - JSON-compatible runtime value
 * @returns Detached value with no shared references
 */
function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

/**
 * Parses exact runtime file text without exposing parser details or raw bytes.
 *
 * @param text - Complete atomic runtime file contents
 * @returns Detached strict runtime snapshot
 */
function parseRuntimeText(text: string): KnowledgeRuntimeStoreSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parseKnowledgeRuntimeStoreSnapshot(value);
}

/**
 * Checks whether an unknown JSON value exposes named fields.
 *
 * @param value - Unknown parsed JSON value
 * @returns Whether the value is a non-array record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses exact runtime text without assuming its outer-envelope version.
 *
 * @param text - Complete persisted runtime text
 * @returns Unknown parsed JSON value
 */
function parseUnknownRuntimeText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

/**
 * Strictly validates one queue retained by a legacy outer envelope.
 *
 * @param slot - Legacy Bundle queue slot
 * @returns Detached current queue snapshot
 */
function requireLegacyQueueSlot(slot: KnowledgeRuntimeBundleSlot): IngestQueueSnapshot {
  const parsed = parseIngestQueueSnapshot(slot.value);
  if (
    !parsed.ok ||
    !validateIngestQueueSnapshot(slot.value).valid ||
    parsed.value.bundleId !== slot.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return cloneJson(parsed.value);
}

/**
 * Strictly validates one Manifest retained by a legacy outer envelope.
 *
 * @param slot - Legacy Bundle Manifest slot
 */
function assertLegacyManifestSlot(slot: KnowledgeRuntimeBundleSlot): void {
  const parsed = parseSourceManifest(slot.value);
  if (
    !parsed.ok ||
    !validateSourceManifest(slot.value).valid ||
    parsed.value.bundleId !== slot.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  for (const entry of parsed.value.entries) {
    if (entry.lastSuccessful !== undefined) {
      throw new KnowledgeRuntimeMigrationUnsafeError("manifest_success_present", slot.bundleId);
    }
    if (entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY] !== undefined) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "manifest_reserved_commit_metadata_present",
        slot.bundleId
      );
    }
  }
}

/**
 * Migrates one empty legacy Review slot without fabricating record-level intent.
 *
 * @param slot - Legacy outer-envelope Review slot
 * @returns Strict empty Review-v2 slot
 */
function migrateLegacyReviewSlot(slot: KnowledgeRuntimeBundleSlot): KnowledgeRuntimeBundleSlot {
  if (isRecord(slot.value) && slot.value.version === CHANGESET_REVIEW_SNAPSHOT_VERSION) {
    const parsed = parseChangeSetReviewSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (parsed.value.records.length > 0) {
      throw new KnowledgeRuntimeMigrationUnsafeError("review_records_present", slot.bundleId);
    }
    return { bundleId: slot.bundleId, value: cloneJson(parsed.value) };
  }

  const parsed = legacyEmptyReviewSnapshotSchema.safeParse(slot.value);
  if (!parsed.success || parsed.data.bundleId !== slot.bundleId) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  if (parsed.data.records.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("review_records_present", slot.bundleId);
  }
  return {
    bundleId: slot.bundleId,
    value: {
      version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
      bundleId: parsed.data.bundleId,
      revision: parsed.data.revision,
      records: [],
    },
  };
}

/**
 * Rejects Queue states whose in-flight review or apply evidence cannot be upgraded safely.
 *
 * @param snapshot - Strict Queue-v3 snapshot retained by runtime v1
 */
function assertLegacyQueueIsMigrationSafe(snapshot: IngestQueueSnapshot): void {
  if (snapshot.pendingReviews.length > 0 || snapshot.reviewRejections.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_review_state_present", snapshot.bundleId);
  }
  if (
    snapshot.applyClaim !== undefined ||
    snapshot.applyCommit !== undefined ||
    snapshot.applyAbandonments.length > 0
  ) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_apply_state_present", snapshot.bundleId);
  }
  if (snapshot.jobs.some((job) => job.status === "awaiting_review" || job.stage === "applying")) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_active_job_present", snapshot.bundleId);
  }
}

/**
 * Adds the v3 observation journal without inventing tokens for legacy inputs.
 *
 * @param value - Strictly shaped runtime-v2 JSON
 * @param runtimeId - New stable runtime identity generated outside the transform
 * @returns Strict detached runtime-v3 snapshot
 */
function migrateRuntimeV2ToV3Snapshot(
  value: unknown,
  runtimeId: string
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = runtimeV2StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const previous = parsed.data;
  assertUniqueBundleSlots(previous.queues);
  assertUniqueBundleSlots(previous.reviews);
  assertUniqueBundleSlots(previous.manifests);
  assertUniqueInputRevisionRecords(previous.inputRevisions);
  assertUniqueApplyCommits(previous.applyCommits);
  if (previous.revision >= Number.MAX_SAFE_INTEGER - 1) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const queues = new Map<string, IngestQueueSnapshot>();
  for (const slot of previous.queues) {
    const queue = parseIngestQueueSnapshot(slot.value);
    if (
      !queue.ok ||
      !validateIngestQueueSnapshot(queue.value).valid ||
      queue.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    queues.set(slot.bundleId, queue.value);
  }
  for (const [bundleId, queue] of queues) {
    const previousSources = previous.inputRevisions.find(
      (candidate) => candidate.bundleId === bundleId
    )?.sources;
    for (const watermark of queue.sourceHighWatermarks) {
      const allocated = previousSources?.find(
        (candidate) => candidate.sourceId === watermark.sourceId
      );
      if (!allocated || allocated.inputRevision < watermark.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
  const inputRevisions: KnowledgeRuntimeInputRevisionBundle[] = previous.inputRevisions.map(
    (bundle) => {
      const queue = queues.get(bundle.bundleId);
      return {
        bundleId: bundle.bundleId,
        sources: bundle.sources.map((source) => {
          const legacyCheckpoint = queue?.sourceHighWatermarks.find(
            (candidate) => candidate.sourceId === source.sourceId
          );
          return {
            sourceId: source.sourceId,
            inputRevision: source.inputRevision,
            managedAfterRevision: source.inputRevision,
            ...(legacyCheckpoint === undefined
              ? {}
              : { legacyCheckpoint: cloneJson(legacyCheckpoint) }),
            observations: [],
          };
        }),
      };
    }
  );
  const migrated: PreviousKnowledgeRuntimeStoreSnapshot = {
    ...previous,
    version: PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION,
    runtimeId,
    revision: previous.revision + 1,
    inputRevisions,
  };
  const validated = previousKnowledgeRuntimeStoreSnapshotSchema.safeParse(migrated);
  if (!validated.success) throw new KnowledgeRuntimeStoreCorruptError();
  assertUniqueBundleSlots(validated.data.queues);
  assertUniqueBundleSlots(validated.data.reviews);
  assertUniqueBundleSlots(validated.data.manifests);
  assertUniqueInputRevisionRecords(validated.data.inputRevisions);
  assertUniqueApplyCommits(validated.data.applyCommits);
  assertRuntimeSlotSemantics(validated.data, false);
  return cloneJson(validated.data);
}

/** Creates the pending projection used to re-run one unproved legacy completion. */
function demoteLegacyCompletedJob(job: ReusableCompletedJob): KnowledgeIngestJob {
  return {
    id: job.id,
    bundleId: job.bundleId,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    rerunRequested: false,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: "pending",
    stage: "queued",
  };
}

/**
 * Demotes current legacy completions that have no durable success proof.
 *
 * Queue history, attempts, observations, reruns, and source high-watermarks are
 * retained byte-for-byte. Only the unsafe terminal projection changes, along
 * with the startup execution gate when the Queue was running.
 */
function migrateRuntimeV3Queue(
  previous: PreviousKnowledgeRuntimeStoreSnapshot,
  queue: IngestQueueSnapshot,
  manifest: SourceManifest | undefined
): IngestQueueSnapshot {
  const demotedJobIds = new Set<string>();
  for (const highWatermark of queue.sourceHighWatermarks) {
    const outcome = findCurrentSourceTerminalOutcome(queue, highWatermark);
    if (outcome.kind === "invalid") {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      outcome.kind === "completed" &&
      !reusableCompletionHasProof(previous, manifest, outcome.job)
    ) {
      demotedJobIds.add(outcome.job.id);
    }
  }
  if (demotedJobIds.size === 0) return cloneJson(queue);
  if (queue.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_revision_overflow", queue.bundleId);
  }
  const jobs = queue.jobs.map((job) =>
    job.status === "completed" && demotedJobIds.has(job.id) ? demoteLegacyCompletedJob(job) : job
  );
  const pausedAt = Math.max(
    0,
    ...jobs
      .filter((job) => demotedJobIds.has(job.id))
      .map((job) => Math.max(job.createdAt, job.updatedAt))
  );
  const candidate: IngestQueueSnapshot = {
    ...queue,
    revision: queue.revision + 1,
    control:
      queue.control.status === "running"
        ? {
            status: "paused",
            reason: "startup_recovery",
            pausedAt,
            detail: "Legacy completion requires one proof-producing restart run",
          }
        : queue.control,
    jobs,
  };
  const parsed = parseIngestQueueSnapshot(candidate);
  if (!parsed.ok || !validateIngestQueueSnapshot(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return cloneJson(parsed.value);
}

/** Strictly parses one runtime-v3 envelope without imposing v4-only semantics. */
function parsePreviousKnowledgeRuntimeStoreSnapshot(
  value: unknown
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = previousKnowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot, false);
  return cloneJson(snapshot);
}

/** Adds the v4 exact-completion proof fence through one atomic transform. */
function migrateRuntimeV3ToV4Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  const previous = parsePreviousKnowledgeRuntimeStoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const manifests = new Map<string, SourceManifest>();
  for (const slot of previous.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    manifests.set(slot.bundleId, parsed.value);
  }
  const queues = previous.queues.map((slot) => {
    const parsed = parseIngestQueueSnapshot(slot.value);
    if (!parsed.ok || !validateIngestQueueSnapshot(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    return {
      bundleId: slot.bundleId,
      value: migrateRuntimeV3Queue(previous, parsed.value, manifests.get(slot.bundleId)),
    };
  });
  return parseKnowledgeRuntimeStoreSnapshot({
    ...previous,
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    revision: previous.revision + 1,
    queues,
  });
}

/**
 * Performs the constrained v1 migration and adds the v3 observation journal.
 *
 * The migration preserves Queue, Manifest, and scalar allocator floors,
 * upgrades empty Review slots, and refuses all states carrying recovery work.
 * Both format changes occur inside one atomic file transform.
 *
 * @param value - Unknown parsed runtime JSON
 * @param runtimeId - New stable runtime identity generated outside the transform
 * @returns Strict detached runtime-v3 snapshot
 */
function migrateLegacyRuntimeSnapshot(
  value: unknown,
  runtimeId: string
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = legacyKnowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const legacy = parsed.data;
  assertUniqueBundleSlots(legacy.queues);
  assertUniqueBundleSlots(legacy.reviews);
  assertUniqueBundleSlots(legacy.manifests);
  assertUniqueInputRevisionRecords(legacy.inputRevisions);

  if (legacy.activeTransaction !== null) {
    throw new KnowledgeRuntimeMigrationUnsafeError("active_transaction_present");
  }
  if (legacy.applyCommits.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("apply_commit_ledger_present");
  }
  if (legacy.revision >= Number.MAX_SAFE_INTEGER - 1) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }

  for (const slot of legacy.queues) {
    assertLegacyQueueIsMigrationSafe(requireLegacyQueueSlot(slot));
  }
  for (const slot of legacy.manifests) {
    assertLegacyManifestSlot(slot);
  }
  const reviews = legacy.reviews.map(migrateLegacyReviewSlot);
  const previous: KnowledgeRuntimeStoreSnapshotV2 = {
    version: RUNTIME_V2_STORE_VERSION,
    revision: legacy.revision,
    queues: legacy.queues,
    reviews,
    manifests: legacy.manifests,
    activeTransaction: null,
    inputRevisions: legacy.inputRevisions,
    applyCommits: [],
  };
  return migrateRuntimeV2ToV3Snapshot(previous, runtimeId);
}

/**
 * Compares identifiers using deterministic code-unit ordering.
 *
 * @param left - First identifier
 * @param right - Second identifier
 * @returns Negative, zero, or positive ordering result
 */
function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Creates the strict revision-zero Queue observed before a Bundle has durable work.
 *
 * @param bundleId - Bundle whose Queue slot is absent
 * @returns Detached empty current-version Queue snapshot
 */
function createEmptyRuntimeQueueSnapshot(bundleId: string): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

/**
 * Creates the strict revision-zero Review Store observed before a Bundle has records.
 *
 * @param bundleId - Bundle whose Review slot is absent
 * @returns Detached empty current-version Review snapshot
 */
function createEmptyRuntimeReviewSnapshot(bundleId: string): ChangeSetReviewSnapshot {
  return {
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId,
    revision: 0,
    records: [],
  };
}

/** Detects Queue state proving that startup write recovery is still unresolved. */
function queueHasStartupWriteRecoveryEvidence(snapshot: IngestQueueSnapshot): boolean {
  return (
    snapshot.applyClaim !== undefined ||
    snapshot.applyCommit !== undefined ||
    (snapshot.control.status === "paused" &&
      (snapshot.control.reason === "recovery_required" ||
        snapshot.control.reason === "commit_pending_ack")) ||
    snapshot.jobs.some(
      (job) => job.status === "processing" || (job.status === "failed" && job.stage === "applying")
    )
  );
}

/** Selects accepted Review classifications that are terminal for startup release. */
function acceptedClassificationIsTerminal(
  classification: NoJournalApplyRecoveryClassification
): boolean {
  return classification.kind === "committed" || classification.kind === "abandoned";
}

/** Checks whether one Queue job retains the immutable identity of an apply claim. */
function queueJobMatchesApplyClaim(
  job: KnowledgeIngestJob | undefined,
  claim: IngestApplyClaimMarker
): job is KnowledgeIngestJob {
  return (
    job !== undefined &&
    job.id === claim.jobId &&
    job.sourceId === claim.sourceId &&
    job.sourceContentHash === claim.sourceContentHash &&
    job.pipelineFingerprint === claim.pipelineFingerprint &&
    job.inputRevision === claim.inputRevision &&
    job.attempt === claim.attempt &&
    (job.status !== "processing" || job.startedAt === claim.startedAt)
  );
}

/** Replaces one Queue job while preserving the order of every retained record. */
function replaceRuntimeQueueJob(
  snapshot: IngestQueueSnapshot,
  replacement: KnowledgeIngestJob
): IngestQueueSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => (job.id === replacement.id ? replacement : job)),
  };
}

/** Exact non-applying Queue transition that may publish no-change success. */
interface RuntimeNoChangesQueueTransition {
  processing: Extract<KnowledgeIngestJob, { status: "processing" }>;
  completed: Extract<KnowledgeIngestJob, { status: "completed" }>;
}

/** Reports whether a candidate attempts any non-applying Queue completion. */
function hasProtectedNoChangesCompletion(
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot
): boolean {
  if (!current) return false;
  return current.jobs.some((job) => {
    if (job.status !== "processing" || job.stage === "applying") return false;
    const next = candidate.jobs.find((candidateJob) => candidateJob.id === job.id);
    return next?.status === "completed";
  });
}

/** Reconstructs the only Queue projection accepted for a no-change commit. */
function projectRuntimeNoChangesQueueTransition(
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): RuntimeNoChangesQueueTransition | null {
  const processing = current.jobs.find(
    (job): job is Extract<KnowledgeIngestJob, { status: "processing" }> =>
      job.status === "processing" && job.stage !== "applying"
  );
  if (!processing) return null;
  const completed = candidate.jobs.find(
    (job): job is Extract<KnowledgeIngestJob, { status: "completed" }> =>
      job.id === processing.id && job.status === "completed"
  );
  if (!completed || completed.completedAt < Math.max(processing.updatedAt, processing.startedAt)) {
    return null;
  }
  const expectedCompleted: KnowledgeIngestJob = {
    id: processing.id,
    bundleId: processing.bundleId,
    sourceId: processing.sourceId,
    sourceContentHash: processing.sourceContentHash,
    pipelineFingerprint: processing.pipelineFingerprint,
    inputRevision: processing.inputRevision,
    attempt: processing.attempt,
    rerunRequested: false,
    createdAt: processing.createdAt,
    updatedAt: completed.completedAt,
    status: "completed",
    stage: "completed",
    changeSetId: completed.changeSetId,
    completedAt: completed.completedAt,
  };
  const expected = {
    ...promoteNoJournalRerun(
      replaceRuntimeQueueJob(current, expectedCompleted),
      processing.sourceId,
      completed.completedAt
    ),
    revision: current.revision + 1,
  };
  return exactJsonValuesEqual(expected, candidate) ? { processing, completed } : null;
}

/** Creates the exact Manifest revision published with a no-change Queue terminal. */
function createNoChangesCommittedManifest(
  manifest: SourceManifest,
  source: SourceManifestEntry,
  marker: NoChangesManifestCommitMarker
): SourceManifest {
  if (manifest.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      manifest.bundleId,
      source.sourceId,
      "revision_overflow"
    );
  }
  const nextEntry: SourceManifestEntry = {
    ...source,
    extensions: {
      ...source.extensions,
      [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: marker as unknown as JsonValue,
    },
  };
  if (
    nextEntry.lastFailure !== undefined &&
    nextEntry.lastFailure.failure.occurredAt <= marker.completedAt
  ) {
    delete nextEntry.lastFailure;
  }
  return {
    ...manifest,
    revision: manifest.revision + 1,
    entries: manifest.entries.map((entry) =>
      entry.sourceId === source.sourceId ? nextEntry : entry
    ),
  };
}

/** Validates and projects one atomic no-change Manifest mutation. */
function projectRuntimeNoChangesManifestCommit(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot,
  authority: Extract<QueueWriteAuthority, { kind: "no_changes_commit" }>
): SourceManifest {
  const transition = projectRuntimeNoChangesQueueTransition(current, candidate);
  const parsedPlan = parseNoChangesManifestCommitPlan(authority.plan);
  const fallbackSourceId = transition?.processing.sourceId ?? "unknown-source";
  if (
    !transition ||
    !parsedPlan.ok ||
    !validateNoChangesManifestCommitPlan(parsedPlan.ok ? parsedPlan.value : authority.plan).valid ||
    typeof authority.planDigest !== "string" ||
    createNoChangesManifestCommitPlanDigest(parsedPlan.value) !== authority.planDigest
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      fallbackSourceId,
      transition ? "authority_invalid" : "queue_mismatch"
    );
  }
  const { processing, completed } = transition;
  const plan = parsedPlan.value;
  if (
    plan.bundleId !== current.bundleId ||
    plan.sourceId !== processing.sourceId ||
    plan.sourceContentHash !== processing.sourceContentHash ||
    plan.pipelineFingerprint !== processing.pipelineFingerprint ||
    plan.inputRevision !== processing.inputRevision ||
    plan.noChangesId !== completed.changeSetId
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "queue_mismatch"
    );
  }
  if (state.activeTransaction !== null) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "transaction_active"
    );
  }
  const manifestRaw = findBundleSlot(state, "manifests", current.bundleId);
  if (manifestRaw === null) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "manifest_mismatch"
    );
  }
  const manifest = parseSourceManifest(manifestRaw);
  if (
    !manifest.ok ||
    manifest.value.revision !== plan.expectedManifestRevision ||
    createSourceManifestDigest(manifest.value) !== plan.expectedManifestDigest
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "manifest_mismatch"
    );
  }
  const source = manifest.value.entries.find((entry) => entry.sourceId === processing.sourceId);
  if (!source) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  let sourceAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
  try {
    sourceAuthority = deriveKnowledgeSourceCompileAuthority(source);
  } catch {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  const sourceAuthorityMatches =
    plan.kind === "query_writeback_source_compile"
      ? sourceAuthority.operation === "query_writeback" &&
        sourceAuthority.sourceOriginDigest === plan.sourceOriginDigest &&
        sourceAuthority.expectedSourceContentHash === plan.sourceContentHash
      : sourceAuthority.operation === "ingest";
  if (
    !sourceAuthorityMatches ||
    !noChangesBasePagesMatchSource(source, plan.baseGeneratedPages, false)
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  const previousApply = readSourceCommitExtension(source, current.bundleId);
  const previousNoChanges = readSourceNoChangesCommitMarker(source);
  if (
    processing.inputRevision <=
    Math.max(previousApply?.inputRevision ?? 0, previousNoChanges?.inputRevision ?? 0)
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "input_revision_not_newer"
    );
  }
  const observations =
    state.inputRevisions
      .find((bundle) => bundle.bundleId === current.bundleId)
      ?.sources.find((candidateSource) => candidateSource.sourceId === processing.sourceId)
      ?.observations.filter(
        (observation) =>
          observation.status === "consumed" &&
          observation.inputRevision === processing.inputRevision &&
          observation.sourceContentHash === processing.sourceContentHash &&
          observation.pipelineFingerprint === processing.pipelineFingerprint
      ) ?? [];
  if (observations.length !== 1) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "observation_mismatch"
    );
  }
  let marker: NoChangesManifestCommitMarker;
  try {
    marker = createKnowledgeNoChangesCommitMarker({
      plan,
      jobClaim: {
        jobId: processing.id,
        sourceId: processing.sourceId,
        sourceContentHash: processing.sourceContentHash,
        pipelineFingerprint: processing.pipelineFingerprint,
        inputRevision: processing.inputRevision,
        attempt: processing.attempt,
        startedAt: processing.startedAt,
      },
      completedAt: completed.completedAt,
      manifestAfterRevision: manifest.value.revision + 1,
    });
  } catch {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "authority_invalid"
    );
  }
  return createNoChangesCommittedManifest(manifest.value, source, marker);
}

/**
 * Reconstructs the only legal accepted-Review claim transition.
 *
 * @param state - Shared Runtime envelope containing the authoritative Review
 * @param current - Queue before the accepted claim is established
 * @param candidate - Proposed next Queue revision
 * @returns Whether candidate is the exact `beginReviewApply` projection
 */
function acceptedClaimProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const claim = candidate.applyClaim;
  const controlAllowsBegin =
    current.control.status === "running" ||
    (current.control.status === "paused" && current.control.reason === "startup_recovery");
  if (
    !controlAllowsBegin ||
    current.applyClaim !== undefined ||
    claim === undefined ||
    candidate.applyCommit !== undefined
  ) {
    return false;
  }
  const reviewRaw = findBundleSlot(state, "reviews", current.bundleId);
  if (reviewRaw === null) {
    return false;
  }
  const parsedReview = parseChangeSetReviewSnapshot(reviewRaw);
  if (!parsedReview.ok || !validateChangeSetReviewSnapshot(parsedReview.value).valid) {
    return false;
  }
  const record = parsedReview.value.records.find(
    (candidateRecord): candidateRecord is AcceptedChangeSetReviewRecord =>
      candidateRecord.outcome === "accepted" &&
      queueClaimMatchesAcceptedRecord(claim, candidateRecord)
  );
  const currentJob = current.jobs.find((job) => job.id === claim.jobId);
  const pending = current.pendingReviews.find((item) => item.jobId === claim.jobId);
  if (
    !record ||
    !currentJob ||
    currentJob.status !== "awaiting_review" ||
    currentJob.stage !== "review" ||
    currentJob.changeSetId !== record.changeSetId ||
    !queueJobMatchesAcceptedRecord(currentJob, record) ||
    pending?.kind !== "durable" ||
    pending.changeSetId !== record.changeSetId ||
    pending.proposalDigest !== record.proposalDigest ||
    pending.reviewRecordRevision !== 0 ||
    pending.recordedAt !== record.recordedAt ||
    claim.startedAt < Math.max(currentJob.updatedAt, record.acceptedAt)
  ) {
    return false;
  }

  const applying: KnowledgeIngestJob = {
    id: currentJob.id,
    bundleId: currentJob.bundleId,
    sourceId: currentJob.sourceId,
    sourceContentHash: currentJob.sourceContentHash,
    pipelineFingerprint: currentJob.pipelineFingerprint,
    inputRevision: currentJob.inputRevision,
    attempt: currentJob.attempt,
    rerunRequested: currentJob.rerunRequested,
    createdAt: currentJob.createdAt,
    updatedAt: claim.startedAt,
    status: "processing",
    stage: "applying",
    startedAt: claim.startedAt,
  };
  const expected: IngestQueueSnapshot = {
    ...replaceRuntimeQueueJob(current, applying),
    revision: current.revision + 1,
    pendingReviews: current.pendingReviews.filter((item) => item.jobId !== claim.jobId),
    applyClaim: {
      jobId: applying.id,
      sourceId: applying.sourceId,
      sourceContentHash: applying.sourceContentHash,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: applying.inputRevision,
      attempt: applying.attempt,
      startedAt: applying.startedAt,
      reviewedChangeSet: {
        changeSetId: record.changeSetId,
        changeSetDigest: record.acceptedDigest,
      },
      acceptedReview: {
        proposalDigest: record.proposalDigest,
        recordRevision: record.recordRevision,
        manifestCommitIntentDigest: record.manifestCommitIntentDigest,
        acceptedAt: record.acceptedAt,
      },
    },
  };
  return exactJsonValuesEqual(expected, candidate);
}

/**
 * Preserves every accepted-but-not-started Queue anchor across generic writes.
 *
 * Watcher enqueue may update only the active job's rerun flag and monotonic
 * timestamp. Starting one accepted apply is handled separately by the exact
 * accepted-claim projection and therefore never reaches this comparison.
 */
function acceptedNotStartedAnchorsArePreserved(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const reviewRaw = findBundleSlot(state, "reviews", current.bundleId);
  if (reviewRaw === null) {
    return true;
  }
  const parsedReview = parseChangeSetReviewSnapshot(reviewRaw);
  if (!parsedReview.ok || !validateChangeSetReviewSnapshot(parsedReview.value).valid) {
    return false;
  }
  for (const record of parsedReview.value.records) {
    if (record.outcome !== "accepted") {
      continue;
    }
    const currentJob = current.jobs.find((job) => job.id === record.jobClaim.jobId);
    const currentPending = current.pendingReviews.find(
      (pending) => pending.jobId === record.jobClaim.jobId
    );
    const isAcceptedNotStarted =
      queueJobMatchesAcceptedRecord(currentJob, record) &&
      currentJob.status === "awaiting_review" &&
      currentJob.stage === "review" &&
      currentJob.changeSetId === record.changeSetId &&
      currentPending?.kind === "durable" &&
      currentPending.changeSetId === record.changeSetId &&
      currentPending.proposalDigest === record.proposalDigest &&
      currentPending.reviewRecordRevision === 0 &&
      currentPending.recordedAt === record.recordedAt &&
      current.applyClaim?.jobId !== record.jobClaim.jobId;
    if (!isAcceptedNotStarted) {
      continue;
    }
    const candidateJob = candidate.jobs.find((job) => job.id === record.jobClaim.jobId);
    const candidatePending = candidate.pendingReviews.find(
      (pending) => pending.jobId === record.jobClaim.jobId
    );
    if (
      !protectedQueueJobProjectionMatches(currentJob, candidateJob) ||
      !exactJsonValuesEqual(currentPending, candidatePending)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Keeps Queue observations monotonic and consumes their exact bound journal entries.
 *
 * Every advance requires a first-write-wins binding for the same Bundle,
 * source, revision, content hash, and pipeline fingerprint. Queue replacement,
 * bound-to-consumed transition, and older-observation supersession are then
 * committed by the caller in the same shared-envelope transform.
 *
 * @param state - Current strict runtime envelope
 * @param current - Current Queue slot, or null before its first write
 * @param candidate - Candidate next Queue snapshot
 * @param settledAt - Runtime-owned settlement time
 * @param authority - Opaque capability presented by the enqueue caller
 * @returns Updated observation journals, or null when authority is invalid
 */
function consumeQueueSourceObservations(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot,
  settledAt: number,
  authority?: QueueWriteAuthority
): KnowledgeRuntimeInputRevisionBundle[] | null {
  const currentBySource = new Map(
    (current?.sourceHighWatermarks ?? []).map(
      (watermark) => [watermark.sourceId, watermark] as const
    )
  );
  const candidateBySource = new Map(
    candidate.sourceHighWatermarks.map((watermark) => [watermark.sourceId, watermark] as const)
  );

  for (const watermark of current?.sourceHighWatermarks ?? []) {
    const next = candidateBySource.get(watermark.sourceId);
    if (!next || next.inputRevision < watermark.inputRevision) {
      return null;
    }
    if (next.inputRevision === watermark.inputRevision) {
      if (!exactJsonValuesEqual(watermark, next)) {
        return null;
      }
      continue;
    }
    if (next.observedAt < watermark.observedAt) {
      return null;
    }
  }
  let inputRevisions = state.inputRevisions;
  for (const watermark of candidate.sourceHighWatermarks) {
    const previous = currentBySource.get(watermark.sourceId);
    if (previous && previous.inputRevision === watermark.inputRevision) {
      continue;
    }
    const source = inputRevisions
      .find((bundle) => bundle.bundleId === candidate.bundleId)
      ?.sources.find((candidateSource) => candidateSource.sourceId === watermark.sourceId);
    const observation = source?.observations.find(
      (candidateObservation) => candidateObservation.inputRevision === watermark.inputRevision
    );
    if (
      !source ||
      !observation ||
      observation.status !== "bound" ||
      authority?.kind !== "source_observation" ||
      authority.observationToken !== observation.observationToken ||
      observation.sourceContentHash !== watermark.sourceContentHash ||
      observation.pipelineFingerprint !== watermark.pipelineFingerprint
    ) {
      return null;
    }
    const observations: KnowledgeRuntimeSourceObservationRecord[] = source.observations.map(
      (candidateObservation) => {
        if (candidateObservation.observationToken === observation.observationToken) {
          return {
            ...observation,
            status: "consumed" as const,
            settledAt: Math.max(settledAt, observation.boundAt),
            queueRevision: candidate.revision,
          };
        }
        if (
          candidateObservation.inputRevision < observation.inputRevision &&
          (candidateObservation.status === "allocated" || candidateObservation.status === "bound")
        ) {
          return {
            observationToken: candidateObservation.observationToken,
            captureId: candidateObservation.captureId,
            inputRevision: candidateObservation.inputRevision,
            allocatedAt: candidateObservation.allocatedAt,
            status: "superseded" as const,
            ...(candidateObservation.status === "bound"
              ? {
                  sourceContentHash: candidateObservation.sourceContentHash,
                  pipelineFingerprint: candidateObservation.pipelineFingerprint,
                  boundAt: candidateObservation.boundAt,
                }
              : {}),
            settledAt: Math.max(
              settledAt,
              candidateObservation.allocatedAt,
              candidateObservation.status === "bound" ? candidateObservation.boundAt : 0
            ),
            supersededByInputRevision: observation.inputRevision,
          };
        }
        return candidateObservation;
      }
    );
    inputRevisions = replaceInputRevisionSource(inputRevisions, candidate.bundleId, {
      ...source,
      observations,
    });
  }
  return inputRevisions;
}

/**
 * Reconstructs startup recovery of one exact interrupted applying claim.
 *
 * @param current - Queue still carrying a processing apply behind the startup gate
 * @param candidate - Proposed sticky recovery-required Queue revision
 * @returns Whether candidate is the exact `recoverOnStartup` projection
 */
function startupApplyRecoveryProjectionMatches(
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (
    candidate.control.status !== "paused" ||
    candidate.control.reason !== "recovery_required" ||
    current.applyClaim === undefined
  ) {
    return false;
  }
  const claim = current.applyClaim;
  const applying = current.jobs.find((job) => job.id === claim.jobId);
  if (
    !queueJobMatchesApplyClaim(applying, claim) ||
    applying.status !== "processing" ||
    applying.stage !== "applying"
  ) {
    return false;
  }
  const recoveredAt = Math.max(candidate.control.pausedAt, applying.updatedAt);
  const failed: KnowledgeIngestJob = {
    id: applying.id,
    bundleId: applying.bundleId,
    sourceId: applying.sourceId,
    sourceContentHash: applying.sourceContentHash,
    pipelineFingerprint: applying.pipelineFingerprint,
    inputRevision: applying.inputRevision,
    attempt: applying.attempt,
    rerunRequested: false,
    createdAt: applying.createdAt,
    updatedAt: recoveredAt,
    status: "failed",
    stage: "applying",
    failure: {
      code: "interrupted_apply_requires_recovery",
      message: "An interrupted apply requires transaction recovery before retry",
      retryable: false,
      occurredAt: recoveredAt,
    },
  };
  const recovered = promoteNoJournalRerun(
    replaceRuntimeQueueJob(current, failed),
    applying.sourceId,
    recoveredAt
  );
  const expected: IngestQueueSnapshot = {
    ...recovered,
    revision: current.revision + 1,
    control: {
      status: "paused",
      reason: "recovery_required",
      pausedAt: candidate.control.pausedAt,
      detail: "An interrupted apply must be recovered before queue resume",
    },
  };
  return exactJsonValuesEqual(expected, candidate);
}

/**
 * Compares recovery-owned job state while allowing only watcher bookkeeping.
 *
 * Processing and awaiting-review jobs may receive a newer source observation,
 * which changes `rerunRequested` and monotonically advances `updatedAt` without
 * changing apply/review authority. Failed and completed recovery evidence is
 * terminal and remains byte-exact.
 */
function protectedQueueJobProjectionMatches(
  current: KnowledgeIngestJob | undefined,
  candidate: KnowledgeIngestJob | undefined
): boolean {
  if (!current || !candidate) {
    return false;
  }
  if (current.status !== "processing" && current.status !== "awaiting_review") {
    return exactJsonValuesEqual(current, candidate);
  }
  const {
    rerunRequested: _currentRerunRequested,
    updatedAt: currentUpdatedAt,
    ...currentAuthority
  } = current;
  const {
    rerunRequested: _candidateRerunRequested,
    updatedAt: candidateUpdatedAt,
    ...candidateAuthority
  } = candidate;
  void _currentRerunRequested;
  void _candidateRerunRequested;
  return (
    candidateUpdatedAt >= currentUpdatedAt &&
    exactJsonValuesEqual(currentAuthority, candidateAuthority)
  );
}

/** Creates the Queue marker projected by one exact committed active journal. */
function createRuntimeApplyCommitMarker(
  journal: CommittedChangeSetTransactionJournal
): NonNullable<IngestQueueSnapshot["applyCommit"]> {
  const receipt = createTransactionCommitReceipt(journal);
  return {
    transactionId: receipt.transactionId,
    changeSetId: receipt.changeSetId,
    changeSetDigest: receipt.changeSetDigest,
    commitRevision: receipt.commitRevision,
    ...receipt.jobClaim,
    committedAt: receipt.committedAt,
  };
}

/**
 * Reconstructs completion of the current claim from the exact committed journal.
 *
 * @param state - Shared envelope whose committed journal and ledger own the marker
 * @param current - Queue carrying the applying claim
 * @param candidate - Proposed commit-pending acknowledgement Queue revision
 * @returns Whether candidate is the exact `resolveApplyRecovery` projection
 */
function applyCommitProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (
    candidate.control.status !== "paused" ||
    candidate.control.reason !== "commit_pending_ack" ||
    current.applyClaim === undefined ||
    candidate.applyCommit === undefined ||
    state.activeTransaction === null
  ) {
    return false;
  }
  const parsedJournal = parseChangeSetTransactionJournal(state.activeTransaction);
  if (!parsedJournal.ok || parsedJournal.value.phase !== "committed") {
    return false;
  }
  const journal = parsedJournal.value;
  const marker = createRuntimeApplyCommitMarker(journal);
  const claim = current.applyClaim;
  const applying = current.jobs.find((job) => job.id === claim.jobId);
  if (
    journal.bundleId !== current.bundleId ||
    !exactJsonValuesEqual(marker, candidate.applyCommit) ||
    !queueClaimMatchesTransaction(claim, journal) ||
    (claim.reviewedChangeSet !== undefined &&
      (claim.reviewedChangeSet.changeSetId !== marker.changeSetId ||
        claim.reviewedChangeSet.changeSetDigest !== marker.changeSetDigest)) ||
    !queueJobMatchesApplyClaim(applying, claim) ||
    (applying.status !== "processing" && applying.status !== "failed") ||
    applying.stage !== "applying"
  ) {
    return false;
  }
  const completedAt = candidate.control.pausedAt;
  if (completedAt < Math.max(marker.committedAt, applying.updatedAt)) {
    return false;
  }
  const completed: KnowledgeIngestJob = {
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
    changeSetId: marker.changeSetId,
    completedAt,
  };
  const promoted = promoteNoJournalRerun(
    replaceRuntimeQueueJob(current, completed),
    applying.sourceId,
    completedAt
  );
  const expectedWithoutClaim: IngestQueueSnapshot = { ...promoted };
  delete expectedWithoutClaim.applyClaim;
  const expected: IngestQueueSnapshot = {
    ...expectedWithoutClaim,
    revision: current.revision + 1,
    control: {
      status: "paused",
      reason: "commit_pending_ack",
      pausedAt: completedAt,
      detail: "Committed pages are waiting for durable journal acknowledgement",
    },
    applyCommit: marker,
  };
  return exactJsonValuesEqual(expected, candidate);
}

/**
 * Reconstructs the only legal commit-marker finalization Queue revision.
 *
 * @param state - Shared envelope whose global journal must already be clear
 * @param current - Queue retaining the exact pending acknowledgement marker
 * @param candidate - Proposed startup-gated Queue after marker removal
 * @returns Whether candidate is the exact `finalizeApplyRecovery` projection
 */
function applyCommitFinalizationProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (
    state.activeTransaction !== null ||
    current.applyCommit === undefined ||
    candidate.applyCommit !== undefined ||
    candidate.control.status !== "paused" ||
    candidate.control.reason !== "startup_recovery" ||
    candidate.control.pausedAt < current.applyCommit.committedAt
  ) {
    return false;
  }
  const expectedWithoutMarker: IngestQueueSnapshot = { ...current };
  delete expectedWithoutMarker.applyCommit;
  const expected: IngestQueueSnapshot = {
    ...expectedWithoutMarker,
    revision: current.revision + 1,
    control: {
      status: "paused",
      reason: "startup_recovery",
      pausedAt: candidate.control.pausedAt,
      detail: "Recovered apply committed; startup reconciliation must release the backlog",
    },
  };
  return exactJsonValuesEqual(expected, candidate);
}

/** Preserves an existing claim or marker while a protected gate remains unchanged. */
function protectedQueueEvidenceIsPreserved(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (current.control.status !== "paused") {
    return false;
  }
  const anchorsPreserved = acceptedNotStartedAnchorsArePreserved(state, current, candidate);
  if (current.control.reason === "startup_recovery") {
    if (current.applyClaim === undefined) {
      return candidate.applyClaim === undefined
        ? anchorsPreserved
        : acceptedClaimProjectionMatches(state, current, candidate);
    }
    const currentJob = current.jobs.find((job) => job.id === current.applyClaim?.jobId);
    const candidateJob = candidate.jobs.find((job) => job.id === current.applyClaim?.jobId);
    return (
      anchorsPreserved &&
      exactJsonValuesEqual(current.applyClaim, candidate.applyClaim) &&
      protectedQueueJobProjectionMatches(currentJob, candidateJob)
    );
  }
  if (current.control.reason === "recovery_required") {
    const currentJob = current.jobs.find((job) => job.id === current.applyClaim?.jobId);
    const candidateJob = candidate.jobs.find((job) => job.id === current.applyClaim?.jobId);
    return (
      anchorsPreserved &&
      current.applyClaim !== undefined &&
      exactJsonValuesEqual(current.applyClaim, candidate.applyClaim) &&
      exactJsonValuesEqual(currentJob, candidateJob)
    );
  }
  const currentJob = current.jobs.find((job) => job.id === current.applyCommit?.jobId);
  const candidateJob = candidate.jobs.find((job) => job.id === current.applyCommit?.jobId);
  return (
    anchorsPreserved &&
    current.applyCommit !== undefined &&
    exactJsonValuesEqual(current.applyCommit, candidate.applyCommit) &&
    exactJsonValuesEqual(currentJob, candidateJob)
  );
}

/**
 * Keeps all Runtime recovery gates monotonic across the generic Queue CAS facade.
 *
 * Queue validation proves the evidence required by recovery/commit controls,
 * while the outer Runtime parse additionally binds every commit marker to its
 * exact ledger. Only the dedicated release transform may reach `running`.
 */
function protectedQueueControlTransitionIsAllowed(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot
): boolean {
  if (
    current?.control.status !== "paused" ||
    (current.control.reason !== "startup_recovery" &&
      current.control.reason !== "recovery_required" &&
      current.control.reason !== "commit_pending_ack")
  ) {
    return true;
  }
  if (candidate.control.status !== "paused") {
    return false;
  }
  if (candidate.control.reason === current.control.reason) {
    return (
      exactJsonValuesEqual(current.control, candidate.control) &&
      protectedQueueEvidenceIsPreserved(state, current, candidate)
    );
  }
  if (
    current.control.reason === "startup_recovery" &&
    candidate.control.reason === "recovery_required"
  ) {
    return startupApplyRecoveryProjectionMatches(current, candidate);
  }
  if (
    (current.control.reason === "startup_recovery" ||
      current.control.reason === "recovery_required") &&
    candidate.control.reason === "commit_pending_ack"
  ) {
    return applyCommitProjectionMatches(state, current, candidate);
  }
  return applyCommitFinalizationProjectionMatches(state, current, candidate);
}

/**
 * Sorts accepted Reviews independently of persisted insertion order.
 *
 * @param left - First immutable accepted record
 * @param right - Second immutable accepted record
 * @returns Stable timestamp then identifier ordering
 */
function compareAcceptedReviewRecords(
  left: AcceptedChangeSetReviewRecord,
  right: AcceptedChangeSetReviewRecord
): number {
  return (
    left.recordedAt - right.recordedAt || compareIdentifiers(left.changeSetId, right.changeSetId)
  );
}

/** Requires a non-empty runtime identifier. */
function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

/**
 * Replaces or appends one Bundle slot in deterministic key order.
 *
 * @param slots - Current detached slots
 * @param bundleId - Bundle to replace
 * @param value - Complete replacement value
 * @returns New sorted slot collection
 */
function replaceBundleSlot(
  slots: readonly KnowledgeRuntimeBundleSlot[],
  bundleId: string,
  value: object
): KnowledgeRuntimeBundleSlot[] {
  const replacement = { bundleId, value: cloneJson(value) };
  const exists = slots.some((slot) => slot.bundleId === bundleId);
  return (
    exists
      ? slots.map((slot) => (slot.bundleId === bundleId ? replacement : slot))
      : [...slots, replacement]
  ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
}

/**
 * Finds Bundle ids whose Studio-visible Runtime slots changed in one commit.
 *
 * @param current - Atomic envelope before the transform
 * @param next - Atomic envelope proposed by the transform
 * @returns Stable Bundle ids requiring an authoritative Studio reload
 */
function findStudioChangedBundleIds(
  current: KnowledgeRuntimeStoreSnapshot,
  next: KnowledgeRuntimeStoreSnapshot
): string[] {
  const bundleIds = new Set<string>();
  for (const collection of ["queues", "reviews"] as const) {
    for (const slot of current[collection]) bundleIds.add(slot.bundleId);
    for (const slot of next[collection]) bundleIds.add(slot.bundleId);
  }
  return [...bundleIds]
    .filter(
      (bundleId) =>
        !exactJsonValuesEqual(
          findBundleSlot(current, "queues", bundleId),
          findBundleSlot(next, "queues", bundleId)
        ) ||
        !exactJsonValuesEqual(
          findBundleSlot(current, "reviews", bundleId),
          findBundleSlot(next, "reviews", bundleId)
        )
    )
    .sort(compareIdentifiers);
}

/** Replaces one source journal while retaining deterministic Bundle/source ordering. */
function replaceInputRevisionSource(
  bundles: readonly KnowledgeRuntimeInputRevisionBundle[],
  bundleId: string,
  source: KnowledgeRuntimeInputRevisionRecord
): KnowledgeRuntimeInputRevisionBundle[] {
  const bundle = bundles.find((candidate) => candidate.bundleId === bundleId);
  const nextBundle: KnowledgeRuntimeInputRevisionBundle = {
    bundleId,
    sources: (bundle
      ? bundle.sources.some((candidate) => candidate.sourceId === source.sourceId)
        ? bundle.sources.map((candidate) =>
            candidate.sourceId === source.sourceId ? source : candidate
          )
        : [...bundle.sources, source]
      : [source]
    ).sort((left, right) => compareIdentifiers(left.sourceId, right.sourceId)),
  };
  return (
    bundle
      ? bundles.map((candidate) => (candidate.bundleId === bundleId ? nextBundle : candidate))
      : [...bundles, nextBundle]
  ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
}

/** Reconstructs a Queue-safe bound observation from runtime-owned identity. */
function createBoundSourceInputObservation(
  bundleId: string,
  sourceId: string,
  observation: Extract<KnowledgeRuntimeSourceObservationRecord, { status: "bound" | "consumed" }>
): BoundSourceInputObservation {
  return {
    bundleId,
    sourceId,
    captureId: observation.captureId,
    inputRevision: observation.inputRevision,
    observationToken: observation.observationToken,
    sourceContentHash: observation.sourceContentHash,
    pipelineFingerprint: observation.pipelineFingerprint,
  };
}

/** Throws a sanitized cancellation without retaining the signal reason. */
function throwIfRuntimeExecutionProofAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("The knowledge Runtime execution proof was aborted");
  error.name = "AbortError";
  throw error;
}

/**
 * Reads one Bundle slot from a detached runtime snapshot.
 *
 * @param state - Strict runtime state
 * @param collection - Queue, review, or manifest namespace
 * @param bundleId - Bundle key
 * @returns Stored unknown JSON or null
 */
function findBundleSlot(
  state: KnowledgeRuntimeStoreSnapshot,
  collection: RuntimeBundleCollection,
  bundleId: string
): object | null {
  return state[collection].find((slot) => slot.bundleId === bundleId)?.value ?? null;
}

/**
 * Returns the next exact global runtime-envelope revision.
 *
 * @param state - Current strict runtime state
 * @returns Next safe integer revision
 */
function nextStoreRevision(state: KnowledgeRuntimeStoreSnapshot): number {
  if (state.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return state.revision + 1;
}

/**
 * Owns one Vault-private atomic envelope and exposes strict subsystem operations.
 */
export class KnowledgeRuntimeStore {
  private readonly clock: () => number;
  private readonly opaqueIdFactory: () => string;
  private readonly studioListeners = new Map<string, Set<() => void>>();

  /** Creates a runtime store over an atomic plaintext-file implementation. */
  constructor(
    private readonly file: AtomicRuntimeFile,
    options: KnowledgeRuntimeStoreOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.opaqueIdFactory = options.opaqueIdFactory ?? createSecureOpaqueId;
  }

  /** Initializes and validates the durable runtime file without overwriting it. */
  async initialize(): Promise<void> {
    try {
      await this.file.read();
    } catch {
      const initial = JSON.stringify(
        createEmptyKnowledgeRuntimeStoreSnapshot(this.nextOpaqueId("runtimeId"))
      );
      await this.file.initialize(initial);
    }
    await this.migrateLegacyStore();
    await this.readState();
  }

  /** Reads one detached queue snapshot or null. */
  async readQueue(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("queues", bundleId);
  }

  /** Atomically compares and replaces one complete queue snapshot. */
  async writeQueue(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null,
    authority?: QueueWriteAuthority
  ): Promise<void> {
    const candidate = this.requireQueueSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "queue");
    const settledAt = this.now();
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "queues", bundleId);
      const current = currentRaw === null ? null : this.requireQueueSnapshot(bundleId, currentRaw);
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      const abandonmentHistoryPreserved =
        current === null
          ? candidate.applyAbandonments.length === 0
          : exactJsonValuesEqual(current.applyAbandonments, candidate.applyAbandonments);
      if (!abandonmentHistoryPreserved) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      const acceptedAnchorsPreserved =
        current === null ||
        acceptedNotStartedAnchorsArePreserved(state, current, candidate) ||
        acceptedClaimProjectionMatches(state, current, candidate);
      if (!acceptedAnchorsPreserved) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      if (!protectedQueueControlTransitionIsAllowed(state, current, candidate)) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      const noChangesAuthority = authority?.kind === "no_changes_commit" ? authority : undefined;
      const protectedNoChangesCompletion = hasProtectedNoChangesCompletion(current, candidate);
      if (protectedNoChangesCompletion && noChangesAuthority === undefined) {
        const sourceId =
          current?.jobs.find((job) => {
            const next = candidate.jobs.find((candidateJob) => candidateJob.id === job.id);
            return (
              job.status === "processing" &&
              job.stage !== "applying" &&
              next?.status === "completed"
            );
          })?.sourceId ?? "unknown-source";
        throw new KnowledgeRuntimeNoChangesCommitConflictError(
          bundleId,
          sourceId,
          "authority_invalid"
        );
      }
      let manifests = state.manifests;
      if (noChangesAuthority !== undefined) {
        if (current === null) {
          throw new KnowledgeRuntimeNoChangesCommitConflictError(
            bundleId,
            noChangesAuthority.plan.sourceId,
            "queue_mismatch"
          );
        }
        const nextManifest = projectRuntimeNoChangesManifestCommit(
          state,
          current,
          candidate,
          noChangesAuthority
        );
        manifests = replaceBundleSlot(state.manifests, bundleId, nextManifest);
      }
      const inputRevisions = consumeQueueSourceObservations(
        state,
        current,
        candidate,
        settledAt,
        authority
      );
      if (inputRevisions === null) {
        throw new KnowledgeRuntimeQueueObservationAuthorityError(bundleId);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          queues: replaceBundleSlot(state.queues, bundleId, candidate),
          manifests,
          inputRevisions,
        },
        value: undefined,
      };
    });
  }

  /** Reads one detached review snapshot or null. */
  async readReview(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("reviews", bundleId);
  }

  /**
   * Reads strict Queue and Review state from exactly one Runtime envelope.
   *
   * Missing subsystem slots are represented by detached revision-zero snapshots;
   * this method never creates storage or combines results from separate reads.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns One atomic Studio projection with its outer Runtime revision
   */
  async readStudioBundle(bundleId: string): Promise<KnowledgeRuntimeStudioBundleSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const queueRaw = findBundleSlot(state, "queues", bundleId);
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    return {
      bundleId,
      runtimeRevision: state.revision,
      queue:
        queueRaw === null
          ? createEmptyRuntimeQueueSnapshot(bundleId)
          : this.requireQueueSnapshot(bundleId, queueRaw),
      review:
        reviewRaw === null
          ? createEmptyRuntimeReviewSnapshot(bundleId)
          : this.requireReviewSnapshot(bundleId, reviewRaw),
    };
  }

  /**
   * Reads current applied Wiki provenance from exactly one Runtime envelope.
   *
   * Only current Manifest page versions written by an exact latest-ledger-backed
   * accepted Review are projected. The frozen detached result is retrieval
   * evidence only and grants no durable or file-mutation authority.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Immutable current applied provenance and Runtime revision
   */
  async readAppliedProvenance(
    bundleId: string
  ): Promise<KnowledgeRuntimeAppliedProvenanceSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    if (manifestRaw === null) {
      return freezeAppliedProvenanceSnapshot({
        bundleId,
        runtimeRevision: state.revision,
        manifestRevision: 0,
        pages: [],
      });
    }
    const manifest = this.requireManifest(bundleId, manifestRaw);
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review = reviewRaw === null ? undefined : this.requireReviewSnapshot(bundleId, reviewRaw);
    return freezeAppliedProvenanceSnapshot({
      bundleId,
      runtimeRevision: state.revision,
      manifestRevision: manifest.revision,
      pages: projectAppliedManifestPages(state, manifest, review),
    });
  }

  /**
   * Atomically rejects one exact pending Review and cancels its Queue attempt.
   *
   * The command is captured once before durable access and may express only
   * literal per-change rejection. A transport failure is considered successful
   * only when one exact terminal Queue+Review projection can be re-read.
   *
   * @param bundleId - Stable Bundle identifier
   * @param command - Untrusted whole-proposal Reject command
   * @returns Exact terminal identity and committed subsystem revisions
   */
  async rejectReviewAtomically(
    bundleId: string,
    command: unknown
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    assertIdentifier(bundleId, "bundleId");
    const captured = parseKnowledgeLiteralRejectCommand(command);
    const decidedAt = this.now();
    try {
      return await this.commitReviewRejection(bundleId, captured, decidedAt);
    } catch (error) {
      const confirmed = await this.confirmReviewRejection(bundleId, captured, decidedAt);
      if (confirmed) {
        this.emitStudioHints([bundleId]);
        return confirmed;
      }
      throw error;
    }
  }

  /**
   * Subscribes to value-free hints after Queue or Review commits for one Bundle.
   *
   * Events are non-authoritative. Callers must reload through
   * {@link readStudioBundle}; listener failure cannot affect durable state.
   *
   * @param bundleId - Stable Bundle identifier
   * @param listener - Best-effort reload hint callback
   * @returns Idempotent unsubscribe callback
   */
  subscribeStudioBundle(bundleId: string, listener: () => void): () => void {
    assertIdentifier(bundleId, "bundleId");
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    const listeners = this.studioListeners.get(bundleId) ?? new Set<() => void>();
    listeners.add(listener);
    this.studioListeners.set(bundleId, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.studioListeners.get(bundleId);
      current?.delete(listener);
      if (current?.size === 0) this.studioListeners.delete(bundleId);
    };
  }

  /** Atomically compares and replaces one complete review snapshot. */
  async writeReview(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireReviewSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "review");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "reviews", bundleId);
      const actualRevision =
        currentRaw === null ? null : this.requireReviewSnapshot(bundleId, currentRaw).revision;
      if (actualRevision !== expectedRevision) {
        throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          reviews: replaceBundleSlot(state.reviews, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /** Reads one detached Source Manifest or null. */
  async readManifest(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("manifests", bundleId);
  }

  /** Atomically compares and replaces one complete Source Manifest. */
  async writeManifest(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireManifest(bundleId, manifest);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "manifest");
    await this.updateState((state) => {
      if (state.activeTransaction !== null) {
        const active = this.requireTransaction(state.activeTransaction);
        throw new KnowledgeRuntimeManifestReservationError(bundleId, active.transactionId);
      }
      const currentRaw = findBundleSlot(state, "manifests", bundleId);
      const current = currentRaw === null ? null : this.requireManifest(bundleId, currentRaw);
      assertGenericManifestPreservesCommitState(current, candidate);
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new SourceManifestRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          manifests: replaceBundleSlot(state.manifests, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /**
   * Re-proves one accepted apply before its transaction may observe Wiki files.
   *
   * This read-only preflight uses a detached strict request. Prepared-journal
   * publication repeats the proof inside its atomic runtime transform, so a
   * concurrent Queue or Review update cannot turn preflight into authority.
   *
   * @param request - Strict apply identity produced without Vault file access
   */
  async verifyApplyAuthority(request: ChangeSetTransactionAuthorityRequest): Promise<void> {
    const proof = parseApplyAuthorityRequest(request);
    const state = await this.readState();
    this.assertTransactionFileAccessAuthority(state, proof);
  }

  /**
   * Classifies one accepted Review identity from exactly one runtime snapshot.
   *
   * Classification never observes Wiki files and never starts an apply. Queue,
   * Review, active journal, commit marker, abandonment, allocator, and ledger
   * evidence are interpreted from the same detached atomic-envelope read.
   *
   * @param identity - Accepted identity returned by review startup reconciliation
   * @returns Exact durable phase or explicit no-journal decision candidate
   */
  async classifyNoJournalApplyRecovery(
    identity: AcceptedReviewStartupIdentity
  ): Promise<NoJournalApplyRecoveryClassification> {
    this.assertAcceptedReviewStartupIdentity(identity);
    const state = await this.readState();
    const record = this.requireAcceptedReviewByStartupIdentity(state, identity);
    return this.classifyAcceptedApplyState(state, identity.bundleId, record);
  }

  /**
   * Atomically classifies every accepted Review at one expected Review revision.
   *
   * Queue state, accepted records, active journal, commit ledger, and every
   * returned classification come from the same runtime-envelope read. The
   * runtime revision is only an optimistic display token; later actions still
   * re-resolve their opaque reference and repeat full durable authority proof.
   *
   * @param bundleId - Bundle whose accepted Reviews must be classified
   * @param expectedReviewRevision - Review revision reconciled by the startup coordinator
   * @returns One atomic recovery snapshot or an explicit Review revision miss
   */
  async loadNoJournalApplyRecoverySnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult> {
    assertIdentifier(bundleId, "bundleId");
    if (!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "request_invalid");
    }
    const state = await this.readState();
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review =
      reviewRaw === null
        ? createEmptyRuntimeReviewSnapshot(bundleId)
        : this.requireReviewSnapshot(bundleId, reviewRaw);
    if (review.revision !== expectedReviewRevision) {
      return {
        kind: "review_revision_changed",
        bundleId,
        runtimeRevision: state.revision,
        expectedReviewRevision,
        actualReviewRevision: review.revision,
      };
    }

    const queueRaw = findBundleSlot(state, "queues", bundleId);
    const queueSnapshot =
      queueRaw === null
        ? createEmptyRuntimeQueueSnapshot(bundleId)
        : this.requireQueueSnapshot(bundleId, queueRaw);
    const activeTransaction =
      state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
    const classifications = review.records
      .filter((record): record is AcceptedChangeSetReviewRecord => record.outcome === "accepted")
      .sort(compareAcceptedReviewRecords)
      .map((record) => this.classifyAcceptedApplyState(state, bundleId, record));
    return {
      kind: "loaded",
      snapshot: {
        bundleId,
        runtimeRevision: state.revision,
        reviewRevision: review.revision,
        queueSnapshot,
        globalTransaction:
          activeTransaction === null
            ? null
            : {
                transactionId: activeTransaction.transactionId,
                bundleId: activeTransaction.bundleId,
                changeSetId: activeTransaction.changeSetId,
                phase: activeTransaction.phase,
              },
        classifications,
      },
    };
  }

  /**
   * Atomically releases one exact startup-recovery pause after repeating every proof.
   *
   * The optimistic Gate result is never authority. Runtime, Review, and Queue
   * revisions, all Bundle recovery evidence, the Vault-global transaction,
   * and every accepted Review classification are checked in the same atomic
   * transform that changes only the target Queue control and revisions.
   *
   * @param requestValue - Narrow optimistic observation derived from an observed-clear Gate result
   * @returns Released, unchanged, stale, or blocked without ambiguous partial state
   */
  async releaseStartupRecovery(
    requestValue: KnowledgeStartupReleaseRequest
  ): Promise<KnowledgeStartupReleaseResult> {
    const request = parseKnowledgeStartupReleaseRequest(requestValue);
    return this.updateState<KnowledgeStartupReleaseResult>((state) => {
      if (state.revision !== request.expectedRuntimeRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "runtime",
          },
        };
      }

      const reviewRaw = findBundleSlot(state, "reviews", request.bundleId);
      const review =
        reviewRaw === null
          ? createEmptyRuntimeReviewSnapshot(request.bundleId)
          : this.requireReviewSnapshot(request.bundleId, reviewRaw);
      if (review.revision !== request.expectedReviewRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "review",
          },
        };
      }

      const queueRaw = findBundleSlot(state, "queues", request.bundleId);
      const queue =
        queueRaw === null
          ? createEmptyRuntimeQueueSnapshot(request.bundleId)
          : this.requireQueueSnapshot(request.bundleId, queueRaw);
      const preservedPauseReason =
        queue.control.status === "paused" &&
        (queue.control.reason === "user" || queue.control.reason === "rate_limit")
          ? queue.control.reason
          : undefined;
      if (queue.revision !== request.expectedQueueRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "queue",
          },
        };
      }

      if (state.activeTransaction !== null) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "active_transaction_present",
          },
        };
      }

      for (const slot of state.queues) {
        if (slot.bundleId === request.bundleId) continue;
        const otherQueue = this.requireQueueSnapshot(slot.bundleId, slot.value);
        if (queueHasStartupWriteRecoveryEvidence(otherQueue)) {
          return {
            value: {
              kind: "blocked",
              bundleId: request.bundleId,
              reason: "other_bundle_apply_recovery_present",
            },
          };
        }
      }

      if (queue.applyCommit !== undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "apply_commit_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "failed" && job.stage === "applying")) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "failed_apply_present",
          },
        };
      }
      if (queue.applyClaim !== undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "apply_claim_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "processing")) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "processing_job_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "paused") && preservedPauseReason === undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "paused_job_present",
          },
        };
      }

      for (const bundle of state.inputRevisions) {
        const hasPendingObservation = bundle.sources.some((source) =>
          source.observations.some(
            (observation) => observation.status === "allocated" || observation.status === "bound"
          )
        );
        if (hasPendingObservation) {
          return {
            value: {
              kind: "blocked",
              bundleId: request.bundleId,
              reason:
                bundle.bundleId === request.bundleId
                  ? "source_observation_pending"
                  : "other_bundle_apply_recovery_present",
            },
          };
        }
      }

      for (const slot of state.reviews) {
        const candidateReview =
          slot.bundleId === request.bundleId
            ? review
            : this.requireReviewSnapshot(slot.bundleId, slot.value);
        const acceptedRecords = candidateReview.records.filter(
          (record): record is AcceptedChangeSetReviewRecord => record.outcome === "accepted"
        );
        for (const record of acceptedRecords) {
          const classification = this.classifyAcceptedApplyState(
            state,
            candidateReview.bundleId,
            record
          );
          if (!acceptedClassificationIsTerminal(classification)) {
            return {
              value: {
                kind: "blocked",
                bundleId: request.bundleId,
                reason:
                  candidateReview.bundleId === request.bundleId
                    ? "accepted_review_unresolved"
                    : "other_bundle_apply_recovery_present",
              },
            };
          }
        }
      }

      if (preservedPauseReason !== undefined) {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason:
              preservedPauseReason === "user"
                ? "user_pause_preserved"
                : "rate_limit_pause_preserved",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }

      if (queueRaw === null) {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason: "queue_absent",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }
      if (queue.control.status === "running") {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason: "already_running",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }
      if (queue.control.reason !== "startup_recovery") {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "queue_pause_not_releasable",
          },
        };
      }
      if (
        state.revision === Number.MAX_SAFE_INTEGER ||
        queue.revision === Number.MAX_SAFE_INTEGER
      ) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "revision_overflow",
          },
        };
      }

      const nextQueue: IngestQueueSnapshot = {
        ...queue,
        revision: queue.revision + 1,
        control: { status: "running" },
      };
      return {
        next: {
          ...state,
          revision: state.revision + 1,
          queues: replaceBundleSlot(state.queues, request.bundleId, nextQueue),
        },
        value: {
          kind: "released",
          bundleId: request.bundleId,
          previousRuntimeRevision: state.revision,
          runtimeRevision: state.revision + 1,
          previousQueueRevision: queue.revision,
          queueSnapshot: cloneJson(nextQueue),
        },
      };
    });
  }

  /**
   * Reloads and fully re-proves one continuation immediately before transaction apply.
   *
   * The caller's Bundle is validated against the durable accepted ChangeSet and
   * current Manifest read-set. This method performs no Wiki file access; the
   * transaction runtime repeats the same proof atomically when it publishes the
   * prepared journal.
   *
   * @param reference - Opaque recovery id previously returned by classification
   * @param bundleValue - Current configured Bundle boundary
   * @returns Detached exact input for ChangeSetTransaction.apply
   */
  async loadNoJournalApplyContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundleValue: unknown
  ): Promise<ChangeSetTransactionApplyInput> {
    this.assertNoJournalApplyRecoveryReference(reference);
    const state = await this.readState();
    const record = this.requireAcceptedReviewByReference(state, reference);
    const classification = this.classifyAcceptedApplyState(state, reference.bundleId, record);
    if (classification.kind !== "requires_decision") {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "state_not_actionable"
      );
    }
    const queue = this.requireNoJournalQueue(state, reference.bundleId);
    const claim = queue.applyClaim;
    if (!queueClaimMatchesAcceptedRecord(claim, record)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "queue_state_mismatch"
      );
    }
    const runtimeIdentity = createNoJournalApplyRuntimeIdentity(reference.bundleId, record, claim);
    const proof = parseApplyAuthorityRequest({
      ...runtimeIdentity,
      bundle: bundleValue as KnowledgeBundleConfig,
    });
    this.assertTransactionFileAccessAuthority(state, proof);
    return {
      changeSet: cloneJson(proof.changeSet),
      bundle: cloneJson(proof.bundle),
      jobClaim: { ...proof.jobClaim },
      manifestCommitIntent: cloneJson(proof.manifestCommitIntent),
      manifestCommitIntentDigest: proof.manifestCommitIntentDigest,
    };
  }

  /**
   * Atomically abandons one exact accepted apply before any journal can exist.
   *
   * The shared-envelope callback proves an empty global journal, no Queue commit
   * marker, no source-input ledger, and exact Queue/Review/allocator authority.
   * Manifest drift deliberately does not prevent abandonment because no write
   * intent was published. Exact tombstone replay preserves bytes and revisions.
   *
   * @param reference - Opaque exact recovery reference
   * @param requestedAt - Validated explicit decision timestamp
   * @returns Durable abandonment receipt
   */
  async abandonNoJournalApply(
    reference: NoJournalApplyRecoveryReference,
    requestedAt: number
  ): Promise<NoJournalApplyAbandonReceipt> {
    this.assertNoJournalApplyRecoveryReference(reference);
    if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(reference.bundleId, "request_invalid");
    }
    return this.updateState<NoJournalApplyAbandonReceipt>((state) => {
      const record = this.requireAcceptedReviewByReference(state, reference);
      const classification = this.classifyAcceptedApplyState(state, reference.bundleId, record);
      if (classification.kind === "abandoned") {
        return {
          value: {
            ...classification.reference,
            jobId: classification.jobId,
            changeSetId: classification.changeSetId,
            abandonedAt: classification.abandonedAt,
          },
        };
      }
      if (classification.kind !== "requires_decision") {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "state_not_actionable"
        );
      }
      if (state.activeTransaction !== null) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "write_evidence_conflict"
        );
      }
      const queue = this.requireNoJournalQueue(state, reference.bundleId);
      const claim = queue.applyClaim;
      const job = queue.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
      if (
        !queueClaimMatchesAcceptedRecord(claim, record) ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        (job.status !== "processing" && job.status !== "failed") ||
        job.stage !== "applying" ||
        queue.applyCommit !== undefined
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "queue_state_mismatch"
        );
      }
      const hasSourceInputLedger = state.applyCommits.some(
        (ledger) =>
          ledger.bundleId === reference.bundleId &&
          ledger.sourceId === record.jobClaim.sourceId &&
          ledger.inputRevision === record.jobClaim.inputRevision
      );
      if (hasSourceInputLedger) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "write_evidence_conflict"
        );
      }
      if (
        queue.revision === Number.MAX_SAFE_INTEGER ||
        state.revision === Number.MAX_SAFE_INTEGER
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "revision_overflow"
        );
      }

      const abandonedAt = Math.max(requestedAt, job.updatedAt, claim.startedAt, record.acceptedAt);
      const cancelled: KnowledgeIngestJob = {
        id: job.id,
        bundleId: job.bundleId,
        sourceId: job.sourceId,
        sourceContentHash: job.sourceContentHash,
        pipelineFingerprint: job.pipelineFingerprint,
        inputRevision: job.inputRevision,
        attempt: job.attempt,
        rerunRequested: false,
        createdAt: job.createdAt,
        updatedAt: abandonedAt,
        status: "cancelled",
        stage: "cancelled",
        cancelledAt: abandonedAt,
      };
      const abandonment: IngestApplyAbandonment = {
        jobId: claim.jobId,
        sourceId: claim.sourceId,
        sourceContentHash: claim.sourceContentHash,
        pipelineFingerprint: claim.pipelineFingerprint,
        inputRevision: claim.inputRevision,
        attempt: claim.attempt,
        startedAt: claim.startedAt,
        changeSetId: record.changeSetId,
        changeSetDigest: record.acceptedDigest,
        proposalDigest: record.proposalDigest,
        recordRevision: record.recordRevision,
        manifestCommitIntentDigest: record.manifestCommitIntentDigest,
        acceptedAt: record.acceptedAt,
        abandonedAt,
      };
      const { applyClaim: _applyClaim, ...queueWithoutClaim } = queue;
      void _applyClaim;
      const currentPausedAt =
        queue.control.status === "paused" ? queue.control.pausedAt : abandonedAt;
      const cancelledQueue: IngestQueueSnapshot = {
        ...queueWithoutClaim,
        revision: queue.revision + 1,
        control: {
          status: "paused",
          reason: "startup_recovery",
          pausedAt: Math.max(abandonedAt, currentPausedAt),
          detail: "An accepted apply was explicitly abandoned before journaling",
        },
        jobs: queue.jobs.map((candidate) =>
          candidate.id === cancelled.id ? cancelled : candidate
        ),
        applyAbandonments: [...queue.applyAbandonments, abandonment].sort(
          (left, right) =>
            left.abandonedAt - right.abandonedAt || compareIdentifiers(left.jobId, right.jobId)
        ),
      };
      const nextQueue = this.requireQueueSnapshot(
        reference.bundleId,
        promoteNoJournalRerun(cancelledQueue, job.sourceId, abandonedAt)
      );
      const receipt: NoJournalApplyAbandonReceipt = {
        bundleId: reference.bundleId,
        recoveryId: reference.recoveryId,
        jobId: job.id,
        changeSetId: record.changeSetId,
        abandonedAt,
      };
      return {
        next: {
          ...state,
          revision: state.revision + 1,
          queues: replaceBundleSlot(state.queues, reference.bundleId, nextQueue),
        },
        value: receipt,
      };
    });
  }

  /**
   * Atomically records one exact page commit in both Source Manifest and apply ledger.
   *
   * Exact ledger replay is a byte-preserving no-op. A new transaction must
   * re-prove the current active committed journal, receipt, Manifest read-set,
   * complete final projection, and monotonic source observation in the same
   * synchronous runtime-file transform that publishes both durable artifacts.
   *
   * @param journal - Complete committed transaction with final Manifest intent
   * @param receipt - Exact public proof derived from the committed journal
   */
  async recordApplyCommit(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void> {
    let committed: CommittedChangeSetTransactionJournal;
    try {
      const parsed = this.requireTransaction(journal);
      if (parsed.phase !== "committed") {
        throw new KnowledgeApplyCommitProofError(journal.transactionId, "journal_not_committed");
      }
      committed = parsed;
    } catch (error) {
      if (error instanceof KnowledgeApplyCommitProofError) {
        throw error;
      }
      throw new KnowledgeApplyCommitProofError(journal.transactionId, "journal_invalid");
    }
    if (!transactionCommitReceiptMatchesJournal(receipt, committed)) {
      throw new KnowledgeApplyCommitProofError(committed.transactionId, "receipt_mismatch");
    }
    const intent = committed.manifestCommitIntent;
    if (
      committed.manifestCommitIntentDigest !== createManifestCommitIntentDigest(intent) ||
      intent.bundleId !== committed.bundleId ||
      intent.sourceId !== committed.jobClaim.sourceId ||
      intent.sourceContentHash !== committed.jobClaim.sourceContentHash ||
      intent.pipelineFingerprint !== committed.jobClaim.pipelineFingerprint ||
      intent.inputRevision !== committed.jobClaim.inputRevision ||
      intent.changeSetId !== committed.changeSetId
    ) {
      throw new KnowledgeApplyCommitProofError(committed.transactionId, "journal_invalid");
    }
    const identity = createApplyCommitLedgerIdentity(committed, receipt, intent);

    await this.updateState((state) => {
      const existing = state.applyCommits.find(
        (record) => record.transactionId === committed.transactionId
      );
      if (existing) {
        if (!applyCommitLedgerIdentityMatches(existing, identity)) {
          throw new KnowledgeApplyCommitLedgerConflictError(committed.transactionId);
        }
        return { value: undefined };
      }

      if (state.activeTransaction === null) {
        throw new KnowledgeApplyCommitProofError(committed.transactionId, "active_journal_missing");
      }
      const active = this.requireTransaction(state.activeTransaction);
      if (
        active.phase !== "committed" ||
        active.transactionId !== committed.transactionId ||
        active.revision !== committed.revision ||
        createChangeSetTransactionJournalDigest(active) !== identity.journalDigest ||
        !transactionCommitReceiptMatchesJournal(receipt, active)
      ) {
        throw new KnowledgeApplyCommitProofError(
          committed.transactionId,
          "active_journal_mismatch"
        );
      }

      assertApplyCommitRuntimeAuthority(state, active);

      const currentRaw = findBundleSlot(state, "manifests", committed.bundleId);
      const actualManifest =
        currentRaw === null
          ? {
              version: 1 as const,
              bundleId: committed.bundleId,
              revision: 0,
              entries: [],
            }
          : this.requireManifest(committed.bundleId, currentRaw);
      const source = actualManifest.entries.find(
        (entry) => entry.sourceId === committed.jobClaim.sourceId
      );
      if (!source) {
        throw new KnowledgeApplyCommitManifestConflictError(
          committed.bundleId,
          committed.jobClaim.sourceId,
          "source_missing"
        );
      }
      const intentValidation = validateManifestCommitIntentForCommit(
        intent,
        actualManifest,
        committed.changeSet,
        committed.bundle
      );
      if (!intentValidation.valid) {
        throw new KnowledgeApplyCommitManifestConflictError(
          committed.bundleId,
          committed.jobClaim.sourceId,
          "intent_invalid",
          intentValidation.diagnostics
        );
      }
      assertSourceInputRevisionCanCommit(
        source,
        committed.bundleId,
        committed.jobClaim.inputRevision,
        actualManifest,
        state.applyCommits
      );
      const nextManifest = this.requireManifest(
        committed.bundleId,
        createCommittedSourceManifest(actualManifest, source, committed, receipt, intent)
      );
      const ledgerRecord: KnowledgeApplyCommitLedgerRecord = {
        ...identity,
        manifestAfterRevision: nextManifest.revision,
        manifestAfterDigest: createSourceManifestDigest(nextManifest),
      };
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          manifests: replaceBundleSlot(state.manifests, committed.bundleId, nextManifest),
          applyCommits: [...state.applyCommits, ledgerRecord].sort((left, right) =>
            compareIdentifiers(left.transactionId, right.transactionId)
          ),
        },
        value: undefined,
      };
    });
  }

  /** Reads the detached Vault-global active transaction journal or null. */
  async readActiveTransaction(): Promise<unknown> {
    const state = await this.readState();
    if (state.activeTransaction === null) {
      return null;
    }
    const active = this.requireTransaction(state.activeTransaction);
    if (active.phase === "prepared" || active.phase === "applying") {
      this.assertTransactionFileAccessAuthority(state, active);
    }
    return cloneJson(active);
  }

  /** Atomically compares and replaces the Vault-global active transaction slot. */
  async writeActiveTransaction(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    const candidate = this.requireTransaction(journal);
    if (expectedToken === null) {
      if (candidate.revision !== 0 || candidate.phase !== "prepared") {
        throw new TypeError("A new active transaction must begin as prepared at revision zero");
      }
    } else if (
      candidate.transactionId !== expectedToken.transactionId ||
      candidate.revision !== expectedToken.revision + 1
    ) {
      throw new TypeError("An active transaction replacement must advance its exact token once");
    }

    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      if (expectedToken === null) {
        this.assertTransactionFileAccessAuthority(state, candidate);
      } else if (current) {
        assertActiveTransactionTransition(current, candidate);
        if (current.phase === "prepared" && candidate.phase === "applying") {
          this.assertTransactionFileAccessAuthority(state, candidate);
        }
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: cloneJson(candidate),
        },
        value: undefined,
      };
    });
  }

  /** Atomically compares and clears the Vault-global active transaction slot. */
  async clearActiveTransaction(expectedToken: TransactionStorageToken): Promise<void> {
    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      if (current?.phase !== "committed") {
        throw new TypeError("Only a committed active transaction may be acknowledged and cleared");
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: null,
        },
        value: undefined,
      };
    });
  }

  /** Atomically allocates one strictly newer per-source observation revision. */
  async allocateInputRevision(
    request: AllocateSourceInputRevisionRequest
  ): Promise<SourceInputRevisionAllocation> {
    this.assertInputRevisionRequest(request);
    return this.updateState<SourceInputRevisionAllocation>((state) => {
      for (const candidateBundle of state.inputRevisions) {
        for (const candidateSource of candidateBundle.sources) {
          const replay = candidateSource.observations.find(
            (observation) => observation.captureId === request.captureId
          );
          if (!replay) {
            continue;
          }
          if (
            candidateBundle.bundleId !== request.bundleId ||
            candidateSource.sourceId !== request.sourceId
          ) {
            throw new SourceInputCaptureConflictError();
          }
          return {
            value: {
              bundleId: request.bundleId,
              sourceId: request.sourceId,
              captureId: replay.captureId,
              inputRevision: replay.inputRevision,
              observationToken: replay.observationToken,
            },
          };
        }
      }
      const observationToken = this.nextOpaqueId("observationToken");
      const allocatedAt = this.now();
      if (
        state.inputRevisions.some((candidateBundle) =>
          candidateBundle.sources.some((candidateSource) =>
            candidateSource.observations.some(
              (observation) => observation.observationToken === observationToken
            )
          )
        )
      ) {
        throw new SourceInputObservationTokenCollisionError();
      }
      const bundle = state.inputRevisions.find(
        (candidate) => candidate.bundleId === request.bundleId
      );
      const current = bundle?.sources.find((candidate) => candidate.sourceId === request.sourceId);
      if (current?.inputRevision === Number.MAX_SAFE_INTEGER) {
        throw new SourceInputRevisionOverflowError(request.bundleId, request.sourceId);
      }
      const nextRecord: KnowledgeRuntimeInputRevisionRecord = {
        sourceId: request.sourceId,
        inputRevision: current ? current.inputRevision + 1 : 1,
        managedAfterRevision: current?.managedAfterRevision ?? 0,
        ...(current?.legacyCheckpoint === undefined
          ? {}
          : { legacyCheckpoint: current.legacyCheckpoint }),
        observations: [
          ...(current?.observations ?? []),
          {
            observationToken,
            captureId: request.captureId,
            inputRevision: current ? current.inputRevision + 1 : 1,
            allocatedAt,
            status: "allocated" as const,
          },
        ],
      };
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          inputRevisions: replaceInputRevisionSource(
            state.inputRevisions,
            request.bundleId,
            nextRecord
          ),
        },
        value: {
          bundleId: request.bundleId,
          sourceId: request.sourceId,
          captureId: request.captureId,
          inputRevision: nextRecord.inputRevision,
          observationToken,
        },
      };
    });
  }

  /** Atomically binds one allocated capability to the exact observed payload. */
  async bindInputObservation(
    request: BindSourceInputObservationRequest
  ): Promise<BindSourceInputObservationResult> {
    this.assertObservationBindingRequest(request);
    return this.updateState<BindSourceInputObservationResult>((state) => {
      for (const bundle of state.inputRevisions) {
        for (const source of bundle.sources) {
          const current = source.observations.find(
            (observation) => observation.observationToken === request.observationToken
          );
          if (!current) {
            continue;
          }
          if (current.status === "superseded") {
            if (
              current.sourceContentHash !== undefined &&
              (current.sourceContentHash !== request.sourceContentHash ||
                current.pipelineFingerprint !== request.pipelineFingerprint)
            ) {
              throw new SourceInputObservationBindingConflictError();
            }
            return {
              value: {
                kind: "superseded",
                bundleId: bundle.bundleId,
                sourceId: source.sourceId,
                captureId: current.captureId,
                inputRevision: current.inputRevision,
                supersededByInputRevision: current.supersededByInputRevision,
              },
            };
          }
          if (current.status === "bound" || current.status === "consumed") {
            if (
              current.sourceContentHash !== request.sourceContentHash ||
              current.pipelineFingerprint !== request.pipelineFingerprint
            ) {
              throw new SourceInputObservationBindingConflictError();
            }
            return {
              value: {
                kind: current.status === "consumed" ? "already_consumed" : "ready",
                observation: createBoundSourceInputObservation(
                  bundle.bundleId,
                  source.sourceId,
                  current
                ),
              },
            };
          }
          const boundAt = this.now();
          const effectiveBoundAt = Math.max(boundAt, current.allocatedAt);
          const observations: KnowledgeRuntimeSourceObservationRecord[] = source.observations.map(
            (observation) => {
              if (observation.observationToken === current.observationToken) {
                return {
                  ...observation,
                  status: "bound" as const,
                  sourceContentHash: request.sourceContentHash,
                  pipelineFingerprint: request.pipelineFingerprint,
                  boundAt: effectiveBoundAt,
                };
              }
              if (
                observation.inputRevision < current.inputRevision &&
                (observation.status === "allocated" || observation.status === "bound")
              ) {
                const observationBoundAt =
                  observation.status === "bound" ? observation.boundAt : undefined;
                return {
                  observationToken: observation.observationToken,
                  captureId: observation.captureId,
                  inputRevision: observation.inputRevision,
                  allocatedAt: observation.allocatedAt,
                  status: "superseded" as const,
                  ...(observation.status === "bound"
                    ? {
                        sourceContentHash: observation.sourceContentHash,
                        pipelineFingerprint: observation.pipelineFingerprint,
                        boundAt: observation.boundAt,
                      }
                    : {}),
                  settledAt: Math.max(
                    effectiveBoundAt,
                    observation.allocatedAt,
                    observationBoundAt ?? 0
                  ),
                  supersededByInputRevision: current.inputRevision,
                };
              }
              return observation;
            }
          );
          const nextSource: KnowledgeRuntimeInputRevisionRecord = { ...source, observations };
          const bound = observations.find(
            (observation) => observation.observationToken === current.observationToken
          );
          if (!bound || bound.status !== "bound") {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
          return {
            next: {
              ...state,
              revision: nextStoreRevision(state),
              inputRevisions: replaceInputRevisionSource(
                state.inputRevisions,
                bundle.bundleId,
                nextSource
              ),
            },
            value: {
              kind: "ready",
              observation: createBoundSourceInputObservation(
                bundle.bundleId,
                source.sourceId,
                bound
              ),
            },
          };
        }
      }
      throw new SourceInputObservationTokenError();
    });
  }

  /** Reconciles one observation against the atomically persisted Queue watermark. */
  async settleInputObservation(
    observationToken: string
  ): Promise<SourceInputObservationSettlement> {
    this.assertObservationToken(observationToken);
    return this.updateState<SourceInputObservationSettlement>((state) => {
      for (const bundle of state.inputRevisions) {
        for (const source of bundle.sources) {
          const current = source.observations.find(
            (observation) => observation.observationToken === observationToken
          );
          if (!current) {
            continue;
          }
          if (current.status === "allocated" || current.status === "bound") {
            const queueRaw = findBundleSlot(state, "queues", bundle.bundleId);
            const queue =
              queueRaw === null ? null : this.requireQueueSnapshot(bundle.bundleId, queueRaw);
            const highWatermark = queue?.sourceHighWatermarks.find(
              (candidate) => candidate.sourceId === source.sourceId
            );
            if (current.status === "allocated" || highWatermark === undefined) {
              return { value: { kind: "pending" } };
            }
            if (highWatermark.inputRevision < current.inputRevision) {
              return { value: { kind: "pending" } };
            }
            const settledAt = this.now();
            let terminal: KnowledgeRuntimeSourceObservationRecord;
            let value: SourceInputObservationSettlement;
            if (highWatermark.inputRevision === current.inputRevision) {
              if (queue === null) {
                throw new KnowledgeRuntimeStoreCorruptError();
              }
              if (
                highWatermark.sourceContentHash !== current.sourceContentHash ||
                highWatermark.pipelineFingerprint !== current.pipelineFingerprint
              ) {
                throw new KnowledgeRuntimeStoreCorruptError();
              }
              terminal = {
                ...current,
                status: "consumed",
                settledAt: Math.max(settledAt, current.boundAt),
                queueRevision: queue.revision,
              };
              value = { kind: "consumed", queueRevision: queue.revision };
            } else {
              terminal = {
                ...current,
                status: "superseded",
                settledAt: Math.max(settledAt, current.boundAt),
                supersededByInputRevision: highWatermark.inputRevision,
              };
              value = {
                kind: "superseded",
                supersededByInputRevision: highWatermark.inputRevision,
              };
            }
            const nextSource = {
              ...source,
              observations: source.observations.map((observation) =>
                observation.observationToken === observationToken ? terminal : observation
              ),
            };
            return {
              next: {
                ...state,
                revision: nextStoreRevision(state),
                inputRevisions: replaceInputRevisionSource(
                  state.inputRevisions,
                  bundle.bundleId,
                  nextSource
                ),
              },
              value,
            };
          }
          return {
            value:
              current.status === "consumed"
                ? { kind: "consumed", queueRevision: current.queueRevision }
                : {
                    kind: "superseded",
                    supersededByInputRevision: current.supersededByInputRevision,
                  },
          };
        }
      }
      throw new SourceInputObservationTokenError();
    });
  }

  /** Loads stable pending source-observation work for restart recovery. */
  async loadInputObservationRecoveryWork(
    bundleId: string
  ): Promise<SourceInputObservationRecoveryWork[]> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const bundle = state.inputRevisions.find((candidate) => candidate.bundleId === bundleId);
    if (!bundle) {
      return [];
    }
    return bundle.sources.flatMap((source): SourceInputObservationRecoveryWork[] =>
      source.observations.flatMap((observation): SourceInputObservationRecoveryWork[] => {
        if (observation.status === "allocated") {
          return [
            {
              kind: "allocated",
              allocation: {
                bundleId,
                sourceId: source.sourceId,
                captureId: observation.captureId,
                inputRevision: observation.inputRevision,
                observationToken: observation.observationToken,
              },
            },
          ];
        }
        if (observation.status === "bound") {
          return [
            {
              kind: "bound",
              observation: createBoundSourceInputObservation(
                bundleId,
                source.sourceId,
                observation
              ),
            },
          ];
        }
        return [];
      })
    );
  }

  /**
   * Proves one exact processing Queue attempt, consumed observation, and Manifest
   * from the same atomic Runtime envelope without changing its bytes or revision.
   */
  async proveIngestExecution(
    requestValue: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeIngestExecutionProof>> {
    throwIfRuntimeExecutionProofAborted(signal);
    let request: Readonly<KnowledgeIngestExecutionProofRequest>;
    try {
      request = verifyKnowledgeIngestExecutionProofRequest(requestValue);
    } catch {
      throw new KnowledgeRuntimeIngestExecutionProofError();
    }
    const proof = await this.updateState<Readonly<KnowledgeIngestExecutionProof>>((state) => {
      const queueRaw = findBundleSlot(state, "queues", request.bundleId);
      const manifestRaw = findBundleSlot(state, "manifests", request.bundleId);
      if (queueRaw === null || manifestRaw === null) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const queue = this.requireQueueSnapshot(request.bundleId, queueRaw);
      const manifest = this.requireManifest(request.bundleId, manifestRaw);
      const job = queue.jobs.find((candidate) => candidate.id === request.jobId);
      const tupleJobs = queue.jobs.filter(
        (candidate) =>
          candidate.sourceId === request.sourceId &&
          candidate.sourceContentHash === request.sourceContentHash &&
          candidate.pipelineFingerprint === request.pipelineFingerprint &&
          candidate.inputRevision === request.inputRevision
      );
      if (
        queue.control.status !== "running" ||
        !job ||
        tupleJobs.length !== 1 ||
        tupleJobs[0]?.id !== request.jobId ||
        job.status !== "processing" ||
        job.stage === "applying" ||
        job.bundleId !== request.bundleId ||
        job.sourceId !== request.sourceId ||
        job.sourceContentHash !== request.sourceContentHash ||
        job.pipelineFingerprint !== request.pipelineFingerprint ||
        job.inputRevision !== request.inputRevision ||
        job.attempt !== request.attempt ||
        job.startedAt !== request.startedAt
      ) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const source = state.inputRevisions
        .find((bundle) => bundle.bundleId === request.bundleId)
        ?.sources.find((candidate) => candidate.sourceId === request.sourceId);
      const observations =
        source?.observations.filter(
          (observation) =>
            observation.status === "consumed" &&
            observation.inputRevision === request.inputRevision &&
            observation.sourceContentHash === request.sourceContentHash &&
            observation.pipelineFingerprint === request.pipelineFingerprint
        ) ?? [];
      const manifestEntries = manifest.entries.filter(
        (entry) => entry.sourceId === request.sourceId
      );
      if (observations.length !== 1 || manifestEntries.length !== 1) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const observation = observations[0];
      if (observation.status !== "consumed" || observation.queueRevision > queue.revision) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      return {
        value: Object.freeze({
          version: KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
          bundleId: request.bundleId,
          jobId: request.jobId,
          sourceId: request.sourceId,
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
          inputRevision: request.inputRevision,
          attempt: request.attempt,
          startedAt: request.startedAt,
          stage: job.stage,
          runtimeIdentityDigest: sha256(`knowledge-runtime-execution-owner-v1\n${state.runtimeId}`),
          runtimeRevision: state.revision,
          queueRevision: queue.revision,
          observationIdentityDigest: sha256(
            `knowledge-runtime-consumed-observation-v1\n${canonicalizeJson({
              runtimeId: state.runtimeId,
              bundleId: request.bundleId,
              sourceId: request.sourceId,
              observationToken: observation.observationToken,
              captureId: observation.captureId,
              inputRevision: observation.inputRevision,
              queueRevision: observation.queueRevision,
            })}`
          ),
          manifestRevision: manifest.revision,
          manifestDigest: createSourceManifestDigest(manifest),
        }),
      };
    });
    throwIfRuntimeExecutionProofAborted(signal);
    return proof;
  }

  /** Migrates a supported v1/v2/v3 envelope through one atomic transform. */
  private async migrateLegacyStore(): Promise<void> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    const committedText = await this.file.process((currentText) => {
      if (callbackCalled) {
        throw new KnowledgeRuntimeAtomicWriteError();
      }
      callbackCalled = true;
      const value = parseUnknownRuntimeText(currentText);
      if (!isRecord(value)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (value.version === KNOWLEDGE_RUNTIME_STORE_VERSION) {
        parseKnowledgeRuntimeStoreSnapshot(value);
        expectedText = currentText;
        return currentText;
      }
      if (value.version === PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION) {
        expectedText = JSON.stringify(migrateRuntimeV3ToV4Snapshot(value));
        return expectedText;
      }
      if (value.version === RUNTIME_V2_STORE_VERSION) {
        const runtimeId = this.nextOpaqueId("runtimeId");
        expectedText = JSON.stringify(
          migrateRuntimeV3ToV4Snapshot(migrateRuntimeV2ToV3Snapshot(value, runtimeId))
        );
        return expectedText;
      }
      if (value.version !== LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const runtimeId = this.nextOpaqueId("runtimeId");
      expectedText = JSON.stringify(
        migrateRuntimeV3ToV4Snapshot(migrateLegacyRuntimeSnapshot(value, runtimeId))
      );
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText);
  }

  /** Reads and clones one subsystem Bundle slot. */
  private async readBundleSlot(
    collection: RuntimeBundleCollection,
    bundleId: string
  ): Promise<unknown> {
    assertIdentifier(bundleId, "bundleId");
    const value = findBundleSlot(await this.readState(), collection, bundleId);
    return value === null ? null : cloneJson(value);
  }

  /**
   * Validates one accepted startup identity before durable state is inspected.
   *
   * @param identity - Caller-supplied startup identity
   */
  private assertAcceptedReviewStartupIdentity(identity: AcceptedReviewStartupIdentity): void {
    const value: unknown = identity;
    if (!isRecord(value) || !isRecord(value.jobClaim)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError("unknown", "request_invalid");
    }
    const claim = value.jobClaim;
    const valid =
      typeof value.bundleId === "string" &&
      value.bundleId.trim().length > 0 &&
      typeof value.changeSetId === "string" &&
      value.changeSetId.trim().length > 0 &&
      sha256Schema.safeParse(value.proposalDigest).success &&
      value.recordRevision === 1 &&
      Number.isSafeInteger(value.recordedAt) &&
      (value.recordedAt as number) >= 0 &&
      sha256Schema.safeParse(value.acceptedDigest).success &&
      sha256Schema.safeParse(value.manifestCommitIntentDigest).success &&
      Number.isSafeInteger(value.acceptedAt) &&
      (value.acceptedAt as number) >= 0 &&
      typeof claim.jobId === "string" &&
      claim.jobId.trim().length > 0 &&
      typeof claim.sourceId === "string" &&
      claim.sourceId.trim().length > 0 &&
      sha256Schema.safeParse(claim.sourceContentHash).success &&
      sha256Schema.safeParse(claim.pipelineFingerprint).success &&
      Number.isSafeInteger(claim.inputRevision) &&
      (claim.inputRevision as number) >= 0 &&
      Number.isSafeInteger(claim.attempt) &&
      (claim.attempt as number) > 0;
    if (!valid) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        typeof value.bundleId === "string" && value.bundleId.trim().length > 0
          ? value.bundleId
          : "unknown",
        "request_invalid"
      );
    }
  }

  /**
   * Validates one opaque recovery reference before durable state is inspected.
   *
   * @param reference - Caller-supplied recovery reference
   */
  private assertNoJournalApplyRecoveryReference(reference: NoJournalApplyRecoveryReference): void {
    const value: unknown = reference;
    if (
      !isRecord(value) ||
      typeof value.bundleId !== "string" ||
      value.bundleId.trim().length === 0 ||
      typeof value.recoveryId !== "string" ||
      !/^knowledge-no-journal-[a-f0-9]{64}$/.test(value.recoveryId)
    ) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        isRecord(value) && typeof value.bundleId === "string" && value.bundleId.trim().length > 0
          ? value.bundleId
          : "unknown",
        "request_invalid"
      );
    }
  }

  /**
   * Loads the exact accepted Review record represented by one startup identity.
   *
   * @param state - Complete atomic runtime snapshot
   * @param identity - Exact startup identity to revalidate
   * @returns Detached accepted Review record
   */
  private requireAcceptedReviewByStartupIdentity(
    state: KnowledgeRuntimeStoreSnapshot,
    identity: AcceptedReviewStartupIdentity
  ): AcceptedChangeSetReviewRecord {
    const raw = findBundleSlot(state, "reviews", identity.bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(identity.bundleId, "review_missing");
    }
    const review = this.requireReviewSnapshot(identity.bundleId, raw);
    const record = review.records.find(
      (candidate) => candidate.changeSetId === identity.changeSetId
    );
    if (!record) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        identity.bundleId,
        "review_record_missing"
      );
    }
    if (record.outcome !== "accepted" || !acceptedRecordMatchesStartupIdentity(identity, record)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        identity.bundleId,
        "review_record_mismatch"
      );
    }
    return cloneJson(record);
  }

  /**
   * Resolves an opaque reference back to exactly one immutable accepted record.
   *
   * @param state - Complete atomic runtime snapshot
   * @param reference - Opaque Bundle-scoped recovery reference
   * @returns Detached accepted Review record
   */
  private requireAcceptedReviewByReference(
    state: KnowledgeRuntimeStoreSnapshot,
    reference: NoJournalApplyRecoveryReference
  ): AcceptedChangeSetReviewRecord {
    const raw = findBundleSlot(state, "reviews", reference.bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(reference.bundleId, "review_missing");
    }
    const review = this.requireReviewSnapshot(reference.bundleId, raw);
    const matches = review.records.filter(
      (record): record is AcceptedChangeSetReviewRecord =>
        record.outcome === "accepted" &&
        createNoJournalApplyRecoveryId(reference.bundleId, record) === reference.recoveryId
    );
    if (matches.length !== 1) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "recovery_id_unknown"
      );
    }
    return cloneJson(matches[0]);
  }

  /**
   * Loads one strict Queue snapshot required by recovery classification.
   *
   * @param state - Complete atomic runtime snapshot
   * @param bundleId - Bundle whose Queue is required
   * @returns Detached strict current Queue state
   */
  private requireNoJournalQueue(
    state: KnowledgeRuntimeStoreSnapshot,
    bundleId: string
  ): IngestQueueSnapshot {
    const raw = findBundleSlot(state, "queues", bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "queue_missing");
    }
    return this.requireQueueSnapshot(bundleId, raw);
  }

  /**
   * Classifies one exact accepted record from a single already-loaded envelope.
   *
   * @param state - Complete atomic runtime snapshot
   * @param bundleId - Bundle containing the accepted record
   * @param record - Exact accepted Review record
   * @returns Stable durable phase or explicit decision candidate
   */
  private classifyAcceptedApplyState(
    state: KnowledgeRuntimeStoreSnapshot,
    bundleId: string,
    record: AcceptedChangeSetReviewRecord
  ): NoJournalApplyRecoveryClassification {
    const queue = this.requireNoJournalQueue(state, bundleId);
    const reference = createNoJournalApplyRecoveryReference(bundleId, record);
    const job = queue.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
    const relatedAbandonments = queue.applyAbandonments.filter(
      (candidate) =>
        candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
    );
    const sourceInputLedgers = state.applyCommits.filter(
      (ledger) =>
        ledger.bundleId === bundleId &&
        ledger.sourceId === record.jobClaim.sourceId &&
        ledger.inputRevision === record.jobClaim.inputRevision
    );
    const matchingLedgers = sourceInputLedgers.filter((ledger) =>
      ledgerMatchesAcceptedRecord(ledger, bundleId, record)
    );
    const active =
      state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
    const activeMatches =
      active !== null && transactionMatchesAcceptedRecord(active, bundleId, record);
    const marker = queue.applyCommit;
    const markerRelated =
      marker !== undefined &&
      (marker.jobId === record.jobClaim.jobId || marker.changeSetId === record.changeSetId);

    if (relatedAbandonments.length > 0) {
      const abandonment = relatedAbandonments[0];
      if (
        relatedAbandonments.length !== 1 ||
        !abandonmentMatchesAcceptedRecord(abandonment, record) ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "cancelled" ||
        sourceInputLedgers.length > 0 ||
        activeMatches ||
        markerRelated
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return {
        kind: "abandoned",
        reference,
        jobId: abandonment.jobId,
        changeSetId: abandonment.changeSetId,
        abandonedAt: abandonment.abandonedAt,
      };
    }

    if (sourceInputLedgers.length !== matchingLedgers.length || matchingLedgers.length > 1) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
    }

    if (markerRelated) {
      const ledger = matchingLedgers[0];
      if (
        !marker ||
        matchingLedgers.length !== 1 ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "completed" ||
        job.changeSetId !== record.changeSetId ||
        marker.jobId !== record.jobClaim.jobId ||
        marker.sourceId !== record.jobClaim.sourceId ||
        marker.sourceContentHash !== record.jobClaim.sourceContentHash ||
        marker.pipelineFingerprint !== record.jobClaim.pipelineFingerprint ||
        marker.inputRevision !== record.jobClaim.inputRevision ||
        marker.attempt !== record.jobClaim.attempt ||
        marker.changeSetId !== record.changeSetId ||
        marker.changeSetDigest !== record.acceptedDigest ||
        marker.transactionId !== ledger.transactionId ||
        marker.commitRevision !== ledger.commitRevision ||
        marker.committedAt !== ledger.recordedAt ||
        (active !== null &&
          (!activeMatches ||
            active.phase !== "committed" ||
            active.transactionId !== marker.transactionId))
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return { kind: "finalizing", reference, transactionId: marker.transactionId };
    }

    if (matchingLedgers.length === 1) {
      const ledger = matchingLedgers[0];
      if (activeMatches) {
        if (
          active?.phase !== "committed" ||
          active.transactionId !== ledger.transactionId ||
          !queueClaimMatchesAcceptedRecord(queue.applyClaim, record) ||
          !queueJobMatchesAcceptedRecord(job, record) ||
          (job.status !== "processing" && job.status !== "failed") ||
          job.stage !== "applying"
        ) {
          throw new KnowledgeNoJournalApplyRecoveryConflictError(
            bundleId,
            "write_evidence_conflict"
          );
        }
        assertApplyCommitRuntimeAuthority(state, active);
        return { kind: "finalizing", reference, transactionId: ledger.transactionId };
      }
      if (
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "completed" ||
        job.changeSetId !== record.changeSetId
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return { kind: "committed", reference, transactionId: ledger.transactionId };
    }

    if (activeMatches && active) {
      if (active.phase === "prepared" || active.phase === "applying") {
        this.assertTransactionFileAccessAuthority(state, active);
        return {
          kind: "active",
          reference,
          transactionId: active.transactionId,
          phase: active.phase,
        };
      }
      if (active.phase === "recovery_required") {
        assertApplyCommitRuntimeAuthority(state, active);
        return {
          kind: "blocked",
          reference,
          transactionId: active.transactionId,
          reason: "transaction_recovery_required",
        };
      }
      assertApplyCommitRuntimeAuthority(state, active);
      return { kind: "finalizing", reference, transactionId: active.transactionId };
    }

    const pending = queue.pendingReviews.find(
      (candidate) => candidate.jobId === record.jobClaim.jobId
    );
    if (
      queueJobMatchesAcceptedRecord(job, record) &&
      job.status === "awaiting_review" &&
      job.stage === "review" &&
      job.changeSetId === record.changeSetId &&
      pending?.kind === "durable" &&
      pending.changeSetId === record.changeSetId &&
      pending.proposalDigest === record.proposalDigest &&
      pending.reviewRecordRevision === 0 &&
      pending.recordedAt === record.recordedAt &&
      queue.applyClaim?.jobId !== record.jobClaim.jobId
    ) {
      return {
        kind: "accepted_not_started",
        reference,
        bundleId,
        changeSetId: record.changeSetId,
        jobId: record.jobClaim.jobId,
      };
    }

    const claim = queue.applyClaim;
    if (
      !queueClaimMatchesAcceptedRecord(claim, record) ||
      !queueJobMatchesAcceptedRecord(job, record) ||
      (job.status !== "processing" && job.status !== "failed") ||
      job.stage !== "applying"
    ) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "queue_state_mismatch");
    }
    const runtimeIdentity = createNoJournalApplyRuntimeIdentity(bundleId, record, claim);
    assertApplyCommitRuntimeAuthority(state, runtimeIdentity);
    if (active) {
      return {
        kind: "blocked",
        reference,
        transactionId: active.transactionId,
        reason: "other_transaction_active",
      };
    }
    return {
      kind: "requires_decision",
      candidate: createNoJournalApplyRecoveryCandidate(bundleId, record, claim),
    };
  }

  /** Reads and strictly validates the complete atomic runtime envelope. */
  private async readState(): Promise<KnowledgeRuntimeStoreSnapshot> {
    return parseRuntimeText(await this.file.read());
  }

  /** Commits one Queue+Review Reject projection inside one Runtime transform. */
  private async commitReviewRejection(
    bundleId: string,
    command: KnowledgeLiteralRejectCommand,
    decidedAt: number
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    return this.updateState((state) => {
      const queueRaw = findBundleSlot(state, "queues", bundleId);
      const reviewRaw = findBundleSlot(state, "reviews", bundleId);
      const projection = projectKnowledgeReviewRejection({
        bundleId,
        queue:
          queueRaw === null
            ? createEmptyRuntimeQueueSnapshot(bundleId)
            : this.requireQueueSnapshot(bundleId, queueRaw),
        review:
          reviewRaw === null
            ? createEmptyRuntimeReviewSnapshot(bundleId)
            : this.requireReviewSnapshot(bundleId, reviewRaw),
        command,
        decidedAt,
      });
      if (projection.kind === "already_rejected") {
        return {
          value: { ...projection.receipt, runtimeRevision: state.revision },
        };
      }
      const runtimeRevision = nextStoreRevision(state);
      return {
        next: {
          ...state,
          revision: runtimeRevision,
          queues: replaceBundleSlot(state.queues, bundleId, projection.queue),
          reviews: replaceBundleSlot(state.reviews, bundleId, projection.review),
        },
        value: { ...projection.receipt, runtimeRevision },
      };
    });
  }

  /** Re-reads and proves one exact terminal Reject after an uncertain write result. */
  private async confirmReviewRejection(
    bundleId: string,
    command: KnowledgeLiteralRejectCommand,
    decidedAt: number
  ): Promise<KnowledgeRuntimeReviewRejectReceipt | undefined> {
    try {
      const state = await this.readState();
      const queueRaw = findBundleSlot(state, "queues", bundleId);
      const reviewRaw = findBundleSlot(state, "reviews", bundleId);
      if (queueRaw === null || reviewRaw === null) return undefined;
      const projection = projectKnowledgeReviewRejection({
        bundleId,
        queue: this.requireQueueSnapshot(bundleId, queueRaw),
        review: this.requireReviewSnapshot(bundleId, reviewRaw),
        command,
        decidedAt,
      });
      if (projection.kind !== "already_rejected") return undefined;
      return { ...projection.receipt, runtimeRevision: state.revision };
    } catch {
      return undefined;
    }
  }

  /** Runs one synchronous state transform through the atomic file boundary. */
  private async updateState<T>(
    transform: (state: KnowledgeRuntimeStoreSnapshot) => RuntimeMutation<T>
  ): Promise<T> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    let result: T | undefined;
    let changedBundleIds: string[] = [];
    const committedText = await this.file.process((currentText) => {
      if (callbackCalled) {
        throw new KnowledgeRuntimeAtomicWriteError();
      }
      callbackCalled = true;
      const current = parseRuntimeText(currentText);
      const mutation = transform(current);
      result = mutation.value;
      if (!mutation.next) {
        expectedText = currentText;
        return currentText;
      }
      const next = parseKnowledgeRuntimeStoreSnapshot(mutation.next);
      this.assertUnfinishedTransactionFileAccessAuthority(next);
      changedBundleIds = findStudioChangedBundleIds(current, next);
      expectedText = JSON.stringify(next);
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText);
    this.emitStudioHints(changedBundleIds);
    return result as T;
  }

  /** Publishes isolated post-commit reload hints without carrying durable data. */
  private emitStudioHints(bundleIds: readonly string[]): void {
    for (const bundleId of bundleIds) {
      const listeners = this.studioListeners.get(bundleId);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // Studio hints are best-effort and never participate in Runtime commit success.
        }
      }
    }
  }

  /**
   * Proves every durable reservation required before Wiki file access.
   *
   * The Queue and Review own the exact accepted attempt, while the current
   * Manifest must still satisfy the accepted read-set and monotonic source
   * ordering. A transaction id already present in the success ledger can never
   * be reused as unfinished work.
   *
   * @param state - Complete atomic runtime snapshot
   * @param transaction - Exact accepted apply or unfinished transaction about to access files
   */
  private assertTransactionFileAccessAuthority(
    state: KnowledgeRuntimeStoreSnapshot,
    transaction: KnowledgeApplyAuthorityProof
  ): void {
    if (state.applyCommits.some((record) => record.transactionId === transaction.transactionId)) {
      throw new KnowledgeApplyCommitLedgerConflictError(transaction.transactionId);
    }
    assertApplyCommitRuntimeAuthority(state, transaction);
    const manifestRaw = findBundleSlot(state, "manifests", transaction.bundleId);
    const actualManifest =
      manifestRaw === null
        ? {
            version: 1 as const,
            bundleId: transaction.bundleId,
            revision: 0,
            entries: [],
          }
        : this.requireManifest(transaction.bundleId, manifestRaw);
    const source = actualManifest.entries.find(
      (entry) => entry.sourceId === transaction.jobClaim.sourceId
    );
    if (!source) {
      throw new KnowledgeApplyCommitManifestConflictError(
        transaction.bundleId,
        transaction.jobClaim.sourceId,
        "source_missing"
      );
    }
    const intentValidation = validateManifestCommitIntentForCommit(
      transaction.manifestCommitIntent,
      actualManifest,
      transaction.changeSet,
      transaction.bundle
    );
    if (!intentValidation.valid) {
      throw new KnowledgeApplyCommitManifestConflictError(
        transaction.bundleId,
        transaction.jobClaim.sourceId,
        "intent_invalid",
        intentValidation.diagnostics
      );
    }
    assertSourceInputRevisionCanCommit(
      source,
      transaction.bundleId,
      transaction.jobClaim.inputRevision,
      actualManifest,
      state.applyCommits
    );
  }

  /**
   * Preserves full file-access authority across every shared-envelope mutation.
   *
   * Startup parsing deliberately remains byte-preserving for legacy state, but
   * reading, recovering, or mutating unfinished work must prove the complete
   * Queue, Review, Manifest, ledger, and source-ordering reservation first.
   *
   * @param state - Strict candidate runtime envelope about to be committed
   */
  private assertUnfinishedTransactionFileAccessAuthority(
    state: KnowledgeRuntimeStoreSnapshot
  ): void {
    if (state.activeTransaction === null) {
      return;
    }
    const transaction = this.requireTransaction(state.activeTransaction);
    if (transaction.phase === "prepared" || transaction.phase === "applying") {
      this.assertTransactionFileAccessAuthority(state, transaction);
    }
  }

  /** Strictly parses and validates one queue slot. */
  private requireQueueSnapshot(bundleId: string, value: unknown): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(value);
    const validation = validateIngestQueueSnapshot(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("queue", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates one review slot. */
  private requireReviewSnapshot(bundleId: string, value: unknown): ChangeSetReviewSnapshot {
    const parsed = parseChangeSetReviewSnapshot(value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== bundleId
    ) {
      throw new KnowledgeRuntimeSlotValidationError("review", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates one Source Manifest slot. */
  private requireManifest(bundleId: string, value: unknown): SourceManifest {
    const parsed = parseSourceManifest(value);
    const validation = validateSourceManifest(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("manifest", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates the active transaction slot. */
  private requireTransaction(value: unknown): ChangeSetTransactionJournal {
    const parsed = parseChangeSetTransactionJournal(value);
    const validation = validateChangeSetTransactionJournal(value);
    if (!parsed.ok || !validation.valid) {
      throw new KnowledgeRuntimeSlotValidationError("transaction");
    }
    return cloneJson(parsed.value);
  }

  /** Requires a Bundle snapshot to advance its observed revision exactly once. */
  private assertNextBundleRevision(
    candidateRevision: number,
    expectedRevision: number | null,
    subsystem: "queue" | "review" | "manifest"
  ): void {
    const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
    if (
      expectedRevision === Number.MAX_SAFE_INTEGER ||
      candidateRevision !== nextRevision ||
      !Number.isSafeInteger(candidateRevision)
    ) {
      throw new TypeError(`${subsystem} snapshot must advance its observed revision exactly once`);
    }
  }

  /** Validates one allocation request before touching durable state. */
  private assertInputRevisionRequest(request: AllocateSourceInputRevisionRequest): void {
    assertIdentifier(request.bundleId, "bundleId");
    assertIdentifier(request.sourceId, "sourceId");
    assertIdentifier(request.captureId, "captureId");
  }

  /** Validates one source binding request before durable state access. */
  private assertObservationBindingRequest(request: BindSourceInputObservationRequest): void {
    this.assertObservationToken(request.observationToken);
    if (
      !sha256Schema.safeParse(request.sourceContentHash).success ||
      !sha256Schema.safeParse(request.pipelineFingerprint).success
    ) {
      throw new TypeError("Source observation hashes must be lowercase SHA-256 values");
    }
  }

  /** Validates one opaque observation token without revealing persisted state. */
  private assertObservationToken(observationToken: string): void {
    if (!opaqueIdSchema.safeParse(observationToken).success) {
      throw new SourceInputObservationTokenError();
    }
  }

  /** Returns one validated runtime-owned timestamp. */
  private now(): number {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("Runtime clock must return a non-negative safe integer");
    }
    return timestamp;
  }

  /** Returns one validated 128-bit opaque identifier from the injected factory. */
  private nextOpaqueId(field: string): string {
    const value = this.opaqueIdFactory();
    if (!opaqueIdSchema.safeParse(value).success) {
      throw new TypeError(`${field} factory must return 32 lowercase hexadecimal characters`);
    }
    return value;
  }
}

/** Compares nullable active-transaction tokens field by field. */
function sameTransactionToken(
  left: TransactionStorageToken | null,
  right: TransactionStorageToken | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.transactionId === right.transactionId &&
      left.revision === right.revision)
  );
}

/**
 * Selects the immutable transaction material shared by every journal revision.
 *
 * @param journal - Strict active transaction journal
 * @returns Canonicalizable immutable payload
 */
function selectActiveTransactionPayload(journal: ChangeSetTransactionJournal): JsonValue {
  return {
    version: journal.version,
    transactionId: journal.transactionId,
    bundleId: journal.bundleId,
    bundle: journal.bundle as unknown as JsonValue,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    manifestCommitIntent: journal.manifestCommitIntent as unknown as JsonValue,
    manifestCommitIntentDigest: journal.manifestCommitIntentDigest,
    jobClaim: journal.jobClaim as unknown as JsonValue,
    changeSet: journal.changeSet as unknown as JsonValue,
    targets: journal.targets as unknown as JsonValue,
    createdAt: journal.createdAt,
  };
}

/**
 * Compares the immutable identity and payload of two active journal revisions.
 *
 * @param left - Current durable journal
 * @param right - Candidate next journal
 * @returns Whether only transaction progress fields may differ
 */
function sameActiveTransactionPayload(
  left: ChangeSetTransactionJournal,
  right: ChangeSetTransactionJournal
): boolean {
  return (
    canonicalizeJson(selectActiveTransactionPayload(left)) ===
    canonicalizeJson(selectActiveTransactionPayload(right))
  );
}

/**
 * Requires one active journal replacement to follow the transaction state machine.
 *
 * @param current - Exact current durable journal
 * @param candidate - Strict next journal revision
 */
function assertActiveTransactionTransition(
  current: ChangeSetTransactionJournal,
  candidate: ChangeSetTransactionJournal
): void {
  if (
    !sameActiveTransactionPayload(current, candidate) ||
    candidate.updatedAt < current.updatedAt
  ) {
    throw new TypeError("An active transaction replacement must preserve its immutable payload");
  }
  const validTransition =
    (current.phase === "prepared" &&
      candidate.phase === "applying" &&
      candidate.appliedCount === current.appliedCount) ||
    (current.phase === "applying" &&
      candidate.phase === "applying" &&
      candidate.appliedCount === current.appliedCount + 1) ||
    (current.phase === "applying" &&
      candidate.phase === "committed" &&
      current.appliedCount === current.targets.length &&
      candidate.appliedCount === candidate.targets.length) ||
    (current.phase === "applying" &&
      candidate.phase === "recovery_required" &&
      candidate.appliedCount === current.appliedCount);
  if (!validTransition) {
    throw new TypeError("An active transaction replacement violates the transaction state machine");
  }
}

/** Hidden Runtime and lifecycle authority retained by one QueueStorage facade. */
interface KnowledgeRuntimeQueueStorageState {
  runtime: KnowledgeRuntimeStore;
  executionOwner: KnowledgeExecutionOwner;
}

const runtimeQueueStorageStates = new WeakMap<object, KnowledgeRuntimeQueueStorageState>();

/** Returns hidden state only for an authentic Runtime QueueStorage facade. */
function requireRuntimeQueueStorageState(value: unknown): KnowledgeRuntimeQueueStorageState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The Runtime Queue storage is invalid");
  }
  const state = runtimeQueueStorageStates.get(value);
  if (!state) throw new TypeError("The Runtime Queue storage is invalid");
  return state;
}

/** QueueStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeQueueStorage implements QueueStorage {
  /** Creates a queue facade over the shared runtime store and one workflow lifecycle owner. */
  constructor(
    runtime: KnowledgeRuntimeStore,
    executionOwner: KnowledgeExecutionOwner = createKnowledgeExecutionOwner()
  ) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Queue storage dependency is invalid");
    }
    KnowledgeExecutionOwner.assert(executionOwner);
    KnowledgeExecutionOwner.bindRuntime(executionOwner, runtime);
    runtimeQueueStorageStates.set(this, Object.freeze({ runtime, executionOwner }));
    Object.freeze(this);
  }

  /** Returns the opaque lifecycle identity required by the matching workflow loader. */
  getExecutionOwner(): KnowledgeExecutionOwner {
    return requireRuntimeQueueStorageState(this).executionOwner;
  }

  /** Reads one detached queue snapshot. */
  read(bundleId: string): Promise<unknown> {
    return requireRuntimeQueueStorageState(this).runtime.readQueue(bundleId);
  }

  /** Atomically compares and replaces one queue snapshot. */
  write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null,
    authority?: QueueWriteAuthority
  ): Promise<void> {
    return requireRuntimeQueueStorageState(this).runtime.writeQueue(
      bundleId,
      snapshot,
      expectedRevision,
      authority
    );
  }
}

Object.freeze(KnowledgeRuntimeQueueStorage.prototype);
Object.freeze(KnowledgeRuntimeQueueStorage);

/** Hidden Runtime and optional execution-owner authority retained by one Review facade. */
interface KnowledgeRuntimeReviewStorageState {
  runtime: KnowledgeRuntimeStore;
  executionOwner?: KnowledgeExecutionOwner;
}

const runtimeReviewStorageStates = new WeakMap<object, KnowledgeRuntimeReviewStorageState>();

/** Returns hidden state only for an authentic Runtime ReviewStorage facade. */
function requireRuntimeReviewStorageState(value: unknown): KnowledgeRuntimeReviewStorageState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeReviewStorage.prototype
  ) {
    throw new TypeError("The Runtime Review storage is invalid");
  }
  const state = runtimeReviewStorageStates.get(value);
  if (!state) throw new TypeError("The Runtime Review storage is invalid");
  return state;
}

/** ReviewStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeReviewStorage implements ReviewStorage {
  /**
   * Creates a Review facade, optionally branded for one exact Queue/workflow lifecycle.
   *
   * Recovery-only consumers do not need an execution owner. Production compile
   * handlers must supply the same opaque owner already bound to their Queue.
   */
  constructor(runtime: KnowledgeRuntimeStore, executionOwner?: KnowledgeExecutionOwner) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Review storage dependency is invalid");
    }
    if (executionOwner !== undefined) {
      KnowledgeExecutionOwner.assert(executionOwner);
      KnowledgeExecutionOwner.bindRuntime(executionOwner, runtime);
    }
    runtimeReviewStorageStates.set(this, Object.freeze({ runtime, executionOwner }));
    Object.freeze(this);
  }

  /** Requires an authentic facade carrying an explicit production execution owner. */
  static getExecutionOwner(value: unknown): KnowledgeExecutionOwner {
    const owner = requireRuntimeReviewStorageState(value).executionOwner;
    if (!owner) {
      throw new TypeError("The Runtime Review storage execution owner is unavailable");
    }
    KnowledgeExecutionOwner.assert(owner);
    return owner;
  }

  /** Reads one detached review snapshot. */
  read(bundleId: string): Promise<unknown> {
    return requireRuntimeReviewStorageState(this).runtime.readReview(bundleId);
  }

  /** Atomically compares and replaces one review snapshot. */
  write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return requireRuntimeReviewStorageState(this).runtime.writeReview(
      bundleId,
      snapshot,
      expectedRevision
    );
  }
}

Object.freeze(KnowledgeRuntimeReviewStorage.prototype);
Object.freeze(KnowledgeRuntimeReviewStorage);

/** Hidden Runtime authority retained by one narrow atomic Reject facade. */
const runtimeReviewRejectPortStates = new WeakMap<object, KnowledgeRuntimeStore>();

/** Returns hidden state only for an authentic Runtime atomic Reject facade. */
function requireRuntimeReviewRejectPortState(value: unknown): KnowledgeRuntimeStore {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeReviewRejectPort.prototype
  ) {
    throw new TypeError("The Runtime Review Reject port is invalid");
  }
  const runtime = runtimeReviewRejectPortStates.get(value);
  if (!runtime) throw new TypeError("The Runtime Review Reject port is invalid");
  return runtime;
}

/** Narrow Queue+Review mutation facade exposing only atomic literal rejection. */
export class KnowledgeRuntimeReviewRejectPort {
  /** Creates one Reject-only facade over the shared Runtime store. */
  constructor(runtime: KnowledgeRuntimeStore) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Review Reject dependency is invalid");
    }
    runtimeReviewRejectPortStates.set(this, runtime);
    Object.freeze(this);
  }

  /** Atomically rejects one exact pending Review or replays its exact final state. */
  rejectReviewAtomically(
    bundleId: string,
    command: unknown
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    return requireRuntimeReviewRejectPortState(this).rejectReviewAtomically(bundleId, command);
  }
}

Object.freeze(KnowledgeRuntimeReviewRejectPort.prototype);
Object.freeze(KnowledgeRuntimeReviewRejectPort);

/** SourceManifestStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeManifestStorage implements SourceManifestStorage {
  /** Creates a manifest facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached Source Manifest. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readManifest(bundleId);
  }

  /** Atomically compares and replaces one Source Manifest. */
  write(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeManifest(bundleId, manifest, expectedRevision);
  }
}

/** Read-only transaction preflight backed by the shared runtime envelope. */
export class KnowledgeRuntimeApplyAuthorityPort implements ChangeSetTransactionAuthorityPort {
  /** Creates the authority facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Re-proves one exact apply identity without accessing Wiki files. */
  verify(request: ChangeSetTransactionAuthorityRequest): Promise<void> {
    return this.runtime.verifyApplyAuthority(request);
  }
}

/** No-journal recovery state facade backed by the shared atomic runtime envelope. */
export class KnowledgeRuntimeNoJournalApplyRecoveryPort
  implements NoJournalApplyRecoveryStatePort, NoJournalApplyRecoverySnapshotPort
{
  /** Creates a no-journal recovery facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Classifies one accepted Review identity from one atomic runtime snapshot. */
  classify(identity: AcceptedReviewStartupIdentity): Promise<NoJournalApplyRecoveryClassification> {
    return this.runtime.classifyNoJournalApplyRecovery(identity);
  }

  /** Loads every accepted classification from one exact runtime-envelope revision. */
  loadSnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult> {
    return this.runtime.loadNoJournalApplyRecoverySnapshot(bundleId, expectedReviewRevision);
  }

  /** Reloads and fully re-proves one continuation without observing Wiki files. */
  loadContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<ChangeSetTransactionApplyInput> {
    return this.runtime.loadNoJournalApplyContinueInput(reference, bundle);
  }

  /** Atomically records one exact pre-journal abandonment or replays its receipt. */
  abandon(
    reference: NoJournalApplyRecoveryReference,
    abandonedAt: number
  ): Promise<NoJournalApplyAbandonReceipt> {
    return this.runtime.abandonNoJournalApply(reference, abandonedAt);
  }
}

/** Conditional startup release facade backed by the shared atomic runtime envelope. */
export class KnowledgeRuntimeStartupReleasePort implements KnowledgeStartupReleasePort {
  /** Creates a startup release facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Re-proves and conditionally releases one exact startup-recovery observation. */
  release(request: KnowledgeStartupReleaseRequest): Promise<KnowledgeStartupReleaseResult> {
    return this.runtime.releaseStartupRecovery(request);
  }
}

/** ApplyCommitManifestPort facade backed by the shared atomic runtime envelope. */
export class KnowledgeRuntimeApplyCommitManifestPort implements ApplyCommitManifestPort {
  /** Creates an exact Manifest/ledger facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Atomically records one exact committed transaction and final source projection. */
  recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void> {
    return this.runtime.recordApplyCommit(journal, receipt);
  }
}

/** TransactionStorage facade backed by one shared Vault-global atomic slot. */
export class KnowledgeRuntimeTransactionStorage implements TransactionStorage {
  /** Creates a transaction facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads the detached active transaction journal. */
  readActive(): Promise<unknown> {
    return this.runtime.readActiveTransaction();
  }

  /** Atomically compares and replaces the active transaction journal. */
  writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    return this.runtime.writeActiveTransaction(journal, expectedToken);
  }

  /** Atomically compares and clears the active transaction journal. */
  clearActive(expectedToken: TransactionStorageToken): Promise<void> {
    return this.runtime.clearActiveTransaction(expectedToken);
  }
}

/** Input-revision allocator facade backed by the shared atomic envelope. */
export class KnowledgeRuntimeInputRevisionAllocator implements SourceInputRevisionAllocator {
  /** Creates an allocator facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Allocates one strictly newer source observation revision. */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation> {
    return this.runtime.allocateInputRevision(request);
  }
}

/** Source-observation binding facade backed by the shared atomic envelope. */
export class KnowledgeRuntimeInputObservationBinder implements SourceInputObservationBinder {
  /** Creates a binding facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Binds one opaque allocation token to exact source and pipeline hashes. */
  bind(request: BindSourceInputObservationRequest): Promise<BindSourceInputObservationResult> {
    return this.runtime.bindInputObservation(request);
  }

  /** Reconciles one observation after Queue enqueue or an uncertain result. */
  settle(observationToken: string): Promise<SourceInputObservationSettlement> {
    return this.runtime.settleInputObservation(observationToken);
  }

  /** Loads pending allocations and bound observations for restart recovery. */
  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]> {
    return this.runtime.loadInputObservationRecoveryWork(bundleId);
  }
}

/** Hidden captured capability retained by one Runtime execution-proof facade. */
interface KnowledgeRuntimeIngestExecutionProofPortState {
  queueStorage: KnowledgeRuntimeQueueStorage;
  executionOwner: KnowledgeExecutionOwner;
  prove: (
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ) => Promise<unknown>;
}

const runtimeIngestExecutionProofPortStates = new WeakMap<
  object,
  KnowledgeRuntimeIngestExecutionProofPortState
>();

/** Captures the canonical Runtime proof data method during module initialization. */
function captureRuntimeIngestExecutionProofMethod(): KnowledgeRuntimeStore["proveIngestExecution"] {
  const descriptor = Object.getOwnPropertyDescriptor(
    KnowledgeRuntimeStore.prototype,
    "proveIngestExecution"
  );
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
  }
  return descriptor.value as KnowledgeRuntimeStore["proveIngestExecution"];
}

const runtimeIngestExecutionProofMethod = captureRuntimeIngestExecutionProofMethod();

/**
 * Returns the process-local captured capability for one authentic facade.
 *
 * @param value - Candidate Runtime execution-proof facade
 * @returns Hidden proof capability
 */
function requireRuntimeIngestExecutionProofPortState(
  value: unknown
): KnowledgeRuntimeIngestExecutionProofPortState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The Runtime ingest execution-proof port is invalid");
  }
  const state = runtimeIngestExecutionProofPortStates.get(value);
  if (!state) {
    throw new TypeError("The Runtime ingest execution-proof port is invalid");
  }
  return state;
}

/**
 * Narrow read-only execution-proof facade backed by one shared Runtime envelope.
 *
 * The Runtime receiver and its original proof method are retained only inside a
 * process-local WeakMap closure. The public object therefore exposes neither a
 * durable Runtime handle nor an own property that can be copied as authority.
 */
export class KnowledgeRuntimeIngestExecutionProofPort implements KnowledgeIngestExecutionProofPort {
  /** Captures the Runtime proof method and exact Queue facade without exposing either receiver. */
  constructor(runtime: KnowledgeRuntimeStore, queueStorage: KnowledgeRuntimeQueueStorage) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
    }
    const queueState = requireRuntimeQueueStorageState(queueStorage);
    if (queueState.runtime !== runtime) {
      throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
    }
    runtimeIngestExecutionProofPortStates.set(
      this,
      Object.freeze({
        queueStorage,
        executionOwner: queueState.executionOwner,
        prove: (request: Readonly<KnowledgeIngestExecutionProofRequest>, signal: AbortSignal) =>
          Reflect.apply(runtimeIngestExecutionProofMethod, runtime, [request, signal]),
      })
    );
    Object.freeze(this);
  }

  /** Requires an authentic process-local Runtime proof facade. */
  static assert(value: unknown): asserts value is KnowledgeRuntimeIngestExecutionProofPort {
    requireRuntimeIngestExecutionProofPortState(value);
  }

  /** Requires one Queue claim to come from this facade's exact Runtime QueueStorage instance. */
  static assertClaimOwner(
    value: KnowledgeRuntimeIngestExecutionProofPort,
    claim: IngestExecutionClaim
  ): void {
    const state = requireRuntimeIngestExecutionProofPortState(value);
    if (!ingestExecutionClaimMatchesQueueStorage(claim, state.queueStorage)) {
      throw new TypeError("The Runtime ingest execution-proof owner is invalid");
    }
  }

  /** Returns the opaque App/Vault/workflow lifecycle identity paired with this proof facade. */
  static getExecutionOwner(
    value: KnowledgeRuntimeIngestExecutionProofPort
  ): KnowledgeExecutionOwner {
    return requireRuntimeIngestExecutionProofPortState(value).executionOwner;
  }

  /** Derives one proof from a single atomic Runtime-envelope transform. */
  prove(
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ): Promise<unknown> {
    return requireRuntimeIngestExecutionProofPortState(this).prove(request, signal);
  }
}

Object.freeze(KnowledgeRuntimeIngestExecutionProofPort.prototype);
Object.freeze(KnowledgeRuntimeIngestExecutionProofPort);
