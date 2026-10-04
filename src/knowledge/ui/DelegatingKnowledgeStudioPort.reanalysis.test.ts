import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";

describe("DelegatingKnowledgeStudioPort", () => {
  describe("DelegatingKnowledgeStudioPort", () => {
    describe("reanalyzeJob()", () => {
      function createPort() {
        return new DelegatingKnowledgeStudioPort();
      }

      it("forwards only the exact selected job and queue revision to the current generation — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const reanalyzeJob = jest.fn(async () => undefined);
        const port = createPort();
        port.replaceDelegate(Object.assign(new UnavailableKnowledgeStudioPort(), { reanalyzeJob }));
        await port.reanalyzeJob("reading", "completed", 7, new AbortController().signal);
        expect(reanalyzeJob).toHaveBeenCalledWith(
          "reading",
          "completed",
          7,
          expect.any(AbortSignal)
        );
        port.dispose();
      });

      it("fails closed for older delegates without a reanalysis action — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const port = createPort();
        port.replaceDelegate(new UnavailableKnowledgeStudioPort());
        await expect(
          port.reanalyzeJob("reading", "completed", 7, new AbortController().signal)
        ).rejects.toThrow("not configured");
        port.dispose();
      });

      it("does not call a delegate after caller cancellation — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const reanalyzeJob = jest.fn(async () => undefined);
        const port = createPort();
        port.replaceDelegate(Object.assign(new UnavailableKnowledgeStudioPort(), { reanalyzeJob }));
        const abort = new AbortController();
        abort.abort();
        await expect(
          port.reanalyzeJob("reading", "completed", 7, abort.signal)
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(reanalyzeJob).not.toHaveBeenCalled();
        port.dispose();
      });

      it("revokes the old generation but preserves its resolved atomic enqueue receipt — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        let finish!: () => void;
        let delegatedSignal!: AbortSignal;
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const reanalyzeJob = jest.fn(
          (_bundle: string, _job: string, _revision: number, signal: AbortSignal) => {
            delegatedSignal = signal;
            return pending;
          }
        );
        const port = createPort();
        port.replaceDelegate(Object.assign(new UnavailableKnowledgeStudioPort(), { reanalyzeJob }));
        const result = port.reanalyzeJob("reading", "completed", 7, new AbortController().signal);
        port.replaceDelegate(new UnavailableKnowledgeStudioPort());
        expect(delegatedSignal.aborted).toBe(true);
        finish();
        await expect(result).resolves.toBeUndefined();
        expect(reanalyzeJob).toHaveBeenCalledTimes(1);
        port.dispose();
      });
    });
  });
});
