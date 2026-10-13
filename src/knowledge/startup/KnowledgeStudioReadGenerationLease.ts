import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
} from "@/knowledge/ui/KnowledgeStudioController";

type KnowledgeStudioPort = KnowledgeStudioReadPort & KnowledgeStudioCommandPort;

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

export interface KnowledgeStudioReadGenerationLeaseInput {
  delegate: KnowledgeStudioPort;
  subscribeInvalidation(listener: () => void): () => void;
  replaceDelegate(delegate: KnowledgeStudioPort): void;
  setUnavailable(): void;
  assertCurrent(): void;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function closeSafely(close: () => void): void {
  try {
    close();
  } catch {
    // The associated generation is already non-authoritative.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

export class KnowledgeStudioReadGenerationLease {
  private active = true;
  private closed = false;
  private unsubscribeInvalidation: () => void = () => undefined;

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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSafely(this.unsubscribeInvalidation);
    this.unsubscribeInvalidation = () => undefined;
    this.withdraw();
  }

  private withdraw(): void {
    if (!this.active) return;
    this.active = false;
    closeSafely(() => this.input.setUnavailable());
  }
}
