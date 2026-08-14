jest.mock("@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort", () => {
  type Operation = (session: unknown, outputRef: string, signal: AbortSignal) => Promise<unknown>;
  const operations = new WeakMap<object, Operation>();

  /** Test-only exact adapter with the same hidden-state authenticity contract. */
  class MockKnowledgeProductionForwardRevisionProposalActionAdapter {
    /** Mints one exact test adapter around a controlled asynchronous operation. */
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

    /** Runs the controlled operation retained by this exact adapter. */
    async proposeKnownOutput(
      session: unknown,
      outputRef: string,
      signal: AbortSignal
    ): Promise<unknown> {
      const operation = operations.get(this);
      if (!operation) throw new DOMException("The operation was aborted", "AbortError");
      return operation(session, outputRef, signal);
    }
  }

  return {
    KnowledgeProductionForwardRevisionProposalActionAdapter:
      MockKnowledgeProductionForwardRevisionProposalActionAdapter,
  };
});

import { DelegatingKnowledgeForwardRevisionProposalActionPort } from "@/knowledge/forwardRevision/DelegatingKnowledgeForwardRevisionProposalActionPort";
import {
  KnowledgeProductionForwardRevisionProposalActionAdapter,
  type KnowledgeForwardRevisionProposalActionResult,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import type { KnowledgeKnownAppliedWikiOutputsSession } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const OUTPUT_REF = `known-wiki-output-${"4".repeat(64)}`;
const REVIEW_REF = `forward-studio-review-${"6".repeat(64)}`;
const SESSION = Object.freeze({}) as Readonly<KnowledgeKnownAppliedWikiOutputsSession>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

type TestOperation = (
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
  outputRef: string,
  signal: AbortSignal
) => Promise<Readonly<KnowledgeForwardRevisionProposalActionResult>>;

/** Creates one manually resolved promise for generation races. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Mints one test-authentic adapter through the mocked production boundary. */
function createAdapter(
  operation: TestOperation
): KnowledgeProductionForwardRevisionProposalActionAdapter {
  const Constructor = KnowledgeProductionForwardRevisionProposalActionAdapter as unknown as new (
    operation: TestOperation
  ) => KnowledgeProductionForwardRevisionProposalActionAdapter;
  return new Constructor(operation);
}

describe("DelegatingKnowledgeForwardRevisionProposalActionPort", () => {
  it("reports availability only for a current genuine production generation", () => {
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    const first = createAdapter(async () => Object.freeze({ kind: "stale" as const }));
    const second = createAdapter(async () => Object.freeze({ kind: "stale" as const }));

    expect(port.isAvailable()).toBe(false);
    port.setUnavailable();
    expect(port.isAvailable()).toBe(false);

    port.replaceDelegate(first);
    expect(port.isAvailable()).toBe(true);
    port.revokeDelegate(first);
    expect(port.isAvailable()).toBe(false);

    port.replaceDelegate(second);
    expect(port.isAvailable()).toBe(true);
    port.setUnavailable();
    expect(port.isAvailable()).toBe(false);
    port.replaceDelegate(second);
    expect(port.isAvailable()).toBe(true);
    port.dispose();
    expect(port.isAvailable()).toBe(false);
    const forged = Object.create(
      DelegatingKnowledgeForwardRevisionProposalActionPort.prototype
    ) as DelegatingKnowledgeForwardRevisionProposalActionPort;
    expect(() => forged.isAvailable()).toThrow(DOMException);
  });

  it("starts unavailable and installs only an exact production adapter", async () => {
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    await expect(
      port.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "unavailable" });
    const duckTyped: unknown = {
      proposeKnownOutput: async () =>
        Object.freeze({ kind: "published" as const, reviewRef: REVIEW_REF }),
    };
    expect(() =>
      port.replaceDelegate(duckTyped as KnowledgeProductionForwardRevisionProposalActionAdapter)
    ).toThrow(DOMException);

    const operation = jest.fn(async () => Object.freeze({ kind: "stale" as const }));
    const adapter = createAdapter(operation);
    port.replaceDelegate(adapter);
    const signal = new AbortController().signal;
    await expect(port.proposeKnownOutput(SESSION, OUTPUT_REF, signal)).resolves.toEqual({
      kind: "stale",
    });
    expect(operation).toHaveBeenCalledWith(SESSION, OUTPUT_REF, expect.any(AbortSignal));
    expect(operation.mock.calls[0]).toHaveLength(3);
    expect(() =>
      DelegatingKnowledgeForwardRevisionProposalActionPort.assertCurrentDelegate(port, adapter)
    ).not.toThrow();
  });

  it("aborts a non-published result when its generation is revoked", async () => {
    const deferred = createDeferred<Readonly<KnowledgeForwardRevisionProposalActionResult>>();
    let linkedSignal: AbortSignal | undefined;
    const adapter = createAdapter(async (_session, _ref, signal) => {
      linkedSignal = signal;
      return deferred.promise;
    });
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    port.replaceDelegate(adapter);
    const pending = port.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal);
    port.setUnavailable();
    expect(linkedSignal?.aborted).toBe(true);
    deferred.resolve(Object.freeze({ kind: "stale" }));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves a confirmed publication after caller cancellation and generation replacement", async () => {
    const deferred = createDeferred<Readonly<KnowledgeForwardRevisionProposalActionResult>>();
    const adapter = createAdapter(async () => deferred.promise);
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    port.replaceDelegate(adapter);
    const caller = new AbortController();
    const pending = port.proposeKnownOutput(SESSION, OUTPUT_REF, caller.signal);

    deferred.resolve(Object.freeze({ kind: "published", reviewRef: REVIEW_REF }));
    caller.abort();
    port.setUnavailable();

    await expect(pending).resolves.toEqual({ kind: "published", reviewRef: REVIEW_REF });
  });

  it("does not dispatch after caller cancellation or redirect an obsolete adapter", async () => {
    const oldOperation = jest.fn(async () => Object.freeze({ kind: "stale" as const }));
    const nextOperation = jest.fn(async () =>
      Object.freeze({ kind: "published" as const, reviewRef: REVIEW_REF })
    );
    const oldAdapter = createAdapter(oldOperation);
    const nextAdapter = createAdapter(nextOperation);
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    port.replaceDelegate(oldAdapter);
    port.replaceDelegate(nextAdapter);
    port.revokeDelegate(oldAdapter);
    const caller = new AbortController();
    caller.abort();

    await expect(port.proposeKnownOutput(SESSION, OUTPUT_REF, caller.signal)).rejects.toMatchObject(
      {
        name: "AbortError",
      }
    );
    expect(oldOperation).not.toHaveBeenCalled();
    expect(nextOperation).not.toHaveBeenCalled();

    await expect(
      port.proposeKnownOutput(SESSION, OUTPUT_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "published", reviewRef: REVIEW_REF });
    expect(nextOperation).toHaveBeenCalledTimes(1);
  });

  it("authenticates only the exact stable process-local surface", () => {
    const port = new DelegatingKnowledgeForwardRevisionProposalActionPort();
    expect(() => DelegatingKnowledgeForwardRevisionProposalActionPort.assert(port)).not.toThrow();
    expect(() =>
      DelegatingKnowledgeForwardRevisionProposalActionPort.assert(
        Object.create(DelegatingKnowledgeForwardRevisionProposalActionPort.prototype)
      )
    ).toThrow(DOMException);
    expect(() =>
      DelegatingKnowledgeForwardRevisionProposalActionPort.assert(new Proxy(port, {}))
    ).toThrow(DOMException);
  });
});
