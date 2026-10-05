import { IngestQueue, type RunNextResult } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeStudioRuntimeCommandAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/18";

function createHarness(enabled = true) {
  const unreachable = async (): Promise<never> => {
    throw new Error("Adapter tests must not read files or call a model");
  };
  const queue = new IngestQueue(
    { read: unreachable, write: unreachable },
    { execute: unreachable }
  );
  const runSelected = jest.fn<Promise<RunNextResult>, [string, string, number]>(async () => ({
    kind: "executed",
    jobId: "chapter",
    status: "awaiting_review",
  }));
  Object.defineProperty(queue, "runSelected", { value: runSelected });
  const runtime = new KnowledgeRuntimeStore({
    read: unreachable,
    process: unreachable,
    initialize: unreachable,
  });
  const assertCurrent = jest.fn();
  const refresh = jest.fn();
  const drains: Promise<void>[] = [];
  const adapter = new KnowledgeStudioRuntimeCommandAdapter({
    queue,
    reviewReject: new KnowledgeRuntimeReviewRejectPort(runtime),
    bundleIds: ["reading"],
    assertCurrent,
    retainDrain: (drain) => drains.push(drain),
    ...(enabled ? { onGenerationRefreshRequired: refresh } : {}),
  });
  return { adapter, runSelected, assertCurrent, refresh, drains };
}

describe("KnowledgeStudioRuntimeCommandAdapter", () => {
  describe("KnowledgeStudioRuntimeCommandAdapter", () => {
    describe("getCapabilities()", () => {
      it(`exposes selected execution only with generation refresh ownership (${ISSUE})`, () => {
        expect(createHarness().adapter.getCapabilities()).toMatchObject({ runSelectedJob: true });
        expect(createHarness(false).adapter.getCapabilities().runSelectedJob).not.toBe(true);
      });
    });
    describe("runSelectedJob()", () => {
      it(`executes the exact inspected job once and retains its drain without resuming the Bundle (${ISSUE})`, async () => {
        const { adapter, runSelected, drains, refresh } = createHarness();
        const hint = jest.fn();
        adapter.subscribe("reading", hint);
        await adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal);
        expect(runSelected).toHaveBeenCalledTimes(1);
        expect(runSelected).toHaveBeenCalledWith("reading", "chapter", 12);
        expect(hint).toHaveBeenCalledTimes(1);
        await Promise.all(drains);
        expect(drains).toHaveLength(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(Reflect.ownKeys(adapter)).toEqual([]);
      });
      it(`refreshes Manifest-bound authority after a durable no-changes completion (${ISSUE})`, async () => {
        const { adapter, runSelected, refresh } = createHarness();
        runSelected.mockResolvedValue({
          kind: "executed",
          jobId: "chapter",
          status: "completed",
          generationEffect: "manifest_no_changes_committed",
        });
        await adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal);
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      it(`does not turn a durable completion into failure when its refresh notification throws (${ISSUE})`, async () => {
        const { adapter, runSelected, refresh } = createHarness();
        runSelected.mockResolvedValue({
          kind: "executed",
          jobId: "chapter",
          status: "completed",
          generationEffect: "manifest_no_changes_committed",
        });
        refresh.mockImplementation(() => {
          throw new Error("Lifecycle already closed");
        });
        await expect(
          adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal)
        ).resolves.toBeUndefined();
        expect(runSelected).toHaveBeenCalledTimes(1);
      });
      it(`does not retry an ambiguous failure and refreshes potentially committed authority (${ISSUE})`, async () => {
        const { adapter, runSelected, refresh, drains } = createHarness();
        runSelected.mockRejectedValue(new Error("Ambiguous persistence failure"));
        await expect(
          adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal)
        ).rejects.toThrow();
        expect(runSelected).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        await Promise.all(drains);
      });
      it.each(["failed", "pending", "paused"] as const)(
        `does not report a successful selected analysis for status %s (${ISSUE})`,
        async (status) => {
          const { adapter, runSelected } = createHarness();
          runSelected.mockResolvedValue({ kind: "executed", jobId: "chapter", status });
          await expect(
            adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal)
          ).rejects.toThrow();
          expect(runSelected).toHaveBeenCalledTimes(1);
        }
      );
      it(`rejects stale, cancelled, malformed and unavailable commands before queue execution (${ISSUE})`, async () => {
        const { adapter, runSelected, assertCurrent } = createHarness();
        const aborted = new AbortController();
        aborted.abort();
        await expect(
          adapter.runSelectedJob("reading", "chapter", 12, aborted.signal)
        ).rejects.toThrow();
        await expect(
          adapter.runSelectedJob("other", "chapter", 12, new AbortController().signal)
        ).rejects.toThrow();
        await expect(
          adapter.runSelectedJob("reading", "", 12, new AbortController().signal)
        ).rejects.toThrow();
        await expect(
          adapter.runSelectedJob("reading", "chapter", -1, new AbortController().signal)
        ).rejects.toThrow();
        assertCurrent.mockImplementation(() => {
          throw new DOMException("Stale", "AbortError");
        });
        await expect(
          adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal)
        ).rejects.toThrow();
        expect(runSelected).not.toHaveBeenCalled();
        const disabled = createHarness(false);
        await expect(
          disabled.adapter.runSelectedJob("reading", "chapter", 12, new AbortController().signal)
        ).rejects.toThrow();
        expect(disabled.runSelected).not.toHaveBeenCalled();
      });
      it(`preserves durable success if the view is cancelled after completion (${ISSUE})`, async () => {
        const { adapter, runSelected } = createHarness();
        const abort = new AbortController();
        runSelected.mockImplementation(async () => {
          abort.abort();
          return { kind: "executed", jobId: "chapter", status: "awaiting_review" };
        });
        await expect(
          adapter.runSelectedJob("reading", "chapter", 12, abort.signal)
        ).resolves.toBeUndefined();
      });
    });
  });
});
