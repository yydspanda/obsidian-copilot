jest.mock("@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort", () => {
  type Operation = () => Promise<unknown>;
  const operations = new WeakMap<object, Operation>();

  /** Test-only exact adapter used to exercise lease authenticity and revocation. */
  class MockKnowledgeProductionForwardRevisionProposalActionAdapter {
    /** Mints one exact adapter around a controlled operation. */
    constructor(operation: Operation) {
      operations.set(this, operation);
      Object.freeze(this);
    }

    /** Requires one exact test adapter instance. */
    static assert(
      value: unknown
    ): asserts value is MockKnowledgeProductionForwardRevisionProposalActionAdapter {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.getPrototypeOf(value) !==
          MockKnowledgeProductionForwardRevisionProposalActionAdapter.prototype ||
        !operations.has(value)
      ) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    }

    /** Runs the operation retained by this exact adapter. */
    async proposeKnownOutput(): Promise<unknown> {
      const operation = operations.get(this);
      if (!operation) throw new DOMException("The operation was aborted", "AbortError");
      return operation();
    }
  }

  return {
    KnowledgeProductionForwardRevisionProposalActionAdapter:
      MockKnowledgeProductionForwardRevisionProposalActionAdapter,
  };
});

import { DelegatingKnowledgeForwardRevisionProposalActionPort } from "@/knowledge/forwardRevision/DelegatingKnowledgeForwardRevisionProposalActionPort";
import { KnowledgeForwardRevisionProposalActionGenerationLease } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionGenerationLease";
import { KnowledgeProductionForwardRevisionProposalActionAdapter } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import type { KnowledgeKnownAppliedWikiOutputsSession } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const SESSION = Object.freeze({}) as Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
const OUTPUT_REF = `known-wiki-output-${"5".repeat(64)}`;
const REVIEW_REF = `forward-studio-review-${"7".repeat(64)}`;

/** Mints one test-authentic adapter through the mocked production boundary. */
function createAdapter(
  operation: () => Promise<unknown> = async () => Object.freeze({ kind: "stale" as const })
): KnowledgeProductionForwardRevisionProposalActionAdapter {
  const Constructor = KnowledgeProductionForwardRevisionProposalActionAdapter as unknown as new (
    operation: () => Promise<unknown>
  ) => KnowledgeProductionForwardRevisionProposalActionAdapter;
  return new Constructor(operation);
}

/** Requires one operation to throw platform-standard cancellation. */
function expectAbortError(operation: () => void): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DOMException);
  if (!(caught instanceof DOMException)) throw new Error("Expected a DOMException");
  expect(caught.name).toBe("AbortError");
}

describe("KnowledgeForwardRevisionProposalActionGenerationLease", () => {
  it("installs and conditionally revokes one exact production adapter", async () => {
    const stable = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    const delegate = createAdapter();
    let invalidate = (): void => undefined;
    const lease = new KnowledgeForwardRevisionProposalActionGenerationLease({
      delegate,
      subscribeInvalidation: (listener) => {
        invalidate = listener;
        return () => undefined;
      },
      replaceDelegate: (candidate) => stable.replaceDelegate(candidate),
      revokeDelegate: (candidate) => stable.revokeDelegate(candidate),
      assertCurrent: () => undefined,
    });
    await expect(
      stable.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });

    invalidate();
    expectAbortError(() => lease.assertCurrent());
    await expect(
      stable.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("rejects a duck-typed mutation delegate before publication callbacks run", () => {
    const replaceDelegate = jest.fn();
    const duckTyped: unknown = {
      proposeKnownOutput: async () =>
        Object.freeze({ kind: "published" as const, reviewRef: REVIEW_REF }),
    };
    expectAbortError(
      () =>
        new KnowledgeForwardRevisionProposalActionGenerationLease({
          delegate: duckTyped as KnowledgeProductionForwardRevisionProposalActionAdapter,
          subscribeInvalidation: () => () => undefined,
          replaceDelegate,
          revokeDelegate: jest.fn(),
          assertCurrent: () => undefined,
        })
    );
    expect(replaceDelegate).not.toHaveBeenCalled();
  });

  it("cleans up synchronous invalidation during publication", () => {
    const delegate = createAdapter();
    let invalidate = (): void => undefined;
    const revokeDelegate = jest.fn();
    expectAbortError(
      () =>
        new KnowledgeForwardRevisionProposalActionGenerationLease({
          delegate,
          subscribeInvalidation: (listener) => {
            invalidate = listener;
            return () => undefined;
          },
          replaceDelegate: () => invalidate(),
          revokeDelegate,
          assertCurrent: () => undefined,
        })
    );
    expect(revokeDelegate).toHaveBeenCalledWith(delegate);
  });

  it("does not let an obsolete lease revoke a newer adapter", async () => {
    const stable = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    const oldDelegate = createAdapter(async () => Object.freeze({ kind: "stale" as const }));
    const nextDelegate = createAdapter(async () =>
      Object.freeze({ kind: "published" as const, reviewRef: REVIEW_REF })
    );
    const oldLease = new KnowledgeForwardRevisionProposalActionGenerationLease({
      delegate: oldDelegate,
      subscribeInvalidation: () => () => undefined,
      replaceDelegate: (candidate) => stable.replaceDelegate(candidate),
      revokeDelegate: (candidate) => stable.revokeDelegate(candidate),
      assertCurrent: () => undefined,
    });
    const nextLease = new KnowledgeForwardRevisionProposalActionGenerationLease({
      delegate: nextDelegate,
      subscribeInvalidation: () => () => undefined,
      replaceDelegate: (candidate) => stable.replaceDelegate(candidate),
      revokeDelegate: (candidate) => stable.revokeDelegate(candidate),
      assertCurrent: () => undefined,
    });

    oldLease.close();
    await expect(
      stable.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "published", reviewRef: REVIEW_REF });
    nextLease.close();
  });
});
