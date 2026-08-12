import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeReviewEvidenceOpenRequest,
  KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import {
  createUnavailableKnowledgeStudioSnapshot,
  type KnowledgeStudioCommandPort,
  type KnowledgeStudioReadPort,
  type KnowledgeStudioReviewSubmissionResult,
  type KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";

/** Promise whose settlement is controlled explicitly by one test. */
function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Flushes delegate invocation scheduled through the stable wrapper. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Complete Studio delegate with a scriptable evidence handler. */
class EvidenceDelegate
  implements KnowledgeStudioReadPort, KnowledgeStudioCommandPort, KnowledgeStudioReviewEvidencePort
{
  calls: Array<{ request: Readonly<KnowledgeReviewEvidenceOpenRequest>; signal: AbortSignal }> = [];

  /** Captures one evidence handler for this exact delegate generation. */
  constructor(
    private readonly handler: (
      signal: AbortSignal
    ) => Promise<Readonly<KnowledgeReviewEvidenceOpenResult>>
  ) {}

  /** Returns one ready empty snapshot. */
  async load(bundleId: string): Promise<KnowledgeStudioSnapshot> {
    return {
      ...createUnavailableKnowledgeStudioSnapshot(bundleId),
      availability: "ready",
      reviewEvidenceAvailable: true,
    };
  }

  /** Provides an inert reload subscription. */
  subscribe(): () => void {
    return () => undefined;
  }

  /** Keeps unrelated pause unavailable in this focused fixture. */
  async pauseBundle(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps unrelated resume unavailable in this focused fixture. */
  async resumeBundle(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps unrelated cancellation unavailable in this focused fixture. */
  async cancelJob(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps unrelated retry unavailable in this focused fixture. */
  async retryJob(): Promise<void> {
    throw new Error("unavailable");
  }

  /** Keeps unrelated Review mutation unavailable in this focused fixture. */
  async submitReview(
    _bundleId: string,
    _command: KnowledgeReviewCommand,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    throw new Error("unavailable");
  }

  /** Records and delegates one evidence operation. */
  async openReviewEvidence(
    _bundleId: string,
    request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> {
    this.calls.push({ request, signal });
    return this.handler(signal);
  }
}

const REQUEST: Readonly<KnowledgeReviewEvidenceOpenRequest> = Object.freeze({
  changeSetId: "changeset-1",
  proposalDigest: "a".repeat(64),
  expectedSnapshotToken: "b".repeat(64),
  evidenceRef: "c".repeat(64),
});

describe("DelegatingKnowledgeStudioPort Review evidence", () => {
  it.each(["replace", "dispose"] as const)(
    "aborts and rejects old in-flight evidence work on %s",
    async (action) => {
      const deferred = createDeferred<Readonly<KnowledgeReviewEvidenceOpenResult>>();
      const oldDelegate = new EvidenceDelegate(async () => deferred.promise);
      const replacement = new EvidenceDelegate(async () => ({ kind: "opened" }));
      const port = new DelegatingKnowledgeStudioPort();
      port.replaceDelegate(oldDelegate);

      const pending = port.openReviewEvidence("personal", REQUEST, new AbortController().signal);
      await flushAsync();
      if (action === "replace") port.replaceDelegate(replacement);
      if (action === "dispose") port.dispose();

      expect(oldDelegate.calls[0].signal.aborted).toBe(true);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      deferred.resolve({ kind: "opened" });
      await flushAsync();
    }
  );

  it("routes only to the replacement generation and stays fail-closed when absent", async () => {
    const replacement = new EvidenceDelegate(async () => ({ kind: "stale" }));
    const port = new DelegatingKnowledgeStudioPort();

    await expect(
      port.openReviewEvidence("personal", REQUEST, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeStudioAdapterUnavailableError" });
    port.replaceDelegate(replacement);
    await expect(
      port.openReviewEvidence("personal", REQUEST, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(replacement.calls[0].request).toBe(REQUEST);
  });
});
