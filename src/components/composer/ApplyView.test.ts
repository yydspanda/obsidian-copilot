import type { Root } from "react-dom/client";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ diffViewMode: "split" })),
  updateSetting: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(),
}));

jest.mock("obsidian", () => {
  class MockItemView {
    app = {};
    containerEl: HTMLElement;
    leaf: unknown;

    /** Creates the minimum popout-aware ItemView surface needed by this suite. */
    constructor(leaf: unknown) {
      this.leaf = leaf;
      const container = window.document.createElement("div");
      const title = window.document.createElement("div");
      const content = window.document.createElement("div");
      container.append(title, content);

      Object.assign(content, {
        empty: () => content.replaceChildren(),
        createDiv: () => {
          const child = content.doc.createElement("div");
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
    App: class MockApp {},
    ItemView: MockItemView,
    Notice: jest.fn(),
    TFile: class MockTFile {},
    WorkspaceLeaf: class MockWorkspaceLeaf {},
  };
});

import { ApplyView, type ApplyViewState } from "@/components/composer/ApplyView";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { WorkspaceLeaf } from "obsidian";

interface TestContainer extends HTMLElement {
  migrationCallback?: () => void;
  destroyMigrationListener: jest.Mock;
}

interface RootRecord {
  container: Element | DocumentFragment;
  root: Root;
}

/** Creates one detached test leaf with an observable detach action. */
function createLeaf(): WorkspaceLeaf {
  return { detach: jest.fn() } as unknown as WorkspaceLeaf;
}

/** Creates one valid preview state for lifecycle-only rendering. */
function createState(resultCallback = jest.fn()): ApplyViewState {
  return {
    path: "Wiki/Test.md",
    changes: [{ value: "same\n", added: false, removed: false }],
    resultCallback,
  };
}

describe("ApplyView lifecycle", () => {
  const roots: RootRecord[] = [];

  beforeEach(() => {
    roots.length = 0;
    jest.mocked(createPluginRoot).mockReset();
    jest.mocked(createPluginRoot).mockImplementation((container) => {
      const root = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as Root;
      roots.push({ container, root });
      return root;
    });
  });

  it("keeps the original React host attached across ordinary rerenders", async () => {
    const view = new ApplyView(createLeaf());
    const content = view.containerEl.children[1];

    await view.setState(createState());
    const originalHost = content.firstElementChild;
    await view.onOpen();
    await view.setState(createState());

    expect(createPluginRoot).toHaveBeenCalledTimes(1);
    expect(content.firstElementChild).toBe(originalHost);
    expect(content.contains(roots[0].container as Node)).toBe(true);
    expect(roots[0].root.render).toHaveBeenCalledTimes(3);
  });

  it("unmounts and recreates the root in the migrated window, then cleans it up", async () => {
    const resultCallback = jest.fn();
    const view = new ApplyView(createLeaf());
    const container = view.containerEl as TestContainer;
    const content = view.containerEl.children[1];

    await view.setState(createState(resultCallback));
    await view.onOpen();
    const originalHost = roots[0].container;

    container.migrationCallback?.();

    expect(roots[0].root.unmount).toHaveBeenCalledTimes(1);
    expect(createPluginRoot).toHaveBeenCalledTimes(2);
    expect(roots[1].container).not.toBe(originalHost);
    expect(content.contains(roots[1].container as Node)).toBe(true);
    expect(roots[1].root.render).toHaveBeenCalledTimes(1);

    await view.onClose();

    expect(container.destroyMigrationListener).toHaveBeenCalledTimes(1);
    expect(roots[1].root.unmount).toHaveBeenCalledTimes(1);
    expect(resultCallback).toHaveBeenCalledWith("aborted");
  });
});
