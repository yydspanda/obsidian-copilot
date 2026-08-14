import type { WorkspaceLeaf } from "obsidian";

/** Non-authoritative renderer-realm hint captured from the presentation that initiated navigation. */
export interface KnowledgeStudioPresentationHint {
  readonly doc: Document;
  readonly win: Window;
}

/** Presentation-local routing plan for opening or revealing Knowledge Studio. */
export type KnowledgeStudioPresentationPlan =
  | Readonly<{ kind: "existing"; leaf: WorkspaceLeaf }>
  | Readonly<{ kind: "create_adjacent"; anchor: WorkspaceLeaf }>
  | Readonly<{ kind: "fallback" }>;

/** Captures the exact renderer realm that owns one mounted presentation element. */
export function captureKnowledgeStudioPresentationHint(
  element: Node
): Readonly<KnowledgeStudioPresentationHint> {
  return Object.freeze({ doc: element.doc, win: element.win });
}

/** Reports whether one live leaf belongs to the exact hinted renderer container. */
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

/**
 * Selects a presentation-local Knowledge Studio target without mutating the workspace.
 *
 * An already-open Studio in the source renderer wins. Otherwise any live leaf in
 * that renderer can anchor a supported adjacent-leaf creation. A stale hint falls
 * back to the caller's ordinary workspace routing.
 */
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
