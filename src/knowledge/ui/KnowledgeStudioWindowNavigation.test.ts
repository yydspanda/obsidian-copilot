import type { WorkspaceLeaf } from "obsidian";

import {
  captureKnowledgeStudioPresentationHint,
  planKnowledgeStudioPresentationNavigation,
  type KnowledgeStudioPresentationHint,
} from "@/knowledge/ui/KnowledgeStudioWindowNavigation";

/** Creates a structural leaf owned by one exact renderer container. */
function createLeaf(doc: Document, win: Window): WorkspaceLeaf {
  return {
    getContainer: () => ({ doc, win }),
  } as WorkspaceLeaf;
}

/** Creates an exact presentation hint without relying on the active renderer. */
function createHint(doc: Document, win: Window): Readonly<KnowledgeStudioPresentationHint> {
  return Object.freeze({ doc, win });
}

describe("KnowledgeStudioWindowNavigation", () => {
  it("captures the mounted element's exact owning document and window", () => {
    const ownerDocument = {} as Document;
    const ownerWindow = {} as Window;
    const element = { doc: ownerDocument, win: ownerWindow } as unknown as Node;

    expect(captureKnowledgeStudioPresentationHint(element)).toEqual({
      doc: ownerDocument,
      win: ownerWindow,
    });
  });

  it("prefers an existing Studio leaf in the initiating popout", () => {
    const mainDocument = {} as Document;
    const mainWindow = {} as Window;
    const popoutDocument = {} as Document;
    const popoutWindow = {} as Window;
    const mainStudio = createLeaf(mainDocument, mainWindow);
    const popoutStudio = createLeaf(popoutDocument, popoutWindow);

    expect(
      planKnowledgeStudioPresentationNavigation(
        [mainStudio, popoutStudio],
        [mainStudio, popoutStudio],
        createHint(popoutDocument, popoutWindow)
      )
    ).toEqual({ kind: "existing", leaf: popoutStudio });
  });

  it("creates beside a source-window anchor instead of revealing a Studio in another window", () => {
    const mainDocument = {} as Document;
    const mainWindow = {} as Window;
    const popoutDocument = {} as Document;
    const popoutWindow = {} as Window;
    const mainStudio = createLeaf(mainDocument, mainWindow);
    const popoutAnchor = createLeaf(popoutDocument, popoutWindow);

    expect(
      planKnowledgeStudioPresentationNavigation(
        [mainStudio],
        [mainStudio, popoutAnchor],
        createHint(popoutDocument, popoutWindow)
      )
    ).toEqual({ kind: "create_adjacent", anchor: popoutAnchor });
  });

  it("falls back when the initiating renderer no longer has a live leaf", () => {
    const mainDocument = {} as Document;
    const mainWindow = {} as Window;
    const closedDocument = {} as Document;
    const closedWindow = {} as Window;
    const mainStudio = createLeaf(mainDocument, mainWindow);

    expect(
      planKnowledgeStudioPresentationNavigation(
        [mainStudio],
        [mainStudio],
        createHint(closedDocument, closedWindow)
      )
    ).toEqual({ kind: "fallback" });
  });

  it("requires both document and window identity and fails closed for stale leaves", () => {
    const hintedDocument = {} as Document;
    const hintedWindow = {} as Window;
    const mismatchedDocument = createLeaf({} as Document, hintedWindow);
    const mismatchedWindow = createLeaf(hintedDocument, {} as Window);
    const staleLeaf = {
      getContainer: () => {
        throw new Error("detached");
      },
    } as unknown as WorkspaceLeaf;

    expect(
      planKnowledgeStudioPresentationNavigation(
        [mismatchedDocument, mismatchedWindow, staleLeaf],
        [mismatchedDocument, mismatchedWindow, staleLeaf],
        createHint(hintedDocument, hintedWindow)
      )
    ).toEqual({ kind: "fallback" });
  });
});
