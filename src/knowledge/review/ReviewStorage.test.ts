import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
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

/** Creates one pending record whose proposal digest is exact. */
function createPendingRecord(
  proposal = createProposal(),
  jobClaim = createJobClaim()
): ChangeSetReviewRecord {
  return {
    changeSetId: proposal.id,
    recordRevision: 0,
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    jobClaim,
    recordedAt: 200,
    outcome: "pending",
  };
}

/** Creates a complete v1 snapshot around supplied records. */
function createSnapshot(records: ChangeSetReviewRecord[]): ChangeSetReviewSnapshot {
  return { version: 1, bundleId: "bundle-1", revision: 1, records };
}

/** Extracts stable diagnostic codes from one semantic validation result. */
function diagnosticCodes(snapshot: ChangeSetReviewSnapshot): string[] {
  return validateChangeSetReviewSnapshot(snapshot).diagnostics.map(({ code }) => code);
}

describe("ReviewStorage contracts", () => {
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
    ["wrong version", { ...createSnapshot([]), version: 2 }],
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
      acceptedAt: 201,
    };

    expect(validateChangeSetReviewSnapshot(createSnapshot([accepted]))).toEqual({
      valid: true,
      diagnostics: [],
    });
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
