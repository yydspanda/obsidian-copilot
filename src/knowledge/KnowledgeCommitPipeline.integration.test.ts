import {
  ChangeSetTransaction,
  createTransactionCommitReceiptDigest,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ALL_KNOWLEDGE_FILE_MUTATIONS,
  ChangeSetValidator,
  type KnowledgeFileCompareAndSwapResult,
  type KnowledgeFileObservation,
  type KnowledgeFileStore,
  type KnowledgeProjectionValidationInput,
  type SourceArtifactResolver,
} from "@/knowledge/changeset/ChangeSetValidator";
import {
  createChangeSetTransactionJournalDigest,
  type ChangeSetTransactionJournal,
  type TransactionFileState,
  type TransactionJobClaim,
} from "@/knowledge/changeset/TransactionStorage";
import type {
  CompilerAnalysisRequest,
  CompilerCandidateValidationInput,
  CompilerCandidateValidator,
  CompilerGenerationRequest,
  CompilerModelPort,
  CompilerTargetRequest,
  CompilerTargetResolver,
  KnowledgeCompileInput,
  KnowledgeCompileProposal,
  KnowledgeCompileResult,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import { IngestQueue, type IngestExecutor } from "@/knowledge/ingest/queue/IngestQueue";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { TextArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceLocator,
  SourceManifest,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { NoJournalApplyRecoveryCoordinator } from "@/knowledge/recovery/NoJournalApplyRecovery";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeTransactionStorage,
  parseKnowledgeRuntimeStoreSnapshot,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const SOURCE_TEXT = "A durable knowledge compiler should preserve reviewed provenance.";
const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_TEXT);
const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
const PIPELINE_FINGERPRINT = "b".repeat(64);
const REWRITTEN_CONTENT =
  "---\ntype: concept\n---\n\n# Reviewed knowledge\n\nThe reviewer retained this claim.\n";

/** In-memory atomic plaintext file shared by every real runtime facade in this test. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  private tail: Promise<void> = Promise.resolve();

  /** Creates the runtime file only when it does not yet exist. */
  async initialize(initialContent: string): Promise<void> {
    if (this.content === undefined) {
      this.content = initialContent;
    }
  }

  /** Reads the exact durable plaintext bytes. */
  async read(): Promise<string> {
    if (this.content === undefined) {
      throw new Error("Memory runtime file is not initialized");
    }
    return this.content;
  }

  /** Serializes and durably commits one synchronous plaintext transformation. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.content === undefined) {
        throw new Error("Memory runtime file is not initialized");
      }
      this.content = transform(this.content);
      return this.content;
    } finally {
      release();
    }
  }
}

/** Exact in-memory Wiki file store used by the real transaction validator and runtime. */
class MemoryKnowledgeFileStore implements KnowledgeFileStore {
  readonly mutationCapabilities = ALL_KNOWLEDGE_FILE_MUTATIONS;
  readonly files = new Map<string, string>();

  /** Observes one exact Wiki path. */
  async observe(path: string): Promise<KnowledgeFileObservation> {
    const content = this.files.get(path);
    return content === undefined ? { kind: "missing" } : { kind: "file", content };
  }

  /** Atomically compares and replaces one exact Wiki path state. */
  async compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    const current = await this.observe(path);
    if (this.matches(current, after)) {
      return { kind: "already_after" };
    }
    if (!this.matches(current, before)) {
      return { kind: "conflict", observation: current };
    }
    if (after.kind === "missing") {
      this.files.delete(path);
    } else {
      this.files.set(path, after.content);
    }
    return { kind: "applied" };
  }

  /** Compares an observed Wiki path with one content-addressed journal state. */
  private matches(observation: KnowledgeFileObservation, state: TransactionFileState): boolean {
    if (state.kind === "missing") {
      return observation.kind === "missing";
    }
    return (
      observation.kind === "file" &&
      observation.content === state.content &&
      createFileContentHash(observation.content) === state.contentHash
    );
  }
}

/** Deterministic two-stage model that proposes two new Wiki pages. */
class DeterministicCompilerModel implements CompilerModelPort {
  /** Returns one grounded claim and two caller-resolvable write targets. */
  async analyze(_request: CompilerAnalysisRequest, _signal: AbortSignal): Promise<unknown> {
    return {
      version: 1,
      summary: "Compile one durable knowledge claim",
      concepts: [{ ref: "concept-durability", name: "Durable knowledge" }],
      entities: [],
      claims: [{ ref: "claim-durability", text: SOURCE_TEXT }],
      relations: [],
      citations: [
        {
          claimRef: "claim-durability",
          evidenceId: "evidence-source",
          relation: "supports",
        },
      ],
      targets: [
        {
          ref: "target-primary",
          path: "Wiki/Primary.md",
          intent: "write",
          reason: "Compile the reviewed claim",
          claimRefs: ["claim-durability"],
        },
        {
          ref: "target-filtered",
          path: "Wiki/Filtered.md",
          intent: "write",
          reason: "Compile an optional view of the claim",
          claimRefs: ["claim-durability"],
        },
      ],
    };
  }

  /** Generates deterministic content for every compiler-approved writable target. */
  async generate(request: CompilerGenerationRequest, _signal: AbortSignal): Promise<unknown> {
    return {
      version: 1,
      targetSetDigest: request.targetSetDigest,
      files: request.targets.map((target) => ({
        targetId: target.targetId,
        outcome: "write",
        afterContent: `---\ntype: concept\n---\n\n# ${target.path}\n`,
      })),
    };
  }
}

/** Read-only target resolver that proves every proposed page is absent. */
class MissingCompilerTargetResolver implements CompilerTargetResolver {
  /** Returns one exact Windows-key absence proof per compiler target. */
  async resolve(targets: readonly CompilerTargetRequest[], _signal: AbortSignal): Promise<unknown> {
    return targets.map((target) => ({
      targetId: target.targetId,
      kind: "missing",
      windowsPathKey: toWindowsPathKey(target.path),
    }));
  }
}

/** Deterministic compiler candidate validator that affirms the generated projection. */
class AffirmativeCompilerCandidateValidator implements CompilerCandidateValidator {
  /** Returns affirmative OKF, citation, and link validation flags. */
  async validate(_input: CompilerCandidateValidationInput, _signal: AbortSignal): Promise<unknown> {
    return {
      validation: { okfValid: true, citationsValid: true, linksValid: true },
      diagnostics: [],
    };
  }
}

/** Exact parser artifact resolver used to re-prove the accepted citation at apply time. */
class ExactArtifactResolver implements SourceArtifactResolver {
  /** Creates a resolver for one parser-owned text artifact. */
  constructor(private readonly artifact: TextArtifactObservation) {}

  /** Returns the artifact only for its exact source, artifact, and content identity. */
  async resolve(locator: SourceLocator): Promise<TextArtifactObservation | null> {
    return locator.sourceId === this.artifact.sourceId &&
      locator.artifactId === this.artifact.artifactId &&
      locator.artifactContentHash === this.artifact.artifactContentHash
      ? this.artifact
      : null;
  }
}

/** Creates the Windows-first knowledge Bundle exercised by the complete pipeline. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Config/knowledge-schema.md",
    reviewMode: "always",
  };
}

/** Creates the initially registered source Manifest stored before compilation. */
function createInitialManifest(bundleId: string): SourceManifest {
  return {
    version: 1,
    bundleId,
    revision: 1,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/source-1.md",
        sourcePath: "Sources/source-1.md",
        custody: "user_managed",
      },
    ],
  };
}

/** Creates the exact compiler input bound to the current complete Manifest read-set. */
function createCompileInput(
  bundle: KnowledgeBundleConfig,
  manifest: SourceManifest
): KnowledgeCompileInput {
  return {
    bundle,
    operation: "ingest",
    source: {
      sourceId: "source-1",
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    manifest,
    schema: {
      path: bundle.schemaRef,
      content: "type: knowledge-schema\n",
      contentHash: createFileContentHash("type: knowledge-schema\n"),
    },
    artifacts: [
      {
        kind: "text",
        sourceId: "source-1",
        artifactId: "artifact-source",
        artifactContentHash: ARTIFACT_CONTENT_HASH,
        text: SOURCE_TEXT,
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-source",
        locator: {
          kind: "quote",
          sourceId: "source-1",
          artifactId: "artifact-source",
          artifactContentHash: ARTIFACT_CONTENT_HASH,
          excerpt: SOURCE_TEXT,
          quoteHash: createQuoteHash(SOURCE_TEXT),
        },
      },
    ],
    contextPages: [],
    targetAuthorizations: [],
    createdAt: 1_000,
  };
}

/** Requires a successful compiler proposal and narrows its result type. */
function requireProposal(result: KnowledgeCompileResult): KnowledgeCompileProposal {
  if (result.kind !== "proposed") {
    throw new Error(`Expected compiler proposal, received '${result.kind}'`);
  }
  return result;
}

/** Creates a filtered and content-rewritten accepted ChangeSet in proposal order. */
function createReviewedChangeSet(proposal: KnowledgeChangeSet): KnowledgeChangeSet {
  const retained = proposal.changes[0];
  if (!retained || retained.operation !== "create") {
    throw new Error("Expected the first compiler proposal target to be a create");
  }
  const rewritten: KnowledgeFileChange = {
    ...retained,
    afterContent: REWRITTEN_CONTENT,
    afterHash: createFileContentHash(REWRITTEN_CONTENT),
  };
  return {
    ...proposal,
    changes: [rewritten],
    status: "accepted",
  };
}

/** Creates the real apply-time validator over the in-memory Wiki file store. */
function createApplyValidator(fileStore: KnowledgeFileStore): ChangeSetValidator {
  const artifact: TextArtifactObservation = {
    kind: "text",
    sourceId: "source-1",
    artifactId: "artifact-source",
    artifactContentHash: ARTIFACT_CONTENT_HASH,
    text: SOURCE_TEXT,
  };
  return new ChangeSetValidator(fileStore, new ExactArtifactResolver(artifact), {
    /** Recomputes the projected OKF and link flags for the integration boundary. */
    async validate(_input: KnowledgeProjectionValidationInput) {
      return { okfValid: true, linksValid: true, diagnostics: [] };
    },
  });
}

/** Requires a committed active transaction journal. */
function requireCommittedJournal(
  journal: ChangeSetTransactionJournal | null
): ChangeSetTransactionJournal & { phase: "committed" } {
  if (!journal || journal.phase !== "committed") {
    throw new Error("Expected one committed active transaction journal");
  }
  return journal;
}

/** Strictly parses one Source Manifest returned through an unknown storage boundary. */
function requireManifest(value: unknown): SourceManifest {
  const parsed = parseSourceManifest(value);
  if (!parsed.ok) {
    throw new Error("Expected a strict Source Manifest");
  }
  return parsed.value;
}

/** Parses the exact in-memory runtime plaintext into its strict outer envelope. */
async function readRuntimeSnapshot(
  file: MemoryAtomicRuntimeFile
): Promise<KnowledgeRuntimeStoreSnapshot> {
  return parseKnowledgeRuntimeStoreSnapshot(JSON.parse(await file.read()) as unknown);
}

describe("durable knowledge commit pipeline", () => {
  it("carries reviewed compiler intent into one atomic Manifest and ledger commit", async () => {
    const atomicFile = new MemoryAtomicRuntimeFile();
    const runtime = new KnowledgeRuntimeStore(atomicFile);
    await runtime.initialize();
    const manifestStorage = new KnowledgeRuntimeManifestStorage(runtime);
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    const reviewStorage = new KnowledgeRuntimeReviewStorage(runtime);
    const transactionStorage = new KnowledgeRuntimeTransactionStorage(runtime);
    const applyCommitPort = new KnowledgeRuntimeApplyCommitManifestPort(runtime);
    const inputRevisions = new KnowledgeRuntimeInputRevisionAllocator(runtime);
    const bundle = createBundle();
    const initialManifest = createInitialManifest(bundle.id);
    await manifestStorage.write(bundle.id, initialManifest, null);
    await expect(
      inputRevisions.allocate({ bundleId: bundle.id, sourceId: "source-1" })
    ).resolves.toEqual({ inputRevision: 1 });

    const compiler = new KnowledgeCompiler({
      model: new DeterministicCompilerModel(),
      targetResolver: new MissingCompilerTargetResolver(),
      candidateValidator: new AffirmativeCompilerCandidateValidator(),
    });
    const proposal = requireProposal(
      await compiler.compile(
        createCompileInput(bundle, initialManifest),
        new AbortController().signal
      )
    );
    expect(proposal.changeSet.changes).toHaveLength(2);
    expect(proposal.manifestCommitPlan).toMatchObject({
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      expectedManifestRevision: initialManifest.revision,
      expectedManifestDigest: createSourceManifestDigest(initialManifest),
    });

    let reviewTime = 1_100;
    const reviews = new ChangeSetReviewRepository(reviewStorage, {
      clock: () => reviewTime++,
    });
    const pending = await reviews.saveProposal(bundle.id, {
      proposal: proposal.changeSet,
      proposalDigest: proposal.proposalDigest,
      manifestCommitPlan: proposal.manifestCommitPlan,
      manifestCommitPlanDigest: proposal.manifestCommitPlanDigest,
      jobClaim: {
        jobId: "job-1",
        sourceId: "source-1",
        sourceContentHash: SOURCE_CONTENT_HASH,
        pipelineFingerprint: PIPELINE_FINGERPRINT,
        inputRevision: 1,
        attempt: 1,
      },
    });
    const acceptedChangeSet = createReviewedChangeSet(proposal.changeSet);
    const filteredPath = proposal.changeSet.changes[1]?.path;
    const accepted = await reviews.accept(
      bundle.id,
      pending.changeSetId,
      pending.recordRevision,
      pending.proposalDigest,
      acceptedChangeSet
    );
    expect(accepted.manifestCommitIntent).toMatchObject({
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      generatedPages: [
        {
          path: acceptedChangeSet.changes[0]?.path,
          ownership: "generated",
          contentHash: createFileContentHash(REWRITTEN_CONTENT),
        },
      ],
    });
    expect(accepted.manifestCommitIntent.manifestCommitPlanDigest).toBe(
      proposal.manifestCommitPlanDigest
    );

    let queueTime = 1_050;
    const queueExecutor: IngestExecutor = {
      /** Hands the already-durable pending Review record to the Queue claim. */
      async execute(context) {
        return {
          kind: "awaiting_review",
          changeSetId: pending.changeSetId,
          reviewDecision: {
            outcome: "pending",
            bundleId: bundle.id,
            changeSetId: pending.changeSetId,
            proposalDigest: pending.proposalDigest,
            recordRevision: 0,
            recordedAt: pending.recordedAt,
            jobClaim: {
              jobId: context.job.id,
              sourceId: context.job.sourceId,
              sourceContentHash: context.job.sourceContentHash,
              pipelineFingerprint: context.job.pipelineFingerprint,
              inputRevision: context.job.inputRevision,
              attempt: context.job.attempt,
            },
          },
        };
      },
    };
    const queue = new IngestQueue(queueStorage, queueExecutor, {
      clock: () => queueTime++,
      jobIdFactory: () => "job-1",
    });
    await queue.enqueue({
      bundleId: bundle.id,
      sourceId: "source-1",
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    });
    await expect(queue.runNext(bundle.id)).resolves.toMatchObject({
      kind: "executed",
      status: "awaiting_review",
      jobId: "job-1",
    });
    const applyingJob = await queue.beginReviewApply(bundle.id, {
      outcome: "accepted",
      bundleId: bundle.id,
      changeSetId: accepted.changeSetId,
      proposalDigest: accepted.proposalDigest,
      recordRevision: accepted.recordRevision,
      acceptedDigest: accepted.acceptedDigest,
      manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
      acceptedAt: accepted.acceptedAt,
      jobClaim: { ...accepted.jobClaim },
    });
    expect(applyingJob).toMatchObject({ status: "processing", stage: "applying" });
    await expect(queue.recoverOnStartup(bundle.id)).resolves.toMatchObject({
      control: { status: "paused", reason: "recovery_required" },
      jobs: [expect.objectContaining({ id: applyingJob.id, status: "failed", stage: "applying" })],
    });

    const wikiFiles = new MemoryKnowledgeFileStore();
    let transactionTime = 1_300;
    const transaction = new ChangeSetTransaction({
      storage: transactionStorage,
      fileStore: wikiFiles,
      validator: createApplyValidator(wikiFiles),
      authority: new KnowledgeRuntimeApplyAuthorityPort(runtime),
      now: () => transactionTime++,
      createTransactionId: () => "transaction-compiler-review-1",
    });
    const startupIdentity: AcceptedReviewStartupIdentity = {
      bundleId: bundle.id,
      changeSetId: accepted.changeSetId,
      proposalDigest: accepted.proposalDigest,
      recordRevision: accepted.recordRevision,
      recordedAt: accepted.recordedAt,
      acceptedDigest: accepted.acceptedDigest,
      manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
      acceptedAt: accepted.acceptedAt,
      jobClaim: { ...accepted.jobClaim },
    };
    const noJournalRecovery = new NoJournalApplyRecoveryCoordinator({
      state: new KnowledgeRuntimeNoJournalApplyRecoveryPort(runtime),
      transaction,
      now: () => transactionTime++,
    });
    const recoveryState = await noJournalRecovery.classify(startupIdentity);
    if (recoveryState.kind !== "requires_decision") {
      throw new Error(`Expected no-journal recovery, received '${recoveryState.kind}'`);
    }
    const jobClaim: TransactionJobClaim = {
      jobId: applyingJob.id,
      attempt: applyingJob.attempt,
      startedAt: applyingJob.startedAt,
      sourceId: applyingJob.sourceId,
      sourceContentHash: applyingJob.sourceContentHash,
      pipelineFingerprint: applyingJob.pipelineFingerprint,
      inputRevision: applyingJob.inputRevision,
    };
    const receipt: TransactionCommitReceipt = await noJournalRecovery.continue(
      recoveryState.candidate,
      bundle
    );
    const committedJournal = requireCommittedJournal(await transaction.loadActive());
    expect(wikiFiles.files.get(acceptedChangeSet.changes[0]?.path ?? "")).toBe(REWRITTEN_CONTENT);
    expect(filteredPath).toBeDefined();
    expect(wikiFiles.files.has(filteredPath ?? "")).toBe(false);

    await applyCommitPort.recordCommitted(committedJournal, receipt);

    const committedManifest = requireManifest(await manifestStorage.read(bundle.id));
    const committedSource = committedManifest.entries.find(
      (entry) => entry.sourceId === jobClaim.sourceId
    );
    expect(committedSource?.lastSuccessful).toEqual({
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      generatedPages: accepted.manifestCommitIntent.generatedPages,
      changeSetId: acceptedChangeSet.id,
      completedAt: receipt.committedAt,
    });
    expect(committedSource?.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]).toEqual({
      version: 1,
      inputRevision: 1,
      transactionId: receipt.transactionId,
      manifestIntentDigest: accepted.manifestCommitIntentDigest,
    });
    const committedRuntime = await readRuntimeSnapshot(atomicFile);
    expect(committedRuntime.applyCommits).toHaveLength(1);
    expect(committedRuntime.applyCommits[0]).toMatchObject({
      transactionId: receipt.transactionId,
      commitRevision: receipt.commitRevision,
      bundleId: bundle.id,
      sourceId: jobClaim.sourceId,
      sourceContentHash: jobClaim.sourceContentHash,
      pipelineFingerprint: jobClaim.pipelineFingerprint,
      inputRevision: jobClaim.inputRevision,
      changeSetId: acceptedChangeSet.id,
      manifestIntentDigest: accepted.manifestCommitIntentDigest,
      journalDigest: createChangeSetTransactionJournalDigest(committedJournal),
      receiptDigest: createTransactionCommitReceiptDigest(receipt),
      manifestBeforeRevision: initialManifest.revision,
      manifestBeforeDigest: createSourceManifestDigest(initialManifest),
      manifestAfterRevision: committedManifest.revision,
      manifestAfterDigest: createSourceManifestDigest(committedManifest),
    });

    await expect(queue.verifyApplyRecovery(receipt)).resolves.toMatchObject({
      id: jobClaim.jobId,
      status: "failed",
      stage: "applying",
    });
    await expect(queue.resolveApplyRecovery(receipt)).resolves.toMatchObject({
      id: jobClaim.jobId,
      status: "completed",
    });
    const pendingAcknowledgement = await readRuntimeSnapshot(atomicFile);
    expect(pendingAcknowledgement.applyCommits).toHaveLength(1);
    expect(pendingAcknowledgement.queues[0].value).toMatchObject({
      control: { status: "paused", reason: "commit_pending_ack" },
      applyCommit: {
        transactionId: receipt.transactionId,
        changeSetDigest: receipt.changeSetDigest,
        commitRevision: receipt.commitRevision,
      },
    });

    await expect(transaction.acknowledgeCommitted(receipt)).resolves.toBe(true);
    await expect(transaction.loadActive()).resolves.toBeNull();
    await queue.finalizeApplyRecovery(bundle.id, receipt.transactionId);
    await expect(queue.getPendingApplyCommit(bundle.id)).resolves.toBeNull();
    const clearedBytes = await atomicFile.read();
    await applyCommitPort.recordCommitted(committedJournal, receipt);
    await expect(atomicFile.read()).resolves.toBe(clearedBytes);

    const manifestBeforeOrdinaryWrite = requireManifest(await manifestStorage.read(bundle.id));
    const ordinaryManifest: SourceManifest = {
      ...manifestBeforeOrdinaryWrite,
      revision: manifestBeforeOrdinaryWrite.revision + 1,
      entries: [
        ...manifestBeforeOrdinaryWrite.entries,
        {
          sourceId: "source-2",
          sourceKey: "sources/source-2.md",
          sourcePath: "Sources/source-2.md",
          custody: "user_managed",
        },
      ],
    };
    await manifestStorage.write(bundle.id, ordinaryManifest, manifestBeforeOrdinaryWrite.revision);
    const advancedBytes = await atomicFile.read();
    await applyCommitPort.recordCommitted(committedJournal, receipt);
    await expect(atomicFile.read()).resolves.toBe(advancedBytes);

    const finalManifest = requireManifest(await manifestStorage.read(bundle.id));
    expect(finalManifest.revision).toBe(committedManifest.revision + 1);
    expect(finalManifest.entries.map((entry) => entry.sourceId)).toEqual(["source-1", "source-2"]);
    expect((await readRuntimeSnapshot(atomicFile)).applyCommits).toHaveLength(1);
  });
});
