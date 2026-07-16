import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseKnowledgeBundleConfig, parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeDiagnostic,
} from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";

import {
  ChangeSetValidationError,
  type ChangeSetValidator,
  type KnowledgeFileCompareAndSwapResult,
  type KnowledgeFileObservation,
  type KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  TRANSACTION_JOURNAL_VERSION,
  TransactionStorageRevisionConflictError,
  createChangeSetTransactionDigest,
  parseChangeSetTransactionJournal,
  validateChangeSetTransactionJournal,
  type ChangeSetTransactionJournal,
  type TransactionConflict,
  type TransactionFileState,
  type TransactionJobClaim,
  type TransactionStorage,
  type TransactionStorageToken,
  type TransactionTarget,
} from "@/knowledge/changeset/TransactionStorage";

/** Claim and knowledge payload required to begin a recoverable apply. */
export interface ChangeSetTransactionApplyInput {
  changeSet: unknown;
  bundle: unknown;
  jobClaim: TransactionJobClaim;
}

/** Content-addressed final state safe to copy into manifest bookkeeping. */
export type TransactionCommittedTarget =
  | { path: string; kind: "missing" }
  | { path: string; kind: "file"; contentHash: string };

/** Durable proof that all file after-states preceded the commit marker. */
export interface TransactionCommitReceipt {
  transactionId: string;
  commitRevision: number;
  bundleId: string;
  changeSetId: string;
  changeSetDigest: string;
  jobClaim: TransactionJobClaim;
  committedAt: number;
  targets: TransactionCommittedTarget[];
}

/** Startup result for the Vault-global transaction slot. */
export type TransactionRecoveryResult =
  | { kind: "none" }
  | {
      kind: "committed";
      action: "already_committed" | "rolled_forward";
      receipt: TransactionCommitReceipt;
    }
  | {
      kind: "blocked";
      transactionId: string;
      bundleId: string;
      changeSetId: string;
      conflicts: readonly TransactionConflict[];
    };

/** Constructor dependencies for a pure, adapter-driven transaction runtime. */
export interface ChangeSetTransactionDependencies {
  storage: TransactionStorage;
  fileStore: KnowledgeFileStore;
  validator: ChangeSetValidator;
  now?: () => number;
  createTransactionId?: () => string;
}

/** Internal result of one target-level atomic compare-and-swap attempt. */
type TargetMutationResult =
  | { kind: "after" }
  | {
      kind: "conflict";
      observation: KnowledgeFileObservation;
      code: TransactionConflict["code"];
    };

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Reports persisted journal JSON that cannot satisfy the current contract. */
export class ChangeSetTransactionJournalValidationError extends Error {
  /**
   * Creates a fail-closed journal validation error.
   *
   * @param diagnostics - Safe structural or semantic diagnostics
   */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Active ChangeSet transaction journal is invalid");
    this.name = "ChangeSetTransactionJournalValidationError";
  }
}

/** Reports a persisted journal version that this runtime cannot migrate safely. */
export class ChangeSetTransactionIncompatibleVersionError extends Error {
  /**
   * Creates an incompatible journal version failure.
   *
   * @param version - Unknown persisted version value
   */
  constructor(public readonly version: unknown) {
    super("Active ChangeSet transaction uses an unsupported version");
    this.name = "ChangeSetTransactionIncompatibleVersionError";
  }
}

/** Reports a different transaction occupying the Vault-global active slot. */
export class ChangeSetTransactionBusyError extends Error {
  /**
   * Creates a global active-slot conflict.
   *
   * @param activeTransactionId - Transaction currently occupying the slot
   * @param activeChangeSetId - ChangeSet owned by the active transaction
   */
  constructor(
    public readonly activeTransactionId: string,
    public readonly activeChangeSetId: string
  ) {
    super(`Transaction '${activeTransactionId}' must finish before another ChangeSet can apply`);
    this.name = "ChangeSetTransactionBusyError";
  }
}

/** Reports reuse of one ChangeSet id with a different exact payload. */
export class ChangeSetTransactionIdentityConflictError extends Error {
  /**
   * Creates a ChangeSet digest conflict.
   *
   * @param changeSetId - Reused ChangeSet identifier
   */
  constructor(public readonly changeSetId: string) {
    super(`ChangeSet '${changeSetId}' no longer matches its active transaction payload`);
    this.name = "ChangeSetTransactionIdentityConflictError";
  }
}

/** Reports an active transaction owned by another durable job attempt. */
export class ChangeSetTransactionClaimConflictError extends Error {
  /**
   * Creates an owning job-claim conflict.
   *
   * @param transactionId - Active transaction identifier
   */
  constructor(public readonly transactionId: string) {
    super(`Transaction '${transactionId}' belongs to a different ingest-job attempt`);
    this.name = "ChangeSetTransactionClaimConflictError";
  }
}

/** Reports a changed Bundle boundary beside an unfinished transaction. */
export class ChangeSetTransactionBundleConflictError extends Error {
  /**
   * Creates a Bundle configuration drift failure.
   *
   * @param bundleId - Bundle whose durable write boundary changed
   */
  constructor(public readonly bundleId: string) {
    super(`Bundle '${bundleId}' changed while its ChangeSet transaction was active`);
    this.name = "ChangeSetTransactionBundleConflictError";
  }
}

/** Reports file state that automatic roll-forward must never overwrite. */
export class ChangeSetTransactionRecoveryRequiredError extends Error {
  /**
   * Creates a sticky recovery-required failure.
   *
   * @param transactionId - Blocked transaction identifier
   * @param conflicts - Safe content-addressed conflict details
   */
  constructor(
    public readonly transactionId: string,
    public readonly conflicts: readonly TransactionConflict[]
  ) {
    super(`Transaction '${transactionId}' requires explicit recovery`);
    this.name = "ChangeSetTransactionRecoveryRequiredError";
  }
}

/** Reports revision exhaustion before JavaScript integer precision can be lost. */
export class ChangeSetTransactionRevisionOverflowError extends Error {
  /**
   * Creates a safe-integer revision overflow failure.
   *
   * @param transactionId - Transaction whose revision cannot advance
   * @param revision - Last safely represented revision
   */
  constructor(
    public readonly transactionId: string,
    public readonly revision: number
  ) {
    super(`Transaction '${transactionId}' cannot advance beyond revision ${revision}`);
    this.name = "ChangeSetTransactionRevisionOverflowError";
  }
}

/** Reports unavailable storage or file I/O without persisting raw error text. */
export class ChangeSetTransactionInfrastructureError extends Error {
  /**
   * Creates a sanitized transaction infrastructure failure.
   *
   * @param stage - Durable or file I/O stage that did not complete reliably
   */
  constructor(
    public readonly stage:
      | "storage_read"
      | "storage_write"
      | "storage_clear"
      | "file_observation"
      | "file_mutation"
  ) {
    super(`ChangeSet transaction infrastructure failed during ${stage}`);
    this.name = "ChangeSetTransactionInfrastructureError";
  }
}

/**
 * Checks whether an unknown value is a non-array record.
 *
 * @param value - Runtime value to inspect
 * @returns Whether named fields can be read safely
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Creates a globally unique default transaction identifier.
 *
 * @returns UUID-backed transaction identifier
 */
function createDefaultTransactionId(): string {
  return `knowledge-transaction-${crypto.randomUUID()}`;
}

/**
 * Requires a non-whitespace identifier at an orchestration boundary.
 *
 * @param value - Identifier supplied by a caller or injected factory
 * @param field - Field name used by the error message
 */
function assertIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * Requires one non-negative safe integer.
 *
 * @param value - Runtime numeric input
 * @param field - Field name used by the error message
 */
function assertNonNegativeSafeInteger(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
}

/**
 * Requires one canonical lowercase SHA-256 digest.
 *
 * @param value - Runtime hash supplied by the queue claim
 * @param field - Field name used by the error message
 */
function assertSha256(value: unknown, field: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

/**
 * Validates the durable job attempt that owns a new transaction.
 *
 * @param claim - Caller-supplied queue claim
 */
function assertJobClaim(claim: unknown): asserts claim is TransactionJobClaim {
  if (!isRecord(claim)) {
    throw new TypeError("jobClaim must be an object");
  }
  assertIdentifier(claim.jobId, "jobClaim.jobId");
  if (
    typeof claim.attempt !== "number" ||
    !Number.isSafeInteger(claim.attempt) ||
    claim.attempt <= 0
  ) {
    throw new TypeError("jobClaim.attempt must be a positive safe integer");
  }
  assertNonNegativeSafeInteger(claim.startedAt, "jobClaim.startedAt");
  assertIdentifier(claim.sourceId, "jobClaim.sourceId");
  assertSha256(claim.sourceContentHash, "jobClaim.sourceContentHash");
  assertSha256(claim.pipelineFingerprint, "jobClaim.pipelineFingerprint");
  assertNonNegativeSafeInteger(claim.inputRevision, "jobClaim.inputRevision");
}

/**
 * Compares exact durable job-attempt ownership.
 *
 * @param left - First job claim
 * @param right - Second job claim
 * @returns Whether both claims identify the same attempt
 */
function sameJobClaim(left: TransactionJobClaim, right: TransactionJobClaim): boolean {
  return (
    left.jobId === right.jobId &&
    left.attempt === right.attempt &&
    left.startedAt === right.startedAt &&
    left.sourceId === right.sourceId &&
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.inputRevision === right.inputRevision
  );
}

/**
 * Creates the ABA-safe token for one parsed active journal.
 *
 * @param journal - Current active journal
 * @returns Exact transaction id and revision token
 */
function toStorageToken(journal: ChangeSetTransactionJournal): TransactionStorageToken {
  return { transactionId: journal.transactionId, revision: journal.revision };
}

/**
 * Compares an exact file observation with a journaled file state.
 *
 * @param observation - Current Vault path observation
 * @param expected - Journaled missing or exact file state
 * @returns Whether the states match byte-for-byte text semantics
 */
function observationMatchesState(
  observation: KnowledgeFileObservation,
  expected: TransactionFileState
): boolean {
  if (expected.kind === "missing") {
    return observation.kind === "missing";
  }
  return (
    observation.kind === "file" &&
    observation.content === expected.content &&
    createFileContentHash(observation.content) === expected.contentHash
  );
}

/**
 * Computes a safe actual hash for conflict diagnostics.
 *
 * @param observation - Current Vault path observation
 * @returns Exact content hash for files, otherwise undefined
 */
function getActualHash(observation: KnowledgeFileObservation): string | undefined {
  return observation.kind === "file" ? createFileContentHash(observation.content) : undefined;
}

/**
 * Creates the public receipt for one committed journal.
 *
 * @param journal - Valid committed journal
 * @returns Detached content-addressed commit proof
 */
function createCommitReceipt(
  journal: ChangeSetTransactionJournal & { phase: "committed" }
): TransactionCommitReceipt {
  return {
    transactionId: journal.transactionId,
    commitRevision: journal.revision,
    bundleId: journal.bundleId,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    jobClaim: { ...journal.jobClaim },
    committedAt: journal.committedAt,
    targets: journal.targets.map((target) =>
      target.after.kind === "missing"
        ? { path: target.path, kind: "missing" as const }
        : {
            path: target.path,
            kind: "file" as const,
            contentHash: target.after.contentHash,
          }
    ),
  };
}

/**
 * Canonically compares a supplied receipt with its active committed journal.
 *
 * @param receipt - Caller-supplied durable commit proof
 * @param journal - Current committed journal
 * @returns Whether every receipt field matches the journal-derived proof
 */
function receiptMatchesJournal(
  receipt: TransactionCommitReceipt,
  journal: ChangeSetTransactionJournal & { phase: "committed" }
): boolean {
  return (
    canonicalizeJson(receipt as unknown as JsonValue) ===
    canonicalizeJson(createCommitReceipt(journal) as unknown as JsonValue)
  );
}

/**
 * Compares exact versioned Bundle configurations deterministically.
 *
 * @param left - First validated Bundle configuration
 * @param right - Second validated Bundle configuration
 * @returns Whether every write-boundary field is identical
 */
function sameBundleConfig(left: KnowledgeBundleConfig, right: KnowledgeBundleConfig): boolean {
  return (
    canonicalizeJson(left as unknown as JsonValue) ===
    canonicalizeJson(right as unknown as JsonValue)
  );
}

/**
 * Parses and semantically validates a Bundle supplied for transaction recovery.
 *
 * @param value - Current configured Bundle value
 * @returns Strictly parsed valid Bundle
 */
function parseRecoveryBundle(value: unknown): KnowledgeBundleConfig {
  const parsed = parseKnowledgeBundleConfig(value);
  if (!parsed.ok) {
    throw new ChangeSetValidationError(parsed.issues);
  }
  const validation = validateKnowledgeBundleConfig(parsed.value);
  if (!validation.valid) {
    throw new ChangeSetValidationError(validation.diagnostics);
  }
  return parsed.value;
}

/** Vault-global durable ChangeSet transaction runtime. */
export class ChangeSetTransaction {
  private readonly storage: TransactionStorage;
  private readonly fileStore: KnowledgeFileStore;
  private readonly validator: ChangeSetValidator;
  private readonly now: () => number;
  private readonly createTransactionId: () => string;
  private operationTail: Promise<void> = Promise.resolve();

  /**
   * Creates a transaction runtime with injected durable and Vault adapters.
   *
   * @param dependencies - Storage, file, validation, clock, and id dependencies
   */
  constructor(dependencies: ChangeSetTransactionDependencies) {
    this.storage = dependencies.storage;
    this.fileStore = dependencies.fileStore;
    this.validator = dependencies.validator;
    this.now = dependencies.now ?? Date.now;
    this.createTransactionId = dependencies.createTransactionId ?? createDefaultTransactionId;
  }

  /**
   * Validates, journals, and idempotently applies one accepted ChangeSet.
   *
   * The returned receipt exists only after every after-state was re-observed and
   * the committed marker became durable. Callers must then durably update the
   * manifest and queue before acknowledging the receipt.
   *
   * @param input - ChangeSet, Bundle boundary, and owning queue attempt
   * @returns Durable commit receipt
   */
  async apply(input: ChangeSetTransactionApplyInput): Promise<TransactionCommitReceipt> {
    assertJobClaim(input.jobClaim);
    return this.runExclusive(async () => {
      const active = await this.readActiveJournal();
      if (active) {
        return this.resumeMatchingApply(active, input);
      }

      const prepared = await this.validator.prepare(input.changeSet, input.bundle);
      const transactionId = this.createTransactionId();
      assertIdentifier(transactionId, "transactionId");
      const createdAt = this.readTimestamp(input.jobClaim.startedAt);
      const journal: ChangeSetTransactionJournal = {
        version: TRANSACTION_JOURNAL_VERSION,
        transactionId,
        revision: 0,
        bundleId: prepared.bundle.id,
        bundle: prepared.bundle,
        changeSetId: prepared.changeSet.id,
        changeSetDigest: prepared.changeSetDigest,
        jobClaim: { ...input.jobClaim },
        changeSet: prepared.changeSet,
        targets: prepared.targets.map((target) => ({
          ...target,
          before: { ...target.before },
          after: { ...target.after },
        })),
        appliedCount: 0,
        createdAt,
        updatedAt: createdAt,
        phase: "prepared",
      };
      await this.writeJournal(journal, null);
      const committed = await this.rollForward(journal);
      return createCommitReceipt(committed);
    });
  }

  /**
   * Recovers the one active journal without requiring the original ChangeSet input.
   *
   * Prepared and applying journals roll forward only when every target is still
   * exactly before or after. A committed marker is authoritative and is never
   * replayed merely because a user later edits its output.
   *
   * @param bundleValue - Current configured Bundle used to re-prove write boundaries
   * @returns No work, durable committed proof, or sticky conflict details
   */
  async recoverOnStartup(bundleValue: unknown): Promise<TransactionRecoveryResult> {
    return this.runExclusive(async () => {
      const journal = await this.readActiveJournal();
      if (!journal) {
        return { kind: "none" };
      }
      if (journal.phase === "committed") {
        return {
          kind: "committed",
          action: "already_committed",
          receipt: createCommitReceipt(journal),
        };
      }
      if (journal.phase === "recovery_required") {
        return {
          kind: "blocked",
          transactionId: journal.transactionId,
          bundleId: journal.bundleId,
          changeSetId: journal.changeSetId,
          conflicts: journal.conflicts.map((conflict) => ({ ...conflict })),
        };
      }

      const currentBundle = parseRecoveryBundle(bundleValue);
      if (!sameBundleConfig(currentBundle, journal.bundle)) {
        throw new ChangeSetTransactionBundleConflictError(journal.bundleId);
      }

      const committed = await this.rollForward(journal);
      return {
        kind: "committed",
        action: "rolled_forward",
        receipt: createCommitReceipt(committed),
      };
    });
  }

  /**
   * Reads and validates the current active journal without mutating files.
   *
   * @returns Detached active journal, or null for an empty slot
   */
  async loadActive(): Promise<ChangeSetTransactionJournal | null> {
    return this.runExclusive(() => this.readActiveJournal());
  }

  /**
   * Clears a committed journal after manifest and queue success are durable.
   *
   * Calling this method before downstream bookkeeping completes violates the
   * recovery protocol. An empty slot is treated as an idempotent prior success.
   *
   * @param receipt - Exact receipt returned by apply or startup recovery
   * @returns Whether this call cleared the active slot
   */
  async acknowledgeCommitted(receipt: TransactionCommitReceipt): Promise<boolean> {
    return this.runExclusive(async () => {
      const journal = await this.readActiveJournal();
      if (!journal) {
        return false;
      }
      if (journal.phase !== "committed" || !receiptMatchesJournal(receipt, journal)) {
        throw new ChangeSetTransactionIdentityConflictError(receipt.changeSetId);
      }
      try {
        await this.storage.clearActive(toStorageToken(journal));
      } catch (error) {
        if (error instanceof TransactionStorageRevisionConflictError) {
          throw error;
        }
        throw new ChangeSetTransactionInfrastructureError("storage_clear");
      }
      return true;
    });
  }

  /**
   * Serializes operations within one runtime instance.
   *
   * Cross-instance safety remains the responsibility of the storage adapter's
   * atomic transaction-id plus revision compare-and-swap.
   *
   * @param work - Exclusive async operation
   * @returns Work result after preceding local operations finish
   */
  private async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release: () => void = () => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  /**
   * Resumes only an exact active ChangeSet and job claim.
   *
   * @param active - Parsed active journal
   * @param input - Caller apply request
   * @returns Existing or newly committed receipt
   */
  private async resumeMatchingApply(
    active: ChangeSetTransactionJournal,
    input: ChangeSetTransactionApplyInput
  ): Promise<TransactionCommitReceipt> {
    const parsedChangeSet = parseKnowledgeChangeSet(input.changeSet);
    if (!parsedChangeSet.ok) {
      throw new ChangeSetValidationError(parsedChangeSet.issues);
    }

    if (parsedChangeSet.value.id !== active.changeSetId) {
      throw new ChangeSetTransactionBusyError(active.transactionId, active.changeSetId);
    }
    if (createChangeSetTransactionDigest(parsedChangeSet.value) !== active.changeSetDigest) {
      throw new ChangeSetTransactionIdentityConflictError(active.changeSetId);
    }
    if (!sameJobClaim(active.jobClaim, input.jobClaim)) {
      throw new ChangeSetTransactionClaimConflictError(active.transactionId);
    }
    if (active.phase === "recovery_required") {
      throw new ChangeSetTransactionRecoveryRequiredError(active.transactionId, active.conflicts);
    }
    if (active.phase === "committed") {
      return createCommitReceipt(active);
    }

    const parsedBundle = parseKnowledgeBundleConfig(input.bundle);
    if (!parsedBundle.ok) {
      throw new ChangeSetValidationError(parsedBundle.issues);
    }
    if (parsedBundle.value.id !== active.bundleId) {
      throw new ChangeSetTransactionBusyError(active.transactionId, active.changeSetId);
    }
    const bundleValidation = validateKnowledgeBundleConfig(parsedBundle.value);
    if (!bundleValidation.valid) {
      throw new ChangeSetValidationError(bundleValidation.diagnostics);
    }
    if (!sameBundleConfig(parsedBundle.value, active.bundle)) {
      throw new ChangeSetTransactionBundleConflictError(active.bundleId);
    }
    return createCommitReceipt(await this.rollForward(active));
  }

  /**
   * Loads strict persisted JSON and rejects malformed or incompatible journals.
   *
   * @returns Parsed active journal, or null when the slot is empty
   */
  private async readActiveJournal(): Promise<ChangeSetTransactionJournal | null> {
    let raw: unknown;
    try {
      raw = await this.storage.readActive();
    } catch {
      throw new ChangeSetTransactionInfrastructureError("storage_read");
    }
    if (raw === null) {
      return null;
    }
    if (isRecord(raw) && "version" in raw && raw.version !== TRANSACTION_JOURNAL_VERSION) {
      throw new ChangeSetTransactionIncompatibleVersionError(raw.version);
    }
    const validation = validateChangeSetTransactionJournal(raw);
    if (!validation.valid) {
      throw new ChangeSetTransactionJournalValidationError(validation.diagnostics);
    }
    const parsed = parseChangeSetTransactionJournal(raw);
    if (!parsed.ok) {
      throw new ChangeSetTransactionJournalValidationError(parsed.issues);
    }
    return parsed.value;
  }

  /**
   * Persists one complete journal revision after validating runtime invariants.
   *
   * @param journal - Complete next journal state
   * @param expected - Previous journal, or null for global slot creation
   */
  private async writeJournal(
    journal: ChangeSetTransactionJournal,
    expected: ChangeSetTransactionJournal | null
  ): Promise<void> {
    const validation = validateChangeSetTransactionJournal(journal);
    if (!validation.valid) {
      throw new ChangeSetTransactionJournalValidationError(validation.diagnostics);
    }
    try {
      await this.storage.writeActive(journal, expected ? toStorageToken(expected) : null);
    } catch (error) {
      if (error instanceof TransactionStorageRevisionConflictError) {
        throw error;
      }
      throw new ChangeSetTransactionInfrastructureError("storage_write");
    }
  }

  /**
   * Applies or verifies every target and then durably commits the journal.
   *
   * @param initial - Prepared or applying journal
   * @returns Durable committed journal
   */
  private async rollForward(
    initial: ChangeSetTransactionJournal & { phase: "prepared" | "applying" }
  ): Promise<ChangeSetTransactionJournal & { phase: "committed" }> {
    this.assertRevisionCapacity(initial);
    let journal: ChangeSetTransactionJournal & { phase: "applying" } =
      initial.phase === "prepared" ? await this.persistApplying(initial) : initial;

    const scan = await this.observeAll(journal.targets);
    const scanConflicts = this.findRollForwardConflicts(journal, scan);
    if (scanConflicts.length > 0) {
      await this.blockRecovery(journal, scanConflicts);
    }

    for (let index = 0; index < journal.targets.length; index += 1) {
      const target = journal.targets[index];
      const observation = await this.observeOne(target.path);
      if (index < journal.appliedCount) {
        if (!observationMatchesState(observation, target.after)) {
          await this.blockRecovery(journal, [this.createConflict(target, observation)]);
        }
        continue;
      }

      if (observationMatchesState(observation, target.after)) {
        journal = await this.persistProgress(journal, index + 1);
        continue;
      }
      if (!observationMatchesState(observation, target.before)) {
        await this.blockRecovery(journal, [this.createConflict(target, observation)]);
      }

      const mutation = await this.mutateTarget(target);
      if (mutation.kind === "conflict") {
        await this.blockRecovery(journal, [
          this.createConflict(target, mutation.observation, mutation.code),
        ]);
      }
      journal = await this.persistProgress(journal, index + 1);
    }

    const finalObservations = await this.observeAll(journal.targets);
    const finalConflicts = journal.targets.flatMap((target, index) =>
      observationMatchesState(finalObservations[index], target.after)
        ? []
        : [this.createConflict(target, finalObservations[index], "post_write_verification_failed")]
    );
    if (finalConflicts.length > 0) {
      await this.blockRecovery(journal, finalConflicts);
    }

    return this.persistCommitted(journal);
  }

  /**
   * Marks a prepared journal as applying before any file mutation.
   *
   * @param journal - Durable prepared journal
   * @returns Durable applying journal
   */
  private async persistApplying(
    journal: ChangeSetTransactionJournal & { phase: "prepared" }
  ): Promise<ChangeSetTransactionJournal & { phase: "applying" }> {
    const next: ChangeSetTransactionJournal & { phase: "applying" } = {
      ...journal,
      phase: "applying",
      revision: this.nextRevision(journal),
      updatedAt: this.readTimestamp(journal.updatedAt),
    };
    await this.writeJournal(next, journal);
    return next;
  }

  /**
   * Persists one verified prefix advance.
   *
   * @param journal - Current applying journal
   * @param appliedCount - Newly verified prefix length
   * @returns Durable applying journal revision
   */
  private async persistProgress(
    journal: ChangeSetTransactionJournal & { phase: "applying" },
    appliedCount: number
  ): Promise<ChangeSetTransactionJournal & { phase: "applying" }> {
    if (appliedCount <= journal.appliedCount) {
      return journal;
    }
    const next: ChangeSetTransactionJournal & { phase: "applying" } = {
      ...journal,
      appliedCount,
      revision: this.nextRevision(journal),
      updatedAt: this.readTimestamp(journal.updatedAt),
    };
    await this.writeJournal(next, journal);
    return next;
  }

  /**
   * Persists the commit marker after final after-state verification.
   *
   * @param journal - Applying journal with a fully verified prefix
   * @returns Durable committed journal
   */
  private async persistCommitted(
    journal: ChangeSetTransactionJournal & { phase: "applying" }
  ): Promise<ChangeSetTransactionJournal & { phase: "committed" }> {
    const committedAt = this.readTimestamp(journal.updatedAt);
    const next: ChangeSetTransactionJournal & { phase: "committed" } = {
      ...journal,
      phase: "committed",
      appliedCount: journal.targets.length,
      revision: this.nextRevision(journal),
      updatedAt: committedAt,
      committedAt,
    };
    await this.writeJournal(next, journal);
    return next;
  }

  /**
   * Persists a sticky recovery gate and always throws its typed failure.
   *
   * @param journal - Current applying journal
   * @param conflicts - One or more exact state conflicts
   */
  private async blockRecovery(
    journal: ChangeSetTransactionJournal & { phase: "applying" },
    conflicts: TransactionConflict[]
  ): Promise<never> {
    const minimumTimestamp = Math.max(journal.createdAt, journal.updatedAt);
    const normalizedConflicts = conflicts.map((conflict) => ({
      ...conflict,
      detectedAt: Math.max(conflict.detectedAt, minimumTimestamp),
    }));
    const updatedAt = Math.max(
      this.readTimestamp(journal.updatedAt),
      ...normalizedConflicts.map((conflict) => conflict.detectedAt)
    );
    const blocked: ChangeSetTransactionJournal & { phase: "recovery_required" } = {
      ...journal,
      phase: "recovery_required",
      revision: this.nextRevision(journal),
      updatedAt,
      conflicts: normalizedConflicts,
    };
    await this.writeJournal(blocked, journal);
    throw new ChangeSetTransactionRecoveryRequiredError(journal.transactionId, normalizedConflicts);
  }

  /**
   * Observes every target concurrently while retaining deterministic order.
   *
   * @param targets - Deterministically sorted transaction targets
   * @returns Current observations in target order
   */
  private async observeAll(
    targets: readonly TransactionTarget[]
  ): Promise<KnowledgeFileObservation[]> {
    try {
      return await Promise.all(targets.map((target) => this.fileStore.observe(target.path)));
    } catch {
      throw new ChangeSetTransactionInfrastructureError("file_observation");
    }
  }

  /**
   * Observes one target with sanitized infrastructure handling.
   *
   * @param path - Validated Vault-relative path
   * @returns Current exact state
   */
  private async observeOne(path: string): Promise<KnowledgeFileObservation> {
    try {
      return await this.fileStore.observe(path);
    } catch {
      throw new ChangeSetTransactionInfrastructureError("file_observation");
    }
  }

  /**
   * Finds conflicts before a recovery attempt performs any new file write.
   *
   * @param journal - Current applying journal
   * @param observations - One current observation per sorted target
   * @returns All detected conflicts in deterministic target order
   */
  private findRollForwardConflicts(
    journal: ChangeSetTransactionJournal & { phase: "applying" },
    observations: readonly KnowledgeFileObservation[]
  ): TransactionConflict[] {
    const conflicts: TransactionConflict[] = [];
    journal.targets.forEach((target, index) => {
      const observation = observations[index];
      const isAfter = observationMatchesState(observation, target.after);
      const canStillApply =
        index >= journal.appliedCount && observationMatchesState(observation, target.before);
      if (!isAfter && !canStillApply) {
        conflicts.push(this.createConflict(target, observation));
      }
    });
    return conflicts;
  }

  /**
   * Atomically applies one target and resolves ambiguous adapter errors by re-observation.
   *
   * @param target - Current deterministic transaction target
   * @returns Verified after-state or a non-mutating conflict observation
   */
  private async mutateTarget(target: TransactionTarget): Promise<TargetMutationResult> {
    let result: KnowledgeFileCompareAndSwapResult;
    try {
      result = await this.fileStore.compareAndSwap(target.path, target.before, target.after);
    } catch {
      const observation = await this.observeOne(target.path);
      if (observationMatchesState(observation, target.after)) {
        return { kind: "after" };
      }
      if (observationMatchesState(observation, target.before)) {
        throw new ChangeSetTransactionInfrastructureError("file_mutation");
      }
      return { kind: "conflict", observation, code: "file_state_conflict" };
    }

    if (result.kind === "conflict") {
      return {
        kind: "conflict",
        observation: result.observation,
        code: "file_state_conflict",
      };
    }
    const observation = await this.observeOne(target.path);
    return observationMatchesState(observation, target.after)
      ? { kind: "after" }
      : {
          kind: "conflict",
          observation,
          code: "post_write_verification_failed",
        };
  }

  /**
   * Creates one safe content-addressed conflict record.
   *
   * @param target - Journaled transaction target
   * @param observation - Unexpected current Vault state
   * @param code - Stable conflict classification
   * @returns Persistable conflict without raw file content
   */
  private createConflict(
    target: TransactionTarget,
    observation: KnowledgeFileObservation,
    code: TransactionConflict["code"] = "file_state_conflict"
  ): TransactionConflict {
    const actualHash = getActualHash(observation);
    return {
      path: target.path,
      code,
      detectedAt: this.readTimestamp(0),
      ...(actualHash === undefined ? {} : { actualHash }),
    };
  }

  /**
   * Advances a journal revision without exceeding safe-integer precision.
   *
   * @param journal - Current active journal
   * @returns Next exact revision
   */
  private nextRevision(journal: ChangeSetTransactionJournal): number {
    if (journal.revision === Number.MAX_SAFE_INTEGER) {
      throw new ChangeSetTransactionRevisionOverflowError(journal.transactionId, journal.revision);
    }
    return journal.revision + 1;
  }

  /**
   * Reserves enough exact revisions to reach a commit marker before file I/O.
   *
   * Every uncounted target may require one progress write, the prepared phase
   * needs one applying marker, and the final state always needs one commit
   * marker. Rejecting up front prevents a file mutation that the journal can no
   * longer record safely.
   *
   * @param journal - Prepared or applying journal about to roll forward
   */
  private assertRevisionCapacity(
    journal: ChangeSetTransactionJournal & { phase: "prepared" | "applying" }
  ): void {
    const requiredRevisions =
      (journal.phase === "prepared" ? 1 : 0) + (journal.targets.length - journal.appliedCount) + 1;
    if (journal.revision > Number.MAX_SAFE_INTEGER - requiredRevisions) {
      throw new ChangeSetTransactionRevisionOverflowError(journal.transactionId, journal.revision);
    }
  }

  /**
   * Reads a nondecreasing safe timestamp from the injected clock.
   *
   * @param minimum - Earliest allowed timestamp
   * @returns Safe timestamp not preceding the supplied minimum
   */
  private readTimestamp(minimum: number): number {
    const timestamp = this.now();
    assertNonNegativeSafeInteger(timestamp, "now");
    return Math.max(timestamp, minimum);
  }
}
