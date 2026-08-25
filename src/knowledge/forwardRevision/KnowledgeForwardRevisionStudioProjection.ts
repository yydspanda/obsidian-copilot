import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionApplyJournalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  createKnowledgeForwardRevisionApplyRecoveryExpectation,
  snapshotKnowledgeForwardRevisionApplyRecoveryExpectation,
  type KnowledgeForwardRevisionApplyRecoveryExpectationV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRecoveryExpectation";
import {
  snapshotKnowledgeForwardRevisionApplyLedgerRecord,
  type KnowledgeForwardRevisionApplyLedgerRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  createKnowledgeForwardRevisionTerminalDecisionRecordDigest,
  snapshotKnowledgeForwardRevisionAcceptedDecisionRecord,
  type KnowledgeForwardRevisionAcceptedDecisionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionAcceptedClaimIdentity,
  createKnowledgeForwardRevisionLifecycleResourceIdentity,
  snapshotKnowledgeForwardRevisionAbandonmentRecord,
  snapshotKnowledgeForwardRevisionRecoveryTerminalRecord,
  type KnowledgeForwardRevisionAbandonmentRecordV1,
  type KnowledgeForwardRevisionAcceptedClaimIdentityV1,
  type KnowledgeForwardRevisionRecoveryTerminalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";
import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createEmptyKnowledgeForwardRevisionReviewSnapshotV2,
  snapshotKnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionTerminalReviewEntryV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current internal Studio projection version for dedicated forward Review work. */
export const KNOWLEDGE_FORWARD_REVISION_STUDIO_SNAPSHOT_VERSION = 1 as const;

/** Fixed product-read limits below the enclosing durable protocol bounds. */
export const KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS = Object.freeze({
  maxActiveRecords: 256,
  maxCommittedRecords: 10_000,
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxTotalContentCharacters: 16_000_000,
});

/** One pending proposal retained intact for a later command-time exact rejoin. */
export interface KnowledgeForwardRevisionStudioPendingRecord {
  readonly state: "pending";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly requestedAt: number;
  readonly selectedAppliedAt: number;
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
}

/** One accepted decision that remains visible until an Apply journal is begun. */
export interface KnowledgeForwardRevisionStudioAcceptedReadyRecord {
  readonly state: "accepted_ready";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
}

/** One accepted decision durably terminalized before any Apply journal or Wiki mutation. */
export interface KnowledgeForwardRevisionStudioAbandonedRecord {
  readonly state: "abandoned";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly abandonedAt: number;
  readonly manualOverride: boolean;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
  readonly abandonment: Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>;
  readonly abandonmentDigest: string;
}

/** One sticky recovery durably ended while retaining the freshly observed external Wiki value. */
export interface KnowledgeForwardRevisionStudioKeptCurrentRecord {
  readonly state: "kept_current";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly terminalizedAt: number;
  readonly manualOverride: boolean;
  readonly outcome: KnowledgeForwardRevisionRecoveryTerminalRecordV1["outcome"];
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
}

/** One accepted decision currently owned by a durable non-conflict Apply journal. */
export interface KnowledgeForwardRevisionStudioApplyingRecord {
  readonly state: "applying";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
  readonly applyPhase: "prepared" | "applying" | "committed";
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
}

/** One accepted decision retained behind a sticky durable Apply conflict. */
export interface KnowledgeForwardRevisionStudioRecoveryRequiredRecord {
  readonly state: "recovery_required";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
  readonly conflictCode: "file_state_conflict" | "post_write_verification_failed";
  readonly actualKind: "missing" | "directory" | "file" | "oversized_file";
  readonly detectedAt: number;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly decisionDigest: string;
  readonly recoveryExpectation: Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1>;
}

/** Visible forward work retained behind an internal production coordinator boundary. */
export type KnowledgeForwardRevisionStudioActiveRecord =
  | KnowledgeForwardRevisionStudioPendingRecord
  | KnowledgeForwardRevisionStudioAcceptedReadyRecord
  | KnowledgeForwardRevisionStudioAbandonedRecord
  | KnowledgeForwardRevisionStudioKeptCurrentRecord
  | KnowledgeForwardRevisionStudioApplyingRecord
  | KnowledgeForwardRevisionStudioRecoveryRequiredRecord;

/** Detached product read assembled from exactly one Runtime envelope. */
export interface KnowledgeForwardRevisionStudioSnapshot {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_SNAPSHOT_VERSION;
  readonly kind: "forward_revision_studio_snapshot";
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly reviewRevision: number;
  readonly revisionToken: string;
  readonly activeRecords: readonly Readonly<KnowledgeForwardRevisionStudioActiveRecord>[];
  readonly committedReviewRefs: readonly string[];
  readonly committedCount: number;
}

/** Strict inputs already selected from one validated Runtime envelope. */
export interface KnowledgeForwardRevisionStudioProjectionInput {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly bundleId: string;
  readonly review?: unknown;
  readonly activeApply: unknown;
  readonly applyCommits: readonly unknown[];
  readonly abandonments: readonly unknown[];
  readonly recoveryTerminals: readonly unknown[];
}

/** Stable bounded resource exhausted by a product projection. */
export type KnowledgeForwardRevisionStudioProjectionLimit =
  | "active_records"
  | "committed_records"
  | "content_characters";

const PROJECTION_LIMIT_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionStudioProjectionLimitError");
const authenticProjectionLimitErrors =
  new WeakSet<KnowledgeForwardRevisionStudioProjectionLimitError>();

/** Reports a valid durable graph that exceeds the bounded product contract. */
export class KnowledgeForwardRevisionStudioProjectionLimitError extends Error {
  /** Creates one value-free resource failure. */
  constructor(
    public readonly limit: KnowledgeForwardRevisionStudioProjectionLimit,
    authenticityToken?: symbol
  ) {
    super("Forward revision Studio work exceeds the bounded product read contract");
    this.name = "KnowledgeForwardRevisionStudioProjectionLimitError";
    if (authenticityToken === PROJECTION_LIMIT_ERROR_TOKEN) {
      authenticProjectionLimitErrors.add(this);
    }
  }
}

/** Reports malformed or ambiguously joined projection material without retaining it. */
export class KnowledgeForwardRevisionStudioProjectionError extends Error {
  /** Creates one fixed sanitized projection failure. */
  constructor() {
    super("Forward revision Studio work does not satisfy the product read contract");
    this.name = "KnowledgeForwardRevisionStudioProjectionError";
  }
}

type AcceptedEntry = Extract<KnowledgeForwardRevisionTerminalReviewEntryV2, { state: "accepted" }>;

interface AcceptedProjection {
  readonly entry: Readonly<AcceptedEntry>;
  readonly decision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly identityKey: string;
  readonly reviewRef: string;
  readonly acceptedIdentity: Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1>;
}

interface CapturedProjectionInput {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly bundleId: string;
  readonly review: Readonly<KnowledgeForwardRevisionReviewSnapshotV2>;
  readonly activeApply: Readonly<KnowledgeForwardRevisionApplyJournalV1> | null;
  readonly applyCommits: readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[];
  readonly abandonments: readonly Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>[];
  readonly recoveryTerminals: readonly Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>[];
}

const INPUT_REQUIRED_KEYS = [
  "runtimeId",
  "runtimeRevision",
  "bundleId",
  "activeApply",
  "applyCommits",
  "abandonments",
  "recoveryTerminals",
] as const;
const INPUT_OPTIONAL_KEYS = ["review"] as const;
const SNAPSHOT_KEYS = [
  "version",
  "kind",
  "bundleId",
  "runtimeRevision",
  "reviewRevision",
  "revisionToken",
  "activeRecords",
  "committedReviewRefs",
  "committedCount",
] as const;
const PENDING_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "requestedAt",
  "selectedAppliedAt",
  "proposal",
  "proposalDigest",
] as const;
const ACCEPTED_READY_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "acceptedAt",
  "manualOverride",
  "acceptedDecision",
  "decisionDigest",
] as const;
const ABANDONED_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "acceptedAt",
  "abandonedAt",
  "manualOverride",
  "acceptedDecision",
  "decisionDigest",
  "abandonment",
  "abandonmentDigest",
] as const;
const KEPT_CURRENT_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "acceptedAt",
  "terminalizedAt",
  "manualOverride",
  "outcome",
  "acceptedDecision",
  "decisionDigest",
] as const;
const APPLYING_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "acceptedAt",
  "manualOverride",
  "applyPhase",
  "acceptedDecision",
  "decisionDigest",
] as const;
const RECOVERY_KEYS = [
  "state",
  "reviewRef",
  "snapshotRef",
  "pagePath",
  "updatedAt",
  "acceptedAt",
  "manualOverride",
  "conflictCode",
  "actualKind",
  "detectedAt",
  "acceptedDecision",
  "decisionDigest",
  "recoveryExpectation",
] as const;
const REVIEW_REF_PATTERN = /^forward-studio-review-[a-f0-9]{64}$/;
const SNAPSHOT_REF_PATTERN = /^forward-studio-snapshot-[a-f0-9]{64}$/;
const REVISION_TOKEN_PATTERN = /^forward-studio-revision-[a-f0-9]{64}$/;

/** Throws one sanitized malformed-input failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionStudioProjectionError();
  Object.freeze(error);
  throw error;
}

/** Throws one authentic frozen bounded-resource failure. */
function resourceLimit(limit: KnowledgeForwardRevisionStudioProjectionLimit): never {
  const error = new KnowledgeForwardRevisionStudioProjectionLimitError(
    limit,
    PROJECTION_LIMIT_ERROR_TOKEN
  );
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local resource failure. */
function isAuthenticProjectionLimitError(
  value: unknown
): value is KnowledgeForwardRevisionStudioProjectionLimitError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticProjectionLimitErrors.has(value as KnowledgeForwardRevisionStudioProjectionLimitError)
  );
}

/** Reads an exact plain record through own enumerable data descriptors only. */
function snapshotRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      requiredKeys.some((key) => !keys.includes(key)) ||
      keys.length < requiredKeys.length ||
      keys.length > requiredKeys.length + optionalKeys.length
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

/** Captures one bounded dense array without invoking indexed accessors. */
function snapshotArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
    if (
      !Number.isSafeInteger(length) ||
      Number(length) < 0 ||
      Number(length) > maxLength ||
      Reflect.ownKeys(value).length !== Number(length) + 1
    ) {
      return undefined;
    }
    const captured: unknown[] = [];
    for (let index = 0; index < Number(length); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

/** Reports whether a scalar is a bounded canonical identifier. */
function isIdentifier(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxIdentifierCharacters ||
    value.trim() !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
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

/** Reports whether a scalar is a non-negative safe integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Captures one exact canonical Vault path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxPagePathCharacters
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

/** Compares detached JSON values without retaining either candidate. */
function exactJsonValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
  } catch {
    return false;
  }
}

/** Produces one namespaced opaque reference from strict detached identity data. */
function createOpaqueRef(prefix: string, namespace: string, value: JsonValue): string {
  return `${prefix}-${sha256(`${namespace}\n${canonicalizeJson(value)}`)}`;
}

/** Builds the private exact accepted-decision join key used for journal and ledger matching. */
function createAcceptedIdentityKey(
  runtimeId: string,
  bundleId: string,
  pagePath: string,
  proposalId: string,
  proposalDigest: string,
  acceptedDecisionDigest: string,
  applyClaimId: string,
  applyClaimDigest: string
): string {
  return canonicalizeJson([
    runtimeId,
    bundleId,
    pagePath,
    toWindowsPathKey(pagePath),
    proposalId,
    proposalDigest,
    acceptedDecisionDigest,
    applyClaimId,
    applyClaimDigest,
  ]);
}

/** Creates the stable opaque product reference for one exact durable proposal identity. */
export function createKnowledgeForwardRevisionStudioReviewRef(
  runtimeId: string,
  bundleId: string,
  proposalId: string,
  proposalDigest: string
): string {
  if (
    [runtimeId, bundleId, proposalId].some((value) => !isIdentifier(value)) ||
    !/^[a-f0-9]{64}$/.test(proposalDigest)
  ) {
    invalid();
  }
  return createOpaqueRef("forward-studio-review", "knowledge-forward-revision-studio-review-v1", {
    runtimeId,
    bundleId,
    proposalId,
    proposalDigest,
  });
}

/** Creates a Runtime-revision-bound opaque record token without disclosing command authority. */
function createSnapshotRef(
  input: Readonly<CapturedProjectionInput>,
  reviewRef: string,
  state: KnowledgeForwardRevisionStudioActiveRecord["state"],
  durableIdentity: JsonValue
): string {
  return createOpaqueRef("forward-studio-snapshot", "knowledge-forward-revision-studio-record-v1", {
    runtimeId: input.runtimeId,
    runtimeRevision: input.runtimeRevision,
    bundleId: input.bundleId,
    reviewRevision: input.review.revision,
    reviewRef,
    state,
    durableIdentity,
  });
}

/** Captures and validates every projection input before classification. */
function captureProjectionInput(value: unknown): Readonly<CapturedProjectionInput> {
  const record = snapshotRecord(value, INPUT_REQUIRED_KEYS, INPUT_OPTIONAL_KEYS);
  if (
    !record ||
    !isIdentifier(record.runtimeId) ||
    !isNonNegativeInteger(record.runtimeRevision) ||
    !isIdentifier(record.bundleId)
  ) {
    invalid();
  }
  const runtimeId = record.runtimeId;
  const runtimeRevision = record.runtimeRevision;
  const bundleId = record.bundleId;
  let review: Readonly<KnowledgeForwardRevisionReviewSnapshotV2>;
  let activeApply: Readonly<KnowledgeForwardRevisionApplyJournalV1> | null;
  let applyCommits: readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[];
  let abandonments: readonly Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>[];
  let recoveryTerminals: readonly Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>[];
  try {
    review =
      record.review === undefined
        ? createEmptyKnowledgeForwardRevisionReviewSnapshotV2(bundleId)
        : snapshotKnowledgeForwardRevisionReviewSnapshotV2(record.review);
    activeApply =
      record.activeApply === null
        ? null
        : snapshotKnowledgeForwardRevisionApplyJournal(record.activeApply);
    const rawCommits = snapshotArray(
      record.applyCommits,
      KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxCommittedRecords
    );
    if (!rawCommits) invalid();
    applyCommits = Object.freeze(
      rawCommits.map((commit) => snapshotKnowledgeForwardRevisionApplyLedgerRecord(commit))
    );
    const rawAbandonments = snapshotArray(
      record.abandonments,
      KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxCommittedRecords
    );
    if (!rawAbandonments) invalid();
    abandonments = Object.freeze(
      rawAbandonments.map((abandonment) =>
        snapshotKnowledgeForwardRevisionAbandonmentRecord(abandonment)
      )
    );
    const rawRecoveryTerminals = snapshotArray(
      record.recoveryTerminals,
      KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxCommittedRecords
    );
    if (!rawRecoveryTerminals) invalid();
    recoveryTerminals = Object.freeze(
      rawRecoveryTerminals.map((terminal) =>
        snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(terminal)
      )
    );
  } catch {
    invalid();
  }
  if (
    review.bundleId !== bundleId ||
    review.revision > runtimeRevision ||
    review.records.some((entry) => {
      const proposal = entry.state === "pending" ? entry.proposal : entry.decision.proposal;
      return (
        proposal.request.runtimeId !== runtimeId ||
        proposal.request.bundleId !== bundleId ||
        entry.publishedRuntimeRevision > runtimeRevision ||
        (entry.state !== "pending" && entry.decidedRuntimeRevision > runtimeRevision)
      );
    }) ||
    (activeApply !== null &&
      (activeApply.runtimeId !== runtimeId || activeApply.bundleId !== bundleId)) ||
    applyCommits.some((commit) => commit.runtimeId !== runtimeId || commit.bundleId !== bundleId)
  ) {
    invalid();
  }
  return Object.freeze({
    runtimeId,
    runtimeRevision,
    bundleId,
    review,
    activeApply,
    applyCommits,
    abandonments,
    recoveryTerminals,
  });
}

/** Creates the canonical lifecycle identity carried by one exact accepted decision. */
export function createKnowledgeForwardRevisionStudioAcceptedIdentity(
  decisionValue: unknown
): Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1> {
  try {
    const decision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(decisionValue);
    const request = decision.proposal.request;
    return createKnowledgeForwardRevisionAcceptedClaimIdentity({
      resource: createKnowledgeForwardRevisionLifecycleResourceIdentity({
        runtimeId: request.runtimeId,
        bundleId: request.bundleId,
        sourceId: request.intent.current.primarySourceId,
        pagePath: request.pagePath,
      }),
      acceptedDecisionDigest: decision.acceptedDecisionDigest,
      applyClaimId: decision.applyClaim.claimId,
      applyClaimDigest: decision.applyClaimDigest,
      proposalId: decision.proposal.proposalId,
      proposalDigest: decision.proposalDigest,
      acceptedAfterHash: decision.acceptedAfterHash,
      acceptedAt: decision.acceptedAt,
    });
  } catch {
    invalid();
  }
}

/** Projects one accepted entry into its private exact durable join identity. */
function projectAcceptedEntry(
  runtimeId: string,
  bundleId: string,
  entry: Readonly<AcceptedEntry>
): Readonly<AcceptedProjection> {
  const decision = entry.decision;
  const proposal = decision.proposal;
  const pagePath = proposal.request.pagePath;
  return Object.freeze({
    entry,
    decision,
    identityKey: createAcceptedIdentityKey(
      runtimeId,
      bundleId,
      pagePath,
      proposal.proposalId,
      decision.proposalDigest,
      decision.acceptedDecisionDigest,
      decision.applyClaim.claimId,
      decision.applyClaimDigest
    ),
    reviewRef: createKnowledgeForwardRevisionStudioReviewRef(
      runtimeId,
      bundleId,
      proposal.proposalId,
      decision.proposalDigest
    ),
    acceptedIdentity: createKnowledgeForwardRevisionStudioAcceptedIdentity(decision),
  });
}

/** Returns the private exact identity key carried by one active journal. */
function createJournalIdentityKey(
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): string {
  return createAcceptedIdentityKey(
    journal.runtimeId,
    journal.bundleId,
    journal.pagePath,
    journal.proposalId,
    journal.proposalDigest,
    journal.acceptedDecisionDigest,
    journal.applyClaimId,
    journal.applyClaimDigest
  );
}

/** Returns the private exact identity key carried by one finalized ledger. */
function createLedgerIdentityKey(
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
): string {
  return createAcceptedIdentityKey(
    ledger.runtimeId,
    ledger.bundleId,
    ledger.pagePath,
    ledger.proposalId,
    ledger.proposalDigest,
    ledger.acceptedDecisionDigest,
    ledger.applyClaimId,
    ledger.applyClaimDigest
  );
}

/** Reports whether one rev3 terminal is the exact no-overlay head of a committed ledger. */
function recoveryTerminalMatchesCommittedLedger(
  terminal: Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>,
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
): boolean {
  return (
    terminal.outcome === "committed_then_external_supersession" &&
    terminal.journal.journalRevision === 3 &&
    terminal.acceptedIdentity.resource.runtimeId === ledger.runtimeId &&
    terminal.acceptedIdentity.resource.bundleId === ledger.bundleId &&
    terminal.acceptedIdentity.resource.sourceId === ledger.sourceId &&
    terminal.acceptedIdentity.resource.pagePath === ledger.pagePath &&
    terminal.acceptedIdentity.resource.windowsPathKey === ledger.windowsPathKey &&
    terminal.journal.transactionId === ledger.transactionId &&
    terminal.journal.acceptedDecisionDigest === ledger.acceptedDecisionDigest &&
    terminal.journal.applyClaimId === ledger.applyClaimId &&
    terminal.journal.applyClaimDigest === ledger.applyClaimDigest &&
    terminal.journal.beforeHash === ledger.previousEffectiveContentHash &&
    terminal.journal.afterHash === ledger.effectiveContentHash &&
    terminal.journal.committedAt === ledger.appliedAt
  );
}

/** Requires each immutable source-base epoch to be a chain with an exact earlier handoff. */
function assertCommittedSuccessorChains(
  ledgers: readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]
): void {
  const epochs = new Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]>();
  const lineages = new Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]>();
  for (const ledger of ledgers) {
    const lineageKey = canonicalizeJson([
      ledger.bundleId,
      ledger.windowsPathKey,
      ledger.sourceId,
      ledger.sourceAppliedContentHash,
    ]);
    const epochKey = canonicalizeJson([lineageKey, ledger.sourceBaseDigest]);
    epochs.set(epochKey, [...(epochs.get(epochKey) ?? []), ledger]);
    lineages.set(lineageKey, [...(lineages.get(lineageKey) ?? []), ledger]);
  }
  for (const epoch of epochs.values()) {
    const ordered = [...epoch].sort((left, right) => {
      const revisionOrder = left.manifestAfterRevision - right.manifestAfterRevision;
      if (revisionOrder !== 0) return revisionOrder;
      const timeOrder = left.appliedAt - right.appliedAt;
      if (timeOrder !== 0) return timeOrder;
      return left.forwardLedgerIdentityDigest < right.forwardLedgerIdentityDigest ? -1 : 1;
    });
    const previousHeads = new Set<string>();
    const effectiveHeads = new Set<string>();
    for (const ledger of ordered) {
      if (
        previousHeads.has(ledger.previousEffectiveContentHash) ||
        effectiveHeads.has(ledger.effectiveContentHash)
      ) {
        invalid();
      }
      previousHeads.add(ledger.previousEffectiveContentHash);
      effectiveHeads.add(ledger.effectiveContentHash);
    }
    const first = ordered[0];
    if (first.previousEffectiveContentHash !== first.sourceAppliedContentHash) {
      const lineageKey = canonicalizeJson([
        first.bundleId,
        first.windowsPathKey,
        first.sourceId,
        first.sourceAppliedContentHash,
      ]);
      const hasEarlierPredecessor = (lineages.get(lineageKey) ?? []).some(
        (candidate) =>
          candidate.sourceBaseDigest !== first.sourceBaseDigest &&
          candidate.effectiveContentHash === first.previousEffectiveContentHash &&
          candidate.manifestAfterRevision < first.manifestAfterRevision &&
          candidate.appliedAt <= first.appliedAt
      );
      if (!hasEarlierPredecessor) invalid();
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (
        current.previousEffectiveContentHash !== previous.effectiveContentHash ||
        current.manifestAfterRevision <= previous.manifestAfterRevision ||
        current.appliedAt < previous.appliedAt
      ) {
        invalid();
      }
    }
  }
}

/** Projects one accepted entry into its current product state. */
function projectAcceptedActiveRecord(
  input: Readonly<CapturedProjectionInput>,
  accepted: Readonly<AcceptedProjection>,
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1> | undefined,
  abandonment: Readonly<KnowledgeForwardRevisionAbandonmentRecordV1> | undefined,
  recoveryTerminal: Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> | undefined
): Readonly<KnowledgeForwardRevisionStudioActiveRecord> {
  const { entry, decision, reviewRef } = accepted;
  const pagePath = decision.proposal.request.pagePath;
  if (abandonment) {
    if (journal || recoveryTerminal) invalid();
    const state = "abandoned" as const;
    return Object.freeze({
      state,
      reviewRef,
      snapshotRef: createSnapshotRef(input, reviewRef, state, {
        decisionDigest: entry.decisionDigest,
        abandonmentDigest: abandonment.abandonmentDigest,
      }),
      pagePath,
      updatedAt: abandonment.abandonedAt,
      acceptedAt: decision.acceptedAt,
      abandonedAt: abandonment.abandonedAt,
      manualOverride: decision.manualOverride,
      acceptedDecision: decision,
      decisionDigest: entry.decisionDigest,
      abandonment,
      abandonmentDigest: abandonment.abandonmentDigest,
    });
  }
  if (recoveryTerminal) {
    if (journal) invalid();
    const state = "kept_current" as const;
    return Object.freeze({
      state,
      reviewRef,
      snapshotRef: createSnapshotRef(input, reviewRef, state, {
        decisionDigest: entry.decisionDigest,
        terminalizationDigest: recoveryTerminal.terminalizationDigest,
      }),
      pagePath,
      updatedAt: recoveryTerminal.terminalizedAt,
      acceptedAt: decision.acceptedAt,
      terminalizedAt: recoveryTerminal.terminalizedAt,
      manualOverride: decision.manualOverride,
      outcome: recoveryTerminal.outcome,
      acceptedDecision: decision,
      decisionDigest: entry.decisionDigest,
    });
  }
  if (!journal) {
    const state = "accepted_ready" as const;
    return Object.freeze({
      state,
      reviewRef,
      snapshotRef: createSnapshotRef(input, reviewRef, state, {
        decisionDigest: entry.decisionDigest,
        decidedRuntimeRevision: entry.decidedRuntimeRevision,
        decisionStoreRevision: entry.decisionStoreRevision,
      }),
      pagePath,
      updatedAt: decision.acceptedAt,
      acceptedAt: decision.acceptedAt,
      manualOverride: decision.manualOverride,
      acceptedDecision: decision,
      decisionDigest: entry.decisionDigest,
    });
  }
  const journalDigest = createKnowledgeForwardRevisionApplyJournalDigest(journal);
  if (journal.phase === "recovery_required") {
    const state = "recovery_required" as const;
    const recoveryExpectation = createKnowledgeForwardRevisionApplyRecoveryExpectation(journal);
    return Object.freeze({
      state,
      reviewRef,
      snapshotRef: createSnapshotRef(input, reviewRef, state, {
        decisionDigest: entry.decisionDigest,
        journalDigest,
      }),
      pagePath,
      updatedAt: journal.updatedAt,
      acceptedAt: decision.acceptedAt,
      manualOverride: decision.manualOverride,
      conflictCode: journal.conflict.code,
      actualKind: journal.conflict.actualKind,
      detectedAt: journal.conflict.detectedAt,
      acceptedDecision: decision,
      decisionDigest: entry.decisionDigest,
      recoveryExpectation,
    });
  }
  const state = "applying" as const;
  return Object.freeze({
    state,
    reviewRef,
    snapshotRef: createSnapshotRef(input, reviewRef, state, {
      decisionDigest: entry.decisionDigest,
      journalDigest,
      applyPhase: journal.phase,
    }),
    pagePath,
    updatedAt: journal.updatedAt,
    acceptedAt: decision.acceptedAt,
    manualOverride: decision.manualOverride,
    applyPhase: journal.phase,
    acceptedDecision: decision,
    decisionDigest: entry.decisionDigest,
  });
}

/** Projects one pending entry with its exact durable proposal for later private rejoin. */
function projectPendingActiveRecord(
  input: Readonly<CapturedProjectionInput>,
  entry: Extract<KnowledgeForwardRevisionReviewSnapshotV2["records"][number], { state: "pending" }>
): Readonly<KnowledgeForwardRevisionStudioPendingRecord> {
  const proposal = entry.proposal;
  const request = proposal.request;
  const reviewRef = createKnowledgeForwardRevisionStudioReviewRef(
    input.runtimeId,
    input.bundleId,
    proposal.proposalId,
    entry.proposalDigest
  );
  const state = "pending" as const;
  return Object.freeze({
    state,
    reviewRef,
    snapshotRef: createSnapshotRef(input, reviewRef, state, {
      proposalDigest: entry.proposalDigest,
      publishedRuntimeRevision: entry.publishedRuntimeRevision,
      proposalStoreRevision: entry.proposalStoreRevision,
    }),
    pagePath: request.pagePath,
    updatedAt: proposal.recordedAt,
    requestedAt: request.requestedAt,
    selectedAppliedAt: request.intent.historical.appliedAt,
    proposal,
    proposalDigest: entry.proposalDigest,
  });
}

/** Orders active work by latest durable event and then opaque stable identity. */
function compareActiveRecords(
  left: Readonly<KnowledgeForwardRevisionStudioActiveRecord>,
  right: Readonly<KnowledgeForwardRevisionStudioActiveRecord>
): number {
  const timeOrder = right.updatedAt - left.updatedAt;
  if (timeOrder !== 0) return timeOrder;
  return left.reviewRef < right.reviewRef ? -1 : left.reviewRef > right.reviewRef ? 1 : 0;
}

/** Strictly captures one projected active product row. */
function snapshotActiveRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionStudioActiveRecord> {
  const stateRecord = snapshotRecord(
    value,
    ["state"],
    [
      ...new Set([
        ...PENDING_KEYS,
        ...ACCEPTED_READY_KEYS,
        ...ABANDONED_KEYS,
        ...KEPT_CURRENT_KEYS,
        ...APPLYING_KEYS,
        ...RECOVERY_KEYS,
      ])
        .values()
        .filter((key) => key !== "state"),
    ]
  );
  const state = stateRecord?.state;
  const keys =
    state === "pending"
      ? PENDING_KEYS
      : state === "accepted_ready"
        ? ACCEPTED_READY_KEYS
        : state === "abandoned"
          ? ABANDONED_KEYS
          : state === "kept_current"
            ? KEPT_CURRENT_KEYS
            : state === "applying"
              ? APPLYING_KEYS
              : state === "recovery_required"
                ? RECOVERY_KEYS
                : undefined;
  const record =
    stateRecord &&
    keys &&
    Reflect.ownKeys(stateRecord).length === keys.length &&
    keys.every((key) => Object.hasOwn(stateRecord, key))
      ? stateRecord
      : undefined;
  if (
    !record ||
    typeof record.reviewRef !== "string" ||
    !REVIEW_REF_PATTERN.test(record.reviewRef) ||
    typeof record.snapshotRef !== "string" ||
    !SNAPSHOT_REF_PATTERN.test(record.snapshotRef) ||
    !snapshotPagePath(record.pagePath) ||
    !isNonNegativeInteger(record.updatedAt)
  ) {
    invalid();
  }
  const common = {
    reviewRef: record.reviewRef,
    snapshotRef: record.snapshotRef,
    pagePath: record.pagePath as string,
    updatedAt: record.updatedAt,
  };
  if (state === "pending") {
    let proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
    try {
      proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    } catch {
      invalid();
    }
    if (
      !isNonNegativeInteger(record.requestedAt) ||
      !isNonNegativeInteger(record.selectedAppliedAt) ||
      Number(record.requestedAt) > Number(record.updatedAt) ||
      typeof record.proposalDigest !== "string" ||
      record.proposalDigest !==
        createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      proposal.request.pagePath !== common.pagePath ||
      proposal.request.requestedAt !== record.requestedAt ||
      proposal.recordedAt !== record.updatedAt ||
      proposal.request.intent.historical.appliedAt !== record.selectedAppliedAt
    ) {
      invalid();
    }
    return Object.freeze({
      state,
      ...common,
      requestedAt: record.requestedAt,
      selectedAppliedAt: record.selectedAppliedAt,
      proposal,
      proposalDigest: record.proposalDigest,
    });
  }
  if (
    !isNonNegativeInteger(record.acceptedAt) ||
    typeof record.manualOverride !== "boolean" ||
    Number(record.acceptedAt) > Number(record.updatedAt)
  ) {
    invalid();
  }
  const acceptedCommon = {
    ...common,
    acceptedAt: record.acceptedAt,
    manualOverride: record.manualOverride,
  };
  let acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  try {
    acceptedDecision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
      record.acceptedDecision
    );
  } catch {
    invalid();
  }
  if (
    typeof record.decisionDigest !== "string" ||
    record.decisionDigest !==
      createKnowledgeForwardRevisionTerminalDecisionRecordDigest(acceptedDecision) ||
    acceptedDecision.proposal.request.pagePath !== common.pagePath ||
    acceptedDecision.acceptedAt !== record.acceptedAt ||
    acceptedDecision.manualOverride !== record.manualOverride
  ) {
    invalid();
  }
  if (state === "accepted_ready") {
    return Object.freeze({
      state,
      ...acceptedCommon,
      acceptedDecision,
      decisionDigest: record.decisionDigest,
    });
  }
  if (state === "abandoned") {
    let abandonment: Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>;
    try {
      abandonment = snapshotKnowledgeForwardRevisionAbandonmentRecord(record.abandonment);
    } catch {
      invalid();
    }
    if (
      !isNonNegativeInteger(record.abandonedAt) ||
      record.abandonedAt !== record.updatedAt ||
      abandonment.abandonedAt !== record.abandonedAt ||
      typeof record.abandonmentDigest !== "string" ||
      record.abandonmentDigest !== abandonment.abandonmentDigest ||
      !exactJsonValuesEqual(
        abandonment.acceptedIdentity,
        createKnowledgeForwardRevisionStudioAcceptedIdentity(acceptedDecision)
      )
    ) {
      invalid();
    }
    return Object.freeze({
      state,
      ...acceptedCommon,
      abandonedAt: record.abandonedAt,
      acceptedDecision,
      decisionDigest: record.decisionDigest,
      abandonment,
      abandonmentDigest: record.abandonmentDigest,
    });
  }
  if (state === "kept_current") {
    if (
      !isNonNegativeInteger(record.terminalizedAt) ||
      record.terminalizedAt !== record.updatedAt ||
      (record.outcome !== "abandoned_before_write" &&
        record.outcome !== "write_outcome_uncertain_external_supersession" &&
        record.outcome !== "committed_then_external_supersession")
    ) {
      invalid();
    }
    return Object.freeze({
      state,
      ...acceptedCommon,
      terminalizedAt: record.terminalizedAt,
      outcome: record.outcome,
      acceptedDecision,
      decisionDigest: record.decisionDigest,
    });
  }
  if (state === "applying") {
    if (
      record.applyPhase !== "prepared" &&
      record.applyPhase !== "applying" &&
      record.applyPhase !== "committed"
    ) {
      invalid();
    }
    return Object.freeze({
      state,
      ...acceptedCommon,
      applyPhase: record.applyPhase,
      acceptedDecision,
      decisionDigest: record.decisionDigest,
    });
  }
  if (
    state !== "recovery_required" ||
    (record.conflictCode !== "file_state_conflict" &&
      record.conflictCode !== "post_write_verification_failed") ||
    (record.actualKind !== "missing" &&
      record.actualKind !== "directory" &&
      record.actualKind !== "file" &&
      record.actualKind !== "oversized_file") ||
    !isNonNegativeInteger(record.detectedAt) ||
    record.detectedAt !== record.updatedAt
  ) {
    invalid();
  }
  let recoveryExpectation: Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1>;
  try {
    recoveryExpectation = snapshotKnowledgeForwardRevisionApplyRecoveryExpectation(
      record.recoveryExpectation
    );
  } catch {
    invalid();
  }
  if (
    !exactJsonValuesEqual(
      recoveryExpectation.acceptedIdentity,
      createKnowledgeForwardRevisionStudioAcceptedIdentity(acceptedDecision)
    )
  ) {
    invalid();
  }
  return Object.freeze({
    state,
    ...acceptedCommon,
    conflictCode: record.conflictCode,
    actualKind: record.actualKind,
    detectedAt: record.detectedAt,
    acceptedDecision,
    decisionDigest: record.decisionDigest,
    recoveryExpectation,
  });
}

/** Strictly detaches one product snapshot returned through an adapter boundary. */
export function snapshotKnowledgeForwardRevisionStudioSnapshot(
  value: unknown
): Readonly<KnowledgeForwardRevisionStudioSnapshot> {
  try {
    const record = snapshotRecord(value, SNAPSHOT_KEYS);
    const rawActive = snapshotArray(
      record?.activeRecords,
      KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxActiveRecords
    );
    const rawCommittedReviewRefs = snapshotArray(
      record?.committedReviewRefs,
      KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxCommittedRecords
    );
    if (
      !record ||
      !rawActive ||
      !rawCommittedReviewRefs ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_STUDIO_SNAPSHOT_VERSION ||
      record.kind !== "forward_revision_studio_snapshot" ||
      !isIdentifier(record.bundleId) ||
      !isNonNegativeInteger(record.runtimeRevision) ||
      !isNonNegativeInteger(record.reviewRevision) ||
      Number(record.reviewRevision) > Number(record.runtimeRevision) ||
      typeof record.revisionToken !== "string" ||
      !REVISION_TOKEN_PATTERN.test(record.revisionToken) ||
      !isNonNegativeInteger(record.committedCount) ||
      Number(record.committedCount) >
        KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxCommittedRecords ||
      Number(record.committedCount) !== rawCommittedReviewRefs.length
    ) {
      invalid();
    }
    const activeRecords = Object.freeze(rawActive.map(snapshotActiveRecord));
    const committedReviewRefs = Object.freeze(
      rawCommittedReviewRefs.map((reviewRef) => {
        if (typeof reviewRef !== "string" || !REVIEW_REF_PATTERN.test(reviewRef)) invalid();
        return reviewRef;
      })
    );
    let totalContentCharacters = 0;
    const activeByReviewRef = new Map<
      string,
      Readonly<KnowledgeForwardRevisionStudioActiveRecord>
    >();
    for (let index = 0; index < activeRecords.length; index += 1) {
      const item = activeRecords[index];
      if (activeByReviewRef.has(item.reviewRef)) invalid();
      activeByReviewRef.set(item.reviewRef, item);
      totalContentCharacters +=
        item.state === "pending"
          ? item.proposal.request.selectedContent.length
          : item.acceptedDecision.proposal.request.selectedContent.length +
            item.acceptedDecision.afterContent.length;
      if (
        !Number.isSafeInteger(totalContentCharacters) ||
        totalContentCharacters > KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxTotalContentCharacters
      ) {
        resourceLimit("content_characters");
      }
      if (index > 0 && compareActiveRecords(activeRecords[index - 1], item) > 0) invalid();
    }
    const committedRefs = new Set<string>();
    for (let index = 0; index < committedReviewRefs.length; index += 1) {
      const reviewRef = committedReviewRefs[index];
      const active = activeByReviewRef.get(reviewRef);
      if (
        committedRefs.has(reviewRef) ||
        (active !== undefined &&
          !(
            active.state === "kept_current" &&
            active.outcome === "committed_then_external_supersession"
          )) ||
        (index > 0 && committedReviewRefs[index - 1] >= reviewRef)
      ) {
        invalid();
      }
      committedRefs.add(reviewRef);
    }
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_STUDIO_SNAPSHOT_VERSION,
      kind: "forward_revision_studio_snapshot" as const,
      bundleId: record.bundleId,
      runtimeRevision: record.runtimeRevision,
      reviewRevision: record.reviewRevision,
      revisionToken: record.revisionToken,
      activeRecords,
      committedReviewRefs,
      committedCount: record.committedCount,
    });
  } catch (error) {
    if (isAuthenticProjectionLimitError(error)) throw error;
    invalid();
  }
}

/**
 * Classifies one Bundle's forward Review, journal, and ledger graph from one envelope.
 *
 * Every active row retains the exact durable proposal or accepted decision needed
 * by a private production coordinator to rejoin a later command. That structural
 * material is not mutation authority: Decision and Apply still require their fresh
 * Runtime CAS and genuine process capabilities. React-facing adapters must project
 * these rows again to opaque references and safe display fields.
 *
 * @param value - Strict one-envelope Runtime projection input
 * @returns Frozen bounded active work plus an exact committed count
 */
export function projectKnowledgeForwardRevisionStudioSnapshot(
  value: unknown
): Readonly<KnowledgeForwardRevisionStudioSnapshot> {
  const input = captureProjectionInput(value);
  const acceptedByIdentity = new Map<string, Readonly<AcceptedProjection>>();
  const acceptedByProposalId = new Map<string, Readonly<AcceptedProjection>>();
  const acceptedByLifecycleIdentity = new Map<string, Readonly<AcceptedProjection>>();
  for (const entry of input.review.records) {
    if (entry.state !== "accepted") continue;
    const accepted = projectAcceptedEntry(input.runtimeId, input.bundleId, entry);
    const lifecycleIdentityKey = canonicalizeJson(accepted.acceptedIdentity);
    if (
      acceptedByIdentity.has(accepted.identityKey) ||
      acceptedByProposalId.has(accepted.decision.proposal.proposalId) ||
      acceptedByLifecycleIdentity.has(lifecycleIdentityKey)
    ) {
      invalid();
    }
    acceptedByIdentity.set(accepted.identityKey, accepted);
    acceptedByProposalId.set(accepted.decision.proposal.proposalId, accepted);
    acceptedByLifecycleIdentity.set(lifecycleIdentityKey, accepted);
  }

  const abandonmentByAcceptedIdentity = new Map<
    string,
    Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>
  >();
  const abandonmentIds = new Set<string>();
  const abandonmentDigests = new Set<string>();
  for (const abandonment of input.abandonments) {
    const accepted = acceptedByLifecycleIdentity.get(
      canonicalizeJson(abandonment.acceptedIdentity)
    );
    if (
      !accepted ||
      abandonmentByAcceptedIdentity.has(accepted.identityKey) ||
      abandonmentIds.has(abandonment.abandonmentId) ||
      abandonmentDigests.has(abandonment.abandonmentDigest)
    ) {
      invalid();
    }
    abandonmentByAcceptedIdentity.set(accepted.identityKey, abandonment);
    abandonmentIds.add(abandonment.abandonmentId);
    abandonmentDigests.add(abandonment.abandonmentDigest);
  }

  const recoveryTerminalByAcceptedIdentity = new Map<
    string,
    Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>
  >();
  const recoveryTerminalIds = new Set<string>();
  const recoveryTerminalDigests = new Set<string>();
  for (const terminal of input.recoveryTerminals) {
    const accepted = acceptedByLifecycleIdentity.get(canonicalizeJson(terminal.acceptedIdentity));
    if (
      !accepted ||
      abandonmentByAcceptedIdentity.has(accepted.identityKey) ||
      recoveryTerminalByAcceptedIdentity.has(accepted.identityKey) ||
      recoveryTerminalIds.has(terminal.terminalizationId) ||
      recoveryTerminalDigests.has(terminal.terminalizationDigest)
    ) {
      invalid();
    }
    recoveryTerminalByAcceptedIdentity.set(accepted.identityKey, terminal);
    recoveryTerminalIds.add(terminal.terminalizationId);
    recoveryTerminalDigests.add(terminal.terminalizationDigest);
  }

  const seenLedgerIdentities = new Set<string>();
  const committedIdentities = new Set<string>();
  for (const ledger of input.applyCommits) {
    const key = createLedgerIdentityKey(ledger);
    const accepted = acceptedByIdentity.get(key);
    const recoveryTerminal = recoveryTerminalByAcceptedIdentity.get(key);
    const committedRecovery =
      recoveryTerminal !== undefined &&
      recoveryTerminalMatchesCommittedLedger(recoveryTerminal, ledger);
    if (
      !accepted ||
      seenLedgerIdentities.has(key) ||
      abandonmentByAcceptedIdentity.has(key) ||
      (recoveryTerminal !== undefined && !committedRecovery) ||
      ledger.pagePath !== accepted.decision.proposal.request.pagePath ||
      ledger.windowsPathKey !== toWindowsPathKey(accepted.decision.proposal.request.pagePath) ||
      ledger.sourceAppliedContentHash !== accepted.decision.acceptanceAuthority.manifestBaseHash ||
      ledger.previousEffectiveContentHash !==
        accepted.decision.acceptanceAuthority.vaultObservedBeforeHash ||
      ledger.effectiveContentHash !== accepted.decision.acceptedAfterHash ||
      ledger.appliedAt < accepted.decision.acceptedAt
    ) {
      invalid();
    }
    seenLedgerIdentities.add(key);
    committedIdentities.add(key);
  }
  assertCommittedSuccessorChains(input.applyCommits);

  let activeJournalIdentity: string | undefined;
  if (input.activeApply) {
    activeJournalIdentity = createJournalIdentityKey(input.activeApply);
    const accepted = acceptedByIdentity.get(activeJournalIdentity);
    if (
      !accepted ||
      committedIdentities.has(activeJournalIdentity) ||
      abandonmentByAcceptedIdentity.has(activeJournalIdentity) ||
      recoveryTerminalByAcceptedIdentity.has(activeJournalIdentity) ||
      input.activeApply.pagePath !== accepted.decision.proposal.request.pagePath ||
      input.activeApply.windowsPathKey !==
        toWindowsPathKey(accepted.decision.proposal.request.pagePath) ||
      !exactJsonValuesEqual(input.activeApply.acceptedDecision, accepted.decision) ||
      input.activeApply.sourceAppliedContentHash !==
        accepted.decision.acceptanceAuthority.manifestBaseHash ||
      input.activeApply.previousEffectiveContentHash !==
        accepted.decision.acceptanceAuthority.vaultObservedBeforeHash ||
      input.activeApply.afterHash !== accepted.decision.acceptedAfterHash ||
      input.activeApply.updatedAt < accepted.decision.acceptedAt ||
      input.activeApply.revalidationReceipt.runtimeRevision > input.runtimeRevision
    ) {
      invalid();
    }
  }

  const activeRecords: Readonly<KnowledgeForwardRevisionStudioActiveRecord>[] = [];
  for (const entry of input.review.records) {
    if (entry.state === "rejected") continue;
    if (entry.state === "pending") {
      activeRecords.push(projectPendingActiveRecord(input, entry));
    } else {
      const accepted = acceptedByProposalId.get(entry.decision.proposal.proposalId);
      if (!accepted) invalid();
      if (
        committedIdentities.has(accepted.identityKey) &&
        !recoveryTerminalByAcceptedIdentity.has(accepted.identityKey)
      ) {
        continue;
      }
      activeRecords.push(
        projectAcceptedActiveRecord(
          input,
          accepted,
          activeJournalIdentity === accepted.identityKey
            ? (input.activeApply ?? undefined)
            : undefined,
          abandonmentByAcceptedIdentity.get(accepted.identityKey),
          recoveryTerminalByAcceptedIdentity.get(accepted.identityKey)
        )
      );
    }
    if (activeRecords.length > KNOWLEDGE_FORWARD_REVISION_STUDIO_LIMITS.maxActiveRecords) {
      resourceLimit("active_records");
    }
  }
  activeRecords.sort(compareActiveRecords);
  const frozenActiveRecords = Object.freeze(activeRecords);
  const committedReviewRefs = Object.freeze(
    [...committedIdentities]
      .map((identity) => acceptedByIdentity.get(identity)?.reviewRef)
      .filter((reviewRef): reviewRef is string => reviewRef !== undefined)
      .sort()
  );
  if (committedReviewRefs.length !== committedIdentities.size) invalid();
  const revisionToken = createOpaqueRef(
    "forward-studio-revision",
    "knowledge-forward-revision-studio-snapshot-v1",
    {
      runtimeId: input.runtimeId,
      runtimeRevision: input.runtimeRevision,
      bundleId: input.bundleId,
      reviewRevision: input.review.revision,
      activeSnapshotRefs: frozenActiveRecords.map((record) => record.snapshotRef),
      committedReviewRefs: [...committedReviewRefs],
      committedCount: committedIdentities.size,
    }
  );
  return snapshotKnowledgeForwardRevisionStudioSnapshot({
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_SNAPSHOT_VERSION,
    kind: "forward_revision_studio_snapshot",
    bundleId: input.bundleId,
    runtimeRevision: input.runtimeRevision,
    reviewRevision: input.review.revision,
    revisionToken,
    activeRecords: frozenActiveRecords,
    committedReviewRefs,
    committedCount: committedIdentities.size,
  });
}

Object.freeze(KnowledgeForwardRevisionStudioProjectionLimitError.prototype);
Object.freeze(KnowledgeForwardRevisionStudioProjectionLimitError);
Object.freeze(KnowledgeForwardRevisionStudioProjectionError.prototype);
Object.freeze(KnowledgeForwardRevisionStudioProjectionError);
