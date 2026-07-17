import { diffArrays, type Change } from "diff";
import React, { memo, useMemo } from "react";

/** One line-aligned row rendered by a diff preview. */
export interface DiffRow {
  original: string | null;
  modified: string | null;
  isUnchanged: boolean;
}

/** One exact word-level diff segment. */
export interface WordDiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** Side of a two-way diff being rendered. */
export type DiffSide = "original" | "modified";

/** Props shared by the reusable block preview renderers. */
export interface DiffBlockProps {
  block: readonly Change[];
}

/**
 * Performs a word-level diff while preserving the exact input substrings.
 *
 * Whitespace is tokenized separately so joining every non-added part recreates
 * `original`, and joining every non-removed part recreates `modified`.
 *
 * @param original - Original text to compare
 * @param modified - Modified text to compare
 * @returns Exact ordered diff segments
 */
export function wordLevelDiff(original: string, modified: string): WordDiffPart[] {
  const tokenize = (value: string): string[] => value.split(/(\s+)/).filter(Boolean);
  const diff = diffArrays(tokenize(original), tokenize(modified));

  return diff.map((part) => ({
    value: part.value.join(""),
    added: part.added,
    removed: part.removed,
  }));
}

/**
 * Splits one diff chunk into visible rows without trimming row content.
 *
 * A single terminal empty item produced by the line terminator is removed;
 * additional blank lines remain visible.
 *
 * @param value - Exact diff chunk text
 * @returns Visible row values in source order
 */
export function splitDiffLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Converts ordered diff chunks into aligned original/modified rows.
 *
 * Adjacent removal and addition chunks are paired by row for word-level
 * highlighting. Standalone additions and removals retain a null placeholder on
 * the opposite side.
 *
 * @param block - Exact diff chunks for one visual block
 * @returns Line-aligned rows without modifying the input chunks
 */
export function buildDiffRows(block: readonly Change[]): DiffRow[] {
  const rows: DiffRow[] = [];

  let index = 0;
  while (index < block.length) {
    const current = block[index];

    if (!current.added && !current.removed) {
      splitDiffLines(current.value).forEach((line) => {
        rows.push({ original: line, modified: line, isUnchanged: true });
      });
      index += 1;
      continue;
    }

    if (current.removed) {
      const next = block[index + 1];
      if (next?.added) {
        const originalLines = splitDiffLines(current.value);
        const modifiedLines = splitDiffLines(next.value);
        const rowCount = Math.max(originalLines.length, modifiedLines.length);

        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          rows.push({
            original: originalLines[rowIndex] ?? null,
            modified: modifiedLines[rowIndex] ?? null,
            isUnchanged: false,
          });
        }
        index += 2;
        continue;
      }

      splitDiffLines(current.value).forEach((line) => {
        rows.push({ original: line, modified: null, isUnchanged: false });
      });
      index += 1;
      continue;
    }

    if (current.added) {
      splitDiffLines(current.value).forEach((line) => {
        rows.push({ original: null, modified: line, isUnchanged: false });
      });
    }
    index += 1;
  }

  return rows;
}

/** Props for one word-highlighted side of a replacement row. */
interface WordDiffSpanProps {
  original: string;
  modified: string;
  side: DiffSide;
}

/** Renders the exact visible segments for one side of a word-level replacement. */
const WordDiffSpan = memo(({ original, modified, side }: WordDiffSpanProps) => {
  const diff = wordLevelDiff(original, modified);

  return (
    <span>
      {diff.map((part, index) => {
        if (side === "original") {
          if (part.removed) {
            return (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- exact diff segments are stable and never reordered
              <span key={index} className="tw-bg-error tw-text-error">
                {part.value}
              </span>
            );
          }
          if (part.added) return null;
        } else {
          if (part.added) {
            return (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- exact diff segments are stable and never reordered
              <span key={index} className="tw-bg-success tw-text-success">
                {part.value}
              </span>
            );
          }
          if (part.removed) return null;
        }
        return (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- exact diff segments are stable and never reordered
          <span key={index}>{part.value}</span>
        );
      })}
    </span>
  );
});

WordDiffSpan.displayName = "WordDiffSpan";

/** Props for one line-aligned diff cell. */
interface DiffCellProps {
  row: DiffRow;
  side: DiffSide;
}

/** Renders one original or modified row with the appropriate highlight. */
const DiffCell = memo(({ row, side }: DiffCellProps) => {
  const text = side === "original" ? row.original : row.modified;
  const paired = side === "original" ? row.modified : row.original;

  if (text === null) {
    return <span className="tw-text-muted">&nbsp;</span>;
  }

  if (row.isUnchanged) {
    return <span className="tw-text-normal">{text || "\u00A0"}</span>;
  }

  if (paired !== null && row.original !== null && row.modified !== null) {
    return <WordDiffSpan original={row.original} modified={row.modified} side={side} />;
  }

  const highlightClass =
    side === "original" ? "tw-bg-error tw-text-error" : "tw-bg-success tw-text-success";
  return <span className={highlightClass}>{text || "\u00A0"}</span>;
});

DiffCell.displayName = "DiffCell";

/** Renders one diff block as aligned original and modified columns. */
export const SideBySideDiffBlock = memo(({ block }: DiffBlockProps) => {
  const rows = useMemo(() => buildDiffRows(block), [block]);

  return (
    <div className="tw-grid tw-grid-cols-2 tw-gap-2">
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- rows are derived once per immutable block and never reordered
          <div key={index} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="original" />
          </div>
        ))}
      </div>

      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- rows are derived once per immutable block and never reordered
          <div key={index} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="modified" />
          </div>
        ))}
      </div>
    </div>
  );
});

SideBySideDiffBlock.displayName = "SideBySideDiffBlock";

/** Renders one diff block as stacked original and modified regions. */
export const SplitDiffBlock = memo(({ block }: DiffBlockProps) => {
  const hasChanges = block.some((change) => change.added || change.removed);
  const rows = useMemo(() => buildDiffRows(block), [block]);

  if (!hasChanges) {
    return (
      <div className="tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
        {block.map((change, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- chunks are derived once per immutable block and never reordered
          <span key={index}>{change.value}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Original</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
          {rows.map((row, index) =>
            row.original !== null ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- rows are derived once per immutable block and never reordered
              <div key={index}>
                <DiffCell row={row} side="original" />
              </div>
            ) : null
          )}
        </div>
      </div>

      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Modified</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
          {rows.map((row, index) =>
            row.modified !== null ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- rows are derived once per immutable block and never reordered
              <div key={index}>
                <DiffCell row={row} side="modified" />
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
});

SplitDiffBlock.displayName = "SplitDiffBlock";
