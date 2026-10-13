import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
  snapshotKnowledgeForwardRevisionOverlayEntry,
  type KnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import type {
  KnowledgeEffectiveManifestPage,
  KnowledgeEffectivePageOrigin,
} from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import type { GeneratedPageOwnership } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_APPLY_ORIGIN_KEYS = ["kind"] as const;
const FORWARD_REVISION_ORIGIN_KEYS = ["kind", "overlay"] as const;
const FORWARD_REVISION_OVERLAY_V2_KEYS = [
  "version",
  "kind",
  "bundleId",
  "pagePath",
  "windowsPathKey",
  "sourceId",
  "sourceBaseDigest",
  "sourceAppliedContentHash",
  "previousEffectiveContentHash",
  "effectiveContentHash",
  "forwardTransactionId",
  "acceptedDecisionDigest",
  "forwardLedgerIdentityDigest",
  "appliedAt",
] as const;
const EFFECTIVE_HEAD_KEYS = [
  "sourceAppliedContentHash",
  "effectiveContentHash",
  "contentHash",
  "origin",
] as const;

export type KnowledgeAppliedWikiEffectivePageHead = Pick<
  KnowledgeEffectiveManifestPage,
  "sourceAppliedContentHash" | "effectiveContentHash" | "contentHash" | "origin"
>;

export interface KnowledgeAppliedWikiEffectivePageHeadContext {
  readonly bundleId?: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceIds?: readonly string[];
}

export class KnowledgeAppliedWikiEffectivePageHeadError extends TypeError {
  constructor() {
    super("Applied Wiki effective-page head does not satisfy the strict contract");
    this.name = "KnowledgeAppliedWikiEffectivePageHeadError";
    Object.freeze(this);
  }
}

function invalid(): never {
  throw new KnowledgeAppliedWikiEffectivePageHeadError();
}

function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string") ||
      !keys.every((key) => ownKeys.includes(key))
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function readKind(value: unknown): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotForwardOverlay(value: unknown): Readonly<KnowledgeForwardRevisionOverlayEntry> {
  const record = snapshotExactRecord(value, FORWARD_REVISION_OVERLAY_V2_KEYS);
  if (
    !record ||
    record.version !== KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION ||
    record.kind !== "forward_revision_overlay_entry"
  ) {
    return invalid();
  }
  try {
    return snapshotKnowledgeForwardRevisionOverlayEntry(value);
  } catch {
    return invalid();
  }
}

function snapshotOrigin(
  value: unknown,
  context: Readonly<KnowledgeAppliedWikiEffectivePageHeadContext>,
  sourceAppliedContentHash: string,
  effectiveContentHash: string
): Readonly<KnowledgeEffectivePageOrigin> {
  const kind = readKind(value);
  if (kind === "source_apply") {
    if (
      !snapshotExactRecord(value, SOURCE_APPLY_ORIGIN_KEYS) ||
      sourceAppliedContentHash !== effectiveContentHash
    ) {
      return invalid();
    }
    return Object.freeze({ kind: "source_apply" as const });
  }
  if (kind !== "forward_revision") return invalid();
  const record = snapshotExactRecord(value, FORWARD_REVISION_ORIGIN_KEYS);
  if (!record || context.ownership !== "generated") return invalid();
  const overlay = snapshotForwardOverlay(record.overlay);
  if (
    overlay.pagePath !== context.pagePath ||
    overlay.windowsPathKey !== context.windowsPathKey ||
    overlay.windowsPathKey !== toWindowsPathKey(context.pagePath) ||
    overlay.sourceAppliedContentHash !== sourceAppliedContentHash ||
    overlay.effectiveContentHash !== effectiveContentHash ||
    (context.bundleId !== undefined && overlay.bundleId !== context.bundleId) ||
    (context.sourceIds !== undefined &&
      (context.sourceIds.length !== 1 || context.sourceIds[0] !== overlay.sourceId))
  ) {
    return invalid();
  }
  return Object.freeze({ kind: "forward_revision" as const, overlay });
}

export function snapshotKnowledgeAppliedWikiEffectivePageHead(
  value: unknown,
  context: Readonly<KnowledgeAppliedWikiEffectivePageHeadContext>
): Readonly<KnowledgeAppliedWikiEffectivePageHead> {
  const record = snapshotExactRecord(value, EFFECTIVE_HEAD_KEYS);
  if (
    !record ||
    typeof record.sourceAppliedContentHash !== "string" ||
    !SHA256_PATTERN.test(record.sourceAppliedContentHash) ||
    typeof record.effectiveContentHash !== "string" ||
    !SHA256_PATTERN.test(record.effectiveContentHash) ||
    record.contentHash !== record.effectiveContentHash ||
    context.windowsPathKey !== toWindowsPathKey(context.pagePath)
  ) {
    return invalid();
  }
  const origin = snapshotOrigin(
    record.origin,
    context,
    record.sourceAppliedContentHash,
    record.effectiveContentHash
  );
  return Object.freeze({
    sourceAppliedContentHash: record.sourceAppliedContentHash,
    effectiveContentHash: record.effectiveContentHash,
    contentHash: record.effectiveContentHash,
    origin,
  });
}

Object.freeze(KnowledgeAppliedWikiEffectivePageHeadError.prototype);
Object.freeze(KnowledgeAppliedWikiEffectivePageHeadError);
