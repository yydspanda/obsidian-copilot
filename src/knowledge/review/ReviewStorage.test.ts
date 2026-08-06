import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  projectManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeFileChange } from "@/knowledge/model/types";
import {
  type ChangeSetReviewJobClaim,
  type ChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Creates the exact queue identity used by review fixtures. */
function createJobClaim(jobId = "job-1"): ChangeSetReviewJobClaim {
  return {
    jobId,
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 3,
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

/** Creates a strict proposed ChangeSet with affirmative validation. */
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

/** Creates the complete Manifest read-set and mutation authority for one proposal. */
function createManifestCommitPlan(
  proposal: KnowledgeChangeSet,
  jobClaim = createJobClaim()
): ManifestCommitPlan {
  const common = {
    version: 1,
    bundleId: proposal.bundleId,
    sourceId: jobClaim.sourceId,
    sourceContentHash: jobClaim.sourceContentHash,
    pipelineFingerprint: jobClaim.pipelineFingerprint,
    inputRevision: jobClaim.inputRevision,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_C,
    baseGeneratedPages: proposal.changes.flatMap((change) =>
      change.operation === "create"
        ? []
        : [{ path: change.path, ownership: "generated" as const, contentHash: change.beforeHash }]
    ),
    mutations: proposal.changes.map((change) => ({
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: change.operation === "create" ? ("create_only" as const) : ("authorized" as const),
      ownership: "generated" as const,
      wasTrackedByPrimarySource: change.operation !== "create",
    })),
  };
  return proposal.operation === "query_writeback"
    ? {
        ...common,
        version: 1,
        kind: "query_writeback_source_compile",
        sourceOriginDigest: "d".repeat(64),
      }
    : { ...common, version: 1, kind: "source_compile" };
}

/** Creates one pending record whose proposal digest is exact. */
function createPendingRecord(
  proposal = createProposal(),
  jobClaim = createJobClaim(),
  manifestCommitPlan = createManifestCommitPlan(proposal, jobClaim)
): ChangeSetReviewRecord {
  return {
    changeSetId: proposal.id,
    recordRevision: 0,
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim,
    recordedAt: 200,
    outcome: "pending",
  };
}

/** Creates a complete v2 snapshot around supplied records. */
function createSnapshot(records: ChangeSetReviewRecord[]): ChangeSetReviewSnapshot {
  return { version: 2, bundleId: "bundle-1", revision: 1, records };
}

/** Extracts stable diagnostic codes from one semantic validation result. */
function diagnosticCodes(snapshot: ChangeSetReviewSnapshot): string[] {
  return validateChangeSetReviewSnapshot(snapshot).diagnostics.map(({ code }) => code);
}

describe("ReviewStorage contracts", () => {
  it("accepts query writeback only with its additive source-backed Manifest plan", () => {
    const queryProposal = {
      ...createProposal("changeset-query"),
      operation: "query_writeback" as const,
    };
    const queryRecord = createPendingRecord(queryProposal);

    expect(validateChangeSetReviewSnapshot(createSnapshot([queryRecord]))).toEqual({
      valid: true,
      diagnostics: [],
    });
    if (queryRecord.manifestCommitPlan.kind !== "query_writeback_source_compile") {
      throw new Error("Expected a query-writeback plan");
    }
    const { sourceOriginDigest: _sourceOriginDigest, ...legacyFields } =
      queryRecord.manifestCommitPlan;
    expect(_sourceOriginDigest).toMatch(/^[a-f0-9]{64}$/);
    const ingestPlan: ManifestCommitPlan = { ...legacyFields, kind: "source_compile" };
    const forgedIngestPlan = {
      ...queryRecord,
      manifestCommitPlan: ingestPlan,
      manifestCommitPlanDigest: createManifestCommitPlanDigest(ingestPlan),
    };
    expect(diagnosticCodes(createSnapshot([forgedIngestPlan]))).toContain(
      "review_manifest_plan_operation_mismatch"
    );
  });

  it("strictly parses a valid pending snapshot and clones its input", () => {
    const snapshot = createSnapshot([createPendingRecord()]);
    const parsed = parseChangeSetReviewSnapshot(snapshot);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected the valid review snapshot to parse");
    }
    parsed.value.records[0].proposal.status = "accepted";
    expect(snapshot.records[0].proposal.status).toBe("proposed");
    expect(validateChangeSetReviewSnapshot(parsed.value).valid).toBe(false);
  });

  it.each([
    ["unknown root field", { ...createSnapshot([]), unexpected: true }],
    [
      "unknown record field",
      createSnapshot([
        { ...createPendingRecord(), unexpected: true } as unknown as ChangeSetReviewRecord,
      ]),
    ],
    ["legacy version", { ...createSnapshot([]), version: 1 }],
    ["unsafe revision", { ...createSnapshot([]), revision: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects structurally invalid %s", (_label, value) => {
    expect(parseChangeSetReviewSnapshot(value).ok).toBe(false);
  });

  it("does not retain unknown persisted field names in structural messages", () => {
    const parsed = parseChangeSetReviewSnapshot({
      ...createSnapshot([]),
      "sk-sensitive-field-name": true,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected strict review parsing to reject the unknown field");
    }
    expect(JSON.stringify(parsed.issues)).not.toContain("sk-sensitive-field-name");
  });

  it("rejects proposal digest, status, Bundle, and queue-source drift", () => {
    const wrongStatus = createProposal();
    wrongStatus.status = "accepted";
    const wrongBundle = createProposal("changeset-2");
    wrongBundle.bundleId = "bundle-2";
    const unknownSource = createPendingRecord(createProposal("changeset-3"), {
      ...createJobClaim("job-3"),
      sourceId: "source-unknown",
    });
    const snapshot = createSnapshot([
      { ...createPendingRecord(), proposalDigest: HASH_A },
      createPendingRecord(wrongStatus, createJobClaim("job-2")),
      createPendingRecord(wrongBundle, createJobClaim("job-4")),
      unknownSource,
    ]);

    expect(diagnosticCodes(snapshot)).toEqual(
      expect.arrayContaining([
        "review_proposal_digest_mismatch",
        "review_proposal_status_invalid",
        "review_proposal_identity_mismatch",
        "review_claim_source_unknown",
      ])
    );
  });

  it("binds the exact Manifest plan to proposal, source, input revision, and digest", () => {
    const wrongDigest = { ...createPendingRecord(), manifestCommitPlanDigest: HASH_A };
    const wrongSource = createPendingRecord(
      createProposal("changeset-source"),
      createJobClaim("job-source")
    );
    wrongSource.manifestCommitPlan = {
      ...wrongSource.manifestCommitPlan,
      sourceId: "source-other",
    };
    wrongSource.manifestCommitPlanDigest = createManifestCommitPlanDigest(
      wrongSource.manifestCommitPlan
    );
    const missingMutation = createPendingRecord(
      createProposal("changeset-mutation"),
      createJobClaim("job-mutation")
    );
    missingMutation.manifestCommitPlan = {
      ...missingMutation.manifestCommitPlan,
      mutations: [],
    };

    expect(diagnosticCodes(createSnapshot([wrongDigest, wrongSource, missingMutation]))).toEqual(
      expect.arrayContaining([
        "review_manifest_plan_digest_mismatch",
        "review_manifest_plan_identity_mismatch",
        "manifest_commit_change_unknown",
      ])
    );
  });

  it("rejects source content or pipeline drift even when source and input revision match", () => {
    const sourceProposal = createProposal("changeset-source-content");
    const sourceClaim = createJobClaim("job-source-content");
    const sourcePlan = createManifestCommitPlan(sourceProposal, sourceClaim);
    const sourceMismatch = createPendingRecord(
      sourceProposal,
      { ...sourceClaim, sourceContentHash: HASH_C },
      sourcePlan
    );
    const pipelineProposal = createProposal("changeset-pipeline");
    const pipelineClaim = createJobClaim("job-pipeline");
    const pipelinePlan = createManifestCommitPlan(pipelineProposal, pipelineClaim);
    const pipelineMismatch = createPendingRecord(
      pipelineProposal,
      { ...pipelineClaim, pipelineFingerprint: HASH_C },
      pipelinePlan
    );

    const codes = diagnosticCodes(createSnapshot([sourceMismatch, pipelineMismatch]));
    expect(codes.filter((code) => code === "review_manifest_plan_identity_mismatch")).toHaveLength(
      2
    );
  });

  it("rejects duplicate ChangeSet and queue job identities", () => {
    const first = createPendingRecord();
    const duplicateId = createPendingRecord(createProposal(), createJobClaim("job-2"));
    const duplicateJob = createPendingRecord(createProposal("changeset-2"), createJobClaim());

    expect(diagnosticCodes(createSnapshot([first, duplicateId, duplicateJob]))).toEqual(
      expect.arrayContaining(["review_changeset_id_duplicate", "review_job_id_duplicate"])
    );
  });

  it("accepts filtered and rewritten create/update changes with immutable provenance", () => {
    const before = "# Before\n";
    const after = "# After\n";
    const rewritten = "# Reviewed\n";
    const update: KnowledgeFileChange = {
      id: "change-update",
      path: "Wiki/Update.md",
      sourceRefs: ["source-1"],
      reason: "Update a grounded page",
      operation: "update",
      beforeHash: createFileContentHash(before),
      afterContent: after,
      afterHash: createFileContentHash(after),
    };
    const proposal = createProposal("changeset-rewrite", [createFileChange(), update]);
    const pending = createPendingRecord(proposal);
    const acceptedChangeSet: KnowledgeChangeSet = {
      ...proposal,
      status: "accepted",
      changes: [
        {
          ...update,
          afterContent: rewritten,
          afterHash: createFileContentHash(rewritten),
        },
      ],
    };
    const accepted: ChangeSetReviewRecord = {
      ...pending,
      recordRevision: 1,
      outcome: "accepted",
      acceptedChangeSet,
      acceptedDigest: createChangeSetTransactionDigest(acceptedChangeSet),
      manifestCommitIntent: projectManifestCommitIntent(
        pending.manifestCommitPlan,
        acceptedChangeSet
      ),
      manifestCommitIntentDigest: createManifestCommitIntentDigest(
        projectManifestCommitIntent(pending.manifestCommitPlan, acceptedChangeSet)
      ),
      acceptedAt: 201,
    };

    expect(validateChangeSetReviewSnapshot(createSnapshot([accepted]))).toEqual({
      valid: true,
      diagnostics: [],
    });
    expect(accepted.manifestCommitIntent.generatedPages).toEqual([
      {
        path: update.path,
        ownership: "generated",
        contentHash: createFileContentHash(rewritten),
      },
    ]);
  });

  it("rejects an accepted Manifest intent that differs from the exact reviewed projection", () => {
    const proposal = createProposal();
    const pending = createPendingRecord(proposal);
    const acceptedChangeSet: KnowledgeChangeSet = { ...proposal, status: "accepted" };
    const projected = projectManifestCommitIntent(pending.manifestCommitPlan, acceptedChangeSet);
    const mismatchedIntent = {
      ...projected,
      generatedPages: projected.generatedPages.map((page) => ({
        ...page,
        contentHash: HASH_B,
      })),
    };
    const accepted: ChangeSetReviewRecord = {
      ...pending,
      recordRevision: 1,
      outcome: "accepted",
      acceptedChangeSet,
      acceptedDigest: createChangeSetTransactionDigest(acceptedChangeSet),
      manifestCommitIntent: mismatchedIntent,
      manifestCommitIntentDigest: createManifestCommitIntentDigest(mismatchedIntent),
      acceptedAt: 201,
    };

    expect(diagnosticCodes(createSnapshot([accepted]))).toContain(
      "review_manifest_intent_projection_mismatch"
    );
  });

  it("rejects accepted intent drift from the exact reviewed Manifest plan digest", () => {
    const proposal = createProposal();
    const pending = createPendingRecord(proposal);
    const acceptedChangeSet: KnowledgeChangeSet = { ...proposal, status: "accepted" };
    const projected = projectManifestCommitIntent(pending.manifestCommitPlan, acceptedChangeSet);
    const mismatchedIntent = {
      ...projected,
      manifestCommitPlanDigest: "f".repeat(64),
    };
    const accepted: ChangeSetReviewRecord = {
      ...pending,
      recordRevision: 1,
      outcome: "accepted",
      acceptedChangeSet,
      acceptedDigest: createChangeSetTransactionDigest(acceptedChangeSet),
      manifestCommitIntent: mismatchedIntent,
      manifestCommitIntentDigest: createManifestCommitIntentDigest(mismatchedIntent),
      acceptedAt: 201,
    };

    expect(diagnosticCodes(createSnapshot([accepted]))).toContain(
      "review_manifest_intent_projection_mismatch"
    );
  });

  it("fails closed on accepted delete and accepted identity or provenance rewrites", () => {
    const deleteChange: KnowledgeFileChange = {
      id: "change-delete",
      path: "Wiki/Delete.md",
      sourceRefs: ["source-1"],
      reason: "Delete an obsolete generated page",
      operation: "delete",
      beforeHash: HASH_A,
    };
    const proposal = createProposal("changeset-delete", [deleteChange]);
    const pending = createPendingRecord(proposal);
    pending.manifestCommitPlan = {
      ...pending.manifestCommitPlan,
      baseGeneratedPages: [
        ...pending.manifestCommitPlan.baseGeneratedPages,
        {
          path: "Wiki/Keep.md",
          ownership: "generated",
          contentHash: HASH_B,
        },
      ],
    };
    pending.manifestCommitPlanDigest = createManifestCommitPlanDigest(pending.manifestCommitPlan);
    const exactAcceptedChangeSet: KnowledgeChangeSet = { ...proposal, status: "accepted" };
    const exactIntent = projectManifestCommitIntent(
      pending.manifestCommitPlan,
      exactAcceptedChangeSet
    );
    const acceptedChangeSet: KnowledgeChangeSet = {
      ...proposal,
      status: "accepted",
      sourceRefs: ["source-1", "injected-source"],
      changes: [{ ...deleteChange, path: "Wiki/Other.md" }],
    };
    const accepted: ChangeSetReviewRecord = {
      ...pending,
      recordRevision: 1,
      outcome: "accepted",
      acceptedChangeSet,
      acceptedDigest: createChangeSetTransactionDigest(acceptedChangeSet),
      manifestCommitIntent: exactIntent,
      manifestCommitIntentDigest: createManifestCommitIntentDigest(exactIntent),
      acceptedAt: 201,
    };

    expect(diagnosticCodes(createSnapshot([accepted]))).toEqual(
      expect.arrayContaining([
        "review_accepted_delete_disabled",
        "review_accepted_provenance_mismatch",
        "review_accepted_change_identity_mismatch",
      ])
    );
  });

  it("rejects terminal revision, digest, and timestamp inconsistencies", () => {
    const proposal = createProposal();
    const pending = createPendingRecord(proposal);
    const acceptedChangeSet = { ...proposal, status: "accepted" as const };
    const accepted = {
      ...pending,
      recordRevision: 1,
      outcome: "accepted",
      acceptedChangeSet,
      acceptedDigest: HASH_A,
      manifestCommitIntent: projectManifestCommitIntent(
        pending.manifestCommitPlan,
        acceptedChangeSet
      ),
      manifestCommitIntentDigest: HASH_A,
      acceptedAt: 199,
    } as unknown as ChangeSetReviewRecord;

    expect(diagnosticCodes(createSnapshot([accepted]))).toEqual(
      expect.arrayContaining([
        "review_accepted_digest_mismatch",
        "review_accepted_timestamp_invalid",
      ])
    );
    expect(
      parseChangeSetReviewSnapshot(
        createSnapshot([{ ...accepted, recordRevision: 2 } as unknown as ChangeSetReviewRecord])
      ).ok
    ).toBe(false);
  });

  it("requires pending revision zero and persistence after ChangeSet creation", () => {
    const pending = {
      ...createPendingRecord(),
      recordedAt: 99,
    };

    expect(diagnosticCodes(createSnapshot([pending]))).toContain(
      "review_recorded_timestamp_invalid"
    );
    expect(
      parseChangeSetReviewSnapshot(
        createSnapshot([
          { ...createPendingRecord(), recordRevision: 3 } as unknown as ChangeSetReviewRecord,
        ])
      ).ok
    ).toBe(false);
  });
});
