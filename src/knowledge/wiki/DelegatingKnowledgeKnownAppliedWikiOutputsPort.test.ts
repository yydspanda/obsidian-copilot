import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import type {
  KnowledgeKnownAppliedWikiOutputOriginSummary,
  KnowledgeKnownAppliedWikiOutputsPort,
  KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const ref = (kind: "page" | "output" | "cursor", value: string): string =>
  `known-wiki-${kind}-${value.padStart(64, "0")}`;

/** Creates one deeply frozen source-Apply provenance summary. */
function origins(
  appliedAt: number
): readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[] {
  return Object.freeze([
    Object.freeze({
      kind: "source_apply" as const,
      verifiedApplyCount: 1,
      newestAppliedAt: appliedAt,
      newestManifestRevision: Math.max(1, appliedAt),
    }),
  ]);
}

function createSession(): Readonly<KnowledgeKnownAppliedWikiOutputsSession> {
  return Object.freeze({
    pageRef: ref("page", "a"),
    displayPagePath: "Wiki/Page.md",
    currentState: "applied" as const,
    currentMatch: "current_applied" as const,
    knownOutputCount: 21,
    items: Object.freeze(
      Array.from({ length: 20 }, (_, index) =>
        Object.freeze({
          outputRef: ref("output", (index + 1).toString(16)),
          appliedAt: 100 - index,
          verifiedApplyCount: 1,
          origins: origins(100 - index),
          relation: index === 0 ? ("current_applied" as const) : ("earlier_known" as const),
          proposalCapability:
            index === 0 ? ("selected_is_current" as const) : ("available" as const),
        })
      )
    ),
    nextCursor: ref("cursor", "b"),
  });
}

function createDelegate(): KnowledgeKnownAppliedWikiOutputsPort {
  const session = createSession();
  return Object.freeze({
    inspectKnownOutputs: async () => session,
    listMore: async () =>
      Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          items: Object.freeze([
            Object.freeze({
              outputRef: ref("output", "15"),
              appliedAt: 1,
              verifiedApplyCount: 1,
              origins: origins(1),
              relation: "earlier_known" as const,
              proposalCapability: "available" as const,
            }),
          ]),
        }),
      }),
    readOutput: async (
      _session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
      outputRef: string
    ) =>
      Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          appliedAt: 100,
          verifiedApplyCount: 1,
          origins: origins(100),
          proposalCapability: "selected_is_current" as const,
          content: "known",
        }),
      }),
    compareWithCurrent: async (
      _session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
      outputRef: string
    ) =>
      Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          currentState: "applied" as const,
          knownContent: "known",
          currentContent: "known",
        }),
      }),
  });
}

describe("DelegatingKnowledgeKnownAppliedWikiOutputsPort", () => {
  it("binds refs to the authentic session and consumes each cursor once", async () => {
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    port.replaceDelegate(createDelegate());
    const session = await port.inspectKnownOutputs(
      { pagePath: "Wiki/Page.md" },
      new AbortController().signal
    );

    await expect(
      port.readOutput(session, ref("output", "ff"), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      port.listMore(session, session.nextCursor!, new AbortController().signal)
    ).resolves.toMatchObject({ kind: "loaded" });
    await expect(
      port.listMore(session, session.nextCursor!, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      port.compareWithCurrent(session, session.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({
      kind: "loaded",
      value: {
        outputRef: session.items[0].outputRef,
        currentState: "applied",
        knownContent: "known",
        currentContent: "known",
      },
    });
  });

  it("rejects undisclosed refs and malformed correlated receipts", async () => {
    const delegate = createDelegate();
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    port.replaceDelegate(delegate);
    const first = await port.inspectKnownOutputs(
      { pagePath: "Wiki/Page.md" },
      new AbortController().signal
    );
    await expect(
      port.readOutput(first, ref("output", "ff"), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });

    const wrongReceipt = Object.freeze({
      ...delegate,
      readOutput: async () =>
        Object.freeze({
          kind: "loaded" as const,
          value: Object.freeze({
            outputRef: first.items[0].outputRef,
            appliedAt: 999,
            verifiedApplyCount: 1,
            origins: origins(999),
            proposalCapability: "selected_is_current" as const,
            content: "known",
          }),
        }),
    });
    port.replaceDelegate(wrongReceipt);
    const next = await port.inspectKnownOutputs(
      { pagePath: "Wiki/Page.md" },
      new AbortController().signal
    );
    await expect(
      port.readOutput(next, next.items[0].outputRef, new AbortController().signal)
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("aborts in-flight work and revokes old sessions on replacement", async () => {
    let release: ((value: Readonly<KnowledgeKnownAppliedWikiOutputsSession>) => void) | undefined;
    let linkedSignal: AbortSignal | undefined;
    const delegate = Object.freeze({
      ...createDelegate(),
      inspectKnownOutputs: async (_request: unknown, signal: AbortSignal) => {
        linkedSignal = signal;
        return await new Promise<Readonly<KnowledgeKnownAppliedWikiOutputsSession>>((resolve) => {
          release = resolve;
        });
      },
    });
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    port.replaceDelegate(delegate);
    const pending = port.inspectKnownOutputs(
      { pagePath: "Wiki/Page.md" },
      new AbortController().signal
    );
    port.replaceDelegate(createDelegate());
    expect(linkedSignal?.aborted).toBe(true);
    release?.(createSession());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not dispatch pre-aborted reads or consume the cursor", async () => {
    const base = createDelegate();
    const listMore = jest.fn(base.listMore);
    const readOutput = jest.fn(base.readOutput);
    const compareWithCurrent = jest.fn(base.compareWithCurrent);
    const delegate = Object.freeze({ ...base, listMore, readOutput, compareWithCurrent });
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    port.replaceDelegate(delegate);
    const session = await port.inspectKnownOutputs(
      { pagePath: "Wiki/Page.md" },
      new AbortController().signal
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(port.listMore(session, session.nextCursor!, aborted.signal)).rejects.toMatchObject(
      {
        name: "AbortError",
      }
    );
    await expect(
      port.readOutput(session, session.items[0].outputRef, aborted.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      port.compareWithCurrent(session, session.items[0].outputRef, aborted.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(listMore).not.toHaveBeenCalled();
    expect(readOutput).not.toHaveBeenCalled();
    expect(compareWithCurrent).not.toHaveBeenCalled();
    await expect(
      port.listMore(session, session.nextCursor!, new AbortController().signal)
    ).resolves.toMatchObject({ kind: "loaded" });
  });

  it("does not publish a DTO whose snapshot trap replaced the generation", async () => {
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    const replacement = createDelegate();
    let replaced = false;
    const hostile = new Proxy(createSession(), {
      getPrototypeOf(target) {
        if (!replaced) {
          replaced = true;
          port.replaceDelegate(replacement);
        }
        return Reflect.getPrototypeOf(target);
      },
    });
    port.replaceDelegate(
      Object.freeze({
        ...createDelegate(),
        inspectKnownOutputs: async () => hostile,
      })
    );
    await expect(
      port.inspectKnownOutputs({ pagePath: "Wiki/Page.md" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("authenticates only the exact stable port that owns opaque output sessions", () => {
    const port = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    const delegate = createDelegate();
    port.replaceDelegate(delegate);
    expect(() => DelegatingKnowledgeKnownAppliedWikiOutputsPort.assert(port)).not.toThrow();
    expect(() =>
      DelegatingKnowledgeKnownAppliedWikiOutputsPort.assertCurrentDelegate(port, delegate)
    ).not.toThrow();
    expect(() =>
      DelegatingKnowledgeKnownAppliedWikiOutputsPort.assertCurrentDelegate(port, createDelegate())
    ).toThrow(DOMException);
    expect(() =>
      DelegatingKnowledgeKnownAppliedWikiOutputsPort.assert(
        Object.create(DelegatingKnowledgeKnownAppliedWikiOutputsPort.prototype)
      )
    ).toThrow(DOMException);
    expect(() =>
      DelegatingKnowledgeKnownAppliedWikiOutputsPort.assert(new Proxy(port, {}))
    ).toThrow(DOMException);

    class ForgedSubclass extends DelegatingKnowledgeKnownAppliedWikiOutputsPort {}
    expect(() =>
      DelegatingKnowledgeKnownAppliedWikiOutputsPort.assert(new ForgedSubclass())
    ).toThrow(DOMException);
  });
});
