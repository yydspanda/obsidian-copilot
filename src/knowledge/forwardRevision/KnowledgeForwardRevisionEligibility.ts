import {
  createKnowledgeForwardRevisionIntentDigest,
  snapshotKnowledgeForwardRevisionIntent,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";

export type KnowledgeForwardRevisionCurrentState = "applied" | "drifted" | "missing";

export type KnowledgeForwardRevisionHistoricalDetailState =
  | "available"
  | "too_large"
  | "stale"
  | "unavailable";

export type KnowledgeForwardRevisionBlocker =
  | "none"
  | "source_busy"
  | "transaction_busy"
  | "recovery_required";

export type KnowledgeForwardRevisionValidationState = "valid" | "invalid" | "unavailable";

export type KnowledgeForwardRevisionPendingProposalState = "none" | "exact" | "conflict";

interface KnowledgeForwardRevisionProtocolAdmissionCommonInput {
  readonly intent: unknown;
  readonly historicalDetail: KnowledgeForwardRevisionHistoricalDetailState;
  readonly selectedContentHash: string;
  readonly manifestBaseHash: string;
  readonly ownership: "generated" | "shared" | "user";
  readonly sourceIds: readonly string[];
  readonly primarySourceId: string;
  readonly historicalSourceId: string;
  readonly historicalSourceContentHash: string;
  readonly currentSourceContentHash: string;
  readonly historicalPipelineFingerprint: string;
  readonly currentPipelineFingerprint: string;
  readonly historicalInputRevision: number;
  readonly currentInputRevision: number;
  readonly sourceOrigin: "ingest" | "query_writeback";
  readonly sourceRetired: boolean;
  readonly validation: KnowledgeForwardRevisionValidationState;
  readonly pendingProposal: KnowledgeForwardRevisionPendingProposalState;
  readonly blocker: KnowledgeForwardRevisionBlocker;
}

interface KnowledgeForwardRevisionAppliedObservation {
  readonly currentState: "applied";
  readonly currentContentHash: string;
  readonly vaultObservedBeforeHash: string;
}

interface KnowledgeForwardRevisionDriftedObservation {
  readonly currentState: "drifted";
  readonly currentContentHash: string;
  readonly vaultObservedBeforeHash: string;
}

interface KnowledgeForwardRevisionMissingObservation {
  readonly currentState: "missing";
  readonly currentContentHash: null;
  readonly vaultObservedBeforeHash: null;
}

export type KnowledgeForwardRevisionProtocolAdmissionInput =
  KnowledgeForwardRevisionProtocolAdmissionCommonInput &
    (
      | KnowledgeForwardRevisionAppliedObservation
      | KnowledgeForwardRevisionDriftedObservation
      | KnowledgeForwardRevisionMissingObservation
    );

export type KnowledgeForwardRevisionProtocolIneligibilityReason =
  | "current_drifted"
  | "current_missing"
  | "historical_too_large"
  | "historical_stale"
  | "historical_unavailable"
  | "current_hash_unverified"
  | "selected_is_current"
  | "ownership_shared"
  | "ownership_user"
  | "source_ownership_unsupported"
  | "historical_source_mismatch"
  | "source_content_mismatch"
  | "pipeline_mismatch"
  | "source_revision_not_newer"
  | "source_origin_unsupported"
  | "source_retired"
  | "validation_failed"
  | "validation_unavailable"
  | "proposal_already_pending"
  | "proposal_conflict"
  | "source_busy"
  | "transaction_busy"
  | "recovery_required"
  | "intent_mismatch"
  | "input_invalid";

export type KnowledgeForwardRevisionProtocolAdmission =
  | Readonly<{ eligible: true; intentId: string; intentDigest: string }>
  | Readonly<{ eligible: false; reason: KnowledgeForwardRevisionProtocolIneligibilityReason }>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_SOURCE_IDS = 8;
const INPUT_KEYS = [
  "intent",
  "currentState",
  "historicalDetail",
  "selectedContentHash",
  "currentContentHash",
  "manifestBaseHash",
  "vaultObservedBeforeHash",
  "ownership",
  "sourceIds",
  "primarySourceId",
  "historicalSourceId",
  "historicalSourceContentHash",
  "currentSourceContentHash",
  "historicalPipelineFingerprint",
  "currentPipelineFingerprint",
  "historicalInputRevision",
  "currentInputRevision",
  "sourceOrigin",
  "sourceRetired",
  "validation",
  "pendingProposal",
  "blocker",
] as const;

const results = new Map<
  KnowledgeForwardRevisionProtocolIneligibilityReason,
  Readonly<{ eligible: false; reason: KnowledgeForwardRevisionProtocolIneligibilityReason }>
>();

function ineligible(
  reason: KnowledgeForwardRevisionProtocolIneligibilityReason
): Readonly<{ eligible: false; reason: KnowledgeForwardRevisionProtocolIneligibilityReason }> {
  const existing = results.get(reason);
  if (existing) return existing;
  const created = Object.freeze({ eligible: false as const, reason });
  results.set(reason, created);
  return created;
}

function snapshotRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== INPUT_KEYS.length ||
      keys.some((key) => typeof key !== "string") ||
      INPUT_KEYS.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
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

function snapshotSourceIds(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > MAX_SOURCE_IDS ||
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

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_CHARACTERS &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
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

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function classifyKnowledgeForwardRevisionProtocolAdmission(
  value: unknown
): KnowledgeForwardRevisionProtocolAdmission {
  const input = snapshotRecord(value);
  const sourceIds = snapshotSourceIds(input?.sourceIds);
  if (
    !input ||
    !sourceIds ||
    (input.currentState !== "applied" &&
      input.currentState !== "drifted" &&
      input.currentState !== "missing") ||
    (input.historicalDetail !== "available" &&
      input.historicalDetail !== "too_large" &&
      input.historicalDetail !== "stale" &&
      input.historicalDetail !== "unavailable") ||
    !isDigest(input.selectedContentHash) ||
    !isDigest(input.manifestBaseHash) ||
    (input.currentState === "missing" &&
      (input.currentContentHash !== null || input.vaultObservedBeforeHash !== null)) ||
    (input.currentState !== "missing" &&
      (!isDigest(input.currentContentHash) || !isDigest(input.vaultObservedBeforeHash))) ||
    (input.currentState === "drifted" &&
      input.currentContentHash !== input.vaultObservedBeforeHash) ||
    (input.ownership !== "generated" &&
      input.ownership !== "shared" &&
      input.ownership !== "user") ||
    sourceIds.some((sourceId) => !isIdentifier(sourceId)) ||
    new Set(sourceIds).size !== sourceIds.length ||
    !isIdentifier(input.primarySourceId) ||
    !isIdentifier(input.historicalSourceId) ||
    !isDigest(input.historicalSourceContentHash) ||
    !isDigest(input.currentSourceContentHash) ||
    !isDigest(input.historicalPipelineFingerprint) ||
    !isDigest(input.currentPipelineFingerprint) ||
    !Number.isSafeInteger(input.historicalInputRevision) ||
    Number(input.historicalInputRevision) < 0 ||
    !Number.isSafeInteger(input.currentInputRevision) ||
    Number(input.currentInputRevision) < 0 ||
    (input.sourceOrigin !== "ingest" && input.sourceOrigin !== "query_writeback") ||
    typeof input.sourceRetired !== "boolean" ||
    (input.validation !== "valid" &&
      input.validation !== "invalid" &&
      input.validation !== "unavailable") ||
    (input.pendingProposal !== "none" &&
      input.pendingProposal !== "exact" &&
      input.pendingProposal !== "conflict") ||
    (input.blocker !== "none" &&
      input.blocker !== "source_busy" &&
      input.blocker !== "transaction_busy" &&
      input.blocker !== "recovery_required")
  ) {
    return ineligible("input_invalid");
  }
  let intent: ReturnType<typeof snapshotKnowledgeForwardRevisionIntent>;
  try {
    intent = snapshotKnowledgeForwardRevisionIntent(input.intent);
  } catch {
    return ineligible("intent_mismatch");
  }
  if (input.currentState === "drifted") return ineligible("current_drifted");
  if (input.currentState === "missing") return ineligible("current_missing");
  if (input.historicalDetail === "too_large") return ineligible("historical_too_large");
  if (input.historicalDetail === "stale") return ineligible("historical_stale");
  if (input.historicalDetail === "unavailable") return ineligible("historical_unavailable");
  if (
    input.currentContentHash === null ||
    input.vaultObservedBeforeHash === null ||
    input.currentContentHash !== input.vaultObservedBeforeHash
  ) {
    return ineligible("current_hash_unverified");
  }
  if (input.selectedContentHash === input.currentContentHash) {
    return ineligible("selected_is_current");
  }
  if (input.ownership === "shared") return ineligible("ownership_shared");
  if (input.ownership === "user") return ineligible("ownership_user");
  if (sourceIds.length !== 1 || sourceIds[0] !== input.primarySourceId) {
    return ineligible("source_ownership_unsupported");
  }
  if (input.historicalSourceId !== input.primarySourceId) {
    return ineligible("historical_source_mismatch");
  }
  if (input.historicalSourceContentHash !== input.currentSourceContentHash) {
    return ineligible("source_content_mismatch");
  }
  if (input.historicalPipelineFingerprint !== input.currentPipelineFingerprint) {
    return ineligible("pipeline_mismatch");
  }
  if (Number(input.historicalInputRevision) >= Number(input.currentInputRevision)) {
    return ineligible("source_revision_not_newer");
  }
  if (input.sourceOrigin !== "ingest") return ineligible("source_origin_unsupported");
  if (input.sourceRetired) return ineligible("source_retired");
  if (input.validation === "invalid") return ineligible("validation_failed");
  if (input.validation === "unavailable") return ineligible("validation_unavailable");
  if (input.pendingProposal === "exact") return ineligible("proposal_already_pending");
  if (input.pendingProposal === "conflict") return ineligible("proposal_conflict");
  if (input.blocker === "source_busy") return ineligible("source_busy");
  if (input.blocker === "transaction_busy") return ineligible("transaction_busy");
  if (input.blocker === "recovery_required") return ineligible("recovery_required");
  if (
    intent.historical.selectedContentHash !== input.selectedContentHash ||
    intent.current.manifestBaseHash !== input.manifestBaseHash ||
    intent.current.ownership !== input.ownership ||
    intent.current.primarySourceId !== input.primarySourceId ||
    intent.current.sourceIds.length !== sourceIds.length ||
    intent.current.sourceIds.some((sourceId, index) => sourceId !== sourceIds[index]) ||
    intent.historical.sourceId !== input.historicalSourceId ||
    intent.historical.sourceContentHash !== input.historicalSourceContentHash ||
    intent.current.sourceContentHash !== input.currentSourceContentHash ||
    intent.historical.pipelineFingerprint !== input.historicalPipelineFingerprint ||
    intent.current.pipelineFingerprint !== input.currentPipelineFingerprint ||
    intent.historical.inputRevision !== input.historicalInputRevision ||
    intent.current.inputRevision !== input.currentInputRevision ||
    intent.current.sourceOrigin !== input.sourceOrigin ||
    intent.current.sourceRetired !== input.sourceRetired ||
    intent.current.vaultObservedBeforeHash !== input.vaultObservedBeforeHash
  ) {
    return ineligible("intent_mismatch");
  }
  return Object.freeze({
    eligible: true as const,
    intentId: intent.intentId,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
  });
}
