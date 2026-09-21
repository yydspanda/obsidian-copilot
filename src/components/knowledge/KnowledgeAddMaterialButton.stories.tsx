import type { Meta, StoryObj } from "@/lib/story";
import {
  KnowledgeAddMaterialButton,
  type KnowledgeAddMaterialButtonProps,
} from "./KnowledgeAddMaterialButton";

type Props = KnowledgeAddMaterialButtonProps;
const noop = () => {};

const meta = {
  title: "Knowledge/Add materials",
  component: KnowledgeAddMaterialButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    bundleId: "research",
    queueState: "paused",
    onReceipt: noop,
    port: {
      prepare: () => null,
      select: () => {
        throw new Error("This story has no material selection.");
      },
      add: async () => {
        throw new Error("This story does not add materials.");
      },
    },
  },
} satisfies Meta<Props>;
export default meta;

export const Ready: StoryObj<Props> = { args: {} };
export const Disabled: StoryObj<Props> = { args: { disabled: true } };
