import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  snapshotKnowledgeForwardRevisionApplyLedgerRecord,
  type KnowledgeForwardRevisionApplyLedgerRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  snapshotKnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionAcceptedReviewEntryV2,
  type KnowledgeForwardRevisionReviewSnapshotV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import {
  createManifestCommitIntentDigest,
  projectManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeFileChange } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import type { KnowledgeApplyCommitLedgerRecord } from "@/knowledge/runtime/KnowledgeRuntimeStore";

/** Hard limits for one known-applied-output Runtime read. */
export const KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS = Object.freeze({
  maxApplyCommits: 10_000,
  maxForwardApplyCommits: 10_000,
  maxReviewRecords: 10_000,
  maxForwardReviewRecords: 10_000,
  maxAcceptedChanges: 100_000,
  maxPageOutputs: 10_000,
  maxManifestEntries: 10_000,
  maxContentCharacters: 2_000_000,
  maxTotalSnapshotCharacters: 32_000_000,
  maxIdentifierCharacters: 1_024,
  maxPagePathCharacters: 1_024,
  maxSnapshotDepth: 64,
  maxSnapshotNodes: 5_000_000,
});

/** Stable bounded resource whose exhaustion aborted a projection. */
export type KnowledgeKnownAppliedWikiOutputLimit =
  | "apply_commits"
  | "forward_apply_commits"
  | "review_records"
  | "forward_review_records"
  | "accepted_changes"
  | "page_outputs"
  | "snapshot_characters"
  | "snapshot_complexity";

/** Reports a valid-shaped read that exceeds the bounded projection contract. */
export class KnowledgeKnownAppliedWikiOutputLimitError extends Error {
  /** Creates one sanitized resource-limit failure. */
  constructor(public readonly limit: KnowledgeKnownAppliedWikiOutputLimit) {
    super("Known applied Wiki outputs exceed the bounded read contract");
    this.name = "KnowledgeKnownAppliedWikiOutputLimitError";
  }
}

/** Reports malformed projection arguments without retaining rejected values. */
export class KnowledgeKnownAppliedWikiOutputProjectionError extends Error {
  /** Creates one sanitized projection failure. */
  constructor() {
    super("Known applied Wiki outputs do not satisfy the read projection contract");
    this.name = "KnowledgeKnownAppliedWikiOutputProjectionError";
  }
}

/** Current content-addressed Manifest page captured in the same Runtime envelope. */
export interface KnowledgeKnownAppliedWikiCurrentPage {
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: "generated" | "shared" | "user";
  readonly contentHash: string;
}

/**
 * Private exact version identity retained by the Coordinator behind an opaque ref.
 *
 * This is read authority only. It never authorizes Restore, Review, Apply, or a
 * Vault write, and must be rejoined against a later atomic Runtime envelope.
 */
interface KnowledgeKnownAppliedWikiOutputAuthorityBase {
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly outputPath: string;
  readonly contentHash: string;
  readonly characterCount: number;
  readonly transactionId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
}

/** Exact ordinary Source Apply authority retained behind an opaque detail ref. */
export interface KnowledgeKnownAppliedWikiSourceApplyAuthorityIdentity extends KnowledgeKnownAppliedWikiOutputAuthorityBase {
  readonly origin: "source_apply";
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly manifestIntentDigest: string;
}

/** Exact forward revision authority retained behind an opaque detail ref. */
export interface KnowledgeKnownAppliedWikiForwardRevisionAuthorityIdentity extends KnowledgeKnownAppliedWikiOutputAuthorityBase {
  readonly origin: "forward_revision";
  readonly ledgerId: string;
  readonly ledgerDigest: string;
  readonly forwardLedgerIdentityDigest: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly manualOverride: boolean;
}

/** One exact provenance-discriminated private detail authority. */
export type KnowledgeKnownAppliedWikiOutputAuthorityIdentity =
  | KnowledgeKnownAppliedWikiSourceApplyAuthorityIdentity
  | KnowledgeKnownAppliedWikiForwardRevisionAuthorityIdentity;

/** Aggregate metadata for one verified Apply provenance kind. */
export interface KnowledgeKnownAppliedWikiOutputOriginSummary {
  readonly kind: "source_apply" | "forward_revision";
  readonly verifiedApplyCount: number;
  readonly newestAppliedAt: number;
  readonly newestManifestRevision: number;
}

/** Metadata-only content-addressed output returned by the index read. */
export interface KnowledgeKnownAppliedWikiOutputIndexItem {
  readonly path: string;
  readonly windowsPathKey: string;
  readonly contentHash: string;
  readonly characterCount: number;
  readonly detailAvailability: "available" | "too_large";
  readonly newestAppliedAt: number;
  readonly newestManifestRevision: number;
  readonly verifiedApplyCount: number;
  readonly origins: readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[];
  readonly authority: Readonly<KnowledgeKnownAppliedWikiOutputAuthorityIdentity>;
}

/** Metadata-only known-output index from exactly one atomic Runtime envelope. */
export interface KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly reviewRevision: number | null;
  readonly forwardReviewRevision: number | null;
  readonly manifestRevision: number;
  readonly currentManifestPage: Readonly<KnowledgeKnownAppliedWikiCurrentPage> | null;
  readonly outputs: readonly Readonly<KnowledgeKnownAppliedWikiOutputIndexItem>[];
}

/** Result of rejoining one private index identity against a fresh Runtime envelope. */
export type KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot =
  | {
      readonly kind: "available";
      readonly runtimeId: string;
      readonly runtimeRevision: number;
      readonly contentHash: string;
      readonly content: string;
      readonly characterCount: number;
    }
  | {
      readonly kind: "too_large";
      readonly runtimeId: string;
      readonly runtimeRevision: number;
      readonly contentHash: string;
      readonly characterCount: number;
    }
  | {
      readonly kind: "stale";
      readonly runtimeId: string;
      readonly runtimeRevision: number;
    };

/** Strict index inputs captured from one already-validated Runtime envelope. */
export interface KnowledgeKnownAppliedWikiOutputIndexProjectionInput {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly applyCommits: readonly KnowledgeApplyCommitLedgerRecord[];
  readonly review?: ChangeSetReviewSnapshot;
  readonly forwardRevisionApplyCommits?: readonly KnowledgeForwardRevisionApplyLedgerRecord[];
  readonly forwardRevisionReview?: KnowledgeForwardRevisionReviewSnapshotV2;
  readonly manifestRevision: number;
  readonly currentManifestPage?: KnowledgeKnownAppliedWikiCurrentPage;
}

/** Strict detail inputs captured from one already-validated Runtime envelope. */
export interface KnowledgeKnownAppliedWikiOutputDetailProjectionInput {
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly applyCommits: readonly KnowledgeApplyCommitLedgerRecord[];
  readonly review?: ChangeSetReviewSnapshot;
  readonly forwardRevisionApplyCommits?: readonly KnowledgeForwardRevisionApplyLedgerRecord[];
  readonly forwardRevisionReview?: KnowledgeForwardRevisionReviewSnapshotV2;
  readonly authority: KnowledgeKnownAppliedWikiOutputAuthorityIdentity;
}

/** Mutable descriptor-safe JSON snapshot budget. */
interface SnapshotBudget {
  nodes: number;
  characters: number;
}

/** Page metadata retained after validated accepted content has been discarded. */
interface AcceptedPageMetadata {
  path: string;
  contentHash: string;
  characterCount: number;
}

/** Accepted Review identity retained without proposal or accepted body bytes. */
interface AcceptedRecordMetadata {
  recordIndex: number;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSetId: string;
  changeSetDigest: string;
  manifestIntentDigest: string;
  page?: AcceptedPageMetadata;
}

/** Bounded accepted Review index used by both narrow reads. */
interface AcceptedRecordIndex {
  revision: number;
  byJoinKey: ReadonlyMap<string, readonly AcceptedRecordMetadata[]>;
}

/** Strict accepted Forward Review records indexed by durable decision identity. */
interface ForwardAcceptedRecordIndex {
  revision: number;
  byAcceptedDecisionDigest: ReadonlyMap<
    string,
    readonly Readonly<KnowledgeForwardRevisionAcceptedReviewEntryV2>[]
  >;
}

/** Mutable metadata-only output accumulator. */
interface SourceApplyProof {
  origin: "source_apply";
  ledger: KnowledgeApplyCommitLedgerRecord;
}

/** Exact canonical Forward ledger and accepted Review proof. */
interface ForwardRevisionProof {
  origin: "forward_revision";
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>;
  accepted: Readonly<KnowledgeForwardRevisionAcceptedReviewEntryV2>;
}

/** Any exact Apply proof that can contribute one historical output. */
type KnownAppliedOutputProof = SourceApplyProof | ForwardRevisionProof;

/** Mutable metadata-only output accumulator. */
interface OutputAccumulator {
  path: string;
  contentHash: string;
  characterCount: number;
  proofs: KnownAppliedOutputProof[];
}

/** Reports whether an object exposes exactly the expected own string keys. */
function hasExactOwnKeys(
  value: object,
  expected: readonly string[],
  optional: readonly string[] = []
): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    const allowed = [...expected, ...optional];
    return (
      (prototype === Object.prototype || prototype === null) &&
      keys.length >= expected.length &&
      keys.length <= allowed.length &&
      keys.every((key) => {
        if (typeof key !== "string" || !allowed.includes(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return Boolean(descriptor && descriptor.enumerable && "value" in descriptor);
      }) &&
      expected.every((key) => keys.includes(key))
    );
  } catch {
    return false;
  }
}

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a dense array length without invoking an accessor. */
function readDenseArrayLength(value: unknown): number | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = descriptor && "value" in descriptor ? descriptor.value : undefined;
    return Number.isSafeInteger(length) && Number(length) >= 0 ? Number(length) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads one dense array item through its own enumerable data descriptor. */
function readDenseArrayItem(value: readonly unknown[], index: number): unknown {
  return readDataProperty(value, String(index));
}

/**
 * Detaches JSON data without invoking accessors, traversing cycles, or accepting
 * exotic prototypes. The Runtime parser normally supplies plain JSON; this
 * fence keeps the leaf safe under hostile structurally-typed tests and callers.
 */
function snapshotJsonData(
  value: unknown,
  budget: SnapshotBudget,
  depth = 0,
  ancestors: ReadonlySet<object> = new Set()
): JsonValue | undefined {
  budget.nodes += 1;
  if (budget.nodes > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxSnapshotNodes) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("snapshot_complexity");
  }
  if (depth > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxSnapshotDepth) return undefined;
  if (typeof value === "string") {
    budget.characters += value.length;
    if (budget.characters > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxTotalSnapshotCharacters) {
      throw new KnowledgeKnownAppliedWikiOutputLimitError("snapshot_characters");
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || ancestors.has(value)) return undefined;

  let isArray: boolean;
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (isArray) {
    if (prototype !== Array.prototype) return undefined;
    const length = readDenseArrayLength(value);
    if (length === undefined || keys.length !== length + 1) return undefined;
    const result: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const snapshot = snapshotJsonData(
        readDataProperty(value, String(index)),
        budget,
        depth + 1,
        nextAncestors
      );
      if (snapshot === undefined) return undefined;
      result.push(snapshot);
    }
    return result;
  }

  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of keys) {
    if (typeof key !== "string") return undefined;
    budget.characters += key.length;
    if (budget.characters > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxTotalSnapshotCharacters) {
      throw new KnowledgeKnownAppliedWikiOutputLimitError("snapshot_characters");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return undefined;
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    const snapshot = snapshotJsonData(descriptor.value, budget, depth + 1, nextAncestors);
    if (snapshot === undefined) return undefined;
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: snapshot,
    });
  }
  return result;
}

/** Creates the exact ledger ↔ accepted Review join key. */
function createJoinKey(fields: {
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSetId: string;
  changeSetDigest: string;
  manifestIntentDigest: string;
}): string {
  return canonicalizeJson([
    fields.bundleId,
    fields.sourceId,
    fields.sourceContentHash,
    fields.pipelineFingerprint,
    fields.inputRevision,
    fields.changeSetId,
    fields.changeSetDigest,
    fields.manifestIntentDigest,
  ]);
}

/**
 * Compares one exact Apply ledger with one strict accepted Review record.
 *
 * Sharing this predicate prevents current-provenance and known-output reads
 * from drifting into different commit-proof rules.
 */
export function knowledgeApplyLedgerMatchesAcceptedRecord(
  ledger: KnowledgeApplyCommitLedgerRecord,
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    ledger.bundleId === bundleId &&
    ledger.sourceId === record.jobClaim.sourceId &&
    ledger.sourceContentHash === record.jobClaim.sourceContentHash &&
    ledger.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    ledger.inputRevision === record.jobClaim.inputRevision &&
    ledger.changeSetId === record.changeSetId &&
    ledger.changeSetDigest === record.acceptedDigest &&
    ledger.manifestIntentDigest === record.manifestCommitIntentDigest
  );
}

/** Reports whether a string is an exact lowercase SHA-256 digest. */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Creates one plain strict ledger snapshot through data descriptors only. */
function snapshotLedgerRecord(value: unknown): KnowledgeApplyCommitLedgerRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stringFields = ["transactionId", "bundleId", "sourceId", "changeSetId"] as const;
  const digestFields = [
    "sourceContentHash",
    "pipelineFingerprint",
    "changeSetDigest",
    "manifestIntentDigest",
    "journalDigest",
    "receiptDigest",
    "manifestBeforeDigest",
    "manifestAfterDigest",
  ] as const;
  const integerFields = [
    "commitRevision",
    "inputRevision",
    "manifestBeforeRevision",
    "manifestAfterRevision",
    "recordedAt",
  ] as const;
  if (!hasExactOwnKeys(value, [...stringFields, ...digestFields, ...integerFields])) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {};
  for (const field of [...stringFields, ...digestFields, ...integerFields]) {
    snapshot[field] = readDataProperty(value, field);
  }
  if (
    !stringFields.every(
      (field) =>
        typeof snapshot[field] === "string" &&
        String(snapshot[field]).length <=
          KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters &&
        String(snapshot[field]).trim().length > 0
    ) ||
    !digestFields.every((field) => isDigest(snapshot[field])) ||
    !integerFields.every(
      (field) => Number.isSafeInteger(snapshot[field]) && Number(snapshot[field]) >= 0
    ) ||
    Number(snapshot.manifestAfterRevision) !== Number(snapshot.manifestBeforeRevision) + 1
  ) {
    return undefined;
  }
  return snapshot as unknown as KnowledgeApplyCommitLedgerRecord;
}

/** Snapshots and validates one accepted Review record independently of peers. */
function snapshotAcceptedRecord(
  value: unknown,
  bundleId: string,
  reviewRevision: number,
  budget: SnapshotBudget
): AcceptedChangeSetReviewRecord | undefined {
  const snapshot = snapshotJsonData(value, budget);
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return undefined;
  const parsed = parseChangeSetReviewSnapshot({
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId,
    revision: reviewRevision,
    records: [snapshot],
  });
  if (!parsed.ok || !validateChangeSetReviewSnapshot(parsed.value).valid) return undefined;
  const record = parsed.value.records[0];
  return record?.outcome === "accepted" &&
    canonicalizeJson(snapshot) === canonicalizeJson(record as unknown as JsonValue)
    ? record
    : undefined;
}

/** Re-proves accepted bytes, digest, and final Manifest intent. */
function acceptedRecordHasExactProjection(record: AcceptedChangeSetReviewRecord): boolean {
  if (
    record.acceptedChangeSet.status !== "accepted" ||
    createChangeSetTransactionDigest(record.acceptedChangeSet) !== record.acceptedDigest ||
    createManifestCommitIntentDigest(record.manifestCommitIntent) !==
      record.manifestCommitIntentDigest
  ) {
    return false;
  }
  try {
    const projected = projectManifestCommitIntent(
      record.manifestCommitPlan,
      record.acceptedChangeSet
    );
    return (
      canonicalizeJson(projected as unknown as JsonValue) ===
      canonicalizeJson(record.manifestCommitIntent as unknown as JsonValue)
    );
  } catch {
    return false;
  }
}

/** Selects exactly one create/update targeting the requested Windows-safe path. */
function findPageChange(
  record: AcceptedChangeSetReviewRecord,
  pagePath: string,
  windowsPathKey: string
): Extract<KnowledgeFileChange, { operation: "create" | "update" }> | undefined {
  const matches = record.acceptedChangeSet.changes.filter(
    (change): change is Extract<KnowledgeFileChange, { operation: "create" | "update" }> => {
      if (
        (change.operation !== "create" && change.operation !== "update") ||
        change.path.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters ||
        change.path !== pagePath
      ) {
        return false;
      }
      return toWindowsPathKey(change.path) === windowsPathKey;
    }
  );
  if (matches.length !== 1) return undefined;
  const change = matches[0];
  return createFileContentHash(change.afterContent) === change.afterHash ? change : undefined;
}

/** Converts one validated accepted record into metadata that retains no content. */
function createAcceptedMetadata(
  record: AcceptedChangeSetReviewRecord,
  recordIndex: number,
  bundleId: string,
  pagePath: string,
  windowsPathKey: string
): AcceptedRecordMetadata {
  const change = findPageChange(record, pagePath, windowsPathKey);
  return {
    recordIndex,
    bundleId,
    sourceId: record.jobClaim.sourceId,
    sourceContentHash: record.jobClaim.sourceContentHash,
    pipelineFingerprint: record.jobClaim.pipelineFingerprint,
    inputRevision: record.jobClaim.inputRevision,
    changeSetId: record.changeSetId,
    changeSetDigest: record.acceptedDigest,
    manifestIntentDigest: record.manifestCommitIntentDigest,
    ...(change
      ? {
          page: {
            path: change.path,
            contentHash: change.afterHash,
            characterCount: change.afterContent.length,
          },
        }
      : {}),
  };
}

/** Captures accepted join fields without reading or copying proposal/content bytes. */
function captureAcceptedJoinMetadata(
  value: unknown,
  recordIndex: number,
  bundleId: string
): AcceptedRecordMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const recordKeys = [
    "changeSetId",
    "proposal",
    "proposalDigest",
    "manifestCommitPlan",
    "manifestCommitPlanDigest",
    "jobClaim",
    "recordedAt",
    "outcome",
    "recordRevision",
    "acceptedChangeSet",
    "acceptedDigest",
    "manifestCommitIntent",
    "manifestCommitIntentDigest",
    "acceptedAt",
  ];
  if (!hasExactOwnKeys(value, recordKeys) || readDataProperty(value, "outcome") !== "accepted") {
    return undefined;
  }
  const jobClaim = readDataProperty(value, "jobClaim");
  if (
    !jobClaim ||
    typeof jobClaim !== "object" ||
    !hasExactOwnKeys(jobClaim, [
      "jobId",
      "sourceId",
      "sourceContentHash",
      "pipelineFingerprint",
      "inputRevision",
      "attempt",
    ])
  ) {
    return undefined;
  }
  const sourceId = readDataProperty(jobClaim, "sourceId");
  const sourceContentHash = readDataProperty(jobClaim, "sourceContentHash");
  const pipelineFingerprint = readDataProperty(jobClaim, "pipelineFingerprint");
  const inputRevision = readDataProperty(jobClaim, "inputRevision");
  const changeSetId = readDataProperty(value, "changeSetId");
  const changeSetDigest = readDataProperty(value, "acceptedDigest");
  const manifestIntentDigest = readDataProperty(value, "manifestCommitIntentDigest");
  if (
    typeof sourceId !== "string" ||
    sourceId.length === 0 ||
    sourceId.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    !isDigest(sourceContentHash) ||
    !isDigest(pipelineFingerprint) ||
    !Number.isSafeInteger(inputRevision) ||
    Number(inputRevision) < 0 ||
    typeof changeSetId !== "string" ||
    changeSetId.length === 0 ||
    changeSetId.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    !isDigest(changeSetDigest) ||
    !isDigest(manifestIntentDigest)
  ) {
    return undefined;
  }
  return {
    recordIndex,
    bundleId,
    sourceId,
    sourceContentHash,
    pipelineFingerprint,
    inputRevision: Number(inputRevision),
    changeSetId,
    changeSetDigest,
    manifestIntentDigest,
  };
}

/** Builds a metadata-only accepted index while enforcing Review limits first. */
function indexAcceptedRecords(
  review: unknown,
  bundleId: string,
  pagePath: string,
  windowsPathKey: string,
  budget: SnapshotBudget,
  candidateJoinKeys: ReadonlySet<string>
): AcceptedRecordIndex | null {
  if (!review || typeof review !== "object") return null;
  if (!hasExactOwnKeys(review, ["version", "bundleId", "revision", "records"])) return null;
  const version = readDataProperty(review, "version");
  const reviewBundleId = readDataProperty(review, "bundleId");
  const revision = readDataProperty(review, "revision");
  const records = readDataProperty(review, "records");
  const recordCount = readDenseArrayLength(records);
  if (
    version !== CHANGESET_REVIEW_SNAPSHOT_VERSION ||
    reviewBundleId !== bundleId ||
    typeof reviewBundleId !== "string" ||
    reviewBundleId.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 0 ||
    recordCount === undefined
  ) {
    return null;
  }
  if (recordCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxReviewRecords) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("review_records");
  }

  let acceptedChangeCount = 0;
  const acceptedIndexes: number[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const candidate = readDenseArrayItem(records as readonly unknown[], index);
    if (!candidate || typeof candidate !== "object") continue;
    if (readDataProperty(candidate, "outcome") !== "accepted") continue;
    const changeSet = readDataProperty(candidate, "acceptedChangeSet");
    const changes =
      changeSet && typeof changeSet === "object"
        ? readDataProperty(changeSet, "changes")
        : undefined;
    const changeCount = readDenseArrayLength(changes);
    if (changeCount === undefined) continue;
    acceptedChangeCount += changeCount;
    if (acceptedChangeCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxAcceptedChanges) {
      throw new KnowledgeKnownAppliedWikiOutputLimitError("accepted_changes");
    }
    const metadata = captureAcceptedJoinMetadata(candidate, index, bundleId);
    if (metadata && candidateJoinKeys.has(createJoinKey(metadata))) {
      acceptedIndexes.push(index);
    }
  }

  const byJoinKey = new Map<string, AcceptedRecordMetadata[]>();
  for (const recordIndex of acceptedIndexes) {
    const record = snapshotAcceptedRecord(
      readDenseArrayItem(records as readonly unknown[], recordIndex),
      bundleId,
      Number(revision),
      budget
    );
    if (!record || !acceptedRecordHasExactProjection(record)) continue;
    const metadata = createAcceptedMetadata(
      record,
      recordIndex,
      bundleId,
      pagePath,
      windowsPathKey
    );
    const key = createJoinKey(metadata);
    const matches = byJoinKey.get(key) ?? [];
    matches.push(metadata);
    byJoinKey.set(key, matches);
  }
  return { revision: Number(revision), byJoinKey };
}

/** Re-proves the exact canonical Forward ledger ↔ accepted Review join. */
export function knowledgeForwardApplyLedgerMatchesAcceptedReview(
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>,
  entry: Readonly<KnowledgeForwardRevisionAcceptedReviewEntryV2>
): boolean {
  const decision = entry.decision;
  const request = decision.proposal.request;
  return (
    ledger.runtimeId === request.runtimeId &&
    ledger.bundleId === request.bundleId &&
    ledger.sourceId === request.intent.current.primarySourceId &&
    ledger.pagePath === request.pagePath &&
    ledger.windowsPathKey === toWindowsPathKey(request.pagePath) &&
    ledger.acceptedDecisionDigest === decision.acceptedDecisionDigest &&
    ledger.applyClaimId === decision.applyClaim.claimId &&
    ledger.applyClaimDigest === decision.applyClaimDigest &&
    ledger.proposalId === decision.proposal.proposalId &&
    ledger.proposalDigest === decision.proposalDigest &&
    ledger.originalValidationReceiptDigest === decision.validationReceiptDigest &&
    ledger.effectiveContentHash === decision.acceptedAfterHash &&
    createFileContentHash(decision.afterContent) === ledger.effectiveContentHash &&
    decision.acceptedAt <= ledger.appliedAt
  );
}

/** Builds a bounded strict accepted Forward Review index. */
function indexForwardAcceptedRecords(
  review: unknown,
  bundleId: string,
  budget: SnapshotBudget,
  candidateDecisionDigests: ReadonlySet<string>
): ForwardAcceptedRecordIndex | null {
  if (review === undefined) return null;
  if (!review || typeof review !== "object") return null;
  if (
    !hasExactOwnKeys(review, ["version", "bundleId", "revision", "lastRequestRevision", "records"])
  ) {
    return null;
  }
  const records = readDataProperty(review, "records");
  const recordCount = readDenseArrayLength(records);
  if (recordCount === undefined) return null;
  if (recordCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxForwardReviewRecords) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("forward_review_records");
  }
  const detached = snapshotJsonData(review, budget);
  if (!detached) return null;
  let snapshot: Readonly<KnowledgeForwardRevisionReviewSnapshotV2>;
  try {
    snapshot = snapshotKnowledgeForwardRevisionReviewSnapshotV2(detached);
  } catch {
    return null;
  }
  if (snapshot.bundleId !== bundleId) return null;
  const byAcceptedDecisionDigest = new Map<
    string,
    Readonly<KnowledgeForwardRevisionAcceptedReviewEntryV2>[]
  >();
  for (const entry of snapshot.records) {
    if (
      entry.state !== "accepted" ||
      !candidateDecisionDigests.has(entry.decision.acceptedDecisionDigest)
    ) {
      continue;
    }
    const matches = byAcceptedDecisionDigest.get(entry.decision.acceptedDecisionDigest) ?? [];
    matches.push(entry);
    byAcceptedDecisionDigest.set(entry.decision.acceptedDecisionDigest, matches);
  }
  return { revision: snapshot.revision, byAcceptedDecisionDigest };
}

/** Captures and validates common projection inputs without invoking accessors. */
function captureCommonInput(input: object): {
  runtimeId: string;
  runtimeRevision: number;
  bundleId: string;
  pagePath: string;
  windowsPathKey: string;
  applyCommits: readonly unknown[];
  applyCommitCount: number;
  review: unknown;
  forwardRevisionApplyCommits: readonly unknown[];
  forwardRevisionApplyCommitCount: number;
  forwardRevisionReview: unknown;
} {
  const runtimeId = readDataProperty(input, "runtimeId");
  const runtimeRevision = readDataProperty(input, "runtimeRevision");
  const bundleId = readDataProperty(input, "bundleId");
  const pagePath = readDataProperty(input, "pagePath");
  const applyCommits = readDataProperty(input, "applyCommits");
  const review = readDataProperty(input, "review");
  const rawForwardRevisionApplyCommits = readDataProperty(input, "forwardRevisionApplyCommits");
  const forwardRevisionApplyCommits =
    rawForwardRevisionApplyCommits === undefined ? [] : rawForwardRevisionApplyCommits;
  const forwardRevisionReview = readDataProperty(input, "forwardRevisionReview");
  const applyCommitCount = readDenseArrayLength(applyCommits);
  const forwardRevisionApplyCommitCount = readDenseArrayLength(forwardRevisionApplyCommits);
  const bundleIdWithinLimit =
    typeof bundleId === "string" &&
    bundleId.length <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters;
  const parsedPath =
    typeof pagePath === "string" &&
    pagePath.length <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
      ? parseVaultPath(pagePath)
      : undefined;
  if (
    typeof runtimeId !== "string" ||
    runtimeId.length === 0 ||
    runtimeId.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    !Number.isSafeInteger(runtimeRevision) ||
    Number(runtimeRevision) < 0 ||
    !bundleIdWithinLimit ||
    bundleId.trim().length === 0 ||
    typeof pagePath !== "string" ||
    pagePath.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters ||
    !parsedPath?.ok ||
    parsedPath.path !== pagePath ||
    applyCommitCount === undefined ||
    forwardRevisionApplyCommitCount === undefined
  ) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  if (applyCommitCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxApplyCommits) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("apply_commits");
  }
  if (
    forwardRevisionApplyCommitCount >
    KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxForwardApplyCommits
  ) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("forward_apply_commits");
  }
  return {
    runtimeId,
    runtimeRevision: Number(runtimeRevision),
    bundleId,
    pagePath,
    windowsPathKey: toWindowsPathKey(pagePath),
    applyCommits: applyCommits as readonly unknown[],
    applyCommitCount,
    review,
    forwardRevisionApplyCommits: forwardRevisionApplyCommits as readonly unknown[],
    forwardRevisionApplyCommitCount,
    forwardRevisionReview,
  };
}

/** Requires the exact public index projection input surface. */
function assertIndexInputKeys(input: object): void {
  const required = [
    "runtimeId",
    "runtimeRevision",
    "bundleId",
    "pagePath",
    "applyCommits",
    "manifestRevision",
  ];
  if (
    !hasExactOwnKeys(input, required, [
      "review",
      "forwardRevisionApplyCommits",
      "forwardRevisionReview",
      "currentManifestPage",
    ])
  ) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
}

/** Requires the exact public detail projection input surface. */
function assertDetailInputKeys(input: object): void {
  const required = [
    "runtimeId",
    "runtimeRevision",
    "bundleId",
    "pagePath",
    "applyCommits",
    "authority",
  ];
  if (
    !hasExactOwnKeys(input, required, [
      "review",
      "forwardRevisionApplyCommits",
      "forwardRevisionReview",
    ])
  ) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
}

/** Returns the true durable Apply time for one verified proof. */
function getProofAppliedAt(proof: KnownAppliedOutputProof): number {
  return proof.origin === "source_apply" ? proof.ledger.recordedAt : proof.ledger.appliedAt;
}

/** Returns the committed Manifest revision for one verified proof. */
function getProofManifestRevision(proof: KnownAppliedOutputProof): number {
  return proof.ledger.manifestAfterRevision;
}

/** Returns the exact transaction identity for one verified proof. */
function getProofTransactionId(proof: KnownAppliedOutputProof): string {
  return proof.ledger.transactionId;
}

/** Orders verified Apply proofs by commit time and stable identity. */
function compareProofs(left: KnownAppliedOutputProof, right: KnownAppliedOutputProof): number {
  return (
    getProofAppliedAt(right) - getProofAppliedAt(left) ||
    getProofManifestRevision(right) - getProofManifestRevision(left) ||
    (getProofTransactionId(left) < getProofTransactionId(right)
      ? -1
      : getProofTransactionId(left) > getProofTransactionId(right)
        ? 1
        : left.origin < right.origin
          ? -1
          : left.origin > right.origin
            ? 1
            : 0)
  );
}

/** Creates one deeply frozen private detail authority. */
function freezeAuthority(
  common: ReturnType<typeof captureCommonInput>,
  output: OutputAccumulator,
  newest: KnownAppliedOutputProof
): Readonly<KnowledgeKnownAppliedWikiOutputAuthorityIdentity> {
  const commonAuthority = {
    runtimeId: common.runtimeId,
    bundleId: common.bundleId,
    pagePath: common.pagePath,
    windowsPathKey: common.windowsPathKey,
    outputPath: output.path,
    contentHash: output.contentHash,
    characterCount: output.characterCount,
    transactionId: newest.ledger.transactionId,
    sourceId: newest.ledger.sourceId,
    manifestAfterRevision: newest.ledger.manifestAfterRevision,
    manifestAfterDigest: newest.ledger.manifestAfterDigest,
    appliedAt: getProofAppliedAt(newest),
  };
  if (newest.origin === "source_apply") {
    return Object.freeze({
      ...commonAuthority,
      origin: "source_apply" as const,
      sourceContentHash: newest.ledger.sourceContentHash,
      pipelineFingerprint: newest.ledger.pipelineFingerprint,
      inputRevision: newest.ledger.inputRevision,
      changeSetId: newest.ledger.changeSetId,
      changeSetDigest: newest.ledger.changeSetDigest,
      manifestIntentDigest: newest.ledger.manifestIntentDigest,
    });
  }
  const freshness = newest.ledger.sourceBase.currentSourceFreshness;
  return Object.freeze({
    ...commonAuthority,
    origin: "forward_revision" as const,
    sourceContentHash: freshness.sourceContentHash,
    pipelineFingerprint: freshness.pipelineFingerprint,
    inputRevision: freshness.inputRevision,
    ledgerId: newest.ledger.ledgerId,
    ledgerDigest: newest.ledger.ledgerDigest,
    forwardLedgerIdentityDigest: newest.ledger.forwardLedgerIdentityDigest,
    acceptedDecisionDigest: newest.ledger.acceptedDecisionDigest,
    applyClaimId: newest.ledger.applyClaimId,
    applyClaimDigest: newest.ledger.applyClaimDigest,
    proposalId: newest.ledger.proposalId,
    proposalDigest: newest.ledger.proposalDigest,
    manualOverride: newest.accepted.decision.manualOverride,
  });
}

/** Creates canonical per-origin summaries without discarding mixed provenance. */
function freezeOriginSummaries(
  proofs: readonly KnownAppliedOutputProof[]
): readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[] {
  const kinds = ["source_apply", "forward_revision"] as const;
  const summaries = kinds.flatMap((kind) => {
    const matching = proofs.filter((proof) => proof.origin === kind).sort(compareProofs);
    const newest = matching[0];
    return newest
      ? [
          Object.freeze({
            kind,
            verifiedApplyCount: matching.length,
            newestAppliedAt: getProofAppliedAt(newest),
            newestManifestRevision: getProofManifestRevision(newest),
          }),
        ]
      : [];
  });
  return Object.freeze(summaries);
}

/** Creates one deeply frozen metadata-only index item. */
function freezeIndexItem(
  common: ReturnType<typeof captureCommonInput>,
  output: OutputAccumulator
): Readonly<KnowledgeKnownAppliedWikiOutputIndexItem> {
  const proofs = output.proofs.sort(compareProofs);
  const newest = proofs[0];
  if (!newest) throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  return Object.freeze({
    path: output.path,
    windowsPathKey: common.windowsPathKey,
    contentHash: output.contentHash,
    characterCount: output.characterCount,
    detailAvailability:
      output.characterCount <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters
        ? "available"
        : "too_large",
    newestAppliedAt: getProofAppliedAt(newest),
    newestManifestRevision: getProofManifestRevision(newest),
    verifiedApplyCount: proofs.length,
    origins: freezeOriginSummaries(proofs),
    authority: freezeAuthority(common, output, newest),
  });
}

/** Orders metadata by newest exact Apply commit. */
function compareIndexItems(
  left: KnowledgeKnownAppliedWikiOutputIndexItem,
  right: KnowledgeKnownAppliedWikiOutputIndexItem
): number {
  return (
    right.newestAppliedAt - left.newestAppliedAt ||
    right.newestManifestRevision - left.newestManifestRevision ||
    (left.contentHash < right.contentHash ? -1 : left.contentHash > right.contentHash ? 1 : 0)
  );
}

/** Captures the optional current Manifest page without retaining source evidence. */
function captureCurrentManifestPage(
  value: unknown,
  expectedPagePath: string,
  expectedWindowsPathKey: string
): Readonly<KnowledgeKnownAppliedWikiCurrentPage> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  if (!hasExactOwnKeys(value, ["path", "windowsPathKey", "ownership", "contentHash"])) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  const path = readDataProperty(value, "path");
  const windowsPathKey = readDataProperty(value, "windowsPathKey");
  const ownership = readDataProperty(value, "ownership");
  const contentHash = readDataProperty(value, "contentHash");
  const parsed =
    typeof path === "string" &&
    path.length <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
      ? parseVaultPath(path)
      : undefined;
  if (
    !parsed?.ok ||
    parsed.path !== path ||
    path !== expectedPagePath ||
    windowsPathKey !== expectedWindowsPathKey ||
    toWindowsPathKey(path) !== windowsPathKey ||
    (ownership !== "generated" && ownership !== "shared" && ownership !== "user") ||
    !isDigest(contentHash)
  ) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  return Object.freeze({ path, windowsPathKey, ownership, contentHash });
}

/** Adds one verified proof while preserving every distinct Apply provenance. */
function addVerifiedOutputProof(
  outputs: Map<string, OutputAccumulator>,
  page: AcceptedPageMetadata,
  proof: KnownAppliedOutputProof
): void {
  const existing = outputs.get(page.contentHash);
  if (existing && existing.characterCount !== page.characterCount) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  if (existing) {
    if (
      !existing.proofs.some(
        (candidate) =>
          candidate.origin === proof.origin &&
          getProofTransactionId(candidate) === getProofTransactionId(proof)
      )
    ) {
      const currentNewest = [...existing.proofs].sort(compareProofs)[0];
      if (currentNewest && compareProofs(proof, currentNewest) < 0) {
        existing.path = page.path;
      }
      existing.proofs.push(proof);
    }
    return;
  }
  outputs.set(page.contentHash, {
    path: page.path,
    contentHash: page.contentHash,
    characterCount: page.characterCount,
    proofs: [proof],
  });
  if (outputs.size > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPageOutputs) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("page_outputs");
  }
}

/**
 * Projects a metadata-only index of exact known applied page outputs.
 *
 * Ordinary candidates require one unique source Apply-ledger ↔ accepted-Review
 * join. Forward candidates require one canonical forward ledger ↔ accepted
 * Forward Review join. Both paths re-prove the selected body hash before the
 * body is discarded. Pending, rejected, uncommitted, ambiguous, or tampered
 * records contribute nothing.
 */
export function projectKnowledgeKnownAppliedWikiOutputIndex(
  input: KnowledgeKnownAppliedWikiOutputIndexProjectionInput
): KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot {
  if (!input || typeof input !== "object") {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  assertIndexInputKeys(input);
  const common = captureCommonInput(input);
  const ledgers: KnowledgeApplyCommitLedgerRecord[] = [];
  const ledgerJoinCounts = new Map<string, number>();
  for (let index = 0; index < common.applyCommitCount; index += 1) {
    const ledger = snapshotLedgerRecord(readDenseArrayItem(common.applyCommits, index));
    if (!ledger || ledger.bundleId !== common.bundleId) continue;
    const joinKey = createJoinKey(ledger);
    ledgers.push(ledger);
    ledgerJoinCounts.set(joinKey, (ledgerJoinCounts.get(joinKey) ?? 0) + 1);
  }
  const budget: SnapshotBudget = { nodes: 0, characters: 0 };
  const accepted = indexAcceptedRecords(
    common.review,
    common.bundleId,
    common.pagePath,
    common.windowsPathKey,
    budget,
    new Set(ledgerJoinCounts.keys())
  );
  const outputs = new Map<string, OutputAccumulator>();
  if (accepted) {
    for (const ledger of ledgers) {
      const joinKey = createJoinKey(ledger);
      const records = accepted.byJoinKey.get(joinKey) ?? [];
      if (
        (ledgerJoinCounts.get(joinKey) !== 1 || records.length > 1) &&
        records.some((record) => record.page !== undefined)
      ) {
        throw new KnowledgeKnownAppliedWikiOutputProjectionError();
      }
      if (records.length !== 1 || !records[0].page) continue;
      const page = records[0].page;
      addVerifiedOutputProof(outputs, page, { origin: "source_apply", ledger });
    }
  }

  const forwardLedgers: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[] = [];
  const forwardLedgerDecisionCounts = new Map<string, number>();
  for (let index = 0; index < common.forwardRevisionApplyCommitCount; index += 1) {
    let ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>;
    try {
      ledger = snapshotKnowledgeForwardRevisionApplyLedgerRecord(
        readDenseArrayItem(common.forwardRevisionApplyCommits, index)
      );
    } catch {
      continue;
    }
    if (
      ledger.runtimeId !== common.runtimeId ||
      ledger.bundleId !== common.bundleId ||
      ledger.pagePath !== common.pagePath ||
      ledger.windowsPathKey !== common.windowsPathKey
    ) {
      continue;
    }
    forwardLedgers.push(ledger);
    forwardLedgerDecisionCounts.set(
      ledger.acceptedDecisionDigest,
      (forwardLedgerDecisionCounts.get(ledger.acceptedDecisionDigest) ?? 0) + 1
    );
  }
  const forwardAccepted = indexForwardAcceptedRecords(
    common.forwardRevisionReview,
    common.bundleId,
    budget,
    new Set(forwardLedgerDecisionCounts.keys())
  );
  if (forwardAccepted) {
    for (const ledger of forwardLedgers) {
      const records =
        forwardAccepted.byAcceptedDecisionDigest.get(ledger.acceptedDecisionDigest) ?? [];
      if (forwardLedgerDecisionCounts.get(ledger.acceptedDecisionDigest) !== 1) {
        if (records.length > 0) throw new KnowledgeKnownAppliedWikiOutputProjectionError();
        continue;
      }
      if (records.length > 1) throw new KnowledgeKnownAppliedWikiOutputProjectionError();
      const record = records[0];
      if (!record || !knowledgeForwardApplyLedgerMatchesAcceptedReview(ledger, record)) continue;
      const page: AcceptedPageMetadata = {
        path: ledger.pagePath,
        contentHash: ledger.effectiveContentHash,
        characterCount: record.decision.afterContent.length,
      };
      addVerifiedOutputProof(outputs, page, {
        origin: "forward_revision",
        ledger,
        accepted: record,
      });
    }
  }

  const manifestRevision = readDataProperty(input, "manifestRevision");
  if (!Number.isSafeInteger(manifestRevision) || Number(manifestRevision) < 0) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  const currentManifestPage = captureCurrentManifestPage(
    readDataProperty(input, "currentManifestPage"),
    common.pagePath,
    common.windowsPathKey
  );
  const projected = [...outputs.values()].map((output) => freezeIndexItem(common, output));
  projected.sort(compareIndexItems);
  return Object.freeze({
    runtimeId: common.runtimeId,
    runtimeRevision: common.runtimeRevision,
    bundleId: common.bundleId,
    pagePath: common.pagePath,
    windowsPathKey: common.windowsPathKey,
    reviewRevision: accepted?.revision ?? null,
    forwardReviewRevision: forwardAccepted?.revision ?? null,
    manifestRevision: Number(manifestRevision),
    currentManifestPage,
    outputs: Object.freeze(projected),
  });
}

/** Captures a private authority through data descriptors only. */
function captureAuthority(
  value: unknown
): KnowledgeKnownAppliedWikiOutputAuthorityIdentity | undefined {
  const snapshot = snapshotJsonData(value, { nodes: 0, characters: 0 });
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return undefined;
  const candidate = snapshot as unknown as KnowledgeKnownAppliedWikiOutputAuthorityIdentity;
  const commonAuthorityKeys = [
    "origin",
    "runtimeId",
    "bundleId",
    "pagePath",
    "windowsPathKey",
    "outputPath",
    "contentHash",
    "characterCount",
    "transactionId",
    "sourceId",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
    "manifestAfterRevision",
    "manifestAfterDigest",
    "appliedAt",
  ];
  const sourceAuthorityKeys = [
    ...commonAuthorityKeys,
    "changeSetId",
    "changeSetDigest",
    "manifestIntentDigest",
  ];
  const forwardAuthorityKeys = [
    ...commonAuthorityKeys,
    "ledgerId",
    "ledgerDigest",
    "forwardLedgerIdentityDigest",
    "acceptedDecisionDigest",
    "applyClaimId",
    "applyClaimDigest",
    "proposalId",
    "proposalDigest",
    "manualOverride",
  ];
  if (
    (candidate.origin === "source_apply" && !hasExactOwnKeys(snapshot, sourceAuthorityKeys)) ||
    (candidate.origin === "forward_revision" && !hasExactOwnKeys(snapshot, forwardAuthorityKeys)) ||
    (candidate.origin !== "source_apply" && candidate.origin !== "forward_revision")
  ) {
    return undefined;
  }
  const parsedPagePath =
    typeof candidate.pagePath === "string" &&
    candidate.pagePath.length <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
      ? parseVaultPath(candidate.pagePath)
      : undefined;
  const parsedOutputPath =
    typeof candidate.outputPath === "string" &&
    candidate.outputPath.length <= KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
      ? parseVaultPath(candidate.outputPath)
      : undefined;
  if (
    typeof candidate.runtimeId !== "string" ||
    candidate.runtimeId.length === 0 ||
    candidate.runtimeId.length >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    typeof candidate.bundleId !== "string" ||
    candidate.bundleId.trim().length === 0 ||
    candidate.bundleId.length >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    typeof candidate.pagePath !== "string" ||
    candidate.pagePath.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters ||
    typeof candidate.outputPath !== "string" ||
    candidate.outputPath.length >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters ||
    !parsedPagePath?.ok ||
    parsedPagePath.path !== candidate.pagePath ||
    !parsedOutputPath?.ok ||
    parsedOutputPath.path !== candidate.outputPath ||
    candidate.windowsPathKey !== toWindowsPathKey(candidate.pagePath) ||
    toWindowsPathKey(candidate.outputPath) !== candidate.windowsPathKey ||
    !isDigest(candidate.contentHash) ||
    !Number.isSafeInteger(candidate.characterCount) ||
    candidate.characterCount < 0 ||
    typeof candidate.transactionId !== "string" ||
    candidate.transactionId.trim().length === 0 ||
    candidate.transactionId.length >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    typeof candidate.sourceId !== "string" ||
    candidate.sourceId.trim().length === 0 ||
    candidate.sourceId.length >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
    !isDigest(candidate.sourceContentHash) ||
    !isDigest(candidate.pipelineFingerprint) ||
    !Number.isSafeInteger(candidate.inputRevision) ||
    candidate.inputRevision < 0 ||
    !Number.isSafeInteger(candidate.manifestAfterRevision) ||
    candidate.manifestAfterRevision <= 0 ||
    !isDigest(candidate.manifestAfterDigest) ||
    !Number.isSafeInteger(candidate.appliedAt) ||
    candidate.appliedAt < 0
  ) {
    return undefined;
  }
  if (candidate.origin === "forward_revision") {
    if (
      typeof candidate.ledgerId !== "string" ||
      !/^forward-revision-apply-ledger-[a-f0-9]{64}$/.test(candidate.ledgerId) ||
      !isDigest(candidate.ledgerDigest) ||
      !isDigest(candidate.forwardLedgerIdentityDigest) ||
      !isDigest(candidate.acceptedDecisionDigest) ||
      typeof candidate.applyClaimId !== "string" ||
      candidate.applyClaimId.length === 0 ||
      candidate.applyClaimId.length >
        KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
      !isDigest(candidate.applyClaimDigest) ||
      typeof candidate.proposalId !== "string" ||
      candidate.proposalId.length === 0 ||
      candidate.proposalId.length >
        KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxIdentifierCharacters ||
      !isDigest(candidate.proposalDigest) ||
      typeof candidate.manualOverride !== "boolean"
    ) {
      return undefined;
    }
    return Object.freeze({ ...candidate });
  }
  const ledger = snapshotLedgerRecord({
    transactionId: candidate.transactionId,
    commitRevision: 0,
    bundleId: candidate.bundleId,
    sourceId: candidate.sourceId,
    sourceContentHash: candidate.sourceContentHash,
    pipelineFingerprint: candidate.pipelineFingerprint,
    inputRevision: candidate.inputRevision,
    changeSetId: candidate.changeSetId,
    changeSetDigest: candidate.changeSetDigest,
    manifestIntentDigest: candidate.manifestIntentDigest,
    journalDigest: "0".repeat(64),
    receiptDigest: "0".repeat(64),
    manifestBeforeRevision: candidate.manifestAfterRevision - 1,
    manifestBeforeDigest: "0".repeat(64),
    manifestAfterRevision: candidate.manifestAfterRevision,
    manifestAfterDigest: candidate.manifestAfterDigest,
    recordedAt: candidate.appliedAt,
  });
  return ledger ? Object.freeze({ ...candidate }) : undefined;
}

/** Reports whether one source ledger is the exact private authority selected by the index. */
function sourceLedgerMatchesAuthority(
  ledger: KnowledgeApplyCommitLedgerRecord,
  authority: KnowledgeKnownAppliedWikiSourceApplyAuthorityIdentity
): boolean {
  return (
    ledger.transactionId === authority.transactionId &&
    ledger.bundleId === authority.bundleId &&
    ledger.sourceId === authority.sourceId &&
    ledger.sourceContentHash === authority.sourceContentHash &&
    ledger.pipelineFingerprint === authority.pipelineFingerprint &&
    ledger.inputRevision === authority.inputRevision &&
    ledger.changeSetId === authority.changeSetId &&
    ledger.changeSetDigest === authority.changeSetDigest &&
    ledger.manifestIntentDigest === authority.manifestIntentDigest &&
    ledger.manifestAfterRevision === authority.manifestAfterRevision &&
    ledger.manifestAfterDigest === authority.manifestAfterDigest &&
    ledger.recordedAt === authority.appliedAt
  );
}

/** Reports whether one Forward ledger is the exact private authority selected by the index. */
function forwardLedgerMatchesAuthority(
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>,
  authority: KnowledgeKnownAppliedWikiForwardRevisionAuthorityIdentity
): boolean {
  const freshness = ledger.sourceBase.currentSourceFreshness;
  return (
    ledger.runtimeId === authority.runtimeId &&
    ledger.transactionId === authority.transactionId &&
    ledger.bundleId === authority.bundleId &&
    ledger.sourceId === authority.sourceId &&
    ledger.pagePath === authority.outputPath &&
    ledger.windowsPathKey === authority.windowsPathKey &&
    ledger.effectiveContentHash === authority.contentHash &&
    freshness.sourceContentHash === authority.sourceContentHash &&
    freshness.pipelineFingerprint === authority.pipelineFingerprint &&
    freshness.inputRevision === authority.inputRevision &&
    ledger.manifestAfterRevision === authority.manifestAfterRevision &&
    ledger.manifestAfterDigest === authority.manifestAfterDigest &&
    ledger.appliedAt === authority.appliedAt &&
    ledger.ledgerId === authority.ledgerId &&
    ledger.ledgerDigest === authority.ledgerDigest &&
    ledger.forwardLedgerIdentityDigest === authority.forwardLedgerIdentityDigest &&
    ledger.acceptedDecisionDigest === authority.acceptedDecisionDigest &&
    ledger.applyClaimId === authority.applyClaimId &&
    ledger.applyClaimDigest === authority.applyClaimDigest &&
    ledger.proposalId === authority.proposalId &&
    ledger.proposalDigest === authority.proposalDigest
  );
}

/** Creates a deeply frozen stale detail response. */
function freezeStaleDetail(
  runtimeId: string,
  runtimeRevision: number
): KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot {
  return Object.freeze({ kind: "stale" as const, runtimeId, runtimeRevision });
}

/** Rejoins one exact Forward authority to its canonical ledger and accepted body. */
function projectForwardRevisionOutputDetail(
  common: ReturnType<typeof captureCommonInput>,
  authority: KnowledgeKnownAppliedWikiForwardRevisionAuthorityIdentity
): KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot {
  let selectedLedger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord> | undefined;
  let selectedDecisionJoinCount = 0;
  for (let index = 0; index < common.forwardRevisionApplyCommitCount; index += 1) {
    let ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>;
    try {
      ledger = snapshotKnowledgeForwardRevisionApplyLedgerRecord(
        readDenseArrayItem(common.forwardRevisionApplyCommits, index)
      );
    } catch {
      continue;
    }
    if (
      ledger.bundleId === common.bundleId &&
      ledger.acceptedDecisionDigest === authority.acceptedDecisionDigest
    ) {
      selectedDecisionJoinCount += 1;
    }
    if (forwardLedgerMatchesAuthority(ledger, authority)) {
      if (selectedLedger) throw new KnowledgeKnownAppliedWikiOutputProjectionError();
      selectedLedger = ledger;
    }
  }
  if (!selectedLedger) return freezeStaleDetail(common.runtimeId, common.runtimeRevision);

  const budget: SnapshotBudget = { nodes: 0, characters: 0 };
  const accepted = indexForwardAcceptedRecords(
    common.forwardRevisionReview,
    common.bundleId,
    budget,
    new Set([selectedLedger.acceptedDecisionDigest])
  );
  const matches =
    accepted?.byAcceptedDecisionDigest.get(selectedLedger.acceptedDecisionDigest) ?? [];
  if ((selectedDecisionJoinCount !== 1 || matches.length > 1) && matches.length > 0) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  const entry = matches[0];
  if (
    matches.length !== 1 ||
    !entry ||
    !knowledgeForwardApplyLedgerMatchesAcceptedReview(selectedLedger, entry) ||
    entry.decision.manualOverride !== authority.manualOverride ||
    entry.decision.afterContent.length !== authority.characterCount ||
    entry.decision.acceptedAfterHash !== authority.contentHash ||
    selectedLedger.pagePath !== authority.outputPath
  ) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }
  if (
    entry.decision.afterContent.length >
    KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters
  ) {
    return Object.freeze({
      kind: "too_large" as const,
      runtimeId: common.runtimeId,
      runtimeRevision: common.runtimeRevision,
      contentHash: entry.decision.acceptedAfterHash,
      characterCount: entry.decision.afterContent.length,
    });
  }
  return Object.freeze({
    kind: "available" as const,
    runtimeId: common.runtimeId,
    runtimeRevision: common.runtimeRevision,
    contentHash: entry.decision.acceptedAfterHash,
    content: entry.decision.afterContent,
    characterCount: entry.decision.afterContent.length,
  });
}

/**
 * Rejoins one private index identity and returns at most one bounded body.
 *
 * No other accepted output body survives this projection. Runtime replacement,
 * missing/torn identity, a non-unique Review join, changed bytes, or a different
 * page target returns `stale`; an exact body above 2 Mi characters returns only
 * 2,000,000 characters returns only `too_large` metadata.
 */
export function projectKnowledgeKnownAppliedWikiOutputDetail(
  input: KnowledgeKnownAppliedWikiOutputDetailProjectionInput
): KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot {
  if (!input || typeof input !== "object") {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  assertDetailInputKeys(input);
  const common = captureCommonInput(input);
  const authority = captureAuthority(readDataProperty(input, "authority"));
  if (
    !authority ||
    authority.runtimeId !== common.runtimeId ||
    authority.bundleId !== common.bundleId ||
    authority.pagePath !== common.pagePath ||
    authority.windowsPathKey !== common.windowsPathKey
  ) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }
  if (authority.origin === "forward_revision") {
    return projectForwardRevisionOutputDetail(common, authority);
  }

  let selectedLedger: KnowledgeApplyCommitLedgerRecord | undefined;
  let selectedJoinCount = 0;
  for (let index = 0; index < common.applyCommitCount; index += 1) {
    const ledger = snapshotLedgerRecord(readDenseArrayItem(common.applyCommits, index));
    if (!ledger || ledger.bundleId !== common.bundleId) continue;
    if (createJoinKey(ledger) === createJoinKey(authority)) selectedJoinCount += 1;
    if (sourceLedgerMatchesAuthority(ledger, authority)) {
      if (selectedLedger) throw new KnowledgeKnownAppliedWikiOutputProjectionError();
      selectedLedger = ledger;
    }
  }
  if (!selectedLedger) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }

  const budget: SnapshotBudget = { nodes: 0, characters: 0 };
  const accepted = indexAcceptedRecords(
    common.review,
    common.bundleId,
    common.pagePath,
    common.windowsPathKey,
    budget,
    new Set([createJoinKey(selectedLedger)])
  );
  const metadataMatches = accepted?.byJoinKey.get(createJoinKey(selectedLedger)) ?? [];
  if (
    (selectedJoinCount !== 1 || metadataMatches.length > 1) &&
    metadataMatches.some((record) => record.page !== undefined)
  ) {
    throw new KnowledgeKnownAppliedWikiOutputProjectionError();
  }
  if (metadataMatches.length !== 1 || !metadataMatches[0].page) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }
  const metadata = metadataMatches[0];
  const page = metadata.page;
  if (
    !page ||
    page.path !== authority.outputPath ||
    page.contentHash !== authority.contentHash ||
    page.characterCount !== authority.characterCount
  ) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }

  const review = common.review;
  const records = review && typeof review === "object" ? readDataProperty(review, "records") : null;
  const record = snapshotAcceptedRecord(
    Array.isArray(records) ? readDenseArrayItem(records, metadata.recordIndex) : undefined,
    common.bundleId,
    accepted?.revision ?? 0,
    budget
  );
  if (
    !record ||
    !acceptedRecordHasExactProjection(record) ||
    !knowledgeApplyLedgerMatchesAcceptedRecord(selectedLedger, common.bundleId, record)
  ) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }
  const change = findPageChange(record, common.pagePath, common.windowsPathKey);
  if (
    !change ||
    change.path !== authority.outputPath ||
    change.afterHash !== authority.contentHash ||
    change.afterContent.length !== authority.characterCount
  ) {
    return freezeStaleDetail(common.runtimeId, common.runtimeRevision);
  }
  if (
    change.afterContent.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters
  ) {
    return Object.freeze({
      kind: "too_large" as const,
      runtimeId: common.runtimeId,
      runtimeRevision: common.runtimeRevision,
      contentHash: change.afterHash,
      characterCount: change.afterContent.length,
    });
  }
  return Object.freeze({
    kind: "available" as const,
    runtimeId: common.runtimeId,
    runtimeRevision: common.runtimeRevision,
    contentHash: change.afterHash,
    content: change.afterContent,
    characterCount: change.afterContent.length,
  });
}
