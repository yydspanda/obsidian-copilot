import {
  KnowledgeAppliedWikiPathIndex,
  KnowledgeAppliedWikiPathIndexError,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

describe("KnowledgeAppliedWikiPathIndex", () => {
  it("returns frozen exact-spelling rows and preserves multi-Bundle ambiguity", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([
      { bundleId: "zeta", pagePath: "Wiki/Applied.md" },
      { bundleId: "alpha", pagePath: "Wiki/Applied.md" },
    ]);

    const rows = index.lookupExact("Wiki/Applied.md");

    expect(rows).toEqual([
      { bundleId: "alpha", pagePath: "Wiki/Applied.md" },
      { bundleId: "zeta", pagePath: "Wiki/Applied.md" },
    ]);
    expect(index.lookupExact("wiki/applied.md")).toEqual([]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it("does not let an obsolete lease revoke a newer installation", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    const oldLease = index.install([{ bundleId: "old", pagePath: "Wiki/Old.md" }]);
    const currentLease = index.install([{ bundleId: "current", pagePath: "Wiki/New.md" }]);

    index.revoke(oldLease);
    expect(index.lookupExact("Wiki/New.md")).toEqual([
      { bundleId: "current", pagePath: "Wiki/New.md" },
    ]);

    index.revoke(currentLease);
    expect(index.lookupExact("Wiki/New.md")).toEqual([]);
  });

  it("rejects duplicate identity and Windows case aliases without replacing current rows", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([{ bundleId: "stable", pagePath: "Wiki/Stable.md" }]);

    expect(() =>
      index.install([
        { bundleId: "personal", pagePath: "Wiki/A.md" },
        { bundleId: "personal", pagePath: "Wiki/A.md" },
      ])
    ).toThrow(KnowledgeAppliedWikiPathIndexError);
    expect(() =>
      index.install([
        { bundleId: "one", pagePath: "Wiki/A.md" },
        { bundleId: "two", pagePath: "wiki/a.md" },
      ])
    ).toThrow(KnowledgeAppliedWikiPathIndexError);
    expect(index.lookupExact("Wiki/Stable.md")).toHaveLength(1);
  });

  it("rejects row and array accessors without invoking them", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    let rowGetterCalls = 0;
    const row = { bundleId: "personal" } as { bundleId: string; pagePath: string };
    Object.defineProperty(row, "pagePath", {
      enumerable: true,
      get: () => {
        rowGetterCalls += 1;
        return "Wiki/A.md";
      },
    });

    expect(() => index.install([row])).toThrow(KnowledgeAppliedWikiPathIndexError);
    expect(rowGetterCalls).toBe(0);

    let itemGetterCalls = 0;
    const rows: Array<{ bundleId: string; pagePath: string }> = [];
    Object.defineProperty(rows, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        itemGetterCalls += 1;
        return { bundleId: "personal", pagePath: "Wiki/A.md" };
      },
    });
    Object.defineProperty(rows, "length", { value: 1 });

    expect(() => index.install(rows)).toThrow(KnowledgeAppliedWikiPathIndexError);
    expect(itemGetterCalls).toBe(0);
  });

  it("is advisory only, fails closed after dispose, and rejects prototype forgeries", () => {
    const index = new KnowledgeAppliedWikiPathIndex();
    index.install([{ bundleId: "personal", pagePath: "Wiki/A.md" }]);
    index.dispose();

    expect(index.lookupExact("Wiki/A.md")).toEqual([]);
    expect(() => index.install([])).toThrow(KnowledgeAppliedWikiPathIndexError);

    const forged = Object.create(
      KnowledgeAppliedWikiPathIndex.prototype
    ) as KnowledgeAppliedWikiPathIndex;
    expect(() => forged.lookupExact("Wiki/A.md")).toThrow(KnowledgeAppliedWikiPathIndexError);
  });
});
