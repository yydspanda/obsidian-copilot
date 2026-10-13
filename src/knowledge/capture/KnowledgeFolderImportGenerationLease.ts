import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";

export interface KnowledgeFolderImportGenerationLeaseInput {
  delegate: KnowledgeFolderImportPort;
  subscribeInvalidation(listener: () => void): () => void;
  replaceDelegate(delegate: KnowledgeFolderImportPort): void;
  revokeDelegate(delegate: KnowledgeFolderImportPort): void;
  assertCurrent(): void;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function closeSafely(close: () => void): void {
  try {
    close();
  } catch {
    // The owning generation has already been revoked.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

export class KnowledgeFolderImportGenerationLease {
  private active = true;
  private closed = false;
  private unsubscribeInvalidation: () => void = () => undefined;

  constructor(private readonly input: KnowledgeFolderImportGenerationLeaseInput) {
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
    closeSafely(() => this.input.revokeDelegate(this.input.delegate));
  }
}
