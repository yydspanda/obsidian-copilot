import { tokenizeMixed } from "./tokenizeMixed";

describe("tokenizeMixed", () => {
  it("preserves the Search v3 ASCII, CJK, and hierarchical-tag contract", () => {
    expect(tokenizeMixed("TypeScript 中文编程 #Project/Alpha")).toEqual(
      expect.arrayContaining([
        "typescript",
        "中文",
        "文编",
        "编程",
        "#project/alpha",
        "project/alpha",
        "#project",
        "project",
        "alpha",
      ])
    );
  });

  it("does not manufacture partial words from hyphenated tags", () => {
    const tokens = tokenizeMixed("#copilot-conversation updates");

    expect(tokens).toContain("#copilot-conversation");
    expect(tokens).toContain("copilot-conversation");
    expect(tokens).not.toContain("copilot");
    expect(tokens).not.toContain("conversation");
  });
});
