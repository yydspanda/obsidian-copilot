/** Ordinary Projects initialization that must remain independent from Knowledge startup. */
export interface KnowledgePluginLayoutProjectsPort {
  /** Ensures the normal Projects subsystem has started after layout readiness. */
  ensureInitialized(): Promise<void>;
}

/** Replaceable fail-closed Knowledge barrier started only after layout readiness. */
export interface KnowledgePluginLayoutBarrier {
  /** Starts this barrier's post-layout checks. */
  startAfterLayout(): Promise<void>;
  /** Invalidates this barrier and any work it still owns. */
  cancel(): void;
}

/**
 * Coordinates Obsidian layout readiness without coupling ordinary Projects to Knowledge Runtime.
 *
 * The coordinator deliberately knows nothing about Runtime, Bundle configuration, recovery
 * Gate/release, Queue, models, watchers, or workflow adapters. Project and barrier work are
 * detached independently, and every rejection is isolated at this lifecycle boundary.
 */
export class KnowledgePluginLayoutCoordinator {
  private layoutReady = false;
  private projectsStarted = false;
  private closed = false;
  private barrier?: KnowledgePluginLayoutBarrier;
  private barrierStarted = false;

  /**
   * Creates one permanent plugin-lifecycle coordinator.
   *
   * @param projects - Ordinary Projects initialization boundary
   */
  constructor(private readonly projects: KnowledgePluginLayoutProjectsPort) {}

  /**
   * Attaches the current Knowledge barrier without starting it before layout readiness.
   *
   * Reattaching the same current barrier is idempotent. Replacing it synchronously cancels the
   * old barrier, and a replacement attached after layout readiness starts exactly once. After
   * closure, the supplied barrier is cancelled immediately and cannot be installed.
   *
   * @param barrier - Fail-closed barrier for the current Knowledge startup generation
   */
  attachBarrier(barrier: KnowledgePluginLayoutBarrier): void {
    if (this.closed) {
      this.cancelSafely(barrier);
      return;
    }
    if (this.barrier === barrier) {
      this.startCurrentBarrierOnce();
      return;
    }

    const previousBarrier = this.barrier;
    this.barrier = barrier;
    this.barrierStarted = false;
    if (previousBarrier) {
      this.cancelSafely(previousBarrier);
    }

    // A cancellation callback may have synchronously closed or replaced this coordinator.
    if (!this.closed && this.barrier === barrier) {
      this.startCurrentBarrierOnce();
    }
  }

  /**
   * Records Obsidian layout readiness and starts independent post-layout work exactly once.
   *
   * Ordinary Projects starts first and never waits for a barrier to exist or succeed. Repeated
   * layout notifications are idempotent. If no barrier is attached yet, a later attachment will
   * observe the retained layout-ready state and start itself.
   */
  onLayoutReady(): void {
    if (this.closed) {
      return;
    }

    this.layoutReady = true;
    this.startProjectsOnce();
    this.startCurrentBarrierOnce();
  }

  /**
   * Permanently closes this lifecycle and synchronously invalidates its current barrier.
   *
   * Project initialization has no cancellation capability, so an already-running Promise is only
   * observed until settlement. It has no continuation that can reopen this coordinator.
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const currentBarrier = this.barrier;
    this.barrier = undefined;
    this.barrierStarted = false;
    if (currentBarrier) {
      this.cancelSafely(currentBarrier);
    }
  }

  /** Starts ordinary Projects at most once and contains synchronous or asynchronous failures. */
  private startProjectsOnce(): void {
    if (this.closed || !this.layoutReady || this.projectsStarted) {
      return;
    }

    this.projectsStarted = true;
    this.runDetached(() => this.projects.ensureInitialized());
  }

  /** Starts only the currently attached barrier at most once after layout readiness. */
  private startCurrentBarrierOnce(): void {
    if (this.closed || !this.layoutReady || !this.barrier || this.barrierStarted) {
      return;
    }

    const currentBarrier = this.barrier;
    this.barrierStarted = true;
    this.runDetached(() => currentBarrier.startAfterLayout());
  }

  /**
   * Observes detached lifecycle work so neither synchronous throws nor Promise rejections escape.
   *
   * @param start - Work factory invoked once after its owner is marked started
   */
  private runDetached(start: () => Promise<void>): void {
    try {
      void Promise.resolve(start()).catch(() => undefined);
    } catch {
      // A detached prerequisite failure is surfaced by its owning subsystem, never this boundary.
    }
  }

  /**
   * Cancels one barrier without allowing third-party cleanup failures to break lifecycle closure.
   *
   * @param barrier - Barrier whose publication authority must be invalidated
   */
  private cancelSafely(barrier: KnowledgePluginLayoutBarrier): void {
    try {
      barrier.cancel();
    } catch {
      // Cancellation is best effort at this narrow boundary; closed state remains authoritative.
    }
  }
}
