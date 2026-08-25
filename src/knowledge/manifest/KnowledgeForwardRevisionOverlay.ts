import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
  SourceManifest,
} from "@/knowledge/model/types";
import {
  captureForwardApplyJson,
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  createKnowledgeForwardRevisionSourceBaseDigest,
  snapshotKnowledgeForwardRevisionSourceBase,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { validateSourceManifest } from "@/knowledge/model/validation";
import { sha256 } from "@/utils/hash";

/** Reserved Bundle Manifest extension holding active forward-revision overlays. */
export const KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY =
  "obsidianCopilotKnowledgeForwardRevisionOverlays" as const;

/** Current strict forward-revision overlay format. */
export const KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION = 2 as const;

/** Legacy one-head overlay accepted only as migration input. */
export interface KnowledgeForwardRevisionOverlayEntryV1 {
  readonly version: 1;
  readonly kind: "forward_revision_overlay_entry";
  readonly bundleId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly sourceId: string;
  readonly sourceBaseDigest: string;
  readonly baseContentHash: string;
  readonly effectiveContentHash: string;
  readonly forwardTransactionId: string;
  readonly acceptedDecisionDigest: string;
  readonly forwardLedgerIdentityDigest: string;
  readonly appliedAt: number;
}

/** One active content overlay for a previously generated Wiki page. */
export interface KnowledgeForwardRevisionOverlayEntryV2 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION;
  readonly kind: "forward_revision_overlay_entry";
  readonly bundleId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly sourceId: string;
  readonly sourceBaseDigest: string;
  /** Immutable content hash last produced by the source compiler. */
  readonly sourceAppliedContentHash: string;
  /** Exact effective head consumed by this forward revision's Vault CAS. */
  readonly previousEffectiveContentHash: string;
  readonly effectiveContentHash: string;
  readonly forwardTransactionId: string;
  readonly acceptedDecisionDigest: string;
  readonly forwardLedgerIdentityDigest: string;
  readonly appliedAt: number;
}

/** Canonical active overlay returned by every strict reader. */
export type KnowledgeForwardRevisionOverlayEntry = KnowledgeForwardRevisionOverlayEntryV2;

/** Legacy overlay extension accepted only as migration input. */
export interface KnowledgeForwardRevisionOverlayExtensionV1 {
  readonly version: 1;
  readonly kind: "forward_revision_overlay_extension";
  readonly entries: readonly Readonly<KnowledgeForwardRevisionOverlayEntryV1>[];
}

/** Strict reserved extension containing canonical Windows-unique overlay entries. */
export interface KnowledgeForwardRevisionOverlayExtensionV2 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION;
  readonly kind: "forward_revision_overlay_extension";
  readonly entries: readonly Readonly<KnowledgeForwardRevisionOverlayEntryV2>[];
}

/** Canonical extension returned by every strict reader. */
export type KnowledgeForwardRevisionOverlayExtension = KnowledgeForwardRevisionOverlayExtensionV2;

/** Input for one exact ledger-bound overlay entry. */
export type CreateKnowledgeForwardRevisionOverlayEntryInput = Omit<
  KnowledgeForwardRevisionOverlayEntryV2,
  "version" | "kind" | "windowsPathKey"
>;

const ENTRY_V1_KEYS = [
  "version",
  "kind",
  "bundleId",
  "pagePath",
  "windowsPathKey",
  "sourceId",
  "sourceBaseDigest",
  "baseContentHash",
  "effectiveContentHash",
  "forwardTransactionId",
  "acceptedDecisionDigest",
  "forwardLedgerIdentityDigest",
  "appliedAt",
] as const;
const ENTRY_V2_KEYS = [
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
const CREATE_ENTRY_KEYS = [
  "bundleId",
  "pagePath",
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
const EXTENSION_KEYS = ["version", "kind", "entries"] as const;

/** Fixed value-free error for invalid forward overlay material. */
export class KnowledgeForwardRevisionOverlayValidationError extends TypeError {
  /** Creates one sanitized error; only this module can mark it authentic. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision overlay does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionOverlayValidationError";
    if (authenticityToken === ERROR_TOKEN) authenticErrors.add(this);
  }
}

const ERROR_TOKEN = Symbol("KnowledgeForwardRevisionOverlayValidationError");
const authenticErrors = new WeakSet<KnowledgeForwardRevisionOverlayValidationError>();

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionOverlayValidationError(ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local failure. */
function isAuthenticError(value: unknown): value is KnowledgeForwardRevisionOverlayValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticErrors.has(value as KnowledgeForwardRevisionOverlayValidationError)
  );
}

/** Captures one canonical Vault path without repairing its spelling. */
function snapshotPagePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1_024) return undefined;
  try {
    const parsed = parseVaultPath(value);
    return parsed.ok && parsed.path === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Compares strings without locale-dependent behavior. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Reads one own enumerable scalar discriminant without invoking candidate code. */
function readDataField(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Captures a dense bounded array without invoking candidate accessors. */
function snapshotEntryArray(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value)) return undefined;
    if (length.value < 0 || length.value > 10_000) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length.value + 1 || keys.some((key) => typeof key === "symbol")) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Strictly snapshots one active overlay entry. */
export function snapshotKnowledgeForwardRevisionOverlayEntry(
  value: unknown
): Readonly<KnowledgeForwardRevisionOverlayEntryV2> {
  try {
    const version = readDataField(value, "version");
    const record = captureForwardApplyRecord(value, version === 1 ? ENTRY_V1_KEYS : ENTRY_V2_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    const sourceAppliedContentHash =
      version === 1 ? record?.baseContentHash : record?.sourceAppliedContentHash;
    const previousEffectiveContentHash =
      version === 1 ? record?.baseContentHash : record?.previousEffectiveContentHash;
    if (
      !record ||
      (version !== 1 && version !== KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION) ||
      record.kind !== "forward_revision_overlay_entry" ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !pagePath ||
      record.windowsPathKey !== toWindowsPathKey(pagePath) ||
      !isForwardApplyIdentifier(record.sourceId) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(sourceAppliedContentHash) ||
      !isForwardApplyDigest(previousEffectiveContentHash) ||
      !isForwardApplyDigest(record.effectiveContentHash) ||
      previousEffectiveContentHash === record.effectiveContentHash ||
      !isForwardApplyIdentifier(record.forwardTransactionId) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyDigest(record.forwardLedgerIdentityDigest) ||
      !isForwardApplyNonNegativeInteger(record.appliedAt)
    ) {
      invalid();
    }
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
      kind: "forward_revision_overlay_entry" as const,
      bundleId: record.bundleId,
      pagePath,
      windowsPathKey: record.windowsPathKey,
      sourceId: record.sourceId,
      sourceBaseDigest: record.sourceBaseDigest,
      sourceAppliedContentHash,
      previousEffectiveContentHash,
      effectiveContentHash: record.effectiveContentHash,
      forwardTransactionId: record.forwardTransactionId,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      forwardLedgerIdentityDigest: record.forwardLedgerIdentityDigest,
      appliedAt: Number(record.appliedAt),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one strict overlay entry from exact finalized ledger fields. */
export function createKnowledgeForwardRevisionOverlayEntry(
  value: CreateKnowledgeForwardRevisionOverlayEntryInput
): Readonly<KnowledgeForwardRevisionOverlayEntryV2> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_ENTRY_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (!record || !pagePath) invalid();
    return snapshotKnowledgeForwardRevisionOverlayEntry({
      version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
      kind: "forward_revision_overlay_entry",
      ...record,
      pagePath,
      windowsPathKey: toWindowsPathKey(pagePath),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots the complete canonical reserved overlay extension. */
export function snapshotKnowledgeForwardRevisionOverlayExtension(
  value: unknown
): Readonly<KnowledgeForwardRevisionOverlayExtensionV2> {
  try {
    const record = captureForwardApplyRecord(value, EXTENSION_KEYS);
    const rawEntries = snapshotEntryArray(record?.entries);
    if (
      !record ||
      !rawEntries ||
      (record.version !== 1 && record.version !== KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION) ||
      record.kind !== "forward_revision_overlay_extension"
    ) {
      invalid();
    }
    const entries: Readonly<KnowledgeForwardRevisionOverlayEntryV2>[] = [];
    const transactionIds = new Set<string>();
    const ledgerIdentityDigests = new Set<string>();
    const acceptedDecisionDigests = new Set<string>();
    let previousKey: string | undefined;
    for (const rawEntry of rawEntries) {
      if (readDataField(rawEntry, "version") !== record.version) invalid();
      const entry = snapshotKnowledgeForwardRevisionOverlayEntry(rawEntry);
      if (
        (previousKey !== undefined && compareText(previousKey, entry.windowsPathKey) >= 0) ||
        transactionIds.has(entry.forwardTransactionId) ||
        ledgerIdentityDigests.has(entry.forwardLedgerIdentityDigest) ||
        acceptedDecisionDigests.has(entry.acceptedDecisionDigest)
      ) {
        invalid();
      }
      previousKey = entry.windowsPathKey;
      transactionIds.add(entry.forwardTransactionId);
      ledgerIdentityDigests.add(entry.forwardLedgerIdentityDigest);
      acceptedDecisionDigests.add(entry.acceptedDecisionDigest);
      entries.push(entry);
    }
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
      kind: "forward_revision_overlay_extension" as const,
      entries: Object.freeze(entries),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the canonical digest of a strict overlay extension. */
export function createKnowledgeForwardRevisionOverlayExtensionDigest(value: unknown): string {
  const extension = snapshotKnowledgeForwardRevisionOverlayExtension(value);
  return sha256(
    `knowledge-forward-revision-overlay-extension-v2\n${canonicalizeJson(
      extension as unknown as JsonValue
    )}`
  );
}

/** Parses an untrusted overlay extension into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionOverlayExtension(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionOverlayExtensionV2>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionOverlayExtension(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_overlay_invalid",
          severity: "error",
          field: KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
          message: "Forward revision overlay does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates an untrusted overlay extension without retaining rejected data. */
export function validateKnowledgeForwardRevisionOverlayExtension(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionOverlayExtension(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Detaches one fixed parser diagnostic. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

/** Finds one active overlay by canonical Windows page identity. */
export function findKnowledgeForwardRevisionOverlay(
  extensionValue: unknown,
  pagePath: string
): Readonly<KnowledgeForwardRevisionOverlayEntryV2> | undefined {
  const parsedPath = snapshotPagePath(pagePath);
  if (!parsedPath) invalid();
  const extension = snapshotKnowledgeForwardRevisionOverlayExtension(extensionValue);
  const key = toWindowsPathKey(parsedPath);
  return extension.entries.find((entry) => entry.windowsPathKey === key);
}

/**
 * Adds or strictly advances one overlay head while preserving source history.
 *
 * A replacement is admitted only when it consumes the exact previous effective
 * head for the same Bundle, source, page, and immutable source-applied base.
 */
export function projectKnowledgeForwardRevisionOverlayAddition(
  manifestValue: unknown,
  entryValue: unknown,
  sourceBaseValue: unknown
): Readonly<SourceManifest> {
  try {
    const captured = captureForwardApplyJson(manifestValue);
    if (captured === undefined) invalid();
    const parsedManifest = parseSourceManifest(captured);
    if (!parsedManifest.ok || !validateSourceManifest(parsedManifest.value).valid) invalid();
    const manifest = freezeForwardApplyJson(parsedManifest.value);
    const entry = snapshotKnowledgeForwardRevisionOverlayEntry(entryValue);
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(sourceBaseValue);
    if (
      manifest.bundleId !== entry.bundleId ||
      manifest.revision >= Number.MAX_SAFE_INTEGER ||
      sourceBase.bundleId !== entry.bundleId ||
      sourceBase.sourceId !== entry.sourceId ||
      createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== entry.sourceBaseDigest
    ) {
      invalid();
    }
    const source = manifest.entries.find((candidate) => candidate.sourceId === entry.sourceId);
    const matchingPages = manifest.entries.flatMap((candidateSource) =>
      (candidateSource.lastSuccessful?.generatedPages ?? [])
        .filter((candidate) => toWindowsPathKey(candidate.path) === entry.windowsPathKey)
        .map((candidate) => ({ source: candidateSource, page: candidate }))
    );
    const page = matchingPages[0]?.page;
    const runtimeCommit = source?.extensions?.obsidianCopilotKnowledgeRuntimeCommit;
    if (
      !source ||
      !page ||
      matchingPages.length !== 1 ||
      matchingPages[0]?.source.sourceId !== source.sourceId ||
      page.path !== entry.pagePath ||
      page.ownership !== "generated" ||
      page.contentHash !== entry.sourceAppliedContentHash ||
      canonicalizeJson(source.lastSuccessful as unknown as JsonValue) !==
        canonicalizeJson(sourceBase.lastSuccessful as unknown as JsonValue) ||
      canonicalizeJson(runtimeCommit as JsonValue) !==
        canonicalizeJson(sourceBase.runtimeSourceCommitExtension)
    ) {
      invalid();
    }
    const existingRaw = manifest.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
    const existing =
      existingRaw === undefined
        ? Object.freeze({
            version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
            kind: "forward_revision_overlay_extension" as const,
            entries: Object.freeze([]),
          })
        : snapshotKnowledgeForwardRevisionOverlayExtension(existingRaw);
    const replaced = existing.entries.find(
      (candidate) => candidate.windowsPathKey === entry.windowsPathKey
    );
    if (
      (replaced === undefined &&
        entry.previousEffectiveContentHash !== entry.sourceAppliedContentHash) ||
      (replaced !== undefined &&
        (replaced.bundleId !== entry.bundleId ||
          replaced.sourceId !== entry.sourceId ||
          replaced.pagePath !== entry.pagePath ||
          replaced.sourceAppliedContentHash !== entry.sourceAppliedContentHash ||
          replaced.effectiveContentHash !== entry.previousEffectiveContentHash ||
          entry.appliedAt < replaced.appliedAt)) ||
      existing.entries.some(
        (candidate) =>
          candidate !== replaced &&
          (candidate.forwardTransactionId === entry.forwardTransactionId ||
            candidate.forwardLedgerIdentityDigest === entry.forwardLedgerIdentityDigest ||
            candidate.acceptedDecisionDigest === entry.acceptedDecisionDigest)
      ) ||
      replaced?.forwardTransactionId === entry.forwardTransactionId ||
      replaced?.forwardLedgerIdentityDigest === entry.forwardLedgerIdentityDigest ||
      replaced?.acceptedDecisionDigest === entry.acceptedDecisionDigest
    ) {
      invalid();
    }
    const nextExtension = snapshotKnowledgeForwardRevisionOverlayExtension({
      version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
      kind: "forward_revision_overlay_extension",
      entries: [...existing.entries.filter((candidate) => candidate !== replaced), entry].sort(
        (left, right) => compareText(left.windowsPathKey, right.windowsPathKey)
      ),
    });
    const next: SourceManifest = {
      ...manifest,
      revision: manifest.revision + 1,
      entries: manifest.entries,
      extensions: {
        ...(manifest.extensions ?? {}),
        [KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]: nextExtension as unknown as JsonValue,
      },
    };
    return freezeForwardApplyJson(next);
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/**
 * Removes one exact active overlay from an already advanced source-commit Manifest.
 *
 * The source transaction owns the Manifest revision increment, so this leaf never
 * changes `revision`. The supplied overlay must rejoin one and only one current
 * entry by its complete canonical identity. Other overlays and extensions remain
 * byte-semantically intact; an empty reserved extension is removed altogether.
 */
export function projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(
  manifestValue: unknown,
  entryValue: unknown
): Readonly<SourceManifest> {
  try {
    const captured = captureForwardApplyJson(manifestValue);
    if (captured === undefined) invalid();
    const parsedManifest = parseSourceManifest(captured);
    if (!parsedManifest.ok || !validateSourceManifest(parsedManifest.value).valid) invalid();
    const manifest = freezeForwardApplyJson(parsedManifest.value);
    const entry = snapshotKnowledgeForwardRevisionOverlayEntry(entryValue);
    if (manifest.bundleId !== entry.bundleId) invalid();
    const extensionValue = manifest.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
    if (extensionValue === undefined) invalid();
    const extension = snapshotKnowledgeForwardRevisionOverlayExtension(extensionValue);
    const identity = canonicalizeJson(entry);
    const matches = extension.entries.filter(
      (candidate) => canonicalizeJson(candidate as unknown as JsonValue) === identity
    );
    if (matches.length !== 1) invalid();
    const remaining = extension.entries.filter((candidate) => candidate !== matches[0]);
    const extensions = { ...(manifest.extensions ?? {}) };
    if (remaining.length === 0) {
      delete extensions[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
    } else {
      extensions[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY] =
        snapshotKnowledgeForwardRevisionOverlayExtension({
          version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
          kind: "forward_revision_overlay_extension",
          entries: remaining,
        }) as unknown as JsonValue;
    }
    const { extensions: _previousExtensions, ...manifestWithoutExtensions } = manifest;
    void _previousExtensions;
    return freezeForwardApplyJson({
      ...manifestWithoutExtensions,
      ...(Object.keys(extensions).length === 0 ? {} : { extensions }),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Verifies exact file bytes against one overlay's effective content identity. */
export function matchesKnowledgeForwardRevisionOverlayContent(
  entryValue: unknown,
  content: string
): boolean {
  const entry = snapshotKnowledgeForwardRevisionOverlayEntry(entryValue);
  return createFileContentHash(content) === entry.effectiveContentHash;
}

Object.freeze(KnowledgeForwardRevisionOverlayValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionOverlayValidationError);
