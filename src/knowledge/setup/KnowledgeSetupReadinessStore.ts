import {
  KnowledgeSetupReadinessInputError,
  projectKnowledgeSetupReadiness,
  type KnowledgeSetupChatModelReason,
  type KnowledgeSetupKnowledgeModelReason,
  type KnowledgeSetupReadinessContext,
  type KnowledgeSetupReadinessItem,
  type KnowledgeSetupReadinessLevel,
  type KnowledgeSetupReadinessProjection,
  type KnowledgeSetupWorkspaceReason,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import type {
  KnowledgePluginStartupState,
  KnowledgePluginStartupStatus,
} from "@/knowledge/startup/KnowledgePluginStartupBarrier";

/** Immutable store observation with a monotonic process-local revision. */
export interface KnowledgeSetupReadinessSnapshot extends KnowledgeSetupReadinessProjection {
  revision: number;
}

/** Callback notified synchronously after readiness publication. */
export type KnowledgeSetupReadinessListener = () => void;

/** Fixed error raised when a disposed readiness store is asked to publish again. */
export class KnowledgeSetupReadinessStoreDisposedError extends Error {
  /** Creates one sanitized permanent-closure failure. */
  constructor() {
    super("Knowledge setup readiness store has been disposed");
    this.name = "KnowledgeSetupReadinessStoreDisposedError";
  }
}

const STARTUP_STATUSES = new Set<KnowledgePluginStartupStatus>([
  "waiting_for_layout",
  "runtime_unavailable",
  "projects_unavailable",
  "bundle_unconfigured",
  "bundle_invalid",
  "recovery_unavailable",
  "recovery_attention_required",
  "recovery_blocked",
  "source_recovery_required",
  "workflow_adapters_unavailable",
  "workflow_read_ready",
]);
const STORED_STARTUP_STATUSES = new Set<string>([...STARTUP_STATUSES, "plugin_unloaded"]);

const LEVELS = new Set<KnowledgeSetupReadinessLevel>([
  "checking",
  "locally_ready",
  "needs_action",
  "blocked",
  "not_applicable",
]);

const WORKSPACE_PAIRS = new Set<string>([
  "checking:startup_checking",
  "blocked:plugin_unloaded",
  "locally_ready:workspace_ready",
  "blocked:durable_storage_unavailable",
  "blocked:projects_unavailable",
  "needs_action:no_project",
  "needs_action:bundle_missing",
  "needs_action:bundle_configuration_invalid",
  "needs_action:multiple_bundles",
  "needs_action:configuration_needs_attention",
  "blocked:recovery_unavailable",
  "blocked:recovery_attention_required",
  "blocked:recovery_blocked",
  "blocked:source_recovery_required",
  "blocked:workflow_adapters_unavailable",
]);

const KNOWLEDGE_MODEL_PAIRS = new Set<string>([
  "checking:startup_checking",
  "blocked:plugin_unloaded",
  "locally_ready:knowledge_model_configured",
  "blocked:workspace_unavailable",
  "not_applicable:workspace_unavailable",
  "not_applicable:workspace_configuration_needs_attention",
  "needs_action:knowledge_model_missing",
  "needs_action:knowledge_model_ambiguous",
  "needs_action:knowledge_model_disabled",
  "needs_action:knowledge_model_not_project_enabled",
  "needs_action:knowledge_model_unsupported",
  "needs_action:knowledge_model_configuration_invalid",
  "needs_action:knowledge_model_endpoint_invalid",
  "needs_action:knowledge_model_credential_missing",
  "blocked:knowledge_model_route_unavailable",
  "needs_action:configuration_needs_attention",
]);

const CHAT_MODEL_PAIRS = new Set<string>([
  "blocked:plugin_unloaded",
  "needs_action:chat_model_missing",
  "needs_action:chat_model_ambiguous",
  "needs_action:chat_model_disabled",
  "needs_action:chat_model_unsupported",
  "needs_action:chat_model_not_project_enabled",
  "needs_action:chat_model_credential_missing",
  "locally_ready:chat_model_configured",
]);

/** Reads one enumerable own data field without evaluating an accessor. */
function readOwnData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSetupReadinessInputError();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new KnowledgeSetupReadinessInputError();
  }
  return descriptor.value;
}

/** Captures one readiness item through its exact closed level/reason pair. */
function captureItem<Reason extends string>(
  value: unknown,
  allowedPairs: ReadonlySet<string>
): Readonly<KnowledgeSetupReadinessItem<Reason>> {
  const level = readOwnData(value, "level");
  const reason = readOwnData(value, "reason");
  if (
    typeof level !== "string" ||
    !LEVELS.has(level as KnowledgeSetupReadinessLevel) ||
    typeof reason !== "string" ||
    !allowedPairs.has(`${level}:${reason}`)
  ) {
    throw new KnowledgeSetupReadinessInputError();
  }
  return Object.freeze({
    level: level as KnowledgeSetupReadinessLevel,
    reason: reason as Reason,
  });
}

/** Copies a projection into a new frozen snapshot without retaining caller-owned objects. */
function captureSnapshot(
  revision: number,
  projection: KnowledgeSetupReadinessProjection
): KnowledgeSetupReadinessSnapshot {
  try {
    const startupStatus = readOwnData(projection, "startupStatus");
    const networkVerification = readOwnData(projection, "networkVerification");
    if (
      typeof startupStatus !== "string" ||
      !STORED_STARTUP_STATUSES.has(startupStatus) ||
      networkVerification !== "not_tested"
    ) {
      throw new KnowledgeSetupReadinessInputError();
    }
    const workspace = captureItem<KnowledgeSetupWorkspaceReason>(
      readOwnData(projection, "workspace"),
      WORKSPACE_PAIRS
    );
    const knowledgeModel = captureItem<KnowledgeSetupKnowledgeModelReason>(
      readOwnData(projection, "knowledgeModel"),
      KNOWLEDGE_MODEL_PAIRS
    );
    const chatModel = captureItem<KnowledgeSetupChatModelReason>(
      readOwnData(projection, "chatModel"),
      CHAT_MODEL_PAIRS
    );
    return Object.freeze({
      revision,
      startupStatus: startupStatus as KnowledgeSetupReadinessSnapshot["startupStatus"],
      workspace,
      knowledgeModel,
      chatModel,
      networkVerification: "not_tested" as const,
    });
  } catch (error) {
    if (error instanceof KnowledgeSetupReadinessInputError) {
      throw error;
    }
    throw new KnowledgeSetupReadinessInputError();
  }
}

/** Notifies one non-authoritative observer without interrupting store publication. */
function notifyListenerSafely(listener: KnowledgeSetupReadinessListener): void {
  try {
    listener();
  } catch {
    // Readiness observers cannot interrupt the store or one another.
  }
}

/**
 * Stable in-memory publisher for local Knowledge setup readiness.
 *
 * The store owns no settings, application, runtime, model, network, or I/O
 * capability. Every publication is copied through the closed reason vocabulary.
 */
export class KnowledgeSetupReadinessStore {
  private state: KnowledgeSetupReadinessSnapshot;
  private readonly listeners = new Set<KnowledgeSetupReadinessListener>();
  private disposed = false;

  /**
   * Creates revision zero from an already projected local observation.
   *
   * @param initialProjection - Secret-free projector output
   */
  constructor(initialProjection: KnowledgeSetupReadinessProjection) {
    this.state = captureSnapshot(0, initialProjection);
  }

  /** Returns the current frozen readiness observation synchronously. */
  getState(): KnowledgeSetupReadinessSnapshot {
    return this.state;
  }

  /**
   * Copies and publishes one projected observation at the next local revision.
   *
   * @param projection - Secret-free projector output without a revision
   */
  publish(projection: KnowledgeSetupReadinessProjection): void {
    if (this.disposed) {
      throw new KnowledgeSetupReadinessStoreDisposedError();
    }
    const next = captureSnapshot(this.nextRevision(), projection);
    this.state = next;
    this.notifyListeners();
  }

  /**
   * Projects and publishes one startup observation without exposing a settings edge.
   *
   * @param startupState - Sanitized Knowledge startup-barrier state
   * @param context - Plain Project count and exact Chat catalog result
   */
  publishStartup(
    startupState: KnowledgePluginStartupState,
    context: KnowledgeSetupReadinessContext
  ): void {
    this.publish(projectKnowledgeSetupReadiness(startupState, context));
  }

  /**
   * Subscribes and immediately reports the current observation.
   *
   * Registration precedes the immediate call, preventing a synchronous
   * get/subscribe window. A late subscriber after disposal receives the final
   * observation once but is not retained.
   *
   * @param listener - Callback that reads the snapshot through `getState`
   * @returns Idempotent unsubscribe callback
   */
  subscribe(listener: KnowledgeSetupReadinessListener): () => void {
    if (this.disposed) {
      notifyListenerSafely(listener);
      return () => undefined;
    }
    this.listeners.add(listener);
    notifyListenerSafely(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  /** Permanently closes publication authority and releases every observer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  /** Returns the next safe monotonic process-local revision. */
  private nextRevision(): number {
    if (
      !Number.isSafeInteger(this.state.revision) ||
      this.state.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new KnowledgeSetupReadinessStoreDisposedError();
    }
    return this.state.revision + 1;
  }

  /** Notifies a stable copy so listener mutation cannot affect this publication. */
  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      notifyListenerSafely(listener);
    }
  }
}
