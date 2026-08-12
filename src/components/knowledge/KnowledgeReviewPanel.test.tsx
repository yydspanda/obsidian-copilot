import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { KnowledgeReviewPanel } from "@/components/knowledge/KnowledgeReviewPanel";
import type { KnowledgeReviewEvidenceSummary } from "@/knowledge/review/KnowledgeReviewEvidence";
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
  snapshotToken = "snapshot-1",
  evidence: readonly KnowledgeReviewEvidenceSummary[] = []
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
    evidence,
    omittedEvidenceCount: 0,
    files,
  };
}

/** Creates one safe proposal-level evidence summary. */
function createEvidence(
  overrides: Partial<KnowledgeReviewEvidenceSummary> = {}
): KnowledgeReviewEvidenceSummary {
  return {
    evidenceRef: "a".repeat(64),
    relation: "supports",
    excerpt: "A plain source excerpt.",
    truncated: false,
    location: {
      kind: "markdown_lines",
      startLine: 4,
      endLine: 7,
      heading: "Evidence",
      headingTruncated: false,
    },
    ...overrides,
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
  it("requires an explicit blocked-file decision instead of silently rejecting it in bulk", () => {
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
    expect(getButton("Delete file Knowledge/Removed.md").disabled).toBe(true);

    expect(getButton("Use all proposed changes").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use proposed file Knowledge/First.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep current file Knowledge/Removed.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Validate and apply selection" }));

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

    const submit = getButton("Choose all decisions");
    expect(submit.disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Use proposed block 1 in Knowledge/First.md" })
    );
    expect(submit.disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Keep current block 2 in Knowledge/First.md" })
    );
    const apply = getButton("Validate and apply selection");
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

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

    fireEvent.click(screen.getByRole("button", { name: "Skip all changes" }));
    expect(screen.getByText("Rejecting makes no Wiki file changes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));

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

    expect(getButton("Use all proposed changes").disabled).toBe(true);
    expect(getButton("Use proposed file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Use proposed block 1 in Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Keep current block 1 in Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Keep current file Knowledge/First.md").disabled).toBe(false);

    fireEvent.click(getButton("Keep current file Knowledge/First.md"));
    fireEvent.click(getButton("Reject proposal"));

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

    fireEvent.click(screen.getByRole("button", { name: "Use proposed file Knowledge/First.md" }));
    expect(getButton("Validate and apply selection").disabled).toBe(false);

    rerender(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([file], "snapshot-2")}
        rejectCommandsEnabled={true}
      />
    );

    expect(getButton("Choose all decisions").disabled).toBe(true);
    expect(getButton("Use proposed file Knowledge/First.md").getAttribute("aria-pressed")).toBe(
      "false"
    );
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

    fireEvent.click(screen.getByRole("button", { name: "Use proposed file Knowledge/First.md" }));
    const submit = screen.getByRole("button", { name: "Validate and apply selection" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(getButton("Validating and applying…").disabled).toBe(true);
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
    expect(screen.getAllByText("before", { exact: false }).length).toBeGreaterThan(0);
    expect(getButton("Use all proposed changes").disabled).toBe(true);
    expect(getButton("Skip all changes").disabled).toBe(true);
    expect(getButton("Use proposed file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Keep current file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Review actions unavailable").disabled).toBe(true);

    fireEvent.click(getButton("Use all proposed changes"));
    fireEvent.click(getButton("Review actions unavailable"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows bounded proposal evidence without claiming that it proves each block", () => {
    const evidence = [
      createEvidence(),
      createEvidence({
        evidenceRef: "b".repeat(64),
        relation: "contradicts",
        excerpt: "A conflicting excerpt.",
        truncated: true,
        location: {
          kind: "heading",
          heading: "Counterpoint",
          headingTruncated: false,
          occurrence: 2,
        },
      }),
      createEvidence({
        evidenceRef: "c".repeat(64),
        relation: "context",
        excerpt: "PDF context.",
        location: { kind: "pdf_page", page: 12 },
      }),
      createEvidence({
        evidenceRef: "d".repeat(64),
        excerpt: "Exact quoted context.",
        location: { kind: "quote" },
      }),
      createEvidence({
        evidenceRef: "e".repeat(64),
        excerpt: "Evidence under a shortened heading.",
        location: {
          kind: "markdown_lines",
          startLine: 20,
          endLine: 20,
          heading: "Bounded heading",
          headingTruncated: true,
        },
      }),
    ];
    const plan = {
      ...createReviewPlan([createReviewFile()], "snapshot-1", evidence),
      omittedEvidenceCount: 3,
    };

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );

    expect(
      screen.getByRole("complementary", { name: "Source evidence for this proposal" })
    ).toBeTruthy();
    expect(screen.getByText(/do not prove every changed block/)).toBeTruthy();
    expect(screen.getAllByText("Supports generated claim")).toHaveLength(3);
    expect(screen.getByText("Evidence · lines 4–7")).toBeTruthy();
    expect(screen.getByText("Contradicts generated claim")).toBeTruthy();
    expect(screen.getByText("Counterpoint · occurrence 2")).toBeTruthy();
    expect(screen.getByText("Context for generated claim")).toBeTruthy();
    expect(screen.getByText("PDF page 12")).toBeTruthy();
    expect(screen.getByText("Exact quote")).toBeTruthy();
    expect(screen.getByText("Bounded heading… · line 20")).toBeTruthy();
    expect(screen.getByText("Excerpt shortened for review.")).toBeTruthy();
    expect(
      screen.getByText("3 additional evidence items omitted from this bounded preview.")
    ).toBeTruthy();
  });

  it("opens evidence using only its opaque reference and exposes controlled progress", () => {
    const onOpenEvidence = jest.fn<void, [string]>();
    const evidence = createEvidence();
    const plan = createReviewPlan([createReviewFile()], "snapshot-1", [evidence]);
    const { rerender } = render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onOpenEvidence={onOpenEvidence}
        onSubmit={jest.fn()}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Open exact source location 1"));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
    expect(onOpenEvidence).toHaveBeenCalledWith(evidence.evidenceRef);

    rerender(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onOpenEvidence={onOpenEvidence}
        onSubmit={jest.fn()}
        openingEvidenceRef={evidence.evidenceRef}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );

    expect(getButton("Open exact source location 1").disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Opening…");
  });

  it("renders safe empty and error evidence states without inventing an open action", () => {
    const untrustedText = '<img src="x" onerror="stolen()">';
    const plan = createReviewPlan([createReviewFile()], "snapshot-1", [
      createEvidence({ excerpt: untrustedText }),
    ]);
    const { rerender, container } = render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        evidenceError="The source could not be reopened from this snapshot."
        onSubmit={jest.fn()}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("could not be reopened");
    expect(screen.getByText(untrustedText)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open exact source location/ })).toBeNull();

    rerender(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByText(/No source excerpt is available for this proposal/)).toBeTruthy();
  });

  it("saves an LF-normalized manual whole-file edit without recalculating the diff", () => {
    const onSubmit = jest.fn<void, [KnowledgeReviewCommand]>();
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={onSubmit}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Edit proposed file Knowledge/First.md"));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Edit complete proposed file",
    });
    expect(editor.value).toBe("after\n");
    expect(screen.getByText(/does not ask a model/)).toBeTruthy();
    expect(screen.getByText(/stores line breaks as LF/)).toBeTruthy();
    expect(screen.getByText(/original proposal preview is hidden while you type/)).toBeTruthy();

    fireEvent.change(editor, { target: { value: "# Human revised\r\nExact trailing  \r\n" } });
    fireEvent.click(getButton("Use edited file"));
    expect(screen.getByRole("note").textContent).toContain("exact saved full-file edit");
    expect(screen.getAllByText("before", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Human revised", { exact: false }).length).toBeGreaterThan(0);

    fireEvent.click(getButton("Validate and apply selection"));
    expect(onSubmit).toHaveBeenCalledWith({
      changeSetId: "changeset-1",
      proposalDigest: "proposal-digest-1",
      expectedSnapshotToken: "snapshot-1",
      decisions: [
        {
          changeId: "change-1",
          decision: "accept_edited",
          afterContent: "# Human revised\nExact trailing  \n",
        },
      ],
    });
  });

  it("cancels to the prior decision and resets only the active buffer to proposed text", () => {
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Use proposed file Knowledge/First.md"));
    fireEvent.click(getButton("Edit proposed file Knowledge/First.md"));
    let editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Edit complete proposed file",
    });
    fireEvent.change(editor, { target: { value: "discard me" } });
    fireEvent.click(getButton("Cancel edit"));

    expect(getButton("Use proposed file Knowledge/First.md").getAttribute("aria-pressed")).toBe(
      "true"
    );
    fireEvent.click(getButton("Edit proposed file Knowledge/First.md"));
    editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Edit complete proposed file",
    });
    expect(editor.value).toBe("after\n");
    fireEvent.change(editor, { target: { value: "temporary" } });
    fireEvent.click(getButton("Reset to proposed"));
    expect(editor.value).toBe("after\n");
  });

  it("restores keyboard focus to the exact file edit trigger after Cancel", async () => {
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );
    const trigger = getButton("Edit proposed file Knowledge/First.md");
    fireEvent.click(trigger);
    const cancel = getButton("Cancel edit");
    cancel.focus();
    fireEvent.click(cancel);

    await waitFor(() => expect(trigger.doc.activeElement).toBe(trigger));
  });

  it("never offers manual editing for delete or reject-only files", () => {
    const deletion = createReviewFile({
      operation: "delete",
      capability: "reject_only",
      beforeContent: "old\n",
      afterContent: undefined,
    });
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={createReviewPlan([deletion])}
        rejectCommandsEnabled={true}
      />
    );

    expect(getButton("Edit proposed file Knowledge/First.md").disabled).toBe(true);
    fireEvent.click(getButton("Edit proposed file Knowledge/First.md"));
    expect(screen.queryByRole("textbox", { name: "Edit complete proposed file" })).toBeNull();
  });

  it("refuses to retain textarea input above the exact two-million-character file limit", () => {
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );
    fireEvent.click(getButton("Edit proposed file Knowledge/First.md"));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Edit complete proposed file",
    });
    const overLimit = "x".repeat(2_000_001);

    fireEvent.change(editor, { target: { value: overLimit } });

    expect(editor.value).toBe("after\n");
    expect(screen.getByRole("alert").textContent).toContain(
      "exceeds the 2,000,000-character Review limit"
    );
    expect(screen.getByRole("alert").textContent).toContain("not retained");
  });

  it("refuses to open an edit that would exceed the selected eight-million-character total", () => {
    const fullFile = "x".repeat(2_000_000);
    const draft = {
      "change-1": { kind: "accept_edited" as const, afterContent: fullFile },
      "change-2": { kind: "accept_edited" as const, afterContent: fullFile },
      "change-3": { kind: "accept_edited" as const, afterContent: fullFile },
      "change-4": { kind: "accept_edited" as const, afterContent: fullFile },
    };
    const files = [
      createReviewFile(),
      createReviewFile({ changeId: "change-2", path: "Knowledge/Second.md" }),
      createReviewFile({ changeId: "change-3", path: "Knowledge/Third.md" }),
      createReviewFile({ changeId: "change-4", path: "Knowledge/Fourth.md" }),
      createReviewFile({
        changeId: "change-5",
        path: "Knowledge/Fifth.md",
        afterContent: "x",
      }),
    ];
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        draft={draft}
        onDraftChange={jest.fn()}
        onSubmit={jest.fn()}
        plan={createReviewPlan(files)}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Edit proposed file Knowledge/Fifth.md"));

    expect(screen.queryByRole("textbox", { name: "Edit complete proposed file" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "exceed the 8,000,000-character Review limit"
    );
  });

  it("retains a controlled active buffer across remount and requires it to finish before submit", () => {
    const plan = createReviewPlan([createReviewFile()]);
    const onSubmit = jest.fn();
    const onActiveEditChange = jest.fn(() => true);
    const activeEdit = { changeId: "change-1", afterContent: "typing across remount" };
    const draft = { "change-1": { kind: "accept_exact" as const } };
    const { unmount } = render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        activeEdit={activeEdit}
        busy={false}
        draft={draft}
        onActiveEditChange={onActiveEditChange}
        onDraftChange={jest.fn()}
        onSubmit={onSubmit}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("typing across remount");
    expect(getButton("Finish or cancel edit").disabled).toBe(true);
    expect(getButton("Use all proposed changes").disabled).toBe(true);
    expect(getButton("Skip all changes").disabled).toBe(true);
    expect(getButton("Use proposed file Knowledge/First.md").disabled).toBe(true);
    expect(getButton("Edit proposed file Knowledge/First.md").disabled).toBe(true);
    fireEvent.click(getButton("Finish or cancel edit"));
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();

    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        activeEdit={activeEdit}
        busy={false}
        draft={draft}
        onActiveEditChange={onActiveEditChange}
        onDraftChange={jest.fn()}
        onSubmit={onSubmit}
        plan={plan}
        rejectCommandsEnabled={true}
      />
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("typing across remount");
  });

  it("keeps the active buffer open when controller-owned decision saving fails closed", () => {
    const onDraftChange = jest.fn(() => false);
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        activeEdit={{ changeId: "change-1", afterContent: "must not disappear" }}
        busy={false}
        draft={{ "change-1": { kind: "accept_exact" } }}
        onActiveEditChange={jest.fn(() => true)}
        onDraftChange={onDraftChange}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Use edited file"));

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("must not disappear");
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
  });

  it("explains unsupported editor text without discarding the active buffer", () => {
    const unsupported = "keep this\ud800";
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        activeEdit={{ changeId: "change-1", afterContent: unsupported }}
        busy={false}
        draft={{ "change-1": { kind: "accept_exact" } }}
        onActiveEditChange={jest.fn(() => true)}
        onDraftChange={jest.fn(() => true)}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    fireEvent.click(getButton("Use edited file"));

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(unsupported);
    expect(screen.getByRole("alert").textContent).toContain("incomplete Unicode character");
  });

  it("omits expensive inline diffs without truncating a large saved manual edit", () => {
    const afterContent = "x".repeat(200_001);
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        draft={{ "change-1": { kind: "accept_edited", afterContent } }}
        onDraftChange={jest.fn()}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByText(/Exact Current\/Edited preview omitted/).textContent).toContain(
      "complete edited text without truncation"
    );
  });

  it("omits an adversarial many-line inline diff even below the character cap", () => {
    const afterContent = "x\n".repeat(2_001);
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        draft={{ "change-1": { kind: "accept_edited", afterContent } }}
        onDraftChange={jest.fn()}
        onSubmit={jest.fn()}
        plan={createReviewPlan([createReviewFile()])}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByText(/more than 200,000 total characters or 2,000 lines/)).toBeTruthy();
  });

  it("renders an adversarial single-line edit without a word-level diff", () => {
    const beforeContent = Array.from({ length: 8_000 }, (_, index) => `a${index}`).join(" ");
    const afterContent = Array.from({ length: 8_000 }, (_, index) => `b${index}`).join(" ");
    render(
      <KnowledgeReviewPanel
        acceptCommandsEnabled={true}
        busy={false}
        draft={{ "change-1": { kind: "accept_edited", afterContent } }}
        onDraftChange={jest.fn()}
        onSubmit={jest.fn()}
        plan={createReviewPlan([
          createReviewFile({ beforeContent, afterContent: "generated proposal" }),
        ])}
        rejectCommandsEnabled={true}
      />
    );

    expect(screen.getByRole("region", { name: "Current file content" }).textContent).toContain(
      "a7999"
    );
    expect(screen.getByRole("region", { name: "Edited file content" }).textContent).toContain(
      "b7999"
    );
  });
});
