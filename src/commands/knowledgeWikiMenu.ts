import type { KnowledgeAppliedWikiPageInspectionRequest } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { snapshotKnowledgeAppliedWikiPageInspectionRequest } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { TFile, type Menu, type TAbstractFile } from "obsidian";

/** Identity-only request emitted by the menu without retaining Runtime authority. */
export type KnowledgeWikiInspectionMenuRequest = KnowledgeAppliedWikiPageInspectionRequest;

/** Dependencies retained by the synchronous applied-Wiki file-menu hook. */
export interface KnowledgeWikiMenuInput {
  readonly index: Pick<KnowledgeAppliedWikiPathIndex, "lookupExact">;
  readonly openInspector: (request: Readonly<KnowledgeWikiInspectionMenuRequest>) => void;
}

/** Snapshots one unambiguous exact advisory row without invoking row accessors. */
function hasOneExactAdvisoryRow(value: unknown, pagePath: string): boolean {
  try {
    if (!Array.isArray(value)) return false;
    const arrayKeys = Reflect.ownKeys(value);
    if (arrayKeys.length !== 2 || !arrayKeys.includes("0") || !arrayKeys.includes("length")) {
      return false;
    }
    const rowDescriptor = Object.getOwnPropertyDescriptor(value, "0");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !rowDescriptor ||
      !("value" in rowDescriptor) ||
      !rowDescriptor.enumerable ||
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== 1
    ) {
      return false;
    }
    const row: unknown = rowDescriptor.value;
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const rowKeys = Reflect.ownKeys(row);
    if (rowKeys.length !== 2 || !rowKeys.includes("bundleId") || !rowKeys.includes("pagePath")) {
      return false;
    }
    const bundleId = Object.getOwnPropertyDescriptor(row, "bundleId");
    const indexedPath = Object.getOwnPropertyDescriptor(row, "pagePath");
    return Boolean(
      bundleId &&
        "value" in bundleId &&
        bundleId.enumerable &&
        typeof bundleId.value === "string" &&
        bundleId.value.length > 0 &&
        bundleId.value.length <= 256 &&
        bundleId.value.trim() === bundleId.value &&
        indexedPath &&
        "value" in indexedPath &&
        indexedPath.enumerable &&
        indexedPath.value === pagePath
    );
  } catch {
    return false;
  }
}

/**
 * Adds an inspector action for one exact current applied Knowledge Wiki page.
 *
 * Case aliases, folders, stale historical pages, and unrelated Vault paths
 * never produce an action. The click emits only the canonical page identity;
 * the asynchronous inspector must re-prove current applied state.
 *
 * @param menu - Current Obsidian file menu
 * @param file - File or folder whose menu is being constructed
 * @param input - Exact-only discovery index and inspector-opening callback
 */
export function registerKnowledgeWikiMenu(
  menu: Menu,
  file: TAbstractFile,
  input: KnowledgeWikiMenuInput
): void {
  let request: Readonly<KnowledgeWikiInspectionMenuRequest>;
  try {
    if (!(file instanceof TFile)) return;
    const pathDescriptor = Object.getOwnPropertyDescriptor(file, "path");
    if (
      !pathDescriptor ||
      !("value" in pathDescriptor) ||
      typeof pathDescriptor.value !== "string"
    ) {
      return;
    }
    const requestValue: KnowledgeAppliedWikiPageInspectionRequest = Object.freeze({
      pagePath: pathDescriptor.value,
    });
    request = snapshotKnowledgeAppliedWikiPageInspectionRequest(requestValue);
    const pagePath = request.pagePath;
    const rows = input.index.lookupExact(pagePath);
    if (!hasOneExactAdvisoryRow(rows, pagePath)) return;
  } catch {
    return;
  }
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle("Inspect applied Knowledge page…")
      .setIcon("file-search")
      .onClick(() => input.openInspector(request));
  });
}
