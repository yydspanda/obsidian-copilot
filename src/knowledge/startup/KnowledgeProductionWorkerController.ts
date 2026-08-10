import type { RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeProductionWorkerSession,
  type KnowledgeProductionWorkerPassResult,
} from "@/knowledge/startup/KnowledgeProductionWorkerSession";

const MAX_IMMEDIATE_PASSES = 32;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const FAILURE_RETRY_BASE_DELAY_MS = 250;
const FAILURE_RETRY_MAX_DELAY_MS = 30_000;

/** Exact renderer timer realm used by one plugin-owned worker generation. */
export interface KnowledgeProductionWorkerScheduler {
  /** Returns the current epoch-millisecond time used by Queue retry markers. */
  now(): number;
  /** Schedules one future wakeup and returns an opaque realm-owned handle. */
  schedule(callback: () => void, delayMs: number): unknown;
  /** Cancels one previously returned opaque timer handle. */
  cancel(handle: unknown): void;
}

interface KnowledgeProductionWorkerControllerBaseInput {
  worker: KnowledgeProductionWorkerSession;
  scheduler: KnowledgeProductionWorkerScheduler;
}

/** Dependencies for one event-driven, generation-owned worker controller. */
export type KnowledgeProductionWorkerControllerInput =
  KnowledgeProductionWorkerControllerBaseInput &
    (
      | {
          /** Defers replacement after one durable result changes the Manifest-bound generation. */
          onGenerationRefreshRequired: () => void;
          /** Re-proves the exact Manifest generation after an ambiguous worker rejection. */
          probeGenerationCurrent: () => Promise<boolean>;
        }
      | {
          onGenerationRefreshRequired?: never;
          probeGenerationCurrent?: never;
        }
    );

interface WorkerControllerState {
  worker: KnowledgeProductionWorkerSession;
  scheduler: KnowledgeProductionWorkerScheduler;
  onGenerationRefreshRequired?: () => void;
  probeGenerationCurrent?: () => Promise<boolean>;
  closed: boolean;
  started: boolean;
  running: boolean;
  wakeRequested: boolean;
  refreshPending: boolean;
  ambiguousGenerationProbePending: boolean;
  consecutiveFailures: number;
  drainPromise?: Promise<void>;
  timer?: RetainedTimer;
  settlement: Promise<void>;
  resolveSettlement: () => void;
  settlementResolved: boolean;
}

interface RetainedTimer {
  handle?: unknown;
}

interface PassProjection {
  madeProgress: boolean;
  refreshRequired: boolean;
  nextAttemptAt?: number;
}

const controllerStates = new WeakMap<object, WorkerControllerState>();

/** Stable controller construction/authority failure retaining no Queue data. */
export class KnowledgeProductionWorkerControllerError extends Error {
  /** Creates one value-free worker-controller failure. */
  constructor() {
    super("The production Knowledge worker controller is unavailable");
    this.name = "KnowledgeProductionWorkerControllerError";
  }
}

/** Returns hidden state only for an authentic controller. */
function requireControllerState(value: unknown): WorkerControllerState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionWorkerControllerError();
  }
  const state = controllerStates.get(value);
  if (!state) throw new KnowledgeProductionWorkerControllerError();
  return state;
}

/** Projects one Queue result into progress and retry timing without retaining job ids. */
function inspectQueueResult(result: RunNextResult, projection: PassProjection): void {
  if (
    result.kind === "executed" &&
    result.status === "completed" &&
    result.generationEffect === "manifest_no_changes_committed"
  ) {
    projection.madeProgress = true;
    projection.refreshRequired = true;
    return;
  }
  if (result.kind === "executed" || result.kind === "stale") {
    projection.madeProgress = true;
    return;
  }
  if (result.kind === "waiting") {
    projection.nextAttemptAt =
      projection.nextAttemptAt === undefined
        ? result.nextAttemptAt
        : Math.min(projection.nextAttemptAt, result.nextAttemptAt);
    return;
  }
  if (result.kind === "paused" && result.resumeAt !== undefined) {
    projection.nextAttemptAt =
      projection.nextAttemptAt === undefined
        ? result.resumeAt
        : Math.min(projection.nextAttemptAt, result.resumeAt);
  }
}

/** Reduces one bounded worker pass to scheduling facts only. */
function inspectPass(result: KnowledgeProductionWorkerPassResult): PassProjection {
  const projection: PassProjection = { madeProgress: false, refreshRequired: false };
  for (const item of result.results) {
    inspectQueueResult(item.result, projection);
  }
  return projection;
}

/** Reads and validates one scheduler timestamp without allowing negative delay arithmetic. */
function readNow(scheduler: KnowledgeProductionWorkerScheduler): number {
  const now = scheduler.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new KnowledgeProductionWorkerControllerError();
  }
  return now;
}

/** Cancels a retained timer after first clearing publication authority for its handle. */
function cancelTimer(state: WorkerControllerState): void {
  if (state.timer === undefined) return;
  const timer = state.timer;
  state.timer = undefined;
  if (timer.handle === undefined) return;
  try {
    state.scheduler.cancel(timer.handle);
  } catch {
    // Clearing local authority is sufficient; a late callback rechecks closed state.
  }
}

/** Returns a capped exponential delay for the next infrastructure-failure retry. */
function consumeFailureRetryDelay(state: WorkerControllerState): number {
  const exponent = Math.min(state.consecutiveFailures, 30);
  state.consecutiveFailures = Math.min(state.consecutiveFailures + 1, 31);
  return Math.min(FAILURE_RETRY_MAX_DELAY_MS, FAILURE_RETRY_BASE_DELAY_MS * 2 ** exponent);
}

/** Consumes generation refresh authority once and blocks every later wakeup. */
function requestGenerationRefresh(state: WorkerControllerState): void {
  if (state.refreshPending || state.closed) return;
  state.refreshPending = true;
  state.ambiguousGenerationProbePending = false;
  state.wakeRequested = false;
  cancelTimer(state);
  try {
    state.onGenerationRefreshRequired?.();
  } catch {
    // Refresh authority remains consumed even if the outer lifecycle has already closed.
  }
}

/** Schedules one non-overlapping worker wakeup in the captured renderer realm. */
function scheduleWake(state: WorkerControllerState, delayMs: number): void {
  if (state.closed) return;
  cancelTimer(state);
  const timer: RetainedTimer = {};
  state.timer = timer;
  let handle: unknown;
  try {
    handle = state.scheduler.schedule(() => {
      if (state.timer !== timer) return;
      state.timer = undefined;
      requestRun(state);
    }, delayMs);
  } catch {
    if (state.timer === timer) state.timer = undefined;
    return;
  }
  if (state.timer !== timer) {
    try {
      state.scheduler.cancel(handle);
    } catch {
      // A synchronously fired callback already revoked this timer's local authority.
    }
    return;
  }
  timer.handle = handle;
}

/** Starts one detached bounded drain if another pass is not already active. */
function requestRun(state: WorkerControllerState): void {
  if (state.closed || !state.started || state.refreshPending) return;
  state.wakeRequested = true;
  cancelTimer(state);
  if (state.running) return;
  state.running = true;
  const activeDrain = drain(state);
  state.drainPromise = activeDrain;
  void activeDrain
    .catch(() => undefined)
    .finally(() => {
      if (state.drainPromise === activeDrain) state.drainPromise = undefined;
      resolveSettlementIfClosed(state);
    });
}

/** Resolves one controller lifetime only after close and its final drain unwind. */
function resolveSettlementIfClosed(state: WorkerControllerState): void {
  if (!state.closed || state.running || state.settlementResolved) return;
  state.settlementResolved = true;
  state.resolveSettlement();
}

/** Drains committed work until idle/paused/busy, retry time, close, or the safety bound. */
async function drain(state: WorkerControllerState): Promise<void> {
  let immediatePasses = 0;
  try {
    while (!state.closed) {
      state.wakeRequested = false;
      if (state.ambiguousGenerationProbePending && state.probeGenerationCurrent) {
        try {
          const generationCurrent = await state.probeGenerationCurrent();
          if (state.closed) return;
          if (!generationCurrent) {
            requestGenerationRefresh(state);
            return;
          }
          state.ambiguousGenerationProbePending = false;
        } catch {
          if (state.closed) return;
          // Keep the ambiguity retained so the next wake probes before Queue.
          scheduleWake(state, consumeFailureRetryDelay(state));
          return;
        }
      }
      if (state.closed) return;
      let pass: KnowledgeProductionWorkerPassResult;
      try {
        pass = await state.worker.runOnce();
      } catch {
        if (state.closed) return;
        if (state.probeGenerationCurrent) {
          state.ambiguousGenerationProbePending = true;
          try {
            const generationCurrent = await state.probeGenerationCurrent();
            if (state.closed) return;
            if (!generationCurrent) {
              requestGenerationRefresh(state);
              return;
            }
            state.ambiguousGenerationProbePending = false;
          } catch {
            if (state.closed) return;
            // Keep the ambiguity retained so the next wake probes before Queue.
          }
        }
        scheduleWake(state, consumeFailureRetryDelay(state));
        return;
      }
      if (state.closed) return;
      state.consecutiveFailures = 0;
      const projection = inspectPass(pass);
      if (projection.refreshRequired) {
        requestGenerationRefresh(state);
        return;
      }
      immediatePasses += 1;
      if (projection.madeProgress && immediatePasses < MAX_IMMEDIATE_PASSES) {
        continue;
      }
      if (state.wakeRequested) {
        immediatePasses = 0;
        continue;
      }
      if (projection.madeProgress) {
        scheduleWake(state, 0);
        return;
      }
      if (projection.nextAttemptAt !== undefined) {
        const now = readNow(state.scheduler);
        scheduleWake(
          state,
          Math.min(MAX_TIMER_DELAY_MS, Math.max(0, projection.nextAttemptAt - now))
        );
      }
      return;
    }
  } finally {
    state.running = false;
    if (!state.closed && state.wakeRequested && state.timer === undefined) {
      scheduleWake(state, 0);
    }
  }
}

/** Event-driven owner for one released, bounded production worker session. */
export class KnowledgeProductionWorkerController {
  /** Captures one worker and exact renderer timer realm. */
  constructor(input: KnowledgeProductionWorkerControllerInput) {
    if (
      !(input.worker instanceof KnowledgeProductionWorkerSession) ||
      typeof input.scheduler?.now !== "function" ||
      typeof input.scheduler?.schedule !== "function" ||
      typeof input.scheduler?.cancel !== "function" ||
      (input.onGenerationRefreshRequired !== undefined &&
        typeof input.onGenerationRefreshRequired !== "function") ||
      (input.probeGenerationCurrent !== undefined &&
        typeof input.probeGenerationCurrent !== "function") ||
      (input.onGenerationRefreshRequired === undefined) !==
        (input.probeGenerationCurrent === undefined)
    ) {
      throw new KnowledgeProductionWorkerControllerError();
    }
    let resolveSettlement!: () => void;
    const settlement = new Promise<void>((resolve) => {
      resolveSettlement = resolve;
    });
    controllerStates.set(this, {
      worker: input.worker,
      scheduler: input.scheduler,
      closed: false,
      started: false,
      running: false,
      wakeRequested: false,
      refreshPending: false,
      ambiguousGenerationProbePending: false,
      consecutiveFailures: 0,
      settlement,
      resolveSettlement,
      settlementResolved: false,
      ...(input.onGenerationRefreshRequired === undefined
        ? {}
        : { onGenerationRefreshRequired: input.onGenerationRefreshRequired }),
      ...(input.probeGenerationCurrent === undefined
        ? {}
        : { probeGenerationCurrent: input.probeGenerationCurrent }),
    });
    Object.freeze(this);
  }

  /** Starts this generation once and immediately drains its recovered startup backlog. */
  start(): void {
    const state = requireControllerState(this);
    if (state.closed || state.started) {
      throw new KnowledgeProductionWorkerControllerError();
    }
    state.started = true;
    requestRun(state);
  }

  /** Coalesces a committed Queue-change notification into the current or next drain. */
  notifyWorkAvailable(): void {
    requestRun(requireControllerState(this));
  }

  /** Resolves only after this controller closes and its final active drain unwinds. */
  whenSettled(): Promise<void> {
    return requireControllerState(this).settlement;
  }

  /** Synchronously revokes timers and future passes for this worker generation. */
  close(): void {
    const state = controllerStates.get(this);
    if (!state || state.closed) return;
    state.closed = true;
    state.wakeRequested = false;
    cancelTimer(state);
    try {
      state.worker.close();
    } catch {
      // Worker authority is already revoked by the controller state.
    }
    resolveSettlementIfClosed(state);
  }
}

Object.freeze(KnowledgeProductionWorkerController.prototype);
Object.freeze(KnowledgeProductionWorkerController);
