import {
  ApplyCommitAcknowledgeError,
  ApplyCommitCoordinator,
  ApplyCommitIdentityError,
  type ApplyCommitManifestPort,
  type ApplyCommitQueuePort,
  type ApplyCommitTransactionPort,
  type CommittedChangeSetTransactionJournal,
} from "@/knowledge/changeset/ApplyCommitCoordinator";
import type {
  TransactionCommitReceipt,
  TransactionRecoveryResult,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  TRANSACTION_JOURNAL_VERSION,
  type ChangeSetTransactionJournal,
} from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  INGEST_QUEUE_VERSION,
  type IngestApplyCommitMarker,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeIngestJob,
  SourceManifest,
} from "@/knowledge/model/types";

const DIGEST = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);

type Operation =
  | "recover"
  | "load"
  | "verify"
  | "manifest"
  | "resolve"
  | "ack"
  | "get_pending"
  | "finalize";

/** Creates the Bundle used by coordinator tests. */
function createBundle(id = "personal"): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates the accepted ChangeSet retained by the committed journal. */
function createChangeSet(): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: "change-1",
        operation: "create",
        path: "Wiki/Page.md",
        sourceRefs: ["source-1"],
        reason: "Create generated page",
        expectedAbsent: true,
        afterContent: "# Page\n",
        afterHash: CONTENT_HASH,
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 10,
  };
}

/** Creates the final complete Manifest projection carried by the committed journal. */
function createManifestCommitIntent(changeSet: KnowledgeChangeSet): ManifestCommitIntent {
  const manifest: SourceManifest = {
    version: 1,
    bundleId: changeSet.bundleId,
    revision: 0,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/source.md",
        sourcePath: "Sources/source.md",
        custody: "user_managed",
      },
    ],
  };
  return {
    version: 1,
    kind: "source_compile",
    bundleId: changeSet.bundleId,
    sourceId: "source-1",
    sourceContentHash: "c".repeat(64),
    pipelineFingerprint: "d".repeat(64),
    inputRevision: 1,
    manifestCommitPlanDigest: "e".repeat(64),
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: [{ path: "Wiki/Page.md", ownership: "generated", contentHash: CONTENT_HASH }],
  };
}

/** Creates a complete committed journal for one applying job attempt. */
function createCommittedJournal(): CommittedChangeSetTransactionJournal {
  const bundle = createBundle();
  const changeSet = createChangeSet();
  const manifestCommitIntent = createManifestCommitIntent(changeSet);
  return {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: "transaction-1",
    revision: 4,
    bundleId: bundle.id,
    bundle,
    changeSetId: changeSet.id,
    changeSetDigest: DIGEST,
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    jobClaim: {
      jobId: "job-1",
      sourceId: "source-1",
      sourceContentHash: "c".repeat(64),
      pipelineFingerprint: "d".repeat(64),
      inputRevision: 1,
      attempt: 1,
      startedAt: 20,
    },
    changeSet,
    targets: [
      {
        changeId: "change-1",
        path: "Wiki/Page.md",
        windowsPathKey: "wiki/page.md",
        operation: "create",
        before: { kind: "missing" },
        after: { kind: "file", content: "# Page\n", contentHash: CONTENT_HASH },
      },
    ],
    appliedCount: 1,
    createdAt: 20,
    updatedAt: 30,
    phase: "committed",
    committedAt: 30,
  };
}

/** Derives the public commit receipt expected from the test journal. */
function createReceipt(
  journal: CommittedChangeSetTransactionJournal = createCommittedJournal()
): TransactionCommitReceipt {
  return {
    transactionId: journal.transactionId,
    commitRevision: journal.revision,
    bundleId: journal.bundleId,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    jobClaim: { ...journal.jobClaim },
    committedAt: journal.committedAt,
    targets: journal.targets.map((target) =>
      target.after.kind === "missing"
        ? { path: target.path, kind: "missing" as const }
        : {
            path: target.path,
            kind: "file" as const,
            contentHash: target.after.contentHash,
          }
    ),
  };
}

/** Creates the completed queue job correlated with the committed receipt. */
function createCompletedJob(receipt: TransactionCommitReceipt): KnowledgeIngestJob {
  return {
    id: receipt.jobClaim.jobId,
    bundleId: receipt.bundleId,
    sourceId: "source-1",
    sourceContentHash: "c".repeat(64),
    pipelineFingerprint: "d".repeat(64),
    inputRevision: 1,
    attempt: receipt.jobClaim.attempt,
    rerunRequested: false,
    createdAt: 10,
    updatedAt: receipt.committedAt,
    status: "completed",
    stage: "completed",
    changeSetId: receipt.changeSetId,
    completedAt: receipt.committedAt,
  };
}

/** Converts a receipt into the durable queue hand-off marker. */
function createMarker(receipt: TransactionCommitReceipt): IngestApplyCommitMarker {
  return {
    transactionId: receipt.transactionId,
    changeSetId: receipt.changeSetId,
    changeSetDigest: receipt.changeSetDigest,
    commitRevision: receipt.commitRevision,
    jobId: receipt.jobClaim.jobId,
    sourceId: receipt.jobClaim.sourceId,
    sourceContentHash: receipt.jobClaim.sourceContentHash,
    pipelineFingerprint: receipt.jobClaim.pipelineFingerprint,
    inputRevision: receipt.jobClaim.inputRevision,
    attempt: receipt.jobClaim.attempt,
    startedAt: receipt.jobClaim.startedAt,
    committedAt: receipt.committedAt,
  };
}

/** Creates a detached queue snapshot reflecting the fake queue's current marker. */
function createQueueSnapshot(
  receipt: TransactionCommitReceipt,
  marker: IngestApplyCommitMarker | null
): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: receipt.bundleId,
    revision: marker ? 2 : 3,
    control: marker
      ? {
          status: "paused",
          reason: "commit_pending_ack",
          pausedAt: receipt.committedAt,
        }
      : {
          status: "paused",
          reason: "startup_recovery",
          pausedAt: receipt.committedAt,
        },
    jobs: [createCompletedJob(receipt)],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId: receipt.jobClaim.sourceId,
        sourceContentHash: receipt.jobClaim.sourceContentHash,
        pipelineFingerprint: receipt.jobClaim.pipelineFingerprint,
        inputRevision: receipt.jobClaim.inputRevision,
        observedAt: receipt.committedAt,
      },
    ],
    pendingReviews: [],
    reviewRejections: [],
    ...(marker ? { applyCommit: { ...marker } } : {}),
  };
}

/** One-shot failure injector shared by all fake durable ports. */
class FailureInjector {
  private pending?: Operation;

  /** Configures one operation to fail before changing its fake durable state. */
  failOnce(operation: Operation): void {
    this.pending = operation;
  }

  /** Throws once when the configured operation is reached. */
  reach(operation: Operation): void {
    if (this.pending === operation) {
      this.pending = undefined;
      throw new Error(`simulated ${operation} failure`);
    }
  }
}

/** Stateful fake transaction port that behaves like the global journal slot. */
class FakeTransactionPort implements ApplyCommitTransactionPort {
  active: ChangeSetTransactionJournal | null;
  acknowledgeFalseOnce = false;
  recoveryOverride?: TransactionRecoveryResult;

  /** Creates a fake around one active committed journal. */
  constructor(
    private readonly calls: Operation[],
    private readonly failures: FailureInjector,
    journal: CommittedChangeSetTransactionJournal = createCommittedJournal()
  ) {
    this.active = journal;
  }

  /** Recovers or observes the fake active journal. */
  async recoverOnStartup(_bundle: KnowledgeBundleConfig): Promise<TransactionRecoveryResult> {
    this.calls.push("recover");
    this.failures.reach("recover");
    if (this.recoveryOverride) {
      return this.recoveryOverride;
    }
    if (!this.active) {
      return { kind: "none" };
    }
    if (this.active.phase === "recovery_required") {
      return {
        kind: "blocked",
        transactionId: this.active.transactionId,
        bundleId: this.active.bundleId,
        changeSetId: this.active.changeSetId,
        conflicts: this.active.conflicts,
      };
    }
    if (this.active.phase !== "committed") {
      throw new Error("fake cannot roll forward a non-terminal journal");
    }
    return { kind: "committed", action: "already_committed", receipt: createReceipt(this.active) };
  }

  /** Reads the fake active journal. */
  async loadActive(): Promise<ChangeSetTransactionJournal | null> {
    this.calls.push("load");
    this.failures.reach("load");
    return this.active;
  }

  /** Clears the fake journal or simulates an observed prior clear. */
  async acknowledgeCommitted(_receipt: TransactionCommitReceipt): Promise<boolean> {
    this.calls.push("ack");
    this.failures.reach("ack");
    if (this.acknowledgeFalseOnce) {
      this.acknowledgeFalseOnce = false;
      this.active = null;
      return false;
    }
    if (!this.active) {
      return false;
    }
    this.active = null;
    return true;
  }
}

/** Stateful fake queue port with an idempotent durable commit marker. */
class FakeQueuePort implements ApplyCommitQueuePort {
  marker: IngestApplyCommitMarker | null = null;

  /** Creates the fake queue around the shared receipt. */
  constructor(
    private readonly calls: Operation[],
    private readonly failures: FailureInjector,
    private readonly receipt: TransactionCommitReceipt
  ) {}

  /** Verifies the fake queue identity without changing its marker. */
  async verifyApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    this.calls.push("verify");
    this.failures.reach("verify");
    return createCompletedJob(receipt);
  }

  /** Completes the job and records the fake marker idempotently. */
  async resolveApplyRecovery(receipt: TransactionCommitReceipt): Promise<KnowledgeIngestJob> {
    this.calls.push("resolve");
    this.failures.reach("resolve");
    this.marker ??= createMarker(receipt);
    return createCompletedJob(receipt);
  }

  /** Reads the current fake marker. */
  async getPendingApplyCommit(_bundleId: string): Promise<IngestApplyCommitMarker | null> {
    this.calls.push("get_pending");
    this.failures.reach("get_pending");
    return this.marker ? { ...this.marker } : null;
  }

  /** Clears the exact fake marker and returns reconciled queue state. */
  async finalizeApplyRecovery(
    _bundleId: string,
    transactionId: string
  ): Promise<IngestQueueSnapshot> {
    this.calls.push("finalize");
    this.failures.reach("finalize");
    if (!this.marker || this.marker.transactionId !== transactionId) {
      throw new Error("fake marker identity mismatch");
    }
    this.marker = null;
    return createQueueSnapshot(this.receipt, this.marker);
  }
}

/** Idempotent fake manifest port keyed by the exact transaction identity. */
class FakeManifestPort implements ApplyCommitManifestPort {
  readonly durableTransactions = new Set<string>();

  /** Creates a fake manifest over shared call and failure state. */
  constructor(
    private readonly calls: Operation[],
    private readonly failures: FailureInjector
  ) {}

  /** Records one logical manifest success idempotently. */
  async recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    _receipt: TransactionCommitReceipt
  ): Promise<void> {
    this.calls.push("manifest");
    this.failures.reach("manifest");
    this.durableTransactions.add(`${journal.transactionId}:${journal.revision}`);
  }
}

/** Creates a coordinator and inspectable fake persistence state. */
function createHarness(): {
  coordinator: ApplyCommitCoordinator;
  transaction: FakeTransactionPort;
  queue: FakeQueuePort;
  manifest: FakeManifestPort;
  failures: FailureInjector;
  calls: Operation[];
  receipt: TransactionCommitReceipt;
} {
  const calls: Operation[] = [];
  const failures = new FailureInjector();
  const journal = createCommittedJournal();
  const receipt = createReceipt(journal);
  const transaction = new FakeTransactionPort(calls, failures, journal);
  const queue = new FakeQueuePort(calls, failures, receipt);
  const manifest = new FakeManifestPort(calls, failures);
  return {
    coordinator: new ApplyCommitCoordinator({ transaction, queue, manifest }),
    transaction,
    queue,
    manifest,
    failures,
    calls,
    receipt,
  };
}

describe("ApplyCommitCoordinator", () => {
  it("does nothing after recovery finds neither a journal nor a pending queue marker", async () => {
    const harness = createHarness();
    harness.transaction.active = null;

    await expect(harness.coordinator.reconcile(createBundle())).resolves.toEqual({ kind: "none" });
    expect(harness.calls).toEqual(["recover", "get_pending"]);
  });

  it("returns a blocked transaction without touching manifest or queue state", async () => {
    const harness = createHarness();
    harness.transaction.recoveryOverride = {
      kind: "blocked",
      transactionId: "transaction-1",
      bundleId: "personal",
      changeSetId: "changeset-1",
      conflicts: [
        {
          path: "Wiki/Page.md",
          code: "file_state_conflict",
          detectedAt: 40,
          actualHash: "e".repeat(64),
        },
      ],
    };

    await expect(harness.coordinator.reconcile(createBundle())).resolves.toEqual(
      harness.transaction.recoveryOverride
    );
    expect(harness.calls).toEqual(["recover"]);
  });

  it("persists manifest, queue marker, journal clear, and queue release in strict order", async () => {
    const harness = createHarness();

    const result = await harness.coordinator.reconcile(createBundle());

    expect(result).toMatchObject({
      kind: "committed",
      action: "already_committed",
      receipt: harness.receipt,
      job: { id: "job-1", status: "completed" },
      queueSnapshot: { control: { status: "paused", reason: "startup_recovery" } },
    });
    expect(harness.calls).toEqual([
      "recover",
      "load",
      "verify",
      "manifest",
      "resolve",
      "ack",
      "finalize",
    ]);
    expect(harness.transaction.active).toBeNull();
    expect(harness.queue.marker).toBeNull();
    expect(harness.manifest.durableTransactions).toEqual(new Set(["transaction-1:4"]));
  });

  it.each<Operation>(["recover", "load", "verify", "manifest", "resolve", "ack", "finalize"])(
    "converges after a one-shot %s failure",
    async (failedOperation) => {
      const harness = createHarness();
      const fullSequence: Operation[] = [
        "recover",
        "load",
        "verify",
        "manifest",
        "resolve",
        "ack",
        "finalize",
      ];
      harness.failures.failOnce(failedOperation);

      await expect(harness.coordinator.reconcile(createBundle())).rejects.toThrow(
        `simulated ${failedOperation} failure`
      );
      if (failedOperation === "verify") {
        expect(harness.calls).not.toContain("manifest");
        expect(harness.manifest.durableTransactions).toEqual(new Set());
      }
      const retryResult = await harness.coordinator.reconcile(createBundle());

      const failedPrefix = fullSequence.slice(0, fullSequence.indexOf(failedOperation) + 1);
      const retrySequence: Operation[] =
        failedOperation === "finalize" ? ["recover", "get_pending", "finalize"] : fullSequence;
      expect(harness.calls).toEqual([...failedPrefix, ...retrySequence]);
      expect(retryResult.kind).toBe(
        failedOperation === "finalize" ? "finalized_pending_ack" : "committed"
      );
      expect(harness.transaction.active).toBeNull();
      expect(harness.queue.marker).toBeNull();
      expect(harness.manifest.durableTransactions).toEqual(new Set(["transaction-1:4"]));
    }
  );

  it("finishes a queue marker left after a durable journal clear", async () => {
    const harness = createHarness();
    harness.transaction.active = null;
    harness.queue.marker = createMarker(harness.receipt);

    await expect(harness.coordinator.reconcile(createBundle())).resolves.toMatchObject({
      kind: "finalized_pending_ack",
      transactionId: "transaction-1",
      queueSnapshot: { control: { reason: "startup_recovery" } },
    });
    expect(harness.calls).toEqual(["recover", "get_pending", "finalize"]);
    expect(harness.queue.marker).toBeNull();
  });

  it("converges when reading a pending queue marker fails once", async () => {
    const harness = createHarness();
    harness.transaction.active = null;
    harness.queue.marker = createMarker(harness.receipt);
    harness.failures.failOnce("get_pending");

    await expect(harness.coordinator.reconcile(createBundle())).rejects.toThrow(
      "simulated get_pending failure"
    );
    await expect(harness.coordinator.reconcile(createBundle())).resolves.toMatchObject({
      kind: "finalized_pending_ack",
      transactionId: "transaction-1",
    });
    expect(harness.calls).toEqual(["recover", "get_pending", "recover", "get_pending", "finalize"]);
    expect(harness.queue.marker).toBeNull();
  });

  it("surfaces a missing acknowledgement and converges through the pending marker", async () => {
    const harness = createHarness();
    harness.transaction.acknowledgeFalseOnce = true;

    await expect(harness.coordinator.reconcile(createBundle())).rejects.toBeInstanceOf(
      ApplyCommitAcknowledgeError
    );
    await expect(harness.coordinator.reconcile(createBundle())).resolves.toMatchObject({
      kind: "finalized_pending_ack",
      transactionId: "transaction-1",
    });
    expect(harness.calls).toEqual([
      "recover",
      "load",
      "verify",
      "manifest",
      "resolve",
      "ack",
      "recover",
      "get_pending",
      "finalize",
    ]);
  });

  it.each([
    [
      "transactionId",
      (receipt: TransactionCommitReceipt) => ({ ...receipt, transactionId: "transaction-2" }),
    ],
    ["commitRevision", (receipt: TransactionCommitReceipt) => ({ ...receipt, commitRevision: 5 })],
    [
      "changeSetId",
      (receipt: TransactionCommitReceipt) => ({ ...receipt, changeSetId: "changeset-2" }),
    ],
    [
      "changeSetDigest",
      (receipt: TransactionCommitReceipt) => ({ ...receipt, changeSetDigest: "e".repeat(64) }),
    ],
    [
      "jobClaim.jobId",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, jobId: "job-2" },
      }),
    ],
    [
      "jobClaim.sourceId",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, sourceId: "source-2" },
      }),
    ],
    [
      "jobClaim.sourceContentHash",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, sourceContentHash: "e".repeat(64) },
      }),
    ],
    [
      "jobClaim.pipelineFingerprint",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, pipelineFingerprint: "e".repeat(64) },
      }),
    ],
    [
      "jobClaim.inputRevision",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, inputRevision: 2 },
      }),
    ],
    [
      "jobClaim.attempt",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, attempt: 2 },
      }),
    ],
    [
      "jobClaim.startedAt",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        jobClaim: { ...receipt.jobClaim, startedAt: 21 },
      }),
    ],
    ["committedAt", (receipt: TransactionCommitReceipt) => ({ ...receipt, committedAt: 31 })],
  ] as const)("rejects a mismatched committed receipt field: %s", async (_field, mutate) => {
    const harness = createHarness();
    harness.transaction.recoveryOverride = {
      kind: "committed",
      action: "already_committed",
      receipt: mutate(harness.receipt),
    };

    await expect(harness.coordinator.reconcile(createBundle())).rejects.toMatchObject({
      name: "ApplyCommitIdentityError",
      reason: "receipt_mismatch",
    });
    expect(harness.calls).toEqual(["recover", "load"]);
    expect(harness.manifest.durableTransactions).toEqual(new Set());
  });

  it.each([
    ["target count", (receipt: TransactionCommitReceipt) => ({ ...receipt, targets: [] })],
    [
      "target path",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        targets: [{ ...receipt.targets[0], path: "Wiki/Other.md" }],
      }),
    ],
    [
      "target kind",
      (receipt: TransactionCommitReceipt) => ({
        ...receipt,
        targets: [{ path: receipt.targets[0].path, kind: "missing" as const }],
      }),
    ],
  ] as const)("rejects a mismatched committed receipt %s", async (_field, mutate) => {
    const harness = createHarness();
    harness.transaction.recoveryOverride = {
      kind: "committed",
      action: "already_committed",
      receipt: mutate(harness.receipt),
    };

    await expect(harness.coordinator.reconcile(createBundle())).rejects.toMatchObject({
      name: "ApplyCommitIdentityError",
      reason: "receipt_mismatch",
    });
    expect(harness.calls).toEqual(["recover", "load"]);
  });

  it.each([
    {
      reason: "bundle_mismatch" as const,
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.transaction.recoveryOverride = {
          kind: "committed",
          action: "already_committed",
          receipt: { ...harness.receipt, bundleId: "another-bundle" },
        };
      },
    },
    {
      reason: "journal_missing" as const,
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.transaction.recoveryOverride = {
          kind: "committed",
          action: "already_committed",
          receipt: harness.receipt,
        };
        harness.transaction.active = null;
      },
    },
    {
      reason: "journal_not_committed" as const,
      arrange: (harness: ReturnType<typeof createHarness>) => {
        const committed = createCommittedJournal();
        harness.transaction.recoveryOverride = {
          kind: "committed",
          action: "already_committed",
          receipt: harness.receipt,
        };
        harness.transaction.active = {
          ...committed,
          phase: "applying",
          committedAt: undefined,
        } as unknown as ChangeSetTransactionJournal;
      },
    },
    {
      reason: "receipt_mismatch" as const,
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.transaction.recoveryOverride = {
          kind: "committed",
          action: "already_committed",
          receipt: {
            ...harness.receipt,
            targets: [{ path: "Wiki/Page.md", kind: "file", contentHash: "f".repeat(64) }],
          },
        };
      },
    },
  ])("fails closed for $reason identity", async ({ reason, arrange }) => {
    const harness = createHarness();
    arrange(harness);

    try {
      await harness.coordinator.reconcile(createBundle());
      throw new Error("Expected reconciliation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyCommitIdentityError);
      if (!(error instanceof ApplyCommitIdentityError)) {
        return;
      }
      expect(error.reason).toBe(reason);
    }
    expect(harness.calls).not.toContain("manifest");
    expect(harness.calls).not.toContain("resolve");
  });
});
