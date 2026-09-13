import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

import { KnowledgeRecoveryPanel } from "./KnowledgeRecoveryPanel";

type Props = React.ComponentProps<typeof KnowledgeRecoveryPanel>;

const noop = () => {};

const meta = {
  title: "Knowledge/Recovery Panel",
  component: KnowledgeRecoveryPanel,
  args: {
    onContinue: noop,
    onAbandon: noop,
    onRefresh: noop,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

/**
 * A no-journal proposal whose Knowledge state changed after generation keeps explicit Abandon
 * available but must not advertise Continue as viable.
 */
export const KnowledgeChangedSinceProposalGeneration: StoryObj<Props> = {
  args: {
    model: {
      bundleId: "personal",
      runtimeRevision: 42,
      items: [
        {
          id: "knowledge-no-journal-outdated-proposal",
          status: "decision_required",
          changeSetId: "changeset-outdated-proposal",
          continueBlockedReason: "manifest_read_set_changed",
          actions: { canContinue: false, canAbandon: true },
        },
      ],
    },
  },
};
