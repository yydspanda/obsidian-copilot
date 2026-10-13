import type { IngestQueue, RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";

export interface KnowledgeProductionWorkerSessionInput {
  queue: IngestQueue;

  bundleIds: readonly string[];

  isReleased(): boolean;

  assertCurrent(): void;
}

export type KnowledgeProductionWorkerPassResult = Readonly<{
  kind: "pass";
  results: readonly Readonly<{ bundleId: string; result: RunNextResult }>[];
}>;

export class KnowledgeProductionWorkerSessionError extends Error {
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

function assertWorkerCurrent(state: WorkerState): void {
  if (state.closed) {
    throw new KnowledgeProductionWorkerSessionError("stale");
  }
  state.assertCurrent();
}

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

export class KnowledgeProductionWorkerSession {
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
        if (
          result.kind === "executed" &&
          result.status === "completed" &&
          result.generationEffect === "manifest_no_changes_committed"
        ) {
          return Object.freeze({ kind: "pass", results: Object.freeze(results) });
        }
      }
      return Object.freeze({ kind: "pass", results: Object.freeze(results) });
    } finally {
      state.running = false;
    }
  }

  close(): void {
    const state = workerStates.get(this);
    if (state) state.closed = true;
  }
}

Object.freeze(KnowledgeProductionWorkerSession.prototype);
Object.freeze(KnowledgeProductionWorkerSession);
