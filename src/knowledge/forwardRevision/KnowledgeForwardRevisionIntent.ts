import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of a user-requested forward Wiki revision intent. */
export const KNOWLEDGE_FORWARD_REVISION_INTENT_VERSION = 1 as const;

/** Defensive structural limits for detached forward-revision intent snapshots. */
export const KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxSourceIds: 8,
  maxTotalStringCharacters: 8_192,
});

/** Exact historical Apply identity whose accepted output is being proposed again. */
export interface KnowledgeForwardRevisionHistoricalApplyIdentity {
  readonly bundleId: string;
  readonly pagePath: string;
  readonly transactionId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly manifestIntentDigest: string;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
  readonly selectedContentHash: string;
}

/** Current single-owner authority that a future proposal must freshly re-prove. */
export interface KnowledgeForwardRevisionCurrentAuthority {
  readonly currentState: "applied";
  readonly ownership: "generated";
  readonly sourceOrigin: "ingest";
  readonly sourceRetired: false;
  readonly sourceIds: readonly [string];
  readonly primarySourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly manifestBaseHash: string;
  readonly vaultObservedBeforeHash: string;
}

/**
 * Immutable descriptor and proof material for a possible forward revision.
 *
 * Possession of this data never authorizes a Review, Queue, Vault, Runtime, or
 * Manifest write. Every future mutation boundary must independently re-prove
 * current authority and consume its own authentic capability.
 */
export interface KnowledgeForwardRevisionIntent {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_INTENT_VERSION;
  readonly kind: "forward_revision";
  readonly intentId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly historical: Readonly<KnowledgeForwardRevisionHistoricalApplyIdentity>;
  readonly current: Readonly<KnowledgeForwardRevisionCurrentAuthority>;
}

/** Caller facts from which the module derives a canonical opaque intent id. */
export type CreateKnowledgeForwardRevisionIntentInput = Omit<
  KnowledgeForwardRevisionIntent,
  "version" | "kind" | "intentId"
>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INTENT_KEYS = [
  "version",
  "kind",
  "intentId",
  "bundleId",
  "pagePath",
  "historical",
  "current",
] as const;
const HISTORICAL_KEYS = [
  "bundleId",
  "pagePath",
  "transactionId",
  "sourceId",
  "sourceContentHash",
  "pipelineFingerprint",
  "inputRevision",
  "changeSetId",
  "changeSetDigest",
  "manifestIntentDigest",
  "manifestAfterRevision",
  "manifestAfterDigest",
  "appliedAt",
  "selectedContentHash",
] as const;
const CURRENT_KEYS = [
  "currentState",
  "ownership",
  "sourceOrigin",
  "sourceRetired",
  "sourceIds",
  "primarySourceId",
  "sourceContentHash",
  "pipelineFingerprint",
  "inputRevision",
  "manifestRevision",
  "manifestDigest",
  "manifestBaseHash",
  "vaultObservedBeforeHash",
] as const;
const CREATE_INPUT_KEYS = ["bundleId", "pagePath", "historical", "current"] as const;
const INTENT_ID_PATTERN = /^forward-revision-[a-f0-9]{64}$/;
const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionIntentValidationError");
const validationErrorDiagnostics = new WeakMap<
  KnowledgeForwardRevisionIntentValidationError,
  readonly Readonly<KnowledgeDiagnostic>[]
>();
const FALLBACK_VALIDATION_DIAGNOSTICS: readonly Readonly<KnowledgeDiagnostic>[] = Object.freeze([
  Object.freeze({
    code: "forward_revision_intent_invalid",
    severity: "error" as const,
    field: "intent",
    message: "Forward revision intent does not satisfy the strict protocol",
  }),
]);

/** Sanitized strict-snapshot failure containing only fixed protocol diagnostics. */
export class KnowledgeForwardRevisionIntentValidationError extends TypeError {
  /** Creates an error; only module-issued instances carry authentic diagnostics. */
  constructor(diagnostics: readonly Readonly<KnowledgeDiagnostic>[], authenticityToken?: symbol) {
    super("The knowledge forward revision intent is invalid");
    this.name = "KnowledgeForwardRevisionIntentValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) {
      validationErrorDiagnostics.set(
        this,
        Object.freeze(diagnostics.map((item) => Object.freeze({ ...item })))
      );
    }
  }

  /** Returns detached deeply frozen diagnostics, never caller-owned storage. */
  get diagnostics(): readonly Readonly<KnowledgeDiagnostic>[] {
    return validationErrorDiagnostics.get(this) ?? FALLBACK_VALIDATION_DIAGNOSTICS;
  }
}

/** Creates one module-authentic validation error with detached diagnostics. */
function createValidationError(
  diagnostics: readonly Readonly<KnowledgeDiagnostic>[]
): KnowledgeForwardRevisionIntentValidationError {
  return new KnowledgeForwardRevisionIntentValidationError(diagnostics, VALIDATION_ERROR_TOKEN);
}

/** Reports whether an unknown throw is an authentic module-issued failure. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionIntentValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    validationErrorDiagnostics.has(value as KnowledgeForwardRevisionIntentValidationError)
  );
}

/** Creates one fixed safe diagnostic without retaining rejected values. */
function diagnostic(code: string, field: string, message: string): KnowledgeDiagnostic {
  return Object.freeze({ code, severity: "error" as const, field, message });
}

/** Reads one exact plain record entirely through own enumerable data descriptors. */
function snapshotRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !ownKeys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(result, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Captures a bounded dense string array without invoking element accessors. */
function snapshotStringArray(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS.maxSourceIds ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const result: string[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        return undefined;
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Reports whether a string is one bounded canonical identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether text contains only paired Unicode scalar values. */
function isUnicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Reports whether text contains an unsupported C0 or C1 control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether a value is a lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether a value is a non-negative safe integer. */
function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Captures and validates one canonical Vault-relative page path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS.maxPagePathCharacters ||
    !isUnicodeScalarText(value) ||
    hasControlCharacter(value)
  ) {
    return undefined;
  }
  try {
    const parsed = parseVaultPath(value);
    return parsed.ok && parsed.path === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Counts all protocol strings against one fixed construction budget. */
function isWithinStringBudget(values: readonly string[]): boolean {
  let total = 0;
  for (const value of values) {
    total += value.length;
    if (total > KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS.maxTotalStringCharacters) return false;
  }
  return true;
}

/** Strictly snapshots historical Apply authority without retaining caller objects. */
function snapshotHistorical(
  value: unknown
): Readonly<KnowledgeForwardRevisionHistoricalApplyIdentity> | undefined {
  const record = snapshotRecord(value, HISTORICAL_KEYS);
  if (!record) return undefined;
  const identifiers = [record.bundleId, record.transactionId, record.sourceId, record.changeSetId];
  const pagePath = snapshotPagePath(record.pagePath);
  const digests = [
    record.sourceContentHash,
    record.pipelineFingerprint,
    record.changeSetDigest,
    record.manifestIntentDigest,
    record.manifestAfterDigest,
    record.selectedContentHash,
  ];
  if (
    !identifiers.every(isIdentifier) ||
    !pagePath ||
    !digests.every(isDigest) ||
    !isRevision(record.inputRevision) ||
    !isRevision(record.manifestAfterRevision) ||
    Number(record.manifestAfterRevision) < 1 ||
    !isRevision(record.appliedAt) ||
    Number(record.appliedAt) < 1
  ) {
    return undefined;
  }
  return Object.freeze({
    bundleId: record.bundleId as string,
    pagePath,
    transactionId: record.transactionId as string,
    sourceId: record.sourceId as string,
    sourceContentHash: record.sourceContentHash as string,
    pipelineFingerprint: record.pipelineFingerprint as string,
    inputRevision: Number(record.inputRevision),
    changeSetId: record.changeSetId as string,
    changeSetDigest: record.changeSetDigest as string,
    manifestIntentDigest: record.manifestIntentDigest as string,
    manifestAfterRevision: Number(record.manifestAfterRevision),
    manifestAfterDigest: record.manifestAfterDigest as string,
    appliedAt: Number(record.appliedAt),
    selectedContentHash: record.selectedContentHash as string,
  });
}

/** Strictly snapshots current sole-owner authority without retaining caller objects. */
function snapshotCurrent(
  value: unknown
): Readonly<KnowledgeForwardRevisionCurrentAuthority> | undefined {
  const record = snapshotRecord(value, CURRENT_KEYS);
  const sourceIds = snapshotStringArray(record?.sourceIds);
  if (
    !record ||
    record.currentState !== "applied" ||
    record.ownership !== "generated" ||
    record.sourceOrigin !== "ingest" ||
    record.sourceRetired !== false ||
    !sourceIds ||
    sourceIds.length !== 1 ||
    !isIdentifier(sourceIds[0]) ||
    !isIdentifier(record.primarySourceId) ||
    sourceIds[0] !== record.primarySourceId ||
    !isDigest(record.sourceContentHash) ||
    !isDigest(record.pipelineFingerprint) ||
    !isRevision(record.inputRevision) ||
    !isRevision(record.manifestRevision) ||
    Number(record.manifestRevision) < 1 ||
    !isDigest(record.manifestDigest) ||
    !isDigest(record.manifestBaseHash) ||
    !isDigest(record.vaultObservedBeforeHash) ||
    record.manifestBaseHash !== record.vaultObservedBeforeHash
  ) {
    return undefined;
  }
  return Object.freeze({
    currentState: "applied" as const,
    ownership: "generated" as const,
    sourceOrigin: "ingest" as const,
    sourceRetired: false as const,
    sourceIds: Object.freeze([sourceIds[0]] as [string]),
    primarySourceId: record.primarySourceId,
    sourceContentHash: record.sourceContentHash,
    pipelineFingerprint: record.pipelineFingerprint,
    inputRevision: Number(record.inputRevision),
    manifestRevision: Number(record.manifestRevision),
    manifestDigest: record.manifestDigest,
    manifestBaseHash: record.manifestBaseHash,
    vaultObservedBeforeHash: record.vaultObservedBeforeHash,
  });
}

/** Creates the identity payload shared by construction and strict revalidation. */
function createIntentIdentityPayload(
  value: Omit<KnowledgeForwardRevisionIntent, "version" | "kind" | "intentId">
): JsonValue {
  return {
    bundleId: value.bundleId,
    pagePath: value.pagePath,
    historical: value.historical,
    current: value.current,
  } as unknown as JsonValue;
}

/** Derives the opaque deterministic id for one already detached semantic payload. */
function deriveIntentId(
  value: Omit<KnowledgeForwardRevisionIntent, "version" | "kind" | "intentId">
): string {
  return `forward-revision-${sha256(
    `knowledge-forward-revision-id-v1\n${canonicalizeJson(createIntentIdentityPayload(value))}`
  )}`;
}

/** Snapshots common creator facts before the canonical id exists. */
function snapshotCreateInput(
  value: unknown
): Omit<KnowledgeForwardRevisionIntent, "version" | "kind" | "intentId"> {
  const record = snapshotRecord(value, CREATE_INPUT_KEYS);
  const historical = snapshotHistorical(record?.historical);
  const current = snapshotCurrent(record?.current);
  const pagePath = snapshotPagePath(record?.pagePath);
  if (
    !record ||
    !historical ||
    !current ||
    !pagePath ||
    !isIdentifier(record.bundleId) ||
    historical.bundleId !== record.bundleId ||
    historical.pagePath !== pagePath ||
    historical.sourceId !== current.primarySourceId ||
    historical.sourceContentHash !== current.sourceContentHash ||
    historical.pipelineFingerprint !== current.pipelineFingerprint ||
    historical.inputRevision >= current.inputRevision ||
    historical.manifestAfterRevision >= current.manifestRevision ||
    historical.manifestAfterDigest === current.manifestDigest ||
    historical.selectedContentHash === current.manifestBaseHash
  ) {
    throw createValidationError([
      diagnostic(
        "forward_revision_intent_invalid",
        "intent",
        "Forward revision intent does not satisfy the strict protocol"
      ),
    ]);
  }
  return Object.freeze({
    bundleId: record.bundleId,
    pagePath,
    historical,
    current,
  });
}

/**
 * Constructs descriptor-only proof material with a canonical derived intent id.
 *
 * The returned object is data, not write authority. This function performs no
 * I/O and cannot enqueue, persist Review state, or mutate Wiki/Manifest files.
 *
 * @param value - Exact historical and current facts without derived fields
 * @returns Detached deeply frozen canonical intent
 */
export function createKnowledgeForwardRevisionIntent(
  value: CreateKnowledgeForwardRevisionIntentInput
): Readonly<KnowledgeForwardRevisionIntent> {
  try {
    const captured = snapshotCreateInput(value);
    return snapshotKnowledgeForwardRevisionIntent({
      version: KNOWLEDGE_FORWARD_REVISION_INTENT_VERSION,
      kind: "forward_revision",
      intentId: deriveIntentId(captured),
      ...captured,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    throw createValidationError([
      diagnostic(
        "forward_revision_intent_invalid",
        "intent",
        "Forward revision intent does not satisfy the strict protocol"
      ),
    ]);
  }
}

/**
 * Strictly snapshots one forward-revision intent from descriptor-safe bounded data.
 *
 * @param value - Unknown intent crossing a future durable boundary
 * @returns Detached deeply frozen protocol value
 * @throws KnowledgeForwardRevisionIntentValidationError when any invariant fails
 */
export function snapshotKnowledgeForwardRevisionIntent(
  value: unknown
): Readonly<KnowledgeForwardRevisionIntent> {
  try {
    const record = snapshotRecord(value, INTENT_KEYS);
    const historical = snapshotHistorical(record?.historical);
    const current = snapshotCurrent(record?.current);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      !historical ||
      !current ||
      !pagePath ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_INTENT_VERSION ||
      record.kind !== "forward_revision" ||
      !isIdentifier(record.intentId) ||
      !INTENT_ID_PATTERN.test(record.intentId) ||
      !isIdentifier(record.bundleId) ||
      historical.bundleId !== record.bundleId ||
      historical.pagePath !== pagePath ||
      historical.sourceId !== current.primarySourceId ||
      historical.sourceContentHash !== current.sourceContentHash ||
      historical.pipelineFingerprint !== current.pipelineFingerprint ||
      historical.inputRevision >= current.inputRevision ||
      historical.manifestAfterRevision >= current.manifestRevision ||
      historical.manifestAfterDigest === current.manifestDigest ||
      historical.selectedContentHash === current.manifestBaseHash
    ) {
      throw createValidationError([
        diagnostic(
          "forward_revision_intent_invalid",
          "intent",
          "Forward revision intent does not satisfy the strict protocol"
        ),
      ]);
    }
    const strings = [
      record.intentId,
      record.bundleId,
      pagePath,
      ...Object.values(historical).filter((item): item is string => typeof item === "string"),
      ...Object.values(current).flatMap((item) =>
        typeof item === "string" ? [item] : Array.isArray(item) ? item : []
      ),
    ];
    if (!isWithinStringBudget(strings)) {
      throw createValidationError([
        diagnostic(
          "forward_revision_intent_limit_exceeded",
          "intent",
          "Forward revision intent exceeds its bounded string budget"
        ),
      ]);
    }
    const captured = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_INTENT_VERSION,
      kind: "forward_revision" as const,
      intentId: record.intentId,
      bundleId: record.bundleId,
      pagePath,
      historical,
      current,
    });
    if (captured.intentId !== deriveIntentId(captured)) {
      throw createValidationError([
        diagnostic(
          "forward_revision_intent_id_mismatch",
          "intentId",
          "Forward revision intent id does not match its canonical payload"
        ),
      ]);
    }
    return captured;
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    throw createValidationError([
      diagnostic(
        "forward_revision_intent_invalid",
        "intent",
        "Forward revision intent does not satisfy the strict protocol"
      ),
    ]);
  }
}

/**
 * Validates one unknown intent without throwing or retaining rejected values.
 *
 * @param value - Unknown candidate intent
 * @returns Closed deterministic validation result
 */
export function validateKnowledgeForwardRevisionIntent(value: unknown): KnowledgeValidationResult {
  try {
    snapshotKnowledgeForwardRevisionIntent(value);
    return { valid: true, diagnostics: [] };
  } catch (error) {
    if (isAuthenticValidationError(error)) {
      return { valid: false, diagnostics: error.diagnostics.map((item) => ({ ...item })) };
    }
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "forward_revision_intent_invalid",
          "intent",
          "Forward revision intent does not satisfy the strict protocol"
        ),
      ],
    };
  }
}

/**
 * Computes the canonical content identity of one strict forward-revision intent.
 *
 * @param value - Strict or unknown intent candidate
 * @returns Namespaced lowercase SHA-256 digest
 */
export function createKnowledgeForwardRevisionIntentDigest(value: unknown): string {
  const intent = snapshotKnowledgeForwardRevisionIntent(value);
  return sha256(
    `knowledge-forward-revision-intent-v1\n${canonicalizeJson(intent as unknown as JsonValue)}`
  );
}

Object.freeze(KnowledgeForwardRevisionIntentValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionIntentValidationError);
