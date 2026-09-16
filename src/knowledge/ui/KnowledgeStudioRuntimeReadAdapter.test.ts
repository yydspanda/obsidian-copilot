import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { IngestQueue, type IngestExecutionResult } from "@/knowledge/ingest/queue/IngestQueue";
import {
  INGEST_QUEUE_VERSION,
  type IngestQueueSnapshot,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitPlanDigest,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, KnowledgeChangeSet } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  KnowledgeGroundedRetrievalResult,
  KnowledgeStudioQueryPort,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  type ChangeSetReviewSnapshot,
  type PendingChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";
import type { KnowledgeRuntimeStudioBundleSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import {
  KnowledgeStudioRuntimeReadAdapter,
  KnowledgeStudioRuntimeReadError,
  type KnowledgeStudioRuntimeReadAdapterInput,
  type KnowledgeStudioRuntimePort,
  type KnowledgeStudioVaultHintPort,
} from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";
import { KnowledgeStudioRuntimeCommandAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";
import { KnowledgeStudioReviewedApplyPort } from "@/knowledge/ui/KnowledgeStudioReviewedApplyPort";
import type { KnowledgeSourceLifecyclePort } from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import { createKnowledgeSourceLifecycleModel } from "@/knowledge/ui/sourceLifecycleModel";

const BUNDLE_ID = "personal";
const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const MANIFEST_HASH = "c".repeat(64);

/** Returns the exact Bundle captured by the test adapter generation. */
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

/** Creates one valid create-only proposal beneath the configured Wiki root. */
function createProposal(path = "Wiki/Page.md"): KnowledgeChangeSet {
  const afterContent = "# Page\n";
  return {
    id: "changeset-1",
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        id: "change-1",
        operation: "create",
        path,
        sourceRefs: ["source-1"],
        reason: "Create a grounded page",
        expectedAbsent: true,
        afterContent,
        afterHash: createFileContentHash(afterContent),
      },
    ],
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates the exact Manifest projection stored beside a pending proposal. */
function createManifestCommitPlan(proposal: KnowledgeChangeSet): ManifestCommitPlan {
  return {
    version: 1,
    kind: "source_compile",
    bundleId: BUNDLE_ID,
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 1,
    changeSetId: proposal.id,
    expectedManifestRevision: 0,
    expectedManifestDigest: MANIFEST_HASH,
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

/** Creates one exact pending Review record owned by the queue fixture. */
function createPendingRecord(proposal = createProposal()): PendingChangeSetReviewRecord {
  const manifestCommitPlan = createManifestCommitPlan(proposal);
  return {
    changeSetId: proposal.id,
    proposal,
    proposalDigest: createKnowledgeChangeSetDigest(proposal),
    manifestCommitPlan,
    manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
    jobClaim: {
      jobId: "job-1",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_HASH,
      inputRevision: 1,
      attempt: 1,
    },
    recordedAt: 200,
    outcome: "pending",
    recordRevision: 0,
  };
}

/** Creates one Queue snapshot with an optional exact durable Review hand-off. */
function createQueue(
  record?: PendingChangeSetReviewRecord,
  revision = record ? 2 : 0
): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId: BUNDLE_ID,
    revision,
    control: { status: "running" },
    jobs: record
      ? [
          {
            id: record.jobClaim.jobId,
            bundleId: BUNDLE_ID,
            sourceId: record.jobClaim.sourceId,
            sourceContentHash: record.jobClaim.sourceContentHash,
            pipelineFingerprint: record.jobClaim.pipelineFingerprint,
            inputRevision: record.jobClaim.inputRevision,
            attempt: record.jobClaim.attempt,
            rerunRequested: false,
            createdAt: 100,
            updatedAt: record.recordedAt,
            status: "awaiting_review",
            stage: "review",
            changeSetId: record.changeSetId,
          },
        ]
      : [],
    reruns: [],
    sourceHighWatermarks: record
      ? [
          {
            sourceId: record.jobClaim.sourceId,
            sourceContentHash: record.jobClaim.sourceContentHash,
            pipelineFingerprint: record.jobClaim.pipelineFingerprint,
            inputRevision: record.jobClaim.inputRevision,
            observedAt: 100,
          },
        ]
      : [],
    pendingReviews: record
      ? [
          {
            kind: "durable",
            jobId: record.jobClaim.jobId,
            changeSetId: record.changeSetId,
            proposalDigest: record.proposalDigest,
            reviewRecordRevision: record.recordRevision,
            recordedAt: record.recordedAt,
          },
        ]
      : [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

/** Creates one Review snapshot around caller-selected records. */
function createReview(
  records: ChangeSetReviewSnapshot["records"] = [],
  revision = records.length > 0 ? 1 : 0
): ChangeSetReviewSnapshot {
  return {
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId: BUNDLE_ID,
    revision,
    records,
  };
}

/** Creates one atomic Runtime projection for the Studio adapter. */
function createProjection(
  runtimeRevision: number,
  queue = createQueue(),
  review = createReview()
): KnowledgeRuntimeStudioBundleSnapshot {
  return { bundleId: BUNDLE_ID, runtimeRevision, queue, review };
}

/** Scriptable Runtime facade whose reads preserve call order. */
class FakeRuntime implements KnowledgeStudioRuntimePort {
  readonly readCalls: string[] = [];
  readonly subscriptions = new Map<string, () => void>();
  unsubscribed = false;

  /** Captures an ordered list of atomic projections. */
  constructor(private readonly projections: KnowledgeRuntimeStudioBundleSnapshot[]) {}

  /** Returns the next projection, retaining the last for further consistency reads. */
  async readStudioBundle(bundleId: string): Promise<KnowledgeRuntimeStudioBundleSnapshot> {
    this.readCalls.push(bundleId);
    const projection = this.projections.shift() ?? this.lastProjection;
    if (!projection) throw new Error("Missing scripted Runtime projection");
    this.lastProjection = projection;
    return projection;
  }

  private lastProjection?: KnowledgeRuntimeStudioBundleSnapshot;

  /** Retains one value-free Runtime hint listener. */
  subscribeStudioBundle(bundleId: string, listener: () => void): () => void {
    this.subscriptions.set(bundleId, listener);
    return () => {
      this.unsubscribed = true;
      this.subscriptions.delete(bundleId);
    };
  }
}

/** Scriptable target resolver that records the exact read-only requests. */
class FakeTargetResolver implements CompilerTargetResolver {
  readonly calls: CompilerTargetRequest[][] = [];

  /** Captures one handler for every resolver call. */
  constructor(
    private readonly handler: (
      requests: readonly CompilerTargetRequest[],
      signal: AbortSignal
    ) => Promise<unknown>
  ) {}

  /** Records and delegates one target observation. */
  async resolve(requests: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown> {
    this.calls.push([...requests]);
    return this.handler(requests, signal);
  }
}

/** Creates the default strict missing-target resolver. */
function createMissingResolver(): FakeTargetResolver {
  return new FakeTargetResolver(async (requests) =>
    requests.map((request) => ({
      targetId: request.targetId,
      kind: "missing",
      windowsPathKey: toWindowsPathKey(request.path),
    }))
  );
}

/** Creates a read-only adapter around scripted Runtime and target state. */
function createAdapter(
  runtime: KnowledgeStudioRuntimePort,
  resolver: CompilerTargetResolver = createMissingResolver(),
  subscribeVaultHints?: KnowledgeStudioVaultHintPort,
  assertCurrent: () => void = () => undefined,
  commands?: KnowledgeStudioRuntimeCommandAdapter,
  query?: Pick<KnowledgeStudioQueryPort, "query" | "openCitation" | "revokeCurrent"> &
    Partial<Pick<KnowledgeStudioQueryWritebackPort, "saveQueryToWiki">>,
  sourceLifecycle?: KnowledgeSourceLifecyclePort
): KnowledgeStudioRuntimeReadAdapter {
  return new KnowledgeStudioRuntimeReadAdapter({
    runtime,
    bundles: [createBundle()],
    targetResolver: resolver,
    assertCurrent,
    subscribeVaultHints,
    ...(commands === undefined ? {} : { commands }),
    ...(query === undefined ? {} : { query }),
    ...(sourceLifecycle === undefined ? {} : { sourceLifecycle }),
  });
}

/** Creates one empty grounded result accepted by the Studio Query boundary. */
function createQueryResult(): KnowledgeGroundedRetrievalResult {
  return {
    mode: "grounded_retrieval",
    bundleId: BUNDLE_ID,
    queryId: "query-1",
    runtimeRevision: 4,
    manifestRevision: 2,
    hits: [],
  };
}

/** Creates an authentic command adapter whose narrow reviewed-apply capability is enabled. */
async function createAcceptEnabledCommands(): Promise<KnowledgeStudioRuntimeCommandAdapter> {
  const commandRuntime = new KnowledgeRuntimeStore(new KnowledgeExecutionMemoryRuntimeFile());
  await commandRuntime.initialize();
  const queue = new IngestQueue(new KnowledgeRuntimeQueueStorage(commandRuntime), {
    execute: async (): Promise<IngestExecutionResult> => {
      throw new Error("Snapshot tests must not execute ingest work");
    },
  });
  return new KnowledgeStudioRuntimeCommandAdapter({
    queue,
    reviewReject: new KnowledgeRuntimeReviewRejectPort(commandRuntime),
    reviewApply: new KnowledgeStudioReviewedApplyPort(async () => ({ kind: "applied" })),
    bundleIds: [BUNDLE_ID],
    assertCurrent: () => undefined,
  });
}

/** Creates one opaque command for fail-closed command tests. */
function createReviewCommand(record: PendingChangeSetReviewRecord): KnowledgeReviewCommand {
  return {
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    expectedSnapshotToken: "opaque-token",
    decisions: [{ changeId: "change-1", decision: "reject" }],
  };
}

interface PendingWriteback {
  bundleId: string;
  signal: AbortSignal;
  resolve(result: KnowledgeStudioQueryWritebackResult): void;
  reject(error: Error): void;
}

/** Retains independent Bundle subscriptions and caller-controlled save completions. */
function createWritebackHintFixture(commands?: KnowledgeStudioRuntimeCommandAdapter) {
  const subscriptions = {
    runtime: new Map<string, Set<() => void>>(),
    vault: new Map<string, Set<() => void>>(),
  };
  const subscribe = (
    kind: keyof typeof subscriptions,
    bundleId: string,
    listener: () => void
  ): (() => void) => {
    const listeners = subscriptions[kind].get(bundleId) ?? new Set<() => void>();
    subscriptions[kind].set(bundleId, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const saves: PendingWriteback[] = [];
  const revokeCurrent = jest.fn();
  const adapter = new KnowledgeStudioRuntimeReadAdapter({
    runtime: {
      readStudioBundle: async () => createProjection(4),
      subscribeStudioBundle: (bundleId, listener) => subscribe("runtime", bundleId, listener),
    },
    bundles: [createBundle(), { ...createBundle(), id: "other" }],
    targetResolver: createMissingResolver(),
    assertCurrent: () => undefined,
    subscribeVaultHints: (bundleId, listener) => subscribe("vault", bundleId, listener),
    ...(commands === undefined ? {} : { commands }),
    query: {
      query: async () => createQueryResult(),
      openCitation: async () => undefined,
      revokeCurrent,
      saveQueryToWiki: (bundleId, _queryId, _request, signal) =>
        new Promise<KnowledgeStudioQueryWritebackResult>((resolve, reject) => {
          saves.push({ bundleId, signal, resolve, reject });
        }),
    },
  });
  return {
    adapter,
    saves,
    revokeCurrent,
    emit: (kind: keyof typeof subscriptions, bundleId = BUNDLE_ID): void => {
      subscriptions[kind].get(bundleId)?.forEach((listener) => listener());
    },
  };
}

describe("KnowledgeStudioRuntimeReadAdapter", () => {
  describe("KnowledgeStudioRuntimeReadAdapter", () => {
    describe("load()", () => {
      const issue = "https://github.com/yydspanda/obsidian-copilot/issues/7";

      function createConfiguredAdapter(
        record: PendingChangeSetReviewRecord,
        reviewSources: NonNullable<KnowledgeStudioRuntimeReadAdapterInput["reviewSources"]>
      ): KnowledgeStudioRuntimeReadAdapter {
        const projection = createProjection(7, createQueue(record), createReview([record]));
        return new KnowledgeStudioRuntimeReadAdapter({
          runtime: new FakeRuntime([projection]),
          bundles: [createBundle()],
          targetResolver: createMissingResolver(),
          assertCurrent: () => undefined,
          reviewSources,
        });
      }

      it(`keeps an old proposal eligible when its configuration still matches, with a stable empty slice (${issue})`, async () => {
        const record = createPendingRecord();
        const adapter = createConfiguredAdapter(record, [
          { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: PIPELINE_HASH },
        ]);
        const first = await adapter.load(BUNDLE_ID, new AbortController().signal);
        const second = await adapter.load(BUNDLE_ID, new AbortController().signal);

        expect(first.outdatedReviewIds).toEqual([]);
        expect(second.outdatedReviewIds).toBe(first.outdatedReviewIds);
        expect(Object.isFrozen(first.outdatedReviewIds)).toBe(true);
        expect(first.reviews[0].changeSetId).toBe(record.changeSetId);
      });

      it(`marks a configuration mismatch without hiding or modifying the old proposal (${issue})`, async () => {
        const record = createPendingRecord();
        const before = JSON.stringify(record);
        const snapshot = await createConfiguredAdapter(record, [
          { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: "d".repeat(64) },
        ]).load(BUNDLE_ID, new AbortController().signal);

        expect(snapshot.outdatedReviewIds).toEqual([record.changeSetId]);
        expect(Object.isFrozen(snapshot.outdatedReviewIds)).toBe(true);
        expect(snapshot.reviews).toHaveLength(1);
        expect(snapshot.reviews[0]).toMatchObject({
          changeSetId: record.changeSetId,
          proposalDigest: record.proposalDigest,
          files: [{ integrity: "current", capability: "blocks_allowed" }],
        });
        expect(JSON.stringify(record)).toBe(before);
      });

      it.each([
        ["no registered source", []],
        [
          "another Bundle",
          [{ bundleId: "other", sourceId: "source-1", pipelineFingerprint: PIPELINE_HASH }],
        ],
        [
          "another source",
          [{ bundleId: BUNDLE_ID, sourceId: "source-2", pipelineFingerprint: PIPELINE_HASH }],
        ],
      ])(
        `marks a proposal outdated with %s instead of borrowing its configuration (${issue})`,
        async (_condition, sources) => {
          const record = createPendingRecord();
          const snapshot = await createConfiguredAdapter(record, sources).load(
            BUNDLE_ID,
            new AbortController().signal
          );

          expect(snapshot.outdatedReviewIds).toEqual([record.changeSetId]);
          expect(snapshot.reviews[0].changeSetId).toBe(record.changeSetId);
        }
      );

      it(`changes the render revision when only current configuration compatibility changes (${issue})`, async () => {
        const record = createPendingRecord();
        const current = await createConfiguredAdapter(record, [
          { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: PIPELINE_HASH },
        ]).load(BUNDLE_ID, new AbortController().signal);
        const outdated = await createConfiguredAdapter(record, [
          { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: "d".repeat(64) },
        ]).load(BUNDLE_ID, new AbortController().signal);

        expect(current.revisionToken).not.toBe(outdated.revisionToken);
        expect(current.reviews).toEqual(outdated.reviews);
      });

      it(`retains captured configuration identities when caller-owned input changes (${issue})`, async () => {
        const record = createPendingRecord();
        const sources = [
          { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: PIPELINE_HASH },
        ];
        const adapter = createConfiguredAdapter(record, sources);
        sources[0].pipelineFingerprint = "d".repeat(64);
        sources.length = 0;
        const snapshot = await adapter.load(BUNDLE_ID, new AbortController().signal);

        expect(snapshot.outdatedReviewIds).toEqual([]);
        expect(snapshot.reviews[0].changeSetId).toBe(record.changeSetId);
      });

      it(`marks only the outdated proposal when current and old sources share a Bundle (${issue})`, async () => {
        const outdatedRecord = createPendingRecord();
        const proposal = createProposal("Wiki/Current.md");
        proposal.id = "changeset-current";
        proposal.sourceRefs = ["source-current"];
        proposal.changes[0].sourceRefs = ["source-current"];
        const currentRecord = createPendingRecord(proposal);
        currentRecord.jobClaim.jobId = "job-current";
        currentRecord.jobClaim.sourceId = "source-current";
        currentRecord.manifestCommitPlan.sourceId = "source-current";
        currentRecord.manifestCommitPlanDigest = createManifestCommitPlanDigest(
          currentRecord.manifestCommitPlan
        );
        const queue = createQueue(outdatedRecord);
        const currentQueue = createQueue(currentRecord);
        queue.jobs.push(...currentQueue.jobs);
        queue.sourceHighWatermarks.push(...currentQueue.sourceHighWatermarks);
        queue.pendingReviews.push(...currentQueue.pendingReviews);
        const projection = createProjection(
          7,
          queue,
          createReview([outdatedRecord, currentRecord])
        );
        const before = JSON.stringify(projection);
        const snapshot = await new KnowledgeStudioRuntimeReadAdapter({
          runtime: new FakeRuntime([projection]),
          bundles: [createBundle()],
          targetResolver: createMissingResolver(),
          assertCurrent: () => undefined,
          commands: await createAcceptEnabledCommands(),
          reviewSources: [
            { bundleId: BUNDLE_ID, sourceId: "source-1", pipelineFingerprint: "d".repeat(64) },
            { bundleId: BUNDLE_ID, sourceId: "source-current", pipelineFingerprint: PIPELINE_HASH },
          ],
        }).load(BUNDLE_ID, new AbortController().signal);

        expect(snapshot.outdatedReviewIds).toEqual([outdatedRecord.changeSetId]);
        expect(snapshot.reviews.map((plan) => plan.changeSetId).sort()).toEqual(
          [outdatedRecord.changeSetId, currentRecord.changeSetId].sort()
        );
        expect(snapshot.commandCapabilities).toMatchObject({
          reviewAccept: true,
          reviewReject: true,
        });
        expect(JSON.stringify(projection)).toBe(before);
      });
    });

    describe("subscribe()", () => {
      it("combines Runtime and Vault hints and cleans both subscriptions idempotently", () => {
        const projection = createProjection(1);
        const runtime = new FakeRuntime([projection]);
        const order: string[] = [];
        let vaultHint: (() => void) | undefined;
        let vaultUnsubscribeCount = 0;
        const subscribeVaultHints: KnowledgeStudioVaultHintPort = (_bundleId, listener) => {
          vaultHint = listener;
          return () => {
            vaultUnsubscribeCount += 1;
          };
        };
        const listener = jest.fn(() => order.push("hint"));
        const revokeCurrent = jest.fn(() => order.push("revoke"));
        const unsubscribe = createAdapter(
          runtime,
          createMissingResolver(),
          subscribeVaultHints,
          () => undefined,
          undefined,
          {
            query: async () => createQueryResult(),
            openCitation: async () => undefined,
            revokeCurrent,
          }
        ).subscribe(BUNDLE_ID, listener);

        runtime.subscriptions.get(BUNDLE_ID)?.();
        vaultHint?.();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(revokeCurrent).toHaveBeenNthCalledWith(1, BUNDLE_ID, undefined);
        expect(revokeCurrent).toHaveBeenNthCalledWith(2, BUNDLE_ID, undefined);
        expect(order).toEqual(["revoke", "hint", "revoke", "hint"]);

        unsubscribe();
        unsubscribe();
        vaultHint?.();
        expect(runtime.unsubscribed).toBe(true);
        expect(vaultUnsubscribeCount).toBe(1);
        expect(listener).toHaveBeenCalledTimes(2);
      });

      it("rolls back Runtime subscription and sanitizes a Vault subscription failure", () => {
        let active = false;
        let retainedHint: (() => void) | undefined;
        const unsubscribeRuntime = jest.fn(() => {
          active = false;
        });
        const runtime: KnowledgeStudioRuntimePort = {
          readStudioBundle: async () => createProjection(1),
          subscribeStudioBundle: (_bundleId, listener) => {
            active = true;
            retainedHint = listener;
            return unsubscribeRuntime;
          },
        };
        const onHint = jest.fn();
        const adapter = createAdapter(runtime, createMissingResolver(), () => {
          throw new Error("secret Vault subscription detail");
        });

        let captured: unknown;
        try {
          adapter.subscribe(BUNDLE_ID, onHint);
        } catch (error) {
          captured = error;
        }
        expect(captured).toEqual(
          expect.objectContaining({
            name: "KnowledgeStudioRuntimeReadError",
            message: "Knowledge Studio could not construct a consistent Runtime snapshot",
          })
        );
        expect(unsubscribeRuntime).toHaveBeenCalledTimes(1);
        if (active) retainedHint?.();
        expect(onHint).not.toHaveBeenCalled();
      });
    });

    describe("saveQueryToWiki()", () => {
      const issue = "https://github.com/yydspanda/obsidian-copilot/issues/9";

      it("publishes and delegates reviewed writeback only when its exact method is captured", async () => {
        const projection = createProjection(4);
        const query = jest.fn(async () => createQueryResult());
        const openCitation = jest.fn(async () => undefined);
        const revokeCurrent = jest.fn();
        const saveQueryToWiki = jest.fn(async () => ({ kind: "registered" }) as const);
        const adapter = createAdapter(
          new FakeRuntime([projection, projection]),
          createMissingResolver(),
          undefined,
          () => undefined,
          undefined,
          { query, openCitation, revokeCurrent, saveQueryToWiki }
        );
        const signal = new AbortController().signal;

        const snapshot = await adapter.load(BUNDLE_ID, signal);
        const receipt = await adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          signal
        );

        expect(snapshot).toMatchObject({
          queryAvailable: true,
          queryWritebackAvailable: true,
        });
        expect(receipt).toEqual({ kind: "registered" });
        expect(saveQueryToWiki).toHaveBeenCalledWith(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          signal
        );
      });

      it(`coalesces Runtime, Vault and command hints for every subscriber until registration settles (${issue})`, async () => {
        const fixture = createWritebackHintFixture(await createAcceptEnabledCommands());
        const first = jest.fn();
        const second = jest.fn();
        const unsubscribeFirst = fixture.adapter.subscribe(BUNDLE_ID, first);
        const unsubscribeSecond = fixture.adapter.subscribe(BUNDLE_ID, second);
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );

        fixture.emit("vault");
        fixture.emit("runtime");
        fixture.emit("vault");
        await fixture.adapter.pauseBundle(BUNDLE_ID, 0, new AbortController().signal);
        expect(fixture.revokeCurrent).not.toHaveBeenCalled();
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        fixture.saves[0].resolve({ kind: "registered" });
        await expect(pending).resolves.toEqual({ kind: "registered" });
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(fixture.revokeCurrent).toHaveBeenCalledTimes(2);
        fixture.emit("runtime");
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(2);
        unsubscribeFirst();
        unsubscribeSecond();
      });

      it(`keeps a different Bundle's hints live while one Bundle is saving (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        const first = jest.fn();
        const other = jest.fn();
        fixture.adapter.subscribe(BUNDLE_ID, first);
        fixture.adapter.subscribe("other", other);
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );

        fixture.emit("vault");
        fixture.emit("runtime", "other");
        expect(first).not.toHaveBeenCalled();
        expect(other).toHaveBeenCalledTimes(1);
        expect(fixture.revokeCurrent.mock.calls).toEqual([["other", undefined]]);
        const otherPending = fixture.adapter.saveQueryToWiki(
          "other",
          "query-other",
          { title: "Another Bundle answer" },
          new AbortController().signal
        );
        fixture.emit("runtime", "other");
        fixture.saves[0].resolve({ kind: "registered" });
        await pending;
        expect(first).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(1);
        fixture.saves[1].resolve({ kind: "registered" });
        await otherPending;
        expect(first).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(2);
      });

      it(`waits for the last overlapping save in a Bundle before delivering its hints (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        const onHint = jest.fn();
        fixture.adapter.subscribe(BUNDLE_ID, onHint);
        const first = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "First answer" },
          new AbortController().signal
        );
        const second = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Second answer" },
          new AbortController().signal
        );
        fixture.emit("vault");

        fixture.saves[0].resolve({ kind: "registered" });
        await first;
        expect(onHint).not.toHaveBeenCalled();
        expect(fixture.revokeCurrent).not.toHaveBeenCalled();
        fixture.emit("runtime");
        fixture.saves[1].resolve({ kind: "registered" });
        await second;
        expect(onHint).toHaveBeenCalledTimes(1);
        expect(fixture.revokeCurrent).toHaveBeenCalledTimes(1);
      });

      it(`delivers a deferred hint after a failed save without replacing the save failure (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        const onHint = jest.fn();
        fixture.adapter.subscribe(BUNDLE_ID, onHint);
        const failure = new Error("Registration failed");
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );
        const rejected = expect(pending).rejects.toBe(failure);
        fixture.emit("vault");
        expect(onHint).not.toHaveBeenCalled();

        fixture.saves[0].reject(failure);
        await rejected;
        expect(onHint).toHaveBeenCalledTimes(1);
        fixture.emit("runtime");
        expect(onHint).toHaveBeenCalledTimes(2);
      });

      it(`does not deliver a retained hint to an unsubscribed view (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        const closed = jest.fn();
        const active = jest.fn();
        const unsubscribe = fixture.adapter.subscribe(BUNDLE_ID, closed);
        fixture.adapter.subscribe(BUNDLE_ID, active);
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );
        fixture.emit("vault");
        unsubscribe();
        fixture.saves[0].resolve({ kind: "registered" });
        await pending;

        expect(closed).not.toHaveBeenCalled();
        expect(active).toHaveBeenCalledTimes(1);
        expect(fixture.revokeCurrent).toHaveBeenCalledTimes(1);
      });

      it(`isolates a failing deferred observer from the receipt and other views (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        fixture.adapter.subscribe(BUNDLE_ID, () => {
          throw new Error("View failed");
        });
        const active = jest.fn();
        fixture.adapter.subscribe(BUNDLE_ID, active);
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );
        fixture.emit("vault");
        fixture.saves[0].resolve({ kind: "registered" });

        await expect(pending).resolves.toEqual({ kind: "registered" });
        expect(active).toHaveBeenCalledTimes(1);
      });

      it(`forwards explicit Query revocation immediately while non-authoritative hints wait (${issue})`, async () => {
        const fixture = createWritebackHintFixture();
        const onHint = jest.fn();
        fixture.adapter.subscribe(BUNDLE_ID, onHint);
        const pending = fixture.adapter.saveQueryToWiki(
          BUNDLE_ID,
          "query-1",
          { title: "Durable answer" },
          new AbortController().signal
        );
        fixture.emit("vault");
        fixture.adapter.revokeCurrent(BUNDLE_ID, "query-1");
        expect(fixture.revokeCurrent.mock.calls).toEqual([[BUNDLE_ID, "query-1"]]);
        expect(onHint).not.toHaveBeenCalled();

        fixture.saves[0].resolve({ kind: "registered" });
        await pending;
        expect(fixture.revokeCurrent.mock.calls).toEqual([
          [BUNDLE_ID, "query-1"],
          [BUNDLE_ID, undefined],
        ]);
      });
    });
  });

  it("publishes only a same-revision source lifecycle model and delegates its exact commands", async () => {
    const loadSources = jest.fn(async () =>
      createKnowledgeSourceLifecycleModel({
        bundleId: BUNDLE_ID,
        runtimeRevision: 4,
        manifestRevision: 2,
        sources: [],
      })
    );
    const checkAgain = jest.fn(async () => undefined);
    const retireSource = jest.fn(async () => ({
      outcome: "retired" as const,
      retainedWikiPageCount: 0,
    }));
    const sourceLifecycle: KnowledgeSourceLifecyclePort = {
      loadSources,
      checkAgain,
      retireSource,
    };
    const adapter = createAdapter(
      new FakeRuntime([createProjection(4), createProjection(4)]),
      createMissingResolver(),
      undefined,
      () => undefined,
      undefined,
      undefined,
      sourceLifecycle
    );
    const signal = new AbortController().signal;

    await expect(adapter.load(BUNDLE_ID, signal)).resolves.toMatchObject({
      sourceLifecycle: {
        bundleId: BUNDLE_ID,
        runtimeRevision: 4,
        manifestRevision: 2,
        sources: [],
      },
    });
    await adapter.checkAgain(BUNDLE_ID, "source-1", signal);
    await adapter.retireSource(
      BUNDLE_ID,
      { sourceId: "source-1", retirementRef: "d".repeat(64), reason: "user_requested" },
      signal
    );

    expect(loadSources).toHaveBeenCalledWith(BUNDLE_ID, signal);
    expect(checkAgain).toHaveBeenCalledWith(BUNDLE_ID, "source-1", signal);
    expect(retireSource).toHaveBeenCalledTimes(1);
    expect("replaceMissingSource" in adapter).toBe(false);
  });

  it("rejects a source lifecycle projection from a different Runtime revision", async () => {
    const sourceLifecycle: KnowledgeSourceLifecyclePort = {
      loadSources: async () =>
        createKnowledgeSourceLifecycleModel({
          bundleId: BUNDLE_ID,
          runtimeRevision: 5,
          manifestRevision: 2,
          sources: [],
        }),
      checkAgain: async () => undefined,
      retireSource: async () => ({ outcome: "retired", retainedWikiPageCount: 0 }),
    };
    const adapter = createAdapter(
      new FakeRuntime([createProjection(4)]),
      createMissingResolver(),
      undefined,
      () => undefined,
      undefined,
      undefined,
      sourceLifecycle
    );

    await expect(adapter.load(BUNDLE_ID, new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeStudioRuntimeReadError
    );
  });

  it("renders empty durable Activity and Review from one atomic Runtime generation", async () => {
    const projection = createProjection(4);
    const runtime = new FakeRuntime([projection, projection]);
    const resolver = createMissingResolver();
    const adapter = createAdapter(runtime, resolver);

    const snapshot = await adapter.load(BUNDLE_ID, new AbortController().signal);

    expect(snapshot).toMatchObject({
      bundleId: BUNDLE_ID,
      availability: "ready",
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
        recoveryContinue: false,
        recoveryAbandon: false,
      },
      activity: { bundleId: BUNDLE_ID, revision: 0, items: [] },
      reviews: [],
      recovery: { bundleId: BUNDLE_ID, runtimeRevision: 4, items: [] },
      queryAvailable: false,
      queryWritebackAvailable: false,
    });
    expect(snapshot.notice).toContain("Review decisions and Wiki apply remain disabled");
    expect(snapshot.revisionToken).toMatch(/^r4-q0-v0-[a-f0-9]{12}$/);
    expect(runtime.readCalls).toEqual([BUNDLE_ID, BUNDLE_ID]);
    expect(resolver.calls).toHaveLength(0);
    expect(Object.isFrozen(snapshot.recovery)).toBe(true);
    expect(Object.isFrozen(snapshot.recovery.items)).toBe(true);
  });

  it("publishes and delegates scoped Query only when its exact adapter is installed", async () => {
    const projection = createProjection(4);
    const query = jest.fn(async () => createQueryResult());
    const openCitation = jest.fn(async () => undefined);
    const revokeCurrent = jest.fn();
    const adapter = createAdapter(
      new FakeRuntime([projection, projection]),
      createMissingResolver(),
      undefined,
      () => undefined,
      undefined,
      { query, openCitation, revokeCurrent }
    );
    const signal = new AbortController().signal;

    const snapshot = await adapter.load(BUNDLE_ID, signal);
    const result = await adapter.query(BUNDLE_ID, { query: "topic" }, signal);
    await adapter.openCitation(BUNDLE_ID, result.queryId, "citation-1", signal);
    adapter.revokeCurrent(BUNDLE_ID, result.queryId);

    expect(snapshot).toMatchObject({
      queryAvailable: true,
      queryWritebackAvailable: false,
    });
    expect(snapshot.notice).toContain("grounded Query");
    expect(snapshot.notice).toContain("selected DeepSeek model");
    expect(query).toHaveBeenCalledWith(BUNDLE_ID, { query: "topic" }, signal);
    expect(openCitation).toHaveBeenCalledWith(BUNDLE_ID, "query-1", "citation-1", signal);
    expect(revokeCurrent).toHaveBeenCalledWith(BUNDLE_ID, "query-1");
    await expect(
      adapter.saveQueryToWiki(BUNDLE_ID, "query-1", { title: "Unavailable" }, signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
  });

  it("captures one immutable Query generation instead of following caller substitution", async () => {
    const projection = createProjection(4);
    const originalQuery = jest.fn(async () => createQueryResult());
    const originalOpenCitation = jest.fn(async () => undefined);
    const originalRevokeCurrent = jest.fn();
    const originalSaveQueryToWiki = jest.fn(
      async (): Promise<KnowledgeStudioQueryWritebackResult> => ({ kind: "registered" })
    );
    const replacementQuery = jest.fn(async () => ({ ...createQueryResult(), queryId: "replaced" }));
    const replacementRevokeCurrent = jest.fn();
    const replacementSaveQueryToWiki = jest.fn(
      async (): Promise<KnowledgeStudioQueryWritebackResult> => ({ kind: "registered" })
    );
    const input: KnowledgeStudioRuntimeReadAdapterInput = {
      runtime: new FakeRuntime([projection, projection]),
      bundles: [createBundle()],
      targetResolver: createMissingResolver(),
      assertCurrent: () => undefined,
      query: {
        query: originalQuery,
        openCitation: originalOpenCitation,
        revokeCurrent: originalRevokeCurrent,
        saveQueryToWiki: originalSaveQueryToWiki,
      },
    };
    const adapter = new KnowledgeStudioRuntimeReadAdapter(input);
    input.query = {
      query: replacementQuery,
      openCitation: jest.fn(async () => undefined),
      revokeCurrent: replacementRevokeCurrent,
      saveQueryToWiki: replacementSaveQueryToWiki,
    };
    const signal = new AbortController().signal;

    const snapshot = await adapter.load(BUNDLE_ID, signal);
    const result = await adapter.query(BUNDLE_ID, { query: "topic" }, signal);
    await adapter.openCitation(BUNDLE_ID, result.queryId, "citation-1", signal);
    await adapter.saveQueryToWiki(BUNDLE_ID, result.queryId, { title: "Captured" }, signal);
    adapter.revokeCurrent(BUNDLE_ID, result.queryId);

    expect(snapshot).toMatchObject({
      queryAvailable: true,
      queryWritebackAvailable: true,
    });
    expect(result.queryId).toBe("query-1");
    expect(originalQuery).toHaveBeenCalledTimes(1);
    expect(originalOpenCitation).toHaveBeenCalledTimes(1);
    expect(originalSaveQueryToWiki).toHaveBeenCalledWith(
      BUNDLE_ID,
      "query-1",
      { title: "Captured" },
      signal
    );
    expect(originalRevokeCurrent).toHaveBeenCalledWith(BUNDLE_ID, "query-1");
    expect(replacementQuery).not.toHaveBeenCalled();
    expect(replacementSaveQueryToWiki).not.toHaveBeenCalled();
    expect(replacementRevokeCurrent).not.toHaveBeenCalled();
  });

  it("rejects incomplete or accessor-backed Query methods without invoking getters", () => {
    const projection = createProjection(4);
    let getterCalls = 0;
    let revokeGetterCalls = 0;
    let writebackGetterCalls = 0;
    const accessorQuery = {
      get query(): KnowledgeStudioQueryPort["query"] {
        getterCalls += 1;
        return async () => createQueryResult();
      },
      openCitation: async () => undefined,
      revokeCurrent: () => undefined,
    };
    const base = {
      runtime: new FakeRuntime([projection]),
      bundles: [createBundle()],
      targetResolver: createMissingResolver(),
      assertCurrent: () => undefined,
    };

    expect(
      () =>
        new KnowledgeStudioRuntimeReadAdapter({
          ...base,
          query: accessorQuery,
        })
    ).toThrow(KnowledgeStudioRuntimeReadError);
    expect(getterCalls).toBe(0);
    expect(
      () =>
        new KnowledgeStudioRuntimeReadAdapter({
          ...base,
          query: {
            query: async () => createQueryResult(),
            openCitation: async () => undefined,
            get revokeCurrent(): KnowledgeStudioQueryPort["revokeCurrent"] {
              revokeGetterCalls += 1;
              return () => undefined;
            },
          },
        })
    ).toThrow(KnowledgeStudioRuntimeReadError);
    expect(revokeGetterCalls).toBe(0);
    expect(
      () =>
        new KnowledgeStudioRuntimeReadAdapter({
          ...base,
          query: {
            query: async () => createQueryResult(),
            openCitation: async () => undefined,
            revokeCurrent: () => undefined,
            get saveQueryToWiki(): KnowledgeStudioQueryWritebackPort["saveQueryToWiki"] {
              writebackGetterCalls += 1;
              return async () => ({ kind: "registered" });
            },
          },
        })
    ).toThrow(KnowledgeStudioRuntimeReadError);
    expect(writebackGetterCalls).toBe(0);
    expect(
      () =>
        new KnowledgeStudioRuntimeReadAdapter({
          ...base,
          query: { query: async () => createQueryResult() } as unknown as Pick<
            KnowledgeStudioQueryPort,
            "query" | "openCitation" | "revokeCurrent"
          >,
        })
    ).toThrow(KnowledgeStudioRuntimeReadError);

    const asyncLikeRevoke = createAdapter(
      new FakeRuntime([projection]),
      createMissingResolver(),
      undefined,
      () => undefined,
      undefined,
      {
        query: async () => createQueryResult(),
        openCitation: async () => undefined,
        revokeCurrent: (() =>
          Promise.resolve()) as unknown as KnowledgeStudioQueryPort["revokeCurrent"],
      }
    );
    expect(() => asyncLikeRevoke.revokeCurrent(BUNDLE_ID)).toThrow(KnowledgeStudioRuntimeReadError);
  });

  it("publishes the exact reviewed create/update boundary when acceptance is connected", async () => {
    const projection = createProjection(5);
    const commands = await createAcceptEnabledCommands();
    const snapshot = await createAdapter(
      new FakeRuntime([projection, projection]),
      createMissingResolver(),
      undefined,
      () => undefined,
      commands
    ).load(BUNDLE_ID, new AbortController().signal);

    expect(snapshot.commandCapabilities).toEqual({
      pauseBundle: true,
      resumeBundle: true,
      cancelJob: true,
      retryJob: true,
      reviewReject: true,
      reviewAccept: true,
      recoveryContinue: false,
      recoveryAbandon: false,
      forwardRevisionReview: false,
    });
    expect(snapshot.recovery).toEqual({
      bundleId: BUNDLE_ID,
      runtimeRevision: 5,
      items: [],
    });
    expect(snapshot.notice).toContain("create and update selections can be explicitly applied");
    expect(snapshot.notice).toContain("delete acceptance and Query remain disabled");
  });

  it("shows only an exact Queue-anchored pending Review and observes its target read-only", async () => {
    const record = createPendingRecord();
    const projection = createProjection(7, createQueue(record), createReview([record]));
    const runtime = new FakeRuntime([projection, projection]);
    const resolver = createMissingResolver();
    const adapter = createAdapter(runtime, resolver);

    const snapshot = await adapter.load(BUNDLE_ID, new AbortController().signal);

    expect(snapshot.activity.items[0]).toMatchObject({
      id: "job-1",
      status: "awaiting_review",
      changeSetId: record.changeSetId,
    });
    expect(snapshot.reviews).toHaveLength(1);
    expect(snapshot.reviews[0]).toMatchObject({
      changeSetId: record.changeSetId,
      proposalDigest: record.proposalDigest,
      files: [{ changeId: "change-1", integrity: "current", capability: "blocks_allowed" }],
    });
    expect(resolver.calls).toEqual([
      [
        {
          targetId: "change-1",
          path: "Wiki/Page.md",
          intent: "write",
          access: "create_only",
        },
      ],
    ]);
    const plan = snapshot.reviews[0];
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sourceRefs)).toBe(true);
    expect(Object.isFrozen(plan.validation)).toBe(true);
    expect(Object.isFrozen(plan.files)).toBe(true);
    expect(Object.isFrozen(plan.files[0])).toBe(true);
    expect(Object.isFrozen(plan.files[0].sourceRefs)).toBe(true);
    expect(Object.isFrozen(plan.files[0].blocks)).toBe(true);
    expect(Object.isFrozen(plan.files[0].blocks[0])).toBe(true);
    expect(Object.isFrozen(plan.files[0].blocks[0].parts)).toBe(true);
    expect(Object.isFrozen(plan.files[0].blocks[0].parts[0])).toBe(true);
    expect(() => plan.sourceRefs.push("mutated")).toThrow(TypeError);
  });

  it("hides a Review saved before Queue hand-off but rejects the inverse dangling anchor", async () => {
    const record = createPendingRecord();
    const orphan = createProjection(1, createQueue(), createReview([record]));
    const orphanRuntime = new FakeRuntime([orphan, orphan]);
    const resolver = createMissingResolver();

    await expect(
      createAdapter(orphanRuntime, resolver).load(BUNDLE_ID, new AbortController().signal)
    ).resolves.toMatchObject({ reviews: [] });
    expect(resolver.calls).toHaveLength(0);

    const dangling = createProjection(2, createQueue(record), createReview());
    await expect(
      createAdapter(new FakeRuntime([dangling])).load(BUNDLE_ID, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioRuntimeReadError" });
  });

  it("maps a create-only occupied target to a visible reject-only Review file", async () => {
    const record = createPendingRecord();
    const projection = createProjection(8, createQueue(record), createReview([record]));
    const resolver = new FakeTargetResolver(async () => [
      { targetId: "change-1", kind: "occupied", path: "Wiki/Page.md" },
    ]);
    const snapshot = await createAdapter(new FakeRuntime([projection, projection]), resolver).load(
      BUNDLE_ID,
      new AbortController().signal
    );

    expect(snapshot.reviews[0].files[0]).toMatchObject({
      integrity: "occupied",
      capability: "reject_only",
      blockedReason: "review_create_target_occupied",
    });
  });

  it("retries the complete read when Runtime changes during target observation", async () => {
    const record = createPendingRecord();
    const first = createProjection(10, createQueue(record, 2), createReview([record], 1));
    const second = createProjection(11, createQueue(record, 3), createReview([record], 2));
    const runtime = new FakeRuntime([first, second, second, second]);
    const resolver = createMissingResolver();

    const snapshot = await createAdapter(runtime, resolver).load(
      BUNDLE_ID,
      new AbortController().signal
    );

    expect(snapshot.revisionToken).toMatch(/^r11-q3-v2-[a-f0-9]{12}$/);
    expect(runtime.readCalls).toHaveLength(4);
    expect(resolver.calls).toHaveLength(2);
  });

  it("fails with one sanitized error after bounded consistency retries are exhausted", async () => {
    const projections = [1, 2, 3, 4, 5, 6].map((revision) => createProjection(revision));
    const runtime = new FakeRuntime(projections);
    const resolver = createMissingResolver();

    await expect(
      createAdapter(runtime, resolver).load(BUNDLE_ID, new AbortController().signal)
    ).rejects.toEqual(
      expect.objectContaining({
        name: "KnowledgeStudioRuntimeReadError",
        message: "Knowledge Studio could not construct a consistent Runtime snapshot",
      })
    );
    expect(runtime.readCalls).toHaveLength(6);
    expect(resolver.calls).toHaveLength(0);
  });

  it("sanitizes raw Runtime failures without retaining their message or cause", async () => {
    const runtime: KnowledgeStudioRuntimePort = {
      readStudioBundle: async () => {
        throw new Error("secret path and adapter detail");
      },
      subscribeStudioBundle: () => () => undefined,
    };

    let captured: unknown;
    try {
      await createAdapter(runtime).load(BUNDLE_ID, new AbortController().signal);
    } catch (error) {
      captured = error;
    }
    expect(captured).toEqual(
      expect.objectContaining({
        name: "KnowledgeStudioRuntimeReadError",
        message: "Knowledge Studio could not construct a consistent Runtime snapshot",
      })
    );
    expect(String(captured)).not.toContain("secret path");
    expect(captured).not.toHaveProperty("cause");
  });

  it("rejects a proposal outside the captured Wiki root before any Vault read", async () => {
    const record = createPendingRecord(createProposal("Other/Page.md"));
    const projection = createProjection(3, createQueue(record), createReview([record]));
    const resolver = createMissingResolver();

    await expect(
      createAdapter(new FakeRuntime([projection]), resolver).load(
        BUNDLE_ID,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "KnowledgeStudioRuntimeReadError" });
    expect(resolver.calls).toHaveLength(0);
  });

  it("honors cancellation and lifecycle invalidation without publishing a snapshot", async () => {
    const projection = createProjection(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createAdapter(new FakeRuntime([projection])).load(BUNDLE_ID, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    const assertCurrent = jest.fn(() => {
      throw new Error("stale owner");
    });
    await expect(
      createAdapter(
        new FakeRuntime([projection]),
        createMissingResolver(),
        undefined,
        assertCurrent
      ).load(BUNDLE_ID, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioRuntimeReadError" });
  });

  it("recognizes a serialized own-data cancellation and rejects hostile lookalikes", async () => {
    const record = createPendingRecord();
    const projection = createProjection(1, createQueue(record), createReview([record]));
    const serializedAbort = Object.freeze({ name: "AbortError" }) as Error;
    const abortingResolver = new FakeTargetResolver(async () => {
      throw serializedAbort;
    });

    await expect(
      createAdapter(new FakeRuntime([projection]), abortingResolver).load(
        BUNDLE_ID,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    let getterCalls = 0;
    const accessorLookalike = {} as Error;
    Object.defineProperty(accessorLookalike, "name", {
      get: () => {
        getterCalls += 1;
        return "AbortError";
      },
    });
    const proxyLookalike = new Proxy({} as Error, {
      getOwnPropertyDescriptor: () => {
        throw new Error("descriptor trap must fail closed");
      },
    });
    for (const failure of [accessorLookalike, proxyLookalike]) {
      const hostileResolver = new FakeTargetResolver(async () => {
        throw failure;
      });
      await expect(
        createAdapter(new FakeRuntime([projection]), hostileResolver).load(
          BUNDLE_ID,
          new AbortController().signal
        )
      ).rejects.toBeInstanceOf(KnowledgeStudioRuntimeReadError);
    }
    expect(getterCalls).toBe(0);
  });

  it("keeps every mutation command fail-closed in the read-only generation", async () => {
    const record = createPendingRecord();
    const adapter = createAdapter(new FakeRuntime([createProjection(1)]));
    const signal = new AbortController().signal;

    await expect(adapter.pauseBundle(BUNDLE_ID, 0, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(adapter.resumeBundle(BUNDLE_ID, 0, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(adapter.cancelJob(BUNDLE_ID, "job-1", 0, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(adapter.retryJob(BUNDLE_ID, "job-1", 0, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(
      adapter.submitReview(BUNDLE_ID, createReviewCommand(record), signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    await expect(adapter.query(BUNDLE_ID, { query: "blocked" }, signal)).rejects.toMatchObject({
      name: "KnowledgeStudioAdapterUnavailableError",
    });
    await expect(
      adapter.openCitation(BUNDLE_ID, "query", "citation", signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
  });
});
