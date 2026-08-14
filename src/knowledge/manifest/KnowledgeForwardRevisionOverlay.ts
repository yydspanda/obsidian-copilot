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
export const KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION = 1 as const;

/** One active content overlay for a previously generated Wiki page. */
export interface KnowledgeForwardRevisionOverlayEntryV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION;
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

/** Strict reserved extension containing canonical Windows-unique overlay entries. */
export interface KnowledgeForwardRevisionOverlayExtensionV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION;
  readonly kind: "forward_revision_overlay_extension";
  readonly entries: readonly Readonly<KnowledgeForwardRevisionOverlayEntryV1>[];
}

/** Input for one exact ledger-bound overlay entry. */
export type CreateKnowledgeForwardRevisionOverlayEntryInput = Omit<
  KnowledgeForwardRevisionOverlayEntryV1,
  "version" | "kind" | "windowsPathKey"
>;

const ENTRY_KEYS = [
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
const CREATE_ENTRY_KEYS = [
  "bundleId",
  "pagePath",
  "sourceId",
  "sourceBaseDigest",
  "baseContentHash",
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
): Readonly<KnowledgeForwardRevisionOverlayEntryV1> {
  try {
    const record = captureForwardApplyRecord(value, ENTRY_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION ||
      record.kind !== "forward_revision_overlay_entry" ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !pagePath ||
      record.windowsPathKey !== toWindowsPathKey(pagePath) ||
      !isForwardApplyIdentifier(record.sourceId) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(record.baseContentHash) ||
      !isForwardApplyDigest(record.effectiveContentHash) ||
      record.baseContentHash === record.effectiveContentHash ||
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
      baseContentHash: record.baseContentHash,
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
): Readonly<KnowledgeForwardRevisionOverlayEntryV1> {
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
): Readonly<KnowledgeForwardRevisionOverlayExtensionV1> {
  try {
    const record = captureForwardApplyRecord(value, EXTENSION_KEYS);
    const rawEntries = snapshotEntryArray(record?.entries);
    if (
      !record ||
      !rawEntries ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION ||
      record.kind !== "forward_revision_overlay_extension"
    ) {
      invalid();
    }
    const entries: Readonly<KnowledgeForwardRevisionOverlayEntryV1>[] = [];
    const transactionIds = new Set<string>();
    const ledgerIdentityDigests = new Set<string>();
    const acceptedDecisionDigests = new Set<string>();
    let previousKey: string | undefined;
    for (const rawEntry of rawEntries) {
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
    `knowledge-forward-revision-overlay-extension-v1\n${canonicalizeJson(
      extension as unknown as JsonValue
    )}`
  );
}

/** Parses an untrusted overlay extension into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionOverlayExtension(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionOverlayExtensionV1>> {
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
): Readonly<KnowledgeForwardRevisionOverlayEntryV1> | undefined {
  const parsedPath = snapshotPagePath(pagePath);
  if (!parsedPath) invalid();
  const extension = snapshotKnowledgeForwardRevisionOverlayExtension(extensionValue);
  const key = toWindowsPathKey(parsedPath);
  return extension.entries.find((entry) => entry.windowsPathKey === key);
}

/**
 * Adds a new overlay to an exact Manifest while preserving every source entry.
 *
 * Existing Windows-equivalent overlays are never replaced; supersession belongs
 * to a later protocol version.
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
      page.contentHash !== entry.baseContentHash ||
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
    if (
      existing.entries.some(
        (candidate) =>
          candidate.windowsPathKey === entry.windowsPathKey ||
          candidate.forwardTransactionId === entry.forwardTransactionId ||
          candidate.forwardLedgerIdentityDigest === entry.forwardLedgerIdentityDigest
      )
    ) {
      invalid();
    }
    const nextExtension = snapshotKnowledgeForwardRevisionOverlayExtension({
      version: KNOWLEDGE_FORWARD_REVISION_OVERLAY_VERSION,
      kind: "forward_revision_overlay_extension",
      entries: [...existing.entries, entry].sort((left, right) =>
        compareText(left.windowsPathKey, right.windowsPathKey)
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
