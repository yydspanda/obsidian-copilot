import type { Root } from "react-dom/client";

jest.mock("@/components/knowledge/KnowledgeStudioRoot", () => ({
  KnowledgeStudioRoot: jest.fn(() => null),
}));

jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(),
}));

jest.mock("obsidian", () => {
  class MockItemView {
    app = {};
    containerEl: HTMLElement;

    /** Creates the minimum popout-aware ItemView surface needed by this suite. */
    constructor(_leaf: unknown) {
      const container = window.document.createElement("div");
      const title = window.document.createElement("div");
      const content = window.document.createElement("div");
      container.append(title, content);

      Object.assign(content, {
        empty: () => content.replaceChildren(),
        createDiv: (options?: { cls?: string }) => {
          const child = content.doc.createElement("div");
          if (options?.cls) child.className = options.cls;
          content.appendChild(child);
          return child;
        },
      });

      const destroyMigrationListener = jest.fn();
      Object.assign(container, {
        migrationCallback: undefined,
        destroyMigrationListener,
        onWindowMigrated: jest.fn((callback: () => void) => {
          Object.assign(container, { migrationCallback: callback });
          return destroyMigrationListener;
        }),
      });
      this.containerEl = container;
    }
  }

  return {
    ItemView: MockItemView,
    WorkspaceLeaf: class MockWorkspaceLeaf {},
  };
});

import { KNOWLEDGE_STUDIO_VIEW_TYPE, KnowledgeStudioView } from "@/components/KnowledgeStudioView";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import type { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { WorkspaceLeaf } from "obsidian";

interface TestContainer extends HTMLElement {
  migrationCallback?: () => void;
  destroyMigrationListener: jest.Mock;
}

interface ControllerCalls {
  start: jest.Mock;
  showRefreshing: jest.Mock;
  showUnavailable: jest.Mock;
  destroy: jest.Mock;
}

/** Creates one controller-shaped lifecycle spy. */
function createController(): KnowledgeStudioController & ControllerCalls {
  return {
    start: jest.fn(),
    showRefreshing: jest.fn(),
    showUnavailable: jest.fn(),
    destroy: jest.fn(),
  } as unknown as KnowledgeStudioController & ControllerCalls;
}

/** Creates one detached workspace leaf for lifecycle-only rendering. */
function createLeaf(): WorkspaceLeaf {
  return {} as WorkspaceLeaf;
}

/** Creates one stable folder import capability for view-prop verification. */
function createFolderImportPort(): KnowledgeFolderImportPort {
  return { importFolder: jest.fn() };
}

describe("KnowledgeStudioView", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    roots.length = 0;
    jest.mocked(createPluginRoot).mockReset();
    jest.mocked(createPluginRoot).mockImplementation(() => {
      const root = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as Root;
      roots.push(root);
      return root;
    });
  });

  it("exposes stable workspace metadata and starts the selected Bundle", async () => {
    const controller = createController();
    const sessionStore = new KnowledgeStudioSessionStore("Waiting for project configuration.");
    sessionStore.replaceSelection("bundle-1", "Workflow adapters remain unavailable.");
    const folderImportPort = createFolderImportPort();
    const view = new KnowledgeStudioView(createLeaf(), controller, sessionStore, folderImportPort);

    await view.onOpen();

    expect(view.getViewType()).toBe(KNOWLEDGE_STUDIO_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("Knowledge Studio");
    expect(view.getIcon()).toBe("library-big");
    expect(controller.start).toHaveBeenCalledWith("bundle-1");
    expect(controller.showUnavailable).not.toHaveBeenCalled();
    expect(roots[0].render).toHaveBeenCalledTimes(1);
    expect(jest.mocked(roots[0].render).mock.calls[0]?.[0]).toMatchObject({
      props: { controller, folderImportPort },
    });
  });

  it("moves between unavailable and exact Bundle sessions without a shell Bundle identity", async () => {
    const controller = createController();
    const sessionStore = new KnowledgeStudioSessionStore("Waiting for project configuration.");
    const view = new KnowledgeStudioView(
      createLeaf(),
      controller,
      sessionStore,
      createFolderImportPort()
    );

    await view.onOpen();
    expect(controller.showUnavailable).toHaveBeenLastCalledWith(
      "Waiting for project configuration."
    );
    expect(controller.start).not.toHaveBeenCalled();

    sessionStore.replaceSelection("bundle-2", "Workflow adapters remain unavailable.");
    expect(controller.start).toHaveBeenLastCalledWith("bundle-2");

    sessionStore.publishRefreshing();
    expect(controller.showRefreshing).toHaveBeenCalledTimes(1);

    sessionStore.replaceSelection("bundle-2", "Workflow adapters are ready again.");
    expect(controller.start).toHaveBeenCalledTimes(2);
    expect(controller.start).toHaveBeenLastCalledWith("bundle-2");

    sessionStore.replaceSelection(undefined, "Bundle configuration is invalid.");
    expect(controller.showUnavailable).toHaveBeenLastCalledWith("Bundle configuration is invalid.");

    await view.onClose();
    sessionStore.publishRefreshing();
    sessionStore.replaceSelection("bundle-after-close", "Closed view must not restart.");
    expect(controller.start).toHaveBeenCalledTimes(2);
    expect(controller.showRefreshing).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the React root after window migration and cleans up exact owners", async () => {
    const controller = createController();
    const sessionStore = new KnowledgeStudioSessionStore("Waiting for project configuration.");
    sessionStore.replaceSelection("bundle-2", "Workflow adapters remain unavailable.");
    const folderImportPort = createFolderImportPort();
    const view = new KnowledgeStudioView(createLeaf(), controller, sessionStore, folderImportPort);
    const container = view.containerEl as TestContainer;
    await view.onOpen();
    const firstHost = view.containerEl.children[1].firstElementChild;

    container.migrationCallback?.();

    expect(roots[0].unmount).toHaveBeenCalledTimes(1);
    expect(createPluginRoot).toHaveBeenCalledTimes(2);
    expect(view.containerEl.children[1].firstElementChild).not.toBe(firstHost);
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(jest.mocked(roots[1].render).mock.calls[0]?.[0]).toMatchObject({
      props: { controller, folderImportPort },
    });

    await view.onClose();

    expect(container.destroyMigrationListener).toHaveBeenCalledTimes(1);
    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(roots[1].unmount).toHaveBeenCalledTimes(1);
  });

  it("preserves the unload explanation as durable unavailability", async () => {
    const controller = createController();
    const sessionStore = new KnowledgeStudioSessionStore("Waiting for project configuration.");
    sessionStore.replaceSelection("bundle-2", "Ready.");
    const view = new KnowledgeStudioView(
      createLeaf(),
      controller,
      sessionStore,
      createFolderImportPort()
    );
    await view.onOpen();

    sessionStore.dispose();

    expect(controller.showUnavailable).toHaveBeenLastCalledWith(
      "Knowledge Studio is unavailable because the plugin is unloading."
    );
    expect(controller.showRefreshing).not.toHaveBeenCalled();
    await view.onClose();
  });
});
