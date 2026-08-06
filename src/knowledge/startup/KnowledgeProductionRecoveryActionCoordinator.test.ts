jest.mock("obsidian", () => {
  class FileSystemAdapter {
    /** Returns the fake Windows Vault root. */
    getBasePath(): string {
      return "C:\\KnowledgeVault";
    }

    /** Resolves one fake native path without filesystem access. */
    getFullPath(path: string): string {
      return `C:\\KnowledgeVault\\${path.replaceAll("/", "\\")}`;
    }
  }

  class TFile {
    /** Creates one fake loaded file. */
    constructor(public readonly path: string) {}
  }

  return { FileSystemAdapter, TFile };
});

jest.mock("@/knowledge/runtime/ObsidianKnowledgeFileStore", () => ({
  ObsidianKnowledgeFileStore: class {
    readonly mutationCapabilities = Object.freeze({
      create: true,
      update: true,
      delete: false,
      requiresExistingParentForCreate: false,
    });

    /** Captures the in-memory Vault edge used by coordinator tests. */
    constructor(
      private readonly vault: {
        adapter: {
          stat(path: string): Promise<{ type: string } | null>;
          read(path: string): Promise<string>;
        };
        create(path: string, content: string): Promise<unknown>;
        getAbstractFileByPath(path: string): unknown;
        process(file: unknown, transform: (current: string) => string): Promise<unknown>;
      }
    ) {}

    /** Observes one exact test Vault path. */
    async observe(path: string) {
      const stat = await this.vault.adapter.stat(path);
      if (stat === null) return { kind: "missing" as const };
      if (stat.type === "folder") return { kind: "directory" as const };
      return { kind: "file" as const, content: await this.vault.adapter.read(path) };
    }

    /** Applies one exact create or update against the in-memory Vault. */
    async compareAndSwap(
      path: string,
      before: { kind: string; content?: string },
      after: { kind: string; content?: string }
    ) {
      const current = await this.observe(path);
      const matchesBefore =
        (before.kind === "missing" && current.kind === "missing") ||
        (before.kind === "file" && current.kind === "file" && current.content === before.content);
      const matchesAfter =
        (after.kind === "missing" && current.kind === "missing") ||
        (after.kind === "file" && current.kind === "file" && current.content === after.content);
      if (matchesAfter) return { kind: "already_after" as const };
      if (!matchesBefore) return { kind: "conflict" as const, observation: current };
      if (after.kind !== "file" || typeof after.content !== "string") {
        return { kind: "conflict" as const, observation: current };
      }
      if (before.kind === "missing") {
        await this.vault.create(path, after.content);
      } else {
        const file = this.vault.getAbstractFileByPath(path);
        if (file === null) return { kind: "conflict" as const, observation: current };
        await this.vault.process(file, () => after.content as string);
      }
      return { kind: "applied" as const };
    }
  },
}));

import { FileSystemAdapter, TFile, type App, type Vault } from "obsidian";

import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { KnowledgeProductionPreflightSettingsInput } from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { KnowledgeSourceWorkflowPlanLoader } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import {
  IngestQueue,
  type IngestAcceptedReviewDecisionReceipt,
} from "@/knowledge/ingest/queue/IngestQueue";
import { ObsidianExactSourceArtifactReader } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  createManifestCommitPlan,
  createManifestCommitPlanDigest,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  NoJournalApplyRecoveryClassification,
  NoJournalApplyRecoverySnapshot,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import type { AcceptedChangeSetReviewRecord } from "@/knowledge/review/ReviewStorage";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  parseKnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgePluginProductionPreflightLifecycle,
  type KnowledgePluginProductionPreflightAdmission,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import { createKnowledgeProductionPipelineResources } from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import { KnowledgeProductionRecoveryActionCoordinator } from "@/knowledge/startup/KnowledgeProductionRecoveryActionCoordinator";
import { KnowledgeExecutionMemoryRuntimeFile } from "@/knowledge/testing/KnowledgeExecutionTestHarness";

const PROJECT_ID = "project-personal";
const MODEL_NAME = "deepseek-v4-pro";
const MODEL_KEY = `${MODEL_NAME}|deepseek`;
const BUNDLE_ID = "personal";
const SOURCE_ID = "source-atlas";
const SOURCE_PATH = "Sources/personal/Atlas.md";
const SCHEMA_PATH = "Schemas/personal.md";
const TARGET_PATH = "Wiki/personal/Atlas.md";
const SOURCE_TEXT = "Project Atlas launches on 2026-08-01.\n";
const SOURCE_BYTES = new TextEncoder().encode(SOURCE_TEXT);
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_BYTES);
const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
const AFTER_CONTENT = `---
type: topic
title: Project Atlas
tags: [project]
confidence: 0.9
---

# Project Atlas

Project Atlas launches on 2026-08-01.
`;
const originalRandomUuidDescriptor = Object.getOwnPropertyDescriptor(window.crypto, "randomUUID");
let transactionSequence = 0;

/** Creates one mocked loaded file despite Obsidian's opaque public constructor. */
function createTestFile(path: string): TFile {
  const FileConstructor = TFile as unknown as new (filePath: string) => TFile;
  return new FileConstructor(path);
}

/** In-memory App/Vault edge supporting exact reads and atomic existing-file updates. */
class RecoveryVaultHarness {
  readonly files = new Map<string, string>();
  readonly loaded = new Map<string, TFile>();
  readonly readBinary = jest.fn(async (path: string): Promise<ArrayBuffer> => {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("Missing exact source bytes");
    return new Uint8Array(new TextEncoder().encode(content)).buffer;
  });
  readonly read = jest.fn(async (path: string): Promise<string> => {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("Missing exact Vault text");
    return content;
  });
  readonly stat = jest.fn(async (path: string) => {
    const content = this.files.get(path);
    return content === undefined
      ? null
      : { type: "file" as const, ctime: 1, mtime: 1, size: content.length };
  });
  readonly process = jest.fn(
    async (file: TFile, transform: (current: string) => string): Promise<string> => {
      const current = this.files.get(file.path);
      if (current === undefined) throw new Error("Missing process target");
      const next = transform(current);
      this.files.set(file.path, next);
      return next;
    }
  );
  readonly create = jest.fn(async (path: string, content: string): Promise<TFile> => {
    if (this.files.has(path)) throw new Error("Create target already exists");
    const file = createTestFile(path);
    this.files.set(path, content);
    this.loaded.set(path, file);
    return file;
  });
  readonly adapter = Object.assign(new FileSystemAdapter(), {
    readBinary: this.readBinary,
    read: this.read,
    stat: this.stat,
  });
  readonly vault = {
    adapter: this.adapter,
    getAbstractFileByPath: jest.fn((path: string) => this.loaded.get(path) ?? null),
    create: this.create,
    process: this.process,
  } as unknown as Vault;

  /** Creates one App identity permanently bound to this Vault. */
  createApp(): App {
    return { vault: this.vault } as App;
  }

  /** Adds one loaded exact text file. */
  add(path: string, content: string): void {
    this.files.set(path, content);
    this.loaded.set(path, createTestFile(path));
  }

  /** Clears all observable Vault access counters without changing bytes. */
  clearCalls(): void {
    this.readBinary.mockClear();
    this.read.mockClear();
    this.stat.mockClear();
    this.create.mockClear();
    this.process.mockClear();
  }
}

/** Creates the configured Bundle used by the authentic production lease. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: BUNDLE_ID,
    sourceRoots: ["Sources/personal"],
    wikiRoot: "Wiki/personal",
    schemaRef: SCHEMA_PATH,
    reviewMode: "always",
  };
}

/** Creates already-hydrated settings with inert test-only credentials. */
function createSettings(): KnowledgeProductionPreflightSettingsInput {
  return {
    temperature: 0,
    maxTokens: 8_192,
    reasoningEffort: "high",
    verbosity: "medium",
    activeModels: [
      {
        name: MODEL_NAME,
        provider: "deepseek",
        enabled: true,
        projectEnabled: true,
        temperature: 0,
        reasoningEffort: "high",
        apiKey: "test-only-model-credential",
      },
    ],
    deepseekApiKey: "test-only-provider-credential",
  };
}

/** Creates a model fetch port that fails if recovery attempts model access. */
function createFetchPort(): jest.MockedFunction<KnowledgeDeepSeekFetchPort> {
  return jest.fn<ReturnType<KnowledgeDeepSeekFetchPort>, Parameters<KnowledgeDeepSeekFetchPort>>(
    async () => {
      throw new Error("Recovery must not invoke the model route");
    }
  );
}

/** Mints one authentic production workflow lease. */
async function createAdmission(fetchPort: KnowledgeDeepSeekFetchPort): Promise<{
  lifecycle: KnowledgePluginProductionPreflightLifecycle;
  admission: KnowledgePluginProductionPreflightAdmission;
}> {
  const lifecycle = new KnowledgePluginProductionPreflightLifecycle({
    getProjectRecords: () => [
      {
        project: {
          id: PROJECT_ID,
          knowledgeBundle: createBundle(),
          projectModelKey: MODEL_KEY,
          modelConfigs: {},
        },
      },
    ],
    getSettings: () => createSettings(),
    fetchPort,
    createResources: () => createKnowledgeProductionPipelineResources(),
  });
  const result = await lifecycle.load(new AbortController().signal);
  if (result.kind !== "configured") throw new Error("Expected configured production preflight");
  return { lifecycle, admission: result.admission };
}

/** Creates the clean registered-source Manifest read-set. */
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

/** Creates one grounded create proposal accepted before recovery testing. */
function createProposal(): KnowledgeChangeSet {
  return {
    id: "changeset-atlas-recovery",
    bundleId: BUNDLE_ID,
    operation: "ingest",
    sourceRefs: [SOURCE_ID],
    changes: [
      {
        id: "change-atlas-update",
        operation: "create",
        path: TARGET_PATH,
        sourceRefs: [SOURCE_ID],
        reason: "Create the grounded Atlas launch date",
        expectedAbsent: true,
        afterContent: AFTER_CONTENT,
        afterHash: createFileContentHash(AFTER_CONTENT),
      },
    ],
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
          excerpt: SOURCE_TEXT.trim(),
          quoteHash: createQuoteHash(SOURCE_TEXT.trim()),
        },
      },
    ],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Converts one accepted record into the Queue's exact apply receipt. */
function createAcceptedReceipt(
  record: AcceptedChangeSetReviewRecord
): IngestAcceptedReviewDecisionReceipt {
  return {
    outcome: "accepted",
    bundleId: BUNDLE_ID,
    changeSetId: record.changeSetId,
    proposalDigest: record.proposalDigest,
    recordRevision: record.recordRevision,
    acceptedDigest: record.acceptedDigest,
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
    acceptedAt: record.acceptedAt,
    jobClaim: { ...record.jobClaim },
  };
}

/** Loads the current exact recovery snapshot from one Runtime envelope. */
async function loadRecoverySnapshot(
  runtime: KnowledgeRuntimeStore
): Promise<NoJournalApplyRecoverySnapshot> {
  const studio = await runtime.readStudioBundle(BUNDLE_ID);
  const loaded = await new KnowledgeRuntimeNoJournalApplyRecoveryPort(runtime).loadSnapshot(
    BUNDLE_ID,
    studio.review.revision
  );
  if (loaded.kind !== "loaded") throw new Error("Expected one exact recovery snapshot");
  return loaded.snapshot;
}

interface RecoveryActionHarness {
  lifecycle: KnowledgePluginProductionPreflightLifecycle;
  runtimeFile: KnowledgeExecutionMemoryRuntimeFile;
  runtime: KnowledgeRuntimeStore;
  queue: IngestQueue;
  vault: RecoveryVaultHarness;
  fetchPort: jest.MockedFunction<KnowledgeDeepSeekFetchPort>;
  refresh: jest.Mock<void, []>;
  coordinator: KnowledgeProductionRecoveryActionCoordinator;
  accepted: AcceptedChangeSetReviewRecord;
  snapshot: NoJournalApplyRecoverySnapshot;
  classification: NoJournalApplyRecoveryClassification;
}

/** Seeds an accepted-not-started or requires-decision production recovery state. */
async function createHarness(startApply: boolean): Promise<RecoveryActionHarness> {
  const fetchPort = createFetchPort();
  const { lifecycle, admission } = await createAdmission(fetchPort);
  const vault = new RecoveryVaultHarness();
  vault.add(SCHEMA_PATH, "# Knowledge schema\n");
  vault.add(SOURCE_PATH, SOURCE_TEXT);
  const app = vault.createApp();
  const runtimeFile = new KnowledgeExecutionMemoryRuntimeFile();
  const runtime = new KnowledgeRuntimeStore(runtimeFile);
  await runtime.initialize();
  const manifest = createManifest();
  await new KnowledgeRuntimeManifestStorage(runtime).write(BUNDLE_ID, manifest, null);

  const executionOwner = createKnowledgeExecutionOwner();
  const manifestRepository = new SourceManifestRepository(
    new KnowledgeRuntimeManifestStorage(runtime)
  );
  const plan = await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest: manifestRepository,
    artifactReader: new ObsidianExactSourceArtifactReader(app),
    pipelineProfile: admission.workflowLease,
    parsers: admission.workflowLease.getParsers(),
    generation: { isCurrent: () => admission.workflowLease.isCurrent() },
  }).load(admission.workflowLease.getOwners(), new AbortController().signal);
  const source = plan.getWatchPlan().getSource(BUNDLE_ID, SOURCE_ID);
  if (!source) throw new Error("Expected one planned recovery source");

  const revisions = new KnowledgeRuntimeInputRevisionAllocator(runtime);
  const observations = new KnowledgeRuntimeInputObservationBinder(runtime);
  const allocation = await revisions.allocate({
    bundleId: BUNDLE_ID,
    sourceId: SOURCE_ID,
    captureId: "capture-recovery-atlas",
  });
  const binding = await observations.bind({
    observationToken: allocation.observationToken,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
  });
  if (binding.kind !== "ready") throw new Error("Expected Queue-ready source observation");

  const proposal = createProposal();
  const manifestCommitPlan = createManifestCommitPlan({
    bundle: createBundle(),
    manifest,
    sourceId: SOURCE_ID,
    sourceContentHash: SOURCE_CONTENT_HASH,
    pipelineFingerprint: source.pipelineFingerprint,
    inputRevision: binding.observation.inputRevision,
    changeSet: proposal,
    mutations: [
      {
        changeId: proposal.changes[0].id,
        path: TARGET_PATH,
        operation: "create",
        access: "create_only",
        ownership: "generated",
        wasTrackedByPrimarySource: false,
      },
    ],
  });
  const reviews = new ChangeSetReviewRepository(
    new KnowledgeRuntimeReviewStorage(runtime, executionOwner),
    { clock: () => 110 }
  );
  let queue!: IngestQueue;
  queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(runtime, executionOwner),
    {
      /** Saves one proposal before returning its exact pending Review receipt. */
      async execute(context) {
        const record = await reviews.saveProposal(BUNDLE_ID, {
          proposal,
          proposalDigest: createKnowledgeChangeSetDigest(proposal),
          manifestCommitPlan,
          manifestCommitPlanDigest: createManifestCommitPlanDigest(manifestCommitPlan),
          jobClaim: {
            jobId: context.job.id,
            sourceId: context.job.sourceId,
            sourceContentHash: context.job.sourceContentHash,
            pipelineFingerprint: context.job.pipelineFingerprint,
            inputRevision: context.job.inputRevision,
            attempt: context.job.attempt,
          },
        });
        if (record.outcome !== "pending") throw new Error("Expected pending Review record");
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
    },
    { clock: () => 100, jobIdFactory: () => "job-atlas-recovery" }
  );
  await queue.enqueue(binding.observation);
  await queue.runNext(BUNDLE_ID);
  const pending = await reviews.get(BUNDLE_ID, proposal.id);
  if (pending?.outcome !== "pending") throw new Error("Expected pending Review before acceptance");
  const accepted = await reviews.accept(
    BUNDLE_ID,
    pending.changeSetId,
    pending.recordRevision,
    pending.proposalDigest,
    { ...pending.proposal, status: "accepted" }
  );
  if (accepted.outcome !== "accepted") throw new Error("Expected accepted Review record");
  if (startApply) await queue.beginReviewApply(BUNDLE_ID, createAcceptedReceipt(accepted));
  await queue.recoverOnStartup(BUNDLE_ID);

  const snapshot = await loadRecoverySnapshot(runtime);
  const classification = snapshot.classifications[0];
  if (!classification) throw new Error("Expected one accepted recovery classification");
  const refresh = jest.fn<void, []>();
  const coordinator = new KnowledgeProductionRecoveryActionCoordinator({
    app,
    runtime,
    workflowLease: admission.workflowLease,
    assertCurrent: () => undefined,
    onGenerationRefreshRequired: refresh,
  });
  return {
    lifecycle,
    runtimeFile,
    runtime,
    queue,
    vault,
    fetchPort,
    refresh,
    coordinator,
    accepted,
    snapshot,
    classification,
  };
}

/** Returns the opaque id shared by every recovery classification variant. */
function getRecoveryId(classification: NoJournalApplyRecoveryClassification): string {
  return classification.kind === "requires_decision"
    ? classification.candidate.recoveryId
    : classification.reference.recoveryId;
}

describe("KnowledgeProductionRecoveryActionCoordinator", () => {
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

  it("continues accepted_not_started through apply claim, Wiki update, and exact finalization", async () => {
    const harness = await createHarness(false);
    expect(harness.classification.kind).toBe("accepted_not_started");

    await expect(
      harness.coordinator.continue(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "completed" });

    expect(harness.vault.files.get(TARGET_PATH)).toBe(AFTER_CONTENT);
    expect(harness.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.fetchPort).not.toHaveBeenCalled();
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    await expect(harness.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-atlas-recovery", status: "completed", stage: "completed" }],
      pendingReviews: [],
      control: { status: "paused", reason: "startup_recovery" },
    });
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.runtimeFile.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toHaveLength(1);
    harness.lifecycle.close();
  });

  it("replays an exact accepted_not_started apply claim after commit-then-throw", async () => {
    const harness = await createHarness(false);
    const writeQueue = harness.runtime.writeQueue;
    let injected = false;
    jest
      .spyOn(harness.runtime, "writeQueue")
      .mockImplementation(async (bundleId, snapshot, expectedRevision, authority) => {
        await writeQueue.call(harness.runtime, bundleId, snapshot, expectedRevision, authority);
        if (
          !injected &&
          snapshot.jobs.some((job) => job.status === "processing" && job.stage === "applying")
        ) {
          injected = true;
          throw new Error("ambiguous apply claim write");
        }
      });

    await expect(
      harness.coordinator.continue(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "completed" });

    expect(injected).toBe(true);
    expect(harness.vault.files.get(TARGET_PATH)).toBe(AFTER_CONTENT);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    harness.lifecycle.close();
  });

  it("continues an existing requires_decision claim without starting another apply", async () => {
    const harness = await createHarness(true);
    expect(harness.classification.kind).toBe("requires_decision");

    await expect(
      harness.coordinator.continue(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "completed" });

    expect(harness.vault.files.get(TARGET_PATH)).toBe(AFTER_CONTENT);
    expect(harness.fetchPort).not.toHaveBeenCalled();
    await expect(harness.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-atlas-recovery", status: "completed", stage: "completed" }],
    });
    harness.lifecycle.close();
  });

  it("abandons only requires_decision through Runtime with zero Vault or model access", async () => {
    const harness = await createHarness(true);
    harness.vault.clearCalls();

    await expect(
      harness.coordinator.abandon(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "completed" });

    expect(harness.vault.files.has(TARGET_PATH)).toBe(false);
    expect(harness.vault.readBinary).not.toHaveBeenCalled();
    expect(harness.vault.read).not.toHaveBeenCalled();
    expect(harness.vault.stat).not.toHaveBeenCalled();
    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(harness.vault.process).not.toHaveBeenCalled();
    expect(harness.fetchPort).not.toHaveBeenCalled();
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    await expect(harness.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-atlas-recovery", status: "cancelled", stage: "cancelled" }],
      applyAbandonments: [expect.objectContaining({ changeSetId: harness.accepted.changeSetId })],
    });
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.runtimeFile.read()) as unknown
    );
    expect(runtime.activeTransaction).toBeNull();
    expect(runtime.applyCommits).toEqual([]);
    harness.lifecycle.close();
  });

  it("confirms one exact abandonment after its Runtime commit throws ambiguously", async () => {
    const harness = await createHarness(true);
    harness.vault.clearCalls();
    const abandon = harness.runtime.abandonNoJournalApply.bind(
      harness.runtime
    ) as KnowledgeRuntimeStore["abandonNoJournalApply"];
    let injected = false;
    jest
      .spyOn(harness.runtime, "abandonNoJournalApply")
      .mockImplementation(async (reference, requestedAt) => {
        const receipt = await abandon(reference, requestedAt);
        if (!injected) {
          injected = true;
          throw new Error("ambiguous abandonment commit");
        }
        return receipt;
      });

    await expect(
      harness.coordinator.abandon(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "completed" });

    expect(injected).toBe(true);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    await expect(harness.queue.load(BUNDLE_ID)).resolves.toMatchObject({
      jobs: [{ id: "job-atlas-recovery", status: "cancelled", stage: "cancelled" }],
      applyAbandonments: [expect.objectContaining({ changeSetId: harness.accepted.changeSetId })],
    });
    expect(harness.vault.readBinary).not.toHaveBeenCalled();
    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(harness.fetchPort).not.toHaveBeenCalled();
    harness.lifecycle.close();
  });

  it("fails stale or non-actionable commands closed before plan or Vault access", async () => {
    const harness = await createHarness(false);
    harness.vault.clearCalls();

    await expect(
      harness.coordinator.continue(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision - 1,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      harness.coordinator.abandon(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "blocked" });

    expect(harness.vault.readBinary).not.toHaveBeenCalled();
    expect(harness.vault.read).not.toHaveBeenCalled();
    expect(harness.vault.stat).not.toHaveBeenCalled();
    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(harness.vault.process).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
    harness.lifecycle.close();
  });

  it("returns recovery_required and refreshes after a committed Wiki update cannot finalize", async () => {
    const harness = await createHarness(true);
    jest
      .spyOn(harness.runtime, "recordApplyCommit")
      .mockRejectedValue(new Error("commit unavailable"));

    await expect(
      harness.coordinator.continue(
        BUNDLE_ID,
        getRecoveryId(harness.classification),
        harness.snapshot.runtimeRevision,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "recovery_required" });

    expect(harness.vault.files.get(TARGET_PATH)).toBe(AFTER_CONTENT);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    const runtime = parseKnowledgeRuntimeStoreSnapshot(
      JSON.parse(await harness.runtimeFile.read()) as unknown
    );
    expect(runtime.activeTransaction).toMatchObject({ phase: "committed" });
    harness.lifecycle.close();
  });
});
