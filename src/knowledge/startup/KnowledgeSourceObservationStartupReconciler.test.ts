import type {
  BindSourceInputObservationRequest,
  BoundSourceInputObservation,
  SourceInputObservationRecoveryWork,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  buildKnowledgeSourceWatchPlan,
  KNOWLEDGE_CITATION_CONTRACT_VERSION,
  KNOWLEDGE_PIPELINE_PROFILE_VERSION,
  type KnowledgeBundlePipelineProfile,
  type KnowledgeSourceParserProfile,
  type KnowledgeSourceWatchPlan,
  type WatchedKnowledgeSource,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { CommitSourceInputObservationResult } from "@/knowledge/ingest/SourceObservationHandoff";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { KNOWLEDGE_CONTRACT_VERSION, SUPPORTED_OKF_VERSION } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeSourceObservationStartupError,
  KnowledgeSourceObservationStartupReconciler,
  type KnowledgeSourceObservationExactReaderPort,
  type KnowledgeSourceObservationRecoveryHandoffPort,
  type KnowledgeSourceObservationStartupFailureCode,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";

const SCHEMA_BYTES = new TextEncoder().encode("# Knowledge schema\n");
const FIRST_BYTES = new TextEncoder().encode("first exact source\n");
const SECOND_BYTES = new TextEncoder().encode("second exact source\n");
const HASH_A = createSourceContentHash(FIRST_BYTES);
const HASH_B = createSourceContentHash(SECOND_BYTES);

interface SourceFixture {
  bundleId: string;
  sourceId: string;
  sourcePath: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface HandoffHarness extends KnowledgeSourceObservationRecoveryHandoffPort {
  loadRecoveryWork: jest.Mock<Promise<SourceInputObservationRecoveryWork[]>, [string]>;
  commit: jest.Mock<
    Promise<CommitSourceInputObservationResult>,
    [BindSourceInputObservationRequest]
  >;
}

/** Creates one externally settled Promise for lifecycle-race tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Flushes bounded Promise turns until a synchronous predicate becomes true. */
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for test condition");
}

/** Creates the generic parser shared by strict watch-plan fixtures. */
function createParser(): KnowledgeSourceParserProfile {
  return {
    id: "markdown",
    version: "parser-1",
    pathSuffixes: [".md"],
    configuration: { preserveHeadings: true },
  };
}

/** Creates one complete secret-free Bundle pipeline profile. */
function createPipeline(bundleId: string): KnowledgeBundlePipelineProfile {
  return {
    version: KNOWLEDGE_PIPELINE_PROFILE_VERSION,
    bundleId,
    compiler: { version: "compiler-1", configuration: { maxTargets: 20 } },
    parsers: [createParser()],
    model: {
      provider: "test-provider",
      model: "test-model",
      configuration: { temperature: 0 },
    },
    outputLanguage: "zh-CN",
    okfVersion: SUPPORTED_OKF_VERSION,
    citationContractVersion: KNOWLEDGE_CITATION_CONTRACT_VERSION,
  };
}

/** Builds an opaque production watch plan for the supplied registered sources. */
function createWatchPlan(fixtures: readonly SourceFixture[]): KnowledgeSourceWatchPlan {
  const byBundle = new Map<string, SourceFixture[]>();
  for (const fixture of fixtures) {
    const sources = byBundle.get(fixture.bundleId);
    if (sources) {
      sources.push(fixture);
    } else {
      byBundle.set(fixture.bundleId, [fixture]);
    }
  }
  return buildKnowledgeSourceWatchPlan(
    [...byBundle.entries()].map(([bundleId, sources]) => ({
      bundle: {
        version: KNOWLEDGE_CONTRACT_VERSION,
        id: bundleId,
        sourceRoots: [`Sources/${bundleId}`],
        wikiRoot: `Wiki/${bundleId}`,
        schemaRef: `Schemas/${bundleId}.md`,
        reviewMode: "multi_file" as const,
      },
      manifest: {
        version: KNOWLEDGE_CONTRACT_VERSION,
        bundleId,
        revision: 1,
        entries: sources.map(({ sourceId, sourcePath }) => ({
          sourceId,
          sourcePath,
          sourceKey: toWindowsPathKey(sourcePath),
          custody: "user_managed" as const,
        })),
      },
      schema: { path: `Schemas/${bundleId}.md`, bytes: SCHEMA_BYTES.slice() },
      pipeline: createPipeline(bundleId),
    }))
  );
}

/** Returns one exact registered source from a test plan. */
function requireSource(
  plan: KnowledgeSourceWatchPlan,
  bundleId = "personal",
  sourceId = "source-1"
): Readonly<WatchedKnowledgeSource> {
  const source = plan.getSource(bundleId, sourceId);
  if (!source) {
    throw new Error("Expected source fixture");
  }
  return source;
}

/** Creates one exact pending bound observation for a registered source. */
function createBoundObservation(
  source: Readonly<WatchedKnowledgeSource>,
  inputRevision = 1,
  sourceContentHash = HASH_A
): BoundSourceInputObservation {
  return {
    bundleId: source.bundleId,
    sourceId: source.sourceId,
    captureId: `capture-${source.sourceId}-${inputRevision}`,
    inputRevision,
    observationToken: `token-${source.sourceId}-${inputRevision}`,
    sourceContentHash,
    pipelineFingerprint: source.pipelineFingerprint,
  };
}

/** Wraps one bound observation in the durable recovery-work envelope. */
function boundWork(observation: BoundSourceInputObservation): SourceInputObservationRecoveryWork {
  return { kind: "bound", observation };
}

/** Creates one allocated capture that must be left for the authoritative crawl. */
function allocatedWork(
  source: Readonly<WatchedKnowledgeSource>,
  inputRevision = 1
): SourceInputObservationRecoveryWork {
  return {
    kind: "allocated",
    allocation: {
      bundleId: source.bundleId,
      sourceId: source.sourceId,
      captureId: `capture-${source.sourceId}-${inputRevision}`,
      inputRevision,
      observationToken: `token-${source.sourceId}-${inputRevision}`,
    },
  };
}

/** Creates a strict committed settlement for one exact observation. */
function committed(
  observation: BoundSourceInputObservation,
  queueRevision = observation.inputRevision
): CommitSourceInputObservationResult {
  return { kind: "committed", observation, queueRevision };
}

/** Creates a handoff whose load and commit behaviors remain observable. */
function createHandoff(
  work: SourceInputObservationRecoveryWork[] = [],
  commitImplementation: (
    request: BindSourceInputObservationRequest
  ) => Promise<CommitSourceInputObservationResult> = async () => {
    throw new Error("Unexpected commit");
  }
): HandoffHarness {
  return {
    loadRecoveryWork: jest.fn(async (_bundleId: string) => work),
    commit: jest.fn(commitImplementation),
  };
}

/** Creates an exact-reader success for locally verified bytes. */
function createArtifact(sourcePath: string, bytes = FIRST_BYTES) {
  return {
    sourcePath,
    bytes: bytes.slice(),
    sourceContentHash: createSourceContentHash(bytes),
  };
}

/** Asserts one stable sanitized startup failure. */
async function expectFailure(
  promise: Promise<unknown>,
  code: KnowledgeSourceObservationStartupFailureCode
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected observation startup failure");
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeSourceObservationStartupError);
    expect(error).toMatchObject({
      code,
      message: "Knowledge source observation startup reconciliation failed",
    });
  }
}

describe("KnowledgeSourceObservationStartupReconciler", () => {
  const fixture: SourceFixture = {
    bundleId: "personal",
    sourceId: "source-1",
    sourcePath: "Sources/personal/Research.md",
  };

  it("revalidates exact current bytes before replaying an identical bound observation", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const reader: KnowledgeSourceObservationExactReaderPort = {
      readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
    };
    const handoff = createHandoff([boundWork(observation)], async () => committed(observation, 7));
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: reader,
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toEqual({
      kind: "reconciled",
      replayedBoundCount: 1,
      supersededBoundCount: 0,
      deferredAllocatedCount: 0,
      deferredDriftCount: 0,
    });

    expect(reader.readExpected).toHaveBeenCalledWith(
      source.sourcePath,
      observation.sourceContentHash,
      expect.any(AbortSignal)
    );
    expect(handoff.commit).toHaveBeenCalledWith({
      observationToken: observation.observationToken,
      sourceContentHash: observation.sourceContentHash,
      pipelineFingerprint: observation.pipelineFingerprint,
    });
  });

  it("defers allocated capabilities without reading or guessing bytes", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const reader: KnowledgeSourceObservationExactReaderPort = {
      readExpected: jest.fn(),
    };
    const handoff = createHandoff([allocatedWork(source, 4)]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: reader,
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
      kind: "reconciled",
      deferredAllocatedCount: 1,
    });
    expect(reader.readExpected).not.toHaveBeenCalled();
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "hash drift",
      artifact: (path: string) => createArtifact(path, SECOND_BYTES),
    },
    {
      name: "path drift",
      artifact: () => createArtifact("Sources/personal/Moved.md", FIRST_BYTES),
    },
  ])("defers bound $name to the later crawl", async ({ artifact }) => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const handoff = createHandoff([boundWork(observation)]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: { readExpected: jest.fn(async () => artifact(source.sourcePath)) },
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
      deferredDriftCount: 1,
      replayedBoundCount: 0,
    });
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it.each(["SourceArtifactHashMismatchError", "SourceArtifactUnavailableError"])(
    "treats the exact reader's %s as crawl-owned drift",
    async (name) => {
      const plan = createWatchPlan([fixture]);
      const source = requireSource(plan);
      const observation = createBoundObservation(source);
      const drift = new Error("private source detail");
      drift.name = name;
      const handoff = createHandoff([boundWork(observation)]);
      const reconciler = new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: {
          readExpected: jest.fn(async () => {
            throw drift;
          }),
        },
        handoffs: new Map([[source.bundleId, handoff]]),
      });

      await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
        deferredDriftCount: 1,
      });
      expect(handoff.commit).not.toHaveBeenCalled();
    }
  );

  it("fails closed when recovery work no longer has current source authority", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const orphan = { ...createBoundObservation(source), sourceId: "removed-source" };
    const handoff = createHandoff([boundWork(orphan)]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: { readExpected: jest.fn() },
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expectFailure(
      reconciler.reconcile(new AbortController().signal),
      "source_authority_missing"
    );
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it("fails closed when a bound observation belongs to an obsolete pipeline", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const obsolete = { ...createBoundObservation(source), pipelineFingerprint: HASH_B };
    const handoff = createHandoff([boundWork(obsolete)]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: { readExpected: jest.fn() },
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expectFailure(
      reconciler.reconcile(new AbortController().signal),
      "pipeline_fingerprint_changed"
    );
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it("retries commit-then-throw with the exact same request and verifies durable proof", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    let calls = 0;
    const handoff = createHandoff([boundWork(observation)], async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("private acknowledgement loss");
      }
      return committed(observation, 9);
    });
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: {
        readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
      },
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
      replayedBoundCount: 1,
    });
    expect(handoff.commit).toHaveBeenCalledTimes(2);
    expect(handoff.commit.mock.calls[0][0]).toBe(handoff.commit.mock.calls[1][0]);
    expect(Object.isFrozen(handoff.commit.mock.calls[0][0])).toBe(true);
  });

  it("accepts exact supersession proof without manufacturing a Queue receipt", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source, 3);
    const handoff = createHandoff([boundWork(observation)], async () => ({
      kind: "superseded",
      bundleId: observation.bundleId,
      sourceId: observation.sourceId,
      captureId: observation.captureId,
      inputRevision: observation.inputRevision,
      supersededByInputRevision: 4,
    }));
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: {
        readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
      },
      handoffs: new Map([[source.bundleId, handoff]]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
      replayedBoundCount: 0,
      supersededBoundCount: 1,
    });
  });

  it("loads Bundles and replays sources in deterministic identity/revision order", async () => {
    const plan = createWatchPlan([
      { bundleId: "zeta", sourceId: "z-source", sourcePath: "Sources/zeta/Z.md" },
      { bundleId: "alpha", sourceId: "z-source", sourcePath: "Sources/alpha/Z.md" },
      { bundleId: "alpha", sourceId: "a-source", sourcePath: "Sources/alpha/A.md" },
    ]);
    const alphaA = requireSource(plan, "alpha", "a-source");
    const alphaZ = requireSource(plan, "alpha", "z-source");
    const zetaZ = requireSource(plan, "zeta", "z-source");
    const observations = [
      createBoundObservation(alphaZ, 2, HASH_B),
      createBoundObservation(alphaA, 3, HASH_A),
      createBoundObservation(alphaA, 1, HASH_B),
      createBoundObservation(zetaZ, 1, HASH_A),
    ];
    const loadOrder: string[] = [];
    const replayOrder: string[] = [];
    const byToken = new Map(
      observations.map((observation) => [observation.observationToken, observation])
    );
    const alpha = createHandoff(observations.slice(0, 3).map(boundWork), async (request) => {
      replayOrder.push(request.observationToken);
      const observation = byToken.get(request.observationToken);
      if (!observation) throw new Error("Unknown observation fixture");
      return committed(observation);
    });
    alpha.loadRecoveryWork.mockImplementation(async (bundleId) => {
      loadOrder.push(bundleId);
      return observations.slice(0, 3).map(boundWork);
    });
    const zeta = createHandoff([boundWork(observations[3])], async (request) => {
      replayOrder.push(request.observationToken);
      const observation = byToken.get(request.observationToken);
      if (!observation) throw new Error("Unknown observation fixture");
      return committed(observation);
    });
    zeta.loadRecoveryWork.mockImplementation(async (bundleId) => {
      loadOrder.push(bundleId);
      return [boundWork(observations[3])];
    });
    const pathsByHash = new Map([
      [HASH_A, FIRST_BYTES],
      [HASH_B, SECOND_BYTES],
    ]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: {
        readExpected: jest.fn(async (path, hash) => {
          const bytes = pathsByHash.get(hash);
          if (!bytes) throw new Error("Unknown hash fixture");
          return createArtifact(path, bytes);
        }),
      },
      handoffs: new Map([
        ["zeta", zeta],
        ["alpha", alpha],
      ]),
    });

    await expect(reconciler.reconcile(new AbortController().signal)).resolves.toMatchObject({
      replayedBoundCount: 4,
    });
    expect(loadOrder).toEqual(["alpha", "zeta"]);
    expect(replayOrder).toEqual([
      observations[2].observationToken,
      observations[1].observationToken,
      observations[0].observationToken,
      observations[3].observationToken,
    ]);
  });

  it("close during recovery loading prevents any later exact-byte stage", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const pending = createDeferred<SourceInputObservationRecoveryWork[]>();
    const handoff = createHandoff();
    handoff.loadRecoveryWork.mockImplementation(() => pending.promise);
    const reader = jest.fn(async () => createArtifact(source.sourcePath));
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: { readExpected: reader },
      handoffs: new Map([[source.bundleId, handoff]]),
    });
    const running = reconciler.reconcile(new AbortController().signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });

    reconciler.close();
    pending.resolve([boundWork(observation)]);

    await rejection;
    expect(reader).not.toHaveBeenCalled();
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it("caller cancellation during exact reading aborts the adapter signal and skips commit", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const pending = createDeferred<ReturnType<typeof createArtifact>>();
    let readerSignal: AbortSignal | undefined;
    const handoff = createHandoff([boundWork(observation)]);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: {
        readExpected: jest.fn((_path, _hash, signal) => {
          readerSignal = signal;
          return pending.promise;
        }),
      },
      handoffs: new Map([[source.bundleId, handoff]]),
    });
    const controller = new AbortController();
    const running = reconciler.reconcile(controller.signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => readerSignal !== undefined);

    controller.abort();
    expect(readerSignal?.aborted).toBe(true);
    pending.resolve(createArtifact(source.sourcePath));

    await rejection;
    expect(handoff.commit).not.toHaveBeenCalled();
  });

  it("close after commit entry suppresses late settlement publication", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const pending = createDeferred<CommitSourceInputObservationResult>();
    const handoff = createHandoff([boundWork(observation)], () => pending.promise);
    const reconciler = new KnowledgeSourceObservationStartupReconciler({
      watchPlan: plan,
      artifactReader: {
        readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
      },
      handoffs: new Map([[source.bundleId, handoff]]),
    });
    const running = reconciler.reconcile(new AbortController().signal);
    const rejection = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitUntil(() => handoff.commit.mock.calls.length === 1);

    expect(handoff.commit).toHaveBeenCalledTimes(1);
    reconciler.close();
    pending.resolve(committed(observation));

    await rejection;
    expect(handoff.commit).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed recovery, reader, and settlement success payloads", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);

    const malformedWorkHandoff = createHandoff();
    malformedWorkHandoff.loadRecoveryWork.mockResolvedValue([
      { kind: "bound", observation: { ...observation, inputRevision: 0 } },
    ] as SourceInputObservationRecoveryWork[]);
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: { readExpected: jest.fn() },
        handoffs: new Map([[source.bundleId, malformedWorkHandoff]]),
      }).reconcile(new AbortController().signal),
      "recovery_work_invalid"
    );

    const malformedArtifactHandoff = createHandoff([boundWork(observation)]);
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: {
          readExpected: jest.fn(async () => ({
            sourcePath: source.sourcePath,
            bytes: FIRST_BYTES.slice(),
            sourceContentHash: HASH_B,
          })),
        },
        handoffs: new Map([[source.bundleId, malformedArtifactHandoff]]),
      }).reconcile(new AbortController().signal),
      "source_artifact_invalid"
    );

    const malformedSettlementHandoff = createHandoff([boundWork(observation)], async () => ({
      ...committed(observation),
      queueRevision: 0,
    }));
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: {
          readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
        },
        handoffs: new Map([[source.bundleId, malformedSettlementHandoff]]),
      }).reconcile(new AbortController().signal),
      "observation_settlement_invalid"
    );
    expect(malformedSettlementHandoff.commit).toHaveBeenCalledTimes(1);
  });

  it("sanitizes injected load, read, and repeated commit failures", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);

    const loadFailure = createHandoff();
    loadFailure.loadRecoveryWork.mockRejectedValue(new Error("secret/load/path"));
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: { readExpected: jest.fn() },
        handoffs: new Map([[source.bundleId, loadFailure]]),
      }).reconcile(new AbortController().signal),
      "recovery_load_failed"
    );

    const readFailure = createHandoff([boundWork(observation)]);
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: {
          readExpected: jest.fn(async () => {
            throw new Error("secret/read/path");
          }),
        },
        handoffs: new Map([[source.bundleId, readFailure]]),
      }).reconcile(new AbortController().signal),
      "source_revalidation_failed"
    );

    const commitFailure = createHandoff([boundWork(observation)], async () => {
      throw new Error("secret/token/path");
    });
    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: {
          readExpected: jest.fn(async () => createArtifact(source.sourcePath)),
        },
        handoffs: new Map([[source.bundleId, commitFailure]]),
      }).reconcile(new AbortController().signal),
      "observation_commit_failed"
    );
    expect(commitFailure.commit).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate recovery identities before any byte revalidation", async () => {
    const plan = createWatchPlan([fixture]);
    const source = requireSource(plan);
    const observation = createBoundObservation(source);
    const handoff = createHandoff([boundWork(observation), boundWork({ ...observation })]);
    const reader = jest.fn();

    await expectFailure(
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: { readExpected: reader },
        handoffs: new Map([[source.bundleId, handoff]]),
      }).reconcile(new AbortController().signal),
      "recovery_work_invalid"
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it("fails construction when a planned Bundle lacks a complete handoff", () => {
    const plan = createWatchPlan([fixture]);
    let caught: unknown;

    try {
      new KnowledgeSourceObservationStartupReconciler({
        watchPlan: plan,
        artifactReader: { readExpected: jest.fn() },
        handoffs: new Map(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KnowledgeSourceObservationStartupError);
    expect((caught as KnowledgeSourceObservationStartupError).code).toBe("dependency_invalid");
  });
});
