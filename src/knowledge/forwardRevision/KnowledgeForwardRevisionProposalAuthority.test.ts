import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionProposalAuthorityQuery,
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION,
  snapshotKnowledgeForwardRevisionProposalAuthority,
  snapshotKnowledgeForwardRevisionProposalAuthorityQuery,
  type KnowledgeForwardRevisionProposalAuthorityQueryV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalAuthority";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const SELECTED_CONTENT = "# Historical\n";
const CURRENT_CONTENT = "# Current\n";

/** Creates one exact authority query used by protocol tests. */
function createQuery(): Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1> {
  return createKnowledgeForwardRevisionProposalAuthorityQuery({
    bundleId: "bundle-a",
    pagePath: "Wiki/Page.md",
    selectedContentHash: createFileContentHash(SELECTED_CONTENT),
    selectedAppliedAt: 100,
    selectedVerifiedApplyCount: 1,
    vaultObservedBeforeHash: createFileContentHash(CURRENT_CONTENT),
  });
}

/** Creates one strict Runtime-projected authority response. */
function createAuthority(query = createQuery()): Readonly<Record<string, unknown>> {
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: query.bundleId,
    pagePath: query.pagePath,
    historical: {
      bundleId: query.bundleId,
      pagePath: query.pagePath,
      transactionId: "transaction-old",
      sourceId: "source-a",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      changeSetId: "change-set-old",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 2,
      manifestAfterDigest: HASH_E,
      appliedAt: query.selectedAppliedAt,
      selectedContentHash: query.selectedContentHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: ["source-a"],
      primarySourceId: "source-a",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      manifestRevision: 3,
      manifestDigest: HASH_F,
      manifestBaseHash: query.vaultObservedBeforeHash,
      vaultObservedBeforeHash: query.vaultObservedBeforeHash,
    },
  });
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION,
    kind: "forward_revision_proposal_authority",
    runtimeId: "runtime-a",
    runtimeRevision: 10,
    query,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: Object.freeze({
      proposalDigest: HASH_A,
      acceptedDigest: HASH_C,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_D,
      acceptedAt: 90,
      targetChange: Object.freeze({
        changeId: "change-old",
        path: query.pagePath,
        operation: "update",
        afterHash: query.selectedContentHash,
        sourceRefs: Object.freeze(["source-a"]),
      }),
      manifestPage: Object.freeze({
        path: query.pagePath,
        ownership: "generated",
        contentHash: query.selectedContentHash,
      }),
    }),
  });
}

describe("KnowledgeForwardRevisionProposalAuthority", () => {
  it("strictly rejoins the exact query, intent, Review authority, and selected bytes", () => {
    const query = createQuery();
    const authority = snapshotKnowledgeForwardRevisionProposalAuthority(
      createAuthority(query),
      query,
      SELECTED_CONTENT
    );

    expect(authority.query).toEqual(query);
    expect(authority.intent.historical.selectedContentHash).toBe(
      createFileContentHash(SELECTED_CONTENT)
    );
    expect(authority.intent.current.vaultObservedBeforeHash).toBe(
      createFileContentHash(CURRENT_CONTENT)
    );
    expect(authority.historicalReviewAuthority.targetChange.sourceRefs).toEqual(["source-a"]);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.intent)).toBe(true);
  });

  it("rejects query replay against a different exact-case path or observation", () => {
    const query = createQuery();
    const differentPath = snapshotKnowledgeForwardRevisionProposalAuthorityQuery({
      ...query,
      pagePath: "Wiki/page.md",
    });
    const differentObservation = snapshotKnowledgeForwardRevisionProposalAuthorityQuery({
      ...query,
      vaultObservedBeforeHash: HASH_A,
    });

    expect(() =>
      snapshotKnowledgeForwardRevisionProposalAuthority(
        createAuthority(query),
        differentPath,
        SELECTED_CONTENT
      )
    ).toThrow("Forward revision proposal authority is invalid");
    expect(() =>
      snapshotKnowledgeForwardRevisionProposalAuthority(
        createAuthority(query),
        differentObservation,
        SELECTED_CONTENT
      )
    ).toThrow("Forward revision proposal authority is invalid");
  });

  it("rejects historical authority that does not match the selected body", () => {
    const query = createQuery();
    expect(() =>
      snapshotKnowledgeForwardRevisionProposalAuthority(
        createAuthority(query),
        query,
        "# Different historical body\n"
      )
    ).toThrow("Forward revision proposal authority is invalid");
  });

  it("rejects malformed query counts, extras, and accessor laundering", () => {
    const query = createQuery();
    expect(() =>
      snapshotKnowledgeForwardRevisionProposalAuthorityQuery({
        ...query,
        selectedVerifiedApplyCount: 0,
      })
    ).toThrow("Forward revision proposal authority is invalid");
    expect(() =>
      snapshotKnowledgeForwardRevisionProposalAuthorityQuery({ ...query, extra: true })
    ).toThrow("Forward revision proposal authority is invalid");

    const hostile = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(query)) hostile[key] = value;
    Object.defineProperty(hostile, "bundleId", {
      enumerable: true,
      get: () => "bundle-a",
    });
    expect(() => snapshotKnowledgeForwardRevisionProposalAuthorityQuery(hostile)).toThrow(
      "Forward revision proposal authority is invalid"
    );
  });

  it("mints frozen value-free validation failures", () => {
    let thrown: unknown;
    try {
      snapshotKnowledgeForwardRevisionProposalAuthority({}, createQuery(), SELECTED_CONTENT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(Object.isFrozen(thrown)).toBe(true);
    expect(String(thrown)).not.toContain(SELECTED_CONTENT);
  });
});
