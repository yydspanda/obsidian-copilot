import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeStudioRoot } from "@/components/knowledge/KnowledgeStudioRoot";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeStudioController,
  KnowledgeStudioState,
} from "@/knowledge/ui/KnowledgeStudioController";

jest.mock("@/components/knowledge/KnowledgeActivityPanel", () => ({
  /** Test seam that exposes Activity callback wiring without testing its rendering again. */
  KnowledgeActivityPanel: (props: {
    model: { bundleId: string };
    onPauseBundle: () => void;
    onResumeBundle: () => void;
    onCancelJob: (jobId: string) => void;
    onRetryJob: (jobId: string) => void;
    onReviewJob: (jobId: string) => void;
  }) => (
    <div data-testid="activity-panel">
      <span>Activity model {props.model.bundleId}</span>
      <button type="button" onClick={props.onPauseBundle}>
        Activity pause
      </button>
      <button type="button" onClick={props.onResumeBundle}>
        Activity resume
      </button>
      <button type="button" onClick={() => props.onCancelJob("job-review")}>
        Activity cancel
      </button>
      <button type="button" onClick={() => props.onRetryJob("job-review")}>
        Activity retry
      </button>
      <button type="button" onClick={() => props.onReviewJob("job-review")}>
        Activity review
      </button>
    </div>
  ),
}));

jest.mock("@/components/knowledge/KnowledgeReviewPanel", () => ({
  /** Test seam that exposes selected-plan, busy, back, and submit bindings. */
  KnowledgeReviewPanel: (props: {
    plan: KnowledgeReviewPlan;
    busy: boolean;
    onBack?: () => void;
    onSubmit: (command: KnowledgeReviewCommand) => void | Promise<void>;
  }) => (
    <div data-testid="review-panel">
      <span>Review plan {props.plan.changeSetId}</span>
      <span>Review busy {String(props.busy)}</span>
      <button type="button" onClick={props.onBack}>
        Review back
      </button>
      <button
        type="button"
        onClick={() =>
          props.onSubmit({
            changeSetId: props.plan.changeSetId,
            proposalDigest: props.plan.proposalDigest,
            expectedSnapshotToken: props.plan.snapshotToken,
            decisions: [],
          })
        }
      >
        Review submit
      </button>
    </div>
  ),
}));

const EMPTY_STATUS_COUNTS = {
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
} as const;

/** Creates one compact review plan for composition tests. */
function createReviewPlan(changeSetId: string): KnowledgeReviewPlan {
  return {
    changeSetId,
    bundleId: "personal",
    proposalDigest: changeSetId.padEnd(64, "a").slice(0, 64),
    snapshotToken: `snapshot-${changeSetId}`,
    operation: "ingest",
    sourceRefs: ["source-1"],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 10,
    files: [
      {
        changeId: `change-${changeSetId}`,
        path: `Wiki/${changeSetId}.md`,
        operation: "create",
        reason: "Create page",
        sourceRefs: ["source-1"],
        integrity: "current",
        capability: "blocks_allowed",
        beforeContent: "",
        afterContent: "# Page\n",
        blocks: [
          {
            blockId: `block-${changeSetId}`,
            kind: "change",
            parts: [{ kind: "added", value: "# Page\n" }],
          },
        ],
      },
    ],
  };
}

/** Creates one ready controller state with optional reviews. */
function createReadyState(
  reviews: readonly KnowledgeReviewPlan[] = [createReviewPlan("changeset-1")]
): KnowledgeStudioState {
  return {
    status: "ready",
    activeTab: "activity",
    refreshing: false,
    bundleId: "personal",
    selectedReviewChangeSetId: reviews[0]?.changeSetId,
    snapshot: {
      bundleId: "personal",
      revisionToken: "revision-1",
      availability: "ready",
      activity: {
        bundleId: "personal",
        revision: 1,
        controls: { state: "running", canPause: true, canResume: false },
        items: [
          {
            id: "job-review",
            sourceId: "source-1",
            inputRevision: 1,
            attempt: 1,
            status: "awaiting_review",
            durableStage: "review",
            createdAt: 10,
            updatedAt: 20,
            rerunRequested: false,
            terminal: false,
            actions: { canCancel: true, canRetry: false, canReview: true },
            changeSetId: reviews[0]?.changeSetId,
          },
        ],
        counts: {
          total: 1,
          active: 1,
          terminal: 0,
          hiddenTerminal: 0,
          byStatus: { ...EMPTY_STATUS_COUNTS, awaiting_review: 1 },
        },
      },
      reviews,
    },
  };
}

/**
 * Minimal observable controller used to verify the React composition boundary.
 * It intentionally owns state changes so the component cannot update optimistically.
 */
class TestKnowledgeStudioController {
  private readonly listeners = new Set<() => void>();
  private state: KnowledgeStudioState;
  readonly calls: string[] = [];
  submitted?: KnowledgeReviewCommand;

  /** Creates the fake with one externally owned state object. */
  constructor(initialState: KnowledgeStudioState) {
    this.state = initialState;
  }

  /** Returns the current external-store snapshot. */
  getState(): KnowledgeStudioState {
    return this.state;
  }

  /** Subscribes one React listener. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publishes a replacement state exactly as a real controller would. */
  publish(state: KnowledgeStudioState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  /** Records a tab selection and publishes only UI navigation state. */
  selectTab(tab: KnowledgeStudioState["activeTab"]): void {
    this.calls.push(`tab:${tab}`);
    this.publish({ ...this.state, activeTab: tab });
  }

  /** Records an opaque review selection and publishes controller navigation. */
  openReview(changeSetId: string): void {
    this.calls.push(`review:${changeSetId}`);
    this.publish({
      ...this.state,
      activeTab: "review",
      selectedReviewChangeSetId: changeSetId,
    });
  }

  /** Records a durable reload request without changing render state. */
  async refresh(): Promise<void> {
    this.calls.push("refresh");
  }

  /** Records a bundle pause request without optimistic state. */
  async pauseBundle(): Promise<void> {
    this.calls.push("pause");
  }

  /** Records a bundle resume request without optimistic state. */
  async resumeBundle(): Promise<void> {
    this.calls.push("resume");
  }

  /** Records an opaque job cancellation request without optimistic state. */
  async cancelJob(jobId: string): Promise<void> {
    this.calls.push(`cancel:${jobId}`);
  }

  /** Records an opaque job retry request without optimistic state. */
  async retryJob(jobId: string): Promise<void> {
    this.calls.push(`retry:${jobId}`);
  }

  /** Records an opaque review command without optimistic state. */
  async submitReview(command: KnowledgeReviewCommand): Promise<void> {
    this.calls.push(`submit:${command.changeSetId}`);
    this.submitted = command;
  }
}

/** Converts the focused fake to the concrete controller boundary expected by React. */
function asController(controller: TestKnowledgeStudioController): KnowledgeStudioController {
  return controller as unknown as KnowledgeStudioController;
}

describe("KnowledgeStudioRoot", () => {
  it("subscribes to controller state and replaces loading only after publication", () => {
    const controller = new TestKnowledgeStudioController({
      status: "loading",
      activeTab: "activity",
      refreshing: true,
      bundleId: "personal",
    });
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    expect(screen.getByText("Loading durable knowledge state…")).toBeTruthy();
    expect(screen.queryByTestId("activity-panel")).toBeNull();

    act(() => controller.publish(createReadyState()));

    expect(screen.getByTestId("activity-panel")).toBeTruthy();
    expect(screen.queryByText("Loading durable knowledge state…")).toBeNull();
  });

  it("renders load failures and delegates retry without fabricating state", () => {
    const state: KnowledgeStudioState = {
      status: "error",
      activeTab: "activity",
      refreshing: false,
      bundleId: "personal",
      error: "Knowledge Studio could not load its durable state.",
    };
    const controller = new TestKnowledgeStudioController(state);
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry load" }));

    expect(controller.calls).toEqual(["refresh"]);
    expect(controller.getState()).toBe(state);
  });

  it("shows the fail-closed adapter notice", () => {
    const state = createReadyState([]);
    const controller = new TestKnowledgeStudioController({
      ...state,
      snapshot: {
        ...state.snapshot!,
        availability: "adapter_unavailable",
        notice: "Runtime adapters are not connected. No files can be changed.",
      },
    });
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    expect(screen.getByRole("alert").textContent).toContain("No files can be changed");
    expect(screen.queryByTestId("activity-panel")).toBeNull();
    expect(screen.getByText("Durable Activity is not connected")).toBeTruthy();
  });

  it("delegates Activity actions and maps a review job to its current ChangeSet", () => {
    const controller = new TestKnowledgeStudioController(createReadyState());
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    fireEvent.click(screen.getByRole("button", { name: "Activity pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity review" }));

    expect(controller.calls).toEqual([
      "pause",
      "resume",
      "cancel:job-review",
      "retry:job-review",
      "review:changeset-1",
    ]);
    expect(screen.getByText("Review plan changeset-1")).toBeTruthy();
  });

  it("renders a Review empty state when no current proposal exists", () => {
    const controller = new TestKnowledgeStudioController(createReadyState([]));
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    fireEvent.click(screen.getByRole("tab", { name: "Review" }));

    expect(screen.getByText("No proposals are awaiting review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View activity" }));
    expect(controller.calls).toEqual(["tab:review", "tab:activity"]);
  });

  it("renders the controller-selected review and forwards its opaque submission", () => {
    const reviews = [createReviewPlan("changeset-1"), createReviewPlan("changeset-2")];
    const controller = new TestKnowledgeStudioController({
      ...createReadyState(reviews),
      activeTab: "review",
      selectedReviewChangeSetId: "changeset-2",
      pendingAction: { kind: "submit_review", targetId: "changeset-2" },
    });
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    expect(screen.getByText("Review plan changeset-2")).toBeTruthy();
    expect(screen.getByText("Review busy true")).toBeTruthy();
    expect(screen.getByText("Submitting the review decision…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review submit" }));

    expect(controller.calls).toContain("submit:changeset-2");
    expect(controller.submitted).toMatchObject({
      changeSetId: "changeset-2",
      expectedSnapshotToken: "snapshot-changeset-2",
      decisions: [],
    });
  });

  it("renders blocked feedback and deterministic diagnostics from controller state", () => {
    const controller = new TestKnowledgeStudioController({
      ...createReadyState(),
      feedback: {
        kind: "blocked",
        message: "The selected changes did not pass deterministic validation.",
        diagnostics: [
          {
            code: "links_invalid",
            severity: "error",
            field: "links",
            message: "Unsafe link",
          },
        ],
      },
    });
    render(<KnowledgeStudioRoot controller={asController(controller)} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("did not pass deterministic validation");
    expect(screen.getByRole("list", { name: "Validation diagnostics" }).textContent).toContain(
      "links_invalid · links: Unsafe link"
    );
  });
});
