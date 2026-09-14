import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

import { KnowledgeReviewPanel } from "./KnowledgeReviewPanel";

type Props = React.ComponentProps<typeof KnowledgeReviewPanel>;
type Draft = NonNullable<Props["draft"]>;

const EMPTY_DRAFT: Draft = Object.freeze({});
const noop = () => {};

const overviewBlocks: Props["plan"]["files"][number]["blocks"] = [
  {
    blockId: "overview-purpose",
    kind: "change",
    parts: [
      { kind: "removed", value: "# Research overview\n\nCompare the current findings.\n" },
      { kind: "added", value: "# Research overview\n\nCompare findings with the source notes.\n" },
    ],
  },
  {
    blockId: "overview-context",
    kind: "context",
    parts: [{ kind: "context", value: "\n## Observations\n" }],
  },
  {
    blockId: "overview-evidence",
    kind: "change",
    parts: [
      { kind: "removed", value: "The initial sample supports the conclusion.\n" },
      { kind: "added", value: "The initial sample supports a narrower conclusion.\n" },
    ],
  },
  {
    blockId: "overview-next-step-context",
    kind: "context",
    parts: [{ kind: "context", value: "\n## Next steps\n" }],
  },
  {
    blockId: "overview-next-step",
    kind: "change",
    parts: [
      { kind: "removed", value: "Collect more observations.\n" },
      { kind: "added", value: "Collect independent observations before generalizing.\n" },
    ],
  },
];

const plan: Props["plan"] = {
  changeSetId: "review-gallery-proposal",
  bundleId: "review-gallery-bundle",
  proposalDigest: "a".repeat(64),
  snapshotToken: "b".repeat(64),
  operation: "ingest",
  sourceRefs: ["research-notes"],
  validation: { okfValid: true, citationsValid: true, linksValid: true },
  createdAt: 1,
  evidence: [],
  omittedEvidenceCount: 0,
  files: [
    {
      changeId: "overview",
      path: "Knowledge/Research overview.md",
      operation: "update",
      reason: "Clarify what the observations support and what still needs verification.",
      sourceRefs: ["research-notes"],
      integrity: "current",
      capability: "blocks_allowed",
      beforeContent: overviewBlocks
        .flatMap((block) => block.parts.filter((part) => part.kind !== "added"))
        .map((part) => part.value)
        .join(""),
      afterContent: overviewBlocks
        .flatMap((block) => block.parts.filter((part) => part.kind !== "removed"))
        .map((part) => part.value)
        .join(""),
      blocks: overviewBlocks,
    },
    {
      changeId: "glossary",
      path: "Knowledge/Research glossary.md",
      operation: "create",
      reason: "Define the terminology used in the research overview.",
      sourceRefs: ["research-notes"],
      integrity: "current",
      capability: "exact_only",
      beforeContent: "",
      afterContent:
        "# Research glossary\n\nObservation: a recorded result from the source notes.\n",
      blocks: [
        {
          blockId: "glossary-definition",
          kind: "change",
          parts: [
            {
              kind: "added",
              value:
                "# Research glossary\n\nObservation: a recorded result from the source notes.\n",
            },
          ],
        },
      ],
    },
    {
      changeId: "follow-up",
      path: "Knowledge/Follow-up questions.md",
      operation: "update",
      reason: "Keep the next verification step visible alongside the summary.",
      sourceRefs: ["research-notes"],
      integrity: "current",
      capability: "exact_only",
      beforeContent: "# Follow-up questions\n\nWhich observations are missing?\n",
      afterContent: "# Follow-up questions\n\nWhich independent observations are missing?\n",
      blocks: [
        {
          blockId: "follow-up-question",
          kind: "change",
          parts: [
            {
              kind: "removed",
              value: "# Follow-up questions\n\nWhich observations are missing?\n",
            },
            {
              kind: "added",
              value: "# Follow-up questions\n\nWhich independent observations are missing?\n",
            },
          ],
        },
      ],
    },
  ],
};

const allSelected: Draft = {
  overview: { kind: "accept_exact" },
  glossary: { kind: "accept_exact" },
  "follow-up": { kind: "accept_exact" },
};

const defaultProps: Props = {
  plan,
  busy: false,
  acceptCommandsEnabled: true,
  rejectCommandsEnabled: true,
  onSubmit: noop,
};

// Drafts stay interactive without a controller or any file-write capability.
function InteractiveReview(args: Partial<Props>): JSX.Element {
  const [draft, setDraft] = React.useState<Draft>(args.draft ?? EMPTY_DRAFT);
  return (
    <KnowledgeReviewPanel
      {...defaultProps}
      {...args}
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        return true;
      }}
    />
  );
}

const meta = {
  title: "Knowledge/Review Panel",
  component: KnowledgeReviewPanel,
  args: defaultProps,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const InteractiveDraft: StoryObj<Props> = {
  render: InteractiveReview,
};

export const PausedInteractive: StoryObj<Props> = {
  args: { applyPaused: true },
  render: InteractiveReview,
};

// Stored proposals remain inspectable without suggesting that selection updates their authority.
// https://github.com/yydspanda/obsidian-copilot/issues/7
export const OutdatedInteractive: StoryObj<Props> = {
  args: { applyOutdated: true, draft: allSelected },
  render: InteractiveReview,
};

export const OutdatedReadOnly: StoryObj<Props> = {
  args: {
    applyOutdated: true,
    acceptCommandsEnabled: false,
    rejectCommandsEnabled: false,
    draft: allSelected,
  },
};

export const AllSelected: StoryObj<Props> = {
  args: { draft: allSelected },
  render: InteractiveReview,
};

export const MixedPartialAndEdited: StoryObj<Props> = {
  args: {
    draft: {
      overview: {
        kind: "accept_blocks",
        blocks: { "overview-purpose": "accept", "overview-evidence": "reject" },
      },
      glossary: {
        kind: "accept_edited",
        afterContent: "# Research glossary\n\nObservation: a recorded result, not an inference.\n",
      },
      "follow-up": { kind: "reject" },
    },
  },
  render: InteractiveReview,
};

export const Busy: StoryObj<Props> = {
  args: { busy: true, draft: allSelected },
};

export const ReadOnlyWithBlockedFile: StoryObj<Props> = {
  args: {
    acceptCommandsEnabled: false,
    rejectCommandsEnabled: false,
    plan: {
      ...plan,
      files: [
        plan.files[0],
        {
          ...plan.files[1],
          integrity: "occupied",
          capability: "reject_only",
          blockedReason: "review_create_target_occupied",
        },
      ],
    },
  },
};

export const LongProposal: StoryObj<Props> = {
  args: {
    plan: {
      ...plan,
      files: Array.from({ length: 8 }, (_, index) => ({
        ...plan.files[0],
        changeId: `research-section-${index + 1}`,
        path: `Knowledge/Research synthesis and independent verification/Section ${index + 1} observations and follow-up questions.md`,
        reason:
          "Review the source-backed observations, retained context, and proposed follow-up questions before choosing which changes belong in the knowledge collection.",
      })),
    },
  },
  render: InteractiveReview,
};
