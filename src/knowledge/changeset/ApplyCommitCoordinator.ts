import {
  transactionCommitReceiptMatchesJournal,
  type TransactionCommitReceipt,
  type TransactionRecoveryResult,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type { ChangeSetTransactionJournal } from "@/knowledge/changeset/TransactionStorage";
import type {
  IngestApplyCommitMarker,
  IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeBundleConfig, KnowledgeIngestJob } from "@/knowledge/model/types";

export type CommittedChangeSetTransactionJournal = ChangeSetTransactionJournal & {
  phase: "committed";
};

export interface ApplyCommitTransactionPort {
  recoverOnStartup(bundle: KnowledgeBundleConfig): Promise<TransactionRecoveryResult>;

  loadActive(): Promise<ChangeSetTransactionJournal | null>;

  acknowledgeCommitted(receipt: TransactionCommitReceipt): Promise<boolean>;
}

export interface ApplyCommitQueuePort {
  verifyApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob>;

  resolveApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob>;

  getPendingApplyCommit(bundleId: string): Promise<IngestApplyCommitMarker | null>;

  finalizeApplyRecovery(bundleId: string, transactionId: string): Promise<IngestQueueSnapshot>;
}

export interface ApplyCommitManifestPort {
  recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void>;
}

export interface ApplyCommitCoordinatorDependencies {
  transaction: ApplyCommitTransactionPort;
  queue: ApplyCommitQueuePort;
  manifest: ApplyCommitManifestPort;
}

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

export type ApplyCommitIdentityErrorReason =
  | "bundle_mismatch"
  | "journal_missing"
  | "journal_not_committed"
  | "receipt_mismatch";

export class ApplyCommitIdentityError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly reason: ApplyCommitIdentityErrorReason
  ) {
    super(`Committed transaction '${transactionId}' could not be identified during reconciliation`);
    this.name = "ApplyCommitIdentityError";
  }
}

export class ApplyCommitAcknowledgeError extends Error {
  constructor(public readonly transactionId: string) {
    super(`Committed transaction '${transactionId}' was not acknowledged`);
    this.name = "ApplyCommitAcknowledgeError";
  }
}

export class ApplyCommitCoordinator {
  private readonly transaction: ApplyCommitTransactionPort;
  private readonly queue: ApplyCommitQueuePort;
  private readonly manifest: ApplyCommitManifestPort;

  constructor(dependencies: ApplyCommitCoordinatorDependencies) {
    this.transaction = dependencies.transaction;
    this.queue = dependencies.queue;
    this.manifest = dependencies.manifest;
  }

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
    if (!transactionCommitReceiptMatchesJournal(receipt, active)) {
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
