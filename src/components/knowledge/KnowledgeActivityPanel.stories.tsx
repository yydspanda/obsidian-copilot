import { KnowledgeActivityPanel, type KnowledgeActivityPanelProps } from "./KnowledgeActivityPanel";
import type { KnowledgeActivityItem } from "@/knowledge/ui/activityModel";
import type { Meta, StoryObj } from "@/lib/story";

type Props = KnowledgeActivityPanelProps;

const noop = () => {};

function createProps(overrides: Partial<KnowledgeActivityItem>): Props {
  const item: KnowledgeActivityItem = {
    id: "reading-job",
    sourceId: "Sources/Reading/Comparing observations.md",
    inputRevision: 2,
    attempt: 1,
    status: "completed",
    durableStage: "completed",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    rerunRequested: false,
    terminal: true,
    actions: { canCancel: false, canRetry: false, canReview: false },
    ...overrides,
  };
  return {
    model: {
      bundleId: "reading",
      revision: 7,
      controls: { state: "paused", canPause: false, canResume: true },
      items: [item],
      counts: {
        total: 1,
        active: item.terminal ? 0 : 1,
        terminal: item.terminal ? 1 : 0,
        hiddenTerminal: 0,
        byStatus: {
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
          [item.status]: 1,
        },
      },
    },
    commandCapabilities: { pauseBundle: true, resumeBundle: true, cancelJob: true, retryJob: true },
    onPauseBundle: noop,
    onResumeBundle: noop,
    onCancelJob: noop,
    onRetryJob: noop,
    onReviewJob: noop,
  };
}

const meta = {
  title: "Knowledge/Activity",
  component: KnowledgeActivityPanel,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Applied: StoryObj<Props> = {
  args: createProps({ completion: { kind: "applied" } }),
};

export const AnalysisNoTargets: StoryObj<Props> = {
  args: createProps({ completion: { kind: "no_changes", reason: "analysis_no_targets" } }),
};

export const ResolutionNoTargets: StoryObj<Props> = {
  args: createProps({ completion: { kind: "no_changes", reason: "resolved_no_targets" } }),
};

export const UnchangedGeneration: StoryObj<Props> = {
  args: createProps({
    sourceId:
      "Sources/Reading/Long-term observations across changing conditions and counterexamples.md",
    completion: {
      kind: "no_changes",
      reason: "all_targets_unchanged",
      generationOutcomes: { explicitUnchanged: 2, identicalWrites: 1 },
    },
  }),
};

export const LegacyNoChanges: StoryObj<Props> = {
  args: createProps({ completion: { kind: "no_changes", reason: "all_targets_unchanged" } }),
};

export const LegacyCompleted: StoryObj<Props> = {
  args: createProps({}),
};

const finalizingProps = createProps({ status: "finalizing", terminal: false });

export const Finalizing: StoryObj<Props> = {
  args: {
    ...finalizingProps,
    model: {
      ...finalizingProps.model,
      controls: { state: "finalizing", canPause: false, canResume: false },
    },
  },
};
