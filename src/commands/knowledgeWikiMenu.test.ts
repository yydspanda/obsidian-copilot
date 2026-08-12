import { registerKnowledgeWikiMenu } from "@/commands/knowledgeWikiMenu";
import type {
  KnowledgeAppliedWikiPathIndex,
  KnowledgeAppliedWikiPathIndexRow,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { TFile, TFolder, type Menu, type MenuItem, type TAbstractFile } from "obsidian";

interface RecordedMenuItem {
  title?: string;
  icon?: string;
  click?: () => void;
}

/** Creates a minimal chainable Menu test seam. */
function createMenu(): { menu: Menu; items: RecordedMenuItem[]; separators: number[] } {
  const items: RecordedMenuItem[] = [];
  const separators: number[] = [];
  const menu = {
    addSeparator: jest.fn(() => {
      separators.push(items.length);
      return menu;
    }),
    addItem: jest.fn((build: (item: MenuItem) => void) => {
      const record: RecordedMenuItem = {};
      const item = {
        setTitle: jest.fn((title: string) => {
          record.title = title;
          return item;
        }),
        setIcon: jest.fn((icon: string) => {
          record.icon = icon;
          return item;
        }),
        onClick: jest.fn((click: () => void) => {
          record.click = click;
          return item;
        }),
      } as unknown as MenuItem;
      build(item);
      items.push(record);
      return menu;
    }),
  } as unknown as Menu;
  return { menu, items, separators };
}

/** Creates a deterministic exact-only path index for one test. */
function createIndex(
  lookupExact: (path: string) => readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
): Pick<KnowledgeAppliedWikiPathIndex, "lookupExact"> {
  return { lookupExact };
}

/** Creates a TFile prototype instance with one own data path for strict menu routing. */
function createFile(path: string): TFile {
  const file: unknown = Object.create(TFile.prototype);
  if (!(file instanceof TFile)) throw new Error("Invalid TFile test seam");
  Object.defineProperty(file, "path", { value: path, enumerable: true, configurable: true });
  return file;
}

/** Creates a TFolder prototype instance with one own data path for negative routing tests. */
function createFolder(path: string): TFolder {
  const folder: unknown = Object.create(TFolder.prototype);
  if (!(folder instanceof TFolder)) throw new Error("Invalid TFolder test seam");
  Object.defineProperty(folder, "path", { value: path, enumerable: true, configurable: true });
  return folder;
}

describe("registerKnowledgeWikiMenu", () => {
  it("offers inspection for one exact current applied page and emits only its page identity", () => {
    const pagePath = "Wiki/Topic.md";
    const row = Object.freeze({ bundleId: "personal", pagePath });
    const index = createIndex((path) => (path === pagePath ? Object.freeze([row]) : []));
    const openInspector = jest.fn();
    const { menu, items, separators } = createMenu();

    registerKnowledgeWikiMenu(menu, createFile(pagePath), {
      index,
      openInspector,
    });

    expect(separators).toEqual([0]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Inspect applied Knowledge page…",
      icon: "file-search",
    });
    items[0].click?.();
    expect(openInspector).toHaveBeenCalledTimes(1);
    expect(openInspector).toHaveBeenCalledWith({ pagePath });
    const emitted: unknown = openInspector.mock.calls[0][0];
    expect(typeof emitted).toBe("object");
    expect(emitted).not.toBeNull();
    if (typeof emitted !== "object" || emitted === null) throw new Error("Missing menu request");
    expect(Reflect.ownKeys(emitted)).toEqual(["pagePath"]);
    expect(Object.isFrozen(emitted)).toBe(true);
  });

  it("does not alter menus for unrelated, case-alias, folder, or stale paths", () => {
    const row = Object.freeze({ bundleId: "personal", pagePath: "Wiki/Topic.md" });
    const index = createIndex((path) => (path === row.pagePath ? Object.freeze([row]) : []));

    for (const path of ["Notes/Ordinary.md", "wiki/topic.md", "Wiki"] as const) {
      const { menu, items, separators } = createMenu();
      registerKnowledgeWikiMenu(menu, createFile(path), {
        index,
        openInspector: jest.fn(),
      });
      expect(items).toEqual([]);
      expect(separators).toEqual([]);
    }
  });

  it("fails closed for ambiguous, mismatched, or throwing advisory lookups", () => {
    const pagePath = "Wiki/Shared.md";
    const cases = [
      createIndex(() =>
        Object.freeze([
          Object.freeze({ bundleId: "personal", pagePath }),
          Object.freeze({ bundleId: "work", pagePath }),
        ])
      ),
      createIndex(() =>
        Object.freeze([Object.freeze({ bundleId: "personal", pagePath: "Wiki/Other.md" })])
      ),
      createIndex(() => {
        throw new Error("untrusted index failure");
      }),
    ];

    for (const index of cases) {
      const { menu, items, separators } = createMenu();
      registerKnowledgeWikiMenu(menu, createFile(pagePath), {
        index,
        openInspector: jest.fn(),
      });
      expect(items).toEqual([]);
      expect(separators).toEqual([]);
    }
  });

  it("does not expose the command for a folder or a file-shaped non-TFile", () => {
    const pagePath = "Wiki/Topic.md";
    const row = Object.freeze({ bundleId: "personal", pagePath });
    const index = createIndex(() => Object.freeze([row]));

    for (const file of [
      createFolder(pagePath) as TAbstractFile,
      { path: pagePath } as TAbstractFile,
    ]) {
      const { menu, items, separators } = createMenu();
      registerKnowledgeWikiMenu(menu, file, { index, openInspector: jest.fn() });
      expect(items).toEqual([]);
      expect(separators).toEqual([]);
    }
  });

  it("does not invoke accessor-based advisory row data", () => {
    const pagePath = "Wiki/Topic.md";
    const getter = jest.fn(() => pagePath);
    const row = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(row, "bundleId", {
      value: "personal",
      enumerable: true,
    });
    Object.defineProperty(row, "pagePath", {
      get: getter,
      enumerable: true,
    });
    const index = createIndex(
      () => Object.freeze([row]) as unknown as readonly KnowledgeAppliedWikiPathIndexRow[]
    );
    const { menu, items } = createMenu();

    registerKnowledgeWikiMenu(menu, createFile(pagePath), {
      index,
      openInspector: jest.fn(),
    });

    expect(getter).not.toHaveBeenCalled();
    expect(items).toEqual([]);
  });
});
