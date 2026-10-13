import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatCaptureReceipt,
  type KnowledgeChatCaptureRequest,
  type KnowledgeChatDraftReceipt,
  type KnowledgeChatDraftSession,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import type { KnowledgeChatDraftRequest } from "@/knowledge/capture/KnowledgeChatDraftCapture";

interface CaptureGeneration {
  delegate: KnowledgeChatCapturePort;
  abortController: AbortController;
}

class UnavailableKnowledgeChatCapturePort implements KnowledgeChatCapturePort {
  async addVaultSource(): Promise<KnowledgeChatCaptureReceipt> {
    throw new KnowledgeChatCaptureError("unavailable");
  }

  prepareKnowledgeDraft(): null {
    return null;
  }

  async createKnowledgeDraft(): Promise<KnowledgeChatDraftReceipt> {
    throw new KnowledgeChatCaptureError("unavailable");
  }
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class DelegatingKnowledgeChatCapturePort implements KnowledgeChatCapturePort {
  private readonly unavailable = new UnavailableKnowledgeChatCapturePort();
  private readonly draftSessions = new WeakMap<
    object,
    { readonly generation: CaptureGeneration; readonly delegateSession: KnowledgeChatDraftSession }
  >();
  private generation: CaptureGeneration = this.createGeneration(this.unavailable);
  private disposed = false;

  replaceDelegate(delegate: KnowledgeChatCapturePort): void {
    if (this.disposed) throw new KnowledgeChatCaptureError("unavailable");
    this.generation.abortController.abort();
    this.generation = this.createGeneration(delegate);
  }

  setUnavailable(): void {
    if (this.disposed) return;
    this.replaceDelegate(this.unavailable);
  }

  revokeDelegate(delegate: KnowledgeChatCapturePort): void {
    if (this.disposed || this.generation.delegate !== delegate) return;
    this.setUnavailable();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation.abortController.abort();
    this.generation = this.createGeneration(this.unavailable);
  }

  async addVaultSource(
    request: Readonly<KnowledgeChatCaptureRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatCaptureReceipt> {
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
        return generation.delegate.addVaultSource(request, controller.signal);
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

  prepareKnowledgeDraft(): Readonly<KnowledgeChatDraftSession> | null {
    const generation = this.generation;
    if (this.disposed || generation.abortController.signal.aborted) return null;
    try {
      const delegateSession = generation.delegate.prepareKnowledgeDraft();
      if (
        delegateSession === null ||
        generation !== this.generation ||
        generation.abortController.signal.aborted ||
        typeof delegateSession.bundleId !== "string" ||
        delegateSession.bundleId.length === 0 ||
        typeof delegateSession.sourceRoot !== "string" ||
        delegateSession.sourceRoot.length === 0
      ) {
        return null;
      }
      const session = Object.freeze({
        bundleId: delegateSession.bundleId,
        sourceRoot: delegateSession.sourceRoot,
      });
      this.draftSessions.set(session, { generation, delegateSession });
      return session;
    } catch {
      return null;
    }
  }

  async createKnowledgeDraft(
    session: Readonly<KnowledgeChatDraftSession>,
    request: Readonly<KnowledgeChatDraftRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatDraftReceipt> {
    const generation = this.generation;
    const binding =
      typeof session === "object" && session !== null ? this.draftSessions.get(session) : undefined;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    generation.abortController.signal.addEventListener("abort", abort, { once: true });
    try {
      if (
        !binding ||
        binding.generation !== generation ||
        signal.aborted ||
        generation.abortController.signal.aborted ||
        this.disposed
      ) {
        throw createAbortError();
      }
      await Promise.resolve();
      if (generation !== this.generation || controller.signal.aborted || this.disposed) {
        throw createAbortError();
      }
      return await generation.delegate.createKnowledgeDraft(
        binding.delegateSession,
        request,
        controller.signal
      );
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted || this.disposed) {
        throw createAbortError();
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      generation.abortController.signal.removeEventListener("abort", abort);
    }
  }

  private createGeneration(delegate: KnowledgeChatCapturePort): CaptureGeneration {
    return { delegate, abortController: new AbortController() };
  }
}
