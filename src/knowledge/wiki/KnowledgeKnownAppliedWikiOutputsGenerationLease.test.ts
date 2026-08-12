import { KnowledgeKnownAppliedWikiOutputsGenerationLease } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsGenerationLease";
import type { KnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const delegate = Object.freeze({}) as KnowledgeKnownAppliedWikiOutputsPort;

/** Requires one operation to throw a platform AbortError. */
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

describe("KnowledgeKnownAppliedWikiOutputsGenerationLease", () => {
  it("publishes and conditionally revokes one exact delegate", () => {
    let invalidate = (): void => undefined;
    const replace = jest.fn();
    const revoke = jest.fn();
    const lease = new KnowledgeKnownAppliedWikiOutputsGenerationLease({
      delegate,
      subscribeInvalidation: (listener) => {
        invalidate = listener;
        return () => undefined;
      },
      replaceDelegate: replace,
      revokeDelegate: revoke,
      assertCurrent: () => undefined,
    });
    expect(replace).toHaveBeenCalledWith(delegate);
    invalidate();
    expect(revoke).toHaveBeenCalledWith(delegate);
    expectAbortError(() => lease.assertCurrent());
  });

  it("cleans up a synchronously invalidated publication", () => {
    let invalidate = (): void => undefined;
    const revoke = jest.fn();
    expectAbortError(
      () =>
        new KnowledgeKnownAppliedWikiOutputsGenerationLease({
          delegate,
          subscribeInvalidation: (listener) => {
            invalidate = listener;
            return () => undefined;
          },
          replaceDelegate: () => invalidate(),
          revokeDelegate: revoke,
          assertCurrent: () => undefined,
        })
    );
    expect(revoke).toHaveBeenCalledWith(delegate);
  });

  it("conditionally revokes when publication installs and then throws", () => {
    const revoke = jest.fn();
    expectAbortError(
      () =>
        new KnowledgeKnownAppliedWikiOutputsGenerationLease({
          delegate,
          subscribeInvalidation: () => () => undefined,
          replaceDelegate: () => {
            throw new Error("installed then threw");
          },
          revokeDelegate: revoke,
          assertCurrent: () => undefined,
        })
    );
    expect(revoke).toHaveBeenCalledWith(delegate);
  });

  it("retries exact revocation when invalidation fires during publication", () => {
    let invalidate = (): void => undefined;
    const revoke = jest.fn();
    expectAbortError(
      () =>
        new KnowledgeKnownAppliedWikiOutputsGenerationLease({
          delegate,
          subscribeInvalidation: (listener) => {
            invalidate = listener;
            return () => undefined;
          },
          replaceDelegate: () => invalidate(),
          revokeDelegate: revoke,
          assertCurrent: () => undefined,
        })
    );
    expect(revoke.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(revoke).toHaveBeenLastCalledWith(delegate);
  });
});
