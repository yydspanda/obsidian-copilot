import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { deriveKnowledgeActivityModel } from "@/knowledge/ui/activityModel";

function queuedSnapshot(): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "reading",
    revision: 7,
    control: { status: "paused", reason: "user", pausedAt: 30 },
    jobs: ["first", "selected"].map((id) => ({
      id,
      bundleId: "reading",
      sourceId: id,
      sourceContentHash: "a".repeat(64),
      pipelineFingerprint: "b".repeat(64),
      inputRevision: 1,
      attempt: 0,
      rerunRequested: false,
      createdAt: 10,
      updatedAt: 20,
      status: "pending" as const,
      stage: "queued" as const,
    })),
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

describe("activityModel", () => {
  describe("deriveKnowledgeActivityModel()", () => {
    it("offers an explicit single-material run on pending rows while the bundle stays user-paused — https://github.com/yydspanda/obsidian-copilot/issues/18", () => {
      const model = deriveKnowledgeActivityModel(queuedSnapshot());
      expect(model.controls.state).toBe("paused");
      expect(model.items.map((item) => item.actions)).toEqual([
        expect.objectContaining({ canRunSelected: true }),
        expect.objectContaining({ canRunSelected: true }),
      ]);
      expect(Object.isFrozen(model.items[0].actions)).toBe(true);
    });

    it.each([
      "running",
      "rate_limit",
      "startup_recovery",
      "recovery_required",
      "commit_pending_ack",
    ] as const)(
      "does not offer single-material execution through the %s gate — https://github.com/yydspanda/obsidian-copilot/issues/18",
      (reason) => {
        const snapshot = queuedSnapshot();
        snapshot.control =
          reason === "running" ? { status: "running" } : { status: "paused", reason, pausedAt: 30 };
        expect(
          deriveKnowledgeActivityModel(snapshot).items.every((item) => !item.actions.canRunSelected)
        ).toBe(true);
      }
    );

    it("withholds single-material execution during another processing job and for scheduled retries — https://github.com/yydspanda/obsidian-copilot/issues/18", () => {
      const snapshot = queuedSnapshot();
      snapshot.jobs[0] = {
        ...snapshot.jobs[0],
        status: "processing",
        stage: "analyzing",
        startedAt: 20,
      };
      expect(
        deriveKnowledgeActivityModel(snapshot).items.every((item) => !item.actions.canRunSelected)
      ).toBe(true);
      snapshot.jobs = [
        { ...queuedSnapshot().jobs[0], status: "pending", stage: "queued", nextAttemptAt: 50 },
      ];
      expect(deriveKnowledgeActivityModel(snapshot).items[0].actions.canRunSelected).not.toBe(true);
    });
  });
});
