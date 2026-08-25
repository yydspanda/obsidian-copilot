import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import type { KnowledgeRuntimeAppliedProvenanceSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { sha256 } from "@/utils/hash";

import {
  KnowledgeAppliedWikiSnapshotReadError,
  KnowledgeAppliedWikiSnapshotReader,
  type KnowledgeAppliedProvenanceReadPort,
} from "./KnowledgeAppliedWikiSnapshotReader";

const PAGE_CONTENT = "# Durable knowledge\n\nThe accepted fact is grounded.\n";
const PAGE_HASH = sha256(PAGE_CONTENT);
const FORWARD_CONTENT = "# Durable knowledge\n\nThe manually revised wording is current.\n";
const FORWARD_HASH = sha256(FORWARD_CONTENT);
const ADJACENT_CONTENT = "# Adjacent knowledge\n\nA later source fact.\n";
const ADJACENT_HASH = sha256(ADJACENT_CONTENT);
const SOURCE_HASH = sha256("raw source");
const LATER_SOURCE_HASH = sha256("later raw source");
const PIPELINE_HASH = sha256("pipeline");

const BUNDLE: KnowledgeBundleConfig = {
  version: 1,
  id: "personal",
  sourceRoots: ["Sources"],
  wikiRoot: "Wiki",
  schemaRef: "Schema/knowledge.md",
  reviewMode: "always",
};

/** Creates one current applied provenance projection for reader tests. */
function createProjection(
  runtimeRevision = 7,
  overrides: Partial<KnowledgeRuntimeAppliedProvenanceSnapshot> = {}
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  return {
    bundleId: "personal",
    runtimeRevision,
    manifestRevision: 3,
    pages: [
      {
        path: "Wiki/Durable.md",
        windowsPathKey: "wiki/durable.md",
        ownership: "generated",
        sourceAppliedContentHash: PAGE_HASH,
        effectiveContentHash: PAGE_HASH,
        contentHash: PAGE_HASH,
        origin: { kind: "source_apply" },
        sources: [
          {
            sourceId: "source-1",
            sourcePath: "Sources/Raw.md",
            custody: "user_managed",
            sourceContentHash: SOURCE_HASH,
            pipelineFingerprint: PIPELINE_HASH,
            inputRevision: 2,
            changeSetId: "changeset-2",
            changeSetDigest: sha256("changeset"),
            acceptedAt: 200,
            citations: [
              {
                citationId: "citation-1",
                claimId: "claim-1",
                relation: "supports",
                locator: {
                  kind: "markdown_lines",
                  sourceId: "source-1",
                  artifactId: "artifact-1",
                  artifactContentHash: SOURCE_HASH,
                  excerpt: "raw source",
                  quoteHash: sha256("raw source"),
                  startLine: 1,
                  endLine: 1,
                },
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** Creates one typed Runtime port backed by a Jest implementation. */
function createRuntime(
  implementation: () => Promise<KnowledgeRuntimeAppliedProvenanceSnapshot>
): KnowledgeAppliedProvenanceReadPort & { readAppliedProvenance: jest.Mock } {
  return { readAppliedProvenance: jest.fn(implementation) };
}

/** Creates one resolver that echoes exact file observations for requested pages. */
function createResolver(content = PAGE_CONTENT): CompilerTargetResolver & { resolve: jest.Mock } {
  return {
    resolve: jest.fn(async (requests: readonly CompilerTargetRequest[]) =>
      requests.map((request) => ({
        targetId: request.targetId,
        kind: "file" as const,
        path: request.path,
        content,
      }))
    ),
  };
}

describe("KnowledgeAppliedWikiSnapshotReader", () => {
  it("publishes only exact hash-verified applied pages from a stable Runtime sandwich", async () => {
    const runtime = createRuntime(async () => createProjection());
    let capturedRequests: readonly CompilerTargetRequest[] = [];
    const resolver: CompilerTargetResolver & { resolve: jest.Mock } = {
      resolve: jest.fn(async (requests: readonly CompilerTargetRequest[]) => {
        capturedRequests = requests;
        return requests.map((request) => ({
          targetId: request.targetId,
          kind: "file" as const,
          path: request.path,
          content: PAGE_CONTENT,
        }));
      }),
    };
    const assertCurrent = jest.fn();
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent,
    });

    const result = await reader.read(new AbortController().signal);

    expect(runtime.readAppliedProvenance).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].targetId).toMatch(/^wiki-[a-f0-9]{64}$/);
    expect(capturedRequests[0]).toEqual({
      targetId: capturedRequests[0].targetId,
      path: "Wiki/Durable.md",
      intent: "write",
      access: "authorized",
    });
    expect(result).toMatchObject({
      bundleId: "personal",
      runtimeRevision: 7,
      manifestRevision: 3,
      pages: [
        {
          path: "Wiki/Durable.md",
          sourceAppliedContentHash: PAGE_HASH,
          effectiveContentHash: PAGE_HASH,
          contentHash: PAGE_HASH,
          origin: { kind: "source_apply" },
          content: PAGE_CONTENT,
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.pages)).toBe(true);
    expect(Object.isFrozen(result.pages[0].sources[0].citations[0].locator)).toBe(true);
    expect(assertCurrent).toHaveBeenCalledTimes(4);
  });

  it("retains a Forward effective page after a later same-source Apply touches another page", async () => {
    const base = createProjection();
    const baseSource = base.pages[0].sources[0];
    const historicalSource = {
      ...baseSource,
      inputRevision: 1,
      changeSetId: "changeset-historical-base",
      changeSetDigest: sha256("historical changeset"),
      acceptedAt: 100,
    };
    const laterSource = {
      ...baseSource,
      sourceContentHash: LATER_SOURCE_HASH,
      inputRevision: 3,
      changeSetId: "changeset-adjacent",
      changeSetDigest: sha256("adjacent changeset"),
      acceptedAt: 400,
      citations: baseSource.citations.map((citation) => ({
        ...citation,
        citationId: "citation-adjacent",
        claimId: "claim-adjacent",
        locator: {
          ...citation.locator,
          artifactContentHash: LATER_SOURCE_HASH,
          excerpt: "later raw source",
          quoteHash: sha256("later raw source"),
        },
      })),
    };
    const forwardPage = {
      ...base.pages[0],
      sources: [historicalSource],
      effectiveContentHash: FORWARD_HASH,
      contentHash: FORWARD_HASH,
      origin: {
        kind: "forward_revision" as const,
        overlay: {
          version: 2 as const,
          kind: "forward_revision_overlay_entry" as const,
          bundleId: "personal",
          pagePath: "Wiki/Durable.md",
          windowsPathKey: "wiki/durable.md",
          sourceId: "source-1",
          sourceBaseDigest: sha256("source-base"),
          sourceAppliedContentHash: PAGE_HASH,
          previousEffectiveContentHash: PAGE_HASH,
          effectiveContentHash: FORWARD_HASH,
          forwardTransactionId: "forward-1",
          acceptedDecisionDigest: sha256("decision"),
          forwardLedgerIdentityDigest: sha256("ledger"),
          appliedAt: 300,
        },
      },
    };
    const projection = createProjection(7, {
      manifestRevision: 5,
      pages: [
        {
          ...base.pages[0],
          path: "Wiki/Adjacent.md",
          windowsPathKey: "wiki/adjacent.md",
          sourceAppliedContentHash: ADJACENT_HASH,
          effectiveContentHash: ADJACENT_HASH,
          contentHash: ADJACENT_HASH,
          sources: [laterSource],
        },
        forwardPage,
      ],
    });
    const runtime = createRuntime(async () => projection);
    const resolver: CompilerTargetResolver & { resolve: jest.Mock } = {
      resolve: jest.fn(async (requests: readonly CompilerTargetRequest[]) =>
        requests.map((request) => ({
          targetId: request.targetId,
          kind: "file" as const,
          path: request.path,
          content: request.path === "Wiki/Durable.md" ? FORWARD_CONTENT : ADJACENT_CONTENT,
        }))
      ),
    };
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    const snapshot = await reader.read(new AbortController().signal);
    const retained = snapshot.pages.find((page) => page.path === "Wiki/Durable.md");

    expect(snapshot.pages.map((page) => page.path)).toEqual([
      "Wiki/Adjacent.md",
      "Wiki/Durable.md",
    ]);
    expect(retained).toMatchObject({
      sourceAppliedContentHash: PAGE_HASH,
      effectiveContentHash: FORWARD_HASH,
      contentHash: FORWARD_HASH,
      content: FORWARD_CONTENT,
      origin: { kind: "forward_revision" },
      sources: [
        {
          sourceContentHash: SOURCE_HASH,
          inputRevision: 1,
          changeSetId: "changeset-historical-base",
        },
      ],
    });
    expect(retained?.sources[0].citations[0].locator.excerpt).toBe("raw source");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("fails closed on a forward origin that cannot rejoin its retained Source", async () => {
    const base = createProjection();
    const forward = {
      ...base.pages[0],
      effectiveContentHash: FORWARD_HASH,
      contentHash: FORWARD_HASH,
      origin: {
        kind: "forward_revision" as const,
        overlay: {
          version: 2 as const,
          kind: "forward_revision_overlay_entry" as const,
          bundleId: "personal",
          pagePath: "Wiki/Durable.md",
          windowsPathKey: "wiki/durable.md",
          sourceId: "orphan-source",
          sourceBaseDigest: sha256("source-base"),
          sourceAppliedContentHash: PAGE_HASH,
          previousEffectiveContentHash: PAGE_HASH,
          effectiveContentHash: FORWARD_HASH,
          forwardTransactionId: "forward-1",
          acceptedDecisionDigest: sha256("decision"),
          forwardLedgerIdentityDigest: sha256("ledger"),
          appliedAt: 300,
        },
      },
    };
    const runtime = createRuntime(async () => createProjection(7, { pages: [forward] }));
    const resolver = createResolver(FORWARD_CONTENT);
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    await expect(reader.read(new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeAppliedWikiSnapshotReadError
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("returns a stable empty corpus without inventing files for an empty Manifest", async () => {
    const runtime = createRuntime(async () =>
      createProjection(4, { manifestRevision: 0, pages: [] })
    );
    const resolver = createResolver();
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    await expect(reader.read(new AbortController().signal)).resolves.toEqual({
      bundleId: "personal",
      runtimeRevision: 4,
      manifestRevision: 0,
      pages: [],
    });
    expect(resolver.resolve).toHaveBeenCalledWith([], expect.any(AbortSignal));
  });

  it("rejects an applied projection outside the configured Wiki before reading it", async () => {
    const valid = createProjection();
    const projection = createProjection(7, {
      pages: [
        {
          ...valid.pages[0],
          path: "Other/Durable.md",
          windowsPathKey: "other/durable.md",
        },
      ],
    });
    const runtime = createRuntime(async () => projection);
    const resolver = createResolver();
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    await expect(reader.read(new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeAppliedWikiSnapshotReadError
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("never publishes changed page bytes and does not fall back to another Vault note", async () => {
    const runtime = createRuntime(async () => createProjection());
    const resolver = createResolver("# Externally changed\n\nSame search words elsewhere.");
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
      maxConsistencyAttempts: 2,
    });

    await expect(reader.read(new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeAppliedWikiSnapshotReadError
    );
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ path: "Wiki/Durable.md" })],
      expect.any(AbortSignal)
    );
    expect(resolver.resolve).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ path: "Wiki/Durable.md" })],
      expect.any(AbortSignal)
    );
  });

  it("retries the complete read when the Runtime changes and publishes only a stable attempt", async () => {
    const projections = [
      createProjection(7),
      createProjection(8),
      createProjection(8),
      createProjection(8),
    ];
    const runtime = createRuntime(async () => projections.shift()!);
    const resolver = createResolver();
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    await expect(reader.read(new AbortController().signal)).resolves.toMatchObject({
      runtimeRevision: 8,
      pages: [{ content: PAGE_CONTENT }],
    });
    expect(runtime.readAppliedProvenance).toHaveBeenCalledTimes(4);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects a case-drifted resolver response instead of accepting a Windows alias", async () => {
    const runtime = createRuntime(async () => createProjection());
    const resolver: CompilerTargetResolver & { resolve: jest.Mock } = {
      resolve: jest.fn(async (requests: readonly CompilerTargetRequest[]) => [
        {
          targetId: requests[0].targetId,
          kind: "file",
          path: "wiki/durable.md",
          content: PAGE_CONTENT,
        },
      ]),
    };
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
      maxConsistencyAttempts: 1,
    });

    await expect(reader.read(new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeAppliedWikiSnapshotReadError
    );
  });

  it("maps cancellation during an uninterruptible read to AbortError and publishes nothing", async () => {
    const runtime = createRuntime(async () => createProjection());
    const abort = new AbortController();
    const resolver: CompilerTargetResolver = {
      resolve: jest.fn(async () => {
        abort.abort();
        return [];
      }),
    };
    const reader = new KnowledgeAppliedWikiSnapshotReader({
      runtime,
      bundle: BUNDLE,
      targetResolver: resolver,
      assertCurrent: () => undefined,
    });

    await expect(reader.read(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.readAppliedProvenance).toHaveBeenCalledTimes(1);
  });
});
