import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
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
import {
  KnowledgeStudioAdapterUnavailableError,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";

type KnowledgeStudioPort = KnowledgeStudioReadPort & KnowledgeStudioCommandPort;
type QueryCapableKnowledgeStudioPort = KnowledgeStudioPort &
  Partial<Pick<KnowledgeStudioQueryPort, "query" | "openCitation" | "revokeCurrent">> &
  Partial<Pick<KnowledgeStudioQueryWritebackPort, "saveQueryToWiki">>;

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

/** Creates the platform-standard cancellation error used at Studio boundaries. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * Links caller and delegate-generation cancellation without retaining listeners.
 *
 * @param signals - Signals whose cancellation invalidates the delegated operation
 * @returns Linked signal and deterministic listener cleanup
 */
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

/**
 * Stable Studio boundary whose replaceable implementation is never exposed to React.
 *
 * The wrapper starts and ends fail-closed. Delegate snapshots are never retained:
 * every read goes to the implementation active for that exact generation.
 */
export class DelegatingKnowledgeStudioPort
  implements
    KnowledgeStudioReadPort,
    KnowledgeStudioCommandPort,
    KnowledgeStudioQueryPort,
    KnowledgeStudioQueryWritebackPort
{
  private readonly unavailableDelegate: KnowledgeStudioPort;
  private generation: DelegateGeneration;
  private readonly hintBindings = new Map<string, BundleHintBinding>();
  private disposed = false;

  /**
   * Creates a stable port backed initially by the explicit unavailable adapter.
   *
   * @param unavailableNotice - Optional sanitized notice for unavailable snapshots
   */
  constructor(unavailableNotice?: string) {
    this.unavailableDelegate = new UnavailableKnowledgeStudioPort(unavailableNotice);
    this.generation = this.createGeneration(this.unavailableDelegate);
  }

  /**
   * Atomically makes a new implementation current and invalidates all old work.
   *
   * Existing Bundle subscriptions are rebound to the replacement and receive a
   * reload hint. A disposed wrapper cannot be reopened.
   *
   * @param delegate - Complete read/command implementation for the next generation
   */
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

  /**
   * Permanently fail-closes this wrapper and invalidates in-flight delegate work.
   *
   * Current subscribers receive one final reload hint so they can replace a ready
   * snapshot with the unavailable snapshot. Their underlying subscriptions are
   * removed, and future subscriptions are inert.
   */
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

  /** Loads a snapshot from the delegate current for this operation generation. */
  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.load(bundleId, delegatedSignal)
    );
  }

  /**
   * Subscribes to reload hints while keeping the replaceable delegate private.
   *
   * @param bundleId - Stable Bundle identifier
   * @param onHint - Callback that must trigger a fresh authoritative load
   * @returns Idempotent local unsubscription callback
   */
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

  /** Routes a Bundle pause through the current delegate generation. */
  async pauseBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.pauseBundle(bundleId, expectedQueueRevision, delegatedSignal)
    );
  }

  /** Routes a Bundle resume through the current delegate generation. */
  async resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.resumeBundle(bundleId, expectedQueueRevision, delegatedSignal)
    );
  }

  /** Routes one queue-job cancellation through the current delegate generation. */
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

  /** Routes one failed-job retry through the current delegate generation. */
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

  /** Routes an opaque review decision through the current delegate generation. */
  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    return this.runWithCurrentDelegate(signal, (delegate, delegatedSignal) =>
      delegate.submitReview(bundleId, command, delegatedSignal)
    );
  }

  /** Routes an opaque recovery continuation through the current delegate generation. */
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

  /** Routes an opaque no-journal abandonment through the current delegate generation. */
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

  /** Routes one scoped applied-Wiki query through the current delegate generation. */
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

  /** Routes one opaque citation jump through the current delegate generation. */
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

  /** Routes one current-answer capture through the exact delegate generation. */
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

  /** Synchronously revokes exact or Bundle-wide Query authority on the active delegate. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    if (this.disposed) return;
    const generation = this.generation;
    const revokeCurrent = generation.delegate.revokeCurrent;
    if (typeof revokeCurrent !== "function") return;
    const result = Reflect.apply(revokeCurrent, generation.delegate, [bundleId, queryId]);
    if (result !== undefined) throw new KnowledgeStudioAdapterUnavailableError();
    if (generation !== this.generation) throw createAbortError();
  }

  /** Permanently closes the stable Query boundary together with the Studio port. */
  close(): void {
    this.dispose();
  }

  /**
   * Executes against one captured generation and rejects any late result.
   *
   * @param callerSignal - Cancellation owned by the Studio controller
   * @param operation - Delegate operation using the linked generation signal
   * @returns Result only when the captured generation is still current
   */
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

  /**
   * Creates a separately cancellable delegate generation.
   *
   * @param delegate - Delegate owned by the new generation
   * @returns Generation record
   */
  private createGeneration(delegate: QueryCapableKnowledgeStudioPort): DelegateGeneration {
    return { delegate, abortController: new AbortController() };
  }

  /**
   * Binds one local Bundle fan-out to the captured delegate generation.
   *
   * @param bundleId - Bundle whose hints are observed
   * @param binding - Local subscriber fan-out
   * @param generation - Generation that owns the delegate subscription
   */
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

  /**
   * Removes one delegate subscription without allowing cleanup failure to leak.
   *
   * @param binding - Binding whose delegate subscription is removed
   */
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
    }
  }

  /**
   * Emits a non-authoritative reload hint to every current Bundle subscriber.
   *
   * @param bundleId - Bundle whose durable state may have changed
   */
  private emitHint(bundleId: string): void {
    const binding = this.hintBindings.get(bundleId);
    if (!binding) {
      return;
    }

    for (const { listener } of [...binding.subscriptions]) {
      this.invokeHintListener(listener);
    }
  }

  /**
   * Isolates listeners so one view cannot suppress another view's reload hint.
   *
   * @param listener - One local hint listener
   */
  private invokeHintListener(listener: () => void): void {
    try {
      listener();
    } catch {
      // Hints are best-effort; authoritative state is loaded separately.
    }
  }
}
