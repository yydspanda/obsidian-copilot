import type { KnowledgeChatCapturePort } from "@/knowledge/capture/KnowledgeChatCapturePort";

/** Installation capabilities retained by one revocable Chat capture generation. */
export interface KnowledgeChatCaptureGenerationLeaseInput {
  delegate: KnowledgeChatCapturePort;
  subscribeInvalidation(listener: () => void): () => void;
  replaceDelegate(delegate: KnowledgeChatCapturePort): void;
  revokeDelegate(delegate: KnowledgeChatCapturePort): void;
  assertCurrent(): void;
}

/** Creates the standard cancellation category for a stale capture installation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Invokes cleanup after authority is withdrawn without leaking cleanup failures. */
function closeSafely(close: () => void): void {
  try {
    close();
  } catch {
    // The owning generation has already been revoked.
  }
}

/**
 * Installs one production Chat capture delegate for exactly one upstream generation.
 *
 * Invalidation is subscribed before publication, and revocation is conditional on
 * the exact delegate so an obsolete lease cannot withdraw a newer generation.
 */
export class KnowledgeChatCaptureGenerationLease {
  private active = true;
  private closed = false;
  private unsubscribeInvalidation: () => void = () => undefined;

  /** Subscribes invalidation and atomically publishes one exact delegate. */
  constructor(private readonly input: KnowledgeChatCaptureGenerationLeaseInput) {
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

  /** Proves both this lease and its upstream production generation. */
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

  /** Idempotently closes the invalidation hook and exact delegate installation. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSafely(this.unsubscribeInvalidation);
    this.unsubscribeInvalidation = () => undefined;
    this.withdraw();
  }

  /** Withdraws only the delegate installed by this exact lease. */
  private withdraw(): void {
    if (!this.active) return;
    this.active = false;
    closeSafely(() => this.input.revokeDelegate(this.input.delegate));
  }
}
