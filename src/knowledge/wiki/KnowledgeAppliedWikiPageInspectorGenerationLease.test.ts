import {
  KnowledgeAppliedWikiPageInspectorGenerationLease,
  type KnowledgeAppliedWikiPageInspectorGenerationLeaseInput,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorGenerationLease";
import type { KnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type { KnowledgeAppliedWikiPathIndexLease } from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

/** Creates one inert delegate identity for lease tests. */
function createDelegate(): KnowledgeAppliedWikiPageInspectorPort {
  return {
    inspectPage: async () => {
      throw new Error("unused");
    },
    openEvidence: async () => ({ kind: "unavailable" }),
  };
}

/** Creates a recording lease harness with optional reentrant invalidation point. */
function createHarness(invalidateDuring?: "install" | "replace"): {
  input: KnowledgeAppliedWikiPageInspectorGenerationLeaseInput;
  events: string[];
  invalidate(): void;
} {
  const events: string[] = [];
  let invalidate = (): void => undefined;
  const delegate = createDelegate();
  const input: KnowledgeAppliedWikiPageInspectorGenerationLeaseInput = {
    delegate,
    indexRows: [{ bundleId: "personal", pagePath: "Wiki/A.md" }],
    subscribeInvalidation: (listener) => {
      events.push("subscribe");
      invalidate = listener;
      return () => events.push("unsubscribe");
    },
    installPathIndex: () => {
      events.push("install-index");
      if (invalidateDuring === "install") invalidate();
      return Object.freeze(Object.create(null)) as KnowledgeAppliedWikiPathIndexLease;
    },
    revokePathIndex: () => events.push("revoke-index"),
    replaceDelegate: () => {
      events.push("replace-delegate");
      if (invalidateDuring === "replace") invalidate();
    },
    revokeDelegate: () => events.push("revoke-delegate"),
    assertCurrent: () => undefined,
  };
  return { input, events, invalidate: () => invalidate() };
}

describe("KnowledgeAppliedWikiPageInspectorGenerationLease", () => {
  it("installs index before delegate and revokes both on close", () => {
    const harness = createHarness();
    const lease = new KnowledgeAppliedWikiPageInspectorGenerationLease(harness.input);

    expect(harness.events).toEqual(["subscribe", "install-index", "replace-delegate"]);
    lease.close();
    lease.close();

    expect(harness.events).toEqual([
      "subscribe",
      "install-index",
      "replace-delegate",
      "unsubscribe",
      "revoke-index",
      "revoke-delegate",
    ]);
  });

  it("unconditionally revokes an index returned after reentrant invalidation", () => {
    const harness = createHarness("install");

    expect(() => new KnowledgeAppliedWikiPageInspectorGenerationLease(harness.input)).toThrow(
      /aborted/i
    );
    expect(harness.events).toEqual([
      "subscribe",
      "install-index",
      "unsubscribe",
      "revoke-index",
      "revoke-delegate",
    ]);
  });

  it("unconditionally revokes a delegate published during reentrant invalidation", () => {
    const harness = createHarness("replace");

    expect(() => new KnowledgeAppliedWikiPageInspectorGenerationLease(harness.input)).toThrow(
      /aborted/i
    );
    expect(harness.events).toEqual([
      "subscribe",
      "install-index",
      "replace-delegate",
      "revoke-index",
      "unsubscribe",
      "revoke-delegate",
    ]);
  });

  it("does not let closing an old lease revoke a newer conditional installation", () => {
    const current = { delegate: undefined as KnowledgeAppliedWikiPageInspectorPort | undefined };
    const revoked: KnowledgeAppliedWikiPageInspectorPort[] = [];
    const createInput = (): KnowledgeAppliedWikiPageInspectorGenerationLeaseInput => {
      const delegate = createDelegate();
      return {
        delegate,
        indexRows: [],
        subscribeInvalidation: () => () => undefined,
        replaceDelegate: (value) => {
          current.delegate = value;
        },
        revokeDelegate: (value) => {
          if (current.delegate === value) {
            revoked.push(value);
            current.delegate = undefined;
          }
        },
        installPathIndex: () =>
          Object.freeze(Object.create(null)) as KnowledgeAppliedWikiPathIndexLease,
        revokePathIndex: () => undefined,
        assertCurrent: () => undefined,
      };
    };
    const old = new KnowledgeAppliedWikiPageInspectorGenerationLease(createInput());
    const next = new KnowledgeAppliedWikiPageInspectorGenerationLease(createInput());

    old.close();
    expect(revoked).toEqual([]);
    expect(current.delegate).toBeDefined();

    next.close();
    expect(revoked).toHaveLength(1);
    expect(current.delegate).toBeUndefined();
  });
});
