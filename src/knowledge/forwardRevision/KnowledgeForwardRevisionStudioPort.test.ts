import {
  createKnowledgeForwardRevisionStudioAbandonCommand,
  createKnowledgeForwardRevisionStudioApplyCommand,
  createKnowledgeForwardRevisionStudioCommandFromReview,
  snapshotKnowledgeForwardRevisionStudioCommand,
  type KnowledgeForwardRevisionStudioAcceptedReadyReview,
  type KnowledgeForwardRevisionStudioPendingReview,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import type { KnowledgeReviewPlan } from "@/knowledge/review/ReviewDecision";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const REVIEW_REF = `forward-studio-review-${HASH_A}`;
const SNAPSHOT_REF = `forward-studio-snapshot-${HASH_B}`;
const BLOCK_REF = `review-block-${HASH_A}`;

/** Creates one frozen single-file display plan accepted by the reusable Review UI boundary. */
function createPlan(): Readonly<KnowledgeReviewPlan> {
  return Object.freeze({
    changeSetId: REVIEW_REF,
    bundleId: "bundle-a",
    proposalDigest: HASH_A,
    snapshotToken: HASH_B,
    operation: "ingest" as const,
    sourceRefs: Object.freeze(["source-a"]) as unknown as string[],
    validation: Object.freeze({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    }),
    createdAt: 10,
    evidence: Object.freeze([]),
    omittedEvidenceCount: 0,
    files: Object.freeze([
      Object.freeze({
        changeId: "forward-change-a",
        path: "Wiki/Page.md",
        operation: "update" as const,
        reason: "Forward revision",
        sourceRefs: Object.freeze(["source-a"]) as unknown as string[],
        integrity: "current" as const,
        capability: "blocks_allowed" as const,
        beforeContent: "before\n",
        afterContent: "after\n",
        blocks: Object.freeze([
          Object.freeze({
            blockId: BLOCK_REF,
            kind: "change" as const,
            parts: Object.freeze([
              Object.freeze({ kind: "removed" as const, value: "before\n" }),
              Object.freeze({ kind: "added" as const, value: "after\n" }),
            ]) as unknown as { kind: "removed" | "added"; value: string }[],
          }),
        ]) as unknown as KnowledgeReviewPlan["files"][number]["blocks"],
      }),
    ]) as unknown as KnowledgeReviewPlan["files"],
  });
}

/** Creates one current pending product row for command-conversion tests. */
function createPendingReview(): Readonly<KnowledgeForwardRevisionStudioPendingReview> {
  return Object.freeze({
    state: "pending" as const,
    reviewRef: REVIEW_REF,
    snapshotRef: SNAPSHOT_REF,
    pagePath: "Wiki/Page.md",
    updatedAt: 10,
    requestedAt: 9,
    selectedAppliedAt: 5,
    plan: createPlan(),
  });
}

describe("KnowledgeForwardRevisionStudioPort", () => {
  it("converts exact, edited, block, and Apply actions without durable identifiers", () => {
    const review = createPendingReview();
    expect(
      createKnowledgeForwardRevisionStudioCommandFromReview(review, {
        changeSetId: REVIEW_REF,
        proposalDigest: HASH_A,
        expectedSnapshotToken: HASH_B,
        decisions: [{ changeId: "forward-change-a", decision: "accept_exact" }],
      })
    ).toEqual({
      version: 1,
      kind: "forward_revision_studio_command",
      reviewRef: REVIEW_REF,
      snapshotRef: SNAPSHOT_REF,
      action: "accept_exact",
    });
    expect(
      createKnowledgeForwardRevisionStudioCommandFromReview(review, {
        changeSetId: REVIEW_REF,
        proposalDigest: HASH_A,
        expectedSnapshotToken: HASH_B,
        decisions: [
          {
            changeId: "forward-change-a",
            decision: "accept_edited",
            afterContent: "manual\n",
          },
        ],
      })
    ).toMatchObject({ action: "accept_edited", afterContent: "manual\n" });
    expect(
      createKnowledgeForwardRevisionStudioCommandFromReview(review, {
        changeSetId: REVIEW_REF,
        proposalDigest: HASH_A,
        expectedSnapshotToken: HASH_B,
        decisions: [
          {
            changeId: "forward-change-a",
            decision: "accept_blocks",
            acceptedBlockIds: [BLOCK_REF],
          },
        ],
      })
    ).toMatchObject({ action: "accept_blocks", acceptedBlockIds: [BLOCK_REF] });

    const accepted: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyReview> = Object.freeze({
      state: "accepted_ready",
      reviewRef: REVIEW_REF,
      snapshotRef: SNAPSHOT_REF,
      pagePath: "Wiki/Page.md",
      updatedAt: 20,
      acceptedAt: 20,
      manualOverride: false,
    });
    expect(createKnowledgeForwardRevisionStudioApplyCommand(accepted)).toMatchObject({
      action: "apply",
      reviewRef: REVIEW_REF,
      snapshotRef: SNAPSHOT_REF,
    });
    expect(createKnowledgeForwardRevisionStudioAbandonCommand(accepted)).toMatchObject({
      action: "abandon",
      reviewRef: REVIEW_REF,
      snapshotRef: SNAPSHOT_REF,
    });
  });

  it("accepts an empty partial selection and returns a deeply detached frozen command", () => {
    const acceptedBlockIds: string[] = [];
    const command = snapshotKnowledgeForwardRevisionStudioCommand({
      version: 1,
      kind: "forward_revision_studio_command",
      reviewRef: REVIEW_REF,
      snapshotRef: SNAPSHOT_REF,
      action: "accept_blocks",
      acceptedBlockIds,
    });
    acceptedBlockIds.push(BLOCK_REF);
    expect(command).toMatchObject({ action: "accept_blocks", acceptedBlockIds: [] });
    expect(Object.isFrozen(command)).toBe(true);
    expect(
      Object.isFrozen(command.action === "accept_blocks" ? command.acceptedBlockIds : [])
    ).toBe(true);
  });

  it("rejects accessors, sparse arrays, duplicate blocks, invalid controls, and stale plans", () => {
    const getter = Object.defineProperty(
      {
        version: 1,
        kind: "forward_revision_studio_command",
        reviewRef: REVIEW_REF,
        snapshotRef: SNAPSHOT_REF,
      },
      "action",
      { enumerable: true, get: () => "apply" }
    );
    expect(() => snapshotKnowledgeForwardRevisionStudioCommand(getter)).toThrow(TypeError);

    const sparse: string[] = [];
    sparse.length = 2;
    sparse[1] = BLOCK_REF;
    expect(() =>
      snapshotKnowledgeForwardRevisionStudioCommand({
        version: 1,
        kind: "forward_revision_studio_command",
        reviewRef: REVIEW_REF,
        snapshotRef: SNAPSHOT_REF,
        action: "accept_blocks",
        acceptedBlockIds: sparse,
      })
    ).toThrow(TypeError);
    expect(() =>
      snapshotKnowledgeForwardRevisionStudioCommand({
        version: 1,
        kind: "forward_revision_studio_command",
        reviewRef: REVIEW_REF,
        snapshotRef: SNAPSHOT_REF,
        action: "accept_blocks",
        acceptedBlockIds: [BLOCK_REF, BLOCK_REF],
      })
    ).toThrow(TypeError);
    expect(() =>
      snapshotKnowledgeForwardRevisionStudioCommand({
        version: 1,
        kind: "forward_revision_studio_command",
        reviewRef: REVIEW_REF,
        snapshotRef: SNAPSHOT_REF,
        action: "accept_edited",
        afterContent: "bad\u0000text",
      })
    ).toThrow(TypeError);
    expect(() =>
      createKnowledgeForwardRevisionStudioCommandFromReview(createPendingReview(), {
        changeSetId: REVIEW_REF,
        proposalDigest: HASH_A,
        expectedSnapshotToken: "c".repeat(64),
        decisions: [{ changeId: "forward-change-a", decision: "reject" }],
      })
    ).toThrow(TypeError);
  });
});
