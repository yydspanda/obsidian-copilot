import {
  createUnavailableKnowledgeStudioSnapshot,
  KnowledgeStudioController,
  UnavailableKnowledgeStudioPort,
  type KnowledgeStudioCommandPort,
  type KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";

function createSnapshot(): KnowledgeStudioSnapshot {
  const base = createUnavailableKnowledgeStudioSnapshot("reading");
  return {
    ...base,
    availability: "ready",
    revisionToken: "reading-7",
    commandCapabilities: { ...base.commandCapabilities, reanalyzeJob: true },
    activity: {
      ...base.activity,
      revision: 7,
      controls: { state: "paused", canPause: false, canResume: true },
      items: [
        {
          id: "completed-1",
          sourceId: "source-1",
          inputRevision: 2,
          attempt: 1,
          status: "completed",
          durableStage: "completed",
          createdAt: 10,
          updatedAt: 20,
          terminal: true,
          rerunRequested: false,
          actions: { canCancel: false, canRetry: false, canReview: false, canReanalyze: true },
        },
      ],
      counts: {
        ...base.activity.counts,
        total: 1,
        terminal: 1,
        byStatus: { ...base.activity.counts.byStatus, completed: 1 },
      },
    },
  };
}

async function createController(
  snapshot = createSnapshot(),
  command = jest.fn(async () => undefined)
) {
  const commands: KnowledgeStudioCommandPort = Object.assign(new UnavailableKnowledgeStudioPort(), {
    reanalyzeJob: command,
  });
  const read = { load: jest.fn(async () => snapshot), subscribe: () => () => undefined };
  const controller = new KnowledgeStudioController(read, commands);
  controller.start("reading");
  await controller.refresh();
  return { controller, commands, command, read, snapshot };
}

describe("KnowledgeStudioController", () => {
  describe("KnowledgeStudioController", () => {
    describe("reanalyzeJob()", () => {
      it("queues the confirmed completed job at the visible revision and leaves Resume to the user — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const { controller, command } = await createController();
        await controller.reanalyzeJob("completed-1");
        expect(command).toHaveBeenCalledWith("reading", "completed-1", 7, expect.any(AbortSignal));
        expect(controller.getState().feedback).toEqual({
          kind: "success",
          message: "New analysis queued. The bundle remains paused; use Resume bundle when ready.",
        });
        expect(controller.getState().snapshot?.activity.controls.state).toBe("paused");
        controller.destroy();
      });

      it.each([
        "missing-capability",
        "missing-method",
        "ineligible",
        "running",
        "finalizing",
        "unknown-job",
      ])(
        "rejects %s without sending a paid-work command — https://github.com/yydspanda/obsidian-copilot/issues/16",
        async (condition) => {
          const snapshot = createSnapshot();
          if (condition === "missing-capability")
            snapshot.commandCapabilities = {
              ...snapshot.commandCapabilities,
              reanalyzeJob: undefined,
            };
          if (condition === "ineligible")
            snapshot.activity = {
              ...snapshot.activity,
              items: snapshot.activity.items.map((item) => ({
                ...item,
                actions: { ...item.actions, canReanalyze: false },
              })),
            };
          if (condition === "running")
            snapshot.activity = {
              ...snapshot.activity,
              controls: { state: "running", canPause: true, canResume: false },
            };
          if (condition === "finalizing")
            snapshot.activity = {
              ...snapshot.activity,
              items: snapshot.activity.items.map((item) => ({ ...item, status: "finalizing" })),
            };
          const { controller, commands, command } = await createController(snapshot);
          if (condition === "missing-method") delete commands.reanalyzeJob;
          await controller.reanalyzeJob(condition === "unknown-job" ? "other" : "completed-1");
          expect(command).not.toHaveBeenCalled();
          expect(controller.getState().feedback?.kind).toBe("blocked");
          controller.destroy();
        }
      );

      it("serializes repeated confirmations and cancels the old session without publishing late success — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        let finish!: () => void;
        const pending = new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        });
        const { controller, command } = await createController(
          createSnapshot(),
          jest.fn(() => pending)
        );
        const first = controller.reanalyzeJob("completed-1");
        await controller.reanalyzeJob("completed-1");
        expect(command).toHaveBeenCalledTimes(1);
        expect(controller.getState().pendingAction).toEqual({
          kind: "reanalyze",
          targetId: "completed-1",
        });
        const signal = (
          command.mock.calls[0] as unknown as [string, string, number, AbortSignal]
        )[3];
        controller.stop();
        expect(signal.aborted).toBe(true);
        finish();
        await first;
        expect(controller.getState().feedback).toBeUndefined();
        controller.destroy();
      });

      it("reports backend rejection safely and reloads durable state instead of retrying — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const command = jest.fn(async () => {
          throw new Error("private source details");
        });
        const { controller, read } = await createController(createSnapshot(), command);
        const before = read.load.mock.calls.length;
        await controller.reanalyzeJob("completed-1");
        expect(command).toHaveBeenCalledTimes(1);
        expect(read.load.mock.calls.length).toBeGreaterThan(before);
        expect(controller.getState().feedback?.kind).toBe("error");
        expect(JSON.stringify(controller.getState())).not.toContain("private source details");
        controller.destroy();
      });
    });

    describe("refresh()", () => {
      it("rejects a malformed optional reanalysis capability instead of treating it as consent — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
        const snapshot = createSnapshot();
        snapshot.commandCapabilities = {
          ...snapshot.commandCapabilities,
          reanalyzeJob: "yes" as unknown as boolean,
        };
        const { controller } = await createController(snapshot);
        expect(controller.getState().status).toBe("error");
        expect(controller.getState().snapshot).toBeUndefined();
        controller.destroy();
      });
    });
  });
});
