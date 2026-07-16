import { z } from "zod";

import { knowledgeIngestJobSchema } from "@/knowledge/model/schemas";
import type {
  KnowledgeDiagnostic,
  KnowledgeIngestJob,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { validateKnowledgeIngestJob } from "@/knowledge/model/validation";

/** Current version of the persisted ingest queue snapshot. */
export const INGEST_QUEUE_VERSION = 1 as const;

/** Durable reason that prevents a Bundle queue from claiming more work. */
export type IngestQueuePauseReason =
  | "user"
  | "rate_limit"
  | "startup_recovery"
  | "recovery_required";

/** Durable execution gate shared by every job in one Bundle queue. */
export type IngestQueueControl =
  | { status: "running" }
  | {
      status: "paused";
      reason: IngestQueuePauseReason;
      pausedAt: number;
      detail?: string;
      resumeAt?: number;
    };

/** Latest source input retained while an older input is still in flight. */
export interface IngestRerunRequest {
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  /** Latest durable per-source observation revision retained for the rerun. */
  inputRevision: number;
  requestedAt: number;
  updatedAt: number;
}

/** Complete versioned queue state persisted independently for one Bundle. */
export interface IngestQueueSnapshot {
  version: typeof INGEST_QUEUE_VERSION;
  bundleId: string;
  revision: number;
  control: IngestQueueControl;
  jobs: KnowledgeIngestJob[];
  reruns: IngestRerunRequest[];
}

/**
 * Signals that queue state changed after a read and before its full snapshot write.
 */
export class IngestQueueRevisionConflictError extends Error {
  /**
   * Creates an optimistic queue write conflict.
   *
   * @param bundleId - Bundle whose queue changed concurrently
   * @param expectedRevision - Revision observed before the write, or null for create
   * @param actualRevision - Optional revision observed by the storage adapter
   */
  constructor(
    public readonly bundleId: string,
    public readonly expectedRevision: number | null,
    public readonly actualRevision?: number | null
  ) {
    super(
      expectedRevision === null
        ? `Ingest queue '${bundleId}' was created concurrently`
        : `Ingest queue '${bundleId}' changed after revision ${expectedRevision}` +
            (actualRevision === undefined ? "" : `; observed revision ${actualRevision}`)
    );
    this.name = "IngestQueueRevisionConflictError";
  }
}

/** Persistence port for complete versioned queue snapshots. */
export interface QueueStorage {
  /**
   * Reads unknown persisted JSON for one Bundle.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Unknown JSON, or null when no queue has been persisted
   */
  read(bundleId: string): Promise<unknown>;

  /**
   * Writes a complete validated snapshot with optimistic revision checking.
   * The comparison and full-snapshot replacement MUST be one atomic adapter
   * operation; a read-then-write sequence without an exclusive lock is invalid.
   *
   * @param bundleId - Stable Bundle identifier
   * @param snapshot - Complete next queue revision
   * @param expectedRevision - Previously observed revision, or null for create
   */
  write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void>;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();

const queueControlSchema: z.ZodType<IngestQueueControl> = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running") }).strict(),
  z
    .object({
      status: z.literal("paused"),
      reason: z.enum(["user", "rate_limit", "startup_recovery", "recovery_required"]),
      pausedAt: nonNegativeIntegerSchema,
      detail: z.string().optional(),
      resumeAt: nonNegativeIntegerSchema.optional(),
    })
    .strict(),
]);

const rerunRequestSchema: z.ZodType<IngestRerunRequest> = z
  .object({
    jobId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeIntegerSchema,
    requestedAt: nonNegativeIntegerSchema,
    updatedAt: nonNegativeIntegerSchema,
  })
  .strict();

/** Strict runtime schema for a complete ingest queue snapshot. */
export const ingestQueueSnapshotSchema: z.ZodType<IngestQueueSnapshot> = z
  .object({
    version: z.literal(INGEST_QUEUE_VERSION),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    control: queueControlSchema,
    jobs: z.array(knowledgeIngestJobSchema),
    reruns: z.array(rerunRequestSchema),
  })
  .strict();

/**
 * Formats one Zod issue path for stable diagnostics.
 *
 * @param path - Zod property and array-index path
 * @returns Dot-separated diagnostic field
 */
function formatIssuePath(path: (string | number)[]): string {
  return path.map(String).join(".");
}

/**
 * Strictly parses unknown persisted queue JSON.
 *
 * @param value - Runtime value expected to contain a queue snapshot
 * @returns Parsed detached snapshot or structural diagnostics
 */
export function parseIngestQueueSnapshot(
  value: unknown
): KnowledgeParseResult<IngestQueueSnapshot> {
  const result = ingestQueueSnapshotSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      code: `schema_${issue.code}`,
      severity: "error",
      field: formatIssuePath(issue.path),
      message: issue.message,
    })),
  };
}

/**
 * Appends one deterministic semantic validation error.
 *
 * @param diagnostics - Mutable diagnostic collection
 * @param code - Stable machine-readable code
 * @param field - Snapshot field associated with the issue
 * @param message - Human-readable explanation
 */
function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

/**
 * Reports whether a job still participates in source-level queue deduplication.
 *
 * @param job - Durable queue job
 * @returns Whether the job is non-terminal
 */
function isActiveJob(job: KnowledgeIngestJob): boolean {
  return !["failed", "completed", "cancelled"].includes(job.status);
}

/**
 * Validates cross-record queue invariants after strict shape parsing.
 *
 * @param value - Unknown or typed queue snapshot
 * @returns Deterministic validation result
 */
export function validateIngestQueueSnapshot(value: unknown): KnowledgeValidationResult {
  const parsed = parseIngestQueueSnapshot(value);
  if (!parsed.ok) {
    return { valid: false, diagnostics: parsed.issues };
  }

  const snapshot = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  const jobIds = new Set<string>();
  const activeSourceIds = new Set<string>();
  const rerunSourceIds = new Set<string>();
  const rerunJobIds = new Set<string>();
  let processingCount = 0;

  snapshot.jobs.forEach((job, index) => {
    const field = `jobs.${index}`;
    if (job.bundleId !== snapshot.bundleId) {
      addError(
        diagnostics,
        "queue_job_bundle_mismatch",
        `${field}.bundleId`,
        "Every job must belong to the containing Bundle queue"
      );
    }
    if (jobIds.has(job.id)) {
      addError(
        diagnostics,
        "queue_job_id_duplicate",
        `${field}.id`,
        "Job ids must be unique within a queue"
      );
    }
    jobIds.add(job.id);

    const jobValidation = validateKnowledgeIngestJob(job);
    for (const diagnostic of jobValidation.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        field: diagnostic.field ? `${field}.${diagnostic.field}` : field,
      });
    }

    if (isActiveJob(job)) {
      if (activeSourceIds.has(job.sourceId)) {
        addError(
          diagnostics,
          "queue_active_source_duplicate",
          `${field}.sourceId`,
          "A source may have at most one non-terminal queue job"
        );
      }
      activeSourceIds.add(job.sourceId);
    } else if (job.rerunRequested) {
      addError(
        diagnostics,
        "queue_terminal_rerun_invalid",
        `${field}.rerunRequested`,
        "Terminal jobs cannot retain a rerun request"
      );
    }

    if (job.status === "processing") {
      processingCount += 1;
      if (snapshot.control.status === "paused" && job.stage !== "applying") {
        addError(
          diagnostics,
          "queue_processing_under_paused_gate",
          `${field}.stage`,
          "Only an applying job may finish under a paused execution gate"
        );
      }
    }
    if (job.status === "paused" && snapshot.control.status !== "paused") {
      addError(
        diagnostics,
        "queue_paused_job_without_gate",
        `${field}.status`,
        "A paused job requires a paused queue execution gate"
      );
    }
  });

  if (processingCount > 1) {
    addError(
      diagnostics,
      "queue_processing_count_invalid",
      "jobs",
      "A Bundle queue may persist at most one processing job"
    );
  }

  const hasApplyRecoveryFailure = snapshot.jobs.some(
    (job) => job.status === "failed" && job.stage === "applying"
  );
  if (
    hasApplyRecoveryFailure &&
    !(snapshot.control.status === "paused" && snapshot.control.reason === "recovery_required")
  ) {
    addError(
      diagnostics,
      "queue_apply_recovery_gate_missing",
      "control",
      "A failed applying job requires a sticky recovery-required gate"
    );
  }
  if (
    snapshot.control.status === "paused" &&
    snapshot.control.reason === "recovery_required" &&
    !hasApplyRecoveryFailure
  ) {
    addError(
      diagnostics,
      "queue_apply_recovery_job_missing",
      "control.reason",
      "A recovery-required gate must reference a failed applying job"
    );
  }

  snapshot.reruns.forEach((rerun, index) => {
    const field = `reruns.${index}`;
    if (rerunSourceIds.has(rerun.sourceId)) {
      addError(
        diagnostics,
        "queue_rerun_source_duplicate",
        `${field}.sourceId`,
        "A source may retain at most one latest rerun request"
      );
    }
    if (rerunJobIds.has(rerun.jobId) || jobIds.has(rerun.jobId)) {
      addError(
        diagnostics,
        "queue_rerun_job_id_duplicate",
        `${field}.jobId`,
        "A reserved rerun job id must be unique"
      );
    }
    rerunSourceIds.add(rerun.sourceId);
    rerunJobIds.add(rerun.jobId);

    if (rerun.updatedAt < rerun.requestedAt) {
      addError(
        diagnostics,
        "queue_rerun_timestamp_order_invalid",
        `${field}.updatedAt`,
        "Rerun updatedAt cannot precede requestedAt"
      );
    }

    const active = snapshot.jobs.find((job) => isActiveJob(job) && job.sourceId === rerun.sourceId);
    if (!active || !active.rerunRequested) {
      addError(
        diagnostics,
        "queue_rerun_orphaned",
        field,
        "Every rerun must be referenced by one non-terminal source job"
      );
      return;
    }
    if (rerun.requestedAt < active.createdAt) {
      addError(
        diagnostics,
        "queue_rerun_precedes_job",
        `${field}.requestedAt`,
        "A rerun cannot be requested before its active predecessor exists"
      );
    }
    if (rerun.updatedAt > active.updatedAt) {
      addError(
        diagnostics,
        "queue_rerun_torn_update",
        `${field}.updatedAt`,
        "Rerun state cannot be newer than its atomically updated predecessor"
      );
    }
    if (rerun.inputRevision <= active.inputRevision) {
      addError(
        diagnostics,
        "queue_rerun_observation_order_invalid",
        `${field}.inputRevision`,
        "A rerun input revision must follow its predecessor input revision"
      );
    }
    if (
      active.sourceContentHash === rerun.sourceContentHash &&
      active.pipelineFingerprint === rerun.pipelineFingerprint
    ) {
      addError(
        diagnostics,
        "queue_rerun_redundant",
        field,
        "A rerun must describe a different source or pipeline version"
      );
    }
  });

  snapshot.jobs.forEach((job, index) => {
    if (job.rerunRequested && !rerunSourceIds.has(job.sourceId)) {
      addError(
        diagnostics,
        "queue_rerun_payload_missing",
        `jobs.${index}.rerunRequested`,
        "A rerun flag requires a durable latest-input payload"
      );
    }
  });

  if (
    snapshot.control.status === "paused" &&
    snapshot.control.resumeAt !== undefined &&
    snapshot.control.reason !== "rate_limit"
  ) {
    addError(
      diagnostics,
      "queue_resume_time_reason_invalid",
      "control.resumeAt",
      "Only a rate-limit pause may declare a suggested resume time"
    );
  }
  if (
    snapshot.control.status === "paused" &&
    snapshot.control.resumeAt !== undefined &&
    snapshot.control.resumeAt < snapshot.control.pausedAt
  ) {
    addError(
      diagnostics,
      "queue_resume_timestamp_invalid",
      "control.resumeAt",
      "Suggested resume time cannot precede the pause"
    );
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
