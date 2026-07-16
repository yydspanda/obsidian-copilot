import { Mutex } from "async-mutex";

import type {
  KnowledgeDiagnostic,
  KnowledgeFailure,
  KnowledgeIngestJob,
} from "@/knowledge/model/types";
import type { KnowledgeIngestWorkStage } from "@/knowledge/model/types";
import {
  ExponentialRetryPolicy,
  type RetryDecision,
  type RetryPolicy,
} from "@/knowledge/ingest/queue/RetryPolicy";
import {
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  type IngestQueuePauseReason,
  type IngestQueueSnapshot,
  type IngestRerunRequest,
  type QueueStorage,
  validateIngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";

const DEFAULT_MAX_WRITE_ATTEMPTS = 3;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FAILURE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;
const SENSITIVE_FAILURE_PATTERN =
  /(?:\bbearer\s+[a-z0-9._~-]{8,}|\bsk-[a-z0-9_-]{8,}|(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+)/i;
const WORK_STAGE_ORDER: readonly KnowledgeIngestWorkStage[] = [
  "parsing",
  "analyzing",
  "associating",
  "generating",
  "validating",
  "applying",
];

type ProcessingIngestJob = Extract<KnowledgeIngestJob, { status: "processing" }>;
type ExecutedJobStatus = Extract<RunNextResult, { kind: "executed" }>["status"];

/** Input required to enqueue one exact source and pipeline version. */
export interface EnqueueIngestRequest {
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  /** Durable, per-source monotonic revision allocated before enqueue. */
  inputRevision: number;
}

/** Observable result of durable source-level enqueue deduplication. */
export interface EnqueueIngestResult {
  kind: "enqueued" | "deduplicated" | "updated" | "rerun_scheduled";
  job: KnowledgeIngestJob;
}

/** Successful executor outcome that either waits for review or commits directly. */
export type IngestExecutionResult =
  | { kind: "awaiting_review"; changeSetId: string }
  | { kind: "completed"; changeSetId: string };

/** Context passed to a provider-neutral ingest executor. */
export interface IngestExecutionContext {
  job: Readonly<ProcessingIngestJob>;
  signal: AbortSignal;
  reportStage(stage: KnowledgeIngestWorkStage): Promise<void>;
}

/** Provider-neutral port that performs one already-claimed ingest job. */
export interface IngestExecutor {
  /**
   * Executes one job and cooperatively observes cancellation.
   *
   * @param context - Claimed job, abort signal, and durable stage reporter
   * @returns Review or committed completion outcome
   */
  execute(context: IngestExecutionContext): Promise<IngestExecutionResult>;
}

/** Serializable failure details deliberately supplied by an executor adapter. */
export interface IngestExecutorFailureDetails {
  code: string;
  message: string;
  retryable: boolean;
  rateLimited: boolean;
  retryAfterMs?: number;
}

/** Typed executor failure safe for retry classification and persistence. */
export class IngestExecutorError extends Error {
  /**
   * Creates a structured executor failure.
   *
   * @param details - Serializable failure and rate-limit metadata
   */
  constructor(public readonly details: IngestExecutorFailureDetails) {
    super(details.message);
    this.name = "IngestExecutorError";
  }
}

/** Cause attached to a post-commit queue notification. */
export type IngestQueueEventCause =
  | "enqueue"
  | "deduplicate"
  | "source_update"
  | "rerun_scheduled"
  | "claim"
  | "stage"
  | "retry"
  | "rate_limit"
  | "failure"
  | "awaiting_review"
  | "complete"
  | "pause"
  | "resume"
  | "cancel"
  | "recover";

/** Best-effort notification emitted only after durable state is known. */
export interface IngestQueueEvent {
  type: "queue_changed";
  cause: IngestQueueEventCause;
  bundleId: string;
  revision: number;
  jobId?: string;
}

/** Non-authoritative notification port for future UI and activity surfaces. */
export interface EventSink {
  /**
   * Observes a committed queue mutation without owning queue state.
   *
   * @param event - Post-commit reload hint
   */
  emit(event: IngestQueueEvent): void | Promise<void>;
}

/** Queue construction dependencies with deterministic test seams. */
export interface IngestQueueOptions {
  clock?: () => number;
  jobIdFactory?: () => string;
  retryPolicy?: RetryPolicy;
  eventSink?: EventSink;
  maxWriteAttempts?: number;
}

/** Result returned when the queue attempts to execute one eligible job. */
export type RunNextResult =
  | { kind: "idle" }
  | { kind: "paused"; reason: IngestQueuePauseReason }
  | { kind: "waiting"; nextAttemptAt: number }
  | { kind: "busy"; jobId: string }
  | { kind: "stale"; jobId: string }
  | {
      kind: "executed";
      jobId: string;
      status: "pending" | "paused" | "awaiting_review" | "failed" | "completed" | "cancelled";
    };

/** Reports persisted queue JSON that cannot satisfy the current contract. */
export class IngestQueueValidationError extends Error {
  /**
   * Creates a queue validation failure without retaining raw persisted data.
   *
   * @param bundleId - Bundle whose queue failed validation
   * @param diagnostics - Stable structural or semantic issues
   */
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`Ingest queue '${bundleId}' does not satisfy the current contract`);
    this.name = "IngestQueueValidationError";
  }
}

/** Reports a persisted queue version that this runtime cannot safely read. */
export class IngestQueueIncompatibleVersionError extends Error {
  /**
   * Creates an incompatible queue version failure.
   *
   * @param bundleId - Bundle whose queue uses an unsupported version
   * @param version - Unknown persisted version value
   */
  constructor(
    public readonly bundleId: string,
    public readonly version: unknown
  ) {
    super(`Ingest queue '${bundleId}' uses an unsupported version`);
    this.name = "IngestQueueIncompatibleVersionError";
  }
}

/** Reports a storage key whose queue claims to belong to another Bundle. */
export class IngestQueueBundleMismatchError extends Error {
  /**
   * Creates a Bundle identity mismatch.
   *
   * @param requestedBundleId - Bundle used to read storage
   * @param storedBundleId - Bundle declared by persisted queue state
   */
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`Ingest queue stored for '${requestedBundleId}' belongs to '${storedBundleId}'`);
    this.name = "IngestQueueBundleMismatchError";
  }
}

/** Reports a queue revision that cannot advance without precision loss. */
export class IngestQueueRevisionOverflowError extends Error {
  /**
   * Creates a safe-integer revision overflow failure.
   *
   * @param bundleId - Bundle whose revision reached the safe integer limit
   * @param revision - Last safely represented revision
   */
  constructor(
    public readonly bundleId: string,
    public readonly revision: number
  ) {
    super(`Ingest queue '${bundleId}' cannot advance beyond revision ${revision}`);
    this.name = "IngestQueueRevisionOverflowError";
  }
}

/** Reports optimistic write conflicts that exceeded bounded retries. */
export class IngestQueueWriteConflictExhaustedError extends Error {
  /**
   * Creates an exhausted queue write conflict.
   *
   * @param bundleId - Bundle whose queue could not converge
   * @param attempts - Attempted read-transform-write cycles
   * @param conflict - Last observed storage conflict
   */
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: IngestQueueRevisionConflictError
  ) {
    super(`Ingest queue '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "IngestQueueWriteConflictExhaustedError";
  }
}

/** Reports an operation targeting an unknown durable job id. */
export class IngestQueueJobNotFoundError extends Error {
  /**
   * Creates a missing queue job failure.
   *
   * @param bundleId - Bundle expected to contain the job
   * @param jobId - Missing job identifier
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Job '${jobId}' is not present in Bundle queue '${bundleId}'`);
    this.name = "IngestQueueJobNotFoundError";
  }
}

/** Reports a fail-closed illegal queue state transition. */
export class IngestQueueTransitionError extends Error {
  /**
   * Creates an illegal state transition failure.
   *
   * @param jobId - Durable job identifier
   * @param from - Current persisted status and stage
   * @param action - Rejected operation
   */
  constructor(
    public readonly jobId: string,
    public readonly from: string,
    public readonly action: string
  ) {
    super(`Job '${jobId}' cannot ${action} from '${from}'`);
    this.name = "IngestQueueTransitionError";
  }
}

/** Reports a non-empty id factory collision with persisted queue history. */
export class IngestQueueJobIdConflictError extends Error {
  /**
   * Creates a generated job id collision.
   *
   * @param bundleId - Bundle containing the conflicting id
   * @param jobId - Generated duplicate id
   */
  constructor(
    public readonly bundleId: string,
    public readonly jobId: string
  ) {
    super(`Generated job id '${jobId}' already exists in Bundle queue '${bundleId}'`);
    this.name = "IngestQueueJobIdConflictError";
  }
}

/** Reports distinct source inputs that claim the same monotonic input revision. */
export class IngestQueueObservationConflictError extends Error {
  /**
   * Creates an unordered same-time source observation conflict.
   *
   * @param bundleId - Bundle containing the source
   * @param sourceId - Stable source identifier
   * @param inputRevision - Source revision shared by different exact inputs
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly inputRevision: number
  ) {
    super(`Source '${sourceId}' has conflicting queue inputs at revision ${inputRevision}`);
    this.name = "IngestQueueObservationConflictError";
  }
}

/** Reports a queue blocked on a future recoverable apply transaction. */
export class IngestQueueRecoveryRequiredError extends Error {
  /**
   * Creates a recovery-required queue gate failure.
   *
   * @param bundleId - Bundle whose interrupted apply is not safe to resume
   */
  constructor(public readonly bundleId: string) {
    super(`Bundle queue '${bundleId}' requires apply transaction recovery before resume`);
    this.name = "IngestQueueRecoveryRequiredError";
  }
}

/** Reports queue persistence failures separately from executor failures. */
export class IngestQueueInfrastructureError extends Error {
  /**
   * Creates an infrastructure boundary failure that must not be persisted as a provider error.
   *
   * @param operation - Queue infrastructure operation that failed
   * @param cause - Original storage, validation, or concurrency error
   */
  constructor(
    public readonly operation: string,
    public readonly cause: unknown
  ) {
    super(`Ingest queue infrastructure failed during ${operation}`);
    this.name = "IngestQueueInfrastructureError";
  }
}

interface LoadedQueue {
  snapshot: IngestQueueSnapshot;
  expectedRevision: number | null;
}

interface QueueMutation<T> {
  next?: IngestQueueSnapshot;
  value: T;
}

interface MutationResult<T> {
  snapshot: IngestQueueSnapshot;
  value: T;
}

interface ClaimedJobResult {
  kind: "claimed" | "idle" | "paused" | "waiting" | "busy";
  jobId?: string;
  reason?: IngestQueuePauseReason;
  nextAttemptAt?: number;
}

interface EnqueueMutationValue {
  kind: EnqueueIngestResult["kind"];
  jobId: string;
}

interface PauseMutationValue {
  changed: boolean;
  pausedJobId?: string;
}

interface FailureMutationValue {
  changed: boolean;
  cause: IngestQueueEventCause;
}

interface ActiveController {
  jobId: string;
  attempt: number;
  startedAt: number;
  controller: AbortController;
}

/**
 * Checks whether an unknown value is a non-null record.
 *
 * @param value - Runtime value to inspect
 * @returns Whether fields can be read safely
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a job remains eligible for source-level deduplication.
 *
 * @param job - Durable queue job
 * @returns Whether the job is non-terminal
 */
function isActiveJob(job: KnowledgeIngestJob): boolean {
  return !["failed", "completed", "cancelled"].includes(job.status);
}

/**
 * Returns a stable status/stage label for transition errors.
 *
 * @param job - Durable queue job
 * @returns Combined state label
 */
function jobState(job: KnowledgeIngestJob): string {
  return `${job.status}/${job.stage}`;
}

/**
 * Checks whether processing state still belongs to one exact claimed execution.
 *
 * Attempt is incremented on every durable claim, so it prevents a late result
 * from an aborted predecessor from finalizing a subsequently resumed attempt.
 *
 * @param job - Current durable job state
 * @param attempt - Completed-execution count captured at claim time
 * @param startedAt - Start timestamp captured at claim time
 * @returns Whether the current processing state is the same claim
 */
function isSameClaim(
  job: KnowledgeIngestJob,
  attempt: number,
  startedAt: number
): job is ProcessingIngestJob {
  return job.status === "processing" && job.attempt === attempt && job.startedAt === startedAt;
}

/**
 * Finds a durable job or throws a typed not-found error.
 *
 * @param snapshot - Current validated queue snapshot
 * @param jobId - Stable job identifier
 * @returns Matching durable job
 */
function requireJob(snapshot: IngestQueueSnapshot, jobId: string): KnowledgeIngestJob {
  const job = snapshot.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    throw new IngestQueueJobNotFoundError(snapshot.bundleId, jobId);
  }
  return job;
}

/**
 * Replaces one durable job without mutating the parsed snapshot.
 *
 * @param snapshot - Current validated queue snapshot
 * @param nextJob - Complete replacement job
 * @returns Immutable queue proposal
 */
function replaceJob(
  snapshot: IngestQueueSnapshot,
  nextJob: KnowledgeIngestJob
): IngestQueueSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => (job.id === nextJob.id ? nextJob : job)),
  };
}

/**
 * Creates an empty, unpersisted Bundle queue.
 *
 * @param bundleId - Stable Bundle identifier
 * @returns Revision-zero running queue
 */
function createEmptyQueue(bundleId: string): IngestQueueSnapshot {
  return {
    version: 1,
    bundleId,
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
  };
}

/**
 * Checks whether a job matches one exact source and pipeline input.
 *
 * @param job - Durable queue job
 * @param request - Requested source input
 * @returns Whether both behavior-defining hashes match
 */
function jobMatchesRequest(job: KnowledgeIngestJob, request: EnqueueIngestRequest): boolean {
  return (
    job.sourceContentHash === request.sourceContentHash &&
    job.pipelineFingerprint === request.pipelineFingerprint
  );
}

/**
 * Checks whether a rerun payload matches one exact source and pipeline input.
 *
 * @param rerun - Durable latest rerun request
 * @param request - Requested source input
 * @returns Whether both behavior-defining hashes match
 */
function rerunMatchesRequest(rerun: IngestRerunRequest, request: EnqueueIngestRequest): boolean {
  return (
    rerun.sourceContentHash === request.sourceContentHash &&
    rerun.pipelineFingerprint === request.pipelineFingerprint
  );
}

/**
 * Converts a reserved rerun payload into one new pending job.
 *
 * @param bundleId - Containing Bundle identity
 * @param rerun - Latest durable rerun input
 * @param timestamp - Non-regressing promotion timestamp
 * @returns Pending job with a fresh attempt budget
 */
function createJobFromRerun(
  bundleId: string,
  rerun: IngestRerunRequest,
  timestamp: number
): KnowledgeIngestJob {
  return {
    id: rerun.jobId,
    bundleId,
    sourceId: rerun.sourceId,
    sourceContentHash: rerun.sourceContentHash,
    pipelineFingerprint: rerun.pipelineFingerprint,
    inputRevision: rerun.inputRevision,
    attempt: 0,
    rerunRequested: false,
    createdAt: rerun.requestedAt,
    updatedAt: Math.max(timestamp, rerun.updatedAt),
    status: "pending",
    stage: "queued",
  };
}

/**
 * Promotes a latest rerun payload after its predecessor becomes terminal.
 *
 * @param snapshot - Snapshot already containing the terminal predecessor
 * @param sourceId - Source whose rerun may be promoted
 * @param timestamp - Non-regressing promotion timestamp
 * @returns Queue with zero or one newly pending rerun job
 */
function promoteRerun(
  snapshot: IngestQueueSnapshot,
  sourceId: string,
  timestamp: number
): IngestQueueSnapshot {
  const rerun = snapshot.reruns.find((candidate) => candidate.sourceId === sourceId);
  if (!rerun) {
    return snapshot;
  }
  return {
    ...snapshot,
    jobs: [...snapshot.jobs, createJobFromRerun(snapshot.bundleId, rerun, timestamp)],
    reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== sourceId),
  };
}

/**
 * Requires a non-whitespace identifier at the queue boundary.
 *
 * @param value - Identifier supplied by orchestration
 * @param field - Field name used by the thrown error
 */
function assertIdentifier(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

/**
 * Requires a lowercase SHA-256 value at the queue boundary.
 *
 * @param value - Hash supplied by orchestration
 * @param field - Field name used by the thrown error
 */
function assertHash(value: string, field: string): void {
  if (!HASH_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`);
  }
}

/**
 * Adds a validated delay without exceeding JavaScript's exact integer range.
 *
 * @param timestamp - Non-negative safe-integer timestamp
 * @param delayMs - Non-negative safe-integer delay
 * @returns Saturated safe-integer timestamp
 */
function addSafeDelay(timestamp: number, delayMs: number): number {
  if (delayMs > Number.MAX_SAFE_INTEGER - timestamp) {
    return Number.MAX_SAFE_INTEGER;
  }
  return timestamp + delayMs;
}

/**
 * Persists and executes isolated durable ingest queues for knowledge Bundles.
 *
 * Storage CAS protects independent queue instances. Per-Bundle mutexes only
 * serialize operations within this object; executor work always runs outside
 * the mutex so user pause and cancellation remain responsive.
 */
export class IngestQueue {
  private readonly clock: () => number;
  private readonly jobIdFactory: () => string;
  private readonly retryPolicy: RetryPolicy;
  private readonly eventSink?: EventSink;
  private readonly maxWriteAttempts: number;
  private readonly bundleMutexes = new Map<string, Mutex>();
  private readonly activeControllers = new Map<string, ActiveController>();

  /**
   * Creates a queue over injected persistence and execution ports.
   *
   * @param storage - Complete queue snapshot persistence port
   * @param executor - Provider-neutral work executor
   * @param options - Deterministic clock, ids, retries, events, and CAS bound
   */
  constructor(
    private readonly storage: QueueStorage,
    private readonly executor: IngestExecutor,
    options: IngestQueueOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.jobIdFactory =
      options.jobIdFactory ??
      (() => {
        return crypto.randomUUID();
      });
    this.retryPolicy =
      options.retryPolicy ??
      new ExponentialRetryPolicy(
        {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          jitterRatio: 0.2,
        },
        Math.random
      );
    this.eventSink = options.eventSink;
    this.maxWriteAttempts = options.maxWriteAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxWriteAttempts) || this.maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive safe integer");
    }
  }

  /**
   * Loads and validates one Bundle queue without creating storage eagerly.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached persisted state or an empty revision-zero queue
   */
  async load(bundleId: string): Promise<IngestQueueSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedSnapshot(bundleId, loaded.snapshot);
  }

  /**
   * Enqueues one source version with source-level deduplication.
   *
   * Pending inputs are updated in place before their first execution. If an
   * older input is processing or awaiting review, only one latest rerun payload
   * is retained durably regardless of how many further source changes arrive.
   *
   * @param request - Exact source and pipeline input to schedule
   * @returns Durable enqueue, update, rerun, or deduplication result
   */
  async enqueue(request: EnqueueIngestRequest): Promise<EnqueueIngestResult> {
    this.assertEnqueueRequest(request);
    const timestamp = this.now();
    const reservedJobId = this.nextJobId();
    const mutation = await this.getBundleMutex(request.bundleId).runExclusive(async () => {
      return this.mutate<EnqueueMutationValue>(request.bundleId, (current) => {
        const active = current.jobs.find(
          (job) => isActiveJob(job) && job.sourceId === request.sourceId
        );
        if (!active) {
          this.assertJobIdAvailable(current, reservedJobId);
          const job: KnowledgeIngestJob = {
            id: reservedJobId,
            bundleId: request.bundleId,
            sourceId: request.sourceId,
            sourceContentHash: request.sourceContentHash,
            pipelineFingerprint: request.pipelineFingerprint,
            inputRevision: request.inputRevision,
            attempt: 0,
            rerunRequested: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            status: "pending",
            stage: "queued",
          };
          return {
            next: { ...current, jobs: [...current.jobs, job] },
            value: { kind: "enqueued" as const, jobId: job.id },
          };
        }

        const existingRerun = current.reruns.find((rerun) => rerun.sourceId === request.sourceId);
        const latestInputRevision = existingRerun?.inputRevision ?? active.inputRevision;
        const matchesLatestInput = existingRerun
          ? rerunMatchesRequest(existingRerun, request)
          : jobMatchesRequest(active, request);
        if (request.inputRevision < latestInputRevision) {
          return { value: { kind: "deduplicated" as const, jobId: active.id } };
        }
        if (request.inputRevision === latestInputRevision && !matchesLatestInput) {
          throw new IngestQueueObservationConflictError(
            request.bundleId,
            request.sourceId,
            request.inputRevision
          );
        }
        if (existingRerun !== undefined && rerunMatchesRequest(existingRerun, request)) {
          if (request.inputRevision === existingRerun.inputRevision) {
            return { value: { kind: "deduplicated" as const, jobId: active.id } };
          }
          return {
            next: {
              ...replaceJob(current, {
                ...active,
                updatedAt: Math.max(timestamp, active.updatedAt),
              }),
              reruns: current.reruns.map((rerun) =>
                rerun.sourceId === active.sourceId
                  ? {
                      ...rerun,
                      inputRevision: request.inputRevision,
                      updatedAt: Math.max(timestamp, rerun.updatedAt),
                    }
                  : rerun
              ),
            },
            value: { kind: "deduplicated" as const, jobId: active.id },
          };
        }
        if (jobMatchesRequest(active, request)) {
          if (!existingRerun) {
            if (request.inputRevision === active.inputRevision) {
              return { value: { kind: "deduplicated" as const, jobId: active.id } };
            }
            return {
              next: replaceJob(current, {
                ...active,
                inputRevision: request.inputRevision,
                updatedAt: Math.max(timestamp, active.updatedAt),
              }),
              value: { kind: "deduplicated" as const, jobId: active.id },
            };
          }
          return {
            next: {
              ...replaceJob(current, {
                ...active,
                inputRevision: request.inputRevision,
                rerunRequested: false,
                updatedAt: Math.max(timestamp, active.updatedAt),
              }),
              reruns: current.reruns.filter((rerun) => rerun.sourceId !== active.sourceId),
            },
            value: { kind: "updated" as const, jobId: active.id },
          };
        }

        if (
          (active.status === "pending" || active.status === "paused") &&
          existingRerun === undefined
        ) {
          const updatedAt = Math.max(timestamp, active.updatedAt);
          const nextJob: KnowledgeIngestJob = {
            id: active.id,
            bundleId: active.bundleId,
            sourceId: active.sourceId,
            sourceContentHash: request.sourceContentHash,
            pipelineFingerprint: request.pipelineFingerprint,
            inputRevision: request.inputRevision,
            attempt: 0,
            rerunRequested: false,
            createdAt: active.createdAt,
            updatedAt,
            status: "pending",
            stage: "queued",
          };
          return {
            next: replaceJob(current, nextJob),
            value: { kind: "updated" as const, jobId: active.id },
          };
        }

        const rerunJobId = existingRerun?.jobId ?? reservedJobId;
        if (!existingRerun) {
          this.assertJobIdAvailable(current, rerunJobId);
        }
        const rerun: IngestRerunRequest = {
          jobId: rerunJobId,
          sourceId: request.sourceId,
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
          inputRevision: request.inputRevision,
          requestedAt: existingRerun?.requestedAt ?? Math.max(timestamp, active.updatedAt),
          updatedAt: Math.max(timestamp, existingRerun?.updatedAt ?? active.updatedAt),
        };
        const nextJob: KnowledgeIngestJob = {
          ...active,
          rerunRequested: true,
          updatedAt: Math.max(timestamp, active.updatedAt),
        };
        return {
          next: {
            ...replaceJob(current, nextJob),
            reruns: existingRerun
              ? current.reruns.map((candidate) =>
                  candidate.sourceId === rerun.sourceId ? rerun : candidate
                )
              : [...current.reruns, rerun],
          },
          value: { kind: "rerun_scheduled" as const, jobId: active.id },
        };
      });
    });

    const job = requireJob(mutation.snapshot, mutation.value.jobId);
    const cause: IngestQueueEventCause =
      mutation.value.kind === "enqueued"
        ? "enqueue"
        : mutation.value.kind === "updated"
          ? "source_update"
          : mutation.value.kind === "rerun_scheduled"
            ? "rerun_scheduled"
            : "deduplicate";
    this.emit(mutation.snapshot, cause, job.id);
    return { kind: mutation.value.kind, job };
  }

  /**
   * Claims and executes at most one eligible job for a Bundle.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Queue availability or final durable status of the claimed job
   */
  async runNext(bundleId: string): Promise<RunNextResult> {
    assertIdentifier(bundleId, "bundleId");
    const claim = await this.claimNext(bundleId);
    if (claim.value.kind !== "claimed" || !claim.value.jobId) {
      if (claim.value.kind === "paused" && claim.value.reason) {
        return { kind: "paused", reason: claim.value.reason };
      }
      if (claim.value.kind === "waiting" && claim.value.nextAttemptAt !== undefined) {
        return { kind: "waiting", nextAttemptAt: claim.value.nextAttemptAt };
      }
      if (claim.value.kind === "busy" && claim.value.jobId) {
        return { kind: "busy", jobId: claim.value.jobId };
      }
      return { kind: "idle" };
    }

    const job = requireJob(claim.snapshot, claim.value.jobId);
    if (job.status !== "processing") {
      throw new IngestQueueTransitionError(job.id, jobState(job), "execute an unclaimed job");
    }
    const active = this.activeControllers.get(bundleId);
    if (
      !active ||
      active.jobId !== job.id ||
      active.attempt !== job.attempt ||
      active.startedAt !== job.startedAt
    ) {
      throw new IngestQueueTransitionError(job.id, jobState(job), "execute without a controller");
    }

    const executionJob = Object.freeze({ ...job });
    try {
      this.emit(claim.snapshot, "claim", executionJob.id);
      const beforeExecution = requireJob(await this.load(bundleId), executionJob.id);
      if (
        active.controller.signal.aborted ||
        !isSameClaim(beforeExecution, executionJob.attempt, executionJob.startedAt)
      ) {
        const status = this.toRunStatus(beforeExecution);
        return status === "stale"
          ? { kind: "stale", jobId: executionJob.id }
          : { kind: "executed", jobId: executionJob.id, status };
      }

      let result: IngestExecutionResult;
      try {
        result = await this.executor.execute({
          job: executionJob,
          signal: active.controller.signal,
          reportStage: async (stage) => {
            await this.reportStage(
              bundleId,
              executionJob.id,
              executionJob.attempt,
              executionJob.startedAt,
              stage,
              active.controller.signal
            );
          },
        });
        this.assertExecutionResult(result);
      } catch (error) {
        if (error instanceof IngestQueueInfrastructureError) {
          throw error;
        }
        const finalized = await this.finalizeFailure(
          bundleId,
          executionJob.id,
          executionJob.attempt,
          executionJob.startedAt,
          error,
          active.controller.signal
        );
        if (finalized === "stale") {
          return { kind: "stale", jobId: executionJob.id };
        }
        return { kind: "executed", jobId: executionJob.id, status: finalized };
      }

      const finalized = await this.finalizeSuccess(
        bundleId,
        executionJob.id,
        executionJob.attempt,
        executionJob.startedAt,
        result
      );
      if (finalized === "stale") {
        return { kind: "stale", jobId: executionJob.id };
      }
      return { kind: "executed", jobId: executionJob.id, status: finalized };
    } catch (error) {
      await this.recoverAfterInfrastructureFailure(bundleId);
      throw error;
    } finally {
      const current = this.activeControllers.get(bundleId);
      if (current?.controller === active.controller) {
        this.activeControllers.delete(bundleId);
      }
    }
  }

  /**
   * Reloads ambiguous storage state and prevents an orphaned processing claim.
   *
   * The original infrastructure error remains authoritative. If storage is
   * still unavailable, startup recovery will retry this same operation later.
   *
   * @param bundleId - Bundle whose live worker unwound unexpectedly
   */
  private async recoverAfterInfrastructureFailure(bundleId: string): Promise<void> {
    try {
      await this.recoverOnStartup(bundleId);
    } catch {
      return;
    }
  }

  /**
   * Pauses new claims and cooperatively stops non-applying active work.
   *
   * Applying is an explicit no-abort boundary: the execution gate is paused,
   * but a future recoverable transaction must reach a safe commit or recovery
   * point before the job itself can stop.
   *
   * @param bundleId - Stable Bundle identifier
   * @param detail - Optional user-facing pause detail
   * @returns Detached committed queue snapshot
   */
  async pause(bundleId: string, detail?: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<PauseMutationValue>(bundleId, (current) => {
        if (current.control.status === "paused" && current.control.reason === "recovery_required") {
          return { value: { changed: false } };
        }
        const processing = current.jobs.find((job) => job.status === "processing");
        const sameControl =
          current.control.status === "paused" &&
          current.control.reason === "user" &&
          current.control.detail === detail;
        let next = current;
        if (processing && processing.stage !== "applying") {
          const pausedAt = Math.max(timestamp, processing.updatedAt);
          const paused: KnowledgeIngestJob = {
            id: processing.id,
            bundleId: processing.bundleId,
            sourceId: processing.sourceId,
            sourceContentHash: processing.sourceContentHash,
            pipelineFingerprint: processing.pipelineFingerprint,
            inputRevision: processing.inputRevision,
            attempt: processing.attempt,
            rerunRequested: processing.rerunRequested,
            createdAt: processing.createdAt,
            updatedAt: pausedAt,
            status: "paused",
            stage: processing.stage,
            pausedAt,
            ...(detail === undefined ? {} : { reason: detail }),
          };
          next = replaceJob(next, paused);
        }
        if (!sameControl) {
          next = {
            ...next,
            control: {
              status: "paused",
              reason: "user",
              pausedAt: timestamp,
              ...(detail === undefined ? {} : { detail }),
            },
          };
        }
        const pausedJobId = processing?.stage === "applying" ? undefined : processing?.id;
        return next === current
          ? { value: { changed: false } }
          : {
              next,
              value: {
                changed: true,
                ...(pausedJobId === undefined ? {} : { pausedJobId }),
              },
            };
      });
    });

    if (mutation.value.pausedJobId) {
      const active = this.activeControllers.get(bundleId);
      if (active?.jobId === mutation.value.pausedJobId) {
        active.controller.abort();
      }
    }
    if (mutation.value.changed) {
      this.emit(mutation.snapshot, "pause", mutation.value.pausedJobId);
    }
    return mutation.snapshot;
  }

  /**
   * Resumes a Bundle queue and requeues every safely paused job.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached committed queue snapshot
   */
  async resume(bundleId: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const hasApplyRecoveryFailure = current.jobs.some(
          (job) => job.status === "failed" && job.stage === "applying"
        );
        if (
          hasApplyRecoveryFailure ||
          (current.control.status === "paused" && current.control.reason === "recovery_required")
        ) {
          throw new IngestQueueRecoveryRequiredError(bundleId);
        }
        const hasPausedJobs = current.jobs.some((job) => job.status === "paused");
        if (current.control.status === "running" && !hasPausedJobs) {
          return { value: false };
        }
        return {
          next: {
            ...current,
            control: { status: "running" },
            jobs: current.jobs.map((job): KnowledgeIngestJob => {
              if (job.status !== "paused") {
                return job;
              }
              return {
                id: job.id,
                bundleId: job.bundleId,
                sourceId: job.sourceId,
                sourceContentHash: job.sourceContentHash,
                pipelineFingerprint: job.pipelineFingerprint,
                inputRevision: job.inputRevision,
                attempt: job.attempt,
                rerunRequested: job.rerunRequested,
                createdAt: job.createdAt,
                updatedAt: Math.max(timestamp, job.updatedAt),
                status: "pending",
                stage: "queued",
              };
            }),
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "resume");
    }
    return mutation.snapshot;
  }

  /**
   * Cancels a pending, paused, processing, or review job and its reserved rerun.
   *
   * Applying cannot be cancelled at the queue boundary because aborting a
   * multi-file write without its transaction journal could corrupt user data.
   * This is source-work cancellation, so the one coalesced rerun is discarded.
   * Cancellation only updates queue state and signals the executor; it has no
   * page-deletion capability, including for shared or user-owned pages.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Durable job identifier
   * @returns Detached cancelled job
   */
  async cancel(bundleId: string, jobId: string): Promise<KnowledgeIngestJob> {
    assertIdentifier(jobId, "jobId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status === "cancelled") {
          return { value: false };
        }
        if (["completed", "failed"].includes(job.status)) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "cancel");
        }
        if (job.status === "processing" && job.stage === "applying") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "cancel during apply");
        }
        const cancelledAt = Math.max(timestamp, job.updatedAt);
        const cancelled: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: cancelledAt,
          status: "cancelled",
          stage: "cancelled",
          cancelledAt,
        };
        return {
          next: {
            ...replaceJob(current, cancelled),
            reruns: current.reruns.filter((rerun) => rerun.sourceId !== job.sourceId),
          },
          value: true,
        };
      });
    });

    if (mutation.value) {
      const active = this.activeControllers.get(bundleId);
      if (active?.jobId === jobId) {
        active.controller.abort();
      }
      this.emit(mutation.snapshot, "cancel", jobId);
    }
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Explicitly retries one retryable terminal failure.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Failed job identifier
   * @returns Detached pending job
   */
  async retryFailed(bundleId: string, jobId: string): Promise<KnowledgeIngestJob> {
    assertIdentifier(jobId, "jobId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "failed" || !job.failure.retryable || job.stage === "applying") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "retry");
        }
        const activeForSource = current.jobs.some(
          (candidate) =>
            candidate.id !== job.id && candidate.sourceId === job.sourceId && isActiveJob(candidate)
        );
        if (activeForSource) {
          throw new IngestQueueTransitionError(job.id, jobState(job), "retry beside active source");
        }
        const pending: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: 0,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: Math.max(timestamp, job.updatedAt),
          status: "pending",
          stage: "queued",
        };
        return { next: replaceJob(current, pending), value: true };
      });
    });
    this.emit(mutation.snapshot, "retry", jobId);
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Records successful user review and promotes a queued latest-source rerun.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Awaiting-review job identifier
   * @returns Detached completed predecessor job
   */
  async completeReview(bundleId: string, jobId: string): Promise<KnowledgeIngestJob> {
    assertIdentifier(jobId, "jobId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status === "completed") {
          return { value: false };
        }
        if (job.status !== "awaiting_review") {
          throw new IngestQueueTransitionError(job.id, jobState(job), "complete review");
        }
        const completedAt = Math.max(timestamp, job.updatedAt);
        const completed: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: completedAt,
          status: "completed",
          stage: "completed",
          changeSetId: job.changeSetId,
          completedAt,
        };
        return {
          next: promoteRerun(replaceJob(current, completed), job.sourceId, completedAt),
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "complete", jobId);
    }
    return requireJob(mutation.snapshot, jobId);
  }

  /**
   * Recovers interrupted work once during startup and leaves backlog paused.
   *
   * Non-applying processing becomes pending in the same durable mutation as
   * the startup-recovery gate. An interrupted apply fails closed behind a
   * recovery-required gate until Commit E's write journal can prove its state.
   * Recovery itself never increments an execution attempt.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached recovered queue snapshot
   */
  async recoverOnStartup(bundleId: string): Promise<IngestQueueSnapshot> {
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate(bundleId, (current) => {
        const hasBacklog = current.jobs.some((job) => isActiveJob(job));
        if (!hasBacklog) {
          return { value: false };
        }
        const alreadySafelyPaused =
          current.control.status === "paused" &&
          !current.jobs.some((job) => job.status === "processing");
        if (alreadySafelyPaused) {
          return { value: false };
        }
        let next = current;
        let interruptedApply = false;
        for (const job of current.jobs) {
          if (job.status !== "processing") {
            continue;
          }
          const recoveredAt = Math.max(timestamp, job.updatedAt);
          if (job.stage === "applying") {
            interruptedApply = true;
            const failed: KnowledgeIngestJob = {
              id: job.id,
              bundleId: job.bundleId,
              sourceId: job.sourceId,
              sourceContentHash: job.sourceContentHash,
              pipelineFingerprint: job.pipelineFingerprint,
              inputRevision: job.inputRevision,
              attempt: job.attempt,
              rerunRequested: false,
              createdAt: job.createdAt,
              updatedAt: recoveredAt,
              status: "failed",
              stage: "applying",
              failure: {
                code: "interrupted_apply_requires_recovery",
                message: "An interrupted apply requires transaction recovery before retry",
                retryable: false,
                occurredAt: recoveredAt,
              },
            };
            next = promoteRerun(replaceJob(next, failed), job.sourceId, recoveredAt);
            continue;
          }
          const pending: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: job.rerunRequested,
            createdAt: job.createdAt,
            updatedAt: recoveredAt,
            status: "pending",
            stage: "queued",
          };
          next = replaceJob(next, pending);
        }
        return {
          next: {
            ...next,
            control: interruptedApply
              ? {
                  status: "paused",
                  reason: "recovery_required",
                  pausedAt: timestamp,
                  detail: "An interrupted apply must be recovered before queue resume",
                }
              : current.control.status === "paused"
                ? current.control
                : { status: "paused", reason: "startup_recovery", pausedAt: timestamp },
          },
          value: true,
        };
      });
    });
    if (mutation.value) {
      this.emit(mutation.snapshot, "recover");
    }
    return mutation.snapshot;
  }

  /**
   * Claims the oldest due pending job under the Bundle mutex and creates its controller.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Claimed snapshot or a durable availability result
   */
  private async claimNext(bundleId: string): Promise<MutationResult<ClaimedJobResult>> {
    const timestamp = this.now();
    return this.getBundleMutex(bundleId).runExclusive(async () => {
      const localExecution = this.activeControllers.get(bundleId);
      if (localExecution) {
        return {
          snapshot: await this.load(bundleId),
          value: { kind: "busy", jobId: localExecution.jobId },
        };
      }
      const mutation = await this.mutate<ClaimedJobResult>(bundleId, (current) => {
        if (current.control.status === "paused") {
          return {
            value: {
              kind: "paused" as const,
              reason: current.control.reason,
            },
          };
        }
        const processing = current.jobs.find((job) => job.status === "processing");
        if (processing) {
          return { value: { kind: "busy" as const, jobId: processing.id } };
        }

        const pending = current.jobs
          .filter((job): job is Extract<KnowledgeIngestJob, { status: "pending" }> => {
            return job.status === "pending";
          })
          .sort(
            (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
          );
        const due = pending.find(
          (job) => job.nextAttemptAt === undefined || job.nextAttemptAt <= timestamp
        );
        if (!due) {
          const nextAttemptAt = pending.reduce<number | undefined>((earliest, job) => {
            if (job.nextAttemptAt === undefined) {
              return earliest;
            }
            return earliest === undefined
              ? job.nextAttemptAt
              : Math.min(earliest, job.nextAttemptAt);
          }, undefined);
          return nextAttemptAt === undefined
            ? { value: { kind: "idle" as const } }
            : { value: { kind: "waiting" as const, nextAttemptAt } };
        }
        if (due.attempt >= Number.MAX_SAFE_INTEGER) {
          throw new IngestQueueTransitionError(due.id, jobState(due), "increment attempt");
        }
        const startedAt = Math.max(timestamp, due.updatedAt);
        const processingJob: ProcessingIngestJob = {
          id: due.id,
          bundleId: due.bundleId,
          sourceId: due.sourceId,
          sourceContentHash: due.sourceContentHash,
          pipelineFingerprint: due.pipelineFingerprint,
          inputRevision: due.inputRevision,
          attempt: due.attempt + 1,
          rerunRequested: due.rerunRequested,
          createdAt: due.createdAt,
          updatedAt: startedAt,
          status: "processing",
          stage: "parsing",
          startedAt,
        };
        return {
          next: replaceJob(current, processingJob),
          value: { kind: "claimed" as const, jobId: due.id },
        };
      });

      if (mutation.value.kind === "claimed" && mutation.value.jobId) {
        const claimed = requireJob(mutation.snapshot, mutation.value.jobId);
        if (claimed.status !== "processing") {
          throw new IngestQueueTransitionError(
            claimed.id,
            jobState(claimed),
            "create claim controller"
          );
        }
        this.activeControllers.set(bundleId, {
          jobId: mutation.value.jobId,
          attempt: claimed.attempt,
          startedAt: claimed.startedAt,
          controller: new AbortController(),
        });
      }
      return mutation;
    });
  }

  /**
   * Persists a monotonic forward work-stage transition reported by the executor.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param stage - Current executor stage
   * @param signal - Controller signal paired with the claim
   */
  private async reportStage(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    stage: KnowledgeIngestWorkStage,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      throw new DOMException("Ingest execution was aborted", "AbortError");
    }
    const timestamp = this.now();
    let mutation: MutationResult<boolean>;
    try {
      mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
        return this.mutate<boolean>(bundleId, (current) => {
          const job = requireJob(current, jobId);
          if (!isSameClaim(job, attempt, startedAt)) {
            throw new IngestQueueTransitionError(job.id, jobState(job), `report stage '${stage}'`);
          }
          const currentIndex = WORK_STAGE_ORDER.indexOf(job.stage);
          const nextIndex = WORK_STAGE_ORDER.indexOf(stage);
          if (nextIndex < currentIndex) {
            throw new IngestQueueTransitionError(
              job.id,
              jobState(job),
              `move backward to '${stage}'`
            );
          }
          if (nextIndex === currentIndex) {
            return { value: false };
          }
          return {
            next: replaceJob(current, {
              ...job,
              stage,
              updatedAt: Math.max(timestamp, job.updatedAt),
            }),
            value: true,
          };
        });
      });
    } catch (error) {
      if (error instanceof IngestQueueTransitionError) {
        throw error;
      }
      throw new IngestQueueInfrastructureError("stage persistence", error);
    }
    if (mutation.value) {
      this.emit(mutation.snapshot, "stage", jobId);
    }
  }

  /**
   * Persists a successful executor outcome unless a concurrent user action won first.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param result - Review or completed executor outcome
   * @returns Final durable job status
   */
  private async finalizeSuccess(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    result: IngestExecutionResult
  ): Promise<ExecutedJobStatus | "stale"> {
    if (result.kind !== "awaiting_review" && result.kind !== "completed") {
      throw new TypeError("executor result kind is not supported");
    }
    assertIdentifier(result.changeSetId, "changeSetId");
    const timestamp = this.now();
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<boolean>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "processing") {
          return { value: false };
        }
        if (!isSameClaim(job, attempt, startedAt)) {
          return { value: false };
        }
        if (result.kind === "awaiting_review") {
          const awaitingReview: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: job.rerunRequested,
            createdAt: job.createdAt,
            updatedAt: Math.max(timestamp, job.updatedAt),
            status: "awaiting_review",
            stage: "review",
            changeSetId: result.changeSetId,
          };
          return { next: replaceJob(current, awaitingReview), value: true };
        }
        const completedAt = Math.max(timestamp, job.updatedAt);
        const completed: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: completedAt,
          status: "completed",
          stage: "completed",
          changeSetId: result.changeSetId,
          completedAt,
        };
        return {
          next: promoteRerun(replaceJob(current, completed), job.sourceId, completedAt),
          value: true,
        };
      });
    });
    const finalJob = requireJob(mutation.snapshot, jobId);
    if (finalJob.attempt !== attempt) {
      return "stale";
    }
    const cause = finalJob.status === "awaiting_review" ? "awaiting_review" : "complete";
    if (mutation.value) {
      this.emit(mutation.snapshot, cause, jobId);
    }
    return this.toRunStatus(finalJob);
  }

  /**
   * Persists retry, rate-limit pause, or terminal failure after executor rejection.
   *
   * @param bundleId - Stable Bundle identifier
   * @param jobId - Claimed job identifier
   * @param error - Unknown executor rejection
   * @param signal - Controller signal paired with the claim
   * @returns Final durable job status
   */
  private async finalizeFailure(
    bundleId: string,
    jobId: string,
    attempt: number,
    startedAt: number,
    error: unknown,
    signal: AbortSignal
  ): Promise<ExecutedJobStatus | "stale"> {
    const timestamp = this.now();
    const normalized = this.normalizeExecutorFailure(error, timestamp);
    const decision = this.decideRetrySafely({
      attempt,
      retryable: normalized.failure.retryable,
      rateLimited: normalized.rateLimited,
      ...(normalized.retryAfterMs === undefined ? {} : { retryAfterMs: normalized.retryAfterMs }),
    });
    const mutation = await this.getBundleMutex(bundleId).runExclusive(async () => {
      return this.mutate<FailureMutationValue>(bundleId, (current) => {
        const job = requireJob(current, jobId);
        if (job.status !== "processing") {
          return { value: { changed: false, cause: "failure" } };
        }
        if (!isSameClaim(job, attempt, startedAt)) {
          return { value: { changed: false, cause: "failure" } };
        }

        const failedAt = Math.max(timestamp, job.updatedAt);
        const failure: KnowledgeFailure = {
          ...normalized.failure,
          occurredAt: failedAt,
        };
        const terminalFailure: KnowledgeIngestJob = {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: job.sourceContentHash,
          pipelineFingerprint: job.pipelineFingerprint,
          inputRevision: job.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: failedAt,
          status: "failed",
          stage: job.stage,
          failure,
        };
        if (job.stage === "applying") {
          const recoveryFailure: KnowledgeIngestJob = {
            ...terminalFailure,
            failure: {
              code: "apply_failure_requires_recovery",
              message: "Apply failure requires transaction recovery before retry",
              retryable: false,
              occurredAt: failedAt,
            },
          };
          const next = promoteRerun(replaceJob(current, recoveryFailure), job.sourceId, failedAt);
          return {
            next: {
              ...next,
              control: {
                status: "paused",
                reason: "recovery_required",
                pausedAt: failedAt,
                detail: "Apply transaction state must be recovered before queue resume",
              },
            },
            value: { changed: true, cause: "failure" },
          };
        }
        const hasRerun = current.reruns.some((rerun) => rerun.sourceId === job.sourceId);
        if (hasRerun) {
          let next = promoteRerun(
            replaceJob(current, terminalFailure),
            job.sourceId,
            Math.max(timestamp, job.updatedAt)
          );
          if (decision.kind === "pause") {
            next = {
              ...next,
              control: {
                status: "paused",
                reason: "rate_limit",
                pausedAt: timestamp,
                ...(decision.retryAfterMs === undefined
                  ? {}
                  : { resumeAt: addSafeDelay(timestamp, decision.retryAfterMs) }),
              },
            };
          }
          return {
            next,
            value: {
              changed: true,
              cause: decision.kind === "pause" ? "rate_limit" : "failure",
            },
          };
        }

        if (decision.kind === "retry") {
          const pending: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: false,
            createdAt: job.createdAt,
            updatedAt: Math.max(timestamp, job.updatedAt),
            status: "pending",
            stage: "queued",
            nextAttemptAt: addSafeDelay(Math.max(timestamp, job.updatedAt), decision.delayMs),
          };
          return {
            next: replaceJob(current, pending),
            value: { changed: true, cause: "retry" },
          };
        }

        if (decision.kind === "pause") {
          const pausedAt = Math.max(timestamp, job.updatedAt);
          const nextJob: KnowledgeIngestJob = {
            id: job.id,
            bundleId: job.bundleId,
            sourceId: job.sourceId,
            sourceContentHash: job.sourceContentHash,
            pipelineFingerprint: job.pipelineFingerprint,
            inputRevision: job.inputRevision,
            attempt: job.attempt,
            rerunRequested: false,
            createdAt: job.createdAt,
            updatedAt: pausedAt,
            status: "paused",
            stage: job.stage,
            pausedAt,
            reason: normalized.failure.message,
          };
          return {
            next: {
              ...replaceJob(current, nextJob),
              control: {
                status: "paused",
                reason: "rate_limit",
                pausedAt,
                detail: normalized.failure.message,
                ...(decision.retryAfterMs === undefined
                  ? {}
                  : { resumeAt: addSafeDelay(pausedAt, decision.retryAfterMs) }),
              },
            },
            value: { changed: true, cause: "rate_limit" },
          };
        }

        return {
          next: replaceJob(current, terminalFailure),
          value: { changed: true, cause: "failure" },
        };
      });
    });

    const finalJob = requireJob(mutation.snapshot, jobId);
    if (finalJob.attempt !== attempt) {
      return "stale";
    }
    if (mutation.value.changed && !(signal.aborted && finalJob.status === "cancelled")) {
      this.emit(mutation.snapshot, mutation.value.cause, jobId);
    }
    return this.toRunStatus(finalJob);
  }

  /**
   * Normalizes only explicitly typed executor errors; unknown errors remain generic.
   *
   * Avoiding raw unknown error messages prevents provider payloads or credentials
   * from being copied into durable queue JSON accidentally.
   *
   * @param error - Unknown executor rejection
   * @param occurredAt - Queue-owned failure timestamp
   * @returns Serializable failure and explicit retry classification
   */
  private normalizeExecutorFailure(
    error: unknown,
    occurredAt: number
  ): {
    failure: KnowledgeFailure;
    rateLimited: boolean;
    retryAfterMs?: number;
  } {
    if (error instanceof IngestExecutorError) {
      const { details } = error;
      if (
        isRecord(details) &&
        typeof details.code === "string" &&
        FAILURE_CODE_PATTERN.test(details.code) &&
        typeof details.message === "string" &&
        details.message.trim().length > 0 &&
        details.message.length <= 1_000 &&
        !SENSITIVE_FAILURE_PATTERN.test(details.message) &&
        typeof details.retryable === "boolean" &&
        typeof details.rateLimited === "boolean" &&
        (details.retryAfterMs === undefined ||
          (Number.isSafeInteger(details.retryAfterMs) && details.retryAfterMs >= 0)) &&
        (details.rateLimited || details.retryAfterMs === undefined)
      ) {
        return {
          failure: {
            code: details.code,
            message: details.message,
            retryable: details.retryable,
            occurredAt,
          },
          rateLimited: details.rateLimited,
          ...(details.retryAfterMs === undefined ? {} : { retryAfterMs: details.retryAfterMs }),
        };
      }
    }
    return {
      failure: {
        code: "unexpected_executor_failure",
        message: "The ingest executor failed without safe structured details",
        retryable: false,
        occurredAt,
      },
      rateLimited: false,
    };
  }

  /**
   * Selects a stable retry decision and fails closed for malformed custom policies.
   *
   * The decision is computed once outside the CAS-replayed transform so jitter
   * cannot change merely because an unrelated concurrent queue write won first.
   *
   * @param context - Completed-attempt and normalized failure classification
   * @returns Valid retry, rate-limit pause, or terminal failure decision
   */
  private decideRetrySafely(context: {
    attempt: number;
    retryable: boolean;
    rateLimited: boolean;
    retryAfterMs?: number;
  }): RetryDecision {
    try {
      const decision = this.retryPolicy.decide(context);
      if (
        decision.kind === "retry" &&
        Number.isSafeInteger(decision.delayMs) &&
        decision.delayMs >= 0
      ) {
        return decision;
      }
      if (
        decision.kind === "pause" &&
        (decision.retryAfterMs === undefined ||
          (Number.isSafeInteger(decision.retryAfterMs) && decision.retryAfterMs >= 0))
      ) {
        return decision;
      }
      if (
        decision.kind === "fail" &&
        (decision.reason === "not_retryable" || decision.reason === "attempts_exhausted")
      ) {
        return decision;
      }
    } catch {
      return { kind: "fail", reason: "not_retryable" };
    }
    return { kind: "fail", reason: "not_retryable" };
  }

  /**
   * Validates an executor outcome before entering persistence finalization.
   *
   * @param value - Runtime result returned through the executor port
   */
  private assertExecutionResult(value: unknown): asserts value is IngestExecutionResult {
    if (
      !isRecord(value) ||
      (value.kind !== "awaiting_review" && value.kind !== "completed") ||
      typeof value.changeSetId !== "string" ||
      value.changeSetId.trim().length === 0
    ) {
      throw new TypeError("executor result does not satisfy the ingest outcome contract");
    }
  }

  /**
   * Narrows a durable state to the statuses exposed by runNext.
   *
   * @param job - Durable job after success/failure finalization
   * @returns Legal externally observable execution status
   */
  private toRunStatus(job: KnowledgeIngestJob): ExecutedJobStatus | "stale" {
    if (job.status === "processing") {
      return "stale";
    }
    return job.status;
  }

  /**
   * Validates exact enqueue identity and hashes before any storage access.
   *
   * @param request - Candidate enqueue request
   */
  private assertEnqueueRequest(request: EnqueueIngestRequest): void {
    assertIdentifier(request.bundleId, "bundleId");
    assertIdentifier(request.sourceId, "sourceId");
    assertHash(request.sourceContentHash, "sourceContentHash");
    assertHash(request.pipelineFingerprint, "pipelineFingerprint");
    if (!Number.isSafeInteger(request.inputRevision) || request.inputRevision < 0) {
      throw new TypeError("inputRevision must be a non-negative safe integer");
    }
  }

  /**
   * Reads a validated non-negative safe-integer timestamp from the injected clock.
   *
   * @returns Current deterministic queue time
   */
  private now(): number {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("clock must return a non-negative safe integer");
    }
    return timestamp;
  }

  /**
   * Reads and validates one non-whitespace id from the injected factory.
   *
   * @returns Candidate durable job id
   */
  private nextJobId(): string {
    const jobId = this.jobIdFactory();
    assertIdentifier(jobId, "generated jobId");
    return jobId;
  }

  /**
   * Rejects a candidate id already used by job history or a reserved rerun.
   *
   * @param snapshot - Current validated queue snapshot
   * @param jobId - Candidate durable id
   */
  private assertJobIdAvailable(snapshot: IngestQueueSnapshot, jobId: string): void {
    if (
      snapshot.jobs.some((job) => job.id === jobId) ||
      snapshot.reruns.some((rerun) => rerun.jobId === jobId)
    ) {
      throw new IngestQueueJobIdConflictError(snapshot.bundleId, jobId);
    }
  }

  /**
   * Returns the in-process mutex dedicated to one Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Reused Bundle mutex
   */
  private getBundleMutex(bundleId: string): Mutex {
    const existing = this.bundleMutexes.get(bundleId);
    if (existing) {
      return existing;
    }
    const mutex = new Mutex();
    this.bundleMutexes.set(bundleId, mutex);
    return mutex;
  }

  /**
   * Emits a best-effort post-commit reload hint.
   *
   * Queue storage remains authoritative: observer failure never rolls back or
   * changes the success result of the durable operation it follows.
   *
   * @param snapshot - Current committed or validated no-op snapshot
   * @param cause - Operation that produced the observable state
   * @param jobId - Optional affected job id
   */
  private emit(snapshot: IngestQueueSnapshot, cause: IngestQueueEventCause, jobId?: string): void {
    if (!this.eventSink) {
      return;
    }
    try {
      const pending = this.eventSink.emit({
        type: "queue_changed",
        cause,
        bundleId: snapshot.bundleId,
        revision: snapshot.revision,
        ...(jobId === undefined ? {} : { jobId }),
      });
      void Promise.resolve(pending).catch(() => undefined);
    } catch {
      return;
    }
  }

  /**
   * Loads unknown queue JSON and enforces version and Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Validated snapshot and expected write revision
   */
  private async loadForMutation(bundleId: string): Promise<LoadedQueue> {
    const raw = await this.storage.read(bundleId);
    if (raw === null) {
      return { snapshot: createEmptyQueue(bundleId), expectedRevision: null };
    }
    if (isRecord(raw) && "version" in raw && raw.version !== 1) {
      throw new IngestQueueIncompatibleVersionError(bundleId, raw.version);
    }
    const snapshot = this.cloneValidatedSnapshot(bundleId, raw);
    if (snapshot.bundleId !== bundleId) {
      throw new IngestQueueBundleMismatchError(bundleId, snapshot.bundleId);
    }
    return { snapshot, expectedRevision: snapshot.revision };
  }

  /**
   * Applies one immutable mutation with bounded optimistic conflict retries.
   *
   * @param bundleId - Stable Bundle identifier
   * @param transform - Deterministic transform replayed after CAS conflicts
   * @returns Detached current or newly persisted snapshot and operation value
   */
  private async mutate<T>(
    bundleId: string,
    transform: (snapshot: IngestQueueSnapshot) => QueueMutation<T>
  ): Promise<MutationResult<T>> {
    assertIdentifier(bundleId, "bundleId");
    let lastConflict: IngestQueueRevisionConflictError | undefined;
    for (let attempt = 0; attempt < this.maxWriteAttempts; attempt += 1) {
      const loaded = await this.loadForMutation(bundleId);
      const proposal = transform(loaded.snapshot);
      if (!proposal.next) {
        return {
          snapshot: this.cloneValidatedSnapshot(bundleId, loaded.snapshot),
          value: proposal.value,
        };
      }
      if (loaded.snapshot.revision >= Number.MAX_SAFE_INTEGER) {
        throw new IngestQueueRevisionOverflowError(bundleId, loaded.snapshot.revision);
      }
      const next = this.cloneValidatedSnapshot(bundleId, {
        ...proposal.next,
        version: 1,
        bundleId,
        revision: loaded.snapshot.revision + 1,
      });
      try {
        await this.storage.write(bundleId, next, loaded.expectedRevision);
        return {
          snapshot: this.cloneValidatedSnapshot(bundleId, next),
          value: proposal.value,
        };
      } catch (error) {
        if (!(error instanceof IngestQueueRevisionConflictError)) {
          throw error;
        }
        lastConflict = error;
      }
    }
    throw new IngestQueueWriteConflictExhaustedError(
      bundleId,
      this.maxWriteAttempts,
      lastConflict ?? new IngestQueueRevisionConflictError(bundleId, null)
    );
  }

  /**
   * Strictly parses, semantically validates, and clones a queue snapshot.
   *
   * @param bundleId - Bundle used for safe error reporting
   * @param value - Unknown or typed queue value
   * @returns Detached validated queue snapshot
   */
  private cloneValidatedSnapshot(bundleId: string, value: unknown): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(value);
    if (!parsed.ok) {
      throw new IngestQueueValidationError(bundleId, parsed.issues);
    }
    const semantic = validateIngestQueueSnapshot(parsed.value);
    if (!semantic.valid) {
      throw new IngestQueueValidationError(bundleId, semantic.diagnostics);
    }
    return parsed.value;
  }
}
