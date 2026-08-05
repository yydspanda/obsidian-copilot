import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
} from "@/knowledge/ui/KnowledgeStudioController";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";
import {
  hasExactKnowledgeBundleSequence,
  KnowledgeStudioReadGenerationLease,
} from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";

type KnowledgeStudioPort = KnowledgeStudioReadPort & KnowledgeStudioCommandPort;

/** Creates one complete inert delegate for lease identity tests. */
function createDelegate(): KnowledgeStudioPort {
  return new UnavailableKnowledgeStudioPort("Test-only delegate");
}

/** Requires one synchronous action to throw the sanitized cancellation category. */
function expectAbortError(action: () => void): void {
  let captured: unknown;
  try {
    action();
  } catch (error) {
    captured = error;
  }
  expect(captured).toEqual(
    expect.objectContaining({ name: "AbortError", message: "The operation was aborted" })
  );
}

describe("KnowledgeStudioReadGenerationLease", () => {
  it("accepts only the exact ordered Bundle sequence", () => {
    expect(hasExactKnowledgeBundleSequence(["personal", "work"], ["personal", "work"])).toBe(true);
    expect(hasExactKnowledgeBundleSequence(["work", "personal"], ["personal", "work"])).toBe(false);
    expect(hasExactKnowledgeBundleSequence(["personal"], ["personal", "work"])).toBe(false);
    expect(hasExactKnowledgeBundleSequence(["personal", 1], ["personal", "work"])).toBe(false);
    expect(hasExactKnowledgeBundleSequence(null, ["personal"])).toBe(false);
  });

  it("registers invalidation before replacement and withdraws idempotently", () => {
    const events: string[] = [];
    let invalidate: (() => void) | undefined;
    const delegate = createDelegate();
    const lease = new KnowledgeStudioReadGenerationLease({
      delegate,
      subscribeInvalidation: (listener) => {
        events.push("subscribe");
        invalidate = listener;
        return () => events.push("unsubscribe");
      },
      replaceDelegate: (value) => {
        expect(value).toBe(delegate);
        events.push("replace");
      },
      setUnavailable: () => events.push("unavailable"),
      assertCurrent: () => events.push("assert"),
    });

    expect(events).toEqual(["subscribe", "assert", "replace", "assert"]);
    lease.assertCurrent();
    invalidate?.();
    invalidate?.();
    expectAbortError(() => lease.assertCurrent());
    lease.close();
    lease.close();
    expect(events).toEqual([
      "subscribe",
      "assert",
      "replace",
      "assert",
      "assert",
      "unavailable",
      "unsubscribe",
    ]);
  });

  it("never replaces the delegate when invalidation fires during subscription", () => {
    const replaceDelegate = jest.fn();
    const setUnavailable = jest.fn();

    expectAbortError(
      () =>
        new KnowledgeStudioReadGenerationLease({
          delegate: createDelegate(),
          subscribeInvalidation: (listener) => {
            listener();
            return jest.fn();
          },
          replaceDelegate,
          setUnavailable,
          assertCurrent: jest.fn(),
        })
    );
    expect(replaceDelegate).not.toHaveBeenCalled();
    expect(setUnavailable).toHaveBeenCalledTimes(1);
  });

  it("lets unavailable replacement win when invalidation is re-entrant", () => {
    const events: string[] = [];
    let invalidate: (() => void) | undefined;

    expectAbortError(
      () =>
        new KnowledgeStudioReadGenerationLease({
          delegate: createDelegate(),
          subscribeInvalidation: (listener) => {
            invalidate = listener;
            return () => events.push("unsubscribe");
          },
          replaceDelegate: () => {
            events.push("replace-live");
            invalidate?.();
          },
          setUnavailable: () => events.push("replace-unavailable"),
          assertCurrent: () => events.push("assert"),
        })
    );
    expect(events).toEqual(["assert", "replace-live", "replace-unavailable", "unsubscribe"]);
  });

  it("sanitizes installation failures and cleans the invalidation subscription", () => {
    const unsubscribe = jest.fn();
    const setUnavailable = jest.fn();

    expectAbortError(
      () =>
        new KnowledgeStudioReadGenerationLease({
          delegate: createDelegate(),
          subscribeInvalidation: () => unsubscribe,
          replaceDelegate: () => {
            throw new Error("secret replacement detail");
          },
          setUnavailable,
          assertCurrent: jest.fn(),
        })
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(setUnavailable).toHaveBeenCalledTimes(1);
  });
});
