import type {
  NoJournalApplyRecoveryClassification,
  NoJournalApplyRecoverySnapshot,
} from "@/knowledge/recovery/NoJournalApplyRecovery";

/** Stable recovery conditions rendered without exposing note content or source paths. */
export type KnowledgeRecoveryStatus =
  | "accepted_not_started"
  | "decision_required"
  | "transaction_active"
  | "apply_blocked"
  | "commit_finalizing"
  | "global_transaction"
  | "queue_recovery_required"
  | "queue_commit_pending_ack";

/** Explicit actions allowed by one freshly re-proved durable recovery state. */
export interface KnowledgeRecoveryActions {
  canContinue: boolean;
  canAbandon: boolean;
}

/** One opaque recovery row derived from a single Runtime-envelope observation. */
export interface KnowledgeRecoveryItem {
  id: string;
  status: KnowledgeRecoveryStatus;
  actions: Readonly<KnowledgeRecoveryActions>;
  changeSetId?: string;
  transactionId?: string;
  phase?: "prepared" | "applying" | "recovery_required" | "committed";
  blockedReason?: "transaction_recovery_required" | "other_transaction_active";
}

/** Complete immutable recovery projection for one configured Bundle. */
export interface KnowledgeRecoveryModel {
  bundleId: string;
  runtimeRevision: number;
  items: readonly Readonly<KnowledgeRecoveryItem>[];
}

/** Creates frozen action flags for one recovery row. */
function createActions(canContinue: boolean, canAbandon: boolean): KnowledgeRecoveryActions {
  return Object.freeze({ canContinue, canAbandon });
}

/** Converts one accepted Review classification into a safe recovery row, if still actionable. */
function deriveClassificationItem(
  classification: NoJournalApplyRecoveryClassification
): KnowledgeRecoveryItem | undefined {
  switch (classification.kind) {
    case "accepted_not_started":
      return Object.freeze({
        id: classification.reference.recoveryId,
        status: "accepted_not_started",
        changeSetId: classification.changeSetId,
        actions: createActions(true, false),
      });
    case "requires_decision":
      return Object.freeze({
        id: classification.candidate.recoveryId,
        status: "decision_required",
        changeSetId: classification.candidate.changeSetId,
        actions: createActions(true, true),
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

/** Reports whether an accepted classification already represents one global transaction. */
function hasTransaction(items: readonly KnowledgeRecoveryItem[], transactionId: string): boolean {
  return items.some((item) => item.transactionId === transactionId);
}

/**
 * Derives a deterministic, content-free recovery model from one atomic Runtime snapshot.
 *
 * Action flags are only optimistic display hints. Production commands must reload
 * the opaque recovery id and repeat every Queue, Review, Manifest, and transaction proof.
 */
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
