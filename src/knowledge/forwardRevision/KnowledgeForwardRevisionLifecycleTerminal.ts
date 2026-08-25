import {
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  hasForwardApplyControlCharacter,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
  isForwardApplyUnicodeScalarText,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/** Current strict version of forward lifecycle lineage and terminal records. */
export const KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION = 1 as const;

/** Exact Runtime and Windows-safe page identity shared by one lifecycle. */
export interface KnowledgeForwardRevisionLifecycleResourceIdentityV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_lifecycle_resource_identity";
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly sourceId: string;
  readonly pagePath: string;
  readonly windowsPathKey: string;
}

/** Input for one canonical lifecycle resource identity. */
export type CreateKnowledgeForwardRevisionLifecycleResourceIdentityInput = Omit<
  KnowledgeForwardRevisionLifecycleResourceIdentityV1,
  "version" | "kind" | "windowsPathKey"
>;

/** Content-free ledger edge used to prove an exact CAS lineage. */
export interface KnowledgeForwardRevisionLedgerLineageRefV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_ledger_lineage_ref";
  readonly ledgerKind: "forward_revision_apply" | "source_apply";
  readonly resource: Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1>;
  readonly transactionId: string;
  readonly ledgerIdentityDigest: string;
  readonly casBeforeHash: string;
  readonly afterHash: string;
  readonly appliedAt: number;
}

/** Input for one content-free ledger lineage edge. */
export type CreateKnowledgeForwardRevisionLedgerLineageRefInput = Omit<
  KnowledgeForwardRevisionLedgerLineageRefV1,
  "version" | "kind"
>;

/** Durable proof that one active forward overlay was atomically superseded. */
export interface KnowledgeForwardRevisionSupersessionRecordV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_supersession_record";
  readonly supersessionId: string;
  readonly predecessor: Readonly<KnowledgeForwardRevisionLedgerLineageRefV1>;
  readonly successor: Readonly<KnowledgeForwardRevisionLedgerLineageRefV1>;
  readonly supersededAt: number;
  readonly supersessionDigest: string;
}

/** Input for one atomic forward-overlay supersession proof. */
export interface CreateKnowledgeForwardRevisionSupersessionRecordInput {
  readonly predecessor: unknown;
  readonly successor: unknown;
  readonly supersededAt: number;
}

/** Exact accepted decision and non-authoritative Apply-claim identity. */
export interface KnowledgeForwardRevisionAcceptedClaimIdentityV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_accepted_claim_identity";
  readonly resource: Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1>;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly acceptedAfterHash: string;
  readonly acceptedAt: number;
}

/** Input for one exact accepted decision and Apply-claim identity. */
export type CreateKnowledgeForwardRevisionAcceptedClaimIdentityInput = Omit<
  KnowledgeForwardRevisionAcceptedClaimIdentityV1,
  "version" | "kind"
>;

/** Durable accepted-not-started terminal record with explicit proof absences. */
export interface KnowledgeForwardRevisionAbandonmentRecordV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_abandonment_record";
  readonly abandonmentId: string;
  readonly acceptedIdentity: Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1>;
  readonly outcome: "abandoned_before_write";
  readonly journalIdentity: null;
  readonly ledgerIdentityDigest: null;
  readonly overlayLedgerIdentityDigest: null;
  readonly vaultMutation: "none";
  readonly abandonedAt: number;
  readonly abandonmentDigest: string;
}

/** Input for one accepted-not-started abandonment. */
export interface CreateKnowledgeForwardRevisionAbandonmentRecordInput {
  readonly acceptedIdentity: unknown;
  readonly abandonedAt: number;
}

/** Safe external file observation retained without Vault bytes. */
export type KnowledgeForwardRevisionExternalObservationV1 =
  | {
      readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
      readonly kind: "forward_revision_external_observation";
      readonly actualKind: "file";
      readonly actualHash: string;
      readonly observedAt: number;
    }
  | {
      readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
      readonly kind: "forward_revision_external_observation";
      readonly actualKind: "missing" | "directory" | "oversized_file";
      readonly observedAt: number;
    };

/** Input for one bounded external file observation. */
export type CreateKnowledgeForwardRevisionExternalObservationInput =
  | {
      readonly actualKind: "file";
      readonly actualHash: string;
      readonly observedAt: number;
    }
  | {
      readonly actualKind: "missing" | "directory" | "oversized_file";
      readonly observedAt: number;
    };

/** Fields common to every exact sticky-recovery journal identity. */
interface KnowledgeForwardRevisionRecoveryJournalRefBaseV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_recovery_journal_ref";
  readonly phase: "recovery_required";
  readonly resource: Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1>;
  readonly transactionId: string;
  readonly recoveryJournalDigest: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly updatedAt: number;
}

/** Recovery revision one proves no write was authorized. */
export interface KnowledgeForwardRevisionRecoveryJournalRefRevision1V1
  extends KnowledgeForwardRevisionRecoveryJournalRefBaseV1 {
  readonly journalRevision: 1;
}

/** Recovery revision two has an intentionally uncertain write outcome. */
export interface KnowledgeForwardRevisionRecoveryJournalRefRevision2V1
  extends KnowledgeForwardRevisionRecoveryJournalRefBaseV1 {
  readonly journalRevision: 2;
}

/** Recovery revision three proves an exact committed marker preceded external drift. */
export interface KnowledgeForwardRevisionRecoveryJournalRefRevision3V1
  extends KnowledgeForwardRevisionRecoveryJournalRefBaseV1 {
  readonly journalRevision: 3;
  readonly committedAt: number;
}

/** Any exact sticky-recovery journal identity accepted by terminalization. */
export type KnowledgeForwardRevisionRecoveryJournalRefV1 =
  | KnowledgeForwardRevisionRecoveryJournalRefRevision1V1
  | KnowledgeForwardRevisionRecoveryJournalRefRevision2V1
  | KnowledgeForwardRevisionRecoveryJournalRefRevision3V1;

/** Input for one exact sticky-recovery journal identity. */
export type CreateKnowledgeForwardRevisionRecoveryJournalRefInput =
  | Omit<KnowledgeForwardRevisionRecoveryJournalRefRevision1V1, "version" | "kind" | "phase">
  | Omit<KnowledgeForwardRevisionRecoveryJournalRefRevision2V1, "version" | "kind" | "phase">
  | Omit<KnowledgeForwardRevisionRecoveryJournalRefRevision3V1, "version" | "kind" | "phase">;

/** Fields common to all sticky-recovery terminalization outcomes. */
interface KnowledgeForwardRevisionRecoveryTerminalRecordBaseV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION;
  readonly kind: "forward_revision_recovery_terminal_record";
  readonly terminalizationId: string;
  readonly acceptedIdentity: Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1>;
  readonly observation: Readonly<KnowledgeForwardRevisionExternalObservationV1>;
  readonly vaultMutation: "none";
  readonly terminalizedAt: number;
  readonly terminalizationDigest: string;
}

/** Prepared recovery abandoned without starting a Vault write. */
export interface KnowledgeForwardRevisionAbandonedRecoveryTerminalRecordV1
  extends KnowledgeForwardRevisionRecoveryTerminalRecordBaseV1 {
  readonly outcome: "abandoned_before_write";
  readonly journal: Readonly<KnowledgeForwardRevisionRecoveryJournalRefRevision1V1>;
}

/** Applying recovery closed only after an unrelated external supersession. */
export interface KnowledgeForwardRevisionUncertainRecoveryTerminalRecordV1
  extends KnowledgeForwardRevisionRecoveryTerminalRecordBaseV1 {
  readonly outcome: "write_outcome_uncertain_external_supersession";
  readonly journal: Readonly<KnowledgeForwardRevisionRecoveryJournalRefRevision2V1>;
}

/** Committed recovery closed only after a later external supersession. */
export interface KnowledgeForwardRevisionCommittedRecoveryTerminalRecordV1
  extends KnowledgeForwardRevisionRecoveryTerminalRecordBaseV1 {
  readonly outcome: "committed_then_external_supersession";
  readonly journal: Readonly<KnowledgeForwardRevisionRecoveryJournalRefRevision3V1>;
}

/** Truthful terminalization of one sticky recovery without a Vault mutation. */
export type KnowledgeForwardRevisionRecoveryTerminalRecordV1 =
  | KnowledgeForwardRevisionAbandonedRecoveryTerminalRecordV1
  | KnowledgeForwardRevisionUncertainRecoveryTerminalRecordV1
  | KnowledgeForwardRevisionCommittedRecoveryTerminalRecordV1;

/** Input for one sticky-recovery terminalization; outcome derives from journal revision. */
export interface CreateKnowledgeForwardRevisionRecoveryTerminalRecordInput {
  readonly acceptedIdentity: unknown;
  readonly journal: unknown;
  readonly observation: unknown;
  readonly terminalizedAt: number;
}

const RESOURCE_KEYS = [
  "version",
  "kind",
  "runtimeId",
  "bundleId",
  "sourceId",
  "pagePath",
  "windowsPathKey",
] as const;
const CREATE_RESOURCE_KEYS = ["runtimeId", "bundleId", "sourceId", "pagePath"] as const;
const LEDGER_REF_KEYS = [
  "version",
  "kind",
  "ledgerKind",
  "resource",
  "transactionId",
  "ledgerIdentityDigest",
  "casBeforeHash",
  "afterHash",
  "appliedAt",
] as const;
const CREATE_LEDGER_REF_KEYS = [
  "ledgerKind",
  "resource",
  "transactionId",
  "ledgerIdentityDigest",
  "casBeforeHash",
  "afterHash",
  "appliedAt",
] as const;
const SUPERSESSION_KEYS = [
  "version",
  "kind",
  "supersessionId",
  "predecessor",
  "successor",
  "supersededAt",
  "supersessionDigest",
] as const;
const CREATE_SUPERSESSION_KEYS = ["predecessor", "successor", "supersededAt"] as const;
const ACCEPTED_IDENTITY_KEYS = [
  "version",
  "kind",
  "resource",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "proposalId",
  "proposalDigest",
  "acceptedAfterHash",
  "acceptedAt",
] as const;
const CREATE_ACCEPTED_IDENTITY_KEYS = [
  "resource",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "proposalId",
  "proposalDigest",
  "acceptedAfterHash",
  "acceptedAt",
] as const;
const ABANDONMENT_KEYS = [
  "version",
  "kind",
  "abandonmentId",
  "acceptedIdentity",
  "outcome",
  "journalIdentity",
  "ledgerIdentityDigest",
  "overlayLedgerIdentityDigest",
  "vaultMutation",
  "abandonedAt",
  "abandonmentDigest",
] as const;
const CREATE_ABANDONMENT_KEYS = ["acceptedIdentity", "abandonedAt"] as const;
const FILE_OBSERVATION_KEYS = [
  "version",
  "kind",
  "actualKind",
  "actualHash",
  "observedAt",
] as const;
const NON_FILE_OBSERVATION_KEYS = ["version", "kind", "actualKind", "observedAt"] as const;
const CREATE_FILE_OBSERVATION_KEYS = ["actualKind", "actualHash", "observedAt"] as const;
const CREATE_NON_FILE_OBSERVATION_KEYS = ["actualKind", "observedAt"] as const;
const RECOVERY_JOURNAL_KEYS = [
  "version",
  "kind",
  "phase",
  "resource",
  "transactionId",
  "recoveryJournalDigest",
  "journalRevision",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "beforeHash",
  "afterHash",
  "updatedAt",
] as const;
const COMMITTED_RECOVERY_JOURNAL_KEYS = [...RECOVERY_JOURNAL_KEYS, "committedAt"] as const;
const CREATE_RECOVERY_JOURNAL_KEYS = [
  "resource",
  "transactionId",
  "recoveryJournalDigest",
  "journalRevision",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "beforeHash",
  "afterHash",
  "updatedAt",
] as const;
const CREATE_COMMITTED_RECOVERY_JOURNAL_KEYS = [
  ...CREATE_RECOVERY_JOURNAL_KEYS,
  "committedAt",
] as const;
const RECOVERY_TERMINAL_KEYS = [
  "version",
  "kind",
  "terminalizationId",
  "acceptedIdentity",
  "outcome",
  "journal",
  "observation",
  "vaultMutation",
  "terminalizedAt",
  "terminalizationDigest",
] as const;
const CREATE_RECOVERY_TERMINAL_KEYS = [
  "acceptedIdentity",
  "journal",
  "observation",
  "terminalizedAt",
] as const;

const SUPERSESSION_ID_PATTERN = /^forward-revision-supersession-[a-f0-9]{64}$/;
const ABANDONMENT_ID_PATTERN = /^forward-revision-abandonment-[a-f0-9]{64}$/;
const TERMINALIZATION_ID_PATTERN = /^forward-revision-recovery-terminal-[a-f0-9]{64}$/;
const APPLY_CLAIM_ID_PATTERN = /^forward-revision-apply-claim-[a-f0-9]{64}$/;
const PROPOSAL_ID_PATTERN = /^forward-revision-proposal-[a-f0-9]{64}$/;

/** Fixed value-free failure for malformed forward lifecycle terminal material. */
export class KnowledgeForwardRevisionLifecycleTerminalValidationError extends TypeError {
  /** Creates one sanitized error; only this module can mark it authentic. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision lifecycle terminal material does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionLifecycleTerminalValidationError";
    if (authenticityToken === ERROR_TOKEN) authenticErrors.add(this);
  }
}

const ERROR_TOKEN = Symbol("KnowledgeForwardRevisionLifecycleTerminalValidationError");
const authenticErrors = new WeakSet<KnowledgeForwardRevisionLifecycleTerminalValidationError>();

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionLifecycleTerminalValidationError(ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local failure. */
function isAuthenticError(
  value: unknown
): value is KnowledgeForwardRevisionLifecycleTerminalValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticErrors.has(value as KnowledgeForwardRevisionLifecycleTerminalValidationError)
  );
}

/** Hashes one strict value under an explicit protocol domain. */
function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/** Captures one canonical Windows-safe Vault page path. */
function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 1_024 ||
    !isForwardApplyUnicodeScalarText(value) ||
    hasForwardApplyControlCharacter(value)
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

/** Detects one own data property without invoking candidate code. */
function hasOwnDataProperty(value: unknown, key: string): boolean {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
  } catch {
    return false;
  }
}

/** Compares exact lifecycle resource identities without locale behavior. */
function sameResourceIdentity(
  left: Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1>,
  right: Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1>
): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.bundleId === right.bundleId &&
    left.sourceId === right.sourceId &&
    left.pagePath === right.pagePath &&
    left.windowsPathKey === right.windowsPathKey
  );
}

/** Strictly snapshots one exact Runtime and page identity. */
export function snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(
  value: unknown
): Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1> {
  try {
    const record = captureForwardApplyRecord(value, RESOURCE_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_lifecycle_resource_identity" ||
      !isForwardApplyIdentifier(record.runtimeId) ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !isForwardApplyIdentifier(record.sourceId) ||
      !pagePath ||
      record.windowsPathKey !== toWindowsPathKey(pagePath)
    ) {
      invalid();
    }
    return freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_lifecycle_resource_identity" as const,
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      pagePath,
      windowsPathKey: record.windowsPathKey,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one canonical Runtime and page identity. */
export function createKnowledgeForwardRevisionLifecycleResourceIdentity(
  value: CreateKnowledgeForwardRevisionLifecycleResourceIdentityInput
): Readonly<KnowledgeForwardRevisionLifecycleResourceIdentityV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_RESOURCE_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (!record || !pagePath) invalid();
    return snapshotKnowledgeForwardRevisionLifecycleResourceIdentity({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_lifecycle_resource_identity",
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      pagePath,
      windowsPathKey: toWindowsPathKey(pagePath),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the domain-separated digest of one strict resource identity. */
export function createKnowledgeForwardRevisionLifecycleResourceIdentityDigest(
  value: unknown
): string {
  const identity = snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(value);
  return digestValue("knowledge-forward-revision-lifecycle-resource-identity-v1", identity);
}

/** Strictly snapshots one content-free Apply-ledger lineage edge. */
export function snapshotKnowledgeForwardRevisionLedgerLineageRef(
  value: unknown
): Readonly<KnowledgeForwardRevisionLedgerLineageRefV1> {
  try {
    const record = captureForwardApplyRecord(value, LEDGER_REF_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_ledger_lineage_ref" ||
      (record.ledgerKind !== "forward_revision_apply" && record.ledgerKind !== "source_apply") ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyDigest(record.ledgerIdentityDigest) ||
      !isForwardApplyDigest(record.casBeforeHash) ||
      !isForwardApplyDigest(record.afterHash) ||
      !isForwardApplyNonNegativeInteger(record.appliedAt)
    ) {
      invalid();
    }
    const resource = snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(record.resource);
    if (
      record.ledgerKind === "forward_revision_apply" &&
      record.casBeforeHash === record.afterHash
    ) {
      invalid();
    }
    return freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_ledger_lineage_ref" as const,
      ledgerKind: record.ledgerKind,
      resource,
      transactionId: record.transactionId,
      ledgerIdentityDigest: record.ledgerIdentityDigest,
      casBeforeHash: record.casBeforeHash,
      afterHash: record.afterHash,
      appliedAt: Number(record.appliedAt),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one content-free Apply-ledger lineage edge. */
export function createKnowledgeForwardRevisionLedgerLineageRef(
  value: CreateKnowledgeForwardRevisionLedgerLineageRefInput
): Readonly<KnowledgeForwardRevisionLedgerLineageRefV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_LEDGER_REF_KEYS);
    if (!record) invalid();
    return snapshotKnowledgeForwardRevisionLedgerLineageRef({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_ledger_lineage_ref",
      ...record,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the domain-separated digest of one ledger lineage edge. */
export function createKnowledgeForwardRevisionLedgerLineageRefDigest(value: unknown): string {
  const reference = snapshotKnowledgeForwardRevisionLedgerLineageRef(value);
  return digestValue("knowledge-forward-revision-ledger-lineage-ref-v1", reference);
}

/** Strictly snapshots one canonical atomic supersession record. */
export function snapshotKnowledgeForwardRevisionSupersessionRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionSupersessionRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, SUPERSESSION_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_supersession_record" ||
      !isForwardApplyIdentifier(record.supersessionId) ||
      !SUPERSESSION_ID_PATTERN.test(record.supersessionId) ||
      !isForwardApplyNonNegativeInteger(record.supersededAt) ||
      !isForwardApplyDigest(record.supersessionDigest)
    ) {
      invalid();
    }
    const predecessor = snapshotKnowledgeForwardRevisionLedgerLineageRef(record.predecessor);
    const successor = snapshotKnowledgeForwardRevisionLedgerLineageRef(record.successor);
    const supersededAt = Number(record.supersededAt);
    if (
      predecessor.ledgerKind !== "forward_revision_apply" ||
      !sameResourceIdentity(predecessor.resource, successor.resource) ||
      predecessor.transactionId === successor.transactionId ||
      predecessor.ledgerIdentityDigest === successor.ledgerIdentityDigest ||
      predecessor.afterHash !== successor.casBeforeHash ||
      successor.appliedAt < predecessor.appliedAt ||
      supersededAt !== successor.appliedAt
    ) {
      invalid();
    }
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_supersession_record" as const,
      predecessor,
      successor,
      supersededAt,
    });
    const supersessionDigest = digestValue(
      "knowledge-forward-revision-supersession-record-v1",
      payload
    );
    const supersessionId = `forward-revision-supersession-${supersessionDigest}`;
    if (
      record.supersessionDigest !== supersessionDigest ||
      record.supersessionId !== supersessionId
    ) {
      invalid();
    }
    return freezeForwardApplyJson({
      ...payload,
      supersessionId,
      supersessionDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one canonical atomic supersession record. */
export function createKnowledgeForwardRevisionSupersessionRecord(
  value: CreateKnowledgeForwardRevisionSupersessionRecordInput
): Readonly<KnowledgeForwardRevisionSupersessionRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_SUPERSESSION_KEYS);
    if (!record || !isForwardApplyNonNegativeInteger(record.supersededAt)) invalid();
    const predecessor = snapshotKnowledgeForwardRevisionLedgerLineageRef(record.predecessor);
    const successor = snapshotKnowledgeForwardRevisionLedgerLineageRef(record.successor);
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_supersession_record" as const,
      predecessor,
      successor,
      supersededAt: Number(record.supersededAt),
    });
    const supersessionDigest = digestValue(
      "knowledge-forward-revision-supersession-record-v1",
      payload
    );
    return snapshotKnowledgeForwardRevisionSupersessionRecord({
      ...payload,
      supersessionId: `forward-revision-supersession-${supersessionDigest}`,
      supersessionDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Rejoins a stored supersession to exact replay lineage fields. */
export function snapshotKnowledgeForwardRevisionSupersessionRecordForReplay(
  value: unknown,
  input: CreateKnowledgeForwardRevisionSupersessionRecordInput
): Readonly<KnowledgeForwardRevisionSupersessionRecordV1> {
  const stored = snapshotKnowledgeForwardRevisionSupersessionRecord(value);
  const expected = createKnowledgeForwardRevisionSupersessionRecord(input);
  if (canonicalizeJson(stored) !== canonicalizeJson(expected)) invalid();
  return stored;
}

/** Computes the canonical self-consistency digest of one supersession record. */
export function createKnowledgeForwardRevisionSupersessionRecordDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionSupersessionRecord(value).supersessionDigest;
}

/** Parses one untrusted supersession into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionSupersessionRecord(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionSupersessionRecordV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionSupersessionRecord(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_supersession_invalid",
          severity: "error",
          field: "forwardRevisionSupersessions",
          message: "Forward revision supersession does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted supersession without retaining rejected data. */
export function validateKnowledgeForwardRevisionSupersessionRecord(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionSupersessionRecord(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Strictly snapshots one accepted decision and Apply-claim identity. */
export function snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
  value: unknown
): Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1> {
  try {
    const record = captureForwardApplyRecord(value, ACCEPTED_IDENTITY_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_accepted_claim_identity" ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(record.applyClaimId) ||
      !APPLY_CLAIM_ID_PATTERN.test(record.applyClaimId) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyIdentifier(record.proposalId) ||
      !PROPOSAL_ID_PATTERN.test(record.proposalId) ||
      !isForwardApplyDigest(record.proposalDigest) ||
      !isForwardApplyDigest(record.acceptedAfterHash) ||
      !isForwardApplyNonNegativeInteger(record.acceptedAt)
    ) {
      invalid();
    }
    const resource = snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(record.resource);
    return freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_accepted_claim_identity" as const,
      resource,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaimId: record.applyClaimId,
      applyClaimDigest: record.applyClaimDigest,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      acceptedAfterHash: record.acceptedAfterHash,
      acceptedAt: Number(record.acceptedAt),
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one exact accepted decision and Apply-claim identity. */
export function createKnowledgeForwardRevisionAcceptedClaimIdentity(
  value: CreateKnowledgeForwardRevisionAcceptedClaimIdentityInput
): Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_ACCEPTED_IDENTITY_KEYS);
    if (!record) invalid();
    return snapshotKnowledgeForwardRevisionAcceptedClaimIdentity({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_accepted_claim_identity",
      ...record,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the domain-separated digest of one accepted decision identity. */
export function createKnowledgeForwardRevisionAcceptedClaimIdentityDigest(value: unknown): string {
  const identity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(value);
  return digestValue("knowledge-forward-revision-accepted-claim-identity-v1", identity);
}

/** Strictly snapshots one accepted-not-started abandonment record. */
export function snapshotKnowledgeForwardRevisionAbandonmentRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionAbandonmentRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, ABANDONMENT_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_abandonment_record" ||
      !isForwardApplyIdentifier(record.abandonmentId) ||
      !ABANDONMENT_ID_PATTERN.test(record.abandonmentId) ||
      record.outcome !== "abandoned_before_write" ||
      record.journalIdentity !== null ||
      record.ledgerIdentityDigest !== null ||
      record.overlayLedgerIdentityDigest !== null ||
      record.vaultMutation !== "none" ||
      !isForwardApplyNonNegativeInteger(record.abandonedAt) ||
      !isForwardApplyDigest(record.abandonmentDigest)
    ) {
      invalid();
    }
    const acceptedIdentity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
      record.acceptedIdentity
    );
    const abandonedAt = Number(record.abandonedAt);
    if (abandonedAt < acceptedIdentity.acceptedAt) invalid();
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_abandonment_record" as const,
      acceptedIdentity,
      outcome: "abandoned_before_write" as const,
      journalIdentity: null,
      ledgerIdentityDigest: null,
      overlayLedgerIdentityDigest: null,
      vaultMutation: "none" as const,
      abandonedAt,
    });
    const abandonmentDigest = digestValue(
      "knowledge-forward-revision-abandonment-record-v1",
      payload
    );
    const abandonmentId = `forward-revision-abandonment-${abandonmentDigest}`;
    if (record.abandonmentDigest !== abandonmentDigest || record.abandonmentId !== abandonmentId) {
      invalid();
    }
    return freezeForwardApplyJson({
      ...payload,
      abandonmentId,
      abandonmentDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one accepted-not-started abandonment with explicit proof absences. */
export function createKnowledgeForwardRevisionAbandonmentRecord(
  value: CreateKnowledgeForwardRevisionAbandonmentRecordInput
): Readonly<KnowledgeForwardRevisionAbandonmentRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_ABANDONMENT_KEYS);
    if (!record || !isForwardApplyNonNegativeInteger(record.abandonedAt)) invalid();
    const acceptedIdentity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
      record.acceptedIdentity
    );
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_abandonment_record" as const,
      acceptedIdentity,
      outcome: "abandoned_before_write" as const,
      journalIdentity: null,
      ledgerIdentityDigest: null,
      overlayLedgerIdentityDigest: null,
      vaultMutation: "none" as const,
      abandonedAt: Number(record.abandonedAt),
    });
    const abandonmentDigest = digestValue(
      "knowledge-forward-revision-abandonment-record-v1",
      payload
    );
    return snapshotKnowledgeForwardRevisionAbandonmentRecord({
      ...payload,
      abandonmentId: `forward-revision-abandonment-${abandonmentDigest}`,
      abandonmentDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Rejoins an abandonment to its exact accepted identity and timestamp. */
export function snapshotKnowledgeForwardRevisionAbandonmentRecordForReplay(
  value: unknown,
  input: CreateKnowledgeForwardRevisionAbandonmentRecordInput
): Readonly<KnowledgeForwardRevisionAbandonmentRecordV1> {
  const stored = snapshotKnowledgeForwardRevisionAbandonmentRecord(value);
  const expected = createKnowledgeForwardRevisionAbandonmentRecord(input);
  if (canonicalizeJson(stored) !== canonicalizeJson(expected)) invalid();
  return stored;
}

/** Computes the canonical self-consistency digest of one abandonment record. */
export function createKnowledgeForwardRevisionAbandonmentRecordDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionAbandonmentRecord(value).abandonmentDigest;
}

/** Parses one untrusted abandonment into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionAbandonmentRecord(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionAbandonmentRecord(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_abandonment_invalid",
          severity: "error",
          field: "forwardRevisionAbandonments",
          message: "Forward revision abandonment does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted abandonment without retaining rejected data. */
export function validateKnowledgeForwardRevisionAbandonmentRecord(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionAbandonmentRecord(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Strictly snapshots one bounded external observation without Vault bytes. */
export function snapshotKnowledgeForwardRevisionExternalObservation(
  value: unknown
): Readonly<KnowledgeForwardRevisionExternalObservationV1> {
  try {
    const hasHash = hasOwnDataProperty(value, "actualHash");
    const record = captureForwardApplyRecord(
      value,
      hasHash ? FILE_OBSERVATION_KEYS : NON_FILE_OBSERVATION_KEYS
    );
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_external_observation" ||
      !isForwardApplyNonNegativeInteger(record.observedAt) ||
      (record.actualKind !== "file" &&
        record.actualKind !== "missing" &&
        record.actualKind !== "directory" &&
        record.actualKind !== "oversized_file") ||
      (record.actualKind === "file" && !isForwardApplyDigest(record.actualHash)) ||
      (record.actualKind !== "file" && record.actualHash !== undefined)
    ) {
      invalid();
    }
    return freezeForwardApplyJson(
      record.actualKind === "file"
        ? {
            version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
            kind: "forward_revision_external_observation" as const,
            actualKind: "file" as const,
            actualHash: record.actualHash as string,
            observedAt: Number(record.observedAt),
          }
        : {
            version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
            kind: "forward_revision_external_observation" as const,
            actualKind: record.actualKind,
            observedAt: Number(record.observedAt),
          }
    );
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one bounded external observation without retaining Vault bytes. */
export function createKnowledgeForwardRevisionExternalObservation(
  value: CreateKnowledgeForwardRevisionExternalObservationInput
): Readonly<KnowledgeForwardRevisionExternalObservationV1> {
  try {
    const hasHash = hasOwnDataProperty(value, "actualHash");
    const record = captureForwardApplyRecord(
      value,
      hasHash ? CREATE_FILE_OBSERVATION_KEYS : CREATE_NON_FILE_OBSERVATION_KEYS
    );
    if (!record) invalid();
    return snapshotKnowledgeForwardRevisionExternalObservation({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_external_observation",
      ...record,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one exact sticky-recovery journal identity. */
export function snapshotKnowledgeForwardRevisionRecoveryJournalRef(
  value: unknown
): Readonly<KnowledgeForwardRevisionRecoveryJournalRefV1> {
  try {
    const hasCommittedAt = hasOwnDataProperty(value, "committedAt");
    const record = captureForwardApplyRecord(
      value,
      hasCommittedAt ? COMMITTED_RECOVERY_JOURNAL_KEYS : RECOVERY_JOURNAL_KEYS
    );
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_recovery_journal_ref" ||
      record.phase !== "recovery_required" ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyDigest(record.recoveryJournalDigest) ||
      (record.journalRevision !== 1 &&
        record.journalRevision !== 2 &&
        record.journalRevision !== 3) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(record.applyClaimId) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyDigest(record.beforeHash) ||
      !isForwardApplyDigest(record.afterHash) ||
      record.beforeHash === record.afterHash ||
      !isForwardApplyNonNegativeInteger(record.updatedAt) ||
      (record.journalRevision === 3 &&
        (!isForwardApplyNonNegativeInteger(record.committedAt) ||
          Number(record.committedAt) > Number(record.updatedAt))) ||
      (record.journalRevision !== 3 && record.committedAt !== undefined)
    ) {
      invalid();
    }
    const resource = snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(record.resource);
    const base = {
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_recovery_journal_ref" as const,
      phase: "recovery_required" as const,
      resource,
      transactionId: record.transactionId,
      recoveryJournalDigest: record.recoveryJournalDigest,
      journalRevision: record.journalRevision,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      applyClaimId: record.applyClaimId,
      applyClaimDigest: record.applyClaimDigest,
      beforeHash: record.beforeHash,
      afterHash: record.afterHash,
      updatedAt: Number(record.updatedAt),
    };
    return freezeForwardApplyJson(
      record.journalRevision === 3
        ? { ...base, journalRevision: 3 as const, committedAt: Number(record.committedAt) }
        : record.journalRevision === 2
          ? { ...base, journalRevision: 2 as const }
          : { ...base, journalRevision: 1 as const }
    );
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one exact sticky-recovery journal identity. */
export function createKnowledgeForwardRevisionRecoveryJournalRef(
  value: CreateKnowledgeForwardRevisionRecoveryJournalRefInput
): Readonly<KnowledgeForwardRevisionRecoveryJournalRefV1> {
  try {
    const hasCommittedAt = hasOwnDataProperty(value, "committedAt");
    const record = captureForwardApplyRecord(
      value,
      hasCommittedAt ? CREATE_COMMITTED_RECOVERY_JOURNAL_KEYS : CREATE_RECOVERY_JOURNAL_KEYS
    );
    if (!record) invalid();
    return snapshotKnowledgeForwardRevisionRecoveryJournalRef({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_recovery_journal_ref",
      phase: "recovery_required",
      ...record,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the domain-separated digest of one recovery journal reference. */
export function createKnowledgeForwardRevisionRecoveryJournalRefDigest(value: unknown): string {
  const reference = snapshotKnowledgeForwardRevisionRecoveryJournalRef(value);
  return digestValue("knowledge-forward-revision-recovery-journal-ref-v1", reference);
}

/** Derives the only truthful terminal outcome for one recovery revision. */
function deriveRecoveryOutcome(
  revision: KnowledgeForwardRevisionRecoveryJournalRefV1["journalRevision"]
): KnowledgeForwardRevisionRecoveryTerminalRecordV1["outcome"] {
  if (revision === 1) return "abandoned_before_write";
  if (revision === 2) return "write_outcome_uncertain_external_supersession";
  return "committed_then_external_supersession";
}

/** Strictly snapshots one sticky-recovery terminalization record. */
export function snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(
  value: unknown
): Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, RECOVERY_TERMINAL_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION ||
      record.kind !== "forward_revision_recovery_terminal_record" ||
      !isForwardApplyIdentifier(record.terminalizationId) ||
      !TERMINALIZATION_ID_PATTERN.test(record.terminalizationId) ||
      (record.outcome !== "abandoned_before_write" &&
        record.outcome !== "write_outcome_uncertain_external_supersession" &&
        record.outcome !== "committed_then_external_supersession") ||
      record.vaultMutation !== "none" ||
      !isForwardApplyNonNegativeInteger(record.terminalizedAt) ||
      !isForwardApplyDigest(record.terminalizationDigest)
    ) {
      invalid();
    }
    const acceptedIdentity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
      record.acceptedIdentity
    );
    const journal = snapshotKnowledgeForwardRevisionRecoveryJournalRef(record.journal);
    const observation = snapshotKnowledgeForwardRevisionExternalObservation(record.observation);
    const terminalizedAt = Number(record.terminalizedAt);
    if (
      record.outcome !== deriveRecoveryOutcome(journal.journalRevision) ||
      !sameResourceIdentity(acceptedIdentity.resource, journal.resource) ||
      acceptedIdentity.acceptedDecisionDigest !== journal.acceptedDecisionDigest ||
      acceptedIdentity.applyClaimId !== journal.applyClaimId ||
      acceptedIdentity.applyClaimDigest !== journal.applyClaimDigest ||
      acceptedIdentity.acceptedAfterHash !== journal.afterHash ||
      journal.updatedAt !== observation.observedAt ||
      terminalizedAt < observation.observedAt ||
      terminalizedAt < acceptedIdentity.acceptedAt ||
      (observation.actualKind === "file" &&
        (observation.actualHash === journal.afterHash ||
          (journal.journalRevision !== 3 && observation.actualHash === journal.beforeHash)))
    ) {
      invalid();
    }
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_recovery_terminal_record" as const,
      acceptedIdentity,
      outcome: deriveRecoveryOutcome(journal.journalRevision),
      journal,
      observation,
      vaultMutation: "none" as const,
      terminalizedAt,
    });
    const terminalizationDigest = digestValue(
      "knowledge-forward-revision-recovery-terminal-record-v1",
      payload
    );
    const terminalizationId = `forward-revision-recovery-terminal-${terminalizationDigest}`;
    if (
      record.terminalizationDigest !== terminalizationDigest ||
      record.terminalizationId !== terminalizationId
    ) {
      invalid();
    }
    return freezeForwardApplyJson({
      ...payload,
      terminalizationId,
      terminalizationDigest,
    }) as Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>;
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one sticky-recovery terminalization with a revision-derived outcome. */
export function createKnowledgeForwardRevisionRecoveryTerminalRecord(
  value: CreateKnowledgeForwardRevisionRecoveryTerminalRecordInput
): Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> {
  try {
    const record = captureForwardApplyRecord(value, CREATE_RECOVERY_TERMINAL_KEYS);
    if (!record || !isForwardApplyNonNegativeInteger(record.terminalizedAt)) invalid();
    const acceptedIdentity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
      record.acceptedIdentity
    );
    const journal = snapshotKnowledgeForwardRevisionRecoveryJournalRef(record.journal);
    const observation = snapshotKnowledgeForwardRevisionExternalObservation(record.observation);
    const payload = freezeForwardApplyJson({
      version: KNOWLEDGE_FORWARD_REVISION_LIFECYCLE_TERMINAL_VERSION,
      kind: "forward_revision_recovery_terminal_record" as const,
      acceptedIdentity,
      outcome: deriveRecoveryOutcome(journal.journalRevision),
      journal,
      observation,
      vaultMutation: "none" as const,
      terminalizedAt: Number(record.terminalizedAt),
    });
    const terminalizationDigest = digestValue(
      "knowledge-forward-revision-recovery-terminal-record-v1",
      payload
    );
    return snapshotKnowledgeForwardRevisionRecoveryTerminalRecord({
      ...payload,
      terminalizationId: `forward-revision-recovery-terminal-${terminalizationDigest}`,
      terminalizationDigest,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Rejoins one terminalization to its exact accepted, journal, and observation replay. */
export function snapshotKnowledgeForwardRevisionRecoveryTerminalRecordForReplay(
  value: unknown,
  input: CreateKnowledgeForwardRevisionRecoveryTerminalRecordInput
): Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> {
  const stored = snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(value);
  const expected = createKnowledgeForwardRevisionRecoveryTerminalRecord(input);
  if (canonicalizeJson(stored) !== canonicalizeJson(expected)) invalid();
  return stored;
}

/** Computes the canonical self-consistency digest of one recovery terminal record. */
export function createKnowledgeForwardRevisionRecoveryTerminalRecordDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(value).terminalizationDigest;
}

/** Parses one untrusted recovery terminal into a detached value or fixed diagnostic. */
export function parseKnowledgeForwardRevisionRecoveryTerminalRecord(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_recovery_terminal_invalid",
          severity: "error",
          field: "forwardRevisionRecoveryTerminals",
          message: "Forward revision recovery terminal does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted recovery terminal without retaining rejected data. */
export function validateKnowledgeForwardRevisionRecoveryTerminalRecord(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionRecoveryTerminalRecord(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Detaches one fixed parser diagnostic. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionLifecycleTerminalValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionLifecycleTerminalValidationError);
