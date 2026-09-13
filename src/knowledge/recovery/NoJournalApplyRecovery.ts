import type {
  ChangeSetTransactionApplyInput,
  TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import { sha256 } from "@/utils/hash";

/** Opaque durable reference to one accepted apply whose journal was never published. */
export interface NoJournalApplyRecoveryReference {
  bundleId: string;
  recoveryId: string;
}

/** Sanitized Vault-global transaction slot observed with one atomic recovery snapshot. */
export interface NoJournalApplyGlobalTransactionObservation {
  transactionId: string;
  bundleId: string;
  changeSetId: string;
  phase: "prepared" | "applying" | "recovery_required" | "committed";
}

/** Exact accepted Queue attempt that requires an explicit no-journal decision. */
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

/** Durable classification of one accepted Review record at the runtime authority boundary. */
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

/** Immutable accepted fields used to correlate Review actions with Runtime classifications. */
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

/**
 * Creates the stable opaque recovery reference shared by Review and Runtime boundaries.
 *
 * @param bundleId - Bundle containing the accepted Review
 * @param identity - Immutable accepted Review identity material
 * @returns Content-addressed Bundle-scoped recovery reference
 */
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

/** Durable receipt proving that an exact no-journal apply was explicitly abandoned. */
export interface NoJournalApplyAbandonReceipt extends NoJournalApplyRecoveryReference {
  jobId: string;
  changeSetId: string;
  abandonedAt: number;
}

/**
 * One atomic, display-only recovery observation for every accepted Review in a Bundle.
 *
 * The runtime revision is an optimistic observation token, never an authority
 * token. Continue and abandon operations must still reload and re-prove their
 * exact durable evidence.
 */
export interface NoJournalApplyRecoverySnapshot {
  bundleId: string;
  runtimeRevision: number;
  reviewRevision: number;
  queueSnapshot: IngestQueueSnapshot;
  globalTransaction: NoJournalApplyGlobalTransactionObservation | null;
  classifications: readonly NoJournalApplyRecoveryClassification[];
}

/** Result of loading an atomic recovery snapshot against one observed Review revision. */
export type NoJournalApplyRecoverySnapshotLoadResult =
  | { kind: "loaded"; snapshot: NoJournalApplyRecoverySnapshot }
  | {
      kind: "review_revision_changed";
      bundleId: string;
      runtimeRevision: number;
      expectedReviewRevision: number;
      actualReviewRevision: number;
    };

/** Atomic read port used by the higher-level startup recovery gate. */
export interface NoJournalApplyRecoverySnapshotPort {
  /**
   * Loads Queue and all accepted classifications from one runtime envelope.
   *
   * @param bundleId - Bundle whose accepted Reviews must be classified
   * @param expectedReviewRevision - Review revision reconciled immediately beforehand
   * @returns Atomic snapshot or an explicit optimistic-revision miss
   */
  loadSnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult>;
}

/** Atomic runtime state operations required by the no-journal recovery coordinator. */
export interface NoJournalApplyRecoveryStatePort {
  /** Classifies one durable accepted Review identity without mutating state. */
  classify(identity: AcceptedReviewStartupIdentity): Promise<NoJournalApplyRecoveryClassification>;

  /** Reloads and re-proves the exact durable input immediately before apply. */
  loadContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<ChangeSetTransactionApplyInput>;

  /** Atomically abandons the exact accepted attempt when no file mutation can have begun. */
  abandon(
    reference: NoJournalApplyRecoveryReference,
    abandonedAt: number
  ): Promise<NoJournalApplyAbandonReceipt>;
}

/** Transaction operation permitted after the runtime has re-proved a continuation input. */
export interface NoJournalApplyRecoveryTransactionPort {
  /** Begins or resumes the exact accepted ChangeSet transaction. */
  apply(input: ChangeSetTransactionApplyInput): Promise<TransactionCommitReceipt>;
}

/** Constructor dependencies for the adapter-driven no-journal recovery coordinator. */
export interface NoJournalApplyRecoveryCoordinatorDependencies {
  state: NoJournalApplyRecoveryStatePort;
  transaction: NoJournalApplyRecoveryTransactionPort;
  now?: () => number;
}

/** Reports an injected clock value that cannot safely identify an abandonment decision. */
export class NoJournalApplyRecoveryClockError extends TypeError {
  /** Creates a deterministic invalid-clock error. */
  constructor() {
    super("clock must return a non-negative safe integer");
    this.name = "NoJournalApplyRecoveryClockError";
  }
}

/** Coordinates explicit decisions while durable identity and mutation authority stay in adapters. */
export class NoJournalApplyRecoveryCoordinator {
  private readonly state: NoJournalApplyRecoveryStatePort;
  private readonly transaction: NoJournalApplyRecoveryTransactionPort;
  private readonly clock: () => number;

  /** Creates a coordinator over atomic runtime state and transaction ports. */
  constructor(dependencies: NoJournalApplyRecoveryCoordinatorDependencies) {
    this.state = dependencies.state;
    this.transaction = dependencies.transaction;
    this.clock = dependencies.now ?? Date.now;
  }

  /** Delegates durable accepted-review classification to the runtime authority boundary. */
  async classify(
    identity: AcceptedReviewStartupIdentity
  ): Promise<NoJournalApplyRecoveryClassification> {
    return this.state.classify(identity);
  }

  /** Re-proves one opaque recovery reference before invoking the transaction runtime. */
  async continue(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<TransactionCommitReceipt> {
    const input = await this.state.loadContinueInput(reference, bundle);
    return this.transaction.apply(input);
  }

  /** Records one explicit abandonment using a strictly validated decision timestamp. */
  async abandon(reference: NoJournalApplyRecoveryReference): Promise<NoJournalApplyAbandonReceipt> {
    const abandonedAt = this.clock();
    if (!Number.isSafeInteger(abandonedAt) || abandonedAt < 0) {
      throw new NoJournalApplyRecoveryClockError();
    }
    return this.state.abandon(reference, abandonedAt);
  }
}
