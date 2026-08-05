import type {
  KnowledgePluginRecoveryStartupPort,
  KnowledgePluginRecoveryStartupResult,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import type { KnowledgeProductionRecoveryState } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";

/** Minimal recovery composer surface retained by the plugin adapter. */
export interface KnowledgePluginProductionRecoveryComposerPort {
  /** Runs one serialized recovery-only generation. */
  start(): Promise<void>;
  /** Returns the latest detached sanitized composer state. */
  getState(): KnowledgeProductionRecoveryState;
  /** Permanently invalidates this recovery generation. */
  close(): void;
}

/** Lifecycle authority checked on both sides of every durable recovery await. */
export interface KnowledgePluginProductionRecoveryPortDependencies {
  composer: KnowledgePluginProductionRecoveryComposerPort;
  /** Re-proves plugin, Runtime, and preflight generation ownership. */
  assertCurrent(): void;
  /** Releases the plugin's current-composer reference after closure. */
  onClose?(): void;
}

/** Creates the platform-standard cancellation used for stale production generations. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * Projects one detached recovery-composer state into the Barrier contract.
 *
 * @param state - Sanitized state returned by the recovery-only composer
 * @returns Narrow result containing no Gate receipts, job IDs, paths, or raw failures
 */
export function toKnowledgePluginRecoveryStartupResult(
  state: KnowledgeProductionRecoveryState
): KnowledgePluginRecoveryStartupResult {
  if (state.status === "observed_clear") {
    return { kind: "observed_clear" };
  }
  if (state.status === "attention_required" || state.status === "blocked") {
    return {
      kind: state.status,
      recoveryBundleId: state.stoppedBundleId,
      attentionKinds: Array.from(
        new Set(state.bundleResults.flatMap(({ attentionKinds }) => attentionKinds))
      ),
    };
  }
  if (state.status === "diagnostic") {
    return { kind: "unavailable", diagnosticCode: state.code };
  }
  return { kind: "unavailable", diagnosticCode: "recovery_state_invalid" };
}

/**
 * Binds one recovery-only composer to an exact plugin/preflight lifecycle.
 *
 * The adapter checks authority before and after the serialized Gate. The composer
 * additionally rechecks between durable phases. Closing suppresses stale
 * publication while allowing only an already-entered durable phase—especially a
 * transaction roll-forward—to reach its crash-safe boundary.
 */
export class KnowledgePluginProductionRecoveryPort implements KnowledgePluginRecoveryStartupPort {
  private closed = false;
  private started = false;

  /** Creates one one-shot plugin adapter over a recovery-only composer. */
  constructor(private readonly dependencies: KnowledgePluginProductionRecoveryPortDependencies) {}

  /** Runs recovery only while both the caller signal and plugin generation remain current. */
  async start(signal: AbortSignal): Promise<KnowledgePluginRecoveryStartupResult> {
    this.assertOpen(signal);
    if (this.started) {
      throw createAbortError();
    }
    this.started = true;
    this.dependencies.assertCurrent();
    await this.dependencies.composer.start();
    this.assertOpen(signal);
    this.dependencies.assertCurrent();
    return toKnowledgePluginRecoveryStartupResult(this.dependencies.composer.getState());
  }

  /** Permanently closes the composer and releases its plugin-owned reference exactly once. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.dependencies.composer.close();
    } finally {
      this.dependencies.onClose?.();
    }
  }

  /** Rejects closed or caller-cancelled operations before consulting lifecycle authority. */
  private assertOpen(signal: AbortSignal): void {
    if (this.closed || signal.aborted) {
      throw createAbortError();
    }
  }
}

Object.freeze(KnowledgePluginProductionRecoveryPort.prototype);
Object.freeze(KnowledgePluginProductionRecoveryPort);
