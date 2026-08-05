import {
  KNOWLEDGE_SCOPED_LEXICAL_LIMITS,
  KnowledgeScopedLexicalRetriever,
  KnowledgeScopedPageSnapshot,
} from "./KnowledgeScopedLexicalRetriever";

/** Creates one immutable page snapshot for retrieval tests. */
function page(
  evidenceId: string,
  path: string,
  content: string
): Readonly<KnowledgeScopedPageSnapshot> {
  return Object.freeze({
    evidenceId,
    path,
    contentHash: `${evidenceId}-content-hash`,
    content,
  });
}

describe("KnowledgeScopedLexicalRetriever", () => {
  const retriever = new KnowledgeScopedLexicalRetriever();

  it("ranks English title and heading fields without reading the supplied path", () => {
    const snapshots = [
      page("evidence-title", "accepted/Architecture.md", "# Architecture\nA concise overview."),
      page("evidence-body", "accepted/Notes.md", "# Notes\nArchitecture is discussed here."),
    ];

    const hits = retriever.retrieve("architecture", snapshots);

    expect(hits[0]).toMatchObject({
      evidenceId: "evidence-title",
      path: "accepted/Architecture.md",
      contentHash: "evidence-title-content-hash",
      heading: "Architecture",
    });
    expect(hits.every((hit) => snapshots.some((snapshot) => snapshot.path === hit.path))).toBe(
      true
    );
  });

  it("uses the shared Search v3 CJK token semantics", () => {
    const hits = retriever.retrieve("个人知识库", [
      page("wiki", "accepted/知识库.md", "# 编译流程\n个人知识库会持续沉淀知识。"),
      page("other", "accepted/天气.md", "# 天气\n今天适合散步。"),
    ]);

    expect(hits).not.toHaveLength(0);
    expect(hits.every((hit) => hit.evidenceId === "wiki")).toBe(true);
    expect(hits[0].matchedTerms).toEqual(expect.arrayContaining(["个人", "人知", "知识", "识库"]));
  });

  it("returns heading-first exact slices with nested heading context", () => {
    const content = [
      "Preamble retained with the first section.",
      "# Alpha",
      `needle alpha ${"alpha filler ".repeat(12)}`,
      "## Child",
      `needle child ${"child filler ".repeat(12)}`,
    ].join("\n");
    const snapshot = page("nested", "accepted/Nested.md", content);

    const hits = retriever.retrieve("needle", [snapshot], {
      maxResults: 20,
      maxChunkCharacters: 80,
    });

    expect(hits.map((hit) => hit.heading)).toEqual(expect.arrayContaining(["Alpha", "Child"]));
    expect(hits.find((hit) => hit.heading === "Child")?.headingPath).toEqual(["Alpha", "Child"]);
    for (const hit of hits) {
      expect(hit.content).toBe(content.slice(hit.startOffset, hit.endOffset));
      expect(hit.content.length).toBeLessThanOrEqual(80);
    }
  });

  it("ignores heading-like lines inside fenced code blocks", () => {
    const content = [
      "# Real heading",
      "needle before",
      "```markdown",
      "# Counterfeit heading",
      "needle inside code",
      "```",
      `needle after ${"filler ".repeat(30)}`,
    ].join("\n");

    const hits = retriever.retrieve("needle", [page("fenced", "accepted/Fenced.md", content)], {
      maxResults: 20,
      maxChunkCharacters: 80,
    });

    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map((hit) => hit.heading))).toEqual(new Set(["Real heading"]));
  });

  it("is deterministic across caller page order", () => {
    const first = page("first", "accepted/A.md", "# Common\ncommon material");
    const second = page("second", "accepted/B.md", "# Common\ncommon material");

    const forward = retriever.retrieve("common", [first, second], { maxResults: 10 });
    const reversed = retriever.retrieve("common", [second, first], { maxResults: 10 });

    expect(reversed).toEqual(forward);
    expect(forward.map((hit) => hit.path)).toEqual(["accepted/A.md", "accepted/B.md"]);
  });

  it("gives distinct pages one result before filling repeat-page slots", () => {
    const dominant = page(
      "dominant",
      "accepted/A.md",
      [
        `# One\ntarget target target ${"one ".repeat(30)}`,
        `# Two\ntarget target target ${"two ".repeat(30)}`,
        `# Three\ntarget target target ${"three ".repeat(30)}`,
      ].join("\n")
    );
    const secondary = page("secondary", "accepted/B.md", "# B\ntarget once");
    const tertiary = page("tertiary", "accepted/C.md", "# C\ntarget once");

    const hits = retriever.retrieve("target", [dominant, secondary, tertiary], {
      maxResults: 3,
      maxChunkCharacters: 80,
    });

    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((hit) => hit.evidenceId))).toEqual(
      new Set(["dominant", "secondary", "tertiary"])
    );
  });

  it("clamps top-K and freezes detached result metadata", () => {
    const snapshots = Array.from(
      { length: KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxResults + 5 },
      (_, index) => page(`evidence-${index}`, `accepted/${index}.md`, "# Match\nsharedterm")
    );

    const hits = retriever.retrieve("sharedterm", snapshots, { maxResults: Number.MAX_VALUE });

    expect(hits).toHaveLength(KNOWLEDGE_SCOPED_LEXICAL_LIMITS.maxResults);
    expect(Object.isFrozen(hits)).toBe(true);
    expect(Object.isFrozen(hits[0])).toBe(true);
    expect(Object.isFrozen(hits[0].matchedTerms)).toBe(true);
    expect(Object.isFrozen(hits[0].headingPath)).toBe(true);
  });

  it("fails closed on ambiguous evidence identity and returns no result for blank queries", () => {
    const duplicateA = page("duplicate", "accepted/A.md", "needle");
    const duplicateB = page("duplicate", "accepted/B.md", "needle");

    expect(() => retriever.retrieve("needle", [duplicateA, duplicateB])).toThrow(
      "evidenceId must be unique"
    );
    expect(retriever.retrieve("   ", [duplicateA])).toEqual([]);
  });
});
