import {
  ALL_KNOWLEDGE_FILE_MUTATIONS,
  createKnowledgeChangeSetDigest,
  type KnowledgeFileCompareAndSwapResult,
  type KnowledgeFileMutationCapabilities,
  type KnowledgeFileObservation,
  type KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import type { TransactionFileState } from "@/knowledge/changeset/TransactionStorage";
import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  type KnowledgePipelineProfilePort,
  type KnowledgeSourceExecutionPlan,
  type KnowledgeWorkflowGenerationPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  createManifestCommitPlan,
  createManifestCommitPlanDigest,
  type ManifestCommitMutation,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStartupReleasePort,
  parseKnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeProductionReviewedApplyCoordinator } from "@/knowledge/startup/KnowledgeProductionReviewedApplyCoordinator";
import {
  createKnowledgeExecutionTestHarness,
  type KnowledgeExecutionTestHarness,
} from "@/knowledge/testing/KnowledgeExecutionTestHarness";
import { loadKnowledgeStudioReviewContext } from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-notes";
const SOURCE_PATH = "Sources/Notes.md";
const SCHEMA_PATH = "Schema/knowledge.md";
const TARGET_PATH = "Wiki/Atlas.md";
const SECOND_TARGET_PATH = "Wiki/Atlas Timeline.md";
const SOURCE_TEXT = "Project Atlas launch date is 2026-08-01.";
const SOURCE_BYTES = new TextEncoder().encode(`# Source\n${SOURCE_TEXT}\n`);
const FOLLOWUP_SOURCE_BYTES = new TextEncoder().encode(
  `# Source\n${SOURCE_TEXT}\nThe launch schedule is now confirmed.\n`
);
const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);
const FOLLOWUP_SOURCE_CONTENT_HASH = createSourceContentHash(FOLLOWUP_SOURCE_BYTES);
const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
const PAGE_CONTENT = `---
type: topic
title: Project Atlas
tags: [project]
confidence: 0.9
---

# Project Atlas

${SOURCE_TEXT}
`;
const UPDATED_PAGE_CONTENT = `---
type: topic
title: Project Atlas
tags: [project]
confidence: 0.95
---

# Project Atlas

${SOURCE_TEXT}

The launch schedule is confirmed.
`;
const TIMELINE_PAGE_CONTENT = `---
type: topic
title: Project Atlas Timeline
tags: [project]
confidence: 0.9
---

# Project Atlas Timeline

${SOURCE_TEXT}
`;
const originalRandomUuidDescriptor = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
let transactionSequence = 0;

/** Exact in-memory Wiki mutation boundary used by reviewed-apply tests. */
class MemoryKnowledgeFileStore implements KnowledgeFileStore {
  readonly mutationCapabilities: Readonly<KnowledgeFileMutationCapabilities>;
  readonly files = new Map<string, string>();
  compareAndSwapCalls = 0;

  /** Creates a logical store with an optional real-parent precondition. */
  constructor(requiresExistingParentForCreate = false) {
    this.mutationCapabilities = requiresExistingParentForCreate
      ? Object.freeze({
          ...ALL_KNOWLEDGE_FILE_MUTATIONS,
          requiresExistingParentForCreate: true,
        })
      : ALL_KNOWLEDGE_FILE_MUTATIONS;
  }

  /** Observes one exact Wiki path. */
  async observe(path: string): Promise<KnowledgeFileObservation> {
    const content = this.files.get(path);
    return content === undefined ? { kind: "missing" } : { kind: "file", content };
  }

  /** Applies one exact compare-and-swap mutation. */
  async compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    this.compareAndSwapCalls += 1;
    const current = await this.observe(path);
    if (this.matches(current, after)) return { kind: "already_after" };
    if (!this.matches(current, before)) return { kind: "conflict", observation: current };
    if (after.kind === "missing") {
      this.files.delete(path);
    } else {
      this.files.set(path, after.content);
    }
    return { kind: "applied" };
  }

  /** Compares a current observation with one journal-owned file state. */
  private matches(observation: KnowledgeFileObservation, state: TransactionFileState): boolean {
    if (state.kind === "missing") return observation.kind === "missing";
    return (
      observation.kind === "file" &&
      observation.content === state.content &&
      createFileContentHash(observation.content) === state.contentHash
    );
  }
}

/** Creates the project-owned Bundle used by the reviewed apply workflow. */
function createOwner(): ConfiguredProjectKnowledgeBundle {
  return {
    projectId: "project-personal",
    config: {
      version: 1,
      id: BUNDLE_ID,
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: SCHEMA_PATH,
      reviewMode: "always",
    },
  };
}

/** Creates the initial source registration read by planning and finalization. */
function createManifest(): SourceManifest {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    revision: 1,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourcePath: SOURCE_PATH,
        sourceKey: toWindowsPathKey(SOURCE_PATH),
        custody: "user_managed",
      },
    ],
  };
}

/** Creates the parser identity retained by the exact workflow fingerprint. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates the complete secret-free pipeline profile for one planned source. */
function createPipelineProfile(): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: { version: "knowledge-compiler-v1", configuration: { protocolVersion: 1 } },
    parsers: [createParserProfile()],
    model: {
      provider: "private-test-provider",
      model: "private-test-model",
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-json-v1",
        streaming: false,
        modelFallback: false,
        temperature: 0,
        maxTokens: 8192,
        reasoningEffort: "medium",
        verbosity: "medium",
        endpointIdentity: "1".repeat(64),
        routingIdentity: "2".repeat(64),
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates an exact source or schema artifact read. */
function createExactArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

/** Builds an authentic execution plan that can re-prove the accepted source. */
async function createExecutionPlan(
  manifest: SourceManifest,
  executionOwner: ReturnType<typeof createKnowledgeExecutionOwner>,
  sourceBytes: Uint8Array = SOURCE_BYTES
): Promise<KnowledgeSourceExecutionPlan> {
  const parser: KnowledgeByteParser = {
    /** Returns the exact profile bound during plan construction. */
    getProfile: () => createParserProfile(),
    /** Produces one exact text artifact used by citation validation. */
    parse: async () => ({
      artifact: {
        kind: "text" as const,
        sourceId: SOURCE_ID,
        artifactId: "primary",
        artifactContentHash: ARTIFACT_CONTENT_HASH,
        text: SOURCE_TEXT,
      },
    }),
  };
  const manifestPort: KnowledgeManifestSnapshotPort = { load: async () => manifest };
  const readerPort: KnowledgeExactArtifactReaderPort = {
    read: async (path) => createExactArtifact(path, SCHEMA_BYTES),
    readExpected: async (path) => createExactArtifact(path, sourceBytes),
  };
  const profilePort: KnowledgePipelineProfilePort = {
    resolve: async () => createPipelineProfile(),
  };
  const generationPort: KnowledgeWorkflowGenerationPort = { isCurrent: () => true };
  return await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: manifestPort,
    artifactReader: readerPort,
    pipelineProfile: profilePort,
    parsers: [parser],
    generation: generationPort,
  }).load([createOwner()], new AbortController().signal);
}

/** Creates one valid grounded proposal suitable for production revalidation. */
function createProposal(
  changes: KnowledgeFileChange[] = [
    {
      id: "change-atlas",
      operation: "create",
      path: TARGET_PATH,
      sourceRefs: [SOURCE_ID],
      reason: "Create one grounded project page",
      expectedAbsent: true,
      afterContent: PAGE_CONTENT,
      afterHash: createFileContentHash(PAGE_CONTENT),
    },
  ],
  id = "changeset-atlas"
): KnowledgeChangeSet {
  return {
    id,
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes,
    citations: [
      {
        citationId: "citation-atlas",
        claimId: "claim-atlas",
        relation: "supports",
        locator: {
          kind: "quote",
          sourceId: SOURCE_ID,
          artifactId: "primary",
          artifactContentHash: ARTIFACT_CONTENT_HASH,
          excerpt: SOURCE_TEXT,
          quoteHash: createQuoteHash(SOURCE_TEXT),
        },
      },
    ],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates one exact update proposal change around a Manifest-tracked page. */
function createUpdateChange(
  id = "change-atlas-followup",
  path = TARGET_PATH,
  beforeContent = PAGE_CONTENT,
  afterContent = UPDATED_PAGE_CONTENT
): Extract<KnowledgeFileChange, { operation: "update" }> {
  return {
    id,
    operation: "update",
    path,
    sourceRefs: [SOURCE_ID],
    reason: "Refresh one grounded project page",
    beforeHash: createFileContentHash(beforeContent),
    afterContent,
    afterHash: createFileContentHash(afterContent),
  };
}

/** Creates one exact create proposal change around a currently absent path. */
function createCreateChange(
  id: string,
  path: string,
  afterContent: string
): Extract<KnowledgeFileChange, { operation: "create" }> {
  return {
    id,
    operation: "create",
    path,
    sourceRefs: [SOURCE_ID],
    reason: "Create one grounded project page",
    expectedAbsent: true,
    afterContent,
    afterHash: createFileContentHash(afterContent),
  };
}

/** Creates one exact delete proposal change around a Manifest-tracked page. */
function createDeleteChange(): Extract<KnowledgeFileChange, { operation: "delete" }> {
  return {
    id: "change-atlas-followup",
    operation: "delete",
    path: TARGET_PATH,
    sourceRefs: [SOURCE_ID],
    reason: "Remove one obsolete generated page",
    beforeHash: createFileContentHash(PAGE_CONTENT),
  };
}

/** Resolves Manifest commit mutations from the proposal's exact base projection. */
function createManifestMutations(
  proposal: KnowledgeChangeSet,
  manifest: SourceManifest
): ManifestCommitMutation[] {
  const generatedPages = manifest.entries[0]?.lastSuccessful?.generatedPages ?? [];
  return proposal.changes.map((change) => {
    const tracked = generatedPages.find(
      (page) => toWindowsPathKey(page.path) === toWindowsPathKey(change.path)
    );
    return {
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      access: tracked ? "authorized" : "create_only",
      ownership: tracked?.ownership ?? "generated",
      wasTrackedByPrimarySource: tracked !== undefined,
    };
  });
}

/** Creates a target resolver for exact existing files and absent or occupied fallback paths. */
function createTargetResolver(
  kind: "missing" | "occupied",
  existingFiles: ReadonlyMap<string, string> = new Map()
): CompilerTargetResolver {
  return Object.freeze({
    resolve: async (targets: readonly CompilerTargetRequest[]) =>
      targets.map((target) => {
        const content = existingFiles.get(target.path);
        if (content !== undefined) {
          return {
            targetId: target.targetId,
            kind: "file" as const,
            path: target.path,
            content,
          };
        }
        return kind === "missing"
          ? {
              targetId: target.targetId,
              kind: "missing" as const,
              windowsPathKey: toWindowsPathKey(target.path),
            }
          : { targetId: target.targetId, kind: "occupied" as const, path: target.path };
      }),
  });
}

interface ReviewedApplyHarness {
  bundle: KnowledgeBundleConfig;
  capabilities: Pick<
    KnowledgeExecutionTestHarness,
    "executionOwner" | "file" | "queue" | "runtime"
  >;
  coordinator: KnowledgeProductionReviewedApplyCoordinator;
  fileStore: MemoryKnowledgeFileStore;
  reviews: ChangeSetReviewRepository;
  resolver: CompilerTargetResolver;
  refresh: jest.Mock<void, []>;
  changeSetId: string;
  jobId: string;
}

/**
 * Seeds one exact awaiting-Review queue job and production apply coordinator.
 *
 * @param targetKind - Current target observation exposed to Review
 * @param requiresExistingParentForCreate - Whether the test CAS needs a real parent directory
 * @returns Authentic pending Review and released production coordinator
 */
async function createReviewedApplyHarness(
  targetKind: "missing" | "occupied",
  requiresExistingParentForCreate = false
): Promise<ReviewedApplyHarness> {
  const owner = createOwner();
  const bundle = owner.config;
  const manifest = createManifest();
  const executionOwner = createKnowledgeExecutionOwner();
  const plan = await createExecutionPlan(manifest, executionOwner);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected one planned source");
  const proposal = createProposal();
  const proposalDigest = createKnowledgeChangeSetDigest(proposal);
  const manifestCommitPlan = createManifestCommitPlan({
    bundle,
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    inputRevision: 1,
    changeSet: proposal,
    mutations: createManifestMutations(proposal, manifest),
  });
  const manifestCommitPlanDigest = createManifestCommitPlanDigest(manifestCommitPlan);
  let reviews: ChangeSetReviewRepository | undefined;
  const capabilities = await createKnowledgeExecutionTestHarness({
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    jobId: "job-reviewed-apply",
    clock: 100,
    executionOwner,
    execute: async (context) => {
      if (!reviews) throw new Error("Review repository is not installed");
      const record = await reviews.saveProposal(BUNDLE_ID, {
        proposal,
        proposalDigest,
        manifestCommitPlan,
        manifestCommitPlanDigest,
        jobClaim: {
          jobId: context.job.id,
          sourceId: context.job.sourceId,
          sourceContentHash: context.job.sourceContentHash,
          pipelineFingerprint: context.job.pipelineFingerprint,
          inputRevision: context.job.inputRevision,
          attempt: context.job.attempt,
        },
      });
      if (record.outcome !== "pending") throw new Error("Expected one pending Review record");
      return {
        kind: "awaiting_review",
        changeSetId: record.changeSetId,
        reviewDecision: {
          outcome: "pending",
          bundleId: BUNDLE_ID,
          changeSetId: record.changeSetId,
          proposalDigest: record.proposalDigest,
          recordRevision: record.recordRevision,
          recordedAt: record.recordedAt,
          jobClaim: { ...record.jobClaim },
        },
      };
    },
  });
  reviews = new ChangeSetReviewRepository(
    new KnowledgeRuntimeReviewStorage(capabilities.runtime, executionOwner),
    { clock: () => 110 }
  );
  await expect(capabilities.queue.runNext(BUNDLE_ID)).resolves.toMatchObject({
    kind: "executed",
    status: "awaiting_review",
  });
  const resolver = createTargetResolver(targetKind);
  const fileStore = new MemoryKnowledgeFileStore(requiresExistingParentForCreate);
  const refresh = jest.fn<void, []>();
  const coordinator = new KnowledgeProductionReviewedApplyCoordinator({
    runtime: capabilities.runtime,
    queue: capabilities.queue,
    reviews,
    plan,
    bundles: [bundle],
    targetResolver: resolver,
    fileStore,
    assertCurrent: () => undefined,
    onGenerationRefreshRequired: refresh,
  });
  return {
    bundle,
    capabilities,
    coordinator,
    fileStore,
    reviews,
    resolver,
    refresh,
    changeSetId: proposal.id,
    jobId: "job-reviewed-apply",
  };
}

/**
 * Commits an authentic first create, then seeds a second reviewed source revision.
 *
 * Runtime deliberately forbids tests from fabricating lastSuccessful state: the
 * first commit supplies its matching Manifest metadata and apply ledger.
 */
async function createFollowupReviewedApplyHarness(
  proposal: KnowledgeChangeSet,
  existingFiles: ReadonlyMap<string, string>
): Promise<ReviewedApplyHarness> {
  const first = await createReviewedApplyHarness("missing");
  const firstCommand = await createAcceptCommand(first);
  await expect(
    first.coordinator.submit(BUNDLE_ID, firstCommand, new AbortController().signal)
  ).resolves.toEqual({ kind: "applied" });

  const observed = await first.capabilities.runtime.readStudioBundle(BUNDLE_ID);
  const released = await new KnowledgeRuntimeStartupReleasePort(first.capabilities.runtime).release(
    {
      bundleId: BUNDLE_ID,
      expectedRuntimeRevision: observed.runtimeRevision,
      expectedReviewRevision: observed.review.revision,
      expectedQueueRevision: observed.queue.revision,
    }
  );
  if (released.kind !== "released") throw new Error("Expected the committed Queue to release");

  const manifestRaw = await new KnowledgeRuntimeManifestStorage(first.capabilities.runtime).read(
    BUNDLE_ID
  );
  const parsedManifest = parseSourceManifest(manifestRaw);
  if (!parsedManifest.ok) throw new Error("Expected the committed Source Manifest");
  const manifest = parsedManifest.value;
  const executionOwner = createKnowledgeExecutionOwner();
  const plan = await createExecutionPlan(manifest, executionOwner, FOLLOWUP_SOURCE_BYTES);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected one planned follow-up source");
  const allocation = await new KnowledgeRuntimeInputRevisionAllocator(
    first.capabilities.runtime
  ).allocate({
    bundleId: BUNDLE_ID,
    sourceId: SOURCE_ID,
    captureId: `capture-${proposal.id}`,
  });
  const binding = await new KnowledgeRuntimeInputObservationBinder(first.capabilities.runtime).bind(
    {
      observationToken: allocation.observationToken,
      sourceContentHash: FOLLOWUP_SOURCE_CONTENT_HASH,
      pipelineFingerprint: source.pipelineFingerprint,
    }
  );
  if (binding.kind !== "ready") throw new Error("Expected one ready follow-up observation");

  const proposalDigest = createKnowledgeChangeSetDigest(proposal);
  const manifestCommitPlan = createManifestCommitPlan({
    bundle: first.bundle,
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: FOLLOWUP_SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    inputRevision: binding.observation.inputRevision,
    changeSet: proposal,
    mutations: createManifestMutations(proposal, manifest),
  });
  const manifestCommitPlanDigest = createManifestCommitPlanDigest(manifestCommitPlan);
  const reviews = new ChangeSetReviewRepository(
    new KnowledgeRuntimeReviewStorage(first.capabilities.runtime, executionOwner),
    { clock: () => 210 }
  );
  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(first.capabilities.runtime, executionOwner),
    {
      /** Saves the follow-up proposal before publishing its durable Review receipt. */
      execute: async (context) => {
        const record = await reviews.saveProposal(BUNDLE_ID, {
          proposal,
          proposalDigest,
          manifestCommitPlan,
          manifestCommitPlanDigest,
          jobClaim: {
            jobId: context.job.id,
            sourceId: context.job.sourceId,
            sourceContentHash: context.job.sourceContentHash,
            pipelineFingerprint: context.job.pipelineFingerprint,
            inputRevision: context.job.inputRevision,
            attempt: context.job.attempt,
          },
        });
        if (record.outcome !== "pending") throw new Error("Expected a pending follow-up Review");
        return {
          kind: "awaiting_review" as const,
          changeSetId: record.changeSetId,
          reviewDecision: {
            outcome: "pending" as const,
            bundleId: BUNDLE_ID,
            changeSetId: record.changeSetId,
            proposalDigest: record.proposalDigest,
            recordRevision: record.recordRevision,
            recordedAt: record.recordedAt,
            jobClaim: { ...record.jobClaim },
          },
        };
      },
    },
    {
      clock: () => 200,
      jobIdFactory: () => "job-reviewed-followup",
      retryPolicy: { decide: () => ({ kind: "fail", reason: "not_retryable" }) },
    }
  );
  await queue.enqueue(binding.observation);
  await expect(queue.runNext(BUNDLE_ID)).resolves.toMatchObject({
    kind: "executed",
    status: "awaiting_review",
  });

  const resolver = createTargetResolver("missing", existingFiles);
  const fileStore = new MemoryKnowledgeFileStore();
  for (const [path, content] of existingFiles) fileStore.files.set(path, content);
  const refresh = jest.fn<void, []>();
  return {
    bundle: first.bundle,
    capabilities: {
      executionOwner,
      file: first.capabilities.file,
      queue,
      runtime: first.capabilities.runtime,
    },
    coordinator: new KnowledgeProductionReviewedApplyCoordinator({
      runtime: first.capabilities.runtime,
      queue,
      reviews,
      plan,
      bundles: [first.bundle],
      targetResolver: resolver,
      fileStore,
      assertCurrent: () => undefined,
      onGenerationRefreshRequired: refresh,
    }),
    fileStore,
    reviews,
    resolver,
    refresh,
    changeSetId: proposal.id,
    jobId: "job-reviewed-followup",
  };
}

/** Builds an exact all-accept command from a fresh durable Review context. */
async function createAcceptCommand(harness: ReviewedApplyHarness) {
  const context = await loadKnowledgeStudioReviewContext({
    runtime: harness.capabilities.runtime,
    bundle: harness.bundle,
    targetResolver: harness.resolver,
    changeSetId: harness.changeSetId,
    signal: new AbortController().signal,
    assertCurrent: () => undefined,
  });
  if (!context) throw new Error("Expected one pending Review context");
  return {
    changeSetId: context.plan.changeSetId,
    proposalDigest: context.plan.proposalDigest,
    expectedSnapshotToken: context.plan.snapshotToken,
    decisions: context.plan.files.map((file) => ({
      changeId: file.changeId,
      decision: "accept_exact" as const,
    })),
  };
}

describe("KnowledgeProductionReviewedApplyCoordinator", () => {
  beforeAll(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        transactionSequence += 1;
        return `00000000-0000-4000-8000-${String(transactionSequence).padStart(12, "0")}`;
      },
    });
  });

  afterAll(() => {
    if (originalRandomUuidDescriptor) {
      Object.defineProperty(window.crypto, "randomUUID", originalRandomUuidDescriptor);
    } else {
      Reflect.deleteProperty(window.crypto, "randomUUID");
    }
  });

  it("applies one reviewed create and finalizes Runtime, Manifest, Queue, and journal state", async () => {
    const harness = await createReviewedApplyHarness("missing");
    const command = await createAcceptCommand(harness);

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "applied" });

    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(PAGE_CONTENT);
    expect(harness.fileStore.compareAndSwapCalls).toBe(1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    await expect(harness.capabilities.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      control: { status: "paused", reason: "startup_recovery" },
      jobs: [{ id: "job-reviewed-apply", status: "completed", stage: "completed" }],
      pendingReviews: [],
    });
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "accepted",
      acceptedChangeSet: { status: "accepted" },
    });
    const manifestRaw = await new KnowledgeRuntimeManifestStorage(
      harness.capabilities.runtime
    ).read(BUNDLE_ID);
    const manifest = parseSourceManifest(manifestRaw);
    if (!manifest.ok) throw new Error("Expected a committed Source Manifest");
    expect(manifest.value.entries[0]?.lastSuccessful).toMatchObject({
      sourceContentHash: SOURCE_CONTENT_HASH,
      changeSetId: harness.changeSetId,
      generatedPages: [
        {
          path: TARGET_PATH,
          ownership: "generated",
          contentHash: createFileContentHash(PAGE_CONTENT),
        },
      ],
    });
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.capabilities.file.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toHaveLength(1);
  });

  it("blocks a missing create parent before durable Review acceptance", async () => {
    const harness = await createReviewedApplyHarness("missing", true);
    const command = await createAcceptCommand(harness);

    const result = await harness.coordinator.submit(
      BUNDLE_ID,
      command,
      new AbortController().signal
    );
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("Expected blocked Review submission");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "changeset_create_parent_missing"
    );

    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "pending",
      recordRevision: 0,
    });
    await expect(harness.capabilities.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-reviewed-apply", status: "awaiting_review", stage: "review" }],
      pendingReviews: [expect.objectContaining({ changeSetId: harness.changeSetId })],
    });
    expect(harness.fileStore.compareAndSwapCalls).toBe(0);
    expect(harness.refresh).not.toHaveBeenCalled();
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.capabilities.file.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toEqual([]);
  });

  it("applies one fresh Manifest-authorized update against its exact before state", async () => {
    const proposal = createProposal([createUpdateChange()], "changeset-atlas-followup");
    const harness = await createFollowupReviewedApplyHarness(
      proposal,
      new Map([[TARGET_PATH, PAGE_CONTENT]])
    );
    const command = await createAcceptCommand(harness);

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "applied" });

    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(UPDATED_PAGE_CONTENT);
    expect(harness.fileStore.compareAndSwapCalls).toBe(1);
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "accepted",
      acceptedChangeSet: {
        changes: [
          {
            id: "change-atlas-followup",
            operation: "update",
            beforeHash: createFileContentHash(PAGE_CONTENT),
            afterHash: createFileContentHash(UPDATED_PAGE_CONTENT),
          },
        ],
      },
    });
    const manifestRaw = await new KnowledgeRuntimeManifestStorage(
      harness.capabilities.runtime
    ).read(BUNDLE_ID);
    const committedManifest = parseSourceManifest(manifestRaw);
    if (!committedManifest.ok) throw new Error("Expected a committed Source Manifest");
    expect(committedManifest.value).toMatchObject({
      revision: 3,
      entries: [
        {
          lastSuccessful: {
            generatedPages: [
              {
                path: TARGET_PATH,
                ownership: "generated",
                contentHash: createFileContentHash(UPDATED_PAGE_CONTENT),
              },
            ],
          },
        },
      ],
    });
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("applies one mixed block-selected update and exact-selected create atomically", async () => {
    const proposal = createProposal(
      [
        createUpdateChange(),
        createCreateChange("change-atlas-timeline", SECOND_TARGET_PATH, TIMELINE_PAGE_CONTENT),
      ],
      "changeset-atlas-followup"
    );
    const harness = await createFollowupReviewedApplyHarness(
      proposal,
      new Map([[TARGET_PATH, PAGE_CONTENT]])
    );
    const context = await loadKnowledgeStudioReviewContext({
      runtime: harness.capabilities.runtime,
      bundle: harness.bundle,
      targetResolver: harness.resolver,
      changeSetId: harness.changeSetId,
      signal: new AbortController().signal,
      assertCurrent: () => undefined,
    });
    if (!context) throw new Error("Expected one pending Review context");
    const update = context.plan.files.find((file) => file.changeId === "change-atlas-followup");
    if (!update) throw new Error("Expected the update Review file");
    const acceptedBlockIds = update.blocks
      .filter((block) => block.kind === "change")
      .map((block) => block.blockId);
    expect(acceptedBlockIds.length).toBeGreaterThan(0);
    const command = {
      changeSetId: context.plan.changeSetId,
      proposalDigest: context.plan.proposalDigest,
      expectedSnapshotToken: context.plan.snapshotToken,
      decisions: [
        {
          changeId: "change-atlas-followup",
          decision: "accept_blocks" as const,
          acceptedBlockIds,
        },
        { changeId: "change-atlas-timeline", decision: "accept_exact" as const },
      ],
    };

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "applied" });

    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(UPDATED_PAGE_CONTENT);
    expect(harness.fileStore.files.get(SECOND_TARGET_PATH)).toBe(TIMELINE_PAGE_CONTENT);
    expect(harness.fileStore.compareAndSwapCalls).toBe(2);
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "accepted",
      acceptedChangeSet: {
        changes: [
          {
            id: "change-atlas-followup",
            operation: "update",
            afterContent: UPDATED_PAGE_CONTENT,
          },
          {
            id: "change-atlas-timeline",
            operation: "create",
            afterContent: TIMELINE_PAGE_CONTENT,
          },
        ],
      },
    });
    const queue = await harness.capabilities.queue.load(BUNDLE_ID);
    expect(queue.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job-reviewed-followup",
          status: "completed",
          stage: "completed",
        }),
      ])
    );
    expect(queue.pendingReviews).toEqual([]);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("atomically rejects an all-reject selection without entering Wiki apply", async () => {
    const harness = await createReviewedApplyHarness("missing");
    const context = await loadKnowledgeStudioReviewContext({
      runtime: harness.capabilities.runtime,
      bundle: harness.bundle,
      targetResolver: harness.resolver,
      changeSetId: harness.changeSetId,
      signal: new AbortController().signal,
      assertCurrent: () => undefined,
    });
    if (!context) throw new Error("Expected one pending Review context");
    const before = await harness.capabilities.runtime.readStudioBundle(BUNDLE_ID);
    const command = {
      changeSetId: context.plan.changeSetId,
      proposalDigest: context.plan.proposalDigest,
      expectedSnapshotToken: context.plan.snapshotToken,
      decisions: context.plan.files.map((file) => ({
        changeId: file.changeId,
        decision: "reject" as const,
      })),
    };

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "rejected" });

    const after = await harness.capabilities.runtime.readStudioBundle(BUNDLE_ID);
    expect(after.runtimeRevision).toBe(before.runtimeRevision + 1);
    expect(after.review).toMatchObject({
      revision: before.review.revision + 1,
      records: [
        {
          outcome: "rejected",
          changeSetId: harness.changeSetId,
          recordRevision: 1,
        },
      ],
    });
    expect(after.queue).toMatchObject({
      revision: before.queue.revision + 1,
      jobs: [{ id: "job-reviewed-apply", status: "cancelled", stage: "cancelled" }],
      pendingReviews: [],
      reviewRejections: [
        expect.objectContaining({
          jobId: "job-reviewed-apply",
          changeSetId: harness.changeSetId,
        }),
      ],
    });
    expect(harness.fileStore.compareAndSwapCalls).toBe(0);
    expect(harness.fileStore.files.size).toBe(0);
    expect(harness.refresh).not.toHaveBeenCalled();
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.capabilities.file.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toEqual([]);
  });

  it("keeps a fresh tracked delete reject-only and blocks an attempted acceptance", async () => {
    const proposal = createProposal([createDeleteChange()], "changeset-atlas-followup");
    const harness = await createFollowupReviewedApplyHarness(
      proposal,
      new Map([[TARGET_PATH, PAGE_CONTENT]])
    );
    const context = await loadKnowledgeStudioReviewContext({
      runtime: harness.capabilities.runtime,
      bundle: harness.bundle,
      targetResolver: harness.resolver,
      changeSetId: harness.changeSetId,
      signal: new AbortController().signal,
      assertCurrent: () => undefined,
    });
    if (!context) throw new Error("Expected one pending Review context");
    expect(context.plan.files).toEqual([
      expect.objectContaining({
        changeId: "change-atlas-followup",
        operation: "delete",
        integrity: "current",
        capability: "reject_only",
        blockedReason: "review_delete_read_set_not_journaled",
      }),
    ]);
    const command = {
      changeSetId: context.plan.changeSetId,
      proposalDigest: context.plan.proposalDigest,
      expectedSnapshotToken: context.plan.snapshotToken,
      decisions: [{ changeId: "change-atlas-followup", decision: "accept_exact" as const }],
    };

    const result = await harness.coordinator.submit(
      BUNDLE_ID,
      command,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      kind: "blocked",
      diagnostics: [expect.objectContaining({ code: "review_command_accept_blocked" })],
    });
    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(PAGE_CONTENT);
    expect(harness.fileStore.compareAndSwapCalls).toBe(0);
    expect(harness.refresh).not.toHaveBeenCalled();
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "pending",
      recordRevision: 0,
    });
    const queue = await harness.capabilities.queue.load(BUNDLE_ID);
    expect(queue.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job-reviewed-followup",
          status: "awaiting_review",
          stage: "review",
        }),
      ])
    );
    expect(queue.pendingReviews).toEqual([
      expect.objectContaining({ changeSetId: harness.changeSetId }),
    ]);
  });

  it("confirms an accepted Review whose durable write throws after commit", async () => {
    const harness = await createReviewedApplyHarness("missing");
    const command = await createAcceptCommand(harness);
    const writeReview = harness.capabilities.runtime.writeReview;
    let injected = false;
    const writeReviewSpy = jest
      .spyOn(harness.capabilities.runtime, "writeReview")
      .mockImplementation(async (bundleId, snapshot, expectedRevision) => {
        await writeReview.call(harness.capabilities.runtime, bundleId, snapshot, expectedRevision);
        if (!injected && snapshot.records.some((record) => record.outcome === "accepted")) {
          injected = true;
          throw new Error("ambiguous Review write");
        }
      });

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "applied" });

    expect(injected).toBe(true);
    expect(writeReviewSpy).toHaveBeenCalled();
    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(PAGE_CONTENT);
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "accepted",
      recordRevision: 1,
    });
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("replays the exact apply claim after beginReviewApply commits and then throws", async () => {
    const harness = await createReviewedApplyHarness("missing");
    const command = await createAcceptCommand(harness);
    const beginSpy = jest.spyOn(harness.capabilities.queue, "beginReviewApply");
    const writeQueue = harness.capabilities.runtime.writeQueue;
    let injected = false;
    jest
      .spyOn(harness.capabilities.runtime, "writeQueue")
      .mockImplementation(async (bundleId, snapshot, expectedRevision, authority) => {
        await writeQueue.call(
          harness.capabilities.runtime,
          bundleId,
          snapshot,
          expectedRevision,
          authority
        );
        if (
          !injected &&
          snapshot.jobs.some((job) => job.status === "processing" && job.stage === "applying")
        ) {
          injected = true;
          throw new Error("ambiguous Queue apply claim");
        }
      });

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "applied" });

    expect(injected).toBe(true);
    expect(beginSpy).toHaveBeenCalledTimes(2);
    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(PAGE_CONTENT);
    await expect(harness.capabilities.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-reviewed-apply", status: "completed", stage: "completed" }],
      pendingReviews: [],
    });
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("returns recovery_required after page commit when durable finalization fails", async () => {
    const harness = await createReviewedApplyHarness("missing");
    const command = await createAcceptCommand(harness);
    const resolveApply = jest
      .spyOn(harness.capabilities.queue, "resolveApplyRecovery")
      .mockRejectedValue(new Error("finalization unavailable"));

    await expect(
      harness.coordinator.submit(BUNDLE_ID, command, new AbortController().signal)
    ).resolves.toEqual({ kind: "recovery_required" });

    expect(resolveApply).toHaveBeenCalledTimes(1);
    expect(harness.fileStore.files.get(TARGET_PATH)).toBe(PAGE_CONTENT);
    expect(harness.fileStore.compareAndSwapCalls).toBe(1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "accepted",
    });
    await expect(harness.capabilities.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-reviewed-apply", status: "processing", stage: "applying" }],
      pendingReviews: [],
    });
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.capabilities.file.read()) as unknown
    );
    expect(runtime.activeTransaction).toMatchObject({
      bundleId: BUNDLE_ID,
      changeSetId: harness.changeSetId,
      phase: "committed",
    });
    expect(runtime.applyCommits).toHaveLength(1);
  });

  it("blocks an occupied create before durable acceptance or any Wiki mutation", async () => {
    const harness = await createReviewedApplyHarness("occupied");
    const command = await createAcceptCommand(harness);

    const result = await harness.coordinator.submit(
      BUNDLE_ID,
      command,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      kind: "blocked",
      diagnostics: [expect.objectContaining({ code: "review_command_accept_blocked" })],
    });
    expect(harness.fileStore.compareAndSwapCalls).toBe(0);
    expect(harness.fileStore.files.size).toBe(0);
    expect(harness.refresh).not.toHaveBeenCalled();
    await expect(harness.reviews.get(BUNDLE_ID, harness.changeSetId)).resolves.toMatchObject({
      outcome: "pending",
      recordRevision: 0,
    });
    await expect(harness.capabilities.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-reviewed-apply", status: "awaiting_review", stage: "review" }],
      pendingReviews: [expect.objectContaining({ changeSetId: harness.changeSetId })],
    });
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.capabilities.file.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toEqual([]);
  });
});
