import type { KnowledgeForwardRevisionPendingProposalRecordV1 } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_FORWARD_REVISION_ACCEPTANCE_AUTHORITY_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
});

export type KnowledgeForwardRevisionNoChangesReason =
  | "analysis_no_targets"
  | "resolved_no_targets"
  | "all_targets_unchanged";

export interface KnowledgeForwardRevisionSourceFreshnessBase {
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
  readonly committedManifestRevision: number;
  readonly completedAt: number;
}

export interface KnowledgeForwardRevisionAppliedFreshness extends KnowledgeForwardRevisionSourceFreshnessBase {
  readonly kind: "applied";
  readonly transactionId: string;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly manifestIntentDigest: string;
  readonly committedManifestDigest: string;
}

export interface KnowledgeForwardRevisionNoChangesFreshness extends KnowledgeForwardRevisionSourceFreshnessBase {
  readonly kind: "no_changes";
  readonly noChangesId: string;
  readonly reason: KnowledgeForwardRevisionNoChangesReason;
  readonly planDigest: string;
  readonly jobId: string;
  readonly attempt: number;
}

export type KnowledgeForwardRevisionSourceFreshness =
  | KnowledgeForwardRevisionAppliedFreshness
  | KnowledgeForwardRevisionNoChangesFreshness;

export interface KnowledgeForwardRevisionAcceptanceAuthority {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly manifestBaseHash: string;
  readonly vaultObservedBeforeHash: string;
  readonly currentSourceFreshness: Readonly<KnowledgeForwardRevisionSourceFreshness>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NO_CHANGES_ID_PATTERN = /^knowledge-no-changes-[a-f0-9]{64}$/;
const AUTHORITY_KEYS = [
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "manifestRevision",
  "manifestDigest",
  "manifestBaseHash",
  "vaultObservedBeforeHash",
  "currentSourceFreshness",
] as const;
const FRESHNESS_COMMON_KEYS = [
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
  "committedManifestRevision",
  "completedAt",
] as const;
const APPLIED_FRESHNESS_KEYS = [
  ...FRESHNESS_COMMON_KEYS,
  "transactionId",
  "changeSetId",
  "changeSetDigest",
  "manifestIntentDigest",
  "committedManifestDigest",
] as const;
const NO_CHANGES_FRESHNESS_KEYS = [
  ...FRESHNESS_COMMON_KEYS,
  "noChangesId",
  "reason",
  "planDigest",
  "jobId",
  "attempt",
] as const;
const NO_CHANGES_REASONS: readonly KnowledgeForwardRevisionNoChangesReason[] = Object.freeze([
  "analysis_no_targets",
  "resolved_no_targets",
  "all_targets_unchanged",
]);

export class KnowledgeForwardRevisionAcceptanceAuthorityValidationError extends TypeError {
  constructor(authenticityToken?: symbol) {
    super("Forward revision acceptance authority does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionAcceptanceAuthorityValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionAcceptanceAuthorityValidationError");
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionAcceptanceAuthorityValidationError>();

function snapshotRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(captured, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <=
      KNOWLEDGE_FORWARD_REVISION_ACCEPTANCE_AUTHORITY_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function readDataDiscriminant(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function invalid(): never {
  const error = new KnowledgeForwardRevisionAcceptanceAuthorityValidationError(
    VALIDATION_ERROR_TOKEN
  );
  Object.freeze(error);
  throw error;
}

function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionAcceptanceAuthorityValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(
      value as KnowledgeForwardRevisionAcceptanceAuthorityValidationError
    )
  );
}

export function snapshotKnowledgeForwardRevisionSourceFreshness(
  value: unknown
): Readonly<KnowledgeForwardRevisionSourceFreshness> {
  const kind = readDataDiscriminant(value, "kind");
  const expectedKeys =
    kind === "applied"
      ? APPLIED_FRESHNESS_KEYS
      : kind === "no_changes"
        ? NO_CHANGES_FRESHNESS_KEYS
        : undefined;
  const record = expectedKeys ? snapshotRecord(value, expectedKeys) : undefined;
  if (
    !record ||
    !isIdentifier(record.runtimeId) ||
    !isPositiveInteger(record.runtimeRevision) ||
    !isDigest(record.runtimeDigest) ||
    !isIdentifier(record.bundleId) ||
    !isIdentifier(record.sourceId) ||
    !isDigest(record.sourceContentHash) ||
    !isDigest(record.pipelineFingerprint) ||
    !isPositiveInteger(record.inputRevision) ||
    !isNonNegativeInteger(record.manifestRevision) ||
    !isDigest(record.manifestDigest) ||
    !isNonNegativeInteger(record.committedManifestRevision) ||
    Number(record.committedManifestRevision) > Number(record.manifestRevision) ||
    !isNonNegativeInteger(record.completedAt)
  ) {
    invalid();
  }
  const common = Object.freeze({
    runtimeId: record.runtimeId,
    runtimeRevision: Number(record.runtimeRevision),
    runtimeDigest: record.runtimeDigest,
    bundleId: record.bundleId,
    sourceId: record.sourceId,
    sourceContentHash: record.sourceContentHash,
    pipelineFingerprint: record.pipelineFingerprint,
    inputRevision: Number(record.inputRevision),
    manifestRevision: Number(record.manifestRevision),
    manifestDigest: record.manifestDigest,
    committedManifestRevision: Number(record.committedManifestRevision),
    completedAt: Number(record.completedAt),
  });
  if (kind === "applied") {
    if (
      !isIdentifier(record.transactionId) ||
      !isIdentifier(record.changeSetId) ||
      !isDigest(record.changeSetDigest) ||
      !isDigest(record.manifestIntentDigest) ||
      !isDigest(record.committedManifestDigest)
    ) {
      invalid();
    }
    return Object.freeze({
      ...common,
      kind: "applied" as const,
      transactionId: record.transactionId,
      changeSetId: record.changeSetId,
      changeSetDigest: record.changeSetDigest,
      manifestIntentDigest: record.manifestIntentDigest,
      committedManifestDigest: record.committedManifestDigest,
    });
  }
  if (
    !isIdentifier(record.noChangesId) ||
    !NO_CHANGES_ID_PATTERN.test(record.noChangesId) ||
    !NO_CHANGES_REASONS.includes(record.reason as KnowledgeForwardRevisionNoChangesReason) ||
    !isDigest(record.planDigest) ||
    !isIdentifier(record.jobId) ||
    !isPositiveInteger(record.attempt)
  ) {
    invalid();
  }
  return Object.freeze({
    ...common,
    kind: "no_changes" as const,
    noChangesId: record.noChangesId,
    reason: record.reason as KnowledgeForwardRevisionNoChangesReason,
    planDigest: record.planDigest,
    jobId: record.jobId,
    attempt: Number(record.attempt),
  });
}

export function snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(
  value: unknown
): Readonly<KnowledgeForwardRevisionAcceptanceAuthority> {
  try {
    const record = snapshotRecord(value, AUTHORITY_KEYS);
    if (
      !record ||
      !isIdentifier(record.runtimeId) ||
      !isPositiveInteger(record.runtimeRevision) ||
      !isDigest(record.runtimeDigest) ||
      !isNonNegativeInteger(record.manifestRevision) ||
      !isDigest(record.manifestDigest) ||
      !isDigest(record.manifestBaseHash) ||
      !isDigest(record.vaultObservedBeforeHash)
    ) {
      invalid();
    }
    const freshness = snapshotKnowledgeForwardRevisionSourceFreshness(
      record.currentSourceFreshness
    );
    if (
      Number(record.runtimeRevision) !== freshness.runtimeRevision ||
      record.runtimeDigest !== freshness.runtimeDigest ||
      Number(record.manifestRevision) !== freshness.manifestRevision ||
      record.manifestDigest !== freshness.manifestDigest ||
      record.runtimeId !== freshness.runtimeId
    ) {
      invalid();
    }
    return Object.freeze({
      runtimeId: record.runtimeId,
      runtimeRevision: Number(record.runtimeRevision),
      runtimeDigest: record.runtimeDigest,
      manifestRevision: Number(record.manifestRevision),
      manifestDigest: record.manifestDigest,
      manifestBaseHash: record.manifestBaseHash,
      vaultObservedBeforeHash: record.vaultObservedBeforeHash,
      currentSourceFreshness: freshness,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function snapshotKnowledgeForwardRevisionAcceptanceAuthority(
  value: unknown,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>
): Readonly<KnowledgeForwardRevisionAcceptanceAuthority> {
  try {
    const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(value);
    const request = proposal.request;
    const current = request.intent.current;
    const freshness = authority.currentSourceFreshness;
    if (
      authority.runtimeId !== request.runtimeId ||
      authority.manifestBaseHash !== current.manifestBaseHash ||
      authority.vaultObservedBeforeHash !== current.vaultObservedBeforeHash ||
      authority.manifestRevision !== current.manifestRevision ||
      authority.manifestDigest !== current.manifestDigest ||
      freshness.runtimeId !== request.runtimeId ||
      freshness.bundleId !== request.bundleId ||
      freshness.sourceId !== current.primarySourceId ||
      freshness.sourceContentHash !== current.sourceContentHash ||
      freshness.pipelineFingerprint !== current.pipelineFingerprint ||
      freshness.inputRevision !== current.inputRevision
    ) {
      invalid();
    }
    return authority;
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function createKnowledgeForwardRevisionAcceptanceAuthorityDigest(value: unknown): string {
  const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(value);
  return sha256(
    `knowledge-forward-revision-acceptance-authority-v1\n${canonicalizeJson(authority)}`
  );
}

Object.freeze(KnowledgeForwardRevisionAcceptanceAuthorityValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionAcceptanceAuthorityValidationError);
