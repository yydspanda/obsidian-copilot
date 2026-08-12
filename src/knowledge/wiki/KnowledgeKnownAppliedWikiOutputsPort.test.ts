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

/** Creates one strict first-page session fixture. */
function createSession(): object {
  return {
    pageRef,
    displayPagePath: "Wiki/Topic.md",
    currentState: "applied",
    currentMatch: "current_applied",
    knownOutputCount: 2,
    items: [
      {
        outputRef,
        appliedAt: 100,
        verifiedApplyCount: 1,
        relation: "current_applied",
      },
    ],
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
      (_, index) => ({
        outputRef: `known-wiki-output-${index.toString(16).padStart(64, "0")}`,
        appliedAt: index,
        verifiedApplyCount: 1,
        relation: "earlier_known",
      })
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
        content: "e\u0301\r\n  ",
      }).content
    ).toBe("e\u0301\r\n  ");
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputDetail({
        outputRef,
        appliedAt: 1,
        verifiedApplyCount: 1,
        content: "x".repeat(KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters + 1),
      })
    ).toThrow();
  });

  it("rejects contradictory first-page relation claims", () => {
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        items: [
          {
            outputRef,
            appliedAt: 100,
            verifiedApplyCount: 1,
            relation: "latest_known",
          },
        ],
      })
    ).toThrow();
    expect(() =>
      snapshotKnowledgeKnownAppliedWikiOutputsSession({
        ...createSession(),
        currentState: "drifted",
        currentMatch: "none",
        items: [
          {
            outputRef,
            appliedAt: 100,
            verifiedApplyCount: 1,
            relation: "current_applied",
          },
        ],
      })
    ).toThrow();
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
