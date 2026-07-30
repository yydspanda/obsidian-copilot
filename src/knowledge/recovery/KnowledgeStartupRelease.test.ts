import { INGEST_QUEUE_VERSION } from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeStartupGateResult } from "@/knowledge/recovery/KnowledgeStartupGate";
import {
  KnowledgeStartupReleaseCoordinator,
  KnowledgeStartupReleaseDispositionError,
  KnowledgeStartupReleaseRequestError,
  parseKnowledgeStartupReleaseRequest,
  type KnowledgeStartupReleasePort,
} from "@/knowledge/recovery/KnowledgeStartupRelease";

/** Creates one detached observed-clear Gate result for coordinator tests. */
function createGateResult(
  disposition: KnowledgeStartupGateResult["disposition"] = "observed_clear"
): KnowledgeStartupGateResult {
  return {
    bundleId: "personal",
    disposition,
    runtimeRevision: 9,
    reviewRevision: 4,
    queueSnapshot: {
      version: INGEST_QUEUE_VERSION,
      bundleId: "personal",
      revision: 6,
      control: { status: "paused", reason: "startup_recovery", pausedAt: 20 },
      jobs: [],
      reruns: [],
      sourceHighWatermarks: [],
      pendingReviews: [],
      reviewRejections: [],
      applyAbandonments: [],
    },
    globalTransaction: null,
    applyCommit: { kind: "none" },
    reviewReconciliations: [],
    acceptedClassifications: [],
    attention: [],
  };
}

describe("KnowledgeStartupReleaseCoordinator", () => {
  it("delegates only the narrow optimistic token from an observed-clear Gate result", async () => {
    const release: KnowledgeStartupReleasePort["release"] = jest.fn(async (request) => ({
      kind: "observation_changed" as const,
      bundleId: request.bundleId,
      boundary: "runtime" as const,
    }));
    const coordinator = new KnowledgeStartupReleaseCoordinator({ release });

    await expect(coordinator.release(createGateResult())).resolves.toEqual({
      kind: "observation_changed",
      bundleId: "personal",
      boundary: "runtime",
    });
    expect(release).toHaveBeenCalledWith({
      bundleId: "personal",
      expectedRuntimeRevision: 9,
      expectedReviewRevision: 4,
      expectedQueueRevision: 6,
    });
  });

  it.each(["attention_required", "blocked"] as const)(
    "rejects a %s Gate result before calling the Runtime port",
    async (disposition) => {
      const release: KnowledgeStartupReleasePort["release"] = jest.fn();
      const coordinator = new KnowledgeStartupReleaseCoordinator({ release });

      await expect(coordinator.release(createGateResult(disposition))).rejects.toMatchObject({
        name: KnowledgeStartupReleaseDispositionError.name,
        disposition,
      });
      expect(release).not.toHaveBeenCalled();
    }
  );
});

describe("parseKnowledgeStartupReleaseRequest", () => {
  it("returns a detached strict request", () => {
    const request = {
      bundleId: "personal",
      expectedRuntimeRevision: 9,
      expectedReviewRevision: 4,
      expectedQueueRevision: 6,
    };

    expect(parseKnowledgeStartupReleaseRequest(request)).toEqual(request);
  });

  it.each([
    null,
    {},
    {
      bundleId: "",
      expectedRuntimeRevision: 0,
      expectedReviewRevision: 0,
      expectedQueueRevision: 0,
    },
    {
      bundleId: "personal",
      expectedRuntimeRevision: -1,
      expectedReviewRevision: 0,
      expectedQueueRevision: 0,
    },
    {
      bundleId: "personal",
      expectedRuntimeRevision: 0,
      expectedReviewRevision: Number.NaN,
      expectedQueueRevision: 0,
    },
    {
      bundleId: "personal",
      expectedRuntimeRevision: 0,
      expectedReviewRevision: 0,
      expectedQueueRevision: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      bundleId: "personal",
      expectedRuntimeRevision: 0,
      expectedReviewRevision: 0,
      expectedQueueRevision: 0,
      unexpected: true,
    },
  ])("rejects malformed optimistic token %#", (value) => {
    expect(() => parseKnowledgeStartupReleaseRequest(value)).toThrow(
      KnowledgeStartupReleaseRequestError
    );
  });
});
