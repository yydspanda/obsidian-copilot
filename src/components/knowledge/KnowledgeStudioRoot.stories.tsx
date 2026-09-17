import type { KnowledgeStudioState } from "@/knowledge/ui/KnowledgeStudioController";
import type { Meta, StoryObj } from "@/lib/story";
import { KnowledgeStudioRoot, type KnowledgeStudioRootProps } from "./KnowledgeStudioRoot";

type Props = KnowledgeStudioRootProps;

const noop = () => {};
const success = {
  kind: "success",
  message: "The query answer was registered as a managed source.",
} as const;

/** Fixed, inert ports keep these snapshot-free states independent of plugin runtime. */
function createProps(state: KnowledgeStudioState): Props {
  return {
    controller: {
      getState: () => state,
      subscribe: () => noop,
      refresh: async () => {},
    } as unknown as Props["controller"],
    folderImportPort: {
      importFolder: async () => {
        throw new Error("Folder import is unavailable in this story.");
      },
    },
    setupReadiness: {
      subscribe: () => noop,
    } as unknown as Props["setupReadiness"],
    setupNavigation: {
      openCopilotSettings: noop,
      openProjectFile: noop,
      openSchema: noop,
      openChat: noop,
      refreshDisplayedStatus: noop,
    },
  };
}

const meta = {
  title: "Knowledge/Studio",
  component: KnowledgeStudioRoot,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<Props>;
export default meta;

export const RefreshingAfterSave: StoryObj<Props> = {
  args: createProps({
    status: "refreshing",
    activeTab: "query",
    refreshing: true,
    feedback: success,
  }),
};

export const LoadingAfterSave: StoryObj<Props> = {
  args: createProps({
    status: "loading",
    activeTab: "query",
    refreshing: true,
    bundleId: "personal",
    feedback: success,
  }),
};

export const ReloadFailedAfterSave: StoryObj<Props> = {
  args: createProps({
    status: "error",
    activeTab: "query",
    refreshing: false,
    bundleId: "personal",
    feedback: success,
    error: "Knowledge Studio could not load its durable state.",
  }),
};

export const RefreshingAfterSaveFailure: StoryObj<Props> = {
  args: createProps({
    status: "refreshing",
    activeTab: "query",
    refreshing: true,
    feedback: {
      kind: "error",
      message: "The answer could not be registered as a source.",
    },
  }),
};
