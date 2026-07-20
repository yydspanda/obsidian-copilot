import {
  ChangeSetTransaction,
  ChangeSetTransactionBundleConflictError,
  ChangeSetTransactionBusyError,
  ChangeSetTransactionClaimConflictError,
  ChangeSetTransactionIdentityConflictError,
  ChangeSetTransactionIncompatibleVersionError,
  ChangeSetTransactionInfrastructureError,
  ChangeSetTransactionJournalValidationError,
  ChangeSetTransactionManifestIntentValidationError,
  ChangeSetTransactionRecoveryRequiredError,
  ChangeSetTransactionRevisionOverflowError,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ALL_KNOWLEDGE_FILE_MUTATIONS,
  ChangeSetValidator,
  type KnowledgeFileCompareAndSwapResult,
  type KnowledgeFileObservation,
  type KnowledgeFileStore,
  type KnowledgeProjectionValidationInput,
  type SourceArtifactResolver,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  TransactionStorageRevisionConflictError,
  type ChangeSetTransactionJournal,
  type TransactionFileState,
  type TransactionJobClaim,
  type TransactionStorage,
  type TransactionStorageToken,
} from "@/knowledge/changeset/TransactionStorage";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import type { TextArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type {
  ClaimCitation,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceManifest,
} from "@/knowledge/model/types";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const DIRECTORY = Symbol("directory");

type MemoryFileValue = string | typeof DIRECTORY;
type StorageFailure = { revision: number; timing: "before" | "after" };

/** Creates a detached JSON clone for in-memory durability boundaries. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory implementation of the global active-journal CAS contract. */
class MemoryTransactionStorage implements TransactionStorage {
  active: ChangeSetTransactionJournal | null = null;
  writeHistory: ChangeSetTransactionJournal[] = [];
  clearCount = 0;
  failure?: StorageFailure;
  readOverride?: unknown;
  hasReadOverride = false;

  /** Reads a detached active journal or an explicitly injected malformed value. */
  async readActive(): Promise<unknown> {
    return this.hasReadOverride ? cloneJson(this.readOverride) : cloneJson(this.active);
  }

  /** Atomically compares and replaces the active journal for tests. */
  async writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    const actualToken = this.active
      ? { transactionId: this.active.transactionId, revision: this.active.revision }
      : null;
    const matches =
      expectedToken === null
        ? actualToken === null
        : actualToken !== null &&
          actualToken.transactionId === expectedToken.transactionId &&
          actualToken.revision === expectedToken.revision;
    if (!matches) {
      throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
    }

    const failure = this.failure;
    if (failure?.revision === journal.revision && failure.timing === "before") {
      this.failure = undefined;
      throw new Error("simulated crash before durable journal write");
    }
    this.active = cloneJson(journal);
    this.writeHistory.push(cloneJson(journal));
    if (failure?.revision === journal.revision && failure.timing === "after") {
      this.failure = undefined;
      throw new Error("simulated crash after durable journal write");
    }
  }

  /** Atomically compares and clears the active journal for tests. */
  async clearActive(expectedToken: TransactionStorageToken): Promise<void> {
    const actualToken = this.active
      ? { transactionId: this.active.transactionId, revision: this.active.revision }
      : null;
    if (
      !actualToken ||
      actualToken.transactionId !== expectedToken.transactionId ||
      actualToken.revision !== expectedToken.revision
    ) {
      throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
    }
    this.active = null;
    this.clearCount += 1;
  }
}

/** In-memory exact text file store with deterministic failure injection. */
class MemoryKnowledgeFileStore implements KnowledgeFileStore {
  readonly mutationCapabilities = ALL_KNOWLEDGE_FILE_MUTATIONS;
  readonly files = new Map<string, MemoryFileValue>();
  readonly mutations: Array<{ kind: "write" | "delete"; path: string }> = [];
  observeCount = 0;
  observeFailuresRemaining = 0;
  readonly throwBeforeWrite = new Set<string>();
  readonly throwAfterWrite = new Set<string>();
  readonly corruptWrites = new Set<string>();
  readonly compareAndSwapInterference = new Map<string, MemoryFileValue | undefined>();

  /** Observes one exact in-memory path. */
  async observe(path: string): Promise<KnowledgeFileObservation> {
    this.observeCount += 1;
    if (this.observeFailuresRemaining > 0) {
      this.observeFailuresRemaining -= 1;
      throw new Error("simulated observation failure with secret payload");
    }
    return this.readObservation(path);
  }

  /** Atomically compares and replaces one exact path state for tests. */
  async compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    if (this.throwBeforeWrite.delete(path)) {
      throw new Error("simulated file lock before write");
    }
    if (this.compareAndSwapInterference.has(path)) {
      const interference = this.compareAndSwapInterference.get(path);
      this.compareAndSwapInterference.delete(path);
      if (interference === undefined) {
        this.files.delete(path);
      } else {
        this.files.set(path, interference);
      }
    }

    const current = this.readObservation(path);
    if (this.matchesState(current, after)) {
      return { kind: "already_after" };
    }
    if (!this.matchesState(current, before)) {
      return { kind: "conflict", observation: current };
    }

    if (after.kind === "missing") {
      this.mutations.push({ kind: "delete", path });
      this.files.delete(path);
    } else {
      this.mutations.push({ kind: "write", path });
      this.files.set(
        path,
        this.corruptWrites.has(path) ? `${after.content}corrupt` : after.content
      );
    }
    if (this.throwAfterWrite.delete(path)) {
      throw new Error("simulated process failure after write");
    }
    return { kind: "applied" };
  }

  /** Reads one path without triggering observation failure injection. */
  private readObservation(path: string): KnowledgeFileObservation {
    const value = this.files.get(path);
    if (value === undefined) {
      return { kind: "missing" };
    }
    return value === DIRECTORY ? { kind: "directory" } : { kind: "file", content: value };
  }

  /** Compares one in-memory observation with an exact transaction file state. */
  private matchesState(
    observation: KnowledgeFileObservation,
    state: TransactionFileState
  ): boolean {
    if (state.kind === "missing") {
      return observation.kind === "missing";
    }
    return (
      observation.kind === "file" &&
      observation.content === state.content &&
      createFileContentHash(observation.content) === state.contentHash
    );
  }
}

/** Creates the Bundle authorized to write only inside Wiki. */
function createBundle(id = "personal"): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates one complete immutable ingest identity for transaction ownership. */
function createJobClaim(overrides: Partial<TransactionJobClaim> = {}): TransactionJobClaim {
  return {
    jobId: "job-1",
    attempt: 1,
    startedAt: 500,
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: 1,
    ...overrides,
  };
}

/** Creates a materially valid citation for transaction preflight. */
function createCitation(): ClaimCitation {
  const excerpt = "Grounded evidence";
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: SOURCE_HASH,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
    },
  };
}

/** Creates a valid accepted file creation. */
function createFileChange(path: string, content: string): KnowledgeFileChange {
  return {
    id: `change-${path}`,
    operation: "create",
    path,
    sourceRefs: ["source-1"],
    reason: "Create generated Wiki page",
    expectedAbsent: true,
    afterContent: content,
    afterHash: createFileContentHash(content),
  };
}

/** Creates a two-target accepted ChangeSet whose input order differs from apply order. */
function createChangeSet(id = "changeset-1"): KnowledgeChangeSet {
  return {
    id,
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [createFileChange("Wiki/B.md", "# B\n"), createFileChange("Wiki/A.md", "# A\n")],
    citations: [createCitation()],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

/** Creates the final Manifest projection supplied by one accepted review record. */
function createManifestCommitIntent(
  changeSet: KnowledgeChangeSet,
  jobClaim: TransactionJobClaim
): ManifestCommitIntent {
  const manifest: SourceManifest = {
    version: 1,
    bundleId: changeSet.bundleId,
    revision: 0,
    entries: [
      {
        sourceId: jobClaim.sourceId,
        sourceKey: "sources/source.md",
        sourcePath: "Sources/source.md",
        custody: "user_managed",
      },
    ],
  };
  return {
    version: 1,
    kind: "source_compile",
    bundleId: changeSet.bundleId,
    sourceId: jobClaim.sourceId,
    sourceContentHash: jobClaim.sourceContentHash,
    pipelineFingerprint: jobClaim.pipelineFingerprint,
    inputRevision: jobClaim.inputRevision,
    manifestCommitPlanDigest: "e".repeat(64),
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: changeSet.changes
      .filter((change) => change.operation !== "delete")
      .map((change) => ({
        path: change.path,
        ownership: "generated" as const,
        contentHash: change.afterHash,
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
}

/** Creates a validator whose artifact, OKF, and link checks succeed. */
function createValidator(fileStore: KnowledgeFileStore): ChangeSetValidator {
  const artifact: TextArtifactObservation = {
    kind: "text",
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: SOURCE_HASH,
    text: "Grounded evidence",
  };
  const artifactResolver: SourceArtifactResolver = {
    resolve: async () => artifact,
  };
  return new ChangeSetValidator(fileStore, artifactResolver, {
    validate: async (_input: KnowledgeProjectionValidationInput) => ({
      okfValid: true,
      linksValid: true,
      diagnostics: [],
    }),
  });
}

/** Creates a transaction runtime with deterministic clock and unique test ids. */
function createTransaction(
  storage: MemoryTransactionStorage,
  fileStore: MemoryKnowledgeFileStore,
  prefix = "transaction"
): ChangeSetTransaction {
  let timestamp = 1_000;
  let sequence = 0;
  return new ChangeSetTransaction({
    storage,
    fileStore,
    validator: createValidator(fileStore),
    now: () => timestamp++,
    createTransactionId: () => `${prefix}-${++sequence}`,
  });
}

/** Creates the owning queue-attempt input for one ChangeSet. */
function createApplyInput(changeSet = createChangeSet()) {
  const jobClaim = createJobClaim();
  const manifestCommitIntent = createManifestCommitIntent(changeSet, jobClaim);
  return {
    changeSet,
    bundle: createBundle(),
    jobClaim,
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
  };
}

/** Requires and narrows the in-memory active journal to its committed phase. */
function requireCommitted(storage: MemoryTransactionStorage) {
  const active = storage.active;
  if (!active || active.phase !== "committed") {
    throw new Error("Expected a committed active transaction");
  }
  return active;
}

/** Counts file mutations for one target path. */
function countMutations(fileStore: MemoryKnowledgeFileStore, path: string): number {
  return fileStore.mutations.filter((mutation) => mutation.path === path).length;
}

describe("ChangeSetTransaction", () => {
  it("applies create/update/delete targets in Windows-key order and commits last", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.files.set("Wiki/Update.md", "old\r\n");
    files.files.set("Wiki/Delete.md", "obsolete");
    const update: KnowledgeFileChange = {
      id: "change-update",
      operation: "update",
      path: "Wiki/Update.md",
      sourceRefs: ["source-1"],
      reason: "Refresh page",
      beforeHash: createFileContentHash("old\r\n"),
      afterContent: "new\n",
      afterHash: createFileContentHash("new\n"),
    };
    const deletion: KnowledgeFileChange = {
      id: "change-delete",
      operation: "delete",
      path: "Wiki/Delete.md",
      sourceRefs: ["source-1"],
      reason: "Remove obsolete generated page",
      beforeHash: createFileContentHash("obsolete"),
    };
    const changeSet = createChangeSet();
    changeSet.changes = [update, createFileChange("Wiki/Create.md", "created"), deletion];
    const transaction = createTransaction(storage, files);

    const input = createApplyInput(changeSet);
    const receipt = await transaction.apply(input);

    expect(files.mutations).toEqual([
      { kind: "write", path: "Wiki/Create.md" },
      { kind: "delete", path: "Wiki/Delete.md" },
      { kind: "write", path: "Wiki/Update.md" },
    ]);
    expect(files.files.get("Wiki/Create.md")).toBe("created");
    expect(files.files.has("Wiki/Delete.md")).toBe(false);
    expect(files.files.get("Wiki/Update.md")).toBe("new\n");
    expect(requireCommitted(storage).revision).toBe(5);
    expect(storage.writeHistory.at(-1)?.phase).toBe("committed");
    expect(receipt.targets).toEqual([
      { path: "Wiki/Create.md", kind: "file", contentHash: createFileContentHash("created") },
      { path: "Wiki/Delete.md", kind: "missing" },
      { path: "Wiki/Update.md", kind: "file", contentHash: createFileContentHash("new\n") },
    ]);
    expect(receipt.jobClaim).toEqual(input.jobClaim);
    expect(receipt.jobClaim).not.toBe(input.jobClaim);
    expect(requireCommitted(storage).jobClaim).toEqual(input.jobClaim);
  });

  it.each([
    ["before", 0],
    ["after", 0],
    ["before", 1],
    ["after", 1],
    ["before", 2],
    ["after", 2],
    ["before", 3],
    ["after", 3],
    ["before", 4],
    ["after", 4],
  ] as const)(
    "recovers idempotently after a crash %s journal revision %i",
    async (timing, revision) => {
      const storage = new MemoryTransactionStorage();
      storage.failure = { revision, timing };
      const files = new MemoryKnowledgeFileStore();
      const transaction = createTransaction(storage, files, `crash-${timing}-${revision}`);
      const input = createApplyInput();

      await expect(transaction.apply(input)).rejects.toBeInstanceOf(
        ChangeSetTransactionInfrastructureError
      );

      let receipt: TransactionCommitReceipt;
      if (storage.active) {
        const recovered = await transaction.recoverOnStartup(createBundle());
        expect(recovered.kind).toBe("committed");
        if (recovered.kind !== "committed") {
          throw new Error("Expected startup recovery to commit");
        }
        receipt = recovered.receipt;
      } else {
        receipt = await transaction.apply(input);
      }

      expect(receipt.changeSetId).toBe("changeset-1");
      expect(files.files.get("Wiki/A.md")).toBe("# A\n");
      expect(files.files.get("Wiki/B.md")).toBe("# B\n");
      expect(countMutations(files, "Wiki/A.md")).toBe(1);
      expect(countMutations(files, "Wiki/B.md")).toBe(1);
      expect(requireCommitted(storage).appliedCount).toBe(2);
    }
  );

  it("pre-scans every target and writes nothing new when recovery sees an unknown state", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 2, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );
    expect(files.mutations).toEqual([{ kind: "write", path: "Wiki/A.md" }]);
    files.files.set("Wiki/B.md", "user content");
    const mutationCount = files.mutations.length;

    await expect(transaction.recoverOnStartup(createBundle())).rejects.toBeInstanceOf(
      ChangeSetTransactionRecoveryRequiredError
    );

    expect(files.mutations).toHaveLength(mutationCount);
    expect(storage.active).toMatchObject({
      phase: "recovery_required",
      conflicts: [{ path: "Wiki/B.md", code: "file_state_conflict" }],
    });
    await expect(transaction.recoverOnStartup(createBundle())).resolves.toMatchObject({
      kind: "blocked",
      conflicts: [{ path: "Wiki/B.md" }],
    });
  });

  it("never overwrites a user edit that lands between observation and atomic CAS", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.compareAndSwapInterference.set("Wiki/A.md", "concurrent user edit");
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toMatchObject({
      name: "ChangeSetTransactionRecoveryRequiredError",
      conflicts: [{ path: "Wiki/A.md", code: "file_state_conflict" }],
    });

    expect(files.files.get("Wiki/A.md")).toBe("concurrent user edit");
    expect(files.mutations).toEqual([]);
    expect(storage.active?.phase).toBe("recovery_required");
  });

  it("refuses to roll forward after the configured Bundle boundary changes", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 1, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );
    const changedBundle = { ...createBundle(), wikiRoot: "OtherWiki" };

    await expect(transaction.recoverOnStartup(changedBundle)).rejects.toBeInstanceOf(
      ChangeSetTransactionBundleConflictError
    );
    expect(files.mutations).toEqual([]);
  });

  it("persists conflict timestamps safely when the Windows clock moves backwards", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.compareAndSwapInterference.set("Wiki/A.md", "concurrent user edit");
    let clockReads = 0;
    const transaction = new ChangeSetTransaction({
      storage,
      fileStore: files,
      validator: createValidator(files),
      now: () => (clockReads++ === 0 ? 1_000 : 900),
      createTransactionId: () => "backward-clock-transaction",
    });

    await expect(transaction.apply(createApplyInput())).rejects.toBeInstanceOf(
      ChangeSetTransactionRecoveryRequiredError
    );

    expect(storage.active).toMatchObject({
      phase: "recovery_required",
      createdAt: 1_000,
      updatedAt: 1_000,
      conflicts: [{ path: "Wiki/A.md", detectedAt: 1_000 }],
    });
  });

  it("rejects insufficient journal revision capacity before any file mutation", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 1, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );
    const prepared = storage.active;
    if (!prepared || prepared.phase !== "prepared") {
      throw new Error("Expected a durable prepared journal");
    }
    storage.active = {
      ...prepared,
      phase: "applying",
      revision: Number.MAX_SAFE_INTEGER - 1,
    };
    const mutationCount = files.mutations.length;

    await expect(transaction.recoverOnStartup(createBundle())).rejects.toBeInstanceOf(
      ChangeSetTransactionRevisionOverflowError
    );
    expect(files.mutations).toHaveLength(mutationCount);
  });

  it("blocks when an already journaled prefix is reverted by the user", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 2, timing: "after" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );
    expect(storage.active).toMatchObject({ phase: "applying", appliedCount: 1 });
    files.files.delete("Wiki/A.md");

    await expect(transaction.recoverOnStartup(createBundle())).rejects.toMatchObject({
      name: "ChangeSetTransactionRecoveryRequiredError",
      conflicts: [{ path: "Wiki/A.md", code: "file_state_conflict" }],
    });
    expect(countMutations(files, "Wiki/B.md")).toBe(0);
  });

  it("persists recovery_required when a resolved write does not reach after-state", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.corruptWrites.add("Wiki/A.md");
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toMatchObject({
      name: "ChangeSetTransactionRecoveryRequiredError",
      conflicts: [{ path: "Wiki/A.md", code: "post_write_verification_failed" }],
    });

    expect(storage.active?.phase).toBe("recovery_required");
    expect(countMutations(files, "Wiki/B.md")).toBe(0);
  });

  it("leaves a transient pre-write failure recoverable instead of misclassifying it", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.throwBeforeWrite.add("Wiki/A.md");
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toMatchObject({
      name: "ChangeSetTransactionInfrastructureError",
      stage: "file_mutation",
    });
    expect(storage.active?.phase).toBe("applying");

    await expect(transaction.recoverOnStartup(createBundle())).resolves.toMatchObject({
      kind: "committed",
      action: "rolled_forward",
    });
  });

  it("recognizes a write that reached after-state before the adapter threw", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.throwAfterWrite.add("Wiki/A.md");
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).resolves.toMatchObject({
      changeSetId: "changeset-1",
    });
    expect(countMutations(files, "Wiki/A.md")).toBe(1);
    expect(requireCommitted(storage).phase).toBe("committed");
  });

  it("treats a committed marker as authoritative after later user edits", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const receipt = await transaction.apply(createApplyInput());
    const mutationCount = files.mutations.length;
    files.files.set("Wiki/A.md", "later user edit");

    await expect(transaction.recoverOnStartup(createBundle())).resolves.toEqual({
      kind: "committed",
      action: "already_committed",
      receipt,
    });
    expect(files.mutations).toHaveLength(mutationCount);
    expect(files.files.get("Wiki/A.md")).toBe("later user edit");
  });

  it("returns an exact committed receipt even if non-writing Bundle settings later change", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();
    const receipt = await transaction.apply(input);
    const changedBundle = { ...createBundle(), reviewMode: "multi_file" as const };

    await expect(transaction.apply({ ...input, bundle: changedBundle })).resolves.toEqual(receipt);
  });

  it("clears only an exact committed receipt after downstream bookkeeping", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const receipt = await transaction.apply(createApplyInput());

    await expect(
      transaction.acknowledgeCommitted({ ...receipt, changeSetDigest: "f".repeat(64) })
    ).rejects.toBeInstanceOf(ChangeSetTransactionIdentityConflictError);
    expect(storage.active?.phase).toBe("committed");
    await expect(transaction.acknowledgeCommitted(receipt)).resolves.toBe(true);
    await expect(transaction.acknowledgeCommitted(receipt)).resolves.toBe(false);
    expect(storage.clearCount).toBe(1);
  });

  it("rejects a different ChangeSet, changed payload, or job attempt beside an active journal", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 1, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const original = createChangeSet();
    const input = createApplyInput(original);
    await expect(transaction.apply(input)).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );

    await expect(
      transaction.apply(createApplyInput(createChangeSet("changeset-2")))
    ).rejects.toBeInstanceOf(ChangeSetTransactionBusyError);

    const changed = createChangeSet();
    changed.changes[0] = createFileChange("Wiki/B.md", "different");
    await expect(transaction.apply(createApplyInput(changed))).rejects.toBeInstanceOf(
      ChangeSetTransactionIdentityConflictError
    );

    await expect(
      transaction.apply({ ...input, jobClaim: { ...input.jobClaim, attempt: 2 } })
    ).rejects.toBeInstanceOf(ChangeSetTransactionClaimConflictError);
  });

  it("rejects an active claim with matching attempt coordinates but different ingest identity", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 1, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();
    await expect(transaction.apply(input)).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );

    const identityOverrides: Array<Partial<TransactionJobClaim>> = [
      { sourceId: "source-other" },
      { sourceContentHash: "c".repeat(64) },
      { pipelineFingerprint: "d".repeat(64) },
      { inputRevision: 2 },
    ];
    for (const override of identityOverrides) {
      const changedClaim = { ...input.jobClaim, ...override };
      expect(changedClaim).toMatchObject({ jobId: "job-1", attempt: 1, startedAt: 500 });
      await expect(transaction.apply({ ...input, jobClaim: changedClaim })).rejects.toBeInstanceOf(
        ChangeSetTransactionClaimConflictError
      );
    }
  });

  it("rejects a different final Manifest intent beside the same active ChangeSet", async () => {
    const storage = new MemoryTransactionStorage();
    storage.failure = { revision: 1, timing: "before" };
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();
    await expect(transaction.apply(input)).rejects.toBeInstanceOf(
      ChangeSetTransactionInfrastructureError
    );

    const changedIntent: ManifestCommitIntent = {
      ...input.manifestCommitIntent,
      expectedManifestDigest: "f".repeat(64),
    };
    await expect(
      transaction.apply({
        ...input,
        manifestCommitIntent: changedIntent,
        manifestCommitIntentDigest: createManifestCommitIntentDigest(changedIntent),
      })
    ).rejects.toBeInstanceOf(ChangeSetTransactionIdentityConflictError);
    expect(files.mutations).toEqual([]);
  });

  it.each([
    ["source content hash", { sourceContentHash: "c".repeat(64) }],
    ["pipeline fingerprint", { pipelineFingerprint: "d".repeat(64) }],
  ] satisfies Array<[string, Partial<ManifestCommitIntent>]>)(
    "rejects Manifest intent %s drift from the owning claim before persistence or file mutation",
    async (_label, override) => {
      const storage = new MemoryTransactionStorage();
      const files = new MemoryKnowledgeFileStore();
      const transaction = createTransaction(storage, files);
      const input = createApplyInput();
      const manifestCommitIntent = { ...input.manifestCommitIntent, ...override };

      await expect(
        transaction.apply({
          ...input,
          manifestCommitIntent,
          manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
        })
      ).rejects.toBeInstanceOf(ChangeSetTransactionManifestIntentValidationError);
      expect(files.mutations).toEqual([]);
      expect(storage.writeHistory).toEqual([]);
    }
  );

  it("normalizes a structurally valid but semantic-invalid Manifest intent to the typed boundary", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();
    const manifestCommitIntent: ManifestCommitIntent = {
      ...input.manifestCommitIntent,
      generatedPages: [...input.manifestCommitIntent.generatedPages].reverse(),
    };

    await expect(
      transaction.apply({
        ...input,
        manifestCommitIntent,
        manifestCommitIntentDigest: input.manifestCommitIntentDigest,
      })
    ).rejects.toBeInstanceOf(ChangeSetTransactionManifestIntentValidationError);
    expect(files.mutations).toEqual([]);
    expect(storage.writeHistory).toEqual([]);
  });

  it.each([
    ["source content hash", { sourceContentHash: "not-a-hash" }],
    ["pipeline fingerprint", { pipelineFingerprint: "not-a-hash" }],
    ["negative input revision", { inputRevision: -1 }],
    ["unsafe input revision", { inputRevision: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects malformed claim %s before validation or persistence", async (_label, override) => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();

    await expect(
      transaction.apply({ ...input, jobClaim: { ...input.jobClaim, ...override } })
    ).rejects.toBeInstanceOf(TypeError);
    expect(files.observeCount).toBe(0);
    expect(storage.writeHistory).toEqual([]);
    expect(storage.active).toBeNull();
  });

  it("rejects a claim source absent from ChangeSet sourceRefs before any write", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const transaction = createTransaction(storage, files);
    const input = createApplyInput();

    let rejection: unknown;
    try {
      await transaction.apply({
        ...input,
        jobClaim: createJobClaim({ sourceId: "source-other" }),
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(ChangeSetTransactionManifestIntentValidationError);
    if (!(rejection instanceof ChangeSetTransactionManifestIntentValidationError)) {
      throw new Error("Expected Manifest intent validation to reject the source mismatch");
    }
    expect(rejection.diagnostics.map(({ code }) => code)).toContain(
      "transaction_manifest_intent_identity_mismatch"
    );
    expect(files.mutations).toEqual([]);
    expect(storage.writeHistory).toEqual([]);
    expect(storage.active).toBeNull();
  });

  it("fails closed on incompatible or malformed persisted journals before file I/O", async () => {
    const incompatibleStorage = new MemoryTransactionStorage();
    incompatibleStorage.hasReadOverride = true;
    incompatibleStorage.readOverride = { version: 2 };
    const incompatibleFiles = new MemoryKnowledgeFileStore();
    const incompatible = createTransaction(incompatibleStorage, incompatibleFiles);

    await expect(incompatible.recoverOnStartup(createBundle())).rejects.toBeInstanceOf(
      ChangeSetTransactionIncompatibleVersionError
    );
    expect(incompatibleFiles.observeCount).toBe(0);

    const malformedStorage = new MemoryTransactionStorage();
    malformedStorage.hasReadOverride = true;
    malformedStorage.readOverride = { version: 3, transactionId: "broken" };
    const malformedFiles = new MemoryKnowledgeFileStore();
    const malformed = createTransaction(malformedStorage, malformedFiles);

    await expect(malformed.recoverOnStartup(createBundle())).rejects.toBeInstanceOf(
      ChangeSetTransactionJournalValidationError
    );
    expect(malformedFiles.observeCount).toBe(0);
  });

  it("surfaces storage CAS contention without allowing two active transactions", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    const first = createTransaction(storage, files, "first");
    const second = createTransaction(storage, files, "second");
    const firstInput = createApplyInput(createChangeSet("changeset-first"));
    const secondChangeSet = createChangeSet("changeset-second");
    secondChangeSet.changes = [createFileChange("Wiki/C.md", "# C\n")];
    const secondInput = {
      ...createApplyInput(secondChangeSet),
      jobClaim: createJobClaim({ jobId: "job-2" }),
    };

    const results = await Promise.allSettled([first.apply(firstInput), second.apply(secondInput)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(storage.active).not.toBeNull();
    expect(
      results.some(
        (result) =>
          result.status === "rejected" &&
          (result.reason instanceof TransactionStorageRevisionConflictError ||
            result.reason instanceof ChangeSetTransactionBusyError)
      )
    ).toBe(true);
  });

  it("sanitizes storage and file observation failures without persisting raw messages", async () => {
    const storage = new MemoryTransactionStorage();
    const files = new MemoryKnowledgeFileStore();
    files.observeFailuresRemaining = 1;
    const transaction = createTransaction(storage, files);

    await expect(transaction.apply(createApplyInput())).rejects.toEqual(
      expect.objectContaining({
        name: "ChangeSetValidationInfrastructureError",
        stage: "file_observation",
      })
    );
    expect(storage.active).toBeNull();
  });
});
