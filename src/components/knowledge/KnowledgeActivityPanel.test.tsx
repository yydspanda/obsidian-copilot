import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import {
  KnowledgeActivityPanel,
  type KnowledgeActivityPanelProps,
} from "@/components/knowledge/KnowledgeActivityPanel";
import * as activityStories from "@/components/knowledge/KnowledgeActivityPanel.stories";
import type {
  KnowledgeActivityBundleControls,
  KnowledgeActivityCounts,
  KnowledgeActivityItem,
  KnowledgeActivityModel,
  KnowledgeActivityStatus,
} from "@/knowledge/ui/activityModel";

const EMPTY_STATUS_COUNTS: Readonly<Record<KnowledgeActivityStatus, number>> = {
  queued: 0,
  parsing: 0,
  analyzing: 0,
  associating: 0,
  generating: 0,
  validating: 0,
  awaiting_review: 0,
  applying: 0,
  finalizing: 0,
  paused: 0,
  recovery_required: 0,
  failed: 0,
  cancelled: 0,
  completed: 0,
};

const DEFAULT_CONTROLS: Readonly<KnowledgeActivityBundleControls> = {
  state: "running",
  canPause: true,
  canResume: false,
};

const ENABLED_COMMAND_CAPABILITIES = {
  pauseBundle: true,
  resumeBundle: true,
  cancelJob: true,
  retryJob: true,
} as const;

const DISABLED_COMMAND_CAPABILITIES = {
  pauseBundle: false,
  resumeBundle: false,
  cancelJob: false,
  retryJob: false,
} as const;

const DEFAULT_CALLBACKS = {
  onPauseBundle: jest.fn(),
  onResumeBundle: jest.fn(),
  onCancelJob: jest.fn(),
  onRetryJob: jest.fn(),
  onReviewJob: jest.fn(),
};

/**
 * Creates one immutable Activity item fixture.
 *
 * @param overrides - Fields that differ from a queued job
 * @returns Activity item suitable for rendering
 */
function createItem(
  overrides: Partial<KnowledgeActivityItem> = {}
): Readonly<KnowledgeActivityItem> {
  return {
    id: "job-1",
    sourceId: "notes/source.md",
    inputRevision: 1,
    attempt: 1,
    status: "queued",
    durableStage: "queued",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    rerunRequested: false,
    terminal: false,
    actions: { canCancel: true, canRetry: false, canReview: false },
    ...overrides,
  };
}

/**
 * Derives consistent aggregate counts for fixture items.
 *
 * @param items - Complete fixture item collection
 * @param hiddenTerminal - Terminal rows omitted from the visible collection
 * @returns Consistent Activity counts
 */
function createCounts(
  items: readonly Readonly<KnowledgeActivityItem>[],
  hiddenTerminal = 0
): Readonly<KnowledgeActivityCounts> {
  const byStatus = { ...EMPTY_STATUS_COUNTS };
  for (const item of items) {
    byStatus[item.status] += 1;
  }
  const visibleTerminal = items.filter((item) => item.terminal).length;
  const terminal = visibleTerminal + hiddenTerminal;
  return {
    total: items.length + hiddenTerminal,
    active: items.length - visibleTerminal,
    terminal,
    hiddenTerminal,
    byStatus,
  };
}

/**
 * Creates one complete Activity model fixture.
 *
 * @param options - Optional items, controls, and hidden history
 * @returns Activity model suitable for the pure panel
 */
function createModel(
  options: {
    items?: readonly Readonly<KnowledgeActivityItem>[];
    controls?: Readonly<KnowledgeActivityBundleControls>;
    hiddenTerminal?: number;
  } = {}
): Readonly<KnowledgeActivityModel> {
  const items = options.items ?? [];
  return {
    bundleId: "personal",
    revision: 7,
    controls: options.controls ?? DEFAULT_CONTROLS,
    items,
    counts: createCounts(items, options.hiddenTerminal),
  };
}

/** Returns one named button with its concrete disabled-state type. */
function getButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

describe("KnowledgeActivityPanel", () => {
  describe("KnowledgeActivityPanel()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("confirms paid execution of only the selected row and leaves other materials paused — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
      let settle!: () => void;
      const onRunSelectedJob = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)));
      const props = {
        ...DEFAULT_CALLBACKS,
        onRunSelectedJob,
        commandCapabilities: { ...ENABLED_COMMAND_CAPABILITIES, runSelectedJob: true },
        model: createModel({
          controls: { state: "paused", pauseReason: "user", canPause: false, canResume: true },
          items: ["selected", "other"].map((id) =>
            createItem({
              id,
              sourceId: `notes/${id}.md`,
              actions: { canCancel: true, canRetry: false, canReview: false, canRunSelected: true },
            })
          ),
        }),
      };
      render(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(getButton("Run only notes/selected.md"));
      const dialog = screen.getByRole("alertdialog", { name: "Run only this material?" });
      expect(dialog.textContent).toContain("analysis and generation");
      expect(dialog.textContent).toContain("may incur charges");
      expect(dialog.textContent).toContain("Other materials stay paused");
      expect(dialog.textContent).toContain("Review and Apply");
      expect(onRunSelectedJob).not.toHaveBeenCalled();
      fireEvent.click(getButton("Not now"));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      fireEvent.click(getButton("Run only notes/selected.md"));
      const confirm = getButton("Run this material");
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(onRunSelectedJob).toHaveBeenCalledTimes(1);
      expect(onRunSelectedJob).toHaveBeenCalledWith("selected", 7);
      expect(getButton("Resume bundle").disabled).toBe(true);
      expect(getButton("Run only notes/other.md").disabled).toBe(true);
      expect(getButton("Cancel notes/selected.md").disabled).toBe(false);
      expect(getButton("Cancel notes/other.md").disabled).toBe(true);
      fireEvent.click(getButton("Cancel notes/selected.md"));
      expect(DEFAULT_CALLBACKS.onCancelJob).toHaveBeenCalledWith("selected");
      expect(screen.getByRole("status").textContent).toContain("Running only this material");
      expect(DEFAULT_CALLBACKS.onResumeBundle).not.toHaveBeenCalled();
      await act(async () => settle());
      expect(getButton("Resume bundle").disabled).toBe(false);
    });

    it("invalidates a selected-run confirmation when its visible queue revision changes — https://github.com/yydspanda/obsidian-copilot/issues/18", () => {
      const props = {
        ...DEFAULT_CALLBACKS,
        onRunSelectedJob: jest.fn().mockResolvedValue(undefined),
        commandCapabilities: { ...ENABLED_COMMAND_CAPABILITIES, runSelectedJob: true },
        model: createModel({
          controls: { state: "paused", pauseReason: "user", canPause: false, canResume: true },
          items: [
            createItem({
              actions: { canCancel: true, canRetry: false, canReview: false, canRunSelected: true },
            }),
          ],
        }),
      };
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(getButton("Run only notes/source.md"));
      rerender(<KnowledgeActivityPanel {...props} model={{ ...props.model, revision: 8 }} />);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      rerender(<KnowledgeActivityPanel {...props} />);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(props.onRunSelectedJob).not.toHaveBeenCalled();
    });

    it("keeps selected execution unavailable without an exact command callback or while externally busy — https://github.com/yydspanda/obsidian-copilot/issues/18", () => {
      const props = {
        ...DEFAULT_CALLBACKS,
        commandCapabilities: { ...ENABLED_COMMAND_CAPABILITIES, runSelectedJob: true },
        model: createModel({
          items: [
            createItem({
              actions: { canCancel: true, canRetry: false, canReview: false, canRunSelected: true },
            }),
          ],
        }),
      };
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      expect(getButton("Run only notes/source.md").disabled).toBe(true);
      rerender(<KnowledgeActivityPanel {...props} busy onRunSelectedJob={jest.fn()} />);
      expect(getButton("Run only notes/source.md").disabled).toBe(true);
    });

    it("reports selected-run rejection without leaking provider details or retrying — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
      const onRunSelectedJob = jest.fn().mockRejectedValue(new Error("private provider detail"));
      const props = {
        ...DEFAULT_CALLBACKS,
        onRunSelectedJob,
        commandCapabilities: { ...ENABLED_COMMAND_CAPABILITIES, runSelectedJob: true },
        model: createModel({
          items: [
            createItem({
              actions: { canCancel: true, canRetry: false, canReview: false, canRunSelected: true },
            }),
          ],
        }),
      };
      render(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(getButton("Run only notes/source.md"));
      await act(async () => fireEvent.click(getButton("Run this material")));
      expect(screen.getByRole("alert").textContent).toContain("Selected material could not be run");
      expect(screen.queryByText(/private provider detail/)).toBeNull();
      expect(onRunSelectedJob).toHaveBeenCalledTimes(1);
      expect(DEFAULT_CALLBACKS.onResumeBundle).not.toHaveBeenCalled();
    });

    it("requires a cost confirmation before queueing one completed material and lets cancellation do nothing — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
      const onReanalyzeJob = jest.fn().mockResolvedValue(undefined);
      const item = createItem({
        status: "completed",
        durableStage: "completed",
        terminal: true,
        actions: { canCancel: false, canRetry: false, canReview: false, canReanalyze: true },
      });
      render(
        <KnowledgeActivityPanel
          commandCapabilities={{ ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true }}
          model={createModel({ items: [item] })}
          {...DEFAULT_CALLBACKS}
          onReanalyzeJob={onReanalyzeJob}
        />
      );
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      expect(screen.getByRole("alertdialog", { name: "Reanalyze this material?" })).toBeTruthy();
      expect(screen.getByText(/configured model and may incur charges/)).toBeTruthy();
      expect(screen.getByText(/existing history and Wiki files are preserved/)).toBeTruthy();
      expect(screen.getByText(/Resume bundle/)).toBeTruthy();
      expect(onReanalyzeJob).not.toHaveBeenCalled();
      fireEvent.click(getButton("Cancel reanalysis"));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onReanalyzeJob).not.toHaveBeenCalled();
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      await act(async () => fireEvent.click(getButton("Queue reanalysis")));
      expect(onReanalyzeJob).toHaveBeenCalledTimes(1);
      expect(onReanalyzeJob).toHaveBeenCalledWith("job-1");
      expect(DEFAULT_CALLBACKS.onResumeBundle).not.toHaveBeenCalled();
    });

    it("keeps reanalysis and bundle mutation disabled until the queued request settles — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
      let settle!: () => void;
      const onReanalyzeJob = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)));
      render(
        <KnowledgeActivityPanel
          commandCapabilities={{ ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true }}
          model={createModel({
            controls: { state: "paused", canPause: false, canResume: true },
            items: [
              createItem({
                status: "completed",
                durableStage: "completed",
                terminal: true,
                actions: {
                  canCancel: false,
                  canRetry: false,
                  canReview: false,
                  canReanalyze: true,
                },
              }),
            ],
          })}
          {...DEFAULT_CALLBACKS}
          onReanalyzeJob={onReanalyzeJob}
        />
      );
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      const confirm = getButton("Queue reanalysis");
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(onReanalyzeJob).toHaveBeenCalledTimes(1);
      expect(getButton("Reanalyze notes/source.md").disabled).toBe(true);
      expect(getButton("Resume bundle").disabled).toBe(true);
      expect(screen.getByRole("status").textContent).toContain("Queuing reanalysis");
      await act(async () => settle());
      expect(getButton("Resume bundle").disabled).toBe(false);
    });

    it("discards confirmation when the bundle, queue revision or admitted row changes — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const onReanalyzeJob = jest.fn().mockResolvedValue(undefined);
      const model = createModel({
        items: [
          createItem({
            status: "completed",
            durableStage: "completed",
            terminal: true,
            actions: { canCancel: false, canRetry: false, canReview: false, canReanalyze: true },
          }),
        ],
      });
      const props = {
        ...DEFAULT_CALLBACKS,
        commandCapabilities: { ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true },
        model,
        onReanalyzeJob,
      };
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      rerender(
        <KnowledgeActivityPanel {...props} model={{ ...model, revision: model.revision + 1 }} />
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
      rerender(<KnowledgeActivityPanel {...props} />);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      rerender(
        <KnowledgeActivityPanel
          {...props}
          model={{
            ...model,
            items: model.items.map((item) => ({
              ...item,
              actions: { ...item.actions, canReanalyze: false },
            })),
          }}
        />
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.queryByRole("button", { name: "Reanalyze notes/source.md" })).toBeNull();
      rerender(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      rerender(
        <KnowledgeActivityPanel {...props} model={{ ...model, bundleId: "another-bundle" }} />
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onReanalyzeJob).not.toHaveBeenCalled();
    });

    it("honors missing callbacks, disabled adapters and an externally busy controller — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const model = createModel({
        items: [
          createItem({
            status: "completed",
            durableStage: "completed",
            terminal: true,
            actions: { canCancel: false, canRetry: false, canReview: false, canReanalyze: true },
          }),
        ],
      });
      const props = {
        ...DEFAULT_CALLBACKS,
        model,
        commandCapabilities: ENABLED_COMMAND_CAPABILITIES,
      };
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      expect(getButton("Reanalyze notes/source.md").disabled).toBe(true);
      rerender(
        <KnowledgeActivityPanel
          {...props}
          busy
          onReanalyzeJob={jest.fn()}
          commandCapabilities={{ ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true }}
        />
      );
      expect(getButton("Reanalyze notes/source.md").disabled).toBe(true);
      expect(getButton("Pause bundle").disabled).toBe(true);
    });

    it("shows a safe queueing failure without exposing provider detail or starting a model — https://github.com/yydspanda/obsidian-copilot/issues/16", async () => {
      const onReanalyzeJob = jest.fn().mockRejectedValue(new Error("private provider detail"));
      render(
        <KnowledgeActivityPanel
          {...DEFAULT_CALLBACKS}
          commandCapabilities={{ ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true }}
          onReanalyzeJob={onReanalyzeJob}
          model={createModel({
            items: [
              createItem({
                status: "completed",
                durableStage: "completed",
                terminal: true,
                actions: {
                  canCancel: false,
                  canRetry: false,
                  canReview: false,
                  canReanalyze: true,
                },
              }),
            ],
          })}
        />
      );
      fireEvent.click(getButton("Reanalyze notes/source.md"));
      await act(async () => fireEvent.click(getButton("Queue reanalysis")));
      expect(screen.getByRole("alert").textContent).toContain("could not be queued");
      expect(screen.queryByText(/private provider detail/)).toBeNull();
      expect(DEFAULT_CALLBACKS.onResumeBundle).not.toHaveBeenCalled();
    });

    it("renders aggregate counts, an empty state, and the permitted bundle action", () => {
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel()}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByRole("heading", { name: "Knowledge activity" })).toBeTruthy();
      expect(screen.getByText("No knowledge activity yet")).toBeTruthy();
      expect(screen.getByText(/bundle personal · revision 7/)).toBeTruthy();
      expect(screen.getByText("Bundle Running")).toBeTruthy();
      expect(screen.getAllByText("0")).toHaveLength(5);
      expect(screen.queryByRole("button", { name: "Resume bundle" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Pause bundle" }));
      expect(DEFAULT_CALLBACKS.onPauseBundle).toHaveBeenCalledTimes(1);
    });

    it("offers the gallery confirmation interactively and disables the busy gallery variant — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const props = activityStories.Reanalyze.args as KnowledgeActivityPanelProps;
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /^Reanalyze / }));
      expect(screen.getByRole("alertdialog", { name: "Reanalyze this material?" })).toBeTruthy();
      rerender(
        <KnowledgeActivityPanel
          {...(activityStories.ReanalyzeBusy.args as KnowledgeActivityPanelProps)}
        />
      );
      expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Reanalyze / }).disabled).toBe(
        true
      );
      expect(getButton("Queue reanalysis").disabled).toBe(true);
      expect(getButton("Resume bundle").disabled).toBe(true);
    });

    it("renders selected-run gallery confirmation, pending and safe failure states without a provider — https://github.com/yydspanda/obsidian-copilot/issues/18", async () => {
      const { rerender, unmount } = render(
        <KnowledgeActivityPanel
          {...(activityStories.SelectedRun.args as KnowledgeActivityPanelProps)}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /^Run only / }));
      expect(screen.getByRole("alertdialog", { name: "Run only this material?" })).toBeTruthy();
      await act(async () => fireEvent.click(getButton("Run this material")));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      rerender(
        <KnowledgeActivityPanel
          {...(activityStories.SelectedRunPending.args as KnowledgeActivityPanelProps)}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /^Run only / }));
      fireEvent.click(getButton("Run this material"));
      expect(screen.getByRole("status").textContent).toContain("Running only this material");
      expect(getButton("Resume bundle").disabled).toBe(true);
      unmount();
      render(
        <KnowledgeActivityPanel
          {...(activityStories.SelectedRunFailure.args as KnowledgeActivityPanelProps)}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /^Run only / }));
      await act(async () => fireEvent.click(getButton("Run this material")));
      expect(screen.getByRole("alert").textContent).toContain("Selected material could not be run");
    });

    it("keeps Cancel available after remounting an active selected run and disables it while cancellation settles — https://github.com/yydspanda/obsidian-copilot/issues/18", () => {
      const props = {
        ...(activityStories.SelectedRun.args as KnowledgeActivityPanelProps),
        busy: true,
        runningSelectedJobId: "reading-job",
      };
      const { rerender } = render(<KnowledgeActivityPanel {...props} />);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Cancel / }).disabled).toBe(
        false
      );
      expect(getButton("Resume bundle").disabled).toBe(true);
      rerender(
        <KnowledgeActivityPanel
          {...(activityStories.SelectedRunCancelling.args as KnowledgeActivityPanelProps)}
        />
      );
      expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Cancel / }).disabled).toBe(
        true
      );
      expect(screen.getByRole("status").textContent).toContain("Cancelling this material");
    });

    it("does not offer reanalysis for older rows or unacknowledged completed work — https://github.com/yydspanda/obsidian-copilot/issues/16", () => {
      const model = createModel({
        items: [
          createItem({
            status: "completed",
            terminal: true,
            actions: { canCancel: false, canRetry: false, canReview: false },
          }),
          createItem({
            id: "unacknowledged",
            status: "finalizing",
            actions: { canCancel: false, canRetry: false, canReview: false, canReanalyze: true },
          }),
        ],
      });
      render(
        <KnowledgeActivityPanel
          {...DEFAULT_CALLBACKS}
          model={model}
          commandCapabilities={{ ...ENABLED_COMMAND_CAPABILITIES, reanalyzeJob: true }}
          onReanalyzeJob={jest.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /^Reanalyze / })).toBeNull();
    });

    it("shows the exact processing stage and delegates only enabled job actions", () => {
      const item = createItem({
        id: "job-analyze",
        status: "analyzing",
        durableStage: "analyzing",
        actions: { canCancel: true, canRetry: false, canReview: false },
      });
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ items: [item] })}
          {...DEFAULT_CALLBACKS}
        />
      );

      const row = screen.getByRole("listitem");
      expect(within(row).getByText("Analyzing")).toBeTruthy();
      expect(within(row).getByText("Durable stage: Analyzing")).toBeTruthy();
      expect(within(row).getByText("Extracting source-backed knowledge.")).toBeTruthy();
      expect(within(row).queryByRole("button", { name: /Review/ })).toBeNull();
      expect(within(row).queryByRole("button", { name: /Retry/ })).toBeNull();

      fireEvent.click(within(row).getByRole("button", { name: "Cancel notes/source.md" }));
      expect(DEFAULT_CALLBACKS.onCancelJob).toHaveBeenCalledWith("job-analyze");
    });

    it("delegates review and retry by opaque job id according to each capability", () => {
      const review = createItem({
        id: "job-review",
        sourceId: "notes/review.md",
        status: "awaiting_review",
        durableStage: "review",
        changeSetId: "change-set-1",
        actions: { canCancel: false, canRetry: false, canReview: true },
      });
      const failed = createItem({
        id: "job-failed",
        sourceId: "notes/failed.md",
        status: "failed",
        durableStage: "generating",
        terminal: true,
        actions: { canCancel: false, canRetry: true, canReview: false },
        failure: {
          code: "provider_timeout",
          message: "The provider did not respond in time.",
          retryable: true,
          occurredAt: 1_700_000_001_000,
        },
      });
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ items: [review, failed] })}
          {...DEFAULT_CALLBACKS}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Review notes/review.md" }));
      fireEvent.click(screen.getByRole("button", { name: "Retry notes/failed.md" }));

      expect(DEFAULT_CALLBACKS.onReviewJob).toHaveBeenCalledWith("job-review");
      expect(DEFAULT_CALLBACKS.onRetryJob).toHaveBeenCalledWith("job-failed");
      expect(screen.getByRole("alert").textContent).toContain(
        "provider_timeout · Failed during Generating"
      );
      expect(screen.getByRole("alert").textContent).toContain(
        "The provider did not respond in time."
      );
    });

    it("keeps finalizing distinct from completed outcomes and exposes no applying action — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const finalizing = createItem({
        id: "job-finalizing",
        status: "finalizing",
        durableStage: "completed",
        terminal: false,
        actions: { canCancel: false, canRetry: false, canReview: false },
      });
      const applying = createItem({
        id: "job-applying",
        sourceId: "notes/applying.md",
        status: "applying",
        durableStage: "applying",
        actions: { canCancel: false, canRetry: false, canReview: false },
      });
      const controls: Readonly<KnowledgeActivityBundleControls> = {
        state: "finalizing",
        canPause: false,
        canResume: false,
        pauseReason: "commit_pending_ack",
        pausedAt: 1_700_000_000_000,
      };
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ items: [finalizing, applying], controls })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByText("Bundle Finalizing commit")).toBeTruthy();
      expect(screen.getByText("Finalizing")).toBeTruthy();
      expect(screen.getByText(/not yet durably acknowledged/)).toBeTruthy();
      expect(screen.queryByText("Completed")).toBeNull();
      expect(screen.queryByText("Wiki updated")).toBeNull();
      expect(screen.queryByText("No Wiki changes")).toBeNull();
      expect(screen.queryByRole("button", { name: /bundle/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Cancel notes\/applying.md/ })).toBeNull();
    });

    it("labels durably applied file changes as Wiki updated without promising semantic completeness — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({
            items: [
              createItem({
                status: "completed",
                durableStage: "completed",
                terminal: true,
                completion: { kind: "applied" },
                actions: { canCancel: false, canRetry: false, canReview: false },
              }),
            ],
          })}
          {...DEFAULT_CALLBACKS}
        />
      );

      const row = within(screen.getByRole("listitem"));
      expect(row.getByText("Wiki updated")).toBeTruthy();
      expect(row.getByText(/Approved file changes were written to the Wiki/)).toBeTruthy();
      expect(row.getByText(/does not verify that every source detail is represented/)).toBeTruthy();
      expect(row.queryByText("Completed")).toBeNull();
      expect(row.queryByRole("button")).toBeNull();
    });

    it.each([
      ["analysis_no_targets", "Analysis selected no Wiki targets."],
      ["resolved_no_targets", "Target resolution left no Wiki targets to generate."],
      ["all_targets_unchanged", "Generation produced no file changes."],
    ] as const)(
      "shows a neutral No Wiki changes outcome for %s and warns that new material may not be included — https://github.com/yydspanda/obsidian-copilot/issues/15",
      (reason, detail) => {
        render(
          <KnowledgeActivityPanel
            commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
            model={createModel({
              items: [
                createItem({
                  status: "completed",
                  durableStage: "completed",
                  terminal: true,
                  completion: { kind: "no_changes", reason },
                  actions: { canCancel: false, canRetry: false, canReview: false },
                }),
              ],
            })}
            {...DEFAULT_CALLBACKS}
          />
        );

        const row = within(screen.getByRole("listitem"));
        const badge = row.getByText("No Wiki changes");
        expect(badge.classList.contains("tw-bg-success")).toBe(false);
        expect(row.getByText(detail)).toBeTruthy();
        expect(row.getByText(/does not mean new material is included/)).toBeTruthy();
        expect(row.getByText(/Existing citations may still need updating/)).toBeTruthy();
        expect(row.queryByText("Wiki updated")).toBeNull();
        expect(row.queryByRole("button")).toBeNull();
      }
    );

    it.each([
      { explicitUnchanged: 2, identicalWrites: 1 },
      { explicitUnchanged: 0, identicalWrites: 3 },
    ])(
      "reports explicit unchanged and identical-write counts separately, including zero ($explicitUnchanged / $identicalWrites) — https://github.com/yydspanda/obsidian-copilot/issues/15",
      (generationOutcomes) => {
        render(
          <KnowledgeActivityPanel
            commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
            model={createModel({
              items: [
                createItem({
                  status: "completed",
                  durableStage: "completed",
                  terminal: true,
                  completion: {
                    kind: "no_changes",
                    reason: "all_targets_unchanged",
                    generationOutcomes,
                  },
                }),
              ],
            })}
            {...DEFAULT_CALLBACKS}
          />
        );

        expect(
          screen.getByText(
            `Targets explicitly marked unchanged: ${generationOutcomes.explicitUnchanged}. Proposed writes identical to existing files: ${generationOutcomes.identicalWrites}.`
          )
        ).toBeTruthy();
        expect(screen.queryByText(/history did not record how many targets/)).toBeNull();
      }
    );

    it("explains that generation counts were not recorded for older no-change history — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({
            items: [
              createItem({
                status: "completed",
                durableStage: "completed",
                terminal: true,
                completion: { kind: "no_changes", reason: "all_targets_unchanged" },
              }),
            ],
          })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByText(/This history did not record how many targets/)).toBeTruthy();
      expect(screen.queryByText(/Targets explicitly marked unchanged:/)).toBeNull();
    });

    it("keeps old completion history neutral without guessing whether Wiki files changed — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({
            items: [createItem({ status: "completed", durableStage: "completed", terminal: true })],
          })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByText("Completed").classList.contains("tw-bg-success")).toBe(false);
      expect(screen.getByText(/detailed outcome was not recorded/)).toBeTruthy();
      expect(screen.getByText(/cannot confirm whether Wiki files changed/)).toBeTruthy();
      expect(screen.queryByText("Wiki updated")).toBeNull();
      expect(screen.queryByText("No Wiki changes")).toBeNull();
    });

    it.each([
      ["Applied", activityStories.Applied, "Wiki updated"],
      ["AnalysisNoTargets", activityStories.AnalysisNoTargets, "No Wiki changes"],
      ["ResolutionNoTargets", activityStories.ResolutionNoTargets, "No Wiki changes"],
      ["UnchangedGeneration", activityStories.UnchangedGeneration, "No Wiki changes"],
      ["LegacyNoChanges", activityStories.LegacyNoChanges, "No Wiki changes"],
      ["LegacyCompleted", activityStories.LegacyCompleted, "Completed"],
      ["Finalizing", activityStories.Finalizing, "Finalizing"],
    ] as const)(
      "renders the %s gallery fixture with its distinct outcome and no job mutation controls — https://github.com/yydspanda/obsidian-copilot/issues/15",
      (_name, story, label) => {
        render(<KnowledgeActivityPanel {...(story.args as KnowledgeActivityPanelProps)} />);

        const row = within(screen.getByRole("listitem"));
        expect(row.getByText(label)).toBeTruthy();
        expect(row.queryByRole("button")).toBeNull();
      }
    );

    it("renders recovery as a hard block with no pause or resume control", () => {
      const recovery = createItem({
        id: "job-recovery",
        status: "recovery_required",
        durableStage: "applying",
        actions: { canCancel: false, canRetry: false, canReview: false },
      });
      const controls: Readonly<KnowledgeActivityBundleControls> = {
        state: "recovery_required",
        canPause: false,
        canResume: false,
        pauseReason: "recovery_required",
        pausedAt: 1_700_000_000_000,
        detail: "A prepared transaction needs recovery.",
      };
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ items: [recovery], controls })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByText("Bundle Recovery required")).toBeTruthy();
      expect(screen.getByText("A prepared transaction needs recovery.")).toBeTruthy();
      expect(screen.getByText("Recovery required", { selector: ".tw-inline-flex" })).toBeTruthy();
      expect(screen.getByText(/Automatic writes are blocked/)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("shows the resume capability and pause metadata without inventing pause", () => {
      const controls: Readonly<KnowledgeActivityBundleControls> = {
        state: "rate_limited",
        canPause: false,
        canResume: true,
        pauseReason: "rate_limit",
        pausedAt: 1_700_000_000_000,
        resumeAt: 1_700_000_060_000,
      };
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ controls })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.queryByRole("button", { name: "Pause bundle" })).toBeNull();
      expect(screen.getByText("2023-11-14T22:13:20.000Z", { selector: "time" })).toBeTruthy();
      expect(screen.getByText("2023-11-14T22:14:20.000Z", { selector: "time" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Resume bundle" }));
      expect(DEFAULT_CALLBACKS.onResumeBundle).toHaveBeenCalledTimes(1);
    });

    it("reports omitted terminal history even when no rows are visible", () => {
      render(
        <KnowledgeActivityPanel
          commandCapabilities={ENABLED_COMMAND_CAPABILITIES}
          model={createModel({ hiddenTerminal: 3 })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(screen.getByText("No recent activity to display")).toBeTruthy();
      expect(screen.getByText(/3 older terminal jobs are hidden/)).toBeTruthy();
      expect(screen.getByText("History").nextElementSibling?.textContent).toBe("3");
    });

    it("keeps durable Activity readable while every mutation command is disabled", () => {
      const cancellable = createItem({ id: "job-cancel" });
      const retryable = createItem({
        id: "job-retry",
        sourceId: "notes/retry.md",
        status: "failed",
        durableStage: "generating",
        terminal: true,
        actions: { canCancel: false, canRetry: true, canReview: false },
        failure: {
          code: "provider_timeout",
          message: "The provider did not respond in time.",
          retryable: true,
          occurredAt: 1_700_000_001_000,
        },
      });
      const reviewable = createItem({
        id: "job-review",
        sourceId: "notes/review.md",
        status: "awaiting_review",
        durableStage: "review",
        changeSetId: "change-set-1",
        actions: { canCancel: false, canRetry: false, canReview: true },
      });
      const { rerender } = render(
        <KnowledgeActivityPanel
          commandCapabilities={DISABLED_COMMAND_CAPABILITIES}
          model={createModel({ items: [cancellable, retryable, reviewable] })}
          {...DEFAULT_CALLBACKS}
        />
      );

      expect(getButton("Pause bundle").disabled).toBe(true);
      expect(getButton("Cancel notes/source.md").disabled).toBe(true);
      expect(getButton("Retry notes/retry.md").disabled).toBe(true);
      expect(getButton("Review notes/review.md").disabled).toBe(false);

      fireEvent.click(getButton("Pause bundle"));
      fireEvent.click(getButton("Cancel notes/source.md"));
      fireEvent.click(getButton("Retry notes/retry.md"));
      fireEvent.click(getButton("Review notes/review.md"));

      expect(DEFAULT_CALLBACKS.onPauseBundle).not.toHaveBeenCalled();
      expect(DEFAULT_CALLBACKS.onCancelJob).not.toHaveBeenCalled();
      expect(DEFAULT_CALLBACKS.onRetryJob).not.toHaveBeenCalled();
      expect(DEFAULT_CALLBACKS.onReviewJob).toHaveBeenCalledWith("job-review");

      rerender(
        <KnowledgeActivityPanel
          commandCapabilities={DISABLED_COMMAND_CAPABILITIES}
          model={createModel({
            controls: { state: "paused", canPause: false, canResume: true },
          })}
          {...DEFAULT_CALLBACKS}
        />
      );
      expect(getButton("Resume bundle").disabled).toBe(true);
      fireEvent.click(getButton("Resume bundle"));
      expect(DEFAULT_CALLBACKS.onResumeBundle).not.toHaveBeenCalled();
    });
  });
});
