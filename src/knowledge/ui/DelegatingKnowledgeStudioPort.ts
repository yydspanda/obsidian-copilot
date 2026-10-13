import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import type { KnowledgeReviewEvidenceOpenRequest } from "@/knowledge/review/KnowledgeReviewEvidence";
import type {
  KnowledgeStudioQueryResult,
  KnowledgeStudioQueryPort,
  KnowledgeStudioQueryRequest,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackRequest,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
  KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";
import type {
  KnowledgeForwardRevisionStudioCommand,
  KnowledgeForwardRevisionStudioSubmissionResult,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import {
  KnowledgeStudioAdapterUnavailableError,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";

type KnowledgeStudioPort = KnowledgeStudioReadPort & KnowledgeStudioCommandPort;
type QueryCapableKnowledgeStudioPort = KnowledgeStudioPort &
  Partial<Pick<KnowledgeStudioQueryPort, "query" | "openCitation" | "revokeCurrent">> &
  Partial<Pick<KnowledgeStudioQueryWritebackPort, "saveQueryToWiki">> &
  Partial<KnowledgeStudioReviewEvidencePort> &
  Partial<KnowledgeSourceLifecyclePort>;

interface DelegateGeneration {
  delegate: QueryCapableKnowledgeStudioPort;
  abortController: AbortController;
}

interface HintSubscription {
  listener: () => void;
}

interface BundleHintBinding {
  subscriptions: Set<HintSubscription>;
  unsubscribeDelegate?: () => void;
}

interface LinkedAbortSignal {
  signal: AbortSignal;
  release(): void;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbortSignal {
  const controller = new AbortController();
  const listeners: { signal: AbortSignal; listener: () => void }[] = [];

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }

    const listener = (): void => controller.abort();
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    release: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

export class DelegatingKnowledgeStudioPort
  implements
    KnowledgeStudioReadPort,
    KnowledgeStudioCommandPort,
    KnowledgeStudioQueryPort,
    KnowledgeStudioQueryWritebackPort,
    KnowledgeStudioReviewEvidencePort,
    KnowledgeSourceLifecyclePort
{
  private readonly unavailableDelegate: KnowledgeStudioPort;
  private generation: DelegateGeneration;
  private readonly hintBindings = new Map<string, BundleHintBinding>();
  private disposed = false;

  constructor(unavailableNotice?: string) {
    this.unavailableDelegate = new UnavailableKnowledgeStudioPort(unavailableNotice);
    this.generation = this.createGeneration(this.unavailableDelegate);
  }

  replaceDelegate(delegate: QueryCapableKnowledgeStudioPort): void {
    if (this.disposed) {
      throw new KnowledgeStudioAdapterUnavailableError();
    }

    const previousGeneration = this.generation;
    previousGeneration.abortController.abort();
    this.generation = this.createGeneration(delegate);

    for (const binding of this.hintBindings.values()) {
      this.unbindDelegateHint(binding);
    }
    for (const [bundleId, binding] of this.hintBindings) {
      this.bindDelegateHint(bundleId, binding, this.generation);
    }
    for (const bundleId of this.hintBindings.keys()) {
      this.emitHint(bundleId);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    const listeners = [...this.hintBindings.values()].flatMap((binding) =>
      [...binding.subscriptions].map(({ listener }) => listener)
    );

    this.disposed = true;
    this.generation.abortController.abort();
    this.generation = this.createGeneration(this.unavailableDelegate);

    for (const binding of this.hintBindings.values()) {
      this.unbindDelegateHint(binding);
    }
    this.hintBindings.clear();

    for (const listener of listeners) {
      this.invokeHintListener(listener);
    }
  }

  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.load(bundleId, delegatedSignal)
    );
  }

  subscribe(bundleId: string, onHint: () => void): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let binding = this.hintBindings.get(bundleId);
    let needsDelegateBinding = false;
    if (!binding) {
      binding = { subscriptions: new Set<HintSubscription>() };
      this.hintBindings.set(bundleId, binding);
      needsDelegateBinding = true;
    }

    const subscription: HintSubscription = { listener: onHint };
    binding.subscriptions.add(subscription);
    if (needsDelegateBinding) {
      this.bindDelegateHint(bundleId, binding, this.generation);
    }
    let active = true;

    return () => {
      if (!active) {
        return;
      }
      active = false;

      const currentBinding = this.hintBindings.get(bundleId);
      if (!currentBinding) {
        return;
      }
      currentBinding.subscriptions.delete(subscription);
      if (currentBinding.subscriptions.size === 0) {
        this.unbindDelegateHint(currentBinding);
        this.hintBindings.delete(bundleId);
      }
    };
  }

  async pauseBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.pauseBundle(bundleId, expectedQueueRevision, delegatedSignal)
    );
  }

  async resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.resumeBundle(bundleId, expectedQueueRevision, delegatedSignal)
    );
  }

  async cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.cancelJob(bundleId, jobId, expectedQueueRevision, delegatedSignal)
    );
  }

  async retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.retryJob(bundleId, jobId, expectedQueueRevision, delegatedSignal)
    );
  }

  async reanalyzeJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    // Reanalysis is absent on older generations; never fall back to failed-job Retry.
    // https://github.com/yydspanda/obsidian-copilot/issues/16
    return this.runCommitWinsWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.reanalyzeJob === "function"
        ? delegate.reanalyzeJob(bundleId, jobId, expectedQueueRevision, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async runSelectedJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    // Older delegates cannot authorize selected work; never fall back to Resume-all.
    // https://github.com/yydspanda/obsidian-copilot/issues/18
    return this.runCommitWinsWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.runSelectedJob === "function"
        ? delegate.runSelectedJob(bundleId, jobId, expectedQueueRevision, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    return this.runCommitWinsWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.submitReview(bundleId, command, delegatedSignal)
    );
  }

  async submitForwardRevisionStudio(
    bundleId: string,
    command: KnowledgeForwardRevisionStudioCommand,
    signal: AbortSignal
  ): Promise<KnowledgeForwardRevisionStudioSubmissionResult> {
    return this.runCommitWinsWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.submitForwardRevisionStudio === "function"
        ? delegate.submitForwardRevisionStudio(bundleId, command, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async openReviewEvidence(
    bundleId: string,
    request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ) {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.openReviewEvidence === "function"
        ? delegate.openReviewEvidence(bundleId, request, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async continueRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.continueRecovery
        ? delegate.continueRecovery(bundleId, recoveryId, expectedRuntimeRevision, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async abandonRecovery(
    bundleId: string,
    recoveryId: string,
    expectedRuntimeRevision: number,
    signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.abandonRecovery
        ? delegate.abandonRecovery(bundleId, recoveryId, expectedRuntimeRevision, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async loadSources(bundleId: string, signal: AbortSignal) {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.loadSources === "function"
        ? delegate.loadSources(bundleId, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.checkAgain === "function"
        ? delegate.checkAgain(bundleId, sourceId, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> {
    return this.runCommitWinsWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.retireSource === "function"
        ? delegate.retireSource(bundleId, request, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.query === "function"
        ? delegate.query(bundleId, request, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.openCitation === "function"
        ? delegate.openCitation(bundleId, queryId, citationRef, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      typeof delegate.saveQueryToWiki === "function"
        ? delegate.saveQueryToWiki(bundleId, queryId, request, delegatedSignal)
        : Promise.reject(new KnowledgeStudioAdapterUnavailableError())
    );
  }

  revokeCurrent(bundleId: string, queryId?: string): void {
    if (this.disposed) return;
    const generation = this.generation;
    const revokeCurrent = generation.delegate.revokeCurrent;
    if (typeof revokeCurrent !== "function") return;
    const result = Reflect.apply(revokeCurrent, generation.delegate, [bundleId, queryId]);
    if (result !== undefined) throw new KnowledgeStudioAdapterUnavailableError();
    if (generation !== this.generation) throw createAbortError();
  }

  close(): void {
    this.dispose();
  }

  private async runCommitWinsWithCurrentDelegate<T>(
    callerSignal: AbortSignal,
    operation: (delegate: QueryCapableKnowledgeStudioPort, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const generation = this.generation;
    const linked = linkAbortSignals([callerSignal, generation.abortController.signal]);
    try {
      if (linked.signal.aborted || generation !== this.generation) {
        throw createAbortError();
      }
      try {
        return await operation(generation.delegate, linked.signal);
      } catch (error) {
        if (linked.signal.aborted || generation !== this.generation) {
          throw createAbortError();
        }
        throw error;
      }
    } finally {
      linked.release();
    }
  }

  private async runWithCurrentDelegate<T>(
    callerSignal: AbortSignal,
    operation: (delegate: QueryCapableKnowledgeStudioPort, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const generation = this.generation;
    const linked = linkAbortSignals([callerSignal, generation.abortController.signal]);
    let removeAbortListener = (): void => undefined;

    try {
      if (linked.signal.aborted) {
        throw createAbortError();
      }

      const aborted = new Promise<never>((_resolve, reject) => {
        const rejectAsAborted = (): void => reject(createAbortError());
        linked.signal.addEventListener("abort", rejectAsAborted, { once: true });
        removeAbortListener = () => linked.signal.removeEventListener("abort", rejectAsAborted);
      });
      const delegated = Promise.resolve().then(() => {
        if (linked.signal.aborted || generation !== this.generation) {
          throw createAbortError();
        }
        return operation(generation.delegate, linked.signal);
      });
      const result = await Promise.race([delegated, aborted]);

      if (linked.signal.aborted || generation !== this.generation) {
        throw createAbortError();
      }
      return result;
    } catch (error) {
      if (linked.signal.aborted || generation !== this.generation) {
        throw createAbortError();
      }
      throw error;
    } finally {
      removeAbortListener();
      linked.release();
    }
  }

  private createGeneration(delegate: QueryCapableKnowledgeStudioPort): DelegateGeneration {
    return { delegate, abortController: new AbortController() };
  }

  private bindDelegateHint(
    bundleId: string,
    binding: BundleHintBinding,
    generation: DelegateGeneration
  ): void {
    try {
      binding.unsubscribeDelegate = generation.delegate.subscribe(bundleId, () => {
        if (!this.disposed && generation === this.generation) {
          this.emitHint(bundleId);
        }
      });
    } catch {
      binding.unsubscribeDelegate = undefined;
    }
  }

  private unbindDelegateHint(binding: BundleHintBinding): void {
    const unsubscribe = binding.unsubscribeDelegate;
    binding.unsubscribeDelegate = undefined;
    if (!unsubscribe) {
      return;
    }

    try {
      unsubscribe();
    } catch {
      // Delegate cleanup is best-effort; its generation is already invalid.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }

  private emitHint(bundleId: string): void {
    const binding = this.hintBindings.get(bundleId);
    if (!binding) {
      return;
    }

    for (const { listener } of [...binding.subscriptions]) {
      this.invokeHintListener(listener);
    }
  }

  private invokeHintListener(listener: () => void): void {
    try {
      listener();
    } catch {
      // Hints are best-effort; authoritative state is loaded separately.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }
}
