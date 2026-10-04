import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import { deriveKnowledgeActivityModel } from "@/knowledge/ui/activityModel";

function createCompletedSnapshot(): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: "reading",
    revision: 1,
    control: { status: "running" },
    jobs: [
      {
        id: "finished",
        bundleId: "reading",
        sourceId: "source",
        sourceContentHash: "a".repeat(64),
        pipelineFingerprint: "b".repeat(64),
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 10,
        updatedAt: 20,
        status: "completed",
        stage: "completed",
        changeSetId: "changes",
        completedAt: 20,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

describe("activityModel", () => {
  describe("deriveKnowledgeActivityModel()", () => {
    it("retains proven applied completion without inferring it from terminal status — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const options = {
        maxTerminalItems: 50,
        completionOutcomes: { finished: { kind: "applied" as const } },
      };
      const model = deriveKnowledgeActivityModel(createCompletedSnapshot(), options);
      expect(model.items[0]).toMatchObject({
        status: "completed",
        completion: { kind: "applied" },
      });
    });

    it("copies and freezes content-free no-changes diagnostics for the exact job — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const generationOutcomes = { explicitUnchanged: 2, identicalWrites: 1 };
      const completion = {
        kind: "no_changes" as const,
        reason: "all_targets_unchanged" as const,
        generationOutcomes,
      };
      const options = { maxTerminalItems: 50, completionOutcomes: { finished: completion } };
      const model = deriveKnowledgeActivityModel(createCompletedSnapshot(), options);
      expect(model.items[0]).toMatchObject({ completion });
      generationOutcomes.explicitUnchanged = 99;
      expect(model.items[0]).toMatchObject({
        completion: { generationOutcomes: { explicitUnchanged: 2, identicalWrites: 1 } },
      });
      const projected = (model.items[0] as unknown as { completion: typeof completion }).completion;
      expect(Object.isFrozen(projected)).toBe(true);
      expect(Object.isFrozen(projected.generationOutcomes)).toBe(true);
    });

    it("leaves old or unrelated completed rows unknown instead of borrowing another job outcome — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const options = {
        maxTerminalItems: 50,
        completionOutcomes: { other: { kind: "applied" as const } },
      };
      expect(deriveKnowledgeActivityModel(createCompletedSnapshot()).items[0]).not.toHaveProperty(
        "completion"
      );
      expect(
        deriveKnowledgeActivityModel(createCompletedSnapshot(), options).items[0]
      ).not.toHaveProperty("completion");
      const inheritedName = createCompletedSnapshot();
      inheritedName.jobs[0].id = "constructor";
      expect(deriveKnowledgeActivityModel(inheritedName, options).items[0]).not.toHaveProperty(
        "completion"
      );
    });

    it("does not project a success outcome while a completed job is still finalizing — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const snapshot = createCompletedSnapshot();
      snapshot.applyCommit = {
        jobId: "finished",
        sourceId: "source",
        sourceContentHash: "a".repeat(64),
        pipelineFingerprint: "b".repeat(64),
        inputRevision: 1,
        attempt: 1,
        startedAt: 10,
        transactionId: "transaction",
        changeSetId: "changes",
        changeSetDigest: "c".repeat(64),
        commitRevision: 1,
        committedAt: 20,
      };
      const options = {
        maxTerminalItems: 50,
        completionOutcomes: { finished: { kind: "applied" as const } },
      };
      const item = deriveKnowledgeActivityModel(snapshot, options).items[0];
      expect(item.status).toBe("finalizing");
      expect(item).not.toHaveProperty("completion");
    });
  });
});
