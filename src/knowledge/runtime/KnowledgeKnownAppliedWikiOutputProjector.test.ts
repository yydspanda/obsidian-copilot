import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import {
  createKnowledgeForwardRevisionPreparedApplyJournal,
  projectKnowledgeForwardRevisionApplyJournalApplying,
  projectKnowledgeForwardRevisionApplyJournalCommitted,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  createKnowledgeForwardRevisionApplyLedgerRecord,
  type KnowledgeForwardRevisionApplyLedgerRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  createKnowledgeForwardRevisionApplyRevalidationReceipt,
  createKnowledgeForwardRevisionSourceBase,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import {
  createKnowledgeForwardRevisionAcceptedDecisionRecord,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { createKnowledgeForwardRevisionReviewCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionTerminalReviewEntryV2,
  snapshotKnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionReviewSnapshotV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import {
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import {
  createManifestCommitIntentDigest,
  createManifestCommitPlanDigest,
  projectManifestCommitIntent,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceManifestEntry,
} from "@/knowledge/model/types";
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
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const RUNTIME_ID = "1".repeat(32);
const PAGE_PATH = "Wiki/Topic.md";
const FORWARD_SELECTED_CONTENT = "# Forward selected historical output\n";
const FORWARD_CURRENT_CONTENT = "# Forward current source output\n";

/** One exact accepted Review and matching Apply ledger fixture. */
interface AppliedFixture {
  record: AcceptedChangeSetReviewRecord;
  ledger: KnowledgeApplyCommitLedgerRecord;
}

/** One exact accepted Forward Review and matching canonical Forward ledger. */
interface ForwardAppliedFixture {
  review: Readonly<KnowledgeForwardRevisionReviewSnapshotV2>;
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>;
  afterContent: string;
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

/** Creates the exact applied source authority retained by a Forward ledger source base. */
function createForwardAppliedAuthority(
  runtimeRevision: number,
  completedAt: number
): KnowledgeForwardRevisionAcceptanceAuthority {
  return {
    runtimeId: RUNTIME_ID,
    runtimeRevision,
    runtimeDigest: runtimeRevision === 20 ? HASH_E : HASH_D,
    manifestRevision: 9,
    manifestDigest: HASH_F,
    manifestBaseHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
    vaultObservedBeforeHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: RUNTIME_ID,
      runtimeRevision,
      runtimeDigest: runtimeRevision === 20 ? HASH_E : HASH_D,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      committedManifestRevision: 8,
      completedAt,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_D,
      manifestIntentDigest: HASH_C,
      committedManifestDigest: HASH_B,
    },
  };
}

/** Creates one strict Forward proposal bound to the current generated page. */
function createForwardProposal(requestedAt: number) {
  const selectedContentHash = createFileContentHash(FORWARD_SELECTED_CONTENT);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: PAGE_PATH,
    historical: {
      bundleId: "personal",
      pagePath: PAGE_PATH,
      transactionId: "transaction-historical",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: requestedAt - 50,
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
      manifestBaseHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
      vaultObservedBeforeHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision: 1,
    runtimeId: RUNTIME_ID,
    bundleId: "personal",
    pagePath: PAGE_PATH,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_B,
      acceptedDigest: HASH_C,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_D,
      acceptedAt: requestedAt - 60,
      targetChange: {
        changeId: "change-historical",
        path: PAGE_PATH,
        operation: "update",
        afterHash: selectedContentHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: PAGE_PATH,
        ownership: "generated",
        contentHash: selectedContentHash,
      },
    },
    selectedContent: FORWARD_SELECTED_CONTENT,
    selectedContentHash,
    requestedAt,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: requestedAt });
}

/** Creates one exact deterministic validation receipt for a Forward body. */
function createForwardValidationReceipt(
  proposal: ReturnType<typeof createForwardProposal>,
  authority: KnowledgeForwardRevisionAcceptanceAuthority,
  afterContent: string,
  validatedAt: number
) {
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
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
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: HASH_A,
    },
  ];
  return {
    command,
    receipt: createKnowledgeForwardRevisionValidationReceipt({
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
      acceptanceAuthority: authority,
      historicalCitations: [],
      validationReadSet,
      sourceArtifactObservationBindingDigest:
        createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
          authority,
          validationReadSet
        ),
      warningSummary: null,
      validatedAt,
    }),
  };
}

/** Creates one exact current source entry for a Forward ledger source base. */
function createForwardSourceEntry(completedAt: number): SourceManifestEntry {
  return {
    sourceId: "source-1",
    sourceKey: "sources/note.md",
    sourcePath: "Sources/Note.md",
    custody: "user_managed",
    lastSuccessful: {
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      generatedPages: [
        {
          path: PAGE_PATH,
          ownership: "generated",
          contentHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
        },
      ],
      changeSetId: "changeset-current",
      completedAt,
    },
    extensions: {
      obsidianCopilotKnowledgeRuntimeCommit: {
        version: 1,
        inputRevision: 7,
        transactionId: "transaction-current",
        manifestIntentDigest: HASH_C,
      },
    },
  };
}

/** Creates one canonical accepted Forward Review and finalized ledger. */
function createForwardAppliedFixture(options: {
  afterContent: string;
  appliedAt: number;
  transactionId?: string;
}): ForwardAppliedFixture {
  const completedAt = options.appliedAt - 30;
  const requestedAt = options.appliedAt - 18;
  const proposal = createForwardProposal(requestedAt);
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const decisionAuthority = createForwardAppliedAuthority(20, completedAt);
  const original = createForwardValidationReceipt(
    proposal,
    decisionAuthority,
    options.afterContent,
    options.appliedAt - 14
  );
  const accepted = createKnowledgeForwardRevisionAcceptedDecisionRecord({
    proposal,
    proposalDigest,
    command: original.command,
    afterContent: options.afterContent,
    acceptanceAuthority: decisionAuthority,
    validationReceipt: original.receipt,
    validationReceiptDigest: original.receipt.receiptDigest,
    acceptedAt: options.appliedAt - 12,
  });
  const applyAuthority = createForwardAppliedAuthority(21, completedAt);
  const fresh = createForwardValidationReceipt(
    proposal,
    applyAuthority,
    options.afterContent,
    options.appliedAt - 5
  );
  const sourceBase = createKnowledgeForwardRevisionSourceBase({
    bundleId: "personal",
    sourceEntry: createForwardSourceEntry(completedAt),
    currentSourceFreshness: applyAuthority.currentSourceFreshness,
  });
  const revalidation = createKnowledgeForwardRevisionApplyRevalidationReceipt({
    acceptedDecision: accepted,
    freshValidationReceipt: fresh.receipt,
    applyAuthority,
    sourceBase,
    vaultObservedBeforeHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
    vaultObservedAfterHash: createFileContentHash(FORWARD_CURRENT_CONTENT),
    revalidatedAt: options.appliedAt - 5,
  });
  const prepared = createKnowledgeForwardRevisionPreparedApplyJournal({
    transactionId: options.transactionId ?? "forward-transaction-1",
    acceptedDecision: accepted,
    revalidationReceipt: revalidation,
    manifestBeforeRevision: 9,
    manifestBeforeDigest: HASH_F,
    beforeContent: FORWARD_CURRENT_CONTENT,
    afterContent: options.afterContent,
    createdAt: options.appliedAt - 3,
  });
  const applying = projectKnowledgeForwardRevisionApplyJournalApplying(
    prepared,
    options.appliedAt - 2
  );
  const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(
    applying,
    options.appliedAt
  );
  const ledger = createKnowledgeForwardRevisionApplyLedgerRecord({
    committedJournal: committed,
    sourceBase,
    manifestAfterRevision: 10,
    manifestAfterDigest: HASH_A,
    appliedAt: options.appliedAt,
  });
  const reviewEntry = createKnowledgeForwardRevisionTerminalReviewEntryV2({
    decision: accepted,
    publishedRuntimeRevision: 10,
    proposalStoreRevision: 1,
    decidedRuntimeRevision: 21,
    decisionStoreRevision: 2,
  });
  const review = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
    version: 2,
    bundleId: "personal",
    revision: 2,
    lastRequestRevision: 1,
    records: [reviewEntry],
  });
  return { review, ledger, afterContent: options.afterContent };
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
    forwardRevisionApplyCommits: [] as Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[],
    forwardRevisionReview: undefined as
      | Readonly<KnowledgeForwardRevisionReviewSnapshotV2>
      | undefined,
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
    forwardRevisionApplyCommits: input.forwardRevisionApplyCommits,
    forwardRevisionReview: input.forwardRevisionReview,
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
      origins: [
        {
          kind: "source_apply",
          verifiedApplyCount: 2,
          newestAppliedAt: 3_000,
          newestManifestRevision: 3,
        },
      ],
      detailAvailability: "available",
    });
    expect(snapshot.outputs[0]).not.toHaveProperty("content");
    expect(snapshot.outputs[0]?.authority.transactionId).toBe("transaction-repeated");
    expect(snapshot.outputs[0]?.authority.origin).toBe("source_apply");
    expect(snapshot.outputs[1]?.newestAppliedAt).toBe(2_000);
    expect(snapshot.currentManifestPage?.path).toBe(PAGE_PATH);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs[0]?.authority)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs[0]?.origins)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs[0]?.origins[0])).toBe(true);
  });

  it("joins one canonical Forward ledger to its exact accepted Review body", () => {
    const forward = createForwardAppliedFixture({
      afterContent: "# Forward revised output\n",
      appliedAt: 3_000,
    });
    const input = createIndexInput([]);
    input.forwardRevisionApplyCommits = [forward.ledger];
    input.forwardRevisionReview = forward.review;
    const snapshot = projectKnowledgeKnownAppliedWikiOutputIndex(input);
    const item = snapshot.outputs[0];
    if (!item || item.authority.origin !== "forward_revision") {
      throw new Error("Expected one Forward output authority");
    }

    expect(snapshot.forwardReviewRevision).toBe(2);
    expect(item).toMatchObject({
      contentHash: createFileContentHash(forward.afterContent),
      characterCount: forward.afterContent.length,
      newestAppliedAt: 3_000,
      newestManifestRevision: 10,
      verifiedApplyCount: 1,
      origins: [
        {
          kind: "forward_revision",
          verifiedApplyCount: 1,
          newestAppliedAt: 3_000,
          newestManifestRevision: 10,
        },
      ],
      authority: {
        origin: "forward_revision",
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 7,
        manualOverride: true,
        acceptedDecisionDigest: forward.ledger.acceptedDecisionDigest,
        proposalId: forward.ledger.proposalId,
        proposalDigest: forward.ledger.proposalDigest,
        ledgerId: forward.ledger.ledgerId,
        ledgerDigest: forward.ledger.ledgerDigest,
        forwardLedgerIdentityDigest: forward.ledger.forwardLedgerIdentityDigest,
      },
    });
    expect(item).not.toHaveProperty("content");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail(createDetailInput(input, item.authority))
    ).toEqual({
      kind: "available",
      runtimeId: RUNTIME_ID,
      runtimeRevision: 40,
      contentHash: createFileContentHash(forward.afterContent),
      content: forward.afterContent,
      characterCount: forward.afterContent.length,
    });
  });

  it("aggregates mixed Source and Forward Apply provenance without inventing one origin", () => {
    const content = "# Shared historical bytes\n";
    const source = createAppliedFixture({
      suffix: "mixed-source",
      content,
      inputRevision: 1,
      manifestAfterRevision: 1,
      appliedAt: 2_000,
    });
    const forward = createForwardAppliedFixture({ afterContent: content, appliedAt: 3_000 });
    const input = createIndexInput([source]);
    input.forwardRevisionApplyCommits = [forward.ledger];
    input.forwardRevisionReview = forward.review;

    const item = projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs[0];
    if (!item) throw new Error("Expected one mixed-provenance output");
    expect(item.verifiedApplyCount).toBe(2);
    expect(item.origins).toEqual([
      {
        kind: "source_apply",
        verifiedApplyCount: 1,
        newestAppliedAt: 2_000,
        newestManifestRevision: 1,
      },
      {
        kind: "forward_revision",
        verifiedApplyCount: 1,
        newestAppliedAt: 3_000,
        newestManifestRevision: 10,
      },
    ]);
    expect(item.authority.origin).toBe("forward_revision");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail(createDetailInput(input, item.authority))
    ).toMatchObject({ kind: "available", content });
  });

  it("requires exact Forward ledger and Review replay for detail", () => {
    const forward = createForwardAppliedFixture({
      afterContent: "# Exact Forward detail\n",
      appliedAt: 3_000,
    });
    const input = createIndexInput([]);
    input.forwardRevisionApplyCommits = [forward.ledger];
    input.forwardRevisionReview = forward.review;
    const authority = projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs[0]?.authority;
    if (!authority || authority.origin !== "forward_revision") {
      throw new Error("Expected one Forward authority");
    }

    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        authority: { ...authority, ledgerDigest: HASH_F },
      }).kind
    ).toBe("stale");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        forwardRevisionReview: undefined,
      }).kind
    ).toBe("stale");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        forwardRevisionApplyCommits: [],
      }).kind
    ).toBe("stale");
    expect(
      projectKnowledgeKnownAppliedWikiOutputDetail({
        ...createDetailInput(input, authority),
        authority: { ...authority, manualOverride: false },
      }).kind
    ).toBe("stale");
  });

  it("fails closed for uncommitted, tampered, or ambiguous Forward evidence", () => {
    const first = createForwardAppliedFixture({
      afterContent: "# Forward evidence\n",
      appliedAt: 3_000,
    });
    const input = createIndexInput([]);
    input.forwardRevisionReview = first.review;
    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);

    input.forwardRevisionApplyCommits = [{ ...first.ledger, ledgerDigest: HASH_F }];
    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);

    const tamperedReview = JSON.parse(
      JSON.stringify(first.review)
    ) as KnowledgeForwardRevisionReviewSnapshotV2;
    const acceptedEntry = tamperedReview.records[0];
    if (acceptedEntry?.state !== "accepted") throw new Error("Expected accepted fixture Review");
    (acceptedEntry.decision as { afterContent: string }).afterContent = "# Tampered body\n";
    input.forwardRevisionApplyCommits = [first.ledger];
    input.forwardRevisionReview = tamperedReview;
    expect(projectKnowledgeKnownAppliedWikiOutputIndex(input).outputs).toEqual([]);

    const second = createForwardAppliedFixture({
      afterContent: first.afterContent,
      appliedAt: 3_000,
      transactionId: "forward-transaction-2",
    });
    input.forwardRevisionApplyCommits = [first.ledger, second.ledger];
    input.forwardRevisionReview = first.review;
    expect(() => projectKnowledgeKnownAppliedWikiOutputIndex(input)).toThrow(
      KnowledgeKnownAppliedWikiOutputProjectionError
    );
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
    const hostileForwardReview = {
      version: 2,
      bundleId: "personal",
      revision: 0,
      lastRequestRevision: 0,
    };
    Object.defineProperty(hostileForwardReview, "records", {
      enumerable: true,
      get: getter,
    });

    const snapshot = projectKnowledgeKnownAppliedWikiOutputIndex({
      ...createIndexInput([]),
      applyCommits: [hostileLedgerRow as KnowledgeApplyCommitLedgerRecord],
      forwardRevisionApplyCommits: [
        hostileLedgerRow as unknown as KnowledgeForwardRevisionApplyLedgerRecord,
      ],
      review: createReview([hostileReviewRow as ChangeSetReviewRecord]),
      forwardRevisionReview:
        hostileForwardReview as unknown as KnowledgeForwardRevisionReviewSnapshotV2,
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
        forwardRevisionApplyCommits: new Array(
          KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxForwardApplyCommits + 1
        ) as KnowledgeForwardRevisionApplyLedgerRecord[],
      })
    ).toThrow(KnowledgeKnownAppliedWikiOutputLimitError);

    expect(() =>
      projectKnowledgeKnownAppliedWikiOutputIndex({
        ...createIndexInput([]),
        forwardRevisionReview: {
          version: 2,
          bundleId: "personal",
          revision: 0,
          lastRequestRevision: 0,
          records: new Array(
            KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxForwardReviewRecords + 1
          ),
        } as unknown as KnowledgeForwardRevisionReviewSnapshotV2,
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
