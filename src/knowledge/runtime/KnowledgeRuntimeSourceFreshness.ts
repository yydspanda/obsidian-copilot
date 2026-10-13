import type { NoChangesManifestCommitReason } from "@/knowledge/manifest/NoChangesManifestCommit";
import {
  snapshotKnowledgeForwardRevisionOverlayEntry,
  type KnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import type { GeneratedPageOwnership } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

export const KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION = 2 as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NO_CHANGES_ID_PATTERN = /^knowledge-no-changes-[a-f0-9]{64}$/;
const MAX_GENERATED_PAGES = 10_000;
const COMMON_AUTHORITY_KEYS = [
  "version",
  "kind",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "bundleId",
  "sourceId",
  "sourceContentHash",
  "pipelineFingerprint",
  "inputRevision",
  "manifestRevision",
  "manifestDigest",
  "generatedPages",
] as const;
const APPLIED_AUTHORITY_KEYS = [
  ...COMMON_AUTHORITY_KEYS,
  "transactionId",
  "changeSetId",
  "changeSetDigest",
  "manifestIntentDigest",
  "committedManifestRevision",
  "committedManifestDigest",
  "completedAt",
] as const;
const NO_CHANGES_AUTHORITY_KEYS = [
  ...COMMON_AUTHORITY_KEYS,
  "noChangesId",
  "reason",
  "planDigest",
  "jobId",
  "attempt",
  "committedManifestRevision",
  "completedAt",
] as const;
const GENERATED_PAGE_KEYS = [
  "path",
  "windowsPathKey",
  "ownership",
  "sourceAppliedContentHash",
  "effectiveContentHash",
  "contentHash",
  "origin",
] as const;
const SOURCE_APPLY_ORIGIN_KEYS = ["kind"] as const;
const FORWARD_REVISION_ORIGIN_KEYS = ["kind", "overlay"] as const;
const NO_CHANGES_REASONS: readonly NoChangesManifestCommitReason[] = Object.freeze([
  "analysis_no_targets",
  "resolved_no_targets",
  "all_targets_unchanged",
]);

export interface KnowledgeRuntimeFreshnessGeneratedPage {
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceAppliedContentHash: string;
  readonly effectiveContentHash: string;
  readonly contentHash: string;
  readonly origin:
    | Readonly<{ kind: "source_apply" }>
    | Readonly<{
        kind: "forward_revision";
        overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>;
      }>;
}

interface KnowledgeRuntimeSourceFreshnessAuthorityBase {
  readonly version: typeof KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION;
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly generatedPages: readonly Readonly<KnowledgeRuntimeFreshnessGeneratedPage>[];
}

export interface KnowledgeRuntimeAppliedFreshnessAuthority extends KnowledgeRuntimeSourceFreshnessAuthorityBase {
  readonly kind: "applied";
  readonly transactionId: string;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly manifestIntentDigest: string;
  readonly committedManifestRevision: number;
  readonly committedManifestDigest: string;
  readonly completedAt: number;
}

export interface KnowledgeRuntimeNoChangesFreshnessAuthority extends KnowledgeRuntimeSourceFreshnessAuthorityBase {
  readonly kind: "no_changes";
  readonly noChangesId: string;
  readonly reason: NoChangesManifestCommitReason;
  readonly planDigest: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly committedManifestRevision: number;
  readonly completedAt: number;
}

export type KnowledgeRuntimeSourceFreshnessAuthority =
  | KnowledgeRuntimeAppliedFreshnessAuthority
  | KnowledgeRuntimeNoChangesFreshnessAuthority;

export interface KnowledgeRuntimeSourceFreshnessAuthorityPort {
  readSourceFreshnessAuthority(bundleId: string, sourceId: string): Promise<unknown>;
}

export class KnowledgeRuntimeSourceFreshnessAuthorityValidationError extends TypeError {
  constructor() {
    super("Runtime source freshness authority does not satisfy the strict contract");
    this.name = "KnowledgeRuntimeSourceFreshnessAuthorityValidationError";
    Object.freeze(this);
  }
}

function throwInvalidAuthority(): never {
  throw new KnowledgeRuntimeSourceFreshnessAuthorityValidationError();
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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

function snapshotDensePageArray(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_GENERATED_PAGES ||
      Reflect.ownKeys(value).length !== lengthDescriptor.value + 1
    ) {
      return undefined;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function parseGeneratedPages(
  value: unknown,
  bundleId: string,
  sourceId: string
): readonly Readonly<KnowledgeRuntimeFreshnessGeneratedPage>[] {
  const rawPages = snapshotDensePageArray(value);
  if (!rawPages) return throwInvalidAuthority();
  const pathKeys = new Set<string>();
  const pages = rawPages.map((rawPage) => {
    const page = snapshotExactRecord(rawPage, GENERATED_PAGE_KEYS);
    if (!page) return throwInvalidAuthority();
    const parsedPath = typeof page.path === "string" ? parseVaultPath(page.path) : undefined;
    if (
      !parsedPath?.ok ||
      parsedPath.path !== page.path ||
      page.windowsPathKey !== toWindowsPathKey(parsedPath.path) ||
      (page.ownership !== "generated" &&
        page.ownership !== "shared" &&
        page.ownership !== "user") ||
      !isSha256(page.sourceAppliedContentHash) ||
      !isSha256(page.effectiveContentHash) ||
      page.contentHash !== page.effectiveContentHash
    ) {
      return throwInvalidAuthority();
    }
    if (pathKeys.has(page.windowsPathKey)) return throwInvalidAuthority();
    pathKeys.add(page.windowsPathKey);
    const origin = parseGeneratedPageOrigin(
      page.origin,
      bundleId,
      sourceId,
      parsedPath.path,
      page.sourceAppliedContentHash,
      page.effectiveContentHash,
      page.ownership
    );
    return Object.freeze({
      path: parsedPath.path,
      windowsPathKey: page.windowsPathKey,
      ownership: page.ownership,
      sourceAppliedContentHash: page.sourceAppliedContentHash,
      effectiveContentHash: page.effectiveContentHash,
      contentHash: page.effectiveContentHash,
      origin,
    });
  });
  return Object.freeze(pages);
}

function parseGeneratedPageOrigin(
  value: unknown,
  bundleId: string,
  sourceId: string,
  path: string,
  sourceAppliedContentHash: string,
  effectiveContentHash: string,
  ownership: GeneratedPageOwnership
): KnowledgeRuntimeFreshnessGeneratedPage["origin"] {
  const kind = readAuthorityKind(value);
  if (kind === "source_apply") {
    const record = snapshotExactRecord(value, SOURCE_APPLY_ORIGIN_KEYS);
    if (!record || sourceAppliedContentHash !== effectiveContentHash) {
      return throwInvalidAuthority();
    }
    return Object.freeze({ kind: "source_apply" as const });
  }
  if (kind !== "forward_revision") return throwInvalidAuthority();
  const record = snapshotExactRecord(value, FORWARD_REVISION_ORIGIN_KEYS);
  if (!record) return throwInvalidAuthority();
  let overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>;
  try {
    overlay = snapshotKnowledgeForwardRevisionOverlayEntry(record.overlay);
  } catch {
    return throwInvalidAuthority();
  }
  if (
    ownership !== "generated" ||
    overlay.bundleId !== bundleId ||
    overlay.sourceId !== sourceId ||
    overlay.pagePath !== path ||
    overlay.windowsPathKey !== toWindowsPathKey(path) ||
    overlay.sourceAppliedContentHash !== sourceAppliedContentHash ||
    overlay.effectiveContentHash !== effectiveContentHash
  ) {
    return throwInvalidAuthority();
  }
  return Object.freeze({ kind: "forward_revision" as const, overlay });
}

function readAuthorityKind(value: unknown): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function parseAuthorityCommon(record: Readonly<Record<string, unknown>>) {
  if (
    record.version !== KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION ||
    !isIdentifier(record.runtimeId) ||
    !isNonNegativeInteger(record.runtimeRevision) ||
    !isSha256(record.runtimeDigest) ||
    !isIdentifier(record.bundleId) ||
    !isIdentifier(record.sourceId) ||
    !isSha256(record.sourceContentHash) ||
    !isSha256(record.pipelineFingerprint) ||
    !isNonNegativeInteger(record.inputRevision) ||
    !isNonNegativeInteger(record.manifestRevision) ||
    !isSha256(record.manifestDigest)
  ) {
    return throwInvalidAuthority();
  }
  const bundleId = record.bundleId;
  const sourceId = record.sourceId;
  return Object.freeze({
    version: KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION,
    runtimeId: record.runtimeId,
    runtimeRevision: record.runtimeRevision,
    runtimeDigest: record.runtimeDigest,
    bundleId,
    sourceId,
    sourceContentHash: record.sourceContentHash,
    pipelineFingerprint: record.pipelineFingerprint,
    inputRevision: record.inputRevision,
    manifestRevision: record.manifestRevision,
    manifestDigest: record.manifestDigest,
    generatedPages: parseGeneratedPages(record.generatedPages, bundleId, sourceId),
  });
}

export function parseKnowledgeRuntimeSourceFreshnessAuthority(
  value: unknown
): KnowledgeRuntimeSourceFreshnessAuthority {
  const kind = readAuthorityKind(value);
  if (kind === "applied") {
    const record = snapshotExactRecord(value, APPLIED_AUTHORITY_KEYS);
    if (!record) return throwInvalidAuthority();
    const common = parseAuthorityCommon(record);
    if (
      !isIdentifier(record.transactionId) ||
      !isIdentifier(record.changeSetId) ||
      !isSha256(record.changeSetDigest) ||
      !isSha256(record.manifestIntentDigest) ||
      !isNonNegativeInteger(record.committedManifestRevision) ||
      record.committedManifestRevision > common.manifestRevision ||
      !isSha256(record.committedManifestDigest) ||
      !isNonNegativeInteger(record.completedAt) ||
      common.generatedPages.length === 0
    ) {
      return throwInvalidAuthority();
    }
    return Object.freeze({
      ...common,
      kind: "applied",
      transactionId: record.transactionId,
      changeSetId: record.changeSetId,
      changeSetDigest: record.changeSetDigest,
      manifestIntentDigest: record.manifestIntentDigest,
      committedManifestRevision: record.committedManifestRevision,
      committedManifestDigest: record.committedManifestDigest,
      completedAt: record.completedAt,
    });
  }

  if (kind === "no_changes") {
    const record = snapshotExactRecord(value, NO_CHANGES_AUTHORITY_KEYS);
    if (!record) return throwInvalidAuthority();
    const common = parseAuthorityCommon(record);
    if (
      common.inputRevision < 1 ||
      typeof record.noChangesId !== "string" ||
      !NO_CHANGES_ID_PATTERN.test(record.noChangesId) ||
      !NO_CHANGES_REASONS.includes(record.reason as NoChangesManifestCommitReason) ||
      !isSha256(record.planDigest) ||
      !isIdentifier(record.jobId) ||
      !Number.isSafeInteger(record.attempt) ||
      (record.attempt as number) < 1 ||
      !isNonNegativeInteger(record.committedManifestRevision) ||
      record.committedManifestRevision > common.manifestRevision ||
      !isNonNegativeInteger(record.completedAt)
    ) {
      return throwInvalidAuthority();
    }
    return Object.freeze({
      ...common,
      kind: "no_changes",
      noChangesId: record.noChangesId,
      reason: record.reason as NoChangesManifestCommitReason,
      planDigest: record.planDigest,
      jobId: record.jobId,
      attempt: record.attempt as number,
      committedManifestRevision: record.committedManifestRevision,
      completedAt: record.completedAt,
    });
  }

  return throwInvalidAuthority();
}
