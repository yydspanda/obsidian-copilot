import { KnowledgeStudioRoot } from "@/components/knowledge/KnowledgeStudioRoot";
import { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
import type { Root } from "react-dom/client";

/** Stable Obsidian workspace type for the personal knowledge surface. */
export const KNOWLEDGE_STUDIO_VIEW_TYPE = "obsidian-copilot-knowledge-studio";

/** Default Bundle selected by the first single-user vertical slice. */
export const DEFAULT_KNOWLEDGE_BUNDLE_ID = "personal";

/** Popout-safe ItemView hosting the controller-driven Knowledge Studio UI. */
export class KnowledgeStudioView extends ItemView {
  private root: Root | null = null;
  private windowMigrationDestroy: (() => void) | null = null;

  /**
   * Creates one view with a controller owned by its lifecycle.
   *
   * @param leaf - Obsidian workspace leaf
   * @param controller - Read/command controller for one Bundle session
   * @param bundleId - Bundle opened by this view
   */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: KnowledgeStudioController,
    private readonly bundleId = DEFAULT_KNOWLEDGE_BUNDLE_ID
  ) {
    super(leaf);
  }

  /** Returns the stable Obsidian workspace view type. */
  getViewType(): string {
    return KNOWLEDGE_STUDIO_VIEW_TYPE;
  }

  /** Returns the icon shown in workspace tabs and navigation. */
  getIcon(): string {
    return "library-big";
  }

  /** Returns the visible workspace title. */
  getTitle(): string {
    return "Knowledge Studio";
  }

  /** Returns the visible workspace label. */
  getDisplayText(): string {
    return "Knowledge Studio";
  }

  /** Mounts the React surface and starts its durable Bundle session. */
  async onOpen(): Promise<void> {
    this.renderView();
    this.controller.start(this.bundleId);
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = this.containerEl.onWindowMigrated(() => {
      this.unmountRoot();
      this.renderView();
    });
  }

  /** Releases migration hooks, controller work, and the current React root. */
  async onClose(): Promise<void> {
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = null;
    this.controller.destroy();
    this.unmountRoot();
  }

  /** Creates a fresh React root in the document currently owning the view. */
  private renderView(): void {
    const contentEl = this.containerEl.children[1];
    contentEl.empty();
    const rootEl = contentEl.createDiv({ cls: "copilot-knowledge-studio-root tw-h-full" });
    this.root = createPluginRoot(rootEl, this.app);
    this.root.render(<KnowledgeStudioRoot controller={this.controller} />);
  }

  /** Unmounts the React tree from the exact document that created it. */
  private unmountRoot(): void {
    this.root?.unmount();
    this.root = null;
  }
}
