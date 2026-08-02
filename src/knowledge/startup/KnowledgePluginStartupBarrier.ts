/** Fail-closed phases exposed while the plugin's knowledge feature starts. */
export type KnowledgePluginStartupStatus =
  | "waiting_for_layout"
  | "runtime_unavailable"
  | "projects_unavailable"
  | "bundle_unconfigured"
  | "bundle_invalid"
  | "recovery_unavailable"
  | "recovery_attention_required"
  | "recovery_blocked"
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
      status: "recovery_unavailable";
      bundleIds: readonly string[];
      diagnosticCodes: readonly string[];
    })
  | (KnowledgePluginStartupStateBase & {
      status: "recovery_attention_required" | "recovery_blocked";
      bundleIds: readonly string[];
      attentionKinds: readonly string[];
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
  | {
      kind: "configured";
      bundleIds: readonly string[];
      recovery?: KnowledgePluginRecoveryStartupPort;
      observation?: KnowledgePluginObservationStartupPort;
    };

/** Sanitized one-shot result returned by the production recovery boundary. */
export type KnowledgePluginRecoveryStartupResult =
  | { kind: "observed_clear" }
  | {
      kind: "attention_required" | "blocked";
      attentionKinds: readonly string[];
    }
  | { kind: "unavailable"; diagnosticCode: string };

/** One-shot recovery capability captured from the exact configured generation. */
export interface KnowledgePluginRecoveryStartupPort {
  /** Runs recovery observation/roll-forward without releasing or claiming Queue work. */
  start(signal: AbortSignal): Promise<KnowledgePluginRecoveryStartupResult>;
  /** Permanently closes this recovery generation and suppresses stale publication. */
  close(): void;
}

/** One long-lived observation capability started only after recovery is clear. */
export interface KnowledgePluginObservationStartupPort {
  /** Starts listener-first observation for the exact current startup generation. */
  start(signal: AbortSignal): Promise<KnowledgePluginObservationStartupResult>;
  /** Permanently closes the live watcher and suppresses stale publication. */
  close(): void;
}

/** Sanitized observation result accepted by the startup barrier. */
export type KnowledgePluginObservationStartupResult =
  | Readonly<{ kind: "observation_converged"; scheduledCaptureCount: number }>
  | Readonly<{ kind: "blocked"; blockerKinds: readonly string[] }>
  | Readonly<{ kind: "diagnostic"; code: string }>;

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
const RECOVERY_FAILED = "recovery_failed";
const RECOVERY_RESULT_INVALID = "recovery_result_invalid";
const SAFE_DIAGNOSTIC_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;
const SAFE_RECOVERY_DIAGNOSTIC_CODES = new Set([
  "active_transaction_owner_unconfigured",
  "input_invalid",
  "recovery_failed",
  "recovery_state_invalid",
  "runtime_state_invalid",
]);
const SAFE_RECOVERY_ATTENTION_KINDS = new Set([
  "accepted_apply_blocked",
  "accepted_not_started",
  "commit_finalizing",
  "global_transaction_observed",
  "no_journal_decision_required",
  "queue_commit_pending_ack",
  "queue_recovery_required",
  "transaction_active",
  "transaction_recovery_required",
]);

/**
 * Creates one frozen state with no raw error or untrusted configuration data.
 *
 * @param state - Safe state fields
 * @returns Immutable state observation
 */
function freezeStartupState<T extends KnowledgePluginStartupState>(state: T): T {
  if (state.status === "bundle_invalid" || state.status === "recovery_unavailable") {
    Object.freeze(state.diagnosticCodes);
  }
  if (
    state.status === "recovery_unavailable" ||
    state.status === "recovery_attention_required" ||
    state.status === "recovery_blocked" ||
    state.status === "workflow_adapters_unavailable"
  ) {
    Object.freeze(state.bundleIds);
  }
  if (state.status === "recovery_attention_required" || state.status === "recovery_blocked") {
    Object.freeze(state.attentionKinds);
  }
  return Object.freeze(state);
}

/**
 * Extracts deterministic diagnostic codes without exposing paths, messages, or raw input.
 *
 * @param codes - Potentially repeated validation diagnostic codes
 * @returns Sorted immutable code collection
 */
function sanitizeDiagnosticCodes(
  codes: readonly unknown[],
  fallback: string = BUNDLE_CONFIG_INVALID
): readonly string[] {
  const safeCodes = codes.filter(
    (code): code is string => typeof code === "string" && SAFE_DIAGNOSTIC_CODE_PATTERN.test(code)
  );
  return Object.freeze(Array.from(new Set(safeCodes.length > 0 ? safeCodes : [fallback])).sort());
}

/** Sanitizes recovery attention categories through the same closed text boundary. */
function sanitizeAttentionKinds(kinds: readonly unknown[]): readonly string[] | undefined {
  if (
    kinds.length === 0 ||
    kinds.some((kind) => typeof kind !== "string" || !SAFE_RECOVERY_ATTENTION_KINDS.has(kind))
  ) {
    return undefined;
  }
  return Object.freeze(Array.from(new Set(kinds as readonly string[])).sort());
}

/** Accepts only the fixed recovery composer diagnostic vocabulary. */
function sanitizeRecoveryDiagnosticCode(code: unknown): string {
  return typeof code === "string" && SAFE_RECOVERY_DIAGNOSTIC_CODES.has(code)
    ? code
    : RECOVERY_RESULT_INVALID;
}

/** Accepts only a complete, value-free observation convergence result. */
function isObservationConverged(
  value: unknown
): value is Readonly<{ kind: "observation_converged"; scheduledCaptureCount: number }> {
  if (typeof value !== "object" || value === null) return false;
  const kind = Object.getOwnPropertyDescriptor(value, "kind");
  const scheduled = Object.getOwnPropertyDescriptor(value, "scheduledCaptureCount");
  return (
    kind !== undefined &&
    "value" in kind &&
    kind.enumerable === true &&
    kind.value === "observation_converged" &&
    scheduled !== undefined &&
    "value" in scheduled &&
    scheduled.enumerable === true &&
    Number.isSafeInteger(scheduled.value) &&
    scheduled.value >= 0
  );
}

/** Finds a callable data method without evaluating accessors on an injected object. */
function hasCallableDataMethod(value: object, key: string): boolean {
  try {
    let current: object | null = value;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function";
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return false;
  }
  return false;
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
 * Coordinates plugin prerequisites and one exact recovery-only generation.
 *
 * Recovery is supplied as an opaque one-shot port only after strict Bundle and
 * zero-network production preflight validation. A separate observation port may
 * be retained after observed-clear recovery, but the barrier never receives a
 * startup release, Queue worker, model, no-journal action, or Wiki generation
 * capability. The published state remains `workflow_adapters_unavailable`.
 */
export class KnowledgePluginStartupBarrier {
  private generation = 0;
  private activeRun?: { generation: number; controller: AbortController };
  private activeRecovery?: KnowledgePluginRecoveryStartupPort;
  private activeObservation?: KnowledgePluginObservationStartupPort;
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
    this.closeActiveObservation();
    this.closeActiveRecovery();
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
      await this.publishBundleResult(generation, bundleResult, controller.signal);
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
    if (!this.activeRun && !this.activeRecovery && !this.activeObservation) {
      return;
    }
    this.activeRun?.controller.abort();
    this.closeActiveObservation();
    this.closeActiveRecovery();
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
  private async publishBundleResult(
    generation: number,
    result: KnowledgePluginBundleConfigLoadResult,
    signal: AbortSignal
  ): Promise<void> {
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
      const recovery = this.readRecoveryPort(result);
      if (recovery === null) {
        this.closeObservationSafelyFromResult(result);
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return;
      }
      if (recovery) {
        const observation = this.readObservationPort(result);
        if (observation === null) {
          this.closeObservationSafelyFromResult(result);
          this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
          return;
        }
        await this.runRecovery(generation, signal, bundleIds, recovery, observation);
        return;
      }
      this.closeObservationSafelyFromResult(result);
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

  /** Reads an optional own data recovery port without invoking an accessor. */
  private readRecoveryPort(
    result: Extract<KnowledgePluginBundleConfigLoadResult, { kind: "configured" }>
  ): KnowledgePluginRecoveryStartupPort | undefined | null {
    const descriptor = Object.getOwnPropertyDescriptor(result, "recovery");
    if (!descriptor) {
      return undefined;
    }
    const candidate: unknown = "value" in descriptor ? descriptor.value : undefined;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !hasCallableDataMethod(candidate, "start") ||
      !hasCallableDataMethod(candidate, "close")
    ) {
      return null;
    }
    return candidate as KnowledgePluginRecoveryStartupPort;
  }

  /** Reads an optional own data observation port without invoking an accessor. */
  private readObservationPort(
    result: Extract<KnowledgePluginBundleConfigLoadResult, { kind: "configured" }>
  ): KnowledgePluginObservationStartupPort | undefined | null {
    const descriptor = Object.getOwnPropertyDescriptor(result, "observation");
    if (!descriptor) return undefined;
    const candidate: unknown = "value" in descriptor ? descriptor.value : undefined;
    if (candidate === undefined) return undefined;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !hasCallableDataMethod(candidate, "start") ||
      !hasCallableDataMethod(candidate, "close")
    ) {
      return null;
    }
    return candidate as KnowledgePluginObservationStartupPort;
  }

  /** Closes an observation supplied by a malformed or recovery-only result. */
  private closeObservationSafelyFromResult(
    result: Extract<KnowledgePluginBundleConfigLoadResult, { kind: "configured" }>
  ): void {
    const observation = this.readObservationPort(result);
    if (observation && observation !== this.activeObservation) {
      this.closeObservationSafely(observation);
    }
  }

  /** Runs and closes one recovery generation before publishing its sanitized result. */
  private async runRecovery(
    generation: number,
    signal: AbortSignal,
    bundleIds: readonly string[],
    recovery: KnowledgePluginRecoveryStartupPort,
    observation?: KnowledgePluginObservationStartupPort
  ): Promise<void> {
    this.activeRecovery = recovery;
    let result: KnowledgePluginRecoveryStartupResult;
    try {
      result = await recovery.start(signal);
    } catch {
      this.closeObservationSafely(observation);
      if (this.isCurrent(generation, signal)) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_FAILED);
      }
      return;
    } finally {
      if (this.activeRecovery === recovery) {
        this.activeRecovery = undefined;
        this.closeRecoverySafely(recovery);
      }
    }

    if (!this.isCurrent(generation, signal)) {
      this.closeObservationSafely(observation);
      return;
    }
    if (typeof result !== "object" || result === null || typeof result.kind !== "string") {
      this.closeObservationSafely(observation);
      this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
      return;
    }
    if (result.kind === "observed_clear") {
      if (
        observation &&
        !(await this.startObservation(generation, signal, bundleIds, observation))
      ) {
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
    if (result.kind === "unavailable") {
      this.closeObservationSafely(observation);
      const diagnosticCode = sanitizeRecoveryDiagnosticCode(result.diagnosticCode);
      this.publishRecoveryUnavailable(generation, bundleIds, diagnosticCode);
      return;
    }
    if (result.kind === "attention_required" || result.kind === "blocked") {
      this.closeObservationSafely(observation);
      if (!Array.isArray(result.attentionKinds)) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return;
      }
      const attentionKinds = sanitizeAttentionKinds(result.attentionKinds);
      if (!attentionKinds) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return;
      }
      this.publish(
        generation,
        freezeStartupState({
          generation,
          status:
            result.kind === "attention_required"
              ? "recovery_attention_required"
              : "recovery_blocked",
          bundleIds,
          attentionKinds,
        })
      );
      return;
    }
    this.closeObservationSafely(observation);
    this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
  }

  /** Starts and retains one observation session after a clear recovery result. */
  private async startObservation(
    generation: number,
    signal: AbortSignal,
    bundleIds: readonly string[],
    observation: KnowledgePluginObservationStartupPort
  ): Promise<boolean> {
    this.activeObservation = observation;
    let result: KnowledgePluginObservationStartupResult;
    try {
      result = await observation.start(signal);
    } catch {
      this.closeActiveObservation();
      if (this.isCurrent(generation, signal)) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_FAILED);
      }
      return false;
    }
    if (!this.isCurrent(generation, signal)) {
      this.closeActiveObservation();
      return false;
    }
    if (!isObservationConverged(result)) {
      this.closeActiveObservation();
      this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
      return false;
    }
    return true;
  }

  /** Publishes one fixed-code recovery failure without reclassifying Bundle configuration. */
  private publishRecoveryUnavailable(
    generation: number,
    bundleIds: readonly string[],
    diagnosticCode: string
  ): void {
    this.publish(
      generation,
      freezeStartupState({
        generation,
        status: "recovery_unavailable",
        bundleIds,
        diagnosticCodes: sanitizeDiagnosticCodes([diagnosticCode], RECOVERY_FAILED),
      })
    );
  }

  /** Closes the currently running recovery capability during replacement or cancellation. */
  private closeActiveRecovery(): void {
    const recovery = this.activeRecovery;
    this.activeRecovery = undefined;
    if (recovery) {
      this.closeRecoverySafely(recovery);
    }
  }

  /** Closes the current long-lived observation capability during replacement/cancellation. */
  private closeActiveObservation(): void {
    const observation = this.activeObservation;
    this.activeObservation = undefined;
    if (observation) {
      this.closeObservationSafely(observation);
    }
  }

  /** Isolates observation cleanup so generation invalidation remains authoritative. */
  private closeObservationSafely(
    observation: KnowledgePluginObservationStartupPort | undefined
  ): void {
    if (!observation) return;
    try {
      observation.close();
    } catch {
      // Observation authority is already revoked by generation and signal checks.
    }
  }

  /** Isolates recovery cleanup so fail-closed lifecycle state remains authoritative. */
  private closeRecoverySafely(recovery: KnowledgePluginRecoveryStartupPort): void {
    try {
      recovery.close();
    } catch {
      // Recovery publication authority is already revoked by generation and signal checks.
    }
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
