import { KnowledgeSourcePathIndex } from "@/knowledge/sourceLifecycle/KnowledgeSourcePathIndex";
import type { Menu, TAbstractFile } from "obsidian";

export interface KnowledgeSourceMenuInput {
  readonly index: KnowledgeSourcePathIndex;
  readonly openKnowledgeStudio: () => void;
}

function addWarning(menu: Menu, title: string): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon("triangle-alert").setDisabled(true);
  });
}

function addOpenStudioAction(menu: Menu, openKnowledgeStudio: () => void): void {
  menu.addItem((item) => {
    item
      .setTitle("Open Knowledge Studio before deleting…")
      .setIcon("library-big")
      .onClick(openKnowledgeStudio);
  });
}

export function registerKnowledgeSourceMenu(
  menu: Menu,
  file: TAbstractFile,
  input: KnowledgeSourceMenuInput
): void {
  const match = input.index.lookup(file.path);
  const exactCount = match.exact.length + match.caseAliases.length;
  const descendantCount = match.descendants.length;
  if (exactCount === 0 && descendantCount === 0) return;

  menu.addSeparator();
  if (exactCount > 0) {
    addWarning(menu, "Registered Knowledge source — deleting it will require recovery");
  } else {
    addWarning(
      menu,
      `Contains ${descendantCount} registered Knowledge ${
        descendantCount === 1 ? "source" : "sources"
      } — remove safely first`
    );
  }
  addOpenStudioAction(menu, input.openKnowledgeStudio);
}
