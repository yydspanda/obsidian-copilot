import type { Vault } from "obsidian";

import { ApplyCommitCoordinator } from "@/knowledge/changeset/ApplyCommitCoordinator";
import { ChangeSetTransaction } from "@/knowledge/changeset/ChangeSetTransaction";
import {
  ChangeSetValidator,
  type KnowledgeProjectionValidationInput,
  type KnowledgeProjectionValidationResult,
  type KnowledgeProjectionValidator,
  type SourceArtifactResolver,
} from "@/knowledge/changeset/ChangeSetValidator";
import { KnowledgeProductionForwardRevisionApplyTransactionRunner } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator";
import {
  IngestQueue,
  type IngestExecutionContext,
  type IngestExecutor,
} from "@/knowledge/ingest/queue/IngestQueue";
import { parseKnowledgeBundleConfig } from "@/knowledge/model/schemas";
import type { KnowledgeBundleConfig, SourceLocator } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import {
  KnowledgeStartupGate,
  type KnowledgeStartupAttention,
  type KnowledgeStartupGateDisposition,
  type KnowledgeStartupGateResult,
} from "@/knowledge/recovery/KnowledgeStartupGate";
import { KnowledgeStartupReleaseCoordinator } from "@/knowledge/recovery/KnowledgeStartupRelease";
import { ChangeSetReviewRepository } from "@/knowledge/review/ChangeSetReviewRepository";
import { ReviewQueueStartupReconciler } from "@/knowledge/review/ReviewQueueStartupReconciler";
import {
  KnowledgeRuntimeApplyAuthorityPort,
  KnowledgeRuntimeApplyCommitManifestPort,
  KnowledgeRuntimeNoJournalApplyRecoveryPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeReviewStorage,
  KnowledgeRuntimeStore,
  KnowledgeRuntimeTransactionStorage,
  KnowledgeRuntimeStartupReleasePort,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { ObsidianKnowledgeFileStore } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import {
  deriveKnowledgeActivityModel,
  type KnowledgeActivityModel,
} from "@/knowledge/ui/activityModel";
import {
  deriveKnowledgeRecoveryModel,
  type KnowledgeRecoveryModel,
} from "@/knowledge/ui/recoveryModel";

const MAX_CONFIGURED_BUNDLES = 10_000;
const MAX_FORWARD_REVISION_RECOVERY_ATTEMPTS = 3;

/** Exact production dependencies captured by one recovery-only lifecycle. */
export interface KnowledgeProductionRecoveryComposerInput {
  /** Already initialized Vault-private Runtime store owned by this plugin generation. */
  runtime: KnowledgeRuntimeStore;
  /** Exact Obsidian Vault whose generated files may require journal roll-forward. */
  vault: Vault;
  /** Complete strict Bundle set captured from one Projects generation. */
  bundles: readonly KnowledgeBundleConfig[];
  /** Genuine same-Runtime/Vault runner for an already-durable forward Apply journal. */
  forwardRevisionApplyRecovery?: KnowledgeProductionForwardRevisionApplyTransactionRunner;
}

/** Closed diagnostic vocabulary that never includes raw Runtime or Vault values. */
export type KnowledgeProductionRecoveryDiagnosticCode =
  | "input_invalid"
  | "active_transaction_owner_unconfigured"
  | "runtime_state_invalid"
  | "recovery_failed";

/** Sanitized result of running one Bundle through the production startup Gate. */
export interface KnowledgeProductionRecoveryBundleResult {
  bundleId: string;
  disposition: KnowledgeStartupGateDisposition;
  attentionKinds: readonly KnowledgeProductionRecoveryAttentionKind[];
}

/** Closed recovery evidence accepted by the plugin startup barrier. */
export type KnowledgeProductionRecoveryAttentionKind =
  | KnowledgeStartupAttention["kind"]
  | "forward_revision_apply_recovery_required";

/** Narrow stopped-Bundle projection retained only for the recovery Studio delegate. */
export interface KnowledgeProductionRecoveryStudioObservation {
  bundleId: string;
  runtimeRevision: number;
  reviewRevision: number;
  activity: Readonly<KnowledgeActivityModel>;
  recovery: Readonly<KnowledgeRecoveryModel>;
}

/** Sanitized outcome of a fresh Gate plus conditional release pass. */
export type KnowledgeProductionFreshReleaseResult =
  | Readonly<{ kind: "released"; bundleIds: readonly string[] }>
  | Readonly<{ kind: "blocked"; bundleId: string }>
  | Readonly<{ kind: "observation_changed"; bundleId: string }>;

/** Immutable lifecycle state published by the recovery-only composer. */
export type KnowledgeProductionRecoveryState =
  | Readonly<{
      generation: number;
      status: "idle" | "recovering";
      bundleIds: readonly string[];
    }>
  | Readonly<{
      generation: number;
      status: "observed_clear";
      bundleResults: readonly KnowledgeProductionRecoveryBundleResult[];
    }>
  | Readonly<{
      generation: number;
      status: "attention_required" | "blocked";
      stoppedBundleId: string;
      bundleResults: readonly KnowledgeProductionRecoveryBundleResult[];
    }>
  | Readonly<{
      generation: number;
      status: "diagnostic";
      code: KnowledgeProductionRecoveryDiagnosticCode;
    }>
  | Readonly<{
      generation: number;
      status: "closed";
    }>;

/** Listener notified only after a current generation publishes a state. */
export type KnowledgeProductionRecoveryStateListener = () => void;

/** Internal capability boundary deliberately absent from all recovery paths. */
class KnowledgeProductionRecoveryCapabilityUnavailableError extends Error {
  /** Creates a static failure without retaining execution input. */
  constructor() {
    super("The production Knowledge recovery generation cannot execute new work");
    this.name = "KnowledgeProductionRecoveryCapabilityUnavailableError";
  }
}

/** Queue executor that makes accidental worker execution fail before doing work. */
class FailClosedRecoveryIngestExecutor implements IngestExecutor {
  /** Rejects every attempt because recovery may never claim new Queue work. */
  async execute(_context: IngestExecutionContext): Promise<never> {
    throw new KnowledgeProductionRecoveryCapabilityUnavailableError();
  }
}

/** Artifact boundary unavailable to recovery-only transaction composition. */
class FailClosedRecoveryArtifactResolver implements SourceArtifactResolver {
  /** Rejects every lookup because startup may only resume an existing journal. */
  async resolve(_locator: SourceLocator): Promise<never> {
    throw new KnowledgeProductionRecoveryCapabilityUnavailableError();
  }
}

/** Projection boundary unavailable to recovery-only transaction composition. */
class FailClosedRecoveryProjectionValidator implements KnowledgeProjectionValidator {
  /** Rejects every validation because startup may not prepare a new transaction. */
  async validate(
    _input: KnowledgeProjectionValidationInput
  ): Promise<KnowledgeProjectionValidationResult> {
    throw new KnowledgeProductionRecoveryCapabilityUnavailableError();
  }
}

interface KnowledgeProductionRecoveryComposition {
  bundles: readonly KnowledgeBundleConfig[];
  bundlesById: ReadonlyMap<string, KnowledgeBundleConfig>;
  transaction: ChangeSetTransaction;
  gate: KnowledgeStartupGate;
  release: KnowledgeStartupReleaseCoordinator;
  forwardRevisionApplyRecovery?: KnowledgeProductionForwardRevisionApplyTransactionRunner;
}

interface KnowledgeProductionRecoveryInternalState {
  generation: number;
  closed: boolean;
  composition?: KnowledgeProductionRecoveryComposition;
  compositionFailure?: KnowledgeProductionRecoveryDiagnosticCode;
  published: KnowledgeProductionRecoveryState;
  studioObservation?: Readonly<KnowledgeProductionRecoveryStudioObservation>;
  operationTail: Promise<void>;
  listeners: Set<KnowledgeProductionRecoveryStateListener>;
}

/** Internal Gate generation outcome and its optional recovery-only UI projection. */
interface KnowledgeProductionRecoveryGenerationResult {
  state: KnowledgeProductionRecoveryState;
  studioObservation?: Readonly<KnowledgeProductionRecoveryStudioObservation>;
}

class KnowledgeProductionRecoveryInputError extends TypeError {
  /** Creates one static input failure without retaining its source value. */
  constructor() {
    super("The production Knowledge recovery input is invalid");
    this.name = "KnowledgeProductionRecoveryInputError";
  }
}

class KnowledgeProductionRecoveryActiveOwnerError extends Error {
  /** Creates one sanitized missing-owner failure without retaining the owner identity. */
  constructor() {
    super("The active Knowledge transaction owner is not configured");
    this.name = "KnowledgeProductionRecoveryActiveOwnerError";
  }
}

class KnowledgeProductionRecoveryRuntimeStateError extends Error {
  /** Creates one sanitized Runtime-state failure without retaining its cause. */
  constructor() {
    super("The production Knowledge Runtime state is invalid");
    this.name = "KnowledgeProductionRecoveryRuntimeStateError";
  }
}

class KnowledgeProductionRecoveryGenerationError extends Error {
  /** Creates one static stale-generation failure without retaining recovery state. */
  constructor() {
    super("The production Knowledge recovery generation is no longer current");
    this.name = "KnowledgeProductionRecoveryGenerationError";
  }
}

const composerStates = new WeakMap<object, KnowledgeProductionRecoveryInternalState>();

const INVALID_FALLBACK_STATE: KnowledgeProductionRecoveryState = Object.freeze({
  generation: 0,
  status: "diagnostic",
  code: "input_invalid",
});

/** Reads one enumerable own data property without evaluating accessors. */
function readDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new KnowledgeProductionRecoveryInputError();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  return descriptor.value;
}

/** Reads one optional enumerable own data property without evaluating accessors. */
function readOptionalDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new KnowledgeProductionRecoveryInputError();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  return descriptor.value;
}

/** Captures a bounded dense array without consulting iterator hooks. */
function snapshotDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > MAX_CONFIGURED_BUNDLES ||
    Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
  ) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KnowledgeProductionRecoveryInputError();
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

/** Copies one Bundle from data properties before strict schema and semantic validation. */
function snapshotBundle(value: unknown): KnowledgeBundleConfig {
  const sourceRoots = snapshotDenseArray(readDataProperty(value, "sourceRoots"));
  const candidate = {
    version: readDataProperty(value, "version"),
    id: readDataProperty(value, "id"),
    sourceRoots,
    wikiRoot: readDataProperty(value, "wikiRoot"),
    schemaRef: readDataProperty(value, "schemaRef"),
    reviewMode: readDataProperty(value, "reviewMode"),
  };
  const expectedKeys = ["id", "reviewMode", "schemaRef", "sourceRoots", "version", "wikiRoot"];
  const actualKeys = Reflect.ownKeys(value as object)
    .filter((key): key is string => typeof key === "string")
    .sort();
  if (
    Reflect.ownKeys(value as object).some((key) => typeof key !== "string") ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  const parsed = parseKnowledgeBundleConfig(candidate);
  if (!parsed.ok || !validateKnowledgeBundleConfig(parsed.value).valid) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  Object.freeze(parsed.value.sourceRoots);
  return Object.freeze(parsed.value);
}

/** Captures and deterministically orders one complete strict Bundle generation. */
function snapshotBundles(value: unknown): readonly KnowledgeBundleConfig[] {
  const captured = snapshotDenseArray(value).map(snapshotBundle);
  captured.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (let index = 1; index < captured.length; index += 1) {
    if (captured[index - 1].id === captured[index].id) {
      throw new KnowledgeProductionRecoveryInputError();
    }
  }
  return Object.freeze(captured);
}

/** Composes all recovery ports over the exact Runtime, Vault, and Bundle snapshot. */
function composeRecovery(
  input: KnowledgeProductionRecoveryComposerInput
): KnowledgeProductionRecoveryComposition {
  const runtime = readDataProperty(input, "runtime");
  const vault = readDataProperty(input, "vault");
  const bundles = snapshotBundles(readDataProperty(input, "bundles"));
  const forwardRevisionApplyRecovery = readOptionalDataProperty(
    input,
    "forwardRevisionApplyRecovery"
  );
  if (!(runtime instanceof KnowledgeRuntimeStore) || typeof vault !== "object" || vault === null) {
    throw new KnowledgeProductionRecoveryInputError();
  }
  if (forwardRevisionApplyRecovery !== undefined) {
    KnowledgeProductionForwardRevisionApplyTransactionRunner.assert(forwardRevisionApplyRecovery);
    if (
      !KnowledgeProductionForwardRevisionApplyTransactionRunner.matchesRuntimeAndVault(
        forwardRevisionApplyRecovery,
        runtime,
        vault
      )
    ) {
      throw new KnowledgeProductionRecoveryInputError();
    }
  }

  const queue = new IngestQueue(
    new KnowledgeRuntimeQueueStorage(runtime),
    new FailClosedRecoveryIngestExecutor()
  );
  const reviews = new ChangeSetReviewRepository(new KnowledgeRuntimeReviewStorage(runtime));
  const fileStore = new ObsidianKnowledgeFileStore(vault as Vault);
  const transaction = new ChangeSetTransaction({
    storage: new KnowledgeRuntimeTransactionStorage(runtime),
    fileStore,
    validator: new ChangeSetValidator(
      fileStore,
      new FailClosedRecoveryArtifactResolver(),
      new FailClosedRecoveryProjectionValidator()
    ),
    authority: new KnowledgeRuntimeApplyAuthorityPort(runtime),
  });
  const gate = new KnowledgeStartupGate({
    queue,
    applyCommit: new ApplyCommitCoordinator({
      transaction,
      queue,
      manifest: new KnowledgeRuntimeApplyCommitManifestPort(runtime),
    }),
    reviews: new ReviewQueueStartupReconciler({ reviews, queue }),
    accepted: new KnowledgeRuntimeNoJournalApplyRecoveryPort(runtime),
  });
  const release = new KnowledgeStartupReleaseCoordinator(
    new KnowledgeRuntimeStartupReleasePort(runtime)
  );
  return Object.freeze({
    bundles,
    bundlesById: new Map(bundles.map((bundle) => [bundle.id, bundle])),
    transaction,
    gate,
    release,
    ...(forwardRevisionApplyRecovery === undefined ? {} : { forwardRevisionApplyRecovery }),
  });
}

/** Freezes one sanitized Bundle summary without retaining a Gate result. */
function summarizeGateResult(
  expectedBundleId: string,
  result: KnowledgeStartupGateResult
): KnowledgeProductionRecoveryBundleResult {
  if (result.bundleId !== expectedBundleId) {
    throw new Error("The production Knowledge Gate returned another Bundle");
  }
  const attentionKinds = Object.freeze(
    Array.from(new Set(result.attention.map((attention) => attention.kind)))
  );
  return Object.freeze({
    bundleId: expectedBundleId,
    disposition: result.disposition,
    attentionKinds,
  });
}

/** Creates one immutable state and freezes every nested public collection. */
function freezeState(state: KnowledgeProductionRecoveryState): KnowledgeProductionRecoveryState {
  if ("bundleIds" in state) {
    Object.freeze(state.bundleIds);
  }
  if ("bundleResults" in state) {
    Object.freeze(state.bundleResults);
  }
  return Object.freeze(state);
}

/** Returns Bundles in Vault-global transaction-owner-first recovery order. */
async function orderBundlesForRecovery(
  composition: KnowledgeProductionRecoveryComposition
): Promise<readonly KnowledgeBundleConfig[]> {
  let active;
  try {
    active = await composition.transaction.loadActive();
  } catch {
    throw new KnowledgeProductionRecoveryRuntimeStateError();
  }
  if (!active) {
    return composition.bundles;
  }
  const owner = composition.bundlesById.get(active.bundleId);
  if (!owner) {
    throw new KnowledgeProductionRecoveryActiveOwnerError();
  }
  return Object.freeze([owner, ...composition.bundles.filter((bundle) => bundle.id !== owner.id)]);
}

/** Maps a caught recovery failure to one static diagnostic code. */
function classifyRecoveryFailure(error: unknown): KnowledgeProductionRecoveryDiagnosticCode {
  if (error instanceof KnowledgeProductionRecoveryActiveOwnerError) {
    return "active_transaction_owner_unconfigured";
  }
  if (error instanceof KnowledgeProductionRecoveryRuntimeStateError) {
    return "runtime_state_invalid";
  }
  return "recovery_failed";
}

/** Projects one trusted Gate result into the content-free recovery Studio contract. */
function createStudioObservation(
  result: KnowledgeStartupGateResult
): Readonly<KnowledgeProductionRecoveryStudioObservation> {
  const recovery = deriveKnowledgeRecoveryModel({
    bundleId: result.bundleId,
    runtimeRevision: result.runtimeRevision,
    reviewRevision: result.reviewRevision,
    queueSnapshot: result.queueSnapshot,
    globalTransaction: result.globalTransaction,
    classifications: result.acceptedClassifications,
  });
  return Object.freeze({
    bundleId: result.bundleId,
    runtimeRevision: result.runtimeRevision,
    reviewRevision: result.reviewRevision,
    activity: deriveKnowledgeActivityModel(result.queueSnapshot),
    recovery,
  });
}

/**
 * Converges an already-durable forward Apply before any legacy Bundle Gate runs.
 *
 * A transient unchanged-before result receives a bounded immediate retry. A
 * sticky conflict or exhausted retry remains globally blocked, while an exact
 * commit proceeds to the ordinary owner-first recovery sequence.
 */
async function runForwardRevisionApplyRecovery(
  composition: KnowledgeProductionRecoveryComposition,
  generation: number,
  isCurrent: () => boolean
): Promise<KnowledgeProductionRecoveryGenerationResult | null | undefined> {
  const runner = composition.forwardRevisionApplyRecovery;
  if (!runner) return null;
  const signal = new AbortController().signal;
  for (let attempt = 0; attempt < MAX_FORWARD_REVISION_RECOVERY_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) return undefined;
    const result = await runner.recoverActive(signal);
    if (!isCurrent()) return undefined;
    if (result.kind === "idle") return null;
    if (!composition.bundlesById.has(result.bundleId)) {
      throw new KnowledgeProductionRecoveryActiveOwnerError();
    }
    if (result.kind === "committed") return null;
    if (result.kind === "in_progress" && attempt + 1 < MAX_FORWARD_REVISION_RECOVERY_ATTEMPTS) {
      continue;
    }
    const summary = Object.freeze({
      bundleId: result.bundleId,
      disposition: "blocked" as const,
      attentionKinds: Object.freeze(["forward_revision_apply_recovery_required" as const]),
    });
    return {
      state: freezeState({
        generation,
        status: "blocked",
        stoppedBundleId: result.bundleId,
        bundleResults: Object.freeze([summary]),
      }),
    };
  }
  throw new KnowledgeProductionRecoveryRuntimeStateError();
}

/** Runs only the startup Gate and stops at the first non-clear Bundle. */
async function runRecoveryGeneration(
  composition: KnowledgeProductionRecoveryComposition,
  generation: number,
  isCurrent: () => boolean
): Promise<KnowledgeProductionRecoveryGenerationResult | undefined> {
  const forwardResult = await runForwardRevisionApplyRecovery(composition, generation, isCurrent);
  if (forwardResult !== null) return forwardResult;
  const bundles = await orderBundlesForRecovery(composition);
  if (!isCurrent()) return undefined;
  const bundleResults: KnowledgeProductionRecoveryBundleResult[] = [];
  const assertCurrent = (): void => {
    if (!isCurrent()) {
      throw new KnowledgeProductionRecoveryGenerationError();
    }
  };
  for (const bundle of bundles) {
    const result = await composition.gate.run(bundle, assertCurrent);
    if (!isCurrent()) return undefined;
    const summary = summarizeGateResult(bundle.id, result);
    bundleResults.push(summary);
    if (summary.disposition !== "observed_clear") {
      return {
        state: freezeState({
          generation,
          status: summary.disposition,
          stoppedBundleId: bundle.id,
          bundleResults: Object.freeze([...bundleResults]),
        }),
        studioObservation: createStudioObservation(result),
      };
    }
  }
  return {
    state: freezeState({
      generation,
      status: "observed_clear",
      bundleResults: Object.freeze([...bundleResults]),
    }),
  };
}

/** Publishes one state, then notifies a stable listener snapshot. */
function publishState(
  internal: KnowledgeProductionRecoveryInternalState,
  state: KnowledgeProductionRecoveryState
): void {
  internal.published = state;
  for (const listener of [...internal.listeners]) {
    try {
      listener();
    } catch {
      // Observers cannot interrupt recovery or prevent later observers from running.
    }
  }
}

/**
 * Owns one production recovery-only composition and its publication lifecycle.
 *
 * This boundary may pause/reconcile durable Queue and Review state and may roll
 * forward a pre-existing journal. It cannot claim Queue work, release startup,
 * make a no-journal decision, prepare a new transaction, or invoke a model.
 */
export class KnowledgeProductionRecoveryComposer {
  /** Captures all production capabilities and strict Bundle values synchronously. */
  constructor(input: KnowledgeProductionRecoveryComposerInput) {
    let composition: KnowledgeProductionRecoveryComposition | undefined;
    let compositionFailure: KnowledgeProductionRecoveryDiagnosticCode | undefined;
    try {
      composition = composeRecovery(input);
    } catch {
      compositionFailure = "input_invalid";
    }
    const published = composition
      ? freezeState({
          generation: 0,
          status: "idle",
          bundleIds: Object.freeze(composition.bundles.map((bundle) => bundle.id)),
        })
      : freezeState({ generation: 0, status: "diagnostic", code: "input_invalid" });
    composerStates.set(this, {
      generation: 0,
      closed: false,
      ...(composition === undefined ? {} : { composition }),
      ...(compositionFailure === undefined ? {} : { compositionFailure }),
      published,
      operationTail: Promise.resolve(),
      listeners: new Set(),
    });
    Object.freeze(this);
  }

  /** Proves a recovery composer was constructed by this module without exposing its ports. */
  static assert(value: unknown): asserts value is KnowledgeProductionRecoveryComposer {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeProductionRecoveryComposer.prototype ||
      !composerStates.has(value)
    ) {
      throw new KnowledgeProductionRecoveryInputError();
    }
  }

  /** Returns the latest immutable sanitized lifecycle observation. */
  getState(): KnowledgeProductionRecoveryState {
    return composerStates.get(this)?.published ?? INVALID_FALLBACK_STATE;
  }

  /** Returns the latest exact stopped-Bundle projection without exposing Gate mutation ports. */
  getStudioObservation(
    bundleId: string
  ): Readonly<KnowledgeProductionRecoveryStudioObservation> | undefined {
    const internal = composerStates.get(this);
    const observation = internal?.studioObservation;
    if (!internal || internal.closed || !observation || observation.bundleId !== bundleId) {
      return undefined;
    }
    return observation;
  }

  /** Subscribes to current-generation state publications. */
  subscribe(listener: KnowledgeProductionRecoveryStateListener): () => void {
    const internal = composerStates.get(this);
    if (!internal || internal.closed) return () => undefined;
    internal.listeners.add(listener);
    return () => internal.listeners.delete(listener);
  }

  /**
   * Runs the owner-first recovery Gate sequence for a new lifecycle generation.
   *
   * A newer call supersedes publication from older work. Durable recovery itself
   * is serialized and allowed to reach a safe point because it cannot be aborted
   * halfway through a transaction roll-forward.
   */
  async start(): Promise<void> {
    const internal = composerStates.get(this);
    if (!internal || internal.closed) return;
    const generation = ++internal.generation;
    internal.studioObservation = undefined;
    const composition = internal.composition;
    if (!composition) {
      publishState(
        internal,
        freezeState({
          generation,
          status: "diagnostic",
          code: internal.compositionFailure ?? "input_invalid",
        })
      );
      return;
    }
    publishState(
      internal,
      freezeState({
        generation,
        status: "recovering",
        bundleIds: Object.freeze(composition.bundles.map((bundle) => bundle.id)),
      })
    );

    const previous = internal.operationTail;
    const work = previous
      .catch(() => undefined)
      .then(async () => {
        const isCurrent = () =>
          !internal.closed &&
          internal.generation === generation &&
          internal.composition === composition;
        if (!isCurrent()) return;
        let next: KnowledgeProductionRecoveryGenerationResult | undefined;
        try {
          next = await runRecoveryGeneration(composition, generation, isCurrent);
        } catch (error) {
          if (!isCurrent()) return;
          next = {
            state: freezeState({
              generation,
              status: "diagnostic",
              code: classifyRecoveryFailure(error),
            }),
          };
        }
        if (next && isCurrent()) {
          internal.studioObservation = next.studioObservation;
          publishState(internal, next.state);
        }
      });
    internal.operationTail = work;
    await work;
  }

  /** Runs a fresh Gate and conditionally releases every configured Bundle Queue. */
  async releaseFresh(assertCurrent: () => void): Promise<KnowledgeProductionFreshReleaseResult> {
    const internal = composerStates.get(this);
    if (!internal || internal.closed || !internal.composition) {
      throw new KnowledgeProductionRecoveryGenerationError();
    }
    const { composition } = internal;
    for (const bundle of composition.bundles) {
      assertCurrent();
      const gateResult = await composition.gate.run(bundle, assertCurrent);
      assertCurrent();
      if (gateResult.disposition !== "observed_clear") {
        return {
          kind: "blocked",
          bundleId: bundle.id,
        };
      }
      const result = await composition.release.release(gateResult);
      assertCurrent();
      if (result.kind === "released" || result.kind === "unchanged") {
        continue;
      }
      if (result.kind === "observation_changed") {
        return { kind: "observation_changed", bundleId: bundle.id };
      }
      return { kind: "blocked", bundleId: bundle.id };
    }
    return { kind: "released", bundleIds: Object.freeze(composition.bundles.map(({ id }) => id)) };
  }

  /** Permanently closes capabilities and prevents every stale completion from publishing. */
  close(): void {
    const internal = composerStates.get(this);
    if (!internal || internal.closed) return;
    internal.closed = true;
    internal.generation += 1;
    internal.composition = undefined;
    internal.studioObservation = undefined;
    publishState(internal, freezeState({ generation: internal.generation, status: "closed" }));
    internal.listeners.clear();
  }
}

Object.freeze(KnowledgeProductionRecoveryComposer.prototype);
Object.freeze(KnowledgeProductionRecoveryComposer);
