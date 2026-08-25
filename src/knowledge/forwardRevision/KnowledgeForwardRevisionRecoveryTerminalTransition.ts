import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionRecoveryRequiredApplyJournalV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  createKnowledgeForwardRevisionAcceptedClaimIdentity,
  createKnowledgeForwardRevisionLifecycleResourceIdentity,
  createKnowledgeForwardRevisionRecoveryJournalRef,
  snapshotKnowledgeForwardRevisionRecoveryTerminalRecord,
  type KnowledgeForwardRevisionRecoveryTerminalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";

/** Content-free observation reconstructed from one exact recovery terminal proof. */
export type KnowledgeForwardRevisionRecoveryTerminalTransitionObservation =
  | Readonly<{ kind: "file"; contentHash: string }>
  | Readonly<{ kind: "missing" | "directory" | "oversized_file" }>;

/** Exact active-journal transition material admitted by the Runtime exclusive-mutation guard. */
export interface KnowledgeForwardRevisionRecoveryTerminalTransition {
  readonly previousJournal: Readonly<KnowledgeForwardRevisionRecoveryRequiredApplyJournalV2>;
  readonly previousJournalDigest: string;
  readonly terminal: Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>;
  readonly observation: KnowledgeForwardRevisionRecoveryTerminalTransitionObservation;
  readonly observedAt: number;
}

/** Fixed value-free rejection for a terminal that does not rejoin its active journal. */
export class KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError extends TypeError {
  /** Creates one sanitized validation failure. */
  constructor() {
    super("Forward revision recovery terminal does not rejoin its active journal");
    this.name = "KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError";
    Object.freeze(this);
  }
}

/** Throws one fixed validation failure without retaining rejected values. */
function invalid(): never {
  throw new KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError();
}

/** Compares two already-strict protocol values independently of property insertion order. */
function exactProtocolValuesEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

/**
 * Rejoins one terminal proof to the exact recovery-required journal it atomically clears.
 *
 * The terminal observation may be newer than the persisted conflict observation, but every
 * accepted identity, claim, transaction, hash, journal revision, and recovery-journal digest
 * must be reconstructed exactly from the active journal. The returned transition contains no
 * Vault bytes beyond the already-durable journal snapshot.
 *
 * @param activeJournalValue - Exact active recovery-required Apply journal
 * @param terminalValue - Candidate durable no-write terminal proof
 * @returns Frozen transition material suitable for exact Runtime-state reconstruction
 */
export function snapshotKnowledgeForwardRevisionRecoveryTerminalTransition(
  activeJournalValue: unknown,
  terminalValue: unknown
): Readonly<KnowledgeForwardRevisionRecoveryTerminalTransition> {
  try {
    const journal = snapshotKnowledgeForwardRevisionApplyJournal(activeJournalValue);
    if (journal.phase !== "recovery_required") invalid();
    const terminal = snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(terminalValue);
    if (terminal.observation.observedAt < journal.updatedAt) invalid();
    const resource = createKnowledgeForwardRevisionLifecycleResourceIdentity({
      runtimeId: journal.runtimeId,
      bundleId: journal.bundleId,
      sourceId: journal.sourceId,
      pagePath: journal.pagePath,
    });
    const acceptedIdentity = createKnowledgeForwardRevisionAcceptedClaimIdentity({
      resource,
      acceptedDecisionDigest: journal.acceptedDecisionDigest,
      applyClaimId: journal.applyClaimId,
      applyClaimDigest: journal.applyClaimDigest,
      proposalId: journal.proposalId,
      proposalDigest: journal.proposalDigest,
      acceptedAfterHash: journal.afterHash,
      acceptedAt: journal.acceptedDecision.acceptedAt,
    });
    const previousJournalDigest = createKnowledgeForwardRevisionApplyJournalDigest(journal);
    const journalBase = {
      resource,
      transactionId: journal.transactionId,
      recoveryJournalDigest: previousJournalDigest,
      acceptedDecisionDigest: journal.acceptedDecisionDigest,
      applyClaimId: journal.applyClaimId,
      applyClaimDigest: journal.applyClaimDigest,
      beforeHash: journal.beforeHash,
      afterHash: journal.afterHash,
      updatedAt: terminal.observation.observedAt,
    } as const;
    const expectedJournal = createKnowledgeForwardRevisionRecoveryJournalRef(
      journal.revision === 3
        ? { ...journalBase, journalRevision: 3, committedAt: journal.committedAt! }
        : journal.revision === 2
          ? { ...journalBase, journalRevision: 2 }
          : { ...journalBase, journalRevision: 1 }
    );
    if (
      !exactProtocolValuesEqual(terminal.acceptedIdentity, acceptedIdentity) ||
      !exactProtocolValuesEqual(terminal.journal, expectedJournal)
    ) {
      invalid();
    }
    const observation: KnowledgeForwardRevisionRecoveryTerminalTransitionObservation =
      terminal.observation.actualKind === "file"
        ? Object.freeze({
            kind: "file" as const,
            contentHash: terminal.observation.actualHash,
          })
        : Object.freeze({ kind: terminal.observation.actualKind });
    return Object.freeze({
      previousJournal: journal,
      previousJournalDigest,
      terminal,
      observation,
      observedAt: terminal.observation.observedAt,
    });
  } catch (error) {
    if (error instanceof KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError) {
      throw error;
    }
    return invalid();
  }
}

Object.freeze(KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionRecoveryTerminalTransitionValidationError);
