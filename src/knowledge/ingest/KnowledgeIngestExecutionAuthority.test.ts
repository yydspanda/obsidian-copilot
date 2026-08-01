import {
  KnowledgeIngestExecutionAuthority,
  KnowledgeIngestExecutionAuthorityBinder,
  KnowledgeIngestExecutionAuthorityError,
  type KnowledgeIngestExecutionProofPort,
} from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import type { IngestExecutionContext } from "@/knowledge/ingest/queue/IngestQueue";
import type { SourceManifest } from "@/knowledge/model/types";
import {
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeQueueStorage,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { createKnowledgeExecutionTestHarness } from "@/knowledge/testing/KnowledgeExecutionTestHarness";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_FINGERPRINT = "b".repeat(64);

/** Creates the durable source authority required by Runtime proof. */
function createManifest(revision = 1): SourceManifest {
  return {
    version: 1,
    bundleId: "personal",
    revision,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "sources/source-1.md",
        sourcePath: "Sources/Source-1.md",
        custody: "user_managed",
      },
    ],
  };
}

/** Captures one authority error without accepting an unrelated exception. */
async function expectAuthorityError(
  action: () => Promise<unknown>,
  code: KnowledgeIngestExecutionAuthorityError["code"]
): Promise<KnowledgeIngestExecutionAuthorityError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KnowledgeIngestExecutionAuthorityError);
  expect(caught).toMatchObject({ code });
  return caught as KnowledgeIngestExecutionAuthorityError;
}

describe("KnowledgeIngestExecutionAuthority", () => {
  it("binds a real Runtime proof and monotonically re-proves processing stages", async () => {
    let authority: KnowledgeIngestExecutionAuthority | undefined;
    let proofPort: KnowledgeRuntimeIngestExecutionProofPort | undefined;
    const harness = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-authority",
      execute: async (context) => {
        if (!proofPort) throw new Error("Expected an initialized Runtime proof port");
        authority = await new KnowledgeIngestExecutionAuthorityBinder(proofPort).bind(
          context.executionClaim
        );
        KnowledgeIngestExecutionAuthority.assert(authority);
        expect(authority.getSignal()).toBe(context.signal);
        expect(authority.getClaim()).toMatchObject({
          bundleId: "personal",
          jobId: "job-authority",
          sourceId: "source-1",
          sourceContentHash: SOURCE_HASH,
          pipelineFingerprint: PIPELINE_FINGERPRINT,
          inputRevision: 1,
          attempt: 1,
          startedAt: 100,
        });
        expect(Object.isFrozen(authority)).toBe(true);
        expect(Object.keys(authority)).toEqual([]);

        await authority.reprove("parsing");
        await context.reportStage("analyzing");
        await authority.reprove("analyzing");
        return { kind: "no_changes", changeSetId: "changeset-authority" };
      },
    });
    proofPort = harness.proofPort;

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
    expect(authority).toBeDefined();
    await expectAuthorityError(() => authority!.reprove("analyzing"), "claim_stale");
  });

  it("rejects structural proof ports, reconstructed claims, and repeated binding", async () => {
    const structuralPort: KnowledgeIngestExecutionProofPort = {
      prove: async () => ({ forged: true }),
    };
    expect(() => new KnowledgeIngestExecutionAuthorityBinder(structuralPort)).toThrow(
      KnowledgeIngestExecutionAuthorityError
    );

    let proofPort: KnowledgeRuntimeIngestExecutionProofPort | undefined;
    const harness = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-forgery",
      execute: async (context: IngestExecutionContext) => {
        if (!proofPort) throw new Error("Expected an initialized Runtime proof port");
        const binder = new KnowledgeIngestExecutionAuthorityBinder(proofPort);
        await expectAuthorityError(
          () => binder.bind({ ...context.executionClaim } as never),
          "claim_invalid"
        );
        const authority = await binder.bind(context.executionClaim);
        await expectAuthorityError(
          () =>
            new KnowledgeIngestExecutionAuthorityBinder(proofPort!).bind(context.executionClaim),
          "claim_not_authorized"
        );
        expect(() => KnowledgeIngestExecutionAuthority.assert({ ...authority })).toThrow(
          KnowledgeIngestExecutionAuthorityError
        );
        expect(() =>
          KnowledgeIngestExecutionAuthority.assert(
            Object.create(KnowledgeIngestExecutionAuthority.prototype)
          )
        ).toThrow(KnowledgeIngestExecutionAuthorityError);
        return { kind: "no_changes", changeSetId: "changeset-forgery" };
      },
    });
    proofPort = harness.proofPort;

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
  });

  it("uses the canonical branded facade method instead of a subclass override", async () => {
    let overrideCalls = 0;
    class OverridingProofPort extends KnowledgeRuntimeIngestExecutionProofPort {
      /** Must never replace the canonical proof method captured by the Binder. */
      override async prove(): Promise<unknown> {
        overrideCalls += 1;
        return { forged: true };
      }
    }

    let proofPort: OverridingProofPort | undefined;
    const harness = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-subclass",
      execute: async (context) => {
        if (!proofPort) throw new Error("Expected an initialized Runtime proof port");
        const authority = await new KnowledgeIngestExecutionAuthorityBinder(proofPort).bind(
          context.executionClaim
        );
        await authority.reprove("parsing");
        return { kind: "no_changes", changeSetId: "changeset-subclass" };
      },
    });
    proofPort = new OverridingProofPort(harness.runtime, harness.queueStorage);

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
    expect(overrideCalls).toBe(0);
  });

  it("rejects proof facades owned by another Queue storage or execution lifecycle", async () => {
    const otherLifecycle = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-other-lifecycle",
      execute: async () => ({
        kind: "no_changes",
        changeSetId: "changeset-other-lifecycle",
      }),
    });
    let correctProofPort: KnowledgeRuntimeIngestExecutionProofPort | undefined;
    let wrongStorageProofPort: KnowledgeRuntimeIngestExecutionProofPort | undefined;
    const harness = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-owner-binding",
      execute: async (context) => {
        if (!correctProofPort || !wrongStorageProofPort) {
          throw new Error("Expected initialized Runtime proof ports");
        }
        await expectAuthorityError(
          () =>
            new KnowledgeIngestExecutionAuthorityBinder(wrongStorageProofPort!).bind(
              context.executionClaim
            ),
          "claim_not_authorized"
        );
        await expectAuthorityError(
          () =>
            new KnowledgeIngestExecutionAuthorityBinder(otherLifecycle.proofPort).bind(
              context.executionClaim
            ),
          "claim_not_authorized"
        );
        const authority = await new KnowledgeIngestExecutionAuthorityBinder(correctProofPort).bind(
          context.executionClaim
        );
        await authority.reprove("parsing");
        return { kind: "no_changes", changeSetId: "changeset-owner-binding" };
      },
    });
    correctProofPort = harness.proofPort;
    const alternateQueueStorage = new KnowledgeRuntimeQueueStorage(harness.runtime);
    wrongStorageProofPort = new KnowledgeRuntimeIngestExecutionProofPort(
      harness.runtime,
      alternateQueueStorage
    );

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
  });

  it("fails closed on proof drift and sanitizes lower-level failures", async () => {
    const secretCanary = "private-runtime-corruption-canary";
    let proofPort: KnowledgeRuntimeIngestExecutionProofPort | undefined;
    let file: Awaited<ReturnType<typeof createKnowledgeExecutionTestHarness>>["file"] | undefined;
    const harness = await createKnowledgeExecutionTestHarness({
      manifest: createManifest(),
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      jobId: "job-drift",
      execute: async (context) => {
        if (!proofPort || !file) throw new Error("Expected initialized Runtime capabilities");
        const authority = await new KnowledgeIngestExecutionAuthorityBinder(proofPort).bind(
          context.executionClaim
        );
        await file.replaceManifest(createManifest(2));
        await expectAuthorityError(() => authority.reprove("parsing"), "proof_changed");

        const validContent = await file.read();
        file.replaceContent(`{"${secretCanary}":`);
        const failure = await expectAuthorityError(
          () => authority.reprove("parsing"),
          "claim_not_authorized"
        );
        expect(failure.message).not.toContain(secretCanary);
        expect(JSON.stringify(failure)).not.toContain(secretCanary);
        file.replaceContent(validContent);
        return { kind: "no_changes", changeSetId: "changeset-drift" };
      },
    });
    proofPort = harness.proofPort;
    file = harness.file;

    await expect(harness.queue.runNext("personal")).resolves.toMatchObject({
      kind: "executed",
      status: "completed",
    });
  });
});
