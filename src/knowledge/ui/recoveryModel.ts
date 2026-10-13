import type {
  NoJournalApplyRecoveryClassification,
  NoJournalApplyRecoverySnapshot,
} from "@/knowledge/recovery/NoJournalApplyRecovery";

export type KnowledgeRecoveryStatus =
  | "accepted_not_started"
  | "decision_required"
  | "transaction_active"
  | "apply_blocked"
  | "commit_finalizing"
  | "global_transaction"
  | "queue_recovery_required"
  | "queue_commit_pending_ack";

export interface KnowledgeRecoveryActions {
  canContinue: boolean;
  canAbandon: boolean;
}

export interface KnowledgeRecoveryItem {
  id: string;
  status: KnowledgeRecoveryStatus;
  actions: Readonly<KnowledgeRecoveryActions>;
  changeSetId?: string;
  transactionId?: string;
  phase?: "prepared" | "applying" | "recovery_required" | "committed";
  blockedReason?: "transaction_recovery_required" | "other_transaction_active";
  continueBlockedReason?: "manifest_read_set_changed";
}

export interface KnowledgeRecoveryModel {
  bundleId: string;
  runtimeRevision: number;
  items: readonly Readonly<KnowledgeRecoveryItem>[];
}

function createActions(canContinue: boolean, canAbandon: boolean): KnowledgeRecoveryActions {
  return Object.freeze({ canContinue, canAbandon });
}

function deriveClassificationItem(
  classification: NoJournalApplyRecoveryClassification
): KnowledgeRecoveryItem | undefined {
  switch (classification.kind) {
    case "accepted_not_started": {
      const continueBlockedReason = classification.continueBlockedReason;
      // A stale pre-start acceptance requires a fresh decision instead of a retry
      // against a Manifest read-set that can no longer commit.
      // https://github.com/yydspanda/obsidian-copilot/issues/2
      return Object.freeze({
        id: classification.reference.recoveryId,
        status: continueBlockedReason === undefined ? "accepted_not_started" : "decision_required",
        changeSetId: classification.changeSetId,
        ...(continueBlockedReason === undefined ? {} : { continueBlockedReason }),
        actions: createActions(
          continueBlockedReason === undefined,
          continueBlockedReason !== undefined
        ),
      });
    }
    case "requires_decision":
      // A stale accepted Manifest remains safely abandonable, but presenting
      // Continue would create a deterministic retry loop.
      // https://github.com/yydspanda/obsidian-copilot/issues/2
      return Object.freeze({
        id: classification.candidate.recoveryId,
        status: "decision_required",
        changeSetId: classification.candidate.changeSetId,
        ...(classification.candidate.continueBlockedReason === undefined
          ? {}
          : { continueBlockedReason: classification.candidate.continueBlockedReason }),
        actions: createActions(classification.candidate.continueBlockedReason === undefined, true),
      });
    case "active":
      return Object.freeze({
        id: classification.reference.recoveryId,
        status: "transaction_active",
        transactionId: classification.transactionId,
        phase: classification.phase,
        actions: createActions(false, false),
      });
    case "blocked":
      return Object.freeze({
        id: classification.reference.recoveryId,
        status: "apply_blocked",
        transactionId: classification.transactionId,
        blockedReason: classification.reason,
        actions: createActions(false, false),
      });
    case "finalizing":
      return Object.freeze({
        id: classification.reference.recoveryId,
        status: "commit_finalizing",
        transactionId: classification.transactionId,
        phase: "committed",
        actions: createActions(false, false),
      });
    case "committed":
    case "abandoned":
      return undefined;
  }
}

function hasTransaction(items: readonly KnowledgeRecoveryItem[], transactionId: string): boolean {
  return items.some((item) => item.transactionId === transactionId);
}

export function deriveKnowledgeRecoveryModel(
  snapshot: NoJournalApplyRecoverySnapshot
): Readonly<KnowledgeRecoveryModel> {
  const items = snapshot.classifications
    .map(deriveClassificationItem)
    .filter((item): item is KnowledgeRecoveryItem => item !== undefined);

  if (
    snapshot.globalTransaction !== null &&
    !hasTransaction(items, snapshot.globalTransaction.transactionId)
  ) {
    items.push(
      Object.freeze({
        id: `transaction:${snapshot.globalTransaction.transactionId}`,
        status: "global_transaction" as const,
        transactionId: snapshot.globalTransaction.transactionId,
        changeSetId: snapshot.globalTransaction.changeSetId,
        phase: snapshot.globalTransaction.phase,
        actions: createActions(false, false),
      })
    );
  }

  if (
    snapshot.queueSnapshot.control.status === "paused" &&
    snapshot.queueSnapshot.control.reason === "recovery_required" &&
    !items.some((item) => item.status === "apply_blocked")
  ) {
    items.push(
      Object.freeze({
        id: `queue:${snapshot.bundleId}:recovery_required`,
        status: "queue_recovery_required" as const,
        actions: createActions(false, false),
      })
    );
  }

  if (
    snapshot.queueSnapshot.control.status === "paused" &&
    snapshot.queueSnapshot.control.reason === "commit_pending_ack" &&
    !items.some((item) => item.status === "commit_finalizing")
  ) {
    items.push(
      Object.freeze({
        id: `queue:${snapshot.bundleId}:commit_pending_ack`,
        status: "queue_commit_pending_ack" as const,
        actions: createActions(false, false),
      })
    );
  }

  return Object.freeze({
    bundleId: snapshot.bundleId,
    runtimeRevision: snapshot.runtimeRevision,
    items: Object.freeze(items),
  });
}
