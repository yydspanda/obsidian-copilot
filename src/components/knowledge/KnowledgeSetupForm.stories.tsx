import type { Meta, StoryObj } from "@/lib/story";
import { KnowledgeSetupForm, type KnowledgeSetupFormProps } from "./KnowledgeSetupForm";
import type { KnowledgeSetupPort } from "@/knowledge/setup/KnowledgeSetupPort";

const port: KnowledgeSetupPort = {
  getOptions: () => ({
    availability: "available",
    projects: [{ id: "reading", name: "Reading and comparing ideas" }],
    models: [
      { configuredModelId: "pro", label: "DeepSeek V4 Pro" },
      { configuredModelId: "flash", label: "DeepSeek V4 Flash" },
    ],
  }),
  configure: async (request) => ({ ...request, bundleId: "reading" }),
};

const meta = {
  title: "Knowledge/Setup Form",
  component: KnowledgeSetupForm,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<KnowledgeSetupFormProps>;
export default meta;

export const FirstSetup: StoryObj<KnowledgeSetupFormProps> = { args: { port } };
export const MissingPrerequisites: StoryObj<KnowledgeSetupFormProps> = {
  args: {
    port: {
      ...port,
      getOptions: () => ({ availability: "available", projects: [], models: [] }),
    },
  },
};
export const ExistingBundle: StoryObj<KnowledgeSetupFormProps> = {
  args: {
    port: {
      ...port,
      getOptions: () => ({ ...port.getOptions(), availability: "bundle_exists" }),
    },
  },
};
export const Saving: StoryObj<KnowledgeSetupFormProps> = {
  args: {
    port: {
      ...port,
      configure: () => new Promise(() => {}),
    },
  },
};
export const SaveFailure: StoryObj<KnowledgeSetupFormProps> = {
  args: {
    port: {
      ...port,
      configure: async () => {
        throw new Error("Inert save failure");
      },
    },
  },
};
