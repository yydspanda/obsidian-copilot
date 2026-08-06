import {
  MarkdownView,
  TFile,
  type App,
  type Editor,
  type Vault,
  type Workspace,
  type WorkspaceLeaf,
} from "obsidian";

import { normalizeCitationText } from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";
import {
  resolveKnowledgeCitationTarget,
  type KnowledgeCitationMarkdownRangeTarget,
  type KnowledgeCitationTargetResolution,
} from "@/knowledge/query/KnowledgeCitationTargetResolver";

/** Read-only citation navigation request accepted at the Obsidian edge. */
export interface ObsidianKnowledgeCitationNavigationRequest {
  sourcePath: string;
  citation: ClaimCitation;
}

/** Value-free navigation outcome safe to expose outside the Vault adapter. */
export type ObsidianKnowledgeCitationNavigationResult =
  | { status: "opened" }
  | { status: "stale" }
  | { status: "unsupported" }
  | { status: "unavailable" };

/** Value-free source verification result that performs no workspace mutation. */
export type ObsidianKnowledgeCitationVerificationResult =
  | { status: "verified" }
  | { status: "stale" }
  | { status: "unsupported" }
  | { status: "unavailable" };

const OPENED_RESULT = Object.freeze({ status: "opened" as const });
const STALE_RESULT = Object.freeze({ status: "stale" as const });
const UNSUPPORTED_RESULT = Object.freeze({ status: "unsupported" as const });
const UNAVAILABLE_RESULT = Object.freeze({ status: "unavailable" as const });
const VERIFIED_RESULT = Object.freeze({ status: "verified" as const });

/**
 * Reports cancellation without retaining a caller-provided abort reason.
 *
 * @param signal - Optional caller cancellation signal
 * @returns Whether navigation must stop at the current boundary
 */
function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/**
 * Converts a pure resolver failure into the public value-free edge result.
 *
 * @param resolution - Pure citation resolution result
 * @returns Matching sanitized navigator outcome
 */
function mapResolutionFailure(
  resolution: Exclude<KnowledgeCitationTargetResolution, { status: "resolved" }>
): ObsidianKnowledgeCitationNavigationResult {
  if (resolution.status === "stale") return STALE_RESULT;
  if (resolution.status === "unsupported") return UNSUPPORTED_RESULT;
  return UNAVAILABLE_RESULT;
}

/** Converts a pure resolver failure into the no-mutation verification result. */
function mapVerificationFailure(
  resolution: Exclude<KnowledgeCitationTargetResolution, { status: "resolved" }>
): ObsidianKnowledgeCitationVerificationResult {
  if (resolution.status === "stale") return STALE_RESULT;
  if (resolution.status === "unsupported") return UNSUPPORTED_RESULT;
  return UNAVAILABLE_RESULT;
}

/**
 * Confirms that a resolved range exists inside the currently displayed editor.
 *
 * @param editor - Editor owned by the confirmed MarkdownView
 * @param target - Hash-verified Markdown range
 * @returns Whether both endpoints are valid for the displayed document
 */
function isRangeAvailableInEditor(
  editor: Editor,
  target: KnowledgeCitationMarkdownRangeTarget
): boolean {
  if (
    target.from.line < 0 ||
    target.to.line < target.from.line ||
    target.to.line >= editor.lineCount()
  ) {
    return false;
  }
  const fromLine = editor.getLine(target.from.line);
  const toLine = editor.getLine(target.to.line);
  return (
    target.from.ch >= 0 &&
    target.from.ch <= fromLine.length &&
    target.to.ch >= 0 &&
    target.to.ch <= toLine.length &&
    (target.to.line > target.from.line || target.to.ch >= target.from.ch)
  );
}

/**
 * Opens hash-verified Markdown citations using only a captured Obsidian owner.
 *
 * The adapter performs no writes. It re-reads the source after opening its leaf,
 * confirms the resulting view is a MarkdownView, and refuses exact navigation
 * whenever the Vault or displayed editor changed during the operation.
 */
export class ObsidianKnowledgeCitationNavigator {
  private readonly appOwner: App;
  private readonly vaultOwner: Vault;
  private readonly workspaceOwner: Workspace;

  /**
   * Captures the exact App, Vault, and Workspace generation used by this adapter.
   *
   * @param app - Obsidian App owner captured at composition time
   */
  constructor(app: App) {
    this.appOwner = app;
    this.vaultOwner = app.vault;
    this.workspaceOwner = app.workspace;
  }

  /**
   * Reports whether the captured Vault and Workspace still belong to this App.
   *
   * @returns Whether navigation may continue on the captured owner generation
   */
  private isCurrentOwner(): boolean {
    return (
      this.appOwner.vault === this.vaultOwner && this.appOwner.workspace === this.workspaceOwner
    );
  }

  /**
   * Finds an already-open exact Markdown source without assuming the active window.
   *
   * @param sourcePath - Canonical Vault path from the grounded citation authority
   * @returns Existing leaf in any main or pop-out window, when present
   */
  private findOpenMarkdownLeaf(sourcePath: string): WorkspaceLeaf | undefined {
    let matchingLeaf: WorkspaceLeaf | undefined;
    this.workspaceOwner.iterateAllLeaves((leaf) => {
      if (matchingLeaf) return;
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === sourcePath) {
        matchingLeaf = leaf;
      }
    });
    return matchingLeaf;
  }

  /**
   * Re-proves one exact Markdown source citation without opening a leaf or changing selection.
   *
   * @param request - Source path and typed claim citation
   * @param signal - Optional cancellation checked around the Vault read
   * @returns Verified, stale, unsupported, or unavailable
   */
  async verify(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationVerificationResult> {
    try {
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
      const preflight = resolveKnowledgeCitationTarget({
        sourcePath: request.sourcePath,
        citation: request.citation,
        content: "",
      });
      if (preflight.status === "unsupported" || preflight.status === "unavailable") {
        return mapVerificationFailure(preflight);
      }
      const abstractFile = this.vaultOwner.getAbstractFileByPath(request.sourcePath);
      if (
        !(abstractFile instanceof TFile) ||
        abstractFile.path !== request.sourcePath ||
        abstractFile.extension.toLowerCase() !== "md"
      ) {
        return UNAVAILABLE_RESULT;
      }
      if (isAborted(signal)) return UNAVAILABLE_RESULT;
      const content = await this.vaultOwner.read(abstractFile);
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
      const resolution = resolveKnowledgeCitationTarget({
        sourcePath: request.sourcePath,
        citation: request.citation,
        content,
      });
      return resolution.status === "resolved"
        ? VERIFIED_RESULT
        : mapVerificationFailure(resolution);
    } catch {
      return UNAVAILABLE_RESULT;
    }
  }

  /**
   * Navigates to one exact grounded Markdown range.
   *
   * PDF pages remain unsupported until Obsidian exposes a stable public page
   * navigation contract. All exceptions and unavailable views collapse to a
   * value-free result; source paths and adapter causes are never returned.
   *
   * @param request - Source path and typed claim citation
   * @param signal - Optional cancellation checked around every asynchronous boundary
   * @returns Opened, stale, unsupported, or unavailable
   */
  async navigate(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationNavigationResult> {
    try {
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;

      const preflight = resolveKnowledgeCitationTarget({
        sourcePath: request.sourcePath,
        citation: request.citation,
        content: "",
      });
      if (preflight.status === "unsupported" || preflight.status === "unavailable") {
        return mapResolutionFailure(preflight);
      }
      if (isAborted(signal)) return UNAVAILABLE_RESULT;

      const abstractFile = this.vaultOwner.getAbstractFileByPath(request.sourcePath);
      if (
        !(abstractFile instanceof TFile) ||
        abstractFile.path !== request.sourcePath ||
        abstractFile.extension.toLowerCase() !== "md"
      ) {
        return UNAVAILABLE_RESULT;
      }

      if (isAborted(signal)) return UNAVAILABLE_RESULT;
      const firstContent = await this.vaultOwner.read(abstractFile);
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
      const firstResolution = resolveKnowledgeCitationTarget({
        sourcePath: request.sourcePath,
        citation: request.citation,
        content: firstContent,
      });
      if (firstResolution.status !== "resolved") {
        return mapResolutionFailure(firstResolution);
      }

      const leaf =
        this.findOpenMarkdownLeaf(request.sourcePath) ?? this.workspaceOwner.getLeaf("tab");
      if (isAborted(signal)) return UNAVAILABLE_RESULT;
      await leaf.openFile(abstractFile);
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;

      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== request.sourcePath) {
        return UNAVAILABLE_RESULT;
      }
      this.workspaceOwner.revealLeaf(leaf);

      if (isAborted(signal)) return UNAVAILABLE_RESULT;
      const currentContent = await this.vaultOwner.read(abstractFile);
      if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
      const currentResolution = resolveKnowledgeCitationTarget({
        sourcePath: request.sourcePath,
        citation: request.citation,
        content: currentContent,
      });
      if (currentResolution.status !== "resolved") {
        return mapResolutionFailure(currentResolution);
      }

      const editor = view.editor;
      if (normalizeCitationText(editor.getValue()) !== normalizeCitationText(currentContent)) {
        return STALE_RESULT;
      }
      if (!isRangeAvailableInEditor(editor, currentResolution.target)) {
        return UNAVAILABLE_RESULT;
      }
      if (isAborted(signal)) return UNAVAILABLE_RESULT;

      editor.setSelection(currentResolution.target.from, currentResolution.target.to);
      editor.scrollIntoView(
        { from: currentResolution.target.from, to: currentResolution.target.to },
        true
      );
      editor.focus();
      return OPENED_RESULT;
    } catch {
      return UNAVAILABLE_RESULT;
    }
  }
}
