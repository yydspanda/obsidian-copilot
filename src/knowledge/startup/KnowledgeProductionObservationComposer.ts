import type { App, EventRef, TAbstractFile } from "obsidian";

import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { ObsidianKnowledgeFileStore } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import { KnowledgeProductionCandidateValidator } from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import { KnowledgeProductionModelRouteLease } from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeSourceExecutionPlan,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import {
  IngestQueue,
  type EnqueueIngestRequest,
  type EventSink,
  type IngestExecutor,
  type IngestExecutionContext,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  ObsidianExactSourceArtifactReader,
  ObsidianVaultSourceWatcher,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { SourceObservationHandoff } from "@/knowledge/ingest/SourceObservationHandoff";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { isPathWithinRoot } from "@/knowledge/paths/vaultPath";
import { KnowledgeStudioScopedQueryAdapter } from "@/knowledge/query/KnowledgeStudioScopedQueryAdapter";
import { KnowledgeProductionQueryWritebackCoordinator } from "@/knowledge/query/KnowledgeProductionQueryWritebackCoordinator";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { KnowledgeProductionCompileReviewHandler } from "@/knowledge/startup/KnowledgeProductionCompileReviewHandler";
import { KnowledgeProductionReviewedApplyCoordinator } from "@/knowledge/startup/KnowledgeProductionReviewedApplyCoordinator";
import { KnowledgePluginProductionWorkflowLease } from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import {
  KnowledgeSourceObservationStartupCoordinator,
  type KnowledgeSourceObservationStartupCoordinatorResult,
  type KnowledgeSourceObservationStartupReproofResult,
} from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";
import { KnowledgeSourceObservationStartupReconciler } from "@/knowledge/startup/KnowledgeSourceObservationStartupReconciler";
import { KnowledgeProductionWorkerSession } from "@/knowledge/startup/KnowledgeProductionWorkerSession";
import {
  KnowledgeProductionWorkerController,
  type KnowledgeProductionWorkerScheduler,
} from "@/knowledge/startup/KnowledgeProductionWorkerController";
import { KnowledgeStudioRuntimeReadAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";
import { KnowledgeStudioRuntimeCommandAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";
import { KnowledgeStudioReviewedApplyPort } from "@/knowledge/ui/KnowledgeStudioReviewedApplyPort";
import {
  KnowledgeProductionPreparationExecutor,
  type KnowledgePreparedIngestHandler,
} from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";

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

/** Queue event sink that can wake only the controller installed for this generation. */
class StartupHeldObservationEventSink implements EventSink {
  private controller?: KnowledgeProductionWorkerController;

  /** Ignores pre-release events and coalesces post-release committed changes. */
  emit(): void {
    this.controller?.notifyWorkAvailable();
  }

  /** Installs exactly one authentic controller after conditional release. */
  setController(controller: KnowledgeProductionWorkerController): void {
    if (this.controller || !(controller instanceof KnowledgeProductionWorkerController)) {
      throw createAbortError();
    }
    this.controller = controller;
  }

  /** Drops future wakeups before the Queue execution generation is closed. */
  close(): void {
    this.controller = undefined;
  }
}

interface KnowledgeProductionObservationComposition {
  app: App;
  runtime: KnowledgeRuntimeStore;
  executionOwner: ReturnType<typeof createKnowledgeExecutionOwner>;
  workflowLease: KnowledgePluginProductionWorkflowLease;
  loader: KnowledgeSourceWorkflowPlanLoader;
  owners: ReturnType<KnowledgePluginProductionWorkflowLease["getOwners"]>;
  artifactReader: ObsidianExactSourceArtifactReader;
  handoffs: ReadonlyMap<string, SourceObservationHandoff>;
  queue: IngestQueue;
  heldExecutor: StartupHeldObservationIngestExecutor;
  eventSink: StartupHeldObservationEventSink;
  proofPort: KnowledgeRuntimeIngestExecutionProofPort;
}

interface KnowledgeProductionObservationInternalState {
  generation: number;
  closed: boolean;
  started: boolean;
  composition?: KnowledgeProductionObservationComposition;
  compositionFailure?: KnowledgeProductionObservationDiagnosticCode;
  coordinator?: KnowledgeSourceObservationStartupCoordinator;
  worker?: KnowledgeProductionWorkerSession;
  workerController?: KnowledgeProductionWorkerController;
  modelRouteLease?: KnowledgeProductionModelRouteLease;
  plan?: KnowledgeSourceExecutionPlan;
  lastResult?: KnowledgeProductionObservationResult | KnowledgeProductionObservationReproofResult;
  unsubscribeLease?: () => void;
  closeListeners: Set<() => void>;
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
  const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
  const heldExecutor = new StartupHeldObservationIngestExecutor();
  const eventSink = new StartupHeldObservationEventSink();
  const queue = new IngestQueue(queueStorage, heldExecutor, { eventSink });
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
    runtime,
    executionOwner,
    workflowLease,
    loader,
    owners,
    artifactReader,
    handoffs,
    queue,
    heldExecutor,
    eventSink,
    proofPort,
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
 * Subscribes one Studio Bundle to value-free changes beneath its exact Wiki root.
 *
 * @param composition - Current App/Vault and workflow generation
 * @param bundleId - Configured Bundle whose Wiki targets are observed
 * @param onHint - Non-authoritative reload callback
 * @returns Idempotent exact-Vault listener cleanup
 */
function subscribeKnowledgeStudioVaultHints(
  composition: KnowledgeProductionObservationComposition,
  bundleId: string,
  onHint: () => void
): () => void {
  const owner = composition.owners.find(({ config }) => config.id === bundleId);
  if (!owner || typeof onHint !== "function") throw createAbortError();
  composition.workflowLease.assertCurrent();
  const vault = composition.app.vault;
  let active = true;
  const affectsWiki = (file: TAbstractFile, oldPath?: string): void => {
    if (!active) return;
    if (
      isPathWithinRoot(file.path, owner.config.wikiRoot) ||
      (oldPath !== undefined && isPathWithinRoot(oldPath, owner.config.wikiRoot))
    ) {
      try {
        onHint();
      } catch {
        // Reload hints are non-authoritative and cannot disrupt Vault events.
      }
    }
  };
  const refs: EventRef[] = [];
  try {
    refs.push(vault.on("create", (file) => affectsWiki(file)));
    refs.push(vault.on("modify", (file) => affectsWiki(file)));
    refs.push(vault.on("delete", (file) => affectsWiki(file)));
    refs.push(vault.on("rename", (file, oldPath) => affectsWiki(file, oldPath)));
  } catch {
    active = false;
    for (const ref of refs) {
      try {
        vault.offref(ref);
      } catch {
        // Partial subscription authority is already discarded.
      }
    }
    throw createAbortError();
  }
  return () => {
    if (!active) return;
    active = false;
    for (const ref of refs) {
      try {
        vault.offref(ref);
      } catch {
        // The subscription is already non-authoritative for this generation.
      }
    }
  };
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
      closeListeners: new Set(),
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
      state.plan = plan;
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

  /** Binds an exact claim/read/parser bridge to the released Queue and returns a bounded worker. */
  createPreparedWorkerSession(
    handler: KnowledgePreparedIngestHandler,
    isReleased: () => boolean
  ): KnowledgeProductionWorkerSession {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || !state.coordinator || !state.lastResult || !state.plan || state.worker) {
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
    composition.heldExecutor.setExecutor(
      new KnowledgeProductionPreparationExecutor(state.plan, composition.proofPort, handler)
    );
    const worker = new KnowledgeProductionWorkerSession({
      queue: composition.queue,
      bundleIds: composition.owners.map(({ config }) => config.id),
      isReleased,
      assertCurrent: () => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      },
    });
    state.worker = worker;
    return worker;
  }

  /**
   * Installs the reviewed production Compiler→Review handler over this exact Runtime owner.
   *
   * The Review repository is created internally from the same Runtime and
   * execution owner as the hidden Queue, so `main.ts` cannot splice storage
   * from another plugin or workflow generation.
   */
  createCompileReviewWorkerSession(
    routeLease: KnowledgeProductionModelRouteLease,
    isReleased: () => boolean
  ): KnowledgeProductionWorkerSession {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || state.worker) {
      throw createAbortError();
    }
    try {
      KnowledgeProductionModelRouteLease.assert(routeLease);
      routeLease.assertCurrent();
      if (!routeLease.coversBundleIds(composition.owners.map(({ config }) => config.id))) {
        throw createAbortError();
      }
      const reviews = new ChangeSetReviewRepository(
        new KnowledgeRuntimeReviewStorage(composition.runtime, composition.executionOwner)
      );
      const handler = new KnowledgeProductionCompileReviewHandler({
        routeLease,
        targetResolver: new ObsidianKnowledgeCompilerTargetResolver(composition.app),
        candidateValidator: new KnowledgeProductionCandidateValidator(),
        reviews,
      });
      KnowledgeProductionCompileReviewHandler.assertExecutionOwner(
        handler,
        composition.executionOwner
      );
      const worker = this.createPreparedWorkerSession(handler, isReleased);
      state.modelRouteLease = routeLease;
      return worker;
    } catch {
      throw createAbortError();
    }
  }

  /** Creates the event-driven main-owned controller for the exact released generation. */
  createCompileReviewWorkerController(
    routeLease: KnowledgeProductionModelRouteLease,
    isReleased: () => boolean,
    scheduler: KnowledgeProductionWorkerScheduler
  ): KnowledgeProductionWorkerController {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || state.workerController) {
      throw createAbortError();
    }
    try {
      const worker = this.createCompileReviewWorkerSession(routeLease, isReleased);
      const controller = new KnowledgeProductionWorkerController({ worker, scheduler });
      composition.eventSink.setController(controller);
      state.workerController = controller;
      return controller;
    } catch {
      this.close();
      throw createAbortError();
    }
  }

  /**
   * Creates the Studio adapter for this exact released worker generation.
   *
   * The adapter receives the hidden exact Queue Activity boundary, atomic
   * Review rejection, and—only when the lifecycle callback is supplied—a
   * narrow reviewed-apply port. Transaction, Wiki, Runtime, and model authority
   * remain inside generation-owned coordinators. Every read and command
   * re-proves this workflow lease.
   *
   * @param retainCommandDrain - Optional Vault-level cross-generation drain retention
   * @param onApplyGenerationRefreshRequired - Lifecycle callback that rebuilds Manifest-bound workflow state
   */
  createKnowledgeStudioRuntimeReadAdapter(
    modelRouteLease: KnowledgeProductionModelRouteLease,
    retainCommandDrain?: (drain: Promise<void>) => void,
    onApplyGenerationRefreshRequired?: () => void
  ): KnowledgeStudioRuntimeReadAdapter {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (
      !composition ||
      !state.workerController ||
      !state.plan ||
      state.modelRouteLease !== modelRouteLease
    ) {
      throw createAbortError();
    }
    KnowledgeProductionModelRouteLease.assert(modelRouteLease);
    modelRouteLease.assertCurrent();
    this.assertHealthy();
    const runtime = Object.freeze({
      readStudioBundle: (bundleId: string) => composition.runtime.readStudioBundle(bundleId),
      readAppliedProvenance: (bundleId: string) =>
        composition.runtime.readAppliedProvenance(bundleId),
      subscribeStudioBundle: (bundleId: string, onHint: () => void) =>
        composition.runtime.subscribeStudioBundle(bundleId, onHint),
    });
    const assertCurrent = (): void => {
      assertCompositionCurrent(state, state.generation, composition);
      this.assertHealthy();
    };
    const targetResolver = new ObsidianKnowledgeCompilerTargetResolver(composition.app);
    const fileStore = new ObsidianKnowledgeFileStore(composition.app.vault);
    let reviewApply: KnowledgeStudioReviewedApplyPort | undefined;
    if (onApplyGenerationRefreshRequired) {
      const reviewedApplyCoordinator = new KnowledgeProductionReviewedApplyCoordinator({
        runtime: composition.runtime,
        queue: composition.queue,
        reviews: new ChangeSetReviewRepository(
          new KnowledgeRuntimeReviewStorage(composition.runtime, composition.executionOwner)
        ),
        plan: state.plan,
        bundles: composition.owners.map(({ config }) => config),
        targetResolver,
        fileStore,
        assertCurrent,
        onGenerationRefreshRequired: onApplyGenerationRefreshRequired,
      });
      reviewApply = new KnowledgeStudioReviewedApplyPort((bundleId, command, signal) =>
        reviewedApplyCoordinator.submit(bundleId, command, signal)
      );
    }
    const commands = new KnowledgeStudioRuntimeCommandAdapter({
      queue: composition.queue,
      reviewReject: new KnowledgeRuntimeReviewRejectPort(composition.runtime),
      ...(reviewApply === undefined ? {} : { reviewApply }),
      bundleIds: composition.owners.map(({ config }) => config.id),
      assertCurrent,
      ...(retainCommandDrain === undefined ? {} : { retainDrain: retainCommandDrain }),
      notifyReviewWorkAvailable: () => composition.eventSink.emit(),
    });
    const writeback = onApplyGenerationRefreshRequired
      ? new KnowledgeProductionQueryWritebackCoordinator({
          owners: composition.owners,
          fileStore,
          registration: new KnowledgeSourceRegistrationCore(
            new SourceManifestRepository(new KnowledgeRuntimeManifestStorage(composition.runtime)),
            { assertCurrent }
          ),
          assertCurrent,
          onGenerationRefreshRequired: onApplyGenerationRefreshRequired,
          ...(retainCommandDrain === undefined ? {} : { retainDrain: retainCommandDrain }),
        })
      : undefined;
    const query = new KnowledgeStudioScopedQueryAdapter({
      app: composition.app,
      runtime,
      bundles: composition.owners.map(({ config }) => config),
      targetResolver,
      modelRouteLease,
      ...(writeback === undefined ? {} : { writeback }),
      assertCurrent,
    });
    this.subscribeClose(() => query.close());
    return new KnowledgeStudioRuntimeReadAdapter({
      runtime,
      bundles: composition.owners.map(({ config }) => config),
      targetResolver,
      assertCurrent,
      commands,
      query,
      subscribeVaultHints: (bundleId, onHint) =>
        subscribeKnowledgeStudioVaultHints(composition, bundleId, onHint),
    });
  }

  /**
   * Subscribes to synchronous generation closure without exposing internal state.
   *
   * @param listener - Best-effort callback used to revoke downstream capabilities
   * @returns Idempotent unsubscription callback
   */
  subscribeClose(listener: () => void): () => void {
    const state = requireComposerState(this);
    if (typeof listener !== "function") throw createAbortError();
    if (state.closed) {
      try {
        listener();
      } catch {
        // Closure already won; downstream notification is best-effort.
      }
      return () => undefined;
    }
    state.closeListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      state.closeListeners.delete(listener);
    };
  }

  /** Synchronously closes listeners and invalidates all future plan/capture continuations. */
  close(): void {
    const state = composerStates.get(this);
    if (!state || state.closed) return;
    const composition = state.composition;
    const worker = state.worker;
    const workerController = state.workerController;
    state.closed = true;
    state.generation += 1;
    state.composition = undefined;
    state.plan = undefined;
    state.worker = undefined;
    state.workerController = undefined;
    state.modelRouteLease = undefined;
    try {
      composition?.eventSink.close();
    } catch {
      // Queue event publication is already detached from the closed generation.
    }
    try {
      workerController?.close();
    } catch {
      // Controller authority is already revoked by the generation state.
    }
    try {
      worker?.close();
    } catch {
      // The generation is already revoked; worker cleanup cannot revive it.
    }
    try {
      composition?.queue.close();
    } catch {
      // Queue close is best-effort after publication authority is revoked.
    }
    const unsubscribe = state.unsubscribeLease;
    state.unsubscribeLease = undefined;
    try {
      unsubscribe?.();
    } catch {
      // The local generation is already revoked; unsubscribe cannot revive it.
    }
    closeCoordinator(state);
    const listeners = [...state.closeListeners];
    state.closeListeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Downstream cleanup cannot interrupt or revive the closed generation.
      }
    }
  }
}

Object.freeze(KnowledgeProductionObservationComposer.prototype);
Object.freeze(KnowledgeProductionObservationComposer);
