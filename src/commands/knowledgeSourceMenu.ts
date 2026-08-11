import { KnowledgeSourcePathIndex } from "@/knowledge/sourceLifecycle/KnowledgeSourcePathIndex";
import type { Menu, TAbstractFile } from "obsidian";

/** Dependencies retained by the synchronous Obsidian file-menu hook. */
export interface KnowledgeSourceMenuInput {
  readonly index: KnowledgeSourcePathIndex;
  readonly openKnowledgeStudio: () => void;
}

/** Adds one disabled consequence warning without granting a delete or retirement action. */
function addWarning(menu: Menu, title: string): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon("triangle-alert").setDisabled(true);
  });
}

/** Adds the safe navigation action shared by file and containing-folder warnings. */
function addOpenStudioAction(menu: Menu, openKnowledgeStudio: () => void): void {
  menu.addItem((item) => {
    item
      .setTitle("Open Knowledge Studio before deleting…")
      .setIcon("library-big")
      .onClick(openKnowledgeStudio);
  });
}

/**
 * Adds Knowledge source consequences to one Obsidian file menu.
 *
 * Obsidian exposes no universal before-delete hook. This menu warning covers a
 * visible native-menu path without monkey-patching FileManager; keyboard and
 * external Explorer deletions are handled later by Source Missing recovery.
 *
 * @param menu - Current Obsidian file menu
 * @param file - File or folder whose menu is being constructed
 * @param input - Current value-only source index and Studio navigation callback
 */
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
