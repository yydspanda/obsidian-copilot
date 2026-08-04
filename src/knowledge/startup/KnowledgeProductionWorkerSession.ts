import type { IngestQueue, RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";

/** Narrow production authority needed by the first Queue worker boundary. */
export interface KnowledgeProductionWorkerSessionInput {
  /** Queue instance owned by the exact released Runtime generation. */
  queue: IngestQueue;
  /** Configured Bundle identifiers in deterministic execution order. */
  bundleIds: readonly string[];
  /** Reports whether conditional startup release has completed for this generation. */
  isReleased(): boolean;
  /** Re-proves Runtime, observation, and preflight identity before each claim. */
  assertCurrent(): void;
}

/** Sanitized result of one bounded worker polling pass. */
export type KnowledgeProductionWorkerPassResult = Readonly<{
  kind: "pass";
  results: readonly Readonly<{ bundleId: string; result: RunNextResult }>[];
}>;

/** Stable worker lifecycle failure with no Queue, job, or source payload. */
export class KnowledgeProductionWorkerSessionError extends Error {
  /** Creates a fail-closed worker lifecycle error. */
  constructor(public readonly code: "not_released" | "stale" | "busy" | "input_invalid") {
    super("The production Knowledge worker session is not authorized");
    this.name = "KnowledgeProductionWorkerSessionError";
  }
}

interface WorkerState {
  queue: IngestQueue;
  bundleIds: readonly string[];
  isReleased: () => boolean;
  assertCurrent: () => void;
  closed: boolean;
  running: boolean;
}

const workerStates = new WeakMap<object, WorkerState>();

/** Re-proves that an awaited worker pass still belongs to the current live generation. */
function assertWorkerCurrent(state: WorkerState): void {
  if (state.closed) {
    throw new KnowledgeProductionWorkerSessionError("stale");
  }
  state.assertCurrent();
}

/** Validates a bounded deterministic Bundle identifier list without invoking accessors. */
function snapshotBundleIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    throw new KnowledgeProductionWorkerSessionError("input_invalid");
  }
  const ids = value.map((candidate) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      throw new KnowledgeProductionWorkerSessionError("input_invalid");
    }
    return candidate;
  });
  const sorted = [...new Set(ids)].sort();
  if (sorted.length !== ids.length) {
    throw new KnowledgeProductionWorkerSessionError("input_invalid");
  }
  return Object.freeze(sorted);
}

/** Owns one explicitly released, bounded Queue worker pass without model authority. */
export class KnowledgeProductionWorkerSession {
  /** Captures one exact Queue and generation authority synchronously. */
  constructor(input: KnowledgeProductionWorkerSessionInput) {
    if (!(input.queue instanceof Object) || typeof input.queue.runNext !== "function") {
      throw new KnowledgeProductionWorkerSessionError("input_invalid");
    }
    if (typeof input.isReleased !== "function" || typeof input.assertCurrent !== "function") {
      throw new KnowledgeProductionWorkerSessionError("input_invalid");
    }
    workerStates.set(this, {
      queue: input.queue,
      bundleIds: snapshotBundleIds(input.bundleIds),
      isReleased: () => input.isReleased(),
      assertCurrent: () => input.assertCurrent(),
      closed: false,
      running: false,
    });
    Object.freeze(this);
  }

  /** Runs at most one Queue claim per configured Bundle and never schedules itself. */
  async runOnce(): Promise<KnowledgeProductionWorkerPassResult> {
    const state = workerStates.get(this);
    if (!state || state.closed) {
      throw new KnowledgeProductionWorkerSessionError("stale");
    }
    if (state.running) {
      throw new KnowledgeProductionWorkerSessionError("busy");
    }
    if (!state.isReleased()) {
      throw new KnowledgeProductionWorkerSessionError("not_released");
    }
    state.running = true;
    try {
      const results: Array<Readonly<{ bundleId: string; result: RunNextResult }>> = [];
      for (const bundleId of state.bundleIds) {
        assertWorkerCurrent(state);
        if (!state.isReleased()) {
          throw new KnowledgeProductionWorkerSessionError("not_released");
        }
        const result = await state.queue.runNext(bundleId);
        assertWorkerCurrent(state);
        if (!state.isReleased()) {
          throw new KnowledgeProductionWorkerSessionError("not_released");
        }
        results.push(Object.freeze({ bundleId, result }));
      }
      return Object.freeze({ kind: "pass", results: Object.freeze(results) });
    } finally {
      state.running = false;
    }
  }

  /** Permanently revokes future worker passes. */
  close(): void {
    const state = workerStates.get(this);
    if (state) state.closed = true;
  }
}

Object.freeze(KnowledgeProductionWorkerSession.prototype);
Object.freeze(KnowledgeProductionWorkerSession);
