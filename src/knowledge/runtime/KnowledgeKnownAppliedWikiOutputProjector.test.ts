import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  projectManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeFileChange } from "@/knowledge/model/types";
import type {
  AcceptedChangeSetReviewRecord,
  ChangeSetReviewRecord,
  ChangeSetReviewSnapshot,
} from "@/knowledge/review/ReviewStorage";
import {
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  KnowledgeKnownAppliedWikiOutputLimitError,
  KnowledgeKnownAppliedWikiOutputProjectionError,
  projectKnowledgeKnownAppliedWikiOutputDetail,
  projectKnowledgeKnownAppliedWikiOutputIndex,
} from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import type { KnowledgeApplyCommitLedgerRecord } from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const RUNTIME_ID = "1".repeat(32);
const PAGE_PATH = "Wiki/Topic.md";

/** One exact accepted Review and matching Apply ledger fixture. */
interface AppliedFixture {
  record: AcceptedChangeSetReviewRecord;
  ledger: KnowledgeApplyCommitLedgerRecord;
}

/** Creates one valid proposed create or update. */
function createChange(id: string, content: string, beforeContent?: string): KnowledgeFileChange {
  return beforeContent === undefined
    ? {
        id,
        path: PAGE_PATH,
        sourceRefs: ["source-1"],
        reason: "Create a grounded page",
        operation: "create",
        expectedAbsent: true,
        afterContent: content,
        afterHash: createFileContentHash(content),
      }
    : {
        id,
        path: PAGE_PATH,
        sourceRefs: ["source-1"],
        reason: "Update a grounded page",
        operation: "update",
        beforeHash: createFileContentHash(beforeContent),
        afterContent: content,
        afterHash: createFileContentHash(content),
      };
}

/** Creates one strict proposal around a single page mutation. */
function createProposal(
  id: string,
  change: KnowledgeFileChange,
  createdAt: number
): KnowledgeChangeSet {
  return {
    id,
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [change],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt,
  };
}

/** Creates the complete Manifest plan required by one fixture proposal. */
function createPlan(
  proposal: KnowledgeChangeSet,
  inputRevision: number,
  manifestRevision: number
): ManifestCommitPlan {
  const change = proposal.changes[0];
  if (!change) throw new Error("Expected one fixture change");
  return {
    version: 1,
    kind: "source_compile",
    bundleId: proposal.bundleId,
    sourceId: "source-1",
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision,
    changeSetId: proposal.id,
    expectedManifestRevision: manifestRevision,
    expectedManifestDigest: HASH_C,
    baseGeneratedPages:
      change.operation === "create"
        ? []
        : [{ path: change.path, ownership: "generated", contentHash: change.beforeHash }],
    mutations: [
      {
        changeId: change.id,
        path: change.path,
        operation: change.operation,
        access: change.operation === "create" ? "create_only" : "authorized",
        ownership: "generated",
        wasTrackedByPrimarySource: change.operation !== "create",
      },
    ],
  };
}

/** Creates one accepted Review with an exact matching Apply ledger. */
function createAppliedFixture(options: {
  suffix: string;
  content: string;
  beforeContent?: string;
  inputRevision: number;
  manifestAfterRevision: number;
  appliedAt: number;
  acceptedAt?: number;
}): AppliedFixture {
  const change = createChange(`change-${options.suffix}`, options.content, options.beforeContent);
  const proposal = createProposal(`changeset-${options.suffix}`, change, options.appliedAt - 20);
  const plan = createPlan(proposal, options.inputRevision, options.manifestAfterRevision - 1);
  const acceptedChangeSet: KnowledgeChangeSet = { ...proposal, status: "accepted" };
  const intent = projectManifestCommitIntent(plan, acceptedChangeSet);
  const acceptedDigest = createChangeSetTransactionDigest(acceptedChangeSet);
  const intentDigest = createManifestCommitIntentDigest(intent);
  const record: AcceptedChangeSetReviewRecord = {
    changeSetId: proposal.id,
    proposal,
    proposalDigest: createChangeSetTransactionDigest(proposal),
    manifestCommitPlan: plan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(plan),
    jobClaim: {
      jobId: `job-${options.suffix}`,
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: options.inputRevision,
      attempt: 1,
    },
    recordedAt: options.appliedAt - 10,
    outcome: "accepted",
    recordRevision: 1,
    acceptedChangeSet,
    acceptedDigest,
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: intentDigest,
    acceptedAt: options.acceptedAt ?? options.appliedAt - 5,
  };
  return {
    record,
    ledger: {
      transactionId: `transaction-${options.suffix}`,
      commitRevision: 4,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: options.inputRevision,
      changeSetId: proposal.id,
      changeSetDigest: acceptedDigest,
      manifestIntentDigest: intentDigest,
      journalDigest: HASH_A,
      receiptDigest: HASH_B,
      manifestBeforeRevision: options.manifestAfterRevision - 1,
      manifestBeforeDigest: HASH_A,
      manifestAfterRevision: options.manifestAfterRevision,
      manifestAfterDigest: HASH_B,
      recordedAt: options.appliedAt,
    },
  };
}

/** Creates one strict Review snapshot. */
function createReview(records: ChangeSetReviewRecord[]): ChangeSetReviewSnapshot {
  return { version: 2, bundleId: "personal", revision: records.length, records };
}

/** Creates common index input around exact Review and ledger fixtures. */
function createIndexInput(fixtures: AppliedFixture[]) {
  const currentChange = fixtures.at(-1)?.record.acceptedChangeSet.changes[0];
  const currentContentHash =
    currentChange && currentChange.operation !== "delete" ? currentChange.afterHash : HASH_A;
  return {
    runtimeId: RUNTIME_ID,
    runtimeRevision: 40,
    bundleId: "personal",
    pagePath: PAGE_PATH,
    applyCommits: fixtures.map(({ ledger }) => ledger),
    review: createReview(fixtures.map(({ record }) => record)),
    manifestRevision: 9,
    currentManifestPage: {
      path: PAGE_PATH,
      windowsPathKey: "wiki/topic.md",
      ownership: "generated" as const,
      contentHash: currentContentHash,
    },
  };
}

/** Selects the exact narrow detail input surface from one index fixture. */
function createDetailInput(
  input: ReturnType<typeof createIndexInput>,
  authority: ReturnType<
    typeof projectKnowledgeKnownAppliedWikiOutputIndex
  >["outputs"][number]["authority"]
) {
  return {
    runtimeId: input.runtimeId,
    runtimeRevision: input.runtimeRevision,
    bundleId: input.bundleId,
    pagePath: input.pagePath,
    applyCommits: input.applyCommits,
    review: input.review,
    authority,
  };
}

describe("KnowledgeKnownAppliedWikiOutputProjector", () => {
  it("projects metadata only, de-duplicates hashes, and orders by Apply recordedAt", () => {
    const first = createAppliedFixture({
      suffix: "first",
      content: "# First\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 1_000,
      acceptedAt: 99_000,
    });
    const second = createAppliedFixture({
      suffix: "second",
      content: "# Second\n",
      beforeContent: "# First\n",
      inputRevision: 2,
      manifestAfterRevision: 2,
      appliedAt: 2_000,
    });
    const repeated = createAppliedFixture({
      suffix: "repeated",
      content: "# First\n",
      beforeContent: "# Second\n",
      inputRevision: 3,
      manifestAfterRevision: 3,
      appliedAt: 3_000,
    });

    const snapshot = projectKnowledgeKnownAppliedWikiOutputIndex(
      createIndexInput([first, second, repeated])
    );

    expect(snapshot.outputs).toHaveLength(2);
    expect(snapshot.outputs[0]).toMatchObject({
      contentHash: createFileContentHash("# First\n"),
      characterCount: 8,
      newestAppliedAt: 3_000,
      newestManifestRevision: 3,
      verifiedApplyCount: 2,
      detailAvailability: "available",
    });
    expect(snapshot.outputs[0]).not.toHaveProperty("content");
    expect(snapshot.outputs[0]?.authority.transactionId).toBe("transaction-repeated");
    expect(snapshot.outputs[1]?.newestAppliedAt).toBe(2_000);
    expect(snapshot.currentManifestPage?.path).toBe(PAGE_PATH);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs[0]?.authority)).toBe(true);
  });

  it("rejoins exactly one selected body and fails stale on authority drift", () => {
    const fixture = createAppliedFixture({
      suffix: "detail",
      content: "# Exact detail\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const input = createIndexInput([fixture]);
    const index = projectKnowledgeKnownAppliedWikiOutputIndex(input);
    const authority = index.outputs[0]?.authority;
    if (!authority) throw new Error("Expected one output authority");

    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
      })
    ).toEqual({
      kind: "available",
      runtimeId: RUNTIME_ID,
      runtimeRevision: 40,
      contentHash: createFileContentHash("# Exact detail\n"),
      content: "# Exact detail\n",
      characterCount: 15,
    });
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        authority: { ...authority, transactionId: "transaction-other" },
      }).kind
    ).toBe("stale");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        runtimeId: "2".repeat(32),
      }).kind
    ).toBe("stale");
  });

  it("classifies an exact oversized body without returning its content", () => {
    const content = "x".repeat(KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters + 1);
    const fixture = createAppliedFixture({
      suffix: "large",
      content,
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const input = createIndexInput([fixture]);
    const index = projectKnowledgeKnownAppliedWikiOutputIndex(input);
    const item = index.outputs[0];
    if (!item) throw new Error("Expected one oversized output");

    expect(item.detailAvailability).toBe("too_large");
    expect(item).not.toHaveProperty("content");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail(createDetailInput(input, item.authority))
    ).toEqual({
      kind: "too_large",
      runtimeId: RUNTIME_ID,
      runtimeRevision: 40,
      contentHash: createFileContentHash(content),
      characterCount: content.length,
    });
  });

  it("excludes accepted-but-uncommitted and digest-tampered evidence", () => {
    const committed = createAppliedFixture({
      suffix: "committed",
      content: "# Committed\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const uncommitted = createAppliedFixture({
      suffix: "uncommitted",
      content: "# Uncommitted\n",
      inputRevision: 2,
      manifestAfterRevision: 2,
      appliedAt: 3_000,
    });
    const tampered = createAppliedFixture({
      suffix: "tampered",
      content: "# Tampered\n",
      inputRevision: 3,
      manifestAfterRevision: 3,
      appliedAt: 4_000,
    });
    tampered.record.acceptedChangeSet.changes[0] = {
      ...tampered.record.acceptedChangeSet.changes[0],
      afterContent: "# Changed without hash\n",
    } as KnowledgeFileChange;
    const input = createIndexInput([uncommitted, tampered]);
    input.applyCommits = [tampered.ledger];
    input.review = createReview([uncommitted.record, tampered.record]);

    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);

    const ambiguous = createIndexInput([committed]);
    ambiguous.review = createReview([committed.record, { ...committed.record }]);
    expect(() => projectKnowledgeKnownAppliedWikiOutputIndex(ambiguous)).toThrow(
      KnowledgeKnownAppliedWikiOutputProjectionError
    );
  });

  it("fails closed when two ledgers claim the same accepted page join", () => {
    const fixture = createAppliedFixture({
      suffix: "duplicate-ledger",
      content: "# Duplicate ledger\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const duplicate = {
      ...fixture.ledger,
      transactionId: "transaction-duplicate-ledger-other",
      manifestAfterRevision: 2,
      manifestBeforeRevision: 1,
    };
    const input = createIndexInput([fixture]);
    input.applyCommits = [fixture.ledger, duplicate];

    expect(() => projectKnowledgeKnownAppliedWikiOutputIndex(input)).toThrow(
      KnowledgeKnownAppliedWikiOutputProjectionError
    );
  });

  it("does not invoke hostile row accessors", () => {
    const getter = jest.fn(() => {
      throw new Error("must not run");
    });
    const hostileReviewRow = {};
    Object.defineProperty(hostileReviewRow, "outcome", {
      enumerable: true,
      get: getter,
    });
    const hostileLedgerRow = {};
    Object.defineProperty(hostileLedgerRow, "transactionId", {
      enumerable: true,
      get: getter,
    });

    const snapshot = projectKnowledgeKnownAppliedWikiOutputIndex({
      ...createIndexInput([]),
      applyCommits: [hostileLedgerRow as KnowledgeApplyCommitLedgerRecord],
      review: createReview([hostileReviewRow as ChangeSetReviewRecord]),
    });

    expect(snapshot.outputs).toEqual([]);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects extra projection and private-authority fields", () => {
    const fixture = createAppliedFixture({
      suffix: "exact-keys",
      content: "# Exact keys\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const input = createIndexInput([fixture]);
    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({ ...input, unexpected: true } as never)
    ).toThrow(KnowledgeKnownAppliedWikiOutputProjectionError);
    const hostileInput = new Proxy(input, {
      ownKeys() {
        throw new Error("must be sanitized");
      },
    });
    expect(() => projectKnowledgeKnownAppliedWikiOutputIndex(hostileInput)).toThrow(
      KnowledgeKnownAppliedWikiOutputProjectionError
    );

    const index = projectKnowledgeKnownAppliedWikiOutputIndex(input);
    const authority = index.outputs[0]?.authority;
    if (!authority) throw new Error("Expected one output authority");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        authority: { ...authority, unexpected: true } as never,
      }).kind
    ).toBe("stale");
  });

  it("rejects ledger, Review, and accepted-change counts above their caps", () => {
    const tooManyReviewRecords: ChangeSetReviewRecord[] = Array.from(
      { length: KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxReviewRecords + 1 },
      () => ({}) as ChangeSetReviewRecord
    );
    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...createIndexInput([]),
        applyCommits: new Array(
          KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxApplyCommits + 1
        ) as KnowledgeApplyCommitLedgerRecord[],
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputLimitError);

    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...createIndexInput([]),
        review: {
          version: 2,
          bundleId: "personal",
          revision: 1,
          records: tooManyReviewRecords,
        },
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputLimitError);

    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...createIndexInput([]),
        review: {
          version: 2,
          bundleId: "personal",
          revision: 1,
          records: [
            {
              outcome: "accepted",
              acceptedChangeSet: {
                changes: new Array(
                  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxAcceptedChanges + 1
                ),
              },
            },
          ],
        } as unknown as ChangeSetReviewSnapshot,
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputLimitError);
  });

  it("rejects cumulative accepted strings before validating or hashing the full history", () => {
    const fixture = createAppliedFixture({
      suffix: "character-budget",
      content: "# Small\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const oversized = Object.create(null) as AcceptedChangeSetReviewRecord;
    Object.assign(oversized, fixture.record, {
      proposal: {
        ...fixture.record.proposal,
        changes: [
          {
            ...fixture.record.proposal.changes[0],
            reason: "x".repeat(
              KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxTotalSnapshotCharacters + 1
            ),
          },
        ],
      },
    });
    const input = createIndexInput([fixture]);
    input.review = createReview([oversized]);

    try {
      projectKnowledgeKnownAppliedWikiOutputIndex(input);
      throw new Error("Expected the cumulative character limit to reject the history");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeKnownAppliedWikiOutputLimitError);
      expect((error as KnowledgeKnownAppliedWikiOutputLimitError).limit).toBe(
        "snapshot_characters"
      );
    }
  });

  it("bounds JSON keys and preserves prototype-like keys without prototype mutation", () => {
    const fixture = createAppliedFixture({
      suffix: "json-keys",
      content: "# Keys\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const unusual = JSON.parse(JSON.stringify(fixture.record)) as AcceptedChangeSetReviewRecord;
    Object.defineProperty(unusual.acceptedChangeSet, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const input = createIndexInput([fixture]);
    input.review = createReview([unusual]);
    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const hugeKey = "k".repeat(
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxTotalSnapshotCharacters + 1
    );
    const hugeKeyRecord = JSON.parse(
      JSON.stringify(fixture.record)
    ) as AcceptedChangeSetReviewRecord;
    Object.defineProperty(hugeKeyRecord.acceptedChangeSet, hugeKey, {
      value: true,
      enumerable: true,
    });
    input.review = createReview([hugeKeyRecord]);
    expect(() => projectKnowledgeKnownAppliedWikiOutputIndex(input)).toThrow(
      KnowledgeKnownAppliedWikiOutputLimitError
    );
  });

  it("fails closed when a nested array proxy revokes during descriptor capture", () => {
    const fixture = createAppliedFixture({
      suffix: "revoked-proxy",
      content: "# Proxy\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const { proxy, revoke } = Proxy.revocable(fixture.record.acceptedChangeSet, {
      ownKeys(target) {
        const keys = Reflect.ownKeys(target);
        revoke();
        return keys;
      },
    });
    const input = createIndexInput([fixture]);
    input.review = createReview([{ ...fixture.record, acceptedChangeSet: proxy }]);

    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);
  });

  it("rejects overlong request and current-page paths before normalization", () => {
    const fixture = createAppliedFixture({
      suffix: "path-limit",
      content: "# Path\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const input = createIndexInput([fixture]);
    const longPath = `${"a".repeat(
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
    )}.md`;
    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({ ...input, pagePath: longPath })
    ).toThrow(KnowledgeKnownAppliedWikiOutputProjectionError);
    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...input,
        currentManifestPage: { ...input.currentManifestPage, path: longPath },
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputProjectionError);
  });

  it("does not treat a Windows-case alias as the requested canonical page", () => {
    const fixture = createAppliedFixture({
      suffix: "case-alias",
      content: "# Case\n",
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const input = createIndexInput([fixture]);
    expect(
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...input,
        pagePath: "wiki/topic.md",
        currentManifestPage: undefined,
      }).outputs
    ).toEqual([]);
    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...input,
        pagePath: "wiki/topic.md",
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputProjectionError);
  });
});
