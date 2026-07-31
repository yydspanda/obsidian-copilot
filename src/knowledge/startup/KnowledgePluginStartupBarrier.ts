/** Fail-closed phases exposed while the plugin's knowledge feature starts. */
export type KnowledgePluginStartupStatus =
  | "waiting_for_layout"
  | "runtime_unavailable"
  | "projects_unavailable"
  | "bundle_unconfigured"
  | "bundle_invalid"
  | "workflow_adapters_unavailable";

interface KnowledgePluginStartupStateBase {
  /** Latest-wins generation that published this observation. */
  generation: number;
  /** Sanitized fail-closed startup phase. */
  status: KnowledgePluginStartupStatus;
}

/** Safe, immutable startup observation suitable for plugin/UI wiring. */
export type KnowledgePluginStartupState =
  | (KnowledgePluginStartupStateBase & { status: "waiting_for_layout" })
  | (KnowledgePluginStartupStateBase & { status: "runtime_unavailable" })
  | (KnowledgePluginStartupStateBase & { status: "projects_unavailable" })
  | (KnowledgePluginStartupStateBase & { status: "bundle_unconfigured" })
  | (KnowledgePluginStartupStateBase & {
      status: "bundle_invalid";
      diagnosticCodes: readonly string[];
    })
  | (KnowledgePluginStartupStateBase & {
      status: "workflow_adapters_unavailable";
      bundleIds: readonly string[];
    });

/** Synchronous Runtime readiness proof checked before project files are read. */
export interface KnowledgePluginRuntimeAvailabilityPort {
  /** Reports whether the durable Runtime foundation initialized successfully. */
  isAvailable(): boolean;
}

/** Project initialization boundary that must finish after Obsidian layout readiness. */
export interface KnowledgePluginProjectsPort {
  /** Initializes project storage/cache before any Bundle configuration is loaded. */
  initialize(signal: AbortSignal): Promise<void>;
}

/** Safe aggregate returned after project-owned Bundle loading and validation. */
export type KnowledgePluginBundleConfigLoadResult =
  | { kind: "unconfigured" }
  | { kind: "invalid"; diagnosticCodes: readonly string[] }
  | { kind: "configured"; bundleIds: readonly string[] };

/** Read-only boundary for validated project knowledge Bundle configuration. */
export interface KnowledgePluginBundleConfigPort {
  /**
   * Loads a safe aggregate only after project initialization succeeds.
   */
  load(signal: AbortSignal): Promise<KnowledgePluginBundleConfigLoadResult>;
}

/**
 * One-way Studio delegate boundary used by this barrier.
 *
 * No ready operation is intentionally present: production workflow adapters
 * must be introduced through a separate, explicit wiring change.
 */
export interface KnowledgeStudioStartupAvailabilityPort {
  /** Installs an unavailable delegate/notice for the supplied safe startup state. */
  setUnavailable(state: KnowledgePluginStartupState): void;
}

/** Dependencies of the pure plugin startup-ordering barrier. */
export interface KnowledgePluginStartupBarrierDependencies {
  runtime: KnowledgePluginRuntimeAvailabilityPort;
  projects: KnowledgePluginProjectsPort;
  bundleConfig: KnowledgePluginBundleConfigPort;
  studio: KnowledgeStudioStartupAvailabilityPort;
}

/** Callback notified after a current generation publishes a safe state. */
export type KnowledgePluginStartupStateListener = () => void;

const BUNDLE_CONFIG_LOAD_FAILED = "bundle_config_load_failed";
const BUNDLE_CONFIG_RESULT_INVALID = "bundle_config_result_invalid";
const BUNDLE_CONFIG_INVALID = "bundle_config_invalid";
const SAFE_DIAGNOSTIC_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;

/**
 * Creates one frozen state with no raw error or untrusted configuration data.
 *
 * @param state - Safe state fields
 * @returns Immutable state observation
 */
function freezeStartupState<T extends KnowledgePluginStartupState>(state: T): T {
  if (state.status === "bundle_invalid") {
    Object.freeze(state.diagnosticCodes);
  }
  if (state.status === "workflow_adapters_unavailable") {
    Object.freeze(state.bundleIds);
  }
  return Object.freeze(state);
}

/**
 * Extracts deterministic diagnostic codes without exposing paths, messages, or raw input.
 *
 * @param codes - Potentially repeated validation diagnostic codes
 * @returns Sorted immutable code collection
 */
function sanitizeDiagnosticCodes(codes: readonly unknown[]): readonly string[] {
  const safeCodes = codes.filter(
    (code): code is string => typeof code === "string" && SAFE_DIAGNOSTIC_CODE_PATTERN.test(code)
  );
  return Object.freeze(
    Array.from(new Set(safeCodes.length > 0 ? safeCodes : [BUNDLE_CONFIG_INVALID])).sort()
  );
}

/**
 * Validates and canonicalizes Bundle identifiers without retaining aggregate input.
 *
 * @param bundleIds - Identifiers supplied by the project configuration adapter
 * @returns Frozen, code-unit-sorted unique identifiers, or undefined for malformed input
 */
function sanitizeBundleIds(bundleIds: unknown): readonly string[] | undefined {
  if (!Array.isArray(bundleIds) || bundleIds.length === 0) {
    return undefined;
  }
  const safeBundleIds: string[] = [];
  for (const candidate of bundleIds as readonly unknown[]) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      return undefined;
    }
    safeBundleIds.push(candidate);
  }
  return Object.freeze(Array.from(new Set(safeBundleIds)).sort());
}

/**
 * Coordinates only the plugin-level prerequisites that may be proven today.
 *
 * This class deliberately never calls the startup recovery Gate, startup
 * release, Queue, model, watcher, or any workflow adapter. Even a valid Bundle
 * therefore ends in `workflow_adapters_unavailable`.
 */
export class KnowledgePluginStartupBarrier {
  private generation = 0;
  private activeRun?: { generation: number; controller: AbortController };
  private state: KnowledgePluginStartupState;
  private readonly listeners = new Set<KnowledgePluginStartupStateListener>();

  /**
   * Creates a fail-closed barrier and immediately resets the supplied Studio delegate.
   *
   * @param dependencies - Narrow plugin startup boundaries
   */
  constructor(private readonly dependencies: KnowledgePluginStartupBarrierDependencies) {
    this.state = freezeStartupState({ generation: 0, status: "waiting_for_layout" });
    this.dependencies.studio.setUnavailable(this.state);
  }

  /** Returns the latest immutable, sanitized startup observation. */
  getState(): KnowledgePluginStartupState {
    return this.state;
  }

  /**
   * Subscribes to current-generation state publications.
   *
   * @param listener - Callback that can read the latest state through `getState`
   * @returns Idempotent unsubscribe callback
   */
  subscribe(listener: KnowledgePluginStartupStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Runs the ordered checks after Obsidian reports layout readiness.
   *
   * A new call aborts and supersedes the prior generation. The Studio delegate
   * is reset synchronously before the first awaited project operation.
   */
  async startAfterLayout(): Promise<void> {
    this.activeRun?.controller.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.activeRun = { generation, controller };

    this.publish(generation, freezeStartupState({ generation, status: "waiting_for_layout" }));

    try {
      if (!this.isRuntimeAvailable()) {
        this.publish(generation, freezeStartupState({ generation, status: "runtime_unavailable" }));
        return;
      }

      try {
        await this.dependencies.projects.initialize(controller.signal);
      } catch {
        if (this.isCurrent(generation, controller.signal)) {
          this.publish(
            generation,
            freezeStartupState({ generation, status: "projects_unavailable" })
          );
        }
        return;
      }

      if (!this.isCurrent(generation, controller.signal)) {
        return;
      }

      let bundleResult: KnowledgePluginBundleConfigLoadResult;
      try {
        bundleResult = await this.dependencies.bundleConfig.load(controller.signal);
      } catch {
        if (this.isCurrent(generation, controller.signal)) {
          this.publishInvalidBundle(generation, [BUNDLE_CONFIG_LOAD_FAILED]);
        }
        return;
      }

      if (!this.isCurrent(generation, controller.signal)) {
        return;
      }
      this.publishBundleResult(generation, bundleResult);
    } finally {
      if (this.activeRun?.generation === generation) {
        this.activeRun = undefined;
      }
    }
  }

  /**
   * Cancels an active generation without allowing its eventual completion to publish.
   *
   * Cancellation itself remains fail-closed and returns observation to the
   * pre-layout waiting phase for a future explicit rerun.
   */
  cancel(): void {
    if (!this.activeRun) {
      return;
    }
    this.activeRun.controller.abort();
    const generation = ++this.generation;
    this.activeRun = undefined;
    this.publish(generation, freezeStartupState({ generation, status: "waiting_for_layout" }));
  }

  /**
   * Converts a Runtime readiness exception into the same safe unavailable result.
   *
   * @returns Whether the Runtime foundation is available
   */
  private isRuntimeAvailable(): boolean {
    try {
      return this.dependencies.runtime.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Reports whether an awaited continuation still owns publication authority.
   *
   * @param generation - Generation captured by the continuation
   * @param signal - Run-local cancellation signal
   * @returns Whether the continuation is current and not aborted
   */
  private isCurrent(generation: number, signal: AbortSignal): boolean {
    return (
      !signal.aborted && this.generation === generation && this.activeRun?.generation === generation
    );
  }

  /**
   * Publishes sanitized invalid-Bundle evidence for the current generation.
   *
   * @param generation - Generation owning the validation result
   * @param diagnosticCodes - Stable parser/validator codes
   */
  private publishInvalidBundle(generation: number, diagnosticCodes: readonly string[]): void {
    this.publish(
      generation,
      freezeStartupState({
        generation,
        status: "bundle_invalid",
        diagnosticCodes: sanitizeDiagnosticCodes(diagnosticCodes),
      })
    );
  }

  /**
   * Publishes one validated aggregate result without retaining its source object.
   *
   * @param generation - Generation owning the aggregate result
   * @param result - Safe project configuration aggregate
   */
  private publishBundleResult(
    generation: number,
    result: KnowledgePluginBundleConfigLoadResult
  ): void {
    if (typeof result !== "object" || result === null || typeof result.kind !== "string") {
      this.publishInvalidBundle(generation, [BUNDLE_CONFIG_RESULT_INVALID]);
      return;
    }
    if (result.kind === "unconfigured") {
      this.publish(generation, freezeStartupState({ generation, status: "bundle_unconfigured" }));
      return;
    }
    if (result.kind === "invalid") {
      if (!Array.isArray(result.diagnosticCodes)) {
        this.publishInvalidBundle(generation, [BUNDLE_CONFIG_RESULT_INVALID]);
        return;
      }
      this.publishInvalidBundle(generation, result.diagnosticCodes);
      return;
    }
    if (result.kind === "configured") {
      const bundleIds = sanitizeBundleIds(result.bundleIds);
      if (!bundleIds) {
        this.publishInvalidBundle(generation, [BUNDLE_CONFIG_RESULT_INVALID]);
        return;
      }
      this.publish(
        generation,
        freezeStartupState({
          generation,
          status: "workflow_adapters_unavailable",
          bundleIds,
        })
      );
      return;
    }
    this.publishInvalidBundle(generation, [BUNDLE_CONFIG_RESULT_INVALID]);
  }

  /**
   * Resets Studio first, then exposes the same unavailable state to observers.
   *
   * @param generation - Generation owning the publication
   * @param state - Frozen safe state
   */
  private publish(generation: number, state: KnowledgePluginStartupState): void {
    if (generation !== this.generation) {
      return;
    }
    this.dependencies.studio.setUnavailable(state);
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers are non-authoritative and cannot interrupt startup or one another.
      }
    }
  }
}
