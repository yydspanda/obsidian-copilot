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
export const KNOWLEDGE_FORWARD_REVISION_APPLY_LEDGER_VERSION = 1 as const;

/** Content-free exact success record for one finalized forward update. */
export interface KnowledgeForwardRevisionApplyLedgerRecordV1 {
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

/** Exact finalize fields supplied only after the Manifest overlay is projected. */
export interface CreateKnowledgeForwardRevisionApplyLedgerRecordInput {
  readonly committedJournal: unknown;
  readonly sourceBase: unknown;
  readonly manifestAfterRevision: number;
  readonly manifestAfterDigest: string;
  readonly appliedAt: number;
}

const RECORD_KEYS = [
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
const CREATE_KEYS = [
  "committedJournal",
  "sourceBase",
  "manifestAfterRevision",
  "manifestAfterDigest",
  "appliedAt",
] as const;
const LEDGER_ID_PATTERN = /^forward-revision-apply-ledger-[a-f0-9]{64}$/;

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
    baseContentHash: journal.beforeHash,
    effectiveContentHash: journal.afterHash,
    manifestBeforeRevision: journal.manifestBeforeRevision,
    manifestBeforeDigest: journal.manifestBeforeDigest,
    appliedAt: journal.committedAt,
  });
}

/** Reconstructs the acyclic identity payload from a standalone ledger record. */
function createIdentityPayloadFromRecord(
  record: Omit<KnowledgeForwardRevisionApplyLedgerRecordV1, "ledgerId" | "ledgerDigest">
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
    baseContentHash: record.baseContentHash,
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
    "knowledge-forward-revision-apply-ledger-identity-v1",
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
): Omit<KnowledgeForwardRevisionApplyLedgerRecordV1, "ledgerId" | "ledgerDigest"> {
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
    sourceBaseDigest: journal.sourceBaseDigest,
    baseContentHash: journal.beforeHash,
    effectiveContentHash: journal.afterHash,
    manifestBeforeRevision: journal.manifestBeforeRevision,
    manifestBeforeDigest: journal.manifestBeforeDigest,
    forwardLedgerIdentityDigest: createKnowledgeForwardRevisionApplyLedgerIdentityDigest(
      journal,
      sourceBase
    ),
    manifestAfterRevision,
    manifestAfterDigest,
    appliedAt,
  });
}

/** Strictly snapshots one self-contained content-free ledger record. */
export function snapshotKnowledgeForwardRevisionApplyLedgerRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, RECORD_KEYS);
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
      createIdentityPayloadFromRecord(payload)
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

/** Creates one exact finalized ledger from its committed journal and Manifest result. */
export function createKnowledgeForwardRevisionApplyLedgerRecord(
  value: CreateKnowledgeForwardRevisionApplyLedgerRecordInput
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV1> {
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
    const ledgerDigest = digestValue("knowledge-forward-revision-apply-ledger-record-v1", payload);
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
): Readonly<KnowledgeForwardRevisionApplyLedgerRecordV1> {
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
  if (canonicalizeJson(ledger) !== canonicalizeJson(expected)) {
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
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionApplyLedgerRecordV1>> {
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
