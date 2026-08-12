import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("lucide-react", () => ({
  Loader2: () => <span data-testid="loader" />,
}));

import {
  isKnownAppliedWikiComparisonWithinBudget,
  isKnownAppliedWikiPreviewWithinBudget,
  KnowledgeKnownAppliedWikiOutputsView,
} from "@/components/knowledge/KnowledgeKnownAppliedWikiOutputsView";
import type {
  KnowledgeKnownAppliedWikiOutputDetail,
  KnowledgeKnownAppliedWikiOutputDetailResult,
  KnowledgeKnownAppliedWikiOutputsPageResult,
  KnowledgeKnownAppliedWikiOutputsPort,
  KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const PAGE_REF = `known-wiki-page-${"a".repeat(64)}`;
const FIRST_OUTPUT_REF = `known-wiki-output-${"b".repeat(64)}`;
const SECOND_OUTPUT_REF = `known-wiki-output-${"c".repeat(64)}`;
const FIRST_CURSOR = `known-wiki-cursor-${"d".repeat(64)}`;

/** Creates one deterministic opaque output ref for paging fixtures. */
function outputRef(index: number): string {
  return `known-wiki-output-${index.toString(16).padStart(64, "0")}`;
}

/** Creates one immutable output summary at an explicit global position. */
function createSummary(index: number, current = false) {
  return Object.freeze({
    outputRef: outputRef(index),
    appliedAt: 1_765_000_000_000 - index,
    verifiedApplyCount: 1,
    relation: current ? ("current_applied" as const) : ("earlier_known" as const),
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/** Creates a manually resolved promise for generation tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates one bounded authentic-shape UI session. */
function createSession(
  overrides: Partial<KnowledgeKnownAppliedWikiOutputsSession> = {}
): Readonly<KnowledgeKnownAppliedWikiOutputsSession> {
  const currentState = overrides.currentState ?? "applied";
  const currentMatch =
    overrides.currentMatch ?? (currentState === "applied" ? "current_applied" : "none");
  return Object.freeze({
    pageRef: PAGE_REF,
    displayPagePath: "Wiki/Topic.md",
    currentState,
    currentMatch,
    knownOutputCount: 2,
    items: Object.freeze([
      Object.freeze({
        outputRef: FIRST_OUTPUT_REF,
        appliedAt: 1_765_000_000_000,
        verifiedApplyCount: 1,
        relation: currentState === "applied" ? "current_applied" : "latest_known",
      }),
      Object.freeze({
        outputRef: SECOND_OUTPUT_REF,
        appliedAt: 1_764_000_000_000,
        verifiedApplyCount: 3,
        relation: "earlier_known" as const,
      }),
    ]),
    ...overrides,
  });
}

/** Creates a known-output port recording every opaque call. */
function createHistory(
  overrides: Partial<KnowledgeKnownAppliedWikiOutputsPort> = {}
): KnowledgeKnownAppliedWikiOutputsPort {
  const detail: Readonly<KnowledgeKnownAppliedWikiOutputDetail> = Object.freeze({
    outputRef: FIRST_OUTPUT_REF,
    appliedAt: 1_765_000_000_000,
    verifiedApplyCount: 1,
    content: "known output\r\n  exact spaces",
  });
  return {
    inspectKnownOutputs: jest.fn(async () => createSession()),
    listMore: jest.fn(async () =>
      Object.freeze({ kind: "loaded", value: Object.freeze({ items: Object.freeze([]) }) })
    ),
    readOutput: jest.fn(async () => Object.freeze({ kind: "loaded", value: detail })),
    compareWithCurrent: jest.fn(async () =>
      Object.freeze({
        kind: "loaded",
        value: Object.freeze({
          outputRef: detail.outputRef,
          currentState: "applied",
          knownContent: detail.content,
          currentContent: "current output\n   three spaces",
        }),
      })
    ),
    ...overrides,
  };
}

/** Flushes pending promise continuations and React updates. */
async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("KnowledgeKnownAppliedWikiOutputsView", () => {
  it("renders a bounded drift-safe list and explicitly disclaims recovery or backup semantics", async () => {
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ currentState: "drifted", currentMatch: "earlier_known" })
      ),
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );

    expect(screen.getByRole("status").textContent).toContain("Loading known applied outputs");
    await flushPromises();

    expect(screen.getByRole("heading", { name: "Known applied outputs" })).toBeTruthy();
    expect(screen.getByText("Current applied state not verified")).toBeTruthy();
    expect(screen.getByText(/matches a known applied output, but not/)).toBeTruthy();
    expect(screen.getByText(/not complete file history, File Recovery, or a backup/)).toBeTruthy();
    expect(screen.getByText(/cannot restore or overwrite/)).toBeTruthy();
    expect(screen.getByText("3 verified Apply records")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "View exact output" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /restore|revert|rollback|propose/i })).toBeNull();
  });

  it("rejects an inconsistent first page before rendering any output action", async () => {
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ knownOutputCount: 0, nextCursor: undefined })
      ),
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();

    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.queryByRole("button", { name: "View exact output" })).toBeNull();
  });

  it("paginates with an opaque cursor and returns to an already verified page", async () => {
    const firstItems = Object.freeze(
      Array.from({ length: 20 }, (_, index) => createSummary(index, index === 0))
    );
    const nextItems = Object.freeze([createSummary(20)]);
    const listMore: jest.MockedFunction<KnowledgeKnownAppliedWikiOutputsPort["listMore"]> = jest.fn(
      async (_session, _cursor, _signal) =>
        Object.freeze({
          kind: "loaded" as const,
          value: Object.freeze({
            items: nextItems,
          }),
        })
    );
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ knownOutputCount: 21, items: firstItems, nextCursor: FIRST_CURSOR })
      ),
      listMore,
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await flushPromises();
    expect(listMore.mock.calls[0][1]).toBe(FIRST_CURSOR);
    expect(screen.getAllByRole("button", { name: "View exact output" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getAllByRole("button", { name: "View exact output" })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await flushPromises();
    expect(screen.getAllByRole("button", { name: "View exact output" })).toHaveLength(1);
    expect(listMore).toHaveBeenCalledTimes(1);
  });

  it("invalidates the session instead of rendering an oversized metadata page", async () => {
    const oversizedItems = Object.freeze(
      Array.from({ length: 21 }, (_, index) =>
        Object.freeze({
          outputRef: `known-wiki-output-${index.toString(16).padStart(64, "0")}`,
          appliedAt: 1_765_000_000_000 - index,
          verifiedApplyCount: 1,
          relation: "earlier_known" as const,
        })
      )
    );
    const firstItems = Object.freeze(
      Array.from({ length: 20 }, (_, index) => createSummary(index, index === 0))
    );
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ knownOutputCount: 21, items: firstItems, nextCursor: FIRST_CURSOR })
      ),
      listMore: jest.fn(async () =>
        Object.freeze({
          kind: "loaded" as const,
          value: Object.freeze({ items: oversizedItems }),
        })
      ),
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await flushPromises();

    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.queryByRole("button", { name: "View exact output" })).toBeNull();
  });

  it.each(["stale", "unavailable"] as const)(
    "exits an invalid %s paging session without retaining output actions",
    async (kind) => {
      const firstItems = Object.freeze(
        Array.from({ length: 20 }, (_, index) => createSummary(index, index === 0))
      );
      const history = createHistory({
        inspectKnownOutputs: jest.fn(async () =>
          createSession({ knownOutputCount: 21, items: firstItems, nextCursor: FIRST_CURSOR })
        ),
        listMore: jest.fn(async () => Object.freeze({ kind })),
      });
      render(
        <KnowledgeKnownAppliedWikiOutputsView
          history={history}
          request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
          onBack={jest.fn()}
        />
      );
      await flushPromises();
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      await flushPromises();

      expect(screen.getByRole("alert").textContent).toMatch(
        /no longer current|could not be verified/
      );
      expect(screen.queryByRole("button", { name: "View exact output" })).toBeNull();
    }
  );

  it("does not abort or start a detail read while an opaque page is loading", async () => {
    const firstItems = Object.freeze(
      Array.from({ length: 20 }, (_, index) => createSummary(index, index === 0))
    );
    const deferred = createDeferred<KnowledgeKnownAppliedWikiOutputsPageResult>();
    let pageSignal: AbortSignal | undefined;
    const listMore = jest.fn(async (_session, _cursor, signal: AbortSignal) => {
      pageSignal = signal;
      return deferred.promise;
    });
    const readOutput = jest.fn(async () => Object.freeze({ kind: "unavailable" as const }));
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ knownOutputCount: 21, items: firstItems, nextCursor: FIRST_CURSOR })
      ),
      listMore,
      readOutput,
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    const detailButton = screen.getAllByRole("button", { name: "View exact output" })[0];
    expect(detailButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(detailButton);
    expect(readOutput).not.toHaveBeenCalled();
    expect(pageSignal?.aborted).toBe(false);

    await act(async () => {
      deferred.resolve(
        Object.freeze({
          kind: "loaded",
          value: Object.freeze({ items: Object.freeze([createSummary(20)]) }),
        })
      );
      await deferred.promise;
    });
    expect(screen.getAllByRole("button", { name: "View exact output" })).toHaveLength(1);
  });

  it("renders exact detail as inert plain text and compares without normalizing whitespace", async () => {
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ currentState: "drifted", currentMatch: "none" })
      ),
      compareWithCurrent: jest.fn(async () =>
        Object.freeze({
          kind: "loaded" as const,
          value: Object.freeze({
            outputRef: FIRST_OUTPUT_REF,
            currentState: "drifted" as const,
            knownContent: "known output\r\n  exact spaces",
            currentContent: "current output\n   three spaces",
          }),
        })
      ),
    });
    const { container } = render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();

    fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
    await flushPromises();
    const detailText = container.querySelector("pre");
    expect(detailText?.textContent).toBe("known output\r\n  exact spaces");
    expect(container.querySelector("script,img")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compare with current file" }));
    await flushPromises();
    expect(screen.getByText(/Line endings and spaces are preserved/)).toBeTruthy();
    expect(screen.getByLabelText("Known applied output text").textContent).toContain(
      "known output\r\n  exact spaces"
    );
    expect(screen.getByLabelText("Current file text").textContent).toContain(
      "current output\n   three spaces"
    );
    expect(screen.getByText("Current applied state not verified")).toBeTruthy();
  });

  it.each([
    ["different known text", "applied"],
    ["known output\r\n  exact spaces", "drifted"],
  ] as const)(
    "rejects a comparison receipt with mismatched content or current state",
    async (knownContent, currentState) => {
      const history = createHistory({
        compareWithCurrent: jest.fn(async () =>
          Object.freeze({
            kind: "loaded" as const,
            value: Object.freeze({
              outputRef: FIRST_OUTPUT_REF,
              currentState,
              knownContent,
              currentContent: "current output",
            }),
          })
        ),
      });
      render(
        <KnowledgeKnownAppliedWikiOutputsView
          history={history}
          request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
          onBack={jest.fn()}
        />
      );
      await flushPromises();
      fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
      await flushPromises();
      fireEvent.click(screen.getByRole("button", { name: "Compare with current file" }));
      await flushPromises();

      expect(screen.getByRole("alert").textContent).toContain("could not be verified");
      expect(screen.queryByLabelText("Current file text")).toBeNull();
    }
  );

  it("keeps exact known text inspectable without offering comparison when the file is missing", async () => {
    const compareWithCurrent = jest.fn(async () => Object.freeze({ kind: "unavailable" as const }));
    const history = createHistory({
      inspectKnownOutputs: jest.fn(async () =>
        createSession({ currentState: "missing", currentMatch: "none" })
      ),
      compareWithCurrent,
    });
    const { container } = render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
    await flushPromises();

    expect(container.querySelector("pre")?.textContent).toBe("known output\r\n  exact spaces");
    expect(screen.getByText(/current file is missing/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compare with current file" })).toBeNull();
    expect(compareWithCurrent).not.toHaveBeenCalled();
  });

  it("fails closed before rendering an oversized detail or comparison", async () => {
    const outputRef = FIRST_OUTPUT_REF;
    const tooLarge = "x".repeat(65_537);
    const detailResult: KnowledgeKnownAppliedWikiOutputDetailResult = Object.freeze({
      kind: "loaded",
      value: Object.freeze({
        outputRef,
        appliedAt: 1_765_000_000_000,
        verifiedApplyCount: 1,
        content: tooLarge,
      }),
    });
    const history = createHistory({ readOutput: jest.fn(async () => detailResult) });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
    await flushPromises();

    expect(screen.getByRole("alert").textContent).toContain("too large");
    expect(screen.queryByText(tooLarge)).toBeNull();
    expect(isKnownAppliedWikiPreviewWithinBudget(tooLarge)).toBe(false);
    expect(isKnownAppliedWikiComparisonWithinBudget("x".repeat(40_000), "y".repeat(30_000))).toBe(
      false
    );
  });

  it("rejects detail metadata that does not match the selected summary receipt", async () => {
    const history = createHistory({
      readOutput: jest.fn(async () =>
        Object.freeze({
          kind: "loaded" as const,
          value: Object.freeze({
            outputRef: FIRST_OUTPUT_REF,
            appliedAt: 1_765_000_000_001,
            verifiedApplyCount: 1,
            content: "misbound output",
          }),
        })
      ),
    });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
    await flushPromises();

    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.queryByText("misbound output")).toBeNull();
  });

  it("aborts a child read on Back and ignores its late result", async () => {
    const deferred = createDeferred<KnowledgeKnownAppliedWikiOutputDetailResult>();
    let signal: AbortSignal | undefined;
    const readOutput = jest.fn(
      async (
        _session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
        _outputRef: string,
        readSignal: AbortSignal
      ) => {
        signal = readSignal;
        return deferred.promise;
      }
    );
    const history = createHistory({ readOutput });
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={history}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getAllByRole("button", { name: "View exact output" })[0]);
    expect(screen.getByRole("status").textContent).toContain("Loading bounded exact text");
    fireEvent.click(screen.getByRole("button", { name: "Back to known outputs" }));
    expect(signal?.aborted).toBe(true);

    const lateDetail: Readonly<KnowledgeKnownAppliedWikiOutputDetail> = Object.freeze({
      outputRef: FIRST_OUTPUT_REF,
      appliedAt: 1_765_000_000_000,
      verifiedApplyCount: 1,
      content: "must remain hidden",
    });
    await act(async () => {
      deferred.resolve(Object.freeze({ kind: "loaded", value: lateDetail }));
      await deferred.promise;
    });
    expect(screen.queryByText("must remain hidden")).toBeNull();
    expect(screen.getByRole("heading", { name: "Known applied outputs" }).matches(":focus")).toBe(
      true
    );
  });

  it("returns focus through the realm-local Back button without global document access", async () => {
    const onBack = jest.fn();
    render(
      <KnowledgeKnownAppliedWikiOutputsView
        history={createHistory()}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onBack={onBack}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Back to current page" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
