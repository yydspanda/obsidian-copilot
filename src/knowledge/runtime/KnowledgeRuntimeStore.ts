import { z } from "zod";

import {
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
  SourceInputRevisionAllocation,
  SourceInputRevisionAllocator,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestApplyAbandonment,
  type IngestApplyClaimMarker,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  parseManifestCommitIntent,
  validateManifestCommitIntent,
  validateManifestCommitIntentForCommit,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
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
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeIngestJob,
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
import type {
  NoJournalApplyAbandonReceipt,
  NoJournalApplyRecoveryCandidate,
  NoJournalApplyRecoveryClassification,
  NoJournalApplyRecoveryReference,
  NoJournalApplyRecoveryStatePort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
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
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import { sha256 } from "@/utils/hash";

/** Current format of the Vault-private atomic knowledge runtime store. */
export const KNOWLEDGE_RUNTIME_STORE_VERSION = 2 as const;

/** Previous outer-envelope format eligible for one constrained startup migration. */
const LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION = 1 as const;

/** Reserved Source Manifest extension containing monotonic runtime commit metadata. */
export const KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY =
  "obsidianCopilotKnowledgeRuntimeCommit" as const;

/** One per-Bundle snapshot stored inside the atomic runtime envelope. */
interface KnowledgeRuntimeBundleSlot {
  bundleId: string;
  value: object;
}

/** Latest monotonic observation revision allocated for one source. */
export interface KnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;
}

/** Per-Bundle input-revision namespace retained across application restarts. */
interface KnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: KnowledgeRuntimeInputRevisionRecord[];
}

/** Runtime-owned monotonic source metadata stored through the Manifest extension bag. */
interface KnowledgeRuntimeSourceCommitExtension {
  version: 1;
  inputRevision: number;
  transactionId: string;
  manifestIntentDigest: string;
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
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
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
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: object[];
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();

const runtimeBundleSlotSchema: z.ZodType<KnowledgeRuntimeBundleSlot> = z
  .object({
    bundleId: nonEmptyStringSchema,
    value: z.record(z.unknown()),
  })
  .strict();

const runtimeInputRevisionRecordSchema: z.ZodType<KnowledgeRuntimeInputRevisionRecord> = z
  .object({
    sourceId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeInputRevisionBundleSchema: z.ZodType<KnowledgeRuntimeInputRevisionBundle> = z
  .object({
    bundleId: nonEmptyStringSchema,
    sources: z.array(runtimeInputRevisionRecordSchema),
  })
  .strict();

const runtimeSourceCommitExtensionSchema: z.ZodType<KnowledgeRuntimeSourceCommitExtension> = z
  .object({
    version: z.literal(1),
    inputRevision: z.number().int().safe().nonnegative(),
    transactionId: nonEmptyStringSchema,
    manifestIntentDigest: sha256Schema,
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
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(z.record(z.unknown())),
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
  | "reserved_commit_extension";

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

/** Creates the first empty strict runtime envelope. */
export function createEmptyKnowledgeRuntimeStoreSnapshot(): KnowledgeRuntimeStoreSnapshot {
  return {
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
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
function assertRuntimeSlotSemantics(snapshot: KnowledgeRuntimeStoreSnapshot): void {
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
  bundles: readonly KnowledgeRuntimeInputRevisionBundle[]
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
      const extension = runtimeSourceCommitExtensionSchema.safeParse(rawExtension);
      if (!extension.success || history.length === 0) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const latest = [...history].sort(
        (left, right) => right.manifestAfterRevision - left.manifestAfterRevision
      )[0];
      if (
        extension.data.transactionId !== latest.transactionId ||
        extension.data.inputRevision !== latest.inputRevision ||
        extension.data.manifestIntentDigest !== latest.manifestIntentDigest ||
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
  const material: JsonValue = {
    version: 1,
    bundleId,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordedAt: record.recordedAt,
    acceptedDigest: record.acceptedDigest,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: { ...record.jobClaim },
  };
  return `knowledge-no-journal-${sha256(
    `obsidian-copilot-knowledge-no-journal-apply-recovery-v1\n${canonicalizeJson(material)}`
  )}`;
}

/**
 * Creates the public opaque reference for one accepted record.
 *
 * @param bundleId - Bundle containing the accepted record
 * @param record - Exact immutable accepted Review record
 * @returns Detached recovery reference
 */
function createNoJournalApplyRecoveryReference(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): NoJournalApplyRecoveryReference {
  return {
    bundleId,
    recoveryId: createNoJournalApplyRecoveryId(bundleId, record),
  };
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
  const parsed = runtimeSourceCommitExtensionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_invalid"
    );
  }
  return parsed.data;
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
  if (previous !== null && inputRevision <= previous.inputRevision) {
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
  const nextEntry: SourceManifestEntry = {
    ...source,
    lastSuccessful: snapshot,
    extensions: {
      ...source.extensions,
      [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: extension as unknown as JsonValue,
    },
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
 * Performs the only supported v1-to-v2 outer-envelope migration.
 *
 * The migration preserves Queue, Manifest, and input-revision payloads exactly,
 * upgrades empty Review slots, and refuses all states carrying recovery work.
 *
 * @param value - Unknown parsed runtime JSON
 * @returns Strict detached runtime-v2 snapshot
 */
function migrateLegacyRuntimeSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
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
  return parseKnowledgeRuntimeStoreSnapshot({
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    revision: legacy.revision + 1,
    queues: legacy.queues,
    reviews,
    manifests: legacy.manifests,
    activeTransaction: null,
    inputRevisions: legacy.inputRevisions,
    applyCommits: [],
  });
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
  /** Creates a runtime store over an atomic plaintext-file implementation. */
  constructor(private readonly file: AtomicRuntimeFile) {}

  /** Initializes and validates the durable runtime file without overwriting it. */
  async initialize(): Promise<void> {
    const initial = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot());
    await this.file.initialize(initial);
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
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireQueueSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "queue");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "queues", bundleId);
      const actualRevision =
        currentRaw === null ? null : this.requireQueueSnapshot(bundleId, currentRaw).revision;
      if (actualRevision !== expectedRevision) {
        throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          queues: replaceBundleSlot(state.queues, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /** Reads one detached review snapshot or null. */
  async readReview(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("reviews", bundleId);
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
      };
      const nextBundle: KnowledgeRuntimeInputRevisionBundle = {
        bundleId: request.bundleId,
        sources: (bundle
          ? bundle.sources.some((source) => source.sourceId === request.sourceId)
            ? bundle.sources.map((source) =>
                source.sourceId === request.sourceId ? nextRecord : source
              )
            : [...bundle.sources, nextRecord]
          : [nextRecord]
        ).sort((left, right) => compareIdentifiers(left.sourceId, right.sourceId)),
      };
      const inputRevisions = (
        bundle
          ? state.inputRevisions.map((candidate) =>
              candidate.bundleId === request.bundleId ? nextBundle : candidate
            )
          : [...state.inputRevisions, nextBundle]
      ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          inputRevisions,
        },
        value: { inputRevision: nextRecord.inputRevision },
      };
    });
  }

  /** Migrates one provably idle v1 envelope through a single atomic transform. */
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
      if (value.version !== LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      expectedText = JSON.stringify(migrateLegacyRuntimeSnapshot(value));
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

  /** Runs one synchronous state transform through the atomic file boundary. */
  private async updateState<T>(
    transform: (state: KnowledgeRuntimeStoreSnapshot) => RuntimeMutation<T>
  ): Promise<T> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    let result: T | undefined;
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
      expectedText = JSON.stringify(next);
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText);
    return result as T;
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

/** QueueStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeQueueStorage implements QueueStorage {
  /** Creates a queue facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached queue snapshot. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readQueue(bundleId);
  }

  /** Atomically compares and replaces one queue snapshot. */
  write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeQueue(bundleId, snapshot, expectedRevision);
  }
}

/** ReviewStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeReviewStorage implements ReviewStorage {
  /** Creates a review facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached review snapshot. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readReview(bundleId);
  }

  /** Atomically compares and replaces one review snapshot. */
  write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeReview(bundleId, snapshot, expectedRevision);
  }
}

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
export class KnowledgeRuntimeNoJournalApplyRecoveryPort implements NoJournalApplyRecoveryStatePort {
  /** Creates a no-journal recovery facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Classifies one accepted Review identity from one atomic runtime snapshot. */
  classify(identity: AcceptedReviewStartupIdentity): Promise<NoJournalApplyRecoveryClassification> {
    return this.runtime.classifyNoJournalApplyRecovery(identity);
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
