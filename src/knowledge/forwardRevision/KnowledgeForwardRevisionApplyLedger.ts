import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionCommittedApplyJournalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
  isForwardApplyPositiveInteger,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  createKnowledgeForwardRevisionSourceBaseDigest,
  snapshotKnowledgeForwardRevisionSourceBase,
  type KnowledgeForwardRevisionSourceBaseV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current dedicated forward-Apply ledger record version. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION = 2 as const;

/** Legacy content-free success record accepted only by the explicit migration helper. */
export interface KnowledgeForwardRevisionApplyLedgerRecordV1 {
  readonly version: 1;
  readonly kind: "forward_revision_apply_ledger_record";
  readonly ledgerId: string;
  readonly transactionId: string;
  readonly committedJournalDigest: string;
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly originalValidationReceiptDigest: string;
  readonly revalidationReceiptDigest: string;
  readonly sourceBaseDigest: string;
  readonly baseContentHash: string;
  readonly effectiveContentHash: string;
  readonly manifestBeforeRevision: number;
  readonly manifestBeforeDigest: string;
  readonly forwardLedgerIdentityDigest: string;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
  readonly ledgerDigest: string;
}

/** Content-free exact success record for one finalized forward update. */
export interface KnowledgeForwardRevisionApplyLedgerRecordV2 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION;
  readonly kind: "forward_revision_apply_ledger_record";
  readonly ledgerId: string;
  readonly transactionId: string;
  readonly committedJournalDigest: string;
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly originalValidationReceiptDigest: string;
  readonly revalidationReceiptDigest: string;
  /** Body-free immutable source-base snapshot retained for future lineage proof. */
  readonly sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>;
  readonly sourceBaseDigest: string;
  readonly sourceAppliedContentHash: string;
  readonly previousEffectiveContentHash: string;
  readonly effectiveContentHash: string;
  readonly manifestBeforeRevision: number;
  readonly manifestBeforeDigest: string;
  readonly forwardLedgerIdentityDigest: string;
  /** Legacy v1 overlay identity retained only across cold migration. */
  readonly legacyForwardLedgerIdentityDigest: string | null;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
  readonly ledgerDigest: string;
}

/** Version-neutral canonical ledger record returned by every strict reader. */
export type KnowledgeForwardRevisionApplyLedgerRecord = KnowledgeForwardRevisionApplyLedgerRecordV2;

/** Exact finalize fields supplied only after the Manifest overlay is projected. */
export interface CreateKnowledgeForwardRevisionApplyLedgerRecordInput {
  readonly committedJournal: unknown;
  readonly sourceBase: unknown;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
}

/** Exact outer-migration facts needed to enrich a legacy ledger without rewriting its Manifest. */
export interface MigrateKnowledgeForwardRevisionApplyLedgerRecordV1Input {
  readonly sourceBase: unknown;
  readonly manifestAfterDigest: string;
}

const RECORD_V1_KEYS = [
  "version",
  "kind",
  "ledgerId",
  "transactionId",
  "committedJournalDigest",
  "runtimeId",
  "bundleId",
  "sourceId",
  "pagePath",
  "windowsPathKey",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "proposalId",
  "proposalDigest",
  "originalValidationReceiptDigest",
  "revalidationReceiptDigest",
  "sourceBaseDigest",
  "baseContentHash",
  "effectiveContentHash",
  "manifestBeforeRevision",
  "manifestBeforeDigest",
  "forwardLedgerIdentityDigest",
  "manifestAfterRevision",
  "manifestAfterDigest",
  "appliedAt",
  "ledgerDigest",
] as const;
const RECORD_V2_KEYS = [
  "version",
  "kind",
  "ledgerId",
  "transactionId",
  "committedJournalDigest",
  "runtimeId",
  "bundleId",
  "sourceId",
  "pagePath",
  "windowsPathKey",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "proposalId",
  "proposalDigest",
  "originalValidationReceiptDigest",
  "revalidationReceiptDigest",
  "sourceBase",
  "sourceBaseDigest",
  "sourceAppliedContentHash",
  "previousEffectiveContentHash",
  "effectiveContentHash",
  "manifestBeforeRevision",
  "manifestBeforeDigest",
  "forwardLedgerIdentityDigest",
  "legacyForwardLedgerIdentityDigest",
  "manifestAfterRevision",
  "manifestAfterDigest",
  "appliedAt",
  "ledgerDigest",
] as const;
const CREATE_KEYS = [
  "committedJournal",
  "sourceBase",
  "manifestAfterRevision",
  "manifestAfterDigest",
  "appliedAt",
] as const;
const MIGRATE_V1_KEYS = ["sourceBase", "manifestAfterDigest"] as const;
const LEDGER_ID_PATTERN = /^forward-revision-apply-ledger-[a-f0-9]{64}$/;
const MAX_OUTER_RUNTIME_BYTES = 64 * 1024 * 1024;

/** Fixed value-free error for malformed forward-Apply ledger material. */
export class KnowledgeForwardRevisionApplyLedgerValidationError extends TypeError {
  /** Creates one sanitized error; only this module can mark it authentic. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision Apply ledger does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionApplyLedgerValidationError";
    if (authenticityToken === ERROR_TOKEN) authenticErrors.add(this);
  }
}

const ERROR_TOKEN = Symbol("KnowledgeForwardRevisionApplyLedgerValidationError");
const authenticErrors = new WeakSet<KnowledgeForwardRevisionApplyLedgerValidationError>();

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionApplyLedgerValidationError(ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local failure. */
function isAuthenticError(
  value: unknown
): value is KnowledgeForwardRevisionApplyLedgerValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticErrors.has(value as KnowledgeForwardRevisionApplyLedgerValidationError)
  );
}

/** Hashes one strict value with an explicit domain separator. */
function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/** Reports whether one body-free source base fits the enclosing Runtime cap. */
function isSourceBaseWithinOuterLimit(
  sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>
): boolean {
  try {
    return (
      new TextEncoder().encode(canonicalizeJson(sourceBase as unknown as JsonValue)).byteLength <=
      MAX_OUTER_RUNTIME_BYTES
    );
  } catch {
    return false;
  }
}

/** Captures one canonical Vault page path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1_024) return undefined;
  try {
    const parsed = parseVaultPath(value);
    return parsed.ok && parsed.path === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the acyclic identity payload projected into the Manifest overlay. */
function createIdentityPayload(
  journal: Readonly<KnowledgeForwardRevisionCommittedApplyJournalV1>,
  sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>
): JsonValue {
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION,
    kind: "forward_revision_apply_ledger_identity",
    transactionId: journal.transactionId,
    committedJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(journal),
    runtimeId: journal.runtimeId,
    bundleId: journal.bundleId,
    sourceId: journal.sourceId,
    pagePath: journal.pagePath,
    windowsPathKey: journal.windowsPathKey,
    acceptedDecisionDigest: journal.acceptedDecisionDigest,
    applyClaimId: journal.applyClaimId,
    applyClaimDigest: journal.applyClaimDigest,
    proposalId: journal.proposalId,
    proposalDigest: journal.proposalDigest,
    originalValidationReceiptDigest: journal.originalValidationReceiptDigest,
    revalidationReceiptDigest: journal.revalidationReceiptDigest,
    sourceBaseDigest: createKnowledgeForwardRevisionSourceBaseDigest(sourceBase),
    sourceAppliedContentHash: journal.sourceAppliedContentHash,
    previousEffectiveContentHash: journal.previousEffectiveContentHash,
    effectiveContentHash: journal.afterHash,
    manifestBeforeRevision: journal.manifestBeforeRevision,
    manifestBeforeDigest: journal.manifestBeforeDigest,
    legacyForwardLedgerIdentityDigest: null,
    appliedAt: journal.committedAt,
  });
}

/** Reconstructs the acyclic identity payload from a standalone ledger record. */
function createIdentityPayloadFromRecord(
  record: Omit<KnowledgeForwardRevisionApplyLedgerRecordV2, "ledgerId" | "ledgerDigest">
): JsonValue {
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION,
    kind: "forward_revision_apply_ledger_identity",
    transactionId: record.transactionId,
    committedJournalDigest: record.committedJournalDigest,
    runtimeId: record.runtimeId,
    bundleId: record.bundleId,
    sourceId: record.sourceId,
    pagePath: record.pagePath,
    windowsPathKey: record.windowsPathKey,
    acceptedDecisionDigest: record.acceptedDecisionDigest,
    applyClaimId: record.applyClaimId,
    applyClaimDigest: record.applyClaimDigest,
    proposalId: record.proposalId,
    proposalDigest: record.proposalDigest,
    originalValidationReceiptDigest: record.originalValidationReceiptDigest,
    revalidationReceiptDigest: record.revalidationReceiptDigest,
    sourceBaseDigest: record.sourceBaseDigest,
    sourceAppliedContentHash: record.sourceAppliedContentHash,
    previousEffectiveContentHash: record.previousEffectiveContentHash,
    effectiveContentHash: record.effectiveContentHash,
    manifestBeforeRevision: record.manifestBeforeRevision,
    manifestBeforeDigest: record.manifestBeforeDigest,
    legacyForwardLedgerIdentityDigest: record.legacyForwardLedgerIdentityDigest,
    appliedAt: record.appliedAt,
  });
}

/** Reconstructs the original v1 identity payload for migration validation. */
function createLegacyIdentityPayloadFromRecord(
  record: Omit<KnowledgeForwardRevisionApplyLedgerRecordV1, "ledgerId" | "ledgerDigest">
): JsonValue {
  return Object.freeze({
    version: 1,
    kind: "forward_revision_apply_ledger_identity",
    transactionId: record.transactionId,
    committedJournalDigest: record.committedJournalDigest,
    runtimeId: record.runtimeId,
    bundleId: record.bundleId,
    sourceId: record.sourceId,
    pagePath: record.pagePath,
    windowsPathKey: record.windowsPathKey,
    acceptedDecisionDigest: record.acceptedDecisionDigest,
    applyClaimId: record.applyClaimId,
    applyClaimDigest: record.applyClaimDigest,
    proposalId: record.proposalId,
    proposalDigest: record.proposalDigest,
    originalValidationReceiptDigest: record.originalValidationReceiptDigest,
    revalidationReceiptDigest: record.revalidationReceiptDigest,
    sourceBaseDigest: record.sourceBaseDigest,
    baseContentHash: record.baseContentHash,
    effectiveContentHash: record.effectiveContentHash,
    manifestBeforeRevision: record.manifestBeforeRevision,
    manifestBeforeDigest: record.manifestBeforeDigest,
    appliedAt: record.appliedAt,
  });
}

/** Reconstructs the only legacy identity that a canonical migration may alias. */
function createLegacyIdentityPayloadFromCanonicalRecord(
  record: Omit<KnowledgeForwardRevisionApplyLedgerRecordV2, "ledgerId" | "ledgerDigest">
): JsonValue {
  return Object.freeze({
    version: 1,
    kind: "forward_revision_apply_ledger_identity",
    transactionId: record.transactionId,
    committedJournalDigest: record.committedJournalDigest,
    runtimeId: record.runtimeId,
    bundleId: record.bundleId,
    sourceId: record.sourceId,
    pagePath: record.pagePath,
    windowsPathKey: record.windowsPathKey,
    acceptedDecisionDigest: record.acceptedDecisionDigest,
    applyClaimId: record.applyClaimId,
    applyClaimDigest: record.applyClaimDigest,
    proposalId: record.proposalId,
    proposalDigest: record.proposalDigest,
    originalValidationReceiptDigest: record.originalValidationReceiptDigest,
    revalidationReceiptDigest: record.revalidationReceiptDigest,
    sourceBaseDigest: record.sourceBaseDigest,
    baseContentHash: record.sourceAppliedContentHash,
    effectiveContentHash: record.effectiveContentHash,
    manifestBeforeRevision: record.manifestBeforeRevision,
    manifestBeforeDigest: record.manifestBeforeDigest,
    appliedAt: record.appliedAt,
  });
}

/** Computes the acyclic identity embedded in both overlay and final ledger. */
export function createKnowledgeForwardRevisionApplyLedgerIdentityDigest(
  committedJournalValue: unknown,
  sourceBaseValue: unknown
): string {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(committedJournalValue);
  if (journal.phase !== "committed") invalid();
  const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(sourceBaseValue);
  if (createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== journal.sourceBaseDigest) {
    invalid();
  }
  return digestValue(
    "knowledge-forward-revision-apply-ledger-identity-v2",
    createIdentityPayload(journal, sourceBase)
  );
}

/** Creates the final record payload excluding its content-addressed id and digest. */
function createLedgerPayload(
  journal: Readonly<KnowledgeForwardRevisionCommittedApplyJournalV1>,
  sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>,
  manifestAfterRevision: number,
  manifestAfterDigest: string,
  appliedAt: number
): Omit<KnowledgeForwardRevisionApplyLedgerRecordV2, "ledgerId" | "ledgerDigest"> {
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION,
    kind: "forward_revision_apply_ledger_record" as const,
    transactionId: journal.transactionId,
    committedJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(journal),
    runtimeId: journal.runtimeId,
    bundleId: journal.bundleId,
    sourceId: journal.sourceId,
    pagePath: journal.pagePath,
    windowsPathKey: journal.windowsPathKey,
    acceptedDecisionDigest: journal.acceptedDecisionDigest,
    applyClaimId: journal.applyClaimId,
    applyClaimDigest: journal.applyClaimDigest,
    proposalId: journal.proposalId,
    proposalDigest: journal.proposalDigest,
    originalValidationReceiptDigest: journal.originalValidationReceiptDigest,
    revalidationReceiptDigest: journal.revalidationReceiptDigest,
    sourceBase,
    sourceBaseDigest: journal.sourceBaseDigest,
    sourceAppliedContentHash: journal.sourceAppliedContentHash,
    previousEffectiveContentHash: journal.previousEffectiveContentHash,
    effectiveContentHash: journal.afterHash,
    manifestBeforeRevision: journal.manifestBeforeRevision,
    manifestBeforeDigest: journal.manifestBeforeDigest,
    forwardLedgerIdentityDigest: createKnowledgeForwardRevisionApplyLedgerIdentityDigest(
      journal,
      sourceBase
    ),
    legacyForwardLedgerIdentityDigest: null,
    manifestAfterRevision,
    manifestAfterDigest,
    appliedAt,
  });
}

/** Strictly validates one legacy record before an outer migration supplies its source base. */
export function snapshotKnowledgeForwardRevisionApplyLedgerRecordV1(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, RECORD_V1_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== 1 ||
      record.kind !== "forward_revision_apply_ledger_record" ||
      !isForwardApplyIdentifier(record.ledgerId) ||
      !LEDGER_ID_PATTERN.test(record.ledgerId) ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyDigest(record.committedJournalDigest) ||
      !isForwardApplyIdentifier(record.runtimeId) ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !isForwardApplyIdentifier(record.sourceId) ||
      !pagePath ||
      record.windowsPathKey !== toWindowsPathKey(pagePath) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(record.applyClaimId) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyIdentifier(record.proposalId) ||
      !isForwardApplyDigest(record.proposalDigest) ||
      !isForwardApplyDigest(record.originalValidationReceiptDigest) ||
      !isForwardApplyDigest(record.revalidationReceiptDigest) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(record.baseContentHash) ||
      !isForwardApplyDigest(record.effectiveContentHash) ||
      record.baseContentHash === record.effectiveContentHash ||
      !isForwardApplyNonNegativeInteger(record.manifestBeforeRevision) ||
      !isForwardApplyDigest(record.manifestBeforeDigest) ||
      !isForwardApplyDigest(record.forwardLedgerIdentityDigest) ||
      !isForwardApplyPositiveInteger(record.manifestAfterRevision) ||
      Number(record.manifestAfterRevision) !== Number(record.manifestBeforeRevision) + 1 ||
      !isForwardApplyDigest(record.manifestAfterDigest) ||
      !isForwardApplyNonNegativeInteger(record.appliedAt) ||
      !isForwardApplyDigest(record.ledgerDigest)
    ) {
      invalid();
    }
    const payload = Object.freeze({
      version: 1 as const,
      kind: "forward_revision_apply_ledger_record" as const,
      transactionId: record.transactionId,
      committedJournalDigest: record.committedJournalDigest,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      pagePath,
      windowsPathKey: record.windowsPathKey,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaimId: record.applyClaimId,
      applyClaimDigest: record.applyClaimDigest,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      originalValidationReceiptDigest: record.originalValidationReceiptDigest,
      revalidationReceiptDigest: record.revalidationReceiptDigest,
      sourceBaseDigest: record.sourceBaseDigest,
      baseContentHash: record.baseContentHash,
      effectiveContentHash: record.effectiveContentHash,
      manifestBeforeRevision: Number(record.manifestBeforeRevision),
      manifestBeforeDigest: record.manifestBeforeDigest,
      forwardLedgerIdentityDigest: record.forwardLedgerIdentityDigest,
      manifestAfterRevision: Number(record.manifestAfterRevision),
      manifestAfterDigest: record.manifestAfterDigest,
      appliedAt: Number(record.appliedAt),
    });
    const ledgerDigest = digestValue("knowledge-forward-revision-apply-ledger-record-v1", payload);
    const ledgerId = `forward-revision-apply-ledger-${ledgerDigest}`;
    const expectedIdentityDigest = digestValue(
      "knowledge-forward-revision-apply-ledger-identity-v1",
      createLegacyIdentityPayloadFromRecord(payload)
    );
    if (
      record.forwardLedgerIdentityDigest !== expectedIdentityDigest ||
      record.ledgerDigest !== ledgerDigest ||
      record.ledgerId !== ledgerId
    ) {
      invalid();
    }
    return freezeForwardApplyJson({ ...payload, ledgerId, ledgerDigest });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one canonical self-contained body-free ledger record. */
export function snapshotKnowledgeForwardRevisionApplyLedgerRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV2> {
  try {
    const record = captureForwardApplyRecord(value, RECORD_V2_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION ||
      record.kind !== "forward_revision_apply_ledger_record" ||
      !isForwardApplyIdentifier(record.ledgerId) ||
      !LEDGER_ID_PATTERN.test(record.ledgerId) ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyDigest(record.committedJournalDigest) ||
      !isForwardApplyIdentifier(record.runtimeId) ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !isForwardApplyIdentifier(record.sourceId) ||
      !pagePath ||
      record.windowsPathKey !== toWindowsPathKey(pagePath) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(record.applyClaimId) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyIdentifier(record.proposalId) ||
      !isForwardApplyDigest(record.proposalDigest) ||
      !isForwardApplyDigest(record.originalValidationReceiptDigest) ||
      !isForwardApplyDigest(record.revalidationReceiptDigest) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(record.sourceAppliedContentHash) ||
      !isForwardApplyDigest(record.previousEffectiveContentHash) ||
      !isForwardApplyDigest(record.effectiveContentHash) ||
      record.previousEffectiveContentHash === record.effectiveContentHash ||
      !isForwardApplyNonNegativeInteger(record.manifestBeforeRevision) ||
      !isForwardApplyDigest(record.manifestBeforeDigest) ||
      !isForwardApplyDigest(record.forwardLedgerIdentityDigest) ||
      (record.legacyForwardLedgerIdentityDigest !== null &&
        !isForwardApplyDigest(record.legacyForwardLedgerIdentityDigest)) ||
      !isForwardApplyPositiveInteger(record.manifestAfterRevision) ||
      Number(record.manifestAfterRevision) !== Number(record.manifestBeforeRevision) + 1 ||
      !isForwardApplyDigest(record.manifestAfterDigest) ||
      !isForwardApplyNonNegativeInteger(record.appliedAt) ||
      !isForwardApplyDigest(record.ledgerDigest)
    ) {
      invalid();
    }
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const sourcePages = sourceBase.lastSuccessful.generatedPages.filter(
      (page) => toWindowsPathKey(page.path) === toWindowsPathKey(pagePath)
    );
    if (
      !isSourceBaseWithinOuterLimit(sourceBase) ||
      sourceBase.bundleId !== record.bundleId ||
      sourceBase.sourceId !== record.sourceId ||
      createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== record.sourceBaseDigest ||
      sourcePages.length !== 1 ||
      sourcePages[0]?.path !== pagePath ||
      sourcePages[0]?.ownership !== "generated" ||
      sourcePages[0]?.contentHash !== record.sourceAppliedContentHash
    ) {
      invalid();
    }
    const payload = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION,
      kind: "forward_revision_apply_ledger_record" as const,
      transactionId: record.transactionId,
      committedJournalDigest: record.committedJournalDigest,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      pagePath,
      windowsPathKey: record.windowsPathKey,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaimId: record.applyClaimId,
      applyClaimDigest: record.applyClaimDigest,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      originalValidationReceiptDigest: record.originalValidationReceiptDigest,
      revalidationReceiptDigest: record.revalidationReceiptDigest,
      sourceBase,
      sourceBaseDigest: record.sourceBaseDigest,
      sourceAppliedContentHash: record.sourceAppliedContentHash,
      previousEffectiveContentHash: record.previousEffectiveContentHash,
      effectiveContentHash: record.effectiveContentHash,
      manifestBeforeRevision: Number(record.manifestBeforeRevision),
      manifestBeforeDigest: record.manifestBeforeDigest,
      forwardLedgerIdentityDigest: record.forwardLedgerIdentityDigest,
      legacyForwardLedgerIdentityDigest: record.legacyForwardLedgerIdentityDigest,
      manifestAfterRevision: Number(record.manifestAfterRevision),
      manifestAfterDigest: record.manifestAfterDigest,
      appliedAt: Number(record.appliedAt),
    });
    const ledgerDigest = digestValue("knowledge-forward-revision-apply-ledger-record-v2", payload);
    const ledgerId = `forward-revision-apply-ledger-${ledgerDigest}`;
    const expectedIdentityDigest = digestValue(
      "knowledge-forward-revision-apply-ledger-identity-v2",
      createIdentityPayloadFromRecord(payload)
    );
    const expectedLegacyIdentityDigest = digestValue(
      "knowledge-forward-revision-apply-ledger-identity-v1",
      createLegacyIdentityPayloadFromCanonicalRecord(payload)
    );
    if (
      record.forwardLedgerIdentityDigest !== expectedIdentityDigest ||
      (record.legacyForwardLedgerIdentityDigest !== null &&
        (record.sourceAppliedContentHash !== record.previousEffectiveContentHash ||
          record.legacyForwardLedgerIdentityDigest !== expectedLegacyIdentityDigest)) ||
      record.ledgerDigest !== ledgerDigest ||
      record.ledgerId !== ledgerId
    ) {
      invalid();
    }
    return freezeForwardApplyJson({ ...payload, ledgerId, ledgerDigest });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/**
 * Migrates one validated v1 ledger after Runtime reconstructs its exact source base.
 *
 * The old `baseContentHash` represented both the immutable source-applied base
 * and the sole effective predecessor, so both v2 identities are initialized to
 * that value. The historical Manifest digest must be retained byte-for-byte;
 * overlay compatibility is carried by `legacyForwardLedgerIdentityDigest`
 * instead of rewriting a Manifest that may already anchor an active journal.
 */
export function migrateKnowledgeForwardRevisionApplyLedgerRecordV1(
  value: unknown,
  inputValue: MigrateKnowledgeForwardRevisionApplyLedgerRecordV1Input
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV2> {
  try {
    const legacy = snapshotKnowledgeForwardRevisionApplyLedgerRecordV1(value);
    const input = captureForwardApplyRecord(inputValue, MIGRATE_V1_KEYS);
    if (
      !input ||
      !isForwardApplyDigest(input.manifestAfterDigest) ||
      input.manifestAfterDigest !== legacy.manifestAfterDigest
    ) {
      invalid();
    }
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(input.sourceBase);
    if (
      !isSourceBaseWithinOuterLimit(sourceBase) ||
      sourceBase.bundleId !== legacy.bundleId ||
      sourceBase.sourceId !== legacy.sourceId ||
      createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== legacy.sourceBaseDigest
    ) {
      invalid();
    }
    const provisional = Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION,
      kind: "forward_revision_apply_ledger_record" as const,
      transactionId: legacy.transactionId,
      committedJournalDigest: legacy.committedJournalDigest,
      runtimeId: legacy.runtimeId,
      bundleId: legacy.bundleId,
      sourceId: legacy.sourceId,
      pagePath: legacy.pagePath,
      windowsPathKey: legacy.windowsPathKey,
      acceptedDecisionDigest: legacy.acceptedDecisionDigest,
      applyClaimId: legacy.applyClaimId,
      applyClaimDigest: legacy.applyClaimDigest,
      proposalId: legacy.proposalId,
      proposalDigest: legacy.proposalDigest,
      originalValidationReceiptDigest: legacy.originalValidationReceiptDigest,
      revalidationReceiptDigest: legacy.revalidationReceiptDigest,
      sourceBase,
      sourceBaseDigest: legacy.sourceBaseDigest,
      sourceAppliedContentHash: legacy.baseContentHash,
      previousEffectiveContentHash: legacy.baseContentHash,
      effectiveContentHash: legacy.effectiveContentHash,
      manifestBeforeRevision: legacy.manifestBeforeRevision,
      manifestBeforeDigest: legacy.manifestBeforeDigest,
      forwardLedgerIdentityDigest: legacy.forwardLedgerIdentityDigest,
      legacyForwardLedgerIdentityDigest: legacy.forwardLedgerIdentityDigest,
      manifestAfterRevision: legacy.manifestAfterRevision,
      manifestAfterDigest: input.manifestAfterDigest,
      appliedAt: legacy.appliedAt,
    });
    const forwardLedgerIdentityDigest = digestValue(
      "knowledge-forward-revision-apply-ledger-identity-v2",
      createIdentityPayloadFromRecord(provisional)
    );
    const payload = Object.freeze({ ...provisional, forwardLedgerIdentityDigest });
    const ledgerDigest = digestValue("knowledge-forward-revision-apply-ledger-record-v2", payload);
    return snapshotKnowledgeForwardRevisionApplyLedgerRecord({
      ...payload,
      ledgerId: `forward-revision-apply-ledger-${ledgerDigest}`,
      ledgerDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/**
 * Derives the v2 identity while retaining the current v1 overlay as a legacy alias.
 *
 * Runtime normally needs only the full migration helper. This projection exists
 * for graph validation that must compare the new canonical identity separately
 * from the retained v1 overlay identity without mutating the Manifest.
 */
export function createKnowledgeForwardRevisionApplyLedgerIdentityDigestForV1Migration(
  value: unknown,
  sourceBaseValue: unknown
): string {
  const legacy = snapshotKnowledgeForwardRevisionApplyLedgerRecordV1(value);
  return migrateKnowledgeForwardRevisionApplyLedgerRecordV1(legacy, {
    sourceBase: sourceBaseValue,
    manifestAfterDigest: legacy.manifestAfterDigest,
  }).forwardLedgerIdentityDigest;
}

/** Creates one exact finalized ledger from its committed journal and Manifest result. */
export function createKnowledgeForwardRevisionApplyLedgerRecord(
  value: CreateKnowledgeForwardRevisionApplyLedgerRecordInput
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV2> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_KEYS);
    if (
      !record ||
      !isForwardApplyPositiveInteger(record.manifestAfterRevision) ||
      !isForwardApplyDigest(record.manifestAfterDigest) ||
      !isForwardApplyNonNegativeInteger(record.appliedAt)
    ) {
      invalid();
    }
    const journal = snapshotKnowledgeForwardRevisionApplyJournal(record.committedJournal);
    if (journal.phase !== "committed") invalid();
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const appliedAt = Number(record.appliedAt);
    if (appliedAt !== journal.committedAt) invalid();
    const payload = createLedgerPayload(
      journal,
      sourceBase,
      Number(record.manifestAfterRevision),
      record.manifestAfterDigest,
      appliedAt
    );
    const ledgerDigest = digestValue("knowledge-forward-revision-apply-ledger-record-v2", payload);
    return snapshotKnowledgeForwardRevisionApplyLedgerRecord({
      ...payload,
      ledgerId: `forward-revision-apply-ledger-${ledgerDigest}`,
      ledgerDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Strictly rejoins a ledger to its committed journal and source base. */
export function snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal(
  value: unknown,
  committedJournalValue: unknown,
  sourceBaseValue: unknown
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV2> {
  const ledger = snapshotKnowledgeForwardRevisionApplyLedgerRecord(value);
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(committedJournalValue);
  if (journal.phase !== "committed") invalid();
  const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(sourceBaseValue);
  const expected = createKnowledgeForwardRevisionApplyLedgerRecord({
    committedJournal: journal,
    sourceBase,
    manifestAfterRevision: ledger.manifestAfterRevision,
    manifestAfterDigest: ledger.manifestAfterDigest,
    appliedAt: ledger.appliedAt,
  });
  if (
    canonicalizeJson(ledger as unknown as JsonValue) !==
    canonicalizeJson(expected as unknown as JsonValue)
  ) {
    invalid();
  }
  return ledger;
}

/** Computes the canonical self-consistency digest of one strict ledger. */
export function createKnowledgeForwardRevisionApplyLedgerRecordDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionApplyLedgerRecord(value).ledgerDigest;
}

/** Parses one untrusted ledger into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionApplyLedgerRecord(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionApplyLedgerRecordV2>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionApplyLedgerRecord(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_apply_ledger_invalid",
          severity: "error",
          field: "forwardRevisionApplyCommits",
          message: "Forward revision Apply ledger does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted ledger without retaining rejected data. */
export function validateKnowledgeForwardRevisionApplyLedgerRecord(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionApplyLedgerRecord(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Detaches one fixed parser diagnostic. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionApplyLedgerValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionApplyLedgerValidationError);
