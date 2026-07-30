import type {
  ChangeSetTransactionApplyInput,
  TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  NoJournalApplyRecoveryClockError,
  NoJournalApplyRecoveryCoordinator,
  type NoJournalApplyAbandonReceipt,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoveryReference,
  type NoJournalApplyRecoveryStatePort,
  type NoJournalApplyRecoveryTransactionPort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";

const DIGEST = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const PIPELINE_FINGERPRINT = "c".repeat(64);

/** Creates the durable accepted Review identity used by coordinator tests. */
function createIdentity(): AcceptedReviewStartupIdentity {
  return {
    bundleId: "personal",
    changeSetId: "changeset-1",
    proposalDigest: DIGEST,
    recordRevision: 1,
    recordedAt: 20,
    acceptedDigest: DIGEST,
    manifestCommitIntentDigest: DIGEST,
    acceptedAt: 30,
    jobClaim: {
      jobId: "job-1",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
      attempt: 2,
    },
  };
}

/** Creates one opaque recovery reference without exposing its identity derivation. */
function createReference(): NoJournalApplyRecoveryReference {
  return { bundleId: "personal", recoveryId: "recovery-opaque" };
}

/** Creates the exact input returned only after runtime authority is re-proved. */
function createApplyInput(): ChangeSetTransactionApplyInput {
  return {
    changeSet: { id: "changeset-1" },
    bundle: { id: "personal" },
    jobClaim: {
      jobId: "job-1",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
      attempt: 2,
      startedAt: 25,
    },
    manifestCommitIntent: { version: 1 },
    manifestCommitIntentDigest: DIGEST,
  };
}

/** Creates the transaction receipt returned by the fake apply port. */
function createCommitReceipt(): TransactionCommitReceipt {
  return {
    transactionId: "transaction-1",
    commitRevision: 3,
    bundleId: "personal",
    changeSetId: "changeset-1",
    changeSetDigest: DIGEST,
    jobClaim: { ...createApplyInput().jobClaim },
    committedAt: 40,
    targets: [],
  };
}

/** Creates complete state-port defaults with optional behavior overrides. */
function createStatePort(
  overrides: Partial<NoJournalApplyRecoveryStatePort> = {}
): NoJournalApplyRecoveryStatePort {
  const reference = createReference();
  return {
    classify: async (): Promise<NoJournalApplyRecoveryClassification> => ({
      kind: "requires_decision",
      candidate: {
        ...reference,
        jobId: "job-1",
        changeSetId: "changeset-1",
        sourceId: "source-1",
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_FINGERPRINT,
        inputRevision: 1,
        attempt: 2,
        startedAt: 25,
        acceptedAt: 30,
      },
    }),
    loadContinueInput: async (): Promise<ChangeSetTransactionApplyInput> => createApplyInput(),
    abandon: async (): Promise<NoJournalApplyAbandonReceipt> => ({
      ...reference,
      jobId: "job-1",
      changeSetId: "changeset-1",
      abandonedAt: 50,
    }),
    ...overrides,
  };
}

/** Creates a transaction port that returns a deterministic commit receipt. */
function createTransactionPort(
  apply: NoJournalApplyRecoveryTransactionPort["apply"] = async () => createCommitReceipt()
): NoJournalApplyRecoveryTransactionPort {
  return { apply };
}

describe("NoJournalApplyRecoveryCoordinator", () => {
  it("delegates accepted Review classification without invoking action ports", async () => {
    const identity = createIdentity();
    const classification: NoJournalApplyRecoveryClassification = {
      kind: "accepted_not_started",
      reference: createReference(),
      bundleId: identity.bundleId,
      changeSetId: identity.changeSetId,
      jobId: identity.jobClaim.jobId,
    };
    const classify = jest.fn(async () => classification);
    const loadContinueInput = jest.fn(async () => createApplyInput());
    const abandon = jest.fn(async () => ({
      ...createReference(),
      jobId: "job-1",
      changeSetId: "changeset-1",
      abandonedAt: 50,
    }));
    const apply = jest.fn(async () => createCommitReceipt());
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ classify, loadContinueInput, abandon }),
      transaction: createTransactionPort(apply),
    });

    await expect(coordinator.classify(identity)).resolves.toBe(classification);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith(identity);
    expect(loadContinueInput).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("loads and re-proves durable input before applying it", async () => {
    const operations: string[] = [];
    const reference = createReference();
    const bundle = { id: "personal" };
    const input = createApplyInput();
    const receipt = createCommitReceipt();
    const loadContinueInput = jest.fn(async () => {
      operations.push("load");
      return input;
    });
    const apply = jest.fn(async () => {
      operations.push("apply");
      return receipt;
    });
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ loadContinueInput }),
      transaction: createTransactionPort(apply),
    });

    await expect(coordinator.continue(reference, bundle)).resolves.toBe(receipt);
    expect(operations).toEqual(["load", "apply"]);
    expect(loadContinueInput).toHaveBeenCalledWith(reference, bundle);
    expect(apply).toHaveBeenCalledWith(input);
  });

  it("never invokes apply when the runtime cannot reload continuation authority", async () => {
    const failure = new Error("continuation authority changed");
    const loadContinueInput = jest.fn(async (): Promise<ChangeSetTransactionApplyInput> => {
      throw failure;
    });
    const apply = jest.fn(async () => createCommitReceipt());
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ loadContinueInput }),
      transaction: createTransactionPort(apply),
    });

    await expect(coordinator.continue(createReference(), { id: "personal" })).rejects.toBe(failure);
    expect(apply).not.toHaveBeenCalled();
  });

  it("propagates transaction failures after the state input has been loaded", async () => {
    const failure = new Error("transaction failed");
    const input = createApplyInput();
    const loadContinueInput = jest.fn(async () => input);
    const apply = jest.fn(async (): Promise<TransactionCommitReceipt> => {
      throw failure;
    });
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ loadContinueInput }),
      transaction: createTransactionPort(apply),
    });

    await expect(coordinator.continue(createReference(), { id: "personal" })).rejects.toBe(failure);
    expect(loadContinueInput).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(input);
  });

  it("validates one clock value before delegating an abandonment", async () => {
    const reference = createReference();
    const receipt: NoJournalApplyAbandonReceipt = {
      ...reference,
      jobId: "job-1",
      changeSetId: "changeset-1",
      abandonedAt: 50,
    };
    const now = jest.fn(() => 50);
    const abandon = jest.fn(async () => receipt);
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ abandon }),
      transaction: createTransactionPort(),
      now,
    });

    await expect(coordinator.abandon(reference)).resolves.toBe(receipt);
    expect(now).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledWith(reference, 50);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid clock value %s before touching durable state",
    async (value) => {
      const abandon = jest.fn(async () => ({
        ...createReference(),
        jobId: "job-1",
        changeSetId: "changeset-1",
        abandonedAt: value,
      }));
      const coordinator = new NoJournalApplyRecoveryCoordinator({
        state: createStatePort({ abandon }),
        transaction: createTransactionPort(),
        now: () => value,
      });

      await expect(coordinator.abandon(createReference())).rejects.toBeInstanceOf(
        NoJournalApplyRecoveryClockError
      );
      expect(abandon).not.toHaveBeenCalled();
    }
  );

  it("propagates an atomic state abandonment failure unchanged", async () => {
    const failure = new Error("recovery reference is stale");
    const abandon = jest.fn(async (): Promise<NoJournalApplyAbandonReceipt> => {
      throw failure;
    });
    const coordinator = new NoJournalApplyRecoveryCoordinator({
      state: createStatePort({ abandon }),
      transaction: createTransactionPort(),
      now: () => 50,
    });

    await expect(coordinator.abandon(createReference())).rejects.toBe(failure);
    expect(abandon).toHaveBeenCalledWith(createReference(), 50);
  });
});
