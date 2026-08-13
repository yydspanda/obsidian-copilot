import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS,
  KnowledgeForwardRevisionReviewSnapshotValidationError,
  createEmptyKnowledgeForwardRevisionReviewSnapshot,
  createKnowledgeForwardRevisionPublishedProposal,
  createKnowledgeForwardRevisionReviewSnapshotDigest,
  parseKnowledgeForwardRevisionReviewSnapshot,
  snapshotKnowledgeForwardRevisionPublishedProposal,
  snapshotKnowledgeForwardRevisionReviewSnapshot,
  validateKnowledgeForwardRevisionReviewSnapshot,
  type KnowledgeForwardRevisionPublishedProposalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshot";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const SELECTED_CONTENT = "# Historical output\n";
const SELECTED_HASH = createFileContentHash(SELECTED_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

/** Creates one canonical intent for a numbered request. */
function createIntent(pagePath = "Wiki/Topic.md", historicalTransaction = "transaction-old") {
  return createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath,
    historical: {
      bundleId: "personal",
      pagePath,
      transactionId: historicalTransaction,
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: `changeset-${historicalTransaction}`,
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash: SELECTED_HASH,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: ["source-1"],
      primarySourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_C,
      manifestBaseHash: HASH_A,
      vaultObservedBeforeHash: HASH_A,
    },
  });
}

/** Creates one strict pending proposal at the requested Runtime allocation. */
function createProposal(
  requestRevision = 1,
  pagePath = "Wiki/Topic.md",
  historicalTransaction = "transaction-old"
) {
  const intent = createIntent(pagePath, historicalTransaction);
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision,
    runtimeId: "runtime-1",
    bundleId: "personal",
    pagePath,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_B,
      acceptedDigest: HASH_C,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_D,
      acceptedAt: 90,
      targetChange: {
        changeId: `change-${requestRevision}`,
        path: pagePath,
        operation: "update",
        afterHash: SELECTED_HASH,
        sourceRefs: ["source-1"],
      },
      manifestPage: { path: pagePath, ownership: "generated", contentHash: SELECTED_HASH },
    },
    selectedContent: SELECTED_CONTENT,
    selectedContentHash: SELECTED_HASH,
    requestedAt: 120 + requestRevision,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({
    request,
    recordedAt: request.requestedAt,
  });
}

/** Creates one Runtime publication wrapper at exact revisions. */
function createPublished(
  requestRevision = 1,
  proposalStoreRevision = requestRevision,
  publishedRuntimeRevision = 10 + requestRevision,
  pagePath = "Wiki/Topic.md",
  historicalTransaction = "transaction-old"
) {
  return createKnowledgeForwardRevisionPublishedProposal({
    proposal: createProposal(requestRevision, pagePath, historicalTransaction),
    publishedRuntimeRevision,
    proposalStoreRevision,
  });
}

/** Produces a mutable JSON clone for adversarial persisted-state tests. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionReviewSnapshot", () => {
  it("creates a frozen strict empty Bundle namespace", () => {
    const snapshot = createEmptyKnowledgeForwardRevisionReviewSnapshot("personal");

    expect(snapshot).toEqual({
      version: 1,
      bundleId: "personal",
      revision: 0,
      lastRequestRevision: 0,
      records: [],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    expect(validateKnowledgeForwardRevisionReviewSnapshot(snapshot)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("retains original publication revisions in an immutable digest-bound wrapper", () => {
    const published = createPublished();
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshot({
      version: 1,
      bundleId: "personal",
      revision: 1,
      lastRequestRevision: 1,
      records: [published],
    });

    expect(snapshot.records[0]).toMatchObject({
      publishedRuntimeRevision: 11,
      proposalStoreRevision: 1,
    });
    expect(snapshot.records[0].proposalDigest).toHaveLength(64);
    expect(createKnowledgeForwardRevisionReviewSnapshotDigest(snapshot)).toHaveLength(64);
    expect(Object.isFrozen(snapshot.records[0])).toBe(true);
    expect(Object.isFrozen(snapshot.records[0].proposal)).toBe(true);
  });

  it("binds every proposal to its exact append-only Store publication revision", () => {
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshot({
      version: 1,
      bundleId: "personal",
      revision: 2,
      lastRequestRevision: 2,
      records: [
        createPublished(1, 1, 11),
        createPublished(2, 2, 15, "Wiki/Other.md", "transaction-other"),
      ],
    });

    expect(snapshot.revision).toBe(2);
    expect(snapshot.records.map((record) => record.proposalStoreRevision)).toEqual([1, 2]);
  });

  it("rejects digest substitution and impossible publication revisions", () => {
    const published = createPublished();
    const cases: unknown[] = [
      { ...published, proposalDigest: HASH_A },
      { ...published, publishedRuntimeRevision: 0 },
      { ...published, proposalStoreRevision: 0 },
      { ...published, extra: true },
    ];

    for (const value of cases) {
      expect(() => snapshotKnowledgeForwardRevisionPublishedProposal(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotValidationError
      );
    }
    for (const value of [
      { proposal: createProposal(2), publishedRuntimeRevision: 11, proposalStoreRevision: 1 },
      { proposal: createProposal(2), publishedRuntimeRevision: 1, proposalStoreRevision: 2 },
    ]) {
      expect(() => createKnowledgeForwardRevisionPublishedProposal(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotValidationError
      );
    }
  });

  it("rejects gaps, reordering, duplicates, Bundle drift, and Runtime replacement", () => {
    const first = createPublished(1, 1, 11);
    const second = createPublished(2, 2, 12, "Wiki/Other.md", "transaction-other");
    const secondRuntime = clone(second) as KnowledgeForwardRevisionPublishedProposalV1;
    (secondRuntime.proposal.request as { runtimeId: string }).runtimeId = "runtime-2";
    const candidates: unknown[] = [
      { version: 1, bundleId: "personal", revision: 2, lastRequestRevision: 1, records: [] },
      {
        version: 1,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [second, first],
      },
      {
        version: 1,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [first, first],
      },
      { version: 1, bundleId: "other", revision: 1, lastRequestRevision: 1, records: [first] },
      {
        version: 1,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [first, secondRuntime],
      },
      {
        version: 1,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [first, createPublished(2, 2, 12, "wiki/topic.md", "transaction-case-alias")],
      },
      {
        version: 1,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 1,
        records: [{ ...first, proposalStoreRevision: 2 }],
      },
      {
        version: 1,
        bundleId: "personal",
        revision: 100,
        lastRequestRevision: 1,
        records: [first],
      },
    ];

    for (const value of candidates) {
      expect(() => snapshotKnowledgeForwardRevisionReviewSnapshot(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotValidationError
      );
    }
  });

  it("rejects sparse or oversized arrays, accessors, unknown keys, and revoked proxies", () => {
    const sparse = new Array<KnowledgeForwardRevisionPublishedProposalV1>(1);
    const oversized = new Array(
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_LIMITS.maxRecords + 1
    ).fill(createPublished());
    const accessor = {
      version: 1,
      bundleId: "personal",
      revision: 0,
      lastRequestRevision: 0,
      records: [],
    } as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, "records", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [];
      },
    });
    const revoked = Proxy.revocable(
      createEmptyKnowledgeForwardRevisionReviewSnapshot("personal"),
      {}
    );
    revoked.revoke();

    for (const value of [
      { version: 1, bundleId: "personal", revision: 1, lastRequestRevision: 1, records: sparse },
      {
        version: 1,
        bundleId: "personal",
        revision: oversized.length,
        lastRequestRevision: oversized.length,
        records: oversized,
      },
      { ...createEmptyKnowledgeForwardRevisionReviewSnapshot("personal"), extra: true },
      accessor,
      revoked.proxy,
    ]) {
      expect(parseKnowledgeForwardRevisionReviewSnapshot(value).ok).toBe(false);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects aggregate selected content before deep proposal snapshotting", () => {
    const sharedSelectedContent = "x".repeat(2_000_000);
    const shell = { proposal: { request: { selectedContent: sharedSelectedContent } } };
    const records = new Array(9).fill(shell);

    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshot({
        version: 1,
        bundleId: "personal",
        revision: records.length,
        lastRequestRevision: records.length,
        records,
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotValidationError);
  });

  it("returns detached safe diagnostics without retaining invalid input", () => {
    const result = parseKnowledgeForwardRevisionReviewSnapshot({ version: 99 });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "forward_revision_review_snapshot_invalid",
          severity: "error",
          field: "forwardRevisionReview",
          message: "Forward revision Review state does not satisfy its strict contract",
        },
      ],
    });
    if (!result.ok) {
      result.issues[0].message = "changed";
    }
    expect(parseKnowledgeForwardRevisionReviewSnapshot({ version: 99 })).not.toEqual(result);
  });

  it("rejects unsafe identifiers and does not trust caller-constructed error instances", () => {
    for (const bundleId of [
      "personal\u0000",
      "personal\u0085",
      "personal\ud800",
      "personal\udc00",
    ]) {
      expect(() => createEmptyKnowledgeForwardRevisionReviewSnapshot(bundleId)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotValidationError
      );
    }

    const spoof = new KnowledgeForwardRevisionReviewSnapshotValidationError();
    const hostile = Proxy.revocable(createEmptyKnowledgeForwardRevisionReviewSnapshot("personal"), {
      getPrototypeOf: () => {
        throw spoof;
      },
    });
    expect(() => snapshotKnowledgeForwardRevisionReviewSnapshot(hostile.proxy)).toThrow(
      KnowledgeForwardRevisionReviewSnapshotValidationError
    );
    try {
      snapshotKnowledgeForwardRevisionReviewSnapshot(hostile.proxy);
    } catch (error) {
      expect(error).not.toBe(spoof);
    }

    let authentic: unknown;
    try {
      snapshotKnowledgeForwardRevisionReviewSnapshot({ version: 99 });
    } catch (error) {
      authentic = error;
    }
    expect(Object.isFrozen(authentic)).toBe(true);
    const laundering = Proxy.revocable(
      createEmptyKnowledgeForwardRevisionReviewSnapshot("personal"),
      {
        getPrototypeOf: () => {
          throw authentic;
        },
      }
    );
    expect(() => snapshotKnowledgeForwardRevisionReviewSnapshot(laundering.proxy)).toThrow(
      KnowledgeForwardRevisionReviewSnapshotValidationError
    );
  });

  it("does not retain caller-owned wrapper or snapshot containers", () => {
    const proposal = createProposal();
    const wrapperInput = {
      proposal,
      publishedRuntimeRevision: 11,
      proposalStoreRevision: 1,
    };
    const published = createKnowledgeForwardRevisionPublishedProposal(wrapperInput);
    const records = [published];
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshot({
      version: 1,
      bundleId: "personal",
      revision: 1,
      lastRequestRevision: 1,
      records,
    });

    wrapperInput.publishedRuntimeRevision = 99;
    records.length = 0;
    expect(published.publishedRuntimeRevision).toBe(11);
    expect(snapshot.records).toHaveLength(1);
  });
});
