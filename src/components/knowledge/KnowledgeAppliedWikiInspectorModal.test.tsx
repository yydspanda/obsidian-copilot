import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("lucide-react", () => ({
  ExternalLink: () => <span data-testid="external-link" />,
  Loader2: () => <span data-testid="loader" />,
}));

import {
  KnowledgeAppliedWikiInspectorContent,
  KnowledgeAppliedWikiInspectorModal,
} from "@/components/knowledge/KnowledgeAppliedWikiInspectorModal";
import type {
  KnowledgeAppliedWikiEvidenceOpenResult,
  KnowledgeAppliedWikiPageInspectionSession,
  KnowledgeAppliedWikiPageInspectorPort,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { KnowledgeAppliedWikiPageInspectorError } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type { KnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { App } from "obsidian";
import type { Root } from "react-dom/client";

jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(),
}));

jest.mock("obsidian", () => {
  class MockModal {
    app: unknown;
    contentEl = window.document.createElement("div");
    close = jest.fn();

    /** Captures the minimum Modal owner used by the wrapper suite. */
    constructor(app: unknown) {
      this.app = app;
    }
  }
  return { Modal: MockModal };
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/** Creates a manually controlled asynchronous result. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Creates one authentic-shape frozen UI session without private projector authority. */
function createSession(): Readonly<KnowledgeAppliedWikiPageInspectionSession> {
  return Object.freeze({
    pageRef: "a".repeat(64),
    displayPagePath: "Wiki/Topic.md",
    ownership: "shared",
    sources: Object.freeze([
      Object.freeze({
        sourceRef: "b".repeat(64),
        displaySourcePath: "Sources/Book.md",
        custody: "user_managed",
        acceptedAt: 1_765_000_000_000,
        evidence: Object.freeze([
          Object.freeze({
            evidenceRef: "c".repeat(64),
            relation: "supports",
            excerpt: '<img src="x" onerror="stolen()">',
            truncated: false,
            location: Object.freeze({
              kind: "markdown_lines" as const,
              startLine: 4,
              endLine: 7,
              heading: "Evidence",
              headingTruncated: false,
            }),
          }),
          Object.freeze({
            evidenceRef: "d".repeat(64),
            relation: "context",
            excerpt: "A second bounded excerpt",
            truncated: true,
            location: Object.freeze({ kind: "pdf_page" as const, page: 12 }),
          }),
        ]),
        omittedEvidenceCount: 2,
      }),
    ]),
    omittedSourceCount: 1,
  });
}

/** Creates a session projection for a different page without mutating the base fixture. */
function createSessionAt(pagePath: string): Readonly<KnowledgeAppliedWikiPageInspectionSession> {
  return Object.freeze({ ...createSession(), displayPagePath: pagePath });
}

/** Creates a configurable inspector recording the exact opaque calls. */
function createInspector(
  inspectPage: KnowledgeAppliedWikiPageInspectorPort["inspectPage"] = async () => createSession(),
  openEvidence: KnowledgeAppliedWikiPageInspectorPort["openEvidence"] = async () => ({
    kind: "opened",
  })
): KnowledgeAppliedWikiPageInspectorPort {
  return { inspectPage: jest.fn(inspectPage), openEvidence: jest.fn(openEvidence) };
}

/** Creates the separate read-only known-output capability used by the Modal. */
function createKnownOutputsHistory(): KnowledgeKnownAppliedWikiOutputsPort {
  return {
    inspectKnownOutputs: jest.fn(async () =>
      Object.freeze({
        pageRef: `known-wiki-page-${"e".repeat(64)}`,
        displayPagePath: "Wiki/Topic.md",
        currentState: "drifted" as const,
        currentMatch: "none" as const,
        knownOutputCount: 1,
        items: Object.freeze([
          Object.freeze({
            outputRef: `known-wiki-output-${"f".repeat(64)}`,
            appliedAt: 1_765_000_000_000,
            verifiedApplyCount: 1,
            relation: "latest_known" as const,
          }),
        ]),
      })
    ),
    listMore: jest.fn(async () =>
      Object.freeze({ kind: "loaded", value: Object.freeze({ items: Object.freeze([]) }) })
    ),
    readOutput: jest.fn(async () => Object.freeze({ kind: "unavailable" as const })),
    compareWithCurrent: jest.fn(async () => Object.freeze({ kind: "unavailable" as const })),
  };
}

/** Flushes pending promise continuations and React updates. */
async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("KnowledgeAppliedWikiInspectorContent", () => {
  it("loads and renders current-applied ownership, Sources, bounded evidence, and disclaimer", async () => {
    const inspector = createInspector();
    const { container } = render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Checking the current applied version"
    );
    await flushPromises();

    expect(screen.getByRole("heading", { name: "Applied Knowledge page" })).toBeTruthy();
    expect(screen.getByText("Wiki/Topic.md")).toBeTruthy();
    expect(screen.getByText("Shared page")).toBeTruthy();
    expect(screen.getByText("Sources/Book.md")).toBeTruthy();
    expect(screen.getByText("User-managed source")).toBeTruthy();
    expect(screen.getByText(/does not write, restore, or revise/)).toBeTruthy();
    expect(screen.getByText(/does not prove every sentence or changed block/)).toBeTruthy();
    expect(screen.getByText("Evidence · lines 4–7")).toBeTruthy();
    expect(screen.getByText("PDF page 12")).toBeTruthy();
    expect(screen.getByText("Excerpt shortened for review.")).toBeTruthy();
    expect(screen.getByText(/2 additional evidence items omitted/)).toBeTruthy();
    expect(screen.getByText(/1 additional contributing Source omitted/)).toBeTruthy();
    expect(screen.getByText('<img src="x" onerror="stolen()">')).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens evidence with only an opaque ref and enforces aborting last-request-wins", async () => {
    const first = createDeferred<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>();
    const second = createDeferred<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>();
    const signals: AbortSignal[] = [];
    const openEvidence = jest.fn(
      async (
        _session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
        evidenceRef: string,
        signal: AbortSignal
      ) => {
        signals.push(signal);
        return evidenceRef === "c".repeat(64) ? first.promise : second.promise;
      }
    );
    const inspector = createInspector(async () => createSession(), openEvidence);
    render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "Open exact source location 1" }));
    expect(screen.getByRole("status").textContent).toBe("Opening…");
    expect(openEvidence).toHaveBeenCalledWith(createSession(), "c".repeat(64), signals[0]);

    fireEvent.click(screen.getByRole("button", { name: "Open exact source location 2" }));
    expect(signals[0].aborted).toBe(true);
    expect(openEvidence.mock.calls[1][1]).toBe("d".repeat(64));

    await act(async () => {
      first.resolve({ kind: "stale" });
      await first.promise;
    });
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      second.resolve({ kind: "unavailable" });
      await second.promise;
    });
    expect(screen.getByRole("alert").textContent).toContain("could not be reopened");
  });

  it.each([
    ["not_applied", "no longer a current applied Knowledge page"],
    ["drifted", "has changed since Knowledge applied it"],
    ["unavailable", "could not be inspected"],
  ] as const)(
    "renders a safe %s failure without Source or evidence actions",
    async (code, text) => {
      const inspector = createInspector(async () => {
        throw new KnowledgeAppliedWikiPageInspectorError(code);
      });
      render(
        <KnowledgeAppliedWikiInspectorContent
          inspector={inspector}
          request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
          onClose={jest.fn()}
        />
      );
      await flushPromises();

      expect(screen.getByRole("alert").textContent).toContain(text);
      expect(screen.queryByText("Contributing Sources")).toBeNull();
      expect(screen.queryByRole("button", { name: /Open exact source/ })).toBeNull();
    }
  );

  it("opens known outputs through a separate capability even when the current page drifted", async () => {
    const inspector = createInspector(async () => {
      throw new KnowledgeAppliedWikiPageInspectorError("drifted");
    });
    render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        knownOutputs={createKnownOutputsHistory()}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );
    await flushPromises();
    expect(screen.getByRole("alert").textContent).toContain("changed since Knowledge applied it");

    fireEvent.click(screen.getByRole("button", { name: "Known applied outputs" }));
    await flushPromises();
    expect(screen.getByRole("heading", { name: "Known applied outputs" })).toBeTruthy();
    expect(screen.getByText("Current applied state not verified")).toBeTruthy();
    expect(screen.getByText(/not complete file history/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to current page" }));
    expect(screen.getByRole("heading", { name: "Applied Knowledge page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Known applied outputs" }).matches(":focus")).toBe(
      true
    );
  });

  it("aborts in-flight evidence before entering known outputs and ignores its late result", async () => {
    const navigation = createDeferred<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>();
    let navigationSignal: AbortSignal | undefined;
    const inspector = createInspector(
      async () => createSession(),
      async (_session, _ref, signal) => {
        navigationSignal = signal;
        return navigation.promise;
      }
    );
    render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        knownOutputs={createKnownOutputsHistory()}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "Open exact source location 1" }));
    expect(screen.getByRole("status").textContent).toBe("Opening…");
    fireEvent.click(screen.getByRole("button", { name: "Known applied outputs" }));
    expect(navigationSignal?.aborted).toBe(true);

    await act(async () => {
      navigation.resolve(Object.freeze({ kind: "unavailable" }));
      await navigation.promise;
    });
    await flushPromises();
    expect(screen.getByRole("heading", { name: "Known applied outputs" })).toBeTruthy();
    expect(screen.queryByText(/exact source location could not/)).toBeNull();
  });

  it("aborts an obsolete inspection and ignores its late completion when the page changes", async () => {
    const first = createDeferred<Readonly<KnowledgeAppliedWikiPageInspectionSession>>();
    const second = createDeferred<Readonly<KnowledgeAppliedWikiPageInspectionSession>>();
    const signals: AbortSignal[] = [];
    const inspector = createInspector(async (request, signal) => {
      signals.push(signal);
      return request.pagePath === "Wiki/First.md" ? first.promise : second.promise;
    });
    const { rerender } = render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/First.md" })}
        onClose={jest.fn()}
      />
    );

    rerender(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/Second.md" })}
        onClose={jest.fn()}
      />
    );
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      first.resolve(createSessionAt("Wiki/First.md"));
      await first.promise;
    });
    expect(screen.queryByText("Wiki/First.md")).toBeNull();

    await act(async () => {
      second.resolve(createSessionAt("Wiki/Second.md"));
      await second.promise;
    });
    expect(screen.getByText("Wiki/Second.md")).toBeTruthy();
  });

  it("aborts inspection work when unmounted", async () => {
    const inspection = createDeferred<Readonly<KnowledgeAppliedWikiPageInspectionSession>>();
    let inspectionSignal: AbortSignal | undefined;
    const inspector = createInspector(async (_request, signal) => {
      inspectionSignal = signal;
      return inspection.promise;
    });
    const { unmount } = render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );

    unmount();
    expect(inspectionSignal?.aborted).toBe(true);
  });

  it("aborts exact-source navigation work when unmounted", async () => {
    const navigation = createDeferred<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>();
    let navigationSignal: AbortSignal | undefined;
    const inspector = createInspector(
      async () => createSession(),
      async (_session, _ref, signal) => {
        navigationSignal = signal;
        return navigation.promise;
      }
    );
    const { unmount } = render(
      <KnowledgeAppliedWikiInspectorContent
        inspector={inspector}
        request={Object.freeze({ pagePath: "Wiki/Topic.md" })}
        onClose={jest.fn()}
      />
    );
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Open exact source location 1" }));

    unmount();
    expect(navigationSignal?.aborted).toBe(true);
  });
});

describe("KnowledgeAppliedWikiInspectorModal", () => {
  beforeEach(() => {
    jest.mocked(createPluginRoot).mockReset();
  });

  it("mounts through createPluginRoot and unmounts the exact modal root", () => {
    const root = {
      render: jest.fn(),
      unmount: jest.fn(),
    } as unknown as Root;
    jest.mocked(createPluginRoot).mockReturnValue(root);
    const app = {} as App;
    const modal = new KnowledgeAppliedWikiInspectorModal(
      app,
      Object.freeze({ pagePath: "Wiki/Topic.md" }),
      createInspector()
    );

    modal.onOpen();
    expect(createPluginRoot).toHaveBeenCalledWith(
      (modal as unknown as { contentEl: HTMLElement }).contentEl,
      app
    );
    expect(root.render).toHaveBeenCalledTimes(1);

    modal.onClose();
    expect(root.unmount).toHaveBeenCalledTimes(1);
  });

  it("notifies its lifecycle owner exactly once after synchronous cleanup", () => {
    const root = {
      render: jest.fn(),
      unmount: jest.fn(),
    } as unknown as Root;
    jest.mocked(createPluginRoot).mockReturnValue(root);
    const onClosed = jest.fn();
    const modal = new KnowledgeAppliedWikiInspectorModal(
      {} as App,
      Object.freeze({ pagePath: "Wiki/Topic.md" }),
      createInspector(),
      onClosed
    );

    modal.onOpen();
    modal.onClose();
    modal.onClose();

    expect(root.unmount).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith(modal);
  });

  it("releases lifecycle tracking even if React root cleanup fails", () => {
    const root = {
      render: jest.fn(),
      unmount: jest.fn(() => {
        throw new Error("root cleanup failure");
      }),
    } as unknown as Root;
    jest.mocked(createPluginRoot).mockReturnValue(root);
    const onClosed = jest.fn();
    const modal = new KnowledgeAppliedWikiInspectorModal(
      {} as App,
      Object.freeze({ pagePath: "Wiki/Topic.md" }),
      createInspector(),
      onClosed
    );

    modal.onOpen();
    expect(() => modal.onClose()).toThrow("root cleanup failure");
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(() => modal.onClose()).not.toThrow();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
