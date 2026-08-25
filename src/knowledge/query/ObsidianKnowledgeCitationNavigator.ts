import {
  MarkdownView,
  TFile,
  type App,
  type Editor,
  type Vault,
  type Workspace,
  type WorkspaceLeaf,
} from "obsidian";

import {
  createSourceContentHash,
  isExactUint8Array,
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";
import { validateClaimCitation } from "@/knowledge/model/validation";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
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

interface KnowledgeCitationNavigationQueueState {
  tail: Promise<void>;
}

const navigationQueueStates = new WeakMap<object, KnowledgeCitationNavigationQueueState>();

// Captured intrinsic performs a non-spoofable ArrayBuffer internal-slot check.
// eslint-disable-next-line @typescript-eslint/unbound-method -- capture the intrinsic getter for a non-spoofable receiver check
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength"
)?.get;

/** Exact resolved PDF page whose artifact bytes have been re-proved. */
interface KnowledgeCitationPdfPageTarget {
  readonly kind: "pdf_page";
  readonly sourcePath: string;
  readonly page: number;
}

/** Sanitized result of resolving one PDF citation against current raw bytes. */
type KnowledgeCitationPdfPageResolution =
  | { status: "resolved"; target: KnowledgeCitationPdfPageTarget }
  | { status: "stale" }
  | { status: "unsupported" }
  | { status: "unavailable" };

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
 * Tests exact ArrayBuffer identity across renderer realms.
 *
 * @param value - Unknown Vault binary-read result
 * @returns Whether ArrayBuffer's intrinsic byteLength getter accepts the receiver
 */
function isExactArrayBuffer(value: unknown): value is ArrayBuffer {
  if (!ARRAY_BUFFER_BYTE_LENGTH_GETTER || typeof value !== "object" || value === null) {
    return false;
  }
  try {
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a structurally valid PDF locator against exact current source bytes.
 *
 * Page numbers are admitted only through the shared ClaimCitation validator,
 * which requires a positive safe integer. The raw-byte SHA-256 must match before
 * the page can become actionable; no decoded PDF text or private viewer state is
 * trusted by this navigation boundary.
 *
 * @param request - Source path and typed claim citation
 * @param bytes - Exact bytes returned by the captured Vault
 * @returns A hash-proved PDF page or one sanitized failure category
 */
function resolvePdfPageTarget(
  request: ObsidianKnowledgeCitationNavigationRequest,
  bytes: Uint8Array
): KnowledgeCitationPdfPageResolution {
  if (typeof request !== "object" || request === null || !isExactUint8Array(bytes)) {
    return UNAVAILABLE_RESULT;
  }
  const parsedPath = parseVaultPath(request.sourcePath);
  if (!parsedPath.ok || parsedPath.path !== request.sourcePath) return UNAVAILABLE_RESULT;
  if (!validateClaimCitation(request.citation).valid) return UNAVAILABLE_RESULT;
  const locator = request.citation.locator;
  if (locator.kind !== "pdf_page") return UNSUPPORTED_RESULT;
  if (createSourceContentHash(bytes) !== locator.artifactContentHash) return STALE_RESULT;
  return Object.freeze({
    status: "resolved" as const,
    target: Object.freeze({
      kind: "pdf_page" as const,
      sourcePath: parsedPath.path,
      page: locator.page,
    }),
  });
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
 * Opens hash-verified citations using only a captured Obsidian owner.
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

  /** Returns the navigation queue shared by every adapter for this exact App owner. */
  private getNavigationQueue(): KnowledgeCitationNavigationQueueState {
    const existing = navigationQueueStates.get(this.appOwner);
    if (existing) return existing;
    const created: KnowledgeCitationNavigationQueueState = { tail: Promise.resolve() };
    navigationQueueStates.set(this.appOwner, created);
    return created;
  }

  /**
   * Re-reads and resolves one exact PDF page without changing the workspace.
   *
   * @param request - Source path and typed claim citation
   * @param signal - Optional cancellation checked around the binary Vault read
   * @returns Current PDF page resolution or a sanitized failure
   */
  private async resolveCurrentPdfPage(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<KnowledgeCitationPdfPageResolution> {
    if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
    const abstractFile = this.vaultOwner.getAbstractFileByPath(request.sourcePath);
    if (
      !(abstractFile instanceof TFile) ||
      abstractFile.path !== request.sourcePath ||
      abstractFile.extension.toLowerCase() !== "pdf"
    ) {
      return UNAVAILABLE_RESULT;
    }
    if (isAborted(signal)) return UNAVAILABLE_RESULT;
    const binary = await this.vaultOwner.readBinary(abstractFile);
    if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;
    if (!isExactArrayBuffer(binary)) return UNAVAILABLE_RESULT;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(binary);
    } catch {
      return UNAVAILABLE_RESULT;
    }
    return resolvePdfPageTarget(request, bytes);
  }

  /**
   * Opens a hash-proved PDF page through Obsidian's canonical public link contract.
   *
   * The exact raw bytes are re-read after the asynchronous workspace operation,
   * matching the Markdown navigator's fail-closed drift check. Private PDF view,
   * DOM, and ephemeral-state APIs are intentionally not used.
   *
   * @param request - Source path and typed PDF claim citation
   * @param signal - Optional cancellation checked around every async boundary
   * @returns Opened, stale, unsupported, or unavailable
   */
  private async navigatePdfPage(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationNavigationResult> {
    if (request.sourcePath.includes("#")) return UNSUPPORTED_RESULT;
    const initial = await this.resolveCurrentPdfPage(request, signal);
    if (initial.status !== "resolved") return mapResolutionFailure(initial);
    if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;

    await this.workspaceOwner.openLinkText(
      `${initial.target.sourcePath}#page=${initial.target.page}`,
      "",
      "tab"
    );
    if (isAborted(signal) || !this.isCurrentOwner()) return UNAVAILABLE_RESULT;

    const current = await this.resolveCurrentPdfPage(request, signal);
    return current.status === "resolved" ? OPENED_RESULT : mapResolutionFailure(current);
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
      if (preflight.status === "unsupported") {
        const resolution = await this.resolveCurrentPdfPage(request, signal);
        return resolution.status === "resolved"
          ? VERIFIED_RESULT
          : mapVerificationFailure(resolution);
      }
      if (preflight.status === "unavailable") {
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
   * Navigates to one exact grounded Markdown range or hash-proved PDF page.
   *
   * PDF pages use Obsidian's public canonical `path#page=N` link contract. All
   * exceptions and unavailable views collapse to a value-free result; source
   * paths and adapter causes are never returned.
   *
   * @param request - Source path and typed claim citation
   * @param signal - Optional cancellation checked around every asynchronous boundary
   * @returns Opened, stale, unsupported, or unavailable
   */
  private async navigateCurrent(
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
      if (preflight.status === "unsupported") {
        return await this.navigatePdfPage(request, signal);
      }
      if (preflight.status === "unavailable") {
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

  /**
   * Serializes workspace navigation across every adapter sharing this App owner.
   *
   * An Obsidian `openFile` or `openLinkText` already in progress cannot be
   * cancelled. Waiting for that concrete side effect to settle before starting
   * the next request ensures a newer citation remains the final visible target.
   *
   * @param request - Source path and typed claim citation
   * @param signal - Optional cancellation checked before and throughout navigation
   * @returns Opened, stale, unsupported, or unavailable
   */
  async navigate(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationNavigationResult> {
    const queue = this.getNavigationQueue();
    const execute = (): Promise<ObsidianKnowledgeCitationNavigationResult> => {
      if (isAborted(signal) || !this.isCurrentOwner()) {
        return Promise.resolve(UNAVAILABLE_RESULT);
      }
      return this.navigateCurrent(request, signal);
    };
    const result = queue.tail.then(execute, execute);
    queue.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
