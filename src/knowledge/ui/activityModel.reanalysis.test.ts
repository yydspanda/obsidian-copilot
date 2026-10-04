import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { deriveKnowledgeActivityModel } from "@/knowledge/ui/activityModel";

function completedSnapshot(): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "reading",
    revision: 2,
    control: { status: "paused", reason: "user", pausedAt: 30 },
    jobs: ["old", "current"].map((id, index) => ({
      id,
      bundleId: "reading",
      sourceId: "source",
      sourceContentHash: "a".repeat(64),
      pipelineFingerprint: "b".repeat(64),
      inputRevision: index + 1,
      attempt: 1,
      rerunRequested: false,
      createdAt: 10,
      updatedAt: 20 + index,
      status: "completed" as const,
      stage: "completed" as const,
      changeSetId: `changes-${id}`,
      completedAt: 20 + index,
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
    it("offers reanalysis only on the exact completed row admitted by Runtime — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const options = { reanalyzableJobIds: ["current"] };
      const model = deriveKnowledgeActivityModel(completedSnapshot(), options);
      expect(model.items.find((item) => item.id === "current")?.actions).toMatchObject({
        canReanalyze: true,
      });
      expect(model.items.find((item) => item.id === "old")?.actions).not.toHaveProperty(
        "canReanalyze"
      );
      expect(Object.isFrozen(model.items[0].actions)).toBe(true);
    });

    it("keeps legacy snapshots without admission read-only for completed jobs — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      for (const item of deriveKnowledgeActivityModel(completedSnapshot()).items) {
        expect(item.actions).not.toHaveProperty("canReanalyze");
      }
    });

    it("does not expose reanalysis while the completed row is still finalizing — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const snapshot = completedSnapshot();
      snapshot.applyCommit = {
        jobId: "current",
        sourceId: "source",
        sourceContentHash: "a".repeat(64),
        pipelineFingerprint: "b".repeat(64),
        inputRevision: 2,
        attempt: 1,
        startedAt: 10,
        transactionId: "transaction",
        changeSetId: "changes-current",
        changeSetDigest: "c".repeat(64),
        commitRevision: 1,
        committedAt: 21,
      };
      const options = { reanalyzableJobIds: ["current"] };
      const item = deriveKnowledgeActivityModel(snapshot, options).items.find(
        (candidate) => candidate.id === "current"
      );
      expect(item?.status).toBe("finalizing");
      expect(item?.actions).not.toHaveProperty("canReanalyze");
    });
  });
});
