import {
  getKnowledgeKnownAppliedWikiOutputsErrorCode,
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  KnowledgeKnownAppliedWikiOutputsError,
  snapshotKnowledgeKnownAppliedWikiOutputComparison,
  snapshotKnowledgeKnownAppliedWikiOutputDetail,
  snapshotKnowledgeKnownAppliedWikiOutputsPage,
  snapshotKnowledgeKnownAppliedWikiOutputsRequest,
  snapshotKnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const pageRef = `known-wiki-page-${"a".repeat(64)}`;
const outputRef = `known-wiki-output-${"b".repeat(64)}`;
const cursorRef = `known-wiki-cursor-${"c".repeat(64)}`;

/** Creates one canonical source-Apply provenance summary. */
function createOrigins(appliedAt: number, verifiedApplyCount = 1): readonly object[] {
  return [
    {
      kind: "source_apply",
      verifiedApplyCount,
      newestAppliedAt: appliedAt,
      newestManifestRevision: Math.max(1, appliedAt),
    },
  ];
}

/** Creates one strict output-row fixture. */
function createSummary(
  candidateRef: string,
  appliedAt: number,
  relation: "current_applied" | "latest_known" | "earlier_known",
  proposalCapability:
    | "available"
    | "current_not_applied"
    | "selected_is_current"
    | "forward_origin_not_supported"
    | "detail_too_large"
): object {
  return {
    outputRef: candidateRef,
    appliedAt,
    verifiedApplyCount: 1,
    origins: createOrigins(appliedAt),
    relation,
    proposalCapability,
  };
}

/** Creates one strict first-page session fixture. */
function createSession(): object {
  return {
    pageRef,
    displayPagePath: "Wiki/Topic.md",
    currentState: "applied",
    currentMatch: "current_applied",
    knownOutputCount: 2,
    items: [createSummary(outputRef, 100, "current_applied", "selected_is_current")],
    nextCursor: cursorRef,
  };
}

describe("KnowledgeKnownAppliedWikiOutputsPort", () => {
  it("captures and freezes canonical requests and bounded detached DTOs", () => {
    const request = snapshotKnowledgeKnownAppliedWikiOutputsRequest({ pagePath: "Wiki/Topic.md" });
    const session = snapshotKnowledgeKnownAppliedWikiOutputsSession(createSession());
    const page = snapshotKnowledgeKnownAppliedWikiOutputsPage({ items: [] });
    const detail = snapshotKnowledgeKnownAppliedWikiOutputDetail({
      outputRef,
      appliedAt: 100,
      verifiedApplyCount: 1,
      origins: createOrigins(100),
      proposalCapability: "selected_is_current",
      content: "exact\r\ntext",
    });
    const comparison = snapshotKnowledgeKnownAppliedWikiOutputComparison({
      outputRef,
      currentState: "drifted",
      knownContent: "known\r\n",
      currentContent: "current\n",
    });

    expect(request).toEqual({ pagePath: "Wiki/Topic.md" });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.items)).toBe(true);
    expect(Object.isFrozen(session.items[0])).toBe(true);
    expect(page).toEqual({ items: [] });
    expect(detail.content).toBe("exact\r\ntext");
    expect(comparison.currentState).toBe("drifted");
  });

  it("rejects accessors, sparse arrays, extra keys, forged refs, and inconsistent sessions", () => {
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "pageRef", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return pageRef;
      },
    });
    for (const [key, value] of Object.entries(createSession())) {
      if (key !== "pageRef") hostile[key] = value;
    }
    const sparse = new Array(2);
    sparse[0] = (createSession() as { items: object[] }).items[0];

    expect(() => snapshotKnowledgeKnownAppliedWikiOutputsSession(hostile)).toThrow();
    expect(getterCalls).toBe(0);
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({ ...createSession(), extra: true })
    ).toThrow();
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({ ...createSession(), pageRef: "forged" })
    ).toThrow();
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({ ...createSession(), items: sparse })
    ).toThrow();
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        currentState: "drifted",
        currentMatch: "current_applied",
      })
    ).toThrow();
  });

  it("enforces exact paging and content limits without normalizing text", () => {
    const items = Array.from(
      { length: KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.pageSize },
      (_, index) =>
        createSummary(
          `known-wiki-output-${index.toString(16).padStart(64, "0")}`,
          index,
          "earlier_known",
          "available"
        )
    );
    expect(snapshotKnowledgeKnownAppliedWikiOutputsPage({ items }).items).toHaveLength(20);
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsPage({ items: [...items, items[0]] })
    ).toThrow();
    expect(
      snapshotKnowledgeKnownAppliedWikiOutputDetail({
        outputRef,
        appliedAt: 1,
        verifiedApplyCount: 1,
        origins: createOrigins(1),
        proposalCapability: "available",
        content: "e\u0301\r\n  ",
      }).content
    ).toBe("e\u0301\r\n  ");
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputDetail({
        outputRef,
        appliedAt: 1,
        verifiedApplyCount: 1,
        origins: createOrigins(1),
        proposalCapability: "available",
        content: "x".repeat(KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters + 1),
      })
    ).toThrow();
  });

  it("rejects contradictory first-page relation claims", () => {
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        items: [createSummary(outputRef, 100, "latest_known", "current_not_applied")],
      })
    ).toThrow();
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        currentState: "drifted",
        currentMatch: "none",
        items: [createSummary(outputRef, 100, "current_applied", "selected_is_current")],
      })
    ).toThrow();
  });

  it("preserves mixed origins and rejects dishonest aggregate or proposal capability claims", () => {
    const mixed = {
      outputRef,
      appliedAt: 200,
      verifiedApplyCount: 3,
      origins: [
        {
          kind: "source_apply",
          verifiedApplyCount: 1,
          newestAppliedAt: 100,
          newestManifestRevision: 10,
        },
        {
          kind: "forward_revision",
          verifiedApplyCount: 2,
          newestAppliedAt: 200,
          newestManifestRevision: 20,
        },
      ],
      relation: "current_applied",
      proposalCapability: "selected_is_current",
    };
    const captured = snapshotKnowledgeKnownAppliedWikiOutputsSession({
      ...createSession(),
      knownOutputCount: 1,
      items: [mixed],
      nextCursor: undefined,
    });
    expect(captured.items[0].origins.map((origin) => origin.kind)).toEqual([
      "source_apply",
      "forward_revision",
    ]);
    expect(Object.isFrozen(captured.items[0].origins)).toBe(true);

    const forwardHistorical = createSummary(
      `known-wiki-output-${"d".repeat(64)}`,
      50,
      "earlier_known",
      "forward_origin_not_supported"
    );
    expect(
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        items: [(createSession() as { items: object[] }).items[0], forwardHistorical],
        nextCursor: undefined,
      }).items[1].proposalCapability
    ).toBe("forward_origin_not_supported");

    for (const candidate of [
      { ...mixed, origins: [...mixed.origins].reverse() },
      { ...mixed, verifiedApplyCount: 4 },
      { ...mixed, proposalCapability: "available" },
      {
        ...mixed,
        verifiedApplyCount: 10_001,
        origins: [
          {
            ...mixed.origins[0],
            verifiedApplyCount: 10_001,
            newestAppliedAt: mixed.appliedAt,
          },
        ],
      },
    ]) {
      expect(() =>
        snapshotKnowledgeKnownAppliedWikiOutputsSession({
          ...createSession(),
          knownOutputCount: 1,
          items: [candidate],
          nextCursor: undefined,
        })
      ).toThrow();
    }
  });

  it("recognizes only authentic sanitized errors", () => {
    const error = new KnowledgeKnownAppliedWikiOutputsError("not_known");
    expect(error.code).toBe("not_known");
    expect(getKnowledgeKnownAppliedWikiOutputsErrorCode(error)).toBe("not_known");
    expect(
      getKnowledgeKnownAppliedWikiOutputsErrorCode({
        name: "KnowledgeKnownAppliedWikiOutputsError",
        code: "not_known",
      })
    ).toBeUndefined();
  });
});
