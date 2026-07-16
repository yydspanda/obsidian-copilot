import {
  findWindowsPathCollisions,
  isPathWithinRoot,
  parseVaultPath,
  toWindowsPathKey,
} from "@/knowledge/paths/vaultPath";

describe("parseVaultPath", () => {
  it("preserves a valid canonical path and its Unicode spelling", () => {
    const path = "资料/Cafe\u0301/研究笔记.md";

    expect(parseVaultPath(path)).toEqual({
      ok: true,
      path,
      segments: ["资料", "Cafe\u0301", "研究笔记.md"],
    });
  });

  it.each([
    ["", "path_required"],
    ["C:/Vault/note.md", "path_absolute"],
    ["C:Vault/note.md", "path_absolute"],
    ["/Vault/note.md", "path_absolute"],
    ["//server/share/note.md", "path_absolute"],
    ["\\\\server\\share\\note.md", "path_absolute"],
    ["\\\\?\\C:\\Vault\\note.md", "path_absolute"],
    ["folder\\note.md", "path_backslash"],
    ["folder//note.md", "path_empty_segment"],
    ["folder/", "path_empty_segment"],
    ["folder/./note.md", "path_traversal"],
    ["folder/../note.md", "path_traversal"],
    ["folder/na:me.md", "path_invalid_windows_character"],
    ["folder/control\u0001.md", "path_invalid_windows_character"],
    ["folder/CON", "path_windows_reserved_name"],
    ["folder/con.md", "path_windows_reserved_name"],
    ["folder/LPT9.txt", "path_windows_reserved_name"],
    ["folder/note.", "path_windows_trailing_character"],
    ["folder/note ", "path_windows_trailing_character"],
  ])("rejects %j with %s", (path, expectedCode) => {
    const result = parseVaultPath(path);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
    }
  });

  it("reports the precise invalid segment without creating a forbidden file", () => {
    const result = parseVaultPath("sources/valid/aux.json");

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "path_windows_reserved_name",
          message: "Path segment uses a Windows-reserved device name",
          segmentIndex: 2,
        },
      ],
    });
  });
});

describe("toWindowsPathKey", () => {
  it("normalizes separators, Unicode composition, and case", () => {
    expect(toWindowsPathKey("Wiki\\Cafe\u0301\\NOTE.md")).toBe(
      toWindowsPathKey("wiki/Caf\u00e9/note.md")
    );
  });
});

describe("isPathWithinRoot", () => {
  it("includes the root and descendants using Windows comparison rules", () => {
    expect(isPathWithinRoot("WIKI", "wiki")).toBe(true);
    expect(isPathWithinRoot("Wiki/Cafe\u0301/Note.md", "wiki/caf\u00e9")).toBe(true);
  });

  it("uses segment boundaries and rejects invalid input", () => {
    expect(isPathWithinRoot("wiki-old/note.md", "wiki")).toBe(false);
    expect(isPathWithinRoot("wiki\\note.md", "wiki")).toBe(false);
    expect(isPathWithinRoot("wiki/note.md", "C:/wiki")).toBe(false);
  });
});

describe("findWindowsPathCollisions", () => {
  it("groups case, separator, Unicode, and exact duplicate collisions", () => {
    expect(
      findWindowsPathCollisions([
        "Wiki/Note.md",
        "wiki/note.md",
        "Research/Cafe\u0301.md",
        "research/Caf\u00e9.md",
        "Queue/Job.json",
        "Queue/Job.json",
        "Drafts\\Page.md",
        "drafts/Page.md",
        "Unique/Page.md",
      ])
    ).toEqual([
      {
        key: "wiki/note.md",
        paths: ["Wiki/Note.md", "wiki/note.md"],
      },
      {
        key: "research/caf\u00e9.md",
        paths: ["Research/Cafe\u0301.md", "research/Caf\u00e9.md"],
      },
      {
        key: "queue/job.json",
        paths: ["Queue/Job.json", "Queue/Job.json"],
      },
      {
        key: "drafts/page.md",
        paths: ["Drafts\\Page.md", "drafts/Page.md"],
      },
    ]);
  });

  it("returns no groups when every Windows target is unique", () => {
    expect(findWindowsPathCollisions(["A.md", "B.md", "folder/A.md"])).toEqual([]);
  });
});
