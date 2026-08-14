import {
  KnowledgeSourceRetirementConflictError,
  type KnowledgeSourceRetirementCandidate,
  type KnowledgeSourceRetirementCandidateSnapshot,
  type KnowledgeSourceRetirementReceipt,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeSourceLifecycleError } from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import {
  KnowledgeProductionSourceLifecycleCoordinator,
  type KnowledgeProductionSourceLifecycleCoordinatorInput,
} from "@/knowledge/sourceLifecycle/KnowledgeProductionSourceLifecycleCoordinator";
import type { KnowledgeSourceObservationRecoverableIssue } from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const SOURCE_PATH = "Sources/Personal/Research.md";

interface CoordinatorHarness {
  coordinator: KnowledgeProductionSourceLifecycleCoordinator;
  readCandidates: jest.Mock<Promise<KnowledgeSourceRetirementCandidateSnapshot>, [string]>;
  retireAtomically: jest.Mock<Promise<KnowledgeSourceRetirementReceipt>, [unknown]>;
  getSourceIssues: jest.Mock<readonly KnowledgeSourceObservationRecoverableIssue[], []>;
  assertCurrent: jest.Mock<void, []>;
  refresh: jest.Mock<void, []>;
}

/** Creates one active Runtime retirement candidate. */
function createCandidate(
  patch: Partial<KnowledgeSourceRetirementCandidate> = {}
): KnowledgeSourceRetirementCandidate {
  const blockers = patch.blockers ?? [];
  return {
    sourceId: "source-1",
    sourcePath: SOURCE_PATH,
    custody: "user_managed",
    generatedPageCount: 2,
    status: blockers.length === 0 ? "ready" : "blocked",
    expectedToken: TOKEN_A,
    blockers,
    ...patch,
  };
}

/** Creates one exact Runtime candidate snapshot. */
function createCandidateSnapshot(
  candidates: readonly KnowledgeSourceRetirementCandidate[] = [createCandidate()],
  patch: Partial<KnowledgeSourceRetirementCandidateSnapshot> = {}
): KnowledgeSourceRetirementCandidateSnapshot {
  return {
    bundleId: "personal",
    runtimeRevision: 4,
    manifestRevision: 2,
    candidates: [...candidates],
    ...patch,
  };
}

/** Creates one current missing-source watcher issue. */
function createMissingIssue(
  patch: Partial<
    Extract<KnowledgeSourceObservationRecoverableIssue, { kind: "source_missing" }>
  > = {}
): KnowledgeSourceObservationRecoverableIssue {
  return {
    kind: "source_missing",
    bundleId: "personal",
    sourceId: "source-1",
    ...patch,
  };
}

/** Creates one strict token-bound retirement receipt. */
function createRetirementReceipt(
  patch: Partial<KnowledgeSourceRetirementReceipt> = {}
): KnowledgeSourceRetirementReceipt {
  return {
    outcome: "retired",
    bundleId: "personal",
    sourceId: "source-1",
    sourcePath: SOURCE_PATH,
    custody: "user_managed",
    retirementId: `knowledge-source-retirement-${"c".repeat(64)}`,
    retiredAt: 100,
    manifestRevision: 3,
    runtimeRevision: 5,
    generatedPages: [
      { path: "Wiki/Personal/A.md", ownership: "generated", contentHash: "d".repeat(64) },
      { path: "Wiki/Personal/B.md", ownership: "generated", contentHash: "e".repeat(64) },
    ],
    ...patch,
  };
}

/** Creates one coordinator with narrow observable fake ports. */
function createHarness(
  options: {
    candidates?: KnowledgeSourceRetirementCandidateSnapshot;
    issues?: readonly KnowledgeSourceObservationRecoverableIssue[];
  } = {}
): CoordinatorHarness {
  const readCandidates = jest.fn<Promise<KnowledgeSourceRetirementCandidateSnapshot>, [string]>(
    async (_bundleId) => options.candidates ?? createCandidateSnapshot()
  );
  const retireAtomically = jest.fn<Promise<KnowledgeSourceRetirementReceipt>, [unknown]>(
    async (_command) => createRetirementReceipt()
  );
  const getSourceIssues = jest.fn(() => [...(options.issues ?? [createMissingIssue()])]);
  const assertCurrent = jest.fn<void, []>();
  const refresh = jest.fn<void, []>();
  const input: KnowledgeProductionSourceLifecycleCoordinatorInput = {
    runtime: {
      readSourceRetirementCandidates: readCandidates,
      retireSourceAtomically: retireAtomically,
    },
    getSourceIssues,
    assertCurrent,
    onGenerationRefreshRequired: refresh,
  };
  return {
    coordinator: new KnowledgeProductionSourceLifecycleCoordinator(input),
    readCandidates,
    retireAtomically,
    getSourceIssues,
    assertCurrent,
    refresh,
  };
}

/** Requires one rejected lifecycle action to expose only its stable code. */
async function expectLifecycleError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "KnowledgeSourceLifecycleError",
    code,
    message: "The Knowledge source lifecycle action could not be completed",
  });
}

describe("KnowledgeProductionSourceLifecycleCoordinator", () => {
  it("loads a deeply frozen source model by merging Runtime candidates and watcher issues", async () => {
    const blocked = createCandidate({
      sourceId: "source-2",
      sourcePath: "Sources/Personal/Blocked.pdf",
      expectedToken: TOKEN_B,
      blockers: ["bundle_review_pending"],
    });
    const harness = createHarness({
      candidates: createCandidateSnapshot([createCandidate(), blocked]),
      issues: [
        createMissingIssue(),
        {
          kind: "source_change_unsupported",
          change: "rename",
          bundleId: "personal",
          sourceId: "source-2",
        },
      ],
    });

    const model = await harness.coordinator.loadSources("personal", new AbortController().signal);

    expect(model).toEqual({
      bundleId: "personal",
      runtimeRevision: 4,
      manifestRevision: 2,
      sources: [
        expect.objectContaining({
          sourceId: "source-2",
          status: "missing",
          issueReason: "source_renamed",
          retirementBlockers: ["bundle_review_pending"],
          actions: { canCheckAgain: true, canRemove: false },
        }),
        expect.objectContaining({
          sourceId: "source-1",
          status: "missing",
          issueReason: "source_missing",
          retirementRef: TOKEN_A,
          actions: { canCheckAgain: true, canRemove: true },
        }),
      ],
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.sources)).toBe(true);
    expect(model.sources.every(Object.isFrozen)).toBe(true);
    expect(model.sources.every((source) => Object.isFrozen(source.actions))).toBe(true);
  });

  it("fails closed when watcher issues name a source absent from the atomic Runtime snapshot", async () => {
    const harness = createHarness({
      issues: [createMissingIssue({ sourceId: "unknown-source" })],
    });

    await expectLifecycleError(
      harness.coordinator.loadSources("personal", new AbortController().signal),
      "unavailable"
    );
  });

  it("check-again refreshes exactly once only for a current missing source", async () => {
    const harness = createHarness();

    await harness.coordinator.checkAgain("personal", "source-1", new AbortController().signal);

    expect(harness.refresh).toHaveBeenCalledTimes(1);

    harness.getSourceIssues.mockReturnValue([]);
    await expectLifecycleError(
      harness.coordinator.checkAgain("personal", "source-1", new AbortController().signal),
      "source_not_missing"
    );
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not expose source-file replacement authority", () => {
    const harness = createHarness();

    expect("replaceMissingSource" in harness.coordinator).toBe(false);
  });

  it("retires only after two token proofs and requests one post-commit refresh", async () => {
    const harness = createHarness();

    await expect(
      harness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "source_missing" },
        new AbortController().signal
      )
    ).resolves.toEqual({ outcome: "retired", retainedWikiPageCount: 2 });

    expect(harness.readCandidates).toHaveBeenCalledTimes(2);
    expect(harness.retireAtomically).toHaveBeenCalledTimes(1);
    expect(harness.retireAtomically.mock.calls[0]?.[0]).toEqual({
      version: 1,
      bundleId: "personal",
      sourceId: "source-1",
      expectedToken: TOKEN_A,
      reason: "source_missing",
      confirm: { keepWikiFiles: true, revokeProvenance: true, reserveIdentity: true },
    });
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("blocks retirement before the atomic port and detects token drift on reproof", async () => {
    const blockedHarness = createHarness({
      candidates: createCandidateSnapshot([
        createCandidate({
          blockers: ["forward_revision_overlay_active"],
          status: "blocked",
        }),
      ]),
    });
    await expectLifecycleError(
      blockedHarness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        new AbortController().signal
      ),
      "retirement_blocked"
    );
    expect(blockedHarness.retireAtomically).not.toHaveBeenCalled();

    const staleHarness = createHarness();
    staleHarness.readCandidates
      .mockResolvedValueOnce(createCandidateSnapshot())
      .mockResolvedValueOnce(
        createCandidateSnapshot([createCandidate({ expectedToken: TOKEN_B })], {
          runtimeRevision: 5,
        })
      );
    await expectLifecycleError(
      staleHarness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        new AbortController().signal
      ),
      "source_changed"
    );
    expect(staleHarness.retireAtomically).not.toHaveBeenCalled();
  });

  it("maps atomic Runtime conflicts to stable lifecycle errors", async () => {
    const blocked = createHarness();
    blocked.retireAtomically.mockRejectedValueOnce(
      new KnowledgeSourceRetirementConflictError("personal", "source-1", "blocked", [
        "bundle_work_active",
      ])
    );
    await expectLifecycleError(
      blocked.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        new AbortController().signal
      ),
      "retirement_blocked"
    );

    const changed = createHarness();
    changed.retireAtomically.mockRejectedValueOnce(
      new KnowledgeSourceRetirementConflictError("personal", "source-1", "state_changed")
    );
    await expectLifecycleError(
      changed.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        new AbortController().signal
      ),
      "source_changed"
    );
  });

  it("returns a committed retirement receipt when best-effort refresh throws", async () => {
    const harness = createHarness();
    harness.refresh.mockImplementation(() => {
      throw new Error("refresh transport unavailable");
    });

    await expect(
      harness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        new AbortController().signal
      )
    ).resolves.toEqual({ outcome: "retired", retainedWikiPageCount: 2 });
    expect(harness.retireAtomically).toHaveBeenCalledTimes(1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("returns a committed retirement receipt when caller cancellation follows the commit", async () => {
    const harness = createHarness();
    const abortController = new AbortController();
    harness.retireAtomically.mockImplementationOnce(async () => {
      abortController.abort();
      return createRetirementReceipt();
    });

    await expect(
      harness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        abortController.signal
      )
    ).resolves.toEqual({ outcome: "retired", retainedWikiPageCount: 2 });
    expect(harness.retireAtomically).toHaveBeenCalledTimes(1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("aborts stale generations before any read or mutation", async () => {
    const harness = createHarness();
    harness.assertCurrent.mockImplementation(() => {
      throw new Error("stale generation");
    });

    await expect(
      harness.coordinator.loadSources("personal", new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.readCandidates).not.toHaveBeenCalled();
    expect(harness.retireAtomically).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it("honors caller cancellation before retirement reaches the atomic Runtime port", async () => {
    const harness = createHarness();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      harness.coordinator.retireSource(
        "personal",
        { sourceId: "source-1", retirementRef: TOKEN_A, reason: "user_requested" },
        abortController.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.retireAtomically).not.toHaveBeenCalled();
  });

  it("uses the stable lifecycle error class for direct invalid requests", async () => {
    const harness = createHarness();

    await expect(
      harness.coordinator.checkAgain("", "source-1", new AbortController().signal)
    ).rejects.toBeInstanceOf(KnowledgeSourceLifecycleError);
  });
});
