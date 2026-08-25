import { DelegatingKnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/DelegatingKnowledgeAppliedWikiPageInspectorPort";
import {
  KnowledgeAppliedWikiPageInspectorError,
  type KnowledgeAppliedWikiEvidenceOpenResult,
  type KnowledgeAppliedWikiPageInspectionSession,
  type KnowledgeAppliedWikiPageInspectorPort,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";

const PAGE_REF = "a".repeat(64);
const PAGE_HASH = "d".repeat(64);
const SOURCE_REF = "b".repeat(64);
const EVIDENCE_REF = "c".repeat(64);

/** Creates one valid delegate-owned session DTO. */
function createSession(pagePath = "Wiki/Applied.md"): KnowledgeAppliedWikiPageInspectionSession {
  return {
    pageRef: PAGE_REF,
    displayPagePath: pagePath,
    ownership: "generated",
    sourceAppliedContentHash: PAGE_HASH,
    effectiveContentHash: PAGE_HASH,
    origin: { kind: "source_apply" },
    evidenceScope: "source_applied_content",
    sources: [
      {
        sourceRef: SOURCE_REF,
        displaySourcePath: "Sources/Book.md",
        custody: "user_managed",
        acceptedAt: 10,
        evidence: [
          {
            evidenceRef: EVIDENCE_REF,
            relation: "supports",
            excerpt: "Bounded evidence",
            truncated: false,
            location: { kind: "markdown_lines", startLine: 2, endLine: 3 },
          },
        ],
        omittedEvidenceCount: 0,
      },
    ],
    omittedSourceCount: 0,
  };
}

/** Creates a delegate and records exact session identity used for opening. */
function createDelegate(pagePath = "Wiki/Applied.md"): KnowledgeAppliedWikiPageInspectorPort & {
  delegateSession: KnowledgeAppliedWikiPageInspectionSession;
  openEvidence: jest.Mock<Promise<KnowledgeAppliedWikiEvidenceOpenResult>>;
} {
  const delegateSession = createSession(pagePath);
  return {
    delegateSession,
    inspectPage: async () => delegateSession,
    openEvidence: jest.fn(async () => ({ kind: "opened" as const })),
  };
}

describe("DelegatingKnowledgeAppliedWikiPageInspectorPort", () => {
  it("starts unavailable and publishes a detached deeply frozen wrapper session", async () => {
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    const signal = new AbortController().signal;

    await expect(port.inspectPage({ pagePath: "Wiki/Applied.md" }, signal)).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeAppliedWikiPageInspectorError>>({
        code: "unavailable",
      })
    );

    const delegate = createDelegate();
    port.replaceDelegate(delegate);
    const session = await port.inspectPage({ pagePath: "Wiki/Applied.md" }, signal);

    expect(session).toEqual(delegate.delegateSession);
    expect(session).not.toBe(delegate.delegateSession);
    expect(session.sources).not.toBe(delegate.delegateSession.sources);
    expect(session.origin).not.toBe(delegate.delegateSession.origin);
    expect(session.sources[0].evidence).not.toBe(delegate.delegateSession.sources[0].evidence);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.sources)).toBe(true);
    expect(Object.isFrozen(session.sources[0].evidence[0].location)).toBe(true);

    await expect(port.openEvidence(session, EVIDENCE_REF, signal)).resolves.toEqual({
      kind: "opened",
    });
    expect(delegate.openEvidence).toHaveBeenCalledWith(
      delegate.delegateSession,
      EVIDENCE_REF,
      expect.any(AbortSignal)
    );
  });

  it("refuses equal forged sessions and references not issued in the session", async () => {
    const delegate = createDelegate();
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(delegate);
    const session = await port.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      port.openEvidence(
        { ...session, sources: session.sources },
        EVIDENCE_REF,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      port.openEvidence(session, "d".repeat(64), new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(delegate.openEvidence).not.toHaveBeenCalled();
  });

  it("releases old session bindings and never redirects them into a replacement", async () => {
    const oldDelegate = createDelegate();
    const replacement = createDelegate("Wiki/New.md");
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(oldDelegate);
    const oldSession = await port.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    port.replaceDelegate(replacement);

    await expect(
      port.openEvidence(oldSession, EVIDENCE_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(oldDelegate.openEvidence).not.toHaveBeenCalled();
    expect(replacement.openEvidence).not.toHaveBeenCalled();
  });

  it("aborts in-flight inspection when its generation is replaced", async () => {
    let finish: ((session: KnowledgeAppliedWikiPageInspectionSession) => void) | undefined;
    const oldDelegate = createDelegate();
    oldDelegate.inspectPage = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(oldDelegate);
    const pending = port.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal);
    await Promise.resolve();

    port.replaceDelegate(createDelegate());
    finish?.(oldDelegate.delegateSession);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["replace", "unavailable", "dispose", "caller"] as const)(
    "does not report a late opened result after %s revokes an in-flight open",
    async (action) => {
      let finish: ((result: KnowledgeAppliedWikiEvidenceOpenResult) => void) | undefined;
      const delegate = createDelegate();
      delegate.openEvidence = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
      port.replaceDelegate(delegate);
      const session = await port.inspectPage(
        { pagePath: "Wiki/Applied.md" },
        new AbortController().signal
      );
      const caller = new AbortController();
      const pending = port.openEvidence(session, EVIDENCE_REF, caller.signal);
      await Promise.resolve();

      if (action === "replace") port.replaceDelegate(createDelegate());
      if (action === "unavailable") port.setUnavailable();
      if (action === "dispose") port.dispose();
      if (action === "caller") caller.abort();
      finish?.({ kind: "opened" });

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    }
  );

  it("stays permanently unavailable after dispose", async () => {
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(createDelegate());
    port.dispose();

    expect(() => port.replaceDelegate(createDelegate())).toThrow(
      KnowledgeAppliedWikiPageInspectorError
    );
    await expect(
      port.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects accessor delegate methods without invoking them", () => {
    let getterCalls = 0;
    const hostile = {} as KnowledgeAppliedWikiPageInspectorPort;
    Object.defineProperty(hostile, "inspectPage", {
      get: () => {
        getterCalls += 1;
        return async () => createSession();
      },
    });
    Object.defineProperty(hostile, "openEvidence", {
      value: async () => ({ kind: "opened" as const }),
    });

    expect(() =>
      new DelegatingKnowledgeAppliedWikiPageInspectorPort().replaceDelegate(hostile)
    ).toThrow(KnowledgeAppliedWikiPageInspectorError);
    expect(getterCalls).toBe(0);
  });

  it("rejects accessor DTO array entries without invoking them", async () => {
    let getterCalls = 0;
    const delegate = createDelegate();
    const sources: KnowledgeAppliedWikiPageInspectionSession["sources"] = [];
    Object.defineProperty(sources, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return createSession().sources[0];
      },
    });
    Object.defineProperty(sources, "length", { value: 1 });
    delegate.delegateSession = { ...delegate.delegateSession, sources };
    delegate.inspectPage = async () => delegate.delegateSession;
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(delegate);

    await expect(
      port.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal)
    ).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeAppliedWikiPageInspectorError>>({
        code: "unavailable",
      })
    );
    expect(getterCalls).toBe(0);
  });

  it("does not trust a forged error code getter from a delegate", async () => {
    let getterCalls = 0;
    const delegate = createDelegate();
    delegate.inspectPage = async () => {
      const error = new Error("forged delegate error");
      Object.defineProperty(error, "code", {
        get: () => {
          getterCalls += 1;
          return "not_applied";
        },
      });
      throw error;
    };
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(delegate);

    await expect(
      port.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal)
    ).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeAppliedWikiPageInspectorError>>({
        code: "unavailable",
      })
    );
    expect(getterCalls).toBe(0);
  });

  it("maps a malformed open-result getter to unavailable without invoking it", async () => {
    let getterCalls = 0;
    const delegate = createDelegate();
    delegate.openEvidence = jest.fn(async () => {
      const result = {} as KnowledgeAppliedWikiEvidenceOpenResult;
      Object.defineProperty(result, "kind", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return "opened";
        },
      });
      return result;
    });
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(delegate);
    const session = await port.inspectPage(
      { pagePath: "Wiki/Applied.md" },
      new AbortController().signal
    );

    await expect(
      port.openEvidence(session, EVIDENCE_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "unavailable" });
    expect(getterCalls).toBe(0);
  });

  it("removes caller abort listeners after a successful operation", async () => {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, "addEventListener");
    const remove = jest.spyOn(controller.signal, "removeEventListener");
    const port = new DelegatingKnowledgeAppliedWikiPageInspectorPort();
    port.replaceDelegate(createDelegate());

    await port.inspectPage({ pagePath: "Wiki/Applied.md" }, controller.signal);

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("rejects method calls on prototype forgeries", async () => {
    const forged = Object.create(
      DelegatingKnowledgeAppliedWikiPageInspectorPort.prototype
    ) as DelegatingKnowledgeAppliedWikiPageInspectorPort;

    await expect(
      forged.inspectPage({ pagePath: "Wiki/Applied.md" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
