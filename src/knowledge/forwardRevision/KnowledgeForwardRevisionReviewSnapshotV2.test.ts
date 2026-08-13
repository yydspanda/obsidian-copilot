import {
  createKnowledgeForwardRevisionAcceptedDecisionRecord,
  createKnowledgeForwardRevisionRejectedDecisionRecord,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { createKnowledgeForwardRevisionReviewCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionPublishedProposal,
  snapshotKnowledgeForwardRevisionReviewSnapshot,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshot";
import {
  KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS,
  KnowledgeForwardRevisionReviewSnapshotV2ValidationError,
  createEmptyKnowledgeForwardRevisionReviewSnapshotV2,
  createKnowledgeForwardRevisionPendingReviewEntryV2,
  createKnowledgeForwardRevisionReviewSnapshotV2Digest,
  createKnowledgeForwardRevisionTerminalReviewEntryV2,
  migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2,
  parseKnowledgeForwardRevisionReviewSnapshotV2,
  projectKnowledgeForwardRevisionReviewEntryProposalV2,
  snapshotKnowledgeForwardRevisionPendingReviewEntryV2,
  snapshotKnowledgeForwardRevisionReviewSnapshotV2,
  snapshotKnowledgeForwardRevisionTerminalReviewEntryV2,
  validateKnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionReviewEntryV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import {
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const HISTORICAL_CONTENT = "# Historical output\n";
const CURRENT_CONTENT = "# Current output\n";
const CURRENT_HASH = createFileContentHash(CURRENT_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates one strict pending proposal with independently variable durable identity. */
function createProposal(
  requestRevision = 1,
  pagePath = "Wiki/Topic.md",
  historicalTransaction = "transaction-historical",
  selectedContent = HISTORICAL_CONTENT,
  runtimeId = "runtime-1",
  bundleId = "personal"
) {
  const selectedContentHash = createFileContentHash(selectedContent);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId,
    pagePath,
    historical: {
      bundleId,
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
      selectedContentHash,
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
      manifestDigest: HASH_F,
      manifestBaseHash: CURRENT_HASH,
      vaultObservedBeforeHash: CURRENT_HASH,
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision,
    runtimeId,
    bundleId,
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
        changeId: `change-${historicalTransaction}`,
        path: pagePath,
        operation: "update",
        afterHash: selectedContentHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: { path: pagePath, ownership: "generated", contentHash: selectedContentHash },
    },
    selectedContent,
    selectedContentHash,
    requestedAt: 120 + requestRevision,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({
    request,
    recordedAt: request.requestedAt,
  });
}

/** Creates one coherent current-source acceptance tuple for a proposal. */
function createAppliedAuthority(
  proposal: ReturnType<typeof createProposal>,
  runtimeRevision = 20
): KnowledgeForwardRevisionAcceptanceAuthority {
  const current = proposal.request.intent.current;
  return {
    runtimeId: proposal.request.runtimeId,
    runtimeRevision,
    runtimeDigest: HASH_E,
    manifestRevision: current.manifestRevision,
    manifestDigest: current.manifestDigest,
    manifestBaseHash: current.manifestBaseHash,
    vaultObservedBeforeHash: current.vaultObservedBeforeHash,
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: proposal.request.runtimeId,
      runtimeRevision,
      runtimeDigest: HASH_E,
      bundleId: proposal.request.bundleId,
      sourceId: current.primarySourceId,
      sourceContentHash: current.sourceContentHash,
      pipelineFingerprint: current.pipelineFingerprint,
      inputRevision: current.inputRevision,
      manifestRevision: current.manifestRevision,
      manifestDigest: current.manifestDigest,
      committedManifestRevision: 8,
      completedAt: 115,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_D,
      manifestIntentDigest: HASH_C,
      committedManifestDigest: HASH_B,
    },
  };
}

/** Creates strict command and validation receipt material for one accepted body. */
function createValidationMaterial(
  proposal: ReturnType<typeof createProposal>,
  proposalDigest: string,
  afterContent: string,
  acceptanceAuthority: KnowledgeForwardRevisionAcceptanceAuthority
) {
  const action =
    afterContent === proposal.request.selectedContent ? "accept_exact" : "accept_edited";
  const command = createKnowledgeForwardRevisionReviewCommand(
    action === "accept_exact"
      ? { action, proposal, proposalDigest }
      : { action, proposal, proposalDigest, afterContent }
  );
  const validationReadSet = [
    {
      version: 1,
      kind: "forward_revision_validation_artifact_identity",
      artifactKind: "markdown",
      sourceId: proposal.request.intent.current.primarySourceId,
      artifactId: "artifact-1",
      artifactContentHash: HASH_A,
    },
  ];
  const validationReceipt = createKnowledgeForwardRevisionValidationReceipt({
    proposal,
    proposalDigest,
    command,
    afterContent,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    validationProfile: {
      version: 1,
      kind: "forward_revision_validation_profile",
      profileId: "profile-1",
      profileVersion: 1,
      profileConfigurationDigest: HASH_A,
      bundleConfigurationDigest: HASH_B,
      validatorImplementationId: "deterministic-validator",
      validatorImplementationVersion: 1,
      validatorImplementationDigest: HASH_C,
    },
    acceptanceAuthority,
    historicalCitations: [],
    validationReadSet,
    sourceArtifactObservationBindingDigest:
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        acceptanceAuthority,
        validationReadSet
      ),
    warningSummary: null,
    validatedAt: 125,
  });
  return { command, validationReceipt, validationReceiptDigest: validationReceipt.receiptDigest };
}

/** Creates one pending v2 entry at exact Store and Runtime revisions. */
function createPendingEntry(
  proposal: ReturnType<typeof createProposal>,
  proposalStoreRevision: number,
  publishedRuntimeRevision: number
) {
  return createKnowledgeForwardRevisionPendingReviewEntryV2({
    proposal,
    proposalStoreRevision,
    publishedRuntimeRevision,
  });
}

/** Creates one accepted v2 entry at exact publication and decision revisions. */
function createAcceptedEntry(
  proposal: ReturnType<typeof createProposal>,
  proposalStoreRevision: number,
  publishedRuntimeRevision: number,
  decisionStoreRevision: number,
  decidedRuntimeRevision: number,
  afterContent = `${proposal.request.selectedContent}\nEdited\n`
) {
  const proposalDigest = createKnowledgeForwardRevisionPendingReviewEntryV2({
    proposal,
    proposalStoreRevision,
    publishedRuntimeRevision,
  }).proposalDigest;
  const acceptanceAuthority = createAppliedAuthority(proposal, decidedRuntimeRevision - 1);
  const validationMaterial = createValidationMaterial(
    proposal,
    proposalDigest,
    afterContent,
    acceptanceAuthority
  );
  const decision = createKnowledgeForwardRevisionAcceptedDecisionRecord({
    proposal,
    proposalDigest,
    afterContent,
    acceptanceAuthority,
    ...validationMaterial,
    acceptedAt: 140 + proposal.request.requestRevision,
  });
  return createKnowledgeForwardRevisionTerminalReviewEntryV2({
    decision,
    proposalStoreRevision,
    publishedRuntimeRevision,
    decisionStoreRevision,
    decidedRuntimeRevision,
  });
}

/** Creates one rejected v2 entry at exact publication and decision revisions. */
function createRejectedEntry(
  proposal: ReturnType<typeof createProposal>,
  proposalStoreRevision: number,
  publishedRuntimeRevision: number,
  decisionStoreRevision: number,
  decidedRuntimeRevision: number
) {
  const publication = createKnowledgeForwardRevisionPendingReviewEntryV2({
    proposal,
    proposalStoreRevision,
    publishedRuntimeRevision,
  });
  const decision = createKnowledgeForwardRevisionRejectedDecisionRecord({
    proposal,
    proposalDigest: publication.proposalDigest,
    rejectedAt: 140 + proposal.request.requestRevision,
  });
  return createKnowledgeForwardRevisionTerminalReviewEntryV2({
    decision,
    proposalStoreRevision,
    publishedRuntimeRevision,
    decisionStoreRevision,
    decidedRuntimeRevision,
  });
}

/** Produces a mutable JSON clone for stateful descriptor-proxy tests. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Makes the aggregate precheck observe a short body before strict snapshotting sees the real one. */
function createShortThenFullProposalProxy(
  entry: ReturnType<typeof createPendingEntry>,
  onDeepRead?: () => void
): unknown {
  const target = clone(entry) as unknown as Record<string, unknown>;
  let proposalDescriptorReads = 0;
  return new Proxy(target, {
    getOwnPropertyDescriptor: (proxyTarget, key) => {
      if (key === "proposal") {
        proposalDescriptorReads += 1;
        if (proposalDescriptorReads === 1) {
          return {
            value: { request: { selectedContent: "x" } },
            enumerable: true,
            writable: true,
            configurable: true,
          };
        }
        onDeepRead?.();
      }
      return Reflect.getOwnPropertyDescriptor(proxyTarget, key);
    },
  });
}

describe("KnowledgeForwardRevisionReviewSnapshotV2", () => {
  it("creates a frozen empty decision-capable Bundle namespace", () => {
    const snapshot = createEmptyKnowledgeForwardRevisionReviewSnapshotV2("personal");

    expect(snapshot).toEqual({
      version: 2,
      bundleId: "personal",
      revision: 0,
      lastRequestRevision: 0,
      records: [],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    expect(validateKnowledgeForwardRevisionReviewSnapshotV2(snapshot)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("retains publication proof and terminal decision proof without duplicating proposals", () => {
    const accepted = createAcceptedEntry(createProposal(), 1, 11, 2, 21);
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
      version: 2,
      bundleId: "personal",
      revision: 2,
      lastRequestRevision: 1,
      records: [accepted],
    });

    expect(snapshot.records[0]).toMatchObject({
      state: "accepted",
      recordRevision: 1,
      publishedRuntimeRevision: 11,
      proposalStoreRevision: 1,
      decidedRuntimeRevision: 21,
      decisionStoreRevision: 2,
    });
    expect("proposal" in snapshot.records[0]).toBe(false);
    expect("proposalDigest" in snapshot.records[0]).toBe(false);
    expect(projectKnowledgeForwardRevisionReviewEntryProposalV2(snapshot.records[0])).toEqual({
      proposal: accepted.decision.proposal,
      proposalDigest: accepted.decision.proposalDigest,
      publishedRuntimeRevision: 11,
      proposalStoreRevision: 1,
    });
    expect(createKnowledgeForwardRevisionReviewSnapshotV2Digest(snapshot)).toHaveLength(64);
    expect(Object.isFrozen(snapshot.records[0])).toBe(true);
    expect(Object.isFrozen(accepted.decision)).toBe(true);
  });

  it("treats Store revision as an exact publication-plus-decision event sequence", () => {
    const accepted = createAcceptedEntry(createProposal(1), 1, 11, 2, 21);
    const rejected = createRejectedEntry(
      createProposal(2, "Wiki/Released.md", "transaction-rejected"),
      3,
      22,
      4,
      23
    );
    const replacement = createPendingEntry(
      createProposal(3, "wiki/released.md", "transaction-replacement"),
      5,
      24
    );
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
      version: 2,
      bundleId: "personal",
      revision: 5,
      lastRequestRevision: 3,
      records: [accepted, rejected, replacement],
    });

    expect(snapshot.records.map((entry) => entry.state)).toEqual([
      "accepted",
      "rejected",
      "pending",
    ]);
    expect(snapshot.revision).toBe(5);
    expect(snapshot.lastRequestRevision).toBe(3);
  });

  it("allows a decision event between consecutive request publications", () => {
    const rejected = createRejectedEntry(createProposal(1), 1, 11, 2, 12);
    const next = createPendingEntry(createProposal(2, "Wiki/Next.md", "transaction-next"), 3, 13);

    expect(
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: 3,
        lastRequestRevision: 2,
        records: [rejected, next],
      }).records.map((entry) => entry.proposalStoreRevision)
    ).toEqual([1, 3]);
  });

  it("rejects event gaps, duplicate or regressing Runtime revisions, and wrong event counts", () => {
    const first = createPendingEntry(createProposal(1), 1, 11);
    const second = createPendingEntry(
      createProposal(2, "Wiki/Other.md", "transaction-other"),
      2,
      12
    );
    const acceptedWithGap = createAcceptedEntry(createProposal(1), 1, 11, 3, 21);
    const publicationOrderedFirst = createRejectedEntry(createProposal(1), 1, 11, 2, 12);
    const publicationReorderedSecond = createRejectedEntry(
      createProposal(2, "Wiki/Other.md", "transaction-other"),
      4,
      14,
      5,
      15
    );
    const publicationReorderedThird = createPendingEntry(
      createProposal(3, "Wiki/Third.md", "transaction-third"),
      3,
      13
    );
    const candidates: unknown[] = [
      { version: 2, bundleId: "personal", revision: 2, lastRequestRevision: 1, records: [first] },
      {
        version: 2,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 1,
        records: [acceptedWithGap],
      },
      {
        version: 2,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [first, { ...second, publishedRuntimeRevision: 11 }],
      },
      {
        version: 2,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [first, { ...second, publishedRuntimeRevision: 10 }],
      },
      {
        version: 2,
        bundleId: "personal",
        revision: 5,
        lastRequestRevision: 3,
        records: [publicationOrderedFirst, publicationReorderedSecond, publicationReorderedThird],
      },
    ];

    for (const value of candidates) {
      expect(() => snapshotKnowledgeForwardRevisionReviewSnapshotV2(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotV2ValidationError
      );
    }
  });

  it("enforces exact request allocation, one Runtime and Bundle, and durable identity uniqueness", () => {
    const first = createRejectedEntry(createProposal(1), 1, 11, 2, 12);
    const sameIntent = createRejectedEntry(createProposal(2), 3, 13, 4, 14);
    const requestGap = createPendingEntry(
      createProposal(2, "Wiki/Other.md", "transaction-other"),
      2,
      11
    );
    const otherRuntime = createPendingEntry(
      createProposal(2, "Wiki/Other.md", "transaction-other", HISTORICAL_CONTENT, "runtime-2"),
      2,
      12
    );
    const candidates: unknown[] = [
      {
        version: 2,
        bundleId: "personal",
        revision: 1,
        lastRequestRevision: 1,
        records: [requestGap],
      },
      {
        version: 2,
        bundleId: "personal",
        revision: 2,
        lastRequestRevision: 2,
        records: [createPendingEntry(createProposal(1), 1, 11), otherRuntime],
      },
      {
        version: 2,
        bundleId: "other",
        revision: 1,
        lastRequestRevision: 1,
        records: [createPendingEntry(createProposal(1), 1, 11)],
      },
      {
        version: 2,
        bundleId: "personal",
        revision: 4,
        lastRequestRevision: 2,
        records: [first, sameIntent],
      },
    ];

    for (const value of candidates) {
      expect(() => snapshotKnowledgeForwardRevisionReviewSnapshotV2(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotV2ValidationError
      );
    }
  });

  it("keeps pending and accepted pages exclusive while rejected pages are released", () => {
    const accepted = createAcceptedEntry(createProposal(1), 1, 11, 2, 21);
    const alias = createPendingEntry(
      createProposal(2, "wiki/topic.md", "transaction-alias"),
      3,
      22
    );
    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: 3,
        lastRequestRevision: 2,
        records: [accepted, alias],
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);

    const rejected = createRejectedEntry(createProposal(1), 1, 11, 2, 12);
    const replacement = createPendingEntry(
      createProposal(2, "wiki/topic.md", "transaction-replacement"),
      3,
      13
    );
    expect(
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: 3,
        lastRequestRevision: 2,
        records: [rejected, replacement],
      }).records
    ).toHaveLength(2);
  });

  it("requires page rejection to commit before a case-folded replacement is published", () => {
    const lateRejected = createRejectedEntry(createProposal(1), 1, 11, 3, 13);
    const earlyReplacement = createPendingEntry(
      createProposal(2, "wiki/topic.md", "transaction-early-replacement"),
      2,
      12
    );
    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: 3,
        lastRequestRevision: 2,
        records: [lateRejected, earlyReplacement],
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);

    const firstRejected = createRejectedEntry(createProposal(1), 1, 11, 2, 12);
    const secondRejected = createRejectedEntry(
      createProposal(2, "wiki/topic.md", "transaction-second"),
      3,
      13,
      4,
      14
    );
    const thirdPending = createPendingEntry(
      createProposal(3, "WIKI/TOPIC.MD", "transaction-third"),
      5,
      15
    );
    expect(
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: 5,
        lastRequestRevision: 3,
        records: [firstRejected, secondRejected, thirdPending],
      }).records
    ).toHaveLength(3);
  });

  it("binds entry states, nested record revisions, full decision digests, and chronology", () => {
    const pending = createPendingEntry(createProposal(), 1, 11);
    const accepted = createAcceptedEntry(createProposal(), 1, 11, 2, 21);
    const pendingCases: unknown[] = [
      { ...pending, recordRevision: 1 },
      { ...pending, proposalDigest: HASH_A },
      { ...pending, extra: true },
    ];
    const terminalCases: unknown[] = [
      { ...accepted, state: "rejected" },
      { ...accepted, recordRevision: 0 },
      { ...accepted, decisionDigest: HASH_A },
      { ...accepted, decisionStoreRevision: 1 },
      { ...accepted, decidedRuntimeRevision: 11 },
      { ...accepted, decidedRuntimeRevision: 22 },
      { ...accepted, decisionStoreRevision: 22, decidedRuntimeRevision: 21 },
      { ...accepted, extra: true },
    ];

    for (const value of pendingCases) {
      expect(() => snapshotKnowledgeForwardRevisionPendingReviewEntryV2(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotV2ValidationError
      );
    }
    for (const value of terminalCases) {
      expect(() => snapshotKnowledgeForwardRevisionTerminalReviewEntryV2(value)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotV2ValidationError
      );
    }
  });

  it("migrates v1 publications exactly into pending v2 records", () => {
    const first = createProposal(1);
    const second = createProposal(2, "Wiki/Other.md", "transaction-other");
    const legacy = snapshotKnowledgeForwardRevisionReviewSnapshot({
      version: 1,
      bundleId: "personal",
      revision: 2,
      lastRequestRevision: 2,
      records: [
        createKnowledgeForwardRevisionPublishedProposal({
          proposal: first,
          proposalStoreRevision: 1,
          publishedRuntimeRevision: 11,
        }),
        createKnowledgeForwardRevisionPublishedProposal({
          proposal: second,
          proposalStoreRevision: 2,
          publishedRuntimeRevision: 14,
        }),
      ],
    });
    const migrated = migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2(legacy);

    expect(migrated).toMatchObject({
      version: 2,
      bundleId: legacy.bundleId,
      revision: legacy.revision,
      lastRequestRevision: legacy.lastRequestRevision,
    });
    expect(migrated.records.map((entry) => entry.state)).toEqual(["pending", "pending"]);
    expect(migrated.records.map((entry) => entry.recordRevision)).toEqual([0, 0]);
    expect(migrated.records.map((entry) => entry.proposalStoreRevision)).toEqual([1, 2]);
    expect(
      migrated.records.map((entry) =>
        entry.state === "pending" ? entry.proposal.proposalId : undefined
      )
    ).toEqual(legacy.records.map((entry) => entry.proposal.proposalId));
  });

  it("counts every physically retained pending and terminal body exactly once", () => {
    const body = "x".repeat(1_000_000);
    const proposal = createProposal(1, "Wiki/Large.md", "transaction-large", body);
    const accepted = createAcceptedEntry(proposal, 1, 11, 2, 21, `${body}y`);
    const rawEntries = new Array(9).fill(accepted);

    expect(body.length * rawEntries.length * 2 + rawEntries.length).toBeGreaterThan(
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxTotalRetainedBodyCharacters
    );
    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: rawEntries.length * 2,
        lastRequestRevision: rawEntries.length,
        records: rawEntries,
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);
  });

  it("rechecks detached bodies after stateful proxies evade the raw aggregate precheck", () => {
    const body = "x".repeat(2_000_000);
    const statefulEntries = Array.from({ length: 9 }, (_, index) =>
      createShortThenFullProposalProxy(
        createPendingEntry(
          createProposal(
            index + 1,
            `Wiki/Large-${index + 1}.md`,
            `transaction-large-${index + 1}`,
            body
          ),
          index + 1,
          index + 11
        )
      )
    );

    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: statefulEntries.length,
        lastRequestRevision: statefulEntries.length,
        records: statefulEntries,
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);
  });

  it("stops deep snapshotting when detached bodies cross the aggregate limit", () => {
    const body = "x".repeat(2_000_000);
    let afterLimitDeepReads = 0;
    const statefulEntries = Array.from({ length: 10 }, (_, index) =>
      createShortThenFullProposalProxy(
        createPendingEntry(
          createProposal(
            index + 1,
            `Wiki/Stop-${index + 1}.md`,
            `transaction-stop-${index + 1}`,
            body
          ),
          index + 1,
          index + 11
        ),
        index === 9 ? () => (afterLimitDeepReads += 1) : undefined
      )
    );

    expect(() =>
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({
        version: 2,
        bundleId: "personal",
        revision: statefulEntries.length,
        lastRequestRevision: statefulEntries.length,
        records: statefulEntries,
      })
    ).toThrow(KnowledgeForwardRevisionReviewSnapshotV2ValidationError);
    expect(afterLimitDeepReads).toBe(0);
  });

  it("rejects sparse and oversized arrays, accessors, unknown keys, and revoked proxies", () => {
    const sparse = new Array<KnowledgeForwardRevisionReviewEntryV2>(1);
    const oversized = new Array(
      KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxRecords + 1
    ).fill(createPendingEntry(createProposal(), 1, 11));
    const accessor = {
      version: 2,
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
      createEmptyKnowledgeForwardRevisionReviewSnapshotV2("personal"),
      {}
    );
    revoked.revoke();

    for (const value of [
      { version: 2, bundleId: "personal", revision: 1, lastRequestRevision: 1, records: sparse },
      {
        version: 2,
        bundleId: "personal",
        revision: oversized.length,
        lastRequestRevision: oversized.length,
        records: oversized,
      },
      { ...createEmptyKnowledgeForwardRevisionReviewSnapshotV2("personal"), extra: true },
      accessor,
      revoked.proxy,
    ]) {
      expect(parseKnowledgeForwardRevisionReviewSnapshotV2(value).ok).toBe(false);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects unsafe identifiers and only propagates authentic in-flight failures", () => {
    for (const bundleId of [
      "personal\u0000",
      "personal\u0085",
      "personal\ud800",
      "personal\udc00",
    ]) {
      expect(() => createEmptyKnowledgeForwardRevisionReviewSnapshotV2(bundleId)).toThrow(
        KnowledgeForwardRevisionReviewSnapshotV2ValidationError
      );
    }

    const spoof = new KnowledgeForwardRevisionReviewSnapshotV2ValidationError();
    const hostile = Proxy.revocable(
      createEmptyKnowledgeForwardRevisionReviewSnapshotV2("personal"),
      {
        getPrototypeOf: () => {
          throw spoof;
        },
      }
    );
    expect(() => snapshotKnowledgeForwardRevisionReviewSnapshotV2(hostile.proxy)).toThrow(
      KnowledgeForwardRevisionReviewSnapshotV2ValidationError
    );
    try {
      snapshotKnowledgeForwardRevisionReviewSnapshotV2(hostile.proxy);
    } catch (error) {
      expect(error).not.toBe(spoof);
    }

    let authentic: unknown;
    try {
      snapshotKnowledgeForwardRevisionReviewSnapshotV2({ version: 99 });
    } catch (error) {
      authentic = error;
    }
    expect(Object.isFrozen(authentic)).toBe(true);
    const laundering = Proxy.revocable(
      createEmptyKnowledgeForwardRevisionReviewSnapshotV2("personal"),
      {
        getPrototypeOf: () => {
          throw authentic;
        },
      }
    );
    expect(() => snapshotKnowledgeForwardRevisionReviewSnapshotV2(laundering.proxy)).toThrow(
      KnowledgeForwardRevisionReviewSnapshotV2ValidationError
    );
  });

  it("returns detached diagnostics and never retains caller-owned containers", () => {
    const result = parseKnowledgeForwardRevisionReviewSnapshotV2({ version: 99 });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "forward_revision_review_snapshot_v2_invalid",
          severity: "error",
          field: "forwardRevisionReview",
          message: "Forward revision Review v2 state does not satisfy its strict contract",
        },
      ],
    });
    if (!result.ok) result.issues[0].message = "changed";
    expect(parseKnowledgeForwardRevisionReviewSnapshotV2({ version: 99 })).not.toEqual(result);

    const pending = createPendingEntry(createProposal(), 1, 11);
    const records = [pending];
    const snapshot = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
      version: 2,
      bundleId: "personal",
      revision: 1,
      lastRequestRevision: 1,
      records,
    });
    records.length = 0;
    expect(snapshot.records).toHaveLength(1);
  });

  it("does not accept an invalid v1 source during migration", () => {
    expect(() => migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2({ version: 1 })).toThrow(
      KnowledgeForwardRevisionReviewSnapshotV2ValidationError
    );
    expect(parseKnowledgeForwardRevisionReviewSnapshotV2({ version: 1 }).ok).toBe(false);
  });
});
