import type {
  ChangeSetTransactionApplyInput,
  TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import { sha256 } from "@/utils/hash";

export interface NoJournalApplyRecoveryReference {
  bundleId: string;
  recoveryId: string;
}

export interface NoJournalApplyGlobalTransactionObservation {
  transactionId: string;
  bundleId: string;
  changeSetId: string;
  phase: "prepared" | "applying" | "recovery_required" | "committed";
}

export interface NoJournalApplyRecoveryCandidate extends NoJournalApplyRecoveryReference {
  jobId: string;
  changeSetId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
  startedAt: number;
  acceptedAt: number;
  continueBlockedReason?: "manifest_read_set_changed";
}

export type NoJournalApplyRecoveryClassification =
  | {
      kind: "accepted_not_started";
      reference: NoJournalApplyRecoveryReference;
      bundleId: string;
      changeSetId: string;
      jobId: string;
      continueBlockedReason?: "manifest_read_set_changed";
    }
  | { kind: "requires_decision"; candidate: NoJournalApplyRecoveryCandidate }
  | {
      kind: "active";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
      phase: "prepared" | "applying";
    }
  | {
      kind: "blocked";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
      reason: "transaction_recovery_required" | "other_transaction_active";
    }
  | {
      kind: "finalizing";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
    }
  | {
      kind: "committed";
      reference: NoJournalApplyRecoveryReference;
      transactionId: string;
    }
  | {
      kind: "abandoned";
      reference: NoJournalApplyRecoveryReference;
      jobId: string;
      changeSetId: string;
      abandonedAt: number;
    };

export type NoJournalApplyRecoveryIdentityMaterial = Pick<
  AcceptedReviewStartupIdentity,
  | "changeSetId"
  | "proposalDigest"
  | "recordedAt"
  | "acceptedDigest"
  | "manifestCommitIntentDigest"
  | "acceptedAt"
  | "jobClaim"
>;

export function createNoJournalApplyRecoveryReference(
  bundleId: string,
  identity: NoJournalApplyRecoveryIdentityMaterial
): NoJournalApplyRecoveryReference {
  const material: JsonValue = {
    version: 1,
    bundleId,
    changeSetId: identity.changeSetId,
    proposalDigest: identity.proposalDigest,
    recordedAt: identity.recordedAt,
    acceptedDigest: identity.acceptedDigest,
    manifestCommitIntentDigest: identity.manifestCommitIntentDigest,
    acceptedAt: identity.acceptedAt,
    jobClaim: { ...identity.jobClaim },
  };
  return {
    bundleId,
    recoveryId: `knowledge-no-journal-${sha256(
      `obsidian-copilot-knowledge-no-journal-apply-recovery-v1\n${canonicalizeJson(material)}`
    )}`,
  };
}

export interface NoJournalApplyAbandonReceipt extends NoJournalApplyRecoveryReference {
  jobId: string;
  changeSetId: string;
  abandonedAt: number;
}

export interface NoJournalApplyRecoverySnapshot {
  bundleId: string;
  runtimeRevision: number;
  reviewRevision: number;
  queueSnapshot: IngestQueueSnapshot;
  globalTransaction: NoJournalApplyGlobalTransactionObservation | null;
  classifications: readonly NoJournalApplyRecoveryClassification[];
}

export type NoJournalApplyRecoverySnapshotLoadResult =
  | { kind: "loaded"; snapshot: NoJournalApplyRecoverySnapshot }
  | {
      kind: "review_revision_changed";
      bundleId: string;
      runtimeRevision: number;
      expectedReviewRevision: number;
      actualReviewRevision: number;
    };

export interface NoJournalApplyRecoverySnapshotPort {
  loadSnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult>;
}

export interface NoJournalApplyRecoveryStatePort {
  classify(identity: AcceptedReviewStartupIdentity): Promise<NoJournalApplyRecoveryClassification>;

  loadContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<ChangeSetTransactionApplyInput>;

  abandon(
    reference: NoJournalApplyRecoveryReference,
    abandonedAt: number
  ): Promise<NoJournalApplyAbandonReceipt>;
}

export interface NoJournalApplyRecoveryTransactionPort {
  apply(input: ChangeSetTransactionApplyInput): Promise<TransactionCommitReceipt>;
}

export interface NoJournalApplyRecoveryCoordinatorDependencies {
  state: NoJournalApplyRecoveryStatePort;
  transaction: NoJournalApplyRecoveryTransactionPort;
  now?: () => number;
}

export class NoJournalApplyRecoveryClockError extends TypeError {
  constructor() {
    super("clock must return a non-negative safe integer");
    this.name = "NoJournalApplyRecoveryClockError";
  }
}

export class NoJournalApplyRecoveryCoordinator {
  private readonly state: NoJournalApplyRecoveryStatePort;
  private readonly transaction: NoJournalApplyRecoveryTransactionPort;
  private readonly clock: () => number;

  constructor(dependencies: NoJournalApplyRecoveryCoordinatorDependencies) {
    this.state = dependencies.state;
    this.transaction = dependencies.transaction;
    this.clock = dependencies.now ?? Date.now;
  }

  async classify(
    identity: AcceptedReviewStartupIdentity
  ): Promise<NoJournalApplyRecoveryClassification> {
    return this.state.classify(identity);
  }

  async continue(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<TransactionCommitReceipt> {
    const input = await this.state.loadContinueInput(reference, bundle);
    return this.transaction.apply(input);
  }

  async abandon(reference: NoJournalApplyRecoveryReference): Promise<NoJournalApplyAbandonReceipt> {
    const abandonedAt = this.clock();
    if (!Number.isSafeInteger(abandonedAt) || abandonedAt < 0) {
      throw new NoJournalApplyRecoveryClockError();
    }
    return this.state.abandon(reference, abandonedAt);
  }
}
