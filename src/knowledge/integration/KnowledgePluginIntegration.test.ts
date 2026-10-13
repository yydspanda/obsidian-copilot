import { KNOWLEDGE_STUDIO_VIEW_TYPE, KnowledgeStudioView } from "@/components/KnowledgeStudioView";
import { KnowledgePluginIntegration } from "@/knowledge/integration/KnowledgePluginIntegration";
import { isKnowledgeStudioPlatformSupported } from "@/knowledge/ui/platform";
import type { ModelManagementApi } from "@/modelManagement";
import type { Plugin, ViewCreator, WorkspaceLeaf } from "obsidian";

jest.mock("@/knowledge/ui/platform", () => ({
  isKnowledgeStudioPlatformSupported: jest.fn(() => true),
}));

function createIntegration() {
  const registerView = jest.fn();
  const plugin = {
    app: {
      vault: { adapter: {} },
      workspace: { on: jest.fn(), onLayoutReady: jest.fn() },
    },
    manifest: {},
    register: jest.fn(),
    registerEvent: jest.fn(),
    registerView,
    addCommand: jest.fn(),
    addRibbonIcon: jest.fn(),
  } as unknown as Plugin;
  const registerStartedView = jest.fn<void, [string, ViewCreator]>();
  const integration = new KnowledgePluginIntegration({
    plugin,
    modelManagement: {
      providerRegistry: { subscribe: () => () => undefined },
    } as unknown as ModelManagementApi,
    registerStartedView,
    ensureProjectsInitialized: async () => undefined,
    getCurrentProjectId: () => undefined,
    subscribeCurrentProjectChange: () => () => undefined,
    openChat: jest.fn(),
    openProjects: jest.fn(),
  });
  return { integration, registerView, registerStartedView };
}

describe("KnowledgePluginIntegration", () => {
  describe("KnowledgePluginIntegration", () => {
    describe("load()", () => {
      beforeEach(() => jest.mocked(isKnowledgeStudioPlatformSupported).mockReturnValue(true));

      it("publishes the Studio creator once through the host startup boundary without registering its view twice https://github.com/logancyang/obsidian-copilot/issues/3518", () => {
        const { integration, registerView, registerStartedView } = createIntegration();
        try {
          integration.load();
          integration.load();

          expect(registerStartedView).toHaveBeenCalledTimes(1);
          const [type, creator] = registerStartedView.mock.calls[0];
          expect(type).toBe(KNOWLEDGE_STUDIO_VIEW_TYPE);
          expect(creator({} as WorkspaceLeaf)).toBeInstanceOf(KnowledgeStudioView);
          expect(registerView).not.toHaveBeenCalled();
        } finally {
          integration.close();
        }
      });

      it("does not publish a Studio view on unsupported platforms https://github.com/logancyang/obsidian-copilot/issues/3518", () => {
        jest.mocked(isKnowledgeStudioPlatformSupported).mockReturnValue(false);
        const { integration, registerView, registerStartedView } = createIntegration();
        try {
          integration.load();

          expect(registerStartedView).not.toHaveBeenCalled();
          expect(registerView).not.toHaveBeenCalled();
        } finally {
          integration.close();
        }
      });
    });
  });
});
