jest.mock("obsidian", () => {
  class TFile {
    /** Creates one minimal active-file test seam. */
    constructor(public path: string) {}
  }
  return { TFile };
});

import { checkKnowledgeWikiInspectionCommand } from "@/commands/knowledgeWikiCommand";
import { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { TFile } from "obsidian";

/** Creates one authentic TFile-shaped active-file test value. */
function createFile(path: string): TFile {
  const file: unknown = Object.create(TFile.prototype);
  Object.defineProperty(file, "path", { value: path, enumerable: true });
  if (!(file instanceof TFile)) throw new Error("Invalid TFile test seam");
  return file;
}

describe("checkKnowledgeWikiInspectionCommand", () => {
  it("captures and opens one exact indexed TFile only outside the discovery phase", () => {
    const pagePath = "Wiki/Topic.md";
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([Object.freeze({ bundleId: "personal", pagePath })]);
    const openInspector = jest.fn();
    const file = createFile(pagePath);

    expect(checkKnowledgeWikiInspectionCommand(true, file, { index, openInspector })).toBe(true);
    expect(openInspector).not.toHaveBeenCalled();
    expect(checkKnowledgeWikiInspectionCommand(false, file, { index, openInspector })).toBe(true);
    expect(openInspector).toHaveBeenCalledWith({ pagePath });
    expect(Object.isFrozen(openInspector.mock.calls[0][0])).toBe(true);
  });

  it("fails closed for missing, stale, ambiguous, or non-TFile active values", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([
      Object.freeze({ bundleId: "personal", pagePath: "Wiki/Shared.md" }),
      Object.freeze({ bundleId: "work", pagePath: "Wiki/Shared.md" }),
    ]);
    const openInspector = jest.fn();

    expect(
      checkKnowledgeWikiInspectionCommand(true, createFile("Wiki/Missing.md"), {
        index,
        openInspector,
      })
    ).toBe(false);
    expect(
      checkKnowledgeWikiInspectionCommand(false, createFile("Wiki/Shared.md"), {
        index,
        openInspector,
      })
    ).toBe(false);
    expect(checkKnowledgeWikiInspectionCommand(false, null, { index, openInspector })).toBe(false);
    expect(openInspector).not.toHaveBeenCalled();
  });

  it("fails closed after the advisory index is disposed", () => {
    const pagePath = "Wiki/Topic.md";
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([Object.freeze({ bundleId: "personal", pagePath })]);
    index.dispose();

    expect(
      checkKnowledgeWikiInspectionCommand(false, createFile(pagePath), {
        index,
        openInspector: jest.fn(),
      })
    ).toBe(false);
  });

  it("does not invoke an active-file path accessor or accept a prototype-forged index", () => {
    let pathReads = 0;
    const accessorFile: unknown = Object.create(TFile.prototype);
    Object.defineProperty(accessorFile, "path", {
      enumerable: true,
      get: () => {
        pathReads += 1;
        return "Wiki/Topic.md";
      },
    });
    if (!(accessorFile instanceof TFile)) throw new Error("Invalid TFile test seam");
    const realIndex = new KnowledgeAppliedWikiPathIndex();
    realIndex.install([Object.freeze({ bundleId: "personal", pagePath: "Wiki/Topic.md" })]);
    const openInspector = jest.fn();

    expect(
      checkKnowledgeWikiInspectionCommand(false, accessorFile, {
        index: realIndex,
        openInspector,
      })
    ).toBe(false);
    expect(pathReads).toBe(0);

    const forgedIndex = Object.create(
      KnowledgeAppliedWikiPathIndex.prototype
    ) as KnowledgeAppliedWikiPathIndex;
    expect(
      checkKnowledgeWikiInspectionCommand(false, createFile("Wiki/Topic.md"), {
        index: forgedIndex,
        openInspector,
      })
    ).toBe(false);
    expect(openInspector).not.toHaveBeenCalled();
  });
});
