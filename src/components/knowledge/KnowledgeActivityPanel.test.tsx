import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { KnowledgeActivityPanel } from "@/components/knowledge/KnowledgeActivityPanel";
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

describe("KnowledgeActivityPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders aggregate counts, an empty state, and the permitted bundle action", () => {
    render(<KnowledgeActivityPanel model={createModel()} {...DEFAULT_CALLBACKS} />);

    expect(screen.getByRole("heading", { name: "Knowledge activity" })).toBeTruthy();
    expect(screen.getByText("No knowledge activity yet")).toBeTruthy();
    expect(screen.getByText(/bundle personal · revision 7/)).toBeTruthy();
    expect(screen.getByText("Bundle Running")).toBeTruthy();
    expect(screen.getAllByText("0")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Resume bundle" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pause bundle" }));
    expect(DEFAULT_CALLBACKS.onPauseBundle).toHaveBeenCalledTimes(1);
  });

  it("shows the exact processing stage and delegates only enabled job actions", () => {
    const item = createItem({
      id: "job-analyze",
      status: "analyzing",
      durableStage: "analyzing",
      actions: { canCancel: true, canRetry: false, canReview: false },
    });
    render(
      <KnowledgeActivityPanel model={createModel({ items: [item] })} {...DEFAULT_CALLBACKS} />
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

  it("keeps finalizing distinct from completed and exposes no applying action", () => {
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
        model={createModel({ items: [finalizing, applying], controls })}
        {...DEFAULT_CALLBACKS}
      />
    );

    expect(screen.getByText("Bundle Finalizing commit")).toBeTruthy();
    expect(screen.getByText("Finalizing")).toBeTruthy();
    expect(screen.getByText(/not yet durably acknowledged/)).toBeTruthy();
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.queryByRole("button", { name: /bundle/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel notes\/applying.md/ })).toBeNull();
  });

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
    render(<KnowledgeActivityPanel model={createModel({ controls })} {...DEFAULT_CALLBACKS} />);

    expect(screen.queryByRole("button", { name: "Pause bundle" })).toBeNull();
    expect(screen.getByText("2023-11-14T22:13:20.000Z", { selector: "time" })).toBeTruthy();
    expect(screen.getByText("2023-11-14T22:14:20.000Z", { selector: "time" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume bundle" }));
    expect(DEFAULT_CALLBACKS.onResumeBundle).toHaveBeenCalledTimes(1);
  });

  it("reports omitted terminal history even when no rows are visible", () => {
    render(
      <KnowledgeActivityPanel model={createModel({ hiddenTerminal: 3 })} {...DEFAULT_CALLBACKS} />
    );

    expect(screen.getByText("No recent activity to display")).toBeTruthy();
    expect(screen.getByText(/3 older terminal jobs are hidden/)).toBeTruthy();
    expect(screen.getByText("History").nextElementSibling?.textContent).toBe("3");
  });
});
