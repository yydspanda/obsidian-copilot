import type { CompilerTargetResolver } from "@/knowledge/compiler/CompilerModelPort";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import type {
  KnowledgeReviewEvidenceOpenRequest,
  KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  type ChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import type { KnowledgeRuntimeStudioBundleSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeStudioRuntimeReadAdapter,
  type KnowledgeStudioRuntimePort,
} from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";

/** Returns one strict configured Bundle. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates an empty atomic Runtime projection. */
function createProjection(): KnowledgeRuntimeStudioBundleSnapshot {
  const queue: IngestQueueSnapshot = {
    version: INGEST_QUEUE_VERSION,
    bundleId: "personal",
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
  const review: ChangeSetReviewSnapshot = {
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId: "personal",
    revision: 0,
    records: [],
  };
  return { bundleId: "personal", runtimeRevision: 1, queue, review };
}

/** Minimal fixed Runtime facade. */
class FixedRuntime implements KnowledgeStudioRuntimePort {
  /** Returns the same empty projection for each consistency read. */
  async readStudioBundle(): Promise<KnowledgeRuntimeStudioBundleSnapshot> {
    return createProjection();
  }

  /** Provides an inert hint subscription. */
  subscribeStudioBundle(): () => void {
    return () => undefined;
  }
}

const resolver: CompilerTargetResolver = {
  /** No pending Review means target resolution is never invoked. */
  resolve: async () => [],
};
const request: Readonly<KnowledgeReviewEvidenceOpenRequest> = Object.freeze({
  changeSetId: "changeset-1",
  proposalDigest: "a".repeat(64),
  expectedSnapshotToken: "b".repeat(64),
  evidenceRef: "c".repeat(64),
});

describe("KnowledgeStudioRuntimeReadAdapter Review evidence", () => {
  it("publishes capability and delegates the exact opaque request when installed", async () => {
    const calls: Array<{
      bundleId: string;
      request: Readonly<KnowledgeReviewEvidenceOpenRequest>;
      signal: AbortSignal;
    }> = [];
    const reviewEvidence: KnowledgeStudioReviewEvidencePort = {
      openReviewEvidence: async (bundleId, value, signal) => {
        calls.push({ bundleId, request: value, signal });
        return { kind: "stale" };
      },
    };
    const adapter = new KnowledgeStudioRuntimeReadAdapter({
      runtime: new FixedRuntime(),
      bundles: [createBundle()],
      targetResolver: resolver,
      assertCurrent: () => undefined,
      reviewEvidence,
    });
    const signal = new AbortController().signal;

    await expect(adapter.load("personal", signal)).resolves.toMatchObject({
      reviewEvidenceAvailable: true,
    });
    await expect(adapter.openReviewEvidence("personal", request, signal)).resolves.toEqual({
      kind: "stale",
    });
    expect(calls).toEqual([{ bundleId: "personal", request, signal }]);
  });

  it("publishes false and rejects without an evidence generation", async () => {
    const adapter = new KnowledgeStudioRuntimeReadAdapter({
      runtime: new FixedRuntime(),
      bundles: [createBundle()],
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });
    const signal = new AbortController().signal;

    await expect(adapter.load("personal", signal)).resolves.toMatchObject({
      reviewEvidenceAvailable: false,
    });
    await expect(adapter.openReviewEvidence("personal", request, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
  });

  it("captures one exact method instead of following caller substitution", async () => {
    const original = jest.fn(
      async (): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> => ({ kind: "opened" })
    );
    const replacement = jest.fn(
      async (): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> => ({ kind: "unavailable" })
    );
    const reviewEvidence = { openReviewEvidence: original };
    const adapter = new KnowledgeStudioRuntimeReadAdapter({
      runtime: new FixedRuntime(),
      bundles: [createBundle()],
      targetResolver: resolver,
      assertCurrent: () => undefined,
      reviewEvidence,
    });
    reviewEvidence.openReviewEvidence = replacement;

    await expect(
      adapter.openReviewEvidence("personal", request, new AbortController().signal)
    ).resolves.toEqual({ kind: "opened" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });
});
