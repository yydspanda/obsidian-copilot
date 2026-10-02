import type { KnowledgeStudioState } from "@/knowledge/ui/KnowledgeStudioController";
import type { Meta, StoryObj } from "@/lib/story";
import { KnowledgeStudioRoot, type KnowledgeStudioRootProps } from "./KnowledgeStudioRoot";

type Props = KnowledgeStudioRootProps;

const noop = () => {};
const success = {
  kind: "success",
  message: "The query answer was registered as a managed source.",
} as const;

/** Fixed, inert ports keep gallery states independent of plugin runtime. */
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
    setupPort: {
      getOptions: () => ({ availability: "unavailable", projects: [], models: [] }),
      configure: async () => {
        throw new Error("Setup is unavailable in this story.");
      },
    },
    materialPort: {
      prepare: () => null,
      select: () => {
        throw new Error("Material selection is unavailable in this story.");
      },
      add: async () => {
        throw new Error("Material addition is unavailable in this story.");
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
      openProjects: noop,
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

const materialSelection = Object.freeze({
  bundleId: "personal",
  sourcePath: "Reading/Comparing observations.md",
  destinationPath: "Sources/Vault/Reading/Comparing observations.md",
  mode: "snapshot" as const,
});
const materialSession = Object.freeze({
  bundleId: materialSelection.bundleId,
  sourceRoot: "Sources",
  choices: Object.freeze([{ path: materialSelection.sourcePath, size: 2826 }]),
});

// Read-model refresh must not close the chooser while its own snapshot is being added.
// https://github.com/yydspanda/obsidian-copilot/issues/13
export const AddMaterialDuringReadRefresh: StoryObj<Props> = {
  args: {
    ...createProps({
      status: "ready",
      activeTab: "activity",
      refreshing: true,
      bundleId: "personal",
      snapshot: {
        bundleId: "personal",
        revisionToken: "revision-1",
        availability: "ready",
        commandCapabilities: {
          pauseBundle: false,
          resumeBundle: false,
          cancelJob: false,
          retryJob: false,
          reviewReject: false,
          reviewAccept: false,
        },
        activity: {
          bundleId: "personal",
          revision: 1,
          controls: { state: "paused", canPause: false, canResume: false },
          items: [],
          counts: {
            total: 0,
            active: 0,
            terminal: 0,
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
            },
          },
        },
        reviews: [],
        recovery: { bundleId: "personal", runtimeRevision: 1, items: [] },
      },
    }),
    materialPort: {
      prepare: () => materialSession,
      select: () => materialSelection,
      // Keep Adding visible without timers, Vault writes, or model requests.
      add: () => new Promise(noop),
    },
  },
};
