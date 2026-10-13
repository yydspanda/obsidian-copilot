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

class UnavailableKnowledgeFolderImportPort implements KnowledgeFolderImportPort {
  async importFolder(): Promise<KnowledgeFolderImportReceipt> {
    throw new KnowledgeFolderImportError("unavailable");
  }
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class DelegatingKnowledgeFolderImportPort implements KnowledgeFolderImportPort {
  private readonly unavailable = new UnavailableKnowledgeFolderImportPort();
  private generation: FolderImportGeneration = this.createGeneration(this.unavailable);
  private disposed = false;

  replaceDelegate(delegate: KnowledgeFolderImportPort): void {
    if (this.disposed) throw new KnowledgeFolderImportError("unavailable");
    this.generation.abortController.abort();
    this.generation = this.createGeneration(delegate);
  }

  setUnavailable(): void {
    if (this.disposed) return;
    this.replaceDelegate(this.unavailable);
  }

  revokeDelegate(delegate: KnowledgeFolderImportPort): void {
    if (this.disposed || this.generation.delegate !== delegate) return;
    this.setUnavailable();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation.abortController.abort();
    this.generation = this.createGeneration(this.unavailable);
  }

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

  private createGeneration(delegate: KnowledgeFolderImportPort): FolderImportGeneration {
    return { delegate, abortController: new AbortController() };
  }
}
