import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import type {
  ObsidianKnowledgeCompilerTargetVisitOptions,
  ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import type {
  KnowledgeKnownAppliedWikiOutputAuthorityIdentity,
  KnowledgeKnownAppliedWikiOutputIndexItem,
  KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot,
} from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import {
  KnowledgeProductionKnownAppliedWikiOutputsCoordinator,
  type KnowledgeKnownAppliedWikiOutputsRuntimePort,
} from "@/knowledge/wiki/KnowledgeProductionKnownAppliedWikiOutputsCoordinator";

const PAGE_PATH = "Wiki/Page.md";
const HASH = "a".repeat(64);

function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "bundle",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

function createAuthority(
  contentHash: string,
  appliedAt = 10
): KnowledgeKnownAppliedWikiOutputAuthorityIdentity {
  return {
    runtimeId: "runtime",
    bundleId: "bundle",
    pagePath: PAGE_PATH,
    windowsPathKey: "wiki/page.md",
    outputPath: PAGE_PATH,
    contentHash,
    characterCount: contentHash === HASH ? "current".length : "earlier".length,
    transactionId: `transaction-${contentHash[0]}`,
    sourceId: "source",
    sourceContentHash: "c".repeat(64),
    pipelineFingerprint: "d".repeat(64),
    inputRevision: 1,
    changeSetId: `changeset-${contentHash[0]}`,
    changeSetDigest: "e".repeat(64),
    manifestIntentDigest: "f".repeat(64),
    manifestAfterRevision: appliedAt,
    manifestAfterDigest: "1".repeat(64),
    appliedAt,
  };
}

function createItem(
  content: "current" | "earlier",
  appliedAt = content === "current" ? 10 : 5
): KnowledgeKnownAppliedWikiOutputIndexItem {
  const contentHash = createFileContentHash(content);
  return {
    path: PAGE_PATH,
    windowsPathKey: "wiki/page.md",
    contentHash,
    characterCount: content.length,
    detailAvailability: "available",
    newestAppliedAt: appliedAt,
    newestManifestRevision: appliedAt,
    verifiedApplyCount: 1,
    authority: createAuthority(contentHash, appliedAt),
  };
}

function createIndex(
  outputs: readonly KnowledgeKnownAppliedWikiOutputIndexItem[],
  currentHash = outputs[0]?.contentHash,
  runtimeRevision = 1,
  manifestRevision = 10,
  reviewRevision: number | null = 1
): KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot {
  return {
    runtimeId: "runtime",
    runtimeRevision,
    bundleId: "bundle",
    pagePath: PAGE_PATH,
    windowsPathKey: "wiki/page.md",
    reviewRevision,
    manifestRevision,
    currentManifestPage: currentHash
      ? {
          path: PAGE_PATH,
          windowsPathKey: "wiki/page.md",
          ownership: "generated",
          contentHash: currentHash,
        }
      : null,
    outputs,
  };
}

function createRuntime(
  getIndex: () => KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot
): KnowledgeKnownAppliedWikiOutputsRuntimePort {
  return {
    readKnownAppliedWikiOutputIndex: jest.fn(async () => getIndex()),
    readKnownAppliedWikiOutputDetail: jest.fn(async (_bundleId, _pagePath, authority) => {
      const content =
        authority.contentHash === createFileContentHash("current") ? "current" : "earlier";
      return {
        kind: "available" as const,
        runtimeId: "runtime",
        runtimeRevision: getIndex().runtimeRevision,
        contentHash: authority.contentHash,
        content,
        characterCount: content.length,
      };
    }),
  };
}

function createVisitor(
  current: () => string | undefined,
  reportedPath = PAGE_PATH
): {
  visit(
    requests: readonly CompilerTargetRequest[],
    signal: AbortSignal,
    options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
    visitor: ObsidianKnowledgeCompilerTargetVisitor
  ): Promise<void>;
} {
  return {
    visit: jest.fn(async (requests, signal, options, visitor) => {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      expect(options.maxFileBytes).toBe(2_000_000);
      const request = requests[0];
      const content = current();
      const observation: CompilerTargetObservation =
        content === undefined
          ? {
              targetId: request.targetId,
              kind: "missing",
              windowsPathKey: "wiki/page.md",
            }
          : { targetId: request.targetId, kind: "file", path: reportedPath, content };
      await visitor(
        observation,
        content === undefined ? undefined : new TextEncoder().encode(content).byteLength
      );
    }),
  };
}

function createCoordinator(
  runtime: KnowledgeKnownAppliedWikiOutputsRuntimePort,
  current: () => string | undefined,
  reportedPath = PAGE_PATH
): KnowledgeProductionKnownAppliedWikiOutputsCoordinator {
  return new KnowledgeProductionKnownAppliedWikiOutputsCoordinator({
    runtime,
    bundles: [{ bundle: createBundle(), targetVisitor: createVisitor(current, reportedPath) }],
    assertCurrent: () => undefined,
  });
}

describe("KnowledgeProductionKnownAppliedWikiOutputsCoordinator", () => {
  it("requires Manifest, strict retained output, and Vault bytes for Current applied", async () => {
    const item = createItem("current");
    let revision = 0;
    const runtime = createRuntime(() => createIndex([item], item.contentHash, ++revision));
    const coordinator = createCoordinator(runtime, () => "current");

    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    expect(session).toMatchObject({
      currentState: "applied",
      currentMatch: "current_applied",
      knownOutputCount: 1,
    });
    const detail = await coordinator.readOutput(
      session,
      session.items[0].outputRef,
      new AbortController().signal
    );
    expect(detail).toMatchObject({ kind: "loaded", value: { content: "current" } });
    const comparison = await coordinator.compareWithCurrent(
      session,
      session.items[0].outputRef,
      new AbortController().signal
    );
    expect(comparison).toMatchObject({
      kind: "loaded",
      value: { knownContent: "current", currentContent: "current" },
    });
  });

  it("classifies an exact earlier retained output as external drift", async () => {
    const latest = createItem("current", 10);
    const earlier = createItem("earlier", 5);
    const runtime = createRuntime(() => createIndex([latest, earlier], latest.contentHash));
    const coordinator = createCoordinator(runtime, () => "earlier");

    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    expect(session.currentState).toBe("drifted");
    expect(session.currentMatch).toBe("earlier_known");
    expect(session.items[0].relation).toBe("latest_known");
  });

  it("does not call a Manifest/Vault match current when strict retained proof is absent", async () => {
    const retained = createItem("earlier", 5);
    const unretainedCurrentHash = createFileContentHash("current");
    const runtime = createRuntime(() => createIndex([retained], unretainedCurrentHash));
    const coordinator = createCoordinator(runtime, () => "current");
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    expect(session).toMatchObject({ currentState: "drifted", currentMatch: "none" });
    expect(session.items[0].relation).toBe("latest_known");
  });

  it("allows lazy historical detail when the current Wiki file is missing", async () => {
    const item = createItem("current");
    const runtime = createRuntime(() => createIndex([item], item.contentHash));
    const coordinator = createCoordinator(runtime, () => undefined);
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    expect(session.currentState).toBe("missing");
    await expect(
      coordinator.readOutput(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toMatchObject({ kind: "loaded" });
    await expect(
      coordinator.compareWithCurrent(
        session,
        session.items[0].outputRef,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("fails closed on exact-case path mismatch before issuing a session", async () => {
    const item = createItem("current");
    const runtime = createRuntime(() => createIndex([item], item.contentHash));
    const coordinator = createCoordinator(runtime, () => "current", "Wiki/page.md");
    await expect(
      coordinator.inspectKnownOutputs({ pagePath: PAGE_PATH }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeKnownAppliedWikiOutputsError" });
  });

  it("rejects a Runtime output whose path is only a Windows-case alias", async () => {
    const exact = createItem("current");
    const aliasedPath = "Wiki/page.md";
    const aliased = {
      ...exact,
      path: aliasedPath,
      authority: { ...exact.authority, outputPath: aliasedPath },
    };
    const runtime = createRuntime(() => createIndex([aliased], aliased.contentHash));
    const coordinator = createCoordinator(runtime, () => "current");

    await expect(
      coordinator.inspectKnownOutputs({ pagePath: PAGE_PATH }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeKnownAppliedWikiOutputsError" });
  });

  it("retries a locally regressing Runtime revision vector before publishing", async () => {
    const item = createItem("current");
    const revisions = [
      { runtime: 5, manifest: 12, review: 3 },
      { runtime: 6, manifest: 11, review: 2 },
      { runtime: 7, manifest: 13, review: 3 },
      { runtime: 8, manifest: 14, review: 4 },
    ];
    const readIndex = jest.fn(async () => {
      const revision = revisions.shift() ?? { runtime: 8, manifest: 14, review: 4 };
      return createIndex(
        [item],
        item.contentHash,
        revision.runtime,
        revision.manifest,
        revision.review
      );
    });
    const runtime = createRuntime(() => {
      throw new Error("detail was not expected");
    });
    runtime.readKnownAppliedWikiOutputIndex = readIndex;
    const coordinator = createCoordinator(runtime, () => "current");

    await expect(
      coordinator.inspectKnownOutputs({ pagePath: PAGE_PATH }, new AbortController().signal)
    ).resolves.toMatchObject({ currentState: "applied" });
    expect(readIndex).toHaveBeenCalledTimes(4);
  });

  it("revokes a session when a later stable Runtime sandwich falls below its revision floor", async () => {
    const item = createItem("current");
    const revisions = [
      { runtime: 10, manifest: 10, review: 2 },
      { runtime: 11, manifest: 11, review: 3 },
      { runtime: 9, manifest: 12, review: 4 },
      { runtime: 10, manifest: 13, review: 5 },
    ];
    const runtime = createRuntime(() => {
      const revision = revisions.shift() ?? { runtime: 10, manifest: 13, review: 5 };
      return createIndex(
        [item],
        item.contentHash,
        revision.runtime,
        revision.manifest,
        revision.review
      );
    });
    const coordinator = createCoordinator(runtime, () => "current");
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );

    await expect(
      coordinator.readOutput(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(runtime.readKnownAppliedWikiOutputDetail).not.toHaveBeenCalled();
  });

  it("rejects a detail revision that moves backward inside one read chain", async () => {
    const item = createItem("current");
    const indexRevisions = [1, 2, 3, 4];
    const detailRevisions = [5, 4];
    const runtime: KnowledgeKnownAppliedWikiOutputsRuntimePort = {
      readKnownAppliedWikiOutputIndex: jest.fn(async () =>
        createIndex([item], item.contentHash, indexRevisions.shift() ?? 4)
      ),
      readKnownAppliedWikiOutputDetail: jest.fn(async () => ({
        kind: "available" as const,
        runtimeId: "runtime",
        runtimeRevision: detailRevisions.shift() ?? 4,
        contentHash: item.contentHash,
        content: "current",
        characterCount: "current".length,
      })),
    };
    const coordinator = createCoordinator(runtime, () => "current");
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );

    await expect(
      coordinator.readOutput(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(runtime.readKnownAppliedWikiOutputIndex).toHaveBeenCalledTimes(4);
  });

  it("rejects manifest and Review rollback in the final detail-chain index", async () => {
    const item = createItem("current");
    const indexRevisions = [
      { runtime: 1, manifest: 10, review: 1 },
      { runtime: 2, manifest: 11, review: 2 },
      { runtime: 3, manifest: 12, review: 3 },
      { runtime: 4, manifest: 13, review: 4 },
      { runtime: 7, manifest: 12, review: 3 },
    ];
    const detailRevisions = [5, 6];
    const runtime: KnowledgeKnownAppliedWikiOutputsRuntimePort = {
      readKnownAppliedWikiOutputIndex: jest.fn(async () => {
        const revision = indexRevisions.shift() ?? { runtime: 7, manifest: 12, review: 3 };
        return createIndex(
          [item],
          item.contentHash,
          revision.runtime,
          revision.manifest,
          revision.review
        );
      }),
      readKnownAppliedWikiOutputDetail: jest.fn(async () => ({
        kind: "available" as const,
        runtimeId: "runtime",
        runtimeRevision: detailRevisions.shift() ?? 6,
        contentHash: item.contentHash,
        content: "current",
        characterCount: "current".length,
      })),
    };
    const coordinator = createCoordinator(runtime, () => "current");
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );

    await expect(
      coordinator.readOutput(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
  });

  it("revokes a session when relevant Runtime history changes", async () => {
    const first = createItem("current", 10);
    const second = createItem("earlier", 5);
    let index = createIndex([first], first.contentHash);
    const runtime = createRuntime(() => index);
    const coordinator = createCoordinator(runtime, () => "current");
    const session = await coordinator.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    index = createIndex([first, second], first.contentHash, 99);
    await expect(
      coordinator.readOutput(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
  });
});
