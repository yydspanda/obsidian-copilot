import { DelegatingKnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/DelegatingKnowledgeAppliedWikiPageInspectorPort";
import type {
  KnowledgeAppliedWikiPageInspectionSession,
  KnowledgeAppliedWikiPageInspectorPort,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPathIndex } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import {
  tryPublishKnowledgeAppliedWikiPageInspectorGeneration,
  type KnowledgeAppliedWikiPageInspectorPublicationDelegate,
} from "@/knowledge/startup/KnowledgeAppliedWikiPageInspectorPublication";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/** Creates one externally settled Promise for post-list lifecycle races. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates one frozen inspector session for publication routing tests. */
function createSession(): Readonly<KnowledgeAppliedWikiPageInspectionSession> {
  return Object.freeze({
    pageRef: "a".repeat(64),
    displayPagePath: "Wiki/Topic.md",
    ownership: "generated",
    sourceAppliedContentHash: "d".repeat(64),
    effectiveContentHash: "d".repeat(64),
    origin: Object.freeze({ kind: "source_apply" as const }),
    evidenceScope: "source_applied_content",
    sources: Object.freeze([
      Object.freeze({
        sourceRef: "b".repeat(64),
        displaySourcePath: "Sources/Topic.md",
        custody: "user_managed" as const,
        acceptedAt: 1,
        evidence: Object.freeze([]),
        omittedEvidenceCount: 0,
      }),
    ]),
    omittedSourceCount: 0,
  });
}

/** Creates one optional publication delegate with a configurable row-list result. */
function createDelegate(
  listRows: KnowledgeAppliedWikiPageInspectorPublicationDelegate["listAppliedWikiPathIndexRows"]
): KnowledgeAppliedWikiPageInspectorPublicationDelegate {
  const session = createSession();
  return Object.freeze({
    inspectPage: async () => session,
    openEvidence: async () => Object.freeze({ kind: "unavailable" as const }),
    listAppliedWikiPathIndexRows: listRows,
  });
}

/** Creates stable surfaces and exact conditional publication callbacks. */
function createHarness(delegate: KnowledgeAppliedWikiPageInspectorPublicationDelegate) {
  const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
  const index = new KnowledgeAppliedWikiPathIndex();
  let invalidation = (): void => undefined;
  let current = true;
  const closePresentations = jest.fn();
  const input = {
    signal: new AbortController().signal,
    createDelegate: () => delegate,
    subscribeInvalidation: (listener: () => void) => {
      invalidation = listener;
      return () => undefined;
    },
    replaceDelegate: (next: KnowledgeAppliedWikiPageInspectorPort) => port.replaceDelegate(next),
    revokeDelegate: (next: KnowledgeAppliedWikiPageInspectorPort) => port.revokeDelegate(next),
    installPathIndex: (rows: Parameters<KnowledgeAppliedWikiPathIndex["install"]>[0]) =>
      index.install(rows),
    revokePathIndex: (lease: Parameters<KnowledgeAppliedWikiPathIndex["revoke"]>[0]) =>
      index.revoke(lease),
    assertCurrent: () => {
      if (!current) throw new DOMException("aborted", "AbortError");
    },
    closePresentations,
  };
  return {
    port,
    index,
    input,
    closePresentations,
    invalidate: () => invalidation(),
    makeStale: () => {
      current = false;
    },
  };
}

describe("tryPublishKnowledgeAppliedWikiPageInspectorGeneration", () => {
  it("publishes matching surfaces and revokes both plus presentations on invalidation", async () => {
    const pagePath = "Wiki/Topic.md";
    const delegate = createDelegate(async () =>
      Object.freeze([Object.freeze({ bundleId: "personal", pagePath })])
    );
    const harness = createHarness(delegate);

    const generation = await tryPublishKnowledgeAppliedWikiPageInspectorGeneration(harness.input);

    expect(generation).toBeDefined();
    expect(harness.index.lookupExact(pagePath)).toEqual([{ bundleId: "personal", pagePath }]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath }), harness.input.signal)
    ).resolves.toEqual(createSession());

    harness.invalidate();
    expect(harness.index.lookupExact(pagePath)).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.closePresentations).toHaveBeenCalledTimes(1);
    generation?.close();
  });

  it("contains a local row-list failure so ordinary Studio and worker release can continue", async () => {
    const delegate = createDelegate(async () => {
      throw new Error("local optional failure");
    });
    const harness = createHarness(delegate);
    const publishStudio = jest.fn();
    const startWorker = jest.fn();

    await expect(
      tryPublishKnowledgeAppliedWikiPageInspectorGeneration(harness.input)
    ).resolves.toBeUndefined();
    publishStudio();
    startWorker();

    expect(publishStudio).toHaveBeenCalledTimes(1);
    expect(startWorker).toHaveBeenCalledTimes(1);
    expect(harness.index.lookupExact("Wiki/Topic.md")).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath: "Wiki/Topic.md" }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.closePresentations).toHaveBeenCalledTimes(1);
  });

  it("contains a local delegate-creation failure while the outer generation is current", async () => {
    const harness = createHarness(createDelegate(async () => Object.freeze([])));
    const input = {
      ...harness.input,
      createDelegate: () => {
        throw new Error("local optional failure");
      },
    };

    await expect(
      tryPublishKnowledgeAppliedWikiPageInspectorGeneration(input)
    ).resolves.toBeUndefined();
    expect(harness.index.lookupExact("Wiki/Topic.md")).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath: "Wiki/Topic.md" }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("contains a local lease-install failure without publishing a partial surface", async () => {
    const delegate = createDelegate(async () =>
      Object.freeze([Object.freeze({ bundleId: "personal", pagePath: "Wiki/Topic.md" })])
    );
    const harness = createHarness(delegate);
    const input = {
      ...harness.input,
      installPathIndex: () => {
        throw new Error("local optional failure");
      },
    };

    await expect(
      tryPublishKnowledgeAppliedWikiPageInspectorGeneration(input)
    ).resolves.toBeUndefined();
    expect(harness.index.lookupExact("Wiki/Topic.md")).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath: "Wiki/Topic.md" }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("propagates cancellation when the outer production generation becomes stale", async () => {
    const delegate = createDelegate(async () => {
      throw new Error("local failure during stale generation");
    });
    const harness = createHarness(delegate);
    harness.makeStale();

    await expect(
      tryPublishKnowledgeAppliedWikiPageInspectorGeneration(harness.input)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not publish when the startup signal aborts after the asynchronous row list", async () => {
    const rows = createDeferred<readonly []>();
    const delegate = createDelegate(() => rows.promise);
    const harness = createHarness(delegate);
    const controller = new AbortController();
    const input = { ...harness.input, signal: controller.signal };

    const publication = tryPublishKnowledgeAppliedWikiPageInspectorGeneration(input);
    controller.abort();
    rows.resolve(Object.freeze([]));

    await expect(publication).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.index.lookupExact("Wiki/Topic.md")).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath: "Wiki/Topic.md" }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not publish when outer authority becomes stale after the asynchronous row list", async () => {
    const rows = createDeferred<readonly []>();
    const delegate = createDelegate(() => rows.promise);
    const harness = createHarness(delegate);

    const publication = tryPublishKnowledgeAppliedWikiPageInspectorGeneration(harness.input);
    harness.makeStale();
    rows.resolve(Object.freeze([]));

    await expect(publication).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.index.lookupExact("Wiki/Topic.md")).toEqual([]);
    await expect(
      harness.port.inspectPage(Object.freeze({ pagePath: "Wiki/Topic.md" }), harness.input.signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
