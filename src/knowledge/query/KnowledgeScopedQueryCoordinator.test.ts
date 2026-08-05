import type { ClaimCitation } from "@/knowledge/model/types";
import type { KnowledgeVerifiedWikiSnapshot } from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import { KnowledgeScopedLexicalRetriever } from "@/knowledge/query/KnowledgeScopedLexicalRetriever";

import {
  type KnowledgeAppliedWikiSnapshotReadPort,
  type KnowledgeCitationNavigationTarget,
  type KnowledgeCitationNavigationPort,
  KnowledgeScopedQueryCoordinator,
  KnowledgeScopedQueryError,
} from "./KnowledgeScopedQueryCoordinator";

const PAGE_HASH = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const CITATION: ClaimCitation = {
  citationId: "citation-1",
  claimId: "claim-1",
  relation: "supports",
  locator: {
    kind: "markdown_lines",
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: SOURCE_HASH,
    excerpt: "The exact raw source sentence.",
    quoteHash: "c".repeat(64),
    startLine: 4,
    endLine: 4,
    heading: "Evidence",
  },
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one manually settled Promise for generation-race tests. */
function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      resolvePromise?.(value);
    },
  };
}

/** Creates one exact verified Wiki snapshot with optional page content and citations. */
function createSnapshot(
  content = "# Durable knowledge\n\nThe personal knowledge engine is grounded.\n",
  citations: readonly Readonly<ClaimCitation>[] = [CITATION, CITATION],
  runtimeRevision = 7
): KnowledgeVerifiedWikiSnapshot {
  return {
    bundleId: "personal",
    runtimeRevision,
    manifestRevision: 3,
    pages: [
      {
        evidenceId: "wiki-evidence-1",
        path: "Wiki/Durable.md",
        windowsPathKey: "wiki/durable.md",
        ownership: "generated",
        contentHash: PAGE_HASH,
        content,
        sources: [
          {
            sourceId: "source-1",
            sourcePath: "Sources/Raw.md",
            custody: "user_managed",
            sourceContentHash: SOURCE_HASH,
            pipelineFingerprint: "d".repeat(64),
            inputRevision: 2,
            changeSetId: "changeset-2",
            changeSetDigest: "e".repeat(64),
            acceptedAt: 200,
            citations,
          },
        ],
      },
    ],
  };
}

/** Creates a typed reader mock returning one exact snapshot. */
function createReader(
  snapshot: KnowledgeVerifiedWikiSnapshot = createSnapshot()
): KnowledgeAppliedWikiSnapshotReadPort & { read: jest.Mock } {
  return { read: jest.fn(async () => snapshot) };
}

/** Creates a typed navigation mock. */
function createNavigation(): KnowledgeCitationNavigationPort & { open: jest.Mock } {
  return { open: jest.fn(async () => undefined) };
}

/** Creates deterministic opaque token material for coordinator tests. */
function createIdFactory(): jest.Mock<string, ["query" | "citation"]> {
  let sequence = 0;
  return jest.fn((kind: "query" | "citation") => `${kind}${++sequence}`);
}

/** Creates a coordinator with the real pure lexical retriever. */
function createCoordinator(
  reader: KnowledgeAppliedWikiSnapshotReadPort = createReader(),
  navigation: KnowledgeCitationNavigationPort = createNavigation(),
  idFactory = createIdFactory()
): KnowledgeScopedQueryCoordinator {
  return new KnowledgeScopedQueryCoordinator({
    bundleId: "personal",
    reader,
    retriever: new KnowledgeScopedLexicalRetriever(),
    citationNavigation: navigation,
    idFactory,
  });
}

describe("KnowledgeScopedQueryCoordinator", () => {
  it("returns a frozen retrieval-only result and opens exact citations through opaque refs", async () => {
    const reader = createReader();
    const navigation = createNavigation();
    const coordinator = createCoordinator(reader, navigation);

    const result = await coordinator.query(
      "personal",
      { query: "knowledge engine" },
      new AbortController().signal
    );

    expect(result).toMatchObject({
      mode: "grounded_retrieval",
      bundleId: "personal",
      queryId: "knowledge-query-1-1-query1",
      runtimeRevision: 7,
      manifestRevision: 3,
      hits: [
        {
          pageEvidenceId: "wiki-evidence-1",
          pagePath: "Wiki/Durable.md",
          pageContentHash: PAGE_HASH,
          heading: "Durable knowledge",
          snippet: "# Durable knowledge\n\nThe personal knowledge engine is grounded.\n",
          citations: [
            {
              citationRef: "knowledge-citation-1-1-citation2",
              sourceId: "source-1",
              sourcePath: "Sources/Raw.md",
              relation: "supports",
              location: {
                kind: "markdown_lines",
                startLine: 4,
                endLine: 4,
                heading: "Evidence",
              },
            },
          ],
        },
      ],
    });
    expect(result.hits[0].citations).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.hits)).toBe(true);
    expect(Object.isFrozen(result.hits[0])).toBe(true);
    expect(Object.isFrozen(result.hits[0].citations[0].location)).toBe(true);
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(navigation.open).not.toHaveBeenCalled();

    await coordinator.openCitation(
      "personal",
      result.queryId,
      result.hits[0].citations[0].citationRef,
      new AbortController().signal
    );

    expect(navigation.open).toHaveBeenCalledTimes(1);
    expect(navigation.open.mock.calls[0][0]).toEqual({
      sourcePath: "Sources/Raw.md",
      citation: CITATION,
    });
    expect(Object.isFrozen(navigation.open.mock.calls[0][0])).toBe(true);
    expect(Object.isFrozen(navigation.open.mock.calls[0][0].citation)).toBe(true);
    expect(Object.isFrozen(navigation.open.mock.calls[0][0].citation.locator)).toBe(true);
  });

  it("rejects unknown Bundle, query, and citation refs without calling navigation", async () => {
    const reader = createReader();
    const navigation = createNavigation();
    const coordinator = createCoordinator(reader, navigation);
    const signal = new AbortController().signal;

    await expect(coordinator.query("other", { query: "knowledge" }, signal)).rejects.toEqual(
      new KnowledgeScopedQueryError()
    );
    expect(reader.read).not.toHaveBeenCalled();

    const result = await coordinator.query("personal", { query: "knowledge" }, signal);
    const citationRef = result.hits[0].citations[0].citationRef;
    await expect(
      coordinator.openCitation("other", result.queryId, citationRef, signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    await expect(
      coordinator.openCitation("personal", "unknown-query", citationRef, signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    await expect(
      coordinator.openCitation("personal", result.queryId, "unknown-citation", signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    expect(navigation.open).not.toHaveBeenCalled();
  });

  it("revokes every prior query and citation ref as soon as a new query starts", async () => {
    const navigation = createNavigation();
    const coordinator = createCoordinator(
      createReader(),
      navigation,
      jest.fn((_kind: "query" | "citation") => "same-token")
    );
    const signal = new AbortController().signal;
    const first = await coordinator.query("personal", { query: "knowledge" }, signal);
    const firstCitation = first.hits[0].citations[0].citationRef;
    const second = await coordinator.query("personal", { query: "engine" }, signal);

    expect(second.queryId).not.toBe(first.queryId);
    await expect(
      coordinator.openCitation("personal", first.queryId, firstCitation, signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    await coordinator.openCitation(
      "personal",
      second.queryId,
      second.hits[0].citations[0].citationRef,
      signal
    );
    expect(navigation.open).toHaveBeenCalledTimes(1);
  });

  it("synchronously revokes ready opaque refs and remains reusable", async () => {
    const navigation = createNavigation();
    const coordinator = createCoordinator(createReader(), navigation);
    const signal = new AbortController().signal;
    const first = await coordinator.query("personal", { query: "knowledge" }, signal);
    const firstCitation = first.hits[0].citations[0].citationRef;

    expect(() => coordinator.revokeCurrent("other")).toThrow(KnowledgeScopedQueryError);
    coordinator.revokeCurrent("personal");

    await expect(
      coordinator.openCitation("personal", first.queryId, firstCitation, signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    expect(navigation.open).not.toHaveBeenCalled();

    const second = await coordinator.query("personal", { query: "engine" }, signal);
    await expect(
      coordinator.openCitation(
        "personal",
        second.queryId,
        second.hits[0].citations[0].citationRef,
        signal
      )
    ).resolves.toBeUndefined();
  });

  it("keeps the current query authorized when an old or unknown exact id is revoked", async () => {
    const navigation = createNavigation();
    const coordinator = createCoordinator(createReader(), navigation);
    const signal = new AbortController().signal;
    const first = await coordinator.query("personal", { query: "knowledge" }, signal);
    const current = await coordinator.query("personal", { query: "engine" }, signal);
    const currentCitation = current.hits[0].citations[0].citationRef;

    expect(() => coordinator.revokeCurrent("personal", first.queryId)).not.toThrow();
    expect(() => coordinator.revokeCurrent("personal", "unknown-query-id")).not.toThrow();

    await expect(
      coordinator.openCitation("personal", current.queryId, currentCitation, signal)
    ).resolves.toBeUndefined();
    expect(navigation.open).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight reader when the current capability is revoked", async () => {
    const pendingRead = deferred<KnowledgeVerifiedWikiSnapshot>();
    let readerSignal: AbortSignal | undefined;
    const reader: KnowledgeAppliedWikiSnapshotReadPort = {
      read: jest.fn((signal: AbortSignal) => {
        readerSignal = signal;
        return pendingRead.promise;
      }),
    };
    const coordinator = createCoordinator(reader);
    const pending = coordinator.query(
      "personal",
      { query: "knowledge" },
      new AbortController().signal
    );
    await Promise.resolve();

    coordinator.revokeCurrent("personal");
    expect(readerSignal?.aborted).toBe(true);
    pendingRead.resolve(createSnapshot());

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts a late reader generation and never lets it replace a newer result", async () => {
    const firstRead = deferred<KnowledgeVerifiedWikiSnapshot>();
    let firstSignal: AbortSignal | undefined;
    const reader: KnowledgeAppliedWikiSnapshotReadPort & { read: jest.Mock } = {
      read: jest
        .fn()
        .mockImplementationOnce((signal: AbortSignal) => {
          firstSignal = signal;
          return firstRead.promise;
        })
        .mockResolvedValueOnce(createSnapshot(undefined, undefined, 8)),
    };
    const coordinator = createCoordinator(reader);
    const signal = new AbortController().signal;

    const stale = coordinator.query("personal", { query: "knowledge" }, signal);
    await Promise.resolve();
    const current = await coordinator.query("personal", { query: "engine" }, signal);
    expect(firstSignal?.aborted).toBe(true);
    firstRead.resolve(createSnapshot(undefined, undefined, 7));

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(current.runtimeRevision).toBe(8);
  });

  it("propagates caller cancellation even when the reader settles late", async () => {
    const pendingRead = deferred<KnowledgeVerifiedWikiSnapshot>();
    const reader: KnowledgeAppliedWikiSnapshotReadPort = {
      read: jest.fn(() => pendingRead.promise),
    };
    const coordinator = createCoordinator(reader);
    const abort = new AbortController();
    const result = coordinator.query("personal", { query: "knowledge" }, abort.signal);

    abort.abort();
    pendingRead.resolve(createSnapshot());

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts late citation navigation when a newer query revokes its generation", async () => {
    const pendingOpen = deferred<void>();
    let navigationSignal: AbortSignal | undefined;
    const navigation: KnowledgeCitationNavigationPort & { open: jest.Mock } = {
      open: jest.fn((_target: KnowledgeCitationNavigationTarget, signal: AbortSignal) => {
        navigationSignal = signal;
        return pendingOpen.promise;
      }),
    };
    const coordinator = createCoordinator(createReader(), navigation);
    const signal = new AbortController().signal;
    const first = await coordinator.query("personal", { query: "knowledge" }, signal);
    const opening = coordinator.openCitation(
      "personal",
      first.queryId,
      first.hits[0].citations[0].citationRef,
      signal
    );
    await Promise.resolve();

    await coordinator.query("personal", { query: "engine" }, signal);
    expect(navigationSignal?.aborted).toBe(true);
    pendingOpen.resolve();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts in-flight citation navigation when its exact query id is revoked", async () => {
    const pendingOpen = deferred<void>();
    let navigationSignal: AbortSignal | undefined;
    const navigation: KnowledgeCitationNavigationPort & { open: jest.Mock } = {
      open: jest.fn((_target: KnowledgeCitationNavigationTarget, signal: AbortSignal) => {
        navigationSignal = signal;
        return pendingOpen.promise;
      }),
    };
    const coordinator = createCoordinator(createReader(), navigation);
    const signal = new AbortController().signal;
    const result = await coordinator.query("personal", { query: "knowledge" }, signal);
    const opening = coordinator.openCitation(
      "personal",
      result.queryId,
      result.hits[0].citations[0].citationRef,
      signal
    );
    await Promise.resolve();

    coordinator.revokeCurrent("personal", result.queryId);
    expect(navigationSignal?.aborted).toBe(true);
    pendingOpen.resolve();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns a frozen empty-corpus result and supports CJK retrieval", async () => {
    const emptyReader = createReader({
      bundleId: "personal",
      runtimeRevision: 1,
      manifestRevision: 0,
      pages: [],
    });
    const empty = await createCoordinator(emptyReader).query(
      "personal",
      { query: "anything" },
      new AbortController().signal
    );

    expect(empty).toMatchObject({ mode: "grounded_retrieval", hits: [] });
    expect(Object.isFrozen(empty.hits)).toBe(true);

    const chineseContent = "# 个人知识库\n\n个人知识库会持续沉淀并复利增长。\n";
    const chinese = await createCoordinator(createReader(createSnapshot(chineseContent))).query(
      "personal",
      { query: "知识复利" },
      new AbortController().signal
    );
    expect(chinese.hits).toHaveLength(1);
    expect(chinese.hits[0].snippet).toBe(chineseContent);
    expect(chinese.hits[0].heading).toBe("个人知识库");
  });

  it("rejects blank queries and all work after close", async () => {
    const reader = createReader();
    const coordinator = createCoordinator(reader);
    const signal = new AbortController().signal;

    await expect(coordinator.query("personal", { query: "   " }, signal)).rejects.toEqual(
      new KnowledgeScopedQueryError()
    );
    expect(reader.read).not.toHaveBeenCalled();

    const result = await coordinator.query("personal", { query: "knowledge" }, signal);
    coordinator.close();
    await expect(coordinator.query("personal", { query: "engine" }, signal)).rejects.toEqual(
      new KnowledgeScopedQueryError()
    );
    await expect(
      coordinator.openCitation(
        "personal",
        result.queryId,
        result.hits[0].citations[0].citationRef,
        signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());
  });

  it("sanitizes reader and navigation failures without retaining their causes", async () => {
    const reader: KnowledgeAppliedWikiSnapshotReadPort = {
      read: jest.fn(async () => {
        throw new Error("C:/private/Vault/Wiki/Secret.md");
      }),
    };
    const coordinator = createCoordinator(reader);
    const signal = new AbortController().signal;

    await expect(coordinator.query("personal", { query: "secret" }, signal)).rejects.toEqual(
      new KnowledgeScopedQueryError()
    );

    const navigation: KnowledgeCitationNavigationPort = {
      open: jest.fn(async () => {
        throw new Error("Sources/Raw.md: exact locator failed");
      }),
    };
    const navigable = createCoordinator(createReader(), navigation);
    const result = await navigable.query("personal", { query: "knowledge" }, signal);
    await expect(
      navigable.openCitation(
        "personal",
        result.queryId,
        result.hits[0].citations[0].citationRef,
        signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());
  });
});
