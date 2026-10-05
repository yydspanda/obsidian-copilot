import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/18";

describe("DelegatingKnowledgeStudioPort", () => {
  describe("DelegatingKnowledgeStudioPort", () => {
    describe("runSelectedJob()", () => {
      it(`forwards only the inspected job and preserves completion after generation replacement (${ISSUE})`, async () => {
        const port = new DelegatingKnowledgeStudioPort();
        let finish!: () => void;
        let capturedSignal!: AbortSignal;
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const runSelectedJob = jest.fn(
          (_bundle: string, _job: string, _revision: number, signal: AbortSignal) => {
            capturedSignal = signal;
            return pending;
          }
        );
        port.replaceDelegate(
          Object.assign(new UnavailableKnowledgeStudioPort(), { runSelectedJob })
        );
        const result = port.runSelectedJob("reading", "selected", 7, new AbortController().signal);
        expect(runSelectedJob).toHaveBeenCalledWith(
          "reading",
          "selected",
          7,
          expect.any(AbortSignal)
        );
        port.replaceDelegate(new UnavailableKnowledgeStudioPort());
        expect(capturedSignal.aborted).toBe(true);
        finish();
        await expect(result).resolves.toBeUndefined();
        expect(runSelectedJob).toHaveBeenCalledTimes(1);
        port.dispose();
      });
      it(`fails closed for unavailable delegates and before-caller cancellation (${ISSUE})`, async () => {
        const port = new DelegatingKnowledgeStudioPort();
        await expect(
          port.runSelectedJob("reading", "selected", 7, new AbortController().signal)
        ).rejects.toThrow("not configured");
        const runSelectedJob = jest.fn(async () => undefined);
        port.replaceDelegate(
          Object.assign(new UnavailableKnowledgeStudioPort(), { runSelectedJob })
        );
        const abort = new AbortController();
        abort.abort();
        await expect(
          port.runSelectedJob("reading", "selected", 7, abort.signal)
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(runSelectedJob).not.toHaveBeenCalled();
        port.dispose();
      });
    });
  });
});
