import { registerKnowledgeSourceMenu } from "@/commands/knowledgeSourceMenu";
import { KnowledgeSourcePathIndex } from "@/knowledge/sourceLifecycle/KnowledgeSourcePathIndex";
import type { Menu, MenuItem, TAbstractFile } from "obsidian";

interface RecordedMenuItem {
  title?: string;
  icon?: string;
  disabled?: boolean;
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
        setDisabled: jest.fn((disabled: boolean) => {
          record.disabled = disabled;
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

describe("registerKnowledgeSourceMenu", () => {
  const index = new KnowledgeSourcePathIndex();

  beforeEach(() => {
    index.install([
      { bundleId: "bundle", sourceId: "source-a", sourcePath: "Sources/Topic/A.md" },
      { bundleId: "bundle", sourceId: "source-b", sourcePath: "Sources/Topic/B.pdf" },
    ]);
  });

  it("warns for an exact registered source and opens Studio only on explicit action", () => {
    const { menu, items, separators } = createMenu();
    const openKnowledgeStudio = jest.fn();

    registerKnowledgeSourceMenu(menu, { path: "Sources/Topic/A.md" } as TAbstractFile, {
      index,
      openKnowledgeStudio,
    });

    expect(separators).toEqual([0]);
    expect(items.slice(0, 1)).toEqual([
      {
        title: "Registered Knowledge source — deleting it will require recovery",
        icon: "triangle-alert",
        disabled: true,
      },
    ]);
    expect(items[1]).toMatchObject({
      title: "Open Knowledge Studio before deleting…",
      icon: "library-big",
    });
    expect(typeof items[1].click).toBe("function");
    items[1].click?.();
    expect(openKnowledgeStudio).toHaveBeenCalledTimes(1);
  });

  it("warns once for a folder containing registered descendants", () => {
    const { menu, items } = createMenu();

    registerKnowledgeSourceMenu(menu, { path: "Sources/Topic" } as TAbstractFile, {
      index,
      openKnowledgeStudio: jest.fn(),
    });

    expect(items[0]).toMatchObject({
      title: "Contains 2 registered Knowledge sources — remove safely first",
      disabled: true,
    });
  });

  it("does not alter unrelated file menus", () => {
    const { menu, items, separators } = createMenu();
    registerKnowledgeSourceMenu(menu, { path: "Notes/Ordinary.md" } as TAbstractFile, {
      index,
      openKnowledgeStudio: jest.fn(),
    });
    expect(items).toEqual([]);
    expect(separators).toEqual([]);
  });
});
