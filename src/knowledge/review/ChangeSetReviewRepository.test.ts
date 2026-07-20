import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  projectManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeFileChange } from "@/knowledge/model/types";
import {
  ChangeSetReviewBundleMismatchError,
  ChangeSetReviewDecisionConflictError,
  ChangeSetReviewIdentityConflictError,
  ChangeSetReviewIncompatibleVersionError,
  ChangeSetReviewInfrastructureError,
  ChangeSetReviewNotFoundError,
  ChangeSetReviewRecordRevisionConflictError,
  ChangeSetReviewRepository,
  ChangeSetReviewValidationError,
  ChangeSetReviewWriteConflictExhaustedError,
} from "@/knowledge/review/ChangeSetReviewRepository";
import {
  ReviewStorageRevisionConflictError,
  type ChangeSetReviewJobClaim,
  type ChangeSetReviewSnapshot,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const MANIFEST_HASH = "c".repeat(64);

/** Creates a JSON clone suitable for the strict test persistence adapter. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Atomic in-memory storage with deterministic failure injection. */
class MemoryReviewStorage implements ReviewStorage {
  readonly values = new Map<string, ChangeSetReviewSnapshot>();
  readonly writes: Array<{
    bundleId: string;
    snapshot: ChangeSetReviewSnapshot;
    expectedRevision: number | null;
  }> = [];
  conflictsRemaining = 0;
  readFailure?: Error;
  writeFailure?: Error;

  /** Reads one detached in-memory snapshot or an injected malformed value. */
  async read(bundleId: string): Promise<unknown> {
    if (this.readFailure) {
      throw this.readFailure;
    }
    const snapshot = this.values.get(bundleId);
    return snapshot ? cloneJson(snapshot) : null;
  }

  /** Atomically compares and replaces one complete in-memory snapshot. */
  async write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    if (this.writeFailure) {
      throw this.writeFailure;
    }
    const current = this.values.get(bundleId);
    const actualRevision = current?.revision ?? null;
    if (this.conflictsRemaining > 0) {
      this.conflictsRemaining -= 1;
      throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    if (actualRevision !== expectedRevision) {
      throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
    }
    this.values.set(bundleId, cloneJson(snapshot));
    this.writes.push({ bundleId, snapshot: cloneJson(snapshot), expectedRevision });
  }

  /** Seeds strict or deliberately malformed persisted JSON for a test. */
  seed(bundleId: string, value: ChangeSetReviewSnapshot): void {
    this.values.set(bundleId, cloneJson(value));
  }
}

/** Creates the immutable queue identity paired with one proposal. */
function createJobClaim(jobId = "job-1"): ChangeSetReviewJobClaim {
  return {
    jobId,
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 9,
    attempt: 1,
  };
}

/** Creates one valid proposed file creation. */
function createFileChange(id = "change-1", content = "# Page\n"): KnowledgeFileChange {
  return {
    id,
    path: `Wiki/${id}.md`,
    sourceRefs: ["source-1"],
    reason: "Create a grounded page",
    operation: "create",
    expectedAbsent: true,
    afterContent: content,
    afterHash: createFileContentHash(content),
  };
}

/** Creates a valid review-only ChangeSet. */
function createProposal(
  id = "changeset-1",
  changes: KnowledgeFileChange[] = [createFileChange()]
): KnowledgeChangeSet {
  return {
    id,
    bundleId: "bundle-1",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes,
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates one strict complete Manifest plan for a proposed source compile. */
function createManifestCommitPlan(
  proposal: KnowledgeChangeSet,
  jobClaim = createJobClaim()
): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: proposal.bundleId,
    sourceId: jobClaim.sourceId,
    sourceContentHash: jobClaim.sourceContentHash,
    pipelineFingerprint: jobClaim.pipelineFingerprint,
    inputRevision: jobClaim.inputRevision,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: MANIFEST_HASH,
    baseGeneratedPages: proposal.changes
      .flatMap((change) =>
        change.operation === "create"
          ? []
          : [{ path: change.path, ownership: "generated" as const, contentHash: change.beforeHash }]
      )
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    mutations: proposal.changes
      .map((change) => ({
        changeId: change.id,
        path: change.path,
        operation: change.operation,
        access: change.operation === "create" ? ("create_only" as const) : ("authorized" as const),
        ownership: "generated" as const,
        wasTrackedByPrimarySource: change.operation !== "create",
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
}

/** Creates an exact proposal persistence command. */
function createSaveInput(proposal = createProposal(), jobClaim = createJobClaim()) {
  const manifestCommitPlan = createManifestCommitPlan(proposal, jobClaim);
  return {
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim,
  };
}

/** Creates an accepted payload over selected or rewritten proposal changes. */
function createAccepted(
  proposal: KnowledgeChangeSet,
  changes: KnowledgeFileChange[] = proposal.changes
): KnowledgeChangeSet {
  return { ...proposal, changes, status: "accepted" };
}

/** Creates a valid seeded pending review snapshot. */
function createSeedSnapshot(
  proposal = createProposal(),
  overrides: Partial<ChangeSetReviewSnapshot["records"][number]> = {}
): ChangeSetReviewSnapshot {
  const jobClaim = createJobClaim();
  const manifestCommitPlan = createManifestCommitPlan(proposal, jobClaim);
  return {
    version: 2,
    bundleId: proposal.bundleId,
    revision: 1,
    records: [
      {
        changeSetId: proposal.id,
        recordRevision: 0,
        proposal,
        proposalDigest: createChangeSetTransactionDigest(proposal),
        manifestCommitPlan,
        manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
        jobClaim,
        recordedAt: 1000,
        outcome: "pending",
        ...overrides,
      } as ChangeSetReviewSnapshot["records"][number],
    ],
  };
}

describe("ChangeSetReviewRepository", () => {
  it("saves an exact proposal idempotently and returns detached records", async () => {
    const storage = new MemoryReviewStorage();
    const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });
    const input = createSaveInput();

    const first = await repository.saveProposal("bundle-1", input);
    const replayed = await repository.saveProposal("bundle-1", input);

    expect(first).toMatchObject({ outcome: "pending", recordRevision: 0, recordedAt: 1000 });
    expect(replayed).toEqual(first);
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]).toMatchObject({ expectedRevision: null, snapshot: { revision: 1 } });

    first.proposal.sourceRefs.push("mutated");
    expect((await repository.get("bundle-1", first.changeSetId))?.proposal.sourceRefs).toEqual([
      "source-1",
    ]);
  });

  it("fails closed when a ChangeSet id or queue job id is reused with different material", async () => {
    const storage = new MemoryReviewStorage();
    const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });
    const original = createProposal();
    await repository.saveProposal("bundle-1", createSaveInput(original));

    const changed = createProposal();
    changed.changes[0] = createFileChange("change-1", "# Changed\n");
    await expect(
      repository.saveProposal("bundle-1", createSaveInput(changed))
    ).rejects.toBeInstanceOf(ChangeSetReviewIdentityConflictError);

    await expect(
      repository.saveProposal(
        "bundle-1",
        createSaveInput(original, { ...createJobClaim(), inputRevision: 10 })
      )
    ).rejects.toBeInstanceOf(ChangeSetReviewIdentityConflictError);

    const changedPlanInput = createSaveInput(original);
    changedPlanInput.manifestCommitPlan = {
      ...changedPlanInput.manifestCommitPlan,
      expectedManifestDigest: "d".repeat(64),
    };
    changedPlanInput.manifestCommitPlanDigest = createManifestCommitPlanDigest(
      changedPlanInput.manifestCommitPlan
    );
    await expect(repository.saveProposal("bundle-1", changedPlanInput)).rejects.toBeInstanceOf(
      ChangeSetReviewIdentityConflictError
    );

    const other = createProposal("changeset-2", [createFileChange("change-2")]);
    await expect(
      repository.saveProposal("bundle-1", createSaveInput(other, createJobClaim()))
    ).rejects.toBeInstanceOf(ChangeSetReviewIdentityConflictError);
  });

  it("rejects a Manifest plan bound to different source content or pipeline identity", async () => {
    const storage = new MemoryReviewStorage();
    const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });

    const sourceMismatch = createSaveInput();
    sourceMismatch.jobClaim = {
      ...sourceMismatch.jobClaim,
      sourceContentHash: "d".repeat(64),
    };
    await expect(repository.saveProposal("bundle-1", sourceMismatch)).rejects.toBeInstanceOf(
      ChangeSetReviewValidationError
    );

    const pipelineMismatch = createSaveInput();
    pipelineMismatch.jobClaim = {
      ...pipelineMismatch.jobClaim,
      pipelineFingerprint: "d".repeat(64),
    };
    await expect(repository.saveProposal("bundle-1", pipelineMismatch)).rejects.toBeInstanceOf(
      ChangeSetReviewValidationError
    );
    expect(storage.writes).toHaveLength(0);
  });

  it("accepts filtered and rewritten changes and replays the exact decision idempotently", async () => {
    const storage = new MemoryReviewStorage();
    let timestamp = 1000;
    const repository = new ChangeSetReviewRepository(storage, { clock: () => timestamp++ });
    const proposal = createProposal("changeset-partial", [
      createFileChange("change-1"),
      createFileChange("change-2"),
    ]);
    const pending = await repository.saveProposal("bundle-1", createSaveInput(proposal));
    const rewritten = createFileChange("change-2", "# User reviewed\n");
    const accepted = createAccepted(proposal, [rewritten]);

    const first = await repository.accept(
      "bundle-1",
      proposal.id,
      pending.recordRevision,
      pending.proposalDigest,
      accepted
    );
    const replayed = await repository.accept(
      "bundle-1",
      proposal.id,
      pending.recordRevision,
      pending.proposalDigest,
      accepted
    );

    expect(first).toMatchObject({ outcome: "accepted", recordRevision: 1 });
    expect(first.acceptedChangeSet.changes).toEqual([rewritten]);
    expect(first.acceptedDigest).toBe(createChangeSetTransactionDigest(accepted));
    expect(first.manifestCommitIntent).toEqual(
      projectManifestCommitIntent(pending.manifestCommitPlan, accepted)
    );
    expect(first.manifestCommitIntent.generatedPages).toEqual([
      {
        path: rewritten.path,
        ownership: "generated",
        contentHash: createFileContentHash("# User reviewed\n"),
      },
    ]);
    expect(first.manifestCommitIntentDigest).toBe(
      createManifestCommitIntentDigest(first.manifestCommitIntent)
    );
    expect(replayed).toEqual(first);
    expect(storage.writes).toHaveLength(2);
    expect((await repository.load("bundle-1")).revision).toBe(2);
  });

  it("persists rejection and never fabricates an empty accepted ChangeSet", async () => {
    const storage = new MemoryReviewStorage();
    const repository = new ChangeSetReviewRepository(storage, { clock: () => 1200 });
    const pending = await repository.saveProposal("bundle-1", createSaveInput());

    const first = await repository.reject(
      "bundle-1",
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );
    const replayed = await repository.reject(
      "bundle-1",
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest
    );

    expect(first).toMatchObject({ outcome: "rejected", recordRevision: 1, rejectedAt: 1200 });
    expect(first).not.toHaveProperty("acceptedChangeSet");
    expect(replayed).toEqual(first);
    expect(storage.writes).toHaveLength(2);
  });

  it("rejects missing, stale, and proposal-digest decision commands", async () => {
    const storage = new MemoryReviewStorage();
    const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });
    const pending = await repository.saveProposal("bundle-1", createSaveInput());

    await expect(
      repository.reject("bundle-1", "missing", 0, pending.proposalDigest)
    ).rejects.toBeInstanceOf(ChangeSetReviewNotFoundError);
    await expect(
      repository.reject("bundle-1", pending.changeSetId, 1, pending.proposalDigest)
    ).rejects.toBeInstanceOf(ChangeSetReviewRecordRevisionConflictError);
    await expect(
      repository.reject("bundle-1", pending.changeSetId, 0, SOURCE_HASH)
    ).rejects.toBeInstanceOf(ChangeSetReviewIdentityConflictError);
  });

  it("allows only one of two conflicting window decisions", async () => {
    const storage = new MemoryReviewStorage();
    const firstWindow = new ChangeSetReviewRepository(storage, { clock: () => 1100 });
    const secondWindow = new ChangeSetReviewRepository(storage, { clock: () => 1200 });
    const proposal = createProposal();
    const pending = await firstWindow.saveProposal("bundle-1", createSaveInput(proposal));

    const results = await Promise.allSettled([
      firstWindow.accept(
        "bundle-1",
        proposal.id,
        pending.recordRevision,
        pending.proposalDigest,
        createAccepted(proposal)
      ),
      secondWindow.reject("bundle-1", proposal.id, pending.recordRevision, pending.proposalDigest),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    if (!rejection || rejection.status !== "rejected") {
      throw new Error("Expected one concurrent review decision to be rejected");
    }
    expect(rejection.reason).toBeInstanceOf(ChangeSetReviewDecisionConflictError);
    expect((await firstWindow.get("bundle-1", proposal.id))?.outcome).toMatch(/accepted|rejected/);
  });

  it("converges two identical window acceptances to one durable decision", async () => {
    const storage = new MemoryReviewStorage();
    const firstWindow = new ChangeSetReviewRepository(storage, { clock: () => 1100 });
    const secondWindow = new ChangeSetReviewRepository(storage, { clock: () => 1200 });
    const proposal = createProposal();
    const pending = await firstWindow.saveProposal("bundle-1", createSaveInput(proposal));
    const accepted = createAccepted(proposal);

    const records = await Promise.all([
      firstWindow.accept(
        "bundle-1",
        proposal.id,
        pending.recordRevision,
        pending.proposalDigest,
        accepted
      ),
      secondWindow.accept(
        "bundle-1",
        proposal.id,
        pending.recordRevision,
        pending.proposalDigest,
        accepted
      ),
    ]);

    expect(records[0]).toEqual(records[1]);
    expect(storage.writes).toHaveLength(2);
    expect((await firstWindow.load("bundle-1")).revision).toBe(2);
  });

  it("fails closed on accepted deletes and mutable proposal identity", async () => {
    const deleteChange: KnowledgeFileChange = {
      id: "change-delete",
      path: "Wiki/Delete.md",
      sourceRefs: ["source-1"],
      reason: "Delete an obsolete generated page",
      operation: "delete",
      beforeHash: SOURCE_HASH,
    };
    const proposal = createProposal("changeset-delete", [deleteChange]);
    const cases: KnowledgeChangeSet[] = [
      createAccepted(proposal),
      { ...createAccepted(proposal, [createFileChange("injected")]), id: proposal.id },
      { ...createAccepted(proposal), bundleId: "bundle-other" },
      {
        ...createAccepted(proposal),
        validation: { okfValid: false, citationsValid: true, linksValid: true },
      },
    ];

    for (const accepted of cases) {
      const storage = new MemoryReviewStorage();
      const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });
      const pending = await repository.saveProposal("bundle-1", createSaveInput(proposal));
      await expect(
        repository.accept(
          "bundle-1",
          proposal.id,
          pending.recordRevision,
          pending.proposalDigest,
          accepted
        )
      ).rejects.toBeInstanceOf(ChangeSetReviewValidationError);
      expect((await repository.get("bundle-1", proposal.id))?.outcome).toBe("pending");
    }
  });

  it("preserves accepted identity, provenance, citations, and proposal-owned targets", async () => {
    const proposal = createProposal();
    const citation = {
      citationId: "citation-1",
      claimId: "claim-1",
      relation: "supports" as const,
      locator: {
        kind: "quote" as const,
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash: SOURCE_HASH,
        excerpt: "Grounded evidence",
        quoteHash: createQuoteHash("Grounded evidence"),
      },
    };
    const cases: KnowledgeChangeSet[] = [
      { ...createAccepted(proposal), operation: "lint_fix" },
      { ...createAccepted(proposal), createdAt: proposal.createdAt + 1 },
      { ...createAccepted(proposal), sourceRefs: ["source-1", "source-extra"] },
      { ...createAccepted(proposal), citations: [citation] },
      {
        ...createAccepted(proposal),
        changes: [{ ...proposal.changes[0], path: "Wiki/Injected.md" }],
      },
      {
        ...createAccepted(proposal),
        changes: [{ ...proposal.changes[0], sourceRefs: [] }],
      },
    ];

    for (const accepted of cases) {
      const storage = new MemoryReviewStorage();
      const repository = new ChangeSetReviewRepository(storage, { clock: () => 1000 });
      const pending = await repository.saveProposal("bundle-1", createSaveInput(proposal));
      await expect(
        repository.accept(
          "bundle-1",
          proposal.id,
          pending.recordRevision,
          pending.proposalDigest,
          accepted
        )
      ).rejects.toBeInstanceOf(ChangeSetReviewValidationError);
      expect((await repository.get("bundle-1", proposal.id))?.outcome).toBe("pending");
    }
  });

  it("enforces incompatible version, Bundle identity, and strict persisted JSON", async () => {
    for (const legacy of [
      { version: 1, bundleId: "bundle-1", revision: 0, records: [] },
      { ...createSeedSnapshot(), version: 1 },
    ]) {
      const versionStorage = new MemoryReviewStorage();
      versionStorage.seed("bundle-1", legacy as never);
      await expect(
        new ChangeSetReviewRepository(versionStorage).load("bundle-1")
      ).rejects.toBeInstanceOf(ChangeSetReviewIncompatibleVersionError);
    }

    const bundleStorage = new MemoryReviewStorage();
    const otherProposal = createProposal();
    otherProposal.bundleId = "bundle-other";
    bundleStorage.seed("bundle-1", createSeedSnapshot(otherProposal));
    await expect(
      new ChangeSetReviewRepository(bundleStorage).load("bundle-1")
    ).rejects.toBeInstanceOf(ChangeSetReviewBundleMismatchError);

    const malformedStorage = new MemoryReviewStorage();
    malformedStorage.seed("bundle-1", { version: 2, bundleId: "bundle-1" } as never);
    await expect(
      new ChangeSetReviewRepository(malformedStorage).load("bundle-1")
    ).rejects.toBeInstanceOf(ChangeSetReviewValidationError);
  });

  it("fails before mutation when snapshot revision would overflow or record revision is corrupt", async () => {
    const snapshotStorage = new MemoryReviewStorage();
    snapshotStorage.seed("bundle-1", {
      ...createSeedSnapshot(),
      revision: Number.MAX_SAFE_INTEGER,
    });
    await expect(
      new ChangeSetReviewRepository(snapshotStorage, { clock: () => 1200 }).reject(
        "bundle-1",
        "changeset-1",
        0,
        createChangeSetTransactionDigest(createProposal())
      )
    ).rejects.toMatchObject({
      name: "ChangeSetReviewRevisionOverflowError",
      scope: "snapshot",
    });

    const recordStorage = new MemoryReviewStorage();
    recordStorage.seed(
      "bundle-1",
      createSeedSnapshot(createProposal(), {
        recordRevision: Number.MAX_SAFE_INTEGER,
      } as never)
    );
    await expect(
      new ChangeSetReviewRepository(recordStorage, { clock: () => 1200 }).load("bundle-1")
    ).rejects.toBeInstanceOf(ChangeSetReviewValidationError);
    expect(snapshotStorage.writes).toHaveLength(0);
    expect(recordStorage.writes).toHaveLength(0);
  });

  it("retries storage CAS conflicts within a bound and reports exhaustion", async () => {
    const convergingStorage = new MemoryReviewStorage();
    convergingStorage.conflictsRemaining = 2;
    const converging = new ChangeSetReviewRepository(convergingStorage, {
      maxWriteAttempts: 3,
      clock: () => 1000,
    });
    await expect(converging.saveProposal("bundle-1", createSaveInput())).resolves.toMatchObject({
      outcome: "pending",
    });

    const exhaustedStorage = new MemoryReviewStorage();
    exhaustedStorage.conflictsRemaining = 3;
    const exhausted = new ChangeSetReviewRepository(exhaustedStorage, {
      maxWriteAttempts: 3,
      clock: () => 1000,
    });
    await expect(exhausted.saveProposal("bundle-1", createSaveInput())).rejects.toBeInstanceOf(
      ChangeSetReviewWriteConflictExhaustedError
    );
  });

  it("sanitizes storage read and write failures", async () => {
    const readStorage = new MemoryReviewStorage();
    readStorage.readFailure = new Error("secret token=sk-never-render");
    const readError = await new ChangeSetReviewRepository(readStorage)
      .load("bundle-1")
      .catch((error: unknown) => error);
    expect(readError).toBeInstanceOf(ChangeSetReviewInfrastructureError);
    expect(String(readError)).not.toContain("sk-never-render");

    const writeStorage = new MemoryReviewStorage();
    writeStorage.writeFailure = new Error("password=hunter2");
    const writeError = await new ChangeSetReviewRepository(writeStorage, {
      clock: () => 1000,
    })
      .saveProposal("bundle-1", createSaveInput())
      .catch((error: unknown) => error);
    expect(writeError).toBeInstanceOf(ChangeSetReviewInfrastructureError);
    expect(String(writeError)).not.toContain("hunter2");
  });

  it("sanitizes malicious unknown ChangeSet field names", async () => {
    const repository = new ChangeSetReviewRepository(new MemoryReviewStorage(), {
      clock: () => 1000,
    });
    const proposal = { ...createProposal(), "sk-sensitive-field-name": true };
    const error = await repository
      .saveProposal("bundle-1", {
        proposal,
        proposalDigest: SOURCE_HASH,
        manifestCommitPlan: createManifestCommitPlan(createProposal()),
        manifestCommitPlanDigest: MANIFEST_HASH,
        jobClaim: createJobClaim(),
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ChangeSetReviewValidationError);
    expect(JSON.stringify(error)).not.toContain("sk-sensitive-field-name");
  });

  it("validates constructor options", async () => {
    const storage = new MemoryReviewStorage();
    expect(() => new ChangeSetReviewRepository(storage, { maxWriteAttempts: 0 })).toThrow(
      TypeError
    );
    const invalidClock = new ChangeSetReviewRepository(storage, { clock: () => -1 });
    await expect(invalidClock.saveProposal("bundle-1", createSaveInput())).rejects.toThrow(
      TypeError
    );
  });
});
