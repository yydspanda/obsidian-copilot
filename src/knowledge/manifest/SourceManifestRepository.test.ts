import {
  SourceManifestBundleMismatchError,
  SourceManifestIdentityConflictError,
  SourceManifestIncompatibleVersionError,
  SourceManifestObservationConflictError,
  SourceManifestRepository,
  SourceManifestRevisionOverflowError,
  SourceManifestValidationError,
  SourceManifestWriteConflictExhaustedError,
} from "@/knowledge/manifest/SourceManifestRepository";
import {
  SourceManifestRevisionConflictError,
  type SourceManifestStorage,
} from "@/knowledge/manifest/SourceManifestStorage";
import {
  KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY,
  createKnowledgeNoChangesCommitMarker,
  createNoChangesManifestCommitPlan,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import { KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY } from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import type {
  JsonValue,
  SourceCompileFailure,
  SourceCompileSnapshot,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

interface PlannedWriteFailure {
  error: Error;
  beforeThrow?: () => void;
}

/**
 * Clones a JSON-compatible persisted value so tests cannot share references
 * with the fake storage accidentally.
 *
 * @param value - JSON-compatible value to detach
 * @returns Structurally equal detached value
 */
function clonePersistedValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePersistedValue(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clonePersistedValue(nested)])
    );
  }
  throw new TypeError("Fake manifest storage accepts only JSON-compatible values");
}

/**
 * Creates a valid source entry with a Windows comparison key.
 *
 * @param sourceId - Stable source identifier
 * @param sourcePath - Canonical Vault-relative path
 * @param overrides - Optional contract fields to replace
 * @returns Valid source manifest entry
 */
function createEntry(
  sourceId = "source-1",
  sourcePath = "Sources/Note.md",
  overrides: Partial<SourceManifestEntry> = {}
): SourceManifestEntry {
  return {
    sourceId,
    sourcePath,
    sourceKey: toWindowsPathKey(sourcePath),
    custody: "user_managed",
    ...overrides,
  };
}

/**
 * Creates a valid manifest suitable for seeding the in-memory adapter.
 *
 * @param bundleId - Bundle identity declared by the manifest
 * @param overrides - Optional fields to replace
 * @returns Valid source manifest
 */
function createManifest(
  bundleId = "personal",
  overrides: Partial<SourceManifest> = {}
): SourceManifest {
  return {
    version: 1,
    bundleId,
    revision: 0,
    entries: [],
    ...overrides,
  };
}

/**
 * Creates a valid successful compile snapshot.
 *
 * @param overrides - Optional snapshot fields to replace
 * @returns Valid committed compile state
 */
function createSnapshot(overrides: Partial<SourceCompileSnapshot> = {}): SourceCompileSnapshot {
  return {
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    generatedPages: [
      {
        path: "Wiki/Concepts/Note.md",
        ownership: "generated",
        contentHash: HASH_C,
      },
    ],
    changeSetId: "changeset-1",
    completedAt: 100,
    ...overrides,
  };
}

/**
 * Creates a valid failed compile observation.
 *
 * @param overrides - Optional failed-attempt fields to replace
 * @returns Serializable failed compile state
 */
function createFailure(overrides: Partial<SourceCompileFailure> = {}): SourceCompileFailure {
  return {
    sourceContentHash: HASH_C,
    pipelineFingerprint: HASH_B,
    failure: {
      code: "provider_timeout",
      message: "The provider timed out",
      retryable: true,
      occurredAt: 200,
    },
    ...overrides,
  };
}

/** Creates a JSON-safe explicit zero-page no-change marker. */
function createNoChangesExtension(inputRevision = 1): Record<string, JsonValue> {
  const plan = createNoChangesManifestCommitPlan({
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision,
    compileContextDigest: HASH_A,
    analysisDigest: HASH_B,
    evidenceDigest: HASH_C,
    reason: "analysis_no_targets",
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_A,
    baseGeneratedPages: [],
    sourceAuthority: { operation: "ingest" },
  });
  const marker = createKnowledgeNoChangesCommitMarker({
    plan,
    jobClaim: {
      jobId: "job-no-changes",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision,
      attempt: 1,
      startedAt: 100,
    },
    completedAt: 101,
    manifestAfterRevision: 1,
  });
  return { [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: marker as unknown as JsonValue };
}

/**
 * JSON-only in-memory storage that enforces the Source Manifest CAS contract.
 */
class InMemorySourceManifestStorage implements SourceManifestStorage {
  private readonly values = new Map<string, unknown>();
  private readonly plannedWriteFailures: PlannedWriteFailure[] = [];

  public readCount = 0;
  public writeAttempts = 0;
  public successfulWrites = 0;
  public readonly writtenManifests: SourceManifest[] = [];

  /**
   * Seeds unknown persisted JSON without invoking repository validation.
   *
   * @param bundleId - Storage key to populate
   * @param value - Unknown JSON value returned by subsequent reads
   */
  seed(bundleId: string, value: unknown): void {
    this.values.set(bundleId, clonePersistedValue(value));
  }

  /**
   * Returns detached raw storage state for assertions.
   *
   * @param bundleId - Storage key to inspect
   * @returns Persisted JSON or null when absent
   */
  getStored(bundleId: string): unknown {
    const value = this.values.get(bundleId);
    return value === undefined ? null : clonePersistedValue(value);
  }

  /**
   * Plans one write failure, optionally changing storage just before it throws.
   *
   * @param error - Exact error thrown by the next write attempt
   * @param beforeThrow - Optional concurrent storage mutation
   */
  planWriteFailure(error: Error, beforeThrow?: () => void): void {
    this.plannedWriteFailures.push({ error, ...(beforeThrow ? { beforeThrow } : {}) });
  }

  /**
   * Reads a detached JSON value without creating missing storage eagerly.
   *
   * @param bundleId - Storage key to read
   * @returns Detached persisted value or null
   */
  async read(bundleId: string): Promise<unknown> {
    this.readCount += 1;
    const value = this.values.get(bundleId);
    return value === undefined ? null : clonePersistedValue(value);
  }

  /**
   * Persists a detached manifest only when the expected revision still matches.
   *
   * @param bundleId - Storage key to update
   * @param manifest - Complete proposed manifest
   * @param expectedRevision - Revision observed by the repository
   */
  async write(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    this.writeAttempts += 1;
    const plannedFailure = this.plannedWriteFailures.shift();
    if (plannedFailure) {
      plannedFailure.beforeThrow?.();
      throw plannedFailure.error;
    }

    const current = this.values.get(bundleId);
    if (expectedRevision === null) {
      if (current !== undefined) {
        throw new SourceManifestRevisionConflictError(bundleId, expectedRevision);
      }
    } else {
      const currentRevision =
        typeof current === "object" && current !== null && "revision" in current
          ? (current as { revision?: unknown }).revision
          : undefined;
      if (currentRevision !== expectedRevision) {
        throw new SourceManifestRevisionConflictError(bundleId, expectedRevision);
      }
    }

    const detachedManifest = clonePersistedValue(manifest);
    const parsedManifest = parseSourceManifest(detachedManifest);
    if (!parsedManifest.ok) {
      throw new Error("Repository passed an invalid manifest to fake storage");
    }
    this.values.set(bundleId, detachedManifest);
    this.writtenManifests.push(parsedManifest.value);
    this.successfulWrites += 1;
  }
}

describe("SourceManifestRepository", () => {
  it("loads an empty manifest without eagerly creating storage", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);

    await expect(repository.load("personal")).resolves.toEqual({
      version: 1,
      bundleId: "personal",
      revision: 0,
      entries: [],
    });
    expect(storage.readCount).toBe(1);
    expect(storage.writeAttempts).toBe(0);
    expect(storage.getStored("personal")).toBeNull();
  });

  it("registers a source and reloads it from a new repository instance", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);

    const registered = await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/研究笔记.md",
      custody: "managed_copy",
      extensions: { importer: "manual" },
    });

    expect(registered).toEqual({
      sourceId: "source-1",
      sourcePath: "Sources/研究笔记.md",
      sourceKey: toWindowsPathKey("Sources/研究笔记.md"),
      custody: "managed_copy",
      extensions: { importer: "manual" },
    });
    await expect(new SourceManifestRepository(storage).load("personal")).resolves.toEqual({
      version: 1,
      bundleId: "personal",
      revision: 1,
      entries: [registered],
    });
    expect(storage.successfulWrites).toBe(1);
  });

  it("treats an identical registration as an idempotent no-op", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const registration = {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed" as const,
    };

    const first = await repository.registerSource("personal", registration);
    const second = await repository.registerSource("personal", registration);

    expect(second).toEqual(first);
    expect(storage.writeAttempts).toBe(1);
    expect((await repository.load("personal")).revision).toBe(1);
  });

  it("rejects a reused source id and a case-insensitive Windows path collision", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });

    await expect(
      repository.registerSource("personal", {
        sourceId: "source-1",
        sourcePath: "Sources/Another.md",
        custody: "user_managed",
      })
    ).rejects.toBeInstanceOf(SourceManifestIdentityConflictError);
    await expect(
      repository.registerSource("personal", {
        sourceId: "source-2",
        sourcePath: "sources/NOTE.md",
        custody: "user_managed",
      })
    ).rejects.toBeInstanceOf(SourceManifestIdentityConflictError);
    expect(storage.writeAttempts).toBe(1);
  });

  it("renames a source without changing its sourceId, extensions, or compile history", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const snapshot = createSnapshot();
    const failure = createFailure();
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
      extensions: { origin: { kind: "drop-folder" } },
    });
    await repository.recordSuccessfulCompile("personal", "source-1", snapshot);
    await repository.recordFailedCompile("personal", "source-1", failure);

    const renamed = await repository.renameSource("personal", "source-1", "Archive/Note.md");
    const casingOnlyRename = await repository.renameSource(
      "personal",
      "source-1",
      "archive/note.md"
    );

    expect(renamed).toMatchObject({
      sourceId: "source-1",
      sourcePath: "Archive/Note.md",
      sourceKey: toWindowsPathKey("Archive/Note.md"),
      lastSuccessful: snapshot,
      lastFailure: failure,
      extensions: { origin: { kind: "drop-folder" } },
    });
    expect(casingOnlyRename).toMatchObject({
      sourceId: "source-1",
      sourcePath: "archive/note.md",
      sourceKey: toWindowsPathKey("archive/note.md"),
      lastSuccessful: snapshot,
      lastFailure: failure,
    });
    expect((await repository.load("personal")).revision).toBe(5);
  });

  it("rejects unsafe Windows paths before attempting a write", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);

    try {
      await repository.registerSource("personal", {
        sourceId: "source-1",
        sourcePath: "C:\\Vault\\CON.md",
        custody: "user_managed",
      });
      throw new Error("Expected an unsafe source path to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceManifestValidationError);
      if (!(error instanceof SourceManifestValidationError)) {
        throw error;
      }
      const codes = error.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain("path_absolute");
      expect(codes).toContain("path_backslash");
    }
    expect(storage.writeAttempts).toBe(0);
  });

  it("records a successful compile only as committed source state", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const snapshot = createSnapshot();
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });

    const entry = await repository.recordSuccessfulCompile("personal", "source-1", snapshot);

    expect(entry.lastSuccessful).toEqual(snapshot);
    expect(entry.lastFailure).toBeUndefined();
    expect((await repository.load("personal")).revision).toBe(2);
  });

  it("records a failed compile without replacing the last successful snapshot", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const snapshot = createSnapshot();
    const failure = createFailure();
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await repository.recordSuccessfulCompile("personal", "source-1", snapshot);

    const entry = await repository.recordFailedCompile("personal", "source-1", failure);

    expect(entry.lastSuccessful).toEqual(snapshot);
    expect(entry.lastFailure).toEqual(failure);
  });

  it("clears an older failure after a later successful compile", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await repository.recordFailedCompile("personal", "source-1", createFailure());
    const laterSnapshot = createSnapshot({
      sourceContentHash: HASH_C,
      changeSetId: "changeset-2",
      completedAt: 300,
    });

    const entry = await repository.recordSuccessfulCompile("personal", "source-1", laterSnapshot);

    expect(entry.lastSuccessful).toEqual(laterSnapshot);
    expect(entry.lastFailure).toBeUndefined();
  });

  it("preserves a failure that is newer than a successful compile", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    const newerFailure = createFailure({
      failure: {
        code: "provider_timeout",
        message: "Newer failed attempt",
        retryable: true,
        occurredAt: 400,
      },
    });
    await repository.recordFailedCompile("personal", "source-1", newerFailure);

    const entry = await repository.recordSuccessfulCompile(
      "personal",
      "source-1",
      createSnapshot({ completedAt: 300 })
    );

    expect(entry.lastSuccessful?.completedAt).toBe(300);
    expect(entry.lastFailure).toEqual(newerFailure);
  });

  it("does not advance revision for repeated successful or failed observations", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const snapshot = createSnapshot();
    const failure = createFailure();
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await repository.recordSuccessfulCompile("personal", "source-1", snapshot);
    await repository.recordSuccessfulCompile("personal", "source-1", snapshot);
    await repository.recordFailedCompile("personal", "source-1", failure);
    await repository.recordFailedCompile("personal", "source-1", failure);

    expect(storage.successfulWrites).toBe(3);
    expect((await repository.load("personal")).revision).toBe(3);
  });

  it("ignores older success and failure observations without advancing revision", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    const newestSnapshot = createSnapshot({ completedAt: 500, changeSetId: "changeset-newest" });
    await repository.recordSuccessfulCompile("personal", "source-1", newestSnapshot);
    const writesBeforeStaleObservations = storage.writeAttempts;

    const afterOldSuccess = await repository.recordSuccessfulCompile(
      "personal",
      "source-1",
      createSnapshot({ completedAt: 400, changeSetId: "changeset-old" })
    );
    const afterOldFailure = await repository.recordFailedCompile(
      "personal",
      "source-1",
      createFailure({
        failure: {
          code: "old_failure",
          message: "Older than the committed success",
          retryable: false,
          occurredAt: 450,
        },
      })
    );

    expect(afterOldSuccess.lastSuccessful).toEqual(newestSnapshot);
    expect(afterOldFailure.lastSuccessful).toEqual(newestSnapshot);
    expect(afterOldFailure.lastFailure).toBeUndefined();
    expect(storage.writeAttempts).toBe(writesBeforeStaleObservations);
  });

  it("rejects different observations that claim the same timestamp", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await repository.recordSuccessfulCompile("personal", "source-1", createSnapshot());

    await expect(
      repository.recordSuccessfulCompile(
        "personal",
        "source-1",
        createSnapshot({ changeSetId: "different-changeset" })
      )
    ).rejects.toMatchObject({
      name: "SourceManifestObservationConflictError",
      observation: "success",
      occurredAt: 100,
    });
    await expect(
      repository.recordSuccessfulCompile(
        "personal",
        "source-1",
        createSnapshot({ changeSetId: "another-different-changeset" })
      )
    ).rejects.toBeInstanceOf(SourceManifestObservationConflictError);

    const failure = createFailure();
    await repository.recordFailedCompile("personal", "source-1", failure);
    await expect(
      repository.recordFailedCompile("personal", "source-1", {
        ...failure,
        failure: { ...failure.failure, code: "different_failure" },
      })
    ).rejects.toMatchObject({
      name: "SourceManifestObservationConflictError",
      observation: "failure",
      occurredAt: 200,
    });
  });

  it("reports an unchanged source with all outputs as up to date", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const snapshot = createSnapshot();
    storage.seed(
      "personal",
      createManifest("personal", {
        entries: [createEntry("source-1", "Sources/Note.md", { lastSuccessful: snapshot })],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [
        { path: "wiki/concepts/NOTE.md", exists: true },
      ])
    ).resolves.toEqual({ kind: "up_to_date" });
  });

  it("reports source changes independently", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        entries: [createEntry("source-1", "Sources/Note.md", { lastSuccessful: createSnapshot() })],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_C, HASH_B, [
        { path: "Wiki/Concepts/Note.md", exists: true },
      ])
    ).resolves.toEqual({ kind: "needs_ingest", reasons: ["source_changed"] });
  });

  it("reports pipeline changes independently", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        entries: [createEntry("source-1", "Sources/Note.md", { lastSuccessful: createSnapshot() })],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_C, [
        { path: "Wiki/Concepts/Note.md", exists: true },
      ])
    ).resolves.toEqual({ kind: "needs_ingest", reasons: ["pipeline_changed"] });
  });

  it("requires ingest when any committed output is missing", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        entries: [createEntry("source-1", "Sources/Note.md", { lastSuccessful: createSnapshot() })],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [])
    ).resolves.toEqual({ kind: "needs_ingest", reasons: ["output_missing"] });
  });

  it("recognizes an explicit durable zero-page no-change success", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 1,
        entries: [
          createEntry("source-1", "Sources/Note.md", {
            extensions: createNoChangesExtension(),
          }),
        ],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [])
    ).resolves.toEqual({ kind: "up_to_date" });
  });

  it("uses a newer Runtime apply instead of a retained historical no-change marker", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const applied = createSnapshot({
      sourceContentHash: HASH_C,
      pipelineFingerprint: HASH_C,
    });
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 3,
        entries: [
          createEntry("source-1", "Sources/Note.md", {
            lastSuccessful: applied,
            extensions: {
              ...createNoChangesExtension(1),
              [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
                version: 1,
                inputRevision: 2,
                transactionId: "transaction-newer-apply",
                manifestIntentDigest: HASH_A,
              },
            },
          }),
        ],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_C, HASH_C, [
        { path: "Wiki/Concepts/Note.md", exists: true },
      ])
    ).resolves.toEqual({ kind: "up_to_date" });
  });

  it("fails closed when Apply and no-change claim the same source input revision", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 2,
        entries: [
          createEntry("source-1", "Sources/Note.md", {
            lastSuccessful: createSnapshot(),
            extensions: {
              ...createNoChangesExtension(1),
              [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: {
                version: 1,
                inputRevision: 1,
                transactionId: "transaction-conflicting-apply",
                manifestIntentDigest: HASH_A,
              },
            },
          }),
        ],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [
        { path: "Wiki/Concepts/Note.md", exists: true },
      ])
    ).rejects.toMatchObject({
      name: "SourceManifestValidationError",
      diagnostics: [expect.objectContaining({ code: "manifest_source_outcome_revision_conflict" })],
    });
  });

  it("fails closed when Runtime apply metadata cannot establish outcome ordering", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 2,
        entries: [
          createEntry("source-1", "Sources/Note.md", {
            lastSuccessful: createSnapshot(),
            extensions: {
              ...createNoChangesExtension(1),
              [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: { version: 1 },
            },
          }),
        ],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [
        { path: "Wiki/Concepts/Note.md", exists: true },
      ])
    ).rejects.toMatchObject({
      name: "SourceManifestValidationError",
      diagnostics: [expect.objectContaining({ code: "manifest_runtime_commit_invalid" })],
    });
  });

  it("fails closed when the reserved no-change marker is malformed", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        entries: [
          createEntry("source-1", "Sources/Note.md", {
            extensions: {
              [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: { version: 1 },
            },
          }),
        ],
      })
    );

    await expect(
      repository.evaluateFreshness("personal", "source-1", HASH_A, HASH_B, [])
    ).rejects.toMatchObject({
      name: "SourceManifestValidationError",
      diagnostics: [expect.objectContaining({ code: "manifest_no_changes_commit_invalid" })],
    });
  });

  it("round-trips unknown extension metadata across repository mutations", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const manifestExtensions: Record<string, JsonValue> = {
      futureManifestField: { enabled: true, ranks: [1, 2, 3] },
    };
    const entryExtensions: Record<string, JsonValue> = {
      futureSourceField: { connector: "filesystem", options: ["a", "b"] },
    };
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 7,
        entries: [createEntry("source-1", "Sources/Note.md", { extensions: entryExtensions })],
        extensions: manifestExtensions,
      })
    );

    await repository.renameSource("personal", "source-1", "Archive/Note.md");
    await repository.recordSuccessfulCompile("personal", "source-1", createSnapshot());
    const reloaded = await repository.load("personal");

    expect(reloaded.extensions).toEqual(manifestExtensions);
    expect(reloaded.entries[0].extensions).toEqual(entryExtensions);
    expect(reloaded.revision).toBe(9);
  });

  it("deeply detaches registration inputs, compile inputs, and public return values", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const extensions: Record<string, JsonValue> = { importer: "manual" };
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
      extensions,
    });
    extensions.importer = "mutated-after-register";

    const snapshot = createSnapshot();
    const successful = await repository.recordSuccessfulCompile("personal", "source-1", snapshot);
    snapshot.generatedPages[0].path = "Wiki/Mutated.md";
    successful.sourcePath = "Mutated/Public.md";
    if (successful.lastSuccessful) {
      successful.lastSuccessful.generatedPages[0].path = "Wiki/Public-Mutated.md";
    }

    const reloaded = await repository.load("personal");
    expect(reloaded.entries[0].sourcePath).toBe("Sources/Note.md");
    expect(reloaded.entries[0].extensions).toEqual({ importer: "manual" });
    expect(reloaded.entries[0].lastSuccessful?.generatedPages[0].path).toBe(
      "Wiki/Concepts/Note.md"
    );
  });

  it("rejects an incompatible persisted contract version explicitly", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed("personal", {
      version: 2,
      bundleId: "personal",
      revision: 0,
      entries: [],
    });

    await expect(repository.load("personal")).rejects.toMatchObject({
      name: "SourceManifestIncompatibleVersionError",
      bundleId: "personal",
      version: 2,
    });
    await expect(repository.load("personal")).rejects.toBeInstanceOf(
      SourceManifestIncompatibleVersionError
    );
  });

  it.each([
    ["malformed fields", { version: 1, bundleId: "personal", revision: -1, entries: [] }],
    [
      "unknown fields",
      { version: 1, bundleId: "personal", revision: 0, entries: [], futureField: true },
    ],
  ])("rejects persisted manifests with %s", async (_label, value) => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed("personal", value);

    await expect(repository.load("personal")).rejects.toBeInstanceOf(SourceManifestValidationError);
  });

  it("rejects a manifest stored under a different Bundle identity", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed("personal", createManifest("another-bundle"));

    await expect(repository.load("personal")).rejects.toMatchObject({
      name: "SourceManifestBundleMismatchError",
      requestedBundleId: "personal",
      storedBundleId: "another-bundle",
    });
    await expect(repository.load("personal")).rejects.toBeInstanceOf(
      SourceManifestBundleMismatchError
    );
  });

  it("treats a missing version as corrupt data rather than an incompatible declared version", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed("personal", { bundleId: "personal", revision: 0, entries: [] });

    await expect(repository.load("personal")).rejects.toBeInstanceOf(SourceManifestValidationError);
    await expect(repository.load("personal")).rejects.not.toBeInstanceOf(
      SourceManifestIncompatibleVersionError
    );
  });

  it("rejects unsafe revisions and refuses to overflow the last safe integer", async () => {
    const invalidStorage = new InMemorySourceManifestStorage();
    invalidStorage.seed(
      "personal",
      createManifest("personal", { revision: Number.MAX_SAFE_INTEGER + 1 })
    );
    await expect(
      new SourceManifestRepository(invalidStorage).load("personal")
    ).rejects.toBeInstanceOf(SourceManifestValidationError);

    const saturatedStorage = new InMemorySourceManifestStorage();
    saturatedStorage.seed(
      "personal",
      createManifest("personal", { revision: Number.MAX_SAFE_INTEGER })
    );
    await expect(
      new SourceManifestRepository(saturatedStorage).registerSource("personal", {
        sourceId: "source-1",
        sourcePath: "Sources/Note.md",
        custody: "user_managed",
      })
    ).rejects.toBeInstanceOf(SourceManifestRevisionOverflowError);
    expect(saturatedStorage.writeAttempts).toBe(0);
    expect(
      () => new SourceManifestRepository(saturatedStorage, Number.MAX_SAFE_INTEGER + 1)
    ).toThrow(TypeError);
  });

  it("retries a revision conflict and merges an independently registered source", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const conflict = new SourceManifestRevisionConflictError("personal", null);
    storage.planWriteFailure(conflict, () => {
      storage.seed(
        "personal",
        createManifest("personal", {
          revision: 1,
          entries: [createEntry("source-b", "Sources/B.md")],
        })
      );
    });

    await repository.registerSource("personal", {
      sourceId: "source-a",
      sourcePath: "Sources/A.md",
      custody: "user_managed",
    });
    const manifest = await repository.load("personal");

    expect(manifest.revision).toBe(2);
    expect(manifest.entries.map((entry) => entry.sourceId)).toEqual(["source-b", "source-a"]);
    expect(storage.writeAttempts).toBe(2);
    expect(storage.successfulWrites).toBe(1);
  });

  it("re-evaluates a failed observation after conflict and keeps a newer concurrent failure", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 1,
        entries: [createEntry()],
      })
    );
    const newerFailure = createFailure({
      failure: {
        code: "newer_failure",
        message: "Persisted by a concurrent worker",
        retryable: false,
        occurredAt: 300,
      },
    });
    storage.planWriteFailure(new SourceManifestRevisionConflictError("personal", 1), () => {
      storage.seed(
        "personal",
        createManifest("personal", {
          revision: 2,
          entries: [createEntry("source-1", "Sources/Note.md", { lastFailure: newerFailure })],
        })
      );
    });

    const entry = await repository.recordFailedCompile("personal", "source-1", createFailure());

    expect(entry.lastFailure).toEqual(newerFailure);
    expect(storage.writeAttempts).toBe(1);
    expect((await repository.load("personal")).revision).toBe(2);
  });

  it("retries a successful compile without deleting a newer concurrent failure", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 1,
        entries: [createEntry()],
      })
    );
    const newerFailure = createFailure({
      failure: {
        code: "newer_failure",
        message: "Persisted by a concurrent worker",
        retryable: true,
        occurredAt: 400,
      },
    });
    storage.planWriteFailure(new SourceManifestRevisionConflictError("personal", 1), () => {
      storage.seed(
        "personal",
        createManifest("personal", {
          revision: 2,
          entries: [createEntry("source-1", "Sources/Note.md", { lastFailure: newerFailure })],
        })
      );
    });

    const entry = await repository.recordSuccessfulCompile(
      "personal",
      "source-1",
      createSnapshot({ completedAt: 300 })
    );

    expect(entry.lastSuccessful?.completedAt).toBe(300);
    expect(entry.lastFailure).toEqual(newerFailure);
    expect(storage.writeAttempts).toBe(2);
    expect((await repository.load("personal")).revision).toBe(3);
  });

  it("throws the last revision conflict after exhausting bounded retries", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage, 2);
    const firstConflict = new SourceManifestRevisionConflictError("personal", null);
    const lastConflict = new SourceManifestRevisionConflictError("personal", null);
    storage.planWriteFailure(firstConflict);
    storage.planWriteFailure(lastConflict);

    const registration = repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await expect(registration).rejects.toBeInstanceOf(SourceManifestWriteConflictExhaustedError);
    await expect(registration).rejects.toMatchObject({
      name: "SourceManifestWriteConflictExhaustedError",
      bundleId: "personal",
      attempts: 2,
      conflict: lastConflict,
    });
    expect(storage.writeAttempts).toBe(2);
    expect(storage.getStored("personal")).toBeNull();
  });

  it("propagates non-conflict storage errors without retrying", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const storageError = new Error("disk unavailable");
    storage.planWriteFailure(storageError);

    await expect(
      repository.registerSource("personal", {
        sourceId: "source-1",
        sourcePath: "Sources/Note.md",
        custody: "user_managed",
      })
    ).rejects.toBe(storageError);
    expect(storage.writeAttempts).toBe(1);
    expect(storage.getStored("personal")).toBeNull();
  });

  it("keeps the last successful state when a later storage write fails", async () => {
    const storage = new InMemorySourceManifestStorage();
    const snapshot = createSnapshot();
    storage.seed(
      "personal",
      createManifest("personal", {
        revision: 1,
        entries: [createEntry("source-1", "Sources/Note.md", { lastSuccessful: snapshot })],
      })
    );
    storage.planWriteFailure(new Error("disk unavailable"));
    const repository = new SourceManifestRepository(storage);

    await expect(
      repository.recordFailedCompile("personal", "source-1", createFailure())
    ).rejects.toThrow("disk unavailable");
    const reloaded = await repository.load("personal");
    expect(reloaded.revision).toBe(1);
    expect(reloaded.entries[0].lastSuccessful).toEqual(snapshot);
    expect(reloaded.entries[0].lastFailure).toBeUndefined();
  });

  it("removes only manifest identity and never deletes generated pages itself", async () => {
    const storage = new InMemorySourceManifestStorage();
    const repository = new SourceManifestRepository(storage);
    const generatedPages = new Map([["Wiki/Concepts/Note.md", "# Durable user-visible page"]]);
    await repository.registerSource("personal", {
      sourceId: "source-1",
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
    });
    await repository.recordSuccessfulCompile("personal", "source-1", createSnapshot());

    const manifest = await repository.removeSource("personal", "source-1");

    expect(manifest.entries).toEqual([]);
    expect(manifest.revision).toBe(3);
    expect(generatedPages.get("Wiki/Concepts/Note.md")).toBe("# Durable user-visible page");
    expect(storage.writtenManifests.at(-1)?.entries).toEqual([]);
  });
});
