import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeStudioRoot } from "@/components/knowledge/KnowledgeStudioRoot";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import type {
  KnowledgeReviewCommand,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeForwardRevisionStudioPendingReview,
  KnowledgeForwardRevisionStudioReview,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";
import type { KnowledgeSetupReadinessProjection } from "@/knowledge/setup/KnowledgeSetupReadiness";
import { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";
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
    evidenceError?: string;
    openingEvidenceRef?: string;
    onBack?: () => void;
    onOpenEvidence?: (evidenceRef: string) => void | Promise<void>;
    onSubmit: (command: KnowledgeReviewCommand) => void | Promise<void>;
  }) => (
    <div data-testid="review-panel">
      <span>Review plan {props.plan.changeSetId}</span>
      <span>Review busy {String(props.busy)}</span>
      <span>Review accept {String(props.acceptCommandsEnabled)}</span>
      <span>Review reject {String(props.rejectCommandsEnabled)}</span>
      <span>Review evidence opening {props.openingEvidenceRef ?? "none"}</span>
      <span>Review evidence error {props.evidenceError ?? "none"}</span>
      <button
        type="button"
        onClick={() => {
          void props.onOpenEvidence?.("opaque-evidence-ref");
        }}
      >
        Review open evidence
      </button>
      <button type="button" onClick={props.onBack}>
        Review back
      </button>
      <button
        disabled={!props.rejectCommandsEnabled}
        type="button"
        onClick={() => {
          void props.onSubmit({
            changeSetId: props.plan.changeSetId,
            proposalDigest: props.plan.proposalDigest,
            expectedSnapshotToken: props.plan.snapshotToken,
            decisions: [],
          });
        }}
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
  forwardRevisionReview: true,
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
  forwardRevisionReview: false,
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
    evidence: [],
    omittedEvidenceCount: 0,
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

const FORWARD_REVIEW_REF = `forward-studio-review-${"a".repeat(64)}`;
const FORWARD_SNAPSHOT_REF = `forward-studio-snapshot-${"b".repeat(64)}`;

/** Creates one pending forward row rendered through the reusable Review panel. */
function createForwardPendingReview(): Readonly<KnowledgeForwardRevisionStudioPendingReview> {
  return {
    state: "pending",
    reviewRef: FORWARD_REVIEW_REF,
    snapshotRef: FORWARD_SNAPSHOT_REF,
    pagePath: "Wiki/Forward.md",
    updatedAt: 30,
    requestedAt: 20,
    selectedAppliedAt: 10,
    plan: createReviewPlan(FORWARD_REVIEW_REF),
  };
}

/** Embeds forward rows into a ready Review-tab state with no legacy proposal. */
function createForwardReadyState(
  reviews: readonly Readonly<KnowledgeForwardRevisionStudioReview>[]
): KnowledgeStudioState {
  const base = createReadyState([]);
  return {
    ...base,
    activeTab: "review",
    selectedReviewChangeSetId: undefined,
    selectedForwardRevisionRef: reviews[0]?.reviewRef,
    snapshot: {
      ...base.snapshot!,
      forwardRevisionReviews: reviews,
    },
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
      reviewEvidenceAvailable: true,
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
  submittedForward?: KnowledgeReviewCommand;

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

  /** Records one dedicated forward-row selection and clears legacy selection. */
  openForwardRevision(reviewRef: string): void {
    this.calls.push(`forward:${reviewRef}`);
    this.publish({
      ...this.state,
      activeTab: "review",
      selectedReviewChangeSetId: undefined,
      selectedForwardRevisionRef: reviewRef,
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

  /** Records a reusable Review command routed through the distinct forward boundary. */
  async submitForwardRevisionReview(
    reviewRef: string,
    command: KnowledgeReviewCommand
  ): Promise<void> {
    this.calls.push(`forward-submit:${reviewRef}`);
    this.submittedForward = command;
  }

  /** Records a retry of one durable accepted-ready forward decision. */
  async applyForwardRevision(reviewRef: string): Promise<void> {
    this.calls.push(`forward-apply:${reviewRef}`);
  }

  /** Records one accepted-ready no-write terminal command. */
  async abandonForwardRevision(reviewRef: string): Promise<void> {
    this.calls.push(`forward-abandon:${reviewRef}`);
  }

  /** Records one sticky exact-state recheck and bounded Forward Apply retry. */
  async retryForwardRevisionRecovery(reviewRef: string): Promise<void> {
    this.calls.push(`forward-recovery-retry:${reviewRef}`);
  }

  /** Records one sticky zero-write decision to retain the freshly observed Wiki value. */
  async keepCurrentForwardRevision(reviewRef: string): Promise<void> {
    this.calls.push(`forward-recovery-keep:${reviewRef}`);
  }

  /** Returns no retained Review decisions from this focused composition fake. */
  getReviewDraft(_plan: Readonly<KnowledgeReviewPlan>): Readonly<Record<string, never>> {
    return Object.freeze({});
  }

  /** Returns no active textarea from this focused composition fake. */
  getReviewActiveEdit(_plan: Readonly<KnowledgeReviewPlan>): undefined {
    return undefined;
  }

  /** Accepts a Review draft update without simulating content-bearing state. */
  updateReviewDraft(_plan: Readonly<KnowledgeReviewPlan>, _draft: unknown): boolean {
    return true;
  }

  /** Accepts an active-editor update without simulating content-bearing state. */
  updateReviewActiveEdit(_plan: Readonly<KnowledgeReviewPlan>, _activeEdit: unknown): boolean {
    return true;
  }

  /** Records one opaque Review evidence reference without receiving a source path or locator. */
  async openReviewEvidence(evidenceRef: string): Promise<void> {
    this.calls.push(`review-evidence:${evidenceRef}`);
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

const READY_SETUP_PROJECTION: KnowledgeSetupReadinessProjection = {
  startupStatus: "workflow_read_ready",
  workspace: { level: "locally_ready", reason: "workspace_ready" },
  knowledgeModel: { level: "locally_ready", reason: "knowledge_model_configured" },
  chatModel: { level: "locally_ready", reason: "chat_model_configured" },
  networkVerification: "not_tested",
};

/** Creates inert setup navigation for Root composition tests. */
function createSetupNavigation(): KnowledgeSetupNavigationPort {
  return {
    openCopilotSettings: jest.fn(),
    openProjectFile: jest.fn(),
    openSchema: jest.fn(),
    openChat: jest.fn(),
    refreshDisplayedStatus: jest.fn(),
  };
}

/** Renders Knowledge Studio with the suite's inert folder import boundary. */
function renderStudio(
  controller: TestKnowledgeStudioController,
  setupReadiness = new KnowledgeSetupReadinessStore(READY_SETUP_PROJECTION),
  setupNavigation = createSetupNavigation()
): ReturnType<typeof render> {
  return render(
    <KnowledgeStudioRoot
      controller={asController(controller)}
      folderImportPort={FOLDER_IMPORT_PORT}
      setupNavigation={setupNavigation}
      setupReadiness={setupReadiness}
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

  it("renders guided startup setup without displaying a fabricated Bundle identity", () => {
    const controller = new TestKnowledgeStudioController({
      status: "unavailable",
      activeTab: "activity",
      refreshing: false,
      unavailableNotice: "No project has a Knowledge Bundle configuration.",
    });
    const setupReadiness = new KnowledgeSetupReadinessStore({
      startupStatus: "bundle_unconfigured",
      workspace: { level: "needs_action", reason: "no_project" },
      knowledgeModel: { level: "not_applicable", reason: "workspace_unavailable" },
      chatModel: { level: "locally_ready", reason: "chat_model_configured" },
      networkVerification: "not_tested",
    });
    renderStudio(controller, setupReadiness);

    expect(screen.queryByText("No project has a Knowledge Bundle configuration.")).toBeNull();
    expect(screen.getByText(/Create a Copilot Project first/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Set up Knowledge Studio" })).toBeTruthy();
    expect(screen.getByText("Chat model (optional)")).toBeTruthy();
    expect(screen.queryByText(/Bundle knowledge-studio-unconfigured/)).toBeNull();
    expect(screen.queryByTestId("activity-panel")).toBeNull();
  });

  it("opens and closes local setup status without changing controller state", () => {
    const initialState = createReadyState([]);
    const controller = new TestKnowledgeStudioController(initialState);
    renderStudio(controller);

    fireEvent.click(screen.getByRole("button", { name: "Setup & status" }));
    expect(screen.getByRole("heading", { name: "Knowledge Studio setup & status" })).toBeTruthy();
    expect(screen.getByText("Knowledge model")).toBeTruthy();
    expect(controller.getState()).toBe(initialState);

    fireEvent.click(screen.getByRole("button", { name: "Back to Studio" }));
    expect(screen.getByRole("heading", { name: "Knowledge Studio" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Knowledge Studio setup & status" })).toBeNull();
    expect(controller.getState()).toBe(initialState);
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

    fireEvent.click(screen.getByRole("button", { name: "Review open evidence" }));
    expect(controller.calls).toContain("review-evidence:opaque-evidence-ref");
  });

  it("renders a pending forward row through Review while keeping its submit route distinct", () => {
    const review = createForwardPendingReview();
    const controller = new TestKnowledgeStudioController({
      ...createForwardReadyState([review]),
      pendingAction: { kind: "submit_forward_revision", targetId: review.reviewRef },
    });
    renderStudio(controller);

    expect(screen.getByRole("button", { name: "Open forward revision 1" }).textContent).toContain(
      "Needs decision"
    );
    expect(screen.getByText(`Review plan ${FORWARD_REVIEW_REF}`)).toBeTruthy();
    expect(screen.getByText("Review busy true")).toBeTruthy();
    expect(screen.getByText("Review accept true")).toBeTruthy();
    expect(screen.getByText("Submitting the forward revision decision…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review submit" }));

    expect(controller.calls).toEqual([`forward-submit:${FORWARD_REVIEW_REF}`]);
    expect(controller.submittedForward).toMatchObject({
      changeSetId: FORWARD_REVIEW_REF,
      decisions: [],
    });
  });

  it("keeps accepted-ready and sticky recovery work explicitly actionable", () => {
    const accepted = Object.freeze({
      state: "accepted_ready" as const,
      reviewRef: FORWARD_REVIEW_REF,
      snapshotRef: FORWARD_SNAPSHOT_REF,
      pagePath: "Wiki/Forward.md",
      updatedAt: 40,
      acceptedAt: 35,
      manualOverride: true,
    });
    const controller = new TestKnowledgeStudioController(createForwardReadyState([accepted]));
    const rendered = renderStudio(controller);

    expect(screen.getByRole("tab", { name: /Review/ }).textContent).toContain("1");
    expect(screen.getByText("Accepted revision ready to apply")).toBeTruthy();
    expect(screen.getByText(/available only while no Apply journal/i).textContent).toContain(
      "does not modify the Wiki file"
    );
    expect(screen.getByText(/manual full-file edit/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate and apply" }));
    fireEvent.click(screen.getByRole("button", { name: "End without writing" }));
    expect(controller.calls).toEqual([
      `forward-apply:${FORWARD_REVIEW_REF}`,
      `forward-abandon:${FORWARD_REVIEW_REF}`,
    ]);

    act(() =>
      controller.publish(
        createForwardReadyState([
          {
            ...accepted,
            state: "abandoned",
            abandonedAt: 42,
            updatedAt: 42,
          },
        ])
      )
    );
    expect(
      screen.getByRole("status", { name: "Forward revision ended before write" }).textContent
    ).toContain("No file was changed");
    expect(screen.queryByRole("button", { name: "Validate and apply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End without writing" })).toBeNull();

    act(() =>
      controller.publish(
        createForwardReadyState([
          {
            ...accepted,
            state: "kept_current",
            outcome: "write_outcome_uncertain_external_supersession",
            terminalizedAt: 43,
            updatedAt: 43,
          },
        ])
      )
    );
    expect(
      screen.getByRole("status", { name: "Forward revision kept current Wiki value" }).textContent
    ).toContain("retained the freshly observed Wiki value");
    expect(
      screen.getByRole("status", { name: "Forward revision kept current Wiki value" }).textContent
    ).toContain("not a force action or rollback");
    expect(screen.queryByRole("button", { name: "Validate and apply" })).toBeNull();

    act(() =>
      controller.publish(
        createForwardReadyState([
          {
            ...accepted,
            state: "applying",
            applyPhase: "applying",
          },
        ])
      )
    );
    expect(screen.getByRole("status", { name: "Forward revision applying" }).textContent).toContain(
      "durable applying journal"
    );
    expect(screen.getByRole("status", { name: "Forward revision applying" }).textContent).toContain(
      "reload the plugin"
    );
    expect(screen.queryByRole("button", { name: "Validate and apply" })).toBeNull();

    act(() =>
      controller.publish(
        createForwardReadyState([
          {
            ...accepted,
            state: "recovery_required",
            conflictCode: "file_state_conflict",
            actualKind: "file",
            detectedAt: 45,
          },
        ])
      )
    );
    expect(
      screen.getByRole("alert", { name: "Forward revision recovery required" }).textContent
    ).toContain("will not overwrite it");
    expect(
      screen.getByRole("alert", { name: "Forward revision recovery required" }).textContent
    ).toContain("no automatic retry");
    expect(
      screen.getByRole("alert", { name: "Forward revision recovery required" }).textContent
    ).toContain("Exact-before bytes may receive one bounded compare-and-swap retry");
    expect(
      screen.getByRole("alert", { name: "Forward revision recovery required" }).textContent
    ).toContain("performs no Wiki write");
    fireEvent.click(screen.getByRole("button", { name: "Recheck / retry exact Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep current (no write)" }));
    expect(controller.calls).toEqual([
      `forward-apply:${FORWARD_REVIEW_REF}`,
      `forward-abandon:${FORWARD_REVIEW_REF}`,
      `forward-recovery-retry:${FORWARD_REVIEW_REF}`,
      `forward-recovery-keep:${FORWARD_REVIEW_REF}`,
    ]);

    rendered.unmount();
  });

  it("disables sticky Forward recovery commands while busy or capability is absent", () => {
    const recovery = Object.freeze({
      state: "recovery_required" as const,
      reviewRef: FORWARD_REVIEW_REF,
      snapshotRef: FORWARD_SNAPSHOT_REF,
      pagePath: "Wiki/Forward.md",
      updatedAt: 45,
      acceptedAt: 35,
      manualOverride: false,
      conflictCode: "file_state_conflict" as const,
      actualKind: "file" as const,
      detectedAt: 45,
    });
    const enabled = createForwardReadyState([recovery]);
    const controller = new TestKnowledgeStudioController({
      ...enabled,
      snapshot: {
        ...enabled.snapshot!,
        commandCapabilities: {
          ...enabled.snapshot!.commandCapabilities,
          forwardRevisionReview: false,
        },
      },
    });
    renderStudio(controller);

    const retry = screen.getByRole("button", { name: "Recheck / retry exact Apply" });
    const keep = screen.getByRole("button", { name: "Keep current (no write)" });
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(keep.hasAttribute("disabled")).toBe(true);

    act(() =>
      controller.publish({
        ...enabled,
        pendingAction: {
          kind: "retry_forward_revision_recovery",
          targetId: FORWARD_REVIEW_REF,
        },
      })
    );
    expect(screen.getByText("Rechecking the exact Forward Apply state…")).toBeTruthy();
    expect(
      screen
        .getByRole("alert", { name: "Forward revision recovery required" })
        .getAttribute("aria-busy")
    ).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(keep.hasAttribute("disabled")).toBe(true);

    act(() =>
      controller.publish({
        ...enabled,
        pendingAction: {
          kind: "keep_current_forward_revision",
          targetId: FORWARD_REVIEW_REF,
        },
      })
    );
    expect(screen.getByText("Rechecking before keeping the current Wiki value…")).toBeTruthy();
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(keep.hasAttribute("disabled")).toBe(true);

    act(() => controller.publish(enabled));
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(keep.hasAttribute("disabled")).toBe(false);
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

  it("renders a draft-revocation notice without hiding durable action feedback", () => {
    const controller = new TestKnowledgeStudioController({
      ...createReadyState(),
      feedback: { kind: "blocked", message: "The durable action remains blocked." },
      reviewDraftNotice: "This proposal changed. Its session-only Review draft was cleared.",
    });
    renderStudio(controller);

    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("durable action remains blocked"),
        expect.stringContaining("Review draft was cleared"),
      ])
    );
  });
});
