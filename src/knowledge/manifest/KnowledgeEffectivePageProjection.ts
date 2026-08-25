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

/** Source-compile authority remains the current effective page authority. */
export interface KnowledgeSourceApplyPageOrigin {
  readonly kind: "source_apply";
}

/** One exact active forward-revision lineage layered over a source-compile base. */
export interface KnowledgeForwardRevisionPageOrigin {
  readonly kind: "forward_revision";
  readonly overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>;
}

/** Provenance of the bytes that currently constitute one effective Wiki page. */
export type KnowledgeEffectivePageOrigin =
  | KnowledgeSourceApplyPageOrigin
  | KnowledgeForwardRevisionPageOrigin;

/** Windows-unique page authority with its immutable source base and effective head. */
export interface KnowledgeEffectiveManifestPage {
  readonly bundleId: string;
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceIds: readonly string[];
  readonly sourceAppliedContentHash: string;
  readonly effectiveContentHash: string;
  /** Compatibility alias for consumers whose projection already calls the head `contentHash`. */
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

/** Fixed value-free rejection for an invalid or unprovable effective-page projection. */
export class KnowledgeEffectivePageProjectionError extends TypeError {
  /** Creates one sanitized projection failure. */
  constructor() {
    super("Effective Manifest pages do not satisfy the strict authority contract");
    this.name = "KnowledgeEffectivePageProjectionError";
    Object.freeze(this);
  }
}

/** Throws one fixed projection failure without retaining rejected values. */
function invalid(): never {
  throw new KnowledgeEffectivePageProjectionError();
}

/** Compares strings by code unit without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Captures and validates one complete standalone Source Manifest. */
function snapshotManifest(value: unknown): Readonly<SourceManifest> {
  const captured = captureForwardApplyJson(value);
  if (captured === undefined) return invalid();
  const parsed = parseSourceManifest(captured);
  if (!parsed.ok || !validateSourceManifest(parsed.value).valid) return invalid();
  return freezeForwardApplyJson(parsed.value);
}

/** Adds one source-applied page while rejecting ambiguous Windows identities. */
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

/** Applies one exact forward overlay only to its unique source-applied base page. */
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

/** Freezes one deterministic public page projection. */
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

/**
 * Projects every Windows-unique Manifest page into its source base and effective head.
 *
 * `lastSuccessful` remains the immutable source-compile history. An active strict
 * forward overlay changes only the effective head. Missing hashes, ambiguous
 * source ownership, malformed extensions, and overlays that cannot rejoin their
 * exact source-applied page fail closed.
 *
 * @param manifestValue - Strict Source Manifest candidate
 * @returns Deterministically ordered, deeply frozen effective page authorities
 */
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
