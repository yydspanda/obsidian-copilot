import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeStore,
  type KnowledgeCompletedSourceReanalysisCommand,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeStudioRuntimeCommandAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/16";

function createHarness(enabled = true) {
  const unreachable = async (): Promise<never> => {
    throw new Error("Unexpected direct storage or model use");
  };
  const runtime = new KnowledgeRuntimeStore({
    read: unreachable,
    process: unreachable,
    initialize: unreachable,
  });
  const callback = jest.fn<Promise<void>, [KnowledgeCompletedSourceReanalysisCommand]>(
    async () => undefined
  );
  const assertCurrent = jest.fn();
  const drains: Promise<void>[] = [];
  const adapter = new KnowledgeStudioRuntimeCommandAdapter({
    queue: new IngestQueue({ read: unreachable, write: unreachable }, { execute: unreachable }),
    reviewReject: new KnowledgeRuntimeReviewRejectPort(runtime),
    bundleIds: ["reading"],
    assertCurrent,
    retainDrain: (drain) => drains.push(drain),
    ...(enabled ? { reanalyzeCompletedSource: callback } : {}),
  });
  return { adapter, callback, assertCurrent, drains };
}

describe("KnowledgeStudioRuntimeCommandAdapter", () => {
  describe("KnowledgeStudioRuntimeCommandAdapter", () => {
    describe("getCapabilities()", () => {
      it(`advertises replay only when a private Runtime command is supplied (${ISSUE})`, () => {
        expect(createHarness().adapter.getCapabilities()).toMatchObject({ reanalyzeJob: true });
        expect(createHarness(false).adapter.getCapabilities().reanalyzeJob).not.toBe(true);
      });
    });

    describe("reanalyzeJob()", () => {
      it(`passes only exact job/revision intent and publishes a hint after the durable replay settles (${ISSUE})`, async () => {
        const { adapter, callback, drains } = createHarness();
        const hint = jest.fn();
        adapter.subscribe("reading", hint);
        await adapter.reanalyzeJob(
          "reading",
          "completed-chapter",
          12,
          new AbortController().signal
        );
        expect(callback).toHaveBeenCalledWith({
          bundleId: "reading",
          jobId: "completed-chapter",
          expectedQueueRevision: 12,
        });
        expect(hint).toHaveBeenCalledTimes(1);
        await Promise.all(drains);
        expect(drains).toHaveLength(1);
        expect(Reflect.ownKeys(adapter)).toEqual([]);
      });

      it(`rejects unavailable, aborted, stale, wrong-Bundle, and malformed replay commands before mutation (${ISSUE})`, async () => {
        const { adapter, callback, assertCurrent } = createHarness();
        const aborted = new AbortController();
        aborted.abort();
        await expect(
          adapter.reanalyzeJob("reading", "chapter", 0, aborted.signal)
        ).rejects.toThrow();
        await expect(
          adapter.reanalyzeJob("other", "chapter", 0, new AbortController().signal)
        ).rejects.toThrow();
        await expect(
          adapter.reanalyzeJob("reading", "", 0, new AbortController().signal)
        ).rejects.toThrow();
        await expect(
          adapter.reanalyzeJob("reading", "chapter", -1, new AbortController().signal)
        ).rejects.toThrow();
        assertCurrent.mockImplementation(() => {
          throw new DOMException("Stale", "AbortError");
        });
        await expect(
          adapter.reanalyzeJob("reading", "chapter", 0, new AbortController().signal)
        ).rejects.toThrow();
        expect(callback).not.toHaveBeenCalled();
        const unavailable = createHarness(false);
        await expect(
          unavailable.adapter.reanalyzeJob("reading", "chapter", 0, new AbortController().signal)
        ).rejects.toThrow();
        expect(unavailable.callback).not.toHaveBeenCalled();
      });

      it.each(["generation", "signal"])(
        `preserves durable replay success when %s is revoked after commit (${ISSUE})`,
        async (revoked) => {
          const { adapter, callback, assertCurrent } = createHarness();
          const hint = jest.fn();
          const controller = new AbortController();
          adapter.subscribe("reading", hint);
          callback.mockImplementation(async () => {
            if (revoked === "signal") controller.abort();
            else
              assertCurrent.mockImplementation(() => {
                throw new DOMException("Stale", "AbortError");
              });
          });
          await expect(
            adapter.reanalyzeJob("reading", "chapter", 0, controller.signal)
          ).resolves.toBeUndefined();
          expect(callback).toHaveBeenCalledTimes(1);
          expect(hint).toHaveBeenCalledTimes(1);
        }
      );
    });
  });
});
