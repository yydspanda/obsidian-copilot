import type { App } from "obsidian";

import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeSourceExecutionPlan,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import {
  IngestQueue,
  type EnqueueIngestRequest,
  type IngestExecutor,
  type IngestExecutionContext,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  ObsidianExactSourceArtifactReader,
  ObsidianVaultSourceWatcher,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { SourceObservationHandoff } from "@/knowledge/ingest/SourceObservationHandoff";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgePluginProductionWorkflowLease } from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import {
  KnowledgeSourceObservationStartupCoordinator,
  type KnowledgeSourceObservationStartupCoordinatorResult,
  type KnowledgeSourceObservationStartupReproofResult,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";
import { KnowledgeSourceObservationStartupReconciler } from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";
import { KnowledgeProductionWorkerSession } from "@/knowledge/startup/KnowledgeProductionWorkerSession";

/** Exact production resources consumed by one observation-only workflow generation. */
export interface KnowledgeProductionObservationComposerInput {
  /** App/Vault lifecycle owner used for exact source and schema reads. */
  app: App;
  /** Already initialized shared atomic Runtime envelope. */
  runtime: KnowledgeRuntimeStore;
  /** Same-snapshot, secret-free capability minted by production preflight. */
  workflowLease: KnowledgePluginProductionWorkflowLease;
}

/** Stable composition failures that never expose paths, settings, bytes, or causes. */
export type KnowledgeProductionObservationDiagnosticCode =
  | "dependency_invalid"
  | "workflow_plan_unavailable"
  | "observation_session_unavailable";

/** Sanitized production observation result with no Queue execution or release authority. */
export type KnowledgeProductionObservationResult =
  | KnowledgeSourceObservationStartupCoordinatorResult
  | Readonly<{
      kind: "diagnostic";
      code: KnowledgeProductionObservationDiagnosticCode;
    }>;

/** Sanitized repeatable health proof retained inside the same live watcher session. */
export type KnowledgeProductionObservationReproofResult =
  | KnowledgeSourceObservationStartupReproofResult
  | Readonly<{
      kind: "diagnostic";
      code: KnowledgeProductionObservationDiagnosticCode;
    }>;

/** Execution boundary deliberately unavailable to an observation-only Queue controller. */
class KnowledgeObservationExecutionUnavailableError extends Error {
  /** Creates a value-free failure for any accidental attempt to claim Queue work. */
  constructor() {
    super("The Knowledge observation generation cannot execute Queue work");
    this.name = "KnowledgeObservationExecutionUnavailableError";
  }
}

/** Queue executor that makes the startup-held Queue incapable of running work. */
class StartupHeldObservationIngestExecutor {
  private executor?: IngestExecutor;

  /** Rejects every accidental execution attempt without inspecting its context. */
  async execute(context: IngestExecutionContext) {
    if (!this.executor) throw new KnowledgeObservationExecutionUnavailableError();
    return this.executor.execute(context);
  }

  /** Installs one explicit executor after the caller has proved worker readiness. */
  setExecutor(executor: IngestExecutor): void {
    if (this.executor || typeof executor?.execute !== "function") {
      throw new KnowledgeObservationExecutionUnavailableError();
    }
    this.executor = executor;
  }
}

interface KnowledgeProductionObservationComposition {
  app: App;
  workflowLease: KnowledgePluginProductionWorkflowLease;
  loader: KnowledgeSourceWorkflowPlanLoader;
  owners: ReturnType<KnowledgePluginProductionWorkflowLease["getOwners"]>;
  artifactReader: ObsidianExactSourceArtifactReader;
  handoffs: ReadonlyMap<string, SourceObservationHandoff>;
  queue: IngestQueue;
  heldExecutor: StartupHeldObservationIngestExecutor;
}

interface KnowledgeProductionObservationInternalState {
  generation: number;
  closed: boolean;
  started: boolean;
  composition?: KnowledgeProductionObservationComposition;
  compositionFailure?: KnowledgeProductionObservationDiagnosticCode;
  coordinator?: KnowledgeSourceObservationStartupCoordinator;
  lastResult?: KnowledgeProductionObservationResult | KnowledgeProductionObservationReproofResult;
  unsubscribeLease?: () => void;
}

const composerStates = new WeakMap<object, KnowledgeProductionObservationInternalState>();

/** Creates the platform-standard cancellation used for stale workflow generations. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reads one required enumerable data property without evaluating an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new TypeError("Invalid production observation input");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Invalid production observation input");
  }
  return descriptor.value;
}

/** Returns hidden mutable state only for an authentic composer instance. */
function requireComposerState(value: unknown): KnowledgeProductionObservationInternalState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The production observation composer is invalid");
  }
  const state = composerStates.get(value);
  if (!state) {
    throw new TypeError("The production observation composer is invalid");
  }
  return state;
}

/** Creates one fixed frozen diagnostic without retaining a lower-level failure. */
function createDiagnostic(
  code: KnowledgeProductionObservationDiagnosticCode
): Extract<KnowledgeProductionObservationResult, { kind: "diagnostic" }> {
  return Object.freeze({ kind: "diagnostic" as const, code });
}

/** Reports whether exact composer and preflight ownership remain current. */
function isCompositionCurrent(
  state: KnowledgeProductionObservationInternalState,
  generation: number,
  composition: KnowledgeProductionObservationComposition
): boolean {
  if (
    state.closed ||
    state.generation !== generation ||
    state.composition !== composition ||
    !composition.workflowLease.isCurrent()
  ) {
    return false;
  }
  return true;
}

/** Throws when either the composer generation or its preflight lease is stale. */
function assertCompositionCurrent(
  state: KnowledgeProductionObservationInternalState,
  generation: number,
  composition: KnowledgeProductionObservationComposition,
  signal?: AbortSignal
): void {
  if (signal?.aborted || !isCompositionCurrent(state, generation, composition)) {
    throw createAbortError();
  }
  composition.workflowLease.assertCurrent();
  if (signal?.aborted || !isCompositionCurrent(state, generation, composition)) {
    throw createAbortError();
  }
}

/** Builds exact Runtime, Manifest, reader, loader, and enqueue-only observation ports. */
function composeObservation(
  owner: KnowledgeProductionObservationComposer,
  input: KnowledgeProductionObservationComposerInput,
  state: KnowledgeProductionObservationInternalState
): KnowledgeProductionObservationComposition {
  const app = readDataProperty(input, "app");
  const runtime = readDataProperty(input, "runtime");
  const workflowLease = readDataProperty(input, "workflowLease");
  if (typeof app !== "object" || app === null || !(runtime instanceof KnowledgeRuntimeStore)) {
    throw new TypeError("Invalid production observation dependencies");
  }
  KnowledgePluginProductionWorkflowLease.assert(workflowLease);
  workflowLease.assertCurrent();

  const owners = workflowLease.getOwners();
  const parsers = workflowLease.getParsers();
  const executionOwner = createKnowledgeExecutionOwner();
  const queueStorage = new KnowledgeRuntimeQueueStorage(runtime, executionOwner);
  const heldExecutor = new StartupHeldObservationIngestExecutor();
  const queue = new IngestQueue(queueStorage, heldExecutor);
  const enqueueOnly = Object.freeze({
    enqueue: (request: EnqueueIngestRequest) => queue.enqueue(request),
  });
  const allocator = new KnowledgeRuntimeInputRevisionAllocator(runtime);
  const binder = new KnowledgeRuntimeInputObservationBinder(runtime);
  const handoffs = new Map<string, SourceObservationHandoff>();
  for (const { config } of owners) {
    if (handoffs.has(config.id)) {
      throw new TypeError("Duplicate production observation Bundle");
    }
    handoffs.set(config.id, new SourceObservationHandoff(allocator, binder, enqueueOnly));
  }

  const artifactReader = new ObsidianExactSourceArtifactReader(app as App);
  const manifest = new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(runtime));
  let composition!: KnowledgeProductionObservationComposition;
  const loader = new KnowledgeSourceWorkflowPlanLoader({
    executionOwner,
    manifest,
    artifactReader,
    pipelineProfile: workflowLease,
    parsers,
    generation: {
      isCurrent: () =>
        composition !== undefined &&
        isCompositionCurrent(requireComposerState(owner), state.generation, composition),
    },
  });
  composition = Object.freeze({
    app: app as App,
    workflowLease,
    loader,
    owners,
    artifactReader,
    handoffs,
    queue,
    heldExecutor,
  });
  workflowLease.assertCurrent();
  return composition;
}

/** Creates and installs the watcher/reconciler/coordinator for one authenticated plan. */
function createObservationCoordinator(
  state: KnowledgeProductionObservationInternalState,
  generation: number,
  composition: KnowledgeProductionObservationComposition,
  plan: KnowledgeSourceExecutionPlan
): KnowledgeSourceObservationStartupCoordinator {
  const watcher = new ObsidianVaultSourceWatcher(
    composition.app,
    plan.getWatchPlan(),
    composition.handoffs,
    { artifactReader: composition.artifactReader }
  );
  const reconciler = new KnowledgeSourceObservationStartupReconciler({
    watchPlan: plan.getWatchPlan(),
    artifactReader: composition.artifactReader,
    handoffs: composition.handoffs,
  });
  return new KnowledgeSourceObservationStartupCoordinator({
    watcher,
    reconciler,
    assertCurrent: () => assertCompositionCurrent(state, generation, composition),
  });
}

/** Closes a retained observation coordinator without exposing cleanup failures. */
function closeCoordinator(state: KnowledgeProductionObservationInternalState): void {
  const coordinator = state.coordinator;
  state.coordinator = undefined;
  if (!coordinator) return;
  try {
    coordinator.close();
  } catch {
    // Publication authority is already revoked before cleanup is attempted.
  }
}

/**
 * Owns one production observation generation without exposing Queue execution.
 *
 * The composer retains the listener after initial convergence so later startup
 * phases can repeatedly quiesce and re-prove health. It has no Release, model,
 * Review decision, transaction preparation, or Wiki mutation capability.
 */
export class KnowledgeProductionObservationComposer {
  /** Captures one exact Runtime/App/preflight generation and installs synchronous revocation. */
  constructor(input: KnowledgeProductionObservationComposerInput) {
    const state: KnowledgeProductionObservationInternalState = {
      generation: 1,
      closed: false,
      started: false,
    };
    composerStates.set(this, state);
    try {
      const composition = composeObservation(this, input, state);
      state.composition = composition;
      const unsubscribe = composition.workflowLease.subscribeInvalidation(() => this.close());
      if (state.closed) {
        unsubscribe();
      } else {
        state.unsubscribeLease = unsubscribe;
      }
    } catch {
      state.compositionFailure = "dependency_invalid";
      state.composition = undefined;
    }
    Object.freeze(this);
  }

  /**
   * Loads one double-collected workflow plan and converges durable observations.
   *
   * @param signal - Caller-owned startup generation signal retained for session lifetime
   * @returns Sanitized observation convergence, blocker, or fixed diagnostic
   */
  async start(signal: AbortSignal): Promise<KnowledgeProductionObservationResult> {
    const state = requireComposerState(this);
    if (state.closed || state.started || signal.aborted) {
      throw createAbortError();
    }
    state.started = true;
    const generation = state.generation;
    const composition = state.composition;
    if (!composition) {
      const diagnostic = createDiagnostic(state.compositionFailure ?? "dependency_invalid");
      state.lastResult = diagnostic;
      return diagnostic;
    }

    let phase: "plan" | "observation" = "plan";
    try {
      assertCompositionCurrent(state, generation, composition, signal);
      const plan = await composition.loader.load(composition.owners, signal);
      assertCompositionCurrent(state, generation, composition, signal);
      phase = "observation";
      const coordinator = createObservationCoordinator(state, generation, composition, plan);
      state.coordinator = coordinator;
      assertCompositionCurrent(state, generation, composition, signal);
      const result = await coordinator.start(signal);
      assertCompositionCurrent(state, generation, composition, signal);
      state.lastResult = result;
      if (result.kind !== "observation_converged") {
        closeCoordinator(state);
      }
      return result;
    } catch {
      if (
        signal.aborted ||
        !isCompositionCurrent(state, generation, composition) ||
        state.coordinator !== undefined
      ) {
        this.close();
        throw createAbortError();
      }
      closeCoordinator(state);
      const diagnostic = createDiagnostic(
        phase === "plan" ? "workflow_plan_unavailable" : "observation_session_unavailable"
      );
      state.lastResult = diagnostic;
      return diagnostic;
    }
  }

  /**
   * Quiesces live captures and re-proves observation health after initial convergence.
   *
   * @param signal - Exact current startup/session signal
   * @returns Sanitized current observation health
   */
  async reprove(signal: AbortSignal): Promise<KnowledgeProductionObservationReproofResult> {
    const state = requireComposerState(this);
    const composition = state.composition;
    const coordinator = state.coordinator;
    const generation = state.generation;
    if (!composition || !coordinator || signal.aborted) {
      throw createAbortError();
    }
    assertCompositionCurrent(state, generation, composition, signal);
    try {
      const result = await coordinator.reprove(signal);
      assertCompositionCurrent(state, generation, composition, signal);
      state.lastResult = result;
      if (result.kind !== "observation_reproved") {
        closeCoordinator(state);
      }
      return result;
    } catch {
      this.close();
      throw createAbortError();
    }
  }

  /** Synchronously proves that the retained live watcher session is still healthy and current. */
  assertHealthy(): void {
    const state = requireComposerState(this);
    const composition = state.composition;
    const coordinator = state.coordinator;
    if (!composition || !coordinator || !state.lastResult) {
      throw createAbortError();
    }
    try {
      assertCompositionCurrent(state, state.generation, composition);
      coordinator.assertHealthy();
      assertCompositionCurrent(state, state.generation, composition);
    } catch {
      this.close();
      throw createAbortError();
    }
  }

  /** Binds one explicit executor to the exact released Queue and returns a bounded worker. */
  createWorkerSession(
    executor: IngestExecutor,
    isReleased: () => boolean
  ): KnowledgeProductionWorkerSession {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || !state.coordinator || !state.lastResult) {
      throw createAbortError();
    }
    if (
      state.lastResult.kind !== "observation_converged" &&
      state.lastResult.kind !== "observation_reproved"
    ) {
      throw createAbortError();
    }
    if (typeof isReleased !== "function") {
      throw createAbortError();
    }
    composition.heldExecutor.setExecutor(executor);
    return new KnowledgeProductionWorkerSession({
      queue: composition.queue,
      bundleIds: composition.owners.map(({ config }) => config.id),
      isReleased,
      assertCurrent: () => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      },
    });
  }

  /** Synchronously closes listeners and invalidates all future plan/capture continuations. */
  close(): void {
    const state = composerStates.get(this);
    if (!state || state.closed) return;
    state.closed = true;
    state.generation += 1;
    state.composition = undefined;
    const unsubscribe = state.unsubscribeLease;
    state.unsubscribeLease = undefined;
    try {
      unsubscribe?.();
    } catch {
      // The local generation is already revoked; unsubscribe cannot revive it.
    }
    closeCoordinator(state);
  }
}

Object.freeze(KnowledgeProductionObservationComposer.prototype);
Object.freeze(KnowledgeProductionObservationComposer);
