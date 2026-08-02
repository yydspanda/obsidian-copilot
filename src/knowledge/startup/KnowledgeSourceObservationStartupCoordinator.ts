import type { VaultSourceWatcherStartupBlocker } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  isKnowledgeSourceObservationStartupError,
  KnowledgeSourceObservationStartupError,
  type KnowledgeSourceObservationStartupFailureCode,
  type KnowledgeSourceObservationStartupResult,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";

const MAX_STARTUP_BLOCKERS = 10_000;

/** Listener, crawl, and health surface owned by one production watcher generation. */
export interface KnowledgeSourceObservationStartupWatcherPort {
  /** Acquires every Vault listener without starting the initial crawl. */
  startListening(): void;
  /** Schedules one authoritative crawl of the current opaque watch plan. */
  scan(): number;
  /** Waits until every capture scheduled so far has settled. */
  waitForIdle(): Promise<void>;
  /** Returns authoritative content-free blockers for the current plan generation. */
  getStartupBlockers(): readonly Readonly<VaultSourceWatcherStartupBlocker>[];
  /** Synchronously invalidates listeners and all future capture stages. */
  close(): void;
}

/** Bound-observation recovery surface used on both sides of the full crawl. */
export interface KnowledgeSourceObservationStartupReconcilerPort {
  /** Replays byte-reproved bound work and reports work deferred to the crawl. */
  reconcile(signal: AbortSignal): Promise<KnowledgeSourceObservationStartupResult>;
  /** Synchronously invalidates exact-byte recovery. */
  close(): void;
}

/** Exact generation capabilities consumed by one observation-startup session. */
export interface KnowledgeSourceObservationStartupCoordinatorDependencies {
  watcher: KnowledgeSourceObservationStartupWatcherPort;
  reconciler: KnowledgeSourceObservationStartupReconcilerPort;
  /** Re-proves plugin, Runtime, plan, and preflight generation ownership. */
  assertCurrent(): void;
}

/** Stable diagnostic categories that never expose paths, bytes, tokens, or causes. */
export type KnowledgeSourceObservationStartupDiagnosticCode =
  | "dependency_invalid"
  | "listener_start_failed"
  | "crawl_failed"
  | "watcher_wait_failed"
  | "watcher_state_invalid"
  | `observation_recovery_${KnowledgeSourceObservationStartupFailureCode}`;

/** Sanitized observation result that carries no Queue-release authority. */
export type KnowledgeSourceObservationStartupCoordinatorResult =
  | Readonly<{
      kind: "observation_converged";
      scheduledCaptureCount: number;
    }>
  | Readonly<{
      kind: "blocked";
      blockerKinds: readonly (
        | VaultSourceWatcherStartupBlocker["kind"]
        | "source_observation_pending"
      )[];
    }>
  | Readonly<{
      kind: "diagnostic";
      code: KnowledgeSourceObservationStartupDiagnosticCode;
    }>;

/** Repeatable post-start proof returned without granting Queue or worker authority. */
export type KnowledgeSourceObservationStartupReproofResult =
  | Readonly<{
      kind: "observation_reproved";
    }>
  | Extract<KnowledgeSourceObservationStartupCoordinatorResult, { kind: "blocked" | "diagnostic" }>;

interface CapturedMethod {
  receiver: object;
  method: (...args: never[]) => unknown;
}

interface CapturedCoordinatorDependencies {
  watcher: {
    startListening(): void;
    scan(): unknown;
    waitForIdle(): Promise<unknown>;
    getStartupBlockers(): unknown;
    close(): void;
  };
  reconciler: {
    reconcile(signal: AbortSignal): Promise<unknown>;
    close(): void;
  };
  assertCurrent(): void;
}

/** Creates the platform-standard cancellation used for stale workflow generations. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Compares stable diagnostic categories without depending on the host locale. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Reads a required own data property without evaluating an accessor. */
function readOwnDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && descriptor.enumerable
    ? descriptor.value
    : undefined;
}

/** Captures a callable data method from an object or its finite prototype chain. */
function captureMethod(value: unknown, key: string): CapturedMethod | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  const receiver = value;
  let owner: object | null = receiver;
  const visited = new Set<object>();
  while (owner && owner !== Object.prototype && !visited.has(owner)) {
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "function"
        ? { receiver, method: descriptor.value as (...args: never[]) => unknown }
        : undefined;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

/** Invokes one captured zero-argument method. */
function callZero(method: CapturedMethod): unknown {
  return Reflect.apply(method.method, method.receiver, []);
}

/** Captures every dependency method once so later mutation cannot replace authority. */
function captureDependencies(
  dependencies: KnowledgeSourceObservationStartupCoordinatorDependencies
): CapturedCoordinatorDependencies {
  try {
    const watcherValue = readOwnDataProperty(dependencies, "watcher");
    const reconcilerValue = readOwnDataProperty(dependencies, "reconciler");
    const assertCurrent = captureMethod(dependencies, "assertCurrent");
    const startListening = captureMethod(watcherValue, "startListening");
    const scan = captureMethod(watcherValue, "scan");
    const waitForIdle = captureMethod(watcherValue, "waitForIdle");
    const getStartupBlockers = captureMethod(watcherValue, "getStartupBlockers");
    const closeWatcher = captureMethod(watcherValue, "close");
    const reconcile = captureMethod(reconcilerValue, "reconcile");
    const closeReconciler = captureMethod(reconcilerValue, "close");
    if (
      !assertCurrent ||
      !startListening ||
      !scan ||
      !waitForIdle ||
      !getStartupBlockers ||
      !closeWatcher ||
      !reconcile ||
      !closeReconciler
    ) {
      throw new TypeError("Invalid observation startup dependencies");
    }
    return Object.freeze({
      watcher: Object.freeze({
        startListening: () => {
          callZero(startListening);
        },
        scan: () => callZero(scan),
        waitForIdle: () => callZero(waitForIdle) as Promise<unknown>,
        getStartupBlockers: () => callZero(getStartupBlockers),
        close: () => {
          callZero(closeWatcher);
        },
      }),
      reconciler: Object.freeze({
        reconcile: (signal: AbortSignal) =>
          Reflect.apply(reconcile.method, reconcile.receiver, [signal]) as Promise<unknown>,
        close: () => {
          callZero(closeReconciler);
        },
      }),
      assertCurrent: () => {
        callZero(assertCurrent);
      },
    });
  } catch {
    throw new TypeError("Invalid observation startup dependencies");
  }
}

/** Reads an error name without invoking injected accessors. */
function readErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  let owner: object | null = error;
  const visited = new Set<object>();
  while (owner && !visited.has(owner)) {
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, "name");
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "string"
        ? descriptor.value
        : undefined;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

/** Tests whether an awaited port failed because its exact generation was cancelled. */
function isAbortError(error: unknown): boolean {
  return readErrorName(error) === "AbortError";
}

/** Validates a non-negative safe counter returned by an injected core. */
function isCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Copies and validates the reconciler's value-free aggregate result. */
function snapshotReconciliationResult(value: unknown): KnowledgeSourceObservationStartupResult {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
  }
  const keys = [
    "kind",
    "replayedBoundCount",
    "supersededBoundCount",
    "deferredAllocatedCount",
    "deferredDriftCount",
  ] as const;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
    }
    snapshot[key] = descriptor.value;
  }
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    snapshot.kind !== "reconciled" ||
    !isCounter(snapshot.replayedBoundCount) ||
    !isCounter(snapshot.supersededBoundCount) ||
    !isCounter(snapshot.deferredAllocatedCount) ||
    !isCounter(snapshot.deferredDriftCount)
  ) {
    throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
  }
  return Object.freeze({
    kind: "reconciled",
    replayedBoundCount: snapshot.replayedBoundCount,
    supersededBoundCount: snapshot.supersededBoundCount,
    deferredAllocatedCount: snapshot.deferredAllocatedCount,
    deferredDriftCount: snapshot.deferredDriftCount,
  });
}

/** Copies a dense bounded blocker array without retaining observer-owned values. */
function snapshotBlockerKinds(value: unknown): readonly VaultSourceWatcherStartupBlocker["kind"][] {
  if (!Array.isArray(value) || value.length > MAX_STARTUP_BLOCKERS) {
    throw new TypeError("Invalid watcher blocker snapshot");
  }
  const kinds = new Set<VaultSourceWatcherStartupBlocker["kind"]>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    const kind = readOwnDataProperty(descriptor.value, "kind");
    if (
      kind !== "capture_failed" &&
      kind !== "source_missing" &&
      kind !== "source_path_invalid" &&
      kind !== "source_change_unsupported"
    ) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    kinds.add(kind);
  }
  return Object.freeze([...kinds].sort(compareText));
}

/** Maps a branded reconciler failure into a stable coordinator diagnostic. */
function toRecoveryDiagnostic(
  error: KnowledgeSourceObservationStartupError
): KnowledgeSourceObservationStartupDiagnosticCode {
  return `observation_recovery_${error.code}`;
}

/**
 * Owns listener-first observation convergence without receiving Queue control.
 *
 * The first reconciliation may encounter state that the authoritative crawl can
 * supersede, so only the post-crawl reconciliation and watcher health snapshot
 * decide readiness. This class has no Release, worker, model, Review, or Wiki port.
 */
export class KnowledgeSourceObservationStartupCoordinator {
  private readonly dependencies: CapturedCoordinatorDependencies;
  private generation = 0;
  private started = false;
  private closed = false;
  private operationController?: AbortController;
  private callerSignal?: AbortSignal;
  private callerAbort?: () => void;
  private observationConverged = false;
  private sessionHealthy = false;
  private reproofInFlight = false;
  private healthCheckInProgress = false;

  /** Creates one generation-owned observation session without Queue authority. */
  constructor(dependencies: KnowledgeSourceObservationStartupCoordinatorDependencies) {
    this.dependencies = captureDependencies(dependencies);
  }

  /**
   * Runs listener → recovery → crawl → idle → final recovery in strict order.
   *
   * @param signal - Caller-owned plugin startup generation cancellation
   * @returns Observation readiness only; it never releases or runs a Queue
   */
  async start(signal: AbortSignal): Promise<KnowledgeSourceObservationStartupCoordinatorResult> {
    if (this.closed || this.started || signal.aborted) {
      throw createAbortError();
    }
    this.started = true;
    this.generation += 1;
    const generation = this.generation;
    const controller = new AbortController();
    this.operationController = controller;
    const abortOperation = (): void => {
      controller.abort();
      try {
        this.close();
      } catch {
        // Authority is already revoked; cleanup failures cannot revive this session.
      }
    };
    this.callerSignal = signal;
    this.callerAbort = abortOperation;
    signal.addEventListener("abort", abortOperation, { once: true });

    try {
      this.assertCurrent(generation, signal);
      try {
        this.dependencies.watcher.startListening();
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("listener_start_failed");
      }
      this.assertCurrent(generation, signal);

      try {
        snapshotReconciliationResult(
          await this.dependencies.reconciler.reconcile(controller.signal)
        );
      } catch (error) {
        this.assertCurrent(generation, signal);
        if (isAbortError(error)) {
          throw createAbortError();
        }
        if (
          isKnowledgeSourceObservationStartupError(error) &&
          error.code === "pipeline_fingerprint_changed"
        ) {
          // A successful crawl can supersede only this explicitly stale pipeline identity.
        } else if (isKnowledgeSourceObservationStartupError(error)) {
          return this.finishDiagnostic(toRecoveryDiagnostic(error));
        } else {
          return this.finishDiagnostic("observation_recovery_recovery_work_invalid");
        }
      }
      this.assertCurrent(generation, signal);

      let scheduledCaptureCount: number;
      try {
        const scheduled = this.dependencies.watcher.scan();
        this.assertCurrent(generation, signal);
        if (!isCounter(scheduled)) {
          return this.finishDiagnostic("watcher_state_invalid");
        }
        scheduledCaptureCount = scheduled;
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("crawl_failed");
      }
      this.assertCurrent(generation, signal);

      const waitFailure = await this.waitForWatcher(generation, signal);
      if (waitFailure) return waitFailure;

      let finalReconciliation: KnowledgeSourceObservationStartupResult;
      try {
        finalReconciliation = snapshotReconciliationResult(
          await this.dependencies.reconciler.reconcile(controller.signal)
        );
      } catch (error) {
        this.assertCurrent(generation, signal);
        if (isAbortError(error)) {
          throw createAbortError();
        }
        if (isKnowledgeSourceObservationStartupError(error)) {
          return this.finishDiagnostic(toRecoveryDiagnostic(error));
        }
        return this.finishDiagnostic("observation_recovery_recovery_work_invalid");
      }
      this.assertCurrent(generation, signal);

      const finalWaitFailure = await this.waitForWatcher(generation, signal);
      if (finalWaitFailure) return finalWaitFailure;

      let blockerKinds: readonly VaultSourceWatcherStartupBlocker["kind"][];
      try {
        blockerKinds = snapshotBlockerKinds(this.dependencies.watcher.getStartupBlockers());
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("watcher_state_invalid");
      }
      this.assertCurrent(generation, signal);
      if (blockerKinds.length > 0) {
        return this.finishBlocked(blockerKinds);
      }
      if (
        finalReconciliation.deferredAllocatedCount > 0 ||
        finalReconciliation.deferredDriftCount > 0
      ) {
        const blockerKinds: readonly "source_observation_pending"[] = Object.freeze([
          "source_observation_pending",
        ]);
        return this.finishBlocked(blockerKinds);
      }
      this.observationConverged = true;
      this.sessionHealthy = true;
      return Object.freeze({
        kind: "observation_converged",
        scheduledCaptureCount,
      });
    } catch {
      try {
        this.close();
      } catch {
        // Authority is already revoked; cleanup failures cannot expose injected details.
      }
      throw createAbortError();
    } finally {
      if (this.operationController === controller) {
        this.operationController = undefined;
      }
    }
  }

  /**
   * Re-proves current captures, durable observations, and watcher blockers.
   *
   * Reproof is available only after the exact startup signal produced the first
   * converged result. Calls are one-at-a-time; a mismatched, aborted, concurrent,
   * or stale call permanently invalidates the session rather than transferring
   * its authority to another lifecycle.
   *
   * @param signal - Exact caller signal retained by the successful startup run
   * @returns A fresh health result carrying no Queue-release or worker authority
   */
  async reprove(signal: AbortSignal): Promise<KnowledgeSourceObservationStartupReproofResult> {
    if (
      this.closed ||
      !this.started ||
      !this.observationConverged ||
      !this.sessionHealthy ||
      this.reproofInFlight ||
      this.healthCheckInProgress ||
      signal !== this.callerSignal ||
      signal.aborted
    ) {
      this.closeSafely();
      throw createAbortError();
    }

    this.reproofInFlight = true;
    this.sessionHealthy = false;
    this.generation += 1;
    const generation = this.generation;
    const controller = new AbortController();
    this.operationController = controller;

    try {
      this.assertCurrent(generation, signal);
      const firstWaitFailure = await this.waitForWatcher(generation, signal);
      if (firstWaitFailure) return firstWaitFailure;

      let reconciliation: KnowledgeSourceObservationStartupResult;
      try {
        reconciliation = snapshotReconciliationResult(
          await this.dependencies.reconciler.reconcile(controller.signal)
        );
      } catch (error) {
        this.assertCurrent(generation, signal);
        if (isAbortError(error)) {
          throw createAbortError();
        }
        if (isKnowledgeSourceObservationStartupError(error)) {
          return this.finishDiagnostic(toRecoveryDiagnostic(error));
        }
        return this.finishDiagnostic("observation_recovery_recovery_work_invalid");
      }
      this.assertCurrent(generation, signal);

      const finalWaitFailure = await this.waitForWatcher(generation, signal);
      if (finalWaitFailure) return finalWaitFailure;

      let blockerKinds: readonly VaultSourceWatcherStartupBlocker["kind"][];
      try {
        blockerKinds = snapshotBlockerKinds(this.dependencies.watcher.getStartupBlockers());
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("watcher_state_invalid");
      }
      this.assertCurrent(generation, signal);
      if (blockerKinds.length > 0) {
        return this.finishBlocked(blockerKinds);
      }
      if (reconciliation.deferredAllocatedCount > 0 || reconciliation.deferredDriftCount > 0) {
        return this.finishBlocked(Object.freeze(["source_observation_pending"]));
      }

      this.sessionHealthy = true;
      return Object.freeze({ kind: "observation_reproved" });
    } catch {
      this.closeSafely();
      throw createAbortError();
    } finally {
      if (this.operationController === controller) {
        this.operationController = undefined;
      }
      this.reproofInFlight = false;
    }
  }

  /**
   * Synchronously proves that the converged session is still current and blocker-free.
   *
   * This method deliberately returns no transferable token. A failed proof closes
   * the whole session, so a caller cannot retain an earlier successful observation
   * after a rename, delete, lifecycle replacement, or concurrent reproof.
   */
  assertHealthy(): void {
    if (
      this.closed ||
      !this.started ||
      !this.observationConverged ||
      !this.sessionHealthy ||
      this.reproofInFlight ||
      this.healthCheckInProgress ||
      !this.callerSignal ||
      this.callerSignal.aborted
    ) {
      this.closeSafely();
      throw createAbortError();
    }

    this.healthCheckInProgress = true;
    const generation = this.generation;
    const signal = this.callerSignal;
    try {
      this.assertCurrent(generation, signal);
      const blockerKinds = snapshotBlockerKinds(this.dependencies.watcher.getStartupBlockers());
      this.assertCurrent(generation, signal);
      if (blockerKinds.length > 0) {
        throw createAbortError();
      }
    } catch {
      this.closeSafely();
      throw createAbortError();
    } finally {
      this.healthCheckInProgress = false;
    }
  }

  /** Synchronously invalidates listener, crawl, and recovery continuations exactly once. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.sessionHealthy = false;
    this.generation += 1;
    this.operationController?.abort();
    if (this.callerSignal && this.callerAbort) {
      this.callerSignal.removeEventListener("abort", this.callerAbort);
    }
    this.callerSignal = undefined;
    this.callerAbort = undefined;
    try {
      this.dependencies.watcher.close();
    } finally {
      this.dependencies.reconciler.close();
    }
  }

  /** Waits for current watcher work and sanitizes only non-cancellation failures. */
  private async waitForWatcher(
    generation: number,
    signal: AbortSignal
  ): Promise<
    Extract<KnowledgeSourceObservationStartupCoordinatorResult, { kind: "diagnostic" }> | undefined
  > {
    try {
      await this.dependencies.watcher.waitForIdle();
    } catch (error) {
      this.assertCurrent(generation, signal);
      if (isAbortError(error)) {
        throw createAbortError();
      }
      return this.finishDiagnostic("watcher_wait_failed");
    }
    this.assertCurrent(generation, signal);
    return undefined;
  }

  /** Revokes an unusable session before publishing one sanitized diagnostic. */
  private finishDiagnostic(
    code: KnowledgeSourceObservationStartupDiagnosticCode
  ): Extract<KnowledgeSourceObservationStartupCoordinatorResult, { kind: "diagnostic" }> {
    try {
      this.close();
    } catch {
      // Revocation is already monotonic; cleanup failures cannot change the diagnostic.
    }
    return Object.freeze({ kind: "diagnostic", code });
  }

  /** Revokes a permanently blocked generation after snapshotting its safe reasons. */
  private finishBlocked(
    blockerKinds: readonly (
      | VaultSourceWatcherStartupBlocker["kind"]
      | "source_observation_pending"
    )[]
  ): Extract<KnowledgeSourceObservationStartupCoordinatorResult, { kind: "blocked" }> {
    const result = Object.freeze({
      kind: "blocked" as const,
      blockerKinds: Object.freeze([...blockerKinds]),
    });
    this.closeSafely();
    return result;
  }

  /** Closes authority without allowing cleanup failure to escape a safe result. */
  private closeSafely(): void {
    try {
      this.close();
    } catch {
      // Local generation and health are already invalid before dependency cleanup.
    }
  }

  /** Checks only coordinator-owned lifecycle state without invoking an external port. */
  private assertLocalCurrent(generation: number, signal: AbortSignal): void {
    if (
      this.closed ||
      this.generation !== generation ||
      signal !== this.callerSignal ||
      signal.aborted ||
      this.operationController?.signal.aborted
    ) {
      throw createAbortError();
    }
  }

  /** Re-proves local, caller, and plugin lifecycle ownership around every boundary. */
  private assertCurrent(generation: number, signal: AbortSignal): void {
    this.assertLocalCurrent(generation, signal);
    this.dependencies.assertCurrent();
    this.assertLocalCurrent(generation, signal);
  }
}

Object.freeze(KnowledgeSourceObservationStartupCoordinator.prototype);
Object.freeze(KnowledgeSourceObservationStartupCoordinator);
