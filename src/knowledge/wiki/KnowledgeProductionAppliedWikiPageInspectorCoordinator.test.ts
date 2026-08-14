import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import type {
  ObsidianKnowledgeCompilerTargetVisitOptions,
  ObsidianKnowledgeCompilerTargetVisitPort,
  ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, KnowledgeBundleConfig } from "@/knowledge/model/types";
import type { ObsidianKnowledgeCitationNavigationRequest } from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";
import type {
  KnowledgeRuntimeAppliedPageProvenance,
  KnowledgeRuntimeAppliedProvenanceSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  getKnowledgeAppliedWikiPageInspectorErrorCode,
  type KnowledgeAppliedWikiPageInspectionSession,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeProductionAppliedWikiPageInspectorCoordinator } from "@/knowledge/wiki/KnowledgeProductionAppliedWikiPageInspectorCoordinator";
import { sha256 } from "@/utils/hash";

const PAGE_CONTENT = "# Applied\n";
const PAGE_HASH = sha256(PAGE_CONTENT);
const SOURCE_HASH = "b".repeat(64);
const PIPELINE_HASH = "c".repeat(64);
const CHANGESET_HASH = "d".repeat(64);

const BUNDLE: KnowledgeBundleConfig = {
  version: 1,
  id: "personal",
  sourceRoots: ["Sources"],
  wikiRoot: "Wiki",
  schemaRef: "Schemas/OKF.md",
  reviewMode: "always",
};

/** Creates one exact citation bound to the current Source artifact hash. */
function createCitation(): ClaimCitation {
  const excerpt = "Source evidence";
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: SOURCE_HASH,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
      startLine: 1,
      endLine: 1,
    },
  };
}

/** Creates one exact current applied page provenance. */
function createPage(
  citation: ClaimCitation = createCitation()
): KnowledgeRuntimeAppliedPageProvenance {
  return {
    path: "Wiki/Applied.md",
    windowsPathKey: "wiki/applied.md",
    ownership: "generated",
    contentHash: PAGE_HASH,
    sources: [
      {
        sourceId: "source-1",
        sourcePath: "Sources/Book.md",
        custody: "user_managed",
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        inputRevision: 1,
        changeSetId: "changeset-1",
        changeSetDigest: CHANGESET_HASH,
        acceptedAt: 10,
        citations: [citation],
      },
    ],
  };
}

/** Creates one strict atomic Runtime projection. */
function createSnapshot(
  runtimeRevision = 1,
  pages: readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[] = [createPage()]
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  return {
    bundleId: "personal",
    runtimeRevision,
    manifestRevision: 1,
    pages,
  };
}

/** Executes one visitor callback with the exact configured Vault observation. */
class RecordingVisitor implements ObsidianKnowledgeCompilerTargetVisitPort {
  readonly options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>[] = [];
  readonly requests: Readonly<CompilerTargetRequest>[][] = [];
  content = PAGE_CONTENT;

  async visit(
    targets: readonly CompilerTargetRequest[],
    signal: AbortSignal,
    options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
    visitor: ObsidianKnowledgeCompilerTargetVisitor
  ): Promise<void> {
    this.options.push(options);
    this.requests.push([...targets]);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const request = targets[0];
    const observation: CompilerTargetObservation = {
      targetId: request.targetId,
      kind: "file",
      path: request.path,
      content: this.content,
    };
    await visitor(observation, new TextEncoder().encode(this.content).byteLength);
  }
}

/** Visitor fixture that rejects with one caller-selected boundary failure. */
class RejectingVisitor implements ObsidianKnowledgeCompilerTargetVisitPort {
  /** Captures the exact rejection value without inspecting it. */
  constructor(private readonly failure: Error) {}

  /** Rejects before publishing any Vault observation. */
  async visit(
    _targets: readonly CompilerTargetRequest[],
    _signal: AbortSignal,
    _options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
    _visitor: ObsidianKnowledgeCompilerTargetVisitor
  ): Promise<void> {
    throw this.failure;
  }
}

interface Harness {
  coordinator: KnowledgeProductionAppliedWikiPageInspectorCoordinator;
  visitor: RecordingVisitor;
  runtimeReads: jest.Mock<Promise<KnowledgeRuntimeAppliedProvenanceSnapshot>>;
  navigate: jest.Mock;
  snapshots: KnowledgeRuntimeAppliedProvenanceSnapshot[];
}

/** Creates a coordinator with mutable exact Runtime snapshots for consistency tests. */
function createHarness(
  snapshots: KnowledgeRuntimeAppliedProvenanceSnapshot[] = [createSnapshot()]
): Harness {
  const visitor = new RecordingVisitor();
  let readIndex = 0;
  const runtimeReads = jest.fn(async () => snapshots[Math.min(readIndex++, snapshots.length - 1)]);
  const navigate = jest.fn(async (_request: ObsidianKnowledgeCitationNavigationRequest) => ({
    status: "opened" as const,
  }));
  const coordinator = new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
    runtime: { readAppliedProvenance: runtimeReads },
    bundles: [{ bundle: BUNDLE, targetVisitor: visitor }],
    navigator: { navigate },
    assertCurrent: () => undefined,
  });
  return { coordinator, visitor, runtimeReads, navigate, snapshots };
}

/** Creates an inspector whose Vault boundary rejects with one selected value. */
function createRejectingCoordinator(
  failure: Error
): KnowledgeProductionAppliedWikiPageInspectorCoordinator {
  return new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
    runtime: { readAppliedProvenance: async () => createSnapshot() },
    bundles: [{ bundle: BUNDLE, targetVisitor: new RejectingVisitor(failure) }],
    navigator: { navigate: async () => ({ status: "opened" }) },
    assertCurrent: () => undefined,
  });
}

/** Returns the authentic first evidence ref from one inspection session. */
function evidenceRef(session: KnowledgeAppliedWikiPageInspectionSession): string {
  return session.sources[0].evidence[0].evidenceRef;
}

describe("KnowledgeProductionAppliedWikiPageInspectorCoordinator", () => {
  it("inspects one exact applied page through a 2MB pre-read visitor boundary", async () => {
    const harness = createHarness();

    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    expect(session).toMatchObject({
      displayPagePath: "Wiki/Applied.md",
      ownership: "generated",
      sources: [{ displaySourcePath: "Sources/Book.md", custody: "user_managed" }],
    });
    expect(harness.visitor.options).toEqual([{ maxFileBytes: 2_000_000 }]);
    expect(harness.visitor.requests).toEqual([
      [
        {
          targetId: "wiki-inspector-page",
          path: "Wiki/Applied.md",
          intent: "write",
          access: "authorized",
        },
      ],
    ]);
    expect(harness.runtimeReads).toHaveBeenCalledTimes(2);
  });

  it("classifies a changed Vault page as drifted and an absent page as not_applied", async () => {
    const drift = createHarness();
    drift.visitor.content = "locally changed";
    try {
      await drift.coordinator.inspectPage(
        { pagePath: "Wiki/Applied.md" },
        new AbortController().signal
      );
      throw new Error("expected drift");
    } catch (error) {
      expect(getKnowledgeAppliedWikiPageInspectorErrorCode(error)).toBe("drifted");
    }

    const absent = createHarness([createSnapshot(1, [])]);
    try {
      await absent.coordinator.inspectPage(
        { pagePath: "Wiki/Applied.md" },
        new AbortController().signal
      );
      throw new Error("expected absence");
    } catch (error) {
      expect(getKnowledgeAppliedWikiPageInspectorErrorCode(error)).toBe("not_applied");
    }
  });

  it("retries a changing Runtime sandwich and returns only a stable observation", async () => {
    const changedPage = { ...createPage(), ownership: "shared" as const };
    const harness = createHarness([
      createSnapshot(1),
      createSnapshot(2, [changedPage]),
      createSnapshot(2, [changedPage]),
      createSnapshot(2, [changedPage]),
    ]);

    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    expect(session.ownership).toBe("shared");
    expect(harness.visitor.options).toHaveLength(2);
    expect(harness.runtimeReads).toHaveBeenCalledTimes(4);
  });

  it("allows unrelated Runtime revision advancement while re-proving identical evidence", async () => {
    const snapshots = [
      createSnapshot(1),
      createSnapshot(1),
      createSnapshot(2),
      createSnapshot(2),
      createSnapshot(3),
      createSnapshot(3),
    ];
    const harness = createHarness(snapshots);
    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      harness.coordinator.openEvidence(session, evidenceRef(session), new AbortController().signal)
    ).resolves.toEqual({ kind: "opened" });
    expect(harness.navigate).toHaveBeenCalledTimes(1);
    expect(harness.runtimeReads).toHaveBeenCalledTimes(6);
  });

  it("returns stale after navigation when the exact source/citation changes", async () => {
    const changed = createPage({ ...createCitation(), claimId: "claim-changed" });
    const harness = createHarness([
      createSnapshot(1),
      createSnapshot(1),
      createSnapshot(2),
      createSnapshot(2),
      createSnapshot(3, [changed]),
      createSnapshot(3, [changed]),
    ]);
    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      harness.coordinator.openEvidence(session, evidenceRef(session), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(harness.navigate).toHaveBeenCalledTimes(1);
  });

  it("lists path rows without inspecting hidden Source/citation payloads", async () => {
    let getterCalls = 0;
    const page = createPage();
    Object.defineProperty(page, "sources", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("should stay hidden");
      },
    });
    const harness = createHarness([createSnapshot(1, [page])]);

    await expect(
      harness.coordinator.listAppliedWikiPathIndexRows(new AbortController().signal)
    ).resolves.toEqual([{ bundleId: "personal", pagePath: "Wiki/Applied.md" }]);
    expect(getterCalls).toBe(0);
  });

  it("fails closed on Runtime case aliases and oversized shallow path identities", async () => {
    const alias = { ...createPage(), path: "wiki/applied.md" };
    const duplicate = createHarness([createSnapshot(1, [createPage(), alias])]);
    await expect(
      duplicate.coordinator.inspectPage(
        { pagePath: "Wiki/Applied.md" },
        new AbortController().signal
      )
    ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));

    const oversized = {
      ...createPage(),
      path: `Wiki/${"x".repeat(1_025)}.md`,
      windowsPathKey: `wiki/${"x".repeat(1_025)}.md`,
    };
    const oversizedHarness = createHarness([createSnapshot(1, [oversized])]);
    await expect(
      oversizedHarness.coordinator.listAppliedWikiPathIndexRows(new AbortController().signal)
    ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));
  });

  it("rejects selected Source provenance outside configured roots", async () => {
    const page = createPage();
    const outside = {
      ...page,
      sources: [{ ...page.sources[0], sourcePath: "Private/Book.md" }],
    };
    const harness = createHarness([createSnapshot(1, [outside])]);

    await expect(
      harness.coordinator.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal)
    ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));
    expect(harness.visitor.options).toHaveLength(0);
  });

  it("returns unsupported for a Source suffix the existing navigator cannot open", async () => {
    const page = createPage();
    const unsupported = {
      ...page,
      sources: [{ ...page.sources[0], sourcePath: "Sources/Book.markdown" }],
    };
    const harness = createHarness([
      createSnapshot(1, [unsupported]),
      createSnapshot(1, [unsupported]),
      createSnapshot(2, [unsupported]),
      createSnapshot(2, [unsupported]),
    ]);
    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      harness.coordinator.openEvidence(session, evidenceRef(session), new AbortController().signal)
    ).resolves.toEqual({ kind: "unsupported" });
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it("accepts only authentic sessions from the exact coordinator", async () => {
    const first = createHarness([createSnapshot(), createSnapshot()]);
    const second = createHarness();
    const session = await first.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      first.coordinator.openEvidence(
        { ...session, sources: session.sources },
        evidenceRef(session),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      second.coordinator.openEvidence(session, evidenceRef(session), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(first.navigate).not.toHaveBeenCalled();
    expect(second.navigate).not.toHaveBeenCalled();
  });

  it("returns stale before navigation when exact Source/citation identity changed", async () => {
    const changed = createPage({ ...createCitation(), claimId: "claim-changed" });
    const harness = createHarness([
      createSnapshot(1),
      createSnapshot(1),
      createSnapshot(2, [changed]),
      createSnapshot(2, [changed]),
    ]);
    const session = await harness.coordinator.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      harness.coordinator.openEvidence(session, evidenceRef(session), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it("rejects cross-Bundle Wiki conflicts while allowing Source-to-Source overlap", () => {
    const visitor = new RecordingVisitor();
    const createCoordinator = (other: KnowledgeBundleConfig): void => {
      new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
        runtime: { readAppliedProvenance: async () => createSnapshot() },
        bundles: [
          { bundle: BUNDLE, targetVisitor: visitor },
          { bundle: other, targetVisitor: visitor },
        ],
        navigator: { navigate: async () => ({ status: "opened" }) },
        assertCurrent: () => undefined,
      });
    };
    const baseOther: KnowledgeBundleConfig = {
      ...BUNDLE,
      id: "other",
      sourceRoots: ["OtherSources"],
      wikiRoot: "OtherWiki",
      schemaRef: "OtherSchemas/OKF.md",
    };

    expect(() => createCoordinator({ ...baseOther, wikiRoot: "Wiki/Nested" })).toThrow();
    expect(() => createCoordinator({ ...baseOther, sourceRoots: ["Wiki/Inputs"] })).toThrow();
    expect(() => createCoordinator({ ...baseOther, schemaRef: "Wiki/Schema.md" })).toThrow();
    expect(() =>
      createCoordinator({ ...baseOther, sourceRoots: ["Sources/Nested"] })
    ).not.toThrow();
  });

  it.each([
    ["Bundle id", { id: "x".repeat(257) }],
    ["Wiki root", { wikiRoot: `Wiki/${"x".repeat(1_025)}` }],
    ["schema path", { schemaRef: `Schemas/${"x".repeat(1_025)}.md` }],
    ["Source root", { sourceRoots: [`Sources/${"x".repeat(1_025)}`] }],
  ])("rejects an oversized configured %s before path validation", (_label, override) => {
    const visitor = new RecordingVisitor();

    expect(
      () =>
        new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
          runtime: { readAppliedProvenance: async () => createSnapshot() },
          bundles: [{ bundle: { ...BUNDLE, ...override }, targetVisitor: visitor }],
          navigator: { navigate: async () => ({ status: "opened" }) },
          assertCurrent: () => undefined,
        })
    ).toThrow();
    expect(visitor.options).toHaveLength(0);
  });

  it("enforces the aggregate 10,000-row index cap without visiting Vault or navigating", async () => {
    const visitor = new RecordingVisitor();
    const navigate = jest.fn(async () => ({ status: "opened" as const }));
    const other: KnowledgeBundleConfig = {
      ...BUNDLE,
      id: "other",
      sourceRoots: ["OtherSources"],
      wikiRoot: "OtherWiki",
      schemaRef: "OtherSchemas/OKF.md",
    };
    const firstPages = Array.from(
      { length: 10_000 },
      (_unused, index) =>
        ({
          path: `Wiki/Page ${index}.md`,
          windowsPathKey: `wiki/page ${index}.md`,
        }) as KnowledgeRuntimeAppliedPageProvenance
    );
    const otherPages = [
      {
        path: "OtherWiki/Page.md",
        windowsPathKey: "otherwiki/page.md",
      } as KnowledgeRuntimeAppliedPageProvenance,
    ];
    const runtime = {
      readAppliedProvenance: async (bundleId: string) =>
        bundleId === "personal"
          ? createSnapshot(1, firstPages)
          : {
              bundleId: "other",
              runtimeRevision: 1,
              manifestRevision: 1,
              pages: otherPages,
            },
    };
    const coordinator = new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
      runtime,
      bundles: [
        { bundle: BUNDLE, targetVisitor: visitor },
        { bundle: other, targetVisitor: visitor },
      ],
      navigator: { navigate },
      assertCurrent: () => undefined,
    });

    await expect(
      coordinator.listAppliedWikiPathIndexRows(new AbortController().signal)
    ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));
    expect(visitor.options).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects hostile Runtime row descriptors without invoking them", async () => {
    let getterCalls = 0;
    const row = { windowsPathKey: "wiki/applied.md" } as KnowledgeRuntimeAppliedPageProvenance;
    Object.defineProperty(row, "path", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "Wiki/Applied.md";
      },
    });
    const harness = createHarness([createSnapshot(1, [row])]);

    await expect(
      harness.coordinator.listAppliedWikiPathIndexRows(new AbortController().signal)
    ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));
    expect(getterCalls).toBe(0);
  });

  it("recognizes serialized own-data cancellation and rejects hostile lookalikes", async () => {
    await expect(
      createRejectingCoordinator(Object.freeze({ name: "AbortError" }) as Error).inspectPage(
        { pagePath: "Wiki/Applied.md" },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    let getterCalls = 0;
    const accessorLookalike = {} as Error;
    Object.defineProperty(accessorLookalike, "name", {
      get: () => {
        getterCalls += 1;
        return "AbortError";
      },
    });
    const proxyLookalike = new Proxy({} as Error, {
      getOwnPropertyDescriptor: () => {
        throw new Error("descriptor trap must fail closed");
      },
    });
    for (const failure of [accessorLookalike, proxyLookalike]) {
      await expect(
        createRejectingCoordinator(failure).inspectPage(
          { pagePath: "Wiki/Applied.md" },
          new AbortController().signal
        )
      ).rejects.toEqual(expect.objectContaining({ code: "unavailable" }));
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects constructor getters before invoking them", () => {
    let getterCalls = 0;
    const input = {
      bundles: [{ bundle: BUNDLE, targetVisitor: new RecordingVisitor() }],
      navigator: { navigate: async () => ({ status: "opened" as const }) },
      assertCurrent: () => undefined,
    } as {
      runtime: { readAppliedProvenance(): Promise<KnowledgeRuntimeAppliedProvenanceSnapshot> };
      bundles: Array<{ bundle: KnowledgeBundleConfig; targetVisitor: RecordingVisitor }>;
      navigator: { navigate(): Promise<{ status: "opened" }> };
      assertCurrent(): void;
    };
    Object.defineProperty(input, "runtime", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return { readAppliedProvenance: async () => createSnapshot() };
      },
    });

    expect(() => new KnowledgeProductionAppliedWikiPageInspectorCoordinator(input)).toThrow();
    expect(getterCalls).toBe(0);
  });
});
