import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { KnowledgeReviewPanel } from "@/components/knowledge/KnowledgeReviewPanel";
import type {
  KnowledgeReviewBlock,
  KnowledgeReviewCommand,
  KnowledgeReviewFile,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

/**
 * Creates one changed review block for a focused UI fixture.
 *
 * @param blockId - Opaque block identity
 * @param before - Exact original text
 * @param after - Exact modified text
 * @returns Detached changed block
 */
function createChangedBlock(blockId: string, before: string, after: string): KnowledgeReviewBlock {
  return {
    blockId,
    kind: "change",
    parts: [
      { kind: "removed", value: before },
      { kind: "added", value: after },
    ],
  };
}

/**
 * Creates one review file with safe defaults.
 *
 * @param overrides - Fields that distinguish the test case
 * @returns Complete review file fixture
 */
function createReviewFile(overrides: Partial<KnowledgeReviewFile> = {}): KnowledgeReviewFile {
  return {
    changeId: "change-1",
    path: "Knowledge/First.md",
    operation: "update",
    reason: "Refresh source-backed knowledge",
    sourceRefs: ["source-1"],
    integrity: "current",
    capability: "blocks_allowed",
    beforeContent: "before\n",
    afterContent: "after\n",
    blocks: [createChangedBlock("block-1", "before\n", "after\n")],
    ...overrides,
  };
}

/**
 * Creates one immutable review plan with deterministic identities.
 *
 * @param files - File projections shown in the panel
 * @param snapshotToken - Content-addressed snapshot identity
 * @returns Complete review-plan fixture
 */
function createReviewPlan(
  files: KnowledgeReviewFile[],
  snapshotToken = "snapshot-1"
): KnowledgeReviewPlan {
  return {
    changeSetId: "changeset-1",
    bundleId: "bundle-1",
    proposalDigest: "proposal-digest-1",
    snapshotToken,
    operation: "ingest",
    sourceRefs: ["source-1"],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 1,
    files,
  };
}

/**
 * Finds a named button with its concrete disabled-state type.
 *
 * @param name - Accessible button name
 * @returns Matching HTML button
 */
function getButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

describe("KnowledgeReviewPanel", () => {
  it("accepts eligible files while fail-closed rejecting a blocked delete", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    const update = createReviewFile();
    const deletion = createReviewFile({
      changeId: "change-delete",
      path: "Knowledge/Removed.md",
      operation: "delete",
      capability: "reject_only",
      blockedReason: "review_delete_read_set_not_journaled",
      beforeContent: "old\n",
      afterContent: undefined,
      blocks: [createChangedBlock("delete-block", "old\n", "")],
    });

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([update, deletion])}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByText(/review_delete_read_set_not_journaled/)).toBeTruthy();
    expect(getButton("Accept file Knowledge/Removed.md").disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const command = onSubmit.mock.calls[0][0];
    expect(command).toEqual({
      changeSetId: "changeset-1",
      proposalDigest: "proposal-digest-1",
      expectedSnapshotToken: "snapshot-1",
      decisions: [
        { changeId: "change-1", decision: "accept_exact" },
        { changeId: "change-delete", decision: "reject" },
      ],
    });
    expect(JSON.stringify(command)).not.toMatch(/Knowledge\//);
    expect(JSON.stringify(command)).not.toMatch(/before|after|Hash|Content/);
  });

  it("requires every changed block to be explicit before partial submission", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    const file = createReviewFile({
      blocks: [
        createChangedBlock("block-1", "old one\n", "new one\n"),
        createChangedBlock("block-2", "old two\n", "new two\n"),
      ],
    });

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([file])}
        rejectCommandsEnabled={true}
      />
    );

    const submit = getButton("Submit review");
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Accept block 1 in Knowledge/First.md" }));
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reject block 2 in Knowledge/First.md" }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      changeSetId: "changeset-1",
      proposalDigest: "proposal-digest-1",
      expectedSnapshotToken: "snapshot-1",
      decisions: [
        {
          changeId: "change-1",
          decision: "accept_blocks",
          acceptedBlockIds: ["block-1"],
        },
      ],
    });
  });

  it("rejects every file without requiring partial block decisions", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    const files = [
      createReviewFile(),
      createReviewFile({ changeId: "change-2", path: "Knowledge/Second.md" }),
    ];

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan(files)}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(onSubmit.mock.calls[0][0].decisions).toEqual([
      { changeId: "change-1", decision: "reject" },
      { changeId: "change-2", decision: "reject" },
    ]);
  });

  it("enables only whole-file rejection when acceptance and Wiki apply are unavailable", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={false}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    expect(getButton("Accept all").disabled).toBe(true);
    expect(getButton("Accept file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Accept block 1 in Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Reject block 1 in Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Reject file Knowledge/First.md").disabled).toBe(false);

    fireEvent.click(getButton("Reject file Knowledge/First.md"));
    fireEvent.click(getButton("Submit review"));

    expect(onSubmit).toHaveBeenCalledWith({
      changeSetId: "changeset-1",
      proposalDigest: "proposal-digest-1",
      expectedSnapshotToken: "snapshot-1",
      decisions: [{ changeId: "change-1", decision: "reject" }],
    });
  });

  it("clears local decisions when the content-addressed snapshot changes", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    const file = createReviewFile({
      capability: "exact_only",
      blocks: [
        { blockId: "context-1", kind: "context", parts: [{ kind: "context", value: "same\n" }] },
      ],
    });
    const { rerender } = render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([file])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept file Knowledge/First.md" }));
    expect(getButton("Submit review").disabled).toBe(false);

    rerender(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([file], "snapshot-2")}
        rejectCommandsEnabled={true}
      />
    );

    expect(getButton("Submit review").disabled).toBe(true);
    expect(getButton("Accept file Knowledge/First.md").getAttribute("aria-pressed")).toBe("false");
  });

  it("suppresses duplicate submissions while an async command is pending", () => {
    const pendingSubmission = new Promise<void>(() => undefined);
    const onSubmit = jest.fn<Promise<void>, [KnowledgeReviewCommand]>(() => pendingSubmission);

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept file Knowledge/First.md" }));
    const submit = screen.getByRole("button", { name: "Submit review" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(getButton("Submitting…").disabled).toBe(true);
  });

  it("renders the exact diff while disabling every review decision in read-only mode", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={false}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={false}
      />
    );

    expect(screen.getByText("Knowledge/First.md")).toBeTruthy();
    expect(screen.getByText("before", { exact: false })).toBeTruthy();
    expect(getButton("Accept all").disabled).toBe(true);
    expect(getButton("Reject all").disabled).toBe(true);
    expect(getButton("Accept file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Reject file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Review actions unavailable").disabled).toBe(true);

    fireEvent.click(getButton("Accept all"));
    fireEvent.click(getButton("Review actions unavailable"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
