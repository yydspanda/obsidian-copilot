import type {
  TransactionCommitReceipt,
  TransactionRecoveryResult,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type { ChangeSetTransactionJournal } from "@/knowledge/changeset/TransactionStorage";
import type {
  IngestApplyCommitMarker,
  IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeBundleConfig, KnowledgeIngestJob } from "@/knowledge/model/types";

/** A committed journal whose page after-states are already durable. */
export type CommittedChangeSetTransactionJournal = ChangeSetTransactionJournal & {
  phase: "committed";
};

/** Minimal transaction operations required by post-commit reconciliation. */
export interface ApplyCommitTransactionPort {
  /**
   * Recovers or observes the Vault-global active transaction.
   *
   * @param bundle - Current Bundle configuration used for safe roll-forward
   * @returns No transaction, committed proof, or a blocked conflict
   */
  recoverOnStartup(bundle: KnowledgeBundleConfig): Promise<TransactionRecoveryResult>;

  /**
   * Reads the active journal after recovery reports a committed receipt.
   *
   * @returns Detached active journal, or null when the global slot is empty
   */
  loadActive(): Promise<ChangeSetTransactionJournal | null>;

  /**
   * Clears the exact committed journal after all downstream bookkeeping is durable.
   *
   * @param receipt - Exact durable commit proof to acknowledge
   * @returns Whether this call cleared the active journal
   */
  acknowledgeCommitted(receipt: TransactionCommitReceipt): Promise<boolean>;
}

/** Minimal ingest-queue operations required by post-commit reconciliation. */
export interface ApplyCommitQueuePort {
  /**
   * Read-only proof that the receipt owns the exact durable queue input.
   *
   * This MUST run before Manifest success is recorded. Implementations must
   * compare job, source, content, pipeline, input revision, attempt, and start
   * identity, then repeat the same proof inside resolveApplyRecovery.
   *
   * @param receipt - Exact durable page-commit proof
   * @returns Detached queue job currently owned by the receipt
   */
  verifyApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob>;

  /**
   * Durably completes the owning job and records a commit-pending marker.
   *
   * @param receipt - Exact durable page-commit proof
   * @returns Detached completed queue job
   */
  resolveApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob>;

  /**
   * Reads a queue marker left after the transaction journal was cleared.
   *
   * @param bundleId - Bundle whose queue may still await acknowledgement
   * @returns Detached pending marker, or null when none exists
   */
  getPendingApplyCommit(bundleId: string): Promise<IngestApplyCommitMarker | null>;

  /**
   * Releases the commit-pending marker after the transaction journal is durably clear.
   *
   * @param bundleId - Bundle whose queue is being reconciled
   * @param transactionId - Exact transaction represented by the marker
   * @returns Detached reconciled queue snapshot
   */
  finalizeApplyRecovery(bundleId: string, transactionId: string): Promise<IngestQueueSnapshot>;
}

/** Manifest operation that records one already-durable page commit. */
export interface ApplyCommitManifestPort {
  /**
   * Durably records the successful source compile represented by one commit.
   *
   * Implementations MUST be idempotent for the exact transaction, revision,
   * ChangeSet digest, and receipt. Repeating the same call after a crash must
   * preserve one logical success, while a conflicting identity must fail closed.
   * The promise MUST resolve only after the manifest update is durable.
   *
   * @param journal - Complete committed journal with source and ChangeSet context
   * @param receipt - Exact content-addressed proof derived from the journal
   */
  recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void>;
}

/** Constructor dependencies for the pure post-commit coordinator. */
export interface ApplyCommitCoordinatorDependencies {
  transaction: ApplyCommitTransactionPort;
  queue: ApplyCommitQueuePort;
  manifest: ApplyCommitManifestPort;
}

/** Observable outcome of one startup post-commit reconciliation pass. */
export type ApplyCommitReconciliationResult =
  | { kind: "none" }
  | Extract<TransactionRecoveryResult, { kind: "blocked" }>
  | {
      kind: "finalized_pending_ack";
      transactionId: string;
      queueSnapshot: IngestQueueSnapshot;
    }
  | {
      kind: "committed";
      action: Extract<TransactionRecoveryResult, { kind: "committed" }>["action"];
      receipt: TransactionCommitReceipt;
      job: KnowledgeIngestJob;
      queueSnapshot: IngestQueueSnapshot;
    };

/** Stable reasons a recovery receipt cannot identify the loaded committed journal. */
export type ApplyCommitIdentityErrorReason =
  | "bundle_mismatch"
  | "journal_missing"
  | "journal_not_committed"
  | "receipt_mismatch";

/** Reports torn or conflicting transaction identity during reconciliation. */
export class ApplyCommitIdentityError extends Error {
  /**
   * Creates a fail-closed reconciliation identity error.
   *
   * @param transactionId - Transaction reported by recovery
   * @param reason - Stable mismatch category
   */
  constructor(
    public readonly transactionId: string,
    public readonly reason: ApplyCommitIdentityErrorReason
  ) {
    super(`Committed transaction '${transactionId}' could not be identified during reconciliation`);
    this.name = "ApplyCommitIdentityError";
  }
}

/** Reports a journal acknowledgement that did not clear the expected active slot. */
export class ApplyCommitAcknowledgeError extends Error {
  /**
   * Creates a fail-closed acknowledgement error.
   *
   * @param transactionId - Exact committed transaction that was not cleared
   */
  constructor(public readonly transactionId: string) {
    super(`Committed transaction '${transactionId}' was not acknowledged`);
    this.name = "ApplyCommitAcknowledgeError";
  }
}

/**
 * Compares a journal target's after-state with one receipt target.
 *
 * @param journalTarget - Durable target retained in the transaction journal
 * @param receiptTarget - Content-addressed target exposed by the receipt
 * @returns Whether both describe the exact same post-commit path state
 */
function targetMatchesReceipt(
  journalTarget: ChangeSetTransactionJournal["targets"][number],
  receiptTarget: TransactionCommitReceipt["targets"][number]
): boolean {
  if (
    journalTarget.path !== receiptTarget.path ||
    journalTarget.after.kind !== receiptTarget.kind
  ) {
    return false;
  }
  return (
    journalTarget.after.kind === "missing" ||
    (receiptTarget.kind === "file" && journalTarget.after.contentHash === receiptTarget.contentHash)
  );
}

/**
 * Compares every public receipt field with its committed journal source.
 *
 * @param journal - Loaded committed journal
 * @param receipt - Receipt reported by startup transaction recovery
 * @returns Whether the receipt is exactly derived from the journal
 */
function journalMatchesReceipt(
  journal: CommittedChangeSetTransactionJournal,
  receipt: TransactionCommitReceipt
): boolean {
  return (
    journal.transactionId === receipt.transactionId &&
    journal.revision === receipt.commitRevision &&
    journal.bundleId === receipt.bundleId &&
    journal.changeSetId === receipt.changeSetId &&
    journal.changeSetDigest === receipt.changeSetDigest &&
    journal.jobClaim.jobId === receipt.jobClaim.jobId &&
    journal.jobClaim.attempt === receipt.jobClaim.attempt &&
    journal.jobClaim.startedAt === receipt.jobClaim.startedAt &&
    journal.jobClaim.sourceId === receipt.jobClaim.sourceId &&
    journal.jobClaim.sourceContentHash === receipt.jobClaim.sourceContentHash &&
    journal.jobClaim.pipelineFingerprint === receipt.jobClaim.pipelineFingerprint &&
    journal.jobClaim.inputRevision === receipt.jobClaim.inputRevision &&
    journal.committedAt === receipt.committedAt &&
    journal.targets.length === receipt.targets.length &&
    journal.targets.every((target, index) => targetMatchesReceipt(target, receipt.targets[index]))
  );
}

/**
 * Coordinates crash-safe bookkeeping after a ChangeSet's page files commit.
 *
 * After a read-only exact queue-claim proof, persistence order is intentionally
 * fixed: manifest, queue commit marker, journal acknowledgement, then
 * queue-marker release. Each earlier durable artifact therefore remains
 * sufficient for a later startup pass to converge.
 */
export class ApplyCommitCoordinator {
  private readonly transaction: ApplyCommitTransactionPort;
  private readonly queue: ApplyCommitQueuePort;
  private readonly manifest: ApplyCommitManifestPort;

  /**
   * Creates a coordinator over transaction, queue, and manifest ports.
   *
   * @param dependencies - Pure durable reconciliation ports
   */
  constructor(dependencies: ApplyCommitCoordinatorDependencies) {
    this.transaction = dependencies.transaction;
    this.queue = dependencies.queue;
    this.manifest = dependencies.manifest;
  }

  /**
   * Reconciles one Bundle's active commit and any leftover queue marker.
   *
   * A blocked transaction is returned without touching downstream state. When
   * no journal remains, only an existing queue marker may be finalized. For a
   * committed journal, no acknowledgement occurs until manifest and queue state
   * are both durable.
   *
   * @param bundle - Current Bundle configuration
   * @returns Discriminated reconciliation outcome
   */
  async reconcile(bundle: KnowledgeBundleConfig): Promise<ApplyCommitReconciliationResult> {
    const recovery = await this.transaction.recoverOnStartup(bundle);
    if (recovery.kind === "blocked") {
      return recovery;
    }
    if (recovery.kind === "none") {
      const marker = await this.queue.getPendingApplyCommit(bundle.id);
      if (!marker) {
        return { kind: "none" };
      }
      const queueSnapshot = await this.queue.finalizeApplyRecovery(bundle.id, marker.transactionId);
      return {
        kind: "finalized_pending_ack",
        transactionId: marker.transactionId,
        queueSnapshot,
      };
    }

    const { receipt } = recovery;
    if (receipt.bundleId !== bundle.id) {
      throw new ApplyCommitIdentityError(receipt.transactionId, "bundle_mismatch");
    }
    const active = await this.transaction.loadActive();
    if (!active) {
      throw new ApplyCommitIdentityError(receipt.transactionId, "journal_missing");
    }
    if (active.phase !== "committed") {
      throw new ApplyCommitIdentityError(receipt.transactionId, "journal_not_committed");
    }
    if (!journalMatchesReceipt(active, receipt)) {
      throw new ApplyCommitIdentityError(receipt.transactionId, "receipt_mismatch");
    }

    await this.queue.verifyApplyRecovery(receipt);
    await this.manifest.recordCommitted(active, receipt);
    const job = await this.queue.resolveApplyRecovery(receipt);
    const acknowledged = await this.transaction.acknowledgeCommitted(receipt);
    if (!acknowledged) {
      throw new ApplyCommitAcknowledgeError(receipt.transactionId);
    }
    const queueSnapshot = await this.queue.finalizeApplyRecovery(bundle.id, receipt.transactionId);
    return {
      kind: "committed",
      action: recovery.action,
      receipt,
      job,
      queueSnapshot,
    };
  }
}
