import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  snapshotKnowledgeForwardRevisionOverlayExtension,
  type KnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import {
  captureForwardApplyJson,
  freezeForwardApplyJson,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type { GeneratedPageOwnership, SourceManifest } from "@/knowledge/model/types";
import { validateSourceManifest } from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

export interface KnowledgeSourceApplyPageOrigin {
  readonly kind: "source_apply";
}

export interface KnowledgeForwardRevisionPageOrigin {
  readonly kind: "forward_revision";
  readonly overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>;
}

export type KnowledgeEffectivePageOrigin =
  | KnowledgeSourceApplyPageOrigin
  | KnowledgeForwardRevisionPageOrigin;

export interface KnowledgeEffectiveManifestPage {
  readonly bundleId: string;
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceIds: readonly string[];
  readonly sourceAppliedContentHash: string;
  readonly effectiveContentHash: string;

  readonly contentHash: string;
  readonly origin: Readonly<KnowledgeEffectivePageOrigin>;
}

interface MutableEffectivePage {
  bundleId: string;
  path: string;
  windowsPathKey: string;
  ownership: GeneratedPageOwnership;
  sourceIds: Set<string>;
  sourceAppliedContentHash: string;
  effectiveContentHash: string;
  origin: Readonly<KnowledgeEffectivePageOrigin>;
}

export class KnowledgeEffectivePageProjectionError extends TypeError {
  constructor() {
    super("Effective Manifest pages do not satisfy the strict authority contract");
    this.name = "KnowledgeEffectivePageProjectionError";
    Object.freeze(this);
  }
}

function invalid(): never {
  throw new KnowledgeEffectivePageProjectionError();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotManifest(value: unknown): Readonly<SourceManifest> {
  const captured = captureForwardApplyJson(value);
  if (captured === undefined) return invalid();
  const parsed = parseSourceManifest(captured);
  if (!parsed.ok || !validateSourceManifest(parsed.value).valid) return invalid();
  return freezeForwardApplyJson(parsed.value);
}

function addSourceAppliedPage(
  pagesByKey: Map<string, MutableEffectivePage>,
  bundleId: string,
  sourceId: string,
  page: Readonly<{
    path: string;
    ownership: GeneratedPageOwnership;
    contentHash?: string;
  }>
): void {
  if (page.contentHash === undefined) return invalid();
  const windowsPathKey = toWindowsPathKey(page.path);
  const existing = pagesByKey.get(windowsPathKey);
  if (!existing) {
    pagesByKey.set(windowsPathKey, {
      bundleId,
      path: page.path,
      windowsPathKey,
      ownership: page.ownership,
      sourceIds: new Set([sourceId]),
      sourceAppliedContentHash: page.contentHash,
      effectiveContentHash: page.contentHash,
      origin: Object.freeze({ kind: "source_apply" as const }),
    });
    return;
  }
  if (
    existing.sourceIds.has(sourceId) ||
    existing.path !== page.path ||
    existing.ownership !== page.ownership ||
    existing.sourceAppliedContentHash !== page.contentHash ||
    existing.origin.kind !== "source_apply"
  ) {
    return invalid();
  }
  existing.sourceIds.add(sourceId);
}

function applyForwardOverlay(
  pagesByKey: Map<string, MutableEffectivePage>,
  overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>,
  manifest: Readonly<SourceManifest>
): void {
  const page = pagesByKey.get(overlay.windowsPathKey);
  const source = manifest.entries.find((entry) => entry.sourceId === overlay.sourceId);
  if (
    overlay.bundleId !== manifest.bundleId ||
    !page ||
    !source?.lastSuccessful ||
    page.path !== overlay.pagePath ||
    page.ownership !== "generated" ||
    page.sourceIds.size !== 1 ||
    !page.sourceIds.has(overlay.sourceId) ||
    page.sourceAppliedContentHash !== overlay.sourceAppliedContentHash ||
    page.origin.kind !== "source_apply"
  ) {
    return invalid();
  }
  page.effectiveContentHash = overlay.effectiveContentHash;
  page.origin = Object.freeze({
    kind: "forward_revision" as const,
    overlay,
  });
}

function freezePage(page: MutableEffectivePage): Readonly<KnowledgeEffectiveManifestPage> {
  const sourceIds = [...page.sourceIds].sort(compareText);
  if (sourceIds.length > 1 && page.ownership !== "shared") return invalid();
  return Object.freeze({
    bundleId: page.bundleId,
    path: page.path,
    windowsPathKey: page.windowsPathKey,
    ownership: page.ownership,
    sourceIds: Object.freeze(sourceIds),
    sourceAppliedContentHash: page.sourceAppliedContentHash,
    effectiveContentHash: page.effectiveContentHash,
    contentHash: page.effectiveContentHash,
    origin: page.origin,
  });
}

export function projectKnowledgeEffectiveManifestPages(
  manifestValue: unknown
): readonly Readonly<KnowledgeEffectiveManifestPage>[] {
  try {
    const manifest = snapshotManifest(manifestValue);
    const pagesByKey = new Map<string, MutableEffectivePage>();
    const entries = [...manifest.entries].sort((left, right) =>
      compareText(left.sourceId, right.sourceId)
    );
    for (const entry of entries) {
      for (const page of entry.lastSuccessful?.generatedPages ?? []) {
        addSourceAppliedPage(pagesByKey, manifest.bundleId, entry.sourceId, page);
      }
    }

    const overlayValue = manifest.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
    if (overlayValue !== undefined) {
      const extension = snapshotKnowledgeForwardRevisionOverlayExtension(overlayValue);
      for (const overlay of extension.entries) {
        applyForwardOverlay(pagesByKey, overlay, manifest);
      }
    }

    return Object.freeze(
      [...pagesByKey.values()]
        .sort((left, right) => compareText(left.windowsPathKey, right.windowsPathKey))
        .map(freezePage)
    );
  } catch (error) {
    if (error instanceof KnowledgeEffectivePageProjectionError) throw error;
    return invalid();
  }
}

Object.freeze(KnowledgeEffectivePageProjectionError.prototype);
Object.freeze(KnowledgeEffectivePageProjectionError);
