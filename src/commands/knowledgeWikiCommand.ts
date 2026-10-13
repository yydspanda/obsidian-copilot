import { TFile } from "obsidian";

import {
  snapshotKnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiPageInspectionRequest,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

export interface KnowledgeWikiInspectionCommandInput {
  readonly index: KnowledgeAppliedWikiPathIndex;
  readonly openInspector: (request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>) => void;
}

function isAuthenticIndex(value: unknown): value is KnowledgeAppliedWikiPathIndex {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      Object.getPrototypeOf(value) === KnowledgeAppliedWikiPathIndex.prototype
    );
  } catch {
    return false;
  }
}

function hasOneExactAdvisoryRow(value: unknown, pagePath: string): boolean {
  try {
    if (!Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    const length = Object.getOwnPropertyDescriptor(value, "length");
    const rowDescriptor = Object.getOwnPropertyDescriptor(value, "0");
    if (
      keys.length !== 2 ||
      !keys.includes("0") ||
      !keys.includes("length") ||
      !length ||
      !("value" in length) ||
      length.value !== 1 ||
      !rowDescriptor ||
      !("value" in rowDescriptor) ||
      !rowDescriptor.enumerable
    ) {
      return false;
    }
    const row: unknown = rowDescriptor.value;
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const rowKeys = Reflect.ownKeys(row);
    const bundleId = Object.getOwnPropertyDescriptor(row, "bundleId");
    const indexedPath = Object.getOwnPropertyDescriptor(row, "pagePath");
    return Boolean(
      rowKeys.length === 2 &&
      rowKeys.includes("bundleId") &&
      rowKeys.includes("pagePath") &&
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

export function checkKnowledgeWikiInspectionCommand(
  checking: boolean,
  file: TFile | null,
  input: KnowledgeWikiInspectionCommandInput
): boolean {
  try {
    if (!(file instanceof TFile) || !isAuthenticIndex(input.index)) return false;
    const pathDescriptor = Object.getOwnPropertyDescriptor(file, "path");
    if (
      !pathDescriptor ||
      !("value" in pathDescriptor) ||
      !pathDescriptor.enumerable ||
      typeof pathDescriptor.value !== "string"
    ) {
      return false;
    }
    const request = snapshotKnowledgeAppliedWikiPageInspectionRequest(
      Object.freeze({ pagePath: pathDescriptor.value })
    );
    const rows = input.index.lookupExact(request.pagePath);
    if (!hasOneExactAdvisoryRow(rows, request.pagePath)) return false;
    if (!checking) input.openInspector(request);
    return true;
  } catch {
    return false;
  }
}
