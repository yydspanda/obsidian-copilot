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

import {
  DEFAULT_KNOWLEDGE_BUNDLE_ID,
  KNOWLEDGE_STUDIO_VIEW_TYPE,
  KnowledgeStudioView,
} from "@/components/KnowledgeStudioView";
import type { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { WorkspaceLeaf } from "obsidian";

interface TestContainer extends HTMLElement {
  migrationCallback?: () => void;
  destroyMigrationListener: jest.Mock;
}

interface ControllerCalls {
  start: jest.Mock;
  destroy: jest.Mock;
}

/** Creates one controller-shaped lifecycle spy. */
function createController(): KnowledgeStudioController & ControllerCalls {
  return {
    start: jest.fn(),
    destroy: jest.fn(),
  } as unknown as KnowledgeStudioController & ControllerCalls;
}

/** Creates one detached workspace leaf for lifecycle-only rendering. */
function createLeaf(): WorkspaceLeaf {
  return {} as WorkspaceLeaf;
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
    const view = new KnowledgeStudioView(createLeaf(), controller);

    await view.onOpen();

    expect(view.getViewType()).toBe(KNOWLEDGE_STUDIO_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("Knowledge Studio");
    expect(view.getIcon()).toBe("library-big");
    expect(controller.start).toHaveBeenCalledWith(DEFAULT_KNOWLEDGE_BUNDLE_ID);
    expect(roots[0].render).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the React root after window migration and cleans up exact owners", async () => {
    const controller = createController();
    const view = new KnowledgeStudioView(createLeaf(), controller, "bundle-2");
    const container = view.containerEl as TestContainer;
    await view.onOpen();
    const firstHost = view.containerEl.children[1].firstElementChild;

    container.migrationCallback?.();

    expect(roots[0].unmount).toHaveBeenCalledTimes(1);
    expect(createPluginRoot).toHaveBeenCalledTimes(2);
    expect(view.containerEl.children[1].firstElementChild).not.toBe(firstHost);
    expect(controller.start).toHaveBeenCalledTimes(1);

    await view.onClose();

    expect(container.destroyMigrationListener).toHaveBeenCalledTimes(1);
    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(roots[1].unmount).toHaveBeenCalledTimes(1);
  });
});
