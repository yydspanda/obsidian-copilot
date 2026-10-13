import type { WorkspaceLeaf } from "obsidian";

export interface KnowledgeStudioPresentationHint {
  readonly doc: Document;
  readonly win: Window;
}

export type KnowledgeStudioPresentationPlan =
  | Readonly<{ kind: "existing"; leaf: WorkspaceLeaf }>
  | Readonly<{ kind: "create_adjacent"; anchor: WorkspaceLeaf }>
  | Readonly<{ kind: "fallback" }>;

export function captureKnowledgeStudioPresentationHint(
  element: Node
): Readonly<KnowledgeStudioPresentationHint> {
  return Object.freeze({ doc: element.doc, win: element.win });
}

function isLeafInPresentationContainer(
  leaf: WorkspaceLeaf,
  hint: Readonly<KnowledgeStudioPresentationHint>
): boolean {
  try {
    const container = leaf.getContainer();
    return container.doc === hint.doc && container.win === hint.win;
  } catch {
    return false;
  }
}

export function planKnowledgeStudioPresentationNavigation(
  studioLeaves: readonly WorkspaceLeaf[],
  allLeaves: readonly WorkspaceLeaf[],
  hint: Readonly<KnowledgeStudioPresentationHint>
): KnowledgeStudioPresentationPlan {
  const existing = studioLeaves.find((leaf) => isLeafInPresentationContainer(leaf, hint));
  if (existing) {
    return Object.freeze({ kind: "existing" as const, leaf: existing });
  }

  const anchor = allLeaves.find((leaf) => isLeafInPresentationContainer(leaf, hint));
  return anchor
    ? Object.freeze({ kind: "create_adjacent" as const, anchor })
    : Object.freeze({ kind: "fallback" as const });
}
