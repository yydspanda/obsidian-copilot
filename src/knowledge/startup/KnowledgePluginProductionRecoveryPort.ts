import type {
  KnowledgePluginRecoveryStartupPort,
  KnowledgePluginRecoveryStartupResult,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import type { KnowledgeProductionRecoveryState } from "@/knowledge/startup/KnowledgeProductionRecoveryComposer";

export interface KnowledgePluginProductionRecoveryComposerPort {
  start(): Promise<void>;

  getState(): KnowledgeProductionRecoveryState;

  close(): void;
}

export interface KnowledgePluginProductionRecoveryPortDependencies {
  composer: KnowledgePluginProductionRecoveryComposerPort;

  assertCurrent(): void;

  onClose?(): void;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

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

export class KnowledgePluginProductionRecoveryPort implements KnowledgePluginRecoveryStartupPort {
  private closed = false;
  private started = false;

  constructor(private readonly dependencies: KnowledgePluginProductionRecoveryPortDependencies) {}

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

  private assertOpen(signal: AbortSignal): void {
    if (this.closed || signal.aborted) {
      throw createAbortError();
    }
  }
}

Object.freeze(KnowledgePluginProductionRecoveryPort.prototype);
Object.freeze(KnowledgePluginProductionRecoveryPort);
