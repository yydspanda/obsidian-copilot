export type KnowledgePluginStartupStatus =
  | "waiting_for_layout"
  | "runtime_unavailable"
  | "projects_unavailable"
  | "bundle_unconfigured"
  | "bundle_invalid"
  | "recovery_unavailable"
  | "recovery_attention_required"
  | "recovery_blocked"
  | "source_recovery_required"
  | "workflow_adapters_unavailable"
  | "workflow_read_ready";

interface KnowledgePluginStartupStateBase {
  generation: number;

  status: KnowledgePluginStartupStatus;
}

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
      recoveryBundleId: string;
      attentionKinds: readonly string[];
    })
  | (KnowledgePluginStartupStateBase & {
      status: "source_recovery_required";
      bundleIds: readonly string[];
      sourceRecoveryBundleId: string;
      blockerKinds: readonly ["source_observation_pending"];
    })
  | (KnowledgePluginStartupStateBase & {
      status: "workflow_adapters_unavailable";
      bundleIds: readonly string[];
    })
  | (KnowledgePluginStartupStateBase & {
      status: "workflow_read_ready";
      bundleIds: readonly string[];
    });

export interface KnowledgePluginRuntimeAvailabilityPort {
  isAvailable(): boolean;
}

export interface KnowledgePluginProjectsPort {
  initialize(signal: AbortSignal): Promise<void>;
}

export type KnowledgePluginBundleConfigLoadResult =
  | { kind: "unconfigured" }
  | { kind: "invalid"; diagnosticCodes: readonly string[] }
  | {
      kind: "configured";
      bundleIds: readonly string[];
      recovery?: KnowledgePluginRecoveryStartupPort;
      observation?: KnowledgePluginObservationStartupPort;
    };

export type KnowledgePluginRecoveryStartupResult =
  | { kind: "observed_clear" }
  | {
      kind: "attention_required" | "blocked";
      recoveryBundleId?: string;
      attentionKinds: readonly string[];
    }
  | { kind: "unavailable"; diagnosticCode: string };

export interface KnowledgePluginRecoveryStartupPort {
  start(signal: AbortSignal): Promise<KnowledgePluginRecoveryStartupResult>;

  close(): void;
}

export interface KnowledgePluginObservationStartupPort {
  start(signal: AbortSignal): Promise<KnowledgePluginObservationStartupResult>;

  release?(signal: AbortSignal): Promise<KnowledgePluginObservationReleaseResult>;

  close(): void;
}

export type KnowledgePluginObservationStartupResult =
  | Readonly<{ kind: "observation_converged"; scheduledCaptureCount: number }>
  | Readonly<{
      kind: "blocked";
      blockerKinds: readonly string[];
      sourceRecoveryBundleIds?: readonly string[];
    }>
  | Readonly<{ kind: "diagnostic"; code: string }>;

export type KnowledgePluginObservationReleaseResult =
  | Readonly<{ kind: "released"; bundleIds: readonly string[] }>
  | Readonly<{ kind: "blocked"; bundleId: string }>
  | Readonly<{ kind: "observation_changed"; bundleId: string }>;

export interface KnowledgePluginBundleConfigPort {
  load(signal: AbortSignal): Promise<KnowledgePluginBundleConfigLoadResult>;
}

export interface KnowledgeStudioStartupAvailabilityPort {
  setUnavailable(state: KnowledgePluginStartupState): void;

  setReadReady(
    state: Extract<KnowledgePluginStartupState, { status: "workflow_read_ready" }>
  ): void;

  setRecoveryReady?(
    state: Extract<
      KnowledgePluginStartupState,
      { status: "recovery_attention_required" | "recovery_blocked" }
    >
  ): void;

  setSourceRecoveryReady?(
    state: Extract<KnowledgePluginStartupState, { status: "source_recovery_required" }>
  ): void;
}

export interface KnowledgePluginStartupBarrierDependencies {
  runtime: KnowledgePluginRuntimeAvailabilityPort;
  projects: KnowledgePluginProjectsPort;
  bundleConfig: KnowledgePluginBundleConfigPort;
  studio: KnowledgeStudioStartupAvailabilityPort;
}

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
  "forward_revision_apply_recovery_required",
  "global_transaction_observed",
  "no_journal_decision_required",
  "queue_commit_pending_ack",
  "queue_recovery_required",
  "transaction_active",
  "transaction_recovery_required",
]);

function freezeStartupState<T extends KnowledgePluginStartupState>(state: T): T {
  if (state.status === "bundle_invalid" || state.status === "recovery_unavailable") {
    Object.freeze(state.diagnosticCodes);
  }
  if (
    state.status === "recovery_unavailable" ||
    state.status === "recovery_attention_required" ||
    state.status === "recovery_blocked" ||
    state.status === "source_recovery_required" ||
    state.status === "workflow_adapters_unavailable" ||
    state.status === "workflow_read_ready"
  ) {
    Object.freeze(state.bundleIds);
  }
  if (state.status === "recovery_attention_required" || state.status === "recovery_blocked") {
    Object.freeze(state.attentionKinds);
  }
  if (state.status === "source_recovery_required") {
    Object.freeze(state.blockerKinds);
  }
  return Object.freeze(state);
}

function sanitizeDiagnosticCodes(
  codes: readonly unknown[],
  fallback: string = BUNDLE_CONFIG_INVALID
): readonly string[] {
  const safeCodes = codes.filter(
    (code): code is string => typeof code === "string" && SAFE_DIAGNOSTIC_CODE_PATTERN.test(code)
  );
  return Object.freeze(Array.from(new Set(safeCodes.length > 0 ? safeCodes : [fallback])).sort());
}

function sanitizeAttentionKinds(kinds: readonly unknown[]): readonly string[] | undefined {
  if (
    kinds.length === 0 ||
    kinds.some((kind) => typeof kind !== "string" || !SAFE_RECOVERY_ATTENTION_KINDS.has(kind))
  ) {
    return undefined;
  }
  return Object.freeze(Array.from(new Set(kinds as readonly string[])).sort());
}

function sanitizeRecoveryDiagnosticCode(code: unknown): string {
  return typeof code === "string" && SAFE_RECOVERY_DIAGNOSTIC_CODES.has(code)
    ? code
    : RECOVERY_RESULT_INVALID;
}

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

interface KnowledgeSourceObservationRecoveryResult {
  readonly bundleId: string;
  readonly blockerKinds: readonly ["source_observation_pending"];
}

function isExactSingletonStringArray(candidate: unknown, expected: string): boolean {
  if (!Array.isArray(candidate) || Reflect.ownKeys(candidate).length !== 2) return false;
  const length = Object.getOwnPropertyDescriptor(candidate, "length");
  const item = Object.getOwnPropertyDescriptor(candidate, "0");
  return (
    !!length &&
    "value" in length &&
    length.value === 1 &&
    !!item &&
    "value" in item &&
    item.enumerable === true &&
    item.value === expected
  );
}

function readSourceObservationRecoveryResult(
  value: unknown,
  configuredBundleIds: readonly string[]
): KnowledgeSourceObservationRecoveryResult | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      configuredBundleIds.length !== 1 ||
      Reflect.ownKeys(value).length !== 3
    ) {
      return undefined;
    }
    const kind = Object.getOwnPropertyDescriptor(value, "kind");
    const blockers = Object.getOwnPropertyDescriptor(value, "blockerKinds");
    const recoveryBundles = Object.getOwnPropertyDescriptor(value, "sourceRecoveryBundleIds");
    if (
      !kind ||
      !("value" in kind) ||
      kind.enumerable !== true ||
      kind.value !== "blocked" ||
      !blockers ||
      !("value" in blockers) ||
      blockers.enumerable !== true ||
      !recoveryBundles ||
      !("value" in recoveryBundles) ||
      recoveryBundles.enumerable !== true ||
      !isExactSingletonStringArray(blockers.value, "source_observation_pending") ||
      !isExactSingletonStringArray(recoveryBundles.value, configuredBundleIds[0])
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return Object.freeze({
    bundleId: configuredBundleIds[0],
    blockerKinds: Object.freeze(["source_observation_pending"] as const),
  });
}

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

export class KnowledgePluginStartupBarrier {
  private generation = 0;
  private activeRun?: { generation: number; controller: AbortController };
  private activeRecovery?: KnowledgePluginRecoveryStartupPort;
  private activeObservation?: {
    generation: number;
    port: KnowledgePluginObservationStartupPort;
  };
  private state: KnowledgePluginStartupState;
  private readonly listeners = new Set<KnowledgePluginStartupStateListener>();

  constructor(private readonly dependencies: KnowledgePluginStartupBarrierDependencies) {
    this.state = freezeStartupState({ generation: 0, status: "waiting_for_layout" });
    this.dependencies.studio.setUnavailable(this.state);
  }

  getState(): KnowledgePluginStartupState {
    return this.state;
  }

  subscribe(listener: KnowledgePluginStartupStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

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

  private isRuntimeAvailable(): boolean {
    try {
      return this.dependencies.runtime.isAvailable();
    } catch {
      return false;
    }
  }

  private isCurrent(generation: number, signal: AbortSignal): boolean {
    return (
      !signal.aborted && this.generation === generation && this.activeRun?.generation === generation
    );
  }

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

  private closeObservationSafelyFromResult(
    result: Extract<KnowledgePluginBundleConfigLoadResult, { kind: "configured" }>
  ): void {
    const observation = this.readObservationPort(result);
    if (observation && observation !== this.activeObservation?.port) {
      this.closeObservationSafely(observation);
    }
  }

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
      this.closeRecoverySession(recovery);
      this.closeObservationSafely(observation);
      if (this.isCurrent(generation, signal)) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_FAILED);
      }
      return;
    }

    if (!this.isCurrent(generation, signal)) {
      this.closeRecoverySession(recovery);
      this.closeObservationSafely(observation);
      return;
    }
    if (typeof result !== "object" || result === null || typeof result.kind !== "string") {
      this.closeRecoverySession(recovery);
      this.closeObservationSafely(observation);
      this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
      return;
    }
    if (result.kind === "observed_clear") {
      this.closeRecoverySession(recovery);
      const observationResult = observation
        ? await this.startObservation(generation, signal, bundleIds, observation)
        : "observed";
      if (observationResult === false) return;
      if (typeof observationResult === "object") {
        this.publish(
          generation,
          freezeStartupState({
            generation,
            status: "source_recovery_required",
            bundleIds,
            sourceRecoveryBundleId: observationResult.bundleId,
            blockerKinds: observationResult.blockerKinds,
          })
        );
        return;
      }
      this.publish(
        generation,
        freezeStartupState({
          generation,
          status:
            observationResult === "released"
              ? "workflow_read_ready"
              : "workflow_adapters_unavailable",
          bundleIds,
        })
      );
      return;
    }
    if (result.kind === "unavailable") {
      this.closeRecoverySession(recovery);
      this.closeObservationSafely(observation);
      const diagnosticCode = sanitizeRecoveryDiagnosticCode(result.diagnosticCode);
      this.publishRecoveryUnavailable(generation, bundleIds, diagnosticCode);
      return;
    }
    if (result.kind === "attention_required" || result.kind === "blocked") {
      this.closeObservationSafely(observation);
      const recoveryBundleId =
        result.recoveryBundleId ?? (bundleIds.length === 1 ? bundleIds[0] : undefined);
      if (
        !Array.isArray(result.attentionKinds) ||
        typeof recoveryBundleId !== "string" ||
        !bundleIds.includes(recoveryBundleId)
      ) {
        this.closeRecoverySession(recovery);
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return;
      }
      const attentionKinds = sanitizeAttentionKinds(result.attentionKinds);
      if (!attentionKinds) {
        this.closeRecoverySession(recovery);
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
          recoveryBundleId,
          attentionKinds,
        })
      );
      return;
    }
    this.closeRecoverySession(recovery);
    this.closeObservationSafely(observation);
    this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
  }

  private async startObservation(
    generation: number,
    signal: AbortSignal,
    bundleIds: readonly string[],
    observation: KnowledgePluginObservationStartupPort
  ): Promise<"observed" | "released" | KnowledgeSourceObservationRecoveryResult | false> {
    const session = { generation, port: observation };
    this.activeObservation = session;
    let result: KnowledgePluginObservationStartupResult;
    try {
      result = await observation.start(signal);
    } catch {
      this.closeObservationSession(session);
      if (this.isCurrent(generation, signal)) {
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_FAILED);
      }
      return false;
    }
    if (!this.isCurrent(generation, signal)) {
      this.closeObservationSession(session);
      return false;
    }
    const sourceRecovery = readSourceObservationRecoveryResult(result, bundleIds);
    if (sourceRecovery) {
      return sourceRecovery;
    }
    if (!isObservationConverged(result)) {
      this.closeObservationSession(session);
      this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
      return false;
    }
    if (typeof observation.release === "function") {
      let releaseResult: KnowledgePluginObservationReleaseResult;
      try {
        releaseResult = await observation.release(signal);
      } catch {
        this.closeObservationSession(session);
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_FAILED);
        return false;
      }
      if (releaseResult.kind !== "released") {
        this.closeObservationSession(session);
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return false;
      }
      const releasedBundleIds = sanitizeBundleIds(releaseResult.bundleIds);
      if (
        !releasedBundleIds ||
        releasedBundleIds.length !== bundleIds.length ||
        releasedBundleIds.some((bundleId, index) => bundleId !== bundleIds[index])
      ) {
        this.closeObservationSession(session);
        this.publishRecoveryUnavailable(generation, bundleIds, RECOVERY_RESULT_INVALID);
        return false;
      }
      return "released";
    }
    return "observed";
  }

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

  private closeActiveRecovery(): void {
    const recovery = this.activeRecovery;
    this.activeRecovery = undefined;
    if (recovery) {
      this.closeRecoverySafely(recovery);
    }
  }

  private closeRecoverySession(recovery: KnowledgePluginRecoveryStartupPort): void {
    if (this.activeRecovery !== recovery) return;
    this.activeRecovery = undefined;
    this.closeRecoverySafely(recovery);
  }

  private closeActiveObservation(): void {
    const session = this.activeObservation;
    this.activeObservation = undefined;
    if (session) {
      this.closeObservationSafely(session.port);
    }
  }

  private closeObservationSession(session: {
    generation: number;
    port: KnowledgePluginObservationStartupPort;
  }): void {
    if (this.activeObservation !== session) return;
    this.activeObservation = undefined;
    this.closeObservationSafely(session.port);
  }

  private closeObservationSafely(
    observation: KnowledgePluginObservationStartupPort | undefined
  ): void {
    if (!observation) return;
    try {
      observation.close();
    } catch {
      // Observation authority is already revoked by generation and signal checks.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }

  private closeRecoverySafely(recovery: KnowledgePluginRecoveryStartupPort): void {
    try {
      recovery.close();
    } catch {
      // Recovery publication authority is already revoked by generation and signal checks.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }

  private publish(generation: number, state: KnowledgePluginStartupState): void {
    if (generation !== this.generation) {
      return;
    }
    if (state.status === "workflow_read_ready") {
      this.dependencies.studio.setReadReady(state);
    } else if (state.status === "source_recovery_required") {
      if (this.dependencies.studio.setSourceRecoveryReady) {
        this.dependencies.studio.setSourceRecoveryReady(state);
      } else {
        this.dependencies.studio.setUnavailable(state);
      }
    } else if (
      state.status === "recovery_attention_required" ||
      state.status === "recovery_blocked"
    ) {
      if (this.dependencies.studio.setRecoveryReady) {
        this.dependencies.studio.setRecoveryReady(state);
      } else {
        this.dependencies.studio.setUnavailable(state);
      }
    } else {
      this.dependencies.studio.setUnavailable(state);
    }
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers are non-authoritative and cannot interrupt startup or one another.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
    }
  }
}
