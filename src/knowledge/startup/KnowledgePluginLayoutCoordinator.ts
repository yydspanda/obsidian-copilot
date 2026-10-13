export interface KnowledgePluginLayoutProjectsPort {
  ensureInitialized(): Promise<void>;
}

export interface KnowledgePluginLayoutBarrier {
  startAfterLayout(): Promise<void>;

  cancel(): void;
}

export class KnowledgePluginLayoutCoordinator {
  private layoutReady = false;
  private projectsStarted = false;
  private closed = false;
  private barrier?: KnowledgePluginLayoutBarrier;
  private barrierStarted = false;

  constructor(private readonly projects: KnowledgePluginLayoutProjectsPort) {}

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

    if (!this.closed && this.barrier === barrier) {
      this.startCurrentBarrierOnce();
    }
  }

  onLayoutReady(): void {
    if (this.closed) {
      return;
    }

    this.layoutReady = true;
    this.startProjectsOnce();
    this.startCurrentBarrierOnce();
  }

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

  private startProjectsOnce(): void {
    if (this.closed || !this.layoutReady || this.projectsStarted) {
      return;
    }

    this.projectsStarted = true;
    this.runDetached(() => this.projects.ensureInitialized());
  }

  private startCurrentBarrierOnce(): void {
    if (this.closed || !this.layoutReady || !this.barrier || this.barrierStarted) {
      return;
    }

    const currentBarrier = this.barrier;
    this.barrierStarted = true;
    this.runDetached(() => currentBarrier.startAfterLayout());
  }

  private runDetached(start: () => Promise<void>): void {
    try {
      void Promise.resolve(start()).catch(() => undefined);
    } catch {
      // A detached prerequisite failure is surfaced by its owning subsystem, never this boundary.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }

  private cancelSafely(barrier: KnowledgePluginLayoutBarrier): void {
    try {
      barrier.cancel();
    } catch {
      // Cancellation is best effort at this narrow boundary; closed state remains authoritative.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }
}
