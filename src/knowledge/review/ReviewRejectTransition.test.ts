import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitPlanDigest,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet } from "@/knowledge/model/types";
import {
  KnowledgeLiteralRejectCommandError,
  KnowledgeReviewRejectConflictError,
  parseKnowledgeLiteralRejectCommand,
  projectKnowledgeReviewRejection,
  type KnowledgeLiteralRejectCommand,
} from "@/knowledge/review/ReviewRejectTransition";
import type { ChangeSetReviewSnapshot } from "@/knowledge/review/ReviewStorage";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Creates one strict proposed ChangeSet with a single create target. */
function createProposal(): KnowledgeChangeSet {
  const afterContent = "# Atomic rejection\n";
  return {
    id: "changeset-reject",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: "change-reject",
        operation: "create",
        path: "Wiki/Atomic rejection.md",
        sourceRefs: ["source-1"],
        reason: "Compile one grounded page",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 90,
  };
}

/** Creates one immutable Manifest plan bound to the proposed ChangeSet. */
function createManifestPlan(proposal: KnowledgeChangeSet): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: proposal.bundleId,
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_C,
    baseGeneratedPages: [],
    mutations: proposal.changes.map((change) => ({
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: "create_only" as const,
      ownership: "generated" as const,
      wasTrackedByPrimarySource: false,
    })),
  };
}

/** Creates exact pending Queue and Review state for one durable proposal. */
function createPendingState(): {
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;
  command: KnowledgeLiteralRejectCommand;
} {
  const proposal = createProposal();
  const proposalDigest = createChangeSetTransactionDigest(proposal);
  const manifestCommitPlan = createManifestPlan(proposal);
  return {
    queue: {
      version: INGEST_QUEUE_VERSION,
      bundleId: "personal",
      revision: 7,
      control: { status: "running" },
      jobs: [
        {
          id: "job-reject",
          bundleId: "personal",
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 1,
          attempt: 1,
          rerunRequested: false,
          createdAt: 100,
          updatedAt: 120,
          status: "awaiting_review",
          stage: "review",
          changeSetId: proposal.id,
        },
      ],
      reruns: [],
      sourceHighWatermarks: [],
      pendingReviews: [
        {
          kind: "durable",
          jobId: "job-reject",
          changeSetId: proposal.id,
          proposalDigest,
          reviewRecordRevision: 0,
          recordedAt: 110,
        },
      ],
      reviewRejections: [],
      applyAbandonments: [],
    },
    review: {
      version: 2,
      bundleId: "personal",
      revision: 4,
      records: [
        {
          changeSetId: proposal.id,
          proposal,
          proposalDigest,
          manifestCommitPlan,
          manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
          jobClaim: {
            jobId: "job-reject",
            sourceId: "source-1",
            sourceContentHash: HASH_A,
            pipelineFingerprint: HASH_B,
            inputRevision: 1,
            attempt: 1,
          },
          recordedAt: 110,
          outcome: "pending",
          recordRevision: 0,
        },
      ],
    },
    command: {
      changeSetId: proposal.id,
      proposalDigest,
      expectedSnapshotToken: HASH_C,
      decisions: [{ changeId: proposal.changes[0].id, decision: "reject" }],
    },
  };
}

/** Captures one expected synchronous error without relying on untyped Jest matchers. */
function captureThrownError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error instance");
  }
  throw new Error("Expected operation to throw");
}

describe("parseKnowledgeLiteralRejectCommand", () => {
  it("captures and freezes only exact all-literal-reject commands", () => {
    const { command } = createPendingState();

    const parsed = parseKnowledgeLiteralRejectCommand(command);

    expect(parsed).toEqual(command);
    expect(parsed).not.toBe(command);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.decisions)).toBe(true);
    expect(Object.isFrozen(parsed.decisions[0])).toBe(true);
  });

  it.each([
    {
      name: "accept_exact",
      mutate: (command: Record<string, unknown>) => {
        command.decisions = [{ changeId: "change-reject", decision: "accept_exact" }];
      },
      reason: "decision_invalid",
    },
    {
      name: "accept_blocks that collapses to no selected changes",
      mutate: (command: Record<string, unknown>) => {
        command.decisions = [
          { changeId: "change-reject", decision: "accept_blocks", acceptedBlockIds: [] },
        ];
      },
      reason: "decision_invalid",
    },
    {
      name: "duplicate reject",
      mutate: (command: Record<string, unknown>) => {
        command.decisions = [
          { changeId: "change-reject", decision: "reject" },
          { changeId: "change-reject", decision: "reject" },
        ];
      },
      reason: "decision_duplicate",
    },
    {
      name: "unsupported command field",
      mutate: (command: Record<string, unknown>) => {
        command.acceptedChangeSet = {};
      },
      reason: "command_invalid",
    },
  ])("rejects $name without widening Reject authority", ({ mutate, reason }) => {
    const { command } = createPendingState();
    const value = { ...command, decisions: [...command.decisions] } as Record<string, unknown>;
    mutate(value);

    expect(captureThrownError(() => parseKnowledgeLiteralRejectCommand(value))).toMatchObject({
      reason,
    });
  });

  it("rejects accessors, sparse arrays, and hostile reflection without evaluating values", () => {
    const { command } = createPendingState();
    let getterCalls = 0;
    const accessorCommand = { ...command } as Record<string, unknown>;
    Object.defineProperty(accessorCommand, "decisions", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return command.decisions;
      },
    });
    const sparseDecisions: unknown[] = [];
    sparseDecisions.length = 1;
    const sparse = { ...command, decisions: sparseDecisions };
    const oversizedSparse: unknown[] = [];
    oversizedSparse.length = 4_294_967_295;
    const oversized = { ...command, decisions: oversizedSparse };
    const hostile = new Proxy(command, {
      ownKeys: () => {
        throw new Error("hostile reflection");
      },
    });

    for (const value of [accessorCommand, sparse, oversized, hostile]) {
      expect(() => parseKnowledgeLiteralRejectCommand(value)).toThrow(
        KnowledgeLiteralRejectCommandError
      );
    }
    expect(getterCalls).toBe(0);
  });
});

describe("projectKnowledgeReviewRejection", () => {
  it("projects pending Review and Queue state together without mutating its inputs", () => {
    const state = createPendingState();
    const beforeQueue = JSON.stringify(state.queue);
    const beforeReview = JSON.stringify(state.review);

    const projected = projectKnowledgeReviewRejection({
      bundleId: "personal",
      ...state,
      decidedAt: 125,
    });

    expect(projected.kind).toBe("changed");
    if (projected.kind !== "changed") throw new Error("Expected a changed projection");
    expect(projected.review).toMatchObject({
      revision: 5,
      records: [
        {
          changeSetId: "changeset-reject",
          outcome: "rejected",
          recordRevision: 1,
          rejectedAt: 125,
        },
      ],
    });
    expect(projected.queue).toMatchObject({
      revision: 8,
      pendingReviews: [],
      jobs: [
        {
          id: "job-reject",
          status: "cancelled",
          stage: "cancelled",
          updatedAt: 125,
          cancelledAt: 125,
          rerunRequested: false,
        },
      ],
      reviewRejections: [
        {
          jobId: "job-reject",
          changeSetId: "changeset-reject",
          reviewRecordRevision: 1,
          decisionAt: 125,
          rejectedAt: 125,
        },
      ],
    });
    expect(projected.receipt).toMatchObject({
      outcome: "rejected",
      queueRevision: 8,
      reviewRevision: 5,
      recordRevision: 1,
      rejectedAt: 125,
      cancelledAt: 125,
    });
    expect(JSON.stringify(state.queue)).toBe(beforeQueue);
    expect(JSON.stringify(state.review)).toBe(beforeReview);
  });

  it("promotes the exact retained rerun in the same Queue projection", () => {
    const state = createPendingState();
    state.queue.jobs[0].rerunRequested = true;
    state.queue.reruns = [
      {
        jobId: "job-rerun",
        sourceId: "source-1",
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
        inputRevision: 2,
        requestedAt: 115,
        updatedAt: 123,
      },
    ];

    const projected = projectKnowledgeReviewRejection({
      bundleId: "personal",
      ...state,
      decidedAt: 125,
    });

    expect(projected.kind).toBe("changed");
    if (projected.kind !== "changed") throw new Error("Expected a changed projection");
    expect(projected.queue.reruns).toEqual([]);
    expect(projected.queue.jobs).toEqual([
      expect.objectContaining({ id: "job-reject", status: "cancelled" }),
      {
        id: "job-rerun",
        bundleId: "personal",
        sourceId: "source-1",
        sourceContentHash: HASH_C,
        pipelineFingerprint: HASH_B,
        inputRevision: 2,
        attempt: 0,
        rerunRequested: false,
        createdAt: 115,
        updatedAt: 125,
        status: "pending",
        stage: "queued",
      },
    ]);
  });

  it("recognizes only an exact terminal projection and leaves it byte-preserving", () => {
    const state = createPendingState();
    const first = projectKnowledgeReviewRejection({
      bundleId: "personal",
      ...state,
      decidedAt: 125,
    });
    if (first.kind !== "changed") throw new Error("Expected a changed projection");
    const queueBefore = JSON.stringify(first.queue);
    const reviewBefore = JSON.stringify(first.review);

    const replay = projectKnowledgeReviewRejection({
      bundleId: "personal",
      queue: first.queue,
      review: first.review,
      command: state.command,
      decidedAt: 999,
    });

    expect(replay).toEqual({ kind: "already_rejected", receipt: first.receipt });
    expect(JSON.stringify(first.queue)).toBe(queueBefore);
    expect(JSON.stringify(first.review)).toBe(reviewBefore);
  });

  it.each([
    {
      name: "different durable anchor digest",
      mutate: (state: ReturnType<typeof createPendingState>) => {
        const anchor = state.queue.pendingReviews[0];
        if (anchor.kind === "durable") anchor.proposalDigest = HASH_C;
      },
      reason: "queue_anchor_mismatch",
    },
    {
      name: "different Queue job attempt",
      mutate: (state: ReturnType<typeof createPendingState>) => {
        state.queue.jobs[0].attempt = 2;
      },
      reason: "queue_anchor_mismatch",
    },
    {
      name: "different decision identity",
      mutate: (state: ReturnType<typeof createPendingState>) => {
        state.command = {
          ...state.command,
          decisions: [{ changeId: "change-other", decision: "reject" }],
        };
      },
      reason: "decision_set_mismatch",
    },
  ])("fails closed for $name", ({ mutate, reason }) => {
    const state = createPendingState();
    mutate(state);
    const before = JSON.stringify(state);

    expect(
      captureThrownError(() =>
        projectKnowledgeReviewRejection({ bundleId: "personal", ...state, decidedAt: 125 })
      )
    ).toMatchObject({ reason });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("fails closed instead of replaying a torn rejected terminal state", () => {
    const state = createPendingState();
    const first = projectKnowledgeReviewRejection({
      bundleId: "personal",
      ...state,
      decidedAt: 125,
    });
    if (first.kind !== "changed") throw new Error("Expected a changed projection");
    first.queue.reviewRejections[0].rejectedAt += 1;

    const error = captureThrownError(() =>
      projectKnowledgeReviewRejection({
        bundleId: "personal",
        queue: first.queue,
        review: first.review,
        command: state.command,
        decidedAt: 126,
      })
    );
    expect(error).toBeInstanceOf(KnowledgeReviewRejectConflictError);
    expect(error).toMatchObject({ reason: "rejected_final_mismatch" });
  });

  it("refuses subsystem revision overflow before projecting any state", () => {
    const state = createPendingState();
    state.queue.revision = Number.MAX_SAFE_INTEGER;

    expect(
      captureThrownError(() =>
        projectKnowledgeReviewRejection({ bundleId: "personal", ...state, decidedAt: 125 })
      )
    ).toMatchObject({ reason: "revision_overflow" });
  });
});
