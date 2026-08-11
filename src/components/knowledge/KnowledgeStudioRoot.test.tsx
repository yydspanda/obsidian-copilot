import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeStudioRoot } from "@/components/knowledge/KnowledgeStudioRoot";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeStudioCommandCapabilities,
  KnowledgeStudioController,
  KnowledgeStudioState,
} from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeRecoveryModel } from "@/knowledge/ui/recoveryModel";
import type {
  KnowledgeSourceLifecycleModel,
  KnowledgeSourceRemovalConfirmation,
} from "@/knowledge/ui/sourceLifecycleModel";

jest.mock("@/components/knowledge/KnowledgeActivityPanel", () => ({
  /** Test seam that exposes Activity callback wiring without testing its rendering again. */
  KnowledgeActivityPanel: (props: {
    model: { bundleId: string };
    commandCapabilities: Readonly<KnowledgeStudioCommandCapabilities>;
    onPauseBundle: () => void;
    onResumeBundle: () => void;
    onCancelJob: (jobId: string) => void;
    onRetryJob: (jobId: string) => void;
    onReviewJob: (jobId: string) => void;
  }) => (
    <div data-testid="activity-panel">
      <span>Activity model {props.model.bundleId}</span>
      <button
        disabled={!props.commandCapabilities.pauseBundle}
        type="button"
        onClick={props.onPauseBundle}
      >
        Activity pause
      </button>
      <button
        disabled={!props.commandCapabilities.resumeBundle}
        type="button"
        onClick={props.onResumeBundle}
      >
        Activity resume
      </button>
      <button
        disabled={!props.commandCapabilities.cancelJob}
        type="button"
        onClick={() => props.onCancelJob("job-review")}
      >
        Activity cancel
      </button>
      <button
        disabled={!props.commandCapabilities.retryJob}
        type="button"
        onClick={() => props.onRetryJob("job-review")}
      >
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
    acceptCommandsEnabled: boolean;
    rejectCommandsEnabled: boolean;
    onBack?: () => void;
    onSubmit: (command: KnowledgeReviewCommand) => void | Promise<void>;
  }) => (
    <div data-testid="review-panel">
      <span>Review plan {props.plan.changeSetId}</span>
      <span>Review busy {String(props.busy)}</span>
      <span>Review accept {String(props.acceptCommandsEnabled)}</span>
      <span>Review reject {String(props.rejectCommandsEnabled)}</span>
      <button type="button" onClick={props.onBack}>
        Review back
      </button>
      <button
        disabled={!props.rejectCommandsEnabled}
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

jest.mock("@/components/knowledge/KnowledgeRecoveryPanel", () => ({
  /** Test seam that exposes the recovery model, pending identity, and command bindings. */
  KnowledgeRecoveryPanel: (props: {
    model: Readonly<KnowledgeRecoveryModel>;
    pendingRecoveryId?: string;
    onContinue: (recoveryId: string) => void;
    onAbandon: (recoveryId: string) => void;
    onRefresh: () => void;
  }) => {
    const recoveryId = props.model.items[0]?.id ?? "missing-recovery";
    return (
      <div data-testid="recovery-panel">
        <span>Recovery count {props.model.items.length}</span>
        <span>Recovery pending {props.pendingRecoveryId ?? "none"}</span>
        <button type="button" onClick={() => props.onContinue(recoveryId)}>
          Recovery continue
        </button>
        <button type="button" onClick={() => props.onAbandon(recoveryId)}>
          Recovery abandon
        </button>
        <button type="button" onClick={props.onRefresh}>
          Recovery refresh
        </button>
      </div>
    );
  },
}));

jest.mock("@/components/knowledge/KnowledgeQueryPanel", () => ({
  /** Test seam that exposes Query and opaque citation callback wiring. */
  KnowledgeQueryPanel: (props: {
    state: { status: string };
    writebackAvailable: boolean;
    onQuery: (query: string) => void;
    onOpenCitation: (citationRef: string) => void;
    onSaveToWiki: (title: string) => void;
  }) => (
    <div data-testid="query-panel">
      <span>Query status {props.state.status}</span>
      <span>Query writeback {String(props.writebackAvailable)}</span>
      <button type="button" onClick={() => props.onQuery("grounded topic")}>
        Query submit
      </button>
      <button type="button" onClick={() => props.onOpenCitation("citation-ref-1")}>
        Query citation
      </button>
      <button type="button" onClick={() => props.onSaveToWiki("Durable insight")}>
        Query save
      </button>
    </div>
  ),
}));

jest.mock("@/components/knowledge/KnowledgeSourceLifecyclePanel", () => ({
  /** Test seam that exposes the immutable source model and narrow command callbacks. */
  KnowledgeSourceLifecyclePanel: (props: {
    model: Readonly<KnowledgeSourceLifecycleModel>;
    onCheckAgain: (sourceId: string, signal: AbortSignal) => void;
    onRemove: (
      confirmation: Readonly<KnowledgeSourceRemovalConfirmation>,
      signal: AbortSignal
    ) => void;
  }) => {
    const source = props.model.sources[0];
    return (
      <div data-testid="source-lifecycle-panel">
        <span>Source count {props.model.sources.length}</span>
        <button
          type="button"
          onClick={() => props.onCheckAgain(source.sourceId, new AbortController().signal)}
        >
          Source check
        </button>
        <button
          type="button"
          onClick={() =>
            props.onRemove(
              Object.freeze({
                sourceId: source.sourceId,
                sourcePath: source.sourcePath,
                retirementRef: source.retirementRef,
                runtimeRevision: props.model.runtimeRevision,
                manifestRevision: props.model.manifestRevision,
              }),
              new AbortController().signal
            )
          }
        >
          Source remove
        </button>
      </div>
    );
  },
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

const ENABLED_COMMAND_CAPABILITIES: Readonly<KnowledgeStudioCommandCapabilities> = {
  pauseBundle: true,
  resumeBundle: true,
  cancelJob: true,
  retryJob: true,
  reviewReject: true,
  reviewAccept: true,
  recoveryContinue: true,
  recoveryAbandon: true,
};

const DISABLED_COMMAND_CAPABILITIES: Readonly<KnowledgeStudioCommandCapabilities> = {
  pauseBundle: false,
  resumeBundle: false,
  cancelJob: false,
  retryJob: false,
  reviewReject: false,
  reviewAccept: false,
  recoveryContinue: false,
  recoveryAbandon: false,
};

/** Creates one exact decision-required recovery projection for Root wiring tests. */
function createRecoveryModel(): Readonly<KnowledgeRecoveryModel> {
  return {
    bundleId: "personal",
    runtimeRevision: 7,
    items: [
      {
        id: "recovery-1",
        status: "decision_required",
        changeSetId: "changeset-recovery",
        actions: { canContinue: true, canAbandon: true },
      },
    ],
  };
}

/** Creates one missing-source lifecycle projection for Sources tab wiring tests. */
function createSourceLifecycleModel(): Readonly<KnowledgeSourceLifecycleModel> {
  return {
    bundleId: "personal",
    runtimeRevision: 7,
    manifestRevision: 3,
    sources: [
      {
        sourceId: "source-missing",
        sourcePath: "Sources/Missing.md",
        custody: "user_managed",
        generatedPageCount: 2,
        status: "missing",
        issueReason: "source_missing",
        retirementRef: "retirement-ref",
        retirementBlockers: [],
        actions: { canCheckAgain: true, canRemove: true },
      },
    ],
  };
}

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
  reviews: readonly KnowledgeReviewPlan[] = [createReviewPlan("changeset-1")],
  commandCapabilities: Readonly<KnowledgeStudioCommandCapabilities> = ENABLED_COMMAND_CAPABILITIES,
  recovery: Readonly<KnowledgeRecoveryModel> = {
    bundleId: "personal",
    runtimeRevision: 1,
    items: [],
  }
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
      commandCapabilities,
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
      recovery,
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

  /** Records an explicit recovery continuation without optimistic state. */
  async continueRecovery(recoveryId: string): Promise<void> {
    this.calls.push(`continue:${recoveryId}`);
  }

  /** Records an explicit no-journal abandonment without optimistic state. */
  async abandonRecovery(recoveryId: string): Promise<void> {
    this.calls.push(`abandon:${recoveryId}`);
  }

  /** Records one retrieval-only Query request without synthesizing UI state. */
  async runQuery(query: string): Promise<void> {
    this.calls.push(`query:${query}`);
  }

  /** Records one opaque citation reference without receiving its source path. */
  async openQueryCitation(citationRef: string): Promise<void> {
    this.calls.push(`citation:${citationRef}`);
  }

  /** Records one reviewed writeback title without receiving generated content or paths. */
  async saveCurrentQueryToWiki(title: string): Promise<void> {
    this.calls.push(`save:${title}`);
  }

  /** Records a source recheck without receiving its path or model row. */
  async checkSourceAgain(sourceId: string, _signal?: AbortSignal): Promise<void> {
    this.calls.push(`source-check:${sourceId}`);
  }

  /** Records exact source retirement authority without updating React state. */
  async retireSource(
    confirmation: Readonly<KnowledgeSourceRemovalConfirmation>,
    _signal?: AbortSignal
  ): Promise<void> {
    this.calls.push(
      `source-retire:${confirmation.sourceId}:${confirmation.retirementRef}:` +
        `${confirmation.runtimeRevision}:${confirmation.manifestRevision}:${confirmation.sourcePath}`
    );
  }
}

/** Converts the focused fake to the concrete controller boundary expected by React. */
function asController(controller: TestKnowledgeStudioController): KnowledgeStudioController {
  return controller as unknown as KnowledgeStudioController;
}

const FOLDER_IMPORT_PORT: KnowledgeFolderImportPort = {
  importFolder: jest.fn(),
};

/** Renders Knowledge Studio with the suite's inert folder import boundary. */
function renderStudio(controller: TestKnowledgeStudioController): ReturnType<typeof render> {
  return render(
    <KnowledgeStudioRoot
      controller={asController(controller)}
      folderImportPort={FOLDER_IMPORT_PORT}
    />
  );
}

describe("KnowledgeStudioRoot", () => {
  it("renders a neutral action-free page during transient Studio refresh", () => {
    const controller = new TestKnowledgeStudioController({
      status: "refreshing",
      activeTab: "activity",
      refreshing: true,
    });
    renderStudio(controller);

    expect(screen.getByRole("status").textContent).toContain("Refreshing Knowledge Studio…");
    expect(screen.getByRole("status").textContent).toContain(
      "this is expected and does not mean the operation failed"
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("activity-panel")).toBeNull();
    expect(screen.queryByText("Knowledge Studio unavailable")).toBeNull();
  });

  it("renders startup unavailability without displaying a fabricated Bundle identity", () => {
    const controller = new TestKnowledgeStudioController({
      status: "unavailable",
      activeTab: "activity",
      refreshing: false,
      unavailableNotice: "No project has a Knowledge Bundle configuration.",
    });
    renderStudio(controller);

    expect(screen.getByRole("alert").textContent).toContain(
      "No project has a Knowledge Bundle configuration."
    );
    expect(screen.queryByText(/Bundle knowledge-studio-unconfigured/)).toBeNull();
    expect(screen.queryByTestId("activity-panel")).toBeNull();
  });

  it("subscribes to controller state and replaces loading only after publication", () => {
    const controller = new TestKnowledgeStudioController({
      status: "loading",
      activeTab: "activity",
      refreshing: true,
      bundleId: "personal",
    });
    renderStudio(controller);

    expect(screen.getByText("Loading durable knowledge state…")).toBeTruthy();
    expect(screen.queryByTestId("activity-panel")).toBeNull();

    act(() => controller.publish(createReadyState()));

    expect(screen.getByTestId("activity-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import folder" })).toBeTruthy();
    expect(screen.queryByText("Loading durable knowledge state…")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Recovery/ })).toBeNull();
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
    renderStudio(controller);

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
        commandCapabilities: DISABLED_COMMAND_CAPABILITIES,
        notice: "Runtime adapters are not connected. No files can be changed.",
      },
    });
    renderStudio(controller);

    expect(screen.getByRole("alert").textContent).toContain("No files can be changed");
    expect(screen.queryByTestId("activity-panel")).toBeNull();
    expect(screen.getByText("Durable Activity is not connected")).toBeTruthy();
  });

  it("delegates Activity actions and maps a review job to its current ChangeSet", () => {
    const controller = new TestKnowledgeStudioController(createReadyState());
    renderStudio(controller);

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

  it("keeps live Activity and Review navigation available while read-only commands stay disabled", () => {
    const controller = new TestKnowledgeStudioController(
      createReadyState([createReviewPlan("changeset-1")], DISABLED_COMMAND_CAPABILITIES)
    );
    renderStudio(controller);

    expect(screen.getByTestId("activity-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activity pause" }).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.getByRole("button", { name: "Activity resume" }).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.getByRole("button", { name: "Activity cancel" }).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.getByRole("button", { name: "Activity retry" }).hasAttribute("disabled")).toBe(
      true
    );

    fireEvent.click(screen.getByRole("button", { name: "Activity pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity review" }));

    expect(controller.calls).toEqual(["review:changeset-1"]);
    expect(screen.getByText("Review plan changeset-1")).toBeTruthy();
    expect(screen.getByText("Review accept false")).toBeTruthy();
    expect(screen.getByText("Review reject false")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review submit" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("reveals Query only for a query-capable snapshot and delegates opaque controls", () => {
    const hiddenController = new TestKnowledgeStudioController(createReadyState([]));
    const hidden = renderStudio(hiddenController);
    expect(screen.queryByRole("tab", { name: "Query" })).toBeNull();
    hidden.unmount();

    const ready = createReadyState([]);
    const controller = new TestKnowledgeStudioController({
      ...ready,
      snapshot: {
        ...ready.snapshot!,
        queryAvailable: true,
        queryWritebackAvailable: true,
      },
      query: { status: "idle" },
    });
    renderStudio(controller);

    fireEvent.click(screen.getByRole("tab", { name: "Query" }));
    expect(screen.getByTestId("query-panel")).toBeTruthy();
    expect(screen.getByText("Query writeback true")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Query submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Query citation" }));
    fireEvent.click(screen.getByRole("button", { name: "Query save" }));

    expect(controller.calls).toEqual([
      "tab:query",
      "query:grounded topic",
      "citation:citation-ref-1",
      "save:Durable insight",
    ]);
  });

  it("reveals Sources only with a lifecycle model and delegates narrow source actions", () => {
    const hiddenController = new TestKnowledgeStudioController(createReadyState([]));
    const hidden = renderStudio(hiddenController);
    expect(screen.queryByRole("tab", { name: /Sources/ })).toBeNull();
    hidden.unmount();

    const ready = createReadyState([]);
    const controller = new TestKnowledgeStudioController({
      ...ready,
      snapshot: {
        ...ready.snapshot!,
        sourceLifecycle: createSourceLifecycleModel(),
      },
    });
    renderStudio(controller);

    const sourcesTab = screen.getByRole("tab", { name: /Sources/ });
    expect(sourcesTab.textContent).toContain("1");
    fireEvent.click(sourcesTab);
    expect(screen.getByTestId("source-lifecycle-panel")).toBeTruthy();
    expect(screen.getByText("Source count 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Source check" }));
    fireEvent.click(screen.getByRole("button", { name: "Source remove" }));

    expect(controller.calls).toEqual([
      "tab:sources",
      "source-check:source-missing",
      "source-retire:source-missing:retirement-ref:7:3:Sources/Missing.md",
    ]);
  });

  it("renders a Review empty state when no current proposal exists", () => {
    const controller = new TestKnowledgeStudioController(createReadyState([]));
    renderStudio(controller);

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
    renderStudio(controller);

    expect(screen.getByText("Review plan changeset-2")).toBeTruthy();
    expect(screen.getByText("Review busy true")).toBeTruthy();
    expect(screen.getByText("Review accept true")).toBeTruthy();
    expect(screen.getByText("Submitting the review decision…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review submit" }));

    expect(controller.calls).toContain("submit:changeset-2");
    expect(controller.submitted).toMatchObject({
      changeSetId: "changeset-2",
      expectedSnapshotToken: "snapshot-changeset-2",
      decisions: [],
    });
  });

  it("reveals Recovery only for durable rows and delegates its exact actions", () => {
    const controller = new TestKnowledgeStudioController(
      createReadyState([], ENABLED_COMMAND_CAPABILITIES, createRecoveryModel())
    );
    renderStudio(controller);

    const recoveryTab = screen.getByRole("tab", { name: /Recovery/ });
    expect(recoveryTab.textContent).toContain("Recovery");
    expect(recoveryTab.textContent).toContain("1");
    expect(screen.queryByTestId("recovery-panel")).toBeNull();

    fireEvent.click(recoveryTab);
    expect(controller.calls).toEqual(["tab:recovery"]);
    expect(screen.getByTestId("recovery-panel")).toBeTruthy();
    expect(screen.getByText("Recovery count 1")).toBeTruthy();
    expect(screen.getByText("Recovery pending none")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Recovery continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Recovery abandon" }));
    fireEvent.click(screen.getByRole("button", { name: "Recovery refresh" }));
    expect(controller.calls).toEqual([
      "tab:recovery",
      "continue:recovery-1",
      "abandon:recovery-1",
      "refresh",
    ]);
  });

  it("passes the exact pending recovery identity and renders its progress label", () => {
    const controller = new TestKnowledgeStudioController({
      ...createReadyState([], ENABLED_COMMAND_CAPABILITIES, createRecoveryModel()),
      activeTab: "recovery",
      pendingAction: { kind: "continue_recovery", targetId: "recovery-1" },
    });
    renderStudio(controller);

    expect(screen.getByText("Recovery pending recovery-1")).toBeTruthy();
    expect(screen.getByText("Continuing the selected recovery…")).toBeTruthy();
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
    renderStudio(controller);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("did not pass deterministic validation");
    expect(screen.getByRole("list", { name: "Validation diagnostics" }).textContent).toContain(
      "links_invalid · links: Unsafe link"
    );
  });
});
