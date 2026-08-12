import type { KnowledgeReviewPlan } from "@/knowledge/review/ReviewDecision";
import { KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS } from "@/knowledge/review/ReviewDecision";
import {
  createKnowledgeReviewDraftIdentity,
  KnowledgeReviewDraftStore,
} from "@/knowledge/ui/KnowledgeReviewDraftStore";

/** Creates one compact exact-identity plan for the data-only draft store. */
function createPlan(snapshotToken = "snapshot-1"): KnowledgeReviewPlan {
  return {
    changeSetId: "changeset-1",
    bundleId: "personal",
    proposalDigest: "a".repeat(64),
    snapshotToken,
    operation: "ingest",
    sourceRefs: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    createdAt: 1,
    evidence: [],
    omittedEvidenceCount: 0,
    files: Array.from({ length: 5 }, (_, index) => ({
      changeId: `change-${index + 1}`,
      path: `Wiki/${index + 1}.md`,
      operation: "update" as const,
      reason: "Update page",
      sourceRefs: [],
      integrity: "current" as const,
      capability: "blocks_allowed" as const,
      beforeContent: "before",
      afterContent: "after",
      blocks: [
        {
          blockId: `block-${index + 1}`,
          kind: "change" as const,
          parts: [{ kind: "added" as const, value: "after" }],
        },
      ],
    })),
  };
}

describe("KnowledgeReviewDraftStore", () => {
  it("retains detached decisions and an active buffer only for exact Review identity", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    const decisions = {
      "change-1": { kind: "accept_edited" as const, afterContent: "saved\n" },
    };

    store.write(identity, plan, decisions);
    store.writeActiveEdit(identity, plan, { changeId: "change-1", afterContent: "typing\n" });
    decisions["change-1"].afterContent = "mutated";

    expect(store.read(identity)).toEqual({
      "change-1": { kind: "accept_edited", afterContent: "saved\n" },
    });
    expect(store.readActiveEdit(identity)).toEqual({
      changeId: "change-1",
      afterContent: "typing\n",
    });
    expect(Object.isFrozen(store.read(identity))).toBe(true);
    expect(Object.isFrozen(store.readActiveEdit(identity))).toBe(true);
    expect(
      store.read(createKnowledgeReviewDraftIdentity("personal", createPlan("snapshot-2")))
    ).toEqual({});
  });

  it("never retains a per-file or replacement-total over-budget editor value", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    const retained = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    store.write(identity, plan, {
      "change-1": { kind: "accept_edited", afterContent: retained },
      "change-2": { kind: "accept_edited", afterContent: retained },
      "change-3": { kind: "accept_edited", afterContent: retained },
      "change-4": { kind: "accept_edited", afterContent: retained },
    });

    expect(() =>
      store.writeActiveEdit(identity, plan, {
        changeId: "change-1",
        afterContent: `${retained}x`,
      })
    ).toThrow(RangeError);
    expect(store.readActiveEdit(identity)).toBeUndefined();

    expect(() =>
      store.writeActiveEdit(identity, plan, {
        changeId: "change-5",
        afterContent: "x",
      })
    ).toThrow(RangeError);
    expect(store.readActiveEdit(identity)).toBeUndefined();
  });

  it("reconciles changed tokens and clears all content at session end", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    store.write(identity, plan, { "change-1": { kind: "accept_exact" } });
    store.writeActiveEdit(identity, plan, { changeId: "change-1", afterContent: "typing" });

    expect(store.reconcile("personal", [plan])).toBe(false);
    expect(store.reconcile("personal", [createPlan("snapshot-2")])).toBe(true);
    expect(store.read(identity)).toEqual({});
    expect(store.readActiveEdit(identity)).toBeUndefined();

    store.write(identity, plan, { "change-1": { kind: "reject" } });
    store.clear();
    expect(store.read(identity)).toEqual({});
  });

  it("enforces one aggregate eight-million-character budget across proposal identities", () => {
    const store = new KnowledgeReviewDraftStore();
    const firstPlan = createPlan("snapshot-1");
    const first = createKnowledgeReviewDraftIdentity("personal", firstPlan);
    const secondPlan = {
      ...createPlan("snapshot-2"),
      changeSetId: "changeset-2",
      proposalDigest: "b".repeat(64),
    };
    const second = createKnowledgeReviewDraftIdentity("personal", secondPlan);
    const chunk = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    store.write(first, firstPlan, {
      "change-1": { kind: "accept_edited", afterContent: chunk },
      "change-2": { kind: "accept_edited", afterContent: chunk },
      "change-3": { kind: "accept_edited", afterContent: chunk },
      "change-4": { kind: "accept_edited", afterContent: chunk },
    });

    expect(() =>
      store.writeActiveEdit(second, secondPlan, { changeId: "change-5", afterContent: "x" })
    ).toThrow(RangeError);
    expect(store.readActiveEdit(second)).toBeUndefined();
    expect(store.read(first)["change-4"]).toEqual({
      kind: "accept_edited",
      afterContent: chunk,
    });

    store.delete(first);
    expect(
      store.writeActiveEdit(second, secondPlan, { changeId: "change-5", afterContent: "x" })
    ).toEqual({ changeId: "change-5", afterContent: "x" });
  });

  it("counts saved and active strings physically across exact proposal identities", () => {
    const store = new KnowledgeReviewDraftStore();
    const chunk = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    Array.from({ length: 4 }, (_, index) => {
      const plan = {
        ...createPlan(`snapshot-${index}`),
        changeSetId: `changeset-${index}`,
        proposalDigest: String(index).repeat(64),
      };
      const identity = createKnowledgeReviewDraftIdentity("personal", plan);
      store.write(identity, plan, {
        "change-1": { kind: "accept_edited", afterContent: chunk },
      });
      store.writeActiveEdit(identity, plan, { changeId: "change-1", afterContent: "" });
    });
    const overflowPlan = {
      ...createPlan("snapshot-overflow"),
      changeSetId: "changeset-overflow",
      proposalDigest: "f".repeat(64),
    };
    const overflow = createKnowledgeReviewDraftIdentity("personal", overflowPlan);

    expect(() =>
      store.writeActiveEdit(overflow, overflowPlan, {
        changeId: "change-1",
        afterContent: "x",
      })
    ).toThrow(RangeError);
    expect(store.readActiveEdit(overflow)).toBeUndefined();
  });

  it("atomically commits the active edit without transiently double-counting its text", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    const chunk = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    const base = {
      "change-1": { kind: "accept_edited" as const, afterContent: chunk },
      "change-2": { kind: "accept_edited" as const, afterContent: chunk },
      "change-3": { kind: "accept_edited" as const, afterContent: chunk },
    };
    store.write(identity, plan, base);
    store.writeActiveEdit(identity, plan, { changeId: "change-4", afterContent: chunk });

    expect(
      store.write(identity, plan, {
        ...base,
        "change-4": { kind: "accept_edited", afterContent: chunk },
      })
    ).toMatchObject({
      "change-4": { kind: "accept_edited", afterContent: chunk },
    });
    expect(store.readActiveEdit(identity)).toBeUndefined();
  });

  it("does not retain an empty entry after cancelling an undecided active edit", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    store.writeActiveEdit(identity, plan, { changeId: "change-1", afterContent: "temporary" });

    store.writeActiveEdit(identity, plan, undefined);

    expect(store.read(identity)).toEqual({});
    expect(store.readActiveEdit(identity)).toBeUndefined();
    expect(store.reconcile("personal", [createPlan("snapshot-2")])).toBe(false);
  });

  it("rejects accessors, unknown identities, invalid blocks, and extra active-edit keys", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "change-1", {
      enumerable: true,
      get: () => ({ kind: "reject" }),
    });

    expect(() => store.write(identity, plan, accessor)).toThrow(TypeError);
    expect(() => store.write(identity, plan, { unknown: { kind: "reject" } })).toThrow(TypeError);
    expect(() =>
      store.write(identity, plan, {
        "change-1": { kind: "accept_blocks", blocks: { unknown: "accept" } },
      })
    ).toThrow(TypeError);
    expect(() =>
      store.writeActiveEdit(identity, plan, {
        changeId: "change-1",
        afterContent: "safe",
        extra: true,
      })
    ).toThrow(TypeError);
    expect(store.read(identity)).toEqual({});
    expect(store.readActiveEdit(identity)).toBeUndefined();
  });

  it("allows ephemeral unsupported text but rejects it when committed as a decision", () => {
    const store = new KnowledgeReviewDraftStore();
    const plan = createPlan();
    const identity = createKnowledgeReviewDraftIdentity("personal", plan);
    const unsupported = "temporary\ud800";

    expect(
      store.writeActiveEdit(identity, plan, {
        changeId: "change-1",
        afterContent: unsupported,
      })
    ).toEqual({ changeId: "change-1", afterContent: unsupported });
    expect(() =>
      store.write(identity, plan, {
        "change-1": { kind: "accept_edited", afterContent: unsupported },
      })
    ).toThrow(TypeError);
    expect(store.read(identity)).toEqual({});
    expect(store.readActiveEdit(identity)?.afterContent).toBe(unsupported);
  });
});
