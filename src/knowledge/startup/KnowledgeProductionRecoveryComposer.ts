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
  snapshotKnowledgeForwardRevisionStudioSnapshot,
  type KnowledgeForwardRevisionStudioSnapshot,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection";
import type {
  KnowledgeForwardRevisionStudioApplyingReview,
  KnowledgeForwardRevisionStudioRecoveryRequiredReview,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
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
  KnowledgeRuntimeForwardRevisionStudioPort,
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

export interface KnowledgeProductionRecoveryComposerInput {
  runtime: KnowledgeRuntimeStore;

  vault: Vault;

  bundles: readonly KnowledgeBundleConfig[];

  forwardRevisionApplyRecovery?: KnowledgeProductionForwardRevisionApplyTransactionRunner;
}

export type KnowledgeProductionRecoveryDiagnosticCode =
  | "input_invalid"
  | "active_transaction_owner_unconfigured"
  | "runtime_state_invalid"
  | "recovery_failed";

export interface KnowledgeProductionRecoveryBundleResult {
  bundleId: string;
  disposition: KnowledgeStartupGateDisposition;
  attentionKinds: readonly KnowledgeProductionRecoveryAttentionKind[];
}

export type KnowledgeProductionRecoveryAttentionKind =
  | KnowledgeStartupAttention["kind"]
  | "forward_revision_apply_recovery_required";

export interface KnowledgeProductionRecoveryStudioObservation {
  bundleId: string;
  runtimeRevision: number;
  reviewRevision: number;
  activity: Readonly<KnowledgeActivityModel>;
  recovery: Readonly<KnowledgeRecoveryModel>;
  forwardRevisionReviews: readonly Readonly<
    | KnowledgeForwardRevisionStudioApplyingReview
    | KnowledgeForwardRevisionStudioRecoveryRequiredReview
  >[];
}

export type KnowledgeProductionFreshReleaseResult =
  | Readonly<{ kind: "released"; bundleIds: readonly string[] }>
  | Readonly<{ kind: "blocked"; bundleId: string }>
  | Readonly<{ kind: "observation_changed"; bundleId: string }>;

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

export type KnowledgeProductionRecoveryStateListener = () => void;

class KnowledgeProductionRecoveryCapabilityUnavailableError extends Error {
  constructor() {
    super("The production Knowledge recovery generation cannot execute new work");
    this.name = "KnowledgeProductionRecoveryCapabilityUnavailableError";
  }
}

class FailClosedRecoveryIngestExecutor implements IngestExecutor {
  async execute(_context: IngestExecutionContext): Promise<never> {
    throw new KnowledgeProductionRecoveryCapabilityUnavailableError();
  }
}

class FailClosedRecoveryArtifactResolver implements SourceArtifactResolver {
  async resolve(_locator: SourceLocator): Promise<never> {
    throw new KnowledgeProductionRecoveryCapabilityUnavailableError();
  }
}

class FailClosedRecoveryProjectionValidator implements KnowledgeProjectionValidator {
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
  forwardRevisionStudio: KnowledgeRuntimeForwardRevisionStudioPort;
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

interface KnowledgeProductionRecoveryGenerationResult {
  state: KnowledgeProductionRecoveryState;
  studioObservation?: Readonly<KnowledgeProductionRecoveryStudioObservation>;
}

class KnowledgeProductionRecoveryInputError extends TypeError {
  constructor() {
    super("The production Knowledge recovery input is invalid");
    this.name = "KnowledgeProductionRecoveryInputError";
  }
}

class KnowledgeProductionRecoveryActiveOwnerError extends Error {
  constructor() {
    super("The active Knowledge transaction owner is not configured");
    this.name = "KnowledgeProductionRecoveryActiveOwnerError";
  }
}

class KnowledgeProductionRecoveryRuntimeStateError extends Error {
  constructor() {
    super("The production Knowledge Runtime state is invalid");
    this.name = "KnowledgeProductionRecoveryRuntimeStateError";
  }
}

class KnowledgeProductionRecoveryGenerationError extends Error {
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
    forwardRevisionStudio: new KnowledgeRuntimeForwardRevisionStudioPort(runtime),
    ...(forwardRevisionApplyRecovery === undefined ? {} : { forwardRevisionApplyRecovery }),
  });
}

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

function freezeState(state: KnowledgeProductionRecoveryState): KnowledgeProductionRecoveryState {
  if ("bundleIds" in state) {
    Object.freeze(state.bundleIds);
  }
  if ("bundleResults" in state) {
    Object.freeze(state.bundleResults);
  }
  return Object.freeze(state);
}

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

function classifyRecoveryFailure(error: unknown): KnowledgeProductionRecoveryDiagnosticCode {
  if (error instanceof KnowledgeProductionRecoveryActiveOwnerError) {
    return "active_transaction_owner_unconfigured";
  }
  if (error instanceof KnowledgeProductionRecoveryRuntimeStateError) {
    return "runtime_state_invalid";
  }
  return "recovery_failed";
}

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
    forwardRevisionReviews: Object.freeze([]),
  });
}

function createForwardRevisionStudioObservation(
  snapshotValue: Readonly<KnowledgeForwardRevisionStudioSnapshot>,
  expectedState: "applying" | "recovery_required"
): Readonly<KnowledgeProductionRecoveryStudioObservation> {
  const snapshot = snapshotKnowledgeForwardRevisionStudioSnapshot(snapshotValue);
  const matching = snapshot.activeRecords.filter((record) => record.state === expectedState);
  if (matching.length !== 1) {
    throw new KnowledgeProductionRecoveryRuntimeStateError();
  }
  const record = matching[0];
  if (record.state !== expectedState) {
    throw new KnowledgeProductionRecoveryRuntimeStateError();
  }
  const base = {
    reviewRef: record.reviewRef,
    snapshotRef: record.snapshotRef,
    pagePath: record.pagePath,
    updatedAt: record.updatedAt,
    acceptedAt: record.acceptedAt,
    manualOverride: record.manualOverride,
  };
  const review =
    record.state === "applying"
      ? Object.freeze({ state: "applying" as const, ...base, applyPhase: record.applyPhase })
      : Object.freeze({
          state: "recovery_required" as const,
          ...base,
          conflictCode: record.conflictCode,
          actualKind: record.actualKind,
          detectedAt: record.detectedAt,
        });
  const byStatus = Object.freeze({
    queued: 0,
    parsing: 0,
    analyzing: 0,
    associating: 0,
    generating: 0,
    validating: 0,
    awaiting_review: 0,
    applying: 0,
    finalizing: 0,
    paused: 0,
    recovery_required: 0,
    failed: 0,
    cancelled: 0,
    completed: 0,
  });
  const activity: Readonly<KnowledgeActivityModel> = Object.freeze({
    bundleId: snapshot.bundleId,
    revision: 0,
    controls: Object.freeze({
      state:
        expectedState === "recovery_required"
          ? ("recovery_required" as const)
          : ("startup_recovery" as const),
      canPause: false,
      canResume: false,
    }),
    items: Object.freeze([]),
    counts: Object.freeze({
      total: 0,
      active: 0,
      terminal: 0,
      hiddenTerminal: 0,
      byStatus,
    }),
  });
  const recovery: Readonly<KnowledgeRecoveryModel> = Object.freeze({
    bundleId: snapshot.bundleId,
    runtimeRevision: snapshot.runtimeRevision,
    items: Object.freeze([]),
  });
  return Object.freeze({
    bundleId: snapshot.bundleId,
    runtimeRevision: snapshot.runtimeRevision,
    reviewRevision: snapshot.reviewRevision,
    activity,
    recovery,
    forwardRevisionReviews: Object.freeze([review]),
  });
}

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
    const forwardRevisionSnapshot =
      await composition.forwardRevisionStudio.readForwardRevisionStudioBundle(result.bundleId);
    if (!isCurrent()) return undefined;
    const studioObservation = createForwardRevisionStudioObservation(
      forwardRevisionSnapshot,
      result.kind === "recovery_required" ? "recovery_required" : "applying"
    );
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
      studioObservation,
    };
  }
  throw new KnowledgeProductionRecoveryRuntimeStateError();
}

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
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }
}

export class KnowledgeProductionRecoveryComposer {
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

  getState(): KnowledgeProductionRecoveryState {
    return composerStates.get(this)?.published ?? INVALID_FALLBACK_STATE;
  }

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

  subscribe(listener: KnowledgeProductionRecoveryStateListener): () => void {
    const internal = composerStates.get(this);
    if (!internal || internal.closed) return () => undefined;
    internal.listeners.add(listener);
    return () => internal.listeners.delete(listener);
  }

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
