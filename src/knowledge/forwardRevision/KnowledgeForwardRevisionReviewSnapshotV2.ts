import {
  createKnowledgeForwardRevisionTerminalDecisionRecordDigest,
  snapshotKnowledgeForwardRevisionTerminalDecisionRecord,
  type KnowledgeForwardRevisionAcceptedDecisionRecordV1,
  type KnowledgeForwardRevisionRejectedDecisionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { snapshotKnowledgeForwardRevisionReviewSnapshot } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshot";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of the decision-capable forward Review snapshot leaf. */
export const KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION = 2 as const;

/** Defensive bounds below the enclosing Runtime persistence limits. */
export const KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxRecords: 10_000,
  maxTotalRetainedBodyCharacters: 16_000_000,
});

/** Pending v2 entry that preserves the exact original b1 publication proof. */
export interface KnowledgeForwardRevisionPendingReviewEntryV2 {
  readonly version: 2;
  readonly kind: "forward_revision_review_entry";
  readonly state: "pending";
  readonly recordRevision: 0;
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
}

/** Accepted v2 entry retaining one exact terminal decision and both event revisions. */
export interface KnowledgeForwardRevisionAcceptedReviewEntryV2 {
  readonly version: 2;
  readonly kind: "forward_revision_review_entry";
  readonly state: "accepted";
  readonly recordRevision: 1;
  readonly decision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly decidedRuntimeRevision: number;
  readonly decisionStoreRevision: number;
}

/** Rejected v2 entry retaining one exact terminal decision and both event revisions. */
export interface KnowledgeForwardRevisionRejectedReviewEntryV2 {
  readonly version: 2;
  readonly kind: "forward_revision_review_entry";
  readonly state: "rejected";
  readonly recordRevision: 1;
  readonly decision: Readonly<KnowledgeForwardRevisionRejectedDecisionRecordV1>;
  readonly decisionDigest: string;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly decidedRuntimeRevision: number;
  readonly decisionStoreRevision: number;
}

/** One terminal accepted or rejected forward Review entry. */
export type KnowledgeForwardRevisionTerminalReviewEntryV2 =
  | KnowledgeForwardRevisionAcceptedReviewEntryV2
  | KnowledgeForwardRevisionRejectedReviewEntryV2;

/** One current pending or terminal record for a published forward proposal. */
export type KnowledgeForwardRevisionReviewEntryV2 =
  | KnowledgeForwardRevisionPendingReviewEntryV2
  | KnowledgeForwardRevisionTerminalReviewEntryV2;

/** Strict projection of the immutable b1 publication proof inside any v2 entry. */
export interface KnowledgeForwardRevisionReviewEntryProposalProjectionV2 {
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
}

/** Complete strict decision-capable forward Review state for one Bundle. */
export interface KnowledgeForwardRevisionReviewSnapshotV2 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION;
  readonly bundleId: string;
  /** Number of publication and terminal-decision events committed to this namespace. */
  readonly revision: number;
  /** Highest Runtime-allocated request revision, including rejected requests. */
  readonly lastRequestRevision: number;
  readonly records: readonly Readonly<KnowledgeForwardRevisionReviewEntryV2>[];
}

/** Runtime-only input for one pending v2 publication entry. */
export interface CreateKnowledgeForwardRevisionPendingReviewEntryV2Input {
  readonly proposal: unknown;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
}

/** Runtime-only input for one terminal v2 decision entry. */
export interface CreateKnowledgeForwardRevisionTerminalReviewEntryV2Input {
  readonly decision: unknown;
  readonly publishedRuntimeRevision: number;
  readonly proposalStoreRevision: number;
  readonly decidedRuntimeRevision: number;
  readonly decisionStoreRevision: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PENDING_ENTRY_KEYS = [
  "version",
  "kind",
  "state",
  "recordRevision",
  "proposal",
  "proposalDigest",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
] as const;
const TERMINAL_ENTRY_KEYS = [
  "version",
  "kind",
  "state",
  "recordRevision",
  "decision",
  "decisionDigest",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
  "decidedRuntimeRevision",
  "decisionStoreRevision",
] as const;
const PENDING_CREATE_KEYS = [
  "proposal",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
] as const;
const TERMINAL_CREATE_KEYS = [
  "decision",
  "publishedRuntimeRevision",
  "proposalStoreRevision",
  "decidedRuntimeRevision",
  "decisionStoreRevision",
] as const;
const SNAPSHOT_KEYS = [
  "version",
  "bundleId",
  "revision",
  "lastRequestRevision",
  "records",
] as const;

/** Fixed value-free failure for malformed v2 forward Review persistence. */
export class KnowledgeForwardRevisionReviewSnapshotV2ValidationError extends TypeError {
  /** Creates one sanitized strict-contract failure. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision Review v2 snapshot does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionReviewSnapshotV2ValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionReviewSnapshotV2ValidationError");
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionReviewSnapshotV2ValidationError>();

/** Reads an exact plain record through own enumerable data descriptors only. */
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

/** Captures one bounded dense array without invoking element accessors. */
function snapshotArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const captured: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
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

/** Reports whether text consists only of paired Unicode scalar values. */
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

/** Reports whether identifier text contains an unsupported C0 or C1 control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether one value is a bounded canonical identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Reports whether one value is a lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether one value is a non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Reports whether one value is a positive safe integer. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Throws one authentic frozen sanitized failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionReviewSnapshotV2ValidationError(VALIDATION_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught failure was minted inside this module. */
function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionReviewSnapshotV2ValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionReviewSnapshotV2ValidationError)
  );
}

/** Counts every body field physically retained by one raw entry exactly once. */
function countRetainedBodyCharacters(value: unknown): number {
  const state = readDataProperty(value, "state");
  if (state === "pending") {
    const proposal = readDataProperty(value, "proposal");
    const request = readDataProperty(proposal, "request");
    const selectedContent = readDataProperty(request, "selectedContent");
    if (typeof selectedContent !== "string") invalid();
    return selectedContent.length;
  }
  if (state === "accepted" || state === "rejected") {
    const decision = readDataProperty(value, "decision");
    const proposal = readDataProperty(decision, "proposal");
    const request = readDataProperty(proposal, "request");
    const selectedContent = readDataProperty(request, "selectedContent");
    if (typeof selectedContent !== "string") invalid();
    if (state === "rejected") return selectedContent.length;
    const afterContent = readDataProperty(decision, "afterContent");
    if (typeof afterContent !== "string") invalid();
    return selectedContent.length + afterContent.length;
  }
  invalid();
}

/** Bounds aggregate retained bodies before invoking nested strict snapshotters. */
function requireBoundedRetainedBodies(records: readonly unknown[]): void {
  let characters = 0;
  for (const record of records) {
    characters += countRetainedBodyCharacters(record);
    if (
      !Number.isSafeInteger(characters) ||
      characters >
        KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxTotalRetainedBodyCharacters
    ) {
      invalid();
    }
  }
}

/** Strictly snapshots entries while enforcing the authoritative aggregate incrementally. */
function snapshotBoundedReviewEntries(
  values: readonly unknown[]
): readonly Readonly<KnowledgeForwardRevisionReviewEntryV2>[] {
  const records: Readonly<KnowledgeForwardRevisionReviewEntryV2>[] = [];
  let characters = 0;
  for (const value of values) {
    const entry = snapshotKnowledgeForwardRevisionReviewEntryV2(value);
    characters += countRetainedBodyCharacters(entry);
    if (
      !Number.isSafeInteger(characters) ||
      characters >
        KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxTotalRetainedBodyCharacters
    ) {
      invalid();
    }
    records.push(entry);
  }
  return Object.freeze(records);
}

/** Re-proves one nested proposal and its immutable original b1 publication envelope. */
function snapshotPublicationProof(
  proposalValue: unknown,
  proposalDigestValue: unknown,
  publishedRuntimeRevisionValue: unknown,
  proposalStoreRevisionValue: unknown
) {
  if (
    !isDigest(proposalDigestValue) ||
    !isPositiveInteger(publishedRuntimeRevisionValue) ||
    !isPositiveInteger(proposalStoreRevisionValue)
  ) {
    invalid();
  }
  try {
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(proposalValue);
    if (
      proposalDigestValue !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      proposal.request.requestRevision > Number(proposalStoreRevisionValue) ||
      Number(proposalStoreRevisionValue) > Number(publishedRuntimeRevisionValue)
    ) {
      invalid();
    }
    return Object.freeze({
      proposal,
      proposalDigest: proposalDigestValue,
      publishedRuntimeRevision: Number(publishedRuntimeRevisionValue),
      proposalStoreRevision: Number(proposalStoreRevisionValue),
    });
  } catch {
    invalid();
  }
}

/** Strictly snapshots one pending v2 Review entry. */
export function snapshotKnowledgeForwardRevisionPendingReviewEntryV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionPendingReviewEntryV2> {
  try {
    const record = snapshotRecord(value, PENDING_ENTRY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION ||
      record.kind !== "forward_revision_review_entry" ||
      record.state !== "pending" ||
      record.recordRevision !== 0
    ) {
      invalid();
    }
    const publication = snapshotPublicationProof(
      record.proposal,
      record.proposalDigest,
      record.publishedRuntimeRevision,
      record.proposalStoreRevision
    );
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      kind: "forward_revision_review_entry" as const,
      state: "pending" as const,
      recordRevision: 0 as const,
      proposal: publication.proposal,
      proposalDigest: publication.proposalDigest,
      publishedRuntimeRevision: publication.publishedRuntimeRevision,
      proposalStoreRevision: publication.proposalStoreRevision,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Creates one pending v2 Review entry from Runtime-owned publication revisions. */
export function createKnowledgeForwardRevisionPendingReviewEntryV2(
  value: CreateKnowledgeForwardRevisionPendingReviewEntryV2Input
): Readonly<KnowledgeForwardRevisionPendingReviewEntryV2> {
  try {
    const record = snapshotRecord(value, PENDING_CREATE_KEYS);
    if (!record) invalid();
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    return snapshotKnowledgeForwardRevisionPendingReviewEntryV2({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      kind: "forward_revision_review_entry",
      state: "pending",
      recordRevision: 0,
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      publishedRuntimeRevision: record.publishedRuntimeRevision,
      proposalStoreRevision: record.proposalStoreRevision,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one terminal accepted or rejected v2 Review entry. */
export function snapshotKnowledgeForwardRevisionTerminalReviewEntryV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionTerminalReviewEntryV2> {
  try {
    const record = snapshotRecord(value, TERMINAL_ENTRY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION ||
      record.kind !== "forward_revision_review_entry" ||
      (record.state !== "accepted" && record.state !== "rejected") ||
      record.recordRevision !== 1 ||
      !isDigest(record.decisionDigest) ||
      !isPositiveInteger(record.decidedRuntimeRevision) ||
      !isPositiveInteger(record.decisionStoreRevision)
    ) {
      invalid();
    }
    const decision = snapshotKnowledgeForwardRevisionTerminalDecisionRecord(record.decision);
    if (
      decision.state !== record.state ||
      decision.recordRevision !== record.recordRevision ||
      record.decisionDigest !== createKnowledgeForwardRevisionTerminalDecisionRecordDigest(decision)
    ) {
      invalid();
    }
    const publication = snapshotPublicationProof(
      decision.proposal,
      decision.proposalDigest,
      record.publishedRuntimeRevision,
      record.proposalStoreRevision
    );
    if (
      Number(record.decisionStoreRevision) <= publication.proposalStoreRevision ||
      Number(record.decidedRuntimeRevision) <= publication.publishedRuntimeRevision ||
      Number(record.decisionStoreRevision) > Number(record.decidedRuntimeRevision) ||
      (decision.state === "accepted" &&
        (decision.acceptanceAuthority.runtimeRevision >= Number.MAX_SAFE_INTEGER ||
          Number(record.decidedRuntimeRevision) !==
            decision.acceptanceAuthority.runtimeRevision + 1))
    ) {
      invalid();
    }
    const common = {
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      kind: "forward_revision_review_entry" as const,
      recordRevision: 1 as const,
      decisionDigest: record.decisionDigest,
      publishedRuntimeRevision: publication.publishedRuntimeRevision,
      proposalStoreRevision: publication.proposalStoreRevision,
      decidedRuntimeRevision: Number(record.decidedRuntimeRevision),
      decisionStoreRevision: Number(record.decisionStoreRevision),
    };
    return decision.state === "accepted"
      ? Object.freeze({ ...common, state: "accepted" as const, decision })
      : Object.freeze({ ...common, state: "rejected" as const, decision });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Creates one terminal v2 Review entry from a strict decision and event revisions. */
export function createKnowledgeForwardRevisionTerminalReviewEntryV2(
  value: CreateKnowledgeForwardRevisionTerminalReviewEntryV2Input
): Readonly<KnowledgeForwardRevisionTerminalReviewEntryV2> {
  try {
    const record = snapshotRecord(value, TERMINAL_CREATE_KEYS);
    if (!record) invalid();
    const decision = snapshotKnowledgeForwardRevisionTerminalDecisionRecord(record.decision);
    return snapshotKnowledgeForwardRevisionTerminalReviewEntryV2({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      kind: "forward_revision_review_entry",
      state: decision.state,
      recordRevision: 1,
      decision,
      decisionDigest: createKnowledgeForwardRevisionTerminalDecisionRecordDigest(decision),
      publishedRuntimeRevision: record.publishedRuntimeRevision,
      proposalStoreRevision: record.proposalStoreRevision,
      decidedRuntimeRevision: record.decidedRuntimeRevision,
      decisionStoreRevision: record.decisionStoreRevision,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Strictly dispatches one pending, accepted, or rejected v2 Review entry. */
export function snapshotKnowledgeForwardRevisionReviewEntryV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewEntryV2> {
  return readDataProperty(value, "state") === "pending"
    ? snapshotKnowledgeForwardRevisionPendingReviewEntryV2(value)
    : snapshotKnowledgeForwardRevisionTerminalReviewEntryV2(value);
}

/** Returns the immutable proposal embedded in any strict v2 Review entry. */
function getEntryProposal(
  entry: Readonly<KnowledgeForwardRevisionReviewEntryV2>
): Readonly<KnowledgeForwardRevisionPendingProposalRecordV1> {
  return entry.state === "pending" ? entry.proposal : entry.decision.proposal;
}

/** Projects one strict entry back to its exact immutable b1 publication proof. */
export function projectKnowledgeForwardRevisionReviewEntryProposalV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewEntryProposalProjectionV2> {
  const entry = snapshotKnowledgeForwardRevisionReviewEntryV2(value);
  return Object.freeze({
    proposal: getEntryProposal(entry),
    proposalDigest:
      entry.state === "pending" ? entry.proposalDigest : entry.decision.proposalDigest,
    publishedRuntimeRevision: entry.publishedRuntimeRevision,
    proposalStoreRevision: entry.proposalStoreRevision,
  });
}

/** Returns the publication Store revision shared by every v2 entry state. */
function getPublicationStoreRevision(
  entry: Readonly<KnowledgeForwardRevisionReviewEntryV2>
): number {
  return entry.proposalStoreRevision;
}

/** Returns the publication Runtime revision shared by every v2 entry state. */
function getPublicationRuntimeRevision(
  entry: Readonly<KnowledgeForwardRevisionReviewEntryV2>
): number {
  return entry.publishedRuntimeRevision;
}

/** Creates an empty strict v2 forward Review snapshot without persistence. */
export function createEmptyKnowledgeForwardRevisionReviewSnapshotV2(
  bundleId: string
): Readonly<KnowledgeForwardRevisionReviewSnapshotV2> {
  return snapshotKnowledgeForwardRevisionReviewSnapshotV2({
    version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
    bundleId,
    revision: 0,
    lastRequestRevision: 0,
    records: [],
  });
}

/** Strictly snapshots and semantically validates one v2 forward Review snapshot. */
export function snapshotKnowledgeForwardRevisionReviewSnapshotV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewSnapshotV2> {
  try {
    const record = snapshotRecord(value, SNAPSHOT_KEYS);
    const rawRecords = snapshotArray(
      record?.records,
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxRecords
    );
    if (
      !record ||
      !rawRecords ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION ||
      !isIdentifier(record.bundleId) ||
      !isNonNegativeInteger(record.revision) ||
      !isNonNegativeInteger(record.lastRequestRevision) ||
      Number(record.revision) > KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxRecords * 2
    ) {
      invalid();
    }
    requireBoundedRetainedBodies(rawRecords);
    const records = snapshotBoundedReviewEntries(rawRecords);
    const expectedEventCount = records.reduce(
      (count, entry) => count + (entry.state === "pending" ? 1 : 2),
      0
    );
    if (
      Number(record.revision) !== expectedEventCount ||
      Number(record.lastRequestRevision) !== records.length
    ) {
      invalid();
    }

    const proposalIds = new Set<string>();
    const requestIds = new Set<string>();
    const intentIds = new Set<string>();
    const lastEntryByPagePathKey = new Map<
      string,
      Readonly<KnowledgeForwardRevisionReviewEntryV2>
    >();
    const events = new Map<number, number>();
    let runtimeId: string | undefined;
    let priorPublicationStoreRevision = 0;
    for (let index = 0; index < records.length; index += 1) {
      const entry = records[index];
      const proposal = getEntryProposal(entry);
      const request = proposal.request;
      if (
        request.bundleId !== record.bundleId ||
        request.requestRevision !== index + 1 ||
        (runtimeId !== undefined && request.runtimeId !== runtimeId) ||
        proposalIds.has(proposal.proposalId) ||
        requestIds.has(request.requestId) ||
        intentIds.has(request.intent.intentId) ||
        entry.proposalStoreRevision <= priorPublicationStoreRevision ||
        events.has(getPublicationStoreRevision(entry))
      ) {
        invalid();
      }
      runtimeId = request.runtimeId;
      priorPublicationStoreRevision = entry.proposalStoreRevision;
      proposalIds.add(proposal.proposalId);
      requestIds.add(request.requestId);
      intentIds.add(request.intent.intentId);
      events.set(getPublicationStoreRevision(entry), getPublicationRuntimeRevision(entry));

      const pagePathKey = toWindowsPathKey(request.pagePath);
      const previousPageEntry = lastEntryByPagePathKey.get(pagePathKey);
      if (
        previousPageEntry &&
        (previousPageEntry.state !== "rejected" ||
          previousPageEntry.decisionStoreRevision >= entry.proposalStoreRevision)
      ) {
        invalid();
      }
      lastEntryByPagePathKey.set(pagePathKey, entry);
      if (entry.state !== "pending") {
        if (events.has(entry.decisionStoreRevision)) invalid();
        events.set(entry.decisionStoreRevision, entry.decidedRuntimeRevision);
      }
    }

    let priorRuntimeRevision = 0;
    for (let storeRevision = 1; storeRevision <= Number(record.revision); storeRevision += 1) {
      const runtimeRevision = events.get(storeRevision);
      if (runtimeRevision === undefined || runtimeRevision <= priorRuntimeRevision) invalid();
      priorRuntimeRevision = runtimeRevision;
    }
    if (events.size !== Number(record.revision)) invalid();

    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      bundleId: record.bundleId,
      revision: Number(record.revision),
      lastRequestRevision: Number(record.lastRequestRevision),
      records,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Migrates one strict b1 v1 snapshot into exact pending-only v2 semantics. */
export function migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewSnapshotV2> {
  try {
    const legacy = snapshotKnowledgeForwardRevisionReviewSnapshot(value);
    return snapshotKnowledgeForwardRevisionReviewSnapshotV2({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
      bundleId: legacy.bundleId,
      revision: legacy.revision,
      lastRequestRevision: legacy.lastRequestRevision,
      records: legacy.records.map((published) => ({
        version: KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_VERSION,
        kind: "forward_revision_review_entry",
        state: "pending",
        recordRevision: 0,
        proposal: published.proposal,
        proposalDigest: published.proposalDigest,
        publishedRuntimeRevision: published.publishedRuntimeRevision,
        proposalStoreRevision: published.proposalStoreRevision,
      })),
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

/** Parses one unknown v2 snapshot into a detached value or one safe diagnostic. */
export function parseKnowledgeForwardRevisionReviewSnapshotV2(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionReviewSnapshotV2>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionReviewSnapshotV2(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_review_snapshot_v2_invalid",
          severity: "error",
          field: "forwardRevisionReview",
          message: "Forward revision Review v2 state does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one unknown v2 snapshot without retaining rejected data. */
export function validateKnowledgeForwardRevisionReviewSnapshotV2(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionReviewSnapshotV2(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Computes the canonical namespaced digest of one strict v2 snapshot. */
export function createKnowledgeForwardRevisionReviewSnapshotV2Digest(value: unknown): string {
  const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshotV2(value);
  return sha256(
    `knowledge-forward-revision-review-snapshot-v2\n${canonicalizeJson(
      snapshot as unknown as JsonValue
    )}`
  );
}

/** Detaches one fixed diagnostic returned by the v2 parser. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionReviewSnapshotV2ValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);
