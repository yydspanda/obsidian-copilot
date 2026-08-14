import {
  createKnowledgeForwardRevisionApplyClaimDigest,
  snapshotKnowledgeForwardRevisionAcceptedDecisionRecord,
  type KnowledgeForwardRevisionAcceptedDecisionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  isForwardApplyBody,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  createKnowledgeForwardRevisionApplyRevalidationReceiptDigest,
  snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision,
  type KnowledgeForwardRevisionApplyRevalidationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current dedicated update-only forward-Apply journal version. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_JOURNAL_VERSION = 1 as const;

/** Safe observed Vault state retained after an irreconcilable recovery conflict. */
export interface KnowledgeForwardRevisionApplyConflictV1 {
  readonly version: 1;
  readonly kind: "forward_revision_apply_conflict";
  readonly code: "file_state_conflict" | "post_write_verification_failed";
  readonly actualKind: "missing" | "directory" | "file" | "oversized_file";
  readonly actualHash?: string;
  readonly detectedAt: number;
}

/** Immutable payload shared by every phase of one dedicated forward update. */
interface KnowledgeForwardRevisionApplyJournalBaseV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_JOURNAL_VERSION;
  readonly kind: "forward_revision_apply_journal";
  readonly transactionId: string;
  readonly revision: number;
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly originalValidationReceiptDigest: string;
  readonly revalidationReceipt: Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1>;
  readonly revalidationReceiptDigest: string;
  readonly sourceBaseDigest: string;
  readonly manifestBeforeRevision: number;
  readonly manifestBeforeDigest: string;
  readonly beforeContent: string;
  readonly beforeHash: string;
  readonly afterContent: string;
  readonly afterHash: string;
  /** Deterministic logical floor used for replay identity, never an expiry clock. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Prepared journal that must be durable before any file mutation. */
export type KnowledgeForwardRevisionPreparedApplyJournalV1 =
  KnowledgeForwardRevisionApplyJournalBaseV1 & { readonly phase: "prepared" };

/** Applying journal that authorizes one exact before-to-after CAS attempt. */
export type KnowledgeForwardRevisionApplyingApplyJournalV1 =
  KnowledgeForwardRevisionApplyJournalBaseV1 & { readonly phase: "applying" };

/** Committed marker whose exact digest anchors ledger finalization. */
export type KnowledgeForwardRevisionCommittedApplyJournalV1 =
  KnowledgeForwardRevisionApplyJournalBaseV1 & {
    readonly phase: "committed";
    readonly committedAt: number;
  };

/** Sticky journal that records only safe observed conflict metadata. */
export type KnowledgeForwardRevisionRecoveryRequiredApplyJournalV1 =
  KnowledgeForwardRevisionApplyJournalBaseV1 & {
    readonly phase: "recovery_required";
    readonly conflict: Readonly<KnowledgeForwardRevisionApplyConflictV1>;
    /** Present only when a durable committed marker later observes external drift. */
    readonly committedAt?: number;
  };

/** Any legal phase of one dedicated forward-Apply journal. */
export type KnowledgeForwardRevisionApplyJournalV1 =
  | KnowledgeForwardRevisionPreparedApplyJournalV1
  | KnowledgeForwardRevisionApplyingApplyJournalV1
  | KnowledgeForwardRevisionCommittedApplyJournalV1
  | KnowledgeForwardRevisionRecoveryRequiredApplyJournalV1;

/** Input that prepares one exact update-only journal revision zero. */
export interface CreateKnowledgeForwardRevisionPreparedApplyJournalInput {
  readonly transactionId: string;
  readonly acceptedDecision: unknown;
  readonly revalidationReceipt: unknown;
  readonly manifestBeforeRevision: number;
  readonly manifestBeforeDigest: string;
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly createdAt: number;
}

/** Input that marks an unfinished journal with one safe conflict. */
export interface ProjectKnowledgeForwardRevisionRecoveryRequiredInput {
  readonly code: KnowledgeForwardRevisionApplyConflictV1["code"];
  readonly actualKind: KnowledgeForwardRevisionApplyConflictV1["actualKind"];
  readonly actualHash?: string;
  readonly detectedAt: number;
}

const BASE_KEYS = [
  "version",
  "kind",
  "transactionId",
  "revision",
  "phase",
  "runtimeId",
  "bundleId",
  "sourceId",
  "pagePath",
  "windowsPathKey",
  "acceptedDecision",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "proposalId",
  "proposalDigest",
  "originalValidationReceiptDigest",
  "revalidationReceipt",
  "revalidationReceiptDigest",
  "sourceBaseDigest",
  "manifestBeforeRevision",
  "manifestBeforeDigest",
  "beforeContent",
  "beforeHash",
  "afterContent",
  "afterHash",
  "createdAt",
  "updatedAt",
] as const;
const COMMITTED_KEYS = [...BASE_KEYS, "committedAt"] as const;
const RECOVERY_KEYS = [...BASE_KEYS, "conflict"] as const;
const COMMITTED_RECOVERY_KEYS = [...BASE_KEYS, "committedAt", "conflict"] as const;
const CREATE_KEYS = [
  "transactionId",
  "acceptedDecision",
  "revalidationReceipt",
  "manifestBeforeRevision",
  "manifestBeforeDigest",
  "beforeContent",
  "afterContent",
  "createdAt",
] as const;
const CONFLICT_KEYS_WITH_HASH = [
  "version",
  "kind",
  "code",
  "actualKind",
  "actualHash",
  "detectedAt",
] as const;
const CONFLICT_KEYS_WITHOUT_HASH = ["version", "kind", "code", "actualKind", "detectedAt"] as const;
const RECOVERY_INPUT_KEYS_WITH_HASH = ["code", "actualKind", "actualHash", "detectedAt"] as const;
const RECOVERY_INPUT_KEYS_WITHOUT_HASH = ["code", "actualKind", "detectedAt"] as const;

/** Fixed value-free failure for malformed forward-Apply journals. */
export class KnowledgeForwardRevisionApplyJournalValidationError extends TypeError {
  /** Creates one sanitized error; only this module can mark it authentic. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision Apply journal does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionApplyJournalValidationError";
    if (authenticityToken === ERROR_TOKEN) authenticErrors.add(this);
  }
}

const ERROR_TOKEN = Symbol("KnowledgeForwardRevisionApplyJournalValidationError");
const authenticErrors = new WeakSet<KnowledgeForwardRevisionApplyJournalValidationError>();

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionApplyJournalValidationError(ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local failure. */
function isAuthenticError(
  value: unknown
): value is KnowledgeForwardRevisionApplyJournalValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticErrors.has(value as KnowledgeForwardRevisionApplyJournalValidationError)
  );
}

/** Reads a phase discriminant without invoking candidate code. */
function readPhase(value: unknown): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "phase");
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
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

/** Strictly snapshots safe conflict metadata without raw file bytes. */
function snapshotConflict(value: unknown): Readonly<KnowledgeForwardRevisionApplyConflictV1> {
  const hasHash = (() => {
    try {
      if (typeof value !== "object" || value === null) return false;
      return Object.getOwnPropertyDescriptor(value, "actualHash") !== undefined;
    } catch {
      return false;
    }
  })();
  const record = captureForwardApplyRecord(
    value,
    hasHash ? CONFLICT_KEYS_WITH_HASH : CONFLICT_KEYS_WITHOUT_HASH
  );
  if (
    !record ||
    record.version !== 1 ||
    record.kind !== "forward_revision_apply_conflict" ||
    (record.code !== "file_state_conflict" && record.code !== "post_write_verification_failed") ||
    (record.actualKind !== "missing" &&
      record.actualKind !== "directory" &&
      record.actualKind !== "file" &&
      record.actualKind !== "oversized_file") ||
    !isForwardApplyNonNegativeInteger(record.detectedAt) ||
    (record.actualKind === "file" && !isForwardApplyDigest(record.actualHash)) ||
    (record.actualKind !== "file" && record.actualHash !== undefined)
  ) {
    invalid();
  }
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_apply_conflict" as const,
    code: record.code,
    actualKind: record.actualKind,
    ...(record.actualHash === undefined ? {} : { actualHash: record.actualHash as string }),
    detectedAt: Number(record.detectedAt),
  });
}

/** Strictly snapshots and cross-validates one complete journal phase. */
export function snapshotKnowledgeForwardRevisionApplyJournal(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyJournalV1> {
  try {
    const phase = readPhase(value);
    const keys =
      phase === "committed"
        ? COMMITTED_KEYS
        : phase === "recovery_required"
          ? Object.getOwnPropertyDescriptor(value, "committedAt") === undefined
            ? RECOVERY_KEYS
            : COMMITTED_RECOVERY_KEYS
          : BASE_KEYS;
    const record = captureForwardApplyRecord(value, keys);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_JOURNAL_VERSION ||
      record.kind !== "forward_revision_apply_journal" ||
      (phase !== "prepared" &&
        phase !== "applying" &&
        phase !== "committed" &&
        phase !== "recovery_required") ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyNonNegativeInteger(record.revision) ||
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
      !isForwardApplyNonNegativeInteger(record.manifestBeforeRevision) ||
      !isForwardApplyDigest(record.manifestBeforeDigest) ||
      !isForwardApplyBody(record.beforeContent) ||
      !isForwardApplyDigest(record.beforeHash) ||
      !isForwardApplyBody(record.afterContent) ||
      !isForwardApplyDigest(record.afterHash) ||
      record.beforeContent === record.afterContent ||
      createFileContentHash(record.beforeContent) !== record.beforeHash ||
      createFileContentHash(record.afterContent) !== record.afterHash ||
      !isForwardApplyNonNegativeInteger(record.createdAt) ||
      !isForwardApplyNonNegativeInteger(record.updatedAt) ||
      Number(record.updatedAt) < Number(record.createdAt) ||
      (phase === "prepared" && Number(record.updatedAt) !== Number(record.createdAt))
    ) {
      invalid();
    }
    const acceptedDecision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
      record.acceptedDecision
    );
    const revalidationReceipt =
      snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
        record.revalidationReceipt,
        acceptedDecision
      );
    if (
      record.runtimeId !== revalidationReceipt.runtimeId ||
      record.bundleId !== acceptedDecision.proposal.request.bundleId ||
      record.sourceId !== acceptedDecision.proposal.request.intent.current.primarySourceId ||
      pagePath !== acceptedDecision.proposal.request.pagePath ||
      record.acceptedDecisionDigest !== acceptedDecision.acceptedDecisionDigest ||
      record.applyClaimId !== acceptedDecision.applyClaim.claimId ||
      record.applyClaimDigest !==
        createKnowledgeForwardRevisionApplyClaimDigest(acceptedDecision.applyClaim) ||
      record.proposalId !== acceptedDecision.proposal.proposalId ||
      record.proposalDigest !== acceptedDecision.proposalDigest ||
      record.originalValidationReceiptDigest !== acceptedDecision.validationReceiptDigest ||
      record.revalidationReceiptDigest !==
        createKnowledgeForwardRevisionApplyRevalidationReceiptDigest(revalidationReceipt) ||
      record.sourceBaseDigest !== revalidationReceipt.sourceBaseDigest ||
      Number(record.manifestBeforeRevision) !==
        revalidationReceipt.applyAuthority.manifestRevision ||
      record.manifestBeforeDigest !== revalidationReceipt.applyAuthority.manifestDigest ||
      record.beforeHash !== revalidationReceipt.vaultObservedBeforeHash ||
      record.beforeHash !== revalidationReceipt.applyAuthority.manifestBaseHash ||
      record.afterContent !== acceptedDecision.afterContent ||
      record.afterHash !== acceptedDecision.acceptedAfterHash ||
      Number(record.createdAt) < revalidationReceipt.revalidatedAt
    ) {
      invalid();
    }
    const revision = Number(record.revision);
    if (
      (phase === "prepared" && revision !== 0) ||
      (phase === "applying" && revision !== 1) ||
      (phase === "committed" && revision !== 2) ||
      (phase === "recovery_required" && revision !== 1 && revision !== 2 && revision !== 3)
    ) {
      invalid();
    }
    const base = {
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_JOURNAL_VERSION,
      kind: "forward_revision_apply_journal" as const,
      transactionId: record.transactionId,
      revision,
      phase,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      pagePath,
      windowsPathKey: record.windowsPathKey,
      acceptedDecision,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaimId: record.applyClaimId,
      applyClaimDigest: record.applyClaimDigest,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      originalValidationReceiptDigest: record.originalValidationReceiptDigest,
      revalidationReceipt,
      revalidationReceiptDigest: record.revalidationReceiptDigest,
      sourceBaseDigest: record.sourceBaseDigest,
      manifestBeforeRevision: Number(record.manifestBeforeRevision),
      manifestBeforeDigest: record.manifestBeforeDigest,
      beforeContent: record.beforeContent,
      beforeHash: record.beforeHash,
      afterContent: record.afterContent,
      afterHash: record.afterHash,
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
    };
    if (phase === "committed") {
      if (
        !isForwardApplyNonNegativeInteger(record.committedAt) ||
        Number(record.committedAt) !== Number(record.updatedAt)
      ) {
        invalid();
      }
      return freezeForwardApplyJson({
        ...base,
        phase,
        committedAt: Number(record.committedAt),
      });
    }
    if (phase === "recovery_required") {
      const conflict = snapshotConflict(record.conflict);
      const committedAt = record.committedAt;
      if (
        conflict.detectedAt !== Number(record.updatedAt) ||
        (revision < 3 &&
          conflict.actualKind === "file" &&
          (conflict.actualHash === record.beforeHash ||
            conflict.actualHash === record.afterHash)) ||
        (revision === 1 && conflict.code !== "file_state_conflict") ||
        (revision === 3 &&
          (conflict.code !== "post_write_verification_failed" ||
            (conflict.actualKind === "file" && conflict.actualHash === record.afterHash) ||
            !isForwardApplyNonNegativeInteger(committedAt) ||
            Number(committedAt) > conflict.detectedAt)) ||
        (revision !== 3 && committedAt !== undefined)
      ) {
        invalid();
      }
      return freezeForwardApplyJson({
        ...base,
        phase,
        ...(revision === 3 ? { committedAt: Number(committedAt) } : {}),
        conflict,
      });
    }
    return freezeForwardApplyJson({
      ...base,
      phase,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates and snapshots one prepared revision-zero journal. */
export function createKnowledgeForwardRevisionPreparedApplyJournal(
  value: CreateKnowledgeForwardRevisionPreparedApplyJournalInput
): Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_KEYS);
    if (
      !record ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyNonNegativeInteger(record.manifestBeforeRevision) ||
      !isForwardApplyDigest(record.manifestBeforeDigest) ||
      !isForwardApplyBody(record.beforeContent) ||
      !isForwardApplyBody(record.afterContent) ||
      !isForwardApplyNonNegativeInteger(record.createdAt)
    ) {
      invalid();
    }
    const acceptedDecision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
      record.acceptedDecision
    );
    const receipt = snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
      record.revalidationReceipt,
      acceptedDecision
    );
    return snapshotKnowledgeForwardRevisionApplyJournal({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_JOURNAL_VERSION,
      kind: "forward_revision_apply_journal",
      transactionId: record.transactionId,
      revision: 0,
      phase: "prepared",
      runtimeId: receipt.runtimeId,
      bundleId: receipt.bundleId,
      sourceId: receipt.sourceBase.sourceId,
      pagePath: receipt.pagePath,
      windowsPathKey: toWindowsPathKey(receipt.pagePath),
      acceptedDecision,
      acceptedDecisionDigest: acceptedDecision.acceptedDecisionDigest,
      applyClaimId: acceptedDecision.applyClaim.claimId,
      applyClaimDigest: acceptedDecision.applyClaimDigest,
      proposalId: acceptedDecision.proposal.proposalId,
      proposalDigest: acceptedDecision.proposalDigest,
      originalValidationReceiptDigest: acceptedDecision.validationReceiptDigest,
      revalidationReceipt: receipt,
      revalidationReceiptDigest: receipt.receiptDigest,
      sourceBaseDigest: receipt.sourceBaseDigest,
      manifestBeforeRevision: record.manifestBeforeRevision,
      manifestBeforeDigest: record.manifestBeforeDigest,
      beforeContent: record.beforeContent,
      beforeHash: createFileContentHash(record.beforeContent),
      afterContent: record.afterContent,
      afterHash: createFileContentHash(record.afterContent),
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    }) as Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1>;
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Asserts all immutable journal fields are byte-identical across one transition. */
function assertImmutablePayload(
  previous: Readonly<KnowledgeForwardRevisionApplyJournalV1>,
  next: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): void {
  /** Projects the immutable journal payload without transition-owned fields. */
  const omitPhase = (journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>): JsonValue => {
    const { revision: _revision, phase: _phase, updatedAt: _updatedAt, ...rest } = journal;
    void _revision;
    void _phase;
    void _updatedAt;
    const mutable = { ...rest } as Record<string, unknown>;
    delete mutable.committedAt;
    delete mutable.conflict;
    return mutable as JsonValue;
  };
  if (canonicalizeJson(omitPhase(previous)) !== canonicalizeJson(omitPhase(next))) invalid();
}

/** Projects prepared to applying with revision+1 and monotonic time. */
export function projectKnowledgeForwardRevisionApplyJournalApplying(
  value: unknown,
  updatedAt: number
): Readonly<KnowledgeForwardRevisionApplyingApplyJournalV1> {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(value);
  if (
    journal.phase !== "prepared" ||
    journal.revision >= Number.MAX_SAFE_INTEGER ||
    !isForwardApplyNonNegativeInteger(updatedAt) ||
    updatedAt < journal.updatedAt
  ) {
    invalid();
  }
  const next = snapshotKnowledgeForwardRevisionApplyJournal({
    ...journal,
    phase: "applying",
    revision: journal.revision + 1,
    updatedAt,
  }) as Readonly<KnowledgeForwardRevisionApplyingApplyJournalV1>;
  assertImmutablePayload(journal, next);
  return next;
}

/** Projects applying to committed after exact post-write verification. */
export function projectKnowledgeForwardRevisionApplyJournalCommitted(
  value: unknown,
  committedAt: number
): Readonly<KnowledgeForwardRevisionCommittedApplyJournalV1> {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(value);
  if (
    journal.phase !== "applying" ||
    journal.revision >= Number.MAX_SAFE_INTEGER ||
    !isForwardApplyNonNegativeInteger(committedAt) ||
    committedAt < journal.updatedAt
  ) {
    invalid();
  }
  const next = snapshotKnowledgeForwardRevisionApplyJournal({
    ...journal,
    phase: "committed",
    revision: journal.revision + 1,
    updatedAt: committedAt,
    committedAt,
  }) as Readonly<KnowledgeForwardRevisionCommittedApplyJournalV1>;
  assertImmutablePayload(journal, next);
  return next;
}

/** Projects an unresolved prepared/applying/committed state to sticky recovery-required. */
export function projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(
  value: unknown,
  input: ProjectKnowledgeForwardRevisionRecoveryRequiredInput
): Readonly<KnowledgeForwardRevisionRecoveryRequiredApplyJournalV1> {
  try {
    const journal = snapshotKnowledgeForwardRevisionApplyJournal(value);
    const hasHash =
      typeof input === "object" &&
      input !== null &&
      Object.getOwnPropertyDescriptor(input, "actualHash") !== undefined;
    const record = captureForwardApplyRecord(
      input,
      hasHash ? RECOVERY_INPUT_KEYS_WITH_HASH : RECOVERY_INPUT_KEYS_WITHOUT_HASH
    );
    if (
      !record ||
      (journal.phase !== "prepared" &&
        journal.phase !== "applying" &&
        journal.phase !== "committed") ||
      journal.revision >= Number.MAX_SAFE_INTEGER ||
      !isForwardApplyNonNegativeInteger(record.detectedAt) ||
      Number(record.detectedAt) < journal.updatedAt
    ) {
      invalid();
    }
    const conflict = snapshotConflict({
      version: 1,
      kind: "forward_revision_apply_conflict",
      ...record,
    });
    if (
      (journal.phase !== "committed" &&
        conflict.actualKind === "file" &&
        (conflict.actualHash === journal.beforeHash ||
          conflict.actualHash === journal.afterHash)) ||
      (journal.phase === "prepared" && conflict.code !== "file_state_conflict") ||
      (journal.phase === "committed" &&
        (conflict.code !== "post_write_verification_failed" ||
          (conflict.actualKind === "file" && conflict.actualHash === journal.afterHash)))
    ) {
      invalid();
    }
    const next = snapshotKnowledgeForwardRevisionApplyJournal({
      ...journal,
      phase: "recovery_required",
      revision: journal.revision + 1,
      updatedAt: record.detectedAt,
      ...(journal.phase === "committed" ? { committedAt: journal.committedAt } : {}),
      conflict,
    }) as Readonly<KnowledgeForwardRevisionRecoveryRequiredApplyJournalV1>;
    assertImmutablePayload(journal, next);
    return next;
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the canonical identity of one complete strict journal phase. */
export function createKnowledgeForwardRevisionApplyJournalDigest(value: unknown): string {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(value);
  return sha256(
    `knowledge-forward-revision-apply-journal-v1\n${canonicalizeJson(
      journal as unknown as JsonValue
    )}`
  );
}

/** Parses one untrusted journal into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionApplyJournal(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionApplyJournalV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionApplyJournal(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_apply_journal_invalid",
          severity: "error",
          field: "activeForwardRevisionApply",
          message: "Forward revision Apply journal does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted journal without retaining rejected data. */
export function validateKnowledgeForwardRevisionApplyJournal(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionApplyJournal(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Detaches one fixed parser diagnostic. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionApplyJournalValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionApplyJournalValidationError);
