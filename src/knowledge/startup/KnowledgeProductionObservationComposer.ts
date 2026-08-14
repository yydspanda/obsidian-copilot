import type { App, EventRef, TAbstractFile } from "obsidian";

import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { ObsidianKnowledgeFileStore } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import { KnowledgeProductionCandidateValidator } from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import { KnowledgeProductionModelRouteLease } from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import { KnowledgeProductionForwardRevisionDecisionCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator";
import { KnowledgeProductionForwardRevisionProposalActionAdapter } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import { KnowledgeProductionForwardRevisionProposalCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import {
  KnowledgeProductionForwardRevisionApplyCoordinator,
  KnowledgeProductionForwardRevisionApplyTransactionRunner,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator";
import { KnowledgeProductionForwardRevisionValidationCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import { KnowledgeProductionForwardRevisionStudioCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionStudioCoordinator";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeSourceExecutionPlan,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { KnowledgeSourceFreshnessAdmission } from "@/knowledge/ingest/KnowledgeSourceFreshnessAdmission";
import { ObsidianKnowledgeOutputObservationReader } from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
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
  type VaultSourceWatcherNotification,
  type VaultSourceWatcherNotificationSink,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { SourceObservationHandoff } from "@/knowledge/ingest/SourceObservationHandoff";
import { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { isPathWithinRoot } from "@/knowledge/paths/vaultPath";
import { KnowledgeStudioScopedQueryAdapter } from "@/knowledge/query/KnowledgeStudioScopedQueryAdapter";
import { KnowledgeProductionQueryWritebackCoordinator } from "@/knowledge/query/KnowledgeProductionQueryWritebackCoordinator";
import { ObsidianKnowledgeCitationNavigator } from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import { KnowledgeProductionReviewEvidenceCoordinator } from "@/knowledge/review/KnowledgeProductionReviewEvidenceCoordinator";
import type { KnowledgeReviewEvidenceOpenRequest } from "@/knowledge/review/KnowledgeReviewEvidence";
import { KnowledgeProductionReviewEvidenceSourceAuthority } from "@/knowledge/review/KnowledgeProductionReviewEvidenceSourceAuthority";
import {
  KnowledgeRuntimeInputObservationBinder,
  KnowledgeRuntimeInputRevisionAllocator,
  KnowledgeRuntimeForwardRevisionDecisionPort,
  KnowledgeRuntimeForwardRevisionApplyPort,
  KnowledgeRuntimeForwardRevisionApplyRecoveryPort,
  KnowledgeRuntimeForwardRevisionProposalPublicationPort,
  KnowledgeRuntimeForwardRevisionStudioPort,
  KnowledgeRuntimeForwardRevisionValidationPort,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeManifestStorage,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewRejectPort,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import type { KnowledgeKnownAppliedWikiOutputAuthorityIdentity } from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import { KnowledgeProductionCompileReviewHandler } from "@/knowledge/startup/KnowledgeProductionCompileReviewHandler";
import { KnowledgeProductionReviewedApplyCoordinator } from "@/knowledge/startup/KnowledgeProductionReviewedApplyCoordinator";
import {
  KnowledgePluginProductionWorkflowCompositionClaim,
  KnowledgePluginProductionWorkflowLease,
} from "@/knowledge/startup/KnowledgePluginProductionPreflightLifecycle";
import {
  KnowledgeSourceObservationStartupCoordinator,
  type KnowledgeSourceObservationRecoverableIssue,
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
import { KnowledgeProductionSourceLifecycleCoordinator } from "@/knowledge/sourceLifecycle/KnowledgeProductionSourceLifecycleCoordinator";
import type { KnowledgeSourceLifecyclePort } from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import {
  KnowledgeProductionPreparationExecutor,
  type KnowledgePreparedIngestHandler,
} from "@/knowledge/startup/KnowledgeProductionPreparationExecutor";
import { KnowledgeProductionAppliedWikiPageInspectorCoordinator } from "@/knowledge/wiki/KnowledgeProductionAppliedWikiPageInspectorCoordinator";
import { KnowledgeProductionKnownAppliedWikiOutputsCoordinator } from "@/knowledge/wiki/KnowledgeProductionKnownAppliedWikiOutputsCoordinator";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import type { KnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

/** Exact production resources consumed by one observation-only workflow generation. */
export interface KnowledgeProductionObservationComposerInput {
  /** App/Vault lifecycle owner used for exact source and schema reads. */
  app: App;
  /** Already initialized shared atomic Runtime envelope. */
  runtime: KnowledgeRuntimeStore;
  /** Same-snapshot, secret-free capability minted by production preflight. */
  workflowLease: KnowledgePluginProductionWorkflowLease;
  /** One-shot exact preflight bridge for this composition. */
  workflowCompositionClaim: KnowledgePluginProductionWorkflowCompositionClaim;
  /** Best-effort path-free host notification capability for source issues. */
  notificationSink?: VaultSourceWatcherNotificationSink;
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

/** Exact active Manifest source identity projected without watch-plan authority. */
export interface KnowledgeProductionRegisteredSourcePathSummary {
  readonly bundleId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
}

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
  executionOwner: KnowledgeExecutionOwner;
  workflowLease: KnowledgePluginProductionWorkflowLease;
  owners: ReturnType<KnowledgePluginProductionWorkflowLease["getOwners"]>;
  artifactReader: ObsidianExactSourceArtifactReader;
  handoffs: ReadonlyMap<string, SourceObservationHandoff>;
  queue: IngestQueue;
  freshnessAdmission: KnowledgeSourceFreshnessAdmission;
  heldExecutor: StartupHeldObservationIngestExecutor;
  eventSink: StartupHeldObservationEventSink;
  proofPort: KnowledgeRuntimeIngestExecutionProofPort;
  notificationSink?: VaultSourceWatcherNotificationSink;
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
  sourceRecoveryIssues?: readonly KnowledgeSourceObservationRecoverableIssue[];
  appliedWikiInspectorCreated?: boolean;
  knownAppliedWikiOutputsCreated?: boolean;
  forwardRevisionProposalActionCreated?: boolean;
  forwardRevisionValidationCoordinatorCreated?: boolean;
  forwardRevisionDecisionCoordinatorCreated?: boolean;
  forwardRevisionApplyCoordinatorCreated?: boolean;
  forwardRevisionApplyRecoveryRunnerCreated?: boolean;
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

/** Reads one optional enumerable data property without evaluating an accessor. */
function readOptionalDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new TypeError("Invalid production observation input");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Invalid production observation input");
  }
  return descriptor.value;
}

/** Snapshots one optional watcher notification capability without retaining accessors. */
function snapshotNotificationSink(value: unknown): VaultSourceWatcherNotificationSink | undefined {
  if (value === undefined) return undefined;
  const emit = readDataProperty(value, "emit");
  if (typeof emit !== "function") {
    throw new TypeError("Invalid production observation dependencies");
  }
  return Object.freeze({
    emit: (notification: VaultSourceWatcherNotification) => {
      Reflect.apply(emit, value, [notification]);
    },
  });
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

/** Compares stable source identifiers without depending on the host locale. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Projects a retained watch plan into a frozen path-only source index. */
function snapshotRegisteredSourcePaths(
  plan: KnowledgeSourceExecutionPlan
): readonly Readonly<KnowledgeProductionRegisteredSourcePathSummary>[] {
  return Object.freeze(
    plan
      .getWatchPlan()
      .getSources()
      .map((source) =>
        Object.freeze({
          bundleId: source.bundleId,
          sourceId: source.sourceId,
          sourcePath: source.sourcePath,
        })
      )
      .sort(
        (left, right) =>
          compareText(left.bundleId, right.bundleId) ||
          compareText(left.sourceId, right.sourceId) ||
          compareText(left.sourcePath, right.sourcePath)
      )
  );
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

/** Builds exact Runtime, owner, reader, and enqueue-only pre-observation ports. */
function composeObservation(
  owner: KnowledgeProductionObservationComposer,
  input: KnowledgeProductionObservationComposerInput,
  state: KnowledgeProductionObservationInternalState
): KnowledgeProductionObservationComposition {
  const app = readDataProperty(input, "app");
  const runtime = readDataProperty(input, "runtime");
  const workflowLease = readDataProperty(input, "workflowLease");
  const workflowCompositionClaim = readDataProperty(input, "workflowCompositionClaim");
  const notificationSink = snapshotNotificationSink(
    readOptionalDataProperty(input, "notificationSink")
  );
  if (typeof app !== "object" || app === null || !(runtime instanceof KnowledgeRuntimeStore)) {
    throw new TypeError("Invalid production observation dependencies");
  }
  KnowledgePluginProductionWorkflowLease.assert(workflowLease);
  workflowLease.assertCurrent();

  const owners = workflowLease.getOwners();
  const appOwner = app as App;
  const executionOwner = KnowledgePluginProductionWorkflowLease.consumeCompositionClaim(
    workflowLease,
    workflowCompositionClaim
  );
  KnowledgeExecutionOwner.bindVaultLifecycle(
    executionOwner,
    appOwner,
    appOwner.vault,
    appOwner.vault.adapter
  );
  const queueStorage = new KnowledgeRuntimeQueueStorage(runtime, executionOwner);
  const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
  const heldExecutor = new StartupHeldObservationIngestExecutor();
  const eventSink = new StartupHeldObservationEventSink();
  let composition!: KnowledgeProductionObservationComposition;
  const freshnessAdmission = new KnowledgeSourceFreshnessAdmission({
    authority: runtime,
    outputs: new ObsidianKnowledgeOutputObservationReader(
      new ObsidianKnowledgeCompilerTargetResolver(app as App)
    ),
    generation: {
      assertCurrent: () => {
        if (
          composition === undefined ||
          !isCompositionCurrent(requireComposerState(owner), state.generation, composition)
        ) {
          throw createAbortError();
        }
        composition.workflowLease.assertCurrent();
      },
    },
  });
  const queue = new IngestQueue(queueStorage, heldExecutor, {
    eventSink,
    sourceFreshnessAdmission: freshnessAdmission,
  });
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
  composition = Object.freeze({
    app: app as App,
    runtime,
    executionOwner,
    workflowLease,
    owners,
    artifactReader,
    handoffs,
    queue,
    freshnessAdmission,
    heldExecutor,
    eventSink,
    proofPort,
    notificationSink,
  });
  workflowLease.assertCurrent();
  return composition;
}

/**
 * Captures parser profiles and binds the workflow loader only after recovery is clear.
 *
 * Constructor-time recovery composition deliberately never calls this helper,
 * so a broken parser registry cannot prevent an existing durable journal from
 * reaching its commit-wins recovery boundary.
 */
function createObservationWorkflowPlanLoader(
  state: KnowledgeProductionObservationInternalState,
  generation: number,
  composition: KnowledgeProductionObservationComposition,
  signal: AbortSignal
): KnowledgeSourceWorkflowPlanLoader {
  assertCompositionCurrent(state, generation, composition, signal);
  const parsers = composition.workflowLease.getParsers();
  assertCompositionCurrent(state, generation, composition, signal);
  return new KnowledgeSourceWorkflowPlanLoader({
    executionOwner: composition.executionOwner,
    manifest: new SourceManifestRepository(
      new KnowledgeRuntimeManifestStorage(composition.runtime)
    ),
    artifactReader: composition.artifactReader,
    pipelineProfile: composition.workflowLease,
    parsers,
    generation: {
      isCurrent: () => isCompositionCurrent(state, generation, composition),
    },
  });
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
    {
      artifactReader: composition.artifactReader,
      notificationSink: composition.notificationSink,
    }
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
 * Subscribes one Studio Bundle to coalesced Vault and source-issue reload hints.
 *
 * @param composition - Current App/Vault and workflow generation
 * @param bundleId - Configured Bundle whose Wiki targets are observed
 * @param onHint - Non-authoritative reload callback
 * @param subscribeSourceIssueHints - Generation-owned recoverable issue hint source
 * @returns Idempotent cleanup for every exact-generation hint source
 */
function subscribeKnowledgeStudioExternalHints(
  composition: KnowledgeProductionObservationComposition,
  bundleId: string,
  onHint: () => void,
  subscribeSourceIssueHints: (listener: () => void) => () => void
): () => void {
  const owner = composition.owners.find(({ config }) => config.id === bundleId);
  if (!owner || typeof onHint !== "function" || typeof subscribeSourceIssueHints !== "function") {
    throw createAbortError();
  }
  composition.workflowLease.assertCurrent();
  const vault = composition.app.vault;
  let active = true;
  let hintQueued = false;
  const observedRoots = Object.freeze([...owner.config.sourceRoots, owner.config.wikiRoot]);
  const emitHint = (): void => {
    hintQueued = false;
    if (!active) return;
    try {
      composition.workflowLease.assertCurrent();
      onHint();
    } catch {
      // A stale generation or presentation failure cannot affect watcher state.
    }
  };
  const scheduleHint = (): void => {
    if (!active || hintQueued) return;
    hintQueued = true;
    queueMicrotask(emitHint);
  };
  const affectsBundle = (file: TAbstractFile, oldPath?: string): void => {
    if (!active) return;
    if (
      observedRoots.some((root) => isPathWithinRoot(file.path, root)) ||
      (oldPath !== undefined && observedRoots.some((root) => isPathWithinRoot(oldPath, root)))
    ) {
      scheduleHint();
    }
  };
  const refs: EventRef[] = [];
  let unsubscribeSourceIssues: (() => void) | undefined;
  try {
    unsubscribeSourceIssues = subscribeSourceIssueHints(scheduleHint);
    if (typeof unsubscribeSourceIssues !== "function") throw createAbortError();
    refs.push(vault.on("create", (file) => affectsBundle(file)));
    refs.push(vault.on("modify", (file) => affectsBundle(file)));
    refs.push(vault.on("delete", (file) => affectsBundle(file)));
    refs.push(vault.on("rename", (file, oldPath) => affectsBundle(file, oldPath)));
  } catch {
    active = false;
    for (const ref of refs) {
      try {
        vault.offref(ref);
      } catch {
        // Partial subscription authority is already discarded.
      }
    }
    try {
      unsubscribeSourceIssues?.();
    } catch {
      // Partial issue subscription authority is already discarded.
    }
    throw createAbortError();
  }
  return () => {
    if (!active) return;
    active = false;
    hintQueued = false;
    for (const ref of refs) {
      try {
        vault.offref(ref);
      } catch {
        // The subscription is already non-authoritative for this generation.
      }
    }
    try {
      unsubscribeSourceIssues?.();
    } catch {
      // The source-issue subscription is already non-authoritative.
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
      const loader = createObservationWorkflowPlanLoader(state, generation, composition, signal);
      const plan = await loader.load(composition.owners, signal);
      state.plan = plan;
      assertCompositionCurrent(state, generation, composition, signal);
      phase = "observation";
      const coordinator = createObservationCoordinator(state, generation, composition, plan);
      state.coordinator = coordinator;
      assertCompositionCurrent(state, generation, composition, signal);
      const result = await coordinator.start(signal);
      assertCompositionCurrent(state, generation, composition, signal);
      state.lastResult = result;
      if (
        result.kind === "blocked" &&
        result.blockerKinds.length === 1 &&
        result.blockerKinds[0] === "source_observation_pending"
      ) {
        const issues = coordinator.getSourceRecoveryClassificationIssues();
        if (issues) state.sourceRecoveryIssues = issues;
      }
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

  /**
   * Returns current recoverable source issues without exposing watcher authority.
   *
   * @returns Coordinator-owned frozen issue snapshot for this exact generation
   */
  getSourceIssues(): readonly KnowledgeSourceObservationRecoverableIssue[] {
    const state = requireComposerState(this);
    const composition = state.composition;
    const coordinator = state.coordinator;
    const sourceRecoveryIssues = state.sourceRecoveryIssues;
    if (!composition || !state.lastResult || (!coordinator && !sourceRecoveryIssues)) {
      throw createAbortError();
    }
    try {
      assertCompositionCurrent(state, state.generation, composition);
      let issues: readonly KnowledgeSourceObservationRecoverableIssue[];
      if (coordinator) {
        issues = coordinator.getSourceIssues();
      } else if (sourceRecoveryIssues) {
        issues = sourceRecoveryIssues;
      } else {
        throw createAbortError();
      }
      assertCompositionCurrent(state, state.generation, composition);
      return issues;
    } catch {
      this.close();
      throw createAbortError();
    }
  }

  /**
   * Returns exact active registered source paths for a generation-owned file-menu index.
   *
   * @returns Frozen path-only summaries detached from the retained watch plan
   */
  getRegisteredSourcePaths(): readonly Readonly<KnowledgeProductionRegisteredSourcePathSummary>[] {
    const state = requireComposerState(this);
    const composition = state.composition;
    const plan = state.plan;
    if (!composition || !state.coordinator || !state.lastResult || !plan) {
      throw createAbortError();
    }
    try {
      assertCompositionCurrent(state, state.generation, composition);
      this.assertHealthy();
      const sources = snapshotRegisteredSourcePaths(plan);
      assertCompositionCurrent(state, state.generation, composition);
      return sources;
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
    scheduler: KnowledgeProductionWorkerScheduler,
    onGenerationRefreshRequired: () => void
  ): KnowledgeProductionWorkerController {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || state.workerController) {
      throw createAbortError();
    }
    try {
      const worker = this.createCompileReviewWorkerSession(routeLease, isReleased);
      if (typeof onGenerationRefreshRequired !== "function") {
        throw createAbortError();
      }
      const watchPlan = state.plan?.getWatchPlan();
      if (!watchPlan) throw createAbortError();
      const expectedManifestAuthorities = composition.owners.map(({ config }) => {
        const authority = watchPlan.getBundleAuthority(config.id);
        if (!authority) throw createAbortError();
        return Object.freeze({
          bundleId: config.id,
          revision: authority.manifestRevision,
          digest: authority.manifestDigest,
        });
      });
      const manifests = new SourceManifestRepository(
        new KnowledgeRuntimeManifestStorage(composition.runtime)
      );
      const controller = new KnowledgeProductionWorkerController({
        worker,
        scheduler,
        onGenerationRefreshRequired,
        probeGenerationCurrent: async () => {
          assertCompositionCurrent(state, state.generation, composition);
          for (const expected of expectedManifestAuthorities) {
            const manifest = await manifests.load(expected.bundleId);
            if (
              manifest.revision !== expected.revision ||
              createSourceManifestDigest(manifest) !== expected.digest
            ) {
              return false;
            }
          }
          return true;
        },
      });
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
    const observationCoordinator = state.coordinator;
    if (
      !composition ||
      !observationCoordinator ||
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
    const executionPlan = state.plan;
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
    const reviewEvidenceByBundle = new Map(
      composition.owners.map(({ config }) => [
        config.id,
        new KnowledgeProductionReviewEvidenceCoordinator({
          runtime,
          bundle: config,
          targetResolver,
          sourceAuthority: new KnowledgeProductionReviewEvidenceSourceAuthority({
            plan: executionPlan,
            bundleId: config.id,
            assertCurrent,
          }),
          navigator: new ObsidianKnowledgeCitationNavigator(composition.app),
          assertCurrent,
        }),
      ])
    );
    const reviewEvidence = Object.freeze({
      openReviewEvidence: (
        bundleId: string,
        request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
        signal: AbortSignal
      ) => {
        const coordinator = reviewEvidenceByBundle.get(bundleId);
        if (!coordinator) return Promise.resolve(Object.freeze({ kind: "unavailable" as const }));
        return coordinator.openReviewEvidence(bundleId, request, signal);
      },
    });
    let sourceLifecycle: KnowledgeSourceLifecyclePort | undefined;
    if (onApplyGenerationRefreshRequired) {
      const sourceLifecycleCoordinator = new KnowledgeProductionSourceLifecycleCoordinator({
        runtime: composition.runtime,
        getSourceIssues: () => this.getSourceIssues(),
        assertCurrent,
        onGenerationRefreshRequired: onApplyGenerationRefreshRequired,
      });
      const retainLifecycleAction = <T>(operation: Promise<T>): Promise<T> => {
        retainCommandDrain?.(
          operation.then(
            () => undefined,
            () => undefined
          )
        );
        return operation;
      };
      const lifecyclePort: KnowledgeSourceLifecyclePort = {
        loadSources: (bundleId, signal) => sourceLifecycleCoordinator.loadSources(bundleId, signal),
        checkAgain: (bundleId, sourceId, signal) =>
          retainLifecycleAction(sourceLifecycleCoordinator.checkAgain(bundleId, sourceId, signal)),
        retireSource: (bundleId, request, signal) =>
          retainLifecycleAction(sourceLifecycleCoordinator.retireSource(bundleId, request, signal)),
      };
      sourceLifecycle = Object.freeze(lifecyclePort);
    }
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
    const forwardRevision =
      retainCommandDrain === undefined
        ? undefined
        : new KnowledgeProductionForwardRevisionStudioCoordinator(
            new KnowledgeRuntimeForwardRevisionStudioPort(
              composition.runtime,
              composition.proofPort,
              KnowledgePluginProductionWorkflowLease.getExecutionLease(
                composition.workflowLease,
                composition.executionOwner
              )
            ),
            this.createForwardRevisionDecisionCoordinator(),
            this.createForwardRevisionApplyCoordinator(),
            new ObsidianKnowledgeCompilerTargetResolver(
              composition.app,
              composition.executionOwner
            ),
            composition.executionOwner,
            assertCurrent
          );
    return new KnowledgeStudioRuntimeReadAdapter({
      runtime,
      bundles: composition.owners.map(({ config }) => config),
      targetResolver,
      assertCurrent,
      commands,
      query,
      reviewEvidence,
      ...(forwardRevision === undefined
        ? {}
        : {
            forwardRevision,
            retainForwardRevisionDrain: retainCommandDrain,
          }),
      ...(sourceLifecycle === undefined ? {} : { sourceLifecycle }),
      subscribeVaultHints: (bundleId, onHint) =>
        subscribeKnowledgeStudioExternalHints(composition, bundleId, onHint, (listener) =>
          observationCoordinator.subscribeSourceIssueChanges(bundleId, listener)
        ),
    });
  }

  /**
   * Creates the read-only applied-Wiki inspector for this released worker generation.
   *
   * Each Bundle receives its own bounded target visitor, while one shared citation
   * navigator remains the coordinator's only workspace side-effect capability.
   * Runtime, Vault bytes, workflow plans, and model authority stay private.
   *
   * @returns One exact-generation inspector and advisory path-row listing port
   */
  createAppliedWikiPageInspectorCoordinator(): KnowledgeProductionAppliedWikiPageInspectorCoordinator {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !state.plan ||
      !state.modelRouteLease ||
      state.appliedWikiInspectorCreated
    ) {
      throw createAbortError();
    }
    try {
      const modelRouteLease = state.modelRouteLease;
      modelRouteLease.assertCurrent();
      this.assertHealthy();
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        modelRouteLease.assertCurrent();
        this.assertHealthy();
      };
      const coordinator = new KnowledgeProductionAppliedWikiPageInspectorCoordinator({
        runtime: Object.freeze({
          readAppliedProvenance: (bundleId: string) =>
            composition.runtime.readAppliedProvenance(bundleId),
        }),
        bundles: Object.freeze(
          composition.owners.map(({ config }) =>
            Object.freeze({
              bundle: config,
              targetVisitor: new ObsidianKnowledgeCompilerTargetResolver(composition.app),
            })
          )
        ),
        navigator: new ObsidianKnowledgeCitationNavigator(composition.app),
        assertCurrent,
      });
      assertCurrent();
      state.appliedWikiInspectorCreated = true;
      return coordinator;
    } catch {
      throw createAbortError();
    }
  }

  /** Creates the one read-only known-output browser for this released generation. */
  createKnownAppliedWikiOutputsCoordinator(): KnowledgeProductionKnownAppliedWikiOutputsCoordinator {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !state.plan ||
      !state.modelRouteLease ||
      state.knownAppliedWikiOutputsCreated
    ) {
      throw createAbortError();
    }
    try {
      const modelRouteLease = state.modelRouteLease;
      modelRouteLease.assertCurrent();
      this.assertHealthy();
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        modelRouteLease.assertCurrent();
        this.assertHealthy();
      };
      const coordinator = new KnowledgeProductionKnownAppliedWikiOutputsCoordinator({
        runtime: Object.freeze({
          readKnownAppliedWikiOutputIndex: (bundleId: string, pagePath: string) =>
            composition.runtime.readKnownAppliedWikiOutputIndex(bundleId, pagePath),
          readKnownAppliedWikiOutputDetail: (
            bundleId: string,
            pagePath: string,
            authority: KnowledgeKnownAppliedWikiOutputAuthorityIdentity
          ) => composition.runtime.readKnownAppliedWikiOutputDetail(bundleId, pagePath, authority),
        }),
        bundles: Object.freeze(
          composition.owners.map(({ config }) =>
            Object.freeze({
              bundle: config,
              targetVisitor: new ObsidianKnowledgeCompilerTargetResolver(composition.app),
            })
          )
        ),
        assertCurrent,
      });
      assertCurrent();
      state.knownAppliedWikiOutputsCreated = true;
      return coordinator;
    } catch {
      throw createAbortError();
    }
  }

  /**
   * Creates the receipt-free proposal action paired with the exact known-output generation.
   *
   * @param knownOutputs - Stable authentic browser boundary that issued the UI session
   * @param knownOutputsDelegate - Exact current delegate behind that stable boundary
   * @param retainDrain - Generation drain registrar invoked before proposal work can settle
   * @returns One genuine generation-owned proposal action adapter
   */
  createForwardRevisionProposalActionAdapter(
    knownOutputs: DelegatingKnowledgeKnownAppliedWikiOutputsPort,
    knownOutputsDelegate: KnowledgeKnownAppliedWikiOutputsPort,
    retainDrain: (drain: Promise<void>) => void
  ): KnowledgeProductionForwardRevisionProposalActionAdapter {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !state.plan ||
      composition.owners.length !== 1 ||
      !state.knownAppliedWikiOutputsCreated ||
      state.forwardRevisionProposalActionCreated
    ) {
      throw createAbortError();
    }
    if (typeof retainDrain !== "function") throw createAbortError();
    try {
      /** Reasserts that the proposal action still belongs to this live production generation. */
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      };
      const executionLease = KnowledgePluginProductionWorkflowLease.getExecutionLease(
        composition.workflowLease,
        composition.executionOwner
      );
      const adapter = new KnowledgeProductionForwardRevisionProposalActionAdapter(
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate,
          runtime: new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
            composition.runtime,
            composition.proofPort,
            executionLease
          ),
          executionOwner: composition.executionOwner,
          bundles: composition.owners.map(({ config }) =>
            Object.freeze({ bundleId: config.id, wikiRoot: config.wikiRoot })
          ),
          assertCurrent,
        }),
        retainDrain
      );
      assertCurrent();
      state.forwardRevisionProposalActionCreated = true;
      return adapter;
    } catch {
      throw createAbortError();
    }
  }

  /** Creates one deterministic forward-revision validator for this exact released generation. */
  createForwardRevisionValidationCoordinator(): KnowledgeProductionForwardRevisionValidationCoordinator {
    const state = requireComposerState(this);
    const composition = state.composition;
    const plan = state.plan;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !plan ||
      state.forwardRevisionValidationCoordinatorCreated
    ) {
      throw createAbortError();
    }
    try {
      /** Reasserts that this composer and its production dependencies remain current. */
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      };
      assertCurrent();
      const coordinator = new KnowledgeProductionForwardRevisionValidationCoordinator(
        new KnowledgeRuntimeForwardRevisionValidationPort(
          composition.runtime,
          composition.proofPort
        ),
        plan,
        new ObsidianKnowledgeCompilerTargetResolver(composition.app, composition.executionOwner),
        composition.executionOwner,
        assertCurrent
      );
      assertCurrent();
      state.forwardRevisionValidationCoordinatorCreated = true;
      return coordinator;
    } catch {
      throw createAbortError();
    }
  }

  /** Creates one high-level forward decision boundary for this exact released generation. */
  createForwardRevisionDecisionCoordinator(): KnowledgeProductionForwardRevisionDecisionCoordinator {
    const state = requireComposerState(this);
    const composition = state.composition;
    const plan = state.plan;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !plan ||
      state.forwardRevisionValidationCoordinatorCreated ||
      state.forwardRevisionDecisionCoordinatorCreated
    ) {
      throw createAbortError();
    }
    try {
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      };
      assertCurrent();
      const validator = new KnowledgeProductionForwardRevisionValidationCoordinator(
        new KnowledgeRuntimeForwardRevisionValidationPort(
          composition.runtime,
          composition.proofPort
        ),
        plan,
        new ObsidianKnowledgeCompilerTargetResolver(composition.app, composition.executionOwner),
        composition.executionOwner,
        assertCurrent
      );
      const decisions = new KnowledgeRuntimeForwardRevisionDecisionPort(
        composition.runtime,
        composition.proofPort,
        KnowledgePluginProductionWorkflowLease.getExecutionLease(
          composition.workflowLease,
          composition.executionOwner
        )
      );
      const coordinator = new KnowledgeProductionForwardRevisionDecisionCoordinator(
        validator,
        decisions,
        composition.executionOwner,
        assertCurrent
      );
      assertCurrent();
      state.forwardRevisionValidationCoordinatorCreated = true;
      state.forwardRevisionDecisionCoordinatorCreated = true;
      return coordinator;
    } catch {
      throw createAbortError();
    }
  }

  /** Creates one fresh forward-Apply revalidator for this exact released generation. */
  createForwardRevisionApplyCoordinator(): KnowledgeProductionForwardRevisionApplyCoordinator {
    const state = requireComposerState(this);
    const composition = state.composition;
    const plan = state.plan;
    if (
      !composition ||
      !state.coordinator ||
      !state.workerController ||
      !plan ||
      state.forwardRevisionApplyCoordinatorCreated
    ) {
      throw createAbortError();
    }
    try {
      /** Reasserts that this composer and its production dependencies remain current. */
      const assertCurrent = (): void => {
        assertCompositionCurrent(state, state.generation, composition);
        this.assertHealthy();
      };
      assertCurrent();
      const executionLease = KnowledgePluginProductionWorkflowLease.getExecutionLease(
        composition.workflowLease,
        composition.executionOwner
      );
      const fileStore = ObsidianKnowledgeFileStore.createForExecutionOwner(
        composition.app,
        composition.app.vault,
        composition.executionOwner
      );
      const transactionRunner = new KnowledgeProductionForwardRevisionApplyTransactionRunner(
        new KnowledgeRuntimeForwardRevisionApplyRecoveryPort(
          composition.runtime,
          composition.proofPort,
          executionLease
        ),
        fileStore,
        composition.executionOwner
      );
      const coordinator = new KnowledgeProductionForwardRevisionApplyCoordinator(
        new KnowledgeRuntimeForwardRevisionApplyPort(
          composition.runtime,
          composition.proofPort,
          executionLease
        ),
        transactionRunner,
        plan,
        new ObsidianKnowledgeCompilerTargetResolver(composition.app, composition.executionOwner),
        fileStore,
        composition.executionOwner,
        assertCurrent
      );
      assertCurrent();
      state.forwardRevisionApplyCoordinatorCreated = true;
      return coordinator;
    } catch {
      throw createAbortError();
    }
  }

  /**
   * Creates the startup-only runner for an already-durable forward Apply journal.
   *
   * This factory is intentionally available before observation, worker, parser,
   * or model startup. The returned runner retains only commit-wins Runtime and
   * Vault recovery authority after authenticating this exact live composition.
   */
  createForwardRevisionApplyRecoveryRunner(): KnowledgeProductionForwardRevisionApplyTransactionRunner {
    const state = requireComposerState(this);
    const composition = state.composition;
    if (!composition || state.forwardRevisionApplyRecoveryRunnerCreated) {
      throw createAbortError();
    }
    try {
      assertCompositionCurrent(state, state.generation, composition);
      const recovery = new KnowledgeRuntimeForwardRevisionApplyRecoveryPort(
        composition.runtime,
        composition.proofPort,
        KnowledgePluginProductionWorkflowLease.getExecutionLease(
          composition.workflowLease,
          composition.executionOwner
        )
      );
      const runner = new KnowledgeProductionForwardRevisionApplyTransactionRunner(
        recovery,
        ObsidianKnowledgeFileStore.createForExecutionOwner(
          composition.app,
          composition.app.vault,
          composition.executionOwner
        ),
        composition.executionOwner
      );
      if (
        !KnowledgeProductionForwardRevisionApplyTransactionRunner.matchesExecutionOwner(
          runner,
          composition.executionOwner
        ) ||
        !KnowledgeProductionForwardRevisionApplyTransactionRunner.matchesRuntimeAndVault(
          runner,
          composition.runtime,
          composition.app.vault
        )
      ) {
        throw createAbortError();
      }
      state.forwardRevisionApplyRecoveryRunnerCreated = true;
      return runner;
    } catch {
      throw createAbortError();
    }
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
    state.sourceRecoveryIssues = undefined;
    state.worker = undefined;
    state.workerController = undefined;
    state.modelRouteLease = undefined;
    state.appliedWikiInspectorCreated = undefined;
    state.knownAppliedWikiOutputsCreated = undefined;
    state.forwardRevisionProposalActionCreated = undefined;
    state.forwardRevisionValidationCoordinatorCreated = undefined;
    state.forwardRevisionDecisionCoordinatorCreated = undefined;
    state.forwardRevisionApplyCoordinatorCreated = undefined;
    state.forwardRevisionApplyRecoveryRunnerCreated = undefined;
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
      composition?.freshnessAdmission.close();
    } catch {
      // Freshness output reads are already revoked by generation closure.
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
