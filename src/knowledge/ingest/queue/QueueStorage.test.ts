import type { KnowledgeIngestJob } from "@/knowledge/model/types";
import {
  INGEST_QUEUE_VERSION,
  parseIngestQueueSnapshot,
  type IngestApplyAbandonment,
  type IngestApplyClaimMarker,
  type IngestApplyCommitMarker,
  type IngestQueueSnapshot,
  type IngestPendingReview,
  type IngestReviewRejection,
  type IngestRerunRequest,
  type IngestSourceHighWatermark,
  validateIngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/**
 * Creates a valid pending job for queue contract tests.
 *
 * @param overrides - Optional job fields to replace
 * @returns Strict durable pending job
 */
function createPendingJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    id: "job-1",
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 0,
    rerunRequested: false,
    createdAt: 100,
    updatedAt: 100,
    status: "pending",
    stage: "queued",
    ...overrides,
  } as KnowledgeIngestJob;
}

/**
 * Creates a valid processing job for queue contract tests.
 *
 * @param overrides - Optional job fields to replace
 * @returns Strict durable processing job
 */
function createProcessingJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    ...createPendingJob(),
    attempt: 1,
    status: "processing",
    stage: "parsing",
    startedAt: 110,
    updatedAt: 110,
    ...overrides,
  } as KnowledgeIngestJob;
}

/**
 * Creates a valid completed job for apply-commit acknowledgement tests.
 *
 * @param overrides - Optional completed-job fields to replace
 * @returns Strict durable completed job
 */
function createCompletedJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    ...createPendingJob(),
    attempt: 1,
    status: "completed",
    stage: "completed",
    changeSetId: "changeset-1",
    completedAt: 140,
    updatedAt: 140,
    ...overrides,
  } as KnowledgeIngestJob;
}

/**
 * Creates a cancelled review job for rejection-marker tests.
 *
 * @param overrides - Optional cancelled-job fields to replace
 * @returns Strict durable cancelled job
 */
function createCancelledReviewJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    ...createPendingJob(),
    attempt: 1,
    status: "cancelled",
    stage: "cancelled",
    cancelledAt: 130,
    updatedAt: 130,
    ...overrides,
  } as KnowledgeIngestJob;
}

/**
 * Creates a valid awaiting-review job for pending-anchor tests.
 *
 * @param overrides - Optional job fields to replace
 * @returns Strict durable awaiting-review job
 */
function createAwaitingReviewJob(overrides: Partial<KnowledgeIngestJob> = {}): KnowledgeIngestJob {
  return {
    ...createPendingJob(),
    attempt: 1,
    status: "awaiting_review",
    stage: "review",
    changeSetId: "changeset-review",
    updatedAt: 120,
    ...overrides,
  } as KnowledgeIngestJob;
}

/**
 * Creates one durable pending review anchor.
 *
 * @param overrides - Optional anchor fields to replace
 * @returns Strict pending review marker
 */
function createPendingReview(overrides: Partial<IngestPendingReview> = {}): IngestPendingReview {
  return {
    kind: "durable",
    jobId: "job-1",
    changeSetId: "changeset-review",
    proposalDigest: HASH_C,
    reviewRecordRevision: 0,
    recordedAt: 110,
    ...overrides,
  } as IngestPendingReview;
}

/**
 * Creates one exact durable review-rejection marker.
 *
 * @param overrides - Optional marker fields to replace
 * @returns Strict review rejection
 */
function createReviewRejection(
  overrides: Partial<IngestReviewRejection> = {}
): IngestReviewRejection {
  return {
    jobId: "job-1",
    changeSetId: "changeset-review",
    proposalDigest: HASH_C,
    reviewRecordRevision: 1,
    decisionAt: 120,
    rejectedAt: 130,
    ...overrides,
  };
}

/**
 * Creates a marker proving file commit preceded completed-job acknowledgement.
 *
 * @param overrides - Optional marker fields to replace
 * @returns Strict version-2 apply-commit marker
 */
function createApplyCommitMarker(
  overrides: Partial<IngestApplyCommitMarker> = {}
): IngestApplyCommitMarker {
  return {
    transactionId: "transaction-1",
    changeSetId: "changeset-1",
    changeSetDigest: HASH_C,
    commitRevision: 4,
    jobId: "job-1",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    startedAt: 110,
    committedAt: 130,
    ...overrides,
  };
}

/**
 * Creates the exact claim retained while an applying job is active or interrupted.
 *
 * @param overrides - Optional claim fields to replace
 * @returns Strict apply-claim marker
 */
function createApplyClaimMarker(
  overrides: Partial<IngestApplyClaimMarker> = {}
): IngestApplyClaimMarker {
  return {
    jobId: "job-1",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    startedAt: 110,
    ...overrides,
  };
}

/**
 * Creates exact durable proof that an accepted apply was abandoned before journaling.
 *
 * @param overrides - Optional abandonment fields to replace
 * @returns Strict apply-abandonment tombstone
 */
function createApplyAbandonment(
  overrides: Partial<IngestApplyAbandonment> = {}
): IngestApplyAbandonment {
  return {
    jobId: "job-1",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    attempt: 1,
    startedAt: 120,
    changeSetId: "changeset-review",
    changeSetDigest: HASH_C,
    proposalDigest: HASH_B,
    recordRevision: 1,
    manifestCommitIntentDigest: HASH_A,
    acceptedAt: 110,
    abandonedAt: 130,
    ...overrides,
  };
}

/**
 * Derives one highest source observation for a synthetic storage snapshot.
 *
 * @param jobs - Durable test jobs
 * @param reruns - Durable test rerun payloads
 * @returns One high-watermark per represented source
 */
function deriveTestHighWatermarks(
  jobs: readonly KnowledgeIngestJob[],
  reruns: readonly IngestRerunRequest[]
): IngestSourceHighWatermark[] {
  const values = new Map<string, IngestSourceHighWatermark>();
  for (const record of [...jobs, ...reruns]) {
    const current = values.get(record.sourceId);
    if (!current || record.inputRevision > current.inputRevision) {
      values.set(record.sourceId, {
        sourceId: record.sourceId,
        sourceContentHash: record.sourceContentHash,
        pipelineFingerprint: record.pipelineFingerprint,
        inputRevision: record.inputRevision,
        observedAt: record.updatedAt,
      });
    }
  }
  return [...values.values()];
}

/**
 * Creates a valid queue snapshot for structural and semantic tests.
 *
 * @param overrides - Optional snapshot fields to replace
 * @returns Strict queue snapshot
 */
function createSnapshot(overrides: Partial<IngestQueueSnapshot> = {}): IngestQueueSnapshot {
  const jobs = overrides.jobs ?? [createPendingJob()];
  const reruns = overrides.reruns ?? [];
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "personal",
    revision: 0,
    control: { status: "running" },
    jobs,
    reruns,
    ...overrides,
    sourceHighWatermarks: overrides.sourceHighWatermarks ?? deriveTestHighWatermarks(jobs, reruns),
    pendingReviews: overrides.pendingReviews ?? [],
    reviewRejections: overrides.reviewRejections ?? [],
    applyAbandonments: overrides.applyAbandonments ?? [],
  };
}

/**
 * Returns stable diagnostic codes emitted by queue validation.
 *
 * @param value - Queue value to validate
 * @returns Diagnostic codes in emission order
 */
function diagnosticCodes(value: unknown): string[] {
  return validateIngestQueueSnapshot(value).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("parseIngestQueueSnapshot", () => {
  it("round-trips and detaches a strict persisted snapshot", () => {
    const snapshot = createSnapshot();
    const parsed = parseIngestQueueSnapshot(snapshot);

    expect(parsed).toEqual({ ok: true, value: snapshot });
    if (parsed.ok) {
      expect(parsed.value).not.toBe(snapshot);
      expect(parsed.value.jobs[0]).not.toBe(snapshot.jobs[0]);
    }
  });

  it("rejects unknown fields and unsafe revision values", () => {
    expect(parseIngestQueueSnapshot({ ...createSnapshot(), unexpected: true }).ok).toBe(false);
    expect(
      parseIngestQueueSnapshot({ ...createSnapshot(), revision: Number.MAX_SAFE_INTEGER + 1 }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...createSnapshot(),
        applyCommit: { ...createApplyCommitMarker(), unexpected: true },
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...createSnapshot({
          jobs: [createCancelledReviewJob()],
          reviewRejections: [createReviewRejection()],
        }),
        reviewRejections: [{ ...createReviewRejection(), unexpected: true }],
      }).ok
    ).toBe(false);
    const missingHighWatermarks = { ...createSnapshot() } as Record<string, unknown>;
    delete missingHighWatermarks.sourceHighWatermarks;
    expect(parseIngestQueueSnapshot(missingHighWatermarks).ok).toBe(false);
    const missingPendingReviews = { ...createSnapshot() } as Record<string, unknown>;
    delete missingPendingReviews.pendingReviews;
    expect(parseIngestQueueSnapshot(missingPendingReviews).ok).toBe(false);
    const missingReviewRejections = { ...createSnapshot() } as Record<string, unknown>;
    delete missingReviewRejections.reviewRejections;
    expect(parseIngestQueueSnapshot(missingReviewRejections).ok).toBe(false);
    const missingApplyAbandonments = { ...createSnapshot() } as Record<string, unknown>;
    delete missingApplyAbandonments.applyAbandonments;
    expect(parseIngestQueueSnapshot(missingApplyAbandonments).ok).toBe(false);
  });

  it("strictly migrates version 1 reads into detached current state", () => {
    const current = createSnapshot();
    const legacy = {
      version: 1,
      bundleId: current.bundleId,
      revision: current.revision,
      control: current.control,
      jobs: current.jobs,
      reruns: current.reruns,
    };
    const parsed = parseIngestQueueSnapshot(legacy);

    expect(parsed).toEqual({ ok: true, value: current });
    if (parsed.ok) {
      expect(parsed.value.version).toBe(INGEST_QUEUE_VERSION);
      expect(parsed.value.reviewRejections).toEqual([]);
      expect(parsed.value.applyAbandonments).toEqual([]);
      expect("applyCommit" in parsed.value).toBe(false);
      expect(parsed.value).not.toBe(legacy);
      expect(parsed.value.jobs[0]).not.toBe(legacy.jobs[0]);
    }

    expect(parseIngestQueueSnapshot({ ...legacy, applyCommit: createApplyCommitMarker() }).ok).toBe(
      false
    );

    const legacyApplying = {
      ...legacy,
      jobs: [createProcessingJob({ stage: "applying" })],
    };
    expect(parseIngestQueueSnapshot(legacyApplying)).toMatchObject({
      ok: true,
      value: {
        applyClaim: { jobId: "job-1", attempt: 1, startedAt: 110 },
      },
    });

    const legacyDivergentHistory = {
      ...legacy,
      jobs: [
        createCompletedJob({
          id: "job-old",
          sourceContentHash: HASH_C,
          inputRevision: 3,
        }),
        createPendingJob(),
      ],
    };
    expect(diagnosticCodes(legacyDivergentHistory)).toContain(
      "queue_source_high_watermark_rerun_missing"
    );
  });

  it("strictly migrates version 2 reads with empty rejection history", () => {
    const current = createSnapshot();
    const legacy = {
      version: 2,
      bundleId: current.bundleId,
      revision: current.revision,
      control: current.control,
      jobs: current.jobs,
      reruns: current.reruns,
      sourceHighWatermarks: current.sourceHighWatermarks,
    };

    const parsed = parseIngestQueueSnapshot(legacy);
    expect(parsed).toEqual({ ok: true, value: current });
    if (parsed.ok) {
      expect(parsed.value.version).toBe(INGEST_QUEUE_VERSION);
      expect(parsed.value.reviewRejections).toEqual([]);
      expect(parsed.value.applyAbandonments).toEqual([]);
      expect(parsed.value).not.toBe(legacy);
    }
    expect(
      parseIngestQueueSnapshot({ ...legacy, reviewRejections: [createReviewRejection()] }).ok
    ).toBe(false);

    const awaitingJob = createAwaitingReviewJob();
    const awaitingLegacy = {
      ...legacy,
      jobs: [awaitingJob],
      sourceHighWatermarks: deriveTestHighWatermarks([awaitingJob], []),
    };
    expect(parseIngestQueueSnapshot(awaitingLegacy)).toMatchObject({
      ok: true,
      value: {
        pendingReviews: [
          {
            kind: "legacy_unverified",
            jobId: "job-1",
            changeSetId: "changeset-review",
            migratedFromVersion: 2,
          },
        ],
      },
    });
  });

  it("migrates version 3 reviewed apply authority to explicit fail-closed provenance", () => {
    const applying = createProcessingJob({ stage: "applying" });
    const current = createSnapshot({
      jobs: [applying],
      applyClaim: createApplyClaimMarker(),
    });
    const { applyAbandonments: _applyAbandonments, ...legacyCurrent } = current;
    void _applyAbandonments;
    const legacy = {
      ...legacyCurrent,
      version: 3,
      applyClaim: {
        ...createApplyClaimMarker(),
        reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
        acceptedReview: { proposalDigest: HASH_B, recordRevision: 1, acceptedAt: 110 },
      },
    };

    expect(parseIngestQueueSnapshot(legacy)).toMatchObject({
      ok: true,
      value: {
        version: INGEST_QUEUE_VERSION,
        applyClaim: {
          reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
          legacyReview: { kind: "legacy_unverified", migratedFromVersion: 3 },
        },
      },
    });
    const parsed = parseIngestQueueSnapshot(legacy);
    expect(parsed.ok && validateIngestQueueSnapshot(parsed.value).valid).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.applyAbandonments).toEqual([]);
    }

    expect(
      parseIngestQueueSnapshot({
        ...legacy,
        applyClaim: {
          ...legacy.applyClaim,
          acceptedReview: { ...legacy.applyClaim.acceptedReview, acceptedAt: 99 },
        },
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...legacy,
        applyClaim: {
          ...legacy.applyClaim,
          acceptedReview: { ...legacy.applyClaim.acceptedReview, acceptedAt: 111 },
        },
      }).ok
    ).toBe(false);

    expect(
      parseIngestQueueSnapshot({
        ...legacy,
        applyClaim: {
          ...createApplyClaimMarker(),
          acceptedReview: { proposalDigest: HASH_B, recordRevision: 1, acceptedAt: 110 },
        },
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...legacy,
        applyClaim: {
          ...createApplyClaimMarker(),
          reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
        },
      }).ok
    ).toBe(false);
  });

  it("strictly migrates version 4 reads with empty apply-abandonment history", () => {
    const current = createSnapshot();
    const { applyAbandonments: _applyAbandonments, ...withoutAbandonments } = current;
    const legacy = { ...withoutAbandonments, version: 4 };
    void _applyAbandonments;

    expect(parseIngestQueueSnapshot(legacy)).toEqual({ ok: true, value: current });
    expect(
      parseIngestQueueSnapshot({
        ...legacy,
        applyAbandonments: [createApplyAbandonment()],
      }).ok
    ).toBe(false);
    expect(parseIngestQueueSnapshot({ ...legacy, unexpected: true }).ok).toBe(false);
  });

  it("rejects unsupported versions and illegal job discriminants", () => {
    expect(parseIngestQueueSnapshot({ ...createSnapshot(), version: 6 }).ok).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...createSnapshot(),
        jobs: [{ ...createPendingJob(), status: "processing", stage: "review" }],
      }).ok
    ).toBe(false);
  });

  it("strictly parses apply-commit marker hashes, attempts, and revisions", () => {
    const base = createSnapshot({
      control: { status: "paused", reason: "commit_pending_ack", pausedAt: 140 },
      jobs: [createCompletedJob()],
      applyCommit: createApplyCommitMarker(),
    });
    expect(parseIngestQueueSnapshot(base).ok).toBe(true);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyCommit: createApplyCommitMarker({ changeSetDigest: "not-a-hash" }),
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyCommit: createApplyCommitMarker({ sourceContentHash: "not-a-hash" }),
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyCommit: createApplyCommitMarker({ attempt: 0 }),
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyCommit: createApplyCommitMarker({ commitRevision: -1 }),
      }).ok
    ).toBe(false);
  });

  it("strictly persists the exact digest of a reviewed apply claim", () => {
    const base = createSnapshot({
      jobs: [createProcessingJob({ stage: "applying" })],
      applyClaim: createApplyClaimMarker({
        reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
      }),
    });

    expect(parseIngestQueueSnapshot(base).ok).toBe(true);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyClaim: createApplyClaimMarker({
          reviewedChangeSet: {
            changeSetId: "changeset-reviewed",
            changeSetDigest: "not-a-hash",
          },
        }),
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyClaim: createApplyClaimMarker({
          reviewedChangeSet: {
            changeSetId: "changeset-reviewed",
            changeSetDigest: HASH_C,
            unexpected: true,
          } as never,
        }),
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...base,
        applyClaim: createApplyClaimMarker({
          reviewedChangeSet: { changeSetId: "changeset-reviewed", changeSetDigest: HASH_C },
          acceptedReview: {
            proposalDigest: HASH_B,
            recordRevision: 1,
            manifestCommitIntentDigest: "not-a-hash",
            acceptedAt: 110,
          },
        }),
      }).ok
    ).toBe(false);
  });

  it("strictly parses pending and terminal review revisions", () => {
    const pending = createSnapshot({
      jobs: [createAwaitingReviewJob()],
      pendingReviews: [createPendingReview()],
    });
    expect(parseIngestQueueSnapshot(pending).ok).toBe(true);
    expect(
      parseIngestQueueSnapshot({
        ...pending,
        pendingReviews: [createPendingReview({ reviewRecordRevision: 1 } as never)],
      }).ok
    ).toBe(false);

    const rejected = createSnapshot({
      jobs: [createCancelledReviewJob()],
      reviewRejections: [createReviewRejection()],
    });
    expect(
      parseIngestQueueSnapshot({
        ...rejected,
        reviewRejections: [createReviewRejection({ reviewRecordRevision: 2 } as never)],
      }).ok
    ).toBe(false);
  });

  it("strictly parses exact apply-abandonment identity", () => {
    const abandoned = createSnapshot({
      jobs: [createCancelledReviewJob()],
      applyAbandonments: [createApplyAbandonment()],
    });

    expect(parseIngestQueueSnapshot(abandoned).ok).toBe(true);
    expect(
      parseIngestQueueSnapshot({
        ...abandoned,
        applyAbandonments: [createApplyAbandonment({ manifestCommitIntentDigest: "not-a-hash" })],
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...abandoned,
        applyAbandonments: [createApplyAbandonment({ recordRevision: 2 } as never)],
      }).ok
    ).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...abandoned,
        applyAbandonments: [{ ...createApplyAbandonment(), unexpected: true }],
      }).ok
    ).toBe(false);
  });
});

describe("validateIngestQueueSnapshot", () => {
  it("accepts one active job per source and detached terminal history", () => {
    const completed: KnowledgeIngestJob = {
      ...createPendingJob({ id: "job-old", sourceId: "source-1" }),
      attempt: 1,
      status: "completed",
      stage: "completed",
      changeSetId: "changeset-old",
      completedAt: 100,
    };
    const snapshot = createSnapshot({ jobs: [completed, createPendingJob({ id: "job-new" })] });

    expect(validateIngestQueueSnapshot(snapshot)).toEqual({ valid: true, diagnostics: [] });
  });

  it("accepts an exact rejection marker for a cancelled review attempt", () => {
    const snapshot = createSnapshot({
      jobs: [createCancelledReviewJob()],
      reviewRejections: [createReviewRejection()],
    });

    expect(validateIngestQueueSnapshot(snapshot)).toEqual({ valid: true, diagnostics: [] });
  });

  it("accepts one exact durable abandonment for a cancelled accepted apply", () => {
    const snapshot = createSnapshot({
      jobs: [createCancelledReviewJob()],
      applyAbandonments: [createApplyAbandonment()],
    });

    expect(validateIngestQueueSnapshot(snapshot)).toEqual({ valid: true, diagnostics: [] });
  });

  it("requires unique apply-abandonment job and ChangeSet identities", () => {
    const codes = diagnosticCodes(
      createSnapshot({
        jobs: [createCancelledReviewJob()],
        applyAbandonments: [createApplyAbandonment(), createApplyAbandonment()],
      })
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        "queue_apply_abandonment_job_duplicate",
        "queue_apply_abandonment_changeset_duplicate",
      ])
    );
  });

  it("requires an abandonment to own the exact cancelled queue attempt", () => {
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createPendingJob()],
          applyAbandonments: [createApplyAbandonment()],
        })
      )
    ).toContain("queue_apply_abandonment_job_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createCancelledReviewJob()],
          applyAbandonments: [createApplyAbandonment({ sourceContentHash: HASH_C })],
        })
      )
    ).toContain("queue_apply_abandonment_job_invalid");
  });

  it("requires monotonic accepted, started, and abandoned timestamps", () => {
    const job = createCancelledReviewJob();
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          applyAbandonments: [createApplyAbandonment({ acceptedAt: 99 })],
        })
      )
    ).toContain("queue_apply_abandonment_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          applyAbandonments: [createApplyAbandonment({ acceptedAt: 121 })],
        })
      )
    ).toContain("queue_apply_abandonment_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          applyAbandonments: [createApplyAbandonment({ startedAt: 131 })],
        })
      )
    ).toContain("queue_apply_abandonment_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          applyAbandonments: [createApplyAbandonment({ abandonedAt: 129 })],
        })
      )
    ).toContain("queue_apply_abandonment_timestamp_mismatch");
  });

  it("rejects abandonment conflicts with active, committed, pending, or rejected state", () => {
    const cancelled = createCancelledReviewJob();
    const reviewedChangeSet = {
      changeSetId: "changeset-review",
      changeSetDigest: HASH_C,
    };
    const acceptedReview = {
      proposalDigest: HASH_B,
      recordRevision: 1 as const,
      manifestCommitIntentDigest: HASH_A,
      acceptedAt: 110,
    };

    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [cancelled],
          applyAbandonments: [createApplyAbandonment()],
          applyClaim: createApplyClaimMarker({ reviewedChangeSet, acceptedReview }),
        })
      )
    ).toContain("queue_apply_abandonment_claim_conflict");
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "commit_pending_ack", pausedAt: 140 },
          jobs: [cancelled],
          applyAbandonments: [createApplyAbandonment()],
          applyCommit: createApplyCommitMarker({
            changeSetId: "changeset-review",
            changeSetDigest: HASH_C,
          }),
        })
      )
    ).toContain("queue_apply_abandonment_commit_conflict");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [cancelled],
          pendingReviews: [createPendingReview()],
          applyAbandonments: [createApplyAbandonment()],
        })
      )
    ).toContain("queue_apply_abandonment_pending_review_conflict");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [cancelled],
          reviewRejections: [createReviewRejection()],
          applyAbandonments: [createApplyAbandonment()],
        })
      )
    ).toContain("queue_apply_abandonment_rejection_conflict");
  });

  it("requires every awaiting-review job to own one exact pending anchor", () => {
    const job = createAwaitingReviewJob();
    expect(
      validateIngestQueueSnapshot(
        createSnapshot({ jobs: [job], pendingReviews: [createPendingReview()] })
      )
    ).toEqual({ valid: true, diagnostics: [] });
    expect(diagnosticCodes(createSnapshot({ jobs: [job] }))).toContain(
      "queue_pending_review_missing"
    );
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          pendingReviews: [createPendingReview({ changeSetId: "changeset-other" })],
        })
      )
    ).toContain("queue_pending_review_changeset_mismatch");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [job],
          pendingReviews: [createPendingReview({ recordedAt: 99 })],
        })
      )
    ).toContain("queue_pending_review_timestamp_invalid");
  });

  it("rejects pending review conflicts with applying or rejected state", () => {
    const awaiting = createAwaitingReviewJob();
    const applying = createProcessingJob({
      id: "job-2",
      sourceId: "source-2",
      sourceContentHash: HASH_B,
      stage: "applying",
    });
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [awaiting, applying],
          pendingReviews: [createPendingReview()],
          applyClaim: createApplyClaimMarker({
            jobId: "job-2",
            sourceId: "source-2",
            sourceContentHash: HASH_B,
            reviewedChangeSet: {
              changeSetId: "changeset-review",
              changeSetDigest: HASH_C,
            },
            acceptedReview: {
              proposalDigest: HASH_C,
              recordRevision: 1,
              manifestCommitIntentDigest: HASH_A,
              acceptedAt: 110,
            },
          }),
        })
      )
    ).toContain("queue_apply_claim_pending_review_conflict");

    const cancelled = createCancelledReviewJob({
      id: "job-2",
      sourceId: "source-2",
      sourceContentHash: HASH_B,
    });
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [awaiting, cancelled],
          pendingReviews: [createPendingReview()],
          reviewRejections: [createReviewRejection({ jobId: "job-2" })],
        })
      )
    ).toContain("queue_review_rejection_pending_conflict");
  });

  it("requires exact durable or explicit legacy authorization for reviewed apply claims", () => {
    const applying = createProcessingJob({ stage: "applying" });
    const reviewedChangeSet = {
      changeSetId: "changeset-reviewed",
      changeSetDigest: HASH_C,
    };
    const acceptedReview = {
      proposalDigest: HASH_C,
      recordRevision: 1 as const,
      manifestCommitIntentDigest: HASH_A,
      acceptedAt: 110,
    };
    const valid = createSnapshot({
      jobs: [applying],
      applyClaim: createApplyClaimMarker({ reviewedChangeSet, acceptedReview }),
    });
    expect(validateIngestQueueSnapshot(valid)).toEqual({ valid: true, diagnostics: [] });

    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [applying],
          applyClaim: createApplyClaimMarker({ reviewedChangeSet }),
        })
      )
    ).toContain("queue_apply_claim_review_authorization_missing");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [applying],
          applyClaim: createApplyClaimMarker({ acceptedReview }),
        })
      )
    ).toContain("queue_apply_claim_review_payload_missing");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [applying],
          applyClaim: createApplyClaimMarker({
            reviewedChangeSet,
            acceptedReview,
            legacyReview: { kind: "legacy_unverified", migratedFromVersion: 2 },
          }),
        })
      )
    ).toContain("queue_apply_claim_review_authorization_conflict");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [applying],
          applyClaim: createApplyClaimMarker({
            reviewedChangeSet,
            acceptedReview: { ...acceptedReview, acceptedAt: 99 },
          }),
        })
      )
    ).toContain("queue_apply_claim_review_time_invalid");
  });

  it("requires rejection markers to own one exact cancelled attempt and timestamp", () => {
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createPendingJob()],
          reviewRejections: [createReviewRejection()],
        })
      )
    ).toContain("queue_review_rejection_job_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createCancelledReviewJob()],
          reviewRejections: [createReviewRejection({ rejectedAt: 129 })],
        })
      )
    ).toContain("queue_review_rejection_timestamp_mismatch");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createCancelledReviewJob({ attempt: 0 })],
          reviewRejections: [createReviewRejection()],
        })
      )
    ).toContain("queue_review_rejection_job_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createCancelledReviewJob()],
          reviewRejections: [createReviewRejection({ decisionAt: 131 })],
        })
      )
    ).toContain("queue_review_rejection_decision_time_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createCancelledReviewJob()],
          reviewRejections: [createReviewRejection({ decisionAt: 99 })],
        })
      )
    ).toContain("queue_review_rejection_decision_time_invalid");
  });

  it("rejects duplicate or cross-job review rejection identity", () => {
    const first = createCancelledReviewJob();
    const second = createCancelledReviewJob({
      id: "job-2",
      sourceId: "source-2",
      sourceContentHash: HASH_C,
    });
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [first],
          reviewRejections: [
            createReviewRejection(),
            createReviewRejection({ changeSetId: "changeset-other" }),
          ],
        })
      )
    ).toContain("queue_review_rejection_job_duplicate");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [first, second],
          reviewRejections: [createReviewRejection(), createReviewRejection({ jobId: "job-2" })],
        })
      )
    ).toContain("queue_review_rejection_changeset_duplicate");

    const completed = createCompletedJob({
      id: "job-completed",
      sourceId: "source-2",
      sourceContentHash: HASH_C,
      changeSetId: "changeset-review",
    });
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [first, completed],
          reviewRejections: [createReviewRejection()],
        })
      )
    ).toContain("queue_review_rejection_changeset_conflict");
  });

  it("requires one monotonic payload-consistent high-watermark per source", () => {
    expect(diagnosticCodes(createSnapshot({ sourceHighWatermarks: [] }))).toContain(
      "queue_source_high_watermark_missing"
    );
    expect(
      diagnosticCodes(
        createSnapshot({
          sourceHighWatermarks: [
            ...deriveTestHighWatermarks([createPendingJob()], []),
            ...deriveTestHighWatermarks([createPendingJob()], []),
          ],
        })
      )
    ).toContain("queue_source_high_watermark_duplicate");
    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createPendingJob({ inputRevision: 2 })],
          sourceHighWatermarks: deriveTestHighWatermarks([createPendingJob()], []),
        })
      )
    ).toContain("queue_source_high_watermark_behind");
    expect(
      diagnosticCodes(
        createSnapshot({
          sourceHighWatermarks: [
            {
              ...deriveTestHighWatermarks([createPendingJob()], [])[0],
              sourceContentHash: HASH_C,
            },
          ],
        })
      )
    ).toContain("queue_source_high_watermark_payload_mismatch");
    expect(
      diagnosticCodes(
        createSnapshot({
          sourceHighWatermarks: [
            {
              sourceId: "source-1",
              sourceContentHash: HASH_C,
              pipelineFingerprint: HASH_B,
              inputRevision: 3,
              observedAt: 120,
            },
          ],
        })
      )
    ).toContain("queue_source_high_watermark_rerun_missing");
  });

  it("rejects Bundle mismatches, duplicate ids, duplicate active sources, and two workers", () => {
    const first = createProcessingJob();
    const second = createProcessingJob({
      id: "job-2",
      bundleId: "other",
      sourceId: "source-1",
    });

    expect(diagnosticCodes(createSnapshot({ jobs: [first, second] }))).toEqual(
      expect.arrayContaining([
        "queue_job_bundle_mismatch",
        "queue_active_source_duplicate",
        "queue_processing_count_invalid",
      ])
    );

    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createPendingJob(), createPendingJob({ sourceId: "source-2" })],
        })
      )
    ).toContain("queue_job_id_duplicate");
  });

  it("requires every rerun flag and payload to match each other", () => {
    expect(
      diagnosticCodes(createSnapshot({ jobs: [createProcessingJob({ rerunRequested: true })] }))
    ).toContain("queue_rerun_payload_missing");

    expect(
      diagnosticCodes(
        createSnapshot({
          jobs: [createProcessingJob()],
          reruns: [
            {
              jobId: "job-rerun",
              sourceId: "source-1",
              sourceContentHash: HASH_C,
              pipelineFingerprint: HASH_B,
              inputRevision: 2,
              requestedAt: 120,
              updatedAt: 120,
            },
          ],
        })
      )
    ).toContain("queue_rerun_orphaned");
  });

  it("rejects duplicate, redundant, colliding, and backwards-time rerun payloads", () => {
    const rerun = {
      jobId: "job-rerun",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      requestedAt: 130,
      updatedAt: 120,
    };
    const snapshot = createSnapshot({
      jobs: [createProcessingJob({ rerunRequested: true })],
      reruns: [rerun, { ...rerun, jobId: "job-1", sourceContentHash: HASH_C }],
    });

    expect(diagnosticCodes(snapshot)).toEqual(
      expect.arrayContaining([
        "queue_rerun_source_duplicate",
        "queue_rerun_job_id_duplicate",
        "queue_rerun_timestamp_order_invalid",
        "queue_rerun_redundant",
      ])
    );
  });

  it("requires every retained rerun to equal the latest source observation", () => {
    const active = createProcessingJob({ rerunRequested: true });
    const staleRerun: IngestRerunRequest = {
      jobId: "job-rerun",
      sourceId: "source-1",
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      requestedAt: 110,
      updatedAt: 110,
    };
    const snapshot = createSnapshot({
      jobs: [active],
      reruns: [staleRerun],
      sourceHighWatermarks: [
        {
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 3,
          observedAt: 130,
        },
      ],
    });

    expect(parseIngestQueueSnapshot(snapshot).ok).toBe(true);
    expect(diagnosticCodes(snapshot)).toContain("queue_rerun_not_latest_observation");
  });

  it("requires a paused execution gate for paused jobs", () => {
    const paused: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      status: "paused",
      stage: "generating",
      pausedAt: 120,
      updatedAt: 120,
      reason: "User paused",
    };

    expect(diagnosticCodes(createSnapshot({ jobs: [paused] }))).toContain(
      "queue_paused_job_without_gate"
    );
    expect(
      validateIngestQueueSnapshot(
        createSnapshot({
          control: { status: "paused", reason: "user", pausedAt: 120 },
          jobs: [paused],
        })
      ).valid
    ).toBe(true);
  });

  it("allows only applying work to finish beneath a paused execution gate", () => {
    const parsing = createProcessingJob();
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "user", pausedAt: 120 },
          jobs: [parsing],
        })
      )
    ).toContain("queue_processing_under_paused_gate");

    expect(
      validateIngestQueueSnapshot(
        createSnapshot({
          control: { status: "paused", reason: "user", pausedAt: 120 },
          jobs: [createProcessingJob({ stage: "applying" })],
          applyClaim: createApplyClaimMarker(),
        })
      ).valid
    ).toBe(true);
  });

  it("allows suggested resume time only for rate-limit pauses", () => {
    expect(
      diagnosticCodes(
        createSnapshot({
          control: {
            status: "paused",
            reason: "startup_recovery",
            pausedAt: 120,
            resumeAt: 200,
          },
        })
      )
    ).toContain("queue_resume_time_reason_invalid");

    expect(
      validateIngestQueueSnapshot(
        createSnapshot({
          control: { status: "paused", reason: "rate_limit", pausedAt: 120, resumeAt: 200 },
        })
      ).valid
    ).toBe(true);

    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "rate_limit", pausedAt: 200, resumeAt: 199 },
        })
      )
    ).toContain("queue_resume_timestamp_invalid");
  });

  it("accepts an atomically paired apply-commit marker and acknowledgement gate", () => {
    const snapshot = createSnapshot({
      control: { status: "paused", reason: "commit_pending_ack", pausedAt: 140 },
      jobs: [createCompletedJob()],
      applyCommit: createApplyCommitMarker(),
    });

    expect(validateIngestQueueSnapshot(snapshot)).toEqual({ valid: true, diagnostics: [] });
  });

  it("rejects a torn marker or commit-pending acknowledgement gate", () => {
    expect(
      diagnosticCodes(
        createSnapshot({ jobs: [createCompletedJob()], applyCommit: createApplyCommitMarker() })
      )
    ).toContain("queue_apply_commit_gate_missing");

    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "commit_pending_ack", pausedAt: 140 },
          jobs: [createCompletedJob()],
        })
      )
    ).toContain("queue_apply_commit_marker_missing");
  });

  it("requires the marker to identify one exact completed job attempt and ChangeSet", () => {
    const control = { status: "paused", reason: "commit_pending_ack", pausedAt: 140 } as const;
    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [createPendingJob()],
          applyCommit: createApplyCommitMarker(),
        })
      )
    ).toContain("queue_apply_commit_job_invalid");

    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [createCompletedJob()],
          applyCommit: createApplyCommitMarker({ attempt: 2, changeSetId: "changeset-other" }),
        })
      )
    ).toContain("queue_apply_commit_job_invalid");
  });

  it("enforces job, file-commit, completion, and pause timestamp order", () => {
    const completed = createCompletedJob();
    const control = { status: "paused", reason: "commit_pending_ack", pausedAt: 140 } as const;
    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [completed],
          applyCommit: createApplyCommitMarker({ startedAt: 99 }),
        })
      )
    ).toContain("queue_apply_commit_started_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [completed],
          applyCommit: createApplyCommitMarker({ startedAt: 131, committedAt: 130 }),
        })
      )
    ).toContain("queue_apply_commit_started_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { ...control, pausedAt: 150 },
          jobs: [completed],
          applyCommit: createApplyCommitMarker({ committedAt: 150 }),
        })
      )
    ).toContain("queue_apply_commit_committed_timestamp_invalid");
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { ...control, pausedAt: 129 },
          jobs: [completed],
          applyCommit: createApplyCommitMarker(),
        })
      )
    ).toContain("queue_apply_commit_pause_timestamp_invalid");
  });

  it("never allows a committed marker to coexist with failed applying recovery", () => {
    const failedApplying: KnowledgeIngestJob = {
      ...createPendingJob({ id: "job-failed", sourceId: "source-failed" }),
      attempt: 1,
      status: "failed",
      stage: "applying",
      failure: {
        code: "apply_failed",
        message: "Apply requires recovery",
        retryable: false,
        occurredAt: 130,
      },
      updatedAt: 130,
    };
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "commit_pending_ack", pausedAt: 140 },
          jobs: [createCompletedJob(), failedApplying],
          applyCommit: createApplyCommitMarker(),
        })
      )
    ).toContain("queue_apply_commit_recovery_conflict");
  });

  it("retains the sticky recovery-required invariants from version 1", () => {
    const failedApplying: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      status: "failed",
      stage: "applying",
      failure: {
        code: "apply_failed",
        message: "Apply requires recovery",
        retryable: false,
        occurredAt: 120,
      },
      updatedAt: 120,
    };
    expect(diagnosticCodes(createSnapshot({ jobs: [failedApplying] }))).toContain(
      "queue_apply_recovery_gate_missing"
    );
    expect(
      diagnosticCodes(
        createSnapshot({
          control: { status: "paused", reason: "recovery_required", pausedAt: 120 },
        })
      )
    ).toContain("queue_apply_recovery_job_missing");
    expect(
      validateIngestQueueSnapshot(
        createSnapshot({
          control: { status: "paused", reason: "recovery_required", pausedAt: 120 },
          jobs: [failedApplying],
          applyClaim: createApplyClaimMarker(),
        })
      ).valid
    ).toBe(true);
  });

  it("requires every applying state to retain and exactly match its claim", () => {
    const failedApplying: KnowledgeIngestJob = {
      ...createPendingJob(),
      attempt: 1,
      status: "failed",
      stage: "applying",
      failure: {
        code: "apply_failed",
        message: "Apply requires recovery",
        retryable: false,
        occurredAt: 120,
      },
      updatedAt: 120,
    };
    const control = { status: "paused", reason: "recovery_required", pausedAt: 120 } as const;

    expect(diagnosticCodes(createSnapshot({ control, jobs: [failedApplying] }))).toContain(
      "queue_apply_claim_marker_missing"
    );
    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [failedApplying],
          applyClaim: createApplyClaimMarker({ startedAt: 111 }),
        })
      )
    ).not.toContain("queue_apply_claim_job_mismatch");
    expect(
      diagnosticCodes(
        createSnapshot({
          control,
          jobs: [failedApplying],
          applyClaim: createApplyClaimMarker({ sourceContentHash: HASH_C }),
        })
      )
    ).toContain("queue_apply_claim_job_mismatch");
  });
});
