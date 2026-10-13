import { KnowledgeStudioRoot } from "@/components/knowledge/KnowledgeStudioRoot";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";
import type { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";
import type { KnowledgeSetupPort } from "@/knowledge/setup/KnowledgeSetupPort";
import type { KnowledgeStudioMaterialPort } from "@/knowledge/capture/KnowledgeStudioMaterialPort";
import { KnowledgeStudioController } from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
import type { Root } from "react-dom/client";

export const KNOWLEDGE_STUDIO_VIEW_TYPE = "obsidian-copilot-knowledge-studio";

export class KnowledgeStudioView extends ItemView {
  private root: Root | null = null;
  private windowMigrationDestroy: (() => void) | null = null;
  private sessionUnsubscriber: (() => void) | null = null;
  private currentBundleId?: string;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: KnowledgeStudioController,
    private readonly sessionStore: KnowledgeStudioSessionStore,
    private readonly folderImportPort: KnowledgeFolderImportPort,
    private readonly setupReadiness: KnowledgeSetupReadinessStore,
    private readonly setupNavigation: KnowledgeSetupNavigationPort,
    private readonly setupPort: KnowledgeSetupPort,
    private readonly materialPort: KnowledgeStudioMaterialPort
  ) {
    super(leaf);
  }

  getViewType(): string {
    return KNOWLEDGE_STUDIO_VIEW_TYPE;
  }

  getIcon(): string {
    return "library-big";
  }

  getTitle(): string {
    return "Knowledge Studio";
  }

  getDisplayText(): string {
    return "Knowledge Studio";
  }

  selectReviewTab(): void {
    this.controller.selectTab("review");
  }

  focusPublishedForwardRevision(reviewRef: string): void {
    this.controller.focusPublishedForwardRevision(reviewRef);
  }

  async onOpen(): Promise<void> {
    this.renderView();
    this.sessionUnsubscriber?.();
    this.sessionUnsubscriber = this.sessionStore.subscribe(() => this.synchronizeSession());
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = this.containerEl.onWindowMigrated(() => {
      this.unmountRoot();
      this.renderView();
    });
  }

  async onClose(): Promise<void> {
    this.sessionUnsubscriber?.();
    this.sessionUnsubscriber = null;
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = null;
    this.currentBundleId = undefined;
    this.controller.destroy();
    this.unmountRoot();
  }

  private synchronizeSession(): void {
    const session = this.sessionStore.getState();
    if (session.status === "refreshing") {
      this.currentBundleId = undefined;
      this.controller.showRefreshing();
      return;
    }
    if (session.status === "unavailable") {
      this.currentBundleId = undefined;
      this.controller.showUnavailable(session.unavailableNotice);
      return;
    }
    if (this.currentBundleId === session.bundleId) {
      return;
    }
    this.currentBundleId = session.bundleId;
    this.controller.start(session.bundleId);
  }

  private renderView(): void {
    const contentEl = this.containerEl.children[1];
    contentEl.empty();
    const rootEl = contentEl.createDiv({ cls: "copilot-knowledge-studio-root tw-h-full" });
    this.root = createPluginRoot(rootEl, this.app);
    this.root.render(
      <KnowledgeStudioRoot
        controller={this.controller}
        folderImportPort={this.folderImportPort}
        setupNavigation={this.setupNavigation}
        setupReadiness={this.setupReadiness}
        setupPort={this.setupPort}
        materialPort={this.materialPort}
      />
    );
  }

  private unmountRoot(): void {
    this.root?.unmount();
    this.root = null;
  }
}
