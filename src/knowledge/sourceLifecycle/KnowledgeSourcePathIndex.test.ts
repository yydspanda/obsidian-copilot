import { KnowledgeSourcePathIndex } from "@/knowledge/sourceLifecycle/KnowledgeSourcePathIndex";

describe("KnowledgeSourcePathIndex", () => {
  it("projects exact, Windows-case-alias, and folder-descendant matches", () => {
    const index = new KnowledgeSourcePathIndex();
    index.install([
      { bundleId: "bundle-b", sourceId: "source-2", sourcePath: "Sources/Topic/B.md" },
      { bundleId: "bundle-a", sourceId: "source-1", sourcePath: "Sources/Topic/A.md" },
      { bundleId: "bundle-a", sourceId: "source-3", sourcePath: "Sources/Elsewhere.md" },
    ]);

    expect(index.lookup("Sources/Topic/A.md")).toEqual({
      exact: [{ bundleId: "bundle-a", sourceId: "source-1", sourcePath: "Sources/Topic/A.md" }],
      caseAliases: [],
      descendants: [],
    });
    expect(index.lookup("sources/topic/a.md")).toEqual({
      exact: [],
      caseAliases: [
        { bundleId: "bundle-a", sourceId: "source-1", sourcePath: "Sources/Topic/A.md" },
      ],
      descendants: [],
    });
    expect(index.lookup("Sources/Topic")).toEqual({
      exact: [],
      caseAliases: [],
      descendants: [
        { bundleId: "bundle-a", sourceId: "source-1", sourcePath: "Sources/Topic/A.md" },
        { bundleId: "bundle-b", sourceId: "source-2", sourcePath: "Sources/Topic/B.md" },
      ],
    });
  });

  it("conditionally revokes only the generation that installed a snapshot", () => {
    const index = new KnowledgeSourcePathIndex();
    const first = index.install([
      { bundleId: "bundle", sourceId: "source-1", sourcePath: "Sources/A.md" },
    ]);
    const second = index.install([
      { bundleId: "bundle", sourceId: "source-2", sourcePath: "Sources/B.md" },
    ]);

    index.revoke(first);
    expect(index.lookup("Sources/B.md").exact).toHaveLength(1);

    index.revoke(second);
    expect(index.lookup("Sources/B.md")).toEqual({
      exact: [],
      caseAliases: [],
      descendants: [],
    });
  });

  it("rejects duplicate identities and malformed paths without retaining input", () => {
    const index = new KnowledgeSourcePathIndex();
    expect(() =>
      index.install([
        { bundleId: "bundle", sourceId: "source", sourcePath: "Sources/A.md" },
        { bundleId: "bundle", sourceId: "source", sourcePath: "Sources/B.md" },
      ])
    ).toThrow(TypeError);
    expect(() =>
      index.install([{ bundleId: "bundle", sourceId: "source", sourcePath: "../outside.md" }])
    ).toThrow(TypeError);
    expect(index.lookup("../outside.md")).toEqual({
      exact: [],
      caseAliases: [],
      descendants: [],
    });
  });
});
