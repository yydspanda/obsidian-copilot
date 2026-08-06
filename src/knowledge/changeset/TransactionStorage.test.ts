import {
  TRANSACTION_JOURNAL_VERSION,
  TransactionStorageRevisionConflictError,
  createChangeSetTransactionDigest,
  parseChangeSetTransactionJournal,
  validateChangeSetTransactionJournal,
  type ChangeSetTransactionJournal,
  type TransactionJobClaim,
  type TransactionStorage,
  type TransactionStorageToken,
  type TransactionTarget,
} from "@/knowledge/changeset/TransactionStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceManifest,
} from "@/knowledge/model/types";

const OLD_B = "# Old B\n";
const OLD_C = "# Old C\n";
const NEW_A = "# New A\n";
const NEW_B = "# New B\n";
const SOURCE_CONTENT_HASH = "a".repeat(64);
const PIPELINE_FINGERPRINT = "b".repeat(64);

/** Creates the validated Bundle whose boundaries are persisted for recovery. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates the complete immutable ingest identity persisted by the transaction. */
function createJobClaim(overrides: Partial<TransactionJobClaim> = {}): TransactionJobClaim {
  return {
    jobId: "job-1",
    attempt: 1,
    startedAt: 150,
    sourceId: "source-1",
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: 7,
    ...overrides,
  };
}

/** Creates the accepted create, update, and delete operations used by journal tests. */
function createChanges(): KnowledgeFileChange[] {
  return [
    {
      id: "change-a",
      operation: "create",
      path: "Wiki/A.md",
      sourceRefs: ["source-1"],
      reason: "Create generated page",
      expectedAbsent: true,
      afterContent: NEW_A,
      afterHash: createFileContentHash(NEW_A),
    },
    {
      id: "change-b",
      operation: "update",
      path: "Wiki/B.md",
      sourceRefs: ["source-1"],
      reason: "Update generated page",
      beforeHash: createFileContentHash(OLD_B),
      afterContent: NEW_B,
      afterHash: createFileContentHash(NEW_B),
    },
    {
      id: "change-c",
      operation: "delete",
      path: "Wiki/C.md",
      sourceRefs: ["source-1"],
      reason: "Delete generated page",
      beforeHash: createFileContentHash(OLD_C),
    },
  ];
}

/** Creates a complete accepted ChangeSet with affirmative deterministic validation. */
function createChangeSet(): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: createChanges(),
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

/** Creates the exact final Manifest projection bound to the accepted test ChangeSet. */
function createManifestCommitIntent(
  changeSet: KnowledgeChangeSet = createChangeSet()
): ManifestCommitIntent {
  const manifest: SourceManifest = {
    version: 1,
    bundleId: changeSet.bundleId,
    revision: 0,
    entries: [
      {
        sourceId: "source-1",
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
    sourceId: "source-1",
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: PIPELINE_FINGERPRINT,
    inputRevision: 7,
    manifestCommitPlanDigest: "c".repeat(64),
    changeSetId: changeSet.id,
    expectedManifestRevision: manifest.revision,
    expectedManifestDigest: createSourceManifestDigest(manifest),
    generatedPages: changeSet.changes
      .filter((change) => change.operation !== "delete")
      .map((change) => ({
        path: change.path,
        ownership: "generated" as const,
        contentHash: change.afterHash,
      })),
  };
}

/** Creates deterministic transaction targets with exact pre- and post-state content. */
function createTargets(): TransactionTarget[] {
  return [
    {
      changeId: "change-a",
      path: "Wiki/A.md",
      windowsPathKey: "wiki/a.md",
      operation: "create",
      before: { kind: "missing" },
      after: { kind: "file", content: NEW_A, contentHash: createFileContentHash(NEW_A) },
    },
    {
      changeId: "change-b",
      path: "Wiki/B.md",
      windowsPathKey: "wiki/b.md",
      operation: "update",
      before: { kind: "file", content: OLD_B, contentHash: createFileContentHash(OLD_B) },
      after: { kind: "file", content: NEW_B, contentHash: createFileContentHash(NEW_B) },
    },
    {
      changeId: "change-c",
      path: "Wiki/C.md",
      windowsPathKey: "wiki/c.md",
      operation: "delete",
      before: { kind: "file", content: OLD_C, contentHash: createFileContentHash(OLD_C) },
      after: { kind: "missing" },
    },
  ];
}

/** Creates a valid prepared journal at its initial persisted revision. */
function createPreparedJournal(): ChangeSetTransactionJournal {
  const bundle = createBundle();
  const changeSet = createChangeSet();
  const manifestCommitIntent = createManifestCommitIntent(changeSet);
  return {
    version: TRANSACTION_JOURNAL_VERSION,
    transactionId: "transaction-1",
    revision: 0,
    bundleId: changeSet.bundleId,
    bundle,
    changeSetId: changeSet.id,
    changeSetDigest: createChangeSetTransactionDigest(changeSet),
    manifestCommitIntent,
    manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    jobClaim: createJobClaim(),
    changeSet,
    targets: createTargets(),
    phase: "prepared",
    appliedCount: 0,
    createdAt: 200,
    updatedAt: 200,
  };
}

/** Returns the diagnostic codes emitted by semantic journal validation. */
function diagnosticCodes(value: unknown): string[] {
  return validateChangeSetTransactionJournal(value).diagnostics.map(({ code }) => code);
}

/** Creates the ABA-safe token for one journal revision. */
function createToken(journal: ChangeSetTransactionJournal): TransactionStorageToken {
  return { transactionId: journal.transactionId, revision: journal.revision };
}

/** Compares both fields of a transaction storage token. */
function tokensEqual(
  left: TransactionStorageToken | null,
  right: TransactionStorageToken | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.transactionId === right.transactionId &&
      left.revision === right.revision)
  );
}

/** Reference in-memory adapter used to exercise the documented atomic CAS contract. */
class InMemoryTransactionStorage implements TransactionStorage {
  private active: ChangeSetTransactionJournal | null = null;

  /** Reads the one global active slot. */
  async readActive(): Promise<unknown> {
    return this.active;
  }

  /** Atomically compares and replaces the complete in-memory journal. */
  async writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    const actualToken = this.active ? createToken(this.active) : null;
    const validCreate = expectedToken === null && actualToken === null && journal.revision === 0;
    const validUpdate =
      expectedToken !== null &&
      tokensEqual(expectedToken, actualToken) &&
      journal.transactionId === expectedToken.transactionId &&
      journal.revision === expectedToken.revision + 1;
    if (!validCreate && !validUpdate) {
      throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
    }
    this.active = journal;
  }

  /** Atomically compares and clears the complete in-memory journal. */
  async clearActive(expectedToken: TransactionStorageToken): Promise<void> {
    const actualToken = this.active ? createToken(this.active) : null;
    if (!tokensEqual(expectedToken, actualToken)) {
      throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
    }
    this.active = null;
  }
}

describe("parseChangeSetTransactionJournal", () => {
  it("round-trips every legal discriminated phase", () => {
    const prepared = createPreparedJournal();
    const applying: ChangeSetTransactionJournal = {
      ...prepared,
      phase: "applying",
      revision: 1,
      appliedCount: 2,
      updatedAt: 220,
    };
    const committed: ChangeSetTransactionJournal = {
      ...applying,
      phase: "committed",
      revision: 2,
      appliedCount: applying.targets.length,
      committedAt: 230,
      updatedAt: 230,
    };
    const recoveryRequired: ChangeSetTransactionJournal = {
      ...applying,
      phase: "recovery_required",
      revision: 2,
      conflicts: [
        {
          path: "Wiki/C.md",
          code: "file_state_conflict",
          detectedAt: 230,
          actualHash: "f".repeat(64),
        },
      ],
      updatedAt: 230,
    };

    for (const journal of [prepared, applying, committed, recoveryRequired]) {
      expect(parseChangeSetTransactionJournal(journal)).toEqual({ ok: true, value: journal });
      expect(validateChangeSetTransactionJournal(journal)).toEqual({
        valid: true,
        diagnostics: [],
      });
    }
    expect(parseChangeSetTransactionJournal(prepared)).toMatchObject({
      ok: true,
      value: { jobClaim: createJobClaim() },
    });
  });

  it.each([
    ["legacy version", { ...createPreparedJournal(), version: 2 }],
    ["future version", { ...createPreparedJournal(), version: 4 }],
    ["root extension", { ...createPreparedJournal(), extension: true }],
    [
      "nested target extension",
      {
        ...createPreparedJournal(),
        targets: [{ ...createPreparedJournal().targets[0], extension: true }],
      },
    ],
    [
      "embedded ChangeSet extension",
      {
        ...createPreparedJournal(),
        changeSet: { ...createPreparedJournal().changeSet, extension: true },
      },
    ],
    [
      "embedded Bundle extension",
      {
        ...createPreparedJournal(),
        bundle: { ...createPreparedJournal().bundle, extension: true },
      },
    ],
    ["unsafe revision", { ...createPreparedJournal(), revision: Number.MAX_SAFE_INTEGER + 1 }],
    ["zero attempt", { ...createPreparedJournal(), jobClaim: createJobClaim({ attempt: 0 }) }],
    [
      "legacy partial job claim",
      {
        ...createPreparedJournal(),
        jobClaim: { jobId: "job-1", attempt: 1, startedAt: 150 },
      },
    ],
    [
      "malformed source content hash",
      {
        ...createPreparedJournal(),
        jobClaim: createJobClaim({ sourceContentHash: "not-a-hash" }),
      },
    ],
    [
      "malformed pipeline fingerprint",
      {
        ...createPreparedJournal(),
        jobClaim: createJobClaim({ pipelineFingerprint: "not-a-hash" }),
      },
    ],
    [
      "negative input revision",
      { ...createPreparedJournal(), jobClaim: createJobClaim({ inputRevision: -1 }) },
    ],
    [
      "unsafe input revision",
      {
        ...createPreparedJournal(),
        jobClaim: createJobClaim({ inputRevision: Number.MAX_SAFE_INTEGER + 1 }),
      },
    ],
    ["prepared committed field", { ...createPreparedJournal(), committedAt: 200 }],
    [
      "empty recovery conflicts",
      { ...createPreparedJournal(), phase: "recovery_required", conflicts: [] },
    ],
    [
      "unknown conflict code",
      {
        ...createPreparedJournal(),
        phase: "recovery_required",
        conflicts: [{ path: "Wiki/A.md", code: "unknown", detectedAt: 200 }],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseChangeSetTransactionJournal(value).ok).toBe(false);
  });
});

describe("validateChangeSetTransactionJournal", () => {
  it("accepts a source-backed query-writeback intent and rejects operation drift", () => {
    const base = createPreparedJournal();
    const changeSet: KnowledgeChangeSet = {
      ...base.changeSet,
      operation: "query_writeback",
    };
    const manifestCommitIntent: ManifestCommitIntent = {
      ...base.manifestCommitIntent,
      kind: "query_writeback_source_compile",
      sourceOriginDigest: "d".repeat(64),
    };
    const queryJournal: ChangeSetTransactionJournal = {
      ...base,
      changeSet,
      changeSetDigest: createChangeSetTransactionDigest(changeSet),
      manifestCommitIntent,
      manifestCommitIntentDigest: createManifestCommitIntentDigest(manifestCommitIntent),
    };

    expect(validateChangeSetTransactionJournal(queryJournal)).toEqual({
      valid: true,
      diagnostics: [],
    });
    expect(
      diagnosticCodes({
        ...queryJournal,
        changeSet: { ...queryJournal.changeSet, operation: "lint_fix" },
        changeSetDigest: createChangeSetTransactionDigest({
          ...queryJournal.changeSet,
          operation: "lint_fix",
        }),
      })
    ).toContain("transaction_manifest_intent_operation_mismatch");
  });

  it("validates journal, claim, commit, and conflict timestamps", () => {
    const prepared = createPreparedJournal();
    expect(diagnosticCodes({ ...prepared, updatedAt: 199 })).toContain(
      "transaction_timestamp_order_invalid"
    );
    expect(
      diagnosticCodes({ ...prepared, jobClaim: { ...prepared.jobClaim, startedAt: 201 } })
    ).toContain("transaction_claim_timestamp_invalid");

    const committed = {
      ...prepared,
      phase: "committed",
      appliedCount: prepared.targets.length,
      committedAt: 201,
    };
    expect(diagnosticCodes(committed)).toContain("transaction_committed_timestamp_invalid");

    const recovery = {
      ...prepared,
      phase: "recovery_required",
      conflicts: [{ path: "Wiki/A.md", code: "file_state_conflict", detectedAt: 199 }],
    };
    expect(diagnosticCodes(recovery)).toContain("transaction_conflict_timestamp_invalid");
  });

  it("requires the immutable ingest source to be declared by the ChangeSet", () => {
    const prepared = createPreparedJournal();
    expect(
      diagnosticCodes({
        ...prepared,
        jobClaim: createJobClaim({ sourceId: "source-other" }),
      })
    ).toContain("transaction_claim_source_ref_unknown");
  });

  it("binds the final Manifest intent to the exact source content and pipeline claim", () => {
    const prepared = createPreparedJournal();

    expect(
      diagnosticCodes({
        ...prepared,
        jobClaim: createJobClaim({ sourceContentHash: "c".repeat(64) }),
      })
    ).toContain("transaction_manifest_intent_claim_mismatch");
    expect(
      diagnosticCodes({
        ...prepared,
        jobClaim: createJobClaim({ pipelineFingerprint: "d".repeat(64) }),
      })
    ).toContain("transaction_manifest_intent_claim_mismatch");
  });

  it("validates progress for every terminally meaningful phase", () => {
    const prepared = createPreparedJournal();
    expect(diagnosticCodes({ ...prepared, appliedCount: 1 })).toContain(
      "transaction_prepared_progress_invalid"
    );
    expect(diagnosticCodes({ ...prepared, phase: "applying", appliedCount: 4 })).toContain(
      "transaction_applied_count_invalid"
    );
    expect(
      diagnosticCodes({
        ...prepared,
        phase: "committed",
        committedAt: 200,
        appliedCount: 2,
      })
    ).toContain("transaction_committed_progress_invalid");
  });

  it("requires journal ids and digest to identify the exact accepted ChangeSet", () => {
    const prepared = createPreparedJournal();
    expect(diagnosticCodes({ ...prepared, bundleId: "other" })).toContain(
      "transaction_bundle_mismatch"
    );
    expect(diagnosticCodes({ ...prepared, changeSetId: "other" })).toContain(
      "transaction_changeset_id_mismatch"
    );
    expect(diagnosticCodes({ ...prepared, changeSetDigest: "f".repeat(64) })).toContain(
      "transaction_changeset_digest_mismatch"
    );
  });

  it("returns diagnostics instead of throwing for a structurally valid noncanonical intent", () => {
    const prepared = createPreparedJournal();
    const noncanonical = {
      ...prepared,
      manifestCommitIntent: {
        ...prepared.manifestCommitIntent,
        generatedPages: [...prepared.manifestCommitIntent.generatedPages].reverse(),
      },
    };

    expect(() => validateChangeSetTransactionJournal(noncanonical)).not.toThrow();
    expect(diagnosticCodes(noncanonical)).toContain("manifest_commit_pages_not_canonical");
  });

  it("requires the persisted Bundle identity to match the journal", () => {
    const prepared = createPreparedJournal();
    expect(diagnosticCodes({ ...prepared, bundle: { ...prepared.bundle, id: "other" } })).toContain(
      "transaction_bundle_config_mismatch"
    );
  });

  it("revalidates the complete persisted Bundle contract", () => {
    const prepared = createPreparedJournal();
    expect(
      diagnosticCodes({ ...prepared, bundle: { ...prepared.bundle, sourceRoots: ["Wiki"] } })
    ).toContain("source_wiki_overlap");
  });

  it("reapplies persisted Bundle boundaries and rejects a Raw Source target", () => {
    const prepared = createPreparedJournal();
    const rawChange: KnowledgeFileChange = {
      ...prepared.changeSet.changes[0],
      path: "Sources/raw.md",
    };
    const changeSet: KnowledgeChangeSet = {
      ...prepared.changeSet,
      changes: [rawChange, ...prepared.changeSet.changes.slice(1)],
    };
    const targets: TransactionTarget[] = [
      {
        ...prepared.targets[0],
        path: rawChange.path,
        windowsPathKey: "sources/raw.md",
      },
      ...prepared.targets.slice(1),
    ];
    expect(
      diagnosticCodes({
        ...prepared,
        changeSet,
        changeSetDigest: createChangeSetTransactionDigest(changeSet),
        targets,
      })
    ).toEqual(expect.arrayContaining(["change_path_outside_wiki", "change_path_inside_source"]));
  });

  it("requires an accepted ChangeSet with affirmative validation", () => {
    const prepared = createPreparedJournal();
    const proposed = { ...prepared.changeSet, status: "proposed" };
    expect(
      diagnosticCodes({
        ...prepared,
        changeSet: proposed,
        changeSetDigest: createChangeSetTransactionDigest(proposed as KnowledgeChangeSet),
      })
    ).toContain("transaction_changeset_not_accepted");

    const invalid = {
      ...prepared.changeSet,
      validation: { ...prepared.changeSet.validation, linksValid: false },
    };
    expect(
      diagnosticCodes({
        ...prepared,
        changeSet: invalid,
        changeSetDigest: createChangeSetTransactionDigest(invalid),
      })
    ).toContain("transaction_changeset_validation_invalid");
  });

  it("checks each captured file state's exact content hash", () => {
    const prepared = createPreparedJournal();
    const targets = prepared.targets.map((target, index) =>
      index === 1
        ? {
            ...target,
            before: { kind: "file" as const, content: OLD_B, contentHash: "f".repeat(64) },
          }
        : target
    );
    expect(diagnosticCodes({ ...prepared, targets })).toContain(
      "transaction_file_state_hash_mismatch"
    );
  });

  it("requires one deterministic strictly sorted target per accepted change", () => {
    const prepared = createPreparedJournal();
    expect(diagnosticCodes({ ...prepared, targets: prepared.targets.slice(0, 2) })).toEqual(
      expect.arrayContaining([
        "transaction_target_count_mismatch",
        "transaction_change_target_missing",
      ])
    );

    const reversed = [...prepared.targets].reverse();
    expect(diagnosticCodes({ ...prepared, targets: reversed })).toContain(
      "transaction_target_order_invalid"
    );

    const duplicated = [prepared.targets[0], prepared.targets[0], prepared.targets[2]];
    expect(diagnosticCodes({ ...prepared, targets: duplicated })).toEqual(
      expect.arrayContaining([
        "transaction_target_order_invalid",
        "transaction_target_change_duplicate",
        "transaction_change_target_missing",
      ])
    );
  });

  it("requires the exact normalized Windows path key", () => {
    const prepared = createPreparedJournal();
    const targets = prepared.targets.map((target, index) =>
      index === 0 ? { ...target, windowsPathKey: "Wiki/A.md" } : target
    );
    expect(diagnosticCodes({ ...prepared, targets })).toContain(
      "transaction_windows_path_key_mismatch"
    );
  });

  it.each([
    ["path", { path: "Wiki/Other.md" }, "transaction_target_path_mismatch"],
    ["operation", { operation: "update" }, "transaction_target_operation_mismatch"],
    [
      "before state",
      {
        before: {
          kind: "file",
          content: "unexpected",
          contentHash: createFileContentHash("unexpected"),
        },
      },
      "transaction_target_before_mismatch",
    ],
    ["after state", { after: { kind: "missing" } }, "transaction_target_after_mismatch"],
  ])("rejects target %s drift from the accepted operation", (_label, patch, code) => {
    const prepared = createPreparedJournal();
    const targets = prepared.targets.map((target, index) =>
      index === 0 ? { ...target, ...patch } : target
    );
    expect(diagnosticCodes({ ...prepared, targets })).toContain(code);
  });

  it("checks update before hashes and delete post-states", () => {
    const prepared = createPreparedJournal();
    const targets = prepared.targets.map((target, index) => {
      if (index === 1) {
        const different = "different";
        return {
          ...target,
          before: {
            kind: "file" as const,
            content: different,
            contentHash: createFileContentHash(different),
          },
        };
      }
      return index === 2
        ? {
            ...target,
            after: {
              kind: "file" as const,
              content: "left",
              contentHash: createFileContentHash("left"),
            },
          }
        : target;
    });
    expect(diagnosticCodes({ ...prepared, targets })).toEqual(
      expect.arrayContaining([
        "transaction_target_before_mismatch",
        "transaction_target_after_mismatch",
      ])
    );
  });

  it("requires recovery conflicts to identify exact transaction targets", () => {
    const prepared = createPreparedJournal();
    const recovery = {
      ...prepared,
      phase: "recovery_required",
      conflicts: [
        {
          path: "Wiki/Unknown.md",
          code: "post_write_verification_failed",
          detectedAt: 200,
        },
      ],
    };
    expect(diagnosticCodes(recovery)).toContain("transaction_conflict_target_unknown");
  });
});

describe("TransactionStorage CAS contract", () => {
  it("rejects stale revision updates and enforces a one-step revision advance", async () => {
    const storage = new InMemoryTransactionStorage();
    const prepared = createPreparedJournal();
    await storage.writeActive(prepared, null);

    const applying: ChangeSetTransactionJournal = {
      ...prepared,
      phase: "applying",
      revision: 1,
      updatedAt: 201,
    };
    await storage.writeActive(applying, createToken(prepared));

    await expect(storage.writeActive(applying, createToken(prepared))).rejects.toBeInstanceOf(
      TransactionStorageRevisionConflictError
    );
    await expect(
      storage.writeActive({ ...applying, revision: 3 }, createToken(applying))
    ).rejects.toBeInstanceOf(TransactionStorageRevisionConflictError);
  });

  it("uses transactionId with revision so a delayed clear cannot cause ABA deletion", async () => {
    const storage = new InMemoryTransactionStorage();
    const first = createPreparedJournal();
    const staleToken = createToken(first);
    await storage.writeActive(first, null);
    await storage.clearActive(staleToken);

    const second: ChangeSetTransactionJournal = {
      ...createPreparedJournal(),
      transactionId: "transaction-2",
    };
    await storage.writeActive(second, null);

    await expect(storage.clearActive(staleToken)).rejects.toMatchObject({
      name: "TransactionStorageRevisionConflictError",
      expectedToken: staleToken,
      actualToken: createToken(second),
    });
    await expect(storage.readActive()).resolves.toEqual(second);
  });

  it("rejects creation over an occupied global slot", async () => {
    const storage = new InMemoryTransactionStorage();
    const journal = createPreparedJournal();
    await storage.writeActive(journal, null);

    await expect(
      storage.writeActive({ ...journal, transactionId: "transaction-2" }, null)
    ).rejects.toBeInstanceOf(TransactionStorageRevisionConflictError);
  });
});
