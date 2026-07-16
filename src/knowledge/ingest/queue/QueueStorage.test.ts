import type { KnowledgeIngestJob } from "@/knowledge/model/types";
import {
  parseIngestQueueSnapshot,
  type IngestQueueSnapshot,
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
 * Creates a valid queue snapshot for structural and semantic tests.
 *
 * @param overrides - Optional snapshot fields to replace
 * @returns Strict queue snapshot
 */
function createSnapshot(overrides: Partial<IngestQueueSnapshot> = {}): IngestQueueSnapshot {
  return {
    version: 1,
    bundleId: "personal",
    revision: 0,
    control: { status: "running" },
    jobs: [createPendingJob()],
    reruns: [],
    ...overrides,
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
  });

  it("rejects unsupported versions and illegal job discriminants", () => {
    expect(parseIngestQueueSnapshot({ ...createSnapshot(), version: 2 }).ok).toBe(false);
    expect(
      parseIngestQueueSnapshot({
        ...createSnapshot(),
        jobs: [{ ...createPendingJob(), status: "processing", stage: "review" }],
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
});
