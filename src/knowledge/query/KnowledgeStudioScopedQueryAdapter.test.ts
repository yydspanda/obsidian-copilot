jest.mock("obsidian", () => ({}));

const mockNavigate = jest.fn<
  Promise<{ status: "opened" }>,
  [request: unknown, signal?: AbortSignal]
>(async () => ({ status: "opened" }));
const mockVerify = jest.fn<
  Promise<{ status: "verified" }>,
  [request: unknown, signal?: AbortSignal]
>(async () => ({ status: "verified" }));

jest.mock("@/knowledge/query/ObsidianKnowledgeCitationNavigator", () => ({
  ObsidianKnowledgeCitationNavigator: class TestKnowledgeCitationNavigator {
    /** Captures no platform authority in the isolated adapter test. */
    constructor(_app: unknown) {}

    /** Forwards exact navigation requests to the test spy. */
    navigate(request: unknown, signal?: AbortSignal) {
      return mockNavigate(request, signal);
    }

    /** Forwards exact no-mutation verification requests to the test spy. */
    verify(request: unknown, signal?: AbortSignal) {
      return mockVerify(request, signal);
    }
  },
}));

import type { App } from "obsidian";

import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import {
  bindKnowledgePrivateModelRoute,
  KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import {
  createKnowledgeProductionModelRouteLeaseOwner,
  type KnowledgeProductionModelRouteLeaseOwner,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import type { KnowledgeGroundedAnswerRequest } from "@/knowledge/query/KnowledgeGroundedAnswer";
import { bindKnowledgeGroundedAnswerModelRoute } from "@/knowledge/query/KnowledgeGroundedAnswerModelRoute";
import type { KnowledgeRuntimeAppliedProvenanceSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  createKnowledgeQueryIdFactory,
  KnowledgeStudioScopedQueryAdapter,
  type KnowledgeQuerySecureRandomPort,
} from "@/knowledge/query/KnowledgeStudioScopedQueryAdapter";
import { sha256 } from "@/utils/hash";

const PAGE_CONTENT = "# Applied knowledge\nGrounded evidence lives here.\n";
const SOURCE_PATH = "Sources/personal/Evidence.md";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates one externally settled promise for close-race assertions. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates one strict Bundle fixture for a distinct source and Wiki root. */
function createBundle(id: string): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: [`Sources/${id}`],
    wikiRoot: `Wiki/${id}`,
    schemaRef: `Schemas/${id}.md`,
    reviewMode: "always",
  };
}

/** Creates deterministic byte-filling Web Crypto authority for opaque-id tests. */
function createSecureRandom(): KnowledgeQuerySecureRandomPort {
  let sequence = 0;
  return {
    getRandomValues: ((array: ArrayBufferView | null) => {
      if (!(array instanceof Uint8Array)) throw new Error("Expected Uint8Array");
      sequence += 1;
      array.fill(sequence);
      return array;
    }) as Crypto["getRandomValues"],
  };
}

/** Creates one empty atomic applied-provenance projection. */
function createEmptyProjection(bundleId: string): KnowledgeRuntimeAppliedProvenanceSnapshot {
  return {
    bundleId,
    runtimeRevision: 3,
    manifestRevision: 2,
    pages: [],
  };
}

/** Creates one exact source-backed applied Wiki projection. */
function createAppliedProjection(
  sourcePath = SOURCE_PATH,
  bundleId = "personal"
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  const pagePath = `Wiki/${bundleId}/Applied.md`;
  const sourceId = `source-${bundleId}`;
  return {
    bundleId,
    runtimeRevision: 7,
    manifestRevision: 4,
    pages: [
      {
        path: pagePath,
        windowsPathKey: pagePath.toLocaleLowerCase("en-US"),
        ownership: "generated",
        contentHash: sha256(PAGE_CONTENT),
        sources: [
          {
            sourceId,
            sourcePath,
            custody: "user_managed",
            sourceContentHash: "a".repeat(64),
            pipelineFingerprint: "b".repeat(64),
            inputRevision: 1,
            changeSetId: "changeset-1",
            changeSetDigest: "c".repeat(64),
            acceptedAt: 1,
            citations: [
              {
                citationId: "citation-1",
                claimId: "claim-1",
                relation: "supports",
                locator: {
                  kind: "markdown_lines",
                  sourceId,
                  artifactId: "artifact-1",
                  artifactContentHash: "d".repeat(64),
                  excerpt: "Grounded evidence",
                  quoteHash: "e".repeat(64),
                  startLine: 1,
                  endLine: 1,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Creates an exact resolver that returns the immutable Wiki fixture. */
function createTargetResolver(): jest.Mocked<CompilerTargetResolver> {
  return {
    resolve: jest.fn(async (requests: readonly CompilerTargetRequest[], _signal: AbortSignal) =>
      requests.map((request) => ({
        targetId: request.targetId,
        kind: "file" as const,
        path: request.path,
        content: PAGE_CONTENT,
      }))
    ),
  };
}

/** Creates the platform owner whose navigator behavior is mocked above. */
function createApp(): App {
  return { vault: {}, workspace: {} } as unknown as App;
}

/** Creates an authentic production lease owner with an isolated fake answer transport. */
function createAnswerRouteOwner(
  bundleId: string,
  invoke: (
    request: Readonly<KnowledgeGroundedAnswerRequest>,
    signal: AbortSignal
  ) => Promise<string>
): KnowledgeProductionModelRouteLeaseOwner {
  const route = bindKnowledgePrivateModelRoute(
    {
      provider: "test-provider",
      model: "test-model",
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
        streaming: false,
        modelFallback: false,
      },
    },
    async () => "{}"
  );
  const answerRoute = bindKnowledgeGroundedAnswerModelRoute(bundleId, invoke);
  return createKnowledgeProductionModelRouteLeaseOwner([{ bundleId, route, answerRoute }]);
}

describe("KnowledgeStudioScopedQueryAdapter", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockNavigate.mockResolvedValue({ status: "opened" });
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ status: "verified" });
  });

  it("creates 128-bit browser-safe opaque tokens from Web Crypto bytes", () => {
    const secureRandom = createSecureRandom();
    const idFactory = createKnowledgeQueryIdFactory(secureRandom);

    expect(idFactory("query")).toBe("01".repeat(16));
    expect(idFactory("citation")).toBe("02".repeat(16));
  });

  it("routes every configured Bundle through only its atomic applied-Wiki projection", async () => {
    const readAppliedProvenance = jest.fn(async (bundleId: string) =>
      createEmptyProjection(bundleId)
    );
    const resolver = createTargetResolver();
    const assertCurrent = jest.fn();
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance },
      bundles: [createBundle("personal"), createBundle("work")],
      targetResolver: resolver,
      assertCurrent,
      secureRandom: createSecureRandom(),
    });

    await expect(
      adapter.query("personal", { query: "evidence" }, new AbortController().signal)
    ).resolves.toMatchObject({
      mode: "grounded_retrieval",
      bundleId: "personal",
      runtimeRevision: 3,
      manifestRevision: 2,
      hits: [],
    });
    await expect(
      adapter.query("work", { query: "evidence" }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "work", hits: [] });

    expect(readAppliedProvenance.mock.calls.map(([bundleId]) => bundleId)).toEqual([
      "personal",
      "personal",
      "work",
      "work",
    ]);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve.mock.calls.every(([requests]) => requests.length === 0)).toBe(true);
    expect(assertCurrent).toHaveBeenCalled();
    await expect(
      adapter.query("unknown", { query: "evidence" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
  });

  it("uses the exact Bundle lease to synthesize from source-reproved evidence", async () => {
    const answerInvoke = jest.fn(async (request: Readonly<KnowledgeGroundedAnswerRequest>) =>
      JSON.stringify({
        version: 1,
        contextDigest: request.contextDigest,
        status: "answered",
        claims: [
          {
            claimId: "claim-grounded",
            kind: "source_fact",
            text: "Grounded evidence lives here.",
            evidenceIds: ["evidence-1"],
          },
        ],
        insufficientEvidence: [],
      })
    );
    const owner = createAnswerRouteOwner("personal", answerInvoke);
    const readAppliedProvenance = jest.fn(async () => createAppliedProjection());
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance },
      bundles: [createBundle("personal")],
      targetResolver: createTargetResolver(),
      modelRouteLease: owner.getLease(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });

    try {
      await expect(
        adapter.query("personal", { query: "grounded" }, new AbortController().signal)
      ).resolves.toMatchObject({
        mode: "grounded_answer",
        bundleId: "personal",
        answer: {
          status: "answered",
          claims: [
            {
              claimId: "claim-grounded",
              kind: "source_fact",
              citations: [expect.objectContaining({ sourcePath: SOURCE_PATH })],
            },
          ],
        },
      });
      expect(answerInvoke).toHaveBeenCalledTimes(1);
      expect(answerInvoke.mock.calls[0][0].contexts[0].content).toBe(PAGE_CONTENT);
      expect(answerInvoke.mock.calls[0][0].evidence).toEqual([
        expect.objectContaining({ sourceExcerpt: "Grounded evidence" }),
      ]);
      expect(mockVerify).toHaveBeenCalledTimes(2);
      expect(readAppliedProvenance).toHaveBeenCalledTimes(4);
    } finally {
      adapter.close();
      owner.close();
    }
  });

  it("opens only current opaque citations whose source remains inside the Bundle roots", async () => {
    const projection = createAppliedProjection();
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance: jest.fn(async () => projection) },
      bundles: [createBundle("personal")],
      targetResolver: createTargetResolver(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });
    const signal = new AbortController().signal;
    const result = await adapter.query("personal", { query: "grounded" }, signal);
    const citation = result.hits[0]?.citations[0];
    if (!citation) throw new Error("Expected one grounded citation");

    await expect(
      adapter.openCitation("personal", result.queryId, citation.citationRef, signal)
    ).resolves.toBeUndefined();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: SOURCE_PATH }),
      signal
    );

    await expect(
      adapter.openCitation("personal", result.queryId, "forged-reference", signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
  });

  it("refuses provenance source paths outside the configured Bundle roots", async () => {
    const projection = createAppliedProjection("Sources/other/Private.md");
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance: jest.fn(async () => projection) },
      bundles: [createBundle("personal")],
      targetResolver: createTargetResolver(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });
    const signal = new AbortController().signal;
    const result = await adapter.query("personal", { query: "grounded" }, signal);
    const citation = result.hits[0]?.citations[0];
    if (!citation) throw new Error("Expected one grounded citation");

    await expect(
      adapter.openCitation("personal", result.queryId, citation.citationRef, signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("revokes only the selected Bundle and fails closed for an unknown Bundle", async () => {
    const readAppliedProvenance = jest.fn(async (bundleId: string) =>
      createAppliedProjection(`Sources/${bundleId}/Evidence.md`, bundleId)
    );
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance },
      bundles: [createBundle("personal"), createBundle("work")],
      targetResolver: createTargetResolver(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });
    const signal = new AbortController().signal;
    const personal = await adapter.query("personal", { query: "grounded" }, signal);
    const work = await adapter.query("work", { query: "grounded" }, signal);
    const personalCitation = personal.hits[0]?.citations[0];
    const workCitation = work.hits[0]?.citations[0];
    if (!personalCitation || !workCitation) throw new Error("Expected Bundle citations");

    adapter.revokeCurrent("personal", personal.queryId);

    await expect(
      adapter.openCitation("personal", personal.queryId, personalCitation.citationRef, signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
    await expect(
      adapter.openCitation("work", work.queryId, workCitation.citationRef, signal)
    ).resolves.toBeUndefined();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(() => adapter.revokeCurrent("unknown")).toThrow("grounded knowledge query");
  });

  it("makes repeated exact revocation, Bundle revocation, and close idempotent", async () => {
    const projection = createAppliedProjection();
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance: jest.fn(async () => projection) },
      bundles: [createBundle("personal")],
      targetResolver: createTargetResolver(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });
    const result = await adapter.query(
      "personal",
      { query: "grounded" },
      new AbortController().signal
    );

    expect(() => adapter.revokeCurrent("personal", result.queryId)).not.toThrow();
    expect(() => adapter.revokeCurrent("personal", result.queryId)).not.toThrow();
    expect(() => adapter.revokeCurrent("personal")).not.toThrow();
    expect(() => adapter.revokeCurrent("personal")).not.toThrow();
    expect(() => adapter.close()).not.toThrow();
    expect(() => adapter.close()).not.toThrow();
  });

  it("aborts in-flight retrieval and permanently revokes issued coordinators on close", async () => {
    const deferred = createDeferred<KnowledgeRuntimeAppliedProvenanceSnapshot>();
    const adapter = new KnowledgeStudioScopedQueryAdapter({
      app: createApp(),
      runtime: { readAppliedProvenance: jest.fn(() => deferred.promise) },
      bundles: [createBundle("personal")],
      targetResolver: createTargetResolver(),
      assertCurrent: jest.fn(),
      secureRandom: createSecureRandom(),
    });
    const pending = adapter.query("personal", { query: "grounded" }, new AbortController().signal);

    adapter.close();
    deferred.resolve(createEmptyProjection("personal"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      adapter.query("personal", { query: "grounded" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeScopedQueryError" });
  });
});
