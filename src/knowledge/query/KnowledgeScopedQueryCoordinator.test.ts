import { createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";
import type { KnowledgeVerifiedWikiSnapshot } from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import type {
  KnowledgeGroundedAnswerModelPort,
  KnowledgeGroundedAnswerRequest,
} from "@/knowledge/query/KnowledgeGroundedAnswer";
import { KnowledgeScopedLexicalRetriever } from "@/knowledge/query/KnowledgeScopedLexicalRetriever";
import type {
  KnowledgeQueryWritebackCapture,
  KnowledgeQueryWritebackSubmissionPort,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";

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
    quoteHash: createQuoteHash("The exact raw source sentence."),
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
  return { verify: jest.fn(async () => true), open: jest.fn(async () => undefined) };
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
  idFactory = createIdFactory(),
  answerModel?: KnowledgeGroundedAnswerModelPort,
  writeback?: KnowledgeQueryWritebackSubmissionPort
): KnowledgeScopedQueryCoordinator {
  return new KnowledgeScopedQueryCoordinator({
    bundleId: "personal",
    reader,
    retriever: new KnowledgeScopedLexicalRetriever(),
    citationNavigation: navigation,
    idFactory,
    ...(answerModel === undefined ? {} : { answerModel }),
    ...(writeback === undefined ? {} : { writeback }),
  });
}

/** Creates one valid strict model response bound to the captured request digest. */
function createAnswerWireOutput(
  request: Readonly<KnowledgeGroundedAnswerRequest>,
  evidenceId = "evidence-1"
): string {
  return JSON.stringify({
    version: 1,
    contextDigest: request.contextDigest,
    status: "answered",
    claims: [
      {
        claimId: "claim-1",
        kind: "source_fact",
        text: "The personal knowledge engine is grounded.",
        evidenceIds: [evidenceId],
      },
    ],
    insufficientEvidence: [],
  });
}

describe("KnowledgeScopedQueryCoordinator", () => {
  it("re-proves and captures a grounded answer without accepting a path from UI", async () => {
    const reader = createReader();
    const navigation = createNavigation();
    const generate = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );
    const submit = jest.fn<
      Promise<{ kind: "registered" }>,
      [Readonly<KnowledgeQueryWritebackCapture>, AbortSignal]
    >(async () => ({ kind: "registered" as const }));
    const coordinator = createCoordinator(
      reader,
      navigation,
      createIdFactory(),
      { generate },
      { submit }
    );
    const result = await coordinator.query(
      "personal",
      { query: "knowledge engine" },
      new AbortController().signal
    );

    await expect(
      coordinator.saveQueryToWiki(
        "personal",
        result.queryId,
        { title: "Grounded engine answer" },
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "registered" });

    expect(submit).toHaveBeenCalledTimes(1);
    const submitCall = submit.mock.calls[0];
    if (!submitCall) throw new Error("Expected one writeback submission");
    const submittedCapture = submitCall[0];
    expect(submittedCapture.bundleId).toBe("personal");
    expect(submittedCapture.captureDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(submittedCapture.sourceContent).toContain("# Grounded engine answer");
    expect(submittedCapture.sourceContent).toContain('### [1] "Sources/Raw.md"');
    expect(Reflect.ownKeys(submittedCapture)).not.toContain("sourcePath");
    expect(reader.read).toHaveBeenCalledTimes(4);
    expect(navigation.verify).toHaveBeenCalledTimes(3);
  });

  it("blocks writeback for insufficient answers, stale snapshots, and invalid title accessors", async () => {
    const noEvidenceNavigation: KnowledgeCitationNavigationPort = {
      verify: jest.fn(async () => false),
      open: jest.fn(async () => undefined),
    };
    const generate = jest.fn(async () => {
      throw new Error("must not run");
    });
    const submit = jest.fn<
      Promise<{ kind: "registered" }>,
      [Readonly<KnowledgeQueryWritebackCapture>, AbortSignal]
    >(async () => ({ kind: "registered" as const }));
    const insufficient = createCoordinator(
      createReader(),
      noEvidenceNavigation,
      createIdFactory(),
      { generate },
      { submit }
    );
    const insufficientResult = await insufficient.query(
      "personal",
      { query: "knowledge" },
      new AbortController().signal
    );
    await expect(
      insufficient.saveQueryToWiki(
        "personal",
        insufficientResult.queryId,
        { title: "Not grounded" },
        new AbortController().signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    const reader = createReader();
    const validGenerate = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );
    const stale = createCoordinator(
      reader,
      createNavigation(),
      createIdFactory(),
      { generate: validGenerate },
      { submit }
    );
    const staleResult = await stale.query(
      "personal",
      { query: "knowledge" },
      new AbortController().signal
    );
    reader.read.mockResolvedValueOnce(createSnapshot(undefined, undefined, 8));
    await expect(
      stale.saveQueryToWiki(
        "personal",
        staleResult.queryId,
        { title: "Stale answer" },
        new AbortController().signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    const titleRequest = {} as { title: string };
    Object.defineProperty(titleRequest, "title", {
      enumerable: true,
      get: () => "Accessor title",
    });
    await expect(
      stale.saveQueryToWiki(
        "personal",
        staleResult.queryId,
        titleRequest,
        new AbortController().signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    const extraFieldRequest = { title: "Hidden extra field" } as Record<PropertyKey, unknown>;
    extraFieldRequest[Symbol("extra")] = "not accepted";
    await expect(
      stale.saveQueryToWiki(
        "personal",
        staleResult.queryId,
        extraFieldRequest as unknown as { title: string },
        new AbortController().signal
      )
    ).rejects.toEqual(new KnowledgeScopedQueryError());
    expect(submit).not.toHaveBeenCalled();
  });

  it("synthesizes only from verified Wiki context plus exact source excerpts", async () => {
    const reader = createReader();
    const navigation = createNavigation();
    const generate = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );
    const result = await createCoordinator(reader, navigation, createIdFactory(), {
      generate,
    }).query("personal", { query: "knowledge engine" }, new AbortController().signal);

    expect(result).toMatchObject({
      mode: "grounded_answer",
      bundleId: "personal",
      answer: {
        status: "answered",
        claims: [
          {
            claimId: "claim-1",
            kind: "source_fact",
            text: "The personal knowledge engine is grounded.",
            citations: [
              {
                sourcePath: "Sources/Raw.md",
                citationRef: "knowledge-citation-1-1-citation2",
              },
            ],
          },
        ],
      },
    });
    const request = generate.mock.calls[0][0];
    expect(request.contexts).toEqual([
      expect.objectContaining({
        contextId: "context-1",
        pagePath: "Wiki/Durable.md",
        content: "# Durable knowledge\n\nThe personal knowledge engine is grounded.\n",
      }),
    ]);
    expect(request.evidence).toEqual([
      {
        evidenceId: "evidence-1",
        contextId: "context-1",
        sourceExcerpt: "The exact raw source sentence.",
        sourceRelation: "supports",
      },
    ]);
    expect(navigation.verify).toHaveBeenCalledTimes(2);
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns deterministic insufficiency without a model call when no source re-proves", async () => {
    const navigation: KnowledgeCitationNavigationPort = {
      verify: jest.fn(async () => false),
      open: jest.fn(async () => undefined),
    };
    const generate = jest.fn(async () => {
      throw new Error("must not run");
    });
    const result = await createCoordinator(createReader(), navigation, createIdFactory(), {
      generate,
    }).query("personal", { query: "knowledge engine" }, new AbortController().signal);

    expect(result).toMatchObject({
      mode: "grounded_answer",
      answer: { status: "insufficient_evidence", claims: [] },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed when a source citation becomes stale after model generation", async () => {
    const verify = jest
      .fn<Promise<boolean>, [KnowledgeCitationNavigationTarget, AbortSignal]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const navigation: KnowledgeCitationNavigationPort = {
      verify,
      open: jest.fn(async () => undefined),
    };
    const generate = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );

    await expect(
      createCoordinator(createReader(), navigation, createIdFactory(), {
        generate,
      }).query("personal", { query: "knowledge engine" }, new AbortController().signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    expect(generate).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("aborts a pending model generation and rejects its late answer after revocation", async () => {
    const pendingModel = deferred<string>();
    const modelStarted = deferred<void>();
    let modelRequest: Readonly<KnowledgeGroundedAnswerRequest> | undefined;
    let modelSignal: AbortSignal | undefined;
    const generate = jest.fn(
      (request: Readonly<KnowledgeGroundedAnswerRequest>, signal: AbortSignal) => {
        modelRequest = request;
        modelSignal = signal;
        modelStarted.resolve();
        return pendingModel.promise;
      }
    );
    const coordinator = createCoordinator(createReader(), createNavigation(), createIdFactory(), {
      generate,
    });
    const pending = coordinator.query(
      "personal",
      { query: "knowledge engine" },
      new AbortController().signal
    );
    await modelStarted.promise;

    coordinator.revokeCurrent("personal");
    expect(modelSignal?.aborted).toBe(true);
    if (!modelRequest) throw new Error("Expected the model request to start");
    pendingModel.resolve(createAnswerWireOutput(modelRequest));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown model evidence and post-model Wiki drift without publishing refs", async () => {
    const unknownEvidence = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request, "evidence-never-read")
    );
    await expect(
      createCoordinator(createReader(), createNavigation(), createIdFactory(), {
        generate: unknownEvidence,
      }).query("personal", { query: "knowledge" }, new AbortController().signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    const reader = createReader();
    reader.read
      .mockResolvedValueOnce(createSnapshot(undefined, undefined, 7))
      .mockResolvedValueOnce(createSnapshot(undefined, undefined, 8));
    const valid = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );
    await expect(
      createCoordinator(reader, createNavigation(), createIdFactory(), {
        generate: valid,
      }).query("personal", { query: "knowledge" }, new AbortController().signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());
  });

  it("rejects post-model citation provenance drift even when Wiki bytes stay unchanged", async () => {
    const reader = createReader();
    reader.read
      .mockResolvedValueOnce(createSnapshot())
      .mockResolvedValueOnce(createSnapshot(undefined, []));
    const generate = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      createAnswerWireOutput(request)
    );

    await expect(
      createCoordinator(reader, createNavigation(), createIdFactory(), {
        generate,
      }).query("personal", { query: "knowledge" }, new AbortController().signal)
    ).rejects.toEqual(new KnowledgeScopedQueryError());

    expect(generate).toHaveBeenCalledTimes(1);
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

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
      verify: jest.fn(async () => true),
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
      verify: jest.fn(async () => true),
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
      verify: jest.fn(async () => true),
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
