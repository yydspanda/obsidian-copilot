import type {
  VaultSourceWatcherRecoverableIssue,
  VaultSourceWatcherStartupBlocker,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import {
  isKnowledgeSourceObservationStartupError,
  KnowledgeSourceObservationStartupError,
  type KnowledgeSourceObservationStartupFailureCode,
  type KnowledgeSourceObservationStartupResult,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";

const MAX_STARTUP_BLOCKERS = 10_000;
const EMPTY_SOURCE_ISSUES: readonly Readonly<VaultSourceWatcherRecoverableIssue>[] = Object.freeze(
  []
);

/** Recoverable source state exposed without transferring watcher authority. */
export type KnowledgeSourceObservationRecoverableIssue =
  Readonly<VaultSourceWatcherRecoverableIssue>;

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
  /** Subscribes one Bundle to coalesced recoverable source-issue changes. */
  subscribeSourceIssueChanges(bundleId: string, listener: () => void): () => void;
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
    subscribeSourceIssueChanges(bundleId: string, listener: () => void): unknown;
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
    const subscribeSourceIssueChanges = captureMethod(watcherValue, "subscribeSourceIssueChanges");
    const closeWatcher = captureMethod(watcherValue, "close");
    const reconcile = captureMethod(reconcilerValue, "reconcile");
    const closeReconciler = captureMethod(reconcilerValue, "close");
    if (
      !assertCurrent ||
      !startListening ||
      !scan ||
      !waitForIdle ||
      !getStartupBlockers ||
      !subscribeSourceIssueChanges ||
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
        subscribeSourceIssueChanges: (bundleId: string, listener: () => void): unknown =>
          Reflect.apply(subscribeSourceIssueChanges.method, subscribeSourceIssueChanges.receiver, [
            bundleId,
            listener,
          ]) as unknown,
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

/** Copies exact enumerable data properties without invoking accessors. */
function snapshotExactDataProperties(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Reflect.ownKeys(value).length !== keys.length
  ) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/** Tests one opaque Bundle or source identifier at the startup boundary. */
function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Copies one strict blocker object without retaining observer-owned values. */
function snapshotStartupBlocker(value: unknown): Readonly<VaultSourceWatcherStartupBlocker> {
  const kind = readOwnDataProperty(value, "kind");
  if (kind === "capture_failed") {
    const snapshot = snapshotExactDataProperties(value, ["kind", "stage", "bundleId", "sourceId"]);
    if (
      !snapshot ||
      (snapshot.stage !== "prepare" &&
        snapshot.stage !== "allocate" &&
        snapshot.stage !== "read" &&
        snapshot.stage !== "commit") ||
      !isOpaqueIdentifier(snapshot.bundleId) ||
      !isOpaqueIdentifier(snapshot.sourceId)
    ) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    return Object.freeze({
      kind,
      stage: snapshot.stage,
      bundleId: snapshot.bundleId,
      sourceId: snapshot.sourceId,
    });
  }
  if (kind === "source_missing") {
    const snapshot = snapshotExactDataProperties(value, ["kind", "bundleId", "sourceId"]);
    if (
      !snapshot ||
      !isOpaqueIdentifier(snapshot.bundleId) ||
      !isOpaqueIdentifier(snapshot.sourceId)
    ) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    return Object.freeze({
      kind,
      bundleId: snapshot.bundleId,
      sourceId: snapshot.sourceId,
    });
  }
  if (kind === "source_path_invalid") {
    const snapshot = snapshotExactDataProperties(value, ["kind", "reason", "bundleId", "sourceId"]);
    if (
      !snapshot ||
      (snapshot.reason !== "case_mismatch" && snapshot.reason !== "windows_collision") ||
      !isOpaqueIdentifier(snapshot.bundleId) ||
      !isOpaqueIdentifier(snapshot.sourceId)
    ) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    return Object.freeze({
      kind,
      reason: snapshot.reason,
      bundleId: snapshot.bundleId,
      sourceId: snapshot.sourceId,
    });
  }
  if (kind === "source_change_unsupported") {
    const snapshot = snapshotExactDataProperties(value, ["kind", "change", "bundleId", "sourceId"]);
    if (
      !snapshot ||
      (snapshot.change !== "delete" && snapshot.change !== "rename") ||
      !isOpaqueIdentifier(snapshot.bundleId) ||
      !isOpaqueIdentifier(snapshot.sourceId)
    ) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    return Object.freeze({
      kind,
      change: snapshot.change,
      bundleId: snapshot.bundleId,
      sourceId: snapshot.sourceId,
    });
  }
  throw new TypeError("Invalid watcher blocker snapshot");
}

/** Copies a dense bounded blocker array without retaining observer-owned values. */
function snapshotStartupBlockers(
  value: unknown
): readonly Readonly<VaultSourceWatcherStartupBlocker>[] {
  if (
    !Array.isArray(value) ||
    !Number.isSafeInteger(value.length) ||
    value.length > MAX_STARTUP_BLOCKERS
  ) {
    throw new TypeError("Invalid watcher blocker snapshot");
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError("Invalid watcher blocker snapshot");
  }
  const blockers: Readonly<VaultSourceWatcherStartupBlocker>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Invalid watcher blocker snapshot");
    }
    blockers.push(snapshotStartupBlocker(descriptor.value));
  }
  return Object.freeze(
    blockers.sort(
      (left, right) =>
        compareText(left.bundleId, right.bundleId) ||
        compareText(left.sourceId, right.sourceId) ||
        compareText(left.kind, right.kind) ||
        compareText(
          "stage" in left
            ? left.stage
            : "reason" in left
              ? left.reason
              : "change" in left
                ? left.change
                : "",
          "stage" in right
            ? right.stage
            : "reason" in right
              ? right.reason
              : "change" in right
                ? right.change
                : ""
        )
    )
  );
}

/** Selects deduplicated fatal blocker kinds from one strict snapshot. */
function snapshotFatalBlockerKinds(
  blockers: readonly Readonly<VaultSourceWatcherStartupBlocker>[]
): readonly ("capture_failed" | "source_path_invalid")[] {
  const kinds = new Set<"capture_failed" | "source_path_invalid">();
  for (const blocker of blockers) {
    if (blocker.kind === "capture_failed" || blocker.kind === "source_path_invalid") {
      kinds.add(blocker.kind);
    }
  }
  return Object.freeze([...kinds].sort(compareText));
}

/** Selects recoverable issues from one already detached strict snapshot. */
function snapshotRecoverableSourceIssues(
  blockers: readonly Readonly<VaultSourceWatcherStartupBlocker>[]
): readonly KnowledgeSourceObservationRecoverableIssue[] {
  return Object.freeze(
    blockers.filter(
      (blocker): blocker is KnowledgeSourceObservationRecoverableIssue =>
        blocker.kind === "source_missing" || blocker.kind === "source_change_unsupported"
    )
  );
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
  private sourceRecoveryClassificationOpen = false;
  private sourceIssues: readonly KnowledgeSourceObservationRecoverableIssue[] = EMPTY_SOURCE_ISSUES;

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

      let blockers: readonly Readonly<VaultSourceWatcherStartupBlocker>[];
      try {
        blockers = snapshotStartupBlockers(this.dependencies.watcher.getStartupBlockers());
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("watcher_state_invalid");
      }
      this.assertCurrent(generation, signal);
      this.sourceIssues = snapshotRecoverableSourceIssues(blockers);
      const fatalBlockerKinds = snapshotFatalBlockerKinds(blockers);
      if (fatalBlockerKinds.length > 0) {
        return this.finishBlocked(fatalBlockerKinds);
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

      let blockers: readonly Readonly<VaultSourceWatcherStartupBlocker>[];
      try {
        blockers = snapshotStartupBlockers(this.dependencies.watcher.getStartupBlockers());
      } catch {
        this.assertCurrent(generation, signal);
        return this.finishDiagnostic("watcher_state_invalid");
      }
      this.assertCurrent(generation, signal);
      this.sourceIssues = snapshotRecoverableSourceIssues(blockers);
      const fatalBlockerKinds = snapshotFatalBlockerKinds(blockers);
      if (fatalBlockerKinds.length > 0) {
        return this.finishBlocked(fatalBlockerKinds);
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
   * Synchronously proves that the converged session is current and fatal-blocker-free.
   *
   * This method deliberately returns no transferable token. A failed proof closes
   * the whole session, so a caller cannot retain an earlier successful observation
   * after a fatal capture/path failure, lifecycle replacement, or concurrent reproof.
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
      const blockers = snapshotStartupBlockers(this.dependencies.watcher.getStartupBlockers());
      this.assertCurrent(generation, signal);
      this.sourceIssues = snapshotRecoverableSourceIssues(blockers);
      if (snapshotFatalBlockerKinds(blockers).length > 0) {
        throw createAbortError();
      }
    } catch {
      this.closeSafely();
      throw createAbortError();
    } finally {
      this.healthCheckInProgress = false;
    }
  }

  /**
   * Returns a detached read-only snapshot of currently recoverable source issues.
   *
   * The synchronous health proof refreshes the snapshot first and closes the
   * session if watcher state is malformed, fatal, or no longer current.
   *
   * @returns Strict source issues for a consumer-owned presentation model
   */
  getSourceIssues(): readonly KnowledgeSourceObservationRecoverableIssue[] {
    this.assertHealthy();
    return this.sourceIssues;
  }

  /**
   * Returns the recoverable issue snapshot retained only for immediate startup classification.
   *
   * This narrow read is available after the exact singleton observation-pending
   * result and before the production composer closes the coordinator. It does
   * not make the blocked session healthy or eligible for reproof/release.
   *
   * @returns Frozen path-free issues, or undefined for every other blocked result
   */
  getSourceRecoveryClassificationIssues():
    | readonly KnowledgeSourceObservationRecoverableIssue[]
    | undefined {
    if (!this.sourceRecoveryClassificationOpen) return undefined;
    if (this.closed || !this.started || !this.callerSignal) {
      throw createAbortError();
    }
    const generation = this.generation;
    const signal = this.callerSignal;
    this.assertCurrent(generation, signal);
    return this.sourceIssues;
  }

  /**
   * Subscribes one Bundle to value-free recoverable source-issue changes.
   *
   * @param bundleId - Exact Bundle identity owned by this watcher generation
   * @param listener - Best-effort reload callback
   * @returns Idempotent cleanup for this generation-owned subscription
   */
  subscribeSourceIssueChanges(bundleId: string, listener: () => void): () => void {
    this.assertHealthy();
    if (!isOpaqueIdentifier(bundleId) || typeof listener !== "function" || !this.callerSignal) {
      throw createAbortError();
    }
    const generation = this.generation;
    const signal = this.callerSignal;
    this.assertCurrent(generation, signal);
    let active = true;
    let unsubscribe: unknown;
    const guardedListener = (): void => {
      if (!active) return;
      try {
        this.assertCurrent(generation, signal);
      } catch {
        return;
      }
      try {
        listener();
      } catch {
        // Presentation listeners cannot affect observation authority.
      }
    };
    try {
      unsubscribe = this.dependencies.watcher.subscribeSourceIssueChanges(
        bundleId,
        guardedListener
      );
      this.assertCurrent(generation, signal);
      if (typeof unsubscribe !== "function") throw createAbortError();
    } catch {
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch {
          // A failed subscription never became presentation authority.
        }
      }
      throw createAbortError();
    }
    return () => {
      if (!active) return;
      active = false;
      try {
        (unsubscribe as () => void)();
      } catch {
        // The value-free subscription is already detached locally.
      }
    };
  }

  /** Synchronously invalidates listener, crawl, and recovery continuations exactly once. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.sessionHealthy = false;
    this.sourceRecoveryClassificationOpen = false;
    this.sourceIssues = EMPTY_SOURCE_ISSUES;
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

  /** Retains only exact source-recovery evidence until its composer snapshots and closes it. */
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
    if (
      blockerKinds.length === 1 &&
      blockerKinds[0] === "source_observation_pending" &&
      this.sourceIssues.length > 0
    ) {
      this.sourceRecoveryClassificationOpen = true;
      return result;
    }
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
