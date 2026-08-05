import type {
  IngestApplyClaimMarker,
  IngestApplyCommitMarker,
  IngestQueueControl,
  IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { INGEST_QUEUE_VERSION } from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeIngestJob, KnowledgeIngestWorkStage } from "@/knowledge/model/types";
import {
  DEFAULT_ACTIVITY_TERMINAL_LIMIT,
  deriveKnowledgeActivityModel,
  type KnowledgeActivityBundleState,
  type KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

interface TestJobOptions {
  sourceId?: string;
  sourceContentHash?: string;
  pipelineFingerprint?: string;
  createdAt?: number;
  updatedAt?: number;
  inputRevision?: number;
  attempt?: number;
  rerunRequested?: boolean;
}

/**
 * Creates fields shared by every test job.
 *
 * @param id - Stable test job id
 * @param options - Optional identity and timestamp overrides
 * @returns Common durable job fields
 */
function createJobBase(id: string, options: TestJobOptions = {}) {
  return {
    id,
    bundleId: "personal",
    sourceId: options.sourceId ?? `source-${id}`,
    sourceContentHash: options.sourceContentHash ?? HASH_A,
    pipelineFingerprint: options.pipelineFingerprint ?? HASH_B,
    inputRevision: options.inputRevision ?? 1,
    attempt: options.attempt ?? 0,
    rerunRequested: options.rerunRequested ?? false,
    createdAt: options.createdAt ?? 10,
    updatedAt: options.updatedAt ?? 20,
  };
}

/**
 * Creates one pending queue job.
 *
 * @param id - Stable test job id
 * @param options - Optional common fields and retry timestamp
 * @returns Pending durable job
 */
function createPendingJob(
  id: string,
  options: TestJobOptions & { nextAttemptAt?: number } = {}
): KnowledgeIngestJob {
  return {
    ...createJobBase(id, options),
    status: "pending",
    stage: "queued",
    ...(options.nextAttemptAt === undefined ? {} : { nextAttemptAt: options.nextAttemptAt }),
  };
}

/**
 * Creates one actively processing queue job.
 *
 * @param id - Stable test job id
 * @param stage - Current durable work stage
 * @param options - Optional common fields
 * @returns Processing durable job
 */
function createProcessingJob(
  id: string,
  stage: KnowledgeIngestWorkStage,
  options: TestJobOptions = {}
): KnowledgeIngestJob {
  const base = createJobBase(id, options);
  return {
    ...base,
    status: "processing",
    stage,
    startedAt: Math.max(base.createdAt, base.updatedAt - 1),
  };
}

/**
 * Creates one paused queue job.
 *
 * @param id - Stable test job id
 * @param stage - Paused non-applying stage
 * @param options - Optional common fields and reason
 * @returns Paused durable job
 */
function createPausedJob(
  id: string,
  stage: Exclude<KnowledgeIngestWorkStage, "applying"> = "analyzing",
  options: TestJobOptions & { reason?: string } = {}
): KnowledgeIngestJob {
  const base = createJobBase(id, options);
  return {
    ...base,
    status: "paused",
    stage,
    pausedAt: base.updatedAt,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

/**
 * Creates one awaiting-review queue job.
 *
 * @param id - Stable test job id
 * @param options - Optional common fields
 * @returns Awaiting-review durable job
 */
function createReviewJob(
  id: string,
  options: TestJobOptions = {}
): Extract<KnowledgeIngestJob, { status: "awaiting_review" }> {
  return {
    ...createJobBase(id, options),
    status: "awaiting_review",
    stage: "review",
    changeSetId: `changeset-${id}`,
  };
}

/**
 * Creates one failed queue job.
 *
 * @param id - Stable test job id
 * @param stage - Stage that failed
 * @param retryable - Whether the queue permits explicit retry
 * @param options - Optional common fields
 * @returns Failed durable job
 */
function createFailedJob(
  id: string,
  stage: "queued" | KnowledgeIngestWorkStage | "review" = "generating",
  retryable = true,
  options: TestJobOptions = {}
): KnowledgeIngestJob {
  const base = createJobBase(id, options);
  return {
    ...base,
    status: "failed",
    stage,
    failure: {
      code: `failure-${id}`,
      message: `Failure ${id}`,
      retryable,
      occurredAt: base.updatedAt,
    },
  };
}

/**
 * Creates one completed queue job.
 *
 * @param id - Stable test job id
 * @param options - Optional common fields
 * @returns Completed durable job
 */
function createCompletedJob(id: string, options: TestJobOptions = {}): KnowledgeIngestJob {
  const base = createJobBase(id, options);
  return {
    ...base,
    status: "completed",
    stage: "completed",
    changeSetId: `changeset-${id}`,
    completedAt: base.updatedAt,
  };
}

/**
 * Creates one cancelled queue job.
 *
 * @param id - Stable test job id
 * @param options - Optional common fields
 * @returns Cancelled durable job
 */
function createCancelledJob(id: string, options: TestJobOptions = {}): KnowledgeIngestJob {
  const base = createJobBase(id, options);
  return {
    ...base,
    status: "cancelled",
    stage: "cancelled",
    cancelledAt: base.updatedAt,
  };
}

/**
 * Creates a trusted test queue snapshot.
 *
 * @param jobs - Durable jobs contained by the snapshot
 * @param control - Optional Bundle execution gate
 * @param markers - Optional apply correlation markers
 * @returns Complete queue snapshot
 */
function createSnapshot(
  jobs: KnowledgeIngestJob[],
  control: IngestQueueControl = { status: "running" },
  markers: {
    applyClaim?: IngestApplyClaimMarker;
    applyCommit?: IngestApplyCommitMarker;
    pendingReviews?: IngestQueueSnapshot["pendingReviews"];
    sourceHighWatermarks?: IngestQueueSnapshot["sourceHighWatermarks"];
  } = {}
): IngestQueueSnapshot {
  const pendingReviews =
    markers.pendingReviews ??
    jobs
      .filter(
        (job): job is Extract<KnowledgeIngestJob, { status: "awaiting_review" }> =>
          job.status === "awaiting_review"
      )
      .map((job) => ({
        kind: "durable" as const,
        jobId: job.id,
        changeSetId: job.changeSetId,
        proposalDigest: HASH_C,
        reviewRecordRevision: 0 as const,
        recordedAt: job.updatedAt,
      }));
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "personal",
    revision: 7,
    control,
    jobs,
    reruns: [],
    sourceHighWatermarks: markers.sourceHighWatermarks ?? [],
    pendingReviews,
    reviewRejections: [],
    applyAbandonments: [],
    ...(markers.applyClaim ? { applyClaim: markers.applyClaim } : {}),
    ...(markers.applyCommit ? { applyCommit: markers.applyCommit } : {}),
  };
}

/**
 * Creates an apply marker that exactly owns one completed test job.
 *
 * @param job - Completed durable job
 * @returns Correlated durable commit marker
 */
function createCommitMarker(job: Extract<KnowledgeIngestJob, { status: "completed" }>) {
  const marker: IngestApplyCommitMarker = {
    jobId: job.id,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    startedAt: job.createdAt,
    transactionId: `transaction-${job.id}`,
    changeSetId: job.changeSetId,
    changeSetDigest: HASH_C,
    commitRevision: 4,
    committedAt: job.completedAt,
  };
  return marker;
}

/**
 * Creates an interrupted apply claim for one failed test job.
 *
 * @param job - Failed applying job
 * @returns Durable apply claim marker
 */
function createApplyClaim(job: Extract<KnowledgeIngestJob, { status: "failed" }>) {
  if (job.stage !== "applying") {
    throw new Error("Apply claim fixture must own an applying job");
  }
  const marker: IngestApplyClaimMarker = {
    jobId: job.id,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    startedAt: job.createdAt,
  };
  return marker;
}

/**
 * Creates a semantically correlated snapshot for a single stage fixture.
 *
 * @param job - Single durable job under test
 * @returns Queue snapshot including any required execution gate or claim
 */
function createSingleJobSnapshot(job: KnowledgeIngestJob): IngestQueueSnapshot {
  if (job.status === "processing" && job.stage === "applying") {
    const marker: IngestApplyClaimMarker = {
      jobId: job.id,
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
      attempt: job.attempt,
      startedAt: job.startedAt,
    };
    return createSnapshot([job], { status: "running" }, { applyClaim: marker });
  }
  if (job.status === "paused") {
    return createSnapshot([job], {
      status: "paused",
      reason: "user",
      pausedAt: job.pausedAt,
    });
  }
  return createSnapshot([job]);
}

describe("deriveKnowledgeActivityModel stage projection", () => {
  it.each<{
    name: string;
    job: KnowledgeIngestJob;
    expected: KnowledgeActivityStatus;
  }>([
    { name: "queued", job: createPendingJob("queued"), expected: "queued" },
    {
      name: "parsing",
      job: createProcessingJob("parsing", "parsing"),
      expected: "parsing",
    },
    {
      name: "analyzing",
      job: createProcessingJob("analyzing", "analyzing"),
      expected: "analyzing",
    },
    {
      name: "associating",
      job: createProcessingJob("associating", "associating"),
      expected: "associating",
    },
    {
      name: "generating",
      job: createProcessingJob("generating", "generating"),
      expected: "generating",
    },
    {
      name: "validating",
      job: createProcessingJob("validating", "validating"),
      expected: "validating",
    },
    {
      name: "applying",
      job: createProcessingJob("applying", "applying"),
      expected: "applying",
    },
  ])("projects $name without inventing another durable state", ({ job, expected }) => {
    const model = deriveKnowledgeActivityModel(createSingleJobSnapshot(job));

    expect(model.items[0].status).toBe(expected);
    expect(model.items[0].durableStage).toBe(job.stage);
    expect(model.counts.byStatus[expected]).toBe(1);
  });

  it("exposes retry, cancel, and review only at their job-level queue boundaries", () => {
    const queued = createPendingJob("queued", { nextAttemptAt: 100 });
    const review = createReviewJob("review");
    const applying = createProcessingJob("applying", "applying");

    expect(deriveKnowledgeActivityModel(createSnapshot([queued])).items[0]).toMatchObject({
      nextAttemptAt: 100,
      actions: { canCancel: true, canRetry: false, canReview: false },
    });
    expect(deriveKnowledgeActivityModel(createSnapshot([review])).items[0]).toMatchObject({
      changeSetId: "changeset-review",
      actions: { canCancel: false, canRetry: false, canReview: true },
    });
    expect(deriveKnowledgeActivityModel(createSingleJobSnapshot(applying)).items[0]).toMatchObject({
      status: "applying",
      actions: { canCancel: false, canRetry: false, canReview: false },
    });
  });

  it("keeps a legacy-unverified review blocked until its pending record is reconciled", () => {
    const review = createReviewJob("review");
    const model = deriveKnowledgeActivityModel(
      createSnapshot(
        [review],
        { status: "running" },
        {
          pendingReviews: [
            {
              kind: "legacy_unverified",
              jobId: review.id,
              changeSetId: review.changeSetId,
              migratedFromVersion: 2,
            },
          ],
        }
      )
    );

    expect(model.items[0].actions.canReview).toBe(false);
  });

  it.each(["user", "rate_limit", "startup_recovery"] as const)(
    "blocks review acceptance while the Bundle is paused for %s",
    (reason) => {
      const review = createReviewJob("review");
      const model = deriveKnowledgeActivityModel(
        createSnapshot([review], {
          status: "paused",
          reason,
          pausedAt: 20,
          ...(reason === "rate_limit" ? { resumeAt: 30 } : {}),
        })
      );

      expect(model.items[0].actions).toEqual({
        canCancel: false,
        canRetry: false,
        canReview: false,
      });
    }
  );

  it("blocks review beside active work and retry beside an active source peer", () => {
    const review = createReviewJob("review");
    const active = createProcessingJob("active", "parsing");
    const failed = createFailedJob("failed", "generating", true, { sourceId: "shared-source" });
    const peer = createPendingJob("peer", { sourceId: "shared-source" });
    const model = deriveKnowledgeActivityModel(createSnapshot([review, active, failed, peer]));

    expect(model.items.find((item) => item.id === "review")?.actions.canReview).toBe(false);
    expect(model.items.find((item) => item.id === "failed")?.actions.canRetry).toBe(false);
  });

  it("blocks retry of stale input after a newer divergent source job becomes terminal", () => {
    const failed = createFailedJob("failed", "generating", true, {
      sourceId: "shared-source",
      inputRevision: 1,
    });
    const rejected = createCancelledJob("rejected", {
      sourceId: "shared-source",
      sourceContentHash: HASH_C,
      inputRevision: 2,
    });
    const model = deriveKnowledgeActivityModel(
      createSnapshot(
        [failed, rejected],
        { status: "running" },
        {
          sourceHighWatermarks: [
            {
              sourceId: "shared-source",
              sourceContentHash: HASH_C,
              pipelineFingerprint: HASH_B,
              inputRevision: 2,
              observedAt: 20,
            },
          ],
        }
      )
    );

    expect(model.items.find((item) => item.id === "failed")?.actions.canRetry).toBe(false);
  });

  it("allows retry when a newer source revision has the same compile payload", () => {
    const failed = createFailedJob("failed", "generating", true, {
      sourceId: "shared-source",
      inputRevision: 1,
    });
    const observed = createCancelledJob("observed", {
      sourceId: "shared-source",
      inputRevision: 2,
    });
    const model = deriveKnowledgeActivityModel(
      createSnapshot(
        [failed, observed],
        { status: "running" },
        {
          sourceHighWatermarks: [
            {
              sourceId: "shared-source",
              sourceContentHash: HASH_A,
              pipelineFingerprint: HASH_B,
              inputRevision: 2,
              observedAt: 20,
            },
          ],
        }
      )
    );

    expect(model.items.find((item) => item.id === "failed")?.actions.canRetry).toBe(true);
  });

  it("retains rerun markers and detached sanitized failures", () => {
    const failed = createFailedJob("failed", "generating", true, { rerunRequested: true });
    const snapshot = createSnapshot([failed]);
    const model = deriveKnowledgeActivityModel(snapshot);

    expect(model.items[0]).toMatchObject({
      rerunRequested: true,
      status: "failed",
      failure: { code: "failure-failed", message: "Failure failed", retryable: true },
      actions: { canRetry: true },
    });
    expect(Object.isFrozen(model.items[0].failure)).toBe(true);
    if (failed.status !== "failed") {
      throw new Error("Test fixture must be failed");
    }
    failed.failure.message = "Mutated after projection";
    expect(model.items[0].failure?.message).toBe("Failure failed");
  });
});

describe("deriveKnowledgeActivityModel commit and recovery gates", () => {
  it("keeps only the matching committed job finalizing until commit acknowledgement", () => {
    const owner = createCompletedJob("owner", { createdAt: 30, updatedAt: 50 });
    const history = createCompletedJob("history", { createdAt: 10, updatedAt: 20 });
    if (owner.status !== "completed") {
      throw new Error("Test fixture must be completed");
    }
    const marker = createCommitMarker(owner);
    const snapshot = createSnapshot(
      [history, owner],
      {
        status: "paused",
        reason: "commit_pending_ack",
        pausedAt: marker.committedAt,
      },
      { applyCommit: marker }
    );
    const model = deriveKnowledgeActivityModel(snapshot);

    expect(model.controls).toMatchObject({
      state: "finalizing",
      canPause: false,
      canResume: false,
      pauseReason: "commit_pending_ack",
    });
    expect(model.items.find((item) => item.id === "owner")).toMatchObject({
      status: "finalizing",
      terminal: false,
    });
    expect(model.items.find((item) => item.id === "history")).toMatchObject({
      status: "completed",
      terminal: true,
    });
    expect(model.counts.byStatus.finalizing).toBe(1);
    expect(model.counts.byStatus.completed).toBe(1);
  });

  it("projects an interrupted applying owner as recovery-required instead of retryable failure", () => {
    const failed = createFailedJob("apply", "applying", false, {
      attempt: 1,
      createdAt: 20,
      updatedAt: 40,
    });
    if (failed.status !== "failed") {
      throw new Error("Test fixture must be failed");
    }
    const snapshot = createSnapshot(
      [failed],
      {
        status: "paused",
        reason: "recovery_required",
        pausedAt: 40,
        detail: "Recover the transaction",
      },
      { applyClaim: createApplyClaim(failed) }
    );
    const model = deriveKnowledgeActivityModel(snapshot);

    expect(model.controls).toMatchObject({
      state: "recovery_required",
      canPause: false,
      canResume: false,
      detail: "Recover the transaction",
    });
    expect(model.items[0]).toMatchObject({
      status: "recovery_required",
      terminal: false,
      actions: { canCancel: false, canRetry: false, canReview: false },
    });
  });
});

describe("deriveKnowledgeActivityModel Bundle controls", () => {
  it.each<{
    control: IngestQueueControl;
    state: KnowledgeActivityBundleState;
    canPause: boolean;
    canResume: boolean;
  }>([
    {
      control: { status: "running" },
      state: "running",
      canPause: true,
      canResume: false,
    },
    {
      control: { status: "paused", reason: "user", pausedAt: 20 },
      state: "paused",
      canPause: false,
      canResume: true,
    },
    {
      control: {
        status: "paused",
        reason: "rate_limit",
        pausedAt: 20,
        resumeAt: 200,
      },
      state: "rate_limited",
      canPause: false,
      canResume: true,
    },
    {
      control: { status: "paused", reason: "startup_recovery", pausedAt: 20 },
      state: "startup_recovery",
      canPause: false,
      canResume: false,
    },
  ])("maps $state to Bundle-level pause/resume controls", (expected) => {
    const model = deriveKnowledgeActivityModel(createSnapshot([], expected.control));

    expect(model.controls).toMatchObject({
      state: expected.state,
      canPause: expected.canPause,
      canResume: expected.canResume,
    });
    expect(model.items).toEqual([]);
  });
});

describe("deriveKnowledgeActivityModel bounded history", () => {
  it("shows all active rows first and retains only the newest bounded terminal history", () => {
    const jobs = [
      createCompletedJob("old-completed", { updatedAt: 20 }),
      createPendingJob("queued", { updatedAt: 5 }),
      createFailedJob("new-failed", "generating", false, { updatedAt: 50 }),
      createReviewJob("review", { updatedAt: 4 }),
      createCancelledJob("newest-cancelled", { updatedAt: 60 }),
    ];
    const model = deriveKnowledgeActivityModel(createSnapshot(jobs), { maxTerminalItems: 2 });

    expect(model.items.map((item) => item.id)).toEqual([
      "review",
      "queued",
      "new-failed",
      "newest-cancelled",
    ]);
    expect(model.counts).toMatchObject({
      total: 5,
      active: 2,
      terminal: 3,
      hiddenTerminal: 1,
    });
    expect(model.counts.byStatus.completed).toBe(1);
  });

  it("supports hiding all terminal history without hiding active or blocked work", () => {
    const model = deriveKnowledgeActivityModel(
      createSnapshot([createPausedJob("paused"), createCompletedJob("completed")], {
        status: "paused",
        reason: "user",
        pausedAt: 20,
      }),
      { maxTerminalItems: 0 }
    );

    expect(model.items.map((item) => item.id)).toEqual(["paused"]);
    expect(model.counts.hiddenTerminal).toBe(1);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid terminal limit %p",
    (maxTerminalItems) => {
      expect(() => deriveKnowledgeActivityModel(createSnapshot([]), { maxTerminalItems })).toThrow(
        "maxTerminalItems must be a non-negative safe integer"
      );
    }
  );

  it("returns a detached frozen model using the documented default terminal limit", () => {
    const jobs = Array.from({ length: DEFAULT_ACTIVITY_TERMINAL_LIMIT + 2 }, (_, index) =>
      createCompletedJob(`completed-${index}`, { updatedAt: index + 20 })
    );
    const snapshot = createSnapshot(jobs);
    const model = deriveKnowledgeActivityModel(snapshot);

    expect(model.items).toHaveLength(DEFAULT_ACTIVITY_TERMINAL_LIMIT);
    expect(model.counts.hiddenTerminal).toBe(2);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.items)).toBe(true);
    expect(Object.isFrozen(model.counts)).toBe(true);
    expect(Object.isFrozen(model.counts.byStatus)).toBe(true);
    const visibleSourceIndex = snapshot.jobs.length - 1;
    snapshot.jobs[visibleSourceIndex].rerunRequested = true;
    expect(
      model.items.find((item) => item.id === `completed-${visibleSourceIndex}`)?.rerunRequested
    ).toBe(false);
  });
});
