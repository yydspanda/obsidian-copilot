import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionApplyJournalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  captureForwardApplyRecord,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  createKnowledgeForwardRevisionAcceptedClaimIdentity,
  createKnowledgeForwardRevisionLifecycleResourceIdentity,
  snapshotKnowledgeForwardRevisionAcceptedClaimIdentity,
  type KnowledgeForwardRevisionAcceptedClaimIdentityV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";

/** Current content-free identity version for an explicit sticky-recovery command. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_RECOVERY_EXPECTATION_VERSION = 1 as const;

/** Exact durable journal identity that one explicit recovery command is allowed to resolve. */
export interface KnowledgeForwardRevisionApplyRecoveryExpectationV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_RECOVERY_EXPECTATION_VERSION;
  readonly kind: "forward_revision_apply_recovery_expectation";
  readonly acceptedIdentity: Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1>;
  readonly transactionId: string;
  readonly recoveryJournalDigest: string;
}

const EXPECTATION_KEYS = [
  "version",
  "kind",
  "acceptedIdentity",
  "transactionId",
  "recoveryJournalDigest",
] as const;

/** Creates the canonical accepted identity carried by one validated Apply journal. */
function createAcceptedIdentityForJournal(
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): Readonly<KnowledgeForwardRevisionAcceptedClaimIdentityV1> {
  const decision = journal.acceptedDecision;
  return createKnowledgeForwardRevisionAcceptedClaimIdentity({
    resource: createKnowledgeForwardRevisionLifecycleResourceIdentity({
      runtimeId: journal.runtimeId,
      bundleId: journal.bundleId,
      sourceId: journal.sourceId,
      pagePath: journal.pagePath,
    }),
    acceptedDecisionDigest: decision.acceptedDecisionDigest,
    applyClaimId: decision.applyClaim.claimId,
    applyClaimDigest: decision.applyClaimDigest,
    proposalId: decision.proposal.proposalId,
    proposalDigest: decision.proposalDigest,
    acceptedAfterHash: decision.acceptedAfterHash,
    acceptedAt: decision.acceptedAt,
  });
}

/** Strictly snapshots one content-free sticky-recovery command identity. */
export function snapshotKnowledgeForwardRevisionApplyRecoveryExpectation(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1> {
  try {
    const record = captureForwardApplyRecord(value, EXPECTATION_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_RECOVERY_EXPECTATION_VERSION ||
      record.kind !== "forward_revision_apply_recovery_expectation" ||
      !isForwardApplyIdentifier(record.transactionId) ||
      !isForwardApplyDigest(record.recoveryJournalDigest)
    ) {
      throw new TypeError();
    }
    const acceptedIdentity = snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(
      record.acceptedIdentity
    );
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_RECOVERY_EXPECTATION_VERSION,
      kind: "forward_revision_apply_recovery_expectation" as const,
      acceptedIdentity,
      transactionId: record.transactionId,
      recoveryJournalDigest: record.recoveryJournalDigest,
    });
  } catch {
    throw new TypeError("Forward revision Apply recovery expectation is invalid");
  }
}

/** Creates one exact command expectation from a sticky durable Apply journal. */
export function createKnowledgeForwardRevisionApplyRecoveryExpectation(
  journalValue: unknown
): Readonly<KnowledgeForwardRevisionApplyRecoveryExpectationV1> {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
  if (journal.phase !== "recovery_required") {
    throw new TypeError("Forward revision Apply recovery expectation requires a sticky journal");
  }
  return snapshotKnowledgeForwardRevisionApplyRecoveryExpectation({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_RECOVERY_EXPECTATION_VERSION,
    kind: "forward_revision_apply_recovery_expectation",
    acceptedIdentity: createAcceptedIdentityForJournal(journal),
    transactionId: journal.transactionId,
    recoveryJournalDigest: createKnowledgeForwardRevisionApplyJournalDigest(journal),
  });
}

/** Reports whether one exact command expectation still names the supplied active journal. */
export function knowledgeForwardRevisionApplyRecoveryExpectationMatchesJournal(
  expectationValue: unknown,
  journalValue: unknown
): boolean {
  try {
    const expectation = snapshotKnowledgeForwardRevisionApplyRecoveryExpectation(expectationValue);
    const journal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
    if (journal.phase !== "recovery_required") return false;
    const current = createKnowledgeForwardRevisionApplyRecoveryExpectation(journal);
    return (
      expectation.transactionId === current.transactionId &&
      expectation.recoveryJournalDigest === current.recoveryJournalDigest &&
      canonicalizeJson(expectation.acceptedIdentity) === canonicalizeJson(current.acceptedIdentity)
    );
  } catch {
    return false;
  }
}
