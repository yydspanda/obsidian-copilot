import { IngestQueue } from "@/knowledge/ingest/queue/IngestQueue";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  createNoChangesManifestCommitPlan,
  createNoChangesManifestCommitPlanDigest,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import type { SourceManifest } from "@/knowledge/model/types";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
  type KnowledgeRuntimeStoreSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/16";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

class MemoryFile implements AtomicRuntimeFile {
  content?: string;
  commitThenThrow = false;
  failBeforeCommit = false;

  async initialize(content: string): Promise<void> {
    this.content ??= content;
  }

  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("Uninitialized test file");
    return this.content;
  }

  async process(transform: (content: string) => string): Promise<string> {
    if (this.failBeforeCommit) throw new Error("Atomic write unavailable");
    this.content = transform(await this.read());
    if (this.commitThenThrow) {
      this.commitThenThrow = false;
      throw new Error("Commit acknowledgement lost");
    }
    return this.content;
  }
}

async function createHarness() {
  const file = new MemoryFile();
  let identity = 0;
  const runtime = new KnowledgeRuntimeStore(file, {
    clock: () => 200,
    opaqueIdFactory: () => (++identity).toString(16).padStart(32, "0"),
  });
  await runtime.initialize();
  const manifest: SourceManifest = {
    version: 1,
    bundleId: "reading",
    revision: 1,
    entries: [
      {
        sourceId: "chapter",
        sourceKey: "sources/chapter.md",
        sourcePath: "Sources/Chapter.md",
        custody: "user_managed",
      },
    ],
  };
  await runtime.writeManifest("reading", manifest, null);
  const allocation = await runtime.allocateInputRevision({
    bundleId: "reading",
    sourceId: "chapter",
    captureId: "first-observation",
  });
  const bound = await runtime.bindInputObservation({
    observationToken: allocation.observationToken,
    sourceContentHash: HASH_A,
    pipelineFingerprint: HASH_B,
  });
  if (bound.kind !== "ready") throw new Error("Expected fresh fixture observation");
  const executor = jest.fn(async ({ job }: { job: { inputRevision: number } }) => {
    const current = (await runtime.readManifest("reading")) as SourceManifest;
    const plan = createNoChangesManifestCommitPlan({
      bundleId: "reading",
      sourceId: "chapter",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: job.inputRevision,
      compileContextDigest: HASH_A,
      analysisDigest: HASH_B,
      evidenceDigest: HASH_A,
      reason: "analysis_no_targets",
      expectedManifestRevision: current.revision,
      expectedManifestDigest: createSourceManifestDigest(current),
      baseGeneratedPages: [],
      sourceAuthority: { operation: "ingest" },
    });
    return {
      kind: "no_changes" as const,
      changeSetId: plan.noChangesId,
      manifestCommitPlan: plan,
      manifestCommitPlanDigest: createNoChangesManifestCommitPlanDigest(plan),
    };
  });
  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(runtime),
    { execute: executor },
    {
      clock: () => 200,
      jobIdFactory: () => `job-${++identity}`,
    }
  );
  const first = await queue.enqueue(bound.observation);
  await queue.runNext("reading");
  await queue.pause("reading");
  const snapshot = await queue.load("reading");
  const command = {
    bundleId: "reading",
    jobId: first.job.id,
    expectedQueueRevision: snapshot.revision,
  };
  return { file, runtime, queue, executor, command };
}

describe("KnowledgeRuntimeStore", () => {
  describe("KnowledgeRuntimeStore", () => {
    describe("reanalyzeCompletedSource()", () => {
      it(`queues a fresh input revision without rewriting completed history, proofs, or pause state (${ISSUE})`, async () => {
        const { runtime, file, queue, executor, command } = await createHarness();
        const before = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
        await runtime.reanalyzeCompletedSource(command);
        const after = JSON.parse(await file.read()) as KnowledgeRuntimeStoreSnapshot;
        const oldQueue = before.queues[0].value as IngestQueueSnapshot;
        const newQueue = after.queues[0].value as IngestQueueSnapshot;
        expect(newQueue.jobs).toHaveLength(2);
        expect(newQueue.jobs[0]).toEqual(oldQueue.jobs[0]);
        expect(newQueue.jobs[1]).toMatchObject({
          sourceId: "chapter",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 2,
          attempt: 0,
          status: "pending",
          stage: "queued",
        });
        expect(newQueue.jobs[1].id).not.toBe(command.jobId);
        expect(newQueue.control).toEqual(oldQueue.control);
        expect(after.manifests).toEqual(before.manifests);
        expect(after.reviews).toEqual(before.reviews);
        expect(after.applyCommits).toEqual(before.applyCommits);
        expect(after.inputRevisions[0].sources[0].observations[1]).toMatchObject({
          inputRevision: 2,
          status: "consumed",
          queueRevision: newQueue.revision,
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
        });
        expect(executor).toHaveBeenCalledTimes(1);
        await expect(queue.runNext("reading")).resolves.toMatchObject({ kind: "paused" });
        await new KnowledgeRuntimeStore(file).initialize();
        await queue.resume("reading");
        await expect(queue.runNext("reading")).resolves.toMatchObject({
          kind: "executed",
          status: "completed",
        });
        expect(executor).toHaveBeenCalledTimes(2);
      });

      it(`rejects a second click on a stale queue revision without creating another job (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        await runtime.reanalyzeCompletedSource(command);
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
      });

      it(`refuses a running queue without scheduling work (${ISSUE})`, async () => {
        const { runtime, file, queue, command } = await createHarness();
        await queue.resume("reading");
        command.expectedQueueRevision = (await queue.load("reading")).revision;
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
      });

      it(`preserves an unresolved watcher observation instead of replaying stale input over it (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        await runtime.allocateInputRevision({
          bundleId: "reading",
          sourceId: "chapter",
          captureId: "new-source-read",
        });
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
        expect((await runtime.readStudioBundle("reading")).reanalyzableJobIds).toBeUndefined();
      });

      it(`keeps automatic unchanged observation deduplication intact before explicit replay (${ISSUE})`, async () => {
        const { runtime, file, queue, command, executor } = await createHarness();
        const allocation = await runtime.allocateInputRevision({
          bundleId: "reading",
          sourceId: "chapter",
          captureId: "unchanged-watcher-read",
        });
        const bound = await runtime.bindInputObservation({
          observationToken: allocation.observationToken,
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
        });
        if (bound.kind !== "ready") throw new Error("Expected unchanged observation");
        await expect(queue.enqueue(bound.observation)).resolves.toMatchObject({
          kind: "deduplicated",
          job: { id: command.jobId },
        });
        expect((await queue.load("reading")).jobs).toHaveLength(1);
        expect(executor).toHaveBeenCalledTimes(1);
        command.expectedQueueRevision = (await queue.load("reading")).revision;
        await runtime.reanalyzeCompletedSource(command);
        expect((await queue.load("reading")).jobs[1].inputRevision).toBe(3);
        await new KnowledgeRuntimeStore(file).initialize();
      });

      it(`rejects an already queued same-source replay even with a refreshed revision (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        await runtime.reanalyzeCompletedSource(command);
        command.expectedQueueRevision = (await runtime.readStudioBundle("reading")).queue.revision;
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
        expect((await runtime.readStudioBundle("reading")).reanalyzableJobIds).toBeUndefined();
      });

      it(`preserves startup recovery instead of offering or scheduling replay (${ISSUE})`, async () => {
        const { runtime, file, queue, command } = await createHarness();
        const previous = await queue.load("reading");
        await runtime.writeQueue(
          "reading",
          {
            ...previous,
            revision: previous.revision + 1,
            control: { status: "paused", reason: "startup_recovery", pausedAt: 200 },
          },
          previous.revision
        );
        command.expectedQueueRevision = previous.revision + 1;
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
        expect((await runtime.readStudioBundle("reading")).reanalyzableJobIds).toBeUndefined();
      });

      it(`keeps retired material unavailable without altering its preserved history (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        const candidate = (await runtime.readSourceRetirementCandidates("reading")).candidates[0];
        await runtime.retireSourceAtomically({
          version: 1,
          bundleId: "reading",
          sourceId: "chapter",
          expectedToken: candidate.expectedToken,
          reason: "user_requested",
          confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
        });
        const before = await file.read();
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
        expect((await runtime.readStudioBundle("reading")).reanalyzableJobIds).toBeUndefined();
      });

      it(`rejects unsupported force fields and colliding observation identities without writes (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        const before = await file.read();
        const malformed = { ...command, force: true };
        await expect(runtime.reanalyzeCompletedSource(malformed)).rejects.toThrow();
        expect(await file.read()).toBe(before);
        const collidingRuntime = new KnowledgeRuntimeStore(file, {
          opaqueIdFactory: () => "2".padStart(32, "0"),
        });
        await expect(collidingRuntime.reanalyzeCompletedSource(command)).rejects.toThrow();
        expect(await file.read()).toBe(before);
      });

      it(`does not report a replay as queued when the atomic write fails before commit (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        const before = await file.read();
        file.failBeforeCommit = true;
        await expect(runtime.reanalyzeCompletedSource(command)).rejects.toThrow(
          "Atomic write unavailable"
        );
        expect(await file.read()).toBe(before);
      });

      it(`confirms an exact atomic commit after its acknowledgement is lost (${ISSUE})`, async () => {
        const { runtime, file, command } = await createHarness();
        file.commitThenThrow = true;
        await expect(runtime.reanalyzeCompletedSource(command)).resolves.toBeUndefined();
        expect((await runtime.readStudioBundle("reading")).queue.jobs).toHaveLength(2);
      });
    });

    describe("readStudioBundle()", () => {
      it(`offers only the proven current completed job while safely paused (${ISSUE})`, async () => {
        const { runtime, command, queue } = await createHarness();
        const snapshot = await runtime.readStudioBundle("reading");
        expect(snapshot.reanalyzableJobIds).toEqual([command.jobId]);
        expect(Object.isFrozen(snapshot.reanalyzableJobIds)).toBe(true);
        await queue.resume("reading");
        expect((await runtime.readStudioBundle("reading")).reanalyzableJobIds).toBeUndefined();
      });
    });
  });
});
