import {
  KnowledgeProductionWorkerSession,
  KnowledgeProductionWorkerSessionError,
} from "@/knowledge/startup/KnowledgeProductionWorkerSession";
import type { IngestQueue, RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";

/** Creates a Queue-shaped test double with deterministic results. */
function createQueue(result: RunNextResult = { kind: "idle" }): {
  queue: IngestQueue;
  runNext: jest.Mock<Promise<RunNextResult>, [string]>;
} {
  const runNext = jest.fn(async (_bundleId: string) => result);
  return { queue: { runNext } as unknown as IngestQueue, runNext };
}

describe("KnowledgeProductionWorkerSession", () => {
  it("does not claim before conditional release", async () => {
    const { queue, runNext } = createQueue();
    const session = new KnowledgeProductionWorkerSession({
      queue,
      bundleIds: ["personal"],
      isReleased: () => false,
      assertCurrent: () => undefined,
    });

    await expect(session.runOnce()).rejects.toMatchObject({ code: "not_released" });
    expect(runNext).not.toHaveBeenCalled();
  });

  it("runs one bounded pass in stable Bundle order after release", async () => {
    const { queue, runNext } = createQueue();
    let released = true;
    const session = new KnowledgeProductionWorkerSession({
      queue,
      bundleIds: ["zeta", "alpha"],
      isReleased: () => released,
      assertCurrent: () => undefined,
    });

    await expect(session.runOnce()).resolves.toEqual({
      kind: "pass",
      results: [
        { bundleId: "alpha", result: { kind: "idle" } },
        { bundleId: "zeta", result: { kind: "idle" } },
      ],
    });
    expect(runNext.mock.calls).toEqual([["alpha"], ["zeta"]]);

    released = false;
    await expect(session.runOnce()).rejects.toMatchObject({ code: "not_released" });
  });

  it("rejects overlapping passes and closes stale sessions", async () => {
    let resolveRun!: (result: RunNextResult) => void;
    const deferred = new Promise<RunNextResult>((resolve) => {
      resolveRun = resolve;
    });
    const runNext = jest.fn(async () => deferred);
    const queue = { runNext } as unknown as IngestQueue;
    let current = true;
    const session = new KnowledgeProductionWorkerSession({
      queue,
      bundleIds: ["personal"],
      isReleased: () => true,
      assertCurrent: () => {
        if (!current) throw new KnowledgeProductionWorkerSessionError("stale");
      },
    });

    const first = session.runOnce();
    await expect(session.runOnce()).rejects.toMatchObject({ code: "busy" });
    session.close();
    current = false;
    resolveRun({ kind: "idle" });
    await expect(first).rejects.toBeInstanceOf(KnowledgeProductionWorkerSessionError);
    await expect(session.runOnce()).rejects.toMatchObject({ code: "stale" });
  });
});
