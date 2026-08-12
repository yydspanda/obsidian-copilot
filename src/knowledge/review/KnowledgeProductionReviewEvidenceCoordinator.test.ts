import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitPlanDigest,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, KnowledgeChangeSet } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  ObsidianKnowledgeCitationNavigationRequest,
  ObsidianKnowledgeCitationNavigationResult,
} from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";
import { createKnowledgeReviewPlan } from "@/knowledge/review/ReviewDecision";
import { KnowledgeProductionReviewEvidenceCoordinator } from "@/knowledge/review/KnowledgeProductionReviewEvidenceCoordinator";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  type ChangeSetReviewSnapshot,
  type PendingChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";
import type { KnowledgeRuntimeStudioBundleSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import type { KnowledgeStudioRuntimePort } from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-1";
const SOURCE_PATH = "Sources/Source.md";
const SOURCE_CONTENT = "# Source\nGrounded fact.\n";
const EXCERPT = "Grounded fact.";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Returns the strict Bundle used by the Review evidence fixtures. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates one pending grounded proposal with a single visible evidence reference. */
function createProposal(): KnowledgeChangeSet {
  const afterContent = "# Page\n";
  return {
    id: "changeset-1",
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes: [
      {
        id: "change-1",
        operation: "create",
        path: "Wiki/Page.md",
        sourceRefs: [SOURCE_ID],
        reason: "Create grounded page",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [
      {
        citationId: "citation-1",
        claimId: "claim-1",
        relation: "supports",
        locator: {
          kind: "markdown_lines",
          sourceId: SOURCE_ID,
          artifactId: "primary",
          artifactContentHash: createFileContentHash(SOURCE_CONTENT),
          excerpt: EXCERPT,
          quoteHash: createQuoteHash(EXCERPT),
          startLine: 2,
          endLine: 2,
        },
      },
    ],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates the Manifest commit plan retained beside one pending proposal. */
function createManifestPlan(proposal: KnowledgeChangeSet): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: BUNDLE_ID,
    sourceId: SOURCE_ID,
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
    inputRevision: 1,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: HASH_C,
    baseGeneratedPages: [],
    mutations: proposal.changes.map((change) => ({
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: "create_only" as const,
      ownership: "generated" as const,
      wasTrackedByPrimarySource: false,
    })),
  };
}

/** Creates one exact Queue-anchored pending Review record. */
function createRecord(proposal = createProposal()): PendingChangeSetReviewRecord {
  const manifestCommitPlan = createManifestPlan(proposal);
  return {
    changeSetId: proposal.id,
    proposal,
    proposalDigest: createKnowledgeChangeSetDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim: {
      jobId: "job-1",
      sourceId: SOURCE_ID,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
    },
    recordedAt: 200,
    outcome: "pending",
    recordRevision: 0,
  };
}

/** Creates one atomic Runtime projection containing the pending proposal. */
function createProjection(
  record: PendingChangeSetReviewRecord
): KnowledgeRuntimeStudioBundleSnapshot {
  const queue: IngestQueueSnapshot = {
    version: INGEST_QUEUE_VERSION,
    bundleId: BUNDLE_ID,
    revision: 2,
    control: { status: "running" },
    jobs: [
      {
        id: record.jobClaim.jobId,
        bundleId: BUNDLE_ID,
        sourceId: SOURCE_ID,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        attempt: 1,
        rerunRequested: false,
        createdAt: 100,
        updatedAt: record.recordedAt,
        status: "awaiting_review",
        stage: "review",
        changeSetId: record.changeSetId,
      },
    ],
    reruns: [],
    sourceHighWatermarks: [
      {
        sourceId: SOURCE_ID,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 1,
        observedAt: 100,
      },
    ],
    pendingReviews: [
      {
        kind: "durable",
        jobId: record.jobClaim.jobId,
        changeSetId: record.changeSetId,
        proposalDigest: record.proposalDigest,
        reviewRecordRevision: 0,
        recordedAt: record.recordedAt,
      },
    ],
    reviewRejections: [],
    applyAbandonments: [],
  };
  const review: ChangeSetReviewSnapshot = {
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId: BUNDLE_ID,
    revision: 1,
    records: [record],
  };
  return { bundleId: BUNDLE_ID, runtimeRevision: 3, queue, review };
}

/** Runtime facade that records every fresh consistency-sandwich read. */
class FixedRuntime implements KnowledgeStudioRuntimePort {
  reads = 0;

  /** Captures one immutable projection returned on every read. */
  constructor(private readonly projection: KnowledgeRuntimeStudioBundleSnapshot) {}

  /** Returns the exact current projection. */
  async readStudioBundle(): Promise<KnowledgeRuntimeStudioBundleSnapshot> {
    this.reads += 1;
    return this.projection;
  }

  /** Provides no external hints for a single-operation coordinator test. */
  subscribeStudioBundle(): () => void {
    return () => undefined;
  }
}

/** Resolver that records and returns the current missing create target. */
class MissingTargetResolver implements CompilerTargetResolver {
  calls: readonly CompilerTargetRequest[][] = [];

  /** Resolves every requested create target as exactly absent. */
  async resolve(requests: readonly CompilerTargetRequest[]): Promise<unknown> {
    this.calls = [...this.calls, [...requests]];
    return requests.map((request) => ({
      targetId: request.targetId,
      kind: "missing" as const,
      windowsPathKey: toWindowsPathKey(request.path),
    }));
  }
}

/** Promise whose completion is explicitly controlled by a test. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("KnowledgeProductionReviewEvidenceCoordinator", () => {
  /** Builds one current request from the same deterministic Review projection. */
  function createRequest(record: PendingChangeSetReviewRecord) {
    const plan = createKnowledgeReviewPlan(record.proposal, [
      { changeId: "change-1", kind: "missing" },
    ]);
    return {
      changeSetId: plan.changeSetId,
      proposalDigest: plan.proposalDigest,
      expectedSnapshotToken: plan.snapshotToken,
      evidenceRef: plan.evidence[0].evidenceRef,
    };
  }

  it("rebuilds current Review authority before resolving and opening one opaque reference", async () => {
    const record = createRecord();
    const runtime = new FixedRuntime(createProjection(record));
    const resolver = new MissingTargetResolver();
    const authority = jest.fn(async () => Object.freeze({ sourcePath: SOURCE_PATH }));
    const navigate = jest.fn(
      async (
        _request: ObsidianKnowledgeCitationNavigationRequest,
        _signal?: AbortSignal
      ): Promise<ObsidianKnowledgeCitationNavigationResult> => ({ status: "opened" })
    );
    const coordinator = new KnowledgeProductionReviewEvidenceCoordinator({
      runtime,
      bundle: createBundle(),
      targetResolver: resolver,
      sourceAuthority: { resolve: authority },
      navigator: { navigate },
      assertCurrent: () => undefined,
    });

    await expect(
      coordinator.openReviewEvidence(BUNDLE_ID, createRequest(record), new AbortController().signal)
    ).resolves.toEqual({ kind: "opened" });

    expect(runtime.reads).toBe(2);
    expect(resolver.calls).toHaveLength(1);
    expect(authority).toHaveBeenCalledWith(BUNDLE_ID, SOURCE_ID, expect.any(AbortSignal));
    const navigationRequest = navigate.mock.calls[0]?.[0];
    expect(navigationRequest?.sourcePath).toBe(SOURCE_PATH);
    expect(navigationRequest?.citation.citationId).toBe("citation-1");
    expect(navigate.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("returns value-free stale before source authority when current plan identities differ", async () => {
    const record = createRecord();
    const authority = jest.fn(async () => Object.freeze({ sourcePath: SOURCE_PATH }));
    const navigate = jest.fn(async () => ({ status: "opened" as const }));
    const coordinator = new KnowledgeProductionReviewEvidenceCoordinator({
      runtime: new FixedRuntime(createProjection(record)),
      bundle: createBundle(),
      targetResolver: new MissingTargetResolver(),
      sourceAuthority: { resolve: authority },
      navigator: { navigate },
      assertCurrent: () => undefined,
    });

    await expect(
      coordinator.openReviewEvidence(
        BUNDLE_ID,
        { ...createRequest(record), expectedSnapshotToken: "f".repeat(64) },
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    expect(authority).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("fails closed without disclosing an out-of-root current source path", async () => {
    const record = createRecord();
    const navigate = jest.fn(async () => ({ status: "opened" as const }));
    const coordinator = new KnowledgeProductionReviewEvidenceCoordinator({
      runtime: new FixedRuntime(createProjection(record)),
      bundle: createBundle(),
      targetResolver: new MissingTargetResolver(),
      sourceAuthority: {
        resolve: async () => Object.freeze({ sourcePath: "Other/Source.md" }),
      },
      navigator: { navigate },
      assertCurrent: () => undefined,
    });

    await expect(
      coordinator.openReviewEvidence(BUNDLE_ID, createRequest(record), new AbortController().signal)
    ).resolves.toEqual({ kind: "unavailable" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("honors cancellation after navigation and suppresses its late opened result", async () => {
    const record = createRecord();
    const deferred = createDeferred<ObsidianKnowledgeCitationNavigationResult>();
    const coordinator = new KnowledgeProductionReviewEvidenceCoordinator({
      runtime: new FixedRuntime(createProjection(record)),
      bundle: createBundle(),
      targetResolver: new MissingTargetResolver(),
      sourceAuthority: {
        resolve: async () => Object.freeze({ sourcePath: SOURCE_PATH }),
      },
      navigator: { navigate: async () => deferred.promise },
      assertCurrent: () => undefined,
    });
    const abort = new AbortController();
    const pending = coordinator.openReviewEvidence(BUNDLE_ID, createRequest(record), abort.signal);
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    deferred.resolve({ status: "opened" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
