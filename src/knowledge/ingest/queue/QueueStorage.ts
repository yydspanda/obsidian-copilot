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
export const INGEST_QUEUE_VERSION = 4 as const;

/** Durable reason that prevents a Bundle queue from claiming more work. */
export type IngestQueuePauseReason =
  | "user"
  | "rate_limit"
  | "startup_recovery"
  | "recovery_required"
  | "commit_pending_ack";

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

/** Latest durable source observation used to reject out-of-order watcher delivery. */
export interface IngestSourceHighWatermark {
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  observedAt: number;
}

/** Immutable queue-job identity shared by interrupted and committed apply markers. */
export interface IngestApplyJobClaim {
  jobId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  attempt: number;
  startedAt: number;
}

/** Exact reviewed ChangeSet payload accepted by the user before file application. */
export interface IngestReviewedChangeSetIdentity {
  changeSetId: string;
  changeSetDigest: string;
}

/** Exact durable Review Store decision that authorized one apply claim. */
export interface IngestAcceptedReviewIdentity {
  proposalDigest: string;
  recordRevision: 1;
  manifestCommitIntentDigest: string;
  acceptedAt: number;
}

/** Explicit fail-closed provenance for a reviewed apply claim migrated without full authority. */
export interface IngestLegacyReviewIdentity {
  kind: "legacy_unverified";
  migratedFromVersion: 2 | 3;
}

/** Exact active or interrupted applying claim, optionally bound to reviewed content. */
export interface IngestApplyClaimMarker extends IngestApplyJobClaim {
  reviewedChangeSet?: IngestReviewedChangeSetIdentity;
  acceptedReview?: IngestAcceptedReviewIdentity;
  legacyReview?: IngestLegacyReviewIdentity;
}

/** Durable hand-off proving that file commit finished before queue acknowledgement. */
export interface IngestApplyCommitMarker extends IngestApplyJobClaim {
  transactionId: string;
  changeSetId: string;
  changeSetDigest: string;
  commitRevision: number;
  committedAt: number;
}

/** Durable proof that one exact review proposal was explicitly rejected. */
export interface IngestReviewRejection {
  jobId: string;
  changeSetId: string;
  proposalDigest: string;
  reviewRecordRevision: 1;
  decisionAt: number;
  rejectedAt: number;
}

/** Durable pending Review Store record anchored before a queue waits for user input. */
export interface IngestDurablePendingReview {
  kind: "durable";
  jobId: string;
  changeSetId: string;
  proposalDigest: string;
  reviewRecordRevision: 0;
  recordedAt: number;
}

/** Explicit fail-closed marker for a pre-v3 awaiting-review job without an anchor. */
export interface IngestLegacyPendingReview {
  kind: "legacy_unverified";
  jobId: string;
  changeSetId: string;
  migratedFromVersion: 1 | 2;
}

/** Exact pending-review ownership retained by the queue. */
export type IngestPendingReview = IngestDurablePendingReview | IngestLegacyPendingReview;

/** Complete versioned queue state persisted independently for one Bundle. */
export interface IngestQueueSnapshot {
  version: typeof INGEST_QUEUE_VERSION;
  bundleId: string;
  revision: number;
  control: IngestQueueControl;
  jobs: KnowledgeIngestJob[];
  reruns: IngestRerunRequest[];
  sourceHighWatermarks: IngestSourceHighWatermark[];
  pendingReviews: IngestPendingReview[];
  reviewRejections: IngestReviewRejection[];
  applyClaim?: IngestApplyClaimMarker;
  applyCommit?: IngestApplyCommitMarker;
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
const positiveIntegerSchema = z.number().int().safe().positive();

/** Pause reasons accepted by the read-only version-1 migration schema. */
type LegacyIngestQueuePauseReason = Exclude<IngestQueuePauseReason, "commit_pending_ack">;

/** Version-1 queue control retained exclusively for strict read migration. */
type LegacyIngestQueueControl =
  | { status: "running" }
  | {
      status: "paused";
      reason: LegacyIngestQueuePauseReason;
      pausedAt: number;
      detail?: string;
      resumeAt?: number;
    };

/** Complete legacy snapshot accepted only by the version-1 read migration. */
interface LegacyIngestQueueSnapshotV1 {
  version: 1;
  bundleId: string;
  revision: number;
  control: LegacyIngestQueueControl;
  jobs: KnowledgeIngestJob[];
  reruns: IngestRerunRequest[];
}

/** Version-2 apply claim before durable accepted-review identity was retained. */
interface LegacyIngestApplyClaimMarker extends IngestApplyJobClaim {
  reviewedChangeSet?: IngestReviewedChangeSetIdentity;
}

/** Complete version-2 snapshot accepted only by the strict read migration. */
interface LegacyIngestQueueSnapshotV2 {
  version: 2;
  bundleId: string;
  revision: number;
  control: IngestQueueControl;
  jobs: KnowledgeIngestJob[];
  reruns: IngestRerunRequest[];
  sourceHighWatermarks: IngestSourceHighWatermark[];
  applyClaim?: LegacyIngestApplyClaimMarker;
  applyCommit?: IngestApplyCommitMarker;
}

/** Version-3 accepted review identity before final Manifest intent was retained. */
interface LegacyIngestAcceptedReviewIdentityV3 {
  proposalDigest: string;
  recordRevision: 1;
  acceptedAt: number;
}

/** Version-3 apply claim before the final Manifest intent digest was retained. */
interface LegacyIngestApplyClaimMarkerV3 extends IngestApplyJobClaim {
  reviewedChangeSet?: IngestReviewedChangeSetIdentity;
  acceptedReview?: LegacyIngestAcceptedReviewIdentityV3;
  legacyReview?: IngestLegacyReviewIdentity;
}

/** Complete version-3 snapshot accepted only by the strict read migration. */
interface LegacyIngestQueueSnapshotV3 {
  version: 3;
  bundleId: string;
  revision: number;
  control: IngestQueueControl;
  jobs: KnowledgeIngestJob[];
  reruns: IngestRerunRequest[];
  sourceHighWatermarks: IngestSourceHighWatermark[];
  pendingReviews: IngestPendingReview[];
  reviewRejections: IngestReviewRejection[];
  applyClaim?: LegacyIngestApplyClaimMarkerV3;
  applyCommit?: IngestApplyCommitMarker;
}

const legacyQueueControlSchema: z.ZodType<LegacyIngestQueueControl> = z.discriminatedUnion(
  "status",
  [
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
  ]
);

const queueControlSchema: z.ZodType<IngestQueueControl> = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running") }).strict(),
  z
    .object({
      status: z.literal("paused"),
      reason: z.enum([
        "user",
        "rate_limit",
        "startup_recovery",
        "recovery_required",
        "commit_pending_ack",
      ]),
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

const sourceHighWatermarkSchema: z.ZodType<IngestSourceHighWatermark> = z
  .object({
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeIntegerSchema,
    observedAt: nonNegativeIntegerSchema,
  })
  .strict();

const applyJobClaimShape = {
  jobId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceContentHash: sha256Schema,
  pipelineFingerprint: sha256Schema,
  inputRevision: nonNegativeIntegerSchema,
  attempt: positiveIntegerSchema,
  startedAt: nonNegativeIntegerSchema,
};

const reviewedChangeSetIdentitySchema: z.ZodType<IngestReviewedChangeSetIdentity> = z
  .object({ changeSetId: nonEmptyStringSchema, changeSetDigest: sha256Schema })
  .strict();

const acceptedReviewIdentitySchema: z.ZodType<IngestAcceptedReviewIdentity> = z
  .object({
    proposalDigest: sha256Schema,
    recordRevision: z.literal(1),
    manifestCommitIntentDigest: sha256Schema,
    acceptedAt: nonNegativeIntegerSchema,
  })
  .strict();

const legacyReviewIdentitySchema: z.ZodType<IngestLegacyReviewIdentity> = z
  .object({
    kind: z.literal("legacy_unverified"),
    migratedFromVersion: z.union([z.literal(2), z.literal(3)]),
  })
  .strict();

const legacyAcceptedReviewIdentityV3Schema: z.ZodType<LegacyIngestAcceptedReviewIdentityV3> = z
  .object({
    proposalDigest: sha256Schema,
    recordRevision: z.literal(1),
    acceptedAt: nonNegativeIntegerSchema,
  })
  .strict();

const applyClaimMarkerSchema: z.ZodType<IngestApplyClaimMarker> = z
  .object({
    ...applyJobClaimShape,
    reviewedChangeSet: reviewedChangeSetIdentitySchema.optional(),
    acceptedReview: acceptedReviewIdentitySchema.optional(),
    legacyReview: legacyReviewIdentitySchema.optional(),
  })
  .strict();

const legacyApplyClaimMarkerSchema: z.ZodType<LegacyIngestApplyClaimMarker> = z
  .object({ ...applyJobClaimShape, reviewedChangeSet: reviewedChangeSetIdentitySchema.optional() })
  .strict();

const legacyApplyClaimMarkerV3Schema: z.ZodType<LegacyIngestApplyClaimMarkerV3> = z
  .object({
    ...applyJobClaimShape,
    reviewedChangeSet: reviewedChangeSetIdentitySchema.optional(),
    acceptedReview: legacyAcceptedReviewIdentityV3Schema.optional(),
    legacyReview: legacyReviewIdentitySchema.optional(),
  })
  .strict();

const applyCommitMarkerSchema: z.ZodType<IngestApplyCommitMarker> = z
  .object({
    ...applyJobClaimShape,
    transactionId: nonEmptyStringSchema,
    changeSetId: nonEmptyStringSchema,
    changeSetDigest: sha256Schema,
    commitRevision: nonNegativeIntegerSchema,
    committedAt: nonNegativeIntegerSchema,
  })
  .strict();

const reviewRejectionSchema: z.ZodType<IngestReviewRejection> = z
  .object({
    jobId: nonEmptyStringSchema,
    changeSetId: nonEmptyStringSchema,
    proposalDigest: sha256Schema,
    reviewRecordRevision: z.literal(1),
    decisionAt: nonNegativeIntegerSchema,
    rejectedAt: nonNegativeIntegerSchema,
  })
  .strict();

const pendingReviewSchema: z.ZodType<IngestPendingReview> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("durable"),
      jobId: nonEmptyStringSchema,
      changeSetId: nonEmptyStringSchema,
      proposalDigest: sha256Schema,
      reviewRecordRevision: z.literal(0),
      recordedAt: nonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("legacy_unverified"),
      jobId: nonEmptyStringSchema,
      changeSetId: nonEmptyStringSchema,
      migratedFromVersion: z.union([z.literal(1), z.literal(2)]),
    })
    .strict(),
]);

/** Strict read-only schema for a version-1 queue snapshot. */
const legacyIngestQueueSnapshotSchema: z.ZodType<LegacyIngestQueueSnapshotV1> = z
  .object({
    version: z.literal(1),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    control: legacyQueueControlSchema,
    jobs: z.array(knowledgeIngestJobSchema),
    reruns: z.array(rerunRequestSchema),
  })
  .strict();

/** Strict read-only schema for a version-2 queue snapshot. */
const legacyIngestQueueSnapshotV2Schema: z.ZodType<LegacyIngestQueueSnapshotV2> = z
  .object({
    version: z.literal(2),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    control: queueControlSchema,
    jobs: z.array(knowledgeIngestJobSchema),
    reruns: z.array(rerunRequestSchema),
    sourceHighWatermarks: z.array(sourceHighWatermarkSchema),
    applyClaim: legacyApplyClaimMarkerSchema.optional(),
    applyCommit: applyCommitMarkerSchema.optional(),
  })
  .strict();

/** Strict read-only schema for a version-3 queue snapshot. */
const legacyIngestQueueSnapshotV3Schema: z.ZodType<LegacyIngestQueueSnapshotV3> = z
  .object({
    version: z.literal(3),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    control: queueControlSchema,
    jobs: z.array(knowledgeIngestJobSchema),
    reruns: z.array(rerunRequestSchema),
    sourceHighWatermarks: z.array(sourceHighWatermarkSchema),
    pendingReviews: z.array(pendingReviewSchema),
    reviewRejections: z.array(reviewRejectionSchema),
    applyClaim: legacyApplyClaimMarkerV3Schema.optional(),
    applyCommit: applyCommitMarkerSchema.optional(),
  })
  .strict();

/**
 * Strict runtime schema for a complete version-4 ingest queue snapshot.
 *
 * Version 4 intentionally has no extension bag. Every new persisted field
 * requires another version and an explicit read migration.
 */
export const ingestQueueSnapshotSchema: z.ZodType<IngestQueueSnapshot> = z
  .object({
    version: z.literal(INGEST_QUEUE_VERSION),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    control: queueControlSchema,
    jobs: z.array(knowledgeIngestJobSchema),
    reruns: z.array(rerunRequestSchema),
    sourceHighWatermarks: z.array(sourceHighWatermarkSchema),
    pendingReviews: z.array(pendingReviewSchema),
    reviewRejections: z.array(reviewRejectionSchema),
    applyClaim: applyClaimMarkerSchema.optional(),
    applyCommit: applyCommitMarkerSchema.optional(),
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
 * Reports whether unknown persisted JSON declares the legacy version-1 format.
 *
 * @param value - Untrusted queue JSON
 * @returns Whether the top-level version discriminator is exactly one
 */
function isLegacyVersionOneSnapshot(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "version" in value
    ? (value as { version?: unknown }).version === 1
    : false;
}

/**
 * Reports whether unknown persisted JSON declares the legacy version-2 format.
 *
 * @param value - Untrusted queue JSON
 * @returns Whether the top-level version discriminator is exactly two
 */
function isLegacyVersionTwoSnapshot(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "version" in value
    ? (value as { version?: unknown }).version === 2
    : false;
}

/**
 * Reports whether unknown persisted JSON declares the legacy version-3 format.
 *
 * @param value - Untrusted queue JSON
 * @returns Whether the top-level version discriminator is exactly three
 */
function isLegacyVersionThreeSnapshot(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "version" in value
    ? (value as { version?: unknown }).version === 3
    : false;
}

/**
 * Reconstructs the best available per-source high-watermark from legacy records.
 *
 * Equal-revision payload conflicts deliberately retain the first candidate so
 * semantic validation can detect the disagreeing job or rerun and fail closed.
 *
 * @param legacy - Strictly parsed version-1 queue state
 * @returns One highest observed record per source
 */
function deriveLegacySourceHighWatermarks(
  legacy: LegacyIngestQueueSnapshotV1
): IngestSourceHighWatermark[] {
  const highWatermarks = new Map<string, IngestSourceHighWatermark>();
  const candidates: IngestSourceHighWatermark[] = [
    ...legacy.jobs.map((job) => ({
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
      observedAt: job.updatedAt,
    })),
    ...legacy.reruns.map((rerun) => ({
      sourceId: rerun.sourceId,
      sourceContentHash: rerun.sourceContentHash,
      pipelineFingerprint: rerun.pipelineFingerprint,
      inputRevision: rerun.inputRevision,
      observedAt: rerun.updatedAt,
    })),
  ];
  for (const candidate of candidates) {
    const current = highWatermarks.get(candidate.sourceId);
    if (!current || candidate.inputRevision > current.inputRevision) {
      highWatermarks.set(candidate.sourceId, candidate);
    }
  }
  return [...highWatermarks.values()];
}

/**
 * Makes pre-v3 awaiting-review state explicit without inventing Review Store proof.
 *
 * @param jobs - Strictly parsed legacy queue jobs
 * @param version - Legacy snapshot version that owned the jobs
 * @returns One fail-closed marker per legacy awaiting-review job
 */
function deriveLegacyPendingReviews(
  jobs: readonly KnowledgeIngestJob[],
  version: 1 | 2
): IngestLegacyPendingReview[] {
  return jobs
    .filter(
      (job): job is Extract<KnowledgeIngestJob, { status: "awaiting_review" }> =>
        job.status === "awaiting_review"
    )
    .map((job) => ({
      kind: "legacy_unverified",
      jobId: job.id,
      changeSetId: job.changeSetId,
      migratedFromVersion: version,
    }));
}

/**
 * Converts one strictly parsed version-1 snapshot into detached version-4 state.
 *
 * @param legacy - Valid version-1 persisted queue
 * @returns Equivalent version-4 queue without review-rejection history
 */
function migrateVersionOneSnapshot(legacy: LegacyIngestQueueSnapshotV1): IngestQueueSnapshot {
  const applying = legacy.jobs.find(
    (job): job is Extract<KnowledgeIngestJob, { status: "processing" }> =>
      job.status === "processing" && job.stage === "applying"
  );
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: legacy.bundleId,
    revision: legacy.revision,
    control: legacy.control,
    jobs: legacy.jobs,
    reruns: legacy.reruns,
    sourceHighWatermarks: deriveLegacySourceHighWatermarks(legacy),
    pendingReviews: deriveLegacyPendingReviews(legacy.jobs, 1),
    reviewRejections: [],
    ...(applying
      ? {
          applyClaim: {
            jobId: applying.id,
            sourceId: applying.sourceId,
            sourceContentHash: applying.sourceContentHash,
            pipelineFingerprint: applying.pipelineFingerprint,
            inputRevision: applying.inputRevision,
            attempt: applying.attempt,
            startedAt: applying.startedAt,
          },
        }
      : {}),
  };
}

/**
 * Converts one strictly parsed version-2 snapshot into detached version-4 state.
 *
 * Version 2 predates durable review rejection identity, so migration starts
 * that append-only audit collection empty without inferring prior decisions.
 *
 * @param legacy - Valid version-2 persisted queue
 * @returns Equivalent version-4 queue
 */
function migrateVersionTwoSnapshot(legacy: LegacyIngestQueueSnapshotV2): IngestQueueSnapshot {
  return {
    ...legacy,
    version: INGEST_QUEUE_VERSION,
    pendingReviews: deriveLegacyPendingReviews(legacy.jobs, 2),
    reviewRejections: [],
    ...(legacy.applyClaim?.reviewedChangeSet
      ? {
          applyClaim: {
            ...legacy.applyClaim,
            legacyReview: { kind: "legacy_unverified" as const, migratedFromVersion: 2 as const },
          },
        }
      : {}),
  };
}

/**
 * Converts one strictly parsed version-3 snapshot into detached version-4 state.
 *
 * A reviewed apply already in progress cannot be bound to a final Manifest
 * intent from version-3 bytes. Migration therefore preserves its ChangeSet
 * identity but marks the review authorization as explicitly unverified.
 *
 * @param legacy - Valid version-3 persisted queue
 * @returns Equivalent version-4 queue with fail-closed reviewed apply provenance
 */
function migrateVersionThreeSnapshot(
  legacy: LegacyIngestQueueSnapshotV3
): IngestQueueSnapshot | null {
  const { applyClaim, ...snapshot } = legacy;
  if (applyClaim) {
    const hasReviewedChangeSet = applyClaim.reviewedChangeSet !== undefined;
    const hasAcceptedReview = applyClaim.acceptedReview !== undefined;
    const hasLegacyReview = applyClaim.legacyReview !== undefined;
    const isDirectClaim = !hasReviewedChangeSet && !hasAcceptedReview && !hasLegacyReview;
    const isDurableReviewedClaim = hasReviewedChangeSet && hasAcceptedReview && !hasLegacyReview;
    const isLegacyReviewedClaim =
      hasReviewedChangeSet &&
      !hasAcceptedReview &&
      hasLegacyReview &&
      applyClaim.legacyReview?.migratedFromVersion === 2;
    if (!isDirectClaim && !isDurableReviewedClaim && !isLegacyReviewedClaim) {
      return null;
    }
    const owningJob = legacy.jobs.find((job) => job.id === applyClaim.jobId);
    if (
      isDurableReviewedClaim &&
      applyClaim.acceptedReview &&
      owningJob &&
      (applyClaim.acceptedReview.acceptedAt < owningJob.createdAt ||
        applyClaim.acceptedReview.acceptedAt > applyClaim.startedAt)
    ) {
      return null;
    }
  }
  return {
    ...snapshot,
    version: INGEST_QUEUE_VERSION,
    ...(applyClaim === undefined
      ? {}
      : applyClaim.reviewedChangeSet
        ? {
            applyClaim: {
              jobId: applyClaim.jobId,
              sourceId: applyClaim.sourceId,
              sourceContentHash: applyClaim.sourceContentHash,
              pipelineFingerprint: applyClaim.pipelineFingerprint,
              inputRevision: applyClaim.inputRevision,
              attempt: applyClaim.attempt,
              startedAt: applyClaim.startedAt,
              reviewedChangeSet: { ...applyClaim.reviewedChangeSet },
              legacyReview:
                applyClaim.legacyReview === undefined
                  ? { kind: "legacy_unverified", migratedFromVersion: 3 }
                  : { ...applyClaim.legacyReview },
            },
          }
        : {
            applyClaim: {
              jobId: applyClaim.jobId,
              sourceId: applyClaim.sourceId,
              sourceContentHash: applyClaim.sourceContentHash,
              pipelineFingerprint: applyClaim.pipelineFingerprint,
              inputRevision: applyClaim.inputRevision,
              attempt: applyClaim.attempt,
              startedAt: applyClaim.startedAt,
            },
          }),
  };
}

/**
 * Maps strict schema issues to stable public knowledge diagnostics.
 *
 * @param issues - Zod issues emitted by the selected persisted version schema
 * @returns Stable structural diagnostics
 */
function mapSchemaIssues(issues: z.ZodIssue[]): KnowledgeDiagnostic[] {
  return issues.map((issue) => ({
    code: `schema_${issue.code}`,
    severity: "error",
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
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
  if (isLegacyVersionOneSnapshot(value)) {
    const legacyResult = legacyIngestQueueSnapshotSchema.safeParse(value);
    if (legacyResult.success) {
      return { ok: true, value: migrateVersionOneSnapshot(legacyResult.data) };
    }
    return { ok: false, issues: mapSchemaIssues(legacyResult.error.issues) };
  }

  if (isLegacyVersionTwoSnapshot(value)) {
    const legacyResult = legacyIngestQueueSnapshotV2Schema.safeParse(value);
    if (legacyResult.success) {
      return { ok: true, value: migrateVersionTwoSnapshot(legacyResult.data) };
    }
    return { ok: false, issues: mapSchemaIssues(legacyResult.error.issues) };
  }

  if (isLegacyVersionThreeSnapshot(value)) {
    const legacyResult = legacyIngestQueueSnapshotV3Schema.safeParse(value);
    if (legacyResult.success) {
      const migrated = migrateVersionThreeSnapshot(legacyResult.data);
      if (migrated) {
        return { ok: true, value: migrated };
      }
      return {
        ok: false,
        issues: [
          {
            code: "queue_v3_review_authorization_invalid",
            severity: "error",
            field: "applyClaim",
            message: "Version-3 reviewed apply authority cannot be migrated safely",
          },
        ],
      };
    }
    return { ok: false, issues: mapSchemaIssues(legacyResult.error.issues) };
  }

  const result = ingestQueueSnapshotSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: mapSchemaIssues(result.error.issues),
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
 * Compares every immutable queue-job field retained by an apply claim marker.
 *
 * @param claim - Interrupted or committed apply identity
 * @param job - Durable queue job expected to own the claim
 * @returns Whether the marker belongs to the exact job input and attempt
 */
function applyClaimMatchesJob(claim: IngestApplyJobClaim, job: KnowledgeIngestJob): boolean {
  return (
    claim.jobId === job.id &&
    claim.sourceId === job.sourceId &&
    claim.sourceContentHash === job.sourceContentHash &&
    claim.pipelineFingerprint === job.pipelineFingerprint &&
    claim.inputRevision === job.inputRevision &&
    claim.attempt === job.attempt
  );
}

/**
 * Compares the content and pipeline represented by two source observations.
 *
 * @param left - First source payload identity
 * @param right - Second source payload identity
 * @returns Whether both observations describe identical compile input
 */
function sourcePayloadMatches(
  left: Pick<IngestSourceHighWatermark, "sourceContentHash" | "pipelineFingerprint">,
  right: Pick<IngestSourceHighWatermark, "sourceContentHash" | "pipelineFingerprint">
): boolean {
  return (
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint
  );
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
  const highWatermarkSourceIds = new Set<string>();
  const pendingReviewJobIds = new Set<string>();
  const pendingReviewChangeSetIds = new Set<string>();
  const rejectedJobIds = new Set<string>();
  const rejectedChangeSetIds = new Set<string>();
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

  snapshot.pendingReviews.forEach((pendingReview, index) => {
    const field = `pendingReviews.${index}`;
    if (pendingReviewJobIds.has(pendingReview.jobId)) {
      addError(
        diagnostics,
        "queue_pending_review_job_duplicate",
        `${field}.jobId`,
        "A queue job may own only one pending review anchor"
      );
    }
    pendingReviewJobIds.add(pendingReview.jobId);
    if (pendingReviewChangeSetIds.has(pendingReview.changeSetId)) {
      addError(
        diagnostics,
        "queue_pending_review_changeset_duplicate",
        `${field}.changeSetId`,
        "A ChangeSet may be pending for only one queue job"
      );
    }
    pendingReviewChangeSetIds.add(pendingReview.changeSetId);

    const job = snapshot.jobs.find((candidate) => candidate.id === pendingReview.jobId);
    if (job?.status !== "awaiting_review") {
      addError(
        diagnostics,
        "queue_pending_review_job_invalid",
        `${field}.jobId`,
        "A pending review anchor must belong to one awaiting-review queue job"
      );
      return;
    }
    if (job.changeSetId !== pendingReview.changeSetId) {
      addError(
        diagnostics,
        "queue_pending_review_changeset_mismatch",
        `${field}.changeSetId`,
        "Pending review identity must match its awaiting-review queue job"
      );
    }
    if (
      pendingReview.kind === "durable" &&
      (pendingReview.recordedAt < job.createdAt || pendingReview.recordedAt > job.updatedAt)
    ) {
      addError(
        diagnostics,
        "queue_pending_review_timestamp_invalid",
        `${field}.recordedAt`,
        "Pending review persistence must occur during the owning queue job lifetime"
      );
    }
  });

  snapshot.jobs.forEach((job, index) => {
    if (job.status === "awaiting_review" && !pendingReviewJobIds.has(job.id)) {
      addError(
        diagnostics,
        "queue_pending_review_missing",
        `jobs.${index}.changeSetId`,
        "An awaiting-review job requires a durable or explicit legacy review anchor"
      );
    }
  });

  snapshot.reviewRejections.forEach((rejection, index) => {
    const field = `reviewRejections.${index}`;
    if (rejectedJobIds.has(rejection.jobId)) {
      addError(
        diagnostics,
        "queue_review_rejection_job_duplicate",
        `${field}.jobId`,
        "A queue job may retain only one durable review rejection"
      );
    }
    rejectedJobIds.add(rejection.jobId);
    if (rejectedChangeSetIds.has(rejection.changeSetId)) {
      addError(
        diagnostics,
        "queue_review_rejection_changeset_duplicate",
        `${field}.changeSetId`,
        "A ChangeSet may be rejected by only one durable queue job"
      );
    }
    rejectedChangeSetIds.add(rejection.changeSetId);

    const job = snapshot.jobs.find((candidate) => candidate.id === rejection.jobId);
    if (!job || job.status !== "cancelled" || job.attempt < 1) {
      addError(
        diagnostics,
        "queue_review_rejection_job_invalid",
        `${field}.jobId`,
        "A review rejection must reference one completed-attempt cancelled job"
      );
      return;
    }
    if (rejection.rejectedAt !== job.cancelledAt) {
      addError(
        diagnostics,
        "queue_review_rejection_timestamp_mismatch",
        `${field}.rejectedAt`,
        "Review rejection time must match its cancelled queue job"
      );
    }
    if (rejection.decisionAt > rejection.rejectedAt) {
      addError(
        diagnostics,
        "queue_review_rejection_decision_time_invalid",
        `${field}.decisionAt`,
        "Durable review decision time cannot follow its queue cancellation"
      );
    }
    if (rejection.decisionAt < job.createdAt) {
      addError(
        diagnostics,
        "queue_review_rejection_decision_time_invalid",
        `${field}.decisionAt`,
        "Durable review decision time cannot precede its queue job"
      );
    }
    const conflictingJob = snapshot.jobs.find(
      (candidate) =>
        candidate.id !== job.id &&
        (candidate.status === "awaiting_review" || candidate.status === "completed") &&
        candidate.changeSetId === rejection.changeSetId
    );
    if (conflictingJob) {
      addError(
        diagnostics,
        "queue_review_rejection_changeset_conflict",
        `${field}.changeSetId`,
        "A rejected ChangeSet cannot belong to another durable queue job"
      );
    }
    if (snapshot.applyClaim?.reviewedChangeSet?.changeSetId === rejection.changeSetId) {
      addError(
        diagnostics,
        "queue_review_rejection_apply_conflict",
        `${field}.changeSetId`,
        "A rejected ChangeSet cannot also own the active apply claim"
      );
    }
    if (pendingReviewChangeSetIds.has(rejection.changeSetId)) {
      addError(
        diagnostics,
        "queue_review_rejection_pending_conflict",
        `${field}.changeSetId`,
        "A rejected ChangeSet cannot remain in pending review state"
      );
    }
  });

  if (snapshot.applyClaim) {
    const { acceptedReview, legacyReview, reviewedChangeSet } = snapshot.applyClaim;
    if (reviewedChangeSet && pendingReviewChangeSetIds.has(reviewedChangeSet.changeSetId)) {
      addError(
        diagnostics,
        "queue_apply_claim_pending_review_conflict",
        "applyClaim.reviewedChangeSet.changeSetId",
        "A ChangeSet cannot be both pending review and actively applying"
      );
    }
    if ((acceptedReview || legacyReview) && !reviewedChangeSet) {
      addError(
        diagnostics,
        "queue_apply_claim_review_payload_missing",
        "applyClaim.reviewedChangeSet",
        "Review authorization requires the exact reviewed ChangeSet payload"
      );
    }
    if (reviewedChangeSet && !acceptedReview && !legacyReview) {
      addError(
        diagnostics,
        "queue_apply_claim_review_authorization_missing",
        "applyClaim.reviewedChangeSet",
        "A reviewed ChangeSet requires a durable decision or explicit legacy provenance"
      );
    }
    if (acceptedReview && legacyReview) {
      addError(
        diagnostics,
        "queue_apply_claim_review_authorization_conflict",
        "applyClaim",
        "A review apply claim cannot be both durable and legacy-unverified"
      );
    }
    if (acceptedReview && acceptedReview.acceptedAt > snapshot.applyClaim.startedAt) {
      addError(
        diagnostics,
        "queue_apply_claim_review_time_invalid",
        "applyClaim.acceptedReview.acceptedAt",
        "A durable review decision cannot follow the apply claim start"
      );
    }
  }

  if (processingCount > 1) {
    addError(
      diagnostics,
      "queue_processing_count_invalid",
      "jobs",
      "A Bundle queue may persist at most one processing job"
    );
  }

  snapshot.sourceHighWatermarks.forEach((highWatermark, index) => {
    const field = `sourceHighWatermarks.${index}`;
    if (highWatermarkSourceIds.has(highWatermark.sourceId)) {
      addError(
        diagnostics,
        "queue_source_high_watermark_duplicate",
        `${field}.sourceId`,
        "A source may retain exactly one durable observation high-watermark"
      );
    }
    highWatermarkSourceIds.add(highWatermark.sourceId);

    const sourceJobs = snapshot.jobs.filter((job) => job.sourceId === highWatermark.sourceId);
    const sourceReruns = snapshot.reruns.filter(
      (rerun) => rerun.sourceId === highWatermark.sourceId
    );
    if (sourceJobs.length === 0 && sourceReruns.length === 0) {
      addError(
        diagnostics,
        "queue_source_high_watermark_orphaned",
        field,
        "A source high-watermark must retain related queue history"
      );
    }
    for (const record of [...sourceJobs, ...sourceReruns]) {
      if (record.inputRevision > highWatermark.inputRevision) {
        addError(
          diagnostics,
          "queue_source_high_watermark_behind",
          `${field}.inputRevision`,
          "A source high-watermark cannot precede a durable job or rerun observation"
        );
      } else if (
        record.inputRevision === highWatermark.inputRevision &&
        !sourcePayloadMatches(record, highWatermark)
      ) {
        addError(
          diagnostics,
          "queue_source_high_watermark_payload_mismatch",
          field,
          "Equal source revisions must retain identical content and pipeline identity"
        );
      }
    }
  });

  for (const sourceId of new Set([
    ...snapshot.jobs.map((job) => job.sourceId),
    ...snapshot.reruns.map((rerun) => rerun.sourceId),
  ])) {
    if (!highWatermarkSourceIds.has(sourceId)) {
      addError(
        diagnostics,
        "queue_source_high_watermark_missing",
        "sourceHighWatermarks",
        "Every durable source record requires one observation high-watermark"
      );
    }
  }

  for (const active of snapshot.jobs.filter((job) => isActiveJob(job))) {
    const highWatermark = snapshot.sourceHighWatermarks.find(
      (candidate) => candidate.sourceId === active.sourceId
    );
    if (
      highWatermark &&
      highWatermark.inputRevision > active.inputRevision &&
      !sourcePayloadMatches(highWatermark, active)
    ) {
      const exactRerun = snapshot.reruns.some(
        (rerun) =>
          rerun.sourceId === highWatermark.sourceId &&
          rerun.inputRevision === highWatermark.inputRevision &&
          sourcePayloadMatches(rerun, highWatermark)
      );
      if (!exactRerun) {
        addError(
          diagnostics,
          "queue_source_high_watermark_rerun_missing",
          "sourceHighWatermarks",
          "A newer divergent source high-watermark requires its exact latest rerun"
        );
      }
    }
  }

  const failedApplyingJobs = snapshot.jobs.filter(
    (job) => job.status === "failed" && job.stage === "applying"
  );
  const applyingJobs = snapshot.jobs.filter(
    (job) => (job.status === "processing" || job.status === "failed") && job.stage === "applying"
  );
  const hasApplyRecoveryFailure = failedApplyingJobs.length > 0;
  if (applyingJobs.length > 1) {
    addError(
      diagnostics,
      "queue_apply_recovery_job_count_invalid",
      "jobs",
      "A Bundle queue may retain at most one active or interrupted applying job"
    );
  }
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
  if (snapshot.applyClaim && applyingJobs.length === 0) {
    addError(
      diagnostics,
      "queue_apply_claim_job_missing",
      "applyClaim",
      "An apply claim marker requires one active or interrupted applying job"
    );
  }
  if (applyingJobs.length > 0 && !snapshot.applyClaim) {
    addError(
      diagnostics,
      "queue_apply_claim_marker_missing",
      "applyClaim",
      "Every active or interrupted apply must retain its exact claim"
    );
  }
  if (snapshot.applyClaim) {
    const claim = snapshot.applyClaim;
    const owningJob = applyingJobs.find((job) => job.id === claim.jobId);
    if (!owningJob || !applyClaimMatchesJob(claim, owningJob)) {
      addError(
        diagnostics,
        "queue_apply_claim_job_mismatch",
        "applyClaim",
        "Apply claim marker must identify the exact applying job"
      );
    } else if (
      claim.startedAt < owningJob.createdAt ||
      claim.startedAt > owningJob.updatedAt ||
      (owningJob.status === "processing" && claim.startedAt !== owningJob.startedAt)
    ) {
      addError(
        diagnostics,
        "queue_apply_claim_timestamp_invalid",
        "applyClaim.startedAt",
        "Apply claim start must exactly identify active work or its interrupted lifetime"
      );
    }
    if (
      owningJob &&
      claim.acceptedReview &&
      claim.acceptedReview.acceptedAt < owningJob.createdAt
    ) {
      addError(
        diagnostics,
        "queue_apply_claim_review_time_invalid",
        "applyClaim.acceptedReview.acceptedAt",
        "A durable review decision cannot precede its queue job"
      );
    }
  }

  const hasCommitPendingAckGate =
    snapshot.control.status === "paused" && snapshot.control.reason === "commit_pending_ack";
  if (snapshot.applyCommit && !hasCommitPendingAckGate) {
    addError(
      diagnostics,
      "queue_apply_commit_gate_missing",
      "control",
      "A durable apply-commit marker requires a commit-pending-ack pause gate"
    );
  }
  if (hasCommitPendingAckGate && !snapshot.applyCommit) {
    addError(
      diagnostics,
      "queue_apply_commit_marker_missing",
      "applyCommit",
      "A commit-pending-ack pause gate requires its durable apply-commit marker"
    );
  }
  if (snapshot.applyCommit) {
    const marker = snapshot.applyCommit;
    const owningJob = snapshot.jobs.find((job) => job.id === marker.jobId);
    if (marker.startedAt > marker.committedAt) {
      addError(
        diagnostics,
        "queue_apply_commit_started_timestamp_invalid",
        "applyCommit.startedAt",
        "Apply attempt cannot start after its durable file commit"
      );
    }
    if (
      !owningJob ||
      owningJob.status !== "completed" ||
      !applyClaimMatchesJob(marker, owningJob)
    ) {
      addError(
        diagnostics,
        "queue_apply_commit_job_invalid",
        "applyCommit.jobId",
        "Apply-commit marker must reference one completed queue job"
      );
    } else {
      if (marker.changeSetId !== owningJob.changeSetId) {
        addError(
          diagnostics,
          "queue_apply_commit_changeset_mismatch",
          "applyCommit.changeSetId",
          "Apply-commit marker ChangeSet must match its completed queue job"
        );
      }
      if (marker.startedAt < owningJob.createdAt) {
        addError(
          diagnostics,
          "queue_apply_commit_started_timestamp_invalid",
          "applyCommit.startedAt",
          "Apply attempt must start after job creation and no later than its commit"
        );
      }
      if (marker.committedAt > owningJob.completedAt) {
        addError(
          diagnostics,
          "queue_apply_commit_committed_timestamp_invalid",
          "applyCommit.committedAt",
          "File commit must complete no later than queue-job completion"
        );
      }
    }
    if (
      hasCommitPendingAckGate &&
      snapshot.control.status === "paused" &&
      snapshot.control.pausedAt < marker.committedAt
    ) {
      addError(
        diagnostics,
        "queue_apply_commit_pause_timestamp_invalid",
        "control.pausedAt",
        "Commit acknowledgement gate cannot precede the durable file commit"
      );
    }
    if (hasApplyRecoveryFailure) {
      addError(
        diagnostics,
        "queue_apply_commit_recovery_conflict",
        "applyCommit",
        "An acknowledged file commit cannot coexist with a failed applying job"
      );
    }
    if (snapshot.applyClaim) {
      addError(
        diagnostics,
        "queue_apply_commit_claim_conflict",
        "applyClaim",
        "Committed and unacknowledged apply claim markers cannot coexist"
      );
    }
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
    const highWatermark = snapshot.sourceHighWatermarks.find(
      (candidate) => candidate.sourceId === rerun.sourceId
    );
    if (
      highWatermark &&
      (rerun.inputRevision !== highWatermark.inputRevision ||
        !sourcePayloadMatches(rerun, highWatermark))
    ) {
      addError(
        diagnostics,
        "queue_rerun_not_latest_observation",
        field,
        "A retained rerun must exactly represent its source's latest observation"
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
