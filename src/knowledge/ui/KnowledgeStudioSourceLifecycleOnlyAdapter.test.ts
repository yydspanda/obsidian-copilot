import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import {
  KnowledgeStudioAdapterUnavailableError,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";
import { KnowledgeStudioSourceLifecycleOnlyAdapter } from "@/knowledge/ui/KnowledgeStudioSourceLifecycleOnlyAdapter";
import {
  createKnowledgeSourceLifecycleModel,
  type KnowledgeSourceLifecycleModel,
} from "@/knowledge/ui/sourceLifecycleModel";

const RETIREMENT_REF = "a".repeat(64);

/** Creates one strict missing-source projection with configurable durable blockers. */
function createModel(
  blockers: readonly ("active_transaction" | "bundle_review_pending")[] = []
): Readonly<KnowledgeSourceLifecycleModel> {
  return createKnowledgeSourceLifecycleModel({
    bundleId: "personal",
    runtimeRevision: 17,
    manifestRevision: 4,
    sources: [
      {
        sourceId: "source-1",
        sourcePath: "Sources/missing.md",
        custody: "user_managed",
        generatedPageCount: 3,
        retirementRef: RETIREMENT_REF,
        retirementBlockers: blockers,
        status: "missing",
        issueReason: "source_missing",
        actions: { canCheckAgain: true, canRemove: blockers.length === 0 },
      },
    ],
  });
}

/** Creates observable least-authority lifecycle methods for adapter tests. */
function createLifecycle(
  model: Readonly<KnowledgeSourceLifecycleModel> = createModel()
): KnowledgeSourceLifecyclePort & {
  loadSources: jest.Mock;
  checkAgain: jest.Mock;
  retireSource: jest.Mock;
} {
  return {
    loadSources: jest.fn(async () => model),
    checkAgain: jest.fn(async () => undefined),
    retireSource: jest.fn(async () => ({ outcome: "retired" as const, retainedWikiPageCount: 3 })),
  };
}

describe("KnowledgeStudioSourceLifecycleOnlyAdapter", () => {
  it("opens Sources with exact Runtime/Manifest authority and no workflow capabilities", async () => {
    const lifecycle = createLifecycle(createModel(["active_transaction", "bundle_review_pending"]));
    const adapter = new KnowledgeStudioSourceLifecycleOnlyAdapter({
      bundleId: "personal",
      sourceLifecycle: lifecycle,
      assertCurrent: jest.fn(),
    });

    const snapshot = await adapter.load("personal", new AbortController().signal);

    expect(snapshot).toMatchObject({
      bundleId: "personal",
      availability: "ready",
      preferredTab: "sources",
      queryAvailable: false,
      queryWritebackAvailable: false,
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
      },
      sourceLifecycle: { runtimeRevision: 17, manifestRevision: 4 },
    });
    expect(snapshot.revisionToken).toMatch(/^knowledge-source-lifecycle-[a-f0-9]{64}$/);
    expect(snapshot.sourceLifecycle?.sources[0]).toMatchObject({
      status: "missing",
      retirementBlockers: ["active_transaction", "bundle_review_pending"],
      actions: { canCheckAgain: true, canRemove: false },
    });
    expect(snapshot.activity.items).toEqual([]);
    expect(snapshot.reviews).toEqual([]);
    expect(snapshot.recovery.items).toEqual([]);
    expect(snapshot.notice).toContain("model");
    expect(snapshot.notice).toContain("Wiki writes remain stopped");
    expect(Object.keys(adapter)).toEqual([]);
    expect(Object.isFrozen(adapter)).toBe(true);
    expect("query" in adapter).toBe(false);
    expect("saveQueryToWiki" in adapter).toBe(false);
  });

  it("delegates only recheck and atomic retirement while every ordinary command rejects", async () => {
    const lifecycle = createLifecycle();
    const adapter = new KnowledgeStudioSourceLifecycleOnlyAdapter({
      bundleId: "personal",
      sourceLifecycle: lifecycle,
      assertCurrent: jest.fn(),
    });
    const signal = new AbortController().signal;
    const request: KnowledgeSourceRetirementRequest = {
      sourceId: "source-1",
      retirementRef: RETIREMENT_REF,
      reason: "source_missing",
    };

    await expect(adapter.checkAgain("personal", "source-1", signal)).resolves.toBeUndefined();
    await expect(adapter.retireSource("personal", request, signal)).resolves.toEqual({
      outcome: "retired",
      retainedWikiPageCount: 3,
    });
    await expect(adapter.pauseBundle("personal", 1, signal)).rejects.toBeInstanceOf(
      KnowledgeStudioAdapterUnavailableError
    );
    await expect(
      adapter.submitReview(
        "personal",
        {
          changeSetId: "change-1",
          proposalDigest: "digest-1",
          expectedSnapshotToken: "snapshot-1",
          decisions: [],
        },
        signal
      )
    ).rejects.toBeInstanceOf(KnowledgeStudioAdapterUnavailableError);
    expect(lifecycle.checkAgain).toHaveBeenCalledTimes(1);
    expect(lifecycle.retireSource).toHaveBeenCalledWith("personal", request, signal);
  });

  it("aborts stale delegated work when a new Studio generation replaces it", async () => {
    let resolveLoad!: (value: Readonly<KnowledgeSourceLifecycleModel>) => void;
    const pending = new Promise<Readonly<KnowledgeSourceLifecycleModel>>((resolve) => {
      resolveLoad = resolve;
    });
    const lifecycle = createLifecycle();
    lifecycle.loadSources.mockImplementation(async () => pending);
    const adapter = new KnowledgeStudioSourceLifecycleOnlyAdapter({
      bundleId: "personal",
      sourceLifecycle: lifecycle,
      assertCurrent: jest.fn(),
    });
    const port = new DelegatingKnowledgeStudioPort();
    port.replaceDelegate(adapter);

    const load = port.load("personal", new AbortController().signal);
    await Promise.resolve();
    port.replaceDelegate(new UnavailableKnowledgeStudioPort("next generation"));
    resolveLoad(createModel());

    await expect(load).rejects.toMatchObject({ name: "AbortError" });
  });
});
