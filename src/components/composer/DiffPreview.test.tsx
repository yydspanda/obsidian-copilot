import { render, screen } from "@testing-library/react";
import type { Change } from "diff";
import React from "react";

import {
  buildDiffRows,
  SideBySideDiffBlock,
  splitDiffLines,
  SplitDiffBlock,
  type WordDiffPart,
  wordLevelDiff,
} from "@/components/composer/DiffPreview";

/** Reconstructs one exact side from word-level diff segments. */
function reconstructWordDiff(
  parts: readonly WordDiffPart[],
  side: "original" | "modified"
): string {
  return parts
    .filter((part) => (side === "original" ? !part.added : !part.removed))
    .map((part) => part.value)
    .join("");
}

/** Creates one fully typed diff chunk for a test fixture. */
function createChange(
  value: string,
  kind: "added" | "removed" | "unchanged" = "unchanged"
): Change {
  return {
    value,
    added: kind === "added",
    removed: kind === "removed",
    count: 1,
  };
}

describe("DiffPreview", () => {
  it("preserves exact whitespace and Unicode through word-level diffing", () => {
    const original = "Alpha  beta,\t世界";
    const modified = "Alpha beta!\n世界";

    const parts = wordLevelDiff(original, modified);

    expect(reconstructWordDiff(parts, "original")).toBe(original);
    expect(reconstructWordDiff(parts, "modified")).toBe(modified);
    expect(parts.some((part) => part.removed)).toBe(true);
    expect(parts.some((part) => part.added)).toBe(true);
  });

  it("retains meaningful blank rows and trailing whitespace without an extra terminator row", () => {
    expect(splitDiffLines("first  \n\n")).toEqual(["first  ", ""]);
    expect(splitDiffLines("single\n")).toEqual(["single"]);
    expect(splitDiffLines("")).toEqual([]);
  });

  it("aligns replacement rows exactly and pads the shorter side with null", () => {
    const block: Change[] = [
      createChange("old  \nsecond\n\n", "removed"),
      createChange("new\t\n", "added"),
    ];

    expect(buildDiffRows(block)).toEqual([
      { original: "old  ", modified: "new\t", isUnchanged: false },
      { original: "second", modified: null, isUnchanged: false },
      { original: "", modified: null, isUnchanged: false },
    ]);
    expect(block).toEqual([
      { value: "old  \nsecond\n\n", added: false, removed: true, count: 1 },
      { value: "new\t\n", added: true, removed: false, count: 1 },
    ]);
  });

  it("represents unchanged, standalone removal, and standalone addition rows", () => {
    expect(
      buildDiffRows([
        createChange("same\n"),
        createChange("gone\n", "removed"),
        createChange("added\n", "added"),
      ])
    ).toEqual([
      { original: "same", modified: "same", isUnchanged: true },
      { original: "gone", modified: "added", isUnchanged: false },
    ]);

    expect(buildDiffRows([createChange("gone\n", "removed")])).toEqual([
      { original: "gone", modified: null, isUnchanged: false },
    ]);
    expect(buildDiffRows([createChange("added\n", "added")])).toEqual([
      { original: null, modified: "added", isUnchanged: false },
    ]);
  });

  it("renders the existing side-by-side error and success highlights", () => {
    const { container } = render(
      <SideBySideDiffBlock
        block={[createChange("old value\n", "removed"), createChange("new value\n", "added")]}
      />
    );

    expect(container.querySelector(".tw-bg-error")?.textContent).toBe("old");
    expect(container.querySelector(".tw-bg-success")?.textContent).toBe("new");
  });

  it("renders the existing split labels and shows unchanged content only once", () => {
    const { rerender } = render(
      <SplitDiffBlock
        block={[createChange("before\n", "removed"), createChange("after\n", "added")]}
      />
    );

    expect(screen.getByText("Original")).toBeTruthy();
    expect(screen.getByText("Modified")).toBeTruthy();

    rerender(<SplitDiffBlock block={[createChange("unchanged exactly\n")]} />);
    expect(screen.queryByText("Original")).toBeNull();
    expect(screen.queryByText("Modified")).toBeNull();
    expect(screen.getAllByText("unchanged exactly")).toHaveLength(1);
  });
});
