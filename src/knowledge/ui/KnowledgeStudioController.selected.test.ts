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
    commandCapabilities: { ...base.commandCapabilities, runSelectedJob: true },
    activity: {
      ...base.activity,
      revision: 7,
      controls: { state: "paused", pauseReason: "user", canPause: false, canResume: true },
      items: [
        {
          id: "selected",
          sourceId: "source",
          inputRevision: 1,
          attempt: 0,
          status: "queued",
          durableStage: "queued",
          createdAt: 10,
          updatedAt: 20,
          terminal: false,
          rerunRequested: false,
          actions: { canCancel: true, canRetry: false, canReview: false, canRunSelected: true },
        },
      ],
      counts: {
        ...base.activity.counts,
        total: 1,
        active: 1,
        byStatus: { ...base.activity.counts.byStatus, queued: 1 },
      },
    },
  };
}

async function createController(
  snapshot = createSnapshot(),
  command = jest.fn(async () => undefined)
) {
  const commands: KnowledgeStudioCommandPort = Object.assign(new UnavailableKnowledgeStudioPort(), {
    runSelectedJob: command,
  });
  const read = { load: jest.fn(async () => snapshot), subscribe: () => () => undefined };
  const controller = new KnowledgeStudioController(read, commands);
  controller.start("reading");
  await controller.refresh();
  return { controller, commands, command, read };
}

describe("KnowledgeStudioController", () => {
  describe("KnowledgeStudioController", () => {
    describe("runSelectedJob()", () => {
      it("runs the exact confirmed queued job without resuming or claiming Wiki changes — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        const { controller, command } = await createController();
        await controller.runSelectedJob("selected", 7);
        expect(command).toHaveBeenCalledWith("reading", "selected", 7, expect.any(AbortSignal));
        expect(controller.getState().feedback).toEqual({
          kind: "success",
          message:
            "Selected-material run finished. Other materials remain paused. Check its Activity outcome; any proposed changes still need Review and Apply.",
        });
        expect(controller.getState().snapshot?.activity.controls.state).toBe("paused");
        controller.destroy();
      });

      it("rejects a confirmation for an older visible queue revision instead of authorizing the newer row — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        const { controller, command } = await createController();
        await controller.runSelectedJob("selected", 6);
        expect(command).not.toHaveBeenCalled();
        expect(controller.getState().feedback?.kind).toBe("blocked");
        controller.destroy();
      });

      it.each([
        "missing-capability",
        "missing-method",
        "ineligible",
        "running",
        "rate-limited",
        "completed",
        "unknown-job",
      ])(
        "rejects %s without dispatching model work — https://github.com/yydspanda/obsidian-copilot/issues/18",
        async (condition) => {
          const snapshot = createSnapshot();
          if (condition === "missing-capability")
            snapshot.commandCapabilities = {
              ...snapshot.commandCapabilities,
              runSelectedJob: undefined,
            };
          if (condition === "ineligible")
            snapshot.activity = {
              ...snapshot.activity,
              items: snapshot.activity.items.map((item) => ({
                ...item,
                actions: { ...item.actions, canRunSelected: false },
              })),
            };
          if (condition === "completed")
            snapshot.activity = {
              ...snapshot.activity,
              items: snapshot.activity.items.map((item) => ({ ...item, status: "completed" })),
            };
          if (condition === "running")
            snapshot.activity = {
              ...snapshot.activity,
              controls: { state: "running", canPause: true, canResume: false },
            };
          if (condition === "rate-limited")
            snapshot.activity = {
              ...snapshot.activity,
              controls: {
                state: "rate_limited",
                pauseReason: "rate_limit",
                canPause: false,
                canResume: true,
              },
            };
          const { controller, commands, command } = await createController(snapshot);
          if (condition === "missing-method") delete commands.runSelectedJob;
          await controller.runSelectedJob(condition === "unknown-job" ? "other" : "selected", 7);
          expect(command).not.toHaveBeenCalled();
          expect(controller.getState().feedback?.kind).toBe("blocked");
          controller.destroy();
        }
      );

      it("serializes double clicks and suppresses late feedback after session shutdown — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        let finish!: () => void;
        const pending = new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        });
        const { controller, command } = await createController(
          createSnapshot(),
          jest.fn(() => pending)
        );
        const first = controller.runSelectedJob("selected", 7);
        await controller.runSelectedJob("selected", 7);
        expect(command).toHaveBeenCalledTimes(1);
        expect(controller.getState().pendingAction).toEqual({
          kind: "run_selected",
          targetId: "selected",
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

      it("reloads after a rejected single-material run without retrying or revealing private details — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        const command = jest.fn(async () => {
          throw Error("private model detail");
        });
        const { controller, read } = await createController(createSnapshot(), command);
        const before = read.load.mock.calls.length;
        await controller.runSelectedJob("selected", 7);
        expect(command).toHaveBeenCalledTimes(1);
        expect(read.load.mock.calls.length).toBeGreaterThan(before);
        expect(controller.getState().feedback?.kind).toBe("error");
        expect(JSON.stringify(controller.getState())).not.toContain("private model detail");
        controller.destroy();
      });
    });
    describe("cancelJob()", () => {
      it("cancels only the running selected material at a freshly loaded revision while other actions stay blocked — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        let finish!: () => void;
        const pending = new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        });
        const { controller, commands, read } = await createController(
          createSnapshot(),
          jest.fn(() => pending)
        );
        const cancel = jest.fn(async () => undefined);
        commands.cancelJob = cancel;
        const run = controller.runSelectedJob("selected", 7);
        const fresh = createSnapshot();
        fresh.commandCapabilities = { ...fresh.commandCapabilities, cancelJob: true };
        fresh.activity = { ...fresh.activity, revision: 9 };
        read.load.mockResolvedValue(fresh);
        await controller.cancelJob("other");
        expect(cancel).not.toHaveBeenCalled();
        const cancellation = controller.cancelJob("selected");
        await controller.cancelJob("selected");
        expect(controller.getState().selectedRunCancelling).toBe(true);
        await cancellation;
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledWith("reading", "selected", 9, expect.any(AbortSignal));
        expect(controller.getState().pendingAction?.kind).toBe("run_selected");
        fresh.activity = {
          ...fresh.activity,
          items: fresh.activity.items.map((item) => ({
            ...item,
            status: "cancelled",
            durableStage: "cancelled",
            terminal: true,
            actions: { canCancel: false, canRetry: false, canReview: false },
          })),
        };
        finish();
        await run;
        expect(controller.getState().selectedRunCancelling).toBeUndefined();
        expect(controller.getState().snapshot?.activity.items[0].status).toBe("cancelled");
        controller.destroy();
      });

      it("does not dispatch a late cancellation after the original run's session is replaced — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        let finish!: () => void;
        const pending = new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        });
        const { controller, commands, read } = await createController(
          createSnapshot(),
          jest.fn(() => pending)
        );
        const cancel = jest.fn(async () => undefined);
        commands.cancelJob = cancel;
        const run = controller.runSelectedJob("selected", 7);
        let publish!: (value: KnowledgeStudioSnapshot) => void;
        read.load.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              publish = resolve;
            })
        );
        const cancellation = controller.cancelJob("selected");
        controller.stop();
        publish(createSnapshot());
        await cancellation;
        finish();
        await run;
        expect(cancel).not.toHaveBeenCalled();
        expect(controller.getState().status).toBe("idle");
        expect(controller.getState().selectedRunCancelling).toBeUndefined();
        controller.destroy();
      });

      it.each(["no-longer-cancellable", "cancel-rejected"])(
        "preserves the running action and safely unlocks Cancel when %s — https://github.com/yydspanda/obsidian-copilot/issues/18",
        async (condition) => {
          let finish!: () => void;
          const pending = new Promise<undefined>((resolve) => {
            finish = () => resolve(undefined);
          });
          const { controller, commands, read } = await createController(
            createSnapshot(),
            jest.fn(() => pending)
          );
          const cancel = jest.fn(async () => {
            throw Error("private cancellation detail");
          });
          commands.cancelJob = cancel;
          const run = controller.runSelectedJob("selected", 7);
          const fresh = createSnapshot();
          fresh.commandCapabilities = {
            ...fresh.commandCapabilities,
            cancelJob: condition === "cancel-rejected",
          };
          read.load.mockResolvedValue(fresh);
          await controller.cancelJob("selected");
          expect(controller.getState().selectedRunCancelling).toBeUndefined();
          expect(controller.getState().pendingAction?.kind).toBe("run_selected");
          expect(cancel).toHaveBeenCalledTimes(condition === "cancel-rejected" ? 1 : 0);
          expect(JSON.stringify(controller.getState())).not.toContain(
            "private cancellation detail"
          );
          finish();
          await run;
          controller.destroy();
        }
      );
    });
    describe("refresh()", () => {
      it("rejects a non-boolean optional selected-run capability — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
        const snapshot = createSnapshot();
        snapshot.commandCapabilities = {
          ...snapshot.commandCapabilities,
          runSelectedJob: "yes" as unknown as boolean,
        };
        const { controller } = await createController(snapshot);
        expect(controller.getState().status).toBe("error");
        controller.destroy();
      });
    });
  });
});
