import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
} from "@/knowledge/ui/KnowledgeStudioController";

type KnowledgeStudioPort = KnowledgeStudioReadPort & KnowledgeStudioCommandPort;

/** Reports whether an unknown receipt names one exact ordered Bundle sequence. */
export function hasExactKnowledgeBundleSequence(
  actual: unknown,
  expected: readonly string[]
): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((bundleId, index) => typeof bundleId === "string" && bundleId === expected[index])
  );
}

/** Narrow capabilities required to install one revocable live Studio generation. */
export interface KnowledgeStudioReadGenerationLeaseInput {
  delegate: KnowledgeStudioPort;
  subscribeInvalidation(listener: () => void): () => void;
  replaceDelegate(delegate: KnowledgeStudioPort): void;
  setUnavailable(): void;
  assertCurrent(): void;
}

/** Creates the platform-standard cancellation for a stale Studio generation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Invokes cleanup without allowing a stale capability to escape its boundary. */
function closeSafely(close: () => void): void {
  try {
    close();
  } catch {
    // The associated generation is already non-authoritative.
  }
}

/**
 * Revocable ownership token for one installed Studio delegate.
 *
 * Invalidation is registered before delegate replacement. If invalidation is
 * re-entrant during replacement, the unavailable publication wins and install
 * fails instead of reporting a live generation.
 */
export class KnowledgeStudioReadGenerationLease {
  private active = true;
  private closed = false;
  private unsubscribeInvalidation: () => void = () => undefined;

  /** Installs one exact delegate only after its invalidation hook is active. */
  constructor(private readonly input: KnowledgeStudioReadGenerationLeaseInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.delegate?.load !== "function" ||
      typeof input.delegate?.subscribe !== "function" ||
      typeof input.delegate?.pauseBundle !== "function" ||
      typeof input.delegate?.resumeBundle !== "function" ||
      typeof input.delegate?.cancelJob !== "function" ||
      typeof input.delegate?.retryJob !== "function" ||
      typeof input.delegate?.submitReview !== "function" ||
      typeof input.subscribeInvalidation !== "function" ||
      typeof input.replaceDelegate !== "function" ||
      typeof input.setUnavailable !== "function" ||
      typeof input.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }

    try {
      const unsubscribe = input.subscribeInvalidation(() => this.withdraw());
      if (typeof unsubscribe !== "function") throw createAbortError();
      this.unsubscribeInvalidation = unsubscribe;
      this.assertCurrent();
      input.replaceDelegate(input.delegate);
      this.assertCurrent();
    } catch {
      closeSafely(this.unsubscribeInvalidation);
      this.unsubscribeInvalidation = () => undefined;
      this.withdraw();
      this.closed = true;
      throw createAbortError();
    }
  }

  /** Proves both local installation and the upstream observation generation. */
  assertCurrent(): void {
    if (!this.active || this.closed) throw createAbortError();
    try {
      this.input.assertCurrent();
    } catch {
      this.withdraw();
      throw createAbortError();
    }
    if (!this.active || this.closed) throw createAbortError();
  }

  /** Idempotently revokes the delegate and publishes an unavailable replacement. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSafely(this.unsubscribeInvalidation);
    this.unsubscribeInvalidation = () => undefined;
    this.withdraw();
  }

  /** Makes the unavailable publication win before invoking external cleanup. */
  private withdraw(): void {
    if (!this.active) return;
    this.active = false;
    closeSafely(() => this.input.setUnavailable());
  }
}
