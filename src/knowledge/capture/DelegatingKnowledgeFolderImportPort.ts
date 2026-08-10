import {
  KnowledgeFolderImportError,
  type KnowledgeFolderImportPort,
  type KnowledgeFolderImportReceipt,
  type KnowledgeFolderImportRequest,
} from "@/knowledge/capture/KnowledgeFolderImportPort";

interface FolderImportGeneration {
  delegate: KnowledgeFolderImportPort;
  abortController: AbortController;
}

/** Explicit fail-closed implementation used before and between production generations. */
class UnavailableKnowledgeFolderImportPort implements KnowledgeFolderImportPort {
  /** Rejects import while no released production generation owns the operation. */
  async importFolder(): Promise<KnowledgeFolderImportReceipt> {
    throw new KnowledgeFolderImportError("unavailable");
  }
}

/** Creates the platform-standard cancellation category for a replaced generation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * Stable folder-import boundary whose production delegate is generation-revocable.
 *
 * React and commands retain this wrapper while generation replacement aborts old
 * file reads and rejects late results. Runtime and Manifest capabilities remain
 * private to the current delegate.
 */
export class DelegatingKnowledgeFolderImportPort implements KnowledgeFolderImportPort {
  private readonly unavailable = new UnavailableKnowledgeFolderImportPort();
  private generation: FolderImportGeneration = this.createGeneration(this.unavailable);
  private disposed = false;

  /** Replaces the current delegate and synchronously revokes all old work. */
  replaceDelegate(delegate: KnowledgeFolderImportPort): void {
    if (this.disposed) throw new KnowledgeFolderImportError("unavailable");
    this.generation.abortController.abort();
    this.generation = this.createGeneration(delegate);
  }

  /** Publishes the explicit unavailable delegate without disposing this stable wrapper. */
  setUnavailable(): void {
    if (this.disposed) return;
    this.replaceDelegate(this.unavailable);
  }

  /** Revokes one delegate only when it still owns the current generation. */
  revokeDelegate(delegate: KnowledgeFolderImportPort): void {
    if (this.disposed || this.generation.delegate !== delegate) return;
    this.setUnavailable();
  }

  /** Permanently revokes the wrapper and every in-flight import. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation.abortController.abort();
    this.generation = this.createGeneration(this.unavailable);
  }

  /** Routes one selected folder through the exact current delegate generation. */
  async importFolder(
    request: Readonly<KnowledgeFolderImportRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportReceipt> {
    const generation = this.generation;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    generation.abortController.signal.addEventListener("abort", abort, { once: true });
    let removeAbortRace = (): void => undefined;

    try {
      if (signal.aborted || generation.abortController.signal.aborted || this.disposed) {
        throw createAbortError();
      }
      const aborted = new Promise<never>((_resolve, reject) => {
        const rejectAborted = (): void => reject(createAbortError());
        controller.signal.addEventListener("abort", rejectAborted, { once: true });
        removeAbortRace = () => controller.signal.removeEventListener("abort", rejectAborted);
      });
      const delegated = Promise.resolve().then(() => {
        if (generation !== this.generation || controller.signal.aborted) throw createAbortError();
        return generation.delegate.importFolder(request, controller.signal);
      });
      const result = await Promise.race([delegated, aborted]);
      if (generation !== this.generation || controller.signal.aborted || this.disposed) {
        throw createAbortError();
      }
      return result;
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted || this.disposed) {
        throw createAbortError();
      }
      throw error;
    } finally {
      removeAbortRace();
      signal.removeEventListener("abort", abort);
      generation.abortController.signal.removeEventListener("abort", abort);
    }
  }

  /** Creates a separately cancellable delegate generation. */
  private createGeneration(delegate: KnowledgeFolderImportPort): FolderImportGeneration {
    return { delegate, abortController: new AbortController() };
  }
}
