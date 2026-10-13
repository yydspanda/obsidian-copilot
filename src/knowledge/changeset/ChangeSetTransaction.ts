import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  createManifestCommitIntentDigest,
  getManifestCommitIntentOperation,
  parseManifestCommitIntent,
  validateManifestCommitIntent,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { parseKnowledgeBundleConfig, parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
} from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { sha256 } from "@/utils/hash";

import {
  ChangeSetValidationError,
  type ChangeSetValidator,
  type KnowledgeFileCompareAndSwapResult,
  type KnowledgeFileObservation,
  type KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  TRANSACTION_JOURNAL_VERSION,
  TransactionStorageAuthorityError,
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

export interface ChangeSetTransactionApplyInput {
  changeSet: unknown;
  bundle: unknown;
  jobClaim: TransactionJobClaim;
  manifestCommitIntent: unknown;
  manifestCommitIntentDigest: string;
}

export interface ChangeSetTransactionAuthorityRequest {
  transactionId: string;
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  changeSetDigest: string;
  jobClaim: TransactionJobClaim;
  manifestCommitIntent: ManifestCommitIntent;
  manifestCommitIntentDigest: string;
}

export interface ChangeSetTransactionAuthorityProof {
  readonly minimumTimestamp: number;
}

export interface ChangeSetTransactionAuthorityPort {
  verify(
    request: ChangeSetTransactionAuthorityRequest
  ): Promise<Readonly<ChangeSetTransactionAuthorityProof>>;
}

export type TransactionCommittedTarget =
  | { path: string; kind: "missing" }
  | { path: string; kind: "file"; contentHash: string };

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

export class ChangeSetTransactionManifestIntentValidationError extends Error {
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("The accepted Manifest commit intent is invalid");
    this.name = "ChangeSetTransactionManifestIntentValidationError";
  }
}

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

export interface ChangeSetTransactionDependencies {
  storage: TransactionStorage;
  fileStore: KnowledgeFileStore;
  validator: ChangeSetValidator;
  authority: ChangeSetTransactionAuthorityPort;
  now?: () => number;
  createTransactionId?: () => string;
}

type TargetMutationResult =
  | { kind: "after" }
  | {
      kind: "conflict";
      observation: KnowledgeFileObservation;
      code: TransactionConflict["code"];
    };

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class ChangeSetTransactionJournalValidationError extends Error {
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Active ChangeSet transaction journal is invalid");
    this.name = "ChangeSetTransactionJournalValidationError";
  }
}

export class ChangeSetTransactionIncompatibleVersionError extends Error {
  constructor(public readonly version: unknown) {
    super("Active ChangeSet transaction uses an unsupported version");
    this.name = "ChangeSetTransactionIncompatibleVersionError";
  }
}

export class ChangeSetTransactionBusyError extends Error {
  constructor(
    public readonly activeTransactionId: string,
    public readonly activeChangeSetId: string
  ) {
    super(`Transaction '${activeTransactionId}' must finish before another ChangeSet can apply`);
    this.name = "ChangeSetTransactionBusyError";
  }
}

export class ChangeSetTransactionIdentityConflictError extends Error {
  constructor(public readonly changeSetId: string) {
    super(`ChangeSet '${changeSetId}' no longer matches its active transaction payload`);
    this.name = "ChangeSetTransactionIdentityConflictError";
  }
}

export class ChangeSetTransactionClaimConflictError extends Error {
  constructor(public readonly transactionId: string) {
    super(`Transaction '${transactionId}' belongs to a different ingest-job attempt`);
    this.name = "ChangeSetTransactionClaimConflictError";
  }
}

export class ChangeSetTransactionBundleConflictError extends Error {
  constructor(public readonly bundleId: string) {
    super(`Bundle '${bundleId}' changed while its ChangeSet transaction was active`);
    this.name = "ChangeSetTransactionBundleConflictError";
  }
}

export class ChangeSetTransactionRecoveryRequiredError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly conflicts: readonly TransactionConflict[]
  ) {
    super(`Transaction '${transactionId}' requires explicit recovery`);
    this.name = "ChangeSetTransactionRecoveryRequiredError";
  }
}

export class ChangeSetTransactionRevisionOverflowError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly revision: number
  ) {
    super(`Transaction '${transactionId}' cannot advance beyond revision ${revision}`);
    this.name = "ChangeSetTransactionRevisionOverflowError";
  }
}

export class ChangeSetTransactionInfrastructureError extends Error {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDefaultTransactionId(): string {
  return `knowledge-transaction-${crypto.randomUUID()}`;
}

function assertIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
}

function snapshotAuthorityProof(value: unknown): Readonly<ChangeSetTransactionAuthorityProof> {
  const descriptor = isRecord(value)
    ? Object.getOwnPropertyDescriptor(value, "minimumTimestamp")
    : undefined;
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 1 ||
    !descriptor ||
    !("value" in descriptor)
  ) {
    throw new TypeError("authority proof must contain only minimumTimestamp");
  }
  assertNonNegativeSafeInteger(descriptor.value, "authority.minimumTimestamp");
  return Object.freeze({ minimumTimestamp: descriptor.value as number });
}

function assertSha256(value: unknown, field: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

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

function toStorageToken(journal: ChangeSetTransactionJournal): TransactionStorageToken {
  return { transactionId: journal.transactionId, revision: journal.revision };
}

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

function getActualHash(observation: KnowledgeFileObservation): string | undefined {
  return observation.kind === "file" ? createFileContentHash(observation.content) : undefined;
}

export function createTransactionCommitReceipt(
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

export function transactionCommitReceiptMatchesJournal(
  receipt: TransactionCommitReceipt,
  journal: ChangeSetTransactionJournal & { phase: "committed" }
): boolean {
  return (
    canonicalizeJson(receipt as unknown as JsonValue) ===
    canonicalizeJson(createTransactionCommitReceipt(journal) as unknown as JsonValue)
  );
}

export function createTransactionCommitReceiptDigest(receipt: TransactionCommitReceipt): string {
  return sha256(
    `knowledge-transaction-receipt-v1\n${canonicalizeJson(receipt as unknown as JsonValue)}`
  );
}

function sameBundleConfig(left: KnowledgeBundleConfig, right: KnowledgeBundleConfig): boolean {
  return (
    canonicalizeJson(left as unknown as JsonValue) ===
    canonicalizeJson(right as unknown as JsonValue)
  );
}

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

function parseApplyManifestCommitIntent(
  value: unknown,
  digest: string,
  changeSet: KnowledgeChangeSet,
  bundle: KnowledgeBundleConfig,
  jobClaim: TransactionJobClaim
): ManifestCommitIntent {
  const parsed = parseManifestCommitIntent(value);
  if (!parsed.ok) {
    throw new ChangeSetTransactionManifestIntentValidationError(parsed.issues);
  }
  const validation = validateManifestCommitIntent(parsed.value, bundle);
  const diagnostics = [...validation.diagnostics];
  if (validation.valid && digest !== createManifestCommitIntentDigest(parsed.value)) {
    diagnostics.push({
      code: "transaction_manifest_intent_digest_mismatch",
      severity: "error",
      field: "manifestCommitIntentDigest",
      message: "Manifest intent digest must identify the exact supplied final projection",
    });
  }
  if (
    parsed.value.bundleId !== bundle.id ||
    parsed.value.changeSetId !== changeSet.id ||
    parsed.value.sourceId !== jobClaim.sourceId ||
    parsed.value.sourceContentHash !== jobClaim.sourceContentHash ||
    parsed.value.pipelineFingerprint !== jobClaim.pipelineFingerprint ||
    parsed.value.inputRevision !== jobClaim.inputRevision
  ) {
    diagnostics.push({
      code: "transaction_manifest_intent_identity_mismatch",
      severity: "error",
      field: "manifestCommitIntent",
      message:
        "Manifest intent must match the Bundle, ChangeSet, exact source content, pipeline, and input revision",
    });
  }
  if (changeSet.operation !== getManifestCommitIntentOperation(parsed.value)) {
    diagnostics.push({
      code: "transaction_manifest_intent_operation_mismatch",
      severity: "error",
      field: "changeSet.operation",
      message: "ChangeSet operation must match the exact source-compile Manifest intent",
    });
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new ChangeSetTransactionManifestIntentValidationError(diagnostics);
  }
  return parsed.value;
}

function sameManifestCommitIntent(
  left: ManifestCommitIntent,
  right: ManifestCommitIntent
): boolean {
  return (
    canonicalizeJson(left as unknown as JsonValue) ===
    canonicalizeJson(right as unknown as JsonValue)
  );
}

export class ChangeSetTransaction {
  private readonly storage: TransactionStorage;
  private readonly fileStore: KnowledgeFileStore;
  private readonly validator: ChangeSetValidator;
  private readonly authority: ChangeSetTransactionAuthorityPort;
  private readonly now: () => number;
  private readonly createTransactionId: () => string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: ChangeSetTransactionDependencies) {
    this.storage = dependencies.storage;
    this.fileStore = dependencies.fileStore;
    this.validator = dependencies.validator;
    this.authority = dependencies.authority;
    this.now = dependencies.now ?? Date.now;
    this.createTransactionId = dependencies.createTransactionId ?? createDefaultTransactionId;
  }

  async apply(input: ChangeSetTransactionApplyInput): Promise<TransactionCommitReceipt> {
    assertJobClaim(input.jobClaim);
    return this.runExclusive(async () => {
      const active = await this.readActiveJournal();
      if (active) {
        return this.resumeMatchingApply(active, input);
      }

      const validated = this.validator.validateAcceptedInput(input.changeSet, input.bundle);
      const manifestCommitIntent = parseApplyManifestCommitIntent(
        input.manifestCommitIntent,
        input.manifestCommitIntentDigest,
        validated.changeSet,
        validated.bundle,
        input.jobClaim
      );
      const transactionId = this.createTransactionId();
      assertIdentifier(transactionId, "transactionId");
      const jobClaim: TransactionJobClaim = {
        jobId: input.jobClaim.jobId,
        attempt: input.jobClaim.attempt,
        startedAt: input.jobClaim.startedAt,
        sourceId: input.jobClaim.sourceId,
        sourceContentHash: input.jobClaim.sourceContentHash,
        pipelineFingerprint: input.jobClaim.pipelineFingerprint,
        inputRevision: input.jobClaim.inputRevision,
      };
      const authority = snapshotAuthorityProof(
        await this.authority.verify({
          transactionId,
          bundle: validated.bundle,
          changeSet: validated.changeSet,
          changeSetDigest: validated.changeSetDigest,
          jobClaim,
          manifestCommitIntent,
          manifestCommitIntentDigest: input.manifestCommitIntentDigest,
        })
      );
      const prepared = await this.validator.prepare(validated.changeSet, validated.bundle);
      const createdAt = this.readTimestamp(
        Math.max(input.jobClaim.startedAt, authority.minimumTimestamp)
      );
      const journal: ChangeSetTransactionJournal = {
        version: TRANSACTION_JOURNAL_VERSION,
        transactionId,
        revision: 0,
        bundleId: prepared.bundle.id,
        bundle: prepared.bundle,
        changeSetId: prepared.changeSet.id,
        changeSetDigest: prepared.changeSetDigest,
        manifestCommitIntent,
        manifestCommitIntentDigest: input.manifestCommitIntentDigest,
        jobClaim,
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
      return createTransactionCommitReceipt(committed);
    });
  }

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
          receipt: createTransactionCommitReceipt(journal),
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

      await this.verifyJournalAuthority(journal);
      const committed = await this.rollForward(journal);
      return {
        kind: "committed",
        action: "rolled_forward",
        receipt: createTransactionCommitReceipt(committed),
      };
    });
  }

  async loadActive(): Promise<ChangeSetTransactionJournal | null> {
    return this.runExclusive(() => this.readActiveJournal());
  }

  async acknowledgeCommitted(receipt: TransactionCommitReceipt): Promise<boolean> {
    return this.runExclusive(async () => {
      const journal = await this.readActiveJournal();
      if (!journal) {
        return false;
      }
      if (
        journal.phase !== "committed" ||
        !transactionCommitReceiptMatchesJournal(receipt, journal)
      ) {
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
    const manifestCommitIntent = parseApplyManifestCommitIntent(
      input.manifestCommitIntent,
      input.manifestCommitIntentDigest,
      parsedChangeSet.value,
      active.bundle,
      input.jobClaim
    );
    if (
      input.manifestCommitIntentDigest !== active.manifestCommitIntentDigest ||
      !sameManifestCommitIntent(manifestCommitIntent, active.manifestCommitIntent)
    ) {
      throw new ChangeSetTransactionIdentityConflictError(active.changeSetId);
    }
    if (active.phase === "recovery_required") {
      throw new ChangeSetTransactionRecoveryRequiredError(active.transactionId, active.conflicts);
    }
    if (active.phase === "committed") {
      return createTransactionCommitReceipt(active);
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
    await this.verifyJournalAuthority(active);
    return createTransactionCommitReceipt(await this.rollForward(active));
  }

  private async verifyJournalAuthority(
    journal: ChangeSetTransactionJournal & { phase: "prepared" | "applying" }
  ): Promise<void> {
    await this.authority.verify({
      transactionId: journal.transactionId,
      bundle: journal.bundle,
      changeSet: journal.changeSet,
      changeSetDigest: journal.changeSetDigest,
      jobClaim: journal.jobClaim,
      manifestCommitIntent: journal.manifestCommitIntent,
      manifestCommitIntentDigest: journal.manifestCommitIntentDigest,
    });
  }

  private async readActiveJournal(): Promise<ChangeSetTransactionJournal | null> {
    let raw: unknown;
    try {
      raw = await this.storage.readActive();
    } catch (error) {
      if (error instanceof TransactionStorageAuthorityError) {
        throw error;
      }
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
      if (
        error instanceof TransactionStorageRevisionConflictError ||
        error instanceof TransactionStorageAuthorityError
      ) {
        throw error;
      }
      throw new ChangeSetTransactionInfrastructureError("storage_write");
    }
  }

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

  private async observeAll(
    targets: readonly TransactionTarget[]
  ): Promise<KnowledgeFileObservation[]> {
    try {
      return await Promise.all(targets.map((target) => this.fileStore.observe(target.path)));
    } catch {
      throw new ChangeSetTransactionInfrastructureError("file_observation");
    }
  }

  private async observeOne(path: string): Promise<KnowledgeFileObservation> {
    try {
      return await this.fileStore.observe(path);
    } catch {
      throw new ChangeSetTransactionInfrastructureError("file_observation");
    }
  }

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

  private nextRevision(journal: ChangeSetTransactionJournal): number {
    if (journal.revision === Number.MAX_SAFE_INTEGER) {
      throw new ChangeSetTransactionRevisionOverflowError(journal.transactionId, journal.revision);
    }
    return journal.revision + 1;
  }

  private assertRevisionCapacity(
    journal: ChangeSetTransactionJournal & { phase: "prepared" | "applying" }
  ): void {
    const requiredRevisions =
      (journal.phase === "prepared" ? 1 : 0) + (journal.targets.length - journal.appliedCount) + 1;
    if (journal.revision > Number.MAX_SAFE_INTEGER - requiredRevisions) {
      throw new ChangeSetTransactionRevisionOverflowError(journal.transactionId, journal.revision);
    }
  }

  private readTimestamp(minimum: number): number {
    const timestamp = this.now();
    assertNonNegativeSafeInteger(timestamp, "now");
    return Math.max(timestamp, minimum);
  }
}
